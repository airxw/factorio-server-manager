// ============================================================================
// roles.test.ts — 多角色工具函数单元测试
// 覆盖：normalizeRole / normalizeRoles / hasRole / hasAnyRole / hasRoleLevelAny
//       resolveActiveRole / toContractUserRoles
//
// 纯函数测试，无 DB 依赖。
// 来源：v4.17.0 B7 阶段鉴权链路单元测试
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  Role,
  ROLE_LEVEL,
  normalizeRole,
  normalizeRoles,
  hasRole,
  hasAnyRole,
  hasRoleLevelAny,
  resolveActiveRole,
  toContractUserRole,
  toContractUserRoles,
  isValidRole,
  hasRoleLevel,
  universalRolesFor,
} from './roles.js';

// ---------------------------------------------------------------------------
// normalizeRole
// ---------------------------------------------------------------------------

describe('normalizeRole', () => {
  it('原样返回新 3 级角色值', () => {
    expect(normalizeRole('server_admin')).toBe(Role.SERVER_ADMIN);
    expect(normalizeRole('instance_admin')).toBe(Role.INSTANCE_ADMIN);
    expect(normalizeRole('user')).toBe(Role.USER);
  });

  it('兼容旧 4 级角色值', () => {
    expect(normalizeRole('system_admin')).toBe(Role.SERVER_ADMIN);
    expect(normalizeRole('admin')).toBe(Role.INSTANCE_ADMIN);
    expect(normalizeRole('operator')).toBe(Role.USER);
    expect(normalizeRole('viewer')).toBe(Role.USER);
  });

  it('未知值降级为 user（最低权限原则）', () => {
    expect(normalizeRole('unknown')).toBe(Role.USER);
    expect(normalizeRole('')).toBe(Role.USER);
    expect(normalizeRole('ROOT')).toBe(Role.USER); // 大小写敏感
  });
});

// ---------------------------------------------------------------------------
// normalizeRoles
// ---------------------------------------------------------------------------

describe('normalizeRoles', () => {
  it('Role[] 输入：逐项归一化 + 去重', () => {
    expect(normalizeRoles(['server_admin', 'user'])).toEqual([Role.SERVER_ADMIN, Role.USER]);
    expect(normalizeRoles(['server_admin', 'server_admin'])).toEqual([Role.SERVER_ADMIN]);
    expect(normalizeRoles(['admin', 'instance_admin'])).toEqual([Role.INSTANCE_ADMIN]); // 旧值+新值去重
  });

  it('string 输入（单值，向后兼容）', () => {
    expect(normalizeRoles('server_admin')).toEqual([Role.SERVER_ADMIN]);
    expect(normalizeRoles('admin')).toEqual([Role.INSTANCE_ADMIN]);
    expect(normalizeRoles('unknown')).toEqual([Role.USER]);
  });

  it('JSON 字符串输入（来自 DB users.roles 字段）', () => {
    expect(normalizeRoles('["server_admin","user"]')).toEqual([Role.SERVER_ADMIN, Role.USER]);
    expect(normalizeRoles('["admin","operator"]')).toEqual([Role.INSTANCE_ADMIN, Role.USER]);
    expect(normalizeRoles('[]')).toEqual([Role.USER]); // 空数组降级
  });

  it('JSON 字符串解析失败时降级为 [USER]', () => {
    expect(normalizeRoles('[invalid json')).toEqual([Role.USER]);
  });

  it('null / undefined 输入降级为 [USER]', () => {
    expect(normalizeRoles(null)).toEqual([Role.USER]);
    expect(normalizeRoles(undefined)).toEqual([Role.USER]);
  });

  it('空数组输入降级为 [USER]', () => {
    expect(normalizeRoles([])).toEqual([Role.USER]);
  });

  it('非 string / 非数组 输入降级为 [USER]', () => {
    expect(normalizeRoles(123)).toEqual([Role.USER]);
    expect(normalizeRoles({})).toEqual([Role.USER]);
    expect(normalizeRoles({ role: 'server_admin' })).toEqual([Role.USER]);
  });

  it('数组含非 string 元素：跳过非 string 项', () => {
    expect(normalizeRoles(['server_admin', 123, null, 'user'])).toEqual([Role.SERVER_ADMIN, Role.USER]);
  });

  it('数组全为非 string 元素降级为 [USER]', () => {
    expect(normalizeRoles([123, null, {}])).toEqual([Role.USER]);
  });

  it('保留输入顺序（不排序）', () => {
    expect(normalizeRoles(['user', 'server_admin', 'instance_admin']))
      .toEqual([Role.USER, Role.SERVER_ADMIN, Role.INSTANCE_ADMIN]);
  });
});

