// ============================================================================
// operations.ts — 运营仪表盘路由（v4.6.0）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireRole）
// 挂载前缀：/api/operations
//
// 端点（需 instance_admin+ 权限，由 index.ts 挂载时 requireRole 控制）：
//   GET /instance-admin/overview              — 跨实例总览
//   GET /instance-admin/revenue?days=30       — 收入曲线（默认 30 天，范围 1-90）
//   GET /instance-admin/players?days=30       — 玩家活跃度曲线
//   GET /instance-admin/instances-compare     — 实例对比表
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { OperationsService } from '../../services/operationsService.js';
import type {
  InstanceAdminOverviewResponse,
  OperationsInstancesCompareResponse,
  OperationsPlayersResponse,
  OperationsRevenueResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建运营仪表盘路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createOperationsRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const operationsService = new OperationsService(db);

  // ----------------------------------------------------------------
  // GET /instance-admin/overview — 跨实例总览
  // ----------------------------------------------------------------
  router.get('/instance-admin/overview', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const overview: InstanceAdminOverviewResponse = await operationsService.getOverview(userId);
      res.json(overview);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /instance-admin/revenue?days=30 — 收入曲线
  // ----------------------------------------------------------------
  router.get('/instance-admin/revenue', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const days = parseDaysParam(req.query.days);
      const response: OperationsRevenueResponse = await operationsService.getRevenue(userId, days);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /instance-admin/players?days=30 — 玩家活跃度曲线
  // ----------------------------------------------------------------
  router.get('/instance-admin/players', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const days = parseDaysParam(req.query.days);
      const response: OperationsPlayersResponse = await operationsService.getPlayers(userId, days);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /instance-admin/instances-compare — 实例对比表
  // ----------------------------------------------------------------
  router.get('/instance-admin/instances-compare', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const response: OperationsInstancesCompareResponse = await operationsService.getInstancesCompare(userId);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 解析 days 查询参数：默认 30，范围 1-90 */
function parseDaysParam(raw: unknown): number {
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.min(n, 90));
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(Math.floor(raw), 90));
  }
  return 30;
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'operations router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
