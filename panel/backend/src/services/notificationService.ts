// ============================================================================
// notificationService — 用户通知服务
// 表结构：user_notifications（见 db/migrations/20260716160000_create_user_notifications.ts）
// v3.3.0
// I5: 创建/已读时通过 PanelWsServer.broadcastToUser 推送 WebSocket 通知事件，
//     替代前端 30s 轮询；DB 查询保留作为初始化与降级兜底。
// ============================================================================

import type { Knex } from 'knex';
import {
  NOTIFICATION_NEW_EVENT,
  NOTIFICATION_UNREAD_COUNT_EVENT,
  type NotificationNewPushEvent,
  type NotificationUnreadCountPushEvent,
  type PanelWsServer,
} from '../websocket/server.js';

interface NotificationRow {
  id: number;
  user_id: string;
  type: string;
  title: string;
  content: string;
  related_server_id: string | null;
  related_order_id: number | null;
  is_read: number;
  created_at: string;
  retention_days: number;
}

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

export class NotificationServiceImpl {
  /** I5: WebSocket 服务端引用（方法注入；initWebSocket 完成后由 index.ts 绑定） */
  private wsServer: PanelWsServer | null = null;

  constructor(private db: Knex) {}

  /**
   * I5: 注入 PanelWsServer 引用，启用 WebSocket 实时推送。
   * 在 index.ts 的 initWebSocket 之后调用；未注入时降级为纯 DB 写入（不影响通知创建）。
   */
  setWsServer(ws: PanelWsServer | null): void {
    this.wsServer = ws;
  }

  async create(params: {
    userId: string;
    type: string;
    title: string;
    content?: string;
    relatedServerId?: string;
    relatedOrderId?: number;
  }): Promise<NotificationSummary> {
    const now = new Date().toISOString();
    const inserted = await this.db<NotificationRow>('user_notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      content: params.content ?? '',
      related_server_id: params.relatedServerId ?? null,
      related_order_id: params.relatedOrderId ?? null,
      is_read: 0,
      created_at: now,
    }).returning('*');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    const summary = toSummary(row);
    // I5: 实时推送 notification.new + notification.unread_count
    await this.pushNotificationCreated(params.userId, summary);
    return summary;
  }

  async listForUser(userId: string, limit = 50): Promise<NotificationSummary[]> {
    const rows = await this.db<NotificationRow>('user_notifications')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map(toSummary);
  }

  async countUnread(userId: string): Promise<number> {
    const row = await this.db<NotificationRow>('user_notifications')
      .where({ user_id: userId, is_read: 0 })
      .count<{ cnt: number | string }>('id as cnt')
      .first();
    return Number(row?.cnt ?? 0);
  }

  async markAsRead(userId: string, id: number): Promise<void> {
    await this.db<NotificationRow>('user_notifications')
      .where({ id, user_id: userId })
      .update({ is_read: 1 });
    // I5: 已读后推送最新未读数
    await this.pushUnreadCount(userId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.db<NotificationRow>('user_notifications')
      .where({ user_id: userId, is_read: 0 })
      .update({ is_read: 1 });
    // I5: 全部已读后推送最新未读数
    await this.pushUnreadCount(userId);
  }

  // ----- I5: WebSocket 推送辅助方法 -----

  /**
   * 推送 notification.new 事件 + 同步推送 notification.unread_count。
   * 推送失败不影响通知创建（DB 已写入，前端可在下次重连/降级轮询时同步）。
   */
  private async pushNotificationCreated(userId: string, summary: NotificationSummary): Promise<void> {
    if (!this.wsServer) return;
    try {
      const newEvent: NotificationNewPushEvent = {
        type: NOTIFICATION_NEW_EVENT,
        timestamp: summary.created_at,
        notification: summary,
      };
      this.wsServer.broadcastToUser(userId, newEvent);
      await this.pushUnreadCount(userId);
    } catch {
      // 推送失败降级：前端 WS 断开时走轮询兜底
    }
  }

  /** 推送 notification.unread_count 事件（查询最新未读数） */
  private async pushUnreadCount(userId: string): Promise<void> {
    if (!this.wsServer) return;
    try {
      const unreadCount = await this.countUnread(userId);
      const countEvent: NotificationUnreadCountPushEvent = {
        type: NOTIFICATION_UNREAD_COUNT_EVENT,
        timestamp: new Date().toISOString(),
        unread_count: unreadCount,
      };
      this.wsServer.broadcastToUser(userId, countEvent);
    } catch {
      // ignore
    }
  }

  /**
   * v3.6.2-A2: 清理超过 retention_days 的用户通知（全表统一 retention）
   * 返回删除的行数
   */
  async cleanupOldLogs(): Promise<number> {
    const sample = await this.db<NotificationRow>('user_notifications').select('retention_days').first();
    const retentionDays = sample?.retention_days ?? 30;
    if (retentionDays <= 0) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffIso = cutoff.toISOString();

    const deleted = await this.db<NotificationRow>('user_notifications')
      .where('created_at', '<', cutoffIso)
      .delete();

    return deleted;
  }

  /**
   * v3.6.2-A6: 更新 user_notifications 表的 retention_days（全表统一）
   */
  async updateRetentionDays(retentionDays: number): Promise<void> {
    await this.db<NotificationRow>('user_notifications').update({ retention_days: retentionDays });
  }

  /**
   * v3.6.2-A4: 获取 user_notifications 表的 retention_days 与行数
   */
  async getRetentionStats(): Promise<{ retention_days: number; row_count: number }> {
    const sample = await this.db<NotificationRow>('user_notifications').select('retention_days').first();
    const countResult = await this.db<NotificationRow>('user_notifications').count<{ cnt: number | string }>('* as cnt').first();
    return {
      retention_days: sample?.retention_days ?? 30,
      row_count: Number(countResult?.cnt ?? 0),
    };
  }
}

function toSummary(row: NotificationRow): NotificationSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    related_server_id: row.related_server_id,
    related_order_id: row.related_order_id,
    is_read: !!row.is_read,
    created_at: row.created_at,
  };
}

export function createNotificationService(db: Knex): NotificationServiceImpl {
  return new NotificationServiceImpl(db);
}
