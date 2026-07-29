// ============================================================================
// users.roles.test.ts — v4.17.0 多角色管理路由契约测试
//
// 覆盖端点：
//   - GET    /api/users/:id/roles          查询用户角色集合
//   - PUT    /api/users/:id/roles          调整用户角色集合（触发 JWT 黑名单）
//   - POST   /api/users/:id/revoke-tokens  强制下线用户
//
// 路由本身不套鉴权中间件（在 routes-registry 挂载时统一套），所以测试中
// 直接挂载 createUsersRouter() 即可，不需要注入 req.user。
// 但 req.app.locals.userService / db / auditLogService 必须注入。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex, { type Knex } from 'knex';
import bcrypt from 'bcryptjs';
import { createUsersRouter } from './users.js';
import { UserServiceImpl } from '../../services/userService.js';
import { Role } from '../../core/auth/roles.js';
import { resetTokenBlacklistService } from '../../core/auth/tokenBlacklist.js';

// ---------------------------------------------------------------------------
// 测试用 DB 工厂（与 userServiceMultiRole.test.ts 对齐，含 v4.17.0 字段）
// ---------------------------------------------------------------------------

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
    table.string('role').notNullable().defaultTo('user');
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

  // v4.17.0: player_bindings 表已物理删除，统一到 bindings 表（与 db-helper.ts schema 对齐）
  await db.schema.createTable('bindings', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('binding_type').notNullable(); // 'account' | 'player'
    table.string('scope_type').notNullable();   // 'instance' | 'game_type' | 'global'
    table.string('scope_ref').notNullable();     // instance_id | game_type | null（global）
    table.string('player_name').nullable();
    table.integer('vip_level').notNullable().defaultTo(0);
    table.string('wallet_id').nullable();
    table.string('verify_status').notNullable().defaultTo('pending'); // pending|verified|revoked|expired
    table.string('verify_code').nullable();
    table.text('verify_expires_at').nullable();
    table.text('verified_at').nullable();
    table.text('metadata').nullable();
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  return db;
}

async function destroyTestDb(db: Knex): Promise<void> {
  await db.destroy();
}

// ---------------------------------------------------------------------------
// Mock audit log service（路由内异步调用，失败不阻断响应）
// ---------------------------------------------------------------------------

function createMockAuditLogService() {
  const entries: Array<Record<string, unknown>> = [];
  return {
    create: async (entry: Record<string, unknown>): Promise<void> => {
      entries.push(entry);
    },
    entries,
  };
}

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-jwt-secret-for-multi-role-routes';

const NOW = '2026-07-25T00:00:00.000Z';

async function insertUser(
  db: Knex,
  overrides: Partial<{
    id: string;
    email: string;
    username: string;
    password: string;
    role: string;
    roles: string;
    active_role: string;
    status: string;
    token_version: number;
  }> = {},
): Promise<string> {
  const id = overrides.id ?? `user-${Math.random().toString(36).slice(2, 10)}`;
  const passwordHash = await bcrypt.hash(overrides.password ?? 'Password123!', 10);
  const role = overrides.role ?? Role.USER;
  const roles = overrides.roles ?? JSON.stringify([role]);
  const activeRole = overrides.active_role ?? role;
  await db('users').insert({
    id,
    email: overrides.email ?? `${id}@example.com`,
    username: overrides.username ?? id,
    password_hash: passwordHash,
    role,
    status: overrides.status ?? 'active',
    display_name: null,
    vip_level: 0,
    vip_expires_at: null,
    is_verified: 0,
    last_login_at: null,
    last_login_ip: null,
    created_at: NOW,
    updated_at: NOW,
    token_version: overrides.token_version ?? 0,
    roles,
    active_role: activeRole,
  });
  return id;
}

