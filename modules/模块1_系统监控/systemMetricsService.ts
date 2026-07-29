// ============================================================================
// systemMetricsService.ts — 模块1_系统监控：系统指标采集 + 服务健康检查
//
// 契约对齐：
//   - public/interface_stub/system-metrics-service.d.ts (SystemMetricsService, @version 1.0.0)
//   - public/interface_stub/shared-types.d.ts (SystemMetrics, ServiceHealth, SystemHealth)
//   - public/schema/error-codes-schema.json (SYSTEM_METRICS_001, http_status=500, retryable=true)
//
// 实现要点（模块专属约束）：
//   - CPU: /proc/stat jiffies 差值，采样间隔 100ms
//   - Memory: /proc/meminfo MemTotal / MemAvailable (KB → MB)
//   - Disk: fs.promises.statfs(${DEPLOY_ROOT:-/}) 分区使用率 (bytes → GB)
//   - Load average: /proc/loadavg (1/5/15 min)
//   - Uptime: /proc/uptime (秒)
//   - Backend health: process.memoryUsage().rss + process.uptime() 自检
//   - DB health: knex.raw('SELECT 1'), 超时 1000ms
//   - Daemon health: fetch(${DAEMON_URL}/health), 超时 2000ms
//   - 健康状态映射: 全 healthy→healthy; 任一 unhealthy→unhealthy; 任一 degraded→degraded
//   - 采集失败抛 SystemMetricsCollectionFailedError (不部分返回)
//   - 所有 /proc 读取用 fs.promises.readFile，不阻塞事件循环
//
// 约束:
//   - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现
//   - 故 AppError + SystemMetricsCollectionFailedError 在本模块内提供运行时实现
//     (shared-types.d.ts 仅是类型声明，无运行时实现)
// ============================================================================

import fs from 'node:fs/promises';
import type { Knex } from 'knex';
import type { SystemMetricsService } from '@public/interface_stub/system-metrics-service';
import type { SystemMetrics, SystemHealth, ServiceHealth } from '@public/interface_stub/shared-types';

// ----------------------------------------------------------------------------
// 运行时错误类（本模块内联，与 shared-types.d.ts 声明对齐）
// ----------------------------------------------------------------------------

/**
 * 应用错误基类（对应 shared-types.d.ts AppError）。
 * 与 panel/backend/src/services/errors.ts 的 AppError 结构一致，但本模块独立定义，
 * 避免违反“禁止 import panel/backend/src/services/ 内部代码”约束。
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly category?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;

  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * 系统指标采集失败错误。
 * code = SYSTEM_METRICS_001 (error-codes-schema.json: http_status=500, retryable=true)
 */
export class SystemMetricsCollectionFailedError extends AppError {
  readonly code = 'SYSTEM_METRICS_001';
  readonly category = 'system';
  readonly httpStatus = 500;
  readonly retryable = true;

  constructor(message = '系统指标采集失败') {
    super(message);
  }
}

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------

/** CPU 采样间隔（ms），两次 /proc/stat 读取之间的等待 */
const CPU_SAMPLE_INTERVAL_MS = 100;

/** DB 健康检查超时（ms） */
const DB_HEALTH_TIMEOUT_MS = 1000;

/** Daemon 健康检查超时（ms） */
const DAEMON_HEALTH_TIMEOUT_MS = 2000;

/** 字节 → GB 换算 */
const BYTES_PER_GB = 1024 * 1024 * 1024;

/** KB → MB 换算 */
const KB_PER_MB = 1024;

// ----------------------------------------------------------------------------
// 服务实现
// ----------------------------------------------------------------------------

/**
 * SystemMetricsService 实现。
 *
 * 通过构造函数注入共享基础设施（db knex 连接、daemonUrl），
 * 不依赖其他模块的内部实现。
 */
export class SystemMetricsServiceImpl implements SystemMetricsService {
  constructor(
    private readonly db: Knex,
    private readonly daemonUrl: string,
  ) {}

