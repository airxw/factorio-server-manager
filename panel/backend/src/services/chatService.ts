// ============================================================================
// chatService — 聊天设置 / 触发响应管理（P3）
// 数据契约：public/schema/panel-api-types.ts（ChatSettingsSummary 等）
// 表结构：
//   chat_settings           (id, server_id UNIQUE, enabled, settings_json, updated_at)
//   chat_trigger_responses  (id, server_id, trigger, response, priority, enabled, created_at)
// 来源：P3 任务清单 §聊天 / 触发响应
//
// 说明：本服务按 P3 任务清单要求实现，依赖通过 req.app.locals.chatService 注入。
// ============================================================================

import type { Knex } from 'knex';
import { ChatTriggerNotFoundError } from './errors.js';
// v4.33.0: 日期键统一走公共 utils（W3 提炼批）
import { utcDateKey } from '../utils/date.js';
import type {
  ChatSettingsSummary,
  ChatTriggerResponseSummary,
  ChatTriggerMode,
  UpsertChatSettingsRequest,
  CreateChatTriggerRequest,
  UpdateChatTriggerRequest,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 聊天设置默认 enabled */
const DEFAULT_CHAT_ENABLED = true;
/** 触发响应默认优先级 */
const DEFAULT_TRIGGER_PRIORITY = 50;
/** 触发响应默认启用状态 */
const DEFAULT_TRIGGER_ENABLED = true;
/** 触发响应默认匹配模式（Task 1 契约扩展） */
const DEFAULT_TRIGGER_MODE: ChatTriggerMode = 'prefix';
/** 触发响应默认冷却秒数（Task 1 契约扩展） */
const DEFAULT_TRIGGER_COOLDOWN_SECONDS = 0;

/** C7: 消息缓冲最大条数 */
const MAX_BUFFER_SIZE = 500;

// ----- C7: 聊天引擎类型 -----

/** C7: 聊天消息缓冲条目 */
export interface ChatBufferEntry {
  player_name: string;
  message: string;
  timestamp: string;
  /** 是否已触发自动回复 */
  replied: boolean;
  /** 触发的响应内容（若有） */
  reply?: string;
}

/** C7: processMessage 返回值 */
export interface ProcessMessageResult {
  /** 是否触发了回复（自动回复或内置命令） */
  replied: boolean;
  /** 回复内容（replied=true 时非空） */
  response: string | null;
  /** 回复类型 */
  reply_type: 'trigger' | 'builtin' | null;
}

// ----- DB 行类型 -----

interface ChatSettingsRow {
  id: number;
  server_id: string;
  enabled: number; // SQLite boolean as 0/1
  settings_json: string;
  updated_at: string;
}

interface ChatTriggerRow {
  id: number;
  server_id: string;
  trigger: string;
  response: string;
  priority: number;
  enabled: number; // SQLite boolean as 0/1
  // Task 1 契约扩展：mode / cooldown_seconds 字段（DB 列由 Task 2 迁移添加，在此之前可能为 undefined）
  mode?: string;
  cooldown_seconds?: number;
  created_at: string;
}

// ----- 服务实现 -----

export class ChatServiceImpl {
  /** C7: 消息缓冲——按 serverId 维护最近 500 条聊天消息 */
  private readonly messageBuffer = new Map<string, ChatBufferEntry[]>();

  /** C7: 冷却追踪——key = `${serverId}:${triggerId}`，value = 上次触发时间戳(ms) */
  private readonly cooldownTracker = new Map<string, number>();

  constructor(private readonly db: Knex) {}

  // ---- 聊天设置 ----

  async getSettings(serverId: string): Promise<ChatSettingsSummary> {
    const row = await this.db<ChatSettingsRow>('chat_settings')
      .where({ server_id: serverId })
      .first();
    if (!row) {
      return {
        server_id: serverId,
        enabled: DEFAULT_CHAT_ENABLED,
        settings: {},
        updated_at: new Date().toISOString(),
      };
    }
    return toChatSettingsSummary(row);
  }

  async upsertSettings(
    serverId: string,
    req: UpsertChatSettingsRequest,
  ): Promise<ChatSettingsSummary> {
    const nowIso = new Date().toISOString();
    const settingsJson = JSON.stringify(req.settings ?? {});

    const inserted = await this.db<ChatSettingsRow>('chat_settings')
      .insert({
        server_id: serverId,
        enabled: req.enabled ? 1 : 0,
        settings_json: settingsJson,
        updated_at: nowIso,
      })
      .onConflict(['server_id'] as never)
      .merge({
        enabled: req.enabled ? 1 : 0,
        settings_json: settingsJson,
        updated_at: nowIso,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toChatSettingsSummary(row);
  }

  // ---- 触发响应 ----

  async listTriggers(serverId: string): Promise<ChatTriggerResponseSummary[]> {
    const rows = await this.db<ChatTriggerRow>('chat_trigger_responses')
      .where({ server_id: serverId })
      .orderBy('priority', 'desc')
      .orderBy('id', 'asc');
    return rows.map(toChatTriggerSummary);
  }

  async createTrigger(
    serverId: string,
    req: CreateChatTriggerRequest,
  ): Promise<ChatTriggerResponseSummary> {
    const nowIso = new Date().toISOString();
    const priority = req.priority ?? DEFAULT_TRIGGER_PRIORITY;
    const enabled = req.enabled ?? DEFAULT_TRIGGER_ENABLED;

    const inserted = await this.db<ChatTriggerRow>('chat_trigger_responses')
      .insert({
        server_id: serverId,
        trigger: req.trigger,
        response: req.response,
        priority,
        enabled: enabled ? 1 : 0,
        mode: req.mode ?? DEFAULT_TRIGGER_MODE,
        cooldown_seconds: req.cooldown_seconds ?? DEFAULT_TRIGGER_COOLDOWN_SECONDS,
        created_at: nowIso,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toChatTriggerSummary(row);
  }

  async updateTrigger(
    serverId: string,
    id: number,
    patch: UpdateChatTriggerRequest,
  ): Promise<ChatTriggerResponseSummary> {
    const existing = await this.db<ChatTriggerRow>('chat_trigger_responses')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new ChatTriggerNotFoundError(
        `触发响应不存在: server=${serverId}, id=${id}`,
      );
    }

    const updates: Partial<ChatTriggerRow> = {};
    if (patch.trigger !== undefined) updates.trigger = patch.trigger;
    if (patch.response !== undefined) updates.response = patch.response;
    if (patch.priority !== undefined) updates.priority = patch.priority;
    if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
    if (patch.mode !== undefined) updates.mode = patch.mode;
    if (patch.cooldown_seconds !== undefined) updates.cooldown_seconds = patch.cooldown_seconds;

    const updated = await this.db<ChatTriggerRow>('chat_trigger_responses')
      .where({ server_id: serverId, id })
      .update(updates)
      .returning('*');

    const row = Array.isArray(updated) ? updated[0] : updated;
    return toChatTriggerSummary(row);
  }

  async deleteTrigger(serverId: string, id: number): Promise<void> {
    const existing = await this.db<ChatTriggerRow>('chat_trigger_responses')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new ChatTriggerNotFoundError(
        `触发响应不存在: server=${serverId}, id=${id}`,
      );
    }
    await this.db<ChatTriggerRow>('chat_trigger_responses')
      .where({ server_id: serverId, id })
      .delete();
  }

  // ---- C7: 完整聊天引擎 ----

  /**
   * C7: 处理入站聊天消息——主入口。
   *
   * 流程：
   *   1. 缓冲消息（保留最近 500 条）
   *   2. 检查聊天是否启用
   *   3. 检查内置命令（!online / !time / !help）
   *   4. 遍历触发响应规则（按 priority DESC），匹配第一个满足条件的触发器
   *   5. 冷却检查：触发器在冷却期内则跳过
   *   6. 变量替换：将 {{player_name}} 等变量替换为实际值
   *   7. 返回回复内容（供调用方下发到游戏内）
   *
   * @param serverId 实例 ID
   * @param playerName 发送者游戏内名
   * @param message 消息内容
   * @returns 回复结果（replied=false 表示无回复）
   */
  async processMessage(
    serverId: string,
    playerName: string,
    message: string,
  ): Promise<ProcessMessageResult> {
    // 1. 缓冲消息
    this.bufferMessage(serverId, playerName, message);

    // 2. 检查聊天是否启用
    const settings = await this.getSettings(serverId);
    if (!settings.enabled) {
      return { replied: false, response: null, reply_type: null };
    }

    // 3. 检查内置命令
    const builtin = await this.handleBuiltinCommand(serverId, message);
    if (builtin.handled) {
      this.updateBufferReply(serverId, playerName, message, builtin.response ?? '');
      return { replied: true, response: builtin.response ?? null, reply_type: 'builtin' };
    }

    // 4. 遍历触发响应规则
    const triggers = await this.listTriggers(serverId);
    const now = Date.now();

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;

      // 5. 冷却检查
      const cooldownKey = `${serverId}:${trigger.id}`;
      const cooldownSeconds = trigger.cooldown_seconds ?? 0;
      if (cooldownSeconds > 0) {
        const lastTriggered = this.cooldownTracker.get(cooldownKey);
        if (lastTriggered !== undefined) {
          const elapsedSec = (now - lastTriggered) / 1000;
          if (elapsedSec < cooldownSeconds) {
            continue; // 在冷却中，跳过此触发器
          }
        }
      }

      // 匹配检查
      if (this.matchTrigger(message, trigger.trigger, trigger.mode)) {
        // 6. 变量替换
        const rendered = this.renderResponse(trigger.response, {
          player_name: playerName,
          server_id: serverId,
          message,
        });

        // 更新冷却追踪
        this.cooldownTracker.set(cooldownKey, now);

        // 更新缓冲条目的回复状态
        this.updateBufferReply(serverId, playerName, message, rendered);

        return { replied: true, response: rendered, reply_type: 'trigger' };
      }
    }

    return { replied: false, response: null, reply_type: null };
  }

  /**
   * C7: 获取最近缓冲的聊天消息。
   *
   * @param serverId 实例 ID
   * @param limit 返回条数（默认 50，最大 500）
   * @returns 按时间正序排列的最近消息
   */
  getRecentMessages(serverId: string, limit: number = 50): ChatBufferEntry[] {
    const buffer = this.messageBuffer.get(serverId);
    if (!buffer || buffer.length === 0) return [];
    const actualLimit = Math.min(Math.max(1, limit), MAX_BUFFER_SIZE);
    return buffer.slice(-actualLimit);
  }

  /**
   * C7: 触发器匹配检查。
   *
   * 匹配模式（与 ChatTriggerMode 契约对齐）：
   *   - exact:    消息与触发词完全一致
   *   - prefix:   消息以触发词开头
   *   - contains: 消息包含触发词
   *
   * @param message 玩家消息
   * @param trigger 触发词
   * @param mode 匹配模式
   */
  private matchTrigger(
    message: string,
    trigger: string,
    mode: ChatTriggerMode | undefined,
  ): boolean {
    const m = mode ?? DEFAULT_TRIGGER_MODE;
    switch (m) {
      case 'exact':
        return message === trigger;
      case 'contains':
        return message.includes(trigger);
      case 'prefix':
      default:
        return message.startsWith(trigger);
    }
  }

  /**
   * C7: 变量替换引擎——将响应模板中的 {{var}} 替换为实际值。
   *
   * 支持的变量：
   *   {{player_name}} - 发送者游戏内名
   *   {{server_id}}   - 服务器 ID
   *   {{message}}     - 原始消息内容
   *   {{timestamp}}   - 当前 ISO 时间戳
   *   {{date}}        - 当前日期 YYYY-MM-DD
   *   {{time}}        - 当前时间 HH:MM:SS
   *
   * @param template 响应模板
   * @param vars 变量值映射
   * @returns 渲染后的字符串，未知变量保持原样
   */
  private renderResponse(
    template: string,
    vars: {
      player_name: string;
      server_id: string;
      message: string;
    },
  ): string {
    const now = new Date();
    const varMap: Record<string, string> = {
      player_name: vars.player_name,
      server_id: vars.server_id,
      message: vars.message,
      timestamp: now.toISOString(),
      date: utcDateKey(now),
      time: now.toTimeString().slice(0, 8),
    };
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(varMap, key) ? varMap[key] : match,
    );
  }

  /**
   * C7: 内置命令处理。
   *
   * 支持的命令：
   *   !online / 在线人数  - 查询当前在线玩家数
   *   !time / 时间        - 查询当前服务器时间
   *   !help / 帮助        - 列出可用命令
   *
   * @param serverId 实例 ID
   * @param message 玩家消息
   * @returns { handled: true, response } 表示命中内置命令
   */
  private async handleBuiltinCommand(
    serverId: string,
    message: string,
  ): Promise<{ handled: boolean; response?: string }> {
    const trimmed = message.trim().toLowerCase();

    // !online - 在线人数
    if (trimmed === '!online' || trimmed === '在线人数') {
      const countRow = await this.db('player_histories')
        .where({ server_id: serverId, left_at: null })
        .count('id as cnt')
        .first();
      const num = Number(
        (countRow as unknown as { cnt: number })?.cnt ?? 0,
      );
      return { handled: true, response: `当前在线 ${num} 人` };
    }

    // !time - 当前时间
    if (trimmed === '!time' || trimmed === '时间') {
      const now = new Date();
      return {
        handled: true,
        response: `当前时间: ${now.toTimeString().slice(0, 8)}`,
      };
    }

    // !help - 帮助
    if (trimmed === '!help' || trimmed === '帮助') {
      return {
        handled: true,
        response: '可用命令: !online(在线人数) !time(时间) !help(帮助)',
      };
    }

    return { handled: false };
  }

  /**
   * C7: 缓冲消息到内存环形缓冲区（保留最近 500 条）。
   */
  private bufferMessage(
    serverId: string,
    playerName: string,
    message: string,
  ): void {
    let buffer = this.messageBuffer.get(serverId);
    if (!buffer) {
      buffer = [];
      this.messageBuffer.set(serverId, buffer);
    }
    buffer.push({
      player_name: playerName,
      message,
      timestamp: new Date().toISOString(),
      replied: false,
    });
    // 超出最大缓冲数时，从头删除多余条目
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }
  }

  /**
   * C7: 更新缓冲区中最近一条匹配消息的回复状态。
   */
  private updateBufferReply(
    serverId: string,
    playerName: string,
    message: string,
    reply: string,
  ): void {
    const buffer = this.messageBuffer.get(serverId);
    if (!buffer) return;
    // 从末尾向前查找最近一条未回复的匹配消息
    for (let i = buffer.length - 1; i >= 0; i--) {
      const entry = buffer[i];
      if (
        entry.player_name === playerName &&
        entry.message === message &&
        !entry.replied
      ) {
        entry.replied = true;
        entry.reply = reply;
        break;
      }
    }
  }
}

// ----- 纯函数 / 转换函数 -----

function toChatSettingsSummary(row: ChatSettingsRow): ChatSettingsSummary {
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.settings_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
    }
  } catch {
    settings = {};
  }
  return {
    server_id: row.server_id,
    enabled: row.enabled === 1,
    settings,
    updated_at: row.updated_at,
  };
}

function toChatTriggerSummary(row: ChatTriggerRow): ChatTriggerResponseSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    trigger: row.trigger,
    response: row.response,
    priority: row.priority,
    enabled: row.enabled === 1,
    // Task 1：DB 列由 Task 2 迁移添加，在此之前降级为默认值
    mode: (row.mode as ChatTriggerMode | undefined) ?? DEFAULT_TRIGGER_MODE,
    cooldown_seconds: row.cooldown_seconds ?? DEFAULT_TRIGGER_COOLDOWN_SECONDS,
    created_at: row.created_at,
  };
}

// ----- 工厂 -----

export function createChatService(db: Knex): ChatServiceImpl {
  return new ChatServiceImpl(db);
}
