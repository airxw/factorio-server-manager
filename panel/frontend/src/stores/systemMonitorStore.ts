// ============================================================================
// systemMonitorStore — 系统监控 WebSocket Store（v4.4.0-K2）
//
// 职责：
//   - 维护单一共享 WS 连接，订阅后端 `system.monitor` 事件
//   - 持有最近 1 小时（1800 条 × 2s）的监控数据环形缓冲
//   - 提供订阅/退订接口供 React 组件使用
//   - 连接建立时通过 REST API 拉取历史数据补齐缓冲
//   - 自动重连 + 心跳
//
// 设计要点：
//   - 单例模式：模块级单例，整个应用共用一个 store
//   - 引用计数：首个订阅者触发连接，末个退订触发断开
//   - 不需要 server_id 订阅：system.monitor 是 broadcastToAll 事件
//   - 与 instanceHubStore 独立：避免污染实例事件分发逻辑
// ============================================================================

import type { PanelSystemMonitorEvent } from '@public/schema/ws-events';
import { getToken } from '../api/auth';
import { WS_BASE, REST_BASE } from '../config/env';

/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** 无消息超时（ms）—— 后端 2s 推送一次，30s 无消息视为断连 */
const NO_MESSAGE_TIMEOUT_MS = 30_000;
/** 历史缓冲最大条数（1 小时 × 2 秒 = 1800） */
const HISTORY_MAX_SIZE = 1_800;
/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 5;
/** 最大退避时间（ms） */
const MAX_BACKOFF_MS = 30_000;

/** 监控数据更新回调 */
type MonitorListener = (event: PanelSystemMonitorEvent) => void;
/** 连接状态变更回调 */
type ConnectionListener = (connected: boolean) => void;

class SystemMonitorStore {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByCleanup = false;

  private connected = false;
  private connecting = false;

  /** 历史数据缓冲（旧→新） */
  private history: PanelSystemMonitorEvent[] = [];
  /** 监控数据更新订阅者 */
  private monitorListeners: Set<MonitorListener> = new Set();
  /** 连接状态订阅者 */
  private connectionListeners: Set<ConnectionListener> = new Set();

  /** 当前是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 订阅监控数据更新
   * @param listener 回调函数，每次收到新事件时触发
   * @returns 退订函数
   */
  subscribe(listener: MonitorListener): () => void {
    this.monitorListeners.add(listener);
    // 首个订阅者触发连接
    if (this.monitorListeners.size === 1) {
      this.ensureConnected();
    }
    // 立即推送一次最近的历史（如有），避免新订阅者白屏等待 2s
    if (this.history.length > 0) {
      listener(this.history[this.history.length - 1]!);
    }
    return () => {
      this.monitorListeners.delete(listener);
      // 末个订阅者触发断开
      if (this.monitorListeners.size === 0) {
        this.disconnect();
      }
    };
  }

  /**
   * 订阅连接状态变更
   * @param listener 回调函数
   * @returns 退订函数
   */
  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    // 立即推送当前状态
    listener(this.connected);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /**
   * 获取历史数据（最新在前）
   * @param limit 返回条数，默认 60（2 分钟）
   */
  getHistory(limit = 60): PanelSystemMonitorEvent[] {
    const safeLimit = Math.max(1, Math.min(limit, this.history.length));
    return this.history.slice(-safeLimit).reverse();
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
    this.updateConnected(false);
  }

