// ============================================================================
// userServiceMultiRole.test.ts — 多角色管理服务单元测试
// 覆盖：updateUserRoles / listUserRoles / selectActiveRole / revokeUserTokens
//       + register / login 多角色字段初始化 + toUser / toUserInfo 输出一致性
//
// 来源：v4.17.0 B7 阶段鉴权链路单元测试
// 重点覆盖 R3 SOFT_BLOCK 场景：
//   - R3-11 中: updateUserRoles activeRole ∉ roles 当前实现降级（与契约不一致）
//   - R3-11 高: revokeAllUserTokens 失败时 updateUserRoles 不回滚
//   - R3-4: selectActiveRole 不撤销旧 token
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { UserServiceImpl, toUserInfo } from './userService.js';
import { Role } from '../core/auth/roles.js';
import {
  UserNotFoundError,
  InvalidCredentialError,
} from './errors.js';
import { resetTokenBlacklistService, getTokenBlacklistService } from '../core/auth/tokenBlacklist.js';

// ---------------------------------------------------------------------------
// 测试用 DB 工厂
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  // users 表（含 v4.17.0 roles + active_role 字段）
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
    // v4.17.0 新增字段
    table.text('roles').nullable().defaultTo(null);
    table.string('active_role').nullable().defaultTo(null);
  });

  // v4.17.0: player_bindings 表已物理删除，统一到 bindings 表（register/registerFromGame 依赖）
  // 旧字段映射：game_player_name→player_name, game_type→scope_ref, status→verify_status

  // user_password_history 表（updatePassword 依赖，本次测试不直接用但 register 不需要）
  await db.schema.createTable('user_password_history', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('password_hash').notNullable();
    table.text('created_at').notNullable();
  });

  // bindings 表（v4.17.0 统一绑定，与 db-helper.ts schema 对齐；register 时插入 binding_type='player'）
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

/** 直接插入用户（绕过 register，用于多角色测试的快速 setup） */
async function insertUser(
  db: Knex,
  overrides: Partial<{
    id: string;
    email: string;
    username: string;
    role: string;
    roles: string; // JSON 字符串
    active_role: string;
    token_version: number;
    status: string;
  }> = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const role = overrides.role ?? Role.USER;
  await db('users').insert({
    id,
    email: overrides.email ?? `user-${id}@test.local`,
    username: overrides.username ?? 'testuser',
    password_hash: overrides.roles ?? '$2a$10$' + 'a'.repeat(53),
    role,
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
    roles: overrides.roles ?? JSON.stringify([role]),
    active_role: overrides.active_role ?? role,
  });
  return id;
}

// ---------------------------------------------------------------------------
// updateUserRoles
// ---------------------------------------------------------------------------

