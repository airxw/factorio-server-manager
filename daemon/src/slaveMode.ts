// ============================================================================
// slaveMode — Daemon 从节点模式（L2-2）
//
// 职责：
//   - 启动时向 master 注册（POST /api/nodes/link）或复用本地缓存的 commsKey
//   - 持久化 SlaveState 到 data/slave-state.json（重启后可复用）
//   - 每 10s 向 master 发送 heartbeat（POST /api/nodes/:id/heartbeat）
//   - 提供 getCommsKey() 供 auth 中间件校验 master 来电
//
// 启动条件（环境变量）：
//   SLAVE_MODE=true           — 启用 slave 模式
//   MASTER_URL=http://master:3000  — master Panel 访问地址
//   LINK_KEY=gsp_link_xxx     — 邀请密钥（首次注册用，注册后缓存 commsKey）
//   SLAVE_EXTERNAL_URL=http://slave:8080  — 可选，slave 对外访问地址（默认自动推断）
//   SLAVE_STATE_FILE=data/slave-state.json  — 可选，状态文件路径
//   HEARTBEAT_INTERVAL_MS=10000  — 可选，heartbeat 间隔（默认 10s）
//
// 与 master 的契约对齐：public/schema/panel-api-types.ts
//   POST /api/nodes/link           → { slave_url, link_key, display_fqdn? } → { node_id, comms_key }
//   POST /api/nodes/:id/heartbeat  → header x-comms-key + { cpu_percent?, ... } → { received: true }
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 持久化到本地的 slave 状态（重启后可复用 commsKey） */
export interface SlaveState {
  /** master 分配的节点 ID */
  node_id: string;
  /** master 颁发的通信密钥（与 master DB 中存的对齐） */
  comms_key: string;
  /** master Panel 访问地址（校验缓存是否仍指向同一 master） */
  master_url: string;
  /** 注册时间（ISO 8601） */
  linked_at: string;
}

