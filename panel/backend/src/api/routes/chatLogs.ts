// ============================================================================
// Factorio 集成扩展 Task 11.3 — 聊天日志路由
// 路由内部按端点套权限中间件（11.7：读 requireInstanceAccess）
// 对应服务：app.locals.chatLogService（ChatLogServiceImpl）
//
// 挂载前缀：/api/servers（index.ts 仅套 authenticateToken）
//   GET    /:serverId/chat-logs          → listLogs（支持 query 过滤 + 分页）
// ============================================================================

import { Router, type Response } from 'express';
import type { ChatLogServiceImpl, ChatLogFilters } from '../../services/chatLogService.js';
import { AppError } from '../../services/errors.js';
import { requireInstanceAccess } from '../../middleware/auth.js';
import type {
  ListChatLogsResponse,
  ListChatLogsQuery,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 ChatLogs 路由
 * 依赖通过 req.app.locals 注入：chatLogService
 */
export function createChatLogsRouter(): Router {
  const router = Router();

  // GET /api/servers/:serverId/chat-logs — 查询聊天日志
  router.get('/:serverId/chat-logs', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.chatLogService as ChatLogServiceImpl;
      const query = req.query as Partial<ListChatLogsQuery>;

      // 构造过滤器
      const filters: ChatLogFilters = {};
      if (typeof query.player_name === 'string' && query.player_name.length > 0) {
        filters.player_name = query.player_name;
      }
      if (typeof query.message_contains === 'string' && query.message_contains.length > 0) {
        filters.message_contains = query.message_contains;
      }
      if (typeof query.start_time === 'string') {
        filters.start_time = query.start_time;
      }
      if (typeof query.end_time === 'string') {
        filters.end_time = query.end_time;
      }
      if (query.limit !== undefined) {
        const n = Number(query.limit);
        if (!Number.isNaN(n) && n > 0) filters.limit = n;
      }
      if (query.offset !== undefined) {
        const n = Number(query.offset);
        if (!Number.isNaN(n) && n >= 0) filters.offset = n;
      }

      const result = await service.listLogs(req.params.serverId, filters);
      const response: ListChatLogsResponse = {
        logs: result.logs.map((l) => ({
          id: l.id,
          server_id: l.server_id,
          player_name: l.player_name,
          message: l.message,
          sent_at: l.sent_at,
        })),
        total: result.total,
      };
      res.json(response);
    } catch (err) {
      handleChatLogError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  PACK_CAPABILITY_NOT_DECLARED: 404,
  INSTANCE_NOT_FOUND: 404,
  CHAT_LOG_PARSE_FAILED: 500,
};

function handleChatLogError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? err.httpStatus ?? 400;
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
