// ============================================================================
// passwordReset — v3.9.0-S4 密码找回路由
//
// 端点（公开，无需 authenticateToken）：
//   POST /api/auth/password-reset/request  请求重置邮件（按 IP 限流 5 次/小时）
//   POST /api/auth/password-reset/confirm  通过 token 重置密码
//
// 流程：
//   1. request：输入 email → 生成 token（crypto.randomBytes(32)）→ 存 sha256(token) 到
//      password_resets 表（expires_at = now + 1h）→ 发邮件含 reset_url
//      （邮件发送失败时仍返回 200，避免泄露 SMTP 状态；token 仍写入 DB 便于管理员排查）
//   2. confirm：输入 token + new_password → sha256(token) 查 DB → 校验未过期未使用 →
//      校验密码强度（复用 passwordPolicy.checkPasswordStrength）→
//      UPDATE users SET password_hash=bcrypt(new), password_changed_at=NOW(),
//      token_version+1 → 标记 token used_at
//
// 安全：
//   - 防账号枚举：request 无论用户是否存在均返回 200
//   - token 仅存 hash（sha256），DB 泄露不可直接用
//   - token 1 小时过期 + 使用后立即失效
//   - 密码更新后 token_version+1，强制其他设备重新登录
// ============================================================================

import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { SettingSchemaService } from '../../services/settingSchemaService.js';
import type { MailService } from '../../services/mailService.js';
import { checkPasswordStrength } from '../../services/passwordPolicy.js';
import { createPasswordResetLimiter } from '../../middleware/rateLimiter.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

interface PasswordResetRow {
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
  password_hash: string;
  token_version: number;
  password_changed_at: string | null;
  updated_at: string;
}

/** Token 有效期：1 小时 */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** sha256(token) → hex */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createPasswordResetRouter(
  db: Knex,
  settings: SettingSchemaService,
  mailService: MailService,
  logger: Logger,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /api/auth/password-reset/request
  // 防枚举：无论 email 是否存在均返回 200
  // ----------------------------------------------------------------
  router.post('/request', createPasswordResetLimiter(), async (req, res) => {
    const body = req.body as Partial<{ email: string }>;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const errBody: PanelErrorResponse = {
        error: { code: 'PANEL_VALIDATION_ERROR', message: '邮箱格式不合法' },
      };
      res.status(400).json(errBody);
      return;
    }

    try {
      const user = await db<UserRow>('users').select('id', 'email', 'username', 'token_version').where({ email }).first();

      // 用户不存在时静默成功（防枚举）
      if (user) {
        // 生成 token + 写入 DB
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
        const id = crypto.randomUUID();

        await db<PasswordResetRow>('password_resets').insert({
          id,
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt,
          used_at: null,
          created_at: now.toISOString(),
        });

        // 构造重置链接（基于请求头 origin 或 site.url 配置项——暂用 origin）
        const origin = (req.headers.origin ?? `https://${req.headers.host}`) as string;
        const resetUrl = `${origin}/reset-password?token=${token}`;
        const siteName = await settings.getString('site.name');

        // 发邮件（失败不阻断响应，仅记日志）
        try {
          await mailService.sendPasswordResetEmail(user.email, resetUrl, siteName);
        } catch (mailErr) {
          logger.error(
            { err: mailErr instanceof Error ? mailErr.message : String(mailErr), email },
            '[passwordReset] 邮件发送失败（token 已写入 DB，用户无法收到重置链接）',
          );
        }
      } else {
        logger.info({ email }, '[passwordReset] 用户不存在，静默成功（防枚举）');
      }

      res.json({ requested: true });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[passwordReset] /request 内部错误',
      );
      // 即使出错也返回 200，避免泄露内部状态
      res.json({ requested: true });
    }
  });

  // ----------------------------------------------------------------
  // POST /api/auth/password-reset/confirm
  // ----------------------------------------------------------------
  router.post('/confirm', async (req, res) => {
    const body = req.body as Partial<{ token: string; new_password: string }>;
    const token = typeof body?.token === 'string' ? body.token : '';
    const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';

    if (!token || !newPassword) {
      const errBody: PanelErrorResponse = {
        error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 token 或 new_password' },
      };
      res.status(400).json(errBody);
      return;
    }

    // 校验新密码强度
    const pwdCheck = checkPasswordStrength(newPassword);
    if (!pwdCheck.ok) {
      const errBody: PanelErrorResponse = {
        error: {
          code: 'WEAK_PASSWORD',
          message: '密码强度不足',
          details: {
            failures: pwdCheck.failures,
            suggestions: pwdCheck.suggestions,
            score: pwdCheck.score,
          },
        } as PanelErrorResponse['error'] & { details?: unknown },
      };
      res.status(400).json(errBody);
      return;
    }

    const tokenHash = hashToken(token);

    try {
      const resetRow = await db<PasswordResetRow>('password_resets')
        .where({ token_hash: tokenHash })
        .first();

      if (!resetRow) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PASSWORD_RESET_TOKEN_INVALID', message: '重置链接无效' },
        };
        res.status(400).json(errBody);
        return;
      }

      if (resetRow.used_at) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PASSWORD_RESET_TOKEN_INVALID', message: '重置链接已被使用' },
        };
        res.status(400).json(errBody);
        return;
      }

      const now = Date.now();
      const expiresAt = new Date(resetRow.expires_at).getTime();
      if (Number.isNaN(expiresAt) || expiresAt < now) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PASSWORD_RESET_TOKEN_EXPIRED', message: '重置链接已过期，请重新申请' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 取用户
      const user = await db<UserRow>('users')
        .select('id', 'email', 'username', 'token_version')
        .where({ id: resetRow.user_id })
        .first();
      if (!user) {
        // 用户已被删除
        const errBody: PanelErrorResponse = {
          error: { code: 'PASSWORD_RESET_TOKEN_INVALID', message: '账号已不存在' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 事务：UPDATE users + UPDATE password_resets
      const newHash = await bcrypt.hash(newPassword, 10);
      const nowIso = new Date().toISOString();
      const nextTokenVersion = user.token_version + 1;

      await db.transaction(async (trx) => {
        await trx<UserRow>('users').where({ id: user.id }).update({
          password_hash: newHash,
          token_version: nextTokenVersion,
          password_changed_at: nowIso,
          updated_at: nowIso,
        });
        await trx<PasswordResetRow>('password_resets').where({ id: resetRow.id }).update({
          used_at: nowIso,
        });
      });

      logger.info({ user_id: user.id }, '[passwordReset] 密码重置成功');

      res.json({ confirmed: true });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[passwordReset] /confirm 内部错误',
      );
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: '重置失败，请稍后再试' },
      });
    }
  });

  return router;
}
