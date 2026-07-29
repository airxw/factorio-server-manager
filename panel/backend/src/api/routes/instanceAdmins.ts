// ============================================================================
// instanceAdmins.ts — 实例共管管理路由（v4.5.0）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/servers（复用 servers 前缀，端点 /:serverId/admins 不与 servers.ts 冲突）
//
// 端点：
//   GET    /:serverId/admins           — 列出实例管理员（owner + 共管列表）
//   POST   /:serverId/admins           — 分配管理员（body: { user_id }）
//   DELETE /:serverId/admins/:userId   — 移除管理员
//
// 权限检查：
//   - server_admin → 全通过
//   - instance_admin → 仅当是该实例的 owner 时通过（不能管理非自己拥有的实例的管理员列表）
//   - user → 403 拒绝
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InstanceAdminService } from '../../services/instanceAdminService.js';
import type { BalanceServiceImpl } from '../../services/balanceService.js';
import { Role, normalizeRole } from '../../core/auth/roles.js';
import type {
  AssignInstanceAdminRequest,
  AssignInstanceAdminResponse,
  InstanceAdmin,
  ListInstanceAdminsResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建实例共管管理路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createInstanceAdminsRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const instanceAdminService = new InstanceAdminService(db);

  // ----------------------------------------------------------------
  // 权限检查辅助：server_admin 全通过；instance_admin 仅 owner 通过
  // ----------------------------------------------------------------
  async function checkCanManageAdmins(
    serverId: string,
    user: { userId: string; role: string },
  ): Promise<{ allowed: boolean; error?: PanelErrorResponse; ownerUserId?: string }> {
    const role = normalizeRole(user.role);
    // server_admin 全通过
    if (role === Role.SERVER_ADMIN) {
      return { allowed: true };
    }
    // instance_admin / user → 需要是该实例的 owner
    if (role !== Role.INSTANCE_ADMIN) {
      return {
        allowed: false,
        error: {
          error: { code: 'PANEL_FORBIDDEN', message: '需要实例管理员权限' },
        },
      };
    }
    const server = await db<{ id: string; owner_user_id: string }>('servers')
      .select('owner_user_id')
      .where({ id: serverId })
      .first();
    if (!server) {
      return {
        allowed: false,
        error: {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${serverId}` },
        },
      };
    }
    if (server.owner_user_id !== user.userId) {
      return {
        allowed: false,
        error: {
          error: { code: 'PANEL_FORBIDDEN', message: '仅实例 owner 可管理共管管理员' },
        },
      };
    }
    return { allowed: true, ownerUserId: server.owner_user_id };
  }

  // ----------------------------------------------------------------
  // GET /:serverId/admins — 列出实例管理员（owner + 共管列表）
  // ----------------------------------------------------------------
  router.get('/:serverId/admins', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const serverId = req.params.serverId;
      const permCheck = await checkCanManageAdmins(serverId, user);
      if (!permCheck.allowed && permCheck.error) {
        const status = permCheck.error.error.code === 'SERVER_NOT_FOUND' ? 404 : 403;
        res.status(status).json(permCheck.error);
        return;
      }

      // 查询实例 owner 信息
      const server = await db<{ owner_user_id: string; username: string }>('servers')
        .select('servers.owner_user_id', 'users.username')
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .where({ 'servers.id': serverId })
        .first();

      const admins = await instanceAdminService.listAdmins(serverId);
      const response: ListInstanceAdminsResponse = {
        admins: admins.map(toContractInstanceAdmin),
        owner: {
          user_id: server?.owner_user_id ?? '',
          username: server?.username ?? '',
        },
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /:serverId/admins — 分配管理员
  // ----------------------------------------------------------------
  router.post('/:serverId/admins', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const serverId = req.params.serverId;
      const permCheck = await checkCanManageAdmins(serverId, user);
      if (!permCheck.allowed && permCheck.error) {
        const status = permCheck.error.error.code === 'SERVER_NOT_FOUND' ? 404 : 403;
        res.status(status).json(permCheck.error);
        return;
      }

      const body = req.body as Partial<AssignInstanceAdminRequest>;
      if (typeof body.user_id !== 'string' || body.user_id.trim().length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 user_id 字段' },
        };
        res.status(400).json(errBody);
        return;
      }

      const targetUserId = body.user_id.trim();

      // 校验目标用户存在
      const targetUser = await db<{ id: string; username: string }>('users')
        .select('id', 'username')
        .where({ id: targetUserId })
        .first();
      if (!targetUser) {
        const errBody: PanelErrorResponse = {
          error: { code: 'USER_NOT_FOUND', message: `用户不存在: ${targetUserId}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // 不能给 owner 自身分配共管（owner 已是天然管理员）
      if (permCheck.ownerUserId === targetUserId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'INSTANCE_ADMIN_ALREADY_EXISTS', message: '该用户已是实例 owner，无需重复授权' },
        };
        res.status(409).json(errBody);
        return;
      }

      const success = await instanceAdminService.assignAdmin(
        serverId,
        targetUserId,
        user.userId,
      );
      if (!success) {
        const errBody: PanelErrorResponse = {
          error: { code: 'INSTANCE_ADMIN_ALREADY_EXISTS', message: '该用户已是实例的共管管理员' },
        };
        res.status(409).json(errBody);
        return;
      }

      // v5（方案 §4.5）: 新实例管理员初始额度 seed（幂等，失败仅记日志不阻断主流程）
      //   已有经济记录（global_balances.total_earned > 0）则跳过，否则发放 1000 初始余额
      try {
        const balanceService = req.app.locals.balanceService as BalanceServiceImpl | undefined;
        if (balanceService) {
          const balance = await balanceService.getBalance(targetUserId);
          if (balance.total_earned <= 0) {
            await balanceService.credit(targetUserId, 1000, 'admin_credit', '管理员初始额度');
          }
        }
      } catch (seedErr) {
        logger.warn(
          {
            err: seedErr instanceof Error ? seedErr.message : String(seedErr),
            userId: targetUserId,
            serverId,
          },
          'instanceAdmins: 管理员初始额度 seed 失败（不影响授权结果）',
        );
      }

      // 查询刚创建的记录返回
      const admins = await instanceAdminService.listAdmins(serverId);
      const created = admins.find((a) => a.user_id === targetUserId);
      if (!created) {
        const errBody: PanelErrorResponse = {
          error: { code: 'INSTANCE_ADMIN_ASSIGNMENT_FAILED', message: '授权后查询记录失败' },
        };
        res.status(500).json(errBody);
        return;
      }

      const response: AssignInstanceAdminResponse = {
        admin: toContractInstanceAdmin(created),
      };
      res.status(201).json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /:serverId/admins/:userId — 移除管理员
  // ----------------------------------------------------------------
  router.delete('/:serverId/admins/:userId', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const serverId = req.params.serverId;
      const permCheck = await checkCanManageAdmins(serverId, user);
      if (!permCheck.allowed && permCheck.error) {
        const status = permCheck.error.error.code === 'SERVER_NOT_FOUND' ? 404 : 403;
        res.status(status).json(permCheck.error);
        return;
      }

      const targetUserId = req.params.userId;
      const success = await instanceAdminService.removeAdmin(serverId, targetUserId);
      if (!success) {
        const errBody: PanelErrorResponse = {
          error: { code: 'INSTANCE_ADMIN_NOT_FOUND', message: '共管管理员记录不存在' },
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

function toContractInstanceAdmin(row: {
  id: string;
  instance_id: string;
  user_id: string;
  username: string;
  assigned_by: string;
  assigned_at: string;
}): InstanceAdmin {
  return {
    id: row.id,
    instance_id: row.instance_id,
    user_id: row.user_id,
    username: row.username,
    assigned_by: row.assigned_by,
    assigned_at: row.assigned_at,
  };
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'instanceAdmins router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
