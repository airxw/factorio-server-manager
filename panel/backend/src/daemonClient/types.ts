// ============================================================================
// 模块6_Panel通信客户端 — 本地类型定义
// 实现 public/interface_stub/daemon-rest.ts 的接口契约
// ============================================================================

import type { GamePack } from '@public/schema/pack-schema';
import type { DaemonToPanelEvent } from '@public/schema/ws-events';
import type { Logger } from 'pino';

/**
 * Daemon HTTP 客户端配置
 */
export interface DaemonClientConfig {
  /** Daemon HTTP 基址，例如 http://localhost:8080 */
  baseUrl: string;
  /** Bearer Token，用于 Authorization 头 */
  token: string;
}

/**
 * startInstance 请求体（spec §3.7.1）
 * Daemon 期望接收完整 pack 内联 + 实例参数
 */
export interface StartInstanceBody {
  pack: GamePack;
  instance: {
    name: string;
    port: number;
    rcon_port: number;
    rcon_password: string;
    workdir: string;
  };
  /** 可选：指定启动存档路径，覆盖默认的 saves/world.{ext} */
  save_path?: string;
}

/**
 * DaemonEventStream 配置
 */
export interface DaemonEventStreamConfig {
  /** Daemon HTTP 基址，例如 http://localhost:8080 */
  baseUrl: string;
  /** Bearer Token，作为 ws query 参数 */
  token: string;
  /** 收到 Daemon 事件时的回调 */
  onEvent: (event: DaemonToPanelEvent) => void;
  /** 连接成功（含重连）的回调 */
  onConnect?: () => void;
  /** 日志器 */
  logger: Logger;
}

/**
 * 携带 code 与原始 message 的 Daemon 调用错误
 */
export class DaemonApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'DaemonApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
