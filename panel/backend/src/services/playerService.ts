// ============================================================================
// playerService — 玩家加入设置 / 玩家绑定 / 玩家历史 / 礼包领取记录（P3）
// 数据契约：public/schema/panel-api-types.ts（PlayerJoinSettingsSummary 等）
// 表结构：
//   player_join_settings  (id, server_id UNIQUE, welcome_message, gift_enabled,
//                          gift_item, gift_count, gift_quality, updated_at)
//   player_histories      (id, server_id, game_player_name, joined_at, left_at,
//                          ip_address, session_duration, created_at)
//   gift_claims           (id, server_id, user_id, game_player_name,
//                          claim_type, claimed_at)
//   v4.17.0: player_bindings 已物理删除，全部数据统一到 bindings 表
//            (binding_type='player', scope_type='game_type' 表示跨实例全局玩家绑定)
//   v4.27.0: scope_type 由 'game_type' 改为 'instance'，scope_ref 含义由 game_type 改为 server_id
//            （玩家角色绑定从跨实例全局语义迁移至实例级语义）
// 来源：P3 任务清单 §玩家加入 / 玩家绑定 / 玩家历史 / 礼包领取
//
// 说明：本服务按 P3 任务清单要求实现，依赖通过 req.app.locals.playerService 注入。
//
// v4.17.0 改造：
// - 旧表 player_bindings 已物理删除，全部数据统一到 bindings 表
// - 旧表字段映射：
//   * player_bindings.user_id          ↔ bindings.user_id
//   * player_bindings.game_player_name ↔ bindings.player_name
//   * player_bindings.game_type        ↔ bindings.scope_ref (binding_type='player', scope_type='game_type')
//   * player_bindings.verify_code      ↔ bindings.verify_code
//   * player_bindings.status           ↔ bindings.verify_status ('pending'→'pending', 'verified'→'verified', 'rejected'→'revoked')
//   * player_bindings.verified_at      ↔ bindings.verified_at
//   * player_bindings.created_at       ↔ bindings.created_at
//   * player_bindings.updated_at      ↔ bindings.updated_at
//
// v4.27.0 改造：
// - 玩家角色绑定从 scope_type='game_type'（跨实例全局）改为 scope_type='instance', scope_ref=server_id（实例级）
// - 旧 scope_type='game_type' 的 player 绑定记录由迁移脚本 20260727100000 物理删除
// - createBinding 增加 server 存在性校验 + verify_code 5 分钟 TTL（对齐 instanceBindingService.VERIFY_CODE_TTL_MS）
// v4.19.3 M3.4 改造：
// - PlayerBindingSummary 类型已物理删除，listBindings/createBinding/verifyBinding/rejectBinding
//   直接返回统一 `Binding` 契约（verify_status 使用 'pending'|'verified'|'expired'|'revoked'）
// - 删除 bindingRowToPlayerBindingRow / verifyStatusToStatus / toPlayerBindingSummary 转换函数
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import {
  PlayerBindingNotFoundError,
  PlayerBindingAlreadyExistsError,
  PlayerBindingVerifyCodeInvalidError,
  PlayerBindingNotPendingError,
  FileOperationError,
} from './errors.js';
import type {
  PlayerJoinSettingsSummary,
  UpsertPlayerJoinSettingsRequest,
  Binding,
  CreatePlayerBindingRequest,
  VerifyPlayerBindingRequest,
  PlayerHistorySummary,
  GiftClaimSummary,
  GiftClaimType,
  ReloginGiftItem,
  VipWelcomeMessage,
} from '@public/schema/panel-api-types';
import type {
  BindingType,
  BindingScopeType,
  BindingVerifyStatus,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** verify_code 长度（取自 UUID 前 8 位大写） */
const VERIFY_CODE_LEN = 8;

/** v4.27.0: createBinding 生成的 verify_code TTL（5 分钟，对齐 instanceBindingService.VERIFY_CODE_TTL_MS） */
const VERIFY_CODE_TTL_MS = 5 * 60 * 1000;

/** C16: join/leave 防抖窗口（毫秒），同一玩家 2s 内的重复事件仅保留最后一次 */
const DEBOUNCE_WINDOW_MS = 2000;

// ----- DB 行类型 -----

interface PlayerJoinSettingsRow {
  id: number;
  server_id: string;
  welcome_message: string | null;
  gift_enabled: number; // SQLite boolean as 0/1
  gift_item: string | null;
  gift_count: number | null;
  gift_quality: string | null;
  // Task 1 契约扩展：leave_message 字段（DB 列由 Task 2 迁移添加，在此之前可能为 undefined）
  leave_message?: string | null;
  // P3 回归礼包字段（DB 列由 20260716140000 迁移添加，在此之前可能为 undefined）
  relogin_gift_enabled?: number; // SQLite boolean as 0/1
  relogin_gift_items?: string | null; // JSON 文本
  relogin_cooldown_hours?: number | null;
  relogin_daily_limit?: number | null;
  relogin_total_limit?: number | null;
  // P4 VIP 专属欢迎语（JSON 文本）
  vip_welcome_messages?: string | null;
  updated_at: string;
}

/**
 * v4.17.0: 统一 bindings 表行类型（仅声明玩家全局绑定相关字段）。
 * v4.19.3 M3.4: wallet_id 在 SQLite 可能返回 string，由 bindingRowToBinding 做 Number 转换。
 */
interface BindingRow {
  id: number;
  user_id: string;
  binding_type: string;
  scope_type: string;
  scope_ref: string | null;
  player_name: string | null;
  vip_level: number;
  wallet_id: string | null;
  verify_status: string;
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/**
 * v4.19.3 M3.4: 统一 bindings 表行 → Binding 契约转换。
 * 处理 SQLite 返回类型差异（wallet_id string → number, verify_status/binding_type/scope_type string → 联合类型）。
 */
function bindingRowToBinding(row: BindingRow): Binding {
  return {
    id: row.id,
    user_id: row.user_id,
    binding_type: row.binding_type as BindingType,
    scope_type: row.scope_type as BindingScopeType,
    scope_ref: row.scope_ref,
    player_name: row.player_name,
    vip_level: row.vip_level,
    wallet_id: row.wallet_id === null ? null : Number(row.wallet_id),
    verify_status: row.verify_status as BindingVerifyStatus,
    verify_code: row.verify_code,
    verify_expires_at: row.verify_expires_at,
    verified_at: row.verified_at,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface PlayerHistoryRow {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
  ip_address: string | null;
  session_duration: number | null;
  created_at: string;
}

/** v4.27.0: servers 表所需字段视图（createBinding 校验 server 存在性使用） */
interface ServerRow {
  id: string;
}

interface GiftClaimRow {
  id: number;
  server_id: string;
  user_id: string;
  game_player_name: string;
  claim_type: string;
  claimed_at: string;
}

// ----- 服务实现 -----

export class PlayerServiceImpl {
  /** C16: join/leave 防抖追踪 Map: key = `${serverId}:${gamePlayerName}:${action}` */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly db: Knex) {}

  // ---- 玩家加入设置 ----

  async getJoinSettings(serverId: string): Promise<PlayerJoinSettingsSummary> {
    const row = await this.db<PlayerJoinSettingsRow>('player_join_settings')
      .where({ server_id: serverId })
      .first();
    if (!row) {
      // 不存在返回默认值
      return {
        server_id: serverId,
        welcome_message: null,
        gift_enabled: false,
        gift_item: null,
        gift_count: null,
        gift_quality: null,
        leave_message: null,
        relogin_gift_enabled: false,
        relogin_gift_items: null,
        relogin_cooldown_hours: 24,
        relogin_daily_limit: 1,
        relogin_total_limit: null,
        vip_welcome_messages: null,
        updated_at: new Date().toISOString(),
      };
    }
    return toPlayerJoinSettingsSummary(row);
  }

  async upsertJoinSettings(
    serverId: string,
    patch: UpsertPlayerJoinSettingsRequest,
  ): Promise<PlayerJoinSettingsSummary> {
    const nowIso = new Date().toISOString();

    // 构造 merge 字段：仅传递已提供的字段，保留未传字段
    const merge: Partial<PlayerJoinSettingsRow> = { updated_at: nowIso };
    if (patch.welcome_message !== undefined) merge.welcome_message = patch.welcome_message;
    if (patch.gift_enabled !== undefined) merge.gift_enabled = patch.gift_enabled ? 1 : 0;
    if (patch.gift_item !== undefined) merge.gift_item = patch.gift_item;
    if (patch.gift_count !== undefined) merge.gift_count = patch.gift_count;
    if (patch.gift_quality !== undefined) merge.gift_quality = patch.gift_quality;
    if (patch.leave_message !== undefined) merge.leave_message = patch.leave_message;
    // P3 回归礼包
    if (patch.relogin_gift_enabled !== undefined) merge.relogin_gift_enabled = patch.relogin_gift_enabled ? 1 : 0;
    if (patch.relogin_gift_items !== undefined) {
      merge.relogin_gift_items = patch.relogin_gift_items ? JSON.stringify(patch.relogin_gift_items) : null;
    }
    if (patch.relogin_cooldown_hours !== undefined) merge.relogin_cooldown_hours = patch.relogin_cooldown_hours;
    if (patch.relogin_daily_limit !== undefined) merge.relogin_daily_limit = patch.relogin_daily_limit;
    if (patch.relogin_total_limit !== undefined) merge.relogin_total_limit = patch.relogin_total_limit;
    // P4 VIP 专属欢迎语
    if (patch.vip_welcome_messages !== undefined) {
      merge.vip_welcome_messages = patch.vip_welcome_messages ? JSON.stringify(patch.vip_welcome_messages) : null;
    }

    const insert: Partial<PlayerJoinSettingsRow> = {
      server_id: serverId,
      welcome_message: patch.welcome_message ?? null,
      gift_enabled: (patch.gift_enabled ?? false) ? 1 : 0,
      gift_item: patch.gift_item ?? null,
      gift_count: patch.gift_count ?? null,
      gift_quality: patch.gift_quality ?? null,
      leave_message: patch.leave_message ?? null,
      relogin_gift_enabled: (patch.relogin_gift_enabled ?? false) ? 1 : 0,
      relogin_gift_items: patch.relogin_gift_items ? JSON.stringify(patch.relogin_gift_items) : null,
      relogin_cooldown_hours: patch.relogin_cooldown_hours ?? 24,
      relogin_daily_limit: patch.relogin_daily_limit ?? 1,
      relogin_total_limit: patch.relogin_total_limit ?? null,
      vip_welcome_messages: patch.vip_welcome_messages ? JSON.stringify(patch.vip_welcome_messages) : null,
      updated_at: nowIso,
    };

    const inserted = await this.db<PlayerJoinSettingsRow>('player_join_settings')
      .insert(insert)
      .onConflict(['server_id'] as never)
      .merge(merge)
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toPlayerJoinSettingsSummary(row);
  }

  // ---- 玩家绑定 ----

  /**
   * 列出玩家绑定。
   * v4.17.0 实现：从统一 bindings 表查询 binding_type='player', scope_type='game_type' 的记录。
   * v4.27.0 改造：scope_type 由 'game_type' 改为 'instance'（玩家角色绑定实例级语义）。
   *
   * @param forUserId 可选——提供时仅返回该用户的绑定（玩家自助视角）；
   *                  缺省时返回全部绑定（server_admin 管理视角）。
   */
  async listBindings(forUserId?: string): Promise<Binding[]> {
    const query = this.db<BindingRow>('bindings')
      .where({
        binding_type: 'player',
        scope_type: 'instance',
      })
      .orderBy('created_at', 'desc');
    if (forUserId) {
      query.where({ user_id: forUserId });
    }
    const rows = await query;
    return rows.map(bindingRowToBinding);
  }

  async createBinding(
    userId: string,
    req: CreatePlayerBindingRequest,
  ): Promise<Binding> {
    // v4.27.0: 校验 server_id 存在（参考 verifyCodes.ts 行 88-98 写法）
    // 不存在抛 FileOperationError('SERVER_NOT_FOUND', ...)（路由层 ERROR_CODE_TO_STATUS 映射 404）
    const server = await this.db<ServerRow>('servers')
      .select('id')
      .where({ id: req.server_id })
      .first();
    if (!server) {
      throw new FileOperationError(
        'SERVER_NOT_FOUND',
        `实例不存在: ${req.server_id}`,
      );
    }

    // v4.27.0: 检查 (user_id, server_id) 是否已有 verified/pending 记录
    // scope_type 由 'game_type' 改为 'instance'，scope_ref 含义由 game_type 改为 server_id
    const existing = await this.db<BindingRow>('bindings')
      .where({
        user_id: userId,
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: req.server_id,
      })
      .whereIn('verify_status', ['verified', 'pending'])
      .first();
    if (existing) {
      throw new PlayerBindingAlreadyExistsError(
        `用户 ${userId} 已存在 ${req.server_id} 的 ${existing.verify_status} 绑定记录`,
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = new Date(now.getTime() + VERIFY_CODE_TTL_MS).toISOString();
    const verifyCode = generateVerifyCode();

    try {
      const inserted = await this.db<BindingRow>('bindings')
        .insert({
          user_id: userId,
          binding_type: 'player',
          scope_type: 'instance',
          scope_ref: req.server_id,
          player_name: req.game_player_name,
          vip_level: 0,
          wallet_id: null,
          verify_status: 'pending',
          verify_code: verifyCode,
          // v4.27.0: 加 5 分钟 TTL（对齐 instanceBindingService.VERIFY_CODE_TTL_MS）
          verify_expires_at: expiresAtIso,
          verified_at: null,
          metadata: JSON.stringify({ source: 'playerService.createBinding' }),
          created_at: nowIso,
          updated_at: nowIso,
        })
        .returning('*');
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return bindingRowToBinding(row);
    } catch (err) {
      // UNIQUE 约束冲突 → AlreadyExists
      if (isUniqueConstraintError(err)) {
        throw new PlayerBindingAlreadyExistsError(
          `绑定已存在（user_id=${userId}, server_id=${req.server_id} 或 game_player_name 已被占用）`,
        );
      }
      throw err;
    }
  }

  /**
   * 验证玩家绑定。
   * v4.17.0 实现：从 bindings 表查询，更新 verify_status='verified'。
   * v4.27.0 改造：scope_type 由 'game_type' 改为 'instance'。
   *
   * @param forUserId 可选——提供时校验绑定归属该用户（玩家自助视角）；
   *                  归属不匹配抛 NotFound（404 而非 403，不泄露他人绑定存在性）。
   */
  async verifyBinding(
    id: number,
    req: VerifyPlayerBindingRequest,
    forUserId?: string,
  ): Promise<Binding> {
    const row = await this.db<BindingRow>('bindings')
      .where({
        id,
        binding_type: 'player',
        scope_type: 'instance',
      })
      .first();
    if (!row || (forUserId && row.user_id !== forUserId)) {
      throw new PlayerBindingNotFoundError(`玩家绑定记录不存在: id=${id}`);
    }
    if (row.verify_status !== 'pending') {
      throw new PlayerBindingNotPendingError(
        `绑定记录非 pending 状态，无法审核: id=${id}, verify_status=${row.verify_status}`,
      );
    }
    if (row.verify_code !== req.verify_code) {
      throw new PlayerBindingVerifyCodeInvalidError(
        `验证码不正确: id=${id}`,
      );
    }

    const nowIso = new Date().toISOString();
    const updated = await this.db<BindingRow>('bindings')
      .where({ id })
      .update({ verify_status: 'verified', verified_at: nowIso, updated_at: nowIso })
      .returning('*');
    const result = Array.isArray(updated) ? updated[0] : updated;
    return bindingRowToBinding(result);
  }

  /**
   * 拒绝玩家绑定（v4.17.0: 拒绝 = 软删除，verify_status='revoked'）。
   * v4.19.3 M3.4: 直接返回 Binding 契约，verify_status='revoked'。
   * v4.27.0 改造：scope_type 由 'game_type' 改为 'instance'。
   */
  async rejectBinding(id: number): Promise<Binding> {
    const row = await this.db<BindingRow>('bindings')
      .where({
        id,
        binding_type: 'player',
        scope_type: 'instance',
      })
      .first();
    if (!row) {
      throw new PlayerBindingNotFoundError(`玩家绑定记录不存在: id=${id}`);
    }
    if (row.verify_status !== 'pending') {
      throw new PlayerBindingNotPendingError(
        `绑定记录非 pending 状态，无法审核: id=${id}, verify_status=${row.verify_status}`,
      );
    }

    const nowIso = new Date().toISOString();
    const updated = await this.db<BindingRow>('bindings')
      .where({ id })
      .update({ verify_status: 'revoked', updated_at: nowIso })
      .returning('*');
    const result = Array.isArray(updated) ? updated[0] : updated;
    return bindingRowToBinding(result);
  }

  /**
   * 删除玩家绑定（物理删除）。
   * v4.17.0 实现：从 bindings 表物理删除（区别于 rejectBinding 的软删除）。
   * v4.27.0 改造：scope_type 由 'game_type' 改为 'instance'。
   *
   * @param forUserId 可选——提供时校验绑定归属该用户（玩家自助视角）；
   *                  归属不匹配抛 NotFound（404 而非 403，不泄露他人绑定存在性）。
   */
  async deleteBinding(id: number, forUserId?: string): Promise<void> {
    const row = await this.db<BindingRow>('bindings')
      .where({
        id,
        binding_type: 'player',
        scope_type: 'instance',
      })
      .first();
    if (!row || (forUserId && row.user_id !== forUserId)) {
      throw new PlayerBindingNotFoundError(`玩家绑定记录不存在: id=${id}`);
    }
    await this.db<BindingRow>('bindings').where({ id }).delete();
  }

  // ---- 玩家历史 ----

  async listHistories(serverId: string): Promise<PlayerHistorySummary[]> {
    const rows = await this.db<PlayerHistoryRow>('player_histories')
      .where({ server_id: serverId })
      .orderBy('joined_at', 'desc');
    return rows.map(toPlayerHistorySummary);
  }

  /**
   * 记录玩家加入（Task 10.2 扩展）。
   * 由 eventBus 订阅 player_join 事件自动调用，或由 chatLogService 解析 stdout 后触发。
   *
   * @param serverId 实例 ID
   * @param gamePlayerName 玩家游戏内名
   * @param ipAddress 可选 IP 地址
   * @returns 新建的 player_histories 记录
   */
  async recordJoin(
    serverId: string,
    gamePlayerName: string,
    ipAddress?: string,
  ): Promise<PlayerHistorySummary> {
    const nowIso = new Date().toISOString();
    const inserted = await this.db<PlayerHistoryRow>('player_histories')
      .insert({
        server_id: serverId,
        game_player_name: gamePlayerName,
        joined_at: nowIso,
        left_at: null,
        ip_address: ipAddress ?? null,
        session_duration: null,
        created_at: nowIso,
      })
      .returning('*');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toPlayerHistorySummary(row);
  }

  /**
   * 记录玩家离开（Task 10.2 扩展）。
   * 查找该玩家最近一条 left_at = null 的记录，更新 left_at + 计算 session_duration。
   *
   * @param serverId 实例 ID
   * @param gamePlayerName 玩家游戏内名
   * @returns 更新后的记录；若不存在未关闭的会话返回 null
   */
  async recordLeave(
    serverId: string,
    gamePlayerName: string,
  ): Promise<PlayerHistorySummary | null> {
    const existing = await this.db<PlayerHistoryRow>('player_histories')
      .where({
        server_id: serverId,
        game_player_name: gamePlayerName,
        left_at: null,
      })
      .orderBy('joined_at', 'desc')
      .first();
    if (!existing) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const joinedAt = new Date(existing.joined_at).getTime();
    const sessionDuration = Math.floor((Date.now() - joinedAt) / 1000); // 秒

    const updated = await this.db<PlayerHistoryRow>('player_histories')
      .where({ id: existing.id })
      .update({
        left_at: nowIso,
        session_duration: sessionDuration,
      })
      .returning('*');
    const row = Array.isArray(updated) ? updated[0] : updated;
    return toPlayerHistorySummary(row);
  }

  // ---- C16: join/leave 防抖（2s 窗口覆盖式） ----

  /**
   * C16: 防抖记录玩家加入（2s 窗口覆盖式）。
   *
   * 同一玩家在 2s 内的多次 join 事件仅保留最后一次，避免游戏日志重复解析
   * 导致 player_histories 表出现重复会话记录。
   *
   * 行为：
   *   - 收到 join 事件后，启动 2s 定时器
   *   - 2s 内若同一玩家再次 join，清除旧定时器，以最新数据重新计时
   *   - 2s 内无新 join 事件 → 执行实际 recordJoin
   *
   * @param serverId 实例 ID
   * @param gamePlayerName 玩家游戏内名
   * @param ipAddress 可选 IP 地址（覆盖式：最新值生效）
   */
  recordJoinDebounced(
    serverId: string,
    gamePlayerName: string,
    ipAddress?: string,
  ): void {
    const key = `${serverId}:${gamePlayerName}:join`;
    // 清除已有定时器（覆盖式）
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    // 设置新定时器
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.recordJoin(serverId, gamePlayerName, ipAddress).catch((err) => {
        console.error(
          `[playerService] 防抖 recordJoin 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, DEBOUNCE_WINDOW_MS);
    this.debounceTimers.set(key, timer);
  }

  /**
   * C16: 防抖记录玩家离开（2s 窗口覆盖式）。
   *
   * 同一玩家在 2s 内的多次 leave 事件仅保留最后一次。
   *
   * @param serverId 实例 ID
   * @param gamePlayerName 玩家游戏内名
   */
  recordLeaveDebounced(
    serverId: string,
    gamePlayerName: string,
  ): void {
    const key = `${serverId}:${gamePlayerName}:leave`;
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.recordLeave(serverId, gamePlayerName).catch((err) => {
        console.error(
          `[playerService] 防抖 recordLeave 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, DEBOUNCE_WINDOW_MS);
    this.debounceTimers.set(key, timer);
  }

  // ---- C17: 变量替换引擎 ----

  /**
   * C17: 渲染欢迎语/离开消息的变量替换引擎。
   *
   * 支持的变量：
   *   {{player_name}}  - 玩家游戏内名
   *   {{server_id}}    - 服务器 ID
   *   {{ip_address}}   - 玩家 IP 地址（可能为空）
   *   {{online_count}} - 当前在线玩家数（实时查询 player_histories）
   *   {{timestamp}}    - 当前 ISO 时间戳
   *   {{date}}         - 当前日期 YYYY-MM-DD
   *   {{time}}         - 当前时间 HH:MM:SS
   *
   * @param template 模板字符串（含 {{var}} 占位符），null 返回 null
   * @param vars 变量值映射
   * @returns 渲染后的字符串，未知变量保持原样
   */
  async renderMessage(
    template: string | null,
    vars: {
      player_name: string;
      server_id: string;
      ip_address?: string;
    },
  ): Promise<string | null> {
    if (!template) return null;

    const now = new Date();
    // 查询当前在线人数
    const onlineCountRow = await this.db<PlayerHistoryRow>('player_histories')
      .where({ server_id: vars.server_id, left_at: null })
      .count('id as cnt')
      .first();
    const onlineCount = Number(
      (onlineCountRow as unknown as { cnt: number })?.cnt ?? 0,
    );

    const varMap: Record<string, string> = {
      player_name: vars.player_name,
      server_id: vars.server_id,
      ip_address: vars.ip_address ?? '',
      online_count: String(onlineCount),
      timestamp: now.toISOString(),
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 8),
    };

    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(varMap, key) ? varMap[key] : match,
    );
  }

  // ---- 礼包领取记录 ----

  async listGiftClaims(serverId: string): Promise<GiftClaimSummary[]> {
    const rows = await this.db<GiftClaimRow>('gift_claims')
      .where({ server_id: serverId })
      .orderBy('claimed_at', 'desc');
    return rows.map(toGiftClaimSummary);
  }

  /**
   * 检查今日是否已领取过指定类型的礼包（按 ISO 日期前缀 YYYY-MM-DD 比较）。
   * 用于 PLAYER_JOIN 触发的 welcome_gift 防重复领取。
   */
  async hasClaimedToday(
    serverId: string,
    gamePlayerName: string,
    claimType: GiftClaimType,
  ): Promise<boolean> {
    const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const row = await this.db<GiftClaimRow>('gift_claims')
      .where({
        server_id: serverId,
        game_player_name: gamePlayerName,
        claim_type: claimType,
      })
      .whereLike('claimed_at', `${todayPrefix}%`)
      .select('id')
      .first();
    return !!row;
  }

  /**
   * 记录礼包领取。
   * userId 可选（玩家加入事件触发时无 user_id，用 'system' 占位）。
   */
  async recordGiftClaim(
    serverId: string,
    gamePlayerName: string,
    claimType: GiftClaimType,
    userId?: string,
  ): Promise<GiftClaimSummary> {
    const nowIso = new Date().toISOString();
    const inserted = await this.db<GiftClaimRow>('gift_claims')
      .insert({
        server_id: serverId,
        user_id: userId ?? 'system',
        game_player_name: gamePlayerName,
        claim_type: claimType,
        claimed_at: nowIso,
      })
      .returning('*');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toGiftClaimSummary(row);
  }

  /**
   * P3: 检查指定礼包类型的历史总领取次数（不限日期）。
   * 用于回归礼包的总限额约束。
   */
  async hasClaimedTotalCount(
    serverId: string,
    gamePlayerName: string,
    claimType: GiftClaimType,
  ): Promise<number> {
    const countRow = await this.db<GiftClaimRow>('gift_claims')
      .where({
        server_id: serverId,
        game_player_name: gamePlayerName,
        claim_type: claimType,
      })
      .count('id as cnt')
      .first();
    return Number((countRow as unknown as { cnt: number })?.cnt ?? 0);
  }

  /**
   * P3: 查询玩家在指定服务器的最后离开时间。
   * 用于回归礼包的离线时长判断：当前时间 - 最后离开时间 >= relogin_cooldown_hours 才触发。
   *
   * @returns 最后离开时间（ISO 字符串），无历史记录或当前仍在线返回 null
   */
  async getLastLeaveTime(
    serverId: string,
    gamePlayerName: string,
  ): Promise<string | null> {
    // 查询最近一条已关闭的会话（left_at IS NOT NULL）
    const row = await this.db<PlayerHistoryRow>('player_histories')
      .where({
        server_id: serverId,
        game_player_name: gamePlayerName,
      })
      .whereNotNull('left_at')
      .orderBy('left_at', 'desc')
      .first();
    return row?.left_at ?? null;
  }

  /**
   * P3: 判断玩家是否满足回归礼包触发条件。
   *
   * 条件：
   *   1. relogin_gift_enabled = true
   *   2. relogin_gift_items 非空
   *   3. 玩家有历史离开记录（非首次加入）
   *   4. 离线时长 >= relogin_cooldown_hours（默认 24h）
   *   5. 今日未领取过 relogin_gift
   *   6. 历史总领取次数 < relogin_total_limit（若配置）
   *
   * @returns { shouldGrant, reason, items } shouldGrant=true 时应下发礼包，items 为礼包物品列表
   */
  async checkReloginGift(
    serverId: string,
    gamePlayerName: string,
  ): Promise<{
    shouldGrant: boolean;
    reason: string;
    items: ReloginGiftItem[] | null;
  }> {
    const settings = await this.getJoinSettings(serverId);

    // 1. 开关检查
    if (!settings.relogin_gift_enabled) {
      return { shouldGrant: false, reason: '回归礼包未启用', items: null };
    }

    // 2. 物品列表检查
    if (!settings.relogin_gift_items || settings.relogin_gift_items.length === 0) {
      return { shouldGrant: false, reason: '回归礼包物品为空', items: null };
    }

    // 3. 查询最后离开时间
    const lastLeaveTime = await this.getLastLeaveTime(serverId, gamePlayerName);
    if (!lastLeaveTime) {
      return { shouldGrant: false, reason: '无历史离开记录（首次加入）', items: null };
    }

    // 4. 离线时长判断
    const cooldownHours = settings.relogin_cooldown_hours ?? 24;
    const offlineMs = Date.now() - new Date(lastLeaveTime).getTime();
    const offlineHours = offlineMs / (1000 * 60 * 60);
    if (offlineHours < cooldownHours) {
      return {
        shouldGrant: false,
        reason: `离线时长不足 ${offlineHours.toFixed(1)}h < ${cooldownHours}h`,
        items: null,
      };
    }

    // 5. 今日已领取检查
    const alreadyClaimedToday = await this.hasClaimedToday(serverId, gamePlayerName, 'relogin_gift');
    if (alreadyClaimedToday) {
      return { shouldGrant: false, reason: '今日已领取回归礼包', items: null };
    }

    // 6. 总限额检查
    if (settings.relogin_total_limit !== null && settings.relogin_total_limit !== undefined) {
      const totalClaimed = await this.hasClaimedTotalCount(serverId, gamePlayerName, 'relogin_gift');
      if (totalClaimed >= settings.relogin_total_limit) {
        return {
          shouldGrant: false,
          reason: `已达总领取上限 ${settings.relogin_total_limit}`,
          items: null,
        };
      }
    }

    return {
      shouldGrant: true,
      reason: '满足回归礼包条件',
      items: settings.relogin_gift_items,
    };
  }

  /**
   * P4: 根据玩家 VIP 等级从 vip_welcome_messages 中匹配欢迎语。
   *
   * 匹配规则：
   *   - 过滤 min_vip_level <= 玩家 VIP 等级 的条目
   *   - 取 min_vip_level 最大的一条（最高匹配等级）
   *   - 无匹配返回 null
   *
   * @param serverId 实例 ID
   * @param vipLevel 玩家当前 VIP 等级（0-5）
   * @returns 匹配的欢迎语模板，无匹配返回 null
   */
  async getVipWelcomeMessage(
    serverId: string,
    vipLevel: number,
  ): Promise<string | null> {
    const settings = await this.getJoinSettings(serverId);
    if (!settings.vip_welcome_messages || settings.vip_welcome_messages.length === 0) {
      return null;
    }
    const candidates = settings.vip_welcome_messages
      .filter((m) => m.min_vip_level <= vipLevel)
      .sort((a, b) => b.min_vip_level - a.min_vip_level);
    return candidates[0]?.message ?? null;
  }
}

// ----- 纯函数 / 转换函数 -----

function toPlayerJoinSettingsSummary(
  row: PlayerJoinSettingsRow,
): PlayerJoinSettingsSummary {
  return {
    server_id: row.server_id,
    welcome_message: row.welcome_message,
    gift_enabled: row.gift_enabled === 1,
    gift_item: row.gift_item,
    gift_count: row.gift_count,
    gift_quality: row.gift_quality as PlayerJoinSettingsSummary['gift_quality'],
    // Task 1：DB 列由 Task 2 迁移添加，在此之前降级为 null
    leave_message: row.leave_message ?? null,
    // P3 回归礼包字段（DB 列由 20260716140000 迁移添加，在此之前降级为默认值）
    relogin_gift_enabled: (row.relogin_gift_enabled ?? 0) === 1,
    relogin_gift_items: parseReloginGiftItems(row.relogin_gift_items),
    relogin_cooldown_hours: row.relogin_cooldown_hours ?? 24,
    relogin_daily_limit: row.relogin_daily_limit ?? 1,
    relogin_total_limit: row.relogin_total_limit ?? null,
    // P4 VIP 专属欢迎语
    vip_welcome_messages: parseVipWelcomeMessages(row.vip_welcome_messages),
    updated_at: row.updated_at,
  };
}

/** 解析 relogin_gift_items JSON 文本，非法时返回 null */
function parseReloginGiftItems(json: string | null | undefined): ReloginGiftItem[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is ReloginGiftItem =>
      typeof item === 'object' && item !== null
      && typeof (item as ReloginGiftItem).item === 'string'
      && typeof (item as ReloginGiftItem).count === 'number',
    );
  } catch {
    return null;
  }
}

/** 解析 vip_welcome_messages JSON 文本，非法时返回 null */
function parseVipWelcomeMessages(json: string | null | undefined): VipWelcomeMessage[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is VipWelcomeMessage =>
      typeof item === 'object' && item !== null
      && typeof (item as VipWelcomeMessage).min_vip_level === 'number'
      && typeof (item as VipWelcomeMessage).message === 'string',
    );
  } catch {
    return null;
  }
}

function toPlayerHistorySummary(row: PlayerHistoryRow): PlayerHistorySummary {
  return {
    id: row.id,
    server_id: row.server_id,
    game_player_name: row.game_player_name,
    joined_at: row.joined_at,
    left_at: row.left_at,
    ip_address: row.ip_address,
    session_duration: row.session_duration,
    created_at: row.created_at,
  };
}

function toGiftClaimSummary(row: GiftClaimRow): GiftClaimSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    user_id: row.user_id,
    game_player_name: row.game_player_name,
    claim_type: row.claim_type as GiftClaimType,
    claimed_at: row.claimed_at,
  };
}

// ----- 辅助函数 -----

/** 生成 8 位大写 verify_code */
function generateVerifyCode(): string {
  return randomUUID().slice(0, VERIFY_CODE_LEN).toUpperCase();
}

/** 判断是否为 UNIQUE 约束冲突错误（SQLite / PostgreSQL 兼容） */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('unique constraint') || msg.includes('sqlite_constraint')) {
    return true;
  }
  // PostgreSQL unique_violation 错误码
  const code = (err as { code?: string }).code;
  if (code === '23505') return true;
  return false;
}

// ----- 工厂 -----

export function createPlayerService(db: Knex): PlayerServiceImpl {
  return new PlayerServiceImpl(db);
}
