// ============================================================================
// v4.13.0 步骤16: GM Workbench 玩家操作 API（服主对绑定玩家的操作）
// 依据：docs/plans/v4.13.0-instances-split-plan.md 步骤16
//
// 端点清单：
//   POST /api/store/players/:userId/compensate      发放补偿（give 物品，RCON）
//   POST /api/store/players/:userId/ban             封禁玩家（RCON ban）
//   POST /api/store/players/:userId/adjust-playtime 调整 VIP 时长（Panel 侧）
//
// 门控：
//   - 路由层 requireRole(INSTANCE_ADMIN, SERVER_ADMIN)
//   - 处理器内部 authorizeInstanceAccess（instance_admin 只能操作自有实例）
//   - 玩家必须已绑定到该实例（player_bindings.status='verified'）
//
// 数据流：
//   compensate/ban → playerManagementService → commandDispatcher → daemon → 游戏进程
//   adjust-playtime → user_instance_bindings.vip_expires_at（Panel 侧数据库）
//
// 契约：public/schema/panel-api-types.ts
// ============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import { Role } from '../../core/auth/roles.js';
import { requireRole } from '../../middleware/auth.js';
import type { PlayerManagementServiceImpl } from '../../services/playerManagementService.js';
import * as instanceBindingService from '../../services/instanceBindingService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/** DB 行类型 */
interface ServerRow {
  id: string;
  name: string;
  game_type: string;
  owner_user_id: string;
  pack_id: string;
}

interface PlayerBindingRow {
  user_id: string;
  game_player_name: string;
  game_type: string;
  status: string;
}

/** 请求体类型 */
interface CompensateBody {
  instance_id: string;
  item: string;
  count: number;
  reason?: string;
}

interface BanBody {
  instance_id: string;
  reason?: string;
}

interface AdjustPlaytimeBody {
  instance_id: string;
  /** VIP 时长增量（秒）；正数=延长，负数=缩短 */
  delta_seconds: number;
  reason?: string;
}

/** 权限校验结果 */
interface AuthResult {
  ok: boolean;
  status: number;
  body: PanelErrorResponse;
}

