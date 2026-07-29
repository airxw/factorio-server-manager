// ============================================================================
// voteService — 投票管理（P3 + Task 4 游戏内 !vk 命令）
// 数据契约：public/schema/panel-api-types.ts（VoteSummary / VoteRecordSummary 等）
// 表结构：
//   votes          (id, server_id, initiator, target, reason, status, start_time, end_time, created_at)
//   vote_records   (id, vote_id, voter, vote_choice, created_at)  UNIQUE(vote_id, voter)
//   vote_settings  (id, server_id UNIQUE, enabled, threshold, duration_seconds, reason_prefix,
//                   trigger_keywords, cooldown_seconds, target_cooldown_seconds,
//                   admin_immune, vip_immune_min_level, updated_at)
// 来源：P3 任务清单 §投票 / 模块10 Task 4 游戏内聊天命令
//
// 说明：本服务按 P3 任务清单要求实现，依赖通过 req.app.locals.voteService 注入。
//      castVote 采用简化判定：仅当 yes >= threshold 时设 passed，不主动 failed。
//      Task 4 新增 handleGameChatVoteCommand 支持游戏内 !vk 命令路径，与 web API 并行。
//      kick 命令通过返回值 kick_target 传递给调用方（inGameCommandService）下发。
// ============================================================================

import type { Knex } from 'knex';
import {
  VoteNotFoundError,
  VoteAlreadyClosedError,
  VoteAlreadyCastError,
} from './errors.js';
import { eventBus, VOTE_THRESHOLD_MET } from './eventBus.js';
import { getVipLevelByGamePlayerName } from './instanceBindingService.js';
import type {
  VoteSummary,
  VoteRecordSummary,
  VoteSettingsSummary,
  UpsertVoteSettingsRequest,
  CreateVoteRequest,
  CastVoteRequest,
  VoteChoice,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

const DEFAULT_VOTE_ENABLED = false;
const DEFAULT_VOTE_THRESHOLD = 3;
const DEFAULT_VOTE_DURATION = 60;
const DEFAULT_VOTE_REASON_PREFIX = '[VoteKick]';
// Task 4 新增默认值（与 DB 迁移 20260716000002 对齐）
const DEFAULT_TRIGGER_KEYWORDS = ['!vk'];
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_TARGET_COOLDOWN_SECONDS = 300;
const DEFAULT_ADMIN_IMMUNE = true;
const DEFAULT_VIP_IMMUNE_MIN_LEVEL = 0;

// 投票命令解析关键词（参考 factorio voteService）
const YES_KEYWORDS = ['yes', '同意', '赞成', 'y', '是'];
const NO_KEYWORDS = ['no', '反对', 'n', '否'];

// server_admin / instance_admin(owner) 在 VIP 体系中的等级（与 instanceBindingService.OWNER_VIP_LEVEL 对齐）
const ADMIN_VIP_LEVEL = 5;

// ----- DB 行类型 -----

interface VoteRow {
  id: number;
  server_id: string;
  initiator: string;
  target: string;
  reason: string;
  status: string;
  start_time: string;
  end_time: string | null;
  created_at: string;
}

interface VoteRecordRow {
  id: number;
  vote_id: number;
  voter: string;
  vote_choice: string;
  created_at: string;
}

interface VoteSettingsRow {
  id: number;
  server_id: string;
  enabled: number; // SQLite boolean as 0/1
  threshold: number;
  duration_seconds: number;
  reason_prefix: string;
  updated_at: string;
  // Task 4 新增字段（DB 迁移 20260716000002 添加列）
  trigger_keywords: string; // JSON 数组字符串，如 '["!vk"]'
  cooldown_seconds: number;
  target_cooldown_seconds: number;
  admin_immune: number; // SQLite boolean as 0/1
  vip_immune_min_level: number;
}

/** player_histories 表所需字段视图（在线检查用） */
interface PlayerHistoryRow {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
}

// ----- 命令解析类型 -----

export interface ParsedVoteCommand {
  action: 'initiate' | 'yes' | 'no';
  target?: string;
}

/** handleGameChatVoteCommand 返回值 */
export interface GameChatVoteResult {
  /** false 表示非投票命令，调用方应继续其他处理 */
  handled: boolean;
  /** 需要广播到游戏内的消息 */
  message?: string;
  /** 投票通过时需要踢出的目标玩家名（由调用方下发 kick 命令） */
  kick_target?: string;
  /** kick 原因（供调用方渲染命令） */
  kick_reason?: string;
}

// ----- 纯函数 -----

/**
 * 安全解析 trigger_keywords JSON 字符串为字符串数组。
 * 解析失败或非数组时返回默认关键词列表。
 */
function safeParseKeywords(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || '[]');
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      );
      return filtered.length > 0 ? filtered : DEFAULT_TRIGGER_KEYWORDS;
    }
    return DEFAULT_TRIGGER_KEYWORDS;
  } catch {
    return DEFAULT_TRIGGER_KEYWORDS;
  }
}

