// ============================================================================
// 认证中间件 — JWT 鉴权 + API Key 旁路 + 角色访问控制
// 优先级：x-api-key header > Authorization: Bearer <token>
// 成功：附加 user 到 req；失败：返回 401
// 角色体系：3 级（server_admin / instance_admin / user）
//
// v4.4.0-J1 新增：API Key 旁路认证
//   - 客户端可携带 `x-api-key: gsp_<32hex>` header 而非 JWT
//   - 中间件优先检查 x-api-key：命中则走 ApiKeyService.verifyApiKey
//   - 否则回退到 JWT 鉴权路径
//   - 两条路径最终都构造 JwtPayload 附加到 req.user，下游中间件（requireRole 等）无感知
// ============================================================================

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Knex } from 'knex';
import { extractBearerToken, verifyToken, type JwtPayload } from '../core/auth/jwt.js';
import { Role, normalizeRole, normalizeRoles, hasAnyRole } from '../core/auth/roles.js';
import type { Role as RoleType } from '../core/auth/roles.js';
import { hasPermissionPoint, type PermissionPoint } from '../core/auth/permissions.js';
import { getTokenBlacklistService } from '../core/auth/tokenBlacklist.js';
import { ApiKeyService } from '../services/apiKeyService.js';

/**
 * Express Request 扩展：附加认证后的用户信息
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /**
       * v4.4.0-J1：标记本次认证使用的机制（'jwt' | 'api_key' | undefined）
       * 用于审计日志区分请求来源
       */
      authMethod?: 'jwt' | 'api_key';
      /**
       * v4.17.0：用户角色集合（多值，已归一化）
       * 从 JWT roles 字段读取，缺失时从 role 单值降级推导
       */
      userRoles?: RoleType[];
      /**
       * v4.17.0：当前活动角色（会话级）
       * 从 JWT active_role 字段读取，缺失时取 userRoles[0]
       */
      activeRole?: RoleType;
    }
  }
}

/**
 * v4.17.0 从 JWT payload 提取并归一化用户角色集合
 *
 * 优先级：
 *   1. JWT.roles（v4.17.0 新字段，多值）
 *   2. JWT.role（旧字段，单值，向后兼容）
 *   3. 默认 [Role.USER]
 */
function extractUserRoles(payload: JwtPayload): RoleType[] {
  if (Array.isArray(payload.roles) && payload.roles.length > 0) {
    return normalizeRoles(payload.roles);
  }
  // 降级：从单值 role 推导
  return [normalizeRole(payload.role)];
}

/**
 * v4.17.0 从 JWT payload 解析当前活动角色
 *
 * 优先级：
 *   1. JWT.active_role（v4.17.0 新字段）
 *   2. JWT.role（旧字段，向后兼容）
 *   3. userRoles[0]
 */
function extractActiveRole(payload: JwtPayload, userRoles: RoleType[]): RoleType {
  if (payload.active_role) {
    const r = normalizeRole(payload.active_role);
    if (userRoles.includes(r)) {
      return r;
    }
  }
  // 降级：JWT.role（旧字段）→ 归一化后若在 userRoles 中则使用
  if (payload.role) {
    const r = normalizeRole(payload.role);
    if (userRoles.includes(r)) {
      return r;
    }
  }
  return userRoles[0] ?? Role.USER;
}

/**
 * 从 Express Request 提取客户端 IP（用于 API Key 审计）
 * 优先级：x-forwarded-for 第一个 → x-real-ip → req.ip
 */
function getClientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim();
  }
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.length > 0) {
    return xRealIp.trim();
  }
  return req.ip;
}

