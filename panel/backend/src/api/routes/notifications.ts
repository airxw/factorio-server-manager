// ============================================================================
// 通知路由（v3.3.0）
// 挂载在 /api/notifications 下（在 index.ts 套 authenticateToken(JWT_SECRET)）
// - GET    /     — 列出当前用户通知 + 未读数
// - PATCH  /:id/read  — 标记单条已读
// - PATCH  /read-all  — 全部标记已读
// ============================================================================

import { Router, type Response } from 'express';
import type { NotificationServiceImpl, NotificationSummary } from '../../services/notificationService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

interface ListNotificationsResponse {
  notifications: NotificationSummary[];
  unread_count: number;
}

export function createNotificationsRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } });
        return;
      }
      const service = req.app.locals.notificationService as NotificationServiceImpl;
      const notifications = await service.listForUser(userId);
      const unreadCount = await service.countUnread(userId);
      const response: ListNotificationsResponse = { notifications, unread_count: unreadCount };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  router.patch('/:id/read', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } });
        return;
      }
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: { code: 'PANEL_VALIDATION_ERROR', message: 'id必须为数字' } });
        return;
      }
      const service = req.app.locals.notificationService as NotificationServiceImpl;
      await service.markAsRead(userId, id);
      res.json({ id, read: true });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  router.patch('/read-all', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } });
        return;
      }
      const service = req.app.locals.notificationService as NotificationServiceImpl;
      await service.markAllAsRead(userId);
      res.json({ read_all: true });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
