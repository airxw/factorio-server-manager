// ============================================================================
// emailVerify — v3.9.0-S5 邮箱验证路由
//
// 端点：
//   POST /api/auth/email-verify/request   登录用户重发验证邮件（限流 3 次/小时/用户）
//   POST /api/auth/email-verify/confirm   通过 token 完成邮箱验证（公开，无需鉴权）
//   GET  /api/auth/email-verify/status    返回当前登录用户的 email_verified 状态
//
// 流程：
//   - register 流程：注册成功后自动发验证邮件（在 index.ts 的 register 路由内调用）
//   - /request：登录用户主动重发，生成 token 写 DB + 发邮件
//   - /confirm：输入 token → sha256(token) 查 DB → 校验未过期未使用 →
//     UPDATE users SET email_verified=1 + UPDATE email_verifications.used_at
//
// 安全：
//   - token 仅存 sha256 hash
//   - 24 小时过期
//   - 使用后立即失效
// ============================================================================

import { Router } from 'express';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { SettingSchemaService } from '../../services/settingSchemaService.js';
import type { MailService } from '../../services/mailService.js';
import { createEmailVerifyLimiter } from '../../middleware/rateLimiter.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

interface EmailVerificationRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  email_verified: number;
  updated_at: string;
}

/** Token 有效期：24 小时 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 创建邮箱验证的鉴权路由（/status + /request）
 * 在 index.ts 挂载时套 authenticateToken
 */
export function createEmailVerifyAuthRouter(
  db: Knex,
  settings: SettingSchemaService,
  mailService: MailService,
  logger: Logger,
): Router {
  const router = Router();

  // GET /status
  router.get('/status', async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '未登录' },
      });
      return;
    }
    const user = await db<UserRow>('users').select('email_verified').where({ id: userId }).first();
    if (!user) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }
    res.json({ email_verified: user.email_verified === 1 });
  });

  // POST /request
  router.post('/request', createEmailVerifyLimiter(), async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '未登录' },
      });
      return;
    }

    const user = await db<UserRow>('users')
      .select('id', 'email', 'username', 'email_verified')
      .where({ id: userId })
      .first();
    if (!user) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
      });
      return;
    }

    if (user.email_verified === 1) {
      res.json({ sent: false, reason: 'already_verified' });
      return;
    }

    // 生成 token + 写 DB
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
    const id = crypto.randomUUID();

    await db<EmailVerificationRow>('email_verifications').insert({
      id,
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used_at: null,
      created_at: now.toISOString(),
    });

    const origin = (req.headers.origin ?? `https://${req.headers.host}`) as string;
    const verifyUrl = `${origin}/verify-email?token=${token}`;
    const siteName = await settings.getString('site.name');

    try {
      await mailService.sendEmailVerifyEmail(user.email, verifyUrl, siteName);
    } catch (mailErr) {
      logger.error(
        { err: mailErr instanceof Error ? mailErr.message : String(mailErr), email: user.email },
        '[emailVerify] 邮件发送失败',
      );
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: '邮件发送失败，请检查 SMTP 配置或稍后重试' },
      });
      return;
    }

    res.json({ sent: true });
  });

  return router;
}

/**
 * 创建邮箱验证的公开路由（仅 /confirm）
 * 在 index.ts 挂载时不套 authenticateToken
 */
export function createEmailVerifyPublicRouter(
  db: Knex,
  logger: Logger,
): Router {
  const router = Router();

  // POST /confirm
  router.post('/confirm', async (req, res) => {
    const body = req.body as Partial<{ token: string }>;
    const token = typeof body?.token === 'string' ? body.token : '';

    if (!token) {
      const errBody: PanelErrorResponse = {
        error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 token' },
      };
      res.status(400).json(errBody);
      return;
    }

    const tokenHash = hashToken(token);

    try {
      const verifyRow = await db<EmailVerificationRow>('email_verifications')
        .where({ token_hash: tokenHash })
        .first();

      if (!verifyRow) {
        const errBody: PanelErrorResponse = {
          error: { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: '验证链接无效' },
        };
        res.status(400).json(errBody);
        return;
      }

      if (verifyRow.used_at) {
        const errBody: PanelErrorResponse = {
          error: { code: 'EMAIL_VERIFY_TOKEN_INVALID', message: '验证链接已被使用' },
        };
        res.status(400).json(errBody);
        return;
      }

      const now = Date.now();
      const expiresAt = new Date(verifyRow.expires_at).getTime();
      if (Number.isNaN(expiresAt) || expiresAt < now) {
        const errBody: PanelErrorResponse = {
          error: { code: 'EMAIL_VERIFY_TOKEN_EXPIRED', message: '验证链接已过期，请重新发送' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 事务：UPDATE users + UPDATE email_verifications
      const nowIso = new Date().toISOString();
      await db.transaction(async (trx) => {
        await trx<UserRow>('users').where({ id: verifyRow.user_id }).update({
          email_verified: 1,
          updated_at: nowIso,
        });
        await trx<EmailVerificationRow>('email_verifications').where({ id: verifyRow.id }).update({
          used_at: nowIso,
        });
      });

      logger.info({ user_id: verifyRow.user_id }, '[emailVerify] 邮箱验证成功');

      res.json({ verified: true });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[emailVerify] /confirm 内部错误',
      );
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: '验证失败，请稍后再试' },
      });
    }
  });

  return router;
}
