// ============================================================================
// permissions.test.ts — 权限点矩阵单元测试
// 覆盖：hasPermission / hasPermissionAny（旧硬编码版） + hasPermissionPoint /
//       hasAnyPermissionPoint / roleHasPermissionPoint / listPermissionPointsByRole（v4.17.0 DB 驱动）
//
// 来源：v4.17.0 B7 阶段鉴权链路单元测试
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import {
  Role,
  hasRoleLevel,
} from './roles.js';
import {
  hasPermission,
  hasPermissionAny,
  hasPermissionPoint,
  hasAnyPermissionPoint,
  roleHasPermissionPoint,
  listPermissionPointsByRole,
  canAccessInstance,
  canAccessInstanceAny,
  type Permission,
} from './permissions.js';

// ---------------------------------------------------------------------------
// 测试用 DB 工厂（仅 role_permission_templates 表）
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('role_permission_templates', (table) => {
    table.string('id').primary();
    table.string('role').notNullable();
    table.string('permission_code').notNullable();
    table.text('created_at').notNullable();
    table.unique(['role', 'permission_code'], 'idx_role_perm_unique');
  });
  return db;
}

async function destroyTestDb(db: Knex): Promise<void> {
  await db.destroy();
}

async function grantPermission(
  db: Knex,
  role: Role,
  permissionCode: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db('role_permission_templates').insert({
    id: `${role}:${permissionCode}`,
    role,
    permission_code: permissionCode,
    created_at: now,
  });
}

// ---------------------------------------------------------------------------
// 旧硬编码版 hasPermission / hasPermissionAny
// ---------------------------------------------------------------------------

describe('hasPermission (旧硬编码版)', () => {
  it('server_admin 拥有全部权限', () => {
    expect(hasPermission(Role.SERVER_ADMIN, 'user:manage' as Permission)).toBe(true);
    expect(hasPermission(Role.SERVER_ADMIN, 'server:read' as Permission)).toBe(true);
    expect(hasPermission(Role.SERVER_ADMIN, 'shop:purchase' as Permission)).toBe(true);
  });

  it('instance_admin 拥有实例操作 + 消费操作，无底座操作', () => {
    expect(hasPermission(Role.INSTANCE_ADMIN, 'server:read' as Permission)).toBe(true);
    expect(hasPermission(Role.INSTANCE_ADMIN, 'shop:manage' as Permission)).toBe(true);
    expect(hasPermission(Role.INSTANCE_ADMIN, 'shop:purchase' as Permission)).toBe(true);
    expect(hasPermission(Role.INSTANCE_ADMIN, 'user:manage' as Permission)).toBe(false);
    expect(hasPermission(Role.INSTANCE_ADMIN, 'pack:manage' as Permission)).toBe(false);
  });

  it('user 仅拥有消费操作', () => {
    expect(hasPermission(Role.USER, 'shop:purchase' as Permission)).toBe(true);
    expect(hasPermission(Role.USER, 'cdk:redeem' as Permission)).toBe(true);
    expect(hasPermission(Role.USER, 'vote:participate' as Permission)).toBe(true);
    expect(hasPermission(Role.USER, 'server:read' as Permission)).toBe(false);
    expect(hasPermission(Role.USER, 'user:manage' as Permission)).toBe(false);
  });
});

