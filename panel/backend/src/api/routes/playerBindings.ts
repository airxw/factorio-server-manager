// ============================================================================
// 模块7_Panel业务API — 玩家绑定路由（P3）— 全局端点
// 挂载时套 authenticateToken（不再整组 requireAdmin——玩家自助绑定是核心路径）
// 对应服务：app.locals.playerService（PlayerServiceImpl）
//
// 挂载前缀：/api/player-bindings
//   GET    /                → listBindings（server_admin 看全部；玩家只看自己）
//   POST   /                → createBinding（从 req.user.userId 取 userId，玩家自助）
//   POST   /:id/verify      → verifyBinding（玩家限自己的绑定；admin 任意）
//   POST   /:id/reject      → rejectBinding（管理动作，路由级 requireAdmin）
//   DELETE /:id             → deleteBinding（玩家限自己的绑定；admin 任意）
//
// v4.16.1 修复：历史版本整组挂载 requireAdmin，导致玩家门户（AccountBindingCard /
//   GuildBind）调用全部 403。POST / 的处理器本就按玩家自助设计（userId 从 token 取），
//   挂载与设计矛盾。现按角色分流：管理动作（reject）保持 admin-only，
//   自助动作（list/create/verify/delete）对登录用户开放且限定 ownership。
// ============================================================================

