// ============================================================================
// 模块7_Panel业务API — VIP 权限管理路由（P1 管理员功能）
// 鉴权策略（v3.2.0 改造）：
//   - GET  /api/vip-permissions[/:level] : server_admin + instance_admin 可查看（需要了解各等级含义才能合理分配）
//   - POST/PATCH/DELETE /api/vip-permissions   : 仅 server_admin（全局模板管理）
// 路由层内联 requireRole 中间件，不再依赖 index.ts 统一套 requireAdmin。
// 对应服务：app.locals.vipService（VipServiceImpl）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { VipServiceImpl } from '../../services/vipService.js';
import { AppError } from '../../services/errors.js';
import { requireRole, requireAdmin } from '../../middleware/auth.js';
import { Role } from '../../core/auth/roles.js';
import type {
  CreateVipPermissionRequest,
  CreateVipPermissionResponse,
  DeleteVipPermissionResponse,
  GetVipPermissionResponse,
  ListVipPermissionsResponse,
  PanelErrorResponse,
  UpdateVipPermissionRequest,
  UpdateVipPermissionResponse,
  VipPermissionItem,
} from '@public/schema/panel-api-types';

// ----- DB 行类型（与 vipService.ts VipPermissionRow 对齐） -----
interface VipPermissionRow {
  id: number;
  vip_level: number;
  display_name: string;
  permissions: string;
  max_quality: string;
  daily_limit: number | null;
  daily_reward_amount: number;
}

const VALID_QUALITIES = ['normal', 'uncommon', 'rare', 'epic', 'legendary'] as const;

function toVipPermissionItem(row: VipPermissionRow): VipPermissionItem {
  let permissions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.permissions);
    if (Array.isArray(parsed)) {
      permissions = parsed.map(String);
    }
  } catch {
    permissions = [];
  }
  return {
    id: row.id,
    vip_level: row.vip_level,
    display_name: row.display_name,
    permissions,
    max_quality: row.max_quality as VipPermissionItem['max_quality'],
    daily_limit: row.daily_limit,
    daily_reward_amount: row.daily_reward_amount,
  };
}

function isValidQuality(value: unknown): value is VipPermissionItem['max_quality'] {
  return typeof value === 'string' && (VALID_QUALITIES as readonly string[]).includes(value);
}

/**
 * 创建 VipPermissions 路由
 * 依赖通过 req.app.locals 注入：vipService, db
 */
