// ============================================================================
// tokenBlacklist.ts — v4.17.0 JWT 黑名单服务（LRU + TTL）
//
// 用途：记录被显式撤销的 JWT（按 userId + token_version 维度），用于：
//   1. 角色变更后撤销该用户所有未过期 token（配合 token_version 机制双重保险）
//   2. 提供 revoked_token_count 指标（PUT /api/users/:id/roles 响应需要）
//   3. 关键操作前的 DB 二次校验（防御 JWT 在撤销窗口内被滥用）
//
// 设计：
//   - LRU 淘汰：避免内存无限增长，默认上限 10000 条
//   - TTL 自动过期：默认 25h（覆盖 JWT 24h 最大生命周期 + 1h 缓冲）
//   - 进程内 Map 实现（单实例 Panel 足够；P4 迁 PostgreSQL 后可改 DB 表）
//   - 与 users.token_version 机制互补：token_version 是"版本号比对"，
//     blacklist 是"显式撤销清单"，两者在 auth 中间件中先后校验
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3.4 + §4.2
// ============================================================================

import type { Knex } from 'knex';

interface BlacklistEntry {
  userId: string;
  tokenVersion: number;
  revokedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

const DEFAULT_TTL_MS = 25 * 60 * 60 * 1000; // 25h
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * JWT 黑名单服务（进程内 LRU + TTL）
 *
 * 使用 Map 的插入顺序特性实现简易 LRU：达到上限时删除最早插入的条目
 */
export class TokenBlacklistService {
  private entries = new Map<string, BlacklistEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * 生成 Map key（userId + tokenVersion 唯一标识一组被撤销的 token）
   */
  private makeKey(userId: string, tokenVersion: number): string {
    return `${userId}:${tokenVersion}`;
  }

  /**
   * 撤销指定用户的指定 token_version 对应的所有 token
   *
   * @returns 是否新增入黑名单（已存在则返回 false）
   */
  revokeTokenVersion(userId: string, tokenVersion: number): boolean {
    const key = this.makeKey(userId, tokenVersion);
    if (this.entries.has(key)) {
      return false;
    }

    const now = Date.now();
    this.entries.set(key, {
      userId,
      tokenVersion,
      revokedAt: now,
      expiresAt: now + this.ttlMs,
    });

    // LRU 淘汰：超过上限时删除最早插入的条目
    if (this.entries.size > this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) {
        this.entries.delete(firstKey);
      }
    }

    return true;
  }

  /**
   * 检查 token 是否在黑名单中
   */
  isBlacklisted(userId: string, tokenVersion: number): boolean {
    const key = this.makeKey(userId, tokenVersion);
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    // TTL 过期自动清理
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 撤销用户的所有 token（角色变更时调用）
   *
   * v4.19.0 R3-3 修复：SELECT + UPDATE 包进 knex transaction，避免 DB 异常 +
   * 旧用户（token_version=0）场景下黑名单失效。
   *
   * 流程（事务内）：
   *   1. SELECT users.token_version（FOR UPDATE 语义，SQLite 自动事务隔离）
   *   2. UPDATE users SET token_version = token_version + 1
   *   3. 返回旧 token_version（供调用方决定是否入黑名单）
   * 流程（事务外）：
   *   4. 将 (userId, old_token_version) 加入内存黑名单（不可回滚，须在事务提交后执行）
   *
   * @returns revoked_token_count（加入黑名单的版本数，0 或 1）
   *          事务异常时抛出，由调用方决定回滚/阻断策略（R3-11-2 依赖此契约）
   */
  async revokeAllUserTokens(db: Knex, userId: string): Promise<number> {
    // 事务内：SELECT + UPDATE（原子化，避免旧 token_version=0 场景下黑名单失效）
    const oldVersion = await db.transaction(async (trx) => {
      const user = await trx<{ id: string; token_version: number }>('users')
        .select('token_version')
        .where({ id: userId })
        .first();

      if (!user) {
        return null;
      }

      const currentVersion = user.token_version ?? 0;
      // token_version +1 使所有旧 JWT 失效（必须在事务内完成）
      await trx('users').where({ id: userId }).increment('token_version', 1);
      return currentVersion;
    });

    // 用户不存在：直接返回 0（与原契约一致）
    if (oldVersion === null) {
      return 0;
    }

    // 事务外：写入内存黑名单（无法回滚，须在事务提交后执行）
    // 即便黑名单写入失败（理论上不会），token_version 已递增，旧 JWT 仍会被
    // auth 中间件的 token_version 校验兜底拒绝，安全等级不降低
    const added = this.revokeTokenVersion(userId, oldVersion);
    return added ? 1 : 0;
  }

  /**
   * 清理过期条目（可由定时任务调用）
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * 获取当前黑名单大小（监控/调试用）
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 重置黑名单（仅测试用）
   */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * 单例实例（进程内共享）
 */
let singletonInstance: TokenBlacklistService | null = null;

export function getTokenBlacklistService(): TokenBlacklistService {
  if (!singletonInstance) {
    singletonInstance = new TokenBlacklistService();
  }
  return singletonInstance;
}

/**
 * 重置单例（仅测试用）
 */
export function resetTokenBlacklistService(): void {
  singletonInstance = null;
}
