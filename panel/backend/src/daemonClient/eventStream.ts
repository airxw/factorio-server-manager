// ============================================================================
// 模块6_Panel通信客户端 — Daemon WS 事件流客户端
// 连接 ws://<daemon_host>:<daemon_port>/ws?token=<token>
// 接收事件: connected / instance.started / instance.stopped / console.output / state.change
// 实现 exponential backoff 重连（1s → 2s → 4s → ... max 30s，无限重试）
// ============================================================================

import { WebSocket } from 'ws';
import type { DaemonToPanelEvent } from '@public/schema/ws-events';
import type { DaemonEventStreamConfig } from './types.js';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const VALID_EVENT_TYPES = new Set<DaemonToPanelEvent['type']>([
  'connected',
  'instance.started',
  'instance.stopped',
  'console.output',
  'state.change',
]);

/**
 * Daemon WebSocket 事件流客户端
 * 启动后自动重连；close() 主动关闭不再重连。
 *
 * v4.4.0-N1 改造：
 *   - 内部维护 subscribedInstances 跟踪集，跨重连保留订阅
 *   - 新增 unsubscribe(instanceId) 方法，支持按实例取消订阅
 *   - 重连成功后自动重订阅跟踪集中的所有实例（无需 onConnect 回调补订阅）
 *   - subscribe/unsubscribe 在 WS 未连接时仅更新跟踪集，连接恢复后自动发送
 */
export class DaemonEventStream {
  private readonly config: DaemonEventStreamConfig;
  private ws: WebSocket | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /**
   * 当前已跟踪的实例订阅集合。
   * - subscribe(id) 加入集合 + 立即发送 WS 命令（如已连接）
   * - unsubscribe(id) 移出集合 + 立即发送 WS 命令（如已连接）
   * - 重连成功后，自动遍历集合重新发送 subscribe
   */
  private subscribedInstances: Set<string> = new Set();

  constructor(config: DaemonEventStreamConfig) {
    this.config = config;
  }

