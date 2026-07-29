/**
 * monitor-service.d.ts — monitorService 接口存根
 *
 * 职责：监控快照存储 / 时序查询 / 阈值告警
 * 数据契约：public/schema/monitor-snapshots-schema.json
 * 来源：scheme-final-merged.md §4.3.6 P4 / §2.3.1 resource.metrics / §7.1 P4
 */

import type { MonitorMetrics, MonitorSnapshot } from './shared-types';
import { MonitorDataNotFoundError } from './shared-types';

export interface MonitorService {
  /**
   * 记录监控快照。Daemon 上报 resource.metrics 事件时调用。
   * INSERT monitor_snapshots。
   * @param serverId 目标服务器 ID
   * @param metrics 监控指标（CPU/内存/Tick/玩家数）
   */
  recordSnapshot(serverId: string, metrics: MonitorMetrics): Promise<void>;

  /**
   * 查询时间范围内的监控快照（时序数据）。
   * @param from 起始时间（ISO 8601）
   * @param to 结束时间（ISO 8601）
   * @throws {MonitorDataNotFoundError} 时间范围内无数据
   */
  getSnapshots(serverId: string, from: string, to: string): Promise<MonitorSnapshot[]>;

  /**
   * 阈值告警检查。对比当前 metrics 与配置阈值（system_config 中的 monitor.threshold_*）。
   * @returns {alert, message?} alert=true 表示超阈值；message 为告警描述
   */
  checkThreshold(
    serverId: string,
    metrics: MonitorMetrics,
  ): Promise<{ alert: boolean; message?: string }>;
}

export { MonitorDataNotFoundError } from './shared-types';
