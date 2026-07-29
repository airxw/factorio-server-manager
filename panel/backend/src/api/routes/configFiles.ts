// ============================================================================
// Factorio 集成扩展 Task 11.1 — 配置文件路由
// 路由内部按端点套权限中间件（11.7：读 requireInstanceAccess / 写 requireInstanceAdmin）
// 对应服务：app.locals.configFileService（ConfigFileServiceImpl）
//
// 挂载前缀：/api/servers（index.ts 仅套 authenticateToken）
//   GET    /:serverId/config-files           → listConfigFiles
//   GET    /:serverId/config-files/:name      → readConfigFile
//   PUT    /:serverId/config-files/:name      → writeConfigFile
//   GET    /:serverId/config-files/:name/schema → getConfigFileSchema
// ============================================================================

import { Router, type Response } from 'express';
import path from 'node:path';
import type { ConfigFileServiceImpl } from '../../services/configFileService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import { requireInstanceAccess, requireInstanceAdmin } from '../../middleware/auth.js';
import type {
  ListConfigFilesResponse,
  ReadConfigFileResponse,
  WriteConfigFileRequest,
  WriteConfigFileResponse,
  GetConfigFileSchemaResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * D9: 路径穿越防护——对文件名参数做规范化检查。
 * 使用 path.basename() 提取文件名，拒绝包含 `..` 或路径分隔符的输入。
 * @returns 规范化后的纯文件名
 * @throws AppError(PANEL_VALIDATION_ERROR) 当输入包含 `..` 或路径分隔符
 */
function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new ValidationError('文件名不能为空');
  }
  // 拒绝包含路径穿越片段的输入
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new ValidationError(`文件名包含非法字符: ${filename}`);
  }
  // 提取 basename 作为二次防护（即使绕过了上面的检查，也只取文件名部分）
  const basename = path.basename(filename);
  if (basename !== filename) {
    throw new ValidationError(`文件名包含路径分隔符: ${filename}`);
  }
  return basename;
}

/**
 * 创建 ConfigFiles 路由
 * 依赖通过 req.app.locals 注入：configFileService
 * 读操作：instance_admin + owner / 有 active 绑定的 user 可访问
 * 写操作：instance_admin + owner / server_admin
 */
export function createConfigFilesRouter(): Router {
  const router = Router();

  // GET /api/servers/:serverId/config-files — 列出配置文件元信息
  router.get('/:serverId/config-files', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.configFileService as ConfigFileServiceImpl;
      const configFiles = await service.listConfigFiles(req.params.serverId);
      const response: ListConfigFilesResponse = { config_files: configFiles };
      res.json(response);
    } catch (err) {
      handleConfigFileError(res, err);
    }
  });

  // GET /api/servers/:serverId/config-files/:name — 读取配置文件内容
  router.get('/:serverId/config-files/:name', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.configFileService as ConfigFileServiceImpl;
      // D9: 路径穿越防护——对 :name 参数做规范化检查
      const name = sanitizeFilename(req.params.name);
      const data = await service.readConfigFile(req.params.serverId, name);
      const response: ReadConfigFileResponse = { name, data };
      res.json(response);
    } catch (err) {
      handleConfigFileError(res, err);
    }
  });

  // PUT /api/servers/:serverId/config-files/:name — 写入配置文件
  router.put('/:serverId/config-files/:name', requireInstanceAdmin(), async (req, res) => {
    try {
      const service = req.app.locals.configFileService as ConfigFileServiceImpl;
      // D9: 路径穿越防护——对 :name 参数做规范化检查
      const name = sanitizeFilename(req.params.name);
      const body = req.body as Partial<WriteConfigFileRequest>;
      if (body.data === undefined) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 data 字段' },
        };
        res.status(400).json(errBody);
        return;
      }
      await service.writeConfigFile(req.params.serverId, name, body.data);
      const response: WriteConfigFileResponse = { name, written: true };
      res.json(response);
    } catch (err) {
      handleConfigFileError(res, err);
    }
  });

  // GET /api/servers/:serverId/config-files/:name/schema — 获取配置文件 schema
  router.get('/:serverId/config-files/:name/schema', requireInstanceAccess(), async (req, res) => {
    try {
      const service = req.app.locals.configFileService as ConfigFileServiceImpl;
      // D9: 路径穿越防护——对 :name 参数做规范化检查
      const name = sanitizeFilename(req.params.name);
      const schema = await service.getConfigFileSchema(req.params.serverId, name);
      const response: GetConfigFileSchemaResponse = { name, schema };
      res.json(response);
    } catch (err) {
      handleConfigFileError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  CONFIG_FILE_NOT_FOUND: 404,
  CONFIG_FILE_READ_ONLY: 403,
  PACK_CAPABILITY_NOT_DECLARED: 404,
};

function handleConfigFileError(res: Response, err: unknown): void {
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