/** SlaveModeClient 配置 */
export interface SlaveModeConfig {
  /** master Panel 访问地址（如 http://192.168.5.14:3000） */
  masterUrl: string;
  /** 邀请密钥明文（首次注册用） */
  linkKey: string;
  /** 本地状态文件路径（如 data/slave-state.json） */
  stateFile: string;
  /** slave daemon 自报的对外访问地址（如 http://192.168.1.10:8080） */
  slaveUrl: string;
  /** daemon 版本号（heartbeat 上报） */
  daemonVersion: string;
  /** heartbeat 间隔（ms，默认 10_000） */
  heartbeatIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 推断本机局域网 IP（非 127.0.0.1 的首个 IPv4 地址）。
 * 用于默认拼装 slave_url。若无法推断返回 '127.0.0.1'。
 */
export function detectLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/** 读取本地状态文件（不存在或解析失败返回 null） */
function readStateFile(filePath: string): SlaveState | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as SlaveState;
    if (
      typeof data.node_id !== 'string' ||
      typeof data.comms_key !== 'string' ||
      typeof data.master_url !== 'string'
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** 写入本地状态文件（自动创建父目录） */
function writeStateFile(filePath: string, state: SlaveState): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

/** 删除本地状态文件（commsKey 失效时清理） */
function clearStateFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

/** 采集系统指标用于 heartbeat 上报 */
function collectMetrics(): {
  cpu_percent?: number;
  memory_percent?: number;
} {
  try {
    const cpus = os.cpus();
    const loadavg = os.loadavg();
    // 用 1 分钟 loadavg / cpu 核数 * 100 粗略估算（Linux/Unix）
    const cpuPercent = cpus.length > 0 ? Math.min(100, (loadavg[0] / cpus.length) * 100) : 0;
    const total = os.totalmem();
    const free = os.freemem();
    const memPercent = total > 0 ? ((total - free) / total) * 100 : 0;
    return {
      cpu_percent: Number(cpuPercent.toFixed(1)),
      memory_percent: Number(memPercent.toFixed(1)),
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// SlaveModeClient
// ---------------------------------------------------------------------------

/**
 * Slave 模式客户端：负责向 master 注册 + 持久化 commsKey + 定时 heartbeat。
 *
 * 生命周期：
 *   1. start() — 注册或复用 commsKey + 启动 heartbeat 定时器
 *   2. getCommsKey() — auth 中间件查询当前 commsKey（master 调用 slave 时校验）
 *   3. shutdown() — 清理 heartbeat 定时器
 */
export class SlaveModeClient {
  private state: SlaveState | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs: number;

  constructor(
    private readonly config: SlaveModeConfig,
    private readonly logger: Logger,
  ) {
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 10_000;
  }

  /**
   * 启动 slave 模式：
   *   1. 读本地缓存，若有且指向同一 master → 发 heartbeat 验证 commsKey 是否仍有效
   *   2. 缓存无效或不存在 → 用 linkKey 重新 link
   *   3. 启动 heartbeat 定时器
   */
  async start(): Promise<SlaveState> {
    const cached = readStateFile(this.config.stateFile);

    if (cached && cached.master_url === this.config.masterUrl) {
      // 用 heartbeat 测试 commsKey 是否仍有效
      const valid = await this.testHeartbeat(cached);
      if (valid) {
        this.logger.info(
          { nodeId: cached.node_id, masterUrl: cached.master_url },
          'slave mode: 复用缓存的 commsKey',
        );
        this.state = cached;
        this.startHeartbeatLoop();
        return cached;
      }
      this.logger.warn('slave mode: 缓存的 commsKey 已失效，将重新注册');
      clearStateFile(this.config.stateFile);
    }

    // 用 linkKey 重新注册
    const state = await this.linkSlave();
    this.state = state;
    writeStateFile(this.config.stateFile, state);
    this.logger.info(
      { nodeId: state.node_id, masterUrl: state.master_url },
      'slave mode: 注册成功，commsKey 已持久化',
    );
    this.startHeartbeatLoop();
    return state;
  }

  /** 停止 heartbeat 定时器 */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.logger.info('slave mode: heartbeat 已停止');
  }

  /** 获取当前 commsKey（auth 中间件调用；未启动返回 null） */
  getCommsKey(): string | null {
    return this.state?.comms_key ?? null;
  }

  /** 获取当前 slave state（未启动返回 null） */
  getState(): SlaveState | null {
    return this.state;
  }

  // -----------------------------------------------------------------------
  // 内部：注册流程
  // -----------------------------------------------------------------------

  /**
   * 用 linkKey 向 master 注册。
   * @returns 新的 SlaveState（已写入本地文件）
   */
  private async linkSlave(): Promise<SlaveState> {
    const url = `${this.config.masterUrl}/api/nodes/link`;
    const body = {
      slave_url: this.config.slaveUrl,
      link_key: this.config.linkKey,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`slave mode: link 失败 [${resp.status}] ${text}`);
    }

    const data = (await resp.json()) as { node_id: string; comms_key: string };
    if (!data.node_id || !data.comms_key) {
      throw new Error(`slave mode: link 响应缺少 node_id/comms_key: ${JSON.stringify(data)}`);
    }

    return {
      node_id: data.node_id,
      comms_key: data.comms_key,
      master_url: this.config.masterUrl,
      linked_at: new Date().toISOString(),
    };
  }

  /**
   * 用缓存的 commsKey 发送一次 heartbeat 测试其有效性。
   * @returns true=commsKey 有效（200/201）；false=无效（401/其他）
   */
  private async testHeartbeat(state: SlaveState): Promise<boolean> {
    try {
      const resp = await fetch(
        `${state.master_url}/api/nodes/${encodeURIComponent(state.node_id)}/heartbeat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-comms-key': state.comms_key,
          },
          body: JSON.stringify({
            ...collectMetrics(),
            daemon_version: this.config.daemonVersion,
          }),
        },
      );
      return resp.ok;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'slave mode: testHeartbeat 网络异常，视为无效',
      );
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // 内部：heartbeat 定时循环
  // -----------------------------------------------------------------------

  private startHeartbeatLoop(): void {
    const tick = async (): Promise<void> => {
      if (!this.state) return;
      try {
        await this.sendHeartbeat();
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'slave mode: heartbeat 失败（将在下个周期重试）',
        );
      }
      // 重新调度（避免重叠）
      this.heartbeatTimer = setTimeout(() => {
        void tick();
      }, this.heartbeatIntervalMs) as NodeJS.Timeout;
    };

    // 首次立即发一次（确认 commsKey 仍有效）
    this.heartbeatTimer = setTimeout(() => {
      void tick();
    }, this.heartbeatIntervalMs) as NodeJS.Timeout;
  }

  /** 发送一次 heartbeat */
  private async sendHeartbeat(): Promise<void> {
    if (!this.state) return;
    const resp = await fetch(
      `${this.state.master_url}/api/nodes/${encodeURIComponent(this.state.node_id)}/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-comms-key': this.state.comms_key,
        },
        body: JSON.stringify({
          ...collectMetrics(),
          daemon_version: this.config.daemonVersion,
        }),
      },
    );

    if (resp.status === 401) {
      // commsKey 已失效（master 端被删/重新注册）→ 清缓存 + 尝试重新 link
      this.logger.warn('slave mode: heartbeat 返回 401，commsKey 已失效，尝试重新注册');
      clearStateFile(this.config.stateFile);
      try {
        const state = await this.linkSlave();
        this.state = state;
        writeStateFile(this.config.stateFile, state);
        this.logger.info({ nodeId: state.node_id }, 'slave mode: 重新注册成功');
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'slave mode: 重新注册失败，将在下个 heartbeat 周期重试',
        );
      }
      return;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`heartbeat 失败 [${resp.status}] ${text}`);
    }

    this.logger.debug({ nodeId: this.state.node_id }, 'slave mode: heartbeat 已上报');
  }
}