/**
 * 解析游戏内聊天投票命令。
 *
 * 命令格式（trigger_keywords 可配置，默认 ["!vk"]）：
 *   <keyword> <player>   - 发起针对 <player> 的投票
 *   <keyword> yes         - 投赞成票（同义：同意、赞成、y、是）
 *   <keyword> no          - 投反对票（同义：反对、n、否）
 *   <keyword>             - 单独 <keyword> 视为 yes（便捷同意）
 *
 * @param message 玩家发送的消息（已 trim）
 * @param keywords 触发关键词列表
 * @returns 解析结果，null 表示不是投票命令
 */
export function parseVoteCommand(
  message: string,
  keywords: string[],
): ParsedVoteCommand | null {
  const trimmedMsg = message.trim();
  if (trimmedMsg.length === 0) return null;

  for (const kw of keywords) {
    if (!kw) continue;
    // 单独 <keyword> 视为 yes
    if (trimmedMsg === kw) {
      return { action: 'yes' };
    }
    // <keyword> <rest> 形式
    if (trimmedMsg.startsWith(kw + ' ')) {
      const rest = trimmedMsg.slice(kw.length + 1).trim();
      if (!rest) continue;
      const lowerRest = rest.toLowerCase();
      if (YES_KEYWORDS.includes(lowerRest) || YES_KEYWORDS.includes(rest)) {
        return { action: 'yes' };
      }
      if (NO_KEYWORDS.includes(lowerRest) || NO_KEYWORDS.includes(rest)) {
        return { action: 'no' };
      }
      // 否则视为目标玩家名
      return { action: 'initiate', target: rest };
    }
  }
  return null;
}

// ----- 服务实现 -----

export class VoteServiceImpl {
  constructor(private readonly db: Knex) {}

  // ---- 投票设置 ----

  async getSettings(serverId: string): Promise<VoteSettingsSummary> {
    const row = await this.db<VoteSettingsRow>('vote_settings')
      .where({ server_id: serverId })
      .first();
    if (!row) {
      return {
        server_id: serverId,
        enabled: DEFAULT_VOTE_ENABLED,
        threshold: DEFAULT_VOTE_THRESHOLD,
        duration_seconds: DEFAULT_VOTE_DURATION,
        reason_prefix: DEFAULT_VOTE_REASON_PREFIX,
        updated_at: new Date().toISOString(),
        trigger_keywords: DEFAULT_TRIGGER_KEYWORDS,
        cooldown_seconds: DEFAULT_COOLDOWN_SECONDS,
        target_cooldown_seconds: DEFAULT_TARGET_COOLDOWN_SECONDS,
        admin_immune: DEFAULT_ADMIN_IMMUNE,
        vip_immune_min_level: DEFAULT_VIP_IMMUNE_MIN_LEVEL,
      };
    }
    return toVoteSettingsSummary(row);
  }

