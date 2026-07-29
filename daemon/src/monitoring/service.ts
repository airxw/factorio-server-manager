// ============================================================================
// 模块_Daemon监控服务 — 内存快照存储 + 主动采集编排
// 职责：
//   1. 保留外部推送数据存储能力（recordSnapshot）
//   2. 集成 MonitorCollector，提供 startAutoCollection/stopAutoCollection
//   3. 采集快照存内存；可选通过 onPushToPanel 回调推送到 Panel
// 采集间隔由环境变量 MONITOR_INTERVAL_MS 配置（默认 10000ms）。
// ============================================================================

import type { Logger } from 'pino';
import { MonitorCollector, type MonitorSnapshot } from './collector.js';

/** 单实例内存中保留的最大快照条数（FIFO 裁剪）。 */
const MAX_SNAPSHOTS_PER_INSTANCE = 1000;

/** 默认采集间隔（毫秒）。 */
const DEFAULT_INTERVAL_MS = 10000;

/**
 * 监控服务：管理内存快照存储 + 主动采集器。
 *
 * 数据流：
 *   - 外部推送：recordSnapshot(snapshot) → 存内存
 *   - 主动采集：collector 定时采集 → handleSnapshot → 存内存 + 可选推 Panel
 */
export class MonitorService {
  private readonly snapshots = new Map<string, MonitorSnapshot[]>();
  private readonly collector: MonitorCollector;
  private readonly logger: Logger;
  private readonly onPushToPanel?: (snapshot: MonitorSnapshot) => void;

  constructor(
    logger: Logger,
    options?: {
      intervalMs?: number;
      onPushToPanel?: (snapshot: MonitorSnapshot) => void;
      getChildPids?: (pid: number) => Promise<number[]>;
    },
  ) {
    this.logger = logger;
    this.onPushToPanel = options?.onPushToPanel;
    const intervalMs = options?.intervalMs ?? parseIntervalFromEnv();
    this.collector = new MonitorCollector(
      logger,
      (snapshot) => this.handleSnapshot(snapshot),
      { intervalMs, getChildPids: options?.getChildPids },
    );
  }

  /** 记录外部推送的快照（保留现有外部推送存储能力）。 */
  recordSnapshot(snapshot: MonitorSnapshot): void {
    this.storeSnapshot(snapshot);
  }

  /** 开始主动采集指定实例。 */
  startAutoCollection(instanceId: string, pid: number): void {
    this.collector.startCollection(instanceId, pid);
  }

  /** 停止主动采集指定实例。 */
  stopAutoCollection(instanceId: string): void {
    this.collector.stopCollection(instanceId);
  }

  /**
   * 查询实例历史快照（按时间倒序，返回最近 limit 条）。
   * @param limit 默认 50
   */
  getSnapshots(instanceId: string, limit: number = 50): MonitorSnapshot[] {
    const list = this.snapshots.get(instanceId) ?? [];
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    return list.slice(-safeLimit).reverse();
  }

  /** 停止所有采集。 */
  stopAll(): void {
    this.collector.stopAll();
  }

  /** collector 回调：存内存 + 可选推 Panel。 */
  private handleSnapshot(snapshot: MonitorSnapshot): void {
    this.storeSnapshot(snapshot);
    if (this.onPushToPanel) {
      try {
        this.onPushToPanel(snapshot);
      } catch (err) {
        this.logger.warn(
          { instance_id: snapshot.instance_id, err: String(err) },
          'monitor: 推送到Panel失败',
        );
      }
    }
  }

  /** 存入内存并裁剪到上限。 */
  private storeSnapshot(snapshot: MonitorSnapshot): void {
    const list = this.snapshots.get(snapshot.instance_id) ?? [];
    list.push(snapshot);
    if (list.length > MAX_SNAPSHOTS_PER_INSTANCE) {
      list.splice(0, list.length - MAX_SNAPSHOTS_PER_INSTANCE);
    }
    this.snapshots.set(snapshot.instance_id, list);
  }
}

/** 从环境变量 MONITOR_INTERVAL_MS 解析采集间隔，非法时回退默认值。 */
function parseIntervalFromEnv(): number {
  const raw = process.env.MONITOR_INTERVAL_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_INTERVAL_MS;
}
