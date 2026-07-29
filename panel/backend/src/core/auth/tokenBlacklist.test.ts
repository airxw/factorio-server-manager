// ============================================================================
// tokenBlacklist.test.ts — JWT 黑名单服务单元测试
// 覆盖：revokeTokenVersion / isBlacklisted / revokeAllUserTokens / cleanupExpired / LRU 淘汰 / TTL 过期
//
// 来源：v4.17.0 B7 阶段鉴权链路单元测试
// 重点覆盖 R3-3 SOFT_BLOCK 场景：revokeAllUserTokens 事务保护缺口
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import {
  TokenBlacklistService,
  getTokenBlacklistService,
  resetTokenBlacklistService,
} from './tokenBlacklist.js';

// ---------------------------------------------------------------------------
// 测试用 DB 工厂（仅 users 表，含 token_version 字段）
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
    table.integer('token_version').notNullable().defaultTo(0);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });
  return db;
}

async function destroyTestDb(db: Knex): Promise<void> {
  await db.destroy();
}

async function insertUser(db: Knex, overrides: Partial<{ id: string; email: string; token_version: number }> = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await db('users').insert({
    id,
    email: overrides.email ?? `user-${id}@test.local`,
    username: 'testuser',
    password_hash: '$2a$10$' + 'a'.repeat(53),
    role: 'user',
    status: 'active',
    token_version: overrides.token_version ?? 0,
    created_at: now,
    updated_at: now,
  });
  return id;
}

// 使用全局 crypto（Node 18+）
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// TokenBlacklistService（构造函数注入，无 DB 依赖部分）
// ---------------------------------------------------------------------------