  /** 建立 WS 连接 */
  private connect(): void {
    if (this.closedByCleanup) return;

    const token = getToken();
    if (!token) {
      this.updateConnected(false);
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
      try {
        this.ws!.send(JSON.stringify({ type: 'auth', token }));
      } catch {
        // ignore
      }
      // 启动心跳
      this.heartbeatTimer = setInterval(() => {
        try {
          this.ws!.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }, HEARTBEAT_INTERVAL_MS);
      this.resetNoMessageTimer();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.resetNoMessageTimer();

      let payload: PanelSystemMonitorEvent | { type: string };
      try {
        payload = JSON.parse(event.data as string) as PanelSystemMonitorEvent | { type: string };
      } catch {
        return;
      }

      // 鉴权成功
      if (payload.type === 'auth_ok') {
        this.reconnectAttempts = 0;
        this.updateConnected(true);
        // 连接建立后拉取历史数据补齐缓冲
        void this.fetchHistory();
        return;
      }

      // pong 心跳响应
      if (payload.type === 'pong') return;

      // 系统监控事件
      if (payload.type === 'system.monitor') {
        const e = payload as PanelSystemMonitorEvent;
        this.handleMonitorEvent(e);
      }
    };

    this.ws.onclose = () => {
      this.connecting = false;
      this.updateConnected(false);
      this.clearTimers();
      if (!this.closedByCleanup) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.connecting = false;
      this.updateConnected(false);
    };
  }

  /** 处理监控事件：写入历史缓冲 + 通知所有订阅者 */
  private handleMonitorEvent(event: PanelSystemMonitorEvent): void {
    this.history.push(event);
    if (this.history.length > HISTORY_MAX_SIZE) {
      this.history.shift();
    }
    for (const listener of this.monitorListeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者异常不应影响其他订阅者
      }
    }
  }

  /** 通过 REST API 拉取历史数据（连接建立后调用） */
  private async fetchHistory(): Promise<void> {
    try {
      const token = getToken();
      if (!token) return;
      const resp = await fetch(`${REST_BASE}/system-monitor/history?limit=1800`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as { history: PanelSystemMonitorEvent[] };
      if (Array.isArray(data.history) && data.history.length > 0) {
        // history 接口返回最新在前，反转后追加到缓冲（旧→新）
        // 仅在缓冲为空或新数据时间戳晚于缓冲末尾时合并，避免重复
        const reversed = [...data.history].reverse();
        if (this.history.length === 0) {
          this.history = reversed;
        } else {
          const lastTimestamp = this.history[this.history.length - 1]!.timestamp;
          const filtered = reversed.filter((e) => e.timestamp > lastTimestamp);
          this.history.push(...filtered);
          while (this.history.length > HISTORY_MAX_SIZE) {
            this.history.shift();
          }
        }
        // 通知订阅者有新历史数据
        const latest = this.history[this.history.length - 1]!;
        for (const listener of this.monitorListeners) {
          try {
            listener(latest);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // 历史数据拉取失败不影响实时订阅
    }
  }

  /** 指数退避重连 */
  private scheduleReconnect(): void {
    if (this.closedByCleanup) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    const attempt = this.reconnectAttempts;
    const backoff = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS);
    const jitter = Math.random() * 500;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts += 1;
      this.connect();
    }, backoff + jitter);
  }

  /** 重置无消息计时器 */
  private resetNoMessageTimer(): void {
    if (this.noMessageTimer) clearTimeout(this.noMessageTimer);
    this.noMessageTimer = setTimeout(() => {
      try {
        this.ws?.close(4002, 'no_message_timeout');
      } catch {
        // ignore
      }
    }, NO_MESSAGE_TIMEOUT_MS);
  }

  /** 清理心跳/无消息计时器 */
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

  /** 更新连接状态并通知所有监听器 */
  private updateConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) {
      try {
        listener(this.connected);
      } catch {
        // ignore
      }
    }
  }
}

/** 模块级单例 */
export const systemMonitorStore = new SystemMonitorStore();

/** React Hook：订阅系统监控数据 */
export function useSystemMonitor(): {
  subscribe: (listener: MonitorListener) => () => void;
  isConnected: () => boolean;
  getHistory: (limit?: number) => PanelSystemMonitorEvent[];
} {
  return {
    subscribe: (listener: MonitorListener) => systemMonitorStore.subscribe(listener),
    isConnected: () => systemMonitorStore.isConnected(),
    getHistory: (limit?: number) => systemMonitorStore.getHistory(limit),
  };
}
