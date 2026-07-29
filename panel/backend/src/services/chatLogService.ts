// ============================================================================
// chatLogService — 聊天日志解析与持久化服务（Task 9 新建）
//
// 职责：
//   - parseAndStore(serverId, line) — 按 Pack chat_log.pattern 匹配 stdout 行，
//                                      命中则提取 player + message 写入 chat_logs 表
//   - listLogs(serverId, filters) — 分页查询聊天日志
//   - cleanupOldLogs(serverId) — 删除超过 retention_days 的记录（scheduler 调用）
//
// 依赖：
//   - PackRegistry（读 Pack.chat_log 配置）
//
// 数据契约：
//   - public/schema/pack-schema.ts PackChatLog
//   - chat_logs 表（Task 3 迁移创建）
//
// 边界说明（与 chatService 区分）：
//   - chatService：管理 chat_settings / chat_triggers 业务配置
//   - chatLogService：解析 stdout 行并持久化到 chat_logs
// ============================================================================

import type { Knex } from 'knex';
import type { PackRegistry } from '../core/packs/registry.js';
import type { GamePack, PackChatLog } from '@public/schema/pack-schema';
import {
  InstanceNotFoundError,
  PackNotFoundError,
  PackCapabilityNotDeclaredError,
  ChatLogParseError,
} from './errors.js';

// ----- Server 行类型 -----

interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- chat_logs 表行类型（Task 3 迁移创建）-----

interface ChatLogRow {
  id: number;
  server_id: string;
  player_name: string | null;
  message: string;
  sent_at: string;
  created_at: string;
}

// ----- 查询过滤器 -----

export interface ChatLogFilters {
  player_name?: string;
  message_contains?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
}

// ----- 列表响应 -----

export interface ChatLogListResponse {
  logs: ChatLogRow[];
  total: number;
}

// ----- 服务实现 -----

export class ChatLogServiceImpl {
  /** 编译后的正则缓存：packId → RegExp */
  private readonly patternCache = new Map<string, RegExp>();

  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
  ) {}

  /**
   * 解析 stdout 行并持久化到 chat_logs（Task 9.2）。
   *
   * 步骤：
   *   1. 加载 Pack.chat_log.pattern（缓存编译后的 RegExp）
   *   2. 正则匹配 line，提取 group 1（player）+ group 2（message）
   *   3. 若 storage_enabled=false，仅匹配不存储
   *   4. 命中且 storage_enabled=true 时写入 chat_logs 表
   *
   * @returns 命中且已存储返回 true；未命中或未存储返回 false
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 chat_log
   * @throws {ChatLogParseError} 正则编译失败
   */
  async parseAndStore(serverId: string, line: string): Promise<boolean> {
    const { pack } = await this.resolveServerPackWithChatLog(serverId);
    const chatLog = this.requireChatLog(pack);

    // 编译并缓存正则
    const regex = this.getOrCompilePattern(pack.pack.id, chatLog.pattern);

    // 匹配行
    const match = regex.exec(line);
    if (!match) {
      return false;
    }

    // storage_enabled=false 时不存储
    if (!chatLog.storage_enabled) {
      return true; // 命中但未存储
    }

    // 提取 player + message
    // 假设 pattern 包含两个 group：player（group 1）+ message（group 2）
    const playerName = match[1] ?? null;
    const message = match[2] ?? '';
    if (!message) {
      return false;
    }

    const nowIso = new Date().toISOString();
    await this.db<ChatLogRow>('chat_logs').insert({
      server_id: serverId,
      player_name: playerName,
      message,
      sent_at: nowIso, // P0 使用当前时间，实际应从 stdout 行解析（若 pattern 含 timestamp group）
      created_at: nowIso,
    });
    return true;
  }

  /**
   * 分页查询聊天日志（Task 9.3）。
   */
  async listLogs(
    serverId: string,
    filters: ChatLogFilters = {},
  ): Promise<ChatLogListResponse> {
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    let query = this.db<ChatLogRow>('chat_logs').where({ server_id: serverId });
    if (filters.player_name) {
      query = query.where('player_name', 'like', `%${filters.player_name}%`);
    }
    if (filters.message_contains) {
      query = query.where('message', 'like', `%${filters.message_contains}%`);
    }
    if (filters.start_time) {
      query = query.where('sent_at', '>=', filters.start_time);
    }
    if (filters.end_time) {
      query = query.where('sent_at', '<=', filters.end_time);
    }

    // 总数（Knex count 在 SQLite 下可能返回 string，需 Number 转换）
    const totalResult = (await query
      .clone()
      .count('* as count')
      .first()) as unknown as { count: string | number } | undefined;
    const total = totalResult ? Number(totalResult.count) : 0;

    // 分页查询
    const logs = await query
      .clone()
      .orderBy('sent_at', 'desc')
      .limit(limit)
      .offset(offset);

    return { logs, total };
  }

  /**
   * 清理超过 retention_days 的记录（Task 9.4）。
   *
   * 由 scheduler 定期调用（每个 Pack 独立 retention_days）。
   *
   * @returns 删除的记录数
   */
  async cleanupOldLogs(serverId: string): Promise<number> {
    const { pack } = await this.resolveServerPackWithChatLog(serverId);
    const chatLog = this.requireChatLog(pack);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - chatLog.retention_days);
    const cutoffIso = cutoff.toISOString();

    const deleted = await this.db<ChatLogRow>('chat_logs')
      .where({ server_id: serverId })
      .where('sent_at', '<', cutoffIso)
      .delete();

    return deleted;
  }

  // -------------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------------

  /** 解析 serverId → pack（要求 Pack 声明 chat_log） */
  private async resolveServerPackWithChatLog(
    serverId: string,
  ): Promise<{ pack: GamePack }> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    const pack = this.registry.load(row.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${row.pack_id}`);
    }
    if (!pack.chat_log) {
      throw new PackCapabilityNotDeclaredError(
        `Pack ${row.pack_id} 未声明 chat_log`,
      );
    }
    return { pack };
  }

  /** 获取 Pack.chat_log（已通过 resolveServerPackWithChatLog 保证存在） */
  private requireChatLog(pack: GamePack): PackChatLog {
    if (!pack.chat_log) {
      throw new PackCapabilityNotDeclaredError(
        `Pack ${pack.pack.id} 未声明 chat_log`,
      );
    }
    return pack.chat_log;
  }

  /** 获取或编译 pattern 正则（缓存） */
  private getOrCompilePattern(packId: string, pattern: string): RegExp {
    let regex = this.patternCache.get(packId);
    if (regex) {
      return regex;
    }
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      throw new ChatLogParseError(
        `pattern 编译失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.patternCache.set(packId, regex);
    return regex;
  }
}

// ----- 工厂 -----

export function createChatLogService(
  db: Knex,
  registry: PackRegistry,
): ChatLogServiceImpl {
  return new ChatLogServiceImpl(db, registry);
}