  async upsertSettings(
    serverId: string,
    patch: UpsertVoteSettingsRequest,
  ): Promise<VoteSettingsSummary> {
    const nowIso = new Date().toISOString();
    const current = await this.db<VoteSettingsRow>('vote_settings')
      .where({ server_id: serverId })
      .first();

    const enabled = patch.enabled ?? (current ? current.enabled === 1 : DEFAULT_VOTE_ENABLED);
    const threshold = patch.threshold ?? current?.threshold ?? DEFAULT_VOTE_THRESHOLD;
    const durationSeconds =
      patch.duration_seconds ?? current?.duration_seconds ?? DEFAULT_VOTE_DURATION;
    const reasonPrefix = patch.reason_prefix ?? current?.reason_prefix ?? DEFAULT_VOTE_REASON_PREFIX;
    // Task 4 新增字段处理
    const triggerKeywords =
      patch.trigger_keywords !== undefined
        ? JSON.stringify(patch.trigger_keywords)
        : current?.trigger_keywords ?? JSON.stringify(DEFAULT_TRIGGER_KEYWORDS);
    const cooldownSeconds =
      patch.cooldown_seconds ?? current?.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS;
    const targetCooldownSeconds =
      patch.target_cooldown_seconds ?? current?.target_cooldown_seconds ?? DEFAULT_TARGET_COOLDOWN_SECONDS;
    const adminImmune =
      patch.admin_immune !== undefined
        ? patch.admin_immune
          ? 1
          : 0
        : current?.admin_immune ?? (DEFAULT_ADMIN_IMMUNE ? 1 : 0);
    const vipImmuneMinLevel =
      patch.vip_immune_min_level ?? current?.vip_immune_min_level ?? DEFAULT_VIP_IMMUNE_MIN_LEVEL;

    const inserted = await this.db<VoteSettingsRow>('vote_settings')
      .insert({
        server_id: serverId,
        enabled: enabled ? 1 : 0,
        threshold,
        duration_seconds: durationSeconds,
        reason_prefix: reasonPrefix,
        trigger_keywords: triggerKeywords,
        cooldown_seconds: cooldownSeconds,
        target_cooldown_seconds: targetCooldownSeconds,
        admin_immune: adminImmune,
        vip_immune_min_level: vipImmuneMinLevel,
        updated_at: nowIso,
      })
      .onConflict(['server_id'] as never)
      .merge({
        enabled: enabled ? 1 : 0,
        threshold,
        duration_seconds: durationSeconds,
        reason_prefix: reasonPrefix,
        trigger_keywords: triggerKeywords,
        cooldown_seconds: cooldownSeconds,
        target_cooldown_seconds: targetCooldownSeconds,
        admin_immune: adminImmune,
        vip_immune_min_level: vipImmuneMinLevel,
        updated_at: nowIso,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toVoteSettingsSummary(row);
  }

  // ---- 投票 ----

  async listVotes(serverId: string): Promise<VoteSummary[]> {
    const rows = await this.db<VoteRow>('votes')
      .where({ server_id: serverId })
      .orderBy('created_at', 'desc');
    return rows.map(toVoteSummary);
  }

  async createVote(
    serverId: string,
    req: CreateVoteRequest,
  ): Promise<VoteSummary> {
    const nowIso = new Date().toISOString();
    const inserted = await this.db<VoteRow>('votes')
      .insert({
        server_id: serverId,
        initiator: req.initiator,
        target: req.target,
        reason: req.reason,
        status: 'active',
        start_time: nowIso,
        end_time: null,
        created_at: nowIso,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toVoteSummary(row);
  }

  async getVote(
    serverId: string,
    id: number,
  ): Promise<{ vote: VoteSummary; records: VoteRecordSummary[] }> {
    const voteRow = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, id })
      .first();
    if (!voteRow) {
      throw new VoteNotFoundError(`投票不存在: server=${serverId}, id=${id}`);
    }
    const recordRows = await this.db<VoteRecordRow>('vote_records')
      .where({ vote_id: id })
      .orderBy('id', 'asc');
    return {
      vote: toVoteSummary(voteRow),
      records: recordRows.map(toVoteRecordSummary),
    };
  }

  async castVote(
    serverId: string,
    id: number,
    req: CastVoteRequest,
  ): Promise<{ vote: VoteSummary; record: VoteRecordSummary }> {
    const voteRow = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, id })
      .first();
    if (!voteRow) {
      throw new VoteNotFoundError(`投票不存在: server=${serverId}, id=${id}`);
    }
    if (voteRow.status !== 'active') {
      throw new VoteAlreadyClosedError(
        `投票已结束: id=${id}, status=${voteRow.status}`,
      );
    }

    // 检查是否已投过票（UNIQUE(vote_id, voter)）
    const existingRecord = await this.db<VoteRecordRow>('vote_records')
      .where({ vote_id: id, voter: req.voter })
      .first();
    if (existingRecord) {
      throw new VoteAlreadyCastError(
        `该玩家已对此投票表态: voter=${req.voter}, vote_id=${id}`,
      );
    }

    const nowIso = new Date().toISOString();
    const inserted = await this.db<VoteRecordRow>('vote_records')
      .insert({
        vote_id: id,
        voter: req.voter,
        vote_choice: req.vote_choice,
        created_at: nowIso,
      })
      .returning('*');

    const recordRow = Array.isArray(inserted) ? inserted[0] : inserted;

    // 简化判定：仅当 yes >= threshold 时设 passed
    let thresholdMet = false;
    if (req.vote_choice === 'yes') {
      const settings = await this.getSettings(serverId);
      const yesCount = await this.db<VoteRecordRow>('vote_records')
        .where({ vote_id: id, vote_choice: 'yes' })
        .count('id as cnt')
        .first();
      const yesNum = (yesCount as unknown as { cnt: number })?.cnt ?? 0;
      if (yesNum >= settings.threshold) {
        await this.db<VoteRow>('votes')
          .where({ id })
          .update({ status: 'passed', end_time: nowIso });
        thresholdMet = true;
      }
    }

    const refreshed = await this.db<VoteRow>('votes').where({ id }).first();

    // 阈值满足：emit VOTE_THRESHOLD_MET 事件触发后续 webhook + kick 命令下发
    // emit 在 db 状态更新之后；eventBus 异常隔离，订阅者抛错不影响返回值
    if (thresholdMet && refreshed) {
      try {
        eventBus.emit(VOTE_THRESHOLD_MET, {
          server_id: serverId,
          vote_id: id,
          target: refreshed.target,
          reason: refreshed.reason,
        });
      } catch (err) {
        // emit 失败不影响 castVote 返回值；仅记录到 stderr
        console.error(
          '[voteService] emit VOTE_THRESHOLD_MET 失败:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return {
      vote: toVoteSummary(refreshed!),
      record: toVoteRecordSummary(recordRow),
    };
  }

  async cancelVote(serverId: string, id: number): Promise<VoteSummary> {
    const voteRow = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, id })
      .first();
    if (!voteRow) {
      throw new VoteNotFoundError(`投票不存在: server=${serverId}, id=${id}`);
    }
    if (voteRow.status !== 'active') {
      throw new VoteAlreadyClosedError(
        `投票已结束: id=${id}, status=${voteRow.status}`,
      );
    }
    const nowIso = new Date().toISOString();
    await this.db<VoteRow>('votes')
      .where({ id })
      .update({ status: 'cancelled', end_time: nowIso });
    const refreshed = await this.db<VoteRow>('votes').where({ id }).first();
    return toVoteSummary(refreshed!);
  }