function buildApp(db: Knex, jwtSecret: string): { app: express.Express; auditLogService: ReturnType<typeof createMockAuditLogService> } {
  const userService = new UserServiceImpl(db, jwtSecret);
  const auditLogService = createMockAuditLogService();
  const app = express();
  app.use(express.json());
  app.locals.userService = userService;
  app.locals.db = db;
  app.locals.auditLogService = auditLogService;
  app.use('/api/users', createUsersRouter());
  return { app, auditLogService };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('users.ts 多角色管理路由（v4.17.0）', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createTestDb();
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  // ==========================================================================
  // GET /api/users/:id/roles
  // ==========================================================================

  describe('GET /api/users/:id/roles', () => {
    it('成功返回用户角色集合 + 活动角色 + requires_role_selection=false（单角色）', async () => {
      const userId = await insertUser(db, { roles: JSON.stringify([Role.USER]), active_role: Role.USER });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get(`/api/users/${userId}/roles`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        user_id: userId,
        roles: ['user'],
        active_role: 'user',
        requires_role_selection: false,
      });
    });

    it('多角色用户 requires_role_selection=true', async () => {
      const userId = await insertUser(db, {
        roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
        active_role: Role.USER,
      });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get(`/api/users/${userId}/roles`);

      expect(res.status).toBe(200);
      expect(res.body.requires_role_selection).toBe(true);
      expect(res.body.roles).toEqual(expect.arrayContaining(['user', 'instance_admin']));
      expect(res.body.active_role).toBe('user');
    });

    it('用户不存在返回 404', async () => {
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get('/api/users/non-existent/roles');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('v4.19.2: 旧用户 roles=NULL 时降级为 [USER]（不再从已删除的 role 字段推导）', async () => {
      // v4.19.2 M3: users.role 列已由 M5 基线 DROP，过渡期 fallback 已移除。
      // 当 roles=NULL + active_role=NULL 时，统一降级为 [USER]（最低权限默认）。
      // 旧测试期望从 role 字段推导 ['instance_admin'] 已不再适用。
      const userId = 'legacy-user-001';
      const passwordHash = await bcrypt.hash('Password123!', 10);
      await db('users').insert({
        id: userId,
        email: 'legacy@example.com',
        username: 'legacy',
        password_hash: passwordHash,
        // 测试 schema 仍保留 role 列（供其他测试用），但生产已 DROP；
        // 此处显式置 'user' 以避免测试 DB 默认值干扰。
        role: Role.USER,
        status: 'active',
        display_name: null,
        vip_level: 0,
        vip_expires_at: null,
        is_verified: 0,
        last_login_at: null,
        last_login_ip: null,
        created_at: NOW,
        updated_at: NOW,
        token_version: 0,
        roles: null,
        active_role: null,
      });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get(`/api/users/${userId}/roles`);

      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual(['user']);
      expect(res.body.active_role).toBe('user');
      expect(res.body.requires_role_selection).toBe(false);
    });
  });

  // ==========================================================================
  // PUT /api/users/:id/roles
  // ==========================================================================

  describe('PUT /api/users/:id/roles', () => {
    it('成功调整角色集合（user → user + instance_admin）+ 撤销旧 token', async () => {
      const userId = await insertUser(db, {
        roles: JSON.stringify([Role.USER]),
        active_role: Role.USER,
        token_version: 5,
      });

      const { app, auditLogService } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['user', 'instance_admin'], active_role: 'instance_admin' });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: userId,
        roles: expect.arrayContaining(['user', 'instance_admin']),
        active_role: 'instance_admin',
      });
      expect(res.body.user.role).toBe('instance_admin'); // 过渡期同步
      expect(typeof res.body.revoked_token_count).toBe('number');

      // DB 校验：roles + active_role + role 同步
      const row = await db('users').where({ id: userId }).first();
      expect(JSON.parse(row.roles)).toEqual(['user', 'instance_admin']);
      expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
      expect(row.role).toBe(Role.INSTANCE_ADMIN); // 过渡期同步
      expect(row.token_version).toBe(6); // 5 + 1

      // 审计日志已记录
      expect(auditLogService.entries.length).toBe(1);
      expect(auditLogService.entries[0].action).toBe('user.update_roles');
    });

    it('不传 active_role 时取 roles[0] 作为活动角色', async () => {
      const userId = await insertUser(db);

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['instance_admin', 'user'] });

      expect(res.status).toBe(200);
      expect(res.body.user.active_role).toBe('instance_admin'); // roles[0]
    });

    it('roles 为空数组返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).put(`/api/users/${userId}/roles`).send({ roles: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
      expect(res.body.error.message).toContain('非空数组');
    });

    it('roles 缺失字段返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).put(`/api/users/${userId}/roles`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PANEL_VALIDATION_ERROR');
    });

    it('roles 含非法角色值返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['user', 'super_admin'] }); // super_admin 不在 3 级枚举中

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('非法 role');
    });

    it('roles 含重复元素返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['user', 'user'] });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('重复');
    });

    it('active_role 不在 roles 集合中返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['user'], active_role: 'instance_admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('active_role 必须在 roles');
    });

    it('active_role 为非法值返回 400', async () => {
      const userId = await insertUser(db);
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['user'], active_role: 'super_admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('非法 active_role');
    });

    it('用户不存在返回 404', async () => {
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put('/api/users/non-existent/roles')
        .send({ roles: ['user'] });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('降级场景：仅 server_admin 一个角色（不再保留 user）', async () => {
      const userId = await insertUser(db, {
        roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
        active_role: Role.INSTANCE_ADMIN,
      });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app)
        .put(`/api/users/${userId}/roles`)
        .send({ roles: ['server_admin'] });

      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual(['server_admin']);
      expect(res.body.user.active_role).toBe('server_admin');
    });
  });

  // ==========================================================================
  // POST /api/users/:id/revoke-tokens
  // ==========================================================================

  describe('POST /api/users/:id/revoke-tokens', () => {
    it('成功撤销用户 token + token_version 自增', async () => {
      const userId = await insertUser(db, { token_version: 10 });

      const { app, auditLogService } = buildApp(db, JWT_SECRET);
      const res = await request(app).post(`/api/users/${userId}/revoke-tokens`).send();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        user_id: userId,
        revoked_token_count: expect.any(Number),
        revoked_at: expect.any(String),
      });
      expect(new Date(res.body.revoked_at).getTime()).not.toBeNaN();

      // DB 校验：token_version 自增
      const row = await db('users').where({ id: userId }).first();
      expect(row.token_version).toBe(11);

      // 审计日志
      expect(auditLogService.entries.length).toBe(1);
      expect(auditLogService.entries[0].action).toBe('user.revoke_tokens');
    });

    it('多次调用 token_version 持续自增', async () => {
      const userId = await insertUser(db, { token_version: 0 });

      const { app } = buildApp(db, JWT_SECRET);
      await request(app).post(`/api/users/${userId}/revoke-tokens`).send();
      await request(app).post(`/api/users/${userId}/revoke-tokens`).send();
      const res3 = await request(app).post(`/api/users/${userId}/revoke-tokens`).send();

      expect(res3.status).toBe(200);
      const row = await db('users').where({ id: userId }).first();
      expect(row.token_version).toBe(3);
    });

    it('用户不存在返回 404', async () => {
      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).post('/api/users/non-existent/revoke-tokens').send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  // ==========================================================================
  // AdminUserSummary 输出一致性
  // ==========================================================================

  describe('AdminUserSummary 输出 roles + active_role', () => {
    it('GET /:id 返回的 user 对象包含 roles + active_role 字段', async () => {
      const userId = await insertUser(db, {
        roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
        active_role: Role.INSTANCE_ADMIN,
      });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get(`/api/users/${userId}`);

      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual(expect.arrayContaining(['user', 'instance_admin']));
      expect(res.body.user.active_role).toBe('instance_admin');
      expect(res.body.user.role).toBe('instance_admin'); // 过渡期同步
    });

    it('GET / 列表项包含 roles + active_role 字段', async () => {
      await insertUser(db, {
        id: 'list-user-1',
        email: 'list1@example.com',
        roles: JSON.stringify([Role.USER]),
        active_role: Role.USER,
      });
      await insertUser(db, {
        id: 'list-user-2',
        email: 'list2@example.com',
        roles: JSON.stringify([Role.USER, Role.SERVER_ADMIN]),
        active_role: Role.SERVER_ADMIN,
      });

      const { app } = buildApp(db, JWT_SECRET);
      const res = await request(app).get('/api/users');

      expect(res.status).toBe(200);
      const users = res.body.users as Array<{ id: string; roles?: string[]; active_role?: string }>;
      expect(users.length).toBe(2);
      const multiRoleUser = users.find((u) => u.id === 'list-user-2');
      expect(multiRoleUser?.roles).toEqual(expect.arrayContaining(['user', 'server_admin']));
      expect(multiRoleUser?.active_role).toBe('server_admin');
    });
  });
});
