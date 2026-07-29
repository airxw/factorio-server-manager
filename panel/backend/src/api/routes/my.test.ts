// ============================================================================
// my.test.ts — 玩家门户聚合路由单测（v4.15.0）
//
// 覆盖：
//   1. GET /api/my/orders — 跨实例聚合（联 servers 取实例名、联 shop_order_items 取明细）
//      - status=pending 过滤同时包含 claiming（领取中并入"待领取"）
//      - 仅返回当前用户订单（user_id 强制过滤）
//   2. GET /api/my/overview — 首页聚合概览
//      - 多实例钱包余额合计正确性（user_wallets 跨 server_id 求和）
//      - 今日已领取的钱包不计入 daily_claimable
//      - 未认证请求返回 401
//
// 测试表结构：与生产迁移列定义对齐（见各 createTable 注释来源）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb } from '../../test/db-helper.js';
import { mockLogger } from '../../test/mock-factory.js';
import { createMyRouter } from './my.js';

const TEST_USER_ID = 'user-player-001';
const OTHER_USER_ID = 'user-player-999';

/** 创建 my 路由依赖的 5 张表（列定义与生产迁移对齐，仅保留测试所需列） */
async function createMyTables(db: Knex): Promise<void> {
  // shop_orders：20260703000006_create_shop_tables + 20260715200000_add_economy_system(total_price)
  await db.schema.createTable('shop_orders', (table) => {
    table.increments('id').primary();
    table.string('server_id').notNullable();
    table.string('user_id').notNullable();
    table.string('status').notNullable().defaultTo('pending');
    table.string('claim_code').notNullable();
    table.integer('items_count').notNullable().defaultTo(0);
    table.integer('total_price').notNullable().defaultTo(0);
    table.text('claimed_at').nullable().defaultTo(null);
    table.text('expires_at').notNullable();
    table.string('claimed_player').nullable().defaultTo(null);
    table.text('created_at').notNullable();
  });

  // shop_order_items：20260703000006_create_shop_tables + 20260715200000_add_economy_system(price)
  await db.schema.createTable('shop_order_items', (table) => {
    table.increments('id').primary();
    table.integer('order_id').notNullable();
    table.string('item_name').notNullable();
    table.integer('count').notNullable();
    table.string('quality').notNullable().defaultTo('normal');
    table.integer('price').notNullable().defaultTo(0);
  });

  // v4.17.0: player_bindings 表已物理删除，统一到 bindings 表（由 db-helper.ts 创建）

  // user_notifications：20260716160000_create_user_notifications
  await db.schema.createTable('user_notifications', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable();
    table.string('type').notNullable();
    table.string('title').notNullable();
    table.text('content').defaultTo('');
    table.string('related_server_id').nullable();
    table.integer('related_order_id').nullable();
    table.integer('is_read').notNullable().defaultTo(0);
    table.string('created_at').notNullable();
  });

  // user_wallets：20260715200000_add_economy_system
  await db.schema.createTable('user_wallets', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable();
    table.string('server_id').notNullable();
    table.integer('balance').notNullable().defaultTo(0);
    table.integer('total_earned').notNullable().defaultTo(0);
    table.integer('total_spent').notNullable().defaultTo(0);
    table.text('last_daily_claim_at').nullable().defaultTo(null);
    table.text('last_daily_claim_date').nullable().defaultTo(null);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });
}

/** 注入 req.user（模拟 routes-registry 的 authenticateToken 结果） */
function injectUser(userId: string | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (userId) {
      (req as unknown as { user: { userId: string } }).user = { userId };
    }
    next();
  };
}

