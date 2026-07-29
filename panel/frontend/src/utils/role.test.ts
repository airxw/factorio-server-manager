// ============================================================================
// role.ts 工具单测 — 角色判断函数
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { UserInfo } from '@public/schema/panel-api-types';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from './role';

describe('getEffectiveRole', () => {
  it('优先返回 active_role', () => {
    expect(getEffectiveRole({ role: 'instance_admin', active_role: 'user' } as Pick<UserInfo, 'role' | 'active_role'>)).toBe('user');
  });

  it('active_role 缺失时回退到 role', () => {
    expect(getEffectiveRole({ role: 'instance_admin' } as Pick<UserInfo, 'role' | 'active_role'>)).toBe('instance_admin');
  });

  it('user 为空时返回 null', () => {
    expect(getEffectiveRole(null)).toBeNull();
  });
});

describe('isAdminRole', () => {
  it('server_admin 返回 true', () => {
    expect(isAdminRole('server_admin')).toBe(true);
  });

  it('system_admin 返回 true', () => {
    expect(isAdminRole('system_admin')).toBe(true);
  });

  it('admin 返回 true', () => {
    expect(isAdminRole('admin')).toBe(true);
  });

  it('instance_admin 返回 false', () => {
    expect(isAdminRole('instance_admin')).toBe(false);
  });

  it('普通用户角色返回 false', () => {
    expect(isAdminRole('user')).toBe(false);
  });

  it('undefined 返回 false', () => {
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('null 返回 false', () => {
    expect(isAdminRole(null)).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isAdminRole('')).toBe(false);
  });
});

describe('isInstanceAdminOrAbove', () => {
  it('instance_admin 返回 true', () => {
    expect(isInstanceAdminOrAbove('instance_admin')).toBe(true);
  });

  it('server_admin 返回 true', () => {
    expect(isInstanceAdminOrAbove('server_admin')).toBe(true);
  });

  it('system_admin 返回 true', () => {
    expect(isInstanceAdminOrAbove('system_admin')).toBe(true);
  });

  it('admin 返回 true', () => {
    expect(isInstanceAdminOrAbove('admin')).toBe(true);
  });

  it('普通用户角色返回 false', () => {
    expect(isInstanceAdminOrAbove('user')).toBe(false);
  });

  it('undefined 返回 false', () => {
    expect(isInstanceAdminOrAbove(undefined)).toBe(false);
  });

  it('null 返回 false', () => {
    expect(isInstanceAdminOrAbove(null)).toBe(false);
  });
});