// ---------------------------------------------------------------------------
// hasRole / hasAnyRole
// ---------------------------------------------------------------------------

describe('hasRole', () => {
  it('角色集合包含目标角色返回 true', () => {
    expect(hasRole([Role.SERVER_ADMIN, Role.USER], Role.SERVER_ADMIN)).toBe(true);
    expect(hasRole([Role.SERVER_ADMIN, Role.USER], Role.USER)).toBe(true);
  });

  it('角色集合不包含目标角色返回 false', () => {
    expect(hasRole([Role.USER], Role.SERVER_ADMIN)).toBe(false);
    expect(hasRole([Role.INSTANCE_ADMIN], Role.SERVER_ADMIN)).toBe(false);
  });

  it('空集合返回 false', () => {
    expect(hasRole([], Role.USER)).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('OR 语义：任一匹配即 true', () => {
    expect(hasAnyRole([Role.USER], [Role.SERVER_ADMIN, Role.USER])).toBe(true);
    expect(hasAnyRole([Role.INSTANCE_ADMIN], [Role.SERVER_ADMIN, Role.INSTANCE_ADMIN])).toBe(true);
  });

  it('全部不匹配返回 false', () => {
    expect(hasAnyRole([Role.USER], [Role.SERVER_ADMIN, Role.INSTANCE_ADMIN])).toBe(false);
  });

  it('空 requiredRoles 返回 false', () => {
    expect(hasAnyRole([Role.USER], [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRoleLevel / hasRoleLevelAny
// ---------------------------------------------------------------------------

describe('hasRoleLevel', () => {
  it('等级 >= 目标返回 true', () => {
    expect(hasRoleLevel(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN)).toBe(true);
    expect(hasRoleLevel(Role.SERVER_ADMIN, Role.USER)).toBe(true);
    expect(hasRoleLevel(Role.INSTANCE_ADMIN, Role.INSTANCE_ADMIN)).toBe(true);
    expect(hasRoleLevel(Role.USER, Role.USER)).toBe(true);
  });

  it('等级 < 目标返回 false', () => {
    expect(hasRoleLevel(Role.USER, Role.INSTANCE_ADMIN)).toBe(false);
    expect(hasRoleLevel(Role.USER, Role.SERVER_ADMIN)).toBe(false);
    expect(hasRoleLevel(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN)).toBe(false);
  });
});

describe('hasRoleLevelAny', () => {
  it('取用户最高角色等级比较', () => {
    expect(hasRoleLevelAny([Role.USER, Role.SERVER_ADMIN], Role.INSTANCE_ADMIN)).toBe(true);
    expect(hasRoleLevelAny([Role.USER, Role.INSTANCE_ADMIN], Role.SERVER_ADMIN)).toBe(false);
    expect(hasRoleLevelAny([Role.USER], Role.USER)).toBe(true);
  });

  it('空集合返回 false（Math.max(...[]) = -Infinity）', () => {
    expect(hasRoleLevelAny([], Role.USER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveActiveRole
// ---------------------------------------------------------------------------

describe('resolveActiveRole', () => {
  it('合法 activeRole 且 ∈ roles：原样返回', () => {
    expect(resolveActiveRole('server_admin', [Role.SERVER_ADMIN, Role.USER])).toBe(Role.SERVER_ADMIN);
    expect(resolveActiveRole('user', [Role.SERVER_ADMIN, Role.USER])).toBe(Role.USER);
  });

  it('activeRole 不在 roles 中：降级到 roles[0]', () => {
    expect(resolveActiveRole('server_admin', [Role.USER])).toBe(Role.USER);
    expect(resolveActiveRole('instance_admin', [Role.SERVER_ADMIN, Role.USER])).toBe(Role.SERVER_ADMIN);
  });

  it('旧值 activeRole 经 normalizeRole 归一化后匹配', () => {
    expect(resolveActiveRole('admin', [Role.INSTANCE_ADMIN, Role.USER])).toBe(Role.INSTANCE_ADMIN);
    expect(resolveActiveRole('system_admin', [Role.SERVER_ADMIN, Role.USER])).toBe(Role.SERVER_ADMIN);
  });

  it('activeRole 为 undefined / null：降级到 roles[0]', () => {
    expect(resolveActiveRole(undefined, [Role.SERVER_ADMIN, Role.USER])).toBe(Role.SERVER_ADMIN);
    expect(resolveActiveRole(null, [Role.USER])).toBe(Role.USER);
  });

  it('activeRole 为非 string 类型：降级到 roles[0]', () => {
    expect(resolveActiveRole(123, [Role.USER])).toBe(Role.USER);
    expect(resolveActiveRole({}, [Role.INSTANCE_ADMIN])).toBe(Role.INSTANCE_ADMIN);
  });

  it('roles 为空数组：降级到 Role.USER', () => {
    expect(resolveActiveRole('server_admin', [])).toBe(Role.USER);
    expect(resolveActiveRole(undefined, [])).toBe(Role.USER);
  });
});

// ---------------------------------------------------------------------------
// toContractUserRole / toContractUserRoles
// ---------------------------------------------------------------------------

describe('toContractUserRole', () => {
  it('内部 Role 直传为契约 UserRole', () => {
    expect(toContractUserRole(Role.SERVER_ADMIN)).toBe('server_admin');
    expect(toContractUserRole(Role.INSTANCE_ADMIN)).toBe('instance_admin');
    expect(toContractUserRole(Role.USER)).toBe('user');
  });
});

describe('toContractUserRoles', () => {
  it('Role[] 映射为 UserRole[]', () => {
    expect(toContractUserRoles([Role.SERVER_ADMIN, Role.USER]))
      .toEqual(['server_admin', 'user']);
    expect(toContractUserRoles([Role.INSTANCE_ADMIN]))
      .toEqual(['instance_admin']);
  });

  it('空数组返回空数组', () => {
    expect(toContractUserRoles([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidRole / ROLE_LEVEL
// ---------------------------------------------------------------------------

describe('isValidRole', () => {
  it('合法角色返回 true', () => {
    expect(isValidRole('server_admin')).toBe(true);
    expect(isValidRole('instance_admin')).toBe(true);
    expect(isValidRole('user')).toBe(true);
  });

  it('非法角色返回 false', () => {
    expect(isValidRole('admin')).toBe(false); // 旧值不算合法
    expect(isValidRole('system_admin')).toBe(false);
    expect(isValidRole('unknown')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });
});

describe('ROLE_LEVEL', () => {
  it('server_admin > instance_admin > user', () => {
    expect(ROLE_LEVEL.server_admin).toBeGreaterThan(ROLE_LEVEL.instance_admin);
    expect(ROLE_LEVEL.instance_admin).toBeGreaterThan(ROLE_LEVEL.user);
  });
});

// ---------------------------------------------------------------------------
// universalRolesFor（v4.28.0 全员服主）
// ---------------------------------------------------------------------------

describe('universalRolesFor', () => {
  it('USER → [user, instance_admin]（玩家即服主全集合）', () => {
    expect(universalRolesFor(Role.USER)).toEqual([Role.USER, Role.INSTANCE_ADMIN]);
  });

  it('INSTANCE_ADMIN → [instance_admin, user]（保持主角色在前）', () => {
    expect(universalRolesFor(Role.INSTANCE_ADMIN)).toEqual([Role.INSTANCE_ADMIN, Role.USER]);
  });

  it('SERVER_ADMIN → [server_admin, instance_admin, user]（三级全集合）', () => {
    expect(universalRolesFor(Role.SERVER_ADMIN)).toEqual([
      Role.SERVER_ADMIN,
      Role.INSTANCE_ADMIN,
      Role.USER,
    ]);
  });

  it('未知输入按 USER 处理（default 分支）', () => {
    expect(universalRolesFor('unknown' as Role)).toEqual([Role.USER, Role.INSTANCE_ADMIN]);
  });

  it('返回集合元素唯一且至少包含 user + instance_admin（v4.28.0 不变量）', () => {
    for (const primary of [Role.USER, Role.INSTANCE_ADMIN, Role.SERVER_ADMIN]) {
      const roles = universalRolesFor(primary);
      expect(new Set(roles).size).toBe(roles.length);
      expect(roles).toContain(Role.USER);
      expect(roles).toContain(Role.INSTANCE_ADMIN);
    }
  });
});
