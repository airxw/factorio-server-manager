// ============================================================================
// systemUpdateRoute.ts — 模块0_系统自更新：系统更新路由工厂
//
// 挂载前缀：/api/system-update（由 index.ts 装配时挂载）
//   GET  /api/system-update/build-info         → getBuildInfo
//   GET  /api/system-update/check-update       → checkSystemUpdate
//   POST /api/system-update/update             → performUpdate
//   GET  /api/system-update/update-status/:jobId → getUpdateStatus
//   POST /api/system-update/update/rollback    → rollbackUpdate
//
// 鉴权：authenticateToken + requireAdmin 在 index.ts 挂载时统一套用
//      （系统更新为高危操作，仅 server_admin 可触发）。
//      与 panel/backend/src/api/routes/systemConfig.ts 既有模式一致——
//      router 工厂无参，不内置鉴权中间件（secret 由 index.ts 持有）。
//
// 服务注入：req.app.locals.systemUpdateService（由 index.ts 装配时挂载）
// userId 来源：req.user.userId（JWT payload，由 authenticateToken 解析附加）
// 错误处理：AppError → 按错误码映射 HTTP 状态码；其余 → 500 PANEL_INTERNAL_ERROR
// ============================================================================

import { Router, type Request, type Response } from 'express';
import {
  AppError,
  SystemUpdateServiceImpl,
} from './systemUpdateService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/**
 * 创建 SystemUpdate 路由。
 *
 * 依赖通过 req.app.locals.systemUpdateService 注入。
 * 鉴权（authenticateToken + requireAdmin）由 index.ts 挂载时套用。
 */
export function createSystemUpdateRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /build-info — 当前构建信息（version / commit / gitBranch / gitCommit / buildTime）
  // ----------------------------------------------------------------
  router.get('/build-info', async (req, res) => {
    try {
      const service = getService(req);
      const info = await service.getBuildInfo();
      res.json(info);
    } catch (err) {
      handleSystemUpdateError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /check-update — 检查系统更新（hasUpdate / latestVersion / releaseNotes / downloadUrl / sha256）
  // ----------------------------------------------------------------
  router.get('/check-update', async (req, res) => {
    try {
      const service = getService(req);
      const info = await service.checkSystemUpdate();
      res.json(info);
    } catch (err) {
      handleSystemUpdateError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /update — 触发系统更新（异步执行，返回 jobId）
  // ----------------------------------------------------------------
  router.post('/update', async (req, res) => {
    try {
      const service = getService(req);
      const userId = extractUserId(req, res);
      if (userId === null) return;
      const result = await service.performUpdate(userId);
      res.json(result);
    } catch (err) {
      handleSystemUpdateError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /update-status/:jobId — 查询更新任务状态（轮询用）
  // ----------------------------------------------------------------
  router.get('/update-status/:jobId', async (req, res) => {
    try {
      const service = getService(req);
      const jobId = req.params.jobId;
      if (!jobId) {
        const body: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 jobId 路径参数',
          },
        };
        res.status(400).json(body);
        return;
      }
      const status = await service.getUpdateStatus(jobId);
      res.json(status);
    } catch (err) {
      handleSystemUpdateError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /update/rollback — 回滚到上一个版本
  // ----------------------------------------------------------------
  router.post('/update/rollback', async (req, res) => {
    try {
      const service = getService(req);
      const userId = extractUserId(req, res);
      if (userId === null) return;
      const result = await service.rollbackUpdate(userId);
      res.json(result);
    } catch (err) {
      handleSystemUpdateError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/**
 * 从 req.app.locals.systemUpdateService 取服务实例。
 * 服务未初始化时抛错（由外层 catch 转为 500）。
 */
function getService(req: Request): SystemUpdateServiceImpl {
  const service = req.app.locals.systemUpdateService as SystemUpdateServiceImpl | undefined;
  if (!service) {
    throw new Error('systemUpdateService 未初始化');
  }
  return service;
}

/**
 * 从 JWT payload (req.user) 提取 userId。
 * 未认证返回 null 并写入 401 响答。
 */
function extractUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    const body: PanelErrorResponse = {
      error: {
        code: 'PANEL_UNAUTHORIZED',
        message: '未认证',
      },
    };
    res.status(401).json(body);
    return null;
  }
  return userId;
}

/** 错误码 → HTTP 状态码映射（与 error-codes-schema.json 对齐） */
const ERROR_CODE_TO_STATUS: Record<string, number> = {
  SYSTEM_UPDATE_001: 502,
  SYSTEM_UPDATE_002: 500,
  SYSTEM_UPDATE_003: 500,
  SYSTEM_JOB_NOT_FOUND: 404,
};

/**
 * 错误处理：AppError 按错误码映射状态码；其余视为内部错误 500。
 * 与模块1 systemMetricsRoute 的 handleSystemMetricsError 模式一致。
 */
function handleSystemUpdateError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? err.httpStatus ?? 500;
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
