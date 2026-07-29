/**
 * webhook-service.d.ts — webhookService 接口存根
 *
 * 职责：Webhook 触发 / 分发 / 管理
 * 数据契约：scheme-final-merged.md §4.2.2 P5（webhook 表字段待细化）
 * 来源：scheme-final-merged.md §7.1 P5 / §11 未闭合项 #5
 */

import type { Webhook, WebhookConfig } from './shared-types';
import { WebhookNotFoundError, WebhookDeliveryFailedError } from './shared-types';

export interface WebhookService {
  /**
   * 触发 Webhook。查询 serverId 下订阅了 eventType 的全部 enabled webhook，
   * 异步分发 HTTP POST 请求。失败重试 3 次后标记失败并记录日志。
   * @param serverId 目标服务器 ID
   * @param eventType 事件类型（如 'order.claimed' / 'vote.threshold_met' 等）
   * @param payload 事件负载
   * @throws {WebhookDeliveryFailedError} 全部分发失败（部分失败仅记录日志）
   */
  triggerWebhook(serverId: string, eventType: string, payload: any): Promise<void>;

  /**
   * 列出服务器 Webhook 配置。
   */
  listWebhooks(serverId: string): Promise<Webhook[]>;

  /**
   * 创建 Webhook 配置。
   * @returns 创建的 Webhook 记录（含 ID）
   */
  createWebhook(serverId: string, config: WebhookConfig): Promise<Webhook>;

  /**
   * 删除 Webhook。
   * @throws {WebhookNotFoundError} webhookId 不存在
   */
  deleteWebhook(webhookId: number): Promise<void>;
}

export { WebhookNotFoundError, WebhookDeliveryFailedError } from './shared-types';
