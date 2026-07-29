// ============================================================================
// systemMonitorService — 主机系统监控服务（v4.4.0-K1）
//
// 职责：
//   - 每 2 秒采样一次主机 CPU / 内存 / 磁盘使用率
//   - 通过 PanelWsServer.broadcastToAll 推送给所有已鉴权的前端连接
//   - 保留最近 1 小时历史数据（30 * 60 = 1800 条）供前端按需查询
//
// 设计要点：
//   - CPU 使用率：用 os.cpus() 的 idle/total 时间差计算，所有核心平均
//   - 进程 CPU：用 process.cpuUsage() 差值 + 墙钟时间归一化
//   - 内存：os.totalmem() / os.freemem()
//   - 磁盘：fs.statfs()（Node 18+），失败时降级跳过该字段
//   - 历史数据用环形数组（fixed-size），避免无界增长
//   - 启动时跳过首次 CPU 计算（无前次快照），返回 0
//   - 单例：通过 createSystemMonitorService 工厂创建，由 index.ts 启动/停止
// ============================================================================

import os from 'node:os';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PanelWsServer } from '../websocket/server.js';
import type { Logger } from 'pino';
import type { PanelSystemMonitorEvent } from '@public/schema/ws-events';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 采样间隔（毫秒） */
const SAMPLE_INTERVAL_MS = 2_000;

/** 历史数据保留条数（1 小时 / 2 秒 = 1800 条） */
const HISTORY_MAX_SIZE = 1_800;

/** 面板数据库所在路径（用于磁盘使用率查询的 target path） */
const PANEL_DB_PATH = process.env.DB_PATH ?? './data/panel.db';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 内部采样快照（含前次 CPU 时间用于差值计算） */
interface CpuSnapshot {
  /** 所有核心累计 idle 时间（ms） */
  idle: number;
  /** 所有核心累计 total 时间（ms） */
  total: number;
  /** 墙钟时间戳（ms） */
  timestamp: number;
}

/** 进程 CPU 快照 */
interface ProcessCpuSnapshot {
  /** process.cpuUsage() 累计 user+system 时间（μs） */
  cpuTime: number;
  /** 墙钟时间戳（ms） */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 服务实现
// ---------------------------------------------------------------------------

export class SystemMonitorService {
  /** 采样定时器 */
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 上一次系统 CPU 快照（首次采样为 null） */
  private lastCpuSnapshot: CpuSnapshot | null = null;
  /** 上一次进程 CPU 快照（首次采样为 null） */
  private lastProcessCpu: ProcessCpuSnapshot | null = null;
  /** 历史数据环形数组 */
  private history: PanelSystemMonitorEvent[] = [];
  /** 是否正在采样（防止重入） */
  private sampling = false;

  constructor(
    private readonly wsServer: PanelWsServer,
    private readonly logger: Logger,
  ) {}

  /**
   * 启动周期采样
   */
  start(): void {
    if (this.timer) {
      this.logger.warn('systemMonitorService 已经启动，忽略重复 start()');
      return;
    }
    this.logger.info(
      { interval_ms: SAMPLE_INTERVAL_MS, history_size: HISTORY_MAX_SIZE },
      'systemMonitorService 启动',
    );
    // 首次立即采样一次（建立基线快照，但不广播——首次 CPU 计算需要 2 个采样点）
    this.sample(false).catch((err) => {
      this.logger.error({ err }, 'systemMonitorService 首次采样失败');
    });
    this.timer = setInterval(() => {
      this.sample(true).catch((err) => {
        this.logger.error({ err }, 'systemMonitorService 采样失败');
      });
    }, SAMPLE_INTERVAL_MS);
  }

  /**
   * 停止周期采样
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('systemMonitorService 已停止');
    }
  }

  /**
   * 获取历史数据（最新在前）
   * @param limit 返回条数，默认 60（2 分钟）
   */
  getHistory(limit = 60): PanelSystemMonitorEvent[] {
    const safeLimit = Math.max(1, Math.min(limit, this.history.length));
    // history 是按时间顺序追加的（旧→新），返回最新在前
    return this.history.slice(-safeLimit).reverse();
  }

  /**
   * 立即采样一次
   * @param broadcast 是否广播到 WS（首次采样建议 false，因为无前次 CPU 快照）
   */
  private async sample(broadcast: boolean): Promise<void> {
    if (this.sampling) {
      // 上一次采样尚未完成，跳过本次（避免采样堆积）
      return;
    }
    this.sampling = true;
    try {
      const now = Date.now();
      const timestamp = new Date(now).toISOString();

      // 1. 系统 CPU 使用率
      const cpuInfo = this.calculateCpuPercent();
      const cpuPercent = cpuInfo.percent;

      // 2. 进程 CPU 使用率
      const processCpuPercent = this.calculateProcessCpuPercent(now);

      // 3. 内存
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

      // 4. 磁盘（fs.statfs，Node 18+）
      let diskPercent = 0;
      let diskUsedBytes = 0;
      let diskTotalBytes = 0;
      try {
        const stats = await getDiskStats(PANEL_DB_PATH);
        diskTotalBytes = stats.total;
        diskUsedBytes = stats.used;
        diskPercent = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
      } catch (err) {
        // 磁盘查询失败时保留 0 值，不阻断其他字段采集
        this.logger.debug({ err, path: PANEL_DB_PATH }, '磁盘使用率查询失败');
      }

      // 5. 进程 RSS
      const memUsage = process.memoryUsage();
      const processRssBytes = memUsage.rss;

      // 6. WS 连接数
      const wsConnections = this.wsServer.connectionCount();

      const event: PanelSystemMonitorEvent = {
        type: 'system.monitor',
        timestamp,
        cpu_percent: round2(cpuPercent),
        memory_percent: round2(memoryPercent),
        memory_used_bytes: usedMem,
        memory_total_bytes: totalMem,
        disk_percent: round2(diskPercent),
        disk_used_bytes: diskUsedBytes,
        disk_total_bytes: diskTotalBytes,
        process_rss_bytes: processRssBytes,
        process_cpu_percent: round2(processCpuPercent),
        ws_connections: wsConnections,
      };

      // 写入历史（环形）
      this.history.push(event);
      if (this.history.length > HISTORY_MAX_SIZE) {
        // 丢弃最旧的一条（FIFO）
        this.history.shift();
      }

      // 广播
      if (broadcast) {
        this.wsServer.broadcastToAll(event);
      }
    } finally {
      this.sampling = false;
    }
  }

