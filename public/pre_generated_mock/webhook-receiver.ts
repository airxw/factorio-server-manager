// ============================================================================
// webhook-receiver.ts — v4.17.0 Webhook 接收服务 Mock（预生成稳定 Mock）
//
// 用途：契约冻结后，下游模块（webhook 路由、绑定验证流程、单元测试）可在
//       真实 WebhookReceiver 实现就位前，通过 tsconfig paths alias 切换到本 Mock
//       进行并行开发。覆盖 HMAC 签名校验、时间窗口、nonce 去重、事件分发等场景。
//
// 覆盖场景：
//   1. 签名校验通过（合法 HMAC + 时间戳 + nonce）
//   2. 签名校验失败（HMAC 不匹配）
//   3. 时间戳超出容差窗口（防重放）
//   4. nonce 重复（防重放）
//   5. 事件类型不在白名单内
//   6. player.verify_command 事件触发绑定验证流程
//   7. payload 超过大小限制
//
// 切换路径（rules-3 §四 可覆盖）：通过 tsconfig paths alias 切换，
//   调用方零改动。开发者可在 global_mock/ 下覆盖本 Mock 适配特殊测试场景。
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §10 + §2.6
// ============================================================================

import type {
  WebhookEvent,
  WebhookEventPayload,
  WebhookEventType,
  ReceiveWebhookEventResponse,
  VerifyBindingViaWebhookRequest,
  VerifyBindingViaWebhookResponse,
} from '../schema/panel-api-types';

/**
 * Mock 错误类，模拟 PanelErrorResponse 抛出
 */
export class MockWebhookError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MockWebhookError';
  }
}

/**
 * Mock Webhook 配置（与 webhook.config.schema.json 默认值对齐）
 */
interface MockWebhookConfig {
  hmacAlgorithm: 'sha256' | 'sha384' | 'sha512';
  signatureHeader: string;
  timestampHeader: string;
  nonceHeader: string;
  timestampToleranceSeconds: number;
  nonceCacheTtlSeconds: number;
  nonceCacheMaxEntries: number;
  secretEnvVar: string;
  allowedEventTypes: WebhookEventType[];
  maxPayloadSizeBytes: number;
}

const DEFAULT_CONFIG: MockWebhookConfig = {
  hmacAlgorithm: 'sha256',
  signatureHeader: 'X-GSP-Signature',
  timestampHeader: 'X-GSP-Timestamp',
  nonceHeader: 'X-GSP-Nonce',
  timestampToleranceSeconds: 300, // 5 分钟
  nonceCacheTtlSeconds: 600, // 10 分钟
  nonceCacheMaxEntries: 10000,
  secretEnvVar: 'GSP_WEBHOOK_SECRET',
  allowedEventTypes: [
    'player.join',
    'player.leave',
    'player.chat',
    'player.verify_command',
    'binding.verify_request',
  ],
  maxPayloadSizeBytes: 65536, // 64KB
};

/**
 * Mock 事件处理器签名
 */
export type MockWebhookEventHandler = (payload: WebhookEventPayload) => Promise<void>;

/**
 * Mock Webhook 接收服务
 *
 * 设计说明：
 *   - HMAC-SHA256 签名校验（与 GitHub Webhook 格式一致：'sha256=<hex>'）
 *   - 时间戳容差窗口校验（防重放）
 *   - nonce 去重缓存（LRU + TTL）
 *   - 事件类型白名单
 *   - 事件处理器注册机制（observer pattern）
 *
 * 安全要求（rules-0 §四 + plan §10.3）：
 *   - 密钥从环境变量读取，不入配置文件
 *   - 签名 + 时间戳 + nonce 三重防护
 *   - fail-closed：校验失败一律拒绝
 */
export class MockWebhookReceiver {
  private config: MockWebhookConfig = { ...DEFAULT_CONFIG };
  private secret: string = 'mock-webhook-secret-do-not-use-in-prod';
  private nonceCache: Map<string, number> = new Map(); // nonce → received_at_unix
  private handlers: Map<WebhookEventType, MockWebhookEventHandler[]> = new Map();
  private receivedEvents: WebhookEvent[] = []; // 审计日志

