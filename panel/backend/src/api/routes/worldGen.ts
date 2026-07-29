// ============================================================================
// Factorio 集成扩展 Task 11.2 — 地图生成路由
// 路由内部按端点套权限中间件（11.7：读 requireInstanceAccess / 写 requireInstanceAdmin）
// 对应服务：app.locals.worldGenService（WorldGenServiceImpl）
//
// 挂载前缀：/api/servers（index.ts 仅套 authenticateToken）
//   POST   /:serverId/world/regenerate              → regenerateMap
//   GET    /:serverId/world/map-settings             → getMapSettingsSchema（返回所有 settings_files schema）
//   PUT    /:serverId/world/map-settings/:settingsName → updateMapSettings
// ============================================================================

import { Router, type Response } from 'express';
import type { WorldGenServiceImpl } from '../../services/worldGenService.js';
import { AppError } from '../../services/errors.js';
import { requireInstanceAccess, requireInstanceAdmin } from '../../middleware/auth.js';
import type {
  RegenerateMapResponse,
  GetMapSettingsSchemaResponse,
  UpdateMapSettingsRequest,
  UpdateMapSettingsResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建 WorldGen 路由
 * 依赖通过 req.app.locals 注入：worldGenService
 */
export function createWorldGenRouter(): Router {
  const router = Router();

  // POST /api/servers/:serverId/world/regenerate — 重新生成地图
  router.post('/:serverId/world/regenerate', requireInstanceAdmin(), async (req, res) => {
    try {
      const service = req.app.locals.worldGenService as WorldGenServiceImpl;
      const saveName = req.body?.save_name;
      if (typeof saveName !== 'string' || saveName.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 save_name' },
        };
        res.status(400).json(errBody);
        return;
      }
      await service.regenerateMap(req.params.serverId, saveName);
      const response: RegenerateMapResponse = {
        server_id: req.params.serverId,
        regenerated: true,
      };
      res.json(response);
    } catch (err) {
      handleWorldGenError(res, err);
    }
  });

  // GET /api/servers/:serverId/world/map-settings — 获取地图设置 schema 列表
  router.get('/:serverId/world/map-settings', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.worldGenService as WorldGenServiceImpl;
      const settingsFiles = await service.getMapSettingsSchema(req.params.serverId);
      const response: GetMapSettingsSchemaResponse = {
        settings_files: settingsFiles.map((f) => ({
          name: f.name,
          path: f.path,
          format: f.format,
        })),
      };
      res.json(response);
    } catch (err) {
      handleWorldGenError(res, err);
    }
  });

  // PUT /api/servers/:serverId/world/map-settings/:settingsName — 更新地图设置文件
  router.put(
    '/:serverId/world/map-settings/:settingsName',
    requireInstanceAdmin(),
    async (req, res) => {
      try {
        const service = req.app.locals.worldGenService as WorldGenServiceImpl;
        const body = req.body as Partial<UpdateMapSettingsRequest>;
        if (body.data === undefined) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 data 字段' },
          };
          res.status(400).json(errBody);
          return;
        }
        await service.updateMapSettings(
          req.params.serverId,
          req.params.settingsName,
          body.data,
        );
        const response: UpdateMapSettingsResponse = {
          settings_name: req.params.settingsName,
          written: true,
        };
        res.json(response);
      } catch (err) {
        handleWorldGenError(res, err);
      }
    },
  );

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  WORLD_GEN_FAILED: 500,
  PACK_CAPABILITY_NOT_DECLARED: 404,
  INSTANCE_NOT_FOUND: 404,
  PACK_NOT_FOUND: 404,
};

function handleWorldGenError(res: Response, err: unknown): void {
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
