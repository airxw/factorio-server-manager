// ============================================================================
// 模块7_Panel业务API — 用户管理路由（P1 管理员功能）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.userService（UserServiceImpl）
// @version 4.17.0
//   - 4.17.0: 多角色支持
//     - 新增 GET /api/users/:id/roles（查询角色集合）
//     - 新增 PUT /api/users/:id/roles（调整角色集合，触发 JWT 黑名单）
//     - 新增 POST /api/users/:id/revoke-tokens（强制下线）
//     - toAdminUserSummary 输出 roles + active_role
//   - 3.1.0: 新增 POST /api/users（管理员创建用户）
//                    DELETE /api/users/:id（软删除）
//                    PATCH /api/users/:id/role（调整角色）
//                    适配 3 级 UserRole（直传，不再折叠）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { UserService } from '@public/interface_stub/user-service';
import type { User, UserUpdate } from '@public/interface_stub/shared-types';
import { Role, toContractUserRole, toContractUserRoles, normalizeRole, normalizeRoles, resolveActiveRole, isValidRole } from '../../core/auth/roles.js';
import { AppError } from '../../services/errors.js';
import type {
  AdminUserSummary,
  BatchUserAction,
  BatchUserOperationRequest,
  BatchUserOperationResponse,
  BatchUserOperationResult,
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserResponse,
  GetUserResponse,
  ListUsersResponse,
  ListUserRolesResponse,
  PanelErrorResponse,
  RevokeUserTokensResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  UpdateUserRoleRequest,
  UpdateUserRoleResponse,
  UpdateUserRolesRequest,
  UpdateUserRolesResponse,
  UserRole,
  UserRoles,
  UserStatsResponse,
} from '@public/schema/panel-api-types';
import type { AuditLogServiceImpl } from '../../services/auditLogService.js';

// ----- DB 行类型 -----
interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  /** @deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除 */
  role: string;
  status: string;
  display_name: string | null;
  vip_level: number;
  vip_expires_at: string | null;
  is_verified: number;
  /** v4.0.2: 系统内置标记 */
  is_built_in: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
  /** v4.17.0: 角色集合 JSON 字符串 */
  roles?: string | null;
  /** v4.17.0: 当前活动角色（会话级） */
  active_role?: string | null;
}

/**
 * 将契约 UserRole('admin'|'user') 反向映射到 DB 层存储角色。
 * 新 3 级体系下：'admin' → instance_admin，'user' → user。
 *
 * 注：返回类型为 UserUpdate['role']（shared-types 旧 4 级 UserRole 声明），
 *     因不能修改 public/ 契约，用 normalizeRole + cast 桥接新 3 级 Role 与旧类型声明。
 *     运行时写入 DB 的是新角色值（'instance_admin' / 'user'），与 migration 后的存储一致。
 */
function toInternalRole(contractRole: UserRole): UserUpdate['role'] {
  return normalizeRole(contractRole) as unknown as UserUpdate['role'];
}

