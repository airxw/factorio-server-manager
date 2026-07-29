// ============================================================================
// 模块_Daemon监控采集 — 进程级 CPU/内存 主动采集器
// 使用 Node 内置 child_process 调用 ps 命令采集进程指标，不引入外部依赖。
// 采集策略：setInterval 定时采集，通过 onSnapshot 回调将快照推送给上层服务。
// ============================================================================

import { setInterval, clearInterval } from 'node:timers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

/** 监控快照：单次采集的进程指标。 */
export interface MonitorSnapshot {
  instance_id: string;
  cpu_pct: number | null;
  mem_mb: number | null;
  players: number | null;
  uptime_sec: number | null;
  status: string;
  collected_at: string;
}

/**
 * 监控采集器：定期采集进程 CPU/内存，推送到 monitorService。
 *
 * 线程模型：每个实例一个 setInterval 定时器，回调内异步采集并触发 onSnapshot。
 * 采集失败仅记录告警日志，不中断后续采集周期。
 *
 * A3: 穿透子进程监控 — 当传入 getChildPids 函数时，采集会穿透 bash/cmd wrapper
 * 聚合整个进程树的 CPU/内存，而非仅监控直接子进程（wrapper 本身）。
 */
export class MonitorCollector {
  private readonly intervals = new Map<string, NodeJS.Timeout>();
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly onSnapshot: (snapshot: MonitorSnapshot) => void;
  /** A3: 可选的子进程穿透函数，返回 pid 的所有后代 PID */
  private readonly getChildPids?: (pid: number) => Promise<number[]>;

  constructor(
    logger: Logger,
    onSnapshot: (snapshot: MonitorSnapshot) => void,
    options?: { intervalMs?: number; getChildPids?: (pid: number) => Promise<number[]> },
  ) {
    this.logger = logger;
    this.onSnapshot = onSnapshot;
    this.intervalMs = options?.intervalMs ?? 10000; // 默认10秒
    this.getChildPids = options?.getChildPids;
  }

  /** 开始采集指定实例。 */
  startCollection(instanceId: string, pid: number): void {
    if (this.intervals.has(instanceId)) {
      this.stopCollection(instanceId);
    }

    const timer = setInterval(() => {
      void this.collectOnce(instanceId, pid);
    }, this.intervalMs);

    this.intervals.set(instanceId, timer);
    this.logger.info({ instance_id: instanceId, pid, intervalMs: this.intervalMs }, 'monitor: 开始采集');
  }

  /** 停止采集。 */
  stopCollection(instanceId: string): void {
    const timer = this.intervals.get(instanceId);
    if (timer) {
      clearInterval(timer);
      this.intervals.delete(instanceId);
      this.logger.info({ instance_id: instanceId }, 'monitor: 停止采集');
    }
  }

  /** 采集一次快照。 */
  private async collectOnce(instanceId: string, pid: number): Promise<void> {
    try {
      // A3: 穿透子进程监控 — 获取进程树全量 PID（根 + 所有后代）
      const childPids = this.getChildPids ? await this.getChildPids(pid) : [];
      const allPids = [pid, ...childPids].filter((p) => p > 0);

      const [cpuPct, memMb] = await Promise.all([
        this.getCpuUsage(allPids),
        this.getMemoryUsage(allPids),
      ]);

      const snapshot: MonitorSnapshot = {
        instance_id: instanceId,
        cpu_pct: cpuPct,
        mem_mb: memMb,
        players: null, // 需要RCON查询，暂时为null
        uptime_sec: null,
        status: 'running',
        collected_at: new Date().toISOString(),
      };

      this.onSnapshot(snapshot);
    } catch (err) {
      this.logger.warn({ instance_id: instanceId, err: String(err) }, 'monitor: 采集失败');
    }
  }

  /**
   * 使用 ps 命令获取 CPU 使用率（聚合进程树）。
   * A3: 当传入多个 PID 时聚合所有进程的 %cpu 之和，反映整个进程树的真实 CPU 占用。
   */
  private async getCpuUsage(pids: number[]): Promise<number | null> {
    if (pids.length === 0) return null;
    try {
      const pidArgs = pids.join(',');
      const { stdout } = await execFileAsync('ps', ['-p', pidArgs, '-o', '%cpu=', '--no-headers']);
      const lines = stdout.trim().split('\n').filter((s) => s.trim().length > 0);
      const total = lines.reduce((sum, line) => {
        const v = parseFloat(line.trim());
        return isNaN(v) ? sum : sum + v;
      }, 0);
      return lines.length === 0 ? null : total;
    } catch {
      return null;
    }
  }

  /**
   * 使用 ps 命令获取内存使用（MB，聚合进程树）。
   * A3: 当传入多个 PID 时聚合所有进程的 RSS 之和，反映整个进程树的真实内存占用。
   */
  private async getMemoryUsage(pids: number[]): Promise<number | null> {
    if (pids.length === 0) return null;
    try {
      const pidArgs = pids.join(',');
      const { stdout } = await execFileAsync('ps', ['-p', pidArgs, '-o', 'rss=', '--no-headers']);
      const lines = stdout.trim().split('\n').filter((s) => s.trim().length > 0);
      const totalKb = lines.reduce((sum, line) => {
        const v = parseFloat(line.trim());
        return isNaN(v) ? sum : sum + v;
      }, 0);
      return lines.length === 0 ? null : totalKb / 1024; // KB → MB
    } catch {
      return null;
    }
  }

  /** 停止所有采集。 */
  stopAll(): void {
    for (const instanceId of this.intervals.keys()) {
      this.stopCollection(instanceId);
    }
  }
}