  // ---- 游戏内聊天投票命令（Task 4 新增） ----

  /**
   * 游戏内聊天投票命令入口（!vk / 投票踢人 / vk 等）。
   *
   * 流程：
   *   1. 加载 vote_settings → 解析 trigger_keywords
   *   2. parseVoteCommand 解析消息
   *   3. 异步清理过期投票（end_time < now 且 status='active' → status='failed'）
   *   4. 分发到 handleInitiate / handleVote
   *
   * @returns { handled: false } 表示非投票命令，调用方应继续其他处理
   *          { kick_target } 表示投票通过，调用方应下发 kick 命令
   */
  async handleGameChatVoteCommand(
    serverId: string,
    player: string,
    message: string,
  ): Promise<GameChatVoteResult> {
    // 异步清理过期投票（不阻塞主流程）
    void this.cleanupExpiredVotes(serverId).catch((err) => {
      console.error(
        '[voteService] cleanupExpiredVotes 失败:',
        err instanceof Error ? err.message : String(err),
      );
    });

    const settings = await this.getSettings(serverId);
    if (!settings.enabled) {
      return { handled: false };
    }

    const keywords = settings.trigger_keywords ?? DEFAULT_TRIGGER_KEYWORDS;
    if (keywords.length === 0) {
      return { handled: false };
    }

    const parsed = parseVoteCommand(message, keywords);
    if (!parsed) {
      return { handled: false };
    }

    switch (parsed.action) {
      case 'initiate':
        if (parsed.target) {
          return this.handleInitiate(serverId, player, parsed.target, settings);
        }
        return { handled: true, message: '[投票] 未指定目标玩家' };
      case 'yes':
        return this.handleVote(serverId, player, 'yes', settings);
      case 'no':
        return this.handleVote(serverId, player, 'no', settings);
      default:
        return { handled: false };
    }
  }

