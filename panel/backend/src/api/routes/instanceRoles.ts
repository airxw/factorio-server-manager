// ============================================================================
// instanceRoles.ts — 实例级角色覆盖管理路由（v4.7.0 H1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/servers（复用 servers 前缀，端点 /:serverId/roles 不与 servers.ts 冲突）
//
// 端点：
//   GET    /:serverId/roles           — 列出实例的所有角色分配（未过期）
//   POST   /:serverId/roles           — 授予/更新实例级角色
//   DELETE /:serverId/roles/:userId   — 撤销某用户的实例级角色
//
// 权限检查（requireInstanceAdmin 中间件，v4.7.0 已加入 instance_roles 判定）：
//   - server_admin → 全通过
//   - instance_roles 表存在未过期记录且 role='instance_admin' → 通过
//   - instance_admin + owner 匹配 → 通过（兜底）
//   - instance_admins 共管记录 → 通过（兜底）
//   - 否则 403
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InstanceRoleService } from '../../services/instanceRoleService.js';
import { requireInstanceAdmin } from '../../middleware/auth.js';
import { normalizeRole, Role } from '../../core/auth/roles.js';
import type {
  GrantInstanceRoleRequest,
  GrantInstanceRoleResponse,
  InstanceRoleListResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建实例级角色覆盖管理路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createInstanceRolesRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const instanceRoleService = new InstanceRoleService(db, logger);

  // ----------------------------------------------------------------
  // GET /:serverId/roles — 列出实例的所有角色分配（未过期）
  // ----------------------------------------------------------------
  router.get('/:serverId/roles', requireInstanceAdmin(), async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const roles = await instanceRoleService.listInstanceRoles(serverId);
      const response: InstanceRoleListResponse = { roles };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /:serverId/roles — 授予/更新实例级角色
  // ----------------------------------------------------------------
  router.post('/:serverId/roles', requireInstanceAdmin(), async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const grantedBy = req.user?.userId;
      if (!grantedBy) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<GrantInstanceRoleRequest>;
      if (typeof body.user_id !== 'string' || body.user_id.trim().length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 user_id 字段' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.role !== 'instance_admin' && body.role !== 'user') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `role 必须为 'instance_admin' 或 'user'，收到: ${String(body.role)}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      // 校验目标用户存在
      const targetUser = await db<{ id: string; username: string; role: string }>('users')
        .select('id', 'username', 'role')
        .where('id', body.user_id)
        .first();
      if (!targetUser) {
        const errBody: PanelErrorResponse = {
          error: { code: 'USER_NOT_FOUND', message: `用户不存在: ${body.user_id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // server_admin 全局角色不可被实例级覆盖（无意义且可能引发权限混淆）
      if (normalizeRole(targetUser.role) === Role.SERVER_ADMIN) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_FORBIDDEN',
            message: '不可对 server_admin 全局角色用户授予实例级角色',
          },
        };
        res.status(403).json(errBody);
        return;
      }

      // expires_at 校验：非 null 时必须为可解析的 ISO 8601
      let expiresAt: string | null = null;
      if (body.expires_at !== undefined && body.expires_at !== null) {
        const parsed = Date.parse(body.expires_at);
        if (!Number.isFinite(parsed)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'expires_at 不是合法的 ISO 8601 时间' },
          };
          res.status(400).json(errBody);
          return;
        }
        expiresAt = body.expires_at;
      }

      const role = await instanceRoleService.grantInstanceRole(
        serverId,
        body.user_id,
        body.role,
        grantedBy,
        expiresAt,
      );
      const response: GrantInstanceRoleResponse = { role };
      res.status(201).json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /:serverId/roles/:userId — 撤销某用户的实例级角色
  // ----------------------------------------------------------------
  router.delete('/:serverId/roles/:userId', requireInstanceAdmin(), async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const targetUserId = req.params.userId;
      const deleted = await instanceRoleService.revokeInstanceRole(serverId, targetUserId);
      if (!deleted) {
        const errBody: PanelErrorResponse = {
          error: { code: 'INSTANCE_ROLE_NOT_FOUND', message: '实例级角色记录不存在' },
        };
        res.status(404).json(errBody);
        return;
      }
      res.json({ deleted: true, user_id: targetUserId });
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'instanceRoles router internal error');
  // grantInstanceRole 失败时抛 'INSTANCE_ROLE_GRANT_FAILED' 字符串错误
  if (message === 'INSTANCE_ROLE_GRANT_FAILED') {
    const body: PanelErrorResponse = {
      error: { code: 'INSTANCE_ROLE_GRANT_FAILED', message: '授权后查询记录失败' },
    };
    res.status(500).json(body);
    return;
  }
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
