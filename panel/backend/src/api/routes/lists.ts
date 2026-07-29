// ============================================================================
// 模块7_Panel业务API — 白名单/黑名单路由（P4）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.listService（ListServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/lists/:listType               → list
//   POST   /:serverId/lists/:listType               → create（added_by 取自 req.user.userId）
//   DELETE /:serverId/lists/:listType/:playerName   → remove
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { ListServiceImpl } from '../../services/listService.js';
import { AppError } from '../../services/errors.js';
import type {
  ListType,
  ListListEntriesResponse,
  CreateListEntryRequest,
  CreateListEntryResponse,
  DeleteListEntryResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

const VALID_LIST_TYPES: ListType[] = ['whitelist', 'banlist'];

function isValidListType(value: unknown): value is ListType {
  return (
    typeof value === 'string' &&
    (VALID_LIST_TYPES as readonly string[]).includes(value)
  );
}

function invalidListTypeBody(): PanelErrorResponse {
  return {
    error: {
      code: 'PANEL_VALIDATION_ERROR',
      message: 'listType 必须为 whitelist 或 banlist',
    },
  };
}

/**
 * 创建 Lists 路由
 * 依赖通过 req.app.locals 注入：listService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createListsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/lists/:listType — 列出条目
  // ----------------------------------------------------------------
  router.get('/:serverId/lists/:listType', requireAdmin, async (req, res) => {
    try {
      const listType = req.params.listType;
      if (!isValidListType(listType)) {
        res.status(400).json(invalidListTypeBody());
        return;
      }
      const service = req.app.locals.listService as ListServiceImpl;
      const result = await service.list(req.params.serverId, listType);
      const response: ListListEntriesResponse = { entries: result.entries };
      res.json(response);
    } catch (err) {
      handleListError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/lists/:listType — 创建条目
  // ----------------------------------------------------------------
  router.post('/:serverId/lists/:listType', requireAdmin, async (req, res) => {
    try {
      const listType = req.params.listType;
      if (!isValidListType(listType)) {
        res.status(400).json(invalidListTypeBody());
        return;
      }
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_UNAUTHORIZED',
            message: '未认证',
          },
        };
        res.status(401).json(errBody);
        return;
      }
      const body = req.body as Partial<CreateListEntryRequest>;
      if (
        typeof body.player_name !== 'string' ||
        body.player_name.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 player_name',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const service = req.app.locals.listService as ListServiceImpl;
      const result = await service.create(
        req.params.serverId,
        listType,
        {
          player_name: body.player_name,
          reason: body.reason,
        },
        userId,
      );
      const response: CreateListEntryResponse = { entry: result.entry };
      res.status(201).json(response);
    } catch (err) {
      handleListError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/lists/:listType/:playerName — 删除条目
  // ----------------------------------------------------------------
  router.delete('/:serverId/lists/:listType/:playerName', requireAdmin, async (req, res) => {
    try {
      const listType = req.params.listType;
      if (!isValidListType(listType)) {
        res.status(400).json(invalidListTypeBody());
        return;
      }
      const playerName = decodeURIComponent(req.params.playerName);
      const service = req.app.locals.listService as ListServiceImpl;
      const result = await service.remove(
        req.params.serverId,
        listType,
        playerName,
      );
      const response: DeleteListEntryResponse = {
        player_name: playerName,
        deleted: result.deleted,
      };
      res.json(response);
    } catch (err) {
      handleListError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  LIST_ENTRY_NOT_FOUND: 404,
  LIST_ENTRY_ALREADY_EXISTS: 409,
};

function handleListError(res: Response, err: unknown): void {
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