function toAdminUserSummaryFromRow(row: UserRow): AdminUserSummary {
  // v4.19.2: users.role 列已 DROP，不再从 DB 读取（row.role 恒 undefined）
  const roles = normalizeRoles(row.roles);
  const activeRole = resolveActiveRole(row.active_role, roles);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: toContractUserRole(activeRole),
    roles: toContractUserRoles(roles),
    active_role: toContractUserRole(activeRole),
    status: row.status as 'active' | 'disabled' | 'deleted',
    display_name: row.display_name,
    is_verified: !!row.is_verified,
    last_login_at: row.last_login_at,
    last_login_ip: row.last_login_ip,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAdminUserSummary(user: User): AdminUserSummary {
  // v4.17.0: User 已含 roles + active_role，直接读取并映射到契约
  const userRoles = (user as User & { roles?: UserRoles; active_role?: UserRole }).roles;
  const userActiveRole = (user as User & { roles?: UserRoles; active_role?: UserRole }).active_role;
  // v4.19.2: user.role 来自 toUser() 输出（由 active_role 派生），不再读 DB
  const roles = userRoles ? normalizeRoles(userRoles) : normalizeRoles(user.role);
  const activeRole = userActiveRole
    ? normalizeRole(userActiveRole)
    : resolveActiveRole(user.role, roles);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: toContractUserRole(activeRole),
    roles: toContractUserRoles(roles),
    active_role: toContractUserRole(activeRole),
    status: user.status as 'active' | 'disabled' | 'deleted',
    display_name: user.display_name,
    is_verified: user.is_verified,
    last_login_at: user.last_login_at,
    last_login_ip: user.last_login_ip,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

// ---------------------------------------------------------------------------
// v4.29.10 用户角色/状态保护辅助函数
// 与 DELETE /api/users/:id 已有保护对齐，覆盖 PATCH/PUT/batch 修改路径
// ---------------------------------------------------------------------------

/**
 * 检查目标用户是否为 active server_admin。
 * 用于修改角色/状态前判定是否需要触发「最后一个 server_admin」保护。
 */
async function isActiveServerAdmin(db: Knex, userId: string): Promise<boolean> {
  const row = await db<UserRow>('users')
    .where({ id: userId })
    .select('active_role', 'status')
    .first();
  if (!row) return false;
  if (row.status !== 'active') return false;
  return normalizeRole(row.active_role ?? Role.USER) === Role.SERVER_ADMIN;
}

/**
 * 判断更新后的活动角色是否仍为 server_admin。
 * - 单角色更新（role 字段）：直接判断
 * - 多角色更新（roles + active_role）：判断 active_role 是否为 server_admin
 *   - 显式 active_role：以显式值为准（路由层已校验 active_role ∈ roles）
 *   - 未传 active_role：取 roles[0]（与 userService.updateUserRoles 默认行为一致）
 * - 都未传：沿用现状
 */
function isNewActiveRoleServerAdmin(
  singleRoleUpdate: UserRole | undefined,
  rolesUpdate: UserRole[] | undefined,
  activeRoleUpdate: UserRole | undefined,
  currentActiveRole: string | null | undefined,
): boolean {
  if (singleRoleUpdate !== undefined) {
    return normalizeRole(singleRoleUpdate) === Role.SERVER_ADMIN;
  }
  if (rolesUpdate !== undefined) {
    const normalizedRoles = normalizeRoles(rolesUpdate);
    const ar = activeRoleUpdate !== undefined
      ? normalizeRole(activeRoleUpdate)
      : normalizedRoles[0];
    return ar === Role.SERVER_ADMIN;
  }
  // 未改角色，沿用现状
  return normalizeRole(currentActiveRole ?? Role.USER) === Role.SERVER_ADMIN;
}

/**
 * 创建 Users 路由
 * 依赖通过 req.app.locals 注入：userService, db
 */
export function createUsersRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/users — 列出全部用户
  // v4.x.x: 支持 page / page_size / keyword 查询参数
  //   - 不传 page/page_size → 全量返回（向后兼容）
  //   - 传 page/page_size → 服务端分页，total 为过滤后总条数
  //   - keyword 模糊匹配 email / username（不区分大小写）
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex;

      // ---------- 解析查询参数 ----------
      const pageRaw = req.query.page;
      const pageSizeRaw = req.query.page_size;
      const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';

      const hasPage = pageRaw !== undefined;
      let page = 1;
      let pageSize = 20;
      if (hasPage) {
        page = Math.max(1, parseInt(String(pageRaw), 10) || 1);
        pageSize = Math.min(100, Math.max(1, parseInt(String(pageSizeRaw), 10) || 20));
      }

      // ---------- 构造基础查询（过滤 + 排序） ----------
      const baseQuery = db<UserRow>('users').orderBy('created_at', 'asc');
      if (keyword) {
        const kw = `%${keyword.toLowerCase()}%`;
        baseQuery.whereRaw('LOWER(email) LIKE ? OR LOWER(username) LIKE ?', [kw, kw]);
      }

      // ---------- 全量模式（向后兼容） ----------
      if (!hasPage) {
        const rows = await baseQuery;
        const users = rows.map(toAdminUserSummaryFromRow);
        const response: ListUsersResponse = { users, total: users.length };
        res.json(response);
        return;
      }

      // ---------- 分页模式 ----------
      // 用 clone 避免共享 builder 状态：count 不应带 limit/offset
      const countQuery = baseQuery.clone().clearSelect().clearOrder().count('* as cnt');
      const totalRow = (await countQuery.first()) as { cnt: number } | undefined;
      const total = totalRow?.cnt ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      const rows = await baseQuery.clone().limit(pageSize).offset((page - 1) * pageSize);
      const users = rows.map(toAdminUserSummaryFromRow);
      const response: ListUsersResponse = {
        users,
        total,
        total_pages: totalPages,
        page,
        page_size: pageSize,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/users/stats — 用户分析统计（v4.24.0 新增）
  // 仅 server_admin 可调用（路由挂载已套 requireAdmin=Role.SERVER_ADMIN）
  // 注意：必须在 /:id 之前注册，避免字面量 'stats' 被识别为 :id
  // ----------------------------------------------------------------
  router.get('/stats', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const stats = await userService.getUserStats();
      const response: UserStatsResponse = stats;
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/users/batch — 批量操作用户（v4.24.0 新增）
  // 仅 server_admin 可调用（路由挂载已套 requireAdmin=Role.SERVER_ADMIN）
  // 支持 action: enable / disable / delete / set_role
  // 单次上限 100 个 user_ids
  // 单条失败不阻断整批，返回 BatchUserOperationResponse 含详细 results
  // ----------------------------------------------------------------
  router.post('/batch', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const db = req.app.locals.db as Knex;
      const body = req.body as BatchUserOperationRequest;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? '';

      // ---------- 参数校验 ----------
      if (!body || !Array.isArray(body.user_ids) || body.user_ids.length === 0) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'user_ids 不能为空' },
        });
        return;
      }
      // 去重
      const userIds = Array.from(new Set(body.user_ids));
      // 上限 100
      if (userIds.length > 100) {
        res.status(400).json({
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `单次批量操作上限 100 个用户，当前 ${userIds.length} 个`,
          },
        });
        return;
      }
      const action = body.action as BatchUserAction;
      if (!['enable', 'disable', 'delete', 'set_role'].includes(action)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `无效的 action: ${action}` },
        });
        return;
      }
      if (action === 'set_role') {
        if (!body.role || !isValidRole(body.role)) {
          res.status(400).json({
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `set_role 操作需指定合法 role，收到: ${body.role ?? 'undefined'}`,
            },
          });
          return;
        }
      }

      // ---------- 路由层自保护过滤 ----------
      // 提前查出所有目标用户，过滤掉 operatorId 命中、is_built_in=1 的条目
      // （这些条目不进入 service 层，直接记入 results 为失败）
      const targetRows = await db<UserRow>('users')
        .whereIn('id', userIds)
        .select('id', 'is_built_in');
      const targetMap = new Map(targetRows.map((r) => [r.id, r]));

      const preFilteredIds: string[] = [];
      const preFilteredResults: BatchUserOperationResult[] = [];
      for (const userId of userIds) {
        const row = targetMap.get(userId);
        if (!row) {
          preFilteredResults.push({ user_id: userId, ok: false, error: '用户不存在' });
          continue;
        }
        if (userId === operatorId) {
          preFilteredResults.push({ user_id: userId, ok: false, error: '不能操作自己' });
          continue;
        }
        if (row.is_built_in === 1) {
          preFilteredResults.push({
            user_id: userId,
            ok: false,
            error: '系统内置账号不可批量操作',
          });
          continue;
        }
        preFilteredIds.push(userId);
      }

      // ---------- 事务包裹批量操作 ----------
      let serviceResults: BatchUserOperationResult[] = [];
      if (preFilteredIds.length > 0) {
        // v4.29.10: set_role 批量降级最后一个 server_admin 保护
        // 在事务前预检：若本次将降级的 active server_admin 数 ≥ 全库 active server_admin 数，
        // 整批拒绝（避免事务内逐条降级到 0 后才发现）
        if (action === 'set_role' && normalizeRole(body.role!) !== Role.SERVER_ADMIN) {
          const targetActiveAdmins = await db<UserRow>('users')
            .whereIn('id', preFilteredIds)
            .where({ active_role: Role.SERVER_ADMIN, status: 'active' })
            .select('id');
          if (targetActiveAdmins.length > 0) {
            const totalAdmins = await userService.countActiveServerAdmins();
            if (totalAdmins - targetActiveAdmins.length <= 0) {
              res.status(400).json({
                error: {
                  code: 'PANEL_VALIDATION_ERROR',
                  message: '不能降级最后一个 server_admin（批量操作将导致系统无管理员）',
                },
              });
              return;
            }
          }
        }

        await db.transaction(async (trx) => {
          switch (action) {
            case 'enable':
              serviceResults = await userService.batchUpdateStatus(trx, preFilteredIds, 'active');
              break;
            case 'disable':
              serviceResults = await userService.batchUpdateStatus(trx, preFilteredIds, 'disabled');
              break;
            case 'delete':
              serviceResults = await userService.batchSoftDelete(trx, preFilteredIds, operatorId);
              break;
            case 'set_role':
              serviceResults = await userService.batchSetRole(trx, preFilteredIds, body.role!);
              break;
          }
        });
      }

      // ---------- 合并结果 ----------
      const allResults = [...preFilteredResults, ...serviceResults];
      const succeeded = allResults.filter((r) => r.ok).length;
      const failed = allResults.length - succeeded;
      const response: BatchUserOperationResponse = {
        total: allResults.length,
        succeeded,
        failed,
        results: allResults,
      };

      // ---------- 审计日志 ----------
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId || null,
            action: `user.batch_${action}`,
            target_type: 'user',
            target_id: 'batch',
            details: {
              target_count: userIds.length,
              succeeded,
              failed,
              role: action === 'set_role' ? body.role : undefined,
              failed_reasons: allResults
                .filter((r) => !r.ok)
                .map((r) => ({ user_id: r.user_id, error: r.error })),
            },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }

      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/users/:id — 用户详情
  // ----------------------------------------------------------------
  router.get('/:id', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const user = await userService.getUser(req.params.id);
      const response: GetUserResponse = { user: toAdminUserSummary(user) };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/users/:id — 更新用户
  // （requireAdmin 中间件已确保仅 admin 可调用；role/status 等敏感字段由 admin 修改）
  // v4.29.10: 注入「不能降级最后一个 server_admin」+「不能把自己 status 改为非 active」保护
  // ----------------------------------------------------------------
  router.patch('/:id', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const body = req.body as Partial<UpdateUserRequest>;

      // 构造 updates，仅传递已提供的字段
      const updates: Partial<UserUpdate> = {};
      if (body.username !== undefined) updates.username = body.username;
      if (body.role !== undefined) updates.role = toInternalRole(body.role);
      if (body.status !== undefined) updates.status = body.status;
      if (body.display_name !== undefined) updates.display_name = body.display_name;
      if (body.is_verified !== undefined) updates.is_verified = body.is_verified;

      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId;

      // 自保护：不能把自己 status 改为 disabled/deleted
      if (req.params.id === operatorId && updates.status !== undefined
          && updates.status !== 'active') {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '不能将自己的状态改为非 active' },
        });
        return;
      }

      // 最后一个 server_admin 保护：仅在 role 或 roles 字段被修改时触发
      if (updates.role !== undefined || (body as Partial<UpdateUserRolesRequest>).roles !== undefined) {
        const db = req.app.locals.db as Knex;
        const targetRow = await db<UserRow>('users').where({ id: req.params.id }).first();
        if (targetRow && await isActiveServerAdmin(db, req.params.id)) {
          const rolesUpdate = (body as Partial<UpdateUserRolesRequest>).roles as UserRole[] | undefined;
          const activeRoleUpdate = (body as Partial<UpdateUserRolesRequest>).active_role as UserRole | undefined;
          const stillAdmin = isNewActiveRoleServerAdmin(
            body.role !== undefined ? (body.role as UserRole) : undefined,
            rolesUpdate,
            activeRoleUpdate,
            targetRow.active_role,
          );
          if (!stillAdmin) {
            const remaining = await userService.countActiveServerAdmins(req.params.id);
            if (remaining === 0) {
              res.status(400).json({
                error: { code: 'PANEL_VALIDATION_ERROR', message: '不能降级最后一个 server_admin' },
              });
              return;
            }
          }
        }
      }

      const user = await userService.updateUser(req.params.id, updates);
      const response: UpdateUserResponse = { user: toAdminUserSummary(user) };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/users — 管理员创建用户（v3.1.0 新增）
  // 仅 server_admin 可调用（路由挂载已套 requireAdmin=Role.SERVER_ADMIN）
  // ----------------------------------------------------------------
  router.post('/', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const body = req.body as Partial<CreateUserRequest>;
      if (!body.email || !body.username || !body.password || !body.role) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 email、username、password 或 role' },
        });
        return;
      }
      // 角色合法性校验（3 级）
      if (!isValidRole(body.role)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 role: ${body.role}` },
        });
        return;
      }
      // 密码强度
      if (body.password.length < 6) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '密码至少 6 位' },
        });
        return;
      }
      // 用户名长度
      if (body.username.length < 2 || body.username.length > 32) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '用户名需为 2-32 字符' },
        });
        return;
      }

      const role = body.role as unknown as Role;
      const { userId } = await userService.register(body.email, body.username, body.password, {
        role,
        display_name: body.display_name,
      });
      // 获取完整用户记录
      const user = await userService.getUser(userId);
      const response: CreateUserResponse = { user: toAdminUserSummary(user) };

      // audit log（异步，失败不阻断响应）
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? null;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId,
            action: 'user.create',
            target_type: 'user',
            target_id: userId,
            details: { email: body.email, username: body.username, role: body.role },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }
      res.status(201).json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_ALREADY_EXISTS', 409);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/users/:id/role — 调整用户角色（v3.1.0 新增）
  // 仅 server_admin 可调用（路由挂载已套 requireAdmin=Role.SERVER_ADMIN）
  // v4.17.0 注：该端点仅设置单一活动角色，不修改 roles 集合。
  //             若需调整角色集合（增/删角色），请用 PUT /:id/roles。
  // v4.29.10: 注入「不能降级最后一个 server_admin」保护
  // ----------------------------------------------------------------
  router.patch('/:id/role', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const body = req.body as Partial<UpdateUserRoleRequest>;
      if (!body.role || !isValidRole(body.role)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 role: ${body.role}` },
        });
        return;
      }

      // 最后一个 server_admin 保护
      const db = req.app.locals.db as Knex;
      if (await isActiveServerAdmin(db, req.params.id)) {
        const targetRow = await db<UserRow>('users').where({ id: req.params.id }).first();
        const stillAdmin = isNewActiveRoleServerAdmin(
          body.role as UserRole,
          undefined,
          undefined,
          targetRow?.active_role,
        );
        if (!stillAdmin) {
          const remaining = await userService.countActiveServerAdmins(req.params.id);
          if (remaining === 0) {
            res.status(400).json({
              error: { code: 'PANEL_VALIDATION_ERROR', message: '不能降级最后一个 server_admin' },
            });
            return;
          }
        }
      }

      // 通过 updateUser 更新 role（normalizeRole 内部已做合法性校验）
      const updates: Partial<UserUpdate> = { role: toInternalRole(body.role) };
      const user = await userService.updateUser(req.params.id, updates);
      const response: UpdateUserRoleResponse = { user: toAdminUserSummary(user) };

      // audit log
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? null;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId,
            action: 'user.update_role',
            target_type: 'user',
            target_id: req.params.id,
            details: { new_role: body.role },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ==========================================================================
  // v4.17.0 多角色管理端点
  // ==========================================================================

  // ----------------------------------------------------------------
  // GET /api/users/:id/roles — 查询用户角色集合 + 活动角色（v4.17.0 新增）
  // 仅 server_admin 可调用（路由挂载已套 requireAdmin）
  // 注：本人查询自己的角色应走 /api/auth/me（已含 roles + active_role）
  // ----------------------------------------------------------------
  router.get('/:id/roles', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const result = await userService.listUserRoles(req.params.id);
      const response: ListUserRolesResponse = {
        user_id: result.user_id,
        roles: result.roles as UserRoles,
        active_role: result.active_role,
        requires_role_selection: result.requires_role_selection,
      };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/users/:id/roles — 调整用户角色集合（v4.17.0 新增）
  // 仅 server_admin 可调用；触发 JWT 黑名单（该用户所有旧 token 失效）
  // v4.29.10: 注入「不能降级最后一个 server_admin」保护
  // ----------------------------------------------------------------
  router.put('/:id/roles', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const body = req.body as Partial<UpdateUserRolesRequest>;

      // 校验 roles 非空 + 元素合法
      if (!Array.isArray(body.roles) || body.roles.length === 0) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'roles 必须为非空数组' },
        });
        return;
      }
      for (const r of body.roles) {
        if (!isValidRole(r)) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 role: ${r}` },
          });
          return;
        }
      }
      // 去重检查（normalizeRoles 内部会去重，这里仅做严格校验暴露问题）
      const uniqueRoles = new Set(body.roles);
      if (uniqueRoles.size !== body.roles.length) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'roles 含重复元素' },
        });
        return;
      }
      // 校验 active_role ∈ roles（若提供）
      if (body.active_role !== undefined) {
        if (!isValidRole(body.active_role)) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 active_role: ${body.active_role}` },
          });
          return;
        }
        if (!body.roles.includes(body.active_role)) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'active_role 必须在 roles 集合中' },
          });
          return;
        }
      }

      // 最后一个 server_admin 保护
      const db = req.app.locals.db as Knex;
      if (await isActiveServerAdmin(db, req.params.id)) {
        const targetRow = await db<UserRow>('users').where({ id: req.params.id }).first();
        const stillAdmin = isNewActiveRoleServerAdmin(
          undefined,
          body.roles as UserRole[],
          body.active_role as UserRole | undefined,
          targetRow?.active_role,
        );
        if (!stillAdmin) {
          const remaining = await userService.countActiveServerAdmins(req.params.id);
          if (remaining === 0) {
            res.status(400).json({
              error: { code: 'PANEL_VALIDATION_ERROR', message: '不能降级最后一个 server_admin' },
            });
            return;
          }
        }
      }

      const result = await userService.updateUserRoles(
        req.params.id,
        body.roles as UserRole[],
        body.active_role,
      );
      const response: UpdateUserRolesResponse = {
        user: toAdminUserSummary(result.user),
        revoked_token_count: result.revokedTokenCount,
      };

      // audit log
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? null;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId,
            action: 'user.update_roles',
            target_type: 'user',
            target_id: req.params.id,
            details: {
              new_roles: body.roles,
              new_active_role: body.active_role ?? body.roles[0],
              revoked_token_count: result.revokedTokenCount,
            },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/users/:id/revoke-tokens — 强制下线用户（v4.17.0 新增）
  // 仅 server_admin 可调用；将该用户所有未过期 token 加入黑名单 + token_version+1
  // ----------------------------------------------------------------
  router.post('/:id/revoke-tokens', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const result = await userService.revokeUserTokens(req.params.id);
      const response: RevokeUserTokensResponse = {
        user_id: req.params.id,
        revoked_token_count: result.revokedTokenCount,
        revoked_at: new Date().toISOString(),
      };

      // audit log
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId ?? null;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId,
            action: 'user.revoke_tokens',
            target_type: 'user',
            target_id: req.params.id,
            details: { revoked_token_count: result.revokedTokenCount },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/users/:id — 软删除用户（v3.1.0 新增）
  // 仅 server_admin 可调用；不可删除自己；不可删除最后一个 server_admin
  // ----------------------------------------------------------------
  router.delete('/:id', async (req, res) => {
    try {
      const userService = req.app.locals.userService as UserService;
      const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId;
      // 1. 不允许删除自己
      if (req.params.id === operatorId) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '不能删除自己的账号' },
        });
        return;
      }
      // 2. 查询目标用户，判断是否为 server_admin；若是则检查是否为最后一个
      const db = req.app.locals.db as Knex;
      const targetRow = await db<UserRow>('users').where({ id: req.params.id }).first();
      if (!targetRow) {
        res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
        });
        return;
      }
      const targetRole = normalizeRole(targetRow.active_role ?? Role.USER);
      if (targetRole === Role.SERVER_ADMIN) {
        // 排除自己后统计剩余 active server_admin
        const remaining = await userService.countActiveServerAdmins(req.params.id);
        if (remaining === 0) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '不能删除最后一个 server_admin' },
          });
          return;
        }
      }
      // 3. 软删除
      await userService.softDeleteUser(req.params.id);
      const response: DeleteUserResponse = { id: req.params.id, deleted: true };

      // 4. audit log
      const auditLogService = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      if (auditLogService) {
        void auditLogService
          .create({
            user_id: operatorId ?? null,
            action: 'user.soft_delete',
            target_type: 'user',
            target_id: req.params.id,
            // v4.19.2: users.role 列已 DROP，审计日志改记 active_role
            details: { email: targetRow.email, username: targetRow.username, previous_role: targetRow.active_role ?? null },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);
      }
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'USER_NOT_FOUND', 404);
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