  /**
   * 发起投票踢人。
   * - 在线检查（player_histories 表查 left_at IS NULL）
   * - 已有活跃投票检查
   * - 发起人冷却检查（cooldown_seconds）
   * - 目标冷却检查（target_cooldown_seconds）
   * - 免疫检查（admin_immune + vip_immune_min_level）
   * - 插入 votes 记录（status='active', end_time=now+duration_seconds）
   * - 插入发起者的 yes vote_records 记录
   * - 返回广播消息
   */
  private async handleInitiate(
    serverId: string,
    initiator: string,
    target: string,
    settings: VoteSettingsSummary,
  ): Promise<GameChatVoteResult> {
    const kw = settings.trigger_keywords?.[0] ?? '!vk';

    // 不能对自己发起投票
    if (initiator === target) {
      return { handled: true, message: '[投票] 不能对自己发起投票' };
    }

    // 在线检查：查 player_histories 表 left_at IS NULL
    const online = await this.isPlayerOnline(serverId, target);
    if (!online) {
      return { handled: true, message: `[投票] 目标 ${target} 不在线` };
    }

    // 检查目标是否已有 active 投票
    const existing = await this.findActiveVote(serverId, target);
    if (existing) {
      const yesCount = await this.countVotes(existing.id, 'yes');
      const threshold = settings.threshold;
      return {
        handled: true,
        message: `[投票] ${target} 已有进行中的投票（当前 ${yesCount}/${threshold} 票），使用 "${kw} yes" 投赞成`,
      };
    }

    // 发起人冷却检查
    const cooldownSeconds = settings.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS;
    if (cooldownSeconds > 0) {
      const inCooldown = await this.isInitiatorInCooldown(serverId, initiator, cooldownSeconds);
      if (inCooldown) {
        return { handled: true, message: `[投票] ${initiator} 发起冷却中（${cooldownSeconds}s）` };
      }
    }

    // 目标冷却检查
    const targetCooldownSeconds =
      settings.target_cooldown_seconds ?? DEFAULT_TARGET_COOLDOWN_SECONDS;
    if (targetCooldownSeconds > 0) {
      const inCooldown = await this.isTargetInCooldown(serverId, target, targetCooldownSeconds);
      if (inCooldown) {
        return {
          handled: true,
          message: `[投票] ${target} 近期已被投票，冷却中（${targetCooldownSeconds}s）`,
        };
      }
    }

    // 免疫检查
    const immunity = await this.isTargetImmune(serverId, target, settings);
    if (immunity.immune) {
      return { handled: true, message: `[投票] ${target} 受免疫保护（${immunity.reason}）` };
    }

    // 创建投票记录
    const now = new Date();
    const nowIso = now.toISOString();
    const endTime = new Date(now.getTime() + settings.duration_seconds * 1000).toISOString();
    const reason = `${settings.reason_prefix} 由 ${initiator} 发起`;

    const inserted = await this.db<VoteRow>('votes')
      .insert({
        server_id: serverId,
        initiator,
        target,
        reason,
        status: 'active',
        start_time: nowIso,
        end_time: endTime,
        created_at: nowIso,
      })
      .returning('*');

    const voteRow = Array.isArray(inserted) ? inserted[0] : inserted;

    // 发起者自动算 1 票 yes
    await this.db<VoteRecordRow>('vote_records').insert({
      vote_id: voteRow.id,
      voter: initiator,
      vote_choice: 'yes',
      created_at: nowIso,
    });

    const remaining = settings.threshold - 1;
    return {
      handled: true,
      message:
        `[投票] ${initiator} 发起踢出 ${target}（${settings.duration_seconds}s 内需 ${remaining} 票，达 ${settings.threshold} 票立即踢出）。` +
        `输入 "${kw} yes" 投赞成，"${kw} no" 投反对`,
    };
  }

