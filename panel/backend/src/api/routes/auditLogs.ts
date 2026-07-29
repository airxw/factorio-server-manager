// ============================================================================
// 模块7_Panel业务API — 审计日志路由（P5）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.auditLogService（AuditLogServiceImpl）
//
// 挂载前缀：/api/audit-logs
//   GET    /   → list（query: server_id/user_id/action/target_type/from/to/limit）
// ============================================================================

import { Router, type Response } from 'express';
import type { AuditLogServiceImpl } from '../../services/auditLogService.js';
import { AppError } from '../../services/errors.js';
import type {
  ListAuditLogsResponse,
  ListAuditLogsQuery,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 AuditLogs 路由
 * 依赖通过 req.app.locals 注入：auditLogService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createAuditLogsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/audit-logs — 列出审计日志
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const service = req.app.locals.auditLogService as AuditLogServiceImpl;
      const query: ListAuditLogsQuery = {};
      if (typeof req.query.server_id === 'string' && req.query.server_id) {
        query.server_id = req.query.server_id;
      }
      if (typeof req.query.user_id === 'string' && req.query.user_id) {
        query.user_id = req.query.user_id;
      }
      if (typeof req.query.action === 'string' && req.query.action) {
        query.action = req.query.action;
      }
      if (
        typeof req.query.target_type === 'string' &&
        req.query.target_type
      ) {
        query.target_type = req.query.target_type;
      }
      if (typeof req.query.from === 'string' && req.query.from) {
        query.from = req.query.from;
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        query.to = req.query.to;
      }
      if (typeof req.query.limit === 'string') {
        const parsed = Number(req.query.limit);
        if (Number.isFinite(parsed)) query.limit = parsed;
      } else if (typeof req.query.limit === 'number') {
        query.limit = req.query.limit;
      }
      const result = await service.list(query);
      const response: ListAuditLogsResponse = { logs: result.logs };
      res.json(response);
    } catch (err) {
      handleAuditLogError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {};

function handleAuditLogError(res: Response, err: unknown): void {
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