  /**
   * 建立 WS 连接。已连接时先关闭旧连接再重连。
   */
  connect(): void {
    if (this.closed) {
      this.config.logger.warn('DaemonEventStream 已 close()，拒绝 connect()');
      return;
    }

    const wsUrl = this.buildWsUrl();
    this.config.logger.info({ url: wsUrl.replace(/token=[^&]+/, 'token=***') }, '连接 Daemon WS');

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      this.config.logger.error({ err: String(err) }, '创建 WebSocket 失败，触发重连');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.config.logger.info('Daemon WS 已连接');
      // v4.4.0-N1: 重连后自动重订阅跟踪集中的所有实例
      // 这保证断连期间 subscribe() 调用记录的实例在重连后恢复订阅
      this.resubscribeAll();
      this.config.onConnect?.();
    });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.config.logger.warn({ code, reason: reason.toString() }, 'Daemon WS 关闭');
      this.ws = null;
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    ws.on('error', (err: Error) => {
      this.config.logger.error({ err: err.message }, 'Daemon WS 错误');
      // close 事件通常会跟随 error，重连在 close 中调度
    });
  }

  /**
   * 主动关闭，不再重连
   */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'client closing');
      } catch {
        // 忽略关闭错误
      }
      this.ws = null;
    }
    this.config.logger.info('DaemonEventStream 已关闭');
  }

  /**
   * 订阅指定实例的事件流。
   *
   * Daemon WS 协议要求 Panel 显式发送 `{ type: 'subscribe', instance_id }` 才会
   * 向该 WS 连接推送对应实例的 state.change / console.output 等事件。
   *
   * 调用时机：
   *   - onConnect 后：对 listInstances() 返回的所有实例逐个订阅（覆盖重连场景）
   *   - POST /api/servers/:id/start 成功后：订阅新启动的实例
   *   - 前端 WS 第一个订阅者出现时（v4.4.0-N1 引用计数触发）
   *
   * WS 未连接时仅更新跟踪集，连接恢复后自动补发订阅。
   */
  subscribe(instanceId: string): void {
    if (this.closed) {
      return;
    }
    this.subscribedInstances.add(instanceId);
    this.sendSubscribe(instanceId);
  }

  /**
   * v4.4.0-N1 新增：取消订阅指定实例的事件流。
   *
   * 调用时机：
   *   - 前端 WS 最后一个订阅者退出时（引用计数归零）
   *   - 实例被删除时（清理订阅状态）
   *
   * WS 未连接时仅更新跟踪集，重连后不会重订阅该实例。
   */
  unsubscribe(instanceId: string): void {
    if (this.closed) {
      return;
    }
    this.subscribedInstances.delete(instanceId);
    this.sendUnsubscribe(instanceId);
  }

  /**
   * v4.4.0-N1 新增：获取当前已跟踪的实例订阅集合（只读视图）。
   * 用于诊断和日志，不建议外部修改。
   */
  getSubscribedInstances(): ReadonlySet<string> {
    return this.subscribedInstances;
  }

  // ----------------------------------------------------------------------

  private buildWsUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    // http(s):// → ws(s)://
    const wsBase = base
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    return `${wsBase}/ws?token=${encodeURIComponent(this.config.token)}`;
  }

  private handleMessage(data: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.config.logger.warn({ raw: data.toString().slice(0, 200) }, 'Daemon WS 消息 JSON 解析失败');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this.config.logger.warn({ parsed }, 'Daemon WS 消息非对象');
      return;
    }

    const event = parsed as { type?: string };
    if (typeof event.type !== 'string' || !VALID_EVENT_TYPES.has(event.type as DaemonToPanelEvent['type'])) {
      this.config.logger.warn({ type: event.type }, 'Daemon WS 未知事件类型');
      return;
    }

    const typed = parsed as DaemonToPanelEvent;
    try {
      this.config.onEvent(typed);
    } catch (err) {
      this.config.logger.error(
        { err: err instanceof Error ? err.message : String(err), type: typed.type },
        'onEvent 回调抛出异常',
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.config.logger.info({ delayMs: delay }, '计划重连 Daemon WS');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * v4.4.0-N1: 重连成功后，向 Daemon 重发跟踪集中所有实例的 subscribe 命令。
   * 在 onConnect 回调之前调用，确保 onConnect 内的逻辑（如 DB 状态同步）
   * 看到的是已恢复订阅的状态。
   */
  private resubscribeAll(): void {
    if (this.subscribedInstances.size === 0) {
      return;
    }
    this.config.logger.info(
      { count: this.subscribedInstances.size },
      '重连后重订阅跟踪集中的实例',
    );
    for (const instanceId of this.subscribedInstances) {
      this.sendSubscribe(instanceId);
    }
  }

  /**
   * 发送 subscribe 命令到 Daemon WS（如已连接）。
   * WS 未连接时静默跳过 — 跟踪集已记录，resubscribeAll 会在重连后补发。
   */
  private sendSubscribe(instanceId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      // WS 未连接，跟踪集已更新，重连后由 resubscribeAll 补发
      return;
    }
    const msg = JSON.stringify({ type: 'subscribe', instance_id: instanceId });
    try {
      this.ws.send(msg);
    } catch (err) {
      this.config.logger.warn(
        { err: err instanceof Error ? err.message : String(err), instanceId },
        'subscribe 消息发送失败',
      );
    }
  }

  /**
   * v4.4.0-N1: 发送 unsubscribe 命令到 Daemon WS（如已连接）。
   * WS 未连接时静默跳过 — 跟踪集已更新，重连后不会重订阅该实例。
   */
  private sendUnsubscribe(instanceId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      // WS 未连接，跟踪集已更新，重连后 resubscribeAll 不会再订阅该实例
      return;
    }
    const msg = JSON.stringify({ type: 'unsubscribe', instance_id: instanceId });
    try {
      this.ws.send(msg);
    } catch (err) {
      this.config.logger.warn(
        { err: err instanceof Error ? err.message : String(err), instanceId },
        'unsubscribe 消息发送失败',
      );
    }
  }
}
