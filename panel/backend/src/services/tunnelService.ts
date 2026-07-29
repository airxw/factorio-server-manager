// ============================================================================
// v4.4.0-O1: FRP 隧道服务抽象（TunnelService 接口 + frpc 实现）
//
// 架构说明：
//   - TunnelService 是抽象接口，定义 start/stop/isRunning/getLogs/getConfig
//   - FrpcTunnelService 是 frpc 客户端的实现，管理 frpc 进程生命周期
//   - 配置以 TOML 格式生成到 data/tunnel/frpc.toml
//   - 日志采集 stdout/stderr 到环形缓冲（最多 1000 行）
//
// frpc 二进制路径：
//   - 优先使用 FRPC_BIN_PATH 环境变量
//   - 其次 /usr/local/bin/frpc
//   - 最后 ./data/frpc/frpc（可由 Panel 下载放置）
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';

/** 隧道类型 */
export type TunnelType = 'tcp' | 'udp' | 'http' | 'https';

/** 单个隧道映射配置 */
export interface TunnelMapping {
  /** 隧道名称（唯一标识，用于配置段名） */
  name: string;
  /** 隧道类型 */
  type: TunnelType;
  /** 本地 IP（默认 127.0.0.1） */
  local_ip: string;
  /** 本地端口 */
  local_port: number;
  /** 远程端口（tcp/udp 类型必填） */
  remote_port?: number;
  /** 自定义域名（http/https 类型使用） */
  custom_domains?: string[];
}

/** 隧道服务完整配置 */
export interface TunnelConfig {
  /** frps 服务器地址 */
  server_addr: string;
  /** frps 服务器端口 */
  server_port: number;
  /** frps 认证 token（可选） */
  token?: string;
  /** 隧道映射列表 */
  tunnels: TunnelMapping[];
  /** 是否启用（false 时不启动 frpc 进程） */
  enabled: boolean;
}

/** 隧道日志条目 */
export interface TunnelLogEntry {
  /** ISO 时间戳 */
  timestamp: string;
  /** 日志级别（info/error） */
  level: 'info' | 'error';
  /** 日志内容 */
  message: string;
}

/** 隧道运行状态 */
export interface TunnelStatus {
  /** frpc 进程是否在运行 */
  running: boolean;
  /** 进程 PID（未运行时为 null） */
  pid: number | null;
  /** 当前配置是否启用 */
  enabled: boolean;
  /** frps 服务器地址 */
  server_addr: string;
  /** 隧道数量 */
  tunnel_count: number;
  /** 最近一次启动时间 ISO */
  started_at: string | null;
  /** 最近一次停止时间 ISO */
  stopped_at: string | null;
}

/** frpc 二进制路径 */
const FRPC_BIN_PATH =
  process.env.FRPC_BIN_PATH ?? '/usr/local/bin/frpc';

/** 配置文件路径 */
const FRPC_CONFIG_PATH = process.env.FRPC_CONFIG_PATH ?? './data/tunnel/frpc.toml';

/** 日志环形缓冲最大行数 */
const LOG_BUFFER_MAX = 1000;

/**
 * v4.4.0-O1: TunnelService 抽象接口
 *
 * 定义隧道服务的统一接口，支持未来扩展其他实现（sstap/zerotier 等）。
 */
export interface TunnelService {
  /** 启动 frpc 隧道 */
  start(): Promise<{ success: boolean; message: string }>;
  /** 停止 frpc 隧道 */
  stop(): Promise<{ success: boolean; message: string }>;
  /** 查询运行状态 */
  getStatus(): TunnelStatus;
  /** 获取最近日志 */
  getLogs(limit?: number): TunnelLogEntry[];
  /** 获取当前配置 */
  getConfig(): TunnelConfig;
  /** 更新配置（不自动重启，需手动调用 start/stop） */
  updateConfig(config: TunnelConfig): void;
}

/**
 * frpc 隧道服务实现
 *
 * 生命周期：
 *   - start(): 生成配置 → spawn frpc -c config → 采集日志
 *   - stop(): kill 进程 → 清理引用
 *   - 进程异常退出时自动记录日志，不自动重启（由调用方决定是否重连）
 */
export class FrpcTunnelService implements TunnelService {
  private readonly logger: Logger;
  private config: TunnelConfig;
  private process: ChildProcess | null = null;
  private pid: number | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private logBuffer: TunnelLogEntry[] = [];

  constructor(logger: Logger, initialConfig?: TunnelConfig) {
    this.logger = logger;
    this.config = initialConfig ?? {
      server_addr: '',
      server_port: 7000,
      token: undefined,
      tunnels: [],
      enabled: false,
    };
  }

  async start(): Promise<{ success: boolean; message: string }> {
    if (this.process) {
      return { success: false, message: 'frpc 已在运行中' };
    }
    if (!this.config.enabled) {
      return { success: false, message: '隧道服务未启用（config.enabled=false）' };
    }
    if (!this.config.server_addr) {
      return { success: false, message: 'frps 服务器地址未配置' };
    }
    if (this.config.tunnels.length === 0) {
      return { success: false, message: '未配置任何隧道映射' };
    }

    // 检查 frpc 二进制是否存在
    if (!fs.existsSync(FRPC_BIN_PATH)) {
      return {
        success: false,
        message: `frpc 二进制不存在: ${FRPC_BIN_PATH}。请下载 frpc 并放置到该路径，或设置 FRPC_BIN_PATH 环境变量。`,
      };
    }

    // 生成配置文件
    try {
      this.generateConfigFile();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `配置文件生成失败: ${message}` };
    }