  /**
   * 计算系统 CPU 使用率（自上次采样以来的差值）
   * - 首次调用返回 0 并建立基线快照
   * - 计算公式：1 - (idle_delta / total_delta) * 100
   */
  private calculateCpuPercent(): { percent: number } {
    const cpus = os.cpus();
    if (cpus.length === 0) {
      return { percent: 0 };
    }

    // 累加所有核心的 idle / total 时间
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const { user, nice, sys, idle: cpuIdle, irq } = cpu.times;
      const cpuTotal = user + nice + sys + cpuIdle + irq;
      idle += cpuIdle;
      total += cpuTotal;
    }

    const snapshot: CpuSnapshot = { idle, total, timestamp: Date.now() };

    if (!this.lastCpuSnapshot) {
      // 首次采样：建立基线，返回 0（无前次快照可计算差值）
      this.lastCpuSnapshot = snapshot;
      return { percent: 0 };
    }

    const idleDelta = snapshot.idle - this.lastCpuSnapshot.idle;
    const totalDelta = snapshot.total - this.lastCpuSnapshot.total;
    this.lastCpuSnapshot = snapshot;

    if (totalDelta <= 0) {
      return { percent: 0 };
    }

    const percent = (1 - idleDelta / totalDelta) * 100;
    // 限制在 0-100
    return { percent: clamp(percent, 0, 100) };
  }

  /**
   * 计算进程 CPU 使用率
   * - process.cpuUsage() 返回累计 user+system 时间（μs）
   * - 归一化为单核百分比：cpuTime_delta / wallTime_delta * 100
   * - 多核时可能 > 100%，限制为 100 * 核心数上限（实际中单进程很少超 100）
   */
  private calculateProcessCpuPercent(now: number): number {
    const cpuUsage = process.cpuUsage();
    const cpuTimeUs = cpuUsage.user + cpuUsage.system; // 微秒
    const snapshot: ProcessCpuSnapshot = { cpuTime: cpuTimeUs, timestamp: now };

    if (!this.lastProcessCpu) {
      this.lastProcessCpu = snapshot;
      return 0;
    }

    const cpuTimeDeltaUs = snapshot.cpuTime - this.lastProcessCpu.cpuTime;
    const wallTimeDeltaMs = snapshot.timestamp - this.lastProcessCpu.timestamp;
    this.lastProcessCpu = snapshot;

    if (wallTimeDeltaMs <= 0) {
      return 0;
    }

    // 转换为相同单位：cpuTime_delta 微秒 → 毫秒
    const cpuTimeDeltaMs = cpuTimeDeltaUs / 1000;
    // 单核占用率：cpuTime / wallTime * 100
    const percent = (cpuTimeDeltaMs / wallTimeDeltaMs) * 100;
    // 限制在 0-100（单核场景；多核场景下若想表示总占用率可除以核数，此处保持单核口径）
    return clamp(percent, 0, 100);
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 读取指定路径所在分区的磁盘使用情况
 * 优先使用 fs.statfsSync（Node 18+），失败时降级到 df 命令
 */
async function getDiskStats(targetPath: string): Promise<{ total: number; used: number; available: number }> {
  // 优先 fs.statfs（同步路径更快、无需 spawn）
  try {
    const stats = fs.statfsSync(targetPath);
    // fs.statfsSync 返回 { bsize, blocks, bfree, bavail, files, ffree }
    const total = stats.bsize * stats.blocks;
    const available = stats.bsize * stats.bavail;
    const used = total - stats.bsize * stats.bfree;
    return { total, used, available };
  } catch {
    // 路径不存在或 statfs 不可用，降级到 df
  }

  // 降级方案：df -B1（按字节）
  const { stdout } = await execAsync(
    `df -B1 --output=size,used,avail "${targetPath}" | tail -n 1`,
  );
  const parts = stdout.trim().split(/\s+/);
  if (parts.length < 3) {
    throw new Error(`df 输出格式异常: ${stdout}`);
  }
  const total = parseInt(parts[0], 10);
  const used = parseInt(parts[1], 10);
  const available = parseInt(parts[2], 10);
  if (!Number.isFinite(total) || !Number.isFinite(used)) {
    throw new Error(`df 输出解析失败: ${stdout}`);
  }
  return { total, used, available };
}

/** 保留 2 位小数 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 限制在 [min, max] 范围内 */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 SystemMonitorService 单例
 *
 * 使用方式：
 *   const service = createSystemMonitorService(wsServer, logger);
 *   service.start();
 *   // ... 服务运行期间 ...
 *   service.stop();
 */
export function createSystemMonitorService(
  wsServer: PanelWsServer,
  logger: Logger,
): SystemMonitorService {
  return new SystemMonitorService(wsServer, logger);
}
