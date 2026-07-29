/**
 * system-metrics-service.d.ts — systemMetricsService 接口存根
 *
 * 职责：实时采集本机系统指标（CPU/内存/磁盘/进程）与服务健康状态
 * 来源：s0103 融合定稿 v3.4.0 §互斥点（SystemHealth 页面）
 *
 * @version 1.0.0
 */

import type { SystemMetrics, SystemHealth } from './shared-types';
import { SystemMetricsCollectionFailedError } from './shared-types';

export interface SystemMetricsService {
  /**
   * 采集本机系统指标。读取 /proc/stat、/proc/meminfo、/proc/diskstats 等
   * （Linux 专用，rules-1.md 已确认本项目仅 Linux）。
   *
   * 返回单次快照，不持久化（P0 实时不持久，后续 P1 可落 monitor_snapshots 表）。
   *
   * @throws {SystemMetricsCollectionFailedError} 采集失败（如 /proc 不可读）
   */
  getSystemMetrics(): Promise<SystemMetrics>;

  /**
   * 检查关键服务健康状态。返回聚合状态 + 各服务子状态。
   *
   * 检查项（白名单）：
   * - panel-backend：HTTP GET /api/health（自身）
   * - panel-database：SELECT 1（knex.raw）
   * - panel-daemon：HTTP GET /api/health（DAEMON_URL，超时 2s）
   * - panel-migrations：检查是否有 pending migrations（knex.migrate.currentVersion + list）
   *
   * @throws {SystemMetricsCollectionFailedError} 全部检查失败
   */
  getSystemHealth(): Promise<SystemHealth>;
}
