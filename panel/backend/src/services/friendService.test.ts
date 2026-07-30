// ============================================================================
// friendService.test.ts — 好友系统服务单元测试
// 覆盖：v4.36.0-D8 listRecommendations（同实例已绑定玩家推荐）
//   - 同实例 verified 绑定用户被推荐（共同实例计数 + 实例名）
//   - 排除已是好友 / 待处理请求 / 已拉黑（任一方向）
//   - 排除非 verified 绑定与非 instance scope
//   - 我无 verified 绑定时返回空
//   - 排序：共同实例数降序 → 用户名升序
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import type { Logger } from 'pino';
import { FriendService } from './friendService.js';

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

function createStubLogger(): Logger {
  const noop = (): void => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createStubLogger(),
  } as unknown as Logger;
}

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await db.schema.createTable('users', (table) => {
    table.string('id').primary();
    table.string('username').notNullable();
    table.integer('vip_level').notNullable().defaultTo(0);
    table.text('last_login_at').nullable();
    table.string('status').notNullable().defaultTo('active');
  });

  await db.schema.createTable('servers', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
  });

  await db.schema.createTable('friendships', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('friend_user_id').notNullable();
    table.string('status').notNullable();
    table.text('created_at').notNullable();
    table.text('accepted_at').nullable();
  });

  // bindings 表（v4.17.0 统一绑定，与 db-helper.ts schema 对齐）
  await db.schema.createTable('bindings', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('binding_type').notNullable(); // 'account' | 'player'
    table.string('scope_type').notNullable(); // 'instance' | 'game_type' | 'global'
    table.string('scope_ref').notNullable();
    table.string('player_name').nullable();
    table.integer('vip_level').notNullable().defaultTo(0);
    table.string('wallet_id').nullable();
    table.string('verify_status').notNullable().defaultTo('pending');
    table.string('verify_code').nullable();
    table.text('verify_expires_at').nullable();
    table.text('verified_at').nullable();
    table.text('metadata').nullable();
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  return db;
}

const NOW = '2026-07-30T00:00:00.000Z';

async function insertUser(db: Knex, id: string, username: string): Promise<void> {
  await db('users').insert({ id, username });
}

async function insertServer(db: Knex, id: string, name: string): Promise<void> {
  await db('servers').insert({ id, name });
}

interface BindingSeed {
  id: string;
  user_id: string;
  scope_ref: string;
  binding_type?: string;
  scope_type?: string;
  verify_status?: string;
}

async function insertBinding(db: Knex, seed: BindingSeed): Promise<void> {
  await db('bindings').insert({
    id: seed.id,
    user_id: seed.user_id,
    binding_type: seed.binding_type ?? 'player',
    scope_type: seed.scope_type ?? 'instance',
    scope_ref: seed.scope_ref,
    verify_status: seed.verify_status ?? 'verified',
    created_at: NOW,
    updated_at: NOW,
  });
}

