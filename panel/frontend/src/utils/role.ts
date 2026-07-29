import type { UserInfo } from '@public/schema/panel-api-types';

/**
 * 返回当前会话真正生效的角色。
 * v4.28.x 起多角色账号以 active_role 为准；role 仅作为兼容回退。
 */
export function getEffectiveRole(user: Pick<UserInfo, 'role' | 'active_role'> | null | undefined): string | null {
  if (!user) return null;
  return user.active_role ?? user.role ?? null;
}

/**
 * 判断用户角色是否为管理员（含 server_admin / system_admin / admin 三种）
 * 与 Layout.tsx 的 isServerAdmin 保持一致，供所有 admin 页面统一引用
 */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'server_admin' || role === 'system_admin' || role === 'admin';
}

/**
 * 判断用户角色是否为 instance_admin 或以上（server_admin 也通过）
 * 用于实例级管理页面（如 VIP 管理）的门控
 */
export function isInstanceAdminOrAbove(role: string | undefined | null): boolean {
  return (
    role === 'server_admin' ||
    role === 'system_admin' ||
    role === 'instance_admin' ||
    role === 'admin'
  );
}