/**
 * JWT + API Key 双路径鉴权中间件
 *
 * 优先级：
 *   1. 若存在 `x-api-key` header → 走 API Key 路径
 *   2. 否则 → 走 JWT Bearer Token 路径
 *
 * 成功：附加 user 到 req，附加 authMethod 到 req
 * 失败：返回 401
 *
 * token_version 校验（JWT 路径，v3.4.0 新增）：
 *   - 解析 JWT 后从 payload 取 token_version（缺失视为 0，兼容旧 JWT）
 *   - 从 DB 查 users.token_version
 *   - 若 user.token_version > 0 且 JWT.token_version !== user.token_version → 401（token 已失效）
 *   - 若 user.token_version = 0 → 跳过校验（兼容旧行为，JWT 不受 token_version 约束）
 *   - DB 不可用 / 查询失败时降级跳过（不阻断已通过签名校验的请求，仅记录错误）
 *
 * API Key 路径（v4.4.0-J1 新增）：
 *   - ApiKeyService.verifyApiKey 内部校验：格式 / hash 命中 / 未撤销 / 未过期 / user active
 *   - 不受 token_version 约束（无 JWT session 概念）
 *   - 角色取自 api_keys.role（创建时冻结，与 user.role 解耦）
 */
export function authenticateToken(secret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const db = req.app.locals.db as Knex | undefined;

    // ===== 路径 1：x-api-key 旁路认证 =====
    const apiKeyHeader = req.headers['x-api-key'];
    const apiKeyValue = Array.isArray(apiKeyHeader)
      ? (apiKeyHeader[0] ?? null)
      : (apiKeyHeader ?? null);
    if (typeof apiKeyValue === 'string' && apiKeyValue.length > 0) {
      if (!db) {
        res.status(500).json({
          error: {
            code: 'PANEL_INTERNAL_ERROR' as const,
            message: '数据库未初始化',
          },
        });
        return;
      }
      try {
        const apiKeyService = new ApiKeyService(db);
        const clientIp = getClientIp(req);
        const payload = await apiKeyService.verifyApiKey(apiKeyValue, clientIp);
        if (!payload) {
          // v4.x 安全补强：API Key 路径认证失败统一返回 API_KEY_REVOKED
          // verifyApiKey 内部已将 revoked_at IS NULL 下推到 SQL WHERE（硬校验），
          // 查不到即视为 key 不存在/已撤销/已过期，统一以 API_KEY_REVOKED 拒绝
          res.status(401).json({
            error: {
              code: 'API_KEY_REVOKED' as const,
              message: 'API Key 无效、已撤销或已过期',
            },
          });
          return;
        }
        req.user = payload;
        req.authMethod = 'api_key';
        // v4.17.0 API Key 角色为创建时冻结的单值，降级推导为单元素数组
        const apiUserRoles: RoleType[] = [normalizeRole(payload.role)];
        req.userRoles = apiUserRoles;
        req.activeRole = apiUserRoles[0] ?? Role.USER;
        next();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({
          error: {
            code: 'PANEL_INTERNAL_ERROR' as const,
            message: `API Key 认证内部错误: ${message}`,
          },
        });
        return;
      }
    }

    // ===== 路径 2：JWT Bearer Token 鉴权 =====
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '缺少 Authorization 头或 x-api-key 头',
        },
      });
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token, secret);
    } catch {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: 'JWT 无效或已过期',
        },
      });
      return;
    }

    // token_version 校验（改密后失效旧 JWT）
    // 规则（AGENTS.md §3）：若 user.token_version > 0 且 JWT.token_version !== user.token_version → 401；
    //                       user.token_version = 0 时跳过校验（兼容旧 JWT，向后兼容）
    const jwtTokenVersion = payload.token_version ?? 0;
    if (db) {
      try {
        const user = await db<{ id: string; token_version: number }>('users')
          .select('token_version')
          .where({ id: payload.userId })
          .first();
        // user 不存在：放行让后续业务层处理（保持原有行为，不在此处引入 404）
        // user.token_version = 0：跳过校验（兼容旧行为，JWT 不受 token_version 约束）
        // user.token_version > 0 且与 JWT 不匹配：旧 JWT 已失效（改密后 token_version +1）
        if (user && user.token_version > 0 && user.token_version !== jwtTokenVersion) {
          res.status(401).json({
            error: {
              code: 'PANEL_UNAUTHORIZED' as const,
              message: '登录已失效，请重新登录',
            },
          });
          return;
        }
      } catch {
        // DB 查询失败（如 token_version 列尚未迁移）时降级：
        // 签名已校验通过，放行请求（不因 token_version 查询失败阻断正常请求）
      }
    }

    // v4.17.0 JWT 黑名单校验（角色变更后显式撤销的 token）
    // 与 token_version 机制互补：token_version 是版本号比对，黑名单是显式撤销清单
    if (jwtTokenVersion > 0) {
      const blacklist = getTokenBlacklistService();
      if (blacklist.isBlacklisted(payload.userId, jwtTokenVersion)) {
        res.status(401).json({
          error: {
            code: 'PANEL_UNAUTHORIZED' as const,
            message: 'Token 已被撤销，请重新登录',
          },
        });
        return;
      }
    }

    // v4.17.0 提取多角色信息并附加到 req
    const userRoles = extractUserRoles(payload);
    const activeRole = extractActiveRole(payload, userRoles);
    req.user = payload;
    req.authMethod = 'jwt';
    req.userRoles = userRoles;
    req.activeRole = activeRole;
    next();
  };
}