/**
 * 创建 GM Workbench 玩家操作路由
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createStorePlayerActionsRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ========================================================================
  // POST /api/store/players/:userId/compensate — 发放补偿（give 物品）
  // Body: { instance_id, item, count, reason? }
  // ========================================================================
  router.post(
    '/store/players/:userId/compensate',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId;
        const body = req.body as CompensateBody;

        // 参数校验
        if (!body?.instance_id || !body?.item || !body?.count) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id / item / count' },
          } as PanelErrorResponse);
          return;
        }

        const count = Number(body.count);
        if (!Number.isFinite(count) || count < 1 || count > 999999) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'count 必须为 1-999999 的整数' },
          } as PanelErrorResponse);
          return;
        }

        // 实例权限校验
        const authResult = await authorizeInstanceAccess(db, req, body.instance_id);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        // 查 player_bindings 获取 game_player_name
        const binding = await resolvePlayerBinding(db, userId, body.instance_id);
        if (!binding) {
          res.status(404).json({
            error: { code: 'PANEL_FORBIDDEN', message: '该玩家未绑定到此实例或绑定未验证' },
          } as PanelErrorResponse);
          return;
        }

        // 调用 playerManagementService.giveItem（RCON give 命令）
        const playerManagementService = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
        const result = await playerManagementService.giveItem(
          body.instance_id,
          binding.game_player_name,
          body.item,
          count,
        );

        logger.info(
          {
            user_id: userId,
            instance_id: body.instance_id,
            player: binding.game_player_name,
            item: body.item,
            count,
            reason: body.reason,
            success: result.success,
          },
          'store-player-actions: compensate',
        );

        res.json({
          success: result.success,
          command: result.command,
          ...(result.error ? { error: result.error } : {}),
        });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-player-actions compensate error');
        next(err);
      }
    },
  );

  // ========================================================================
  // POST /api/store/players/:userId/ban — 封禁玩家
  // Body: { instance_id, reason? }
  // ========================================================================
  router.post(
    '/store/players/:userId/ban',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId;
        const body = req.body as BanBody;

        if (!body?.instance_id) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id' },
          } as PanelErrorResponse);
          return;
        }

        const authResult = await authorizeInstanceAccess(db, req, body.instance_id);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        const binding = await resolvePlayerBinding(db, userId, body.instance_id);
        if (!binding) {
          res.status(404).json({
            error: { code: 'PANEL_FORBIDDEN', message: '该玩家未绑定到此实例或绑定未验证' },
          } as PanelErrorResponse);
          return;
        }

        const playerManagementService = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
        const result = await playerManagementService.banPlayer(
          body.instance_id,
          binding.game_player_name,
          body.reason,
        );

        logger.info(
          {
            user_id: userId,
            instance_id: body.instance_id,
            player: binding.game_player_name,
            reason: body.reason,
            success: result.success,
          },
          'store-player-actions: ban',
        );

        res.json({
          success: result.success,
          command: result.command,
          ...(result.error ? { error: result.error } : {}),
        });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-player-actions ban error');
        next(err);
      }
    },
  );

  // ========================================================================
  // POST /api/store/players/:userId/adjust-playtime — 调整 VIP 时长
  // Body: { instance_id, delta_seconds, reason? }
  //
  // 说明：此端点调整的是 user_instance_bindings.vip_expires_at（VIP 到期时间），
  //       而非 player_sessions 中的统计数据（统计数据为实际游戏行为，不可人为修改）。
  //       delta_seconds > 0 延长 VIP，< 0 缩短 VIP。
  //       永久 VIP（vip_expires_at IS NULL）缩短时返回 400（不允许缩短永久 VIP）。
  // ========================================================================
  router.post(
    '/store/players/:userId/adjust-playtime',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.params.userId;
        const body = req.body as AdjustPlaytimeBody;

        if (!body?.instance_id || !Number.isFinite(body.delta_seconds)) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 或 delta_seconds' },
          } as PanelErrorResponse);
          return;
        }

        const deltaSeconds = Math.floor(body.delta_seconds);
        // 限制单次调整幅度：-365天 ~ +365天
        const MAX_DELTA = 365 * 24 * 60 * 60;
        if (Math.abs(deltaSeconds) > MAX_DELTA) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '单次调整幅度不能超过 365 天' },
          } as PanelErrorResponse);
          return;
        }

        const authResult = await authorizeInstanceAccess(db, req, body.instance_id);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        // 查 bindings 表（v4.17.0: 旧表 user_instance_bindings 已合并到统一 bindings 表，
        // binding_type='account', scope_type='instance' 表示账户级 VIP 绑定，
        // vip_expires_at 存储在 metadata JSON 字段中）
        const uib = await instanceBindingService.getAccountBindingRaw(userId, body.instance_id);

        if (!uib) {
          res.status(404).json({
            error: { code: 'PANEL_FORBIDDEN', message: '该玩家未绑定到此实例' },
          } as PanelErrorResponse);
          return;
        }

        // 从 metadata JSON 中解析 vip_expires_at（旧表字段现已迁入 metadata）
        const previousExpiresAt = parseVipExpiresAt(uib.metadata);

        const now = new Date();
        const nowMs = now.getTime();

        let newExpiresAt: string | null;
        if (previousExpiresAt === null) {
          // 永久 VIP
          if (deltaSeconds < 0) {
            res.status(400).json({
              error: { code: 'PANEL_VALIDATION_ERROR', message: '不能缩短永久 VIP 的时长（如需限制请先设置为限时 VIP）' },
            } as PanelErrorResponse);
            return;
          }
          if (deltaSeconds === 0) {
            // 无变化
            res.json({
              success: true,
              previous_expires_at: null,
              current_expires_at: null,
              delta_seconds: 0,
            });
            return;
          }
          // 永久 VIP + 正 delta → 设置为当前时间 + delta
          newExpiresAt = new Date(nowMs + deltaSeconds * 1000).toISOString();
        } else {
          // 限时 VIP
          const currentExpiresMs = new Date(previousExpiresAt).getTime();
          // 基准时间：如果已过期，从当前时间开始算；否则从到期时间算
          const baseMs = Math.max(currentExpiresMs, nowMs);
          const newExpiresMs = baseMs + deltaSeconds * 1000;
          newExpiresAt = new Date(newExpiresMs).toISOString();
        }

        // 更新 bindings 表：vip_level 保持不变，仅更新 metadata.vip_expires_at
        await instanceBindingService.updateAccountBindingVipWithExpiry(
          userId,
          body.instance_id,
          uib.vip_level,
          newExpiresAt,
        );

        logger.info(
          {
            user_id: userId,
            instance_id: body.instance_id,
            delta_seconds: deltaSeconds,
            previous: previousExpiresAt,
            current: newExpiresAt,
            reason: body.reason,
          },
          'store-player-actions: adjust-playtime',
        );

        res.json({
          success: true,
          previous_expires_at: previousExpiresAt,
          current_expires_at: newExpiresAt,
          delta_seconds: deltaSeconds,
        });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-player-actions adjust-playtime error');
        next(err);
      }
    },
  );

  return router;
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/**
 * 实例级权限校验（与 store-gm.ts 逻辑一致）。
 * server_admin/system_admin/admin 直接通过；instance_admin 校验 owner_user_id。
 */
