// ============================================================================
// 模块7_Panel业务API — Webhook 路由（P5）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.webhookService（WebhookServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/webhooks          → list
//   POST   /:serverId/webhooks          → create
//   PATCH  /:serverId/webhooks/:id      → update（部分更新）
//   DELETE /:serverId/webhooks/:id      → remove
//   POST   /:serverId/webhooks/:id/test → triggerTest（即时投递，不持久化）
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { WebhookServiceImpl } from '../../services/webhookService.js';
import { AppError } from '../../services/errors.js';
import type {
  ListWebhooksResponse,
  CreateWebhookRequest,
  CreateWebhookResponse,
  UpdateWebhookRequest,
  UpdateWebhookResponse,
  DeleteWebhookResponse,
  TriggerWebhookTestRequest,
  TriggerWebhookTestResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 Webhooks 路由
 * 依赖通过 req.app.locals 注入：webhookService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createWebhooksRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/webhooks — 列出 Webhook
  // ----------------------------------------------------------------
  router.get('/:serverId/webhooks', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.webhookService as WebhookServiceImpl;
      const result = await service.list(req.params.serverId);
      const response: ListWebhooksResponse = { webhooks: result.webhooks };
      res.json(response);
    } catch (err) {
      handleWebhookError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/webhooks — 创建 Webhook
  // ----------------------------------------------------------------
  router.post('/:serverId/webhooks', requireAdmin, async (req, res) => {
    try {
      const body = req.body as Partial<CreateWebhookRequest>;
      if (typeof body.url !== 'string' || body.url.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 url',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const service = req.app.locals.webhookService as WebhookServiceImpl;
      const result = await service.create(req.params.serverId, {
        url: body.url,
        event_types: body.event_types,
        secret: body.secret,
        enabled: body.enabled,
      });
      const response: CreateWebhookResponse = { webhook: result.webhook };
      res.status(201).json(response);
    } catch (err) {
      handleWebhookError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:serverId/webhooks/:id — 更新 Webhook
  // ----------------------------------------------------------------
  router.patch('/:serverId/webhooks/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const body = req.body as Partial<UpdateWebhookRequest>;
      const service = req.app.locals.webhookService as WebhookServiceImpl;
      const result = await service.update(req.params.serverId, id, {
        url: body.url,
        event_types: body.event_types,
        secret: body.secret,
        enabled: body.enabled,
      });
      const response: UpdateWebhookResponse = { webhook: result.webhook };
      res.json(response);
    } catch (err) {
      handleWebhookError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/webhooks/:id — 删除 Webhook
  // ----------------------------------------------------------------
  router.delete('/:serverId/webhooks/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const service = req.app.locals.webhookService as WebhookServiceImpl;
      const result = await service.remove(req.params.serverId, id);
      const response: DeleteWebhookResponse = { deleted: result.deleted };
      res.json(response);
    } catch (err) {
      handleWebhookError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/webhooks/:id/test — 触发测试投递
  // ----------------------------------------------------------------
  router.post('/:serverId/webhooks/:id/test', requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const body = req.body as Partial<TriggerWebhookTestRequest>;
      if (
        typeof body.event_type !== 'string' ||
        body.event_type.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 event_type',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const service = req.app.locals.webhookService as WebhookServiceImpl;
      const result = await service.triggerTest(req.params.serverId, id, {
        event_type: body.event_type,
        payload: body.payload,
      });
      const response: TriggerWebhookTestResponse = result;
      res.json(response);
    } catch (err) {
      handleWebhookError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  WEBHOOK_NOT_FOUND: 404,
  WEBHOOK_DELIVERY_FAILED: 502,
};

function handleWebhookError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  handleInternal(res, err);
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