/**
 * 角色鉴权中间件工厂：仅允许指定角色通过
 *
 * v4.17.0 多角色支持：
 *   - 优先使用 req.activeRole（会话级活动角色）
 *   - 缺失时降级到 req.user.role（旧 JWT 单值）
 *   - 校验逻辑：activeRole ∈ roles（任一匹配即通过）
 *
 * 用法：app.use('/api/users', authenticateToken(secret), requireRole(Role.SERVER_ADMIN), router)
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 优先使用 activeRole（v4.17.0），降级到旧 role 字段
    const rawRole = req.activeRole ?? req.user?.role;
    if (!rawRole) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '未认证',
        },
      });
      return;
    }
    const role = normalizeRole(rawRole);
    if (!roles.includes(role)) {
      res.status(403).json({
        error: { code: 'PANEL_FORBIDDEN' as const, message: '权限不足' },
      });
      return;
    }
    next();
  };
}

/**
 * v4.17.0 权限点鉴权中间件工厂：基于 role_permission_templates 表校验
 *
 * 多角色场景：任一角色拥有该权限点即通过
 *
 * 用法：router.post('/', authenticateToken(secret), requirePermission('instance.create'), handler)
 *
 * 注：本中间件需要 DB（查 role_permission_templates 表），DB 不可用时降级到 false（拒绝）
 */
export function requirePermission(permissionCode: PermissionPoint): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userRoles = req.userRoles;
    if (!userRoles || userRoles.length === 0) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '未认证或角色信息缺失',
        },
      });
      return;
    }

    const db = req.app.locals.db as Knex | undefined;
    if (!db) {
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: '数据库未初始化',
        },
      });
      return;
    }

    try {
      const allowed = await hasPermissionPoint(db, userRoles, permissionCode);
      if (!allowed) {
        res.status(403).json({
          error: {
            code: 'PANEL_FORBIDDEN' as const,
            message: `缺少权限: ${permissionCode}`,
          },
        });
        return;
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: `权限校验内部错误: ${message}`,
        },
      });
    }
  };
}

/**
 * v4.17.0 多角色鉴权中间件工厂：要求用户角色集合中包含任一指定角色
 *
 * 与 requireRole 不同：requireRole 校验 activeRole（单值），requireAnyRole 校验 userRoles（多值集合）
 * 用于"用户身兼多角色时，只要拥有任一角色即可通过"的场景
 */
export function requireAnyRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles = req.userRoles;
    if (!userRoles || userRoles.length === 0) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '未认证或角色信息缺失',
        },
      });
      return;
    }
    if (!hasAnyRole(userRoles, roles)) {
      res.status(403).json({
        error: { code: 'PANEL_FORBIDDEN' as const, message: '权限不足' },
      });
      return;
    }
    next();
  };
}

/**
 * v4.7.0 辅助函数：查询用户在某实例的未过期 instance_roles 记录
 *
 * 过期判定：expires_at IS NULL OR expires_at > datetime('now')
 * 表不存在时（migration 未跑）返回 null，安全降级到全局角色判定
 *
 * @param db Knex 实例
 * @param instanceId 实例 ID
 * @param userId 用户 ID
 * @returns Role.INSTANCE_ADMIN | Role.USER | null（null 表示无未过期记录或表不存在）
 */
