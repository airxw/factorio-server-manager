// ============================================================================
// notificationStore — 用户通知 WebSocket Store（I5）
//
// 职责：
//   - 维护单一共享 WS 连接，接收后端 broadcastToUser 推送的通知事件
//   - 监听 'notification.new' / 'notification.unread_count' 事件
//   - 持有 unreadCount + recentNotifications（环形缓冲，最近 10 条）
//   - 提供订阅/退订接口供 React 组件使用
//   - 重连后通过 REST 拉取一次未读数，补齐断线期间漏掉的通知
//   - 自动重连 + 心跳
//
// 设计要点：
//   - 单例模式：模块级单例，整个应用共用一个 store
//   - 独立连接：通知事件按 user 维度推送（broadcastToUser），不依赖 server_id
//     订阅，与 instanceHubStore（server 维度）/ systemMonitorStore（全局广播）
//     各自独立，避免污染彼此的事件分发与生命周期
//   - 降级：连接断开时通知 Layout.tsx 切换到 30s 轮询兜底
//
// 事件类型扩展说明：
//   'notification.new' / 'notification.unread_count' 由后端 server.ts 扩展定义，
//   不修改受保护的 public/schema/ws-events.ts；本 store 用内联类型解析。
// ============================================================================

import { getToken } from '../api/auth';
import { WS_BASE, REST_BASE } from '../config/env';

/** 通知摘要（与后端 NotificationServiceImpl.NotificationSummary 结构对齐） */
export interface NotificationSummary {
  id: number;
  type: string;
  title: string;
  content: string;
  related_server_id: string | null;
  related_order_id: number | null;
  is_read: boolean;
  created_at: string;
}

/** 后端推送的事件载荷（联合，按 type 区分） */
interface NotificationNewWsEvent {
  type: 'notification.new';
  timestamp: string;
  notification: NotificationSummary;
}

interface NotificationUnreadCountWsEvent {
  type: 'notification.unread_count';
  timestamp: string;
  unread_count: number;
}

type NotificationWsEvent = NotificationNewWsEvent | NotificationUnreadCountWsEvent;

/** 心跳间隔（ms）—— 周期性 ping 防止 nginx 空闲断连 */
const HEARTBEAT_INTERVAL_MS = 25_000;
/**
 * 无消息超时（ms）—— 通知事件非周期性，但 pong 响应会重置此计时器。
 * 若超过此时间未收到任何消息（含 pong），视为半开连接，主动关闭触发重连。
 */
const NO_MESSAGE_TIMEOUT_MS = 35_000;
/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;
/** 最大退避时间（ms） */
const MAX_BACKOFF_MS = 30_000;
/** recentNotifications 环形缓冲最大条数 */
const RECENT_MAX_SIZE = 10;
/** GET /api/notifications 响应体 */
interface ListNotificationsResponse {
  notifications: NotificationSummary[];
  unread_count: number;
}

/** 通知新增回调 */
type NotificationNewListener = (notification: NotificationSummary) => void;
/** 未读数变更回调 */
type UnreadCountListener = (count: number) => void;
/** 连接状态变更回调（用于 Layout 降级轮询） */
type ConnectionListener = (connected: boolean) => void;

class NotificationStore {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByCleanup = false;

  private connected = false;
  private connecting = false;

  /** 未读数 */
  private unreadCount = 0;
  /** 最近通知（最新在前） */
  private recentNotifications: NotificationSummary[] = [];

  private readonly newListeners: Set<NotificationNewListener> = new Set();
  private readonly unreadCountListeners: Set<UnreadCountListener> = new Set();
  private readonly connectionListeners: Set<ConnectionListener> = new Set();

  /** 当前是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 当前未读数 */
  getUnreadCount(): number {
    return this.unreadCount;
  }

  /** 最近通知（最新在前，最多 10 条） */
  getRecentNotifications(): NotificationSummary[] {
    return this.recentNotifications;
  }

  /**
   * 订阅 notification.new 事件。
   * @returns 退订函数
   */
  onNotificationNew(listener: NotificationNewListener): () => void {
    this.newListeners.add(listener);
    return () => this.newListeners.delete(listener);
  }

  /**
   * 订阅未读数变更。
   * @returns 退订函数
   */
  onUnreadCountChange(listener: UnreadCountListener): () => void {
    this.unreadCountListeners.add(listener);
    return () => this.unreadCountListeners.delete(listener);
  }

