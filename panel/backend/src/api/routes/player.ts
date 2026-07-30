// ============================================================================
// 模块7_Panel业务API — 玩家路由（P3 + D1-D3 玩家管理操作）— server 作用域端点
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken / requireAdmin）
// 对应服务：
//   app.locals.playerService            （PlayerServiceImpl — 加入设置/历史/礼包）
//   app.locals.playerManagementService  （PlayerManagementServiceImpl — D1: kick/ban/op/whitelist）
//
// 挂载前缀：/api/servers
//   GET  /:serverId/player-join/settings  → getJoinSettings      （admin）
//   PUT  /:serverId/player-join/settings  → upsertJoinSettings   （admin）
//   GET  /:serverId/player-histories      → listHistories        （登录用户）
//   GET  /:serverId/gift-claims           → listGiftClaims        （登录用户）
//   --- D1-D3 玩家管理（admin）---
//   GET  /:serverId/players/online                → listOnlinePlayers
//   POST /:serverId/players/kick                  → kick
//   POST /:serverId/players/ban                   → ban
//   POST /:serverId/players/pardon                → pardon
//   POST /:serverId/players/op                    → op
//   POST /:serverId/players/deop                  → deop
//   POST /:serverId/players/whitelist/add         → whitelistAdd
//   POST /:serverId/players/whitelist/remove      → whitelistRemove
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { PlayerServiceImpl } from '../../services/playerService.js';
import type { PlayerManagementServiceImpl } from '../../services/playerManagementService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import type {
  GetPlayerJoinSettingsResponse,
  UpsertPlayerJoinSettingsRequest,
  UpsertPlayerJoinSettingsResponse,
  ListPlayerHistoriesResponse,
  ListGiftClaimsResponse,
  ListOnlinePlayersResponse,
  PlayerActionRequest,
  PlayerActionResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

const VALID_QUALITIES = [
  'normal',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;

function isValidQuality(
  value: unknown,
): value is (typeof VALID_QUALITIES)[number] | null {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    (VALID_QUALITIES as readonly string[]).includes(value)
  );
}

/**
 * 创建 Player 路由（server 作用域端点）
 * 依赖通过 req.app.locals 注入：playerService
 */