// ---------------------------------------------------------------------------
// 工厂函数：从环境变量构造 SlaveModeClient（若未启用 slave 模式返回 null）
// ---------------------------------------------------------------------------

/**
 * 从环境变量解析 SlaveModeConfig。
 * 返回 null 表示未启用 slave 模式（SLAVE_MODE 未设或非 'true'）。
 *
 * 必需环境变量：MASTER_URL、LINK_KEY
 * 可选环境变量：SLAVE_EXTERNAL_URL、SLAVE_STATE_FILE、HEARTBEAT_INTERVAL_MS、PORT
 */
export function parseSlaveModeConfigFromEnv(opts: {
  daemonVersion: string;
  defaultPort: number;
}): SlaveModeConfig | null {
  if (process.env.SLAVE_MODE !== 'true') return null;

  const masterUrl = process.env.MASTER_URL;
  const linkKey = process.env.LINK_KEY;
  if (!masterUrl || !linkKey) {
    throw new Error('slave mode 启用但缺少 MASTER_URL 或 LINK_KEY 环境变量');
  }

  const port = Number(process.env.PORT ?? opts.defaultPort);
  const slaveUrl = process.env.SLAVE_EXTERNAL_URL ?? `http://${detectLocalIp()}:${port}`;
  const stateFile = process.env.SLAVE_STATE_FILE ?? path.resolve(process.cwd(), 'data/slave-state.json');
  const heartbeatIntervalMs = process.env.HEARTBEAT_INTERVAL_MS
    ? Number(process.env.HEARTBEAT_INTERVAL_MS)
    : 10_000;

  return {
    masterUrl,
    linkKey,
    stateFile,
    slaveUrl,
    daemonVersion: opts.daemonVersion,
    heartbeatIntervalMs,
  };
}
