// ============================================================================
// 模块5_Daemon协议层 — 类型定义
// 依据：daemon/src/protocol/AGENTS.md §模块专属约束 2/3
// 实现：public/interface_stub/command-protocol.ts 的 CommandProtocol 接口
// ============================================================================

import type { ChildProcess } from 'node:child_process';

// 重新导出 CommandProtocol 接口，供协议层与实例层统一引用
export type { CommandProtocol } from '@public/interface_stub/command-protocol';

/**
 * RCON 协议上下文：Daemon 与游戏服务器 RCON 端口建立 TCP 连接所需的全部信息。
 * host 固定为 127.0.0.1（P0 单机模式，Daemon 与游戏进程同机）。
 */
export interface RconInstanceContext {
  readonly kind: 'rcon';
  readonly host: string;
  readonly rconPort: number;
  readonly rconPassword: string;
}

/**
 * stdin 协议上下文：Factorio 等仅支持 stdin 单向通信的游戏使用。
 * P0 为 stub 实现，仅持有子进程句柄以便写入 stdin。
 */
export interface StdinInstanceContext {
  readonly kind: 'stdin';
  readonly childProcess: ChildProcess;
}

/**
 * 实例协议上下文：ProtocolFactory.create 按 protocol.type 与 ctx.kind 配对分发。
 * 联合体通过 kind 字段区分，确保 RCON/stdin 上下文不会被混用。
 */
export type InstanceContext = RconInstanceContext | StdinInstanceContext;
