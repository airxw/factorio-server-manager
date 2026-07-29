// ============================================================================
// WebSocket 事件类型契约（Daemon→Panel→Frontend 统一）
// 依据：spec §3.7.1（Daemon→Panel）+ §3.7.2（Panel→Frontend）
// ============================================================================

import type { InstanceState } from './daemon-api-types';

// Daemon → Panel 事件类型（spec §3.7.1）
export type DaemonWsEventType =
  | 'connected'
  | 'instance.started'
  | 'instance.stopped'
  | 'console.output'
  | 'state.change';

// Panel → Daemon 命令类型（spec §3.7.1）
// v4.4.0-N1: 新增 'unsubscribe' 命令，支持按 instanceId 取消订阅
export type PanelToDaemonCommandType = 'subscribe' | 'unsubscribe';

// Panel → Frontend 事件类型（spec §3.7.2）
export type PanelToFrontendEventType =
  | 'console.output'
  | 'instance.state'
  | 'system.monitor';

// ----- 基础事件结构 -----
export interface BaseWsEvent {
  type: string;
  timestamp: string;
}

// ----- Daemon → Panel 事件 -----
export interface ConnectedEvent extends BaseWsEvent {
  type: 'connected';
  daemon_id: string;
  daemon_version: string;
}

export interface InstanceStartedEvent extends BaseWsEvent {
  type: 'instance.started';
  instance_id: string;
  pid: number;
}

export interface InstanceStoppedEvent extends BaseWsEvent {
  type: 'instance.stopped';
  instance_id: string;
  exit_code: number | null;
}

export interface ConsoleOutputEvent extends BaseWsEvent {
  type: 'console.output';
  instance_id: string;
  line: string;
  stream: 'stdout' | 'stderr';
}

export interface StateChangeEvent extends BaseWsEvent {
  type: 'state.change';
  instance_id: string;
  from: InstanceState;
  to: InstanceState;
}

export type DaemonToPanelEvent =
  | ConnectedEvent
  | InstanceStartedEvent
  | InstanceStoppedEvent
  | ConsoleOutputEvent
  | StateChangeEvent;

// ----- Panel → Daemon 命令 -----
export interface SubscribeCommand extends BaseWsEvent {
  type: 'subscribe';
  instance_id: string;
}

/**
 * v4.4.0-N1 新增：取消订阅命令
 *
 * Panel 在前端最后一个订阅者退出时发送，释放 Daemon 端订阅资源。
 * Daemon 收到后从 subscribersByInstance 中移除该 WS 对该 instanceId 的订阅。
 */
export interface UnsubscribeCommand extends BaseWsEvent {
  type: 'unsubscribe';
  instance_id: string;
}

export type PanelToDaemonCommand = SubscribeCommand | UnsubscribeCommand;

// ----- Panel → Frontend 事件（事件中继） -----
export interface PanelConsoleOutputEvent extends BaseWsEvent {
  type: 'console.output';
  server_id: string;
  line: string;
  stream: 'stdout' | 'stderr';
}

export interface PanelInstanceStateEvent extends BaseWsEvent {
  type: 'instance.state';
  server_id: string;
  state: InstanceState;
}

/**
 * v4.4.0-K1 系统监控事件（Panel → Frontend）
 *
 * 由 systemMonitorService 每 2 秒采样一次主机 CPU / 内存 / 磁盘使用率，
 * 通过 PanelWsServer.broadcastToAll 推送给所有已鉴权的前端连接。
 *
 * 前端在 SystemHealth.tsx 中订阅此事件并实时绘制曲线。
 */
export interface PanelSystemMonitorEvent extends BaseWsEvent {
  type: 'system.monitor';
  /** CPU 使用率（0-100，按 idle/total 时间差计算，所有核心平均） */
  cpu_percent: number;
  /** 内存使用率（0-100） */
  memory_percent: number;
  /** 已用内存（字节） */
  memory_used_bytes: number;
  /** 总内存（字节） */
  memory_total_bytes: number;
  /** 磁盘使用率（0-100，Panel.db 所在分区） */
  disk_percent: number;
  /** 已用磁盘（字节） */
  disk_used_bytes: number;
  /** 总磁盘（字节） */
  disk_total_bytes: number;
  /** Node.js 进程 RSS（字节），用于诊断内存泄漏 */
  process_rss_bytes: number;
  /** Node.js 进程 CPU 使用率（0-100） */
  process_cpu_percent: number;
  /** 活跃 WS 客户端连接数 */
  ws_connections: number;
}

export type PanelToFrontendEvent =
  | PanelConsoleOutputEvent
  | PanelInstanceStateEvent
  | PanelSystemMonitorEvent
  | PanelNodeStatusEvent;

/**
 * v5.0.0 L2 节点状态变更事件（Panel → Frontend）
 *
 * 当 slave 节点上线/离线/注册成功时由 master 推送给前端，
 * 前端 Nodes 页面订阅此事件实时刷新节点状态徽章。
 */
export interface PanelNodeStatusEvent extends BaseWsEvent {
  type: 'node.status';
  node_id: string;
  node_name: string;
  node_type: 'master' | 'slave';
  status: 'online' | 'offline' | 'pending' | 'degraded';
  last_seen_at: string | null;
}