  /**
   * 采集本机系统指标快照。
   * 任一采集项失败即抛 SystemMetricsCollectionFailedError（不部分返回）。
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      // CPU 采样需两次读取 + 100ms 间隔；其余采集项与之并行
      const [cpuPercent, mem, disk, loadAvg, uptimeSeconds] = await Promise.all([
        this.collectCpuPercent(),
        this.collectMemory(),
        this.collectDisk(),
        this.collectLoadAvg(),
        this.collectUptime(),
      ]);

      return {
        cpuPercent,
        memUsedMb: mem.usedMb,
        memTotalMb: mem.totalMb,
        diskUsedGb: disk.usedGb,
        diskTotalGb: disk.totalGb,
        uptimeSeconds,
        nodeVersion: process.versions.node,
        loadAvg,
      };
    } catch (err) {
      throw new SystemMetricsCollectionFailedError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * 检查关键服务健康状态。
   * 各服务检查独立容错：单个失败标记 unhealthy，不中断其他检查。
   * 全部检查失败时抛 SystemMetricsCollectionFailedError。
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const [backend, database, daemon] = await Promise.all([
      this.checkBackendHealth(),
      this.checkDbHealth(),
      this.checkDaemonHealth(),
    ]);
    const services: ServiceHealth[] = [backend, database, daemon];

    // 契约 @throws 全部检查失败
    const allFailed = services.every((s) => s.status === 'unhealthy');
    if (allFailed) {
      throw new SystemMetricsCollectionFailedError('全部健康检查失败');
    }

    return {
      status: aggregateStatus(services),
      services,
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // 私有采集方法
  // ==========================================================================

  /**
   * CPU 使用率：读取 /proc/stat 两次（间隔 100ms），计算 jiffies 差值百分比。
   * 使用 aggregate cpu 行（已含所有核心），百分比 0-100。
   */
  private async collectCpuPercent(): Promise<number> {
    const first = await this.readCpuJiffies();
    await sleep(CPU_SAMPLE_INTERVAL_MS);
    const second = await this.readCpuJiffies();

    const deltaTotal = second.total - first.total;
    const deltaIdle = second.idle - first.idle;
    if (deltaTotal <= 0) return 0;

    const percent = (1 - deltaIdle / deltaTotal) * 100;
    return Math.max(0, Math.min(100, percent));
  }

  /**
   * 内存使用：解析 /proc/meminfo MemTotal 与 MemAvailable，返回 MB。
   */
  private async collectMemory(): Promise<{ totalMb: number; usedMb: number }> {
    const content = await fs.readFile('/proc/meminfo', 'utf-8');
    const memTotalKb = parseMemFieldKb(content, 'MemTotal');
    const memAvailableKb = parseMemFieldKb(content, 'MemAvailable');
    if (memTotalKb === null) {
      throw new Error('无法解析 /proc/meminfo MemTotal');
    }
    const available = memAvailableKb ?? 0;
    const totalMb = memTotalKb / KB_PER_MB;
    const usedMb = Math.max(0, (memTotalKb - available) / KB_PER_MB);
    return { totalMb, usedMb };
  }