  /**
   * 订阅连接状态变更（用于 Layout 在断开时降级为 30s 轮询）。
   * 立即推送一次当前状态。
   * @returns 退订函数
   */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connected);
    return () => this.connectionListeners.delete(listener);
  }

  /**
   * 初始化：建立 WS 连接并注册事件监听。
   * 幂等——已连接/连接中时重复调用安全。
   *
   * 实现说明：本 store 管理独立的 WS 连接（通知事件按 user 维度推送，不依赖
   * server_id 订阅，无法复用 instanceHubStore 的 server 维度连接）。
   */
  init(): void {
    if (this.connected || this.connecting) return;
    this.closedByCleanup = false;
    this.connect();
  }

  /** 主动断开并清理（登出/组件卸载时调用） */
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
      try {
        this.ws.close(4003, 'client_disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.updateConnected(false);
  }

  // ========== 内部方法 ==========

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
      // 启动心跳——pong 响应会重置 noMessageTimer，防止空闲断连
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

      let payload: NotificationWsEvent | { type: string };
      try {
        payload = JSON.parse(event.data as string) as NotificationWsEvent | { type: string };
      } catch {
        return;
      }

      // 鉴权成功
      if (payload.type === 'auth_ok') {
        this.reconnectAttempts = 0;
        this.updateConnected(true);
        // I5 降级补齐：重连后立即拉取一次未读数 + 最近通知，
        // 补齐断线期间漏掉的事件
        void this.syncFromRest();
        return;
      }

      // pong 心跳响应
      if (payload.type === 'pong') return;

      // 通知事件分发
      if (payload.type === 'notification.new') {
        this.handleNotificationNew(payload as NotificationNewWsEvent);
      } else if (payload.type === 'notification.unread_count') {
        this.handleUnreadCount(payload as NotificationUnreadCountWsEvent);
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

  /** 处理 notification.new：写入环形缓冲 + 乐观递增未读数 + 通知订阅者 */
  private handleNotificationNew(event: NotificationNewWsEvent): void {
    const n = event.notification;
    // 环形缓冲：最新在前，去重 + 截断
    this.recentNotifications = [n, ...this.recentNotifications.filter((x) => x.id !== n.id)].slice(0, RECENT_MAX_SIZE);
    // 乐观递增未读数（后端会紧接着推送 unread_count 事件校正）
    this.setUnreadCount(this.unreadCount + 1);
    for (const listener of this.newListeners) {
      try {
        listener(n);
      } catch {
        // 单个订阅者异常不应影响其他订阅者
      }
    }
  }

  /** 处理 notification.unread_count：更新未读数 + 通知订阅者 */
  private handleUnreadCount(event: NotificationUnreadCountWsEvent): void {
    this.setUnreadCount(event.unread_count);
  }

  /** 更新未读数并通知订阅者 */
  private setUnreadCount(count: number): void {
    const next = Math.max(0, count);
    if (this.unreadCount === next) return;
    this.unreadCount = next;
    for (const listener of this.unreadCountListeners) {
      try {
        listener(this.unreadCount);
      } catch {
        // ignore
      }
    }
  }

  /**
   * 通过 REST API 拉取未读数 + 最近通知，用于初始化与重连补齐。
   * 失败不影响实时订阅（连接仍保持）。
   * v4.14.2: 不使用 AbortController——避免 destroy 时 abort 产生 net::ERR_ABORTED 日志
   * 改用 closedByCleanup 守卫，destroy 后请求自然完成但结果被丢弃
   */
  private async syncFromRest(): Promise<void> {
    try {
      const token = getToken();
      if (!token) return;
      const resp = await fetch(`${REST_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as ListNotificationsResponse;
      // v4.14.2: destroy 后忽略结果（请求已在飞行中，让它自然完成）
      if (this.closedByCleanup) return;
      if (!Array.isArray(data.notifications)) return;
      // 未读数以服务端为准
      this.setUnreadCount(data.unread_count ?? 0);
      // 最近通知：取前 10 条（接口已按 created_at desc 排序）
      this.recentNotifications = data.notifications.slice(0, RECENT_MAX_SIZE);
    } catch {
      // REST 拉取失败不影响实时订阅
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
export const notificationStore = new NotificationStore();