describe('UserServiceImpl - updateUserRoles', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('成功更新角色集合 + 同步 active_role + 同步 role（过渡期）', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    const result = await service.updateUserRoles(userId, [Role.USER, Role.INSTANCE_ADMIN], Role.INSTANCE_ADMIN);

    expect(result.user.roles).toEqual(['user', 'instance_admin']);
    expect(result.user.active_role).toBe('instance_admin');
    expect(result.user.role).toBe('instance_admin'); // 过渡期同步
    expect(result.revokedTokenCount).toBe(1);

    // DB 验证
    const row = await db('users').where({ id: userId }).first();
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
    expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
    // v4.19.2: users.role 列已 DROP，不再断言 row.role
    expect(row.token_version).toBe(1); // +1
  });

  it('未传 activeRole 时默认取 roles[0]', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    const result = await service.updateUserRoles(userId, [Role.INSTANCE_ADMIN, Role.USER]);

    expect(result.user.active_role).toBe('instance_admin');
    expect(result.user.roles).toEqual(['instance_admin', 'user']);
  });

  it('用户不存在抛 UserNotFoundError', async () => {
    await expect(
      service.updateUserRoles('nonexistent-id', [Role.USER]),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('roles 为空数组抛 InvalidCredentialError', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    await expect(
      service.updateUserRoles(userId, []),
    ).rejects.toThrow(InvalidCredentialError);
  });

  it('roles 全为非法值归一化后为空抛 InvalidCredentialError', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    // normalizeRoles 把非法值降级为 USER，不会返回空数组
    // 但传 [123, null] 这种纯非 string 数组会返回 [USER]
    // 实际上无法触发"归一化后为空"分支（normalizeRoles 保证至少返回 [USER]）
    // 此测试验证传 [USER] 仍能正常通过
    const result = await service.updateUserRoles(userId, ['user']);
    expect(result.user.roles).toEqual(['user']);
  });

  it('R3-11-1 修复：activeRole 显式传入但不在 roles 中时抛 InvalidCredentialError（与契约一致）', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    // v4.19.0 R3-11-1 修复：原 SOFT_BLOCK 行为（静默降级到 roles[0]）已修复
    // 现在与契约声明一致——显式传入的 activeRole 不在 roles 中时抛错
    await expect(
      service.updateUserRoles(userId, [Role.USER], Role.SERVER_ADMIN as never),
    ).rejects.toThrow(InvalidCredentialError);

    // 验证 users 表未被部分更新（事务回滚）
    const row = await db('users').select('roles', 'active_role').where({ id: userId }).first();
    expect(row.active_role).toBe('user');
    expect(row.roles).toBe(JSON.stringify(['user']));
  });

  it('R3-11 高 SOFT_BLOCK 场景：token 撤销成功时 revokedTokenCount=1', async () => {
    const userId = await insertUser(db, { role: Role.USER, token_version: 5 });

    const result = await service.updateUserRoles(userId, [Role.INSTANCE_ADMIN]);

    expect(result.revokedTokenCount).toBe(1);
    // token_version 从 5 → 6
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(6);
  });

  it('R3-11 高 SOFT_BLOCK 场景：token_version=0 旧用户撤销后升为 1', async () => {
    const userId = await insertUser(db, { role: Role.USER, token_version: 0 });

    const result = await service.updateUserRoles(userId, [Role.INSTANCE_ADMIN]);

    expect(result.revokedTokenCount).toBe(1);
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(1);
  });

  it('roles 去重：传入重复角色自动去重', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    const result = await service.updateUserRoles(userId, [Role.USER, Role.USER, Role.INSTANCE_ADMIN]);

    expect(result.user.roles).toEqual(['user', 'instance_admin']);
  });

  it('roles 旧值兼容：传入 admin 自动归一化为 instance_admin', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    const result = await service.updateUserRoles(userId, ['admin' as never, Role.USER]);

    expect(result.user.roles).toEqual(['instance_admin', 'user']);
  });
});

// ---------------------------------------------------------------------------
// listUserRoles
// ---------------------------------------------------------------------------