describe('TokenBlacklistService - 内存黑名单基础操作', () => {
  let service: TokenBlacklistService;

  beforeEach(() => {
    service = new TokenBlacklistService({ ttlMs: 1000, maxEntries: 3 });
  });

  it('revokeTokenVersion 首次撤销返回 true', () => {
    expect(service.revokeTokenVersion('user-1', 1)).toBe(true);
  });

  it('revokeTokenVersion 重复撤销返回 false', () => {
    service.revokeTokenVersion('user-1', 1);
    expect(service.revokeTokenVersion('user-1', 1)).toBe(false);
  });

  it('isBlacklisted 命中已撤销返回 true', () => {
    service.revokeTokenVersion('user-1', 1);
    expect(service.isBlacklisted('user-1', 1)).toBe(true);
  });

  it('isBlacklisted 未撤销返回 false', () => {
    expect(service.isBlacklisted('user-1', 1)).toBe(false);
    service.revokeTokenVersion('user-1', 1);
    expect(service.isBlacklisted('user-1', 2)).toBe(false); // 不同 token_version
    expect(service.isBlacklisted('user-2', 1)).toBe(false); // 不同 userId
  });

  it('TTL 过期后 isBlacklisted 返回 false 并清理条目', () => {
    service.revokeTokenVersion('user-1', 1);
    expect(service.isBlacklisted('user-1', 1)).toBe(true);

    // 推进时间 1.1s（TTL=1000ms）
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    expect(service.isBlacklisted('user-1', 1)).toBe(false);
    vi.useRealTimers();
  });

  it('LRU 淘汰：超过 maxEntries 时删除最早插入的条目', () => {
    // maxEntries = 3
    service.revokeTokenVersion('user-1', 1);
    service.revokeTokenVersion('user-2', 1);
    service.revokeTokenVersion('user-3', 1);
    expect(service.size).toBe(3);

    // 插入第 4 条，触发 LRU 淘汰 user-1
    service.revokeTokenVersion('user-4', 1);
    expect(service.size).toBe(3);
    expect(service.isBlacklisted('user-1', 1)).toBe(false); // 被淘汰
    expect(service.isBlacklisted('user-4', 1)).toBe(true);
  });

  it('cleanupExpired 清理所有过期条目', () => {
    service.revokeTokenVersion('user-1', 1);
    service.revokeTokenVersion('user-2', 1);

    vi.useFakeTimers();
    vi.advanceTimersByTime(1100); // 全部过期

    const cleaned = service.cleanupExpired();
    expect(cleaned).toBe(2);
    expect(service.size).toBe(0);
    vi.useRealTimers();
  });

  it('cleanupExpired 未过期时返回 0', () => {
    service.revokeTokenVersion('user-1', 1);
    expect(service.cleanupExpired()).toBe(0);
    expect(service.size).toBe(1);
  });

  it('size 属性反映当前条目数', () => {
    expect(service.size).toBe(0);
    service.revokeTokenVersion('user-1', 1);
    expect(service.size).toBe(1);
    service.revokeTokenVersion('user-2', 1);
    expect(service.size).toBe(2);
  });

  it('clear 重置黑名单（仅测试用）', () => {
    service.revokeTokenVersion('user-1', 1);
    service.revokeTokenVersion('user-2', 1);
    expect(service.size).toBe(2);

    service.clear();
    expect(service.size).toBe(0);
    expect(service.isBlacklisted('user-1', 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// revokeAllUserTokens（DB 操作）
// ---------------------------------------------------------------------------

describe('TokenBlacklistService - revokeAllUserTokens (DB 集成)', () => {
  let db: Knex;
  let service: TokenBlacklistService;

  beforeEach(async () => {
    db = await createTestDb();
    service = new TokenBlacklistService({ ttlMs: 25 * 60 * 60 * 1000, maxEntries: 10000 });
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  it('成功撤销：加入黑名单 + token_version+1', async () => {
    const userId = await insertUser(db, { token_version: 5 });

    const count = await service.revokeAllUserTokens(db, userId);
    expect(count).toBe(1); // 新增入黑名单

    // 验证 token_version 已 +1
    const user = await db('users').select('token_version').where({ id: userId }).first();
    expect(user.token_version).toBe(6);

    // 验证 (userId, 5) 已在黑名单
    expect(service.isBlacklisted(userId, 5)).toBe(true);
  });

  it('用户不存在时返回 0', async () => {
    const count = await service.revokeAllUserTokens(db, 'nonexistent-user-id');
    expect(count).toBe(0);
  });

  it('token_version=0 的旧用户：加入黑名单 + token_version 升为 1', async () => {
    const userId = await insertUser(db, { token_version: 0 });

    const count = await service.revokeAllUserTokens(db, userId);
    expect(count).toBe(1);

    const user = await db('users').select('token_version').where({ id: userId }).first();
    expect(user.token_version).toBe(1);

    expect(service.isBlacklisted(userId, 0)).toBe(true);
  });

  it('R3-3 修复：DB 异常时事务失败抛出异常（不再静默降级返回 0）', async () => {
    const userId = await insertUser(db, { token_version: 5 });

    // 销毁 DB 模拟 DB 异常
    await destroyTestDb(db);
    // 重新创建一个空 DB（无 users 表）模拟查询失败
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    // v4.19.0 R3-3 修复：原 SOFT_BLOCK 行为（静默降级返回 0）已修复
    // 现在事务失败时异常向上抛出，由调用方决定回滚/阻断策略（R3-11-2 依赖此契约）
    await expect(service.revokeAllUserTokens(db, userId)).rejects.toThrow();

    // 黑名单未变化（事务失败，未到达内存黑名单写入步骤）
    expect(service.isBlacklisted(userId, 5)).toBe(false);
  });

  it('R3-3 SOFT_BLOCK 场景：重复撤销同一 token_version 返回 0', async () => {
    const userId = await insertUser(db, { token_version: 5 });

    const firstCount = await service.revokeAllUserTokens(db, userId);
    expect(firstCount).toBe(1);

    // token_version 已升为 6，再次撤销应针对新版本
    const secondCount = await service.revokeAllUserTokens(db, userId);
    expect(secondCount).toBe(1); // 新版本 6 又加入黑名单

    // 验证两个版本都在黑名单
    expect(service.isBlacklisted(userId, 5)).toBe(true);
    expect(service.isBlacklisted(userId, 6)).toBe(true);

    // token_version 已升为 7
    const user = await db('users').select('token_version').where({ id: userId }).first();
    expect(user.token_version).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 单例工厂
// ---------------------------------------------------------------------------

describe('getTokenBlacklistService / resetTokenBlacklistService', () => {
  afterEach(() => {
    resetTokenBlacklistService();
  });

  it('getTokenBlacklistService 返回单例', () => {
    const s1 = getTokenBlacklistService();
    const s2 = getTokenBlacklistService();
    expect(s1).toBe(s2);
  });

  it('resetTokenBlacklistService 后获取新实例', () => {
    const s1 = getTokenBlacklistService();
    resetTokenBlacklistService();
    const s2 = getTokenBlacklistService();
    expect(s1).not.toBe(s2);
  });
});
