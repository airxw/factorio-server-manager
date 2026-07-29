// ============================================================================
// 模块7_Panel业务API — /api/nodes 路由（L2 集群化管理扩展）
//
// 路由分组：
//   公开路由（createNodesPublicRouter，无 authenticateToken）：
//     POST /link              — slave 注册（linkKey 鉴权）
//     POST /verify-token      — slave 验证 user token（commsKey 鉴权）
//     POST /:id/heartbeat     — slave 心跳上报（commsKey 鉴权）
//
//   鉴权路由（createNodesRouter，挂在 authenticateToken 之后）：
//     GET  /                  — 节点列表（从 DB 读取，L2 扩展）
//     GET  /:id               — 节点详情
//     POST /                  — 创建邀请（requireAdmin）
//     DELETE /:id             — 删除节点（requireAdmin）
//     GET  /:id/disk-usage    — 节点磁盘占用（v3.6.1 原有）
//     GET  /:id/javas         — Java 扫描（v4.4.0-M1 原有）
// ============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type {
  NodeDiskUsage,
  NodeDiskUsageResponse,
  PanelErrorResponse,
  ListNodeClusterResponse,
  NodeDetailResponse,
  CreateNodeInviteRequest,
  CreateNodeInviteResponse,
  LinkSlaveRequest,
  LinkSlaveResponse,
  NodeHeartbeatRequest,
  NodeHeartbeatResponse,
  VerifyTokenRequest,
  VerifyTokenResponse,
  DeleteNodeResponse,
  NodeInstancesResponse,
  ServerSummary,
} from '@public/schema/panel-api-types';
import type { ScanJavasResult, InstanceState } from '@public/schema/daemon-api-types';
import { verifyToken } from '../../core/auth/jwt.js';
import { Role, normalizeRole } from '../../core/auth/roles.js';
import { requireRole } from '../../middleware/auth.js';
import type { NodeService } from '../../services/nodeService.js';
import { AppError } from '../../services/errors.js';

// ---------------------------------------------------------------------------
// 兼容类型：原有 NodeInfo（前端 servers.ts 仍引用，保留导出）
// ---------------------------------------------------------------------------

/** @deprecated L2 起改用 NodeClusterInfo，此类型仅向后兼容 */
export interface NodeInfo {
  id: string;
  name: string;
  status: 'online' | 'offline';
  daemon_url?: string;
}

/** @deprecated 兼容旧 ListNodesResponse */
export interface ListNodesResponse {
  nodes: NodeInfo[];
}

// ---------------------------------------------------------------------------
// commsKey 鉴权中间件（slave → master 调用时使用）
// ---------------------------------------------------------------------------

/**
 * 从请求头 x-comms-key 提取通信密钥并校验
 * 校验通过后将 node 信息挂到 req.context（res.locals.node）
 */
function requireCommsKey(nodeService: NodeService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const commsKey = req.headers['x-comms-key'] as string | undefined;
    if (!commsKey) {
      const body: PanelErrorResponse = {
        error: { code: 'NODE_COMMS_KEY_INVALID', message: '缺少 x-comms-key 头' },
      };
      res.status(401).json(body);
      return;
    }
    const node = await nodeService.verifyCommsKey(commsKey);
    if (!node) {
      const body: PanelErrorResponse = {
        error: { code: 'NODE_COMMS_KEY_INVALID', message: '通信密钥无效' },
      };
      res.status(401).json(body);
      return;
    }
    res.locals.node = node;
    next();
  };
}

// ---------------------------------------------------------------------------
// v4.28.0 节点归属校验中间件（instance_admin 仅可操作自有 self_hosted 节点）
// ---------------------------------------------------------------------------

/**
 * 节点归属校验中间件工厂
 *
 * 规则：
 *   - server_admin：全通过
 *   - instance_admin：仅可操作 self_hosted_owner_id === 自己 的 self_hosted 节点
 *     platform_managed 节点（平台节点）仅 server_admin 可操作 → 403
 *     他人 self_hosted 节点 → 403
 *
 * 用法：router.delete('/:id', requireRole(SERVER_ADMIN, INSTANCE_ADMIN), assertNodeOwnership(nodeService), handler)
 */
