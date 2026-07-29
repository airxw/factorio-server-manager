// ============================================================================
// 模块7_Panel业务API — VIP-实例绑定路由
// 挂载在 /api 下（在 index.ts 套 authenticateToken(JWT_SECRET)）
// - GET    /profile/bindings                      : 用户查看自己的绑定列表
// - POST   /instances/:serverId/bindings          : 用户绑定实例（自动 VIP1）
// - DELETE /instances/:serverId/bindings          : 用户解绑实例
// - GET    /instances/:serverId/bindings          : instance_admin 查看实例绑定列表
// - PATCH  /instances/:serverId/bindings/:userId : instance_admin 调整某用户 VIP 等级
// 对应服务：services/instanceBindingService（直接 import 函数，db 由 service 内部 getDatabase 获取）
// ============================================================================

import { Router, type Response } from 'express';
import { requireInstanceAdmin } from '../../middleware/auth.js';
import * as bindingService from '../../services/instanceBindingService.js';
import {
  AppError,
  BindingAlreadyExistsError,
  BindingNotFoundError,
} from '../../services/errors.js';
import type {
  PanelErrorResponse,
} from '@public/schema/panel-api-types';
import type { BindingRecord, InstanceBindingWithUsername } from '../../services/instanceBindingService.js';

/** VIP 等级合法区间 */
const MIN_VIP_LEVEL = 0;
const MAX_VIP_LEVEL = 5;

/** 用户绑定列表响应 */
interface ListUserBindingsResponse {
  bindings: BindingRecord[];
}

/** 实例绑定列表响应（含用户名） */
interface ListInstanceBindingsResponse {
  bindings: InstanceBindingWithUsername[];
}

/** 绑定操作响应 */
interface BindingActionResponse {
  user_id: string;
  server_id: string;
  bound: boolean;
}

/** VIP 调整响应 */
interface UpdateBindingVipResponse {
  user_id: string;
  server_id: string;
  vip_level: number;
  updated: true;
}

/**
 * 创建 绑定 路由
 * 鉴权由 index.ts 挂载时统一套 authenticateToken(JWT_SECRET)
 */
export function createBindingsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/profile/bindings — 用户查看自己的绑定列表
  // ----------------------------------------------------------------
  router.get('/profile/bindings', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }

      const bindings = await bindingService.listUserBindings(userId);
      const response: ListUserBindingsResponse = { bindings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/instances/:serverId/bindings — 用户绑定实例（自动 VIP1）
  // ----------------------------------------------------------------
  router.post('/instances/:serverId/bindings', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }

      const serverId = req.params.serverId;
      await bindingService.bindInstance(userId, serverId);
      const response: BindingActionResponse = {
        user_id: userId,
        server_id: serverId,
        bound: true,
      };
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof BindingAlreadyExistsError) {
        const body: PanelErrorResponse = {
          error: {
            code: err.code as PanelErrorResponse['error']['code'],
            message: err.message,
          },
        };
        res.status(409).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/instances/:serverId/bindings — 用户解绑实例
  // ----------------------------------------------------------------
  router.delete('/instances/:serverId/bindings', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }

      const serverId = req.params.serverId;
      await bindingService.unbindInstance(userId, serverId);
      const response: BindingActionResponse = {
        user_id: userId,
        server_id: serverId,
        bound: false,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/instances/:serverId/bindings — instance_admin 查看实例绑定列表
  // ----------------------------------------------------------------
  router.get(
    '/instances/:serverId/bindings',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const serverId = req.params.serverId;
        const bindings = await bindingService.listInstanceBindings(serverId);
        const response: ListInstanceBindingsResponse = { bindings };
        res.json(response);
      } catch (err) {
        handleInternal(res, err);
      }
    },
  );

  // ----------------------------------------------------------------
  // PATCH /api/instances/:serverId/bindings/:userId — instance_admin 调整 VIP 等级（含过期时间）
  // ----------------------------------------------------------------
  router.patch(
    '/instances/:serverId/bindings/:userId',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const serverId = req.params.serverId;
        const targetUserId = req.params.userId;
        const body = req.body as { vip_level?: unknown; vip_expires_at?: unknown };

        // 校验 vip_level 0-5
        if (
          typeof body.vip_level !== 'number' ||
          !Number.isInteger(body.vip_level) ||
          body.vip_level < MIN_VIP_LEVEL ||
          body.vip_level > MAX_VIP_LEVEL
        ) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `vip_level 必须为 ${MIN_VIP_LEVEL}-${MAX_VIP_LEVEL} 的整数`,
            },
          };
          res.status(400).json(errBody);
          return;
        }

        // 校验 vip_expires_at（可选）：若提供则必须为有效 ISO 字符串或 null
        const expiresAt = body.vip_expires_at ?? undefined;
        if (expiresAt !== undefined && expiresAt !== null) {
          if (typeof expiresAt !== 'string' || isNaN(Date.parse(expiresAt))) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: 'vip_expires_at 必须为有效的 ISO 日期字符串或 null',
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }

        // v3.8.0-S6: 若未显式提供 vip_expires_at 且 vip_level > 0，
        // 按 vip.default_expiry_days 设置自动计算过期时间（0=永久）
        let effectiveExpiry: string | null | undefined = expiresAt;
        if (expiresAt === undefined && body.vip_level > 0) {
          try {
            const settingSchemaService = req.app.locals.settingSchemaService as
              | import('../../services/settingSchemaService.js').SettingSchemaService
              | undefined;
            if (settingSchemaService) {
              const defaultDays = await settingSchemaService.getNumber('vip.default_expiry_days');
              if (defaultDays > 0) {
                effectiveExpiry = new Date(Date.now() + defaultDays * 24 * 60 * 60 * 1000).toISOString();
              } else {
                // 0=永久，显式置 null
                effectiveExpiry = null;
              }
            }
          } catch {
            // 设置读取失败时保持 undefined（不更新过期时间字段）
          }
        }

        // 更新 vip_level
        await bindingService.updateBindingVip(targetUserId, serverId, body.vip_level);

        // 若提供了 vip_expires_at 或 v3.8.0-S6 自动计算了过期时间，单独更新过期时间
        if (effectiveExpiry !== undefined) {
          // v4.17.0: 旧表 user_instance_bindings 已合并到 bindings 表
          // 复用 instanceBindingService 工具函数更新 metadata.vip_expires_at
          // （同时会刷新 vip_level，与上方 updateBindingVip 调用幂等）
          await bindingService.updateAccountBindingVipWithExpiry(
            targetUserId,
            serverId,
            body.vip_level,
            effectiveExpiry,
          );
        }

        // v3.3.0: VIP 变更通知
        const notifService = req.app.locals.notificationService;
        if (notifService) {
          void notifService.create({
            userId: targetUserId,
            type: 'vip_changed',
            title: 'VIP等级已调整',
            content: `你在实例 ${serverId} 的VIP等级已调整为 ${body.vip_level}`,
            relatedServerId: serverId,
          }).catch(() => { /* 通知失败不影响主流程 */ });
        }

        const response: UpdateBindingVipResponse = {
          user_id: targetUserId,
          server_id: serverId,
          vip_level: body.vip_level,
          updated: true,
        };
        res.json(response);
      } catch (err) {
        if (err instanceof BindingNotFoundError) {
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
    },
  );

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleInternal(res: Response, err: unknown): void {
  // AppError 未被路由显式处理的兜底：映射为 500
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
