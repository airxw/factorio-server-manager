// ============================================================================
// monitorService — 监控快照管理（P4）
// 数据契约：public/schema/panel-api-types.ts（MonitorSnapshotSummary 等）
// 表结构：
//   monitor_snapshots (id, server_id, timestamp, cpu_percent, memory_mb,
//                      tick_rate, player_count, json_extra)
//                      INDEX (server_id, timestamp)
// 来源：P4 任务清单 §监控
//
// 说明：本服务按 P4 任务清单要求实现，依赖通过 req.app.locals.monitorService 注入。
// ============================================================================

import type { Knex } from 'knex';
import { AppError } from './errors.js';
import type {
  MonitorSnapshotSummary,
  CreateMonitorSnapshotRequest,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 快照列表默认条数 */
const DEFAULT_LIMIT = 100;
/** 快照列表最大条数 */
const MAX_LIMIT = 1000;

// ----- DB 行类型 -----

interface MonitorSnapshotRow {
  id: number;
  server_id: string;
  timestamp: string;
  cpu_percent: number | null;
  memory_mb: number | null;
  tick_rate: number | null;
  player_count: number | null;
  json_extra: string | null;
}

// ----- 局部错误类 -----
// AppError 为抽象基类，无法直接实例化；此处在服务文件内定义子类以承载动态错误码。

class MonitorSnapshotCreateFailedError extends AppError {
  readonly code = 'MONITOR_SNAPSHOT_CREATE_FAILED';
  constructor(message: string) {
    super(message);
  }
}

// ----- 服务实现 -----

export class MonitorServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 按 timestamp 范围查询 monitor_snapshots
   * - limit 默认 100、最大 1000
   * - 按 timestamp DESC 排序
   */
  async list(
    serverId: string,
    query: { from?: string; to?: string; limit?: number },
  ): Promise<{ snapshots: MonitorSnapshotSummary[] }> {
    let limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = DEFAULT_LIMIT;
    }
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }

    let qb = this.db<MonitorSnapshotRow>('monitor_snapshots').where({
      server_id: serverId,
    });
    if (query.from) {
      qb = qb.where('timestamp', '>=', query.from);
    }
    if (query.to) {
      qb = qb.where('timestamp', '<=', query.to);
    }
    const rows = await qb.orderBy('timestamp', 'desc').limit(limit);
    return { snapshots: rows.map(toMonitorSnapshotSummary) };
  }

  /**
   * 创建监控快照
   * - timestamp 默认 now() ISO
   * - json_extra 字段为 JSON.stringify(req.json_extra ?? {})
   */
  async create(
    serverId: string,
    req: CreateMonitorSnapshotRequest,
  ): Promise<{ snapshot: MonitorSnapshotSummary }> {
    const timestamp = new Date().toISOString();
    const jsonExtraStr = JSON.stringify(req.json_extra ?? {});
    try {
      const inserted = await this.db<MonitorSnapshotRow>('monitor_snapshots')
        .insert({
          server_id: serverId,
          timestamp,
          cpu_percent: req.cpu_percent ?? null,
          memory_mb: req.memory_mb ?? null,
          tick_rate: req.tick_rate ?? null,
          player_count: req.player_count ?? null,
          json_extra: jsonExtraStr,
        })
        .returning('*');
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return { snapshot: toMonitorSnapshotSummary(row) };
    } catch (err) {
      throw new MonitorSnapshotCreateFailedError(
        `监控快照创建失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 按 timestamp DESC 取第一条
   */
  async getLatest(
    serverId: string,
  ): Promise<{ snapshot: MonitorSnapshotSummary | null }> {
    const row = await this.db<MonitorSnapshotRow>('monitor_snapshots')
      .where({ server_id: serverId })
      .orderBy('timestamp', 'desc')
      .first();
    if (!row) {
      return { snapshot: null };
    }
    return { snapshot: toMonitorSnapshotSummary(row) };
  }

  /**
   * 阈值告警检查（S7-3 实现）
   *
   * 从 system_config 表读取阈值配置（key/value 结构）：
   *   - monitor.threshold_cpu      (数值，百分比 0-100)
   *   - monitor.threshold_memory   (数值，MB)
   *   - monitor.threshold_tick     (数值，最低 tick rate)
   *   - monitor.threshold_players  (数值，最高玩家数)
   *
   * 对比传入 metrics，任一指标超阈值则 alert=true，message 拼接所有超阈值项。
   * 未配置阈值的指标跳过（不告警）。所有阈值未配置时返回 {alert: false}。
   */
  async checkThreshold(
    serverId: string,
    metrics: {
      cpu_percent?: number | null;
      memory_mb?: number | null;
      tick_rate?: number | null;
      player_count?: number | null;
    },
  ): Promise<{ alert: boolean; message?: string }> {
    // serverId 保留用于未来按服务器维度覆盖阈值（system_config key 可加 server_id 前缀）
    void serverId;

    const thresholdKeys = [
      'monitor.threshold_cpu',
      'monitor.threshold_memory',
      'monitor.threshold_tick',
      'monitor.threshold_players',
    ] as const;

    const rows = await this.db<{ key: string; value: string }>('system_config')
      .whereIn('key', thresholdKeys as unknown as string[]);

    const configMap = new Map<string, number>();
    for (const row of rows) {
      const num = Number(row.value);
      if (Number.isFinite(num)) {
        configMap.set(row.key, num);
      }
    }

    const exceeded: string[] = [];

    // CPU：> threshold 触发
    if (metrics.cpu_percent != null) {
      const th = configMap.get('monitor.threshold_cpu');
      if (th !== undefined && metrics.cpu_percent > th) {
        exceeded.push(`CPU ${metrics.cpu_percent.toFixed(1)}% > ${th}%`);
      }
    }

    // 内存：> threshold 触发
    if (metrics.memory_mb != null) {
      const th = configMap.get('monitor.threshold_memory');
      if (th !== undefined && metrics.memory_mb > th) {
        exceeded.push(`内存 ${metrics.memory_mb}MB > ${th}MB`);
      }
    }

    // Tick rate：< threshold 触发（低 tick 为异常）
    if (metrics.tick_rate != null) {
      const th = configMap.get('monitor.threshold_tick');
      if (th !== undefined && metrics.tick_rate < th) {
        exceeded.push(`Tick ${metrics.tick_rate} < ${th}`);
      }
    }

    // 玩家数：> threshold 触发
    if (metrics.player_count != null) {
      const th = configMap.get('monitor.threshold_players');
      if (th !== undefined && metrics.player_count > th) {
        exceeded.push(`玩家数 ${metrics.player_count} > ${th}`);
      }
    }

    if (exceeded.length === 0) {
      return { alert: false };
    }
    return { alert: true, message: `监控告警: ${exceeded.join('; ')}` };
  }

  /**
   * C6: 历史数据自动清理——保留最近 N 天的监控快照。
   *
   * 清理策略：
   *   - 按 timestamp 时间维度，删除早于 cutoff 的快照
   *   - 可指定 serverId 仅清理特定实例，未指定则清理全部实例
   *   - 默认保留 7 天（可通过参数覆盖）
   *
   * 适用于调度器周期调用（如每日清理一次），避免 monitor_snapshots 无限增长。
   *
   * @param retentionDays 保留天数（默认 7）
   * @param serverId 可选，指定实例 ID；未指定则清理所有实例
   * @returns 删除的记录数
   */
  async cleanupHistory(
    retentionDays: number = 7,
    serverId?: string,
  ): Promise<{ deleted: number }> {
    // 计算保留截止时间
    const retention = Math.max(1, Math.floor(retentionDays));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    const cutoffIso = cutoff.toISOString();

    const query = this.db<MonitorSnapshotRow>('monitor_snapshots')
      .where('timestamp', '<', cutoffIso);
    if (serverId) {
      void query.where({ server_id: serverId });
    }
    const deleted = await query.delete();
    return { deleted };
  }
}

// ----- 纯函数 / 转换函数 -----

function toMonitorSnapshotSummary(
  row: MonitorSnapshotRow,
): MonitorSnapshotSummary {
  let extra: Record<string, unknown> | null = null;
  if (row.json_extra) {
    try {
      extra = JSON.parse(row.json_extra) as Record<string, unknown>;
    } catch {
      extra = null;
    }
  }
  return {
    id: row.id,
    server_id: row.server_id,
    timestamp: row.timestamp,
    cpu_percent: row.cpu_percent,
    memory_mb: row.memory_mb,
    tick_rate: row.tick_rate,
    player_count: row.player_count,
    json_extra: extra,
  };
}

// ----- 工厂 -----

export function createMonitorService(db: Knex): MonitorServiceImpl {
  return new MonitorServiceImpl(db);
}
