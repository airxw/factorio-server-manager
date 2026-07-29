// ============================================================================
// 模块7_Panel业务API — 监控快照路由（P4）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.monitorService（MonitorServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/monitor/snapshots   → list（query: from/to/limit）
//   POST   /:serverId/monitor/snapshots   → create
//   GET    /:serverId/monitor/latest      → getLatest
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { MonitorServiceImpl } from '../../services/monitorService.js';
import { AppError } from '../../services/errors.js';
import type {
  ListMonitorSnapshotsResponse,
  CreateMonitorSnapshotRequest,
  CreateMonitorSnapshotResponse,
  GetLatestSnapshotResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 Monitor 路由
 * 依赖通过 req.app.locals 注入：monitorService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createMonitorRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/monitor/snapshots — 列出监控快照
  // ----------------------------------------------------------------
  router.get('/:serverId/monitor/snapshots', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.monitorService as MonitorServiceImpl;
      const from =
        typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      let limit: number | undefined;
      if (typeof req.query.limit === 'string') {
        const parsed = Number(req.query.limit);
        if (Number.isFinite(parsed)) limit = parsed;
      } else if (typeof req.query.limit === 'number') {
        limit = req.query.limit;
      }
      const result = await service.list(req.params.serverId, {
        from,
        to,
        limit,
      });
      const response: ListMonitorSnapshotsResponse = {
        snapshots: result.snapshots,
      };
      res.json(response);
    } catch (err) {
      handleMonitorError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/monitor/snapshots — 创建监控快照
  // ----------------------------------------------------------------
  router.post('/:serverId/monitor/snapshots', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.monitorService as MonitorServiceImpl;
      const body = req.body as Partial<CreateMonitorSnapshotRequest>;
      const result = await service.create(req.params.serverId, {
        cpu_percent: body.cpu_percent,
        memory_mb: body.memory_mb,
        tick_rate: body.tick_rate,
        player_count: body.player_count,
        json_extra: body.json_extra,
      });
      const response: CreateMonitorSnapshotResponse = {
        snapshot: result.snapshot,
      };
      res.status(201).json(response);
    } catch (err) {
      handleMonitorError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/monitor/latest — 获取最新快照
  // ----------------------------------------------------------------
  router.get('/:serverId/monitor/latest', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.monitorService as MonitorServiceImpl;
      const result = await service.getLatest(req.params.serverId);
      const response: GetLatestSnapshotResponse = {
        snapshot: result.snapshot,
      };
      res.json(response);
    } catch (err) {
      handleMonitorError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/monitoring?limit=50 — 查询历史监控快照
  // 从 monitor_snapshots 表读取（按 timestamp 倒序，默认50条）
  // 复用 MonitorServiceImpl.list，与 /monitor/snapshots 同源
  // ----------------------------------------------------------------
  router.get('/:serverId/monitoring', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.monitorService as MonitorServiceImpl;
      let limit: number | undefined;
      if (typeof req.query.limit === 'string') {
        const parsed = Number(req.query.limit);
        if (Number.isFinite(parsed)) limit = parsed;
      } else if (typeof req.query.limit === 'number') {
        limit = req.query.limit;
      }
      const result = await service.list(req.params.serverId, { limit });
      const response: ListMonitorSnapshotsResponse = {
        snapshots: result.snapshots,
      };
      res.json(response);
    } catch (err) {
      handleMonitorError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  MONITOR_SNAPSHOT_CREATE_FAILED: 500,
  SNAPSHOT_NOT_FOUND: 404,
};

function handleMonitorError(res: Response, err: unknown): void {
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