async function authorizeInstanceAccess(
  db: Knex,
  req: Request,
  instanceId: string,
): Promise<AuthResult> {
  const user = req.user;
  if (!user) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } },
    };
  }

  const role = (user.role ?? '').toLowerCase();
  if (role === 'server_admin' || role === 'system_admin' || role === 'admin') {
    return { ok: true, status: 0, body: {} as PanelErrorResponse };
  }

  const server = await db<ServerRow>('servers')
    .select('owner_user_id')
    .where({ id: instanceId })
    .first();

  if (!server) {
    return {
      ok: false,
      status: 404,
      body: { error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' } },
    };
  }

  if (server.owner_user_id !== user.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: { code: 'PANEL_FORBIDDEN', message: '无权访问该实例' } },
    };
  }

  return { ok: true, status: 0, body: {} as PanelErrorResponse };
}

/**
 * 查询玩家在某实例的绑定信息（status='verified'）。
 * v4.17.0: 旧表 player_bindings 已合并到统一 bindings 表，
 *          binding_type='player', scope_type='game_type' 表示跨实例全局玩家绑定。
 *          通过 user_id + instance 的 game_type（即 bindings.scope_ref）关联。
 *          通过 SELECT 别名保持对外字段名（PlayerBindingRow）不变。
 * v4.27.0: scope_type 由 'game_type' 改为 'instance'，scope_ref 含义由 game_type 改为 server_id。
 *          不再 JOIN servers 表查 game_type，直接按 scope_ref=instanceId 查询。
 *          SELECT 别名 `scope_ref as game_type` 保留以维持 PlayerBindingRow 字段名兼容。
 */
async function resolvePlayerBinding(
  db: Knex,
  userId: string,
  instanceId: string,
): Promise<PlayerBindingRow | null> {
  // v4.27.0: 直接按 scope_type='instance', scope_ref=instanceId 查询（不再 JOIN servers）
  const binding = await db<PlayerBindingRow>('bindings')
    .select(
      'user_id',
      'player_name as game_player_name',
      'scope_ref as game_type',
      'verify_status as status',
    )
    .where('user_id', '=', userId)
    .where('binding_type', '=', 'player')
    .where('scope_type', '=', 'instance')
    .where('scope_ref', '=', instanceId)
    .where('verify_status', '=', 'verified')
    .first();

  return binding ?? null;
}

/**
 * 从 bindings.metadata JSON 字符串中解析 vip_expires_at 字段。
 * v4.17.0: 旧表 user_instance_bindings.vip_expires_at 已迁入 bindings.metadata.vip_expires_at。
 * 失败或缺失返回 null（表示永久 VIP 或无过期信息）。
 */
function parseVipExpiresAt(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed === 'object' && typeof parsed.vip_expires_at === 'string') {
      return parsed.vip_expires_at;
    }
    return null;
  } catch {
    return null;
  }
}
