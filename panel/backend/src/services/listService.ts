// ============================================================================
// listService — 白名单/黑名单条目管理（P4）
// 数据契约：public/schema/panel-api-types.ts（ListEntrySummary 等）
// 表结构：
//   list_entries (id, server_id, list_type, player_name, added_at,
//                 added_by, reason)
//                 UNIQUE (server_id, list_type, player_name)
// 来源：P4 任务清单 §白名单黑名单
//
// 说明：本服务按 P4 任务清单要求实现，依赖通过 req.app.locals.listService 注入。
// ============================================================================

import type { Knex } from 'knex';
import { ListEntryNotFoundError, ListEntryAlreadyExistsError } from './errors.js';
import type {
  ListType,
  ListEntrySummary,
  CreateListEntryRequest,
} from '@public/schema/panel-api-types';

// ----- DB 行类型 -----

interface ListEntryRow {
  id: number;
  server_id: string;
  list_type: string;
  player_name: string;
  added_at: string;
  added_by: string;
  reason: string | null;
}

// ----- 服务实现 -----

export class ListServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 按 list_type 过滤，按 added_at DESC 排序
   */
  async list(
    serverId: string,
    listType: ListType,
  ): Promise<{ entries: ListEntrySummary[] }> {
    const rows = await this.db<ListEntryRow>('list_entries')
      .where({ server_id: serverId, list_type: listType })
      .orderBy('added_at', 'desc');
    return { entries: rows.map(toListEntrySummary) };
  }

  /**
   * 创建条目
   * - added_at = now() ISO
   * - UNIQUE 冲突抛 ListEntryAlreadyExistsError
   */
  async create(
    serverId: string,
    listType: ListType,
    req: CreateListEntryRequest,
    addedBy: string,
  ): Promise<{ entry: ListEntrySummary }> {
    try {
      const inserted = await this.db<ListEntryRow>('list_entries')
        .insert({
          server_id: serverId,
          list_type: listType,
          player_name: req.player_name,
          added_at: new Date().toISOString(),
          added_by: addedBy,
          reason: req.reason ?? null,
        })
        .returning('*');
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return { entry: toListEntrySummary(row) };
    } catch (err) {
      if (isSqliteUniqueViolation(err)) {
        throw new ListEntryAlreadyExistsError(
          `白名单/黑名单条目已存在: server=${serverId}, list_type=${listType}, player_name=${req.player_name}`,
        );
      }
      throw err;
    }
  }

  /**
   * 删除条目
   * - 找不到抛 ListEntryNotFoundError
   */
  async remove(
    serverId: string,
    listType: ListType,
    playerName: string,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.db<ListEntryRow>('list_entries')
      .where({
        server_id: serverId,
        list_type: listType,
        player_name: playerName,
      })
      .first();
    if (!existing) {
      throw new ListEntryNotFoundError(
        `白名单/黑名单条目不存在: server=${serverId}, list_type=${listType}, player_name=${playerName}`,
      );
    }
    await this.db<ListEntryRow>('list_entries')
      .where({
        server_id: serverId,
        list_type: listType,
        player_name: playerName,
      })
      .delete();
    return { deleted: true };
  }
}

// ----- 纯函数 / 转换函数 -----

function toListEntrySummary(row: ListEntryRow): ListEntrySummary {
  return {
    id: row.id,
    server_id: row.server_id,
    list_type: row.list_type as ListType,
    player_name: row.player_name,
    added_at: row.added_at,
    added_by: row.added_by,
    reason: row.reason,
  };
}

// ----- 辅助函数 -----

/** 检测唯一约束冲突错误（SQLite SQLITE_CONSTRAINT / PostgreSQL 23505） */
function isSqliteUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(err.message)) return true;
  // PostgreSQL unique_violation
  if (code === '23505') return true;
  return false;
}

// ----- 工厂 -----

export function createListService(db: Knex): ListServiceImpl {
  return new ListServiceImpl(db);
}
