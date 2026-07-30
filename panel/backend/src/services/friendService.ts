// ============================================================================
// friendService — 玩家好友系统服务（v4.8.0 L1）
// 表结构：friendships（见 db/migrations/20260803000002_create_friendships.ts）
//
// 设计要点：
// - sendRequest：单向创建 pending 记录（user_id=请求者, friend_user_id=目标）
// - acceptRequest：更新对方发给我的 pending 记录为 accepted
//   （记录方向：user_id=对方, friend_user_id=我）
// - rejectRequest：删除对方发给我的 pending 记录
// - listFriends：双向查 accepted 记录，JOIN users 取双方 username
// - listPendingRequests：查发给我的 pending 记录，JOIN users 取发起者 username
// - listOnlineFriends：listFriends + last_login_at 近期过滤（5 分钟内）
// - getFriendshipStatus：返回两人之间的关系状态（双向查）
//
// 注意：knex 查询使用 .where('col', val) 双参数形式（避免对象形式陷阱）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface FriendshipDbRow {
  id: string;
  user_id: string;
  friend_user_id: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
}

interface UserRow {
  id: string;
  username: string;
  vip_level: number;
  last_login_at: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// 公共类型（与 panel-api-types.ts 中的 Friendship / PendingFriendRequest 对齐）
// ---------------------------------------------------------------------------

export interface Friendship {
  id: string;
  user_id: string;
  friend_user_id: string;
  username: string;
  friend_username: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  accepted_at: string | null;
}

export interface PendingFriendRequest {
  id: string;
  from_user_id: string;
  from_username: string;
  created_at: string;
}

/**
 * v4.36.0-D8: 好友推荐项（同实例已绑定玩家，与 panel-api-types.FriendRecommendation 对齐）
 */
export interface FriendRecommendation {
  user_id: string;
  username: string;
  shared_instance_count: number;
  shared_server_names: string[];
}

export type FriendshipStatus = 'none' | 'pending' | 'accepted' | 'blocked';

// ---------------------------------------------------------------------------
// 错误（路由层捕获并映射为 PanelErrorCode）
// ---------------------------------------------------------------------------

export class FriendRequestSelfError extends Error {
  constructor() {
    super('FRIEND_REQUEST_SELF');
    this.name = 'FriendRequestSelfError';
  }
}

export class FriendUserNotFoundError extends Error {
  constructor() {
    super('FRIEND_USER_NOT_FOUND');
    this.name = 'FriendUserNotFoundError';
  }
}

export class FriendRequestAlreadyExistsError extends Error {
  constructor() {
    super('FRIEND_REQUEST_ALREADY_EXISTS');
    this.name = 'FriendRequestAlreadyExistsError';
  }
}

export class FriendNotFoundError extends Error {
  constructor() {
    super('FRIEND_NOT_FOUND');
    this.name = 'FriendNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/** 在线判定窗口：last_login_at 在 5 分钟内视为在线 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export class FriendService {
  constructor(
    private readonly db: Knex,
    private readonly logger: Logger,
  ) {}

  /**
   * 发送好友请求
   * @param userId 请求发起者
   * @param friendUserId 请求接收者
   * @throws {FriendRequestSelfError} 不能加自己
   * @throws {FriendUserNotFoundError} 目标用户不存在
   * @throws {FriendRequestAlreadyExistsError} 已是好友或已有 pending 请求
   */
  async sendRequest(userId: string, friendUserId: string): Promise<void> {
    if (userId === friendUserId) {
      throw new FriendRequestSelfError();
    }

    // 检查目标用户存在
    const target = await this.db<UserRow>('users')
      .select('id')
      .where('id', friendUserId)
      .first();
    if (!target) {
      throw new FriendUserNotFoundError();
    }

    // 检查是否已存在关系（任一方向，pending/accepted/blocked 均阻断重复请求）
    const existing = await this.db<FriendshipDbRow>('friendships')
      .where(function () {
        this.where('user_id', userId).andWhere('friend_user_id', friendUserId);
      })
      .orWhere(function () {
        this.where('user_id', friendUserId).andWhere('friend_user_id', userId);
      })
      .first();
    if (existing) {
      throw new FriendRequestAlreadyExistsError();
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await this.db<FriendshipDbRow>('friendships').insert({
        id,
        user_id: userId,
        friend_user_id: friendUserId,
        status: 'pending',
        created_at: now,
        accepted_at: null,
      });
    } catch (err) {
      // UNIQUE 冲突 → 已存在（并发场景兜底）
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId, friendUserId },
        'friendships insert 冲突，视为已存在',
      );
      throw new FriendRequestAlreadyExistsError();
    }
  }

