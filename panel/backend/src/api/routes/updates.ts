// ============================================================================
// Factorio 集成扩展 Task 11.4 — 游戏更新路由
// 路由内部按端点套权限中间件（11.7：检查用 requireInstanceAccess / 应用用 requireInstanceAdmin）
// 对应服务：app.locals.updateService（UpdateServiceImpl）
//
// 注意：tasks.md 原始端点为 /api/packs/:packId/update/*，但 checkUpdate/applyUpdate
// 服务方法接收 serverId（需通过实例定位 node_id 执行 current_version_command）。
// P0 简化：路由端点改为 /api/servers/:serverId/update/*，与服务签名对齐。
//
// 挂载前缀：/api/servers（index.ts 仅套 authenticateToken）
//   GET    /:serverId/update/check   → checkUpdate
//   POST   /:serverId/update/apply   → applyUpdate
// ============================================================================

import { Router, type Response } from 'express';
import type { UpdateServiceImpl } from '../../services/updateService.js';
import { AppError } from '../../services/errors.js';
import { requireInstanceAccess } from '../../middleware/auth.js';
import type {
  CheckUpdateResponse,
  ApplyUpdateResponse,
  UpdateProgressResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 Updates 路由
 * 依赖通过 req.app.locals 注入：updateService
 */
export function createUpdatesRouter(): Router {
  const router = Router();

  // GET /api/servers/:serverId/update/check — 检查游戏更新
  router.get('/:serverId/update/check', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.updateService as UpdateServiceImpl;
      const result = await service.checkUpdate(req.params.serverId);
      const response: CheckUpdateResponse = {
        pack_id: req.params.serverId, // P0: 用 serverId 占位（服务返回 UpdateCheckResult 无 pack_id 字段）
        current_version: result.current_version,
        latest_version: result.latest_version,
        update_available: result.update_available,
      };
      res.json(response);
    } catch (err) {
      handleUpdateError(res, err);
    }
  });

  // POST /api/servers/:serverId/update/apply — 应用游戏更新（v3.5.0: 接受 version_id 或 download_path）
  router.post('/:serverId/update/apply', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.updateService as UpdateServiceImpl;
      const versionId = req.body?.version_id;
      const downloadPath = req.body?.download_path;

      if (typeof versionId === 'string' && versionId.length > 0) {
        // v3.5.0: 从版本池选版本应用
        const { installed_version } = await service.applyVersionFromPool(req.params.serverId, versionId);
        const response: ApplyUpdateResponse = {
          server_id: req.params.serverId,
          applied: true,
          installed_version,
        };
        res.json(response);
        return;
      }

      if (typeof downloadPath === 'string' && downloadPath.length > 0) {
        // 旧路径：手动填 download_path（保留兼容）
        await service.applyUpdate(req.params.serverId, downloadPath);
        const response: ApplyUpdateResponse = {
          server_id: req.params.serverId,
          applied: true,
          installed_version: null,
        };
        res.json(response);
        return;
      }

      const errBody: PanelErrorResponse = {
        error: { code: 'PANEL_VALIDATION_ERROR', message: '请求体必须包含 version_id 或 download_path' },
      };
      res.status(400).json(errBody);
    } catch (err) {
      handleUpdateError(res, err);
    }
  });

  // POST /api/servers/:serverId/update/download — 一键自动下载并安装游戏更新
  // v3.5.0: 已下线，返回 410 Gone + 引导用户前往版本管理页面
  router.post('/:serverId/update/download', requireInstanceAccess(), (_req, res) => {
    res.status(410).json({
      error: {
        code: 'UPDATE_DOWNLOAD_REMOVED',
        message: '一键下载并安装入口已下线（v3.5.0）。请前往「版本管理」页面下载版本，再在本页面选择版本应用。',
      },
    });
  });

  // GET /api/servers/:serverId/update/progress — 查询更新进度
  router.get('/:serverId/update/progress', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.updateService as UpdateServiceImpl;
      const progress = service.getProgress(req.params.serverId);
      const response: UpdateProgressResponse = {
        server_id: progress.server_id,
        phase: progress.phase,
        progress_percent: progress.progress_percent,
        message: progress.message,
        error: progress.error,
        download_path: progress.download_path,
        latest_version: progress.latest_version,
        started_at: progress.started_at,
        finished_at: progress.finished_at,
      };
      res.json(response);
    } catch (err) {
      handleUpdateError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  UPDATE_CHECK_FAILED: 502,
  UPDATE_APPLY_FAILED: 500,
  PACK_CAPABILITY_NOT_DECLARED: 404,
  INSTANCE_NOT_FOUND: 404,
};

function handleUpdateError(res: Response, err: unknown): void {
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
