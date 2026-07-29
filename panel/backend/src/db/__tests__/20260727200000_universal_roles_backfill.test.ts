// ============================================================================
// 20260727200000_universal_roles_backfill.test.ts
// v4.28.0: 全员服主存量用户 roles 补齐迁移脚本单元测试
//
// 覆盖：
//   1. ['user'] → ['user', 'instance_admin']
//   2. ['instance_admin'] → ['instance_admin', 'user']
//   3. ['server_admin'] → ['server_admin', 'instance_admin', 'user']
//   4. null / 坏 JSON → normalizeRoles 回退后补齐
//   5. 幂等：已补齐的行跳过（重复执行不重复更新）
//   6. active_role 不被修改
//   7. users 表不存在时跳过（全新部署）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import crypto from 'node:crypto';
import { up, down } from '../migrations/20260727200000_universal_roles_backfill.js';
import { Role } from '../../core/auth/roles.js';

async function createTestDb(withUsersTable = true): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  if (withUsersTable) {
    await db.schema.createTable('users', (table) => {
      table.string('id').primary();
      table.string('email').notNullable();
      table.text('roles').nullable().defaultTo(null);
      table.string('active_role').nullable().defaultTo(null);
    });
  }

  return db;
}

async function insertUser(
  db: Knex,
  overrides: { roles: string | null; active_role?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await db('users').insert({
    id,
    email: `u-${id}@test.local`,
    roles: overrides.roles,
    active_role: overrides.active_role ?? null,
  });
  return id;
}

async function getRoles(db: Knex, id: string): Promise<{ roles: string | null; active_role: string | null }> {
  return db('users').select('roles', 'active_role').where({ id }).first();
}

describe('migration 20260727200000_universal_roles_backfill', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("['user'] → ['user', 'instance_admin']", async () => {
    const id = await insertUser(db, { roles: JSON.stringify(['user']), active_role: 'user' });

    await up(db);

    const row = await getRoles(db, id);
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
    expect(row.active_role).toBe('user'); // 不变
  });

  it("['instance_admin'] → ['instance_admin', 'user']（保持原顺序）", async () => {
    const id = await insertUser(db, {
      roles: JSON.stringify(['instance_admin']),
      active_role: 'instance_admin',
    });

    await up(db);

    const row = await getRoles(db, id);
    expect(row.roles).toBe(JSON.stringify([Role.INSTANCE_ADMIN, Role.USER]));
    expect(row.active_role).toBe('instance_admin');
  });

  it("['server_admin'] → ['server_admin', 'instance_admin', 'user']", async () => {
    const id = await insertUser(db, {
      roles: JSON.stringify(['server_admin']),
      active_role: 'server_admin',
    });

    await up(db);

    const row = await getRoles(db, id);
    expect(row.roles).toBe(
      JSON.stringify([Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER]),
    );
    expect(row.active_role).toBe('server_admin');
  });

  it('roles=null → normalizeRoles 回退 [user] 后补齐为 [user, instance_admin]', async () => {
    const id = await insertUser(db, { roles: null, active_role: null });

    await up(db);

    const row = await getRoles(db, id);
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
  });

  it('坏 JSON roles → normalizeRoles 回退后补齐', async () => {
    const id = await insertUser(db, { roles: '{not-valid-json' });

    await up(db);

    const row = await getRoles(db, id);
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
  });

  it('幂等：已补齐的行跳过（第二次执行无变化）', async () => {
    const id = await insertUser(db, {
      roles: JSON.stringify(['user', 'instance_admin']),
      active_role: 'user',
    });

    await up(db);
    const afterFirst = await getRoles(db, id);

    await up(db);
    const afterSecond = await getRoles(db, id);

    expect(afterFirst.roles).toBe(afterSecond.roles);
    expect(afterSecond.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
  });

  it('幂等：完整执行两次 up() 结果一致', async () => {
    const id1 = await insertUser(db, { roles: JSON.stringify(['user']) });
    const id2 = await insertUser(db, { roles: JSON.stringify(['instance_admin']) });
    const id3 = await insertUser(db, { roles: JSON.stringify(['server_admin']) });

    await up(db);
    const first1 = await getRoles(db, id1);
    const first2 = await getRoles(db, id2);
    const first3 = await getRoles(db, id3);

    await up(db);
    expect(await getRoles(db, id1)).toEqual(first1);
    expect(await getRoles(db, id2)).toEqual(first2);
    expect(await getRoles(db, id3)).toEqual(first3);
  });

  it('users 表不存在时跳过不抛错（全新部署）', async () => {
    const emptyDb = await createTestDb(false);
    try {
      await expect(up(emptyDb)).resolves.toBeUndefined();
    } finally {
      await emptyDb.destroy();
    }
  });

  it('down() 不抛错（声明式不回滚）', async () => {
    await expect(down(db)).resolves.toBeUndefined();
  });
});