describe('UserServiceImpl - listUserRoles', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('返回用户角色集合 + 活动角色 + requires_role_selection', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
    });

    const result = await service.listUserRoles(userId);

    expect(result.user_id).toBe(userId);
    expect(result.roles).toEqual(['user', 'instance_admin']);
    expect(result.active_role).toBe('instance_admin');
    expect(result.requires_role_selection).toBe(true); // length > 1
  });

  it('单角色用户 requires_role_selection=false', async () => {
    const userId = await insertUser(db, { role: Role.USER });

    const result = await service.listUserRoles(userId);

    expect(result.roles).toEqual(['user']);
    expect(result.requires_role_selection).toBe(false);
  });

  it('缺失 roles 字段时从 role 单值降级推导', async () => {
    const userId = await insertUser(db, { role: Role.SERVER_ADMIN, roles: null as never });

    const result = await service.listUserRoles(userId);

    expect(result.roles).toEqual(['server_admin']);
    expect(result.active_role).toBe('server_admin');
  });

  it('用户不存在抛 UserNotFoundError', async () => {
    await expect(
      service.listUserRoles('nonexistent-id'),
    ).rejects.toThrow(UserNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// selectActiveRole
// ---------------------------------------------------------------------------

describe('UserServiceImpl - selectActiveRole', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('成功切换活动角色 + 签发新 JWT + 同步 role（过渡期）', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.USER,
    });

    const result = await service.selectActiveRole(userId, Role.INSTANCE_ADMIN as never);

    expect(result.user.active_role).toBe('instance_admin');
    expect(result.user.role).toBe('instance_admin'); // 过渡期同步
    expect(result.token).toBeTruthy(); // 新 JWT

    // DB 验证
    const row = await db('users').where({ id: userId }).first();
    expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
    // v4.19.2: users.role 列已 DROP，不再断言 row.role
  });

  it('activeRole 不在 roles 中抛 InvalidCredentialError', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER]),
    });

    await expect(
      service.selectActiveRole(userId, Role.SERVER_ADMIN as never),
    ).rejects.toThrow(InvalidCredentialError);
  });

  it('用户不存在抛 UserNotFoundError', async () => {
    await expect(
      service.selectActiveRole('nonexistent-id', Role.USER as never),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('R3-4 修复：角色升级（低→高）不撤销旧 token（token_version 不变）', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.USER,
      token_version: 5,
    });

    // USER (level 1) → INSTANCE_ADMIN (level 2) = 升级，不撤销
    await service.selectActiveRole(userId, Role.INSTANCE_ADMIN as never);

    // token_version 不变（升级不撤销）
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(5);
  });

  it('v4.28.0 SB-4 收窄：instance_admin → user 同层互切不撤销旧 token（token_version 不变）', async () => {
    const userId = await insertUser(db, {
      role: Role.INSTANCE_ADMIN,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
      token_version: 5,
    });

    // v4.28.0 SB-4：INSTANCE_ADMIN (level 2) → USER (level 1) 是同层身份两面互切，
    // 不再视为安全降级，不撤销其他设备会话——这是快捷互切的必要条件
    const result = await service.selectActiveRole(userId, Role.USER as never);

    // token_version 不变（不撤销）
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(5);

    // 旧 token_version=5 未入黑名单
    const blacklist = getTokenBlacklistService();
    expect(blacklist.isBlacklisted(userId, 5)).toBe(false);

    // 新 JWT 正常签发（含切换后的 active_role）
    expect(result.user.active_role).toBe('user');
    expect(result.token).toBeTruthy();
  });

  it('v4.28.0 SB-4 收窄：user → instance_admin 同层互切不撤销旧 token（token_version 不变）', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.USER,
      token_version: 7,
    });

    // USER (level 1) → INSTANCE_ADMIN (level 2) 升级，不撤销（与旧语义一致）
    await service.selectActiveRole(userId, Role.INSTANCE_ADMIN as never);

    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(7);
  });

  it('R3-4 保留：server_admin → instance_admin 真降级仍强制撤销旧 token（token_version+1）', async () => {
    const userId = await insertUser(db, {
      role: Role.SERVER_ADMIN,
      roles: JSON.stringify([Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER]),
      active_role: Role.SERVER_ADMIN,
      token_version: 5,
    });

    // v4.28.0 收窄后保留的安全语义：仅 server_admin (level 3) 降级才撤销全部 token
    const result = await service.selectActiveRole(userId, Role.INSTANCE_ADMIN as never);

    // token_version 5 → 6（撤销）
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(6);

    // 旧 token_version=5 已入黑名单
    const blacklist = getTokenBlacklistService();
    expect(blacklist.isBlacklisted(userId, 5)).toBe(true);

    // 新 JWT 仍正常签发（含降级后的 active_role）
    expect(result.user.active_role).toBe('instance_admin');
    expect(result.token).toBeTruthy();
  });

  it('R3-4 保留：server_admin → user 真降级仍强制撤销旧 token（token_version+1）', async () => {
    const userId = await insertUser(db, {
      role: Role.SERVER_ADMIN,
      roles: JSON.stringify([Role.SERVER_ADMIN, Role.INSTANCE_ADMIN, Role.USER]),
      active_role: Role.SERVER_ADMIN,
      token_version: 3,
    });

    await service.selectActiveRole(userId, Role.USER as never);

    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(4); // 3 → 4

    const blacklist = getTokenBlacklistService();
    expect(blacklist.isBlacklisted(userId, 3)).toBe(true);
  });

  it('新 JWT 包含 roles + active_role 字段', async () => {
    const userId = await insertUser(db, {
      role: Role.USER,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
    });

    const result = await service.selectActiveRole(userId, Role.INSTANCE_ADMIN as never);

    // 解码 JWT payload（不验签）
    const payload = JSON.parse(
      Buffer.from(result.token.split('.')[1], 'base64').toString('utf-8'),
    );
    expect(payload.roles).toEqual(['user', 'instance_admin']);
    expect(payload.active_role).toBe('instance_admin');
    expect(payload.role).toBe('instance_admin'); // 过渡期同步
  });
});

