// ============================================================================
// nodeStatusStore — 节点状态 WebSocket Store（v4.10.1 L2 增量）
//
// 职责：
//   - 维护单一共享 WS 连接，订阅后端 `node.status` 事件
//   - 收到事件时通知所有订阅者（Nodes.tsx 用于实时刷新节点状态）
//   - 引用计数：首个订阅者触发连接，末个退订触发断开
//   - 自动重连 + 心跳
//
// 设计要点：
//   - 与 systemMonitorStore 同构，但无历史缓冲（node.status 是低频事件）
//   - 单例模式：模块级单例，整个应用共用一个 store
//   - 不需要 server_id 订阅：node.status 是 broadcastToAll 事件
// ============================================================================

import type { PanelNodeStatusEvent } from '@public/schema/ws-events';
import { getToken } from '../api/auth';
import { WS_BASE } from '../config/env';

/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** 无消息超时（ms）—— node.status 低频，用较长超时 */
const NO_MESSAGE_TIMEOUT_MS = 60_000;
/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 5;
/** 最大退避时间（ms） */
const MAX_BACKOFF_MS = 30_000;

/** 节点状态变更回调 */
type NodeStatusListener = (event: PanelNodeStatusEvent) => void;

class NodeStatusStore {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByCleanup = false;

  private connected = false;
  private connecting = false;

  /** 节点状态变更订阅者 */
  private listeners: Set<NodeStatusListener> = new Set();

  /** 当前是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 订阅节点状态变更
   * @param listener 回调函数，每次收到 node.status 事件时触发
   * @returns 退订函数
   */
  subscribe(listener: NodeStatusListener): () => void {
    this.listeners.add(listener);
    // 首个订阅者触发连接
    if (this.listeners.size === 1) {
      this.ensureConnected();
    }
    return () => {
      this.listeners.delete(listener);
      // 末个订阅者触发断开
      if (this.listeners.size === 0) {
        this.disconnect();
      }
    };
  }

  /** 确保连接已建立 */
  private ensureConnected(): void {
    if (this.connected || this.connecting) return;
    this.closedByCleanup = false;
    this.connect();
  }

  /** 主动断开连接 */
  private disconnect(): void {
    this.closedByCleanup = true;
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(4003, 'client_disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }

  /** 建立 WS 连接 */
  private connect(): void {
    if (this.closedByCleanup) return;

    const token = getToken();
    if (!token) {
      this.connected = false;
      return;
    }

    this.connecting = true;
    const url = `${WS_BASE}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      try {
        this.ws!.send(JSON.stringify({ type: 'auth', token }));
      } catch {
        // ignore
      }
      this.startHeartbeat();
      this.connected = true;
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      this.resetNoMessageTimer();
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      // 仅处理 node.status 事件
      if (
        data &&
        typeof data === 'object' &&
        (data as { type?: string }).type === 'node.status'
      ) {
        const event = data as PanelNodeStatusEvent;
        for (const listener of this.listeners) {
          try {
            listener(event);
          } catch {
            // ignore listener errors
          }
        }
      }
      // 心跳 pong 也走 onmessage，resetNoMessageTimer 已处理
    };

    this.ws.onerror = () => {
      // 错误处理交给 onclose
    };

    this.ws.onclose = () => {
      this.connecting = false;
      this.clearTimers();
      this.connected = false;
      if (!this.closedByCleanup) {
        this.scheduleReconnect();
      }
    };
  }

  /** 启动心跳定时器 */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.noMessageTimer = setTimeout(() => {
      // 超时无消息，主动断开触发重连
      if (this.ws) {
        try {
          this.ws.close(4002, 'no_message_timeout');
        } catch {
          // ignore
        }
      }
    }, NO_MESSAGE_TIMEOUT_MS);
  }

  /** 重置无消息定时器（收到任何消息时调用） */
  private resetNoMessageTimer(): void {
    if (this.noMessageTimer) {
      clearTimeout(this.noMessageTimer);
    }
    this.noMessageTimer = setTimeout(() => {
      if (this.ws) {
        try {
          this.ws.close(4002, 'no_message_timeout');
        } catch {
          // ignore
        }
      }
    }, NO_MESSAGE_TIMEOUT_MS);
  }

  /** 清理所有定时器 */
  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.noMessageTimer) {
      clearTimeout(this.noMessageTimer);
      this.noMessageTimer = null;
    }
  }

  /** 安排重连（指数退避） */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    this.reconnectAttempts++;
    const backoff = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      MAX_BACKOFF_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }
}

/** 模块级单例 */
export const nodeStatusStore = new NodeStatusStore();
