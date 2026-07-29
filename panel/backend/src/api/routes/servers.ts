// ============================================================================
// 模块7_Panel业务API — Server CRUD + 生命周期路由
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// ============================================================================

import { Router, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { PackRegistry } from '../../core/packs/registry.js';
import type { GamePack, StartupGuide } from '@public/schema/pack-schema.js';
import type { DaemonHttpClient } from '../../daemonClient/client.js';
import { DaemonApiError } from '../../daemonClient/types.js';
import type { PanelWsServer } from '../../websocket/server.js';
import { normalizeRole, Role } from '../../core/auth/roles.js';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { SafeRemoveService } from '../../services/safeRemoveService.js';
import type { ConfigFileServiceImpl } from '../../services/configFileService.js';
// v1.1.0: 启动前置引导工具函数（校验/渲染启动参数模板）
import {
  validateStartupGuide,
  validateStartupConfig,
  renderStartupArgs,
  mergeWithDefaults,
  type StartupConfig,
} from '../../services/startupGuideService.js';
// v4.6.0: 资源配额服务（创建实例时校验实例数配额）
import { QuotaService } from '../../services/quotaService.js';
// v4.17.0: 权限点鉴权中间件（POST / 创建实例要求 instance.create 权限点）
import { requirePermission } from '../../middleware/auth.js';
import type {
  CreateServerRequest,
  CreateServerResponse,
  DeleteServerResponse,
  GetStartupGuideResponse,
  ListServersResponse,
  PanelErrorResponse,
  SaveStartupConfigRequest,
  SaveStartupConfigResponse,
  ServerCommandRequest,
  ServerCommandResponse,
  ServerDetailResponse,
  ServerDiskUsage,
  ServerDiskUsageResponse,
  ServerResetStateResponse,
  ServerStartResponse,
  ServerStopResponse,
  ServerSummary,
  SubdirCleanupResponse,
  UpdateServerExpiryRequest,
} from '@public/schema/panel-api-types';
import type { InstanceState } from '@public/schema/daemon-api-types';

// ----- DB 行类型 -----
interface ServerRow {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  node_id: string;
  owner_user_id: string;
  status: string;
  port: number;
  rcon_port: number;
  rcon_password_enc: string | null;
  resource_limits_json: string | null;
  current_version: string | null;
  version_id: string | null;
  last_activity_at: string | null;
  marked_for_deletion: number;
  // v3.6.1: 磁盘占用缓存字段
  disk_usage_bytes: number | null;
  disk_usage_updated_at: string | null;
  // v1.1.0: 启动前置引导配置（JSON 字符串，解析后为 { field_key: value }）
  startup_config_json: string | null;
  // v1.1.0: 启动引导配置完成时间（ISO 8601），null=未完成引导
  startup_config_set_at: string | null;
  // v3-billing: 有效期字段（对齐 server-schema.json）
  expires_at: string | null;
  expiry_status: string;
  expiry_grace_until: string | null;
  created_at: string;
  updated_at: string;
}

/** JOIN users + nodes 后的扩展行 */
interface ServerRowWithOwner extends ServerRow {
  /**
   * v4.22.7: 改为 string | null——LEFT JOIN users 未匹配时（owner_user_id 在 users 表不存在，
   * 即孤儿实例）数据库返回 null。toSummary 中兜底为 '未知' 避免 zod schema 校验失败。
   */
  owner_username: string | null;
  /** v4.31.0: JOIN nodes 表的节点名称，LEFT JOIN 未匹配时为 null */
  node_name: string | null;
}

interface NodeRow {
  id: string;
  name: string;
  fqdn: string;
  daemon_token_hash: string;
  public_ip: string | null;
  status: string;
  last_seen_at: string | null;
}

const DEFAULT_NODE_ID = 'node-local';
const GAME_PORT_BASE = 25565;
const RCON_PORT_BASE = 25575;
const PORT_RANGE = 1000; // P0: 在 base+offset 范围内分配

/**
 * 创建 Server 路由
 *
 * @param onInstanceStart 可选回调：POST /:id/start 成功后触发，用于 Panel 订阅该实例的
 *   Daemon WS 事件流。Daemon WS 协议要求显式 subscribe 才推送 state.change 等事件，
 *   不订阅则 Panel DB 状态会停留在 starting，无法感知实例已 running。
 */
export function createServersRouter(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonHttpClient,
  _wsServer: PanelWsServer,
  logger: Logger,
  onInstanceStart?: (serverId: string) => void,
  /**
   * v3.6.1: 节点感知的 Daemon 客户端（用于 execCommand 等需要按 node_id 路由的调用）
   * 若未传入则降级为 daemonClient（仅支持单节点 P0 模式）
   */
  daemonClientService?: DaemonClient,
  /**
   * v3.6.2-A7: 安全删除服务（用于子目录清理 DELETE /:id/subdir/:subdir）
   * 若未传入则子目录清理端点返回 503
   */
  safeRemoveService?: SafeRemoveService,
  /**
   * v1.1.0: 配置文件服务（用于 PUT /:id/startup-config 的 config_writes 写入实例配置文件）
   * 若未传入则 PUT /startup-config 跳过 config_writes（仅保存 startup_config_json），降级运行
   */
  configFileService?: ConfigFileServiceImpl,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers — 列出实例
  //   server_admin → 全部实例
  //   其他角色 → 仅自己的实例
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      // v4.17.0: 优先使用 req.activeRole（会话级活动角色），降级到 req.user.role（旧 JWT）
      const userRole = normalizeRole(req.activeRole ?? req.user?.role ?? '');
      let query = db<ServerRowWithOwner>('servers')
        .select('servers.*', 'users.username as owner_username', 'nodes.name as node_name')
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .leftJoin('nodes', 'servers.node_id', 'nodes.id')
        .orderBy('servers.created_at', 'asc');

      // v4.5.0: 三角色分支
      if (userRole === Role.SERVER_ADMIN) {
        // 全部实例，不加 where
      } else if (userRole === Role.INSTANCE_ADMIN) {
        // owner + instance_admins 关联的实例
        query = query.where(function () {
          this.where('servers.owner_user_id', userId).orWhereIn('servers.id', function () {
            this.select('instance_id').from('instance_admins').where('user_id', userId);
          });
        });
      } else {
        // v4.17.0: user 通过统一 bindings 表（binding_type='account', scope_type='instance'）绑定的实例 + owner 的实例
        //   旧表 user_instance_bindings 已在 migration 20260807000001 中物理删除
        query = query
          .leftJoin('bindings as b', function () {
            this.on('servers.id', '=', 'b.scope_ref')
              .andOn('b.binding_type', '=', db.raw("?", ['account']))
              .andOn('b.scope_type', '=', db.raw("?", ['instance']))
              .andOn('b.verify_status', '=', db.raw("?", ['verified']));
          })
          .where(function () {
            this.where('servers.owner_user_id', userId).orWhere(function () {
              this.where('b.user_id', userId);
            });
          })
          .groupBy('servers.id'); // 避免 JOIN 产生重复
      }

      // v4.5.0: bindings / instance_admins 表可能不存在（fallback 到仅 owner 过滤）
      let rows: ServerRowWithOwner[];
      try {
        rows = await query;
      } catch {
        rows = await db<ServerRowWithOwner>('servers')
          .select('servers.*', 'users.username as owner_username')
          .leftJoin('users', 'servers.owner_user_id', 'users.id')
          .where('servers.owner_user_id', userId)
          .orderBy('servers.created_at', 'asc');
      }
      const servers: ServerSummary[] = rows.map(toSummary);
      const response: ListServersResponse = { servers };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers — 创建实例
  // ----------------------------------------------------------------
  // v4.17.0: 创建实例要求 instance.create 权限点
  //   - user 角色无此权限 → 403（需切换为 instance_admin 或 server_admin）
  //   - instance_admin / server_admin 有此权限 → 通过，受配额约束（server_admin 跳过配额）
  router.post('/', requirePermission('instance.create'), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<CreateServerRequest>;
      if (!body.name || !body.pack_id) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 name 或 pack_id' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 校验 pack 存在
      const pack = registry.get(body.pack_id);
      if (!pack) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PACK_NOT_FOUND', message: `Pack 不存在: ${body.pack_id}` },
        };
        res.status(400).json(errBody);
        return;
      }

      // v3.8.0-S3: games.enabled_packs 多选过滤——非空时检查 pack_id 是否在白名单中
      // v3.8.0-S4: games.max_instances_per_user 限制——非 server_admin 用户受实例数上限约束
      const settingSchemaService = req.app.locals.settingSchemaService as
        | import('../../services/settingSchemaService.js').SettingSchemaService
        | undefined;
      if (settingSchemaService) {
        try {
          // S3: enabled_packs 校验
          const enabledPacks = await settingSchemaService.getJSON<string[]>('games.enabled_packs');
          if (enabledPacks && Array.isArray(enabledPacks) && enabledPacks.length > 0) {
            if (!enabledPacks.includes(body.pack_id)) {
              const errBody: PanelErrorResponse = {
                error: {
                  code: 'PANEL_FORBIDDEN',
                  message: `Pack ${body.pack_id} 未被管理员启用`,
                },
              };
              res.status(403).json(errBody);
              return;
            }
          }
          // S4: max_instances_per_user 校验（server_admin 不受限）
          // v4.17.0: 优先使用 req.activeRole（会话级活动角色），降级到 req.user.role
          const userRole = normalizeRole(req.activeRole ?? req.user?.role ?? '');
          if (userRole !== Role.SERVER_ADMIN) {
            const maxInstances = await settingSchemaService.getNumber('games.max_instances_per_user');
            if (maxInstances > 0) {
              const owned = await db<ServerRow>('servers')
                .where({ owner_user_id: userId })
                .count('* as cnt')
                .first();
              const currentCount = Number((owned as { cnt?: unknown } | undefined)?.cnt ?? 0);
              if (currentCount >= maxInstances) {
                const errBody: PanelErrorResponse = {
                  error: {
                    code: 'PANEL_FORBIDDEN',
                    message: `已达到每用户最大实例数 ${maxInstances}（当前 ${currentCount} 个）`,
                  },
                };
                res.status(403).json(errBody);
                return;
              }
            }
          }
        } catch {
          // 设置读取失败时不阻断创建流程（降级为不校验）
        }
      }

      // v4.6.0: 资源配额检查（server_admin 跳过，与 S4 max_instances_per_user 行为一致）
      // v4.17.0: 优先使用 req.activeRole（会话级活动角色），降级到 req.user.role
      const userRoleForQuota = normalizeRole(req.activeRole ?? req.user?.role ?? '');
      if (userRoleForQuota !== Role.SERVER_ADMIN) {
        const quotaService = new QuotaService(db);
        const quotaCheck = await quotaService.checkInstanceQuota(userId);
        if (!quotaCheck.allowed) {
          const errBody: PanelErrorResponse = {
            error: { code: 'QUOTA_EXCEEDED', message: quotaCheck.reason ?? '实例配额已满' },
          };
          res.status(403).json(errBody);
          return;
        }
      }

      // 校验 node 存在（缺省用 node-local）
      const nodeId = body.node_id ?? DEFAULT_NODE_ID;
      const node = await db<NodeRow>('nodes').where({ id: nodeId }).first();
      if (!node) {
        const errBody: PanelErrorResponse = {
          error: { code: 'NODE_NOT_FOUND', message: `节点不存在: ${nodeId}` },
        };
        res.status(400).json(errBody);
        return;
      }

      // 分配端口（按 Pack 声明的默认端口贴近实际游戏端口）
      // - 游戏端口 base：优先取 Pack.startup.default_game_port，回落 GAME_PORT_BASE
      // - RCON 端口 base：优先取 Pack.protocol.default_port，回落 RCON_PORT_BASE
      // v3.8.0-S5: 读取 games.port_range [min, max] 约束端口分配范围
      const gamePortBase = pack.startup.default_game_port ?? GAME_PORT_BASE;
      const rconPortBase = pack.protocol.default_port ?? RCON_PORT_BASE;
      let portRange: { min: number; max: number } | undefined;
      try {
        const settingSchemaService = req.app.locals.settingSchemaService as
          | import('../../services/settingSchemaService.js').SettingSchemaService
          | undefined;
        if (settingSchemaService) {
          const range = await settingSchemaService.getJSON<number[]>('games.port_range');
          if (Array.isArray(range) && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
            const [min, max] = range;
            if (min < max && min > 0 && max < 65536) {
              portRange = { min: Math.floor(min), max: Math.floor(max) };
            }
          }
        }
      } catch {
        // 设置读取失败时降级为默认 PORT_RANGE 行为
      }
      // v1.1.0: 端口锁定为实例不可变属性——忽略前端传入的 body.port/body.rcon_port，
      //   强制自动分配（CreateServerRequest.port/rcon_port 已 @deprecated，前端不再传）
      const port = await allocatePort(db, 'port', gamePortBase, portRange);
      const rconPort = await allocatePort(db, 'rcon_port', rconPortBase, portRange);

      // 校验指定端口未被占用
      if (await isPortTaken(db, 'port', port)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `游戏端口已被占用: ${port}` },
        };
        res.status(400).json(errBody);
        return;
      }
      if (await isPortTaken(db, 'rcon_port', rconPort)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `RCON 端口已被占用: ${rconPort}` },
        };
        res.status(400).json(errBody);
        return;
      }

      // 生成随机 RCON 密码并 base64 编码存储（P0 简化）
      const rconPassword = generateRconPassword();
      const rconPasswordEnc = Buffer.from(rconPassword).toString('base64');

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const resourceLimits = body.resource_limits ?? null;

      // v3.4.0: 选择版本——传入 version_id 则使用指定版本，否则默认最新
      let selectedVersion: string | null = null;
      let selectedVersionId: string | null = null;
      if (body.version_id) {
        const gv = await db('game_versions')
          .where({ id: body.version_id, pack_id: pack.pack.id })
          .first();
        if (!gv) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `版本不存在或不属于该 Pack: ${body.version_id}` },
          };
          res.status(400).json(errBody);
          return;
        }
        selectedVersion = gv.version as string;
        selectedVersionId = gv.id as string;
      } else {
        // 取该 Pack 的最新版本（按 version_major/version_minor/version_patch 降序）
        const latestGv = await db('game_versions')
          .where({ pack_id: pack.pack.id })
          .orderBy('version_major', 'desc')
          .orderBy('version_minor', 'desc')
          .orderBy('version_patch', 'desc')
          .first();
        if (latestGv) {
          selectedVersion = latestGv.version as string;
          selectedVersionId = latestGv.id as string;
        }
      }

      await db<ServerRow>('servers').insert({
        id,
        name: body.name,
        pack_id: pack.pack.id,
        game_type: pack.pack.game,
        node_id: nodeId,
        owner_user_id: userId,
        status: 'stopped',
        port,
        rcon_port: rconPort,
        rcon_password_enc: rconPasswordEnc,
        resource_limits_json: resourceLimits ? JSON.stringify(resourceLimits) : null,
        current_version: selectedVersion,
        version_id: selectedVersionId,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      });

      // 自动初始化商城基础物品（从 Pack.items.static_list 复制）
      // 失败不阻断实例创建，仅记录日志（避免 Pack 无 items 时报错）
      try {
        await initShopItemsFromPack(db, id, pack, now);
      } catch (itemErr) {
        logger.warn({ err: itemErr instanceof Error ? itemErr.message : String(itemErr), serverId: id }, '初始化商城物品失败（不阻断实例创建）');
      }

      const row = await db<ServerRowWithOwner>('servers')
        .select('servers.*', 'users.username as owner_username', 'nodes.name as node_name')
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .leftJoin('nodes', 'servers.node_id', 'nodes.id')
        .where({ 'servers.id': id })
        .first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '创建后查询实例失败' },
        };
        res.status(500).json(errBody);
        return;
      }

      const response: CreateServerResponse = { server: toSummary(row) };
      res.status(201).json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:id — 实例详情
  // ----------------------------------------------------------------
  router.get('/:id', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRowWithOwner>('servers')
        .select('servers.*', 'users.username as owner_username', 'nodes.name as node_name')
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .leftJoin('nodes', 'servers.node_id', 'nodes.id')
        .where({ 'servers.id': req.params.id })
        .first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // v4.16.1: 只读访问判定（owner/admin 之外，追加放行 active 绑定玩家）
      const readErr = await checkReadAccess(db, row, req.user!);
      if (readErr) {
        res.status(403).json(readErr);
        return;
      }

      const response: ServerDetailResponse = { server: toSummary(row) };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:id — 删除（stopped 或 error 状态可删除；
  //   error 状态下 best-effort 调 daemon 清理残留进程，失败仅日志不阻断）
  // ----------------------------------------------------------------
  router.delete('/:id', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      if (row.status !== 'stopped' && row.status !== 'error') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `仅 stopped/error 状态可删除，当前状态: ${row.status}`,
          },
        };
        res.status(409).json(errBody);
        return;
      }

      // v4.29.8: error 状态下 best-effort 调 daemon 清理残留进程，失败仅记日志不阻断删除
      if (row.status === 'error') {
        try {
          await daemonClient.stopInstance(row.id);
          logger.info({ serverId: row.id }, 'delete: best-effort stopInstance succeeded for error instance');
        } catch (stopErr) {
          logger.warn(
            { err: stopErr instanceof Error ? stopErr.message : String(stopErr), serverId: row.id },
            'delete: best-effort stopInstance failed, continue deleting',
          );
        }
      }

      await db<ServerRow>('servers').where({ id: row.id }).delete();
      const response: DeleteServerResponse = { id: row.id, deleted: true };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:id/start
  // ----------------------------------------------------------------
  router.post('/:id/start', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      if (row.status !== 'stopped') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `仅 stopped 状态可启动，当前状态: ${row.status}`,
          },
        };
        res.status(409).json(errBody);
        return;
      }

      // v3.4.0: 更新活跃时间
      await touchInstance(db, row.id);

      const pack = registry.get(row.pack_id);
      if (!pack) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PACK_NOT_FOUND', message: `Pack 不存在: ${row.pack_id}` },
        };
        res.status(400).json(errBody);
        return;
      }

      // v1.1.0: 启动前置引导校验 + 启动参数渲染
      // Pack 未声明 startup_guide 或 enabled=false → 跳过校验（向后兼容）
      // Pack 声明 startup_guide → 校验 startup_config_json 是否覆盖所有 required 字段
      let renderedPack = pack;
      if (pack.startup_guide?.enabled) {
        let startupConfig: StartupConfig;
        try {
          startupConfig = row.startup_config_json
            ? (JSON.parse(row.startup_config_json) as StartupConfig)
            : {};
        } catch {
          startupConfig = {};
        }
        const validation = validateStartupGuide(pack.startup_guide, startupConfig);
        if (!validation.completed) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'STARTUP_CONFIG_INCOMPLETE',
              message: '请先完成启动配置',
              details: {
                missing_fields: validation.missingFields,
                missing_steps: validation.missingSteps,
              },
            },
          };
          res.status(409).json(errBody);
          return;
        }
        // 合并 default 后渲染启动参数模板（{{var}} → 实际值）
        const merged = mergeWithDefaults(pack.startup_guide, startupConfig);
        const renderedArgs = renderStartupArgs(
          pack.startup.args,
          merged,
          pack.startup_guide.args_mapping,
        );
        renderedPack = { ...pack, startup: { ...pack.startup, args: renderedArgs } };
      }

      // 更新状态为 starting
      await updateStatus(db, row.id, 'starting');

      // 解密 RCON 密码（P0 base64）
      const rconPassword = row.rcon_password_enc
        ? Buffer.from(row.rcon_password_enc, 'base64').toString()
        : '';

      const instancesDir = process.env.INSTANCES_DIR ?? './instances';
      const workdir = `${instancesDir}/${row.id}`;

      try {
        const startResp = await daemonClient.startInstance(row.id, {
          pack: renderedPack,
          instance: {
            name: row.name,
            port: row.port,
            rcon_port: row.rcon_port,
            rcon_password: rconPassword,
            workdir,
          },
        });

        // 启动请求已被 Daemon 接受：订阅该实例的 WS 事件流，
        // 以便接收后续 state.change（starting → running）事件并同步到 DB
        try {
          onInstanceStart?.(row.id);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), serverId: row.id },
            'onInstanceStart 回调失败（不影响启动流程）',
          );
        }

        // 同步 Daemon 返回的 pid/状态到 DB（保留 starting 直到 state.change 事件确认 running）
        await db<ServerRow>('servers').where({ id: row.id }).update({
          status: startResp.status,
          updated_at: new Date().toISOString(),
        });

        const response: ServerStartResponse = {
          server_id: row.id,
          status: 'starting',
          pid: startResp.pid,
        };
        res.json(response);
      } catch (err) {
        // 启动失败：回滚状态为 stopped，并按错误类型映射响应码
        await updateStatus(db, row.id, 'stopped');
        throw err;
      }
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:id/stop
  // ----------------------------------------------------------------
  router.post('/:id/stop', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      if (row.status !== 'running' && row.status !== 'starting' && row.status !== 'error') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `仅 running/starting/error 状态可停止，当前状态: ${row.status}`,
          },
        };
        res.status(409).json(errBody);
        return;
      }

      // v3.4.0: 更新活跃时间
      await touchInstance(db, row.id);

      await updateStatus(db, row.id, 'stopping');

      // v4.29.8: error 状态下 daemon stopInstance 失败时回滚 DB 到 error，
      // 避免实例卡在 stopping（用户可改用 reset-state 恢复）。
      // running/starting 状态下保持原行为（依赖 scheduler-init.ts 状态超时扫描处理卡死）。
      try {
        await daemonClient.stopInstance(row.id);
      } catch (err) {
        if (row.status === 'error') {
          await updateStatus(db, row.id, 'error');
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), serverId: row.id },
            'stop: daemon stopInstance failed on error state, rolled back DB to error',
          );
        }
        throw err; // 仍走 handleDaemonOrInternal 返回 503/502
      }

      const response: ServerStopResponse = {
        server_id: row.id,
        status: 'stopping',
      };
      res.json(response);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:id/reset-state — 强制将 error 状态重置为 stopped
  // v4.29.8: 仅 server_admin 可用，仅 error 状态可调，纯 DB 操作不调 daemon
  // ----------------------------------------------------------------
  router.post('/:id/reset-state', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      // v4.29.8: 权限校验——仅 server_admin（system_admin 旧值经 normalizeRole 自动映射）
      // v1.1.0: 对齐 L138/250/278 的正确写法，去掉错误的 `as Request` 转换
      //   （L6 未 import Request，`as Request` 被 TS 解析为 DOM Request 导致 TS2352）
      const role = normalizeRole(
        req.activeRole ?? req.user?.role ?? '',
      );
      if (role !== Role.SERVER_ADMIN) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_FORBIDDEN',
            message: '仅 server_admin 可执行强制重置状态',
          },
        };
        res.status(403).json(errBody);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      // 注：reset-state 不做 owner 校验——admin 可处理任何 error 实例（运维兜底）

      if (row.status !== 'error') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `仅 error 状态可重置，当前状态: ${row.status}`,
          },
        };
        res.status(409).json(errBody);
        return;
      }

      const prevStatus = row.status as InstanceState;
      await updateStatus(db, row.id, 'stopped');
      logger.info(
        { serverId: row.id, prevStatus },
        'reset-state: error → stopped (admin forced reset)',
      );

      const response: ServerResetStateResponse = {
        server_id: row.id,
        previous_status: prevStatus,
        current_status: 'stopped',
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PATCH /api/servers/:id — 管理员修改实例有效期
  //   v4.31.0: 仅 server_admin 可调用
  //   委托状态机逻辑（setInstanceExpiry 语义），不绕过 expiry_status 约束
  // ----------------------------------------------------------------
  router.patch('/:id', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      // 权限校验——仅 server_admin
      const role = normalizeRole(req.activeRole ?? req.user?.role ?? '');
      if (role !== Role.SERVER_ADMIN) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '仅 server_admin 可修改实例有效期' },
        };
        res.status(403).json(errBody);
        return;
      }

      const body = req.body as Partial<UpdateServerExpiryRequest>;
      if (body.duration_days !== null && body.duration_days !== undefined) {
        if (!Number.isFinite(body.duration_days) || body.duration_days <= 0) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'duration_days 必须为正整数或 null' },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const oldExpiryStatus = row.expiry_status ?? 'permanent';
      const oldExpiresAt = row.expires_at ?? null;
      const durationDays = body.duration_days ?? null;

      // 委托状态机逻辑——与 instanceExpiryService.setInstanceExpiry 语义一致
      let newExpiresAt: string | null;
      let newExpiryStatus: string;
      if (durationDays === null || durationDays >= 36500) {
        newExpiresAt = null;
        newExpiryStatus = 'permanent';
      } else {
        const now = new Date();
        const expires = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
        newExpiresAt = expires.toISOString();
        newExpiryStatus = 'active';
      }

      await db<ServerRow>('servers').where({ id: req.params.id }).update({
        expires_at: newExpiresAt,
        expiry_status: newExpiryStatus,
        expiry_grace_until: null,
        updated_at: new Date().toISOString(),
      });

      logger.info(
        {
          serverId: req.params.id,
          operatorUserId: userId,
          oldExpiresAt,
          newExpiresAt,
          oldExpiryStatus,
          newExpiryStatus,
          durationDays,
        },
        'PATCH /servers/:id — admin updated instance expiry',
      );

      // 写审计日志
      const auditLogService = req.app.locals.auditLogService as
        | import('../../services/auditLogService.js').AuditLogServiceImpl
        | undefined;
      if (auditLogService) {
        await auditLogService.create({
          server_id: req.params.id,
          user_id: userId,
          action: 'server.update_expiry',
          target_type: 'server',
          target_id: req.params.id,
          details: {
            old_expires_at: oldExpiresAt,
            new_expires_at: newExpiresAt,
            old_status: oldExpiryStatus,
            new_status: newExpiryStatus,
            duration_days: durationDays,
            operator_user_id: userId,
          },
        });
      }

      // 返回更新后的实例
      const updatedRow = await db<ServerRowWithOwner>('servers')
        .select('servers.*', 'users.username as owner_username', 'nodes.name as node_name')
        .leftJoin('users', 'servers.owner_user_id', 'users.id')
        .leftJoin('nodes', 'servers.node_id', 'nodes.id')
        .where({ 'servers.id': req.params.id })
        .first();
      if (!updatedRow) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '更新后查询实例失败' },
        };
        res.status(500).json(errBody);
        return;
      }

      const response: { server: ServerSummary } = { server: toSummary(updatedRow) };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:id/startup-guide — 获取启动前置引导声明 + 当前已填配置
  //   v1.1.0: 前端启动向导据此渲染分步表单
  //   返回 guide=null 表示该 Pack 未声明启动引导，可直接启动
  // ----------------------------------------------------------------
  router.get('/:id/startup-guide', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }
      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }
      const pack = registry.get(row.pack_id);
      const guide: StartupGuide | null = pack?.startup_guide ?? null;
      let currentConfig: Record<string, string | number | boolean> = {};
      try {
        currentConfig = row.startup_config_json
          ? (JSON.parse(row.startup_config_json) as Record<string, string | number | boolean>)
          : {};
      } catch {
        currentConfig = {};
      }
      const completed = guide?.enabled
        ? validateStartupGuide(guide, currentConfig).completed
        : true;
      const response: GetStartupGuideResponse = {
        guide,
        current_config: currentConfig,
        completed,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/servers/:id/startup-config — 保存启动前置引导配置
  //   v1.1.0: 保存用户在启动向导中填写的基础设定，按 config_writes 写入实例配置文件
  //   异常契约：
  //     - 400 PANEL_VALIDATION_ERROR：Pack 未声明启动引导
  //     - 400 STARTUP_CONFIG_INVALID：字段值类型/范围/枚举不符
  //     - 404 SERVER_NOT_FOUND / 403 PANEL_FORBIDDEN
  //   注：未覆盖所有 required 字段时仍保存（200），但 completed=false 且附 missing_fields，
  //       前端据此提示用户继续填写。仅 completed=true 时更新 startup_config_set_at。
  // ----------------------------------------------------------------
  router.put('/:id/startup-config', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }
      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }
      const pack = registry.get(row.pack_id);
      if (!pack?.startup_guide?.enabled) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: '该实例的 Pack 未声明启动前置引导',
          },
        };
        res.status(400).json(errBody);
        return;
      }
      const guide = pack.startup_guide;
      const body = req.body as SaveStartupConfigRequest;
      const config: StartupConfig = body.config ?? {};

      // 1. 字段值类型/范围/枚举校验（不通过则 400，不保存）
      const cfgValidation = validateStartupConfig(guide, config);
      if (!cfgValidation.valid) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'STARTUP_CONFIG_INVALID',
            message: cfgValidation.errors.map((e) => e.message).join('; '),
            details: { errors: cfgValidation.errors },
          },
        };
        res.status(400).json(errBody);
        return;
      }

      // 2. 按 config_writes 写入实例配置文件（configFileService 不可用则跳过，降级运行）
      const configWrites: { file: string; success: boolean; error?: string }[] = [];
      if (configFileService && guide.config_writes && guide.config_writes.length > 0) {
        // 按 file 分组，减少读写次数
        const byFile = new Map<string, { field_key: string; config_key: string }[]>();
        for (const w of guide.config_writes) {
          if (!byFile.has(w.file)) byFile.set(w.file, []);
          byFile.get(w.file)!.push({ field_key: w.field_key, config_key: w.config_key });
        }
        for (const [file, writes] of byFile) {
          try {
            const data = (await configFileService.readConfigFile(row.id, file)) as Record<
              string,
              unknown
            >;
            for (const w of writes) {
              if (w.field_key in config) {
                data[w.config_key] = config[w.field_key];
              }
            }
            await configFileService.writeConfigFile(row.id, file, data);
            configWrites.push({ file, success: true });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            configWrites.push({ file, success: false, error: errMsg });
            logger.warn(
              { err: errMsg, serverId: row.id, file },
              'config_writes 写入失败（不阻断 startup_config 保存）',
            );
          }
        }
      }

      // 3. 校验是否覆盖所有 required 字段
      const guideValidation = validateStartupGuide(guide, config);
      const now = new Date().toISOString();

      // 4. 保存 startup_config_json + startup_config_set_at（仅 completed 时更新 set_at）
      await db<ServerRow>('servers').where({ id: row.id }).update({
        startup_config_json: JSON.stringify(config),
        startup_config_set_at: guideValidation.completed
          ? now
          : row.startup_config_set_at,
        updated_at: now,
      });

      const response: SaveStartupConfigResponse = {
        server_id: row.id,
        completed: guideValidation.completed,
        missing_fields: guideValidation.missingFields,
        config_writes: configWrites,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:id/command
  // ----------------------------------------------------------------
  router.post('/:id/command', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      if (row.status !== 'running') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `仅 running 状态可发送命令，当前状态: ${row.status}`,
          },
        };
        res.status(409).json(errBody);
        return;
      }

      // v3.4.0: 更新活跃时间
      await touchInstance(db, row.id);

      const body = req.body as Partial<ServerCommandRequest>;
      if (typeof body.command !== 'string' || body.command.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 command 字段' },
        };
        res.status(400).json(errBody);
        return;
      }

      const cmdResp = await daemonClient.sendCommand(row.id, { command: body.command });

      const response: ServerCommandResponse = {
        server_id: row.id,
        output: cmdResp.output,
        success: cmdResp.success,
      };
      res.json(response);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:id/logs?limit=N — 读取实例控制台历史日志行（转发 Daemon）
  //
  // 用于 RconConsole 挂载时预填历史日志：用户离开控制台 tab/页面后返回时，
  // WS 只能拿到重新订阅后的新行，之前的历史日志会丢失。本端点从 Daemon 内存
  // 环形缓冲拉取最近 N 行，让前端能恢复上下文。
  // ----------------------------------------------------------------
  router.get('/:id/logs', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 500;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500;
      const lines = await daemonClient.getInstanceLogs(row.id, limit);
      res.json({ lines });
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // v3.6.1-A2: GET /api/servers/:id/disk-usage — 实例磁盘占用明细
  //   返回实例根目录总占用 + 子目录（backups/saves/mods/logs）占用
  //   通过 daemon exec du -sb 实时统计，与 DB 缓存的 disk_usage_bytes 配合使用：
  //   - 列表页读 DB 缓存（异步每日刷新）
  //   - 详情页/手动刷新调本端点拿实时值 + 子目录明细
  // ----------------------------------------------------------------
  router.get('/:id/disk-usage', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const instancesDir = path.resolve(process.env.INSTANCES_DIR ?? './instances');
      const instanceRoot = path.resolve(instancesDir, row.id);

      // v3.6.1: 优先使用 daemonClientService（节点感知），未注入时返回 503
      if (!daemonClientService) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_SERVICE_UNAVAILABLE',
            message: '磁盘占用查询服务未初始化（daemonClientService 缺失）',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      // 实例根目录总占用
      let totalBytes = 0;
      try {
        const duResp = await daemonClientService.execCommand(row.node_id, 'system', {
          binary: 'du',
          args: ['-sb', instanceRoot],
          timeout: 15_000,
        });
        if (duResp.exit_code === 0 && duResp.stdout) {
          const m = duResp.stdout.match(/^(\d+)/);
          if (m) totalBytes = parseInt(m[1], 10);
        }
      } catch (err) {
        // du 失败时返回 0 + 空 subdirs，不阻断响应
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), serverId: row.id },
          'disk-usage: du 总量查询失败',
        );
      }

      // 子目录占用（backups/saves/mods/logs）
      const subdirNames = ['backups', 'saves', 'mods', 'logs'];
      const subdirs: ServerDiskUsage['subdirs'] = [];
      for (const name of subdirNames) {
        const subdirPath = path.resolve(instanceRoot, name);
        try {
          const resp = await daemonClientService.execCommand(row.node_id, 'system', {
            binary: 'du',
            args: ['-sb', subdirPath],
            timeout: 10_000,
          });
          if (resp.exit_code === 0 && resp.stdout) {
            const m = resp.stdout.match(/^(\d+)/);
            subdirs.push({ name, bytes: m ? parseInt(m[1], 10) : 0 });
          } else {
            // 子目录不存在时 du 返回非零，记为 0
            subdirs.push({ name, bytes: 0 });
          }
        } catch {
          subdirs.push({ name, bytes: 0 });
        }
      }

      const usage: ServerDiskUsage = {
        server_id: row.id,
        total_bytes: totalBytes,
        subdirs,
        updated_at: new Date().toISOString(),
      };
      const body: ServerDiskUsageResponse = { usage };

      // 顺带刷新 DB 缓存（非阻塞，失败不影响响应）
      void db('servers')
        .where({ id: row.id })
        .update({
          disk_usage_bytes: totalBytes,
          disk_usage_updated_at: usage.updated_at,
        })
        .catch((err: unknown) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), serverId: row.id },
            'disk-usage: DB 缓存刷新失败',
          );
        });

      res.json(body);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // v3.6.2-A7: DELETE /api/servers/:id/subdir/:subdir — 子目录清理
  //   清理实例指定子目录（backups/saves/mods/logs/cache），复用 safeRemoveService
  //   running 状态下禁止清理（避免运行时删除关键文件）
  // ----------------------------------------------------------------
  router.delete('/:id/subdir/:subdir', async (req, res) => {
    try {
      if (!safeRemoveService) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_SERVICE_UNAVAILABLE', message: '子目录清理服务未启用' },
        };
        res.status(503).json(body);
        return;
      }

      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      // running 状态下禁止清理
      if (row.status === 'running' || row.status === 'starting') {
        const body: PanelErrorResponse = {
          error: {
            code: 'INVALID_SERVER_STATE',
            message: `实例 ${row.status === 'running' ? '运行中' : '启动中'}，无法清理子目录`,
          },
        };
        res.status(409).json(body);
        return;
      }

      const subdir = req.params.subdir;
      const result = await safeRemoveService.safeRemove({
        namespace: 'subdir',
        nodeId: row.node_id,
        serverId: row.id,
        subdir,
      });

      if (!result.success) {
        const body: PanelErrorResponse = {
          error: { code: 'SUBDIR_CLEANUP_FAILED', message: result.error ?? '清理失败' },
        };
        res.status(500).json(body);
        return;
      }

      const body: SubdirCleanupResponse = {
        server_id: row.id,
        subdir,
        freed_bytes: result.freed_bytes ?? 0,
      };
      res.json(body);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // P6: GET /api/servers/:id/log-files — 列出实例所有日志文件（转发 Daemon）
  // ----------------------------------------------------------------
  router.get('/:id/log-files', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const result = await daemonClient.listLogFiles(row.id);
      res.json(result);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // P6: GET /api/servers/:id/log-files/:filename?count=N — 读取指定日志文件（转发 Daemon）
  // ----------------------------------------------------------------
  router.get('/:id/log-files/:filename', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const filename = req.params.filename;
      const countRaw = req.query.count;
      const count =
        typeof countRaw === 'string' && countRaw.length > 0
          ? parseInt(countRaw, 10)
          : undefined;
      const safeCount =
        count !== undefined && Number.isFinite(count) && count > 0 ? count : undefined;

      const result = await daemonClient.readLogFile(row.id, filename, safeCount);
      res.json(result);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // P6: DELETE /api/servers/:id/log-files/:filename — 删除日志备份文件（转发 Daemon）
  // ----------------------------------------------------------------
  router.delete('/:id/log-files/:filename', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const filename = req.params.filename;
      await daemonClient.deleteLogFile(row.id, filename);
      // Daemon 返回 204，Panel 同样以 204 No Content 响应
      res.status(204).end();
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // P6: GET /api/servers/:id/players — 获取实例在线玩家列表（转发 Daemon）
  // ----------------------------------------------------------------
  router.get('/:id/players', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const row = await db<ServerRow>('servers').where({ id: req.params.id }).first();
      if (!row) {
        const errBody: PanelErrorResponse = {
          error: { code: 'SERVER_NOT_FOUND', message: `实例不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }

      const ownershipErr = checkOwnership(row, req.user!);
      if (ownershipErr) {
        res.status(403).json(ownershipErr);
        return;
      }

      const result = await daemonClient.getOnlinePlayers(row.id);
      res.json(result);
    } catch (err) {
      handleDaemonOrInternal(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function toSummary(row: ServerRowWithOwner): ServerSummary {
  return {
    id: row.id,
    name: row.name,
    pack_id: row.pack_id,
    game_type: row.game_type,
    node_id: row.node_id,
    owner_user_id: row.owner_user_id,
    // v4.22.7: LEFT JOIN 未匹配时 owner_username 为 null（owner_user_id 在 users 表不存在，
    //   即孤儿实例），兜底为 '未知' 避免前端 zod schema 校验失败导致整个 GET /servers 不可用
    owner_username: row.owner_username ?? '未知',
    status: row.status as InstanceState,
    port: row.port,
    rcon_port: row.rcon_port,
    current_version: row.current_version ?? null,
    last_activity_at: row.last_activity_at ?? null,
    disk_usage_bytes: row.disk_usage_bytes ?? null,
    disk_usage_updated_at: row.disk_usage_updated_at ?? null,
    // v1.1.0: 启动前置引导完成时间（null=未完成引导，前端据此判断是否弹向导）
    startup_config_set_at: row.startup_config_set_at ?? null,
    // v3-billing: 有效期字段
    expires_at: row.expires_at ?? null,
    expiry_status: (row.expiry_status ?? 'permanent') as 'permanent' | 'active' | 'grace' | 'expired' | 'cleaned',
    // v4.31.0: 部署节点名称（LEFT JOIN nodes 未匹配时为 null）
    node_name: row.node_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface JwtUser {
  userId: string;
  email: string;
  username: string;
  /** v4.19.2: 优先使用 active_role；role 字段保留向后兼容 */
  role: string;
  active_role?: string;
}

/**
 * 校验所有权：owner 自身或 server_admin 角色可访问
 */
function checkOwnership(row: ServerRow, user: JwtUser): PanelErrorResponse | null {
  if (row.owner_user_id === user.userId) {
    return null;
  }
  // v4.19.2: 优先 active_role（v4.17.0 新字段），降级 role（旧 JWT）
  const role = normalizeRole(user.active_role ?? user.role);
  if (role === Role.SERVER_ADMIN) {
    return null;
  }
  return {
    error: {
      code: 'PANEL_FORBIDDEN',
      message: '无权访问该实例',
    },
  };
}

/**
 * v4.16.1: GET /api/servers/:id 只读访问判定
 * v4.17.0: 升级到统一 bindings 表（binding_type='account', scope_type='instance', verify_status='verified'）
 * 在 checkOwnership（owner / server_admin）之上追加放行：持有该实例 active 绑定
 * （bindings.verify_status='verified'）的玩家——玩家门户店铺视图
 * （Banner 服务器名/状态叠加层、AccountBindingCard 的 game_type）需要只读实例摘要。
 * 暴露面说明：ServerSummary 无密码类机密字段（rcon_password_enc 不含），
 * port 本是玩家连接所需公开信息。
 * 注意：仅用于 GET /:id；写操作与运维操作仍走 checkOwnership，玩家一律 403。
 */
async function checkReadAccess(
  db: Knex,
  row: ServerRow,
  user: JwtUser,
): Promise<PanelErrorResponse | null> {
  const ownershipErr = checkOwnership(row, user);
  if (!ownershipErr) {
    return null;
  }
  try {
    // v4.17.0: 查统一 bindings 表（旧表 user_instance_bindings 已物理删除）
    const binding = await db('bindings')
      .where({
        user_id: user.userId,
        binding_type: 'account',
        scope_type: 'instance',
        scope_ref: row.id,
        verify_status: 'verified',
      })
      .first();
    if (binding) {
      return null;
    }
  } catch {
    // 表不存在（老库未迁移）→ 安全拒绝
  }
  return ownershipErr;
}

async function updateStatus(db: Knex, id: string, status: InstanceState): Promise<void> {
  await db<ServerRow>('servers').where({ id }).update({
    status,
    updated_at: new Date().toISOString(),
  });
}

/**
 * v3.4.0: 更新实例最后活跃时间
 */
async function touchInstance(db: Knex, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db<ServerRow>('servers').where({ id }).update({
    last_activity_at: now,
    updated_at: now,
  });
}

/**
 * P0 端口分配：在 base+随机偏移范围内寻找未被 servers 表占用的端口
 *
 * v3.8.0-S5: 支持 portRange 约束 [min, max]，候选端口必须落在该范围内。
 *   - 若 base 已在 [min, max] 内，则在 base 周围 [min, max] 子区间随机偏移
 *   - 若 base 不在 [min, max] 内，则在整个 [min, max] 区间内随机
 *   - 未提供 portRange 时退化为原 base + PORT_RANGE 行为
 */
async function allocatePort(
  db: Knex,
  column: 'port' | 'rcon_port',
  base: number,
  portRange?: { min: number; max: number },
): Promise<number> {
  // 收集已占用端口
  const rows = await db<ServerRow>('servers').select(column);
  const used = new Set<number>(rows.map((r) => r[column] as number));

  // v3.8.0-S5: 计算候选端口搜索区间
  let searchMin: number;
  let searchMax: number;
  if (portRange) {
    searchMin = portRange.min;
    searchMax = portRange.max;
    // 若 base 在区间内，以 base 为起点扩展（仍受 min/max 约束）
    if (base >= searchMin && base <= searchMax) {
      // 取 base 附近 ±PORT_RANGE/2，但裁剪到 [searchMin, searchMax]
      const halfRange = Math.min(PORT_RANGE, searchMax - searchMin) >> 1;
      searchMin = Math.max(searchMin, base - halfRange);
      searchMax = Math.min(searchMax, base + halfRange);
    }
  } else {
    searchMin = base;
    searchMax = base + PORT_RANGE;
  }

  const span = searchMax - searchMin;
  if (span <= 0) {
    throw new Error(`端口范围无效: [${searchMin}, ${searchMax}]`);
  }

  // 尝试随机偏移，最多 50 次
  for (let i = 0; i < 50; i++) {
    const candidate = searchMin + Math.floor(Math.random() * span);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  // 退化为顺序扫描
  for (let offset = 0; offset < span; offset++) {
    const candidate = searchMin + offset;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`无可用端口（range=[${searchMin}, ${searchMax}]）`);
}

async function isPortTaken(
  db: Knex,
  column: 'port' | 'rcon_port',
  value: number,
): Promise<boolean> {
  const row = await db<ServerRow>('servers').where(column, value).first();
  return row !== undefined;
}

function generateRconPassword(): string {
  // 16 字节随机 → hex 32 字符
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 初始化商城基础物品：从 Pack.items.static_list 复制到 shop_items 表。
 * - 仅复制 Pack 声明了 items.static_list 的物品
 * - 默认 quality='normal', vip_level_required=1, daily_limit=null, enabled=true
 * - 失败不阻断实例创建（由调用方 try/catch 包裹）
 */
async function initShopItemsFromPack(
  db: Knex,
  serverId: string,
  pack: GamePack,
  now: string,
): Promise<void> {
  const staticList = pack.items?.static_list;
  if (!staticList || staticList.length === 0) return;

  const rows = staticList.map((item) => ({
    server_id: serverId,
    item_name: item.name,
    quality: 'normal',
    vip_level_required: 1,
    daily_limit: null,
    enabled: true,
    created_at: now,
    updated_at: now,
  }));

  await db('shop_items').insert(rows);
}

function handleInternal(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'servers router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}

function handleDaemonOrInternal(
  res: Response,
  err: unknown,
  logger: Logger,
): void {
  if (err instanceof DaemonApiError) {
    logger.warn(
      { code: err.code, statusCode: err.statusCode, message: err.message },
      'daemon api error',
    );
    // 不可达 → 503 DAEMON_UNREACHABLE
    if (err.code === 'DAEMON_UNREACHABLE' || err.statusCode === 0) {
      const body: PanelErrorResponse = {
        error: { code: 'DAEMON_UNREACHABLE', message: `Daemon 不可达: ${err.message}` },
      };
      res.status(503).json(body);
      return;
    }
    // 其他 Daemon 错误透传为 502
    const body: PanelErrorResponse = {
      error: { code: 'DAEMON_UNREACHABLE', message: `Daemon 错误: ${err.message}` },
    };
    res.status(502).json(body);
    return;
  }
  handleInternal(res, err, logger);
}