describe('MyRouter — /api/my/orders', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    await createMyTables(db);

    await db('servers').insert([
      {
        id: 'srv-a',
        name: '阿尔法服',
        pack_id: 'pack-1',
        game_type: 'minecraft',
        node_id: 'node-local',
        owner_user_id: 'owner-1',
        status: 'running',
        port: 25565,
        rcon_port: 25575,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'srv-b',
        name: '贝塔服',
        pack_id: 'pack-2',
        game_type: 'factorio',
        node_id: 'node-local',
        owner_user_id: 'owner-1',
        status: 'stopped',
        port: 34197,
        rcon_port: 34198,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    // 当前用户：srv-a 一条 pending 订单（2 物品）、srv-b 一条 claimed 订单
    await db('shop_orders').insert([
      {
        id: 1,
        server_id: 'srv-a',
        user_id: TEST_USER_ID,
        status: 'pending',
        claim_code: 'AAAA-1111',
        items_count: 2,
        total_price: 150,
        expires_at: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-20T10:00:00.000Z',
      },
      {
        id: 2,
        server_id: 'srv-b',
        user_id: TEST_USER_ID,
        status: 'claimed',
        claim_code: 'BBBB-2222',
        items_count: 1,
        total_price: 80,
        claimed_at: '2026-07-21T08:00:00.000Z',
        expires_at: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-19T10:00:00.000Z',
      },
      {
        id: 3,
        server_id: 'srv-a',
        user_id: TEST_USER_ID,
        status: 'claiming',
        claim_code: 'CCCC-3333',
        items_count: 1,
        total_price: 60,
        expires_at: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-21T10:00:00.000Z',
      },
      // 其他用户订单——不应出现在结果中
      {
        id: 4,
        server_id: 'srv-a',
        user_id: OTHER_USER_ID,
        status: 'pending',
        claim_code: 'DDDD-4444',
        items_count: 1,
        total_price: 999,
        expires_at: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-22T10:00:00.000Z',
      },
    ]);

    await db('shop_order_items').insert([
      { order_id: 1, item_name: 'diamond_sword', count: 1, quality: 'epic', price: 100 },
      { order_id: 1, item_name: 'bread', count: 5, quality: 'normal', price: 10 },
      { order_id: 2, item_name: 'iron-plate', count: 20, quality: 'normal', price: 4 },
      { order_id: 4, item_name: 'should_not_leak', count: 1, quality: 'normal', price: 999 },
    ]);

    app = express();
    app.use(express.json());
    app.use(injectUser(TEST_USER_ID));
    app.use('/api/my', createMyRouter(db, mockLogger() as never));
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('无 status 参数时返回当前用户全部订单（跨实例聚合实例名 + 物品明细，按 created_at 倒序）', async () => {
    const res = await request(app).get('/api/my/orders');
    expect(res.status).toBe(200);

    const orders = res.body.orders as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(3); // 不含 OTHER_USER_ID 的订单

    // created_at 倒序：id=3 (07-21) → id=1 (07-20) → id=2 (07-19)
    expect(orders[0]?.claim_code).toBe('CCCC-3333');
    expect(orders[1]?.claim_code).toBe('AAAA-1111');
    expect(orders[2]?.claim_code).toBe('BBBB-2222');

    // 跨实例实例名 JOIN 正确
    expect(orders[1]?.instance_name).toBe('阿尔法服');
    expect(orders[2]?.instance_name).toBe('贝塔服');

    // 物品明细聚合（id=1 订单 2 件物品）
    const orderA = orders[1] as { items: Array<Record<string, unknown>>; total_price: number };
    expect(orderA.items).toHaveLength(2);
    expect(orderA.items[0]?.item_name).toBe('diamond_sword');
    expect(orderA.items[0]?.price).toBe(100);
    expect(orderA.total_price).toBe(150);
  });

  it('status=pending 时同时包含 claiming（领取中并入"待领取"）', async () => {
    const res = await request(app).get('/api/my/orders?status=pending');
    expect(res.status).toBe(200);

    const orders = res.body.orders as Array<{ status: string }>;
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.status).sort()).toEqual(['claiming', 'pending']);
  });

  it('status=claimed 时仅返回已领取订单（含 claimed_at）', async () => {
    const res = await request(app).get('/api/my/orders?status=claimed');
    expect(res.status).toBe(200);

    const orders = res.body.orders as Array<{ status: string; claimed_at: string | null }>;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe('claimed');
    expect(orders[0]?.claimed_at).toBe('2026-07-21T08:00:00.000Z');
  });

  it('非法 status 参数降级为无过滤（返回全部）', async () => {
    const res = await request(app).get('/api/my/orders?status=hacked');
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(3);
  });

  it('未认证请求返回 401', async () => {
    const anonApp = express();
    anonApp.use(express.json());
    anonApp.use(injectUser(null));
    anonApp.use('/api/my', createMyRouter(db, mockLogger() as never));

    const res = await request(anonApp).get('/api/my/orders');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('PANEL_UNAUTHORIZED');
  });
});

