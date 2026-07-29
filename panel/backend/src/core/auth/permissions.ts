// ============================================================================
// 权限矩阵（3 级角色版 + v4.17.0 多角色 + 权限点矩阵）
// server_admin：底座 + 全部实例 + Pack（最高权限）
// instance_admin：自有实例（servers.owner_user_id 匹配）
// user：消费 + 个人设置（绑定实例后获 VIP1）
//
// 说明：本矩阵仅做"角色级"粗粒度判断（hasPermission）。
//       实例级访问权（instance_admin / user 是否能操作某个具体实例）
//       由 canAccessInstance + 中间件 requireInstanceAccess 在请求时落地。
//
// v4.17.0 升级：
//   - 新增 PermissionPoint 字符串字面量类型（约 90 个权限点）
//   - 新增 hasPermissionPoint / hasAnyPermissionPoint 函数（基于 role_permission_templates 表）
//   - 旧 hasPermission（基于 PERMISSION_REQUIRED_ROLE 硬编码表）保留，过渡期使用
//   - 多角色场景：任一角色拥有该权限点即视为有权限
// ============================================================================

import type { Knex } from 'knex';
import { hasRoleLevel, hasRoleLevelAny, Role } from './roles.js';

/**
 * 权限动作枚举（旧硬编码版，过渡期保留）
 * 命名约定：<域>:<动作>
 *   - 底座域：users / packs / nodes / system_config / audit_logs / webhooks
 *   - 实例域：servers / shop / cdk / chat / vote / players / saves / mods / backups / monitor / lists
 *   - 消费域：shop 购买 / cdk 兑换 / vote 投票
 */
export type Permission =
  // 底座操作（仅 server_admin）
  | 'user:manage'
  | 'pack:read'
  | 'pack:manage'
  | 'node:read'
  | 'system_config:manage'
  | 'audit_log:read'
  | 'webhook:manage'
  // 实例操作（server_admin 全部 + instance_admin 仅自有实例）
  | 'server:read'
  | 'server:create'
  | 'server:delete'
  | 'server:start'
  | 'server:stop'
  | 'server:command'
  | 'shop:manage'
  | 'cdk:manage'
  | 'chat:manage'
  | 'vote:manage'
  | 'player:manage'
  | 'save:manage'
  | 'mod:manage'
  | 'backup:manage'
  | 'monitor:read'
  | 'list:manage'
  // 消费操作（user 仅绑定实例）
  | 'shop:purchase'
  | 'cdk:redeem'
  | 'vote:participate';

/**
 * 权限所需的最小角色（数字等级见 ROLE_LEVEL）
 * - 底座操作 → server_admin (3)
 * - 实例操作 → instance_admin (2)（server_admin 等级更高，自动通过 hasRoleLevel）
 * - 消费操作 → user (1)（所有登录用户角色等级 >= 1）
 *
 * 注：实例操作的"仅自有实例"约束不在本表，由 canAccessInstance +
 *     中间件 requireInstanceAccess 在请求时落地。
 */
const PERMISSION_REQUIRED_ROLE: Record<Permission, Role> = {
  // 底座操作
  'user:manage': Role.SERVER_ADMIN,
  'pack:read': Role.SERVER_ADMIN,
  'pack:manage': Role.SERVER_ADMIN,
  'node:read': Role.SERVER_ADMIN,
  'system_config:manage': Role.SERVER_ADMIN,
  'audit_log:read': Role.SERVER_ADMIN,
  'webhook:manage': Role.SERVER_ADMIN,
  // 实例操作
  'server:read': Role.INSTANCE_ADMIN,
  'server:create': Role.INSTANCE_ADMIN,
  'server:delete': Role.INSTANCE_ADMIN,
  'server:start': Role.INSTANCE_ADMIN,
  'server:stop': Role.INSTANCE_ADMIN,
  'server:command': Role.INSTANCE_ADMIN,
  'shop:manage': Role.INSTANCE_ADMIN,
  'cdk:manage': Role.INSTANCE_ADMIN,
  'chat:manage': Role.INSTANCE_ADMIN,
  'vote:manage': Role.INSTANCE_ADMIN,
  'player:manage': Role.INSTANCE_ADMIN,
  'save:manage': Role.INSTANCE_ADMIN,
  'mod:manage': Role.INSTANCE_ADMIN,
  'backup:manage': Role.INSTANCE_ADMIN,
  'monitor:read': Role.INSTANCE_ADMIN,
  'list:manage': Role.INSTANCE_ADMIN,
  // 消费操作
  'shop:purchase': Role.USER,
  'cdk:redeem': Role.USER,
  'vote:participate': Role.USER,
};

