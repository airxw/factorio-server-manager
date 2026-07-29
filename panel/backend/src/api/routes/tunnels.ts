// ============================================================================
// v4.4.0-O1: FRP 隧道管理路由
//
// 端点：
//   GET  /api/system/tunnel/status  — 查询隧道运行状态
//   GET  /api/system/tunnel/config  — 获取当前配置
//   PUT  /api/system/tunnel/config  — 更新配置（不自动重启）
//   POST /api/system/tunnel/start   — 启动 frpc 隧道
//   POST /api/system/tunnel/stop    — 停止 frpc 隧道
//   GET  /api/system/tunnel/logs    — 获取最近日志
//
// 鉴权：authenticateToken + requireAdmin（仅 server_admin 可操作）
// ============================================================================

import { Router } from 'express';
import type { Logger } from 'pino';
import type { TunnelService, TunnelConfig } from '../../services/tunnelService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/** GET /api/system/tunnel/status 响应 */
interface GetTunnelStatusResponse {
  status: import('../../services/tunnelService.js').TunnelStatus;
}

/** GET /api/system/tunnel/config 响应 */
interface GetTunnelConfigResponse {
  config: TunnelConfig;
}

/** PUT /api/system/tunnel/config 请求 */
interface UpdateTunnelConfigRequest {
  config: TunnelConfig;
}

/** PUT /api/system/tunnel/config 响应 */
interface UpdateTunnelConfigResponse {
  message: string;
}

/** POST /api/system/tunnel/start 响应 */
interface TunnelActionResponse {
  success: boolean;
  message: string;
}

/** GET /api/system/tunnel/logs 响应 */
interface GetTunnelLogsResponse {
  logs: import('../../services/tunnelService.js').TunnelLogEntry[];
}

/**
 * 创建隧道管理路由
 *
 * @param tunnelService TunnelService 实例
 * @param logger        日志记录器
 */
export function createTunnelsRouter(tunnelService: TunnelService, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/system/tunnel/status — 查询隧道运行状态
  // ----------------------------------------------------------------
  router.get('/status', (_req, res) => {
    try {
      const status = tunnelService.getStatus();
      const body: GetTunnelStatusResponse = { status };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/status: 查询状态失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_STATUS_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/system/tunnel/config — 获取当前配置
  // ----------------------------------------------------------------
  router.get('/config', (_req, res) => {
    try {
      const config = tunnelService.getConfig();
      const body: GetTunnelConfigResponse = { config };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/config: 获取配置失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_CONFIG_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/system/tunnel/config — 更新配置（不自动重启）
  // ----------------------------------------------------------------
  router.put('/config', (req, res) => {
    try {
      const { config } = req.body as UpdateTunnelConfigRequest;

      if (!config || typeof config !== 'object') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'config 必填且为对象' },
        };
        res.status(400).json(body);
        return;
      }
      if (typeof config.server_addr !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'config.server_addr 必填且为字符串' },
        };
        res.status(400).json(body);
        return;
      }
      if (typeof config.server_port !== 'number' || config.server_port < 1 || config.server_port > 65535) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'config.server_port 必填且为 1-65535' },
        };
        res.status(400).json(body);
        return;
      }
      if (!Array.isArray(config.tunnels)) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'config.tunnels 必填且为数组' },
        };
        res.status(400).json(body);
        return;
      }
      if (typeof config.enabled !== 'boolean') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'config.enabled 必填且为布尔值' },
        };
        res.status(400).json(body);
        return;
      }

      tunnelService.updateConfig(config);
      const body: UpdateTunnelConfigResponse = {
        message: '配置已更新（需手动 restart 生效）',
      };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/config: 更新配置失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_CONFIG_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/tunnel/start — 启动 frpc 隧道
  // ----------------------------------------------------------------
  router.post('/start', async (_req, res) => {
    try {
      const result = await tunnelService.start();
      const body: TunnelActionResponse = result;
      res.status(result.success ? 200 : 502).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/start: 启动失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_START_FAILED', message },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/tunnel/stop — 停止 frpc 隧道
  // ----------------------------------------------------------------
  router.post('/stop', async (_req, res) => {
    try {
      const result = await tunnelService.stop();
      const body: TunnelActionResponse = result;
      res.status(result.success ? 200 : 502).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/stop: 停止失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_STOP_FAILED', message },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/system/tunnel/logs — 获取最近日志
  // ----------------------------------------------------------------
  router.get('/logs', (req, res) => {
    try {
      const limitParam =
        typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
      const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 1000)) : 100;
      const logs = tunnelService.getLogs(limit);
      const body: GetTunnelLogsResponse = { logs };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'tunnel/logs: 获取日志失败');
      const body: PanelErrorResponse = {
        error: { code: 'TUNNEL_LOGS_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  return router;
}
