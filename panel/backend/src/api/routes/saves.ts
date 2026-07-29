// ============================================================================
// 模块7_Panel业务API — 存档记录路由（P4）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.saveService（SaveServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/saves             → list
//   POST   /:serverId/saves             → create
//   POST   /:serverId/saves/:id/activate → activate
//   DELETE /:serverId/saves/:id         → delete
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import path from 'node:path';
import type { SaveServiceImpl } from '../../services/saveService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import type {
  ListSavesResponse,
  CreateSaveRequest,
  CreateSaveResponse,
  ActivateSaveResponse,
  DeleteSaveResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * D9: 路径穿越防护——对文件名参数做规范化检查。
 * 使用 path.basename() 提取文件名，拒绝包含 `..` 或路径分隔符的输入。
 */
function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new ValidationError('文件名不能为空');
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new ValidationError(`文件名包含非法字符: ${filename}`);
  }
  const basename = path.basename(filename);
  if (basename !== filename) {
    throw new ValidationError(`文件名包含路径分隔符: ${filename}`);
  }
  return basename;
}

/**
 * D9: 路径穿越防护——对文件路径参数做检查。
 * 完整路径允许 `/` 但拒绝 `..` 路径穿越片段。
 */
function sanitizeFilePath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new ValidationError('文件路径不能为空');
  }
  if (filePath.includes('..') || filePath.includes('\0')) {
    throw new ValidationError(`文件路径包含非法字符: ${filePath}`);
  }
  return filePath;
}

/**
 * 创建 Saves 路由
 * 依赖通过 req.app.locals 注入：saveService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createSavesRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/saves — 列出存档记录
  // ----------------------------------------------------------------
  router.get('/:serverId/saves', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.saveService as SaveServiceImpl;
      const saves = await service.list(req.params.serverId);
      const response: ListSavesResponse = { saves };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/saves — 创建存档记录
  // ----------------------------------------------------------------
  router.post('/:serverId/saves', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.saveService as SaveServiceImpl;
      const body = req.body as Partial<CreateSaveRequest>;
      if (typeof body.save_name !== 'string' || body.save_name.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 save_name',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.file_path !== 'string' || body.file_path.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 file_path',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const sizeBytes = body.size_bytes;
      if (
        sizeBytes === undefined ||
        !Number.isInteger(sizeBytes) ||
        sizeBytes < 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: 'size_bytes 需为非负整数',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        typeof body.modified_at !== 'string' ||
        body.modified_at.length === 0
      ) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 modified_at',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const save = await service.create(req.params.serverId, {
        // D9: 路径穿越防护——save_name 作为文件名校验，file_path 作为完整路径校验
        save_name: sanitizeFilename(body.save_name),
        file_path: sanitizeFilePath(body.file_path),
        size_bytes: sizeBytes,
        modified_at: body.modified_at,
        is_active: body.is_active,
      });
      const response: CreateSaveResponse = { save };
      res.status(201).json(response);
    } catch (err) {
      handleSaveError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/saves/:id/activate — 激活存档
  // ----------------------------------------------------------------
  router.post('/:serverId/saves/:id/activate', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.saveService as SaveServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const save = await service.activate(req.params.serverId, id);
      const response: ActivateSaveResponse = { save };
      res.json(response);
    } catch (err) {
      handleSaveError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/saves/:id — 删除存档记录
  // ----------------------------------------------------------------
  router.delete('/:serverId/saves/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.saveService as SaveServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `id 必须为数字: ${req.params.id}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      await service.delete(req.params.serverId, id);
      const response: DeleteSaveResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleSaveError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  SAVE_NOT_FOUND: 404,
  SAVE_ALREADY_EXISTS: 409,
};

function handleSaveError(res: Response, err: unknown): void {
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
