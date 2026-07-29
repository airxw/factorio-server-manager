// ============================================================================
// playerBindings.test.ts — 玩家绑定实例级路由单测（v4.27.0）
//
// 背景：v4.16.1 改为按角色分流；v4.27.0 将 player 绑定从 scope_type='game_type'
//   全局语义迁移至 scope_type='instance' 实例级语义：
//   - POST / 请求体 game_type → server_id（BREAKING）
//   - bindings.scope_ref 含义由 game_type 改为 server_id
//   - playerService.createBinding 增加 server 存在性校验
//
// 测试表结构：bindings（v4.17.0 统一表，由 db-helper.ts 创建）
//   - binding_type='player', scope_type='instance', scope_ref=server_id（v4.27.0）
//
// 路由权限分流：
//   - GET /            server_admin 看全部；玩家只看自己
//   - POST /           任何登录用户创建自己的绑定（userId 从 token 取）
//   - POST /:id/verify 玩家限自己的绑定（他人绑定 404，不泄露存在性）；admin 任意
//   - POST /:id/reject 管理动作，admin-only（玩家 403）
//   - DELETE /:id      玩家限自己的绑定（他人 404）；admin 任意
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb } from '../../test/db-helper.js';
import { createPlayerBindingsRouter } from './playerBindings.js';
import { PlayerServiceImpl } from '../../services/playerService.js';

const PLAYER_ID = 'user-player-001';
const OTHER_PLAYER_ID = 'user-player-999';
const ADMIN_ID = 'user-admin-001';
// v4.27.0: scope_ref 改为 server_id，需先 seed servers 表
const SERVER_ID = 'server-uuid-001';
const OTHER_SERVER_ID = 'server-uuid-002';

const NOW = '2026-07-24T00:00:00.000Z';

/** 注入 req.user（模拟 routes-registry 的 authenticateToken 结果，含 role） */
function injectUser(userId: string, role: 'server_admin' | 'user') {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: { userId: string; role: string } }).user = { userId, role };
    next();
  };
}

/** 组装测试 app：注入 user → 挂载 player-bindings 路由 */
function buildApp(db: Knex, userId: string, role: 'server_admin' | 'user'): express.Express {
  const app = express();
  app.use(express.json());
  app.locals.playerService = new PlayerServiceImpl(db);
  app.use('/api/player-bindings', injectUser(userId, role), createPlayerBindingsRouter());
  return app;
}

/** 种子 servers 表（v4.27.0: playerService.createBinding 校验 server 存在性） */
async function seedServers(db: Knex): Promise<void> {
  await db('servers').insert([
    {
      id: SERVER_ID,
      name: 'Test Server 1',
      pack_id: 'minecraft-vanilla',
      game_type: 'minecraft',
      node_id: 'node-001',
      owner_user_id: ADMIN_ID,
      status: 'running',
      port: 25565,
      rcon_port: 25575,
      rcon_password_enc: null,
      resource_limits_json: null,
      current_version: null,
      version_id: null,
      last_activity_at: null,
      marked_for_deletion: 0,
      disk_usage_bytes: null,
      disk_usage_updated_at: null,
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: OTHER_SERVER_ID,
      name: 'Test Server 2',
      pack_id: 'minecraft-vanilla',
      game_type: 'minecraft',
      node_id: 'node-001',
      owner_user_id: ADMIN_ID,
      status: 'stopped',
      port: 25566,
      rcon_port: 25576,
      rcon_password_enc: null,
      resource_limits_json: null,
      current_version: null,
      version_id: null,
      last_activity_at: null,
      marked_for_deletion: 0,
      disk_usage_bytes: null,
      disk_usage_updated_at: null,
      created_at: NOW,
      updated_at: NOW,
    },
  ]);
}

/** 种子数据：PLAYER 一条 pending 绑定（id=1），OTHER_PLAYER 一条 pending 绑定（id=2） */
async function seedBindings(db: Knex): Promise<void> {
  await db('bindings').insert([
    {
      id: '1',
      user_id: PLAYER_ID,
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: SERVER_ID,
      player_name: 'Steve',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: 'VC-AAAA',
      verify_expires_at: null,
      verified_at: null,
      metadata: '{}',
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: '2',
      user_id: OTHER_PLAYER_ID,
      binding_type: 'player',
      scope_type: 'instance',
      scope_ref: OTHER_SERVER_ID,
      player_name: 'Alex',
      vip_level: 0,
      wallet_id: null,
      verify_status: 'pending',
      verify_code: 'VC-BBBB',
      verify_expires_at: null,
      verified_at: null,
      metadata: '{}',
      created_at: NOW,
      updated_at: NOW,
    },
  ]);
}