  /**
   * 接受好友请求
   * 请求记录方向：user_id=对方(friendUserId), friend_user_id=我(userId), status=pending
   * @param userId 接受者（当前用户）
   * @param friendUserId 请求发起者
   * @throws {FriendNotFoundError} 无对应 pending 请求
   */
  async acceptRequest(userId: string, friendUserId: string): Promise<void> {
    const now = new Date().toISOString();
    const updated = await this.db<FriendshipDbRow>('friendships')
      .where('user_id', friendUserId)
      .andWhere('friend_user_id', userId)
      .andWhere('status', 'pending')
      .update({ status: 'accepted', accepted_at: now });
    if (updated === 0) {
      throw new FriendNotFoundError();
    }
  }

  /**
   * 拒绝好友请求（删除 pending 记录）
   * @param userId 拒绝者（当前用户）
   * @param friendUserId 请求发起者
   * @throws {FriendNotFoundError} 无对应 pending 请求
   */
  async rejectRequest(userId: string, friendUserId: string): Promise<void> {
    const deleted = await this.db<FriendshipDbRow>('friendships')
      .where('user_id', friendUserId)
      .andWhere('friend_user_id', userId)
      .andWhere('status', 'pending')
      .delete();
    if (deleted === 0) {
      throw new FriendNotFoundError();
    }
  }