async function insertFriendship(
  db: Knex,
  id: string,
  userId: string,
  friendUserId: string,
  status: 'pending' | 'accepted' | 'blocked',
): Promise<void> {
  await db('friendships').insert({
    id,
    user_id: userId,
    friend_user_id: friendUserId,
    status,
    created_at: NOW,
    accepted_at: status === 'accepted' ? NOW : null,
  });
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('FriendService.listRecommendations（v4.36.0-D8）', () => {
  let db: Knex;
  let service: FriendService;

  beforeEach(async () => {
    db = await createTestDb();
    service = new FriendService(db, createStubLogger());

    await insertUser(db, 'me', '我自己');
    await insertUser(db, 'u-alice', 'alice');
    await insertUser(db, 'u-bob', 'bob');
    await insertUser(db, 'u-carol', 'carol');
    await insertUser(db, 'u-dave', 'dave');
    await insertServer(db, 'srv-1', ' survival 一号');
    await insertServer(db, 'srv-2', 'creative 二号');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('推荐同实例 verified 绑定用户，含共同实例计数与实例名', async () => {
    // 我绑定 srv-1 / srv-2
    await insertBinding(db, { id: 'b-me-1', user_id: 'me', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-me-2', user_id: 'me', scope_ref: 'srv-2' });
    // alice 同绑 srv-1 + srv-2（2 个共同实例）
    await insertBinding(db, { id: 'b-al-1', user_id: 'u-alice', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-al-2', user_id: 'u-alice', scope_ref: 'srv-2' });
    // bob 仅 srv-1（1 个共同实例）
    await insertBinding(db, { id: 'b-bo-1', user_id: 'u-bob', scope_ref: 'srv-1' });

    const recs = await service.listRecommendations('me');

    expect(recs).toHaveLength(2);
    // 按共同实例数降序：alice 在前
    expect(recs[0].user_id).toBe('u-alice');
    expect(recs[0].shared_instance_count).toBe(2);
    expect(recs[0].shared_server_names).toEqual(['creative 二号', ' survival 一号'].sort());
    expect(recs[1].user_id).toBe('u-bob');
    expect(recs[1].shared_instance_count).toBe(1);
  });

  it('排除已是好友 / 待处理 / 已拉黑用户（任一方向）', async () => {
    await insertBinding(db, { id: 'b-me-1', user_id: 'me', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-al-1', user_id: 'u-alice', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-bo-1', user_id: 'u-bob', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-ca-1', user_id: 'u-carol', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-da-1', user_id: 'u-dave', scope_ref: 'srv-1' });

    // alice：已是好友（我→对方方向）
    await insertFriendship(db, 'f-1', 'me', 'u-alice', 'accepted');
    // bob：待处理请求（对方→我方向）
    await insertFriendship(db, 'f-2', 'u-bob', 'me', 'pending');
    // carol：已拉黑
    await insertFriendship(db, 'f-3', 'me', 'u-carol', 'blocked');
    // dave：无关系 → 唯一推荐

    const recs = await service.listRecommendations('me');
    expect(recs.map((r) => r.user_id)).toEqual(['u-dave']);
  });

  it('排除非 verified 绑定与非 instance scope', async () => {
    await insertBinding(db, { id: 'b-me-1', user_id: 'me', scope_ref: 'srv-1' });
    // alice：pending 绑定 → 不推荐
    await insertBinding(db, {
      id: 'b-al-1',
      user_id: 'u-alice',
      scope_ref: 'srv-1',
      verify_status: 'pending',
    });
    // bob：revoked 绑定 → 不推荐
    await insertBinding(db, {
      id: 'b-bo-1',
      user_id: 'u-bob',
      scope_ref: 'srv-1',
      verify_status: 'revoked',
    });
    // carol：game_type scope（跨实例全局，已废弃语义）→ 不推荐
    await insertBinding(db, {
      id: 'b-ca-1',
      user_id: 'u-carol',
      scope_ref: 'srv-1',
      scope_type: 'game_type',
    });
    // dave：account 类型绑定 → 不推荐
    await insertBinding(db, {
      id: 'b-da-1',
      user_id: 'u-dave',
      scope_ref: 'srv-1',
      binding_type: 'account',
    });

    const recs = await service.listRecommendations('me');
    expect(recs).toHaveLength(0);
  });

  it('我无 verified 实例绑定时返回空（短路）', async () => {
    // 我只有 pending 绑定
    await insertBinding(db, {
      id: 'b-me-1',
      user_id: 'me',
      scope_ref: 'srv-1',
      verify_status: 'pending',
    });
    await insertBinding(db, { id: 'b-al-1', user_id: 'u-alice', scope_ref: 'srv-1' });

    const recs = await service.listRecommendations('me');
    expect(recs).toEqual([]);
  });

  it('共同实例数相同时按用户名升序', async () => {
    await insertBinding(db, { id: 'b-me-1', user_id: 'me', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-bo-1', user_id: 'u-bob', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-al-1', user_id: 'u-alice', scope_ref: 'srv-1' });

    const recs = await service.listRecommendations('me');
    expect(recs.map((r) => r.username)).toEqual(['alice', 'bob']);
  });

  it('同一用户在同一实例的多条绑定只计 1 个共同实例', async () => {
    await insertBinding(db, { id: 'b-me-1', user_id: 'me', scope_ref: 'srv-1' });
    // alice 在 srv-1 绑了两个玩家角色
    await insertBinding(db, { id: 'b-al-1', user_id: 'u-alice', scope_ref: 'srv-1' });
    await insertBinding(db, { id: 'b-al-2', user_id: 'u-alice', scope_ref: 'srv-1' });

    const recs = await service.listRecommendations('me');
    expect(recs).toHaveLength(1);
    expect(recs[0].shared_instance_count).toBe(1);
  });
});
