// ============================================================================
// 模块7_Panel业务API — 聊天路由（P3）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.chatService（ChatServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/chat/settings           → getSettings
//   PUT    /:serverId/chat/settings           → upsertSettings
//   GET    /:serverId/chat/triggers           → listTriggers
//   POST   /:serverId/chat/triggers           → createTrigger
//   PATCH  /:serverId/chat/triggers/:id       → updateTrigger
//   DELETE /:serverId/chat/triggers/:id       → deleteTrigger
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { ChatServiceImpl } from '../../services/chatService.js';
import { AppError } from '../../services/errors.js';
import type {
  CreateChatTriggerRequest,
  CreateChatTriggerResponse,
  DeleteChatTriggerResponse,
  GetChatSettingsResponse,
  ListChatTriggersResponse,
  PanelErrorResponse,
  UpdateChatTriggerRequest,
  UpdateChatTriggerResponse,
  UpsertChatSettingsRequest,
  UpsertChatSettingsResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 Chat 路由
 * 依赖通过 req.app.locals 注入：chatService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createChatRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/chat/settings — 查询聊天设置
  // ----------------------------------------------------------------
  router.get('/:serverId/chat/settings', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const settings = await chatService.getSettings(req.params.serverId);
      const response: GetChatSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/servers/:serverId/chat/settings — upsert 聊天设置
  // ----------------------------------------------------------------
  router.put('/:serverId/chat/settings', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const body = req.body as Partial<UpsertChatSettingsRequest>;
      if (typeof body.enabled !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 enabled 布尔字段' },
        };
        res.status(400).json(errBody);
        return;
      }
      const settings = await chatService.upsertSettings(req.params.serverId, {
        enabled: body.enabled,
        settings: body.settings ?? {},
      });
      const response: UpsertChatSettingsResponse = { settings };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/chat/triggers — 列出触发响应
  // ----------------------------------------------------------------
  router.get('/:serverId/chat/triggers', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const triggers = await chatService.listTriggers(req.params.serverId);
      const response: ListChatTriggersResponse = { triggers };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/chat/triggers — 创建触发响应
  // ----------------------------------------------------------------
  router.post('/:serverId/chat/triggers', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const body = req.body as Partial<CreateChatTriggerRequest>;
      if (typeof body.trigger !== 'string' || body.trigger.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 trigger' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.response !== 'string' || body.response.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 response' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.priority !== undefined &&
        (!Number.isInteger(body.priority) || body.priority < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'priority 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      // Task 1 新增字段校验：mode / cooldown_seconds
      if (
        body.mode !== undefined &&
        body.mode !== 'prefix' &&
        body.mode !== 'exact' &&
        body.mode !== 'contains'
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `mode 无效: ${String(body.mode)}` },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.cooldown_seconds !== undefined &&
        (!Number.isInteger(body.cooldown_seconds) || body.cooldown_seconds < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'cooldown_seconds 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      const trigger = await chatService.createTrigger(req.params.serverId, {
        trigger: body.trigger,
        response: body.response,
        priority: body.priority,
        enabled: body.enabled,
        mode: body.mode,
        cooldown_seconds: body.cooldown_seconds,
      });
      const response: CreateChatTriggerResponse = { trigger };
      res.status(201).json(response);
    } catch (err) {
      handleChatError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:serverId/chat/triggers/:id — 更新触发响应
  // ----------------------------------------------------------------
  router.patch('/:serverId/chat/triggers/:id', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const body = req.body as Partial<UpdateChatTriggerRequest>;
      const patch: UpdateChatTriggerRequest = {};
      if (body.trigger !== undefined) patch.trigger = body.trigger;
      if (body.response !== undefined) patch.response = body.response;
      if (body.priority !== undefined) {
        if (!Number.isInteger(body.priority) || body.priority < 0) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'priority 需为非负整数' },
          };
          res.status(400).json(errBody);
          return;
        }
        patch.priority = body.priority;
      }
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      // Task 1 新增字段：mode / cooldown_seconds
      if (body.mode !== undefined) {
        if (
          body.mode !== 'prefix' &&
          body.mode !== 'exact' &&
          body.mode !== 'contains'
        ) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `mode 无效: ${String(body.mode)}` },
          };
          res.status(400).json(errBody);
          return;
        }
        patch.mode = body.mode;
      }
      if (body.cooldown_seconds !== undefined) {
        if (!Number.isInteger(body.cooldown_seconds) || body.cooldown_seconds < 0) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'cooldown_seconds 需为非负整数' },
          };
          res.status(400).json(errBody);
          return;
        }
        patch.cooldown_seconds = body.cooldown_seconds;
      }

      const trigger = await chatService.updateTrigger(req.params.serverId, id, patch);
      const response: UpdateChatTriggerResponse = { trigger };
      res.json(response);
    } catch (err) {
      handleChatError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/chat/triggers/:id — 删除触发响应
  // ----------------------------------------------------------------
  router.delete('/:serverId/chat/triggers/:id', requireAdmin, async (req, res) => {
    try {
      const chatService = req.app.locals.chatService as ChatServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      await chatService.deleteTrigger(req.params.serverId, id);
      const response: DeleteChatTriggerResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleChatError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  CHAT_TRIGGER_NOT_FOUND: 404,
  PANEL_FORBIDDEN: 403,
};

function handleChatError(res: Response, err: unknown): void {
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