  /**
   * 列出好友（accepted 状态，双向查）
   * JOIN users 取双方 username
   */
  async listFriends(userId: string): Promise<Friendship[]> {
    const rows = await this.db<FriendshipDbRow & { username: string; friend_username: string }>(
      'friendships as f',
    )
      .select(
        'f.id',
        'f.user_id',
        'f.friend_user_id',
        'f.status',
        'f.created_at',
        'f.accepted_at',
        'u1.username as username',
        'u2.username as friend_username',
      )
      .leftJoin('users as u1', 'f.user_id', 'u1.id')
      .leftJoin('users as u2', 'f.friend_user_id', 'u2.id')
      .where('f.status', 'accepted')
      .where(function () {
        this.where('f.user_id', userId).orWhere('f.friend_user_id', userId);
      })
      .orderBy('f.accepted_at', 'desc');

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      friend_user_id: r.friend_user_id,
      username: r.username,
      friend_username: r.friend_username,
      status: r.status as Friendship['status'],
      created_at: r.created_at,
      accepted_at: r.accepted_at,
    }));
  }

  /**
   * 列出待处理请求（发给我的 pending 请求）
   * JOIN users 取发起者 username
   */
  async listPendingRequests(userId: string): Promise<PendingFriendRequest[]> {
    const rows = await this.db<FriendshipDbRow & { from_username: string }>(
      'friendships as f',
    )
      .select('f.id', 'f.user_id as from_user_id', 'f.created_at', 'u.username as from_username')
      .leftJoin('users as u', 'f.user_id', 'u.id')
      .where('f.friend_user_id', userId)
      .andWhere('f.status', 'pending')
      .orderBy('f.created_at', 'desc');

    return rows.map((r) => ({
      id: r.id,
      from_user_id: r.from_user_id,
      from_username: r.from_username,
      created_at: r.created_at,
    }));
  }

  /**
   * 列出在线好友（listFriends + last_login_at 近期过滤）
   * 在线判定：好友方用户的 last_login_at 在 5 分钟内
   */
  async listOnlineFriends(userId: string): Promise<Friendship[]> {
    const friends = await this.listFriends(userId);
    if (friends.length === 0) return [];

    // 收集好友方用户 ID（非当前用户的另一方）
    const otherIds = friends.map((f) =>
      f.user_id === userId ? f.friend_user_id : f.user_id,
    );

    const users = await this.db<UserRow>('users')
      .select('id', 'last_login_at')
      .whereIn('id', otherIds);

    const onlineMap = new Map<string, boolean>();
    const now = Date.now();
    for (const u of users) {
      if (!u.last_login_at) {
        onlineMap.set(u.id, false);
        continue;
      }
      const ts = Date.parse(u.last_login_at);
      onlineMap.set(u.id, Number.isFinite(ts) && now - ts <= ONLINE_WINDOW_MS);
    }

    return friends.filter((f) => {
      const otherId = f.user_id === userId ? f.friend_user_id : f.user_id;
      return onlineMap.get(otherId) === true;
    });
  }

  /**
   * 删除好友（双向删除 accepted 记录）
   * @returns true=删除成功，false=记录不存在
   */
  async removeFriend(userId: string, friendUserId: string): Promise<boolean> {
    const deleted = await this.db<FriendshipDbRow>('friendships')
      .where(function () {
        this.where(function () {
          this.where('user_id', userId).andWhere('friend_user_id', friendUserId);
        });
        this.orWhere(function () {
          this.where('user_id', friendUserId).andWhere('friend_user_id', userId);
        });
      })
      .andWhere('status', 'accepted')
      .delete();
    return deleted > 0;
  }

  /**
   * 获取两人之间的关系状态（双向查）
   * @returns 'none' | 'pending' | 'accepted' | 'blocked'
   */
  async getFriendshipStatus(userId: string, otherUserId: string): Promise<FriendshipStatus> {
    if (userId === otherUserId) {
      return 'accepted';
    }
    const row = await this.db<FriendshipDbRow>('friendships')
      .where(function () {
        this.where(function () {
          this.where('user_id', userId).andWhere('friend_user_id', otherUserId);
        });
        this.orWhere(function () {
          this.where('user_id', otherUserId).andWhere('friend_user_id', userId);
        });
      })
      .first();
    if (!row) return 'none';
    return row.status as FriendshipStatus;
  }

  /**
   * v4.36.0-D8: 同实例已绑定玩家推荐（最小落地，不做算法推荐）
   *
   * 规则：
   * 1. 当前用户在实例上持有 verified 玩家绑定
   *    （bindings.binding_type='player', scope_type='instance', scope_ref=server_id）
   * 2. 推荐同一实例上其他 verified 绑定用户
   * 3. 排除已是好友 / 待处理请求 / 已拉黑（任一方向）
   *
   * @returns 按共同实例数降序、用户名升序，上限 20 条
   */
  async listRecommendations(userId: string): Promise<FriendRecommendation[]> {
    // 1. 我 verified 绑定的实例集合
    const myBindings = await this.db<{ scope_ref: string }>('bindings')
      .select('scope_ref')
      .where('user_id', userId)
      .andWhere('binding_type', 'player')
      .andWhere('scope_type', 'instance')
      .andWhere('verify_status', 'verified')
      .whereNotNull('scope_ref');
    const myServerIds = [...new Set(myBindings.map((r) => r.scope_ref))];
    if (myServerIds.length === 0) return [];

    // 2. 与我有关系（任一方向、任一状态）的用户集合——全部排除
    const related = await this.db<{ user_id: string; friend_user_id: string }>('friendships')
      .select('user_id', 'friend_user_id')
      .where(function () {
        this.where('user_id', userId).orWhere('friend_user_id', userId);
      });
    const excludedIds = new Set<string>([userId]);
    for (const r of related) {
      excludedIds.add(r.user_id);
      excludedIds.add(r.friend_user_id);
    }

    // 3. 同实例其他 verified 绑定用户（JOIN users 取用户名，JOIN servers 取实例名）
    const rows = await this.db<{
      user_id: string;
      username: string;
      scope_ref: string;
      server_name: string | null;
    }>('bindings as b')
      .select('b.user_id', 'u.username', 'b.scope_ref', 's.name as server_name')
      .leftJoin('users as u', 'b.user_id', 'u.id')
      .leftJoin('servers as s', 'b.scope_ref', 's.id')
      .where('b.binding_type', 'player')
      .andWhere('b.scope_type', 'instance')
      .andWhere('b.verify_status', 'verified')
      .whereIn('b.scope_ref', myServerIds)
      .whereNotIn('b.user_id', [...excludedIds]);

    // 4. 按用户聚合：共同实例去重计数 + 实例名收集（每用户最多 3 个）
    const SERVER_NAMES_CAP = 3;
    const byUser = new Map<string, { username: string; serverNames: Set<string> }>();
    for (const r of rows) {
      const entry = byUser.get(r.user_id) ?? { username: r.username, serverNames: new Set() };
      entry.username = r.username;
      if (r.server_name) entry.serverNames.add(r.server_name);
      byUser.set(r.user_id, entry);
    }

    const RECOMMENDATIONS_LIMIT = 20;
    return [...byUser.entries()]
      .map(([uid, e]) => {
        const names = [...e.serverNames].sort();
        return {
          user_id: uid,
          username: e.username,
          shared_instance_count: e.serverNames.size,
          shared_server_names: names.slice(0, SERVER_NAMES_CAP),
        };
      })
      .sort(
        (a, b) =>
          b.shared_instance_count - a.shared_instance_count ||
          a.username.localeCompare(b.username),
      )
      .slice(0, RECOMMENDATIONS_LIMIT);
  }
}
