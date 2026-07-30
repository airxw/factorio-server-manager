// ============================================================================
// 20260902000000_revoke_account_only_bindings.test.ts
// v4.38.0: 强制游戏角色绑定才能获得 VIP — 迁移脚本单元测试（spec 决策 2）
//
// 覆盖：
//   1. 仅账户绑定（无 verified player 绑定）→ revoked + vip_level=0
//   2. 账户绑定 + verified player 绑定 → 保留 verified + vip_level 不变
//   3. 已 revoked 的账户绑定 → 不重复处理（幂等）
//   4. player 绑定不受影响
//   5. bindings 表不存在时跳过（全新部署）
//   6. down() 不抛错（声明式不回滚）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { up, down } from '../migrations/20260902000000_revoke_account_only_bindings.js';

async function createTestDb(withBindingsTable = true): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  if (withBindingsTable) {
    await db.schema.createTable('bindings', (table) => {
      table.increments('id').primary();
      table.string('user_id').notNullable();
      table.string('binding_type').notNullable();
      table.string('scope_type').notNullable();
      table.string('scope_ref').nullable();
      table.string('player_name').nullable();
      table.integer('vip_level').notNullable().defaultTo(0);
      table.string('wallet_id').nullable();
      table.string('verify_status').notNullable();
      table.string('verify_code').nullable();
      table.string('verify_expires_at').nullable();
      table.string('verified_at').nullable();
      table.text('metadata').nullable().defaultTo('');
      table.string('created_at').notNullable();
      table.string('updated_at').notNullable();
    });
  }

  return db;
}

async function insertBinding(
  db: Knex,
  overrides: {
    user_id: string;
    binding_type: 'account' | 'player';
    scope_ref: string;
    verify_status?: string;
    vip_level?: number;
    player_name?: string | null;
    metadata?: string;
  },
): Promise<number> {
  const now = new Date().toISOString();
  const [id] = await db('bindings').insert({
    user_id: overrides.user_id,
    binding_type: overrides.binding_type,
    scope_type: 'instance',
    scope_ref: overrides.scope_ref,
    player_name: overrides.player_name ?? null,
    vip_level: overrides.vip_level ?? 0,
    wallet_id: null,
    verify_status: overrides.verify_status ?? 'verified',
    verify_code: null,
    verify_expires_at: null,
    verified_at: now,
    metadata: overrides.metadata ?? JSON.stringify({ source: 'test' }),
    created_at: now,
    updated_at: now,
  });
  return id;
}

async function getBinding(db: Knex, id: number) {
  return db('bindings').where({ id }).first();
}

describe('migration 20260902000000_revoke_account_only_bindings', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('仅账户绑定（无 verified player 绑定）→ revoked + vip_level=0', async () => {
    const id = await insertBinding(db, {
      user_id: 'u1',
      binding_type: 'account',
      scope_ref: 'srv-1',
      verify_status: 'verified',
      vip_level: 1,
    });

    await up(db);

    const row = await getBinding(db, id);
    expect(row.verify_status).toBe('revoked');
    expect(row.vip_level).toBe(0);
    const meta = JSON.parse(row.metadata);
    expect(meta.source).toBe('migration_revoke_account_only');
    expect(meta.unbound_at).toBeTruthy();
  });

  it('账户绑定 + verified player 绑定 → 保留 verified + vip_level 不变', async () => {
    const accId = await insertBinding(db, {
      user_id: 'u2',
      binding_type: 'account',
      scope_ref: 'srv-2',
      verify_status: 'verified',
      vip_level: 1,
    });
    await insertBinding(db, {
      user_id: 'u2',
      binding_type: 'player',
      scope_ref: 'srv-2',
      verify_status: 'verified',
      vip_level: 0,
      player_name: 'Player2',
    });

    await up(db);

    const row = await getBinding(db, accId);
    expect(row.verify_status).toBe('verified');
    expect(row.vip_level).toBe(1); // 保留原值
  });

  it('已 revoked 的账户绑定 → 不重复处理（幂等）', async () => {
    const id = await insertBinding(db, {
      user_id: 'u3',
      binding_type: 'account',
      scope_ref: 'srv-3',
      verify_status: 'revoked',
      vip_level: 0,
      metadata: JSON.stringify({ source: 'manual_revoke', unbound_at: '2026-01-01T00:00:00.000Z' }),
    });

    await up(db);

    const row = await getBinding(db, id);
    // 已 revoked 不被再次处理（WHERE verify_status='verified' 不匹配）
    expect(row.verify_status).toBe('revoked');
    expect(row.vip_level).toBe(0);
    const meta = JSON.parse(row.metadata);
    // 原始 source 保留，未被覆盖
    expect(meta.source).toBe('manual_revoke');
  });

  it('player 绑定不受影响（即使无对应 account 绑定）', async () => {
    const playerId = await insertBinding(db, {
      user_id: 'u4',
      binding_type: 'player',
      scope_ref: 'srv-4',
      verify_status: 'verified',
      vip_level: 0,
      player_name: 'Player4',
    });

    await up(db);

    const row = await getBinding(db, playerId);
    expect(row.verify_status).toBe('verified');
    expect(row.binding_type).toBe('player');
  });

  it('pending player 绑定不保护 account 绑定（仅 verified player 保护）', async () => {
    // account 绑定 + player 绑定 pending（未验证）→ account 应被 revoke
    const accId = await insertBinding(db, {
      user_id: 'u5',
      binding_type: 'account',
      scope_ref: 'srv-5',
      verify_status: 'verified',
      vip_level: 1,
    });
    await insertBinding(db, {
      user_id: 'u5',
      binding_type: 'player',
      scope_ref: 'srv-5',
      verify_status: 'pending',
      vip_level: 0,
      player_name: 'Player5',
    });

    await up(db);

    const row = await getBinding(db, accId);
    // pending player 不算 verified → account 仍被 revoke
    expect(row.verify_status).toBe('revoked');
    expect(row.vip_level).toBe(0);
  });

  it('幂等：完整执行两次 up() 结果一致', async () => {
    const id = await insertBinding(db, {
      user_id: 'u6',
      binding_type: 'account',
      scope_ref: 'srv-6',
      verify_status: 'verified',
      vip_level: 1,
    });

    await up(db);
    const rowAfterFirst = await getBinding(db, id);
    expect(rowAfterFirst.verify_status).toBe('revoked');

    // 第二次执行：已 revoked 的记录不匹配 WHERE verify_status='verified'
    await up(db);
    const rowAfterSecond = await getBinding(db, id);
    expect(rowAfterSecond.verify_status).toBe('revoked');
    expect(rowAfterSecond.vip_level).toBe(0);
  });

  it('bindings 表不存在时跳过不抛错（全新部署）', async () => {
    const emptyDb = await createTestDb(false);
    await expect(up(emptyDb)).resolves.toBeUndefined();
    await emptyDb.destroy();
  });

  it('down() 不抛错（声明式不回滚）', async () => {
    await expect(down(db)).resolves.toBeUndefined();
  });
});
