// ============================================================================
// systemMetricsRoute.ts — 模块1_系统监控：系统指标与健康状态路由
//
// 挂载前缀：/api/system（由 index.ts 装配时挂载）
//   GET /api/system/metrics  → getSystemMetrics（requireAdmin）
//   GET /api/system/health   → getSystemHealth（requireAdmin）
//
// 鉴权：authenticateToken 在 index.ts 挂载时统一套用；
//      requireAdmin 在路由内部生效（仅 server_admin 可查看系统指标与健康状态）。
//      与 模块2 systemDiagnosticRoute.ts 既有模式一致——
//      router 工厂无参，不内置 authenticateToken（secret 由 index.ts 持有）。
//
// 服务注入：req.app.locals.systemMetricsService（由 index.ts 装配时挂载）
// 错误处理：参考 monitor.ts 模式，AppError → HTTP 状态映射；其余 → 500
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../panel/backend/src/middleware/auth.js';
import { AppError, SystemMetricsServiceImpl } from './systemMetricsService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/**
 * 创建 SystemMetrics 路由。
 *
 * 依赖通过 req.app.locals.systemMetricsService 注入。
 * 鉴权（authenticateToken）由 index.ts 挂载时套用；
 * requireAdmin 在路由内部对 metrics/health 生效（仅 server_admin 可访问）。
 */
export function createSystemMetricsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/system/metrics — 系统资源指标快照（CPU/内存/磁盘/负载/运行时间）
  // 鉴权：仅 server_admin（系统指标含敏感运行时信息，限制 admin 访问）
  // ----------------------------------------------------------------
  router.get('/metrics', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.systemMetricsService as SystemMetricsServiceImpl;
      const metrics = await service.getSystemMetrics();
      res.json(metrics);
    } catch (err) {
      handleSystemMetricsError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/system/health — 服务健康状态（backend/database/daemon 聚合）
  // 鉴权：仅 server_admin（健康状态含内部服务拓扑，限制 admin 访问）
  // ----------------------------------------------------------------
  router.get('/health', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.systemMetricsService as SystemMetricsServiceImpl;
      const health = await service.getSystemHealth();
      res.json(health);
    } catch (err) {
      handleSystemMetricsError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 错误码 → HTTP 状态码映射（与 error-codes-schema.json 对齐） */
const ERROR_CODE_TO_STATUS: Record<string, number> = {
  SYSTEM_METRICS_001: 500,
};

/**
 * 错误处理：AppError 按错误码映射状态码；其余视为内部错误 500。
 * 与 monitor.ts 的 handleMonitorError 模式一致。
 */
function handleSystemMetricsError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 500;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