describe('PlayerBindingsRouter — GET / 按角色分流', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await seedBindings(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('玩家视角：仅返回自己的绑定（不含他人）', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app).get('/api/player-bindings');

    expect(res.status).toBe(200);
    expect(res.body.bindings).toHaveLength(1);
    expect(res.body.bindings[0].user_id).toBe(PLAYER_ID);
    expect(res.body.bindings[0].player_name).toBe('Steve');
  });

  it('admin 视角：返回全部绑定', async () => {
    const app = buildApp(db, ADMIN_ID, 'server_admin');
    const res = await request(app).get('/api/player-bindings');

    expect(res.status).toBe(200);
    expect(res.body.bindings).toHaveLength(2);
  });
});

describe('PlayerBindingsRouter — POST / 玩家自助创建', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await seedServers(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('玩家可创建自己的实例级绑定（userId 取自 token，server_id 取自请求体）', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app)
      .post('/api/player-bindings')
      .send({ game_player_name: 'Steve', server_id: SERVER_ID });

    expect(res.status).toBe(201);
    expect(res.body.binding.user_id).toBe(PLAYER_ID);
    expect(res.body.binding.verify_status).toBe('pending');
    expect(res.body.binding.verify_code).toBeTruthy();
    expect(res.body.binding.scope_type).toBe('instance');
    expect(res.body.binding.scope_ref).toBe(SERVER_ID);
  });

  it('缺少 server_id 时返回 400', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app)
      .post('/api/player-bindings')
      .send({ game_player_name: 'Steve' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
  });

  it('server_id 不存在时返回 404', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app)
      .post('/api/player-bindings')
      .send({ game_player_name: 'Steve', server_id: 'nonexistent-server' });

    expect(res.status).toBe(404);
  });
});

describe('PlayerBindingsRouter — POST /:id/verify ownership', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await seedBindings(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('玩家验证自己的绑定：成功', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app)
      .post('/api/player-bindings/1/verify')
      .send({ verify_code: 'VC-AAAA' });

    expect(res.status).toBe(200);
    expect(res.body.binding.verify_status).toBe('verified');
    expect(res.body.binding.verified_at).toBeTruthy();
  });

  it('玩家验证他人绑定：404（不泄露存在性）', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app)
      .post('/api/player-bindings/2/verify')
      .send({ verify_code: 'VC-BBBB' });

    expect(res.status).toBe(404);
    // 数据库中他人绑定应保持 pending 未被篡改
    const row = await db('bindings').where({ id: '2', binding_type: 'player', scope_type: 'instance' }).first();
    expect(row.verify_status).toBe('pending');
  });

  it('admin 验证任意绑定：成功', async () => {
    const app = buildApp(db, ADMIN_ID, 'server_admin');
    const res = await request(app)
      .post('/api/player-bindings/2/verify')
      .send({ verify_code: 'VC-BBBB' });

    expect(res.status).toBe(200);
    expect(res.body.binding.verify_status).toBe('verified');
  });
});

describe('PlayerBindingsRouter — DELETE /:id ownership', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await seedBindings(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('玩家删除自己的绑定：成功', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app).delete('/api/player-bindings/1');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    const row = await db('bindings').where({ id: '1', binding_type: 'player', scope_type: 'instance' }).first();
    expect(row).toBeUndefined();
  });

  it('玩家删除他人绑定：404 且记录保留', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app).delete('/api/player-bindings/2');

    expect(res.status).toBe(404);
    const row = await db('bindings').where({ id: '2', binding_type: 'player', scope_type: 'instance' }).first();
    expect(row).toBeDefined();
  });
});

describe('PlayerBindingsRouter — POST /:id/reject 管理动作', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    await seedBindings(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('玩家调用 reject：403（管理动作不开放自助）', async () => {
    const app = buildApp(db, PLAYER_ID, 'user');
    const res = await request(app).post('/api/player-bindings/1/reject');

    expect(res.status).toBe(403);
  });

  it('admin 调用 reject：成功', async () => {
    const app = buildApp(db, ADMIN_ID, 'server_admin');
    const res = await request(app).post('/api/player-bindings/1/reject');

    expect(res.status).toBe(200);
    expect(res.body.binding.verify_status).toBe('revoked');
  });
});