  /**
   * 投票（yes/no）。
   * - 查找该 server_id 下 status='active' 且 end_time > now 的最近一次投票
   * - 检查 voter 是否已投票（UNIQUE(vote_id, voter)）
   * - 插入 vote_records
   * - 若 yes 票数 >= threshold，更新 votes.status='passed' + emit VOTE_THRESHOLD_MET + 返回 kick_target
   * - 否则返回当前票数信息
   */
  private async handleVote(
    serverId: string,
    voter: string,
    voteChoice: 'yes' | 'no',
    settings: VoteSettingsSummary,
  ): Promise<GameChatVoteResult> {
    const vote = await this.findActiveVote(serverId);
    if (!vote) {
      // 无活跃投票，静默忽略（避免刷屏）
      return { handled: true };
    }

    // 投票者不能投自己（如果是 target）
    if (vote.target === voter) {
      return { handled: true, message: '[投票] 不能对自己投票' };
    }

    // 检查是否已投过票
    const existingRecord = await this.db<VoteRecordRow>('vote_records')
      .where({ vote_id: vote.id, voter })
      .first();
    if (existingRecord) {
      // 已投过，静默忽略
      return { handled: true };
    }

    const nowIso = new Date().toISOString();

    // 插入投票记录
    await this.db<VoteRecordRow>('vote_records').insert({
      vote_id: vote.id,
      voter,
      vote_choice: voteChoice,
      created_at: nowIso,
    });

    const yesCount = await this.countVotes(vote.id, 'yes');
    const noCount = await this.countVotes(vote.id, 'no');

    if (voteChoice === 'yes' && yesCount >= settings.threshold) {
      // 达阈值，标记 passed
      await this.db<VoteRow>('votes')
        .where({ id: vote.id })
        .update({ status: 'passed', end_time: nowIso });

      // emit VOTE_THRESHOLD_MET 事件（与 castVote 路径一致）
      try {
        eventBus.emit(VOTE_THRESHOLD_MET, {
          server_id: serverId,
          vote_id: vote.id,
          target: vote.target,
          reason: vote.reason,
        });
      } catch (err) {
        console.error(
          '[voteService] emit VOTE_THRESHOLD_MET 失败:',
          err instanceof Error ? err.message : String(err),
        );
      }

      return {
        handled: true,
        message: `[投票] ${vote.target} 已被社区投票踢出（${yesCount} 票赞成）`,
        kick_target: vote.target,
        kick_reason: `社区投票踢出（${yesCount} 票赞成）`,
      };
    }

    return {
      handled: true,
      message: `[投票] ${voter} 投了${voteChoice === 'yes' ? '赞成' : '反对'}，当前 ${yesCount}/${settings.threshold} 赞成，${noCount} 反对`,
    };
  }

