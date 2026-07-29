// ============================================================================
// 模块7_Panel业务API — Pack 物品同步路由（P1 管理员功能）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 对应服务：app.locals.itemSyncService（ItemSyncServiceImpl）
//
// 挂载路径：与 packs.ts 同前缀 /api/packs（Express 按挂载顺序匹配，不冲突）
//   POST /api/packs/:packId/item-sync        → 触发同步
//   GET  /api/packs/:packId/item-sync/logs   → 查询同步日志
//   GET  /api/packs/:packId/items            → 列出 Pack 物品
// ============================================================================

import { Router, type Response } from 'express';
import type { ItemSyncService } from '@public/interface_stub/item-sync-service';
import type { PackItem } from '@public/interface_stub/shared-types';
import { AppError } from '../../services/errors.js';
import type {
  ListItemSyncLogsResponse,
  ListPackItemsResponse,
  PackItemSummary,
  PanelErrorResponse,
  TriggerItemSyncResponse,
} from '@public/schema/panel-api-types';

function toPackItemSummary(item: PackItem): PackItemSummary {
  const summary: PackItemSummary = { name: item.name };
  if (item.display_name !== undefined) summary.display_name = item.display_name;
  if (item.category !== undefined) summary.category = item.category;
  return summary;
}

/**
 * 创建 ItemSync 路由
 * 依赖通过 req.app.locals 注入：itemSyncService
 */
export function createItemSyncRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /api/packs/:packId/item-sync — 触发 Pack 物品同步
  // ----------------------------------------------------------------
  router.post('/:packId/item-sync', async (req, res) => {
    try {
      const itemSyncService = req.app.locals.itemSyncService as ItemSyncService;
      const packId = req.params.packId;
      const result = await itemSyncService.syncFromGithub(packId);
      const response: TriggerItemSyncResponse = {
        pack_id: packId,
        success: result.success,
        items_count: result.itemsCount,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
      res.json(response);
    } catch (err) {
      // ItemSyncFailedError：同步失败但 API 调用成功，返回 200 + success=false
      if (err instanceof AppError && err.code === 'ITEM_SYNC_FAILED') {
        const response: TriggerItemSyncResponse = {
          pack_id: req.params.packId,
          success: false,
          items_count: 0,
          error: err.message,
        };
        res.json(response);
        return;
      }
      handleAppError(res, err, 'PACK_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/packs/:packId/item-sync/logs — 查询同步日志（limit 默认 50）
  // ----------------------------------------------------------------
  router.get('/:packId/item-sync/logs', async (req, res) => {
    try {
      const itemSyncService = req.app.locals.itemSyncService as ItemSyncService;
      const packId = req.params.packId;
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      const limit = Number.isNaN(limitRaw) || limitRaw <= 0 ? 50 : limitRaw;
      const logs = await itemSyncService.getSyncLog(packId, limit);
      const response: ListItemSyncLogsResponse = {
        logs: logs.map((l) => ({
          id: l.id,
          pack_id: l.pack_id,
          source_url: l.source_url,
          status: l.status,
          items_count: l.items_count,
          synced_at: l.synced_at,
          error_message: l.error_message,
          created_at: l.created_at,
        })),
      };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'PACK_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/packs/:packId/items — 列出 Pack 物品（缓存或静态）
  // ----------------------------------------------------------------
  router.get('/:packId/items', async (req, res) => {
    try {
      const itemSyncService = req.app.locals.itemSyncService as ItemSyncService;
      const packId = req.params.packId;
      const items = await itemSyncService.getCachedItems(packId);
      const response: ListPackItemsResponse = {
        pack_id: packId,
        items: items.map(toPackItemSummary),
      };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'PACK_NOT_FOUND', 404);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleAppError(
  res: Response,
  err: unknown,
  expectedCode: string,
  status: number,
): void {
  if (err instanceof AppError && err.code === expectedCode) {
    const body: PanelErrorResponse = {
      error: { code: expectedCode as PanelErrorResponse['error']['code'], message: err.message },
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
