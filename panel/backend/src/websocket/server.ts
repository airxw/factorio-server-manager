// ============================================================================
// Panel → Frontend WebSocket 服务端
// - 二.3: JWT 通过连接后首条 { type:'auth', token } 消息鉴权（不再使用 URL query）
// - 按 server_id 隔离订阅
// - 二.2: 支持 { type:'ping' } / { type:'pong' } 心跳消息
// - 事件转发接口（供模块6 daemonClient 调用，转发 Daemon 事件到前端）
//
// v4.4.0-N1 改造：
//   - 新增 serverIdRefCount 全局引用计数（跨所有连接）
//   - 第一个订阅者出现时触发 onServerSubscribe 回调（Panel 据此订阅 Daemon）
//   - 最后一个订阅者退出时触发 onServerUnsubscribe 回调（Panel 据此取消订阅 Daemon）
//   - 连接关闭时自动清理该连接的所有引用计数
// ============================================================================

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken, type JwtPayload } from '../core/auth/jwt.js';
import type { PanelToFrontendEvent } from '@public/schema/ws-events';

interface ClientConnection {
  ws: WebSocket;
  subscribedServerIds: Set<string>;
  authenticated: boolean;
  /** I5: 鉴权后绑定的用户 ID，用于 broadcastToUser 按 user 维度推送 */
  userId?: string;
}

// ============================================================================
// I5: 通知推送事件类型（扩展 Panel→Frontend 事件，但不修改受保护的 public/schema）
// 通知事件按 user 维度推送（broadcastToUser），与 server 维度的 broadcastToServer 并列。
// ============================================================================

export const NOTIFICATION_NEW_EVENT = 'notification.new' as const;
export const NOTIFICATION_UNREAD_COUNT_EVENT = 'notification.unread_count' as const;

/** 通知摘要载荷（与 NotificationServiceImpl.NotificationSummary 结构对齐） */
export interface NotificationPayload {
  id: number;
  type: string;
  title: string;
  content: string;
  related_server_id: string | null;
  related_order_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationNewPushEvent {
  type: typeof NOTIFICATION_NEW_EVENT;
  timestamp: string;
  notification: NotificationPayload;
}

export interface NotificationUnreadCountPushEvent {
  type: typeof NOTIFICATION_UNREAD_COUNT_EVENT;
  timestamp: string;
  unread_count: number;
}

/** 通知推送事件联合类型 */
export type NotificationPushEvent = NotificationNewPushEvent | NotificationUnreadCountPushEvent;

/** Panel→Frontend 推送事件（受保护 schema 事件 + I5 通知扩展） */
export type PanelPushEvent = PanelToFrontendEvent | NotificationPushEvent;

/**
 * v4.4.0-N1: PanelWsServer 配置选项
 * - onServerSubscribe: 某 serverId 的引用计数从 0→1 时触发
 * - onServerUnsubscribe: 某 serverId 的引用计数从 1→0 时触发
 */
export interface PanelWsServerOptions {
  /** 第一个前端订阅某 serverId 时触发（Panel 应订阅对应 Daemon 实例事件） */
  onServerSubscribe?: (serverId: string) => void;
  /** 最后一个前端取消订阅某 serverId 时触发（Panel 应取消订阅对应 Daemon 实例） */
  onServerUnsubscribe?: (serverId: string) => void;
}

/** 未鉴权连接的超时时间（ms），超时后服务端主动关闭 */
const AUTH_TIMEOUT_MS = 5_000;

export class PanelWsServer {
  private wss: WebSocketServer;
  private clients: Set<ClientConnection> = new Set();
  private jwtSecret: string;
  /**
   * v4.4.0-N1: serverId → 当前订阅该实例的前端连接数。
   * 用于驱动 Panel → Daemon 的 subscribe/unsubscribe 调用。
   * - 某个 serverId 的计数从 0→1：调用 onServerSubscribe
   * - 某个 serverId 的计数从 1→0：调用 onServerUnsubscribe
   */
  private serverIdRefCount: Map<string, number> = new Map();
  private readonly options: PanelWsServerOptions;