import { Router, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import type { PlayerServiceImpl } from '../../services/playerService.js';
import { AppError, PlayerBindingNotFoundError } from '../../services/errors.js';
import { Role, normalizeRole } from '../../core/auth/roles.js';
import { requireAdmin } from '../../middleware/auth.js';
import type {
  ListPlayerBindingsResponse,
  CreatePlayerBindingRequest,
  CreatePlayerBindingResponse,
  VerifyPlayerBindingRequest,
  VerifyPlayerBindingResponse,
  RejectPlayerBindingResponse,
  DeletePlayerBindingResponse,
  Binding,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 判定当前请求是否为 server_admin 管理视角。
 * 与 requireAdmin 语义一致（requireRole(Role.SERVER_ADMIN)）。
 */
function isServerAdmin(req: Request): boolean {
  const rawRole = req.user?.role;
  return rawRole !== undefined && normalizeRole(rawRole) === Role.SERVER_ADMIN;
}

/**
 * 创建 PlayerBindings 路由（全局端点）
 * 依赖通过 req.app.locals 注入：playerService
 * 鉴权：authenticateToken 由挂载处统一套；按角色分流见文件头注释
 */
export function createPlayerBindingsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/player-bindings — server_admin 列出全部；玩家仅列出自己的
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      // 非 admin 视角 → 强制按当前用户过滤（玩家自助）
      const forUserId = isServerAdmin(req) ? undefined : req.user?.userId;
      const bindings = await playerService.listBindings(forUserId);
      const response: ListPlayerBindingsResponse = { bindings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/player-bindings — 创建玩家绑定
  // ----------------------------------------------------------------
  router.post('/', async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_UNAUTHORIZED',
            message: '未授权：缺少用户信息',
          },
        };
        res.status(401).json(errBody);
        return;
      }
      const body = req.body as Partial<CreatePlayerBindingRequest>;
      if (
        typeof body.game_player_name !== 'string' ||
        body.game_player_name.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 game_player_name',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      // v4.27.0: 请求体字段 game_type → server_id（契约 BREAKING 变更）
      if (typeof body.server_id !== 'string' || body.server_id.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 server_id',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const binding = await playerService.createBinding(userId, {
        game_player_name: body.game_player_name,
        server_id: body.server_id,
      });
      const response: CreatePlayerBindingResponse = { binding };
      res.status(201).json(response);
    } catch (err) {
      handleBindingError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/player-bindings/:id/verify — 验证玩家绑定
  // ----------------------------------------------------------------
  router.post('/:id/verify', async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const body = req.body as Partial<VerifyPlayerBindingRequest>;
      if (
        typeof body.verify_code !== 'string' ||
        body.verify_code.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 verify_code',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const binding = await playerService.verifyBinding(
        id,
        { verify_code: body.verify_code },
        // 非 admin → 限定当前用户 ownership（不匹配返回 404，不泄露他人绑定）
        isServerAdmin(req) ? undefined : req.user?.userId,
      );
      const response: VerifyPlayerBindingResponse = { binding };
      res.json(response);
    } catch (err) {
      handleBindingError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/player-bindings/:id/reject — 拒绝玩家绑定（管理动作，admin-only）
  // ----------------------------------------------------------------
  router.post('/:id/reject', requireAdmin, async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const binding = await playerService.rejectBinding(id);
      const response: RejectPlayerBindingResponse = { binding };
      res.json(response);
    } catch (err) {
      handleBindingError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/player-bindings/:id — 删除玩家绑定
  // ----------------------------------------------------------------
  router.delete('/:id', async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      await playerService.deleteBinding(
        id,
        // 非 admin → 限定当前用户 ownership（不匹配返回 404，不泄露他人绑定）
        isServerAdmin(req) ? undefined : req.user?.userId,
      );
      const response: DeletePlayerBindingResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleBindingError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  PLAYER_BINDING_NOT_FOUND: 404,
  PLAYER_BINDING_ALREADY_EXISTS: 409,
  PLAYER_BINDING_VERIFY_CODE_INVALID: 400,
  PLAYER_BINDING_NOT_PENDING: 400,
  // v4.27.0: createBinding 校验 server_id 存在性时抛出
  SERVER_NOT_FOUND: 404,
};

function handleBindingError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  handleInternal(res, err);
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}

// ===========================================================================
// 模块10 Task 7：server 级玩家绑定路由（admin）
// 挂载在 /api/servers/:serverId/player-bindings 下
//   GET    /        → 列出该实例的玩家绑定（含 username）
//   DELETE /:id     → 软删除（verify_status='revoked'）+ 同步解绑 bindings(account, instance)
//
// v4.17.0 改造：
// - 旧表 player_bindings / user_instance_bindings 已物理删除，统一到 bindings 表
// - 玩家全局绑定：bindings WHERE binding_type='player', scope_type='game_type', scope_ref=game_type
// - 账户级绑定：bindings WHERE binding_type='account', scope_type='instance', scope_ref=server_id
// - 软删除语义：verify_status='revoked'（对外仍映射为 status='rejected'）
// - 同步解绑：将账户级 verified 记录改为 revoked，metadata.unbound_at 记录时间
//
// v4.27.0 改造：
// - 玩家绑定从 scope_type='game_type', scope_ref=game_type 改为 scope_type='instance', scope_ref=server_id
// - GET 不再 JOIN servers 查 game_type，直接按 bindings.scope_ref = serverId 查询
// - DELETE 不再校验 binding.scope_ref 与 server.game_type 一致，直接校验 scope_ref === serverId
// ===========================================================================

/**
 * v4.17.0: 统一 bindings 表行类型（账户级绑定解绑用）。
 * 字段定义与 instanceBindingService.BindingRow 一致。
 */
interface BindingRow {
  id: number;
  user_id: string;
  binding_type: string;
  scope_type: string;
  scope_ref: string | null;
  player_name: string | null;
  vip_level: number;
  wallet_id: string | null;
  verify_status: string;
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** v4.17.0: 安全解析 metadata JSON 字符串，失败返回空对象 */
function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** bindings(player, instance) + JOIN users 的查询行（v4.19.3 M3.4: 字段名对齐 Binding 契约；v4.27.0: scope_type 改 instance） */
interface PlayerBindingWithUsernameRow {
  id: number;
  user_id: string;
  player_name: string | null;
  scope_ref: string | null;
  verify_code: string | null;
  verify_status: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  username: string;
}

/** servers 表行视图（v4.27.0: 仅用于校验 server 存在性，不再查 game_type） */
interface ServerRow {
  id: string;
}

/** bindings(player, instance) 表行视图（DELETE 时查 user_id + scope_ref 用；v4.19.3 M3.4: 字段名对齐 Binding 契约；v4.27.0: scope_type 改 instance） */
interface PlayerBindingRow {
  id: number;
  user_id: string;
  scope_ref: string | null;
  verify_status: string;
  updated_at: string;
}

/** server 级玩家绑定列表响应（含 username） */
interface ListServerPlayerBindingsResponse {
  bindings: (Binding & { username: string })[];
}

/**
 * 创建 server 级 PlayerBindings 路由（admin）
 *
 * 挂载前缀：/api/servers/:serverId/player-bindings
 * 鉴权由 index.ts 挂载时统一套 authenticateToken + requireAdmin
 *
 * 设计要点：
 * - v4.27.0: 玩家绑定改为实例级（scope_type='instance', scope_ref=server_id），不再按 game_type 关联
 * - DELETE 为软删除（status='rejected'），同时同步 user_instance_bindings 为 unbound
 * - 两个表的更新包裹在事务中保证原子性
 */
export function createServerPlayerBindingsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/player-bindings — 列出该实例的玩家绑定
  // ----------------------------------------------------------------
  router.get('/:serverId/player-bindings', requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const db = req.app.locals.db as Knex | undefined;
      if (!db) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
        };
        res.status(500).json(errBody);
        return;
      }

      // v4.27.0: 不再查询 server.game_type，仅校验 server 存在性
      const server = await db<ServerRow>('servers')
        .select('id')
        .where({ id: serverId })
        .first();
      if (!server) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${serverId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // v4.27.0: JOIN users 表查询 bindings(player, instance)，按 scope_ref=serverId 直接查询
      //    直接返回 Binding 契约字段（player_name/scope_ref/verify_status），无需别名转换
      const rows = await db<PlayerBindingWithUsernameRow>('bindings')
        .join('users', 'bindings.user_id', 'users.id')
        .where({
          'bindings.binding_type': 'player',
          'bindings.scope_type': 'instance',
          'bindings.scope_ref': serverId,
        })
        .select(
          'bindings.id as id',
          'bindings.user_id as user_id',
          'bindings.player_name as player_name',
          'bindings.scope_ref as scope_ref',
          'bindings.verify_code as verify_code',
          'bindings.verify_status as verify_status',
          'bindings.verified_at as verified_at',
          'bindings.created_at as created_at',
          'bindings.updated_at as updated_at',
          'users.username as username',
        )
        .orderBy('bindings.created_at', 'desc');

      const bindings: (Binding & { username: string })[] = rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        binding_type: 'player',
        scope_type: 'instance',
        player_name: row.player_name,
        scope_ref: row.scope_ref,
        vip_level: 0,
        wallet_id: null,
        verify_status: row.verify_status as Binding['verify_status'],
        verify_code: row.verify_code,
        verify_expires_at: null,
        verified_at: row.verified_at,
        metadata: '{}',
        created_at: row.created_at,
        updated_at: row.updated_at,
        username: row.username,
      }));
      const response: ListServerPlayerBindingsResponse = { bindings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/player-bindings/:id — 软删除 + 同步解绑
  // ----------------------------------------------------------------
  router.delete('/:serverId/player-bindings/:id', requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
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

      // 1. v4.27.0: 查询 bindings(player, instance) 是否存在 + 校验 scope_ref 与 serverId 匹配
      //    字段名直接使用 Binding 契约（scope_ref/verify_status），无需别名
      const binding = (await db('bindings')
        .where({
          binding_type: 'player',
          scope_type: 'instance',
          id,
        })
        .select(
          'id',
          'user_id',
          'scope_ref',
          'verify_status',
          'updated_at',
        )
        .first()) as PlayerBindingRow | undefined;
      if (!binding) {
        throw new PlayerBindingNotFoundError(`玩家绑定记录不存在: id=${id}`);
      }

      // v4.27.0: 直接校验 binding.scope_ref === serverId（不再查 server.game_type）
      if (binding.scope_ref !== serverId) {
        throw new PlayerBindingNotFoundError(`绑定记录 id=${id} 不属于实例 ${serverId}`);
      }

      // 2. v4.17.0 事务：软删除 bindings(player) + 解绑 bindings(account, instance)
      //    旧表 player_bindings / user_instance_bindings 已合并到 bindings 表
      const nowIso = new Date().toISOString();
      await db.transaction(async (trx) => {
        // 软删除：verify_status → 'revoked'（对外仍为 'rejected' 语义）
        await trx<BindingRow>('bindings')
          .where({ id, binding_type: 'player', scope_type: 'instance' })
          .update({ verify_status: 'revoked', updated_at: nowIso });

        // 同步解绑账户级绑定（binding_type='account', scope_type='instance'）
        // 仅更新 verified 记录，无 verified 记录时为幂等（不报错）
        const accountBindings = await trx<BindingRow>('bindings')
          .where({
            user_id: binding.user_id,
            binding_type: 'account',
            scope_type: 'instance',
            scope_ref: serverId,
            verify_status: 'verified',
          })
          .select('*');
        for (const r of accountBindings) {
          const oldMeta = parseMetadata(r.metadata);
          await trx<BindingRow>('bindings')
            .where({ id: r.id })
            .update({
              verify_status: 'revoked',
              metadata: JSON.stringify({ ...oldMeta, unbound_at: nowIso }),
              updated_at: nowIso,
            });
        }
      });

      const response: DeletePlayerBindingResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      if (err instanceof PlayerBindingNotFoundError) {
        const body: PanelErrorResponse = {
          error: {
            code: err.code as PanelErrorResponse['error']['code'],
            message: err.message,
          },
        };
        res.status(404).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  return router;
}