describe('MyRouter — /api/my/overview', () => {
  let db: Knex;
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    await createMyTables(db);

    // 绑定：2 verified + 1 pending（v4.27.0: binding_type='player', scope_type='instance', scope_ref=server_id）
    await db('bindings').insert([
      {
        user_id: TEST_USER_ID,
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: 'srv-a',
        player_name: 'Steve',
        vip_level: 0,
        wallet_id: null,
        verify_status: 'verified',
        verify_code: 'V1',
        verify_expires_at: null,
        verified_at: '2026-07-01T00:00:00.000Z',
        metadata: '{}',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        user_id: TEST_USER_ID,
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: 'srv-b',
        player_name: 'Engineer',
        vip_level: 0,
        wallet_id: null,
        verify_status: 'verified',
        verify_code: 'V2',
        verify_expires_at: null,
        verified_at: '2026-07-01T00:00:00.000Z',
        metadata: '{}',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        user_id: TEST_USER_ID,
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: 'srv-c',
        player_name: 'Rusty',
        vip_level: 0,
        wallet_id: null,
        verify_status: 'pending',
        verify_code: 'V3',
        verify_expires_at: null,
        verified_at: null,
        metadata: '{}',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    // 通知：2 未读 + 1 已读
    await db('user_notifications').insert([
      { user_id: TEST_USER_ID, type: 'order', title: 'n1', is_read: 0, created_at: '2026-07-20T00:00:00.000Z' },
      { user_id: TEST_USER_ID, type: 'order', title: 'n2', is_read: 0, created_at: '2026-07-20T00:00:00.000Z' },
      { user_id: TEST_USER_ID, type: 'order', title: 'n3', is_read: 1, created_at: '2026-07-20T00:00:00.000Z' },
    ]);

    // 订单：1 pending + 1 claiming（计 2）+ 1 claimed（不计）
    await db('shop_orders').insert([
      { server_id: 'srv-x', user_id: TEST_USER_ID, status: 'pending', claim_code: 'P-1', items_count: 1, total_price: 10, expires_at: '2026-08-01T00:00:00.000Z', created_at: '2026-07-20T00:00:00.000Z' },
      { server_id: 'srv-x', user_id: TEST_USER_ID, status: 'claiming', claim_code: 'P-2', items_count: 1, total_price: 20, expires_at: '2026-08-01T00:00:00.000Z', created_at: '2026-07-20T00:00:00.000Z' },
      { server_id: 'srv-x', user_id: TEST_USER_ID, status: 'claimed', claim_code: 'P-3', items_count: 1, total_price: 30, expires_at: '2026-08-01T00:00:00.000Z', created_at: '2026-07-20T00:00:00.000Z' },
    ]);

    // 钱包：3 实例 100+250+50=400；1 个今日已领取 → daily_claimable=2
    const today = new Date().toISOString().slice(0, 10);
    await db('user_wallets').insert([
      { user_id: TEST_USER_ID, server_id: 'srv-a', balance: 100, last_daily_claim_date: null, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
      { user_id: TEST_USER_ID, server_id: 'srv-b', balance: 250, last_daily_claim_date: '2026-07-01', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
      { user_id: TEST_USER_ID, server_id: 'srv-c', balance: 50, last_daily_claim_date: today, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
      // 其他用户钱包——不应计入
      { user_id: OTHER_USER_ID, server_id: 'srv-a', balance: 9999, last_daily_claim_date: null, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' },
    ]);

    app = express();
    app.use(express.json());
    app.use(injectUser(TEST_USER_ID));
    app.use('/api/my', createMyRouter(db, mockLogger() as never));
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('返回全字段聚合概览（绑定/通知/进行中订单计数）', async () => {
    const res = await request(app).get('/api/my/overview');
    expect(res.status).toBe(200);

    const ov = res.body.overview as Record<string, number>;
    expect(ov.bindings_total).toBe(3);
    expect(ov.bindings_verified).toBe(2);
    expect(ov.unread_notifications).toBe(2);
    expect(ov.pending_orders).toBe(2); // pending + claiming，不含 claimed
  });

  it('多实例钱包余额合计正确（跨 server_id 求和，隔离其他用户）', async () => {
    const res = await request(app).get('/api/my/overview');
    expect(res.status).toBe(200);

    const ov = res.body.overview as Record<string, number>;
    expect(ov.wallet_balance).toBe(400); // 100+250+50，不含 OTHER_USER 的 9999
  });

  it('今日已领取的钱包不计入 daily_claimable', async () => {
    const res = await request(app).get('/api/my/overview');
    expect(res.status).toBe(200);

    const ov = res.body.overview as Record<string, number>;
    expect(ov.daily_claimable).toBe(2); // 3 钱包中 1 个今日已领取
  });

  it('未认证请求返回 401', async () => {
    const anonApp = express();
    anonApp.use(express.json());
    anonApp.use(injectUser(null));
    anonApp.use('/api/my', createMyRouter(db, mockLogger() as never));

    const res = await request(anonApp).get('/api/my/overview');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('PANEL_UNAUTHORIZED');
  });
});