  constructor(httpServer: HttpServer, jwtSecret: string, options?: PanelWsServerOptions) {
    this.jwtSecret = jwtSecret;
    this.options = options ?? {};
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  /**
   * 处理新 WS 连接
   * 二.3: 不再从 URL query 读取 token，改为等待客户端首条 auth 消息
   */
  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const conn: ClientConnection = {
      ws,
      subscribedServerIds: new Set(),
      authenticated: false,
    };
    this.clients.add(conn);

    // 鉴权超时：未在 AUTH_TIMEOUT_MS 内完成 auth 则关闭
    const authTimer = setTimeout(() => {
      if (!conn.authenticated) {
        try {
          ws.close(4001, 'auth_timeout');
        } catch {
          // ignore
        }
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(conn, data, authTimer);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      this.handleConnectionClose(conn);
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
      this.handleConnectionClose(conn);
    });
  }

  /**
   * v4.4.0-N1: 连接关闭时清理引用计数。
   * 遍历该连接订阅的所有 serverId，逐一递减全局引用计数；
   * 计数归零时触发 onServerUnsubscribe 回调，Panel 据此取消 Daemon 订阅。
   */
  private handleConnectionClose(conn: ClientConnection): void {
    this.clients.delete(conn);
    for (const serverId of conn.subscribedServerIds) {
      this.decrementRefCount(serverId);
    }
    conn.subscribedServerIds.clear();
  }

  /**
   * v4.4.0-N1: 递增 serverId 的全局引用计数。
   * 计数从 0→1 时触发 onServerSubscribe 回调。
   */
  private incrementRefCount(serverId: string): void {
    const current = this.serverIdRefCount.get(serverId) ?? 0;
    const next = current + 1;
    this.serverIdRefCount.set(serverId, next);
    if (current === 0) {
      // 第一个订阅者出现，通知 Panel 订阅 Daemon
      try {
        this.options.onServerSubscribe?.(serverId);
      } catch {
        // 回调失败不影响订阅状态
      }
    }
  }

  /**
   * v4.4.0-N1: 递减 serverId 的全局引用计数。
   * 计数从 1→0 时触发 onServerUnsubscribe 回调，并清理 Map 条目。
   */
  private decrementRefCount(serverId: string): void {
    const current = this.serverIdRefCount.get(serverId) ?? 0;
    if (current === 0) {
      // 异常状态：计数已为 0 但收到递减请求，忽略
      return;
    }
    const next = current - 1;
    if (next === 0) {
      // 最后一个订阅者退出，通知 Panel 取消订阅 Daemon
      this.serverIdRefCount.delete(serverId);
      try {
        this.options.onServerUnsubscribe?.(serverId);
      } catch {
        // 回调失败不影响状态
      }
    } else {
      this.serverIdRefCount.set(serverId, next);
    }
  }

  /**
   * 处理客户端消息（auth / subscribe / unsubscribe / ping）
   */
  private handleMessage(conn: ClientConnection, data: Buffer, authTimer: ReturnType<typeof setTimeout>): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (typeof msg !== 'object' || msg === null) {
      return;
    }

    const m = msg as { type?: string; server_id?: string; token?: string };

    // 二.3: 首条消息需为 auth，验证 JWT
    if (m.type === 'auth') {
      if (conn.authenticated) return; // 已鉴权，忽略重复 auth
      if (typeof m.token !== 'string' || !m.token) {
        try { conn.ws.close(4001, 'missing_token'); } catch { /* ignore */ }
        return;
      }
      let payload: JwtPayload;
      try {
        payload = verifyToken(m.token, this.jwtSecret);
      } catch {
        try { conn.ws.close(4001, 'invalid_token'); } catch { /* ignore */ }
        return;
      }
      conn.authenticated = true;
      // I5: 绑定 userId，供 broadcastToUser 按 user 维度推送通知事件
      conn.userId = payload.userId;
      clearTimeout(authTimer);
      // 回复鉴权成功
      try {
        conn.ws.send(JSON.stringify({ type: 'auth_ok' }));
      } catch {
        // ignore
      }
      return;
    }

    // 未鉴权的其他消息一律忽略
    if (!conn.authenticated) return;

    if (m.type === 'subscribe' && typeof m.server_id === 'string') {
      // v4.4.0-N1: 仅在该连接首次订阅此 serverId 时递增全局引用计数
      // （重复 subscribe 同一 serverId 不重复计数，与 Set 语义一致）
      if (!conn.subscribedServerIds.has(m.server_id)) {
        conn.subscribedServerIds.add(m.server_id);
        this.incrementRefCount(m.server_id);
      }
    } else if (m.type === 'unsubscribe' && typeof m.server_id === 'string') {
      // v4.4.0-N1: 仅在该连接确实订阅了此 serverId 时递减全局引用计数
      if (conn.subscribedServerIds.has(m.server_id)) {
        conn.subscribedServerIds.delete(m.server_id);
        this.decrementRefCount(m.server_id);
      }
    } else if (m.type === 'ping') {
      // 二.2: 心跳响应
      try {
        conn.ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // ignore
      }
    }
  }

  /**
   * 转发事件到订阅了指定 server_id 的所有前端客户端
   * 供模块6 daemonClient 调用
   */
  broadcastToServer(serverId: string, event: PanelToFrontendEvent): void {
    const payload = JSON.stringify(event);
    for (const conn of this.clients) {
      if (conn.authenticated && conn.subscribedServerIds.has(serverId) && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload);
      }
    }
  }

  /**
   * I5: 推送事件到指定用户的所有已鉴权前端连接。
   *
   * 用于通知等 user 维度事件（无需 server_id 订阅）。
   * 仅发送给通过 auth 且 userId 匹配的连接；单个连接发送失败不影响其他连接。
   */
  broadcastToUser(userId: string, event: PanelPushEvent): void {
    const payload = JSON.stringify(event);
    for (const conn of this.clients) {
      if (conn.authenticated && conn.userId === userId && conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(payload);
        } catch {
          // 单个连接发送失败不应影响其他连接
        }
      }
    }
  }

  /**
   * v4.4.0-K1：广播事件到所有已鉴权的前端客户端
   *
   * 用于系统监控等全局事件（无 server_id 维度）。
   * 仅发送给已通过 auth 的连接，未鉴权连接不接收。
   */
  broadcastToAll(event: PanelToFrontendEvent): void {
    const payload = JSON.stringify(event);
    for (const conn of this.clients) {
      if (conn.authenticated && conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(payload);
        } catch {
          // 单个连接发送失败不应影响其他连接
        }
      }
    }
  }

  /**
   * 当前连接数
   */
  connectionCount(): number {
    return this.clients.size;
  }

  /**
   * 关闭 WS 服务端
   */
  close(): void {
    for (const conn of this.clients) {
      conn.ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
