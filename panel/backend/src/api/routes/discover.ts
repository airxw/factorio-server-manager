// ============================================================================
// discover.ts — 服务器推荐位路由（v4.8.0 K1）
//
// 导出两个路由工厂：
//   1. createDiscoverRouter(db, logger) — 公开列表端点（无需认证，挂载 /api/discover）
//      GET /hot          — 热门服务器（is_public=1，按推荐+创建时间排序）
//      GET /new          — 新开服（is_public=1，按 created_at DESC）
//      GET /recommended  — 推荐服（is_recommended=1，按 recommended_at DESC）
//
//   2. createDiscoverAdminRouter(db, logger) — 管理端点（挂载 /api/admin/servers）
//      PUT /:serverId/visibility — 设置公开/私有（body: { is_public: boolean }）
//      PUT /:serverId/recommend  — 设置/取消推荐（body: { is_recommended: boolean }）
//      权限：requireAdmin（在 index.ts 挂载时套 authenticateToken + requireAdmin）
//
// 说明：
// - servers 表无 online_players 字段，响应中 online_players 固定为 0，
//   热门排序降级为 is_recommended DESC, created_at DESC
// - DB 以 INTEGER 0/1 存储 is_public/is_recommended，API 层转换为 boolean
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type {
  DiscoverListResponse,
  DiscoverServer,
  PanelErrorResponse,
  SetServerRecommendRequest,
  SetServerVisibilityRequest,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface ServerDiscoverDbRow {
  id: string;
  name: string;
  pack_id: string;
  status: string;
  is_public: number;
  is_recommended: number;
  created_at: string;
  recommended_at: string | null;
  owner_username: string | null;
}

// ===========================================================================
// 公开列表路由
// ===========================================================================

/**
 * 创建发现页公开路由（挂载 /api/discover）
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createDiscoverRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /hot — 热门服务器（is_public=1）
  // ----------------------------------------------------------------
  router.get('/hot', async (_req, res) => {
    try {
      const limit = 10; // 热门固定 10 条
      const rows = await db<ServerDiscoverDbRow>('servers as s')
        .select(
          's.id',
          's.name',
          's.pack_id',
          's.status',
          's.is_public',
          's.is_recommended',
          's.created_at',
          's.recommended_at',
          'u.username as owner_username',
        )
        .leftJoin('users as u', 's.owner_user_id', 'u.id')
        .where('s.is_public', 1)
        .whereNotIn('s.status', ['deleted', 'removing'])
        // servers 表无 online_players 字段，降级为推荐优先 + 新创建优先
        .orderBy('s.is_recommended', 'desc')
        .orderBy('s.created_at', 'desc')
        .limit(limit);

      const response: DiscoverListResponse = { servers: rows.map(toDiscoverServer) };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /new — 新开服（is_public=1，按 created_at DESC）
  // ----------------------------------------------------------------
  router.get('/new', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      const rows = await db<ServerDiscoverDbRow>('servers as s')
        .select(
          's.id',
          's.name',
          's.pack_id',
          's.status',
          's.is_public',
          's.is_recommended',
          's.created_at',
          's.recommended_at',
          'u.username as owner_username',
        )
        .leftJoin('users as u', 's.owner_user_id', 'u.id')
        .where('s.is_public', 1)
        .whereNotIn('s.status', ['deleted', 'removing'])
        .orderBy('s.created_at', 'desc')
        .limit(limit);

      const response: DiscoverListResponse = { servers: rows.map(toDiscoverServer) };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /recommended — 推荐服（is_recommended=1，按 recommended_at DESC）
  // ----------------------------------------------------------------
  router.get('/recommended', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      const rows = await db<ServerDiscoverDbRow>('servers as s')
        .select(
          's.id',
          's.name',
          's.pack_id',
          's.status',
          's.is_public',
          's.is_recommended',
          's.created_at',
          's.recommended_at',
          'u.username as owner_username',
        )
        .leftJoin('users as u', 's.owner_user_id', 'u.id')
        .where('s.is_recommended', 1)
        .whereNotIn('s.status', ['deleted', 'removing'])
        .orderBy('s.recommended_at', 'desc')
        .limit(limit);

      const response: DiscoverListResponse = { servers: rows.map(toDiscoverServer) };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 管理路由（visibility / recommend）
// ===========================================================================

/**
 * 创建发现页管理路由（挂载 /api/admin/servers，需 authenticateToken + requireAdmin）
 *
 * 端点：
 *   PUT /:serverId/visibility — 设置公开/私有
 *   PUT /:serverId/recommend  — 设置/取消推荐
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createDiscoverAdminRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // PUT /:serverId/visibility — 设置公开/私有
  // ----------------------------------------------------------------
  router.put('/:serverId/visibility', async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const body = req.body as Partial<SetServerVisibilityRequest>;
      if (typeof body.is_public !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'is_public 必须为 boolean' },
        };
        res.status(400).json(errBody);
        return;
      }

      const exists = await db<{ id: string }>('servers').select('id').where('id', serverId).first();
      if (!exists) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${serverId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      await db('servers').where('id', serverId).update({ is_public: body.is_public ? 1 : 0 });
      res.json({ server_id: serverId, is_public: body.is_public });
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT /:serverId/recommend — 设置/取消推荐
  // ----------------------------------------------------------------
  router.put('/:serverId/recommend', async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const body = req.body as Partial<SetServerRecommendRequest>;
      if (typeof body.is_recommended !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'is_recommended 必须为 boolean' },
        };
        res.status(400).json(errBody);
        return;
      }

      const exists = await db<{ id: string }>('servers').select('id').where('id', serverId).first();
      if (!exists) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${serverId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const now = new Date().toISOString();
      await db('servers')
        .where('id', serverId)
        .update({
          is_recommended: body.is_recommended ? 1 : 0,
          recommended_at: body.is_recommended ? now : null,
        });
      res.json({ server_id: serverId, is_recommended: body.is_recommended });
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 解析 limit 查询参数：默认 10，范围 1-50 */
function parseLimit(raw: unknown): number {
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.min(n, 50));
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(Math.floor(raw), 50));
  }
  return 10;
}

/** DB 行 → DiscoverServer 响应（INTEGER 0/1 → boolean） */
function toDiscoverServer(row: ServerDiscoverDbRow): DiscoverServer {
  return {
    id: row.id,
    name: row.name,
    pack_id: row.pack_id,
    status: row.status,
    online_players: 0,
    is_public: !!row.is_public,
    is_recommended: !!row.is_recommended,
    created_at: row.created_at,
    ...(row.owner_username ? { owner_username: row.owner_username } : {}),
  };
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'discover router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