export function createPlayerRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/player-join/settings — 查询玩家加入设置
  // ----------------------------------------------------------------
  router.get('/:serverId/player-join/settings', requireAdmin, async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const settings = await playerService.getJoinSettings(req.params.serverId);
      const response: GetPlayerJoinSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/servers/:serverId/player-join/settings — upsert 玩家加入设置
  // ----------------------------------------------------------------
  router.put('/:serverId/player-join/settings', requireAdmin, async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const body = req.body as Partial<UpsertPlayerJoinSettingsRequest>;

      // 校验 gift_quality（若提供）
      if (
        body.gift_quality !== undefined &&
        !isValidQuality(body.gift_quality)
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `gift_quality 无效: ${String(body.gift_quality)}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      // 校验 gift_count（若提供）
      if (
        body.gift_count !== undefined &&
        body.gift_count !== null &&
        (!Number.isInteger(body.gift_count) || body.gift_count < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'gift_count 需为非负整数或 null',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      // 校验 P3 回归礼包字段（若提供）
      if (
        body.relogin_cooldown_hours !== undefined &&
        body.relogin_cooldown_hours !== null &&
        (!Number.isInteger(body.relogin_cooldown_hours) || body.relogin_cooldown_hours < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'relogin_cooldown_hours 需为非负整数或 null',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.relogin_daily_limit !== undefined &&
        body.relogin_daily_limit !== null &&
        (!Number.isInteger(body.relogin_daily_limit) || body.relogin_daily_limit < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'relogin_daily_limit 需为非负整数或 null',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.relogin_total_limit !== undefined &&
        body.relogin_total_limit !== null &&
        (!Number.isInteger(body.relogin_total_limit) || body.relogin_total_limit < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'relogin_total_limit 需为非负整数或 null',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.relogin_gift_items !== undefined && body.relogin_gift_items !== null) {
        for (const item of body.relogin_gift_items) {
          if (typeof item.item !== 'string' || !item.item.trim()) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: '回归礼包物品名不能为空',
              },
            };
            res.status(400).json(errBody);
            return;
          }
          if (!Number.isInteger(item.count) || item.count <= 0) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: `回归礼包物品 ${item.item} 的数量需为正整数`,
              },
            };
            res.status(400).json(errBody);
            return;
          }
          if (item.quality !== undefined && !isValidQuality(item.quality)) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: `回归礼包物品 ${item.item} 的品质无效`,
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      // 校验 P4 VIP 专属欢迎语（若提供）
      if (body.vip_welcome_messages !== undefined && body.vip_welcome_messages !== null) {
        for (const m of body.vip_welcome_messages) {
          if (!Number.isInteger(m.min_vip_level) || m.min_vip_level < 0) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: 'VIP 欢迎语的最低 VIP 等级需为非负整数',
              },
            };
            res.status(400).json(errBody);
            return;
          }
          if (typeof m.message !== 'string' || !m.message.trim()) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: 'VIP 欢迎语内容不能为空',
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      const patch: UpsertPlayerJoinSettingsRequest = {};
      if (body.welcome_message !== undefined)
        patch.welcome_message = body.welcome_message;
      if (body.gift_enabled !== undefined)
        patch.gift_enabled = body.gift_enabled;
      if (body.gift_item !== undefined) patch.gift_item = body.gift_item;
      if (body.gift_count !== undefined) patch.gift_count = body.gift_count;
      if (body.gift_quality !== undefined)
        patch.gift_quality = body.gift_quality;
      // Task 1 新增字段：leave_message
      if (body.leave_message !== undefined)
        patch.leave_message = body.leave_message;
      // P3 回归礼包字段
      if (body.relogin_gift_enabled !== undefined)
        patch.relogin_gift_enabled = body.relogin_gift_enabled;
      if (body.relogin_gift_items !== undefined)
        patch.relogin_gift_items = body.relogin_gift_items;
      if (body.relogin_cooldown_hours !== undefined)
        patch.relogin_cooldown_hours = body.relogin_cooldown_hours;
      if (body.relogin_daily_limit !== undefined)
        patch.relogin_daily_limit = body.relogin_daily_limit;
      if (body.relogin_total_limit !== undefined)
        patch.relogin_total_limit = body.relogin_total_limit;
      // P4 VIP 专属欢迎语
      if (body.vip_welcome_messages !== undefined)
        patch.vip_welcome_messages = body.vip_welcome_messages;

      const settings = await playerService.upsertJoinSettings(
        req.params.serverId,
        patch,
      );
      const response: UpsertPlayerJoinSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/player-histories — 列出玩家历史
  // ----------------------------------------------------------------
  router.get('/:serverId/player-histories', requireAdmin, async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const histories = await playerService.listHistories(req.params.serverId);
      const response: ListPlayerHistoriesResponse = { histories };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/gift-claims — 列出礼包领取记录
  // ----------------------------------------------------------------
  router.get('/:serverId/gift-claims', requireAdmin, async (req, res) => {
    try {
      const playerService = req.app.locals.playerService as PlayerServiceImpl;
      const claims = await playerService.listGiftClaims(req.params.serverId);
      const response: ListGiftClaimsResponse = { claims };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ==========================================================================
  // D1-D3: 玩家管理操作（kick/ban/pardon/op/deop/whitelist add/remove + online）
  // 依赖通过 req.app.locals 注入：playerManagementService
  // ==========================================================================

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/players/online — 查询在线玩家
  // ----------------------------------------------------------------
  router.get('/:serverId/players/online', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const players = await pm.listOnlinePlayers(req.params.serverId);
      const response: ListOnlinePlayersResponse = { players };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/kick — 踢出玩家
  // ----------------------------------------------------------------
  router.post('/:serverId/players/kick', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.kickPlayer(req.params.serverId, body.player_name, body.reason ?? undefined);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/ban — 封禁玩家
  // ----------------------------------------------------------------
  router.post('/:serverId/players/ban', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.banPlayer(req.params.serverId, body.player_name, body.reason ?? undefined);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/pardon — 解除封禁
  // ----------------------------------------------------------------
  router.post('/:serverId/players/pardon', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.pardonPlayer(req.params.serverId, body.player_name);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/op — 授予 OP
  // ----------------------------------------------------------------
  router.post('/:serverId/players/op', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.opPlayer(req.params.serverId, body.player_name);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/deop — 撤销 OP
  // ----------------------------------------------------------------
  router.post('/:serverId/players/deop', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.deopPlayer(req.params.serverId, body.player_name);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/whitelist/add — 添加白名单
  // ----------------------------------------------------------------
  router.post('/:serverId/players/whitelist/add', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.whitelistAdd(req.params.serverId, body.player_name);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/players/whitelist/remove — 移除白名单
  // ----------------------------------------------------------------
  router.post('/:serverId/players/whitelist/remove', requireAdmin, async (req, res) => {
    try {
      const pm = req.app.locals.playerManagementService as PlayerManagementServiceImpl;
      const body = parsePlayerActionBody(req.body);
      const result = await pm.whitelistRemove(req.params.serverId, body.player_name);
      const response: PlayerActionResponse = { success: result.success, command: result.command, error: result.error };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// D1-D3 辅助函数
// ===========================================================================

/**
 * 解析并校验玩家操作请求体。
 * player_name 必填，长度 1-32，匹配 [A-Za-z0-9_-]（与 commandDispatcher VARIABLE_PATTERNS.player 对齐）。
 * reason 可选，最长 128 字符。
 */
function parsePlayerActionBody(body: unknown): PlayerActionRequest {
  if (typeof body !== 'object' || body === null) {
    throwValidationError('请求体必须为 JSON 对象');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.player_name !== 'string' || b.player_name.length === 0) {
    throwValidationError('player_name 必填且为非空字符串');
  }
  if (b.player_name.length > 32) {
    throwValidationError('player_name 长度不能超过 32 字符');
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(b.player_name)) {
    throwValidationError('player_name 仅允许字母、数字、下划线、连字符');
  }
  let reason: string | null | undefined;
  if (b.reason !== undefined && b.reason !== null) {
    if (typeof b.reason !== 'string') {
      throwValidationError('reason 必须为字符串');
    }
    if (b.reason.length > 128) {
      throwValidationError('reason 长度不能超过 128 字符');
    }
    reason = b.reason;
  }
  return { player_name: b.player_name, reason };
}

function throwValidationError(message: string): never {
  throw new ValidationError(message);
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleInternal(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(400).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