/**
 * 检查用户角色是否拥有指定权限（角色级粗粒度判断）
 *
 * v4.17.0 多角色场景：取用户最高角色等级比较
 */
export function hasPermission(userRole: Role, permission: Permission): boolean {
  const required = PERMISSION_REQUIRED_ROLE[permission];
  return hasRoleLevel(userRole, required);
}

/**
 * v4.17.0 多角色版本：检查用户角色集合中是否有任一角色拥有指定权限
 */
export function hasPermissionAny(userRoles: Role[], permission: Permission): boolean {
  const required = PERMISSION_REQUIRED_ROLE[permission];
  return hasRoleLevelAny(userRoles, required);
}

// ============================================================================
// v4.17.0 权限点矩阵（DB 驱动）
// ============================================================================

/**
 * 权限点代码（字符串字面量类型，约 90 个）
 * 与 public/schema/permission-points-schema.json + migration 脚本 PERMISSION_POINTS 数组保持一致
 *
 * 命名约定：<资源>.<动作>（如 instance.create、wallet.debit、binding.verify）
 */
export type PermissionPoint = string;

/**
 * 检查单个角色是否拥有指定权限点（基于 role_permission_templates 表）
 *
 * @param db Knex 实例
 * @param role 角色
 * @param permissionCode 权限点代码
 * @returns true=有权限 / false=无权限或表不存在
 */
export async function roleHasPermissionPoint(
  db: Knex,
  role: Role,
  permissionCode: PermissionPoint,
): Promise<boolean> {
  try {
    const row = await db('role_permission_templates')
      .where({ role, permission_code: permissionCode })
      .first();
    return !!row;
  } catch {
    // role_permission_templates 表不存在时降级到 false
    return false;
  }
}

/**
 * 检查用户角色集合中是否有任一角色拥有指定权限点
 *
 * 多角色场景：任一角色拥有该权限点即视为有权限
 *
 * @param db Knex 实例
 * @param userRoles 用户角色集合（已归一化）
 * @param permissionCode 权限点代码
 */
export async function hasPermissionPoint(
  db: Knex,
  userRoles: Role[],
  permissionCode: PermissionPoint,
): Promise<boolean> {
  if (userRoles.length === 0) return false;
  try {
    const row = await db('role_permission_templates')
      .whereIn('role', userRoles)
      .where('permission_code', permissionCode)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * 检查用户角色集合中是否拥有任一指定权限点（OR 语义）
 */
export async function hasAnyPermissionPoint(
  db: Knex,
  userRoles: Role[],
  permissionCodes: PermissionPoint[],
): Promise<boolean> {
  if (userRoles.length === 0 || permissionCodes.length === 0) return false;
  try {
    const row = await db('role_permission_templates')
      .whereIn('role', userRoles)
      .whereIn('permission_code', permissionCodes)
      .first();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * 列出角色的全部权限点（用于 admin 查询用户权限、角色编辑页展示）
 */
export async function listPermissionPointsByRole(db: Knex, role: Role): Promise<PermissionPoint[]> {
  try {
    const rows: Array<{ permission_code: string }> = await db('role_permission_templates')
      .select('permission_code')
      .where('role', role);
    return rows.map((r) => r.permission_code);
  } catch {
    return [];
  }
}

/**
 * 判断用户是否能访问某实例（实例级访问权，纯函数不查 DB）
 *
 * 规则：
 *   - server_admin → true（全部实例）
 *   - instance_admin + owner 匹配 → true（仅自有实例）
 *   - 其它 → false
 *
 * 注：user 角色的实例访问权依赖 bindings 表（v4.17.0 统一绑定），
 *     此纯函数不查 DB，故对 user 一律返回 false。
 *     user 的绑定访问由中间件 requireInstanceAccess 查表落地。
 */
export function canAccessInstance(
  userRole: Role,
  userId: string,
  serverOwnerId: string,
): boolean {
  if (userRole === Role.SERVER_ADMIN) {
    return true;
  }
  if (userRole === Role.INSTANCE_ADMIN && userId === serverOwnerId) {
    return true;
  }
  return false;
}

/**
 * v4.17.0 多角色版本：判断用户角色集合中是否有任一角色能访问实例
 */
export function canAccessInstanceAny(
  userRoles: Role[],
  userId: string,
  serverOwnerId: string,
): boolean {
  return userRoles.some((r) => canAccessInstance(r, userId, serverOwnerId));
}
