// ============================================================================
// 模块7_Panel业务API — 备份记录路由（P4）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.backupService（BackupServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/backups          → list
//   POST   /:serverId/backups          → create（created_by 取自 req.user.userId）
//   PATCH  /:serverId/backups/:id      → update（status + size_bytes?）
//   DELETE /:serverId/backups/:id      → delete
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { BackupServiceImpl } from '../../services/backupService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import type {
  ListBackupsResponse,
  CreateBackupRequest,
  CreateBackupResponse,
  UpdateBackupRequest,
  UpdateBackupResponse,
  DeleteBackupResponse,
  BackupStatus,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

const VALID_STATUSES: BackupStatus[] = [
  'in_progress',
  'completed',
  'failed',
  'deleted',
];

function isValidStatus(value: unknown): value is BackupStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
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
 * 创建 Backups 路由
 * 依赖通过 req.app.locals 注入：backupService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createBackupsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/backups — 列出备份记录
  // ----------------------------------------------------------------
  router.get('/:serverId/backups', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.backupService as BackupServiceImpl;
      const backups = await service.list(req.params.serverId);
      const response: ListBackupsResponse = { backups };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/backups — 创建备份记录
  // ----------------------------------------------------------------
  router.post('/:serverId/backups', requireAdmin, async (req, res) => {
    try {
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
      const service = req.app.locals.backupService as BackupServiceImpl;
      const body = req.body as Partial<CreateBackupRequest>;
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
      if (
        body.size_bytes !== undefined &&
        (!Number.isInteger(body.size_bytes) || body.size_bytes < 0)
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

      const backup = await service.create(req.params.serverId, userId, {
        // D9: 路径穿越防护——file_path 作为完整路径校验，拒绝 .. 路径穿越
        file_path: sanitizeFilePath(body.file_path),
        size_bytes: body.size_bytes,
      });
      const response: CreateBackupResponse = { backup };
      res.status(201).json(response);
    } catch (err) {
      handleBackupError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:serverId/backups/:id — 更新备份状态
  // ----------------------------------------------------------------
  router.patch('/:serverId/backups/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.backupService as BackupServiceImpl;
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
      const body = req.body as Partial<UpdateBackupRequest>;
      if (!isValidStatus(body.status)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `status 无效: ${String(body.status)}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.size_bytes !== undefined &&
        (!Number.isInteger(body.size_bytes) || body.size_bytes < 0)
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

      const backup = await service.update(req.params.serverId, id, {
        status: body.status,
        size_bytes: body.size_bytes,
      });
      const response: UpdateBackupResponse = { backup };
      res.json(response);
    } catch (err) {
      handleBackupError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/backups/:id — 删除备份记录
  // ----------------------------------------------------------------
  router.delete('/:serverId/backups/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.backupService as BackupServiceImpl;
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
      const response: DeleteBackupResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleBackupError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  BACKUP_NOT_FOUND: 404,
};

function handleBackupError(res: Response, err: unknown): void {
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
