// ============================================================================
// 3 级角色定义：server_admin > instance_admin > user
// 内部权限体系，比公共契约的 UserRole('admin'|'user') 更细粒度
//
// 映射关系（相对旧 4 级）：
//   system_admin → server_admin   （系统管理员 → 服务器管理员）
//   admin        → instance_admin （管理员     → 实例管理员）
//   operator     → user           （操作员     → 普通用户）
//   viewer       → user           （查看者     → 普通用户）
//
// @version 3.1.0 升级：内部 Role 维持 3 级不变；公共契约 UserRole 升 3 级后
//                  toContractUserRole 改为直传新 3 级值。
// ============================================================================

import type { UserRole as UserRoleContract } from '@public/schema/panel-api-types';

export const Role = {
  SERVER_ADMIN: 'server_admin',
  INSTANCE_ADMIN: 'instance_admin',
  USER: 'user',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/**
 * 角色等级（数字越大权限越高）
 */
export const ROLE_LEVEL: Record<Role, number> = {
  server_admin: 3,
  instance_admin: 2,
  user: 1,
};

/**
 * 所有合法角色值（用于校验）
 */
export const ALL_ROLES: Role[] = [Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER];

/**
 * 判断角色是否合法
 */
export function isValidRole(value: string): value is Role {
  return ALL_ROLES.includes(value as Role);
}

/**
 * 判断用户角色等级是否 >= 目标角色等级
 */
export function hasRoleLevel(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

/**
 * 将内部 3 级角色映射到公共契约的 UserRole（3 级）
 * @version 3.1.0 升级：契约 UserRole 从 2 级升 3 级，函数现在直传新 3 级值。
 *   server_admin → 'server_admin'
 *   instance_admin → 'instance_admin'
 *   user → 'user'
 *
 * 历史备注：旧契约 UserRole 为 'admin'|'user'，曾使用以下映射：
 *   server_admin / instance_admin → 'admin'
 *   user → 'user'
 * 升级后函数变更为直传新 3 级值（不再折叠到 2 级），与契约 3.1.0 对齐。
 */
export function toContractUserRole(role: Role): UserRoleContract {
  return role as UserRoleContract;
}

/**
 * 兼容旧角色值（迁移期）—— 用于读取可能尚未迁移的旧用户记录。
 *
 * 旧 4 级 → 新 3 级映射（与 migration 20260714100000_migrate_roles_to_3level 一致）：
 *   system_admin → server_admin
 *   admin        → instance_admin
 *   operator / viewer → user
 * 新值原样返回；未知值降级为 user（最低权限原则）。
 */
export function normalizeRole(role: string): Role {
  switch (role) {
    case 'server_admin':
    case 'system_admin': // 旧值兼容
      return Role.SERVER_ADMIN;
    case 'instance_admin':
    case 'admin': // 旧值兼容
      return Role.INSTANCE_ADMIN;
    case 'user':
    case 'operator': // 旧值兼容
    case 'viewer': // 旧值兼容
      return Role.USER;
    default:
      return Role.USER;
  }
}

// ============================================================================
// v4.17.0 多角色支持
// ============================================================================

/**
 * 将任意输入归一化为合法的 Role[] 数组
 *
 * - 输入 Role[] → 逐项 normalizeRole + 去重
 * - 输入 string（单值，向后兼容） → [normalizeRole(string)]
 * - 输入 null/undefined/空数组 → [Role.USER]（最低权限默认）
 * - 输入 JSON 字符串（来自 DB users.roles 字段） → 解析后归一化
 *
 * 用途：从 DB / JWT / 请求体读取 roles 字段后统一规范化
 */
export function normalizeRoles(input: unknown): Role[] {
  let arr: unknown[];

  if (input == null) {
    return [Role.USER];
  }

  if (typeof input === 'string') {
    // DB users.roles 存储为 JSON 字符串
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        arr = JSON.parse(trimmed) as unknown[];
      } catch {
        return [Role.USER];
      }
    } else {
      // 单值字符串
      return [normalizeRole(trimmed)];
    }
  } else if (Array.isArray(input)) {
    arr = input;
  } else {
    return [Role.USER];
  }

  if (arr.length === 0) {
    return [Role.USER];
  }

  const seen = new Set<Role>();
  const result: Role[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const r = normalizeRole(item);
    if (!seen.has(r)) {
      seen.add(r);
      result.push(r);
    }
  }

  return result.length > 0 ? result : [Role.USER];
}

/**
 * 判断用户角色集合中是否包含指定角色（或更高等级角色）
 *
 * 与 hasRoleLevel 不同，本函数严格匹配"是否拥有该角色"，不做等级提升判断。
 * 用于多角色场景下判断"用户是否身兼某角色"。
 */
export function hasRole(userRoles: Role[], requiredRole: Role): boolean {
  return userRoles.includes(requiredRole);
}

/**
 * 判断用户角色集合中是否包含任一指定角色（OR 语义）
 */
export function hasAnyRole(userRoles: Role[], requiredRoles: Role[]): boolean {
  return requiredRoles.some((r) => userRoles.includes(r));
}

/**
 * 判断用户角色集合中是否拥有指定角色等级（含更高等级）
 * 多角色场景：取用户最高角色等级比较
 */
export function hasRoleLevelAny(userRoles: Role[], requiredRole: Role): boolean {
  const maxLevel = Math.max(...userRoles.map((r) => ROLE_LEVEL[r]));
  return maxLevel >= ROLE_LEVEL[requiredRole];
}

/**
 * 解析 active_role：优先使用传入值，否则取 roles[0]
 *
 * 用于登录时选定活动角色、从 DB 读取用户记录时确定当前角色
 *
 * @param activeRole 显式传入的 active_role（可能为 undefined / null / 非法值）
 * @param roles 角色集合（已归一化）
 * @returns 合法的 active_role（必须 ∈ roles）
 */
export function resolveActiveRole(activeRole: unknown, roles: Role[]): Role {
  if (typeof activeRole === 'string') {
    const r = normalizeRole(activeRole);
    if (roles.includes(r)) {
      return r;
    }
  }
  // 默认取 roles[0]（roles 已由 normalizeRoles 保证非空）
  return roles[0] ?? Role.USER;
}

/**
 * 将内部 Role[] 映射到公共契约的 UserRole[]（v4.17.0 直传新 3 级值）
 */
export function toContractUserRoles(roles: Role[]): UserRoleContract[] {
  return roles.map((r) => r as UserRoleContract);
}

// ============================================================================
// v4.28.0 全员服主——角色集合工厂
// ============================================================================

/**
 * 生成账号的完整角色集合（全员服主规范）
 *
 * 背景：玩家和服主是同层级的两面——玩家自己开服就是服主，玩别人的服就是玩家。
 * 因此每个账号的 roles 都包含 user 与 instance_admin，身份切换仅改变 active_role。
 *
 * 映射规则（保持主角色在前，追加缺失项）：
 *   user           → ['user', 'instance_admin']
 *   instance_admin → ['instance_admin', 'user']
 *   server_admin   → ['server_admin', 'instance_admin', 'user']
 *
 * @param primary 账号的主角色（注册角色 / active_role 初始值）
 */
export function universalRolesFor(primary: Role): Role[] {
  switch (primary) {
    case Role.SERVER_ADMIN:
      return [Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER];
    case Role.INSTANCE_ADMIN:
      return [Role.INSTANCE_ADMIN, Role.USER];
    case Role.USER:
    default:
      return [Role.USER, Role.INSTANCE_ADMIN];
  }
}