  /**
   * 重置 Mock 状态（测试用例 setup 时调用）
   */
  resetMockWebhookReceiver(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.secret = 'mock-webhook-secret-do-not-use-in-prod';
    this.nonceCache.clear();
    this.handlers.clear();
    this.receivedEvents = [];
  }

  /**
   * 设置 Webhook 密钥（测试用，模拟环境变量）
   */
  setSecret(secret: string): void {
    this.secret = secret;
  }

  /**
   * 设置配置（覆盖默认值）
   */
  setConfig(overrides: Partial<MockWebhookConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  /**
   * 注册事件处理器
   */
  on(eventType: WebhookEventType, handler: MockWebhookEventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  /**
   * 计算 HMAC 签名（与生产实现一致）
   *
   * 签名输入：`${timestamp}.${nonce}.${JSON.stringify(payload)}`
   * 签名算法：HMAC-SHA256(secret, input)
   * 输出格式：`sha256=<hex>`
   */
  computeSignature(timestamp: string, nonce: string, payload: WebhookEventPayload): string {
    const input = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
    // Node.js crypto 在生产代码中使用；Mock 中用简化版便于测试
    // 真实实现：crypto.createHmac('sha256', secret).update(input).digest('hex')
    // Mock：用简单 hash 模拟（仅用于签名格式校验）
    const hash = simpleHash(this.secret + input);
    return `sha256=${hash}`;
  }

  /**
   * 接收 Webhook 事件
   *
   * 校验流程：
   *   1. payload 大小校验
   *   2. 时间戳容差窗口
   *   3. nonce 去重
   *   4. 事件类型白名单
   *   5. HMAC 签名
   *   6. 分发给注册的处理器
   */
  async receiveEvent(event: WebhookEvent): Promise<ReceiveWebhookEventResponse> {
    // 1. payload 大小校验
    const payloadSize = Buffer.byteLength(JSON.stringify(event.payload), 'utf8');
    if (payloadSize > this.config.maxPayloadSizeBytes) {
      return {
        status: 'rejected',
        reason: `payload size ${payloadSize} exceeds limit ${this.config.maxPayloadSizeBytes}`,
      };
    }

    // 2. 时间戳容差窗口
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(event.timestamp, 10);
    if (isNaN(eventTime)) {
      return { status: 'rejected', reason: 'invalid timestamp format' };
    }
    if (Math.abs(now - eventTime) > this.config.timestampToleranceSeconds) {
      return {
        status: 'rejected',
        reason: `timestamp out of tolerance window (±${this.config.timestampToleranceSeconds}s)`,
      };
    }

    // 3. nonce 去重
    if (this.nonceCache.has(event.nonce)) {
      return { status: 'rejected', reason: 'nonce duplicated (replay attack suspected)' };
    }
    // 清理过期 nonce
    this.cleanupExpiredNonces(now);
    // 添加新 nonce
    this.nonceCache.set(event.nonce, now);

    // 4. 事件类型白名单
    if (!this.config.allowedEventTypes.includes(event.payload.event_type)) {
      return {
        status: 'rejected',
        reason: `event type ${event.payload.event_type} not in whitelist`,
      };
    }

    // 5. HMAC 签名校验
    const expectedSignature = this.computeSignature(
      event.timestamp,
      event.nonce,
      event.payload,
    );
    if (!constantTimeEqual(event.signature, expectedSignature)) {
      return { status: 'rejected', reason: 'HMAC signature mismatch' };
    }

    // 6. 分发给处理器
    const handlers = this.handlers.get(event.payload.event_type) ?? [];
    for (const handler of handlers) {
      try {
        await handler(event.payload);
      } catch (err) {
        // 处理器异常不影响接收确认（已通过校验）
        // 真实实现应记录错误日志
      }
    }

    // 审计日志
    this.receivedEvents.push(event);

    return { status: 'accepted' };
  }

  /**
   * 专用接口：处理游戏内 !verify 命令（player.verify_command 事件）
   *
   * 真实实现：
   *   1. 根据 (server_id, game_type, player_name) 查找 pending 绑定
   *   2. 校验 verify_code 是否匹配
   *   3. 消费验证码：pending → verified
   *   4. 返回验证结果
   *
   * Mock 行为：根据预设的绑定数据返回结果
   */
  async handleVerifyCommand(
    request: VerifyBindingViaWebhookRequest,
  ): Promise<VerifyBindingViaWebhookResponse> {
    // Mock：预设一个成功的绑定
    const mockBindingId = 3;
    const mockUserId = '22222222-2222-2222-2222-222222222222';
    const mockVerifyCode = '654321';

    if (request.verify_code !== mockVerifyCode) {
      return {
        result: 'invalid_code',
        binding_id: null,
        user_id: null,
        message: 'verify_code does not match',
      };
    }

    return {
      result: 'verified',
      binding_id: mockBindingId,
      user_id: mockUserId,
      message: 'binding verified successfully via webhook',
    };
  }

  /**
   * 清理过期 nonce（LRU + TTL）
   */
  private cleanupExpiredNonces(now: number): void {
    const cutoff = now - this.config.nonceCacheTtlSeconds;
    for (const [nonce, receivedAt] of this.nonceCache.entries()) {
      if (receivedAt < cutoff) {
        this.nonceCache.delete(nonce);
      }
    }
    // 容量上限保护：若仍超限，按 FIFO 淘汰
    if (this.nonceCache.size > this.config.nonceCacheMaxEntries) {
      const entries = [...this.nonceCache.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = entries.length - this.config.nonceCacheMaxEntries;
      for (let i = 0; i < toRemove; i++) {
        this.nonceCache.delete(entries[i][0]);
      }
    }
  }

  /**
   * 获取已接收事件数（审计/调试用）
   */
  getReceivedEventCount(): number {
    return this.receivedEvents.length;
  }

  /**
   * 获取 nonce 缓存大小（调试用）
   */
  getNonceCacheSize(): number {
    return this.nonceCache.size;
  }

  /**
   * 构造合法的 Webhook 事件（测试辅助）
   */
  buildValidEvent(
    payload: WebhookEventPayload,
    secretOverride?: string,
  ): WebhookEvent {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = cryptoRandomUUID();
    const secret = secretOverride ?? this.secret;
    const input = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
    const hash = simpleHash(secret + input);
    return {
      event_id: cryptoRandomUUID(),
      payload,
      signature: `sha256=${hash}`,
      timestamp,
      nonce,
    };
  }

  /**
   * 构造签名错误的 Webhook 事件（测试辅助）
   */
  buildInvalidSignatureEvent(payload: WebhookEventPayload): WebhookEvent {
    return {
      event_id: cryptoRandomUUID(),
      payload,
      signature: 'sha256=invalid_signature',
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: cryptoRandomUUID(),
    };
  }

  /**
   * 构造过期时间戳的 Webhook 事件（测试辅助）
   */
  buildExpiredTimestampEvent(payload: WebhookEventPayload): WebhookEvent {
    const expiredTimestamp = String(
      Math.floor(Date.now() / 1000) - this.config.timestampToleranceSeconds - 60,
    );
    const nonce = cryptoRandomUUID();
    const input = `${expiredTimestamp}.${nonce}.${JSON.stringify(payload)}`;
    const hash = simpleHash(this.secret + input);
    return {
      event_id: cryptoRandomUUID(),
      payload,
      signature: `sha256=${hash}`,
      timestamp: expiredTimestamp,
      nonce,
    };
  }
}

/**
 * 简单 hash 函数（Mock 用，非加密安全）
 * 生产实现必须使用 crypto.createHmac
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // 转为 64 位 hex 字符串（模拟 SHA256 输出长度）
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return hex.repeat(8); // 64 字符
}

/**
 * 常量时间字符串比较（防时序攻击）
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 简单 UUID 生成（Mock 用）
 * 生产实现应使用 crypto.randomUUID()
 */
function cryptoRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 默认导出单例（开发联调用）
 * 单元测试请通过 resetMockWebhookReceiver() 重置状态
 */
export const mockWebhookReceiver = new MockWebhookReceiver();
