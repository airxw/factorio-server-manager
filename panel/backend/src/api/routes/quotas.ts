// ============================================================================
// quotas.ts — 资源配额管理路由（v4.6.0）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/quotas
//
// 端点：
//   GET    /                  — 查询当前用户配额 + 用量（任何已认证用户）
//   GET    /role/:role        — 查询角色配额（仅 server_admin）
//   PUT    /role/:role        — 设置角色配额（仅 server_admin）
//   GET    /user/:userId      — 查询用户配额（仅 server_admin）
//   PUT    /user/:userId      — 设置用户配额（仅 server_admin）
//
// 权限检查：角色门控通过 requireRole 中间件在路由内挂载到具体端点
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { QuotaService } from '../../services/quotaService.js';
import { Role, normalizeRole } from '../../core/auth/roles.js';
import { requireRole } from '../../middleware/auth.js';
import type {
  MyQuotaResponse,
  PanelErrorResponse,
  RoleQuotaResponse,
  UpdateRoleQuotaRequest,
  UpdateRoleQuotaResponse,
  UpdateUserQuotaRequest,
  UpdateUserQuotaResponse,
  UserQuotaResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建资源配额管理路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createQuotasRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const quotaService = new QuotaService(db);

  // ----------------------------------------------------------------
  // GET / — 查询当前用户配额 + 用量（任何已认证用户）
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const quota = await quotaService.getEffectiveQuota(userId);
      const usage = await quotaService.getUsage(userId);
      const instanceCheck = await quotaService.checkInstanceQuota(userId);

      // 计算 disk_available_mb
      let diskAvailableMb: number | null = null;
      if (quota && quota.max_disk_mb !== null) {
        diskAvailableMb = Math.max(0, quota.max_disk_mb - usage.disk_used_mb);
      }

      const response: MyQuotaResponse = {
        quota,
        usage,
        can_create_instance: instanceCheck.allowed,
        disk_available_mb: diskAvailableMb,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /role/:role — 查询角色配额（仅 server_admin）
  // ----------------------------------------------------------------
  router.get('/role/:role', requireRole(Role.SERVER_ADMIN), async (req, res) => {
    try {
      const role = req.params.role;
      // 校验 role 合法性（兼容旧值经 normalizeRole）
      const normalized = normalizeRole(role);
      if (!isValidRoleParam(role, normalized)) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `无效的角色: ${role}` },
        };
        res.status(400).json(body);
        return;
      }
      const quota = await quotaService.getQuota('role', normalized);
      const response: RoleQuotaResponse = { quota };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT /role/:role — 设置角色配额（仅 server_admin）
  // ----------------------------------------------------------------
  router.put('/role/:role', requireRole(Role.SERVER_ADMIN), async (req, res) => {
    try {
      const role = req.params.role;
      const normalized = normalizeRole(role);
      if (!isValidRoleParam(role, normalized)) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `无效的角色: ${role}` },
        };
        res.status(400).json(body);
        return;
      }

      const body = req.body as Partial<UpdateRoleQuotaRequest>;
      const limits = validateLimits(body);
      if (!limits.valid) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: limits.message ?? '参数校验失败' },
        };
        res.status(400).json(errBody);
        return;
      }

      try {
        const quota = await quotaService.setQuota('role', normalized, limits.fields);
        const response: UpdateRoleQuotaResponse = { quota };
        res.json(response);
      } catch (e) {
        if (e instanceof Error && e.message === 'QUOTA_UPDATE_FAILED') {
          const errBody: PanelErrorResponse = {
            error: { code: 'QUOTA_UPDATE_FAILED', message: '配额更新失败' },
          };
          res.status(500).json(errBody);
          return;
        }
        throw e;
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /user/:userId — 查询用户配额（仅 server_admin）
  // ----------------------------------------------------------------
  router.get('/user/:userId', requireRole(Role.SERVER_ADMIN), async (req, res) => {
    try {
      const userId = req.params.userId;
      const quota = await quotaService.getQuota('user', userId);
      const response: UserQuotaResponse = { quota };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT /user/:userId — 设置用户配额（仅 server_admin）
  // ----------------------------------------------------------------
  router.put('/user/:userId', requireRole(Role.SERVER_ADMIN), async (req, res) => {
    try {
      const userId = req.params.userId;

      const body = req.body as Partial<UpdateUserQuotaRequest>;
      const limits = validateLimits(body);
      if (!limits.valid) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: limits.message ?? '参数校验失败' },
        };
        res.status(400).json(errBody);
        return;
      }

      try {
        const quota = await quotaService.setQuota('user', userId, limits.fields);
        const response: UpdateUserQuotaResponse = { quota };
        res.json(response);
      } catch (e) {
        if (e instanceof Error && e.message === 'QUOTA_UPDATE_FAILED') {
          const errBody: PanelErrorResponse = {
            error: { code: 'QUOTA_UPDATE_FAILED', message: '配额更新失败' },
          };
          res.status(500).json(errBody);
          return;
        }
        throw e;
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 校验 role 参数：原始值或 normalizeRole 后的值必须是合法 Role */
function isValidRoleParam(raw: string, normalized: Role): boolean {
  const validRaw = ['server_admin', 'instance_admin', 'user'];
  return validRaw.includes(raw) || validRaw.includes(normalized);
}

/** 校验 limits 参数（数字或 null） */
function validateLimits(
  body: Partial<UpdateRoleQuotaRequest>,
): { valid: boolean; fields: { max_instances?: number | null; max_disk_mb?: number | null; max_players_total?: number | null }; message?: string } {
  const fields: { max_instances?: number | null; max_disk_mb?: number | null; max_players_total?: number | null } = {};
  if (body.max_instances !== undefined) {
    if (body.max_instances === null) {
      fields.max_instances = null;
    } else if (typeof body.max_instances === 'number' && Number.isFinite(body.max_instances) && body.max_instances >= 0) {
      fields.max_instances = Math.floor(body.max_instances);
    } else {
      return { valid: false, fields, message: 'max_instances 必须为非负整数或 null' };
    }
  }
  if (body.max_disk_mb !== undefined) {
    if (body.max_disk_mb === null) {
      fields.max_disk_mb = null;
    } else if (typeof body.max_disk_mb === 'number' && Number.isFinite(body.max_disk_mb) && body.max_disk_mb >= 0) {
      fields.max_disk_mb = Math.floor(body.max_disk_mb);
    } else {
      return { valid: false, fields, message: 'max_disk_mb 必须为非负整数或 null' };
    }
  }
  if (body.max_players_total !== undefined) {
    if (body.max_players_total === null) {
      fields.max_players_total = null;
    } else if (typeof body.max_players_total === 'number' && Number.isFinite(body.max_players_total) && body.max_players_total >= 0) {
      fields.max_players_total = Math.floor(body.max_players_total);
    } else {
      return { valid: false, fields, message: 'max_players_total 必须为非负整数或 null' };
    }
  }
  return { valid: true, fields };
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'quotas router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
