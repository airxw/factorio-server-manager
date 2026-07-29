// ============================================================================
// routes-registry.switch-role.test.ts
// v4.28.0: POST /api/auth/switch-role 免密切换端点契约测试（全员服主）
//
// 覆盖：
//   1. 无 token → 401
//   2. 缺 active_role → 400
//   3. 非法 active_role → 400
//   4. 等级闸门：target=server_admin → 403（须走 select-role 密码通道）
//   5. user → instance_admin → 200 + 新 token 含新 active_role
//   6. instance_admin → user → 200 + token_version 不变（SB-4 同层互切不撤销）
//   7. JWT 用户不存在 → 401
//   8. 账号 disabled → 403
//   9. 目标角色不在 roles 集合 → 400
//  10. 审计日志记录 user.switch_role（channel=jwt_passwordless）
//
// 挂载策略：完整 registerRoutes + 真实 db/userService + stub 其他依赖
//   - 59 个路由工厂构造期仅存引用（无 DB/网络副作用），可用 undefined stub
//   - daemonClient 由 registerRoutes 内部构造（仅读 env，无副作用）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex, { type Knex } from 'knex';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { registerRoutes } from './routes-registry.js';
import { UserServiceImpl } from './services/userService.js';
import { signToken } from './core/auth/jwt.js';
import { Role } from './core/auth/roles.js';
import { resetTokenBlacklistService } from './core/auth/tokenBlacklist.js';
import type { PackRegistry } from './core/packs/registry.js';
import type { PanelWsServer } from './websocket/server.js';
import type { DaemonEventStream } from './daemonClient/eventStream.js';
import type { ServiceContainer } from './services-init.js';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// 测试基建
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-jwt-secret-for-switch-role';

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await db.schema.createTable('users', (table) => {
    table.string('id').primary();
    table.string('email').notNullable().unique();
    table.string('username').notNullable();
    table.string('password_hash').notNullable();
    table.string('status').notNullable().defaultTo('active');
    table.string('display_name').nullable().defaultTo(null);
    table.integer('vip_level').notNullable().defaultTo(0);
    table.text('vip_expires_at').nullable().defaultTo(null);
    table.integer('is_verified').notNullable().defaultTo(0);
    table.text('last_login_at').nullable().defaultTo(null);
    table.string('last_login_ip').nullable().defaultTo(null);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.integer('token_version').notNullable().defaultTo(0);
    table.text('roles').nullable().defaultTo(null);
    table.string('active_role').nullable().defaultTo(null);
  });

  // bindings 表（UserServiceImpl 构造期不查，但 login/register 路径引用；此处防御性建表）
  await db.schema.createTable('bindings', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('binding_type').notNullable();
    table.string('scope_type').notNullable();
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

async function insertUser(
  db: Knex,
  overrides: Partial<{
    email: string;
    username: string;
    roles: string;
    active_role: string;
    status: string;
    token_version: number;
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db('users').insert({
    id,
    email: overrides.email ?? `u-${id}@test.local`,
    username: overrides.username ?? 'testuser',
    password_hash: await bcrypt.hash('Password123!', 10),
    status: overrides.status ?? 'active',
    display_name: null,
    vip_level: 0,
    vip_expires_at: null,
    is_verified: 1,
    last_login_at: null,
    last_login_ip: null,
    created_at: now,
    updated_at: now,
    token_version: overrides.token_version ?? 0,
    roles: overrides.roles ?? JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
    active_role: overrides.active_role ?? Role.USER,
  });
  return id;
}

function makeToken(userId: string, activeRole: Role, roles: Role[], tokenVersion = 0): string {
  return signToken(
    {
      userId,
      email: `u-${userId}@test.local`,
      username: 'testuser',
      role: activeRole,
      token_version: tokenVersion,
      roles,
      active_role: activeRole,
    },
    JWT_SECRET,
  );
}

interface AuditEntry {
  user_id: string;
  action: string;
  details?: Record<string, unknown>;
}

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

async function createTestApp(db: Knex, auditEntries: AuditEntry[]) {
  const app = express();
  app.use(express.json());

  const userService = new UserServiceImpl(db, JWT_SECRET);
  const auditLogService = {
    create: async (entry: AuditEntry): Promise<void> => {
      auditEntries.push(entry);
    },
  };

  // 其余服务在 switch-role 路径上不被触达；59 个路由工厂构造期仅存引用
  const services = {
    userService,
    auditLogService,
  } as unknown as ServiceContainer;

  registerRoutes({
    app,
    db,
    registry: {} as PackRegistry,
    services,
    JWT_SECRET,
    logger: createStubLogger(),
    wsServer: {} as PanelWsServer,
    daemonEventStream: { subscribe: () => undefined } as unknown as DaemonEventStream,
  });

  return app;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('POST /api/auth/switch-role（v4.28.0 全员服主免密切换）', () => {
  let db: Knex;
  let auditEntries: AuditEntry[];
  let app: express.Express;

  beforeEach(async () => {
    db = await createTestDb();
    resetTokenBlacklistService();
    auditEntries = [];
    app = await createTestApp(db, auditEntries);
  });

  afterEach(async () => {
    await db.destroy();
    resetTokenBlacklistService();
  });

  it('无 Authorization 头 → 401', async () => {
    const res = await request(app)
      .post('/api/auth/switch-role')
      .send({ active_role: 'instance_admin' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('PANEL_UNAUTHORIZED');
  });

  it('缺少 active_role → 400', async () => {
    const userId = await insertUser(db);
    const token = makeToken(userId, Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('缺少 active_role');
  });

  it('非法 active_role → 400', async () => {
    const userId = await insertUser(db);
    const token = makeToken(userId, Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'superman' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('非法 active_role');
  });

  it('等级闸门：target=server_admin → 403（免密通道拒绝，引导走 select-role 密码通道）', async () => {
    // 注意：用户 roles 集合含 server_admin 也仍被闸门拦截——免密通道不允许升到 level 3
    const userId = await insertUser(db, {
      roles: JSON.stringify([Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER]),
      active_role: Role.INSTANCE_ADMIN,
    });
    const token = makeToken(
      userId,
      Role.INSTANCE_ADMIN,
      [Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER],
    );

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'server_admin' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PANEL_FORBIDDEN');
    expect(res.body.error.message).toContain('select-role');

    // active_role 未被修改
    const row = await db('users').where({ id: userId }).first();
    expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
  });

  it('user → instance_admin → 200 + 新 token 含新 active_role + DB 已更新', async () => {
    const userId = await insertUser(db, {
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.USER,
    });
    const token = makeToken(userId, Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'instance_admin' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.active_role).toBe('instance_admin');
    expect(res.body.user.roles).toEqual(['user', 'instance_admin']);

    // 新 JWT payload 验证
    const payload = JSON.parse(
      Buffer.from((res.body.token as string).split('.')[1], 'base64').toString('utf-8'),
    );
    expect(payload.active_role).toBe('instance_admin');
    expect(payload.roles).toEqual(['user', 'instance_admin']);

    // DB 已更新
    const row = await db('users').where({ id: userId }).first();
    expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
  });

  it('instance_admin → user → 200 + token_version 不变（SB-4 同层互切不撤销其他会话）', async () => {
    const userId = await insertUser(db, {
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
      token_version: 5,
    });
    const token = makeToken(
      userId,
      Role.INSTANCE_ADMIN,
      [Role.USER, Role.INSTANCE_ADMIN],
      5,
    );

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'user' });

    expect(res.status).toBe(200);
    expect(res.body.user.active_role).toBe('user');

    // SB-4：同层互切不撤销——token_version 保持 5
    const row = await db('users').where({ id: userId }).first();
    expect(row.token_version).toBe(5);
  });

  it('JWT 用户不存在 → 401', async () => {
    const ghostToken = makeToken('ghost-user-id', Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${ghostToken}`)
      .send({ active_role: 'instance_admin' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('用户不存在');
  });

  it('账号 disabled → 403', async () => {
    const userId = await insertUser(db, { status: 'disabled' });
    const token = makeToken(userId, Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'instance_admin' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('账号状态异常');
  });

  it('目标角色不在 roles 集合 → 400', async () => {
    // 构造未迁移的老用户：roles 仅 ['user']，目标 instance_admin 不在集合中
    const userId = await insertUser(db, {
      roles: JSON.stringify([Role.USER]),
      active_role: Role.USER,
    });
    const token = makeToken(userId, Role.USER, [Role.USER]);

    const res = await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'instance_admin' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('不在用户角色集合中');
  });

  it('审计日志记录 user.switch_role（channel=jwt_passwordless）', async () => {
    const userId = await insertUser(db, {
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.USER,
    });
    const token = makeToken(userId, Role.USER, [Role.USER, Role.INSTANCE_ADMIN]);

    await request(app)
      .post('/api/auth/switch-role')
      .set('Authorization', `Bearer ${token}`)
      .send({ active_role: 'instance_admin' });

    // 审计是异步的（void ... catch），等待微任务排空
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe('user.switch_role');
    expect(auditEntries[0].user_id).toBe(userId);
    expect(auditEntries[0].details?.new_active_role).toBe('instance_admin');
    expect(auditEntries[0].details?.channel).toBe('jwt_passwordless');
  });
});
