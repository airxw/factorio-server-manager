// ============================================================================
// InstanceHubStore — 共享 WebSocket 连接 + 引用计数 + Promise 串行化 + 多订阅者 Set
// MSLX 借鉴：Pinia-based WebSocket Store 的引用计数 + Promise 串行化 + 多订阅者模式
//
// 核心机制：
//   1. 单一共享 WS 连接：所有组件共用一个 Panel WS，避免多连接资源浪费
//   2. 引用计数：首个订阅者触发 server-side subscribe，末个退订触发 unsubscribe
//   3. Promise 串行化：subscribe/unsubscribe 操作排队执行，避免竞态
//   4. 多订阅者 Set：同一 instance 可被多个组件同时监听，事件广播到所有 handler
//   5. 自动重连 + 订阅恢复：断线重连后自动重新订阅所有活跃 instance
// ============================================================================

import type { InstanceState } from '@public/schema/daemon-api-types';
import type { PanelToFrontendEvent } from '@public/schema/ws-events';
import { getToken } from '../api/auth';
import { WS_BASE } from '../config/env';

/** 实例事件 handler —— 由消费方注册，store 在收到 WS 事件时回调 */
export interface InstanceEventHandlers {
  onConsole: (line: string, stream: 'stdout' | 'stderr', timestamp: string) => void;
  onState: (state: InstanceState) => void;
}

/** 连接状态变更回调 */
type ConnectionListener = (connected: boolean, reconnecting: boolean, maxRetriesReached: boolean) => void;

/** 心跳间隔（ms） */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** 无消息超时（ms） */
const NO_MESSAGE_TIMEOUT_MS = 30_000;
/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;
/** 退避上限（ms） */
const MAX_BACKOFF_MS = 30_000;

/**
 * InstanceHubStore — 单例 store，管理 Panel→Frontend WebSocket 连接。
 *
 * 线程模型（React 侧）：
 *   - store 是模块级单例，生命周期独立于组件
 *   - 组件通过 useInstanceHub hook 注册/退订 handler
 *   - WS 事件在 onmessage 回调中分发到所有注册的 handler
 *
 * Promise 串行化：
 *   - subscribe/unsubscribe 操作通过 operationQueue 链式排队
 *   - 避免并发 subscribe X → unsubscribe X 时 WS 消息乱序
 */
class InstanceHubStore {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private maxRetriesReached = false;

  /** B1: Promise 串行化队列 —— 所有 subscribe/unsubscribe 操作排队执行 */
  private operationQueue: Promise<unknown> = Promise.resolve();

  /** B2: 多订阅者 Set —— instanceId → Set of handlers */
  private readonly subscribers = new Map<string, Set<InstanceEventHandlers>>();

  /** B1: 引用计数 —— instanceId → 活跃组件数（与 subscribers.get(id).size 保持一致） */
  private readonly refCounts = new Map<string, number>();

  /** 连接状态监听器集合 */
  private readonly connectionListeners = new Set<ConnectionListener>();

  /** 重连逻辑 */
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByCleanup = false;

  /** B2: 订阅指定实例的事件流
   * @returns 退订函数（调用后移除 handler，引用计数归零时发送 unsubscribe）
   */
  subscribe(serverId: string, handlers: InstanceEventHandlers): () => void {
    // 添加 handler 到订阅者集合
    let subs = this.subscribers.get(serverId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(serverId, subs);
    }
    subs.add(handlers);

    // 引用计数 +1
    const prevCount = this.refCounts.get(serverId) ?? 0;
    this.refCounts.set(serverId, prevCount + 1);

    // 首个订阅者：发送 subscribe 到服务器（串行化）
    if (prevCount === 0) {
      this.enqueueOperation(() => this.sendSubscribe(serverId));
    }

    // 返回退订函数
    return () => this.unsubscribe(serverId, handlers);
  }

  /** B2: 退订 —— 移除 handler，引用计数归零时发送 unsubscribe */
  private unsubscribe(serverId: string, handlers: InstanceEventHandlers): void {
    const subs = this.subscribers.get(serverId);
    if (!subs) return;

    subs.delete(handlers);
    const newCount = (this.refCounts.get(serverId) ?? 1) - 1;
    this.refCounts.set(serverId, newCount);

    // 末个退订者：发送 unsubscribe 到服务器（串行化）
    if (newCount <= 0) {
      this.refCounts.delete(serverId);
      this.subscribers.delete(serverId);
      this.enqueueOperation(() => this.sendUnsubscribe(serverId));
    }
  }

