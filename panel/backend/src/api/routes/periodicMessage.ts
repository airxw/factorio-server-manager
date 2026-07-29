// ============================================================================
// 模块7_Panel业务API — 定时消息路由（P3）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.periodicMessageService（PeriodicMessageServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/periodic-messages        → list
//   POST   /:serverId/periodic-messages        → create
//   PATCH  /:serverId/periodic-messages/:id    → update
//   DELETE /:serverId/periodic-messages/:id    → delete
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { PeriodicMessageServiceImpl } from '../../services/periodicMessageService.js';
import { AppError } from '../../services/errors.js';
import type {
  ListPeriodicMessagesResponse,
  CreatePeriodicMessageRequest,
  CreatePeriodicMessageResponse,
  UpdatePeriodicMessageRequest,
  UpdatePeriodicMessageResponse,
  DeletePeriodicMessageResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 PeriodicMessage 路由
 * 依赖通过 req.app.locals 注入：periodicMessageService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createPeriodicMessageRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/periodic-messages — 列出定时消息
  // ----------------------------------------------------------------
  router.get('/:serverId/periodic-messages', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals
        .periodicMessageService as PeriodicMessageServiceImpl;
      const messages = await service.list(req.params.serverId);
      const response: ListPeriodicMessagesResponse = { messages };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/periodic-messages — 创建定时消息
  // ----------------------------------------------------------------
  router.post('/:serverId/periodic-messages', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals
        .periodicMessageService as PeriodicMessageServiceImpl;
      const body = req.body as Partial<CreatePeriodicMessageRequest>;
      if (typeof body.message !== 'string' || body.message.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 message',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        typeof body.interval_minutes !== 'number' ||
        !Number.isInteger(body.interval_minutes) ||
        body.interval_minutes <= 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'interval_minutes 需为正整数',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const message = await service.create(req.params.serverId, {
        message: body.message,
        interval_minutes: body.interval_minutes,
        enabled: body.enabled,
      });
      const response: CreatePeriodicMessageResponse = { message };
      res.status(201).json(response);
    } catch (err) {
      handlePeriodicError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:serverId/periodic-messages/:id — 更新定时消息
  // ----------------------------------------------------------------
  router.patch('/:serverId/periodic-messages/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals
        .periodicMessageService as PeriodicMessageServiceImpl;
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
      const body = req.body as Partial<UpdatePeriodicMessageRequest>;
      const patch: UpdatePeriodicMessageRequest = {};
      if (body.message !== undefined) patch.message = body.message;
      if (body.interval_minutes !== undefined) {
        if (
          !Number.isInteger(body.interval_minutes) ||
          body.interval_minutes <= 0
        ) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: 'interval_minutes 需为正整数',
            },
          };
          res.status(400).json(errBody);
          return;
        }
        patch.interval_minutes = body.interval_minutes;
      }
      if (body.enabled !== undefined) patch.enabled = body.enabled;

      const message = await service.update(req.params.serverId, id, patch);
      const response: UpdatePeriodicMessageResponse = { message };
      res.json(response);
    } catch (err) {
      handlePeriodicError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/periodic-messages/:id — 删除定时消息
  // ----------------------------------------------------------------
  router.delete('/:serverId/periodic-messages/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals
        .periodicMessageService as PeriodicMessageServiceImpl;
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

      await service.delete(req.params.serverId, id);
      const response: DeletePeriodicMessageResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handlePeriodicError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  PERIODIC_MESSAGE_NOT_FOUND: 404,
};

function handlePeriodicError(res: Response, err: unknown): void {
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
