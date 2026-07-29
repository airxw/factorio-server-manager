// ============================================================================
// webhook-receiver.d.ts — v4.17.0 Webhook 接收服务接口存根
//
// 用途：接收 Daemon 端游戏事件回调（玩家 join/leave/chat/verify_command），
//       替代旧 player_verify_codes 表的 !verify 命令消费模式。
//
// 实现方：panel/backend/src/services/webhookReceiverService.ts（待创建）
// 调用方：panel/backend/src/api/routes/webhookEvents.ts（待创建）
//
// 契约约束：
//   - 零实现逻辑，仅声明签名（rules-3 §二）
//   - HMAC 签名验证 + timestamp + nonce 三重防护
//   - 异常类型与 panel-api-types.ts PanelErrorResponse 一致
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §10 + §2.6
// ============================================================================

import type {
  WebhookEvent,
  WebhookEventType,
  WebhookEventPayload,
  VerifyBindingViaWebhookRequest,
  VerifyBindingViaWebhookResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * Webhook 接收服务接口（v4.17.0）
 *
 * 设计原则：
 *   1. 签名优先：所有请求必须通过 HMAC-SHA256 + timestamp + nonce 三重校验
 *   2. 事件类型白名单：仅处理 allowed_event_types 内的事件
 *   3. 幂等性：相同 nonce 的请求在 nonce_cache_ttl_seconds 内视为重复，拒绝
 *   4. 异步处理：验证类事件同步处理；统计类事件异步处理（fire-and-forget）
 */
export interface IWebhookReceiverService {
  /**
   * 处理 Webhook 事件（入口方法）
   *
   * 流程：
   *   1. 校验签名（HMAC-SHA256）
   *   2. 校验时间戳（防重放，容差 ±timestamp_tolerance_seconds）
   *   3. 校验 nonce（防重放，LRU 缓存去重）
   *   4. 校验事件类型（白名单）
   *   5. 校验 payload 大小（防 DoS）
   *   6. 路由到具体事件处理器
   *
   * @param headers HTTP 头（含 X-GSP-Signature / X-GSP-Timestamp / X-GSP-Nonce）
   * @param rawBody 原始请求体（用于签名校验，避免 JSON 解析后字符串不一致）
   * @returns 处理结果
   * @throws {PanelErrorResponse} WEBHOOK_SIGNATURE_INVALID | WEBHOOK_TIMESTAMP_EXPIRED | WEBHOOK_NONCE_DUPLICATE | WEBHOOK_EVENT_TYPE_NOT_ALLOWED | WEBHOOK_PAYLOAD_TOO_LARGE
   */
  handleEvent(
    headers: {
      'x-gsp-signature'?: string;
      'x-gsp-timestamp'?: string;
      'x-gsp-nonce'?: string;
      [key: string]: string | undefined;
    },
    rawBody: string,
  ): Promise<{ status: 'accepted' | 'rejected'; reason?: string }>;

  /**
   * 校验签名（HMAC-SHA256）
   *
   * 签名算法：
   *   signature = HMAC-SHA256(
   *     key = $GSP_WEBHOOK_SECRET,
   *     message = timestamp + "\n" + nonce + "\n" + raw_body
   *   )
   *
   * 客户端发送格式（与 GitHub Webhook 一致）：
   *   X-GSP-Signature: sha256=<hex>
   *
   * @param signature 客户端签名（'sha256=<hex>' 格式）
   * @param timestamp Unix 秒级时间戳字符串
   * @param nonce 客户端生成的随机字符串
   * @param rawBody 原始请求体
   * @returns true=签名 valid；false=invalid
   */
  verifySignature(
    signature: string,
    timestamp: string,
    nonce: string,
    rawBody: string,
  ): Promise<boolean>;

  /**
   * 校验时间戳（防重放）
   *
   * @param timestamp Unix 秒级时间戳字符串
   * @returns true=在容差窗口内；false=超出窗口
   */
  verifyTimestamp(timestamp: string): Promise<boolean>;

  /**
   * 校验 nonce（防重放，LRU 去重）
   *
   * @param nonce 客户端生成的随机字符串
   * @returns true=首次出现（valid）；false=重复（invalid）
   */
  verifyNonce(nonce: string): Promise<boolean>;

  /**
   * 处理玩家验证命令事件（player.verify_command）
   *
   * 流程：
   *   1. 从 payload 提取 (scope_type, scope_ref, player_name, verify_code)
   *   2. 调用 bindingService.findBindingByPlayerName 反查绑定
   *   3. 校验 verify_code 匹配
   *   4. 调用 bindingService.verifyBinding 消费验证码
   *
   * @param payload 事件负载
   * @returns 验证结果
   */
  handleVerifyCommand(payload: VerifyBindingViaWebhookRequest): Promise<VerifyBindingViaWebhookResponse>;

  /**
   * 处理玩家加入事件（player.join）
   *
   * 用途：写入 player_sessions 表（与现有 daemon-report 路由并行）
   *
   * @param payload 事件负载
   */
  handlePlayerJoin(payload: WebhookEventPayload): Promise<void>;

  /**
   * 处理玩家离开事件（player.leave）
   *
   * @param payload 事件负载
   */
  handlePlayerLeave(payload: WebhookEventPayload): Promise<void>;

  /**
   * 处理玩家聊天事件（player.chat）
   *
   * 用途：触发 chat-trigger / vote / CDK 兑换等聊天命令
   *
   * @param payload 事件负载
   */
  handlePlayerChat(payload: WebhookEventPayload): Promise<void>;

  /**
   * 清理过期 nonce 缓存（定时任务调用，LRU 自动过期，此方法用于主动清理）
   *
   * @returns 清理的条目数
   */
  cleanupExpiredNonces(): Promise<{ cleaned_count: number }>;

  /**
   * 获取 Webhook 接收统计（调试用）
   */
  getReceiveStats(): Promise<{
    total_received: number;
    total_accepted: number;
    total_rejected: number;
    rejection_reasons: Record<string, number>;
    active_nonces: number;
  }>;
}

/**
 * Webhook 服务异常码
 */
export type WebhookReceiverErrorCode =
  | 'WEBHOOK_SIGNATURE_INVALID' // 签名校验失败
  | 'WEBHOOK_SIGNATURE_MISSING' // 缺少签名头
  | 'WEBHOOK_TIMESTAMP_MISSING' // 缺少时间戳头
  | 'WEBHOOK_TIMESTAMP_INVALID' // 时间戳格式不合法
  | 'WEBHOOK_TIMESTAMP_EXPIRED' // 时间戳超出容差窗口
  | 'WEBHOOK_NONCE_MISSING' // 缺少 nonce 头
  | 'WEBHOOK_NONCE_DUPLICATE' // nonce 重复（防重放命中）
  | 'WEBHOOK_EVENT_TYPE_NOT_ALLOWED' // 事件类型不在白名单
  | 'WEBHOOK_PAYLOAD_TOO_LARGE' // 请求体超限
  | 'WEBHOOK_PAYLOAD_INVALID' // 请求体 JSON 不合法
  | 'WEBHOOK_SECRET_NOT_CONFIGURED' // 服务端未配置 GSP_WEBHOOK_SECRET
  | 'PANEL_INTERNAL_ERROR';
