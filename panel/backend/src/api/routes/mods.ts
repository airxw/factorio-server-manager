// ============================================================================
// 模块7_Panel业务API — Mod 记录路由（P4）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.modService（ModServiceImpl）
//
// 挂载前缀：/api/servers
//   GET    /:serverId/mods          → list
//   POST   /:serverId/mods          → create
//   PATCH  /:serverId/mods/:id      → update（仅 enabled / source_url）
//   DELETE /:serverId/mods/:id      → delete
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import path from 'node:path';
import type { ModServiceImpl, ModMetadata } from '../../services/modService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import type {
  ListModsResponse,
  CreateModRequest,
  CreateModResponse,
  UpdateModRequest,
  UpdateModResponse,
  DeleteModResponse,
  ListModFilesResponse,
  ToggleModFileResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * D9: 路径穿越防护——对文件名参数做规范化检查。
 * 使用 path.basename() 提取文件名，拒绝包含 `..` 或路径分隔符的输入。
 * mod_name 可能被用作文件名（如 mod-list.json 中的条目），需防止路径穿越。
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
 * 创建 Mods 路由
 * 依赖通过 req.app.locals 注入：modService
 * 所有端点仅 admin 可访问（由 index.ts 挂载时套 requireAdmin）
 */
export function createModsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/mods — 列出 Mod 记录
  // ----------------------------------------------------------------
  router.get('/:serverId/mods', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
      const mods = await service.list(req.params.serverId);
      const response: ListModsResponse = { mods };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/mods — 创建 Mod 记录
  // ----------------------------------------------------------------
  router.post('/:serverId/mods', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
      const body = req.body as Partial<CreateModRequest>;
      if (typeof body.mod_name !== 'string' || body.mod_name.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 mod_name',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.version !== 'string' || body.version.length === 0) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '缺少 version',
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const mod = await service.create(req.params.serverId, {
        // D9: 路径穿越防护——mod_name 可能被用作文件名，做规范化检查
        mod_name: sanitizeFilename(body.mod_name),
        version: body.version,
        enabled: body.enabled,
        source_url: body.source_url,
      });
      const response: CreateModResponse = { mod };
      res.status(201).json(response);
    } catch (err) {
      handleModError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:serverId/mods/:id — 更新 Mod（仅 enabled / source_url）
  // ----------------------------------------------------------------
  router.patch('/:serverId/mods/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
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
      const body = req.body as Partial<UpdateModRequest>;
      const patch: UpdateModRequest = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.source_url !== undefined) patch.source_url = body.source_url;

      const mod = await service.update(req.params.serverId, id, patch);
      const response: UpdateModResponse = { mod };
      res.json(response);
    } catch (err) {
      handleModError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.3.0-H1: GET /api/servers/:serverId/mods/files — 列出 mods/ 目录下的 mod 文件
  // ----------------------------------------------------------------
  router.get('/:serverId/mods/files', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
      const mods = await service.listModFiles(req.params.serverId);
      const response: ListModFilesResponse = { mods };
      res.json(response);
    } catch (err) {
      handleModError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.3.0-H1: POST /api/servers/:serverId/mods/files/:name/toggle — 切换 mod 文件启停
  // ----------------------------------------------------------------
  router.post('/:serverId/mods/files/:name/toggle', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
      const modName = req.params.name;
      // 路径穿越防护：modName 必须是纯文件名
      sanitizeFilename(modName);
      const result = await service.toggleModFile(req.params.serverId, modName);
      const response: ToggleModFileResponse = result;
      res.json(response);
    } catch (err) {
      handleModError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // L4: GET /api/servers/:serverId/mods/scan — 扫描 mods 目录 jar 元数据
  // 透传到 Daemon GET /api/instances/:id/mods/scan，返回每个 jar 的
  // name/version/loader/environment/isClientSide，用于识别客户端 mod。
  // ----------------------------------------------------------------
  router.get('/:serverId/mods/scan', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
      const mods: ModMetadata[] = await service.scanMods(req.params.serverId);
      res.json({ mods });
    } catch (err) {
      handleModError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/mods/:id — 删除 Mod 记录
  // ----------------------------------------------------------------
  router.delete('/:serverId/mods/:id', requireAdmin, async (req, res) => {
    try {
      const service = req.app.locals.modService as ModServiceImpl;
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
      const response: DeleteModResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleModError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  MOD_NOT_FOUND: 404,
  MOD_ALREADY_EXISTS: 409,
  // v4.3.0-H1: 文件系统级 mod 操作错误码
  MOD_FILE_NOT_FOUND: 404,
  MOD_FILE_STATE_INVALID: 400,
  FILE_PATH_INVALID: 400,
};

function handleModError(res: Response, err: unknown): void {
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