function assertNodeOwnership(nodeService: NodeService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nodeId = req.params.id;
      const rawRole = req.activeRole ?? req.user?.role ?? 'user';
      const role = normalizeRole(rawRole);
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      await nodeService.assertNodeOwnedByUser(nodeId, role, userId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// 公开路由（slave → master 通信，无 authenticateToken）
// ---------------------------------------------------------------------------

/**
 * 创建 Nodes 公开路由（slave 注册 / heartbeat / verify-token）
 * 这些端点不经过 authenticateToken，而是用 linkKey 或 commsKey 自鉴权。
 *
 * @param daemonClientService 可选，slave 注册成功后清该节点的 HTTP 客户端缓存
 */
export function createNodesPublicRouter(
  nodeService: NodeService,
  jwtSecret: string,
  logger: Logger,
  daemonClientService?: { invalidateClient: (nodeId: string) => void },
): Router {
  const router = Router();

  // GET /api/nodes/invite/:linkKey/bootstrap-script — 下载 slave-bootstrap.sh 部署脚本
  // 公开端点（slave 机器此时尚未注册，通过 linkKey 自鉴权）
  router.get('/invite/:linkKey/bootstrap-script', async (req: Request, res: Response) => {
    try {
      const linkKey = req.params.linkKey;
      const script = await nodeService.generateBootstrapScriptForLinkKey(linkKey);
      res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="slave-bootstrap.sh"');
      res.status(200).send(script);
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  // POST /api/nodes/link — slave 注册
  router.post('/link', async (req: Request, res: Response) => {
    try {
      const body = req.body as LinkSlaveRequest;
      if (!body || !body.slave_url || !body.link_key) {
        const err: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'slave_url 和 link_key 必填' },
        };
        res.status(400).json(err);
        return;
      }
      const result = await nodeService.linkSlave(body.slave_url, body.link_key, body.display_fqdn);
      // slave 注册成功后清该节点的 HTTP 客户端缓存（comms_key 已变化）
      daemonClientService?.invalidateClient(result.nodeId);
      const resp: LinkSlaveResponse = {
        node_id: result.nodeId,
        comms_key: result.commsKey,
      };
      res.status(200).json(resp);
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  // POST /api/nodes/verify-token — slave 验证 user token（commsKey 鉴权）
  router.post('/verify-token', requireCommsKey(nodeService), async (req: Request, res: Response) => {
    try {
      const body = req.body as VerifyTokenRequest;
      if (!body || !body.token) {
        const err: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'token 必填' },
        };
        res.status(400).json(err);
        return;
      }

      // 尝试作为 JWT 验证
      try {
        const payload = verifyToken(body.token, jwtSecret);
        const resp: VerifyTokenResponse = {
          valid: true,
          user_id: payload.userId,
          role: payload.role,
        };
        res.json(resp);
        return;
      } catch {
        // JWT 验证失败，返回 invalid（不区分过期/篡改，避免信息泄露）
        const resp: VerifyTokenResponse = {
          valid: false,
          reason: 'token 无效或已过期',
        };
        res.json(resp);
        return;
      }
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  // POST /api/nodes/:id/heartbeat — slave 心跳上报（commsKey 鉴权）
  router.post('/:id/heartbeat', requireCommsKey(nodeService), async (req: Request, res: Response) => {
    try {
      const nodeId = req.params.id;
      const authedNode = res.locals.node as { id: string };
      // 校验 path 中的 nodeId 与 commsKey 对应的 nodeId 一致
      if (authedNode.id !== nodeId) {
        const err: PanelErrorResponse = {
          error: { code: 'NODE_COMMS_KEY_INVALID', message: '节点 ID 与通信密钥不匹配' },
        };
        res.status(403).json(err);
        return;
      }
      const payload = (req.body ?? {}) as NodeHeartbeatRequest;
      await nodeService.heartbeat(nodeId, payload);
      const resp: NodeHeartbeatResponse = { received: true };
      res.json(resp);
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// 鉴权路由（前端管理端点，挂在 authenticateToken 之后）
// ---------------------------------------------------------------------------

/**
 * 创建 Nodes 鉴权路由
 * GET  /                → ListNodeClusterResponse（L2 扩展，从 DB 读取）
 * GET  /:id             → NodeDetailResponse
 * POST /                → CreateNodeInviteResponse（requireAdmin）
 * DELETE /:id           → DeleteNodeResponse（requireAdmin）
 * GET  /:id/disk-usage  → NodeDiskUsageResponse（v3.6.1）
 * GET  /:id/javas       → ScanJavasResult（v4.4.0-M1）
 *
 * @param nodeService    L2 节点服务
 * @param daemonClient   v3.6.1/v4.4.0-M1: 节点感知的 Daemon 客户端
 * @param logger         日志
 */
export function createNodesRouter(
  nodeService: NodeService,
  daemonClient?: DaemonClient,
  logger?: Logger,
): Router {
  const router = Router();

  // GET /api/nodes — 节点列表（L2 扩展，从 DB 读取）
  // v4.28.0: 按 viewer 角色筛选（server_admin 全量 / instance_admin 自有+平台）
  router.get('/', async (req: Request, res: Response) => {
    try {
      const rawRole = req.activeRole ?? req.user?.role ?? 'user';
      const role = normalizeRole(rawRole);
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const nodes = await nodeService.listNodes(role, userId);
      const body: ListNodeClusterResponse = { nodes };
      res.json(body);
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  // GET /api/nodes/:id — 节点详情（v4.28.0: 加归属校验）
  router.get(
    '/:id',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    assertNodeOwnership(nodeService),
    async (req: Request, res: Response) => {
      try {
        const node = await nodeService.getNode(req.params.id);
        const body: NodeDetailResponse = { node };
        res.json(body);
      } catch (err) {
        handleNodeError(res, err, logger);
      }
    },
  );

  // POST /api/nodes — 创建邀请（v4.28.0: server_admin + instance_admin）
  router.post(
    '/',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as CreateNodeInviteRequest;
        if (!body || !body.name) {
          const err: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'name 必填' },
          };
          res.status(400).json(err);
          return;
        }
        const rawRole = req.activeRole ?? req.user?.role ?? 'user';
        const role = normalizeRole(rawRole);
        const userId = req.user?.userId;
        if (!userId) {
          const err: PanelErrorResponse = {
            error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
          };
          res.status(401).json(err);
          return;
        }
        const result = await nodeService.createInvite(
          body.name,
          userId,
          role,
          body.display_fqdn,
        );
        const resp: CreateNodeInviteResponse = {
          node_id: result.nodeId,
          link_key: result.linkKey,
          slave_command: result.slaveCommand,
          expires_at: result.expiresAt,
        };
        res.status(201).json(resp);
      } catch (err) {
        handleNodeError(res, err, logger);
      }
    },
  );

  // DELETE /api/nodes/:id — 删除节点（v4.28.0: server_admin + instance_admin + 归属校验）
  // 支持 dry_run 查询模式：?dry_run=true 时不执行删除，仅返回该节点上的活跃实例数与可删除状态
  router.delete(
    '/:id',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    assertNodeOwnership(nodeService),
    async (req: Request, res: Response) => {
    try {
      const nodeId = req.params.id;

      // dry-run 模式：查询该节点上的实例，不执行删除
      if (req.query.dry_run === 'true') {
        const db = req.app.locals.db as Knex | undefined;
        if (!db) {
          const body: PanelErrorResponse = {
            error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
          };
          res.status(500).json(body);
          return;
        }

        // 查询该节点上的所有实例（含活跃与已停止），用于 dry-run 预览
        const instances = await db<{ id: string; name: string; status: string; node_id: string | null }>('servers')
          .select('id', 'name', 'status')
          .where('node_id', '=', nodeId)
          .orderBy('name', 'asc');

        // 活跃实例定义：status !== 'stopped'（含 running / starting / stopping 等中间态）
        const activeInstances = instances.filter((i) => i.status !== 'stopped');

        res.json({
          node_id: nodeId,
          dry_run: true,
          instance_count: activeInstances.length,
          total_count: instances.length,
          can_delete: activeInstances.length === 0,
          instances: instances.map((i) => ({
            id: i.id,
            name: i.name,
            status: i.status,
            active: i.status !== 'stopped',
          })),
        });
        return;
      }

      // 原有删除逻辑（非 dry-run）
      await nodeService.deleteNode(nodeId);
      const resp: DeleteNodeResponse = { id: nodeId, deleted: true };
      res.json(resp);
    } catch (err) {
      handleNodeError(res, err, logger);
    }
    },
  );

  // POST /api/nodes/:id/regenerate-invite — 重新生成邀请密钥
  // v4.28.0: server_admin + instance_admin + 归属校验；失败重试时调用，仅对 pending 节点有效
  router.post(
    '/:id/regenerate-invite',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    assertNodeOwnership(nodeService),
    async (req: Request, res: Response) => {
      try {
        const result = await nodeService.regenerateInvite(req.params.id);
        const resp: CreateNodeInviteResponse = {
          node_id: result.nodeId,
          link_key: result.linkKey,
          slave_command: result.slaveCommand,
          expires_at: result.expiresAt,
        };
        res.json(resp);
      } catch (err) {
        handleNodeError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /api/nodes/:id/ping — 节点主动测速 (Master -> Slave)
  // ----------------------------------------------------------------
  router.get('/:id/ping', async (req: Request, res: Response) => {
    try {
      if (!daemonClient) {
        const body: PanelErrorResponse = {
          error: {
            code: 'PANEL_SERVICE_UNAVAILABLE',
            message: 'Daemon 客户端未初始化',
          },
        };
        res.status(503).json(body);
        return;
      }
      
      const start = Date.now();
      await daemonClient.getHealth(req.params.id);
      const latencyMs = Date.now() - start;
      
      res.json({ latency_ms: latencyMs });
    } catch (err) {
      handleNodeError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // v3.6.1-A1: GET /api/nodes/:id/disk-usage — 节点磁盘占用
  // ----------------------------------------------------------------
  router.get('/:id/disk-usage', async (req: Request, res: Response) => {
    try {
      if (!daemonClient) {
        const body: PanelErrorResponse = {
          error: {
            code: 'PANEL_SERVICE_UNAVAILABLE',
            message: '磁盘占用查询服务未初始化（daemonClient 缺失）',
          },
        };
        res.status(503).json(body);
        return;
      }

      const nodeId = req.params.id;
      const resp = await daemonClient.execCommand(nodeId, 'system', {
        binary: 'df',
        args: ['-B1', '/'],
        timeout: 10_000,
      });

      if (resp.exit_code !== 0 || !resp.stdout) {
        const body: PanelErrorResponse = {
          error: {
            code: 'NODE_DISK_USAGE_FAILED',
            message: `df 执行失败 exit=${resp.exit_code}: ${(resp.stderr || resp.stdout || '').trim()}`,
          },
        };
        res.status(502).json(body);
        return;
      }

      const lines = resp.stdout.split('\n').filter(Boolean);
      if (lines.length < 2) {
        const body: PanelErrorResponse = {
          error: {
            code: 'NODE_DISK_USAGE_PARSE_FAILED',
            message: `df 输出行数不足: ${resp.stdout}`,
          },
        };
        res.status(502).json(body);
        return;
      }

      const fields = lines[1].trim().split(/\s+/);
      if (fields.length < 6) {
        const body: PanelErrorResponse = {
          error: {
            code: 'NODE_DISK_USAGE_PARSE_FAILED',
            message: `df 输出字段不足: ${lines[1]}`,
          },
        };
        res.status(502).json(body);
        return;
      }

      const totalBytes = parseInt(fields[1], 10);
      const usedBytes = parseInt(fields[2], 10);
      const availBytes = parseInt(fields[3], 10);
      const usedPercent = parseInt(fields[4].replace(/%$/, ''), 10);

      if (!Number.isFinite(totalBytes) || !Number.isFinite(usedBytes)) {
        const body: PanelErrorResponse = {
          error: {
            code: 'NODE_DISK_USAGE_PARSE_FAILED',
            message: `df 数值解析失败: ${lines[1]}`,
          },
        };
        res.status(502).json(body);
        return;
      }

      const usage: NodeDiskUsage = {
        node_id: nodeId,
        filesystem: fields[0],
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        available_bytes: availBytes,
        used_percent: Number.isFinite(usedPercent) ? usedPercent : 0,
        mount: fields[5],
      };
      const body: NodeDiskUsageResponse = { usage };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn({ err: message, nodeId: req.params.id }, 'nodes/disk-usage: 调用失败');
      const body: PanelErrorResponse = {
        error: { code: 'NODE_DISK_USAGE_FAILED', message },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // v4.4.0-M1: GET /api/nodes/:id/javas — 扫描节点上的 Java 安装
  // v4.28.0: 加归属校验（instance_admin 仅可扫描自有 self_hosted 节点）
  // ----------------------------------------------------------------
  router.get(
    '/:id/javas',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    assertNodeOwnership(nodeService),
    async (req: Request, res: Response) => {
      try {
        if (!daemonClient) {
          const body: PanelErrorResponse = {
            error: {
              code: 'PANEL_SERVICE_UNAVAILABLE',
              message: 'Java 扫描服务未初始化（daemonClient 缺失）',
            },
          };
          res.status(503).json(body);
          return;
        }

        const nodeId = req.params.id;
        const result: ScanJavasResult = await daemonClient.scanJavas(nodeId);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn({ err: message, nodeId: req.params.id }, 'nodes/javas: 调用失败');
        const body: PanelErrorResponse = {
          error: { code: 'NODE_JAVAS_SCAN_FAILED', message },
        };
        res.status(502).json(body);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /api/nodes/:id/instances — 节点上的实例列表
  //   v4.31.0: server_admin 返回该节点全部实例；instance_admin 仅返回自己拥有/共管的
  // ----------------------------------------------------------------
  router.get(
    '/:id/instances',
    requireRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
    assertNodeOwnership(nodeService),
    async (req: Request, res: Response) => {
      try {
        const db = req.app.locals.db as Knex | undefined;
        if (!db) {
          const body: PanelErrorResponse = {
            error: { code: 'PANEL_INTERNAL_ERROR', message: '数据库未初始化' },
          };
          res.status(500).json(body);
          return;
        }

        const nodeId = req.params.id;
        const userId = req.user?.userId;
        if (!userId) {
          const body: PanelErrorResponse = {
            error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
          };
          res.status(401).json(body);
          return;
        }

        const role = normalizeRole(req.activeRole ?? req.user?.role ?? '');

        // 查询节点名称
        const node = await nodeService.getNode(nodeId);

        // 查询实例——server_admin 全量，instance_admin 仅自己拥有/共管的
        let query = db<{ id: string; name: string; pack_id: string; game_type: string; node_id: string; owner_user_id: string; owner_username: string | null; node_name: string | null; status: string; port: number; rcon_port: number; current_version: string | null; last_activity_at: string | null; disk_usage_bytes: number | null; disk_usage_updated_at: string | null; startup_config_set_at: string | null; expires_at: string | null; expiry_status: string; expiry_grace_until: string | null; created_at: string; updated_at: string }>('servers')
          .select(
            'servers.id', 'servers.name', 'servers.pack_id', 'servers.game_type',
            'servers.node_id', 'servers.owner_user_id',
            'users.username as owner_username',
            'nodes.name as node_name',
            'servers.status', 'servers.port', 'servers.rcon_port',
            'servers.current_version', 'servers.last_activity_at',
            'servers.disk_usage_bytes', 'servers.disk_usage_updated_at',
            'servers.startup_config_set_at',
            'servers.expires_at', 'servers.expiry_status', 'servers.expiry_grace_until',
            'servers.created_at', 'servers.updated_at',
          )
          .leftJoin('users', 'servers.owner_user_id', 'users.id')
          .leftJoin('nodes', 'servers.node_id', 'nodes.id')
          .where('servers.node_id', nodeId)
          .orderBy('servers.created_at', 'asc');

        if (role !== Role.SERVER_ADMIN) {
          query = query.where(function () {
            this.where('servers.owner_user_id', userId).orWhereIn('servers.id', function () {
              this.select('instance_id').from('instance_admins').where('user_id', userId);
            });
          });
        }

        const rows = await query;
        const instances: ServerSummary[] = rows.map((row) => ({
          id: row.id,
          name: row.name,
          pack_id: row.pack_id,
          game_type: row.game_type,
          node_id: row.node_id,
          owner_user_id: row.owner_user_id,
          owner_username: row.owner_username ?? '未知',
          status: row.status as InstanceState,
          port: row.port,
          rcon_port: row.rcon_port,
          current_version: row.current_version ?? null,
          last_activity_at: row.last_activity_at ?? null,
          disk_usage_bytes: row.disk_usage_bytes ?? null,
          disk_usage_updated_at: row.disk_usage_updated_at ?? null,
          startup_config_set_at: row.startup_config_set_at ?? null,
          expires_at: row.expires_at ?? null,
          expiry_status: (row.expiry_status ?? 'permanent') as 'permanent' | 'active' | 'grace' | 'expired' | 'cleaned',
          node_name: row.node_name ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));

        const response: NodeInstancesResponse = {
          node_name: node.name,
          instances,
        };
        res.json(response);
      } catch (err) {
        handleNodeError(res, err, logger);
      }
    },
  );

  return router;
}

function handleNodeError(res: Response, err: unknown, logger?: Logger): void {
  if (err instanceof AppError) {
    const status = err.httpStatus ?? 400;
    const body: PanelErrorResponse = {
      error: { code: err.code as any, message: err.message },
    };
    res.status(status).json(body);
    return;
  }
  logger?.error({ err: err instanceof Error ? err.message : String(err) }, 'nodes 路由未预期错误');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: '内部错误' },
  };
  res.status(500).json(body);
}