  /**
   * C9: 清理过期投票——将 end_time < now 且 status='active' 的投票更新为 status='failed'。
   *
   * 原为 private 方法（handleGameChatVoteCommand 入口处异步调用），
   * C9 改为 public 以便调度器周期调用（如每分钟扫描一次）。
   *
   * @param serverId 实例 ID
   * @returns 被清理（标记为 failed）的投票数
   */
  async cleanupExpiredVotes(serverId: string): Promise<number> {
    const nowIso = new Date().toISOString();
    const updated = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, status: 'active' })
      .whereNotNull('end_time')
      .where('end_time', '<', nowIso)
      .update({ status: 'failed', end_time: nowIso });
    return updated;
  }

  /**
   * C9: 恢复错误失败的投票——将 status='failed' 但 end_time > now 的投票恢复为 'active'。
   *
   * 适用场景：
   *   - cleanupExpiredVotes 误判（如时钟回拨导致 end_time 计算错误）
   *   - 手动 DB 编辑导致的状态不一致
   *   - 投票被错误标记为 failed 但实际未过期
   *
   * @param serverId 实例 ID（可选，未指定则扫描全部实例）
   * @returns 恢复为 active 的投票数
   */
  async restoreActiveVotes(serverId?: string): Promise<{ restored: number }> {
    const nowIso = new Date().toISOString();
    const query = this.db<VoteRow>('votes')
      .where({ status: 'failed' })
      .whereNotNull('end_time')
      .where('end_time', '>', nowIso);
    if (serverId) {
      void query.where({ server_id: serverId });
    }
    const restored = await query.update({ status: 'active' });
    return { restored };
  }

  /**
   * 检查玩家是否在线（player_histories 表查 left_at IS NULL）。
   */
  private async isPlayerOnline(serverId: string, playerName: string): Promise<boolean> {
    const row = await this.db<PlayerHistoryRow>('player_histories')
      .where({
        server_id: serverId,
        game_player_name: playerName,
        left_at: null,
      })
      .orderBy('joined_at', 'desc')
      .first();
    return !!row;
  }

  /**
   * 查找当前 server 的活跃投票（status='active' 且 end_time > now）。
   * 若指定 target，则只查找针对该目标的活跃投票。
   */
  private async findActiveVote(
    serverId: string,
    target?: string,
  ): Promise<VoteRow | null> {
    const nowIso = new Date().toISOString();
    const query = this.db<VoteRow>('votes')
      .where({ server_id: serverId, status: 'active' })
      .where('end_time', '>', nowIso);
    if (target) {
      query.andWhere({ target });
    }
    const row = await query.orderBy('id', 'desc').first();
    return row ?? null;
  }

  /**
   * 统计某次投票中指定 choice 的票数。
   */
  private async countVotes(voteId: number, choice: 'yes' | 'no'): Promise<number> {
    const result = await this.db<VoteRecordRow>('vote_records')
      .where({ vote_id: voteId, vote_choice: choice })
      .count('id as cnt')
      .first();
    return Number((result as unknown as { cnt: number })?.cnt ?? 0);
  }

  /**
   * 检查发起人冷却：最近 cooldownSeconds 内是否发起过投票。
   */
  private async isInitiatorInCooldown(
    serverId: string,
    initiator: string,
    cooldownSeconds: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
    const recent = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, initiator })
      .where('created_at', '>=', since)
      .whereNot('status', 'cancelled')
      .orderBy('id', 'desc')
      .first();
    return !!recent;
  }

  /**
   * 检查目标冷却：最近 targetCooldownSeconds 内是否被投过票。
   */
  private async isTargetInCooldown(
    serverId: string,
    target: string,
    targetCooldownSeconds: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - targetCooldownSeconds * 1000).toISOString();
    const recent = await this.db<VoteRow>('votes')
      .where({ server_id: serverId, target })
      .where('created_at', '>=', since)
      .whereNot('status', 'cancelled')
      .orderBy('id', 'desc')
      .first();
    return !!recent;
  }

  /**
   * 检查目标是否免疫被踢。
   * - admin_immune 为 true 且 VIP 等级 >= 5（server_admin / instance_admin owner）→ 管理员免疫
   * - vip_immune_min_level > 0 且 VIP 等级 >= vip_immune_min_level → VIP 免疫
   */
  private async isTargetImmune(
    serverId: string,
    target: string,
    settings: VoteSettingsSummary,
  ): Promise<{ immune: boolean; reason: string }> {
    const adminImmune = settings.admin_immune ?? DEFAULT_ADMIN_IMMUNE;
    const vipImmuneMinLevel =
      settings.vip_immune_min_level ?? DEFAULT_VIP_IMMUNE_MIN_LEVEL;

    // 仅在需要时查询 VIP 等级
    if (!adminImmune && vipImmuneMinLevel <= 0) {
      return { immune: false, reason: '' };
    }

    const vipLevel = await getVipLevelByGamePlayerName(serverId, target);

    if (adminImmune && vipLevel >= ADMIN_VIP_LEVEL) {
      return { immune: true, reason: '管理员免疫' };
    }

    if (vipImmuneMinLevel > 0 && vipLevel >= vipImmuneMinLevel) {
      return { immune: true, reason: `VIP${vipLevel} 免疫` };
    }

    return { immune: false, reason: '' };
  }
}

// ----- 纯函数 / 转换函数 -----

function toVoteSummary(row: VoteRow): VoteSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    initiator: row.initiator,
    target: row.target,
    reason: row.reason,
    status: row.status as VoteSummary['status'],
    start_time: row.start_time,
    end_time: row.end_time,
    created_at: row.created_at,
  };
}

function toVoteRecordSummary(row: VoteRecordRow): VoteRecordSummary {
  return {
    id: row.id,
    vote_id: row.vote_id,
    voter: row.voter,
    vote_choice: row.vote_choice as VoteChoice,
    created_at: row.created_at,
  };
}

function toVoteSettingsSummary(row: VoteSettingsRow): VoteSettingsSummary {
  return {
    server_id: row.server_id,
    enabled: row.enabled === 1,
    threshold: row.threshold,
    duration_seconds: row.duration_seconds,
    reason_prefix: row.reason_prefix,
    updated_at: row.updated_at,
    trigger_keywords: safeParseKeywords(row.trigger_keywords),
    cooldown_seconds: row.cooldown_seconds,
    target_cooldown_seconds: row.target_cooldown_seconds,
    admin_immune: row.admin_immune === 1,
    vip_immune_min_level: row.vip_immune_min_level,
  };
}

// ----- 工厂 -----

export function createVoteService(db: Knex): VoteServiceImpl {
  return new VoteServiceImpl(db);
}
