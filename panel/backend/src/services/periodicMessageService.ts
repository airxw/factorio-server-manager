// ============================================================================
// periodicMessageService — 定时消息管理（P3）
// 数据契约：public/schema/panel-api-types.ts（PeriodicMessageSummary 等）
// 表结构：
//   periodic_messages (id, server_id, message, interval_minutes, enabled,
//                       next_run_at, created_at)
// 来源：P3 任务清单 §定时消息
//
// 说明：本服务按 P3 任务清单要求实现，依赖通过 req.app.locals.periodicMessageService 注入。
// ============================================================================

import type { Knex } from 'knex';
import { PeriodicMessageNotFoundError } from './errors.js';
import type {
  PeriodicMessageSummary,
  CreatePeriodicMessageRequest,
  UpdatePeriodicMessageRequest,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 定时消息默认启用状态 */
const DEFAULT_PERIODIC_ENABLED = true;

// ----- DB 行类型 -----

interface PeriodicMessageRow {
  id: number;
  server_id: string;
  message: string;
  interval_minutes: number;
  enabled: number; // SQLite boolean as 0/1
  next_run_at: string;
  created_at: string;
}

// ----- 服务实现 -----

export class PeriodicMessageServiceImpl {
  constructor(private readonly db: Knex) {}

  async list(serverId: string): Promise<PeriodicMessageSummary[]> {
    const rows = await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ server_id: serverId })
      .orderBy('created_at', 'desc');
    return rows.map(toPeriodicMessageSummary);
  }

  async create(
    serverId: string,
    req: CreatePeriodicMessageRequest,
  ): Promise<PeriodicMessageSummary> {
    const nowIso = new Date().toISOString();
    const enabled = req.enabled ?? DEFAULT_PERIODIC_ENABLED;
    // next_run_at = now + interval_minutes 分钟
    const nextRunAt = computeNextRunAt(req.interval_minutes);

    const inserted = await this.db<PeriodicMessageRow>('periodic_messages')
      .insert({
        server_id: serverId,
        message: req.message,
        interval_minutes: req.interval_minutes,
        enabled: enabled ? 1 : 0,
        next_run_at: nextRunAt,
        created_at: nowIso,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toPeriodicMessageSummary(row);
  }

  async update(
    serverId: string,
    id: number,
    patch: UpdatePeriodicMessageRequest,
  ): Promise<PeriodicMessageSummary> {
    const existing = await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new PeriodicMessageNotFoundError(
        `定时消息不存在: server=${serverId}, id=${id}`,
      );
    }

    const updates: Partial<PeriodicMessageRow> = {};
    if (patch.message !== undefined) updates.message = patch.message;
    if (patch.interval_minutes !== undefined) {
      updates.interval_minutes = patch.interval_minutes;
      // 重新计算 next_run_at = now + interval_minutes
      updates.next_run_at = computeNextRunAt(patch.interval_minutes);
    }
    if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;

    const updated = await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ server_id: serverId, id })
      .update(updates)
      .returning('*');

    const row = Array.isArray(updated) ? updated[0] : updated;
    return toPeriodicMessageSummary(row);
  }

  async delete(serverId: string, id: number): Promise<void> {
    const existing = await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new PeriodicMessageNotFoundError(
        `定时消息不存在: server=${serverId}, id=${id}`,
      );
    }
    await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ server_id: serverId, id })
      .delete();
  }

  /**
   * 获取所有到期（next_run_at <= now）的 enabled 定时消息，
   * 并把每条记录的 next_run_at 推进 interval_minutes 分钟（防止下次重复触发）。
   *
   * 由 PERIODIC_MESSAGE 调度任务调用（每 60s 一次）。
   * 调用方拿到返回值后渲染 broadcast_command 模板并通过 commandDispatcher 下发。
   */
  async getDueAndAdvance(): Promise<PeriodicMessageSummary[]> {
    const nowIso = new Date().toISOString();
    const dueRows = await this.db<PeriodicMessageRow>('periodic_messages')
      .where({ enabled: 1 })
      .where('next_run_at', '<=', nowIso)
      .orderBy('id', 'asc');
    if (dueRows.length === 0) return [];

    for (const row of dueRows) {
      const nextRunAt = computeNextRunAt(row.interval_minutes);
      await this.db<PeriodicMessageRow>('periodic_messages')
        .where({ id: row.id })
        .update({ next_run_at: nextRunAt });
    }
    return dueRows.map(toPeriodicMessageSummary);
  }
}

// ----- 纯函数 / 转换函数 -----

function toPeriodicMessageSummary(
  row: PeriodicMessageRow,
): PeriodicMessageSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    message: row.message,
    interval_minutes: row.interval_minutes,
    enabled: row.enabled === 1,
    next_run_at: row.next_run_at,
    created_at: row.created_at,
  };
}

// ----- 辅助函数 -----

/** 计算 next_run_at = now + intervalMinutes 分钟（ISO 字符串） */
function computeNextRunAt(intervalMinutes: number): string {
  const ms = intervalMinutes * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

// ----- 工厂 -----

export function createPeriodicMessageService(
  db: Knex,
): PeriodicMessageServiceImpl {
  return new PeriodicMessageServiceImpl(db);
}