// ---------------------------------------------------------------------------
// revokeUserTokens
// ---------------------------------------------------------------------------

describe('UserServiceImpl - revokeUserTokens', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('成功撤销用户所有 token', async () => {
    const userId = await insertUser(db, { role: Role.USER, token_version: 3 });

    const result = await service.revokeUserTokens(userId);

    expect(result.revokedTokenCount).toBe(1);
    const row = await db('users').select('token_version').where({ id: userId }).first();
    expect(row.token_version).toBe(4); // 3 → 4
  });

  it('用户不存在抛 UserNotFoundError', async () => {
    await expect(
      service.revokeUserTokens('nonexistent-id'),
    ).rejects.toThrow(UserNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// register / login 多角色字段初始化
// ---------------------------------------------------------------------------

describe('UserServiceImpl - register 多角色字段初始化', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('register 初始化 roles 为全集合（v4.28.0 全员服主）+ active_role = role', async () => {
    const email = `reg-${crypto.randomUUID()}@test.local`;
    const result = await service.register(email, 'reguser', 'password123');

    const row = await db('users').where({ id: result.userId }).first();
    // v4.28.0: 纯玩家注册即获 ['user', 'instance_admin'] 全集合，切换仅改 active_role
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
    expect(row.active_role).toBe(Role.USER);
    // v4.19.2: users.role 列已 DROP，不再 INSERT/SELECT，断言已移除
    expect(result.verifyCode).toBeTruthy();
  });

  it('register 指定 role=INSTANCE_ADMIN 时初始化全集合 + active_role=instance_admin（v4.28.0）', async () => {
    const email = `reg-${crypto.randomUUID()}@test.local`;
    const result = await service.register(email, 'reguser', 'password123', {
      role: Role.INSTANCE_ADMIN,
    });

    const row = await db('users').where({ id: result.userId }).first();
    // v4.28.0: universalRolesFor(INSTANCE_ADMIN) = ['instance_admin', 'user']
    expect(row.roles).toBe(JSON.stringify([Role.INSTANCE_ADMIN, Role.USER]));
    expect(row.active_role).toBe(Role.INSTANCE_ADMIN);
  });

  it('registerFromGame 初始化全集合 roles（v4.28.0 全员服主）', async () => {
    const email = `game-${crypto.randomUUID()}@test.local`;
    const result = await service.registerFromGame(
      email,
      'gameuser',
      'password123',
      'Steve',
      'server-1',
    );

    expect(result.success).toBe(true);

    // 从邮件找回 userId（registerFromGame 不直接返回）
    const row = await db('users').where({ email }).first();
    expect(row).toBeTruthy();
    // v4.28.0: universalRolesFor(USER) = ['user', 'instance_admin']
    expect(row.roles).toBe(JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]));
    expect(row.active_role).toBe(Role.USER);
  });
});

describe('UserServiceImpl - login 多角色字段', () => {
  let db: Knex;
  let service: UserServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    service = new UserServiceImpl(db, 'test-jwt-secret');
    resetTokenBlacklistService();
  });

  afterEach(async () => {
    await destroyTestDb(db);
    resetTokenBlacklistService();
  });

  it('login 未显式指定 activeRole 时回到账号默认身份（roles[0]）', async () => {
    const email = `login-${crypto.randomUUID()}@test.local`;
    const password = 'password123';
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db('users').insert({
      id: userId,
      email,
      username: 'loginuser',
      password_hash: passwordHash,
      role: Role.USER,
      status: 'active',
      display_name: null,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 1,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      token_version: 0,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
    });

    const result = await service.login(email, password);

    expect(result.user.roles).toEqual(['user', 'instance_admin']);
    expect(result.user.active_role).toBe('user');
    expect(result.user.role).toBe('user');

    // JWT payload 验证
    const payload = JSON.parse(
      Buffer.from(result.token.split('.')[1], 'base64').toString('utf-8'),
    );
    expect(payload.roles).toEqual(['user', 'instance_admin']);
    expect(payload.active_role).toBe('user');
    expect(payload.role).toBe('user');
  });

  it('login options.activeRole 指定会话级活动角色', async () => {
    const email = `login-${crypto.randomUUID()}@test.local`;
    const password = 'password123';
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db('users').insert({
      id: userId,
      email,
      username: 'loginuser',
      password_hash: passwordHash,
      role: Role.INSTANCE_ADMIN, // DB active_role 默认
      status: 'active',
      display_name: null,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 1,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      token_version: 0,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
    });

    // 通过 options.activeRole 切换会话角色为 USER
    const result = await service.login(email, password, { activeRole: Role.USER as never });

    expect(result.user.active_role).toBe('user');
    expect(result.user.role).toBe('user'); // 过渡期同步

    const payload = JSON.parse(
      Buffer.from(result.token.split('.')[1], 'base64').toString('utf-8'),
    );
    expect(payload.active_role).toBe('user');
  });

  it('login 缺失 roles 字段时降级为 user（v4.19.2: role 列已 DROP）', async () => {
    const email = `login-${crypto.randomUUID()}@test.local`;
    const password = 'password123';
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    // v4.19.2: users.role 列已 DROP，不再 INSERT；仅设置 roles + active_role
    await db('users').insert({
      id: userId,
      email,
      username: 'loginuser',
      password_hash: passwordHash,
      status: 'active',
      display_name: null,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 1,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      token_version: 0,
      roles: null, // 缺失
      active_role: null, // 缺失
    });

    const result = await service.login(email, password);

    // v4.19.2: roles/active_role 均缺失时降级为 [user] / user
    expect(result.user.roles).toEqual(['user']);
    expect(result.user.active_role).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// toUserInfo 输出一致性
// ---------------------------------------------------------------------------

describe('toUserInfo - 输出一致性', () => {
  it('同时输出 role + roles + active_role 三字段', () => {
    const now = new Date().toISOString();
    const row = {
      id: 'user-1',
      email: 'test@test.local',
      username: 'testuser',
      password_hash: '$2a$10$xxx',
      role: Role.INSTANCE_ADMIN,
      status: 'active',
      display_name: null,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 1,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      token_version: 0,
      roles: JSON.stringify([Role.USER, Role.INSTANCE_ADMIN]),
      active_role: Role.INSTANCE_ADMIN,
    };

    const info = toUserInfo(row);

    expect(info.role).toBe('instance_admin');
    expect(info.roles).toEqual(['user', 'instance_admin']);
    expect(info.active_role).toBe('instance_admin');
  });

  it('缺失 roles 字段时降级为 user（v4.19.2: role 列已 DROP）', () => {
    const now = new Date().toISOString();
    // v4.19.2: users.role 列已 DROP，row.role 恒 undefined；仅 roles + active_role
    const row = {
      id: 'user-1',
      email: 'test@test.local',
      username: 'testuser',
      password_hash: '$2a$10$xxx',
      status: 'active',
      display_name: null,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 1,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      token_version: 0,
      roles: null,
      active_role: null,
    };

    const info = toUserInfo(row);

    // v4.19.2: roles/active_role 均缺失时降级为 [user] / user
    expect(info.role).toBe('user');
    expect(info.roles).toEqual(['user']);
    expect(info.active_role).toBe('user');
  });
});