async function getUnexpiredInstanceRole(
  db: Knex,
  instanceId: string,
  userId: string,
): Promise<Role | null> {
  try {
    const row = await db<{ role: string }>('instance_roles')
      .select('role')
      .where('instance_id', instanceId)
      .where('user_id', userId)
      .where(function () {
        this.whereNull('expires_at').orWhere('expires_at', '>', new Date().toISOString());
      })
      .first();
    if (!row) {
      return null;
    }
    const role = normalizeRole(row.role);
    // 实例级角色仅允许 instance_admin / user（不允许覆盖为 server_admin）
    if (role === Role.INSTANCE_ADMIN || role === Role.USER) {
      return role;
    }
    return null;
  } catch {
    // instance_roles 表不存在时降级到 null（fallback 到全局角色）
    return null;
  }
}

/**
 * 实例访问鉴权中间件工厂：
 *   server_admin → 通过
 *   instance_roles 表存在未过期记录（任意角色） → 通过（实例级显式授权即访问权）
 *   owner 匹配（任意角色） → 通过（兜底，v4.36.1: 从 instance_admin 分支提出）
 *   instance_admins 共管记录（仅 instance_admin 角色） → 通过（兜底）
 *   存在 verified 绑定记录（bindings 表，v4.17.0 统一绑定） → 通过（兜底）
 *   否则 403
 *
 * v4.7.0: instance_roles 表优先于全局角色判定。server_admin 全局角色不查 instance_roles。
 * v4.17.0: 查统一 bindings 表（binding_type='account', scope_type='instance', verify_status='verified'）
 *          旧表 user_instance_bindings 已物理删除，不再 fallback
 *          角色判定优先使用 req.activeRole（多角色会话级），降级到 req.user.role
 * serverId 从 req.params[serverIdParam] 取（默认 'serverId'）。
 * 绑定表可能尚未建表，用 try-catch 保护，查询失败时 fallback 到 owner 判断。
 * db 从 req.app.locals.db 取（由 index.ts 在启动时挂载）。
 */
export function requireInstanceAccess(serverIdParam = 'serverId'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '未认证',
        },
      });
      return;
    }

    const serverId = req.params[serverIdParam];
    if (!serverId) {
      res.status(400).json({
        error: {
          code: 'PANEL_VALIDATION_ERROR' as const,
          message: `缺少路由参数: ${serverIdParam}`,
        },
      });
      return;
    }

    // v4.17.0 优先使用 activeRole（多角色会话级），降级到旧 role 字段
    const role = normalizeRole(req.activeRole ?? user.role);
    const db = req.app.locals.db as Knex | undefined;
    if (!db) {
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: '数据库未初始化',
        },
      });
      return;
    }

    try {
      // server_admin 全通过
      if (role === Role.SERVER_ADMIN) {
        next();
        return;
      }

      // 查询实例 owner
      const server = await db<{ id: string; owner_user_id: string }>('servers')
        .select('owner_user_id')
        .where({ id: serverId })
        .first();

      if (!server) {
        res.status(404).json({
          error: {
            code: 'SERVER_NOT_FOUND' as const,
            message: `实例不存在: ${serverId}`,
          },
        });
        return;
      }

      // v4.7.0: 优先查 instance_roles 表（未过期记录），任意角色都授予访问权
      const instanceRole = await getUnexpiredInstanceRole(db, serverId, user.userId);
      if (instanceRole !== null) {
        next();
        return;
      }

      // owner 匹配（任意角色兜底）—— 实例 owner 在任意 active_role 下都拥有访问权
      // 修复 v4.36.1: 原逻辑将 owner 校验嵌套在 instance_admin 分支内，导致多角色用户
      //   切换到 user active_role 后，列表能见到自有实例但详情页 403（列表与鉴权不一致）
      if (server.owner_user_id === user.userId) {
        next();
        return;
      }

      // instance_admin 共管记录（兜底）
      if (role === Role.INSTANCE_ADMIN) {
        // v4.5.0: 检查 instance_admins 共管关联表
        try {
          const adminRecord = await db('instance_admins')
            .where({ instance_id: serverId, user_id: user.userId })
            .first();
          if (adminRecord) {
            next();
            return;
          }
        } catch {
          // 表不存在时 fallback 到拒绝
        }
      }

      // v4.17.0 查统一 bindings 表（旧表 user_instance_bindings 已物理删除）
      try {
        const binding = await db('bindings')
          .where({
            user_id: user.userId,
            binding_type: 'account',
            scope_type: 'instance',
            scope_ref: serverId,
            verify_status: 'verified',
          })
          .first();
        if (binding) {
          next();
          return;
        }
      } catch {
        // bindings 表不存在（迁移未跑） → fallback：owner 判断已失败，继续拒绝
      }

      res.status(403).json({
        error: {
          code: 'PANEL_FORBIDDEN' as const,
          message: '无权访问该实例',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: `鉴权内部错误: ${message}`,
        },
      });
    }
  };
}

