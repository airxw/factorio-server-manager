// ============================================================================
// batch.ts — 批量操作路由（v4.7.0 I1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 挂载前缀：/api/batch
//
// 端点（仅 server_admin 可访问，由 index.ts 挂载时 requireAdmin 控制）：
//   POST /start    — 批量启动实例
//   POST /stop     — 批量停止实例
//   POST /restart  — 批量重启实例（stop + start 序列）
//   POST /backup   — 批量备份实例
//   POST /update   — 批量更新实例（需 version_id）
//
// 设计要点：
// - 批量上限 50 个实例（超限返回 400 BATCH_LIMIT_EXCEEDED）
// - 每个实例独立 try-catch，返回 BatchActionResult[] 聚合结果
// - start/restart 需要 registry.get(pack_id) 取 pack，daemonClient.startInstance 执行启动
// - stop 仅需 daemonClient.stopInstance
// - backup 通过 req.app.locals.backupService.createBackup(serverId, userId) 调用
// - update 通过 req.app.locals.updateService.applyVersionFromPool(serverId, versionId) 调用
// - restart 用 stop + start 序列实现（daemon 无通用 restart，只有 restartWithSave）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { PackRegistry } from '../../core/packs/registry.js';
import type { DaemonHttpClient } from '../../daemonClient/client.js';
import { DaemonApiError } from '../../daemonClient/types.js';
import type { BackupServiceImpl } from '../../services/backupService.js';
import type { UpdateServiceImpl } from '../../services/updateService.js';
import type {
  BatchActionRequest,
  BatchActionResult,
  BatchActionResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/** 批量操作单次上限 */
const BATCH_LIMIT = 50;

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface ServerRow {
  id: string;
  name: string;
  pack_id: string;
  status: string;
  port: number;
  rcon_port: number;
  rcon_password_enc: string | null;
  updated_at: string;
}

/**
 * 创建批量操作路由
 *
 * @param db Knex 实例
 * @param registry Pack 注册表（start/restart 需要取 pack）
 * @param daemonClient Daemon HTTP 客户端（start/stop/restart 转发）
 * @param logger 日志器
 */
export function createBatchRouter(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonHttpClient,
  logger: Logger,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /start — 批量启动实例
  // ----------------------------------------------------------------
  router.post('/start', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<BatchActionRequest>;
      const instanceIds = parseInstanceIds(body);
      if (instanceIds === null) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'instance_ids 必须为非空字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (instanceIds.length > BATCH_LIMIT) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'BATCH_LIMIT_EXCEEDED',
            message: `批量操作上限 ${BATCH_LIMIT} 个实例，当前 ${instanceIds.length} 个`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const results: BatchActionResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          const row = await db<ServerRow>('servers').where('id', instanceId).first();
          if (!row) {
            results.push({ instance_id: instanceId, success: false, message: '实例不存在' });
            continue;
          }
          if (row.status !== 'stopped') {
            results.push({
              instance_id: instanceId,
              success: false,
              message: `仅 stopped 状态可启动，当前状态: ${row.status}`,
            });
            continue;
          }
          const pack = registry.get(row.pack_id);
          if (!pack) {
            results.push({
              instance_id: instanceId,
              success: false,
              message: `Pack 不存在: ${row.pack_id}`,
            });
            continue;
          }

          // 更新状态为 starting
          await db<ServerRow>('servers').where('id', instanceId).update({
            status: 'starting',
            updated_at: new Date().toISOString(),
          });

          const rconPassword = row.rcon_password_enc
            ? Buffer.from(row.rcon_password_enc, 'base64').toString()
            : '';
          const instancesDir = process.env.INSTANCES_DIR ?? './instances';
          const workdir = `${instancesDir}/${instanceId}`;

          try {
            const startResp = await daemonClient.startInstance(instanceId, {
              pack,
              instance: {
                name: row.name,
                port: row.port,
                rcon_port: row.rcon_port,
                rcon_password: rconPassword,
                workdir,
              },
            });

            // 同步 Daemon 返回的状态到 DB
            await db<ServerRow>('servers').where('id', instanceId).update({
              status: startResp.status,
              updated_at: new Date().toISOString(),
            });

            results.push({ instance_id: instanceId, success: true });
          } catch (err) {
            // 启动失败：回滚状态为 stopped
            await db<ServerRow>('servers').where('id', instanceId).update({
              status: 'stopped',
              updated_at: new Date().toISOString(),
            });
            const message = err instanceof Error ? err.message : String(err);
            results.push({ instance_id: instanceId, success: false, message });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ instance_id: instanceId, success: false, message });
        }
      }

      const response: BatchActionResponse = { results };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /stop — 批量停止实例
  // ----------------------------------------------------------------
  router.post('/stop', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<BatchActionRequest>;
      const instanceIds = parseInstanceIds(body);
      if (instanceIds === null) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'instance_ids 必须为非空字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (instanceIds.length > BATCH_LIMIT) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'BATCH_LIMIT_EXCEEDED',
            message: `批量操作上限 ${BATCH_LIMIT} 个实例，当前 ${instanceIds.length} 个`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const results: BatchActionResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          const row = await db<ServerRow>('servers').where('id', instanceId).first();
          if (!row) {
            results.push({ instance_id: instanceId, success: false, message: '实例不存在' });
            continue;
          }
          if (row.status !== 'running' && row.status !== 'starting') {
            results.push({
              instance_id: instanceId,
              success: false,
              message: `仅 running/starting 状态可停止，当前状态: ${row.status}`,
            });
            continue;
          }

          // 更新状态为 stopping
          await db<ServerRow>('servers').where('id', instanceId).update({
            status: 'stopping',
            updated_at: new Date().toISOString(),
          });

          await daemonClient.stopInstance(instanceId);
          results.push({ instance_id: instanceId, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ instance_id: instanceId, success: false, message });
        }
      }

      const response: BatchActionResponse = { results };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /restart — 批量重启实例（stop + start 序列）
  // ----------------------------------------------------------------
  router.post('/restart', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<BatchActionRequest>;
      const instanceIds = parseInstanceIds(body);
      if (instanceIds === null) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'instance_ids 必须为非空字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (instanceIds.length > BATCH_LIMIT) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'BATCH_LIMIT_EXCEEDED',
            message: `批量操作上限 ${BATCH_LIMIT} 个实例，当前 ${instanceIds.length} 个`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const results: BatchActionResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          const row = await db<ServerRow>('servers').where('id', instanceId).first();
          if (!row) {
            results.push({ instance_id: instanceId, success: false, message: '实例不存在' });
            continue;
          }
          // 仅 running/starting 可重启（先 stop 再 start）
          if (row.status !== 'running' && row.status !== 'starting') {
            results.push({
              instance_id: instanceId,
              success: false,
              message: `仅 running/starting 状态可重启，当前状态: ${row.status}`,
            });
            continue;
          }
          const pack = registry.get(row.pack_id);
          if (!pack) {
            results.push({
              instance_id: instanceId,
              success: false,
              message: `Pack 不存在: ${row.pack_id}`,
            });
            continue;
          }

          // 1. stop
          await db<ServerRow>('servers').where('id', instanceId).update({
            status: 'stopping',
            updated_at: new Date().toISOString(),
          });
          try {
            await daemonClient.stopInstance(instanceId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({
              instance_id: instanceId,
              success: false,
              message: `stop 阶段失败: ${message}`,
            });
            continue;
          }

          // 2. 等待状态变为 stopped（DB 同步由 WS 事件触发；此处直接改为 stopped 后启动）
          await db<ServerRow>('servers').where('id', instanceId).update({
            status: 'stopped',
            updated_at: new Date().toISOString(),
          });

          // 3. start
          await db<ServerRow>('servers').where('id', instanceId).update({
            status: 'starting',
            updated_at: new Date().toISOString(),
          });

          const rconPassword = row.rcon_password_enc
            ? Buffer.from(row.rcon_password_enc, 'base64').toString()
            : '';
          const instancesDir = process.env.INSTANCES_DIR ?? './instances';
          const workdir = `${instancesDir}/${instanceId}`;

          try {
            const startResp = await daemonClient.startInstance(instanceId, {
              pack,
              instance: {
                name: row.name,
                port: row.port,
                rcon_port: row.rcon_port,
                rcon_password: rconPassword,
                workdir,
              },
            });

            await db<ServerRow>('servers').where('id', instanceId).update({
              status: startResp.status,
              updated_at: new Date().toISOString(),
            });

            results.push({ instance_id: instanceId, success: true });
          } catch (err) {
            // start 失败：回滚状态为 stopped
            await db<ServerRow>('servers').where('id', instanceId).update({
              status: 'stopped',
              updated_at: new Date().toISOString(),
            });
            const message = err instanceof Error ? err.message : String(err);
            results.push({
              instance_id: instanceId,
              success: false,
              message: `start 阶段失败: ${message}`,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ instance_id: instanceId, success: false, message });
        }
      }

      const response: BatchActionResponse = { results };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /backup — 批量备份实例
  // ----------------------------------------------------------------
  router.post('/backup', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<BatchActionRequest>;
      const instanceIds = parseInstanceIds(body);
      if (instanceIds === null) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'instance_ids 必须为非空字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (instanceIds.length > BATCH_LIMIT) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'BATCH_LIMIT_EXCEEDED',
            message: `批量操作上限 ${BATCH_LIMIT} 个实例，当前 ${instanceIds.length} 个`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      const backupService = req.app.locals.backupService as BackupServiceImpl | undefined;
      if (!backupService) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_SERVICE_UNAVAILABLE', message: '备份服务未初始化' },
        };
        res.status(503).json(errBody);
        return;
      }

      const results: BatchActionResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          // 校验实例存在
          const row = await db<{ id: string }>('servers').select('id').where('id', instanceId).first();
          if (!row) {
            results.push({ instance_id: instanceId, success: false, message: '实例不存在' });
            continue;
          }
          await backupService.createBackup(instanceId, userId);
          results.push({ instance_id: instanceId, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ instance_id: instanceId, success: false, message });
        }
      }

      const response: BatchActionResponse = { results };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /update — 批量更新实例（需 version_id）
  // ----------------------------------------------------------------
  router.post('/update', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<BatchActionRequest>;
      const instanceIds = parseInstanceIds(body);
      if (instanceIds === null) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'instance_ids 必须为非空字符串数组' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (instanceIds.length > BATCH_LIMIT) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'BATCH_LIMIT_EXCEEDED',
            message: `批量操作上限 ${BATCH_LIMIT} 个实例，当前 ${instanceIds.length} 个`,
          },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.version_id !== 'string' || body.version_id.trim().length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '批量更新必须指定 version_id' },
        };
        res.status(400).json(errBody);
        return;
      }

      const updateService = req.app.locals.updateService as UpdateServiceImpl | undefined;
      if (!updateService) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_SERVICE_UNAVAILABLE', message: '更新服务未初始化' },
        };
        res.status(503).json(errBody);
        return;
      }

      const results: BatchActionResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          // 校验实例存在
          const row = await db<{ id: string }>('servers').select('id').where('id', instanceId).first();
          if (!row) {
            results.push({ instance_id: instanceId, success: false, message: '实例不存在' });
            continue;
          }
          await updateService.applyVersionFromPool(instanceId, body.version_id);
          results.push({ instance_id: instanceId, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ instance_id: instanceId, success: false, message });
        }
      }

      const response: BatchActionResponse = { results };
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

/**
 * 解析 instance_ids 参数
 * @returns 字符串数组（去重）；输入非法时返回 null
 */
function parseInstanceIds(body: Partial<BatchActionRequest>): string[] | null {
  if (!Array.isArray(body.instance_ids) || body.instance_ids.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of body.instance_ids) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null;
    }
    const trimmed = id.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result.length > 0 ? result : null;
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  // Daemon 错误单独处理（透传状态码语义）
  if (err instanceof DaemonApiError) {
    logger.warn(
      { code: err.code, statusCode: err.statusCode, message: err.message },
      'batch router daemon api error',
    );
    if (err.code === 'DAEMON_UNREACHABLE' || err.statusCode === 0) {
      const body: PanelErrorResponse = {
        error: { code: 'DAEMON_UNREACHABLE', message: `Daemon 不可达: ${err.message}` },
      };
      res.status(503).json(body);
      return;
    }
    const body: PanelErrorResponse = {
      error: { code: 'DAEMON_UNREACHABLE', message: `Daemon 错误: ${err.message}` },
    };
    res.status(502).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'batch router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
