// ============================================================================
// 模块10_游戏内聊天命令 — 玩家验证码路由（Task 7）
// 挂载在 /api/verify-codes 下（在 index.ts 套 authenticateToken(JWT_SECRET)）
//   POST /          → 生成验证码（user 角色，任意已登录用户）
//   GET  /mine       → 查询当前用户未使用且未过期的验证码
// 对应服务：services/instanceBindingService（generateVerifyCode 模块级导出函数）
//           req.app.locals.db（GET /mine 直接查表，与 bindings.ts 风格一致）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import * as instanceBindingService from '../../services/instanceBindingService.js';
import { AppError } from '../../services/errors.js';
import type {
  CreateVerifyCodeRequest,
  CreateVerifyCodeResponse,
  ListMyVerifyCodesResponse,
  VerifyCodeSummary,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/** bindings(player, instance, pending) 表行视图（GET /mine 查询用；v4.17.0: 旧表 player_verify_codes 已合并） */
interface VerifyCodeRow {
  id: number;
  user_id: string;
  server_id: string;
  game_player_name: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** servers 表行视图（存在性校验用） */
interface ServerRow {
  id: string;
}

/**
 * 创建 VerifyCodes 路由
 * 鉴权由 index.ts 挂载时统一套 authenticateToken(JWT_SECRET)
 */
export function createVerifyCodesRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /api/verify-codes — 生成游戏内 !verify 命令使用的验证码
  // ----------------------------------------------------------------
  router.post('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }

      const body = req.body as Partial<CreateVerifyCodeRequest>;
      if (typeof body.server_id !== 'string' || body.server_id.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 server_id' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        typeof body.game_player_name !== 'string' ||
        body.game_player_name.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 game_player_name' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 校验实例存在（404 if not found）
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(errBody);
        return;
      }
      const server = await db<ServerRow>('servers')
        .select('id')
        .where({ id: body.server_id })
        .first();
      if (!server) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${body.server_id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const code = await instanceBindingService.generateVerifyCode(
        userId,
        body.server_id,
        body.game_player_name,
      );
      const response: CreateVerifyCodeResponse = { code };
      res.status(201).json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/verify-codes/mine — 查询当前用户未使用且未过期的验证码
  // ----------------------------------------------------------------
  router.get('/mine', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }

      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(errBody);
        return;
      }

      const nowIso = new Date().toISOString();
      // v4.17.0: 旧表 player_verify_codes 已合并到 bindings 表
      //   binding_type='player', scope_type='instance', verify_status='pending' 表示未使用的验证码
      //   通过 SELECT 别名映射到 VerifyCodeRow 字段名（保持对外契约不变）
      //   用 db('bindings') 无泛型 + as 断言，避免 knex 对别名映射的类型推断冲突
      const rows = (await db('bindings')
        .where({
          user_id: userId,
          binding_type: 'player',
          scope_type: 'instance',
          verify_status: 'pending',
        })
        .where('verify_expires_at', '>', nowIso)
        .select(
          'id',
          'user_id',
          'scope_ref as server_id',
          'player_name as game_player_name',
          'verify_code as code',
          'verify_expires_at as expires_at',
          'verified_at as used_at',
          'created_at',
        )
        .orderBy('created_at', 'desc')) as VerifyCodeRow[];

      const codes: VerifyCodeSummary[] = rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        server_id: row.server_id,
        game_player_name: row.game_player_name,
        code: row.code,
        expires_at: row.expires_at,
        used_at: row.used_at,
        created_at: row.created_at,
      }));
      const response: ListMyVerifyCodesResponse = { codes };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleInternal(res: Response, err: unknown): void {
  // AppError 兜底映射
  if (err instanceof AppError) {
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(err.httpStatus ?? 500).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