  /** B1: 注册连接状态变更监听器
   * @returns 取消监听函数 */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    // 立即推送当前状态
    listener(this.connected, this.reconnecting, this.maxRetriesReached);
    return () => this.connectionListeners.delete(listener);
  }

  /** B1: 确保连接已建立（懒连接） */
  ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  // ========== 内部方法 ==========

  /** B1: Promise 串行化 —— 将操作加入队列，前一个完成才执行下一个 */
  private enqueueOperation(fn: () => Promise<void> | void): void {
    this.operationQueue = this.operationQueue.then(fn).catch((err) => {
      // 操作失败不影响后续操作
      console.warn('[InstanceHubStore] operation failed:', err);
    });
  }

  /** 发送 subscribe 消息（需 WS 已连接） */
  private async sendSubscribe(serverId: string): Promise<void> {
    await this.waitForConnection();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'subscribe', server_id: serverId }));
      } catch {
        // WS 已关闭，重连后会自动补订阅
      }
    }
  }

  /** 发送 unsubscribe 消息 */
  private async sendUnsubscribe(serverId: string): Promise<void> {
    await this.waitForConnection();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'unsubscribe', server_id: serverId }));
      } catch {
        // ignore
      }
    }
  }

  /** 等待 WS 连接就绪（最多等 5s） */
  private waitForConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    // 连接未就绪，启动连接并等待
    this.ensureConnected();
    return new Promise((resolve) => {
      const check = () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          resolve();
        } else if (this.ws && this.ws.readyState === WebSocket.CLOSED) {
          // 连接失败，重连后 onopen 会补订阅
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  }

  /** 建立 WS 连接 */
  private connect(): void {
    if (this.closedByCleanup) return;

    const token = getToken();
    if (!token) {
      this.updateConnectionState({ connected: false, reconnecting: false });
      return;
    }

    const url = `${WS_BASE}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
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

      let payload: PanelToFrontendEvent | { type: string };
      try {
        payload = JSON.parse(event.data as string) as PanelToFrontendEvent | { type: string };
      } catch {
        return;
      }

      // 鉴权成功
      if (payload.type === 'auth_ok') {
        this.reconnectAttempts = 0;
        this.updateConnectionState({ connected: true, reconnecting: false, maxRetriesReached: false });
        // B1: 重连后自动恢复所有活跃订阅（串行化）
        this.restoreSubscriptions();
        return;
      }

      // pong 心跳响应
      if (payload.type === 'pong') return;

      // 分发事件到对应 instance 的所有 handler
      const e = payload as PanelToFrontendEvent;
      if (e.type === 'console.output') {
        const subs = this.subscribers.get(e.server_id);
        if (subs) {
          for (const handler of subs) {
            handler.onConsole(e.line, e.stream, e.timestamp);
          }
        }
      } else if (e.type === 'instance.state') {
        const subs = this.subscribers.get(e.server_id);
        if (subs) {
          for (const handler of subs) {
            handler.onState(e.state);
          }
        }
      }
    };

    this.ws.onclose = () => {
      this.updateConnectionState({ connected: false });
      this.clearTimers();
      if (!this.closedByCleanup) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.updateConnectionState({ connected: false });
    };
  }

  /** B1: 重连后自动恢复所有活跃订阅 */
  private restoreSubscriptions(): void {
    for (const serverId of this.subscribers.keys()) {
      this.enqueueOperation(() => this.sendSubscribe(serverId));
    }
  }

  /** 指数退避重连 */
  private scheduleReconnect(): void {
    if (this.closedByCleanup) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.updateConnectionState({ reconnecting: false, maxRetriesReached: true });
      return;
    }
    this.updateConnectionState({ reconnecting: true });
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
  private updateConnectionState(changes: Partial<{ connected: boolean; reconnecting: boolean; maxRetriesReached: boolean }>): void {
    if (changes.connected !== undefined) this.connected = changes.connected;
    if (changes.reconnecting !== undefined) this.reconnecting = changes.reconnecting;
    if (changes.maxRetriesReached !== undefined) this.maxRetriesReached = changes.maxRetriesReached;
    for (const listener of this.connectionListeners) {
      listener(this.connected, this.reconnecting, this.maxRetriesReached);
    }
  }

  /** 清理所有连接（页面卸载时调用） */
  destroy(): void {
    this.closedByCleanup = true;
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }
}

/** 模块级单例 */
export const instanceHub = new InstanceHubStore();