/**
 * 实例管理员鉴权中间件工厂：
 *   server_admin → 通过
 *   instance_roles 表存在未过期记录且 role='instance_admin' → 通过（实例级管理员）
 *   instance_admin + owner 匹配 → 通过（兜底）
 *   instance_admins 共管记录 → 通过（兜底）
 *   否则 403（不查绑定记录，user 一律拒绝）
 *
 * v4.7.0: instance_roles 表优先于全局角色判定。server_admin 全局角色不查 instance_roles。
 * serverId 从 req.params[serverIdParam] 取（默认 'serverId'）。
 */
export function requireInstanceAdmin(serverIdParam = 'serverId'): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        error: {
          code: 'PANEL_UNAUTHORIZED' as const,
          message: '未认证',
        },
      });
      return;
    }

    const serverId = req.params[serverIdParam];
    if (!serverId) {
      res.status(400).json({
        error: {
          code: 'PANEL_VALIDATION_ERROR' as const,
          message: `缺少路由参数: ${serverIdParam}`,
        },
      });
      return;
    }

    // v4.17.0 优先使用 activeRole（多角色会话级），降级到旧 role 字段
    const role = normalizeRole(req.activeRole ?? user.role);
    // server_admin 直接通过
    if (role === Role.SERVER_ADMIN) {
      next();
      return;
    }

    const db = req.app.locals.db as Knex | undefined;
    if (!db) {
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: '数据库未初始化',
        },
      });
      return;
    }

    try {
      const server = await db<{ id: string; owner_user_id: string }>('servers')
        .select('owner_user_id')
        .where({ id: serverId })
        .first();

      if (!server) {
        res.status(404).json({
          error: {
            code: 'SERVER_NOT_FOUND' as const,
            message: `实例不存在: ${serverId}`,
          },
        });
        return;
      }

      // v4.7.0: 优先查 instance_roles 表，仅 instance_admin 角色授予管理员权限
      const instanceRole = await getUnexpiredInstanceRole(db, serverId, user.userId);
      if (instanceRole === Role.INSTANCE_ADMIN) {
        next();
        return;
      }

      // v4.5.0: instance_admin → owner 匹配 或 instance_admins 共管记录（兜底）
      if (role === Role.INSTANCE_ADMIN) {
        if (server.owner_user_id === user.userId) {
          next();
          return;
        }
        // 检查 instance_admins 共管关联表
        try {
          const adminRecord = await db('instance_admins')
            .where({ instance_id: serverId, user_id: user.userId })
            .first();
          if (adminRecord) {
            next();
            return;
          }
        } catch {
          // 表不存在时 fallback 到拒绝
        }
      }

      res.status(403).json({
        error: {
          code: 'PANEL_FORBIDDEN' as const,
          message: '需要实例管理员权限',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: {
          code: 'PANEL_INTERNAL_ERROR' as const,
          message: `鉴权内部错误: ${message}`,
        },
      });
    }
  };
}

/**
 * 管理员鉴权中间件（向后兼容别名）
 * 等价于 requireRole(Role.SERVER_ADMIN) —— 仅 server_admin 通过
 *
 * 历史行为：旧 4 级时放行 admin / system_admin；
 *           新 3 级下 server_admin 是其等价最高权限，instance_admin / user 拒绝。
 */
export const requireAdmin: RequestHandler = requireRole(Role.SERVER_ADMIN);
