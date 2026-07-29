// ============================================================================
// files.ts — 文件管理路由（v4.3.0-F1~F5）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.fileService（FileServiceImpl）
//          app.locals.taskService（TaskServiceImpl）
//
// 挂载前缀：/api/servers
//   --- F1: 目录列表 ---
//   GET  /:serverId/files                      → listFiles
//   --- F2: 文件内容读写 ---
//   GET  /:serverId/files/content              → readFileContent
//   PUT  /:serverId/files/content              → writeFileContent
//   --- F3: 分片上传 ---
//   POST /:serverId/files/upload/init          → initUpload
//   POST /:serverId/files/upload/chunk         → uploadChunk
//   POST /:serverId/files/upload/finish        → finishUpload
//   --- F4: 异步下载 ---
//   POST /:serverId/files/download             → submitDownloadTask
//   --- F5: 压缩/解压 ---
//   POST /:serverId/files/compress             → submitCompressTask
//   POST /:serverId/files/decompress           → submitDecompressTask
//   --- 任务状态查询（通用）---
//   GET  /:serverId/tasks/:taskId              → getTaskStatus
//   POST /:serverId/tasks/:taskId/cancel       → cancelTask
// ============================================================================

import { Router, type Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import type { FileServiceImpl } from '../../services/fileService.js';
import type { TaskServiceImpl } from '../../services/taskService.js';
import { AppError, ValidationError } from '../../services/errors.js';
import type {
  ListFilesResponse,
  ReadFileContentResponse,
  WriteFileContentRequest,
  WriteFileContentResponse,
  UploadInitResponse,
  UploadChunkRequest,
  UploadChunkResponse,
  UploadFinishRequest,
  UploadFinishResponse,
  DownloadFileRequest,
  DownloadFileResponse,
  CompressFileRequest,
  CompressFileResponse,
  DecompressFileRequest,
  DecompressFileResponse,
  GetTaskStatusResponse,
  CancelTaskResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

export function createFilesRouter(): Router {
  const router = Router();

  // ===== F1: GET /:serverId/files — 目录列表 =====
  router.get('/:serverId/files', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      const recursive = req.query.recursive === '1' || req.query.recursive === 'true';
      const result = await fileService.listFiles(req.params.serverId, relPath, recursive);
      const response: ListFilesResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F2: GET /:serverId/files/content — 读文件内容 =====
  router.get('/:serverId/files/content', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!relPath) {
        throw new ValidationError('query parameter "path" is required');
      }
      const result = await fileService.readFileContent(req.params.serverId, relPath);
      const response: ReadFileContentResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F2: PUT /:serverId/files/content — 写文件内容 =====
  router.put('/:serverId/files/content', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!relPath) {
        throw new ValidationError('query parameter "path" is required');
      }
      const body = req.body as Partial<WriteFileContentRequest>;
      if (typeof body.content !== 'string') {
        throw new ValidationError('body.content must be a string');
      }
      const result = await fileService.writeFileContent(req.params.serverId, relPath, body.content);
      const response: WriteFileContentResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F3: POST /:serverId/files/upload/init — 初始化上传 =====
  router.post('/:serverId/files/upload/init', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const result = fileService.initUpload(req.params.serverId);
      const response: UploadInitResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F3: POST /:serverId/files/upload/chunk — 上传分片 =====
  router.post('/:serverId/files/upload/chunk', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const body = req.body as Partial<UploadChunkRequest>;
      if (typeof body.upload_id !== 'string' || !/^[a-fA-F0-9]{32}$/.test(body.upload_id)) {
        throw new ValidationError('upload_id 必须为 32 位 hex');
      }
      const index = body.index;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        throw new ValidationError('index 必须为非负整数');
      }
      if (typeof body.content !== 'string') {
        throw new ValidationError('content 必须为 base64 字符串');
      }
      const result = fileService.uploadChunk(body.upload_id, index, body.content);
      const response: UploadChunkResponse = {
        upload_id: body.upload_id,
        index,
        received: result.received,
      };
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F3: POST /:serverId/files/upload/finish — 完成上传 =====
  router.post('/:serverId/files/upload/finish', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const body = req.body as Partial<UploadFinishRequest>;
      if (typeof body.upload_id !== 'string' || !/^[a-fA-F0-9]{32}$/.test(body.upload_id)) {
        throw new ValidationError('upload_id 必须为 32 位 hex');
      }
      if (typeof body.target_path !== 'string' || body.target_path.length === 0) {
        throw new ValidationError('target_path 必填');
      }
      const result = await fileService.finishUpload(body.upload_id, body.target_path);
      const response: UploadFinishResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F4: POST /:serverId/files/download — 提交异步下载 =====
  router.post('/:serverId/files/download', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const body = req.body as Partial<DownloadFileRequest>;
      if (typeof body.url !== 'string' || !/^https?:\/\//.test(body.url)) {
        throw new ValidationError('url 必须为 http(s):// 开头');
      }
      if (typeof body.target_path !== 'string' || body.target_path.length === 0) {
        throw new ValidationError('target_path 必填');
      }
      const result = fileService.submitDownloadTask(req.params.serverId, body.url, body.target_path, body.sha256);
      const response: DownloadFileResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F5: POST /:serverId/files/compress — 提交异步压缩 =====
  router.post('/:serverId/files/compress', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const body = req.body as Partial<CompressFileRequest>;
      if (typeof body.source_path !== 'string' || body.source_path.length === 0) {
        throw new ValidationError('source_path 必填');
      }
      if (typeof body.target_path !== 'string' || body.target_path.length === 0) {
        throw new ValidationError('target_path 必填');
      }
      if (!body.target_path.endsWith('.zip') && !body.target_path.endsWith('.tar.gz')) {
        throw new ValidationError('target_path 必须以 .zip 或 .tar.gz 结尾');
      }
      const result = fileService.submitCompressTask(req.params.serverId, body.source_path, body.target_path, body.format);
      const response: CompressFileResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== F5: POST /:serverId/files/decompress — 提交异步解压 =====
  router.post('/:serverId/files/decompress', requireAdmin, async (req, res) => {
    try {
      const fileService = req.app.locals.fileService as FileServiceImpl;
      const body = req.body as Partial<DecompressFileRequest>;
      if (typeof body.source_path !== 'string' || body.source_path.length === 0) {
        throw new ValidationError('source_path 必填');
      }
      if (typeof body.target_path !== 'string' || body.target_path.length === 0) {
        throw new ValidationError('target_path 必填');
      }
      const result = fileService.submitDecompressTask(req.params.serverId, body.source_path, body.target_path);
      const response: DecompressFileResponse = result;
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== 通用任务查询：GET /:serverId/tasks/:taskId =====
  router.get('/:serverId/tasks/:taskId', requireAdmin, async (req, res) => {
    try {
      const taskService = req.app.locals.taskService as TaskServiceImpl;
      const state = taskService.getTaskStatus(req.params.taskId);
      if (!state) {
        const body: PanelErrorResponse = {
          error: { code: 'TASK_NOT_FOUND', message: `任务不存在或已过期: ${req.params.taskId}` },
        };
        res.status(404).json(body);
        return;
      }
      const response: GetTaskStatusResponse = {
        task: {
          id: state.id,
          type: state.type,
          status: state.status,
          progress: state.progress,
          result: state.result as Record<string, unknown> | null,
          error_message: state.error_message,
          created_at: state.created_at,
          updated_at: state.updated_at,
          expires_at: state.expires_at,
        },
      };
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  // ===== 通用任务取消：POST /:serverId/tasks/:taskId/cancel =====
  router.post('/:serverId/tasks/:taskId/cancel', requireAdmin, async (req, res) => {
    try {
      const taskService = req.app.locals.taskService as TaskServiceImpl;
      const canceled = taskService.cancelTask(req.params.taskId);
      const response: CancelTaskResponse = {
        task_id: req.params.taskId,
        canceled,
      };
      res.json(response);
    } catch (err) {
      handleFileError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助：错误处理
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  FILE_PATH_INVALID: 400,
  FILE_NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  FILE_BINARY_NOT_EDITABLE: 400,
  FILE_UPLOAD_ID_INVALID: 404,
  FILE_UPLOAD_EXPIRED: 410,
  FILE_UPLOAD_CHUNK_INVALID: 400,
  TASK_NOT_FOUND: 404,
  TASK_CONCURRENT_LIMIT: 429,
  SERVER_NOT_FOUND: 404,
  PANEL_VALIDATION_ERROR: 400,
};

function handleFileError(res: Response, err: unknown): void {
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
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
