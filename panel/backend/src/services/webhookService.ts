// ============================================================================
// webhookService — Webhook 管理（P5）
// 数据契约：public/schema/panel-api-types.ts（WebhookSummary 等）
// 表结构：
//   webhooks (id, server_id, url, event_types, secret, enabled,
//             created_at, updated_at)
//             event_types: JSON 数组字符串（默认 '[]'）
//             secret: string | null
// 来源：P5 任务清单 §Webhook
//
// 说明：本服务按 P5 任务清单要求实现，依赖通过 req.app.locals.webhookService 注入。
//       triggerTest 不持久化投递记录，仅返回即时结果。
// ============================================================================

import type { Knex } from 'knex';
import { WebhookNotFoundError, WebhookDeliveryError } from './errors.js';
import type {
  WebhookSummary,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  TriggerWebhookTestRequest,
  TriggerWebhookTestResponse,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** fetch 超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 10_000;

/** 当前 ISO 时间戳 */
const nowIso = (): string => new Date().toISOString();

// ----- DB 行类型 -----

interface WebhookRow {
  id: number;
  server_id: string;
  url: string;
  event_types: string; // JSON 数组字符串
  secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ----- 服务实现 -----

export class WebhookServiceImpl {
  constructor(private readonly db: Knex) {}

  async list(serverId: string): Promise<{ webhooks: WebhookSummary[] }> {
    const rows = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId })
      .orderBy('created_at', 'desc');
    return { webhooks: rows.map(toWebhookSummary) };
  }

  async create(
    serverId: string,
    req: CreateWebhookRequest,
  ): Promise<{ webhook: WebhookSummary }> {
    const now = nowIso();
    const inserted = await this.db<WebhookRow>('webhooks')
      .insert({
        server_id: serverId,
        url: req.url,
        event_types: JSON.stringify(req.event_types ?? []),
        secret: req.secret ?? null,
        enabled: req.enabled ?? true,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return { webhook: toWebhookSummary(row) };
  }

  async update(
    serverId: string,
    id: number,
    req: UpdateWebhookRequest,
  ): Promise<{ webhook: WebhookSummary }> {
    const existing = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new WebhookNotFoundError(
        `Webhook 不存在: server=${serverId}, id=${id}`,
      );
    }

    const updates: Partial<WebhookRow> = { updated_at: nowIso() };
    if (req.url !== undefined) updates.url = req.url;
    if (req.event_types !== undefined) {
      updates.event_types = JSON.stringify(req.event_types);
    }
    if (req.secret !== undefined) updates.secret = req.secret;
    if (req.enabled !== undefined) updates.enabled = req.enabled;

    const updated = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, id })
      .update(updates)
      .returning('*');

    const row = Array.isArray(updated) ? updated[0] : updated;
    return { webhook: toWebhookSummary(row) };
  }

  async remove(
    serverId: string,
    id: number,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new WebhookNotFoundError(
        `Webhook 不存在: server=${serverId}, id=${id}`,
      );
    }
    await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, id })
      .delete();
    return { deleted: true };
  }

  async triggerTest(
    serverId: string,
    id: number,
    req: TriggerWebhookTestRequest,
  ): Promise<TriggerWebhookTestResponse> {
    const webhook = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, id })
      .first();
    if (!webhook) {
      throw new WebhookNotFoundError(
        `Webhook 不存在: server=${serverId}, id=${id}`,
      );
    }

    const body = {
      event_type: req.event_type,
      payload: req.payload ?? {},
      timestamp: nowIso(),
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (webhook.secret) {
      headers['X-Webhook-Secret'] = webhook.secret;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          delivered: false,
          status_code: res.status,
          error: res.statusText,
        };
      }
      return { delivered: true, status_code: res.status, error: null };
    } catch (err) {
      return {
        delivered: false,
        status_code: null,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 自动触发 Webhook（S7-4 实现）
   *
   * 查询 serverId 下 enabled=true 且 event_types 包含 eventType 的全部 webhook，
   * 异步分发 HTTP POST 请求（3 次重试 + 指数退避 1s/2s/4s）。
   *
   * 行为约定：
   *   - 单个 webhook 投递失败仅 console.warn 记录，不阻断其他 webhook
   *   - 全部 webhook 投递失败时抛 WebhookDeliveryError
   *   - 无匹配 webhook 时直接返回（不视为错误）
   *
   * @param serverId 目标服务器 ID
   * @param eventType 事件类型（如 'order.claimed' / 'vote.threshold_met' 等）
   * @param payload 事件负载
   */
  async triggerWebhook(
    serverId: string,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    // 查询该服务器所有启用的 webhook
    const rows = await this.db<WebhookRow>('webhooks')
      .where({ server_id: serverId, enabled: true });

    // 过滤 event_types 包含 eventType 的 webhook
    const matched = rows.filter((row) => {
      try {
        const types: unknown = JSON.parse(row.event_types);
        if (Array.isArray(types)) {
          return types.map((t) => String(t)).includes(eventType);
        }
      } catch {
        // event_types 解析失败 → 不匹配
      }
      return false;
    });

    if (matched.length === 0) {
      // 无匹配 webhook，不视为错误
      return;
    }

    const body = {
      event_type: eventType,
      payload: payload ?? {},
      timestamp: nowIso(),
    };

    // 并发分发所有匹配的 webhook，单个失败不阻断其他
    const results = await Promise.all(
      matched.map(async (webhook) => {
        const ok = await this.deliverWithRetry(webhook, body);
        return { webhook, ok };
      }),
    );

    const failed = results.filter((r) => !r.ok);
    if (failed.length === matched.length) {
      // 全部失败 → 抛 WebhookDeliveryError
      throw new WebhookDeliveryError(
        `全部 webhook 投递失败: server=${serverId}, event=${eventType}, ` +
          `failed=${failed.map((f) => `#${f.webhook.id}`).join(',')}`,
      );
    }
    // 部分失败 → 仅记录日志
    for (const f of failed) {
      console.warn(
        `[webhook] 投递失败 server=${serverId} event=${eventType} ` +
          `webhook=#${f.webhook.id} url=${f.webhook.url}`,
      );
    }
  }

  /**
   * C8: 事件覆盖度审计——检查关键事件是否均有 webhook 触发点。
   *
   * 审计范围：eventBus 中定义的 7 个关键事件：
   *   - chat.event / player.join / player.leave
   *   - order.claimed / cdk.redeemed
   *   - vote.started / vote.threshold_met
   *
   * 审计逻辑：
   *   - 查询指定 server（或全部 server）下 enabled=true 的 webhook
   *   - 收集所有 webhook 的 event_types 并集
   *   - 对每个关键事件判断是否有覆盖（至少一个 webhook 订阅了该事件）
   *
   * @param serverId 可选，指定实例 ID；未指定则审计全部实例
   * @returns 事件覆盖度报告（covered / uncovered / total / coverage_ratio）
   */
  async auditEventCoverage(serverId?: string): Promise<{
    covered: string[];
    uncovered: string[];
    total: number;
    coverage_ratio: number;
  }> {
    // 关键事件清单（与 eventBus.ts 定义对齐）
    const criticalEvents = [
      'chat.event',
      'player.join',
      'player.leave',
      'order.claimed',
      'cdk.redeemed',
      'vote.started',
      'vote.threshold_met',
    ];

    // 查询启用的 webhook
    const query = this.db<WebhookRow>('webhooks').where({ enabled: true });
    if (serverId) {
      void query.where({ server_id: serverId });
    }
    const rows = await query;

    // 收集所有 webhook 的 event_types 并集
    const subscribedEvents = new Set<string>();
    for (const row of rows) {
      try {
        const types: unknown = JSON.parse(row.event_types);
        if (Array.isArray(types)) {
          for (const t of types) {
            subscribedEvents.add(String(t));
          }
        }
      } catch {
        // event_types 解析失败，跳过该 webhook
      }
    }

    // 审计覆盖度
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const evt of criticalEvents) {
      if (subscribedEvents.has(evt)) {
        covered.push(evt);
      } else {
        uncovered.push(evt);
      }
    }

    const total = criticalEvents.length;
    const coverageRatio = total > 0 ? covered.length / total : 0;

    return {
      covered,
      uncovered,
      total,
      coverage_ratio: coverageRatio,
    };
  }

  /**
   * 带重试的 webhook 投递（私有）
   *
   * 重试策略：最多 3 次，指数退避 1s / 2s / 4s。
   * 任一次成功即返回 true；全部失败返回 false。
   *
   * 参考 triggerTest 的 fetch + AbortController 实现，超时 10s。
   */
  private async deliverWithRetry(
    webhook: WebhookRow,
    body: { event_type: string; payload: unknown; timestamp: string },
  ): Promise<boolean> {
    const maxRetries = 3;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (webhook.secret) {
      headers['X-Webhook-Secret'] = webhook.secret;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.ok) {
          return true;
        }
        // 非 2xx → 本次失败，继续重试
      } catch {
        // 网络错误 / 超时 → 本次失败，继续重试
      } finally {
        clearTimeout(timer);
      }

      // 最后一次不再等待
      if (attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    return false;
  }
}

// ----- 纯函数 / 转换函数 -----

function toWebhookSummary(row: WebhookRow): WebhookSummary {
  let eventTypes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.event_types);
    if (Array.isArray(parsed)) {
      eventTypes = parsed.map((x) => String(x));
    }
  } catch {
    eventTypes = [];
  }
  return {
    id: row.id,
    server_id: row.server_id,
    url: row.url,
    event_types: eventTypes,
    secret: row.secret,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ----- 工厂 -----

export function createWebhookService(db: Knex): WebhookServiceImpl {
  return new WebhookServiceImpl(db);
}