  /**
   * 磁盘使用：fs.promises.statfs 获取 ${DEPLOY_ROOT:-/} 所在分区使用率，返回 GB。
   * Node 18.13+ 提供 fs.promises.statfs，当前环境 Node 22 可用。
   */
  private async collectDisk(): Promise<{ totalGb: number; usedGb: number }> {
    const target = process.env.DEPLOY_ROOT ?? '/';
    const stats = await fs.statfs(target);
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bfree;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      totalGb: totalBytes / BYTES_PER_GB,
      usedGb: usedBytes / BYTES_PER_GB,
    };
  }

  /**
   * Load average：读取 /proc/loadavg 前三个值（1/5/15 分钟）。
   */
  private async collectLoadAvg(): Promise<[number, number, number]> {
    const content = await fs.readFile('/proc/loadavg', 'utf-8');
    const parts = content.trim().split(/\s+/);
    const v1 = parseFloat(parts[0] ?? '');
    const v5 = parseFloat(parts[1] ?? '');
    const v15 = parseFloat(parts[2] ?? '');
    if (!Number.isFinite(v1) || !Number.isFinite(v5) || !Number.isFinite(v15)) {
      throw new Error(`无法解析 /proc/loadavg: ${content.trim()}`);
    }
    return [v1, v5, v15];
  }

  /**
   * Uptime：读取 /proc/uptime 第一个值（秒）。
   */
  private async collectUptime(): Promise<number> {
    const content = await fs.readFile('/proc/uptime', 'utf-8');
    const parts = content.trim().split(/\s+/);
    const uptime = parseFloat(parts[0] ?? '');
    if (!Number.isFinite(uptime)) {
      throw new Error(`无法解析 /proc/uptime: ${content.trim()}`);
    }
    return uptime;
  }

  /**
   * 读取 /proc/stat 首行（aggregate cpu）的 jiffies 总量与 idle 量。
   */
  private async readCpuJiffies(): Promise<{ total: number; idle: number }> {
    const content = await fs.readFile('/proc/stat', 'utf-8');
    const firstLine = content.split('\n', 1)[0] ?? '';
    const parsed = parseCpuLine(firstLine);
    if (parsed === null) {
      throw new Error(`无法解析 /proc/stat 首行: ${firstLine}`);
    }
    return parsed;
  }

  // ==========================================================================
  // 私有健康检查方法
  // ==========================================================================

  /**
   * Backend 健康自检：process.memoryUsage().rss + process.uptime()。
   * 进程在运行即视为 healthy。
   */
  private async checkBackendHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const mem = process.memoryUsage();
      const uptime = process.uptime();
      return {
        name: 'panel-backend',
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB uptime=${Math.floor(uptime)}s`,
      };
    } catch (err) {
      return {
        name: 'panel-backend',
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * DB 健康检查：knex.raw('SELECT 1')，超时 1000ms。
   * 使用 Promise.race + setTimeout，finally 清理 timer 避免未处理 rejection。
   */
  private async checkDbHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('DB health check timeout')),
          DB_HEALTH_TIMEOUT_MS,
        );
      });
      await Promise.race([this.db.raw('SELECT 1'), timeoutPromise]);
      return {
        name: 'panel-database',
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: 'ok',
      };
    } catch (err) {
      return {
        name: 'panel-database',
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Daemon 健康检查：HTTP GET ${daemonUrl}/health，超时 2000ms。
   * 使用 AbortSignal.timeout；2xx 视为 healthy，否则 unhealthy。
   */
  private async checkDaemonHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    const url = `${this.daemonUrl}/health`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DAEMON_HEALTH_TIMEOUT_MS),
      });
      const latency = Date.now() - start;
      if (response.ok) {
        return {
          name: 'panel-daemon',
          status: 'healthy',
          latencyMs: latency,
          message: `HTTP ${response.status}`,
        };
      }
      return {
        name: 'panel-daemon',
        status: 'unhealthy',
        latencyMs: latency,
        message: `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        name: 'panel-daemon',
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ----------------------------------------------------------------------------
// 工厂函数
// ----------------------------------------------------------------------------

/**
 * 创建 SystemMetricsService 实例。
 * 由 index.ts 装配时调用，注入共享 db 与 daemonUrl。
 */
export function createSystemMetricsService(
  db: Knex,
  daemonUrl: string,
): SystemMetricsServiceImpl {
  return new SystemMetricsServiceImpl(db, daemonUrl);
}

// ----------------------------------------------------------------------------
// 辅助函数（模块内私有）
// ----------------------------------------------------------------------------

/**
 * Promise-based 非阻塞 sleep。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析 /proc/stat 首行（aggregate cpu），返回 {total, idle} jiffies。
 * 行格式：`cpu  user nice system idle iowait irq softirq steal [guest guest_nice]`
 * idle 含 idle + iowait；total 含 user+nice+system+idle+iowait+irq+softirq+steal。
 */
function parseCpuLine(line: string): { total: number; idle: number } | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'cpu') return null;
  const values = parts.slice(1).map((s) => Number(s));
  if (values.length < 4 || values.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = values;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  const idleAll = idle + iowait;
  return { total, idle: idleAll };
}

/**
 * 从 /proc/meminfo 内容中解析指定字段的 KB 值。
 * 行格式：`MemTotal:       16384000 kB`
 */
function parseMemFieldKb(content: string, field: string): number | null {
  const re = new RegExp(`^${field}:\\s+(\\d+)\\s+kB`, 'm');
  const m = re.exec(content);
  if (!m || m[1] === undefined) return null;
  const val = parseInt(m[1], 10);
  return Number.isFinite(val) ? val : null;
}

/**
 * 聚合服务健康状态：
 *   任一 unhealthy → unhealthy
 *   任一 degraded（无 unhealthy）→ degraded
 *   全 healthy → healthy
 */
function aggregateStatus(
  services: ServiceHealth[],
): 'healthy' | 'degraded' | 'unhealthy' {
  if (services.some((s) => s.status === 'unhealthy')) return 'unhealthy';
  if (services.some((s) => s.status === 'degraded')) return 'degraded';
  return 'healthy';
}