export function createVipPermissionsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/vip-permissions — 列出全部 VIP 权限配置
  // v3.2.0: server_admin + instance_admin 均可查看（instance_admin 需要了解各等级含义才能合理分配VIP）
  // ----------------------------------------------------------------
  router.get('/', requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN), async (req, res) => {
    try {
      const vipService = req.app.locals.vipService as VipServiceImpl;
      const list = await vipService.listVipPermissions();
      // VipPermission (shared-types) max_quality 为 ItemQuality | 'none'；
      // VipPermissionItem (panel-api-types) max_quality 不含 'none'，直接转换
      const permissions: VipPermissionItem[] = list.map((p) => ({
        id: p.id,
        vip_level: p.vip_level,
        display_name: p.display_name,
        permissions: p.permissions,
        max_quality: p.max_quality as VipPermissionItem['max_quality'],
        daily_limit: p.daily_limit,
        daily_reward_amount: p.daily_reward_amount,
      }));
      const response: ListVipPermissionsResponse = { permissions };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/vip-permissions/:level — 查询单条 VIP 权限
  // v3.2.0: server_admin + instance_admin 均可查看
  // ----------------------------------------------------------------
  router.get('/:level', requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN), async (req, res) => {
    try {
      const level = parseInt(req.params.level, 10);
      if (Number.isNaN(level)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `level 必须为数字: ${req.params.level}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const vipService = req.app.locals.vipService as VipServiceImpl;
      const perm = await vipService.getVipPermissions(level);
      const response: GetVipPermissionResponse = {
        permission: {
          id: perm.id,
          vip_level: perm.vip_level,
          display_name: perm.display_name,
          permissions: perm.permissions,
          max_quality: perm.max_quality as VipPermissionItem['max_quality'],
          daily_limit: perm.daily_limit,
          daily_reward_amount: perm.daily_reward_amount,
        },
      };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'VIP_PERMISSION_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/vip-permissions — 创建 VIP 权限（level 已存在返回 409）
  // 仅 server_admin
  // ----------------------------------------------------------------
  router.post('/', requireAdmin, async (req, res) => {
    try {
      const db = req.app.locals.db as Knex;
      const body = req.body as Partial<CreateVipPermissionRequest>;
      if (typeof body.vip_level !== 'number' || typeof body.display_name !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 vip_level 或 display_name' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!isValidQuality(body.max_quality)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `max_quality 无效: ${String(body.max_quality)}` },
        };
        res.status(400).json(errBody);
        return;
      }

      // 检查 level 是否已存在
      const existing = await db<VipPermissionRow>('vip_permissions')
        .where({ vip_level: body.vip_level })
        .first();
      if (existing) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `vip_level ${body.vip_level} 已存在` },
        };
        res.status(409).json(errBody);
        return;
      }

      const permissions = Array.isArray(body.permissions) ? body.permissions : [];
      const row: Partial<VipPermissionRow> = {
        vip_level: body.vip_level,
        display_name: body.display_name,
        permissions: JSON.stringify(permissions),
        max_quality: body.max_quality,
        daily_limit: body.daily_limit ?? null,
        daily_reward_amount: body.daily_reward_amount ?? 0,
      };
      const inserted = await db<VipPermissionRow>('vip_permissions')
        .insert(row)
        .returning('*');
      const created = Array.isArray(inserted) ? inserted[0] : inserted;
      const response: CreateVipPermissionResponse = {
        permission: toVipPermissionItem(created),
      };
      res.status(201).json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/vip-permissions/:level — 更新 VIP 权限（找不到 404）
  // 仅 server_admin
  // ----------------------------------------------------------------
  router.patch('/:level', requireAdmin, async (req, res) => {
    try {
      const db = req.app.locals.db as Knex;
      const level = parseInt(req.params.level, 10);
      if (Number.isNaN(level)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `level 必须为数字: ${req.params.level}` },
        };
        res.status(400).json(errBody);
        return;
      }

      const body = req.body as Partial<UpdateVipPermissionRequest>;
      const updates: Partial<VipPermissionRow> = {};
      if (body.display_name !== undefined) updates.display_name = body.display_name;
      if (body.permissions !== undefined) updates.permissions = JSON.stringify(body.permissions);
      if (body.max_quality !== undefined) {
        if (!isValidQuality(body.max_quality)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `max_quality 无效: ${String(body.max_quality)}` },
          };
          res.status(400).json(errBody);
          return;
        }
        updates.max_quality = body.max_quality;
      }
      if (body.daily_limit !== undefined) updates.daily_limit = body.daily_limit;
      if (body.daily_reward_amount !== undefined) updates.daily_reward_amount = body.daily_reward_amount;

      const existing = await db<VipPermissionRow>('vip_permissions')
        .where({ vip_level: level })
        .first();
      if (!existing) {
        const errBody: PanelErrorResponse = {
          error: { code: 'VIP_PERMISSION_NOT_FOUND', message: `VIP 权限不存在: level=${level}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const updated = await db<VipPermissionRow>('vip_permissions')
        .where({ vip_level: level })
        .update(updates)
        .returning('*');
      const result = Array.isArray(updated) ? updated[0] : updated;
      const response: UpdateVipPermissionResponse = {
        permission: toVipPermissionItem(result),
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/vip-permissions/:level — 删除 VIP 权限（幂等）
  // 仅 server_admin
  // ----------------------------------------------------------------
  router.delete('/:level', requireAdmin, async (req, res) => {
    try {
      const db = req.app.locals.db as Knex;
      const level = parseInt(req.params.level, 10);
      if (Number.isNaN(level)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `level 必须为数字: ${req.params.level}` },
        };
        res.status(400).json(errBody);
        return;
      }
      await db<VipPermissionRow>('vip_permissions').where({ vip_level: level }).delete();
      const response: DeleteVipPermissionResponse = {
        vip_level: level,
        deleted: true,
      };
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

function handleAppError(
  res: Response,
  err: unknown,
  expectedCode: string,
  status: number,
): void {
  if (err instanceof AppError && err.code === expectedCode) {
    const body: PanelErrorResponse = {
      error: { code: expectedCode as PanelErrorResponse['error']['code'], message: err.message },
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