    // 启动 frpc 进程
    try {
      this.logger.info({ bin: FRPC_BIN_PATH, config: FRPC_CONFIG_PATH }, '启动 frpc 隧道');
      const child = spawn(FRPC_BIN_PATH, ['-c', FRPC_CONFIG_PATH], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(FRPC_CONFIG_PATH),
      });

      this.process = child;
      this.pid = child.pid ?? null;
      this.startedAt = new Date().toISOString();
      this.stoppedAt = null;

      // 采集 stdout
      child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString('utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          this.appendLog('info', line);
        }
      });

      // 采集 stderr
      child.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString('utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          this.appendLog('error', line);
        }
      });

      // 进程退出处理
      child.on('exit', (code, signal) => {
        this.logger.warn({ code, signal, pid: this.pid }, 'frpc 进程退出');
        this.appendLog('error', `frpc 进程退出: code=${code} signal=${signal}`);
        this.process = null;
        this.pid = null;
        this.stoppedAt = new Date().toISOString();
      });

      child.on('error', (err) => {
        this.logger.error({ err: err.message }, 'frpc 进程启动失败');
        this.appendLog('error', `frpc 进程启动失败: ${err.message}`);
        this.process = null;
        this.pid = null;
        this.stoppedAt = new Date().toISOString();
      });

      this.appendLog('info', `frpc 已启动 (pid=${this.pid})`);
      return { success: true, message: `frpc 已启动 (pid=${this.pid})` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'frpc 启动异常');
      return { success: false, message: `frpc 启动异常: ${message}` };
    }
  }

  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.process) {
      return { success: false, message: 'frpc 未在运行' };
    }

    const pid = this.pid;
    try {
      this.process.kill('SIGTERM');
      this.process = null;
      this.pid = null;
      this.stoppedAt = new Date().toISOString();
      this.appendLog('info', `frpc 已停止 (pid=${pid})`);
      this.logger.info({ pid }, 'frpc 已停止');
      return { success: true, message: `frpc 已停止 (pid=${pid})` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, pid }, 'frpc 停止失败');
      return { success: false, message: `frpc 停止失败: ${message}` };
    }
  }

  getStatus(): TunnelStatus {
    return {
      running: this.process !== null,
      pid: this.pid,
      enabled: this.config.enabled,
      server_addr: this.config.server_addr,
      tunnel_count: this.config.tunnels.length,
      started_at: this.startedAt,
      stopped_at: this.stoppedAt,
    };
  }

  getLogs(limit = 100): TunnelLogEntry[] {
    const n = Math.max(1, Math.min(limit, this.logBuffer.length));
    return this.logBuffer.slice(-n);
  }

  getConfig(): TunnelConfig {
    return { ...this.config };
  }

  updateConfig(config: TunnelConfig): void {
    this.config = { ...config };
    this.logger.info(
      { server: config.server_addr, tunnels: config.tunnels.length },
      '隧道配置已更新（需手动 restart 生效）',
    );
  }

  /**
   * 生成 frpc.toml 配置文件。
   * TOML 格式，兼容 frp v0.52+。
   */
  private generateConfigFile(): void {
    const configDir = path.dirname(FRPC_CONFIG_PATH);
    fs.mkdirSync(configDir, { recursive: true });

    const lines: string[] = [];

    // 全局配置
    lines.push(`serverAddr = "${this.config.server_addr}"`);
    lines.push(`serverPort = ${this.config.server_port}`);
    if (this.config.token) {
      lines.push(`auth.token = "${this.config.token}"`);
    }
    lines.push('');

    // 隧道映射
    for (const tunnel of this.config.tunnels) {
      lines.push(`[[proxies]]`);
      lines.push(`name = "${tunnel.name}"`);
      lines.push(`type = "${tunnel.type}"`);
      lines.push(`localIP = "${tunnel.local_ip}"`);
      lines.push(`localPort = ${tunnel.local_port}`);
      if (tunnel.remote_port !== undefined) {
        lines.push(`remotePort = ${tunnel.remote_port}`);
      }
      if (tunnel.custom_domains && tunnel.custom_domains.length > 0) {
        lines.push(`customDomains = [${tunnel.custom_domains.map((d) => `"${d}"`).join(', ')}]`);
      }
      lines.push('');
    }

    const content = lines.join('\n');
    fs.writeFileSync(FRPC_CONFIG_PATH, content, { mode: 0o600 });
    this.logger.info({ path: FRPC_CONFIG_PATH }, 'frpc.toml 配置已生成');
  }

  /**
   * 追加日志到环形缓冲。
   */
  private appendLog(level: 'info' | 'error', message: string): void {
    this.logBuffer.push({
      timestamp: new Date().toISOString(),
      level,
      message,
    });
    // 环形缓冲：超过上限丢弃最旧的
    if (this.logBuffer.length > LOG_BUFFER_MAX) {
      this.logBuffer.shift();
    }
  }
}

/**
 * 工厂函数：创建 FrpcTunnelService 实例
 */
export function createTunnelService(logger: Logger, initialConfig?: TunnelConfig): TunnelService {
  return new FrpcTunnelService(logger, initialConfig);
}