describe('hasPermissionAny (多角色版本)', () => {
  it('任一角色达到权限等级即通过', () => {
    expect(hasPermissionAny([Role.USER, Role.SERVER_ADMIN], 'user:manage' as Permission)).toBe(true);
    expect(hasPermissionAny([Role.USER, Role.INSTANCE_ADMIN], 'server:read' as Permission)).toBe(true);
  });

  it('全部角色未达权限等级拒绝', () => {
    expect(hasPermissionAny([Role.USER, Role.INSTANCE_ADMIN], 'user:manage' as Permission)).toBe(false);
  });

  it('空角色集合拒绝', () => {
    expect(hasPermissionAny([], 'shop:purchase' as Permission)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v4.17.0 DB 驱动版 hasPermissionPoint / hasAnyPermissionPoint
// ---------------------------------------------------------------------------

describe('hasPermissionPoint (v4.17.0 DB 驱动)', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    // 模拟权限模板：server_admin 拥有全部，instance_admin 拥有实例域，user 拥有消费域
    await grantPermission(db, Role.SERVER_ADMIN, 'user.manage');
    await grantPermission(db, Role.SERVER_ADMIN, 'instance.create');
    await grantPermission(db, Role.SERVER_ADMIN, 'binding.verify');
    await grantPermission(db, Role.INSTANCE_ADMIN, 'instance.create');
    await grantPermission(db, Role.INSTANCE_ADMIN, 'shop.manage');
    await grantPermission(db, Role.USER, 'shop.purchase');
    await grantPermission(db, Role.USER, 'cdk.redeem');
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('单角色命中权限点返回 true', async () => {
    expect(await hasPermissionPoint(db, [Role.SERVER_ADMIN], 'user.manage')).toBe(true);
    expect(await hasPermissionPoint(db, [Role.INSTANCE_ADMIN], 'instance.create')).toBe(true);
    expect(await hasPermissionPoint(db, [Role.USER], 'shop.purchase')).toBe(true);
  });

  it('单角色未命中权限点返回 false', async () => {
    expect(await hasPermissionPoint(db, [Role.USER], 'user.manage')).toBe(false);
    expect(await hasPermissionPoint(db, [Role.INSTANCE_ADMIN], 'binding.verify')).toBe(false);
  });

  it('多角色场景：任一角色命中即通过', async () => {
    expect(await hasPermissionPoint(db, [Role.USER, Role.INSTANCE_ADMIN], 'shop.manage')).toBe(true);
    expect(await hasPermissionPoint(db, [Role.USER, Role.INSTANCE_ADMIN], 'shop.purchase')).toBe(true);
    expect(await hasPermissionPoint(db, [Role.USER, Role.INSTANCE_ADMIN], 'user.manage')).toBe(false);
  });

  it('空角色集合返回 false', async () => {
    expect(await hasPermissionPoint(db, [], 'shop.purchase')).toBe(false);
  });

  it('DB 表不存在时降级返回 false（fail-close）', async () => {
    await destroyTestDb(db);
    // 重新创建空 DB（无 role_permission_templates 表）
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    expect(await hasPermissionPoint(db, [Role.SERVER_ADMIN], 'user.manage')).toBe(false);
  });
});

describe('hasAnyPermissionPoint (OR 语义)', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await grantPermission(db, Role.USER, 'shop.purchase');
    await grantPermission(db, Role.INSTANCE_ADMIN, 'shop.manage');
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('任一权限点命中即通过', async () => {
    expect(await hasAnyPermissionPoint(db, [Role.USER], ['shop.purchase', 'shop.manage'])).toBe(true);
    expect(await hasAnyPermissionPoint(db, [Role.INSTANCE_ADMIN], ['shop.purchase', 'shop.manage'])).toBe(true);
  });

  it('全部权限点未命中返回 false', async () => {
    expect(await hasAnyPermissionPoint(db, [Role.USER], ['shop.manage', 'user.manage'])).toBe(false);
  });

  it('空权限点列表返回 false', async () => {
    expect(await hasAnyPermissionPoint(db, [Role.USER], [])).toBe(false);
  });

  it('空角色集合返回 false', async () => {
    expect(await hasAnyPermissionPoint(db, [], ['shop.purchase'])).toBe(false);
  });
});

describe('roleHasPermissionPoint', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await grantPermission(db, Role.SERVER_ADMIN, 'user.manage');
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('角色拥有权限点返回 true', async () => {
    expect(await roleHasPermissionPoint(db, Role.SERVER_ADMIN, 'user.manage')).toBe(true);
  });

  it('角色未拥有权限点返回 false', async () => {
    expect(await roleHasPermissionPoint(db, Role.USER, 'user.manage')).toBe(false);
  });

  it('DB 表不存在时降级返回 false', async () => {
    await destroyTestDb(db);
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    expect(await roleHasPermissionPoint(db, Role.SERVER_ADMIN, 'user.manage')).toBe(false);
  });
});

describe('listPermissionPointsByRole', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await grantPermission(db, Role.INSTANCE_ADMIN, 'instance.create');
    await grantPermission(db, Role.INSTANCE_ADMIN, 'shop.manage');
    await grantPermission(db, Role.INSTANCE_ADMIN, 'cdk.manage');
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('列出角色的全部权限点', async () => {
    const perms = await listPermissionPointsByRole(db, Role.INSTANCE_ADMIN);
    expect(perms).toHaveLength(3);
    expect(perms).toContain('instance.create');
    expect(perms).toContain('shop.manage');
    expect(perms).toContain('cdk.manage');
  });

  it('无权限点的角色返回空数组', async () => {
    const perms = await listPermissionPointsByRole(db, Role.USER);
    expect(perms).toEqual([]);
  });

  it('DB 表不存在时返回空数组', async () => {
    await destroyTestDb(db);
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const perms = await listPermissionPointsByRole(db, Role.SERVER_ADMIN);
    expect(perms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// canAccessInstance / canAccessInstanceAny（纯函数）
// ---------------------------------------------------------------------------

describe('canAccessInstance (纯函数)', () => {
  it('server_admin 访问任意实例返回 true', () => {
    expect(canAccessInstance(Role.SERVER_ADMIN, 'user-1', 'owner-2')).toBe(true);
    expect(canAccessInstance(Role.SERVER_ADMIN, 'user-1', 'user-1')).toBe(true);
  });

  it('instance_admin + owner 匹配返回 true', () => {
    expect(canAccessInstance(Role.INSTANCE_ADMIN, 'user-1', 'user-1')).toBe(true);
  });

  it('instance_admin + owner 不匹配返回 false', () => {
    expect(canAccessInstance(Role.INSTANCE_ADMIN, 'user-1', 'user-2')).toBe(false);
  });

  it('user 一律返回 false（绑定访问由中间件 requireInstanceAccess 查表落地）', () => {
    expect(canAccessInstance(Role.USER, 'user-1', 'user-1')).toBe(false);
    expect(canAccessInstance(Role.USER, 'user-1', 'user-2')).toBe(false);
  });
});

describe('canAccessInstanceAny (多角色版本)', () => {
  it('任一角色能访问即通过', () => {
    expect(canAccessInstanceAny([Role.USER, Role.INSTANCE_ADMIN], 'user-1', 'user-1')).toBe(true);
    expect(canAccessInstanceAny([Role.USER, Role.SERVER_ADMIN], 'user-1', 'user-2')).toBe(true);
  });

  it('全部角色不能访问返回 false', () => {
    expect(canAccessInstanceAny([Role.USER, Role.INSTANCE_ADMIN], 'user-1', 'user-2')).toBe(false);
  });

  it('空角色集合返回 false', () => {
    expect(canAccessInstanceAny([], 'user-1', 'user-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRoleLevel 辅助测试（确认导入正确）
// ---------------------------------------------------------------------------

describe('hasRoleLevel 辅助导入', () => {
  it('从 roles 模块正确导入', () => {
    expect(hasRoleLevel(Role.SERVER_ADMIN, Role.USER)).toBe(true);
    expect(hasRoleLevel(Role.USER, Role.SERVER_ADMIN)).toBe(false);
  });
});
