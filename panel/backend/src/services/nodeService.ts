// ============================================================================
// nodeService — Daemon 集群化管理服务（L2）
//
// 职责：
//   - 生成/校验 linkKey（邀请链接密钥，hash 存储，一次性）
//   - 生成/校验 commsKey（主从通信密钥，明文存储，双向信任）
//   - 创建邀请节点（server_admin 发起，返回 linkKey + slave 启动命令）
//   - slave 注册（linkSlave：验证 linkKey → 颁发 commsKey → 持久化）
//   - 节点列表/详情/删除（删除前校验无活跃实例）
//   - heartbeat 接收（更新 last_seen_at + status）
//   - 离线扫描（scheduler 定时调用，超时 slave 标记 offline）
//
// 设计要点：
//   - linkKey: `gsp_link_<32hex>`，128 位熵，仅创建邀请时返回一次明文，DB 存 SHA-256 hash
//   - commsKey: `gsp_comms_<32hex>`，slave 注册成功后由 master 颁发，DB 明文存储
//     （原因：master 需用它调用 slave daemon，slave 也需用它访问 master verify-token/heartbeat 端点，
//      双向信任，hash 存储无法满足双向验证需求）
//   - master 节点（node-local）不需要 comms_key，仅 slave 节点持有
//   - 注册成功后 link_key_hash 清空（一次性邀请码）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { AppError, ValidationError } from './errors.js';
import { generateBootstrapScript } from './bootstrapScriptTemplate.js';
import type { PanelWsServer } from '../websocket/server.js';
import type { PanelNodeStatusEvent } from '@public/schema/ws-events';
import { Role } from '../core/auth/roles.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const LINK_KEY_PREFIX = 'gsp_link_';
const COMMS_KEY_PREFIX = 'gsp_comms_';
const KEY_RANDOM_HEX_LEN = 32; // 128 位熵

/**
 * master Panel 的对外公开地址（slave 机器通过此地址访问 master）。
 * 由环境变量 PUBLIC_BASE_URL 配置，默认公网 HTTPS 地址（符合 rules 0.md）。
 */
const DEFAULT_MASTER_PUBLIC_URL = 'https://gsp.ecsrz.com:3001';
function getMasterPublicUrl(): string {
  const url = process.env.PUBLIC_BASE_URL;
  if (url) return url.replace(/\/+$/, ''); // 去尾部斜杠
  return DEFAULT_MASTER_PUBLIC_URL;
}

/**
 * linkKey 过期时间窗口（小时），由 SLAVE_LINK_KEY_TTL_HOURS 配置。
 * 默认 24 小时。生产环境不建议超过 72 小时。
 */
const DEFAULT_LINK_KEY_TTL_HOURS = 24;
function getLinkKeyTtlHours(): number {
  const raw = process.env.SLAVE_LINK_KEY_TTL_HOURS;
  if (!raw) return DEFAULT_LINK_KEY_TTL_HOURS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LINK_KEY_TTL_HOURS;
  }
  return parsed;
}

/** 计算 linkKey 过期时间（ISO 8601 字符串） */
function computeLinkKeyExpiry(): string {
  const ttlHours = getLinkKeyTtlHours();
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
}

/** heartbeat 上报的系统指标（slave → master） */
export interface NodeHeartbeatPayload {
  /** slave 节点 CPU 使用率（0-100） */
  cpu_percent?: number;
  /** slave 节点内存使用率（0-100） */
  memory_percent?: number;
  /** slave 节点磁盘使用率（0-100） */
  disk_percent?: number;
  /** slave 节点运行实例数 */
  instance_count?: number;
  /** slave daemon 版本号 */
  daemon_version?: string;
}

/** DB 行类型 */
interface NodeRow {
  id: string;
  name: string;
  fqdn: string;
  daemon_token_hash: string;
  public_ip: string | null;
  status: string;
  last_seen_at: string | null;
  node_type: string;
  comms_key: string | null;
  link_key_hash: string | null;
  link_key_expires_at: string | null;
  linked_at: string | null;
  display_fqdn: string | null;
  // v4.28.0 自带节点字段（migration 20260826000000）
  node_source: string;
  self_hosted_owner_id: string | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
}

/** 对外暴露的节点信息（不含敏感字段） */
export interface NodeInfo {
  id: string;
  name: string;
  fqdn: string;
  public_ip: string | null;
  status: 'online' | 'offline' | 'pending' | 'degraded';
  last_seen_at: string | null;
  node_type: 'master' | 'slave';
  linked_at: string | null;
  display_fqdn: string | null;
  /** linkKey 过期时间（ISO 8601），仅 pending 状态有意义；online 节点为 null */
  link_key_expires_at: string | null;
  // v4.28.0 自带节点字段
  node_source: 'platform_managed' | 'self_hosted';
  self_hosted_owner_id: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
}

// ---------------------------------------------------------------------------
// 错误类
// ---------------------------------------------------------------------------

export class NodeNotFoundError extends AppError {
  readonly code = 'NODE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = '节点不存在') {
    super(message);
  }
}

export class NodeLinkKeyInvalidError extends AppError {
  readonly code = 'NODE_LINK_KEY_INVALID';
  readonly httpStatus = 401;
  constructor(message = '邀请密钥无效或已使用') {
    super(message);
  }
}

export class NodeAlreadyLinkedError extends AppError {
  readonly code = 'NODE_ALREADY_LINKED';
  readonly httpStatus = 409;
  constructor(message = '该邀请码已被使用，节点已注册') {
    super(message);
  }
}

export class NodeHasActiveInstancesError extends AppError {
  readonly code = 'NODE_HAS_ACTIVE_INSTANCES';
  readonly httpStatus = 409;
  constructor(message = '节点下仍有未停止的实例，无法删除') {
    super(message);
  }
}

export class NodeCommsKeyInvalidError extends AppError {
  readonly code = 'NODE_COMMS_KEY_INVALID';
  readonly httpStatus = 401;
  constructor(message = '通信密钥无效') {
    super(message);
  }
}

export class NodeLinkKeyExpiredError extends AppError {
  readonly code = 'NODE_LINK_KEY_EXPIRED';
  readonly httpStatus = 401;
  constructor(message = '邀请密钥已过期，请重新生成邀请') {
    super(message);
  }
}

/**
 * v4.28.0 节点归属校验失败：
 *   - instance_admin 操作 platform_managed 节点（平台节点仅 server_admin 可操作）
 *   - instance_admin 操作他人 self_hosted 节点
 */
export class NodeNotOwnedError extends AppError {
  readonly code = 'NODE_NOT_OWNED';
  readonly httpStatus = 403;
  constructor(message = '无权操作此节点') {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 生成邀请密钥明文：`gsp_link_<32hex>` */
export function generateLinkKey(): string {
  const randomHex = crypto.randomBytes(KEY_RANDOM_HEX_LEN / 2).toString('hex');
  return `${LINK_KEY_PREFIX}${randomHex}`;
}

/** 生成通信密钥明文：`gsp_comms_<32hex>` */
export function generateCommsKey(): string {
  const randomHex = crypto.randomBytes(KEY_RANDOM_HEX_LEN / 2).toString('hex');
  return `${COMMS_KEY_PREFIX}${randomHex}`;
}

/** 计算邀请密钥的 SHA-256 hash */
export function hashLinkKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/** 校验邀请密钥明文格式 */
export function isValidLinkKeyFormat(key: string): boolean {
  if (!key.startsWith(LINK_KEY_PREFIX)) return false;
  const randomPart = key.slice(LINK_KEY_PREFIX.length);
  return /^[a-fA-F0-9]{32}$/.test(randomPart);
}

/** 校验通信密钥明文格式 */
export function isValidCommsKeyFormat(key: string): boolean {
  if (!key.startsWith(COMMS_KEY_PREFIX)) return false;
  const randomPart = key.slice(COMMS_KEY_PREFIX.length);
  return /^[a-fA-F0-9]{32}$/.test(randomPart);
}

function toNodeInfo(row: NodeRow): NodeInfo {
  return {
    id: row.id,
    name: row.name,
    fqdn: row.fqdn,
    public_ip: row.public_ip,
    status: row.status as NodeInfo['status'],
    last_seen_at: row.last_seen_at,
    node_type: row.node_type as 'master' | 'slave',
    linked_at: row.linked_at,
    display_fqdn: row.display_fqdn,
    link_key_expires_at: row.link_key_expires_at,
    // v4.28.0 自带节点字段
    node_source: row.node_source as 'platform_managed' | 'self_hosted',
    self_hosted_owner_id: row.self_hosted_owner_id,
    approval_status: row.approval_status as 'pending' | 'approved' | 'rejected',
    approved_by: row.approved_by,
    approved_at: row.approved_at,
  };
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 节点集群管理服务
 */
export class NodeService {
  private wsServer: PanelWsServer | null = null;

  constructor(
    private readonly db: Knex,
    private readonly logger: Logger,
  ) {}

  /** 注入 PanelWsServer（由 index.ts 在 WS 初始化后调用，启用节点状态广播） */
  setWsServer(ws: PanelWsServer | null): void {
    this.wsServer = ws;
  }

  /** 广播节点状态变更事件给所有已鉴权前端 */
  private broadcastNodeStatus(node: NodeInfo): void {
    if (!this.wsServer) return;
    const event: PanelNodeStatusEvent = {
      type: 'node.status',
      timestamp: new Date().toISOString(),
      node_id: node.id,
      node_name: node.name,
      node_type: node.node_type,
      status: node.status,
      last_seen_at: node.last_seen_at,
    };
    this.wsServer.broadcastToAll(event);
  }

  /**
   * 创建邀请节点（server_admin 或 instance_admin 发起）
   * 生成 linkKey 明文（仅此一次返回）+ 节点记录（status='pending'）
   *
   * v4.28.0 节点归属：
   *   - server_admin 创建 → node_source='platform_managed'（平台节点，approval_status='approved'）
   *   - instance_admin 创建 → node_source='self_hosted'（自带节点，approval_status='pending'，
   *     需 server_admin 审核；未开源期间 slave 永远不会注册成功）
   *
   * @param name 节点名称
   * @param ownerUserId 创建者用户 ID（写入 self_hosted_owner_id）
   * @param ownerRole 创建者角色（决定 node_source）
   * @param displayFqdn 可选的对外访问地址（用于前端展示，区别于 slave 自报的 fqdn）
   * @returns { nodeId, linkKey, slaveCommand, expiresAt }
   */
  async createInvite(
    name: string,
    ownerUserId: string,
    ownerRole: Role,
    displayFqdn?: string | null,
  ): Promise<{ nodeId: string; linkKey: string; slaveCommand: string; expiresAt: string }> {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('节点名称必填');
    }
    if (name.length > 100) {
      throw new ValidationError('节点名称长度不能超过 100');
    }
    if (!ownerUserId) {
      throw new ValidationError('ownerUserId 必填');
    }

    const linkKey = generateLinkKey();
    const linkKeyHash = hashLinkKey(linkKey);
    const nodeId = crypto.randomUUID();
    const expiresAt = computeLinkKeyExpiry();

    // v4.28.0 节点归属：server_admin → platform_managed；其他 → self_hosted
    const nodeSource: 'platform_managed' | 'self_hosted' =
      ownerRole === Role.SERVER_ADMIN ? 'platform_managed' : 'self_hosted';
    const selfHostedOwnerId = nodeSource === 'self_hosted' ? ownerUserId : null;
    // 未开源期间：self_hosted 默认 pending（需 server_admin 审核）；platform_managed 默认 approved
    const approvalStatus: 'pending' | 'approved' =
      nodeSource === 'self_hosted' ? 'pending' : 'approved';

    await this.db('nodes').insert({
      id: nodeId,
      name: name.trim(),
      fqdn: '', // slave 注册时填充
      daemon_token_hash: '',
      public_ip: null,
      status: 'pending',
      last_seen_at: null,
      node_type: 'slave',
      comms_key: null,
      link_key_hash: linkKeyHash,
      link_key_expires_at: expiresAt,
      linked_at: null,
      display_fqdn: displayFqdn ?? null,
      node_source: nodeSource,
      self_hosted_owner_id: selfHostedOwnerId,
      approval_status: approvalStatus,
    });

    this.logger.info(
      { nodeId, name, expiresAt, nodeSource, ownerId: ownerUserId, approvalStatus },
      '节点邀请已创建',
    );

    // slave daemon 启动引导（由前端展示，用户复制到 slave 机器执行）
    // v4.22.9: 改用 .env 写入方式，避免 LINK_KEY 进入 shell history / /proc/<pid>/environ
    // MASTER_URL 从 PUBLIC_BASE_URL 环境变量读取（默认公网 HTTPS，符合 rules 0.md）
    const masterUrl = getMasterPublicUrl();
    const slaveCommand = [
      `# 在项目 daemon 目录下创建 .env 后执行 npm start`,
      `cat >> daemon/.env << 'EOF'`,
      `SLAVE_MODE=true`,
      `MASTER_URL=${masterUrl}`,
      `LINK_KEY=${linkKey}`,
      `EOF`,
      `npm start`,
    ].join('\n');

    return { nodeId, linkKey, slaveCommand, expiresAt };
  }

  /**
   * 重新生成邀请密钥（失败重试时调用）
   * 仅对 pending 节点有效（已注册的节点 commsKey 已颁发，不能重新生成邀请）
   * @param nodeId 节点 ID
   * @returns { nodeId, linkKey, slaveCommand, expiresAt } 新的邀请密钥和启动命令
   */
  async regenerateInvite(
    nodeId: string,
  ): Promise<{ nodeId: string; linkKey: string; slaveCommand: string; expiresAt: string }> {
    const node = await this.db<NodeRow>('nodes').where({ id: nodeId }).first();
    if (!node) {
      throw new NodeNotFoundError(`节点不存在: ${nodeId}`);
    }
    if (node.node_type !== 'slave') {
      throw new ValidationError('主节点不支持重新生成邀请');
    }
    if (node.status === 'online' && node.comms_key) {
      throw new NodeAlreadyLinkedError();
    }

    const linkKey = generateLinkKey();
    const linkKeyHash = hashLinkKey(linkKey);
    const expiresAt = computeLinkKeyExpiry();

    await this.db('nodes').where({ id: nodeId }).update({
      link_key_hash: linkKeyHash,
      link_key_expires_at: expiresAt,
      status: 'pending',
    });

    this.logger.info({ nodeId, expiresAt }, '节点邀请密钥已重新生成');

    const masterUrl = getMasterPublicUrl();
    const slaveCommand = [
      `# 在项目 daemon 目录下创建 .env 后执行 npm start`,
      `cat >> daemon/.env << 'EOF'`,
      `SLAVE_MODE=true`,
      `MASTER_URL=${masterUrl}`,
      `LINK_KEY=${linkKey}`,
      `EOF`,
      `npm start`,
    ].join('\n');

    return { nodeId, linkKey, slaveCommand, expiresAt };
  }

  /**
   * 通过 linkKey 生成 slave-bootstrap.sh 脚本内容（GET /api/nodes/invite/:linkKey/bootstrap-script）
   *
   * 校验链：
   *   1. linkKey 格式合法
   *   2. 节点存在且为 slave 类型
   *   3. 节点 status='pending'（已注册的节点不允许下载脚本）
   *   4. linkKey 未过期
   *
   * @param linkKey 邀请密钥明文
   * @returns shell 脚本内容
   */
  async generateBootstrapScriptForLinkKey(linkKey: string): Promise<string> {
    if (!isValidLinkKeyFormat(linkKey)) {
      throw new NodeLinkKeyInvalidError();
    }

    const linkKeyHash = hashLinkKey(linkKey);
    const node = await this.db<NodeRow>('nodes')
      .where({ link_key_hash: linkKeyHash, node_type: 'slave' })
      .first();

    if (!node) {
      throw new NodeLinkKeyInvalidError();
    }
    if (node.status !== 'pending') {
      throw new NodeAlreadyLinkedError('节点已注册，无法下载部署脚本');
    }
    // linkKey 过期校验
    if (node.link_key_expires_at) {
      const expiryTime = Date.parse(node.link_key_expires_at);
      if (Number.isFinite(expiryTime) && expiryTime < Date.now()) {
        throw new NodeLinkKeyExpiredError();
      }
    }

    return generateBootstrapScript({
      masterUrl: getMasterPublicUrl(),
      linkKey,
    });
  }

  /**
   * slave 注册（slave daemon 启动时调用，公开端点）
   * 验证 linkKey → 生成 commsKey → 更新节点记录 → 返回 commsKey
   * @param slaveUrl slave daemon 的 HTTP 访问地址（如 http://192.168.1.10:8080）
   * @param linkKey 邀请密钥明文
   * @param displayFqdn 可选的对外展示地址
   * @returns { nodeId, commsKey }
   */
  async linkSlave(
    slaveUrl: string,
    linkKey: string,
    displayFqdn?: string | null,
  ): Promise<{ nodeId: string; commsKey: string }> {
    if (!slaveUrl || typeof slaveUrl !== 'string') {
      throw new ValidationError('slaveUrl 必填');
    }
    if (!isValidLinkKeyFormat(linkKey)) {
      throw new NodeLinkKeyInvalidError();
    }

    const linkKeyHash = hashLinkKey(linkKey);
    const node = await this.db<NodeRow>('nodes')
      .where({ link_key_hash: linkKeyHash, node_type: 'slave' })
      .first();

    if (!node) {
      throw new NodeLinkKeyInvalidError();
    }
    if (node.status === 'online' && node.comms_key) {
      throw new NodeAlreadyLinkedError();
    }
    // v4.22.9: linkKey 过期校验
    // link_key_expires_at 为 NULL 视为「未设过期」（向后兼容历史 pending 节点迁移后也有值）
    if (node.link_key_expires_at) {
      const expiryTime = Date.parse(node.link_key_expires_at);
      if (Number.isFinite(expiryTime) && expiryTime < Date.now()) {
        throw new NodeLinkKeyExpiredError();
      }
    }

    const commsKey = generateCommsKey();
    const now = new Date().toISOString();

    await this.db('nodes').where({ id: node.id }).update({
      fqdn: slaveUrl,
      comms_key: commsKey,
      status: 'online',
      last_seen_at: now,
      linked_at: now,
      display_fqdn: displayFqdn ?? node.display_fqdn,
      link_key_hash: null, // 一次性邀请码，注册后清空
      link_key_expires_at: null, // 注册后清空过期时间
    });

    this.logger.info({ nodeId: node.id, slaveUrl }, 'slave 节点注册成功');

    // 广播 node.status 事件，通知前端节点已上线
    this.broadcastNodeStatus({
      id: node.id,
      name: node.name,
      fqdn: slaveUrl,
      public_ip: node.public_ip,
      status: 'online',
      last_seen_at: now,
      node_type: 'slave',
      linked_at: now,
      display_fqdn: displayFqdn ?? node.display_fqdn,
      link_key_expires_at: null, // 注册后已清空
      // v4.28.0 节点归属字段（注册成功后保留原归属信息）
      node_source: node.node_source as 'platform_managed' | 'self_hosted',
      self_hosted_owner_id: node.self_hosted_owner_id,
      approval_status: node.approval_status as 'pending' | 'approved' | 'rejected',
      approved_by: node.approved_by,
      approved_at: node.approved_at,
    });

    return { nodeId: node.id, commsKey };
  }

  /**
   * 列出节点（不含敏感字段）
   *
   * v4.28.0 角色筛选：
   *   - server_admin：返回全部节点（platform_managed + 所有 self_hosted）
   *   - instance_admin：返回「自有 self_hosted 节点」+「所有 platform_managed 节点」
   *     （platform_managed 对 instance_admin 只读，仅 server_admin 可操作）
   *   - user：理论上路由层不会放行到此处（requireRole 拦截），防御性返回空数组
   *
   * v4.22.8: 修复排序字段——nodes 表实际没有 created_at 列，原查询会触发
   *   SQLITE_ERROR: no such column: created_at，导致整个 GET /api/nodes 500。
   *   改用 linked_at（slave 注册时间）作为次排序，master 节点 linked_at=null
   *   在 SQLite DESC 排序中会排在最后，但 node_type asc 已保证 master 在前。
   */
  async listNodes(
    viewerRole: Role,
    viewerUserId: string,
  ): Promise<NodeInfo[]> {
    const query = this.db<NodeRow>('nodes');

    // 非 server_admin：仅返回自有 self_hosted + 所有 platform_managed
    if (viewerRole !== Role.SERVER_ADMIN) {
      query.where(function () {
        this.where('self_hosted_owner_id', viewerUserId).orWhere('node_source', 'platform_managed');
      });
    }

    const rows = await query.orderBy([
      { column: 'node_type', order: 'asc' }, // master 在前
      { column: 'linked_at', order: 'desc' }, // 最近注册的 slave 在前
    ]);
    return rows.map(toNodeInfo);
  }

  /**
   * 获取单个节点详情
   */
  async getNode(id: string): Promise<NodeInfo> {
    const row = await this.db<NodeRow>('nodes').where({ id }).first();
    if (!row) {
      throw new NodeNotFoundError(`节点不存在: ${id}`);
    }
    return toNodeInfo(row);
  }

  /**
   * 删除节点（仅 slave 且无活跃实例可删除）
   * master 节点（node-local）不允许删除
   */
  async deleteNode(id: string): Promise<void> {
    const node = await this.db<NodeRow>('nodes').where({ id }).first();
    if (!node) {
      throw new NodeNotFoundError(`节点不存在: ${id}`);
    }
    if (node.node_type === 'master') {
      throw new ValidationError('master 节点不允许删除');
    }

    // 校验无活跃实例（status != 'stopped'）
    const activeCount = await this.db('servers')
      .where({ node_id: id })
      .whereNot('status', 'stopped')
      .count('id as cnt')
      .first();
    const count = Number(activeCount?.cnt ?? 0);
    if (count > 0) {
      throw new NodeHasActiveInstancesError(`节点下仍有 ${count} 个未停止的实例`);
    }

    await this.db('nodes').where({ id }).delete();
    this.logger.info({ nodeId: id }, 'slave 节点已删除');
  }

  /**
   * 校验节点归属（v4.28.0 节点归属权限控制）
   *
   * 规则：
   *   - server_admin：全通过（可操作任意节点）
   *   - instance_admin：
   *     ✅ 自有 self_hosted 节点（self_hosted_owner_id === viewerUserId）
   *     ❌ 他人 self_hosted 节点 → NodeNotOwnedError 403
   *     ❌ platform_managed 节点 → NodeNotOwnedError 403（平台节点仅 server_admin 可操作）
   *   - user：理论上路由层不会放行到此处
   *
   * 用法：作为中间件在路由层调用，校验失败抛错由 handleNodeError 转换为 HTTP 403/404
   *
   * @param nodeId 节点 ID
   * @param viewerRole 当前操作者角色
   * @param viewerUserId 当前操作者用户 ID
   * @throws {NodeNotFoundError} 节点不存在（404）
   * @throws {NodeNotOwnedError} 无权操作此节点（403）
   */
  async assertNodeOwnedByUser(
    nodeId: string,
    viewerRole: Role,
    viewerUserId: string,
  ): Promise<void> {
    // server_admin 全通过
    if (viewerRole === Role.SERVER_ADMIN) return;

    const node = await this.db<NodeRow>('nodes')
      .select('id', 'node_source', 'self_hosted_owner_id')
      .where({ id: nodeId })
      .first();
    if (!node) {
      throw new NodeNotFoundError(`节点不存在: ${nodeId}`);
    }
    // platform_managed 节点：仅 server_admin 可操作
    if (node.node_source === 'platform_managed') {
      throw new NodeNotOwnedError('平台节点仅系统管理员可操作');
    }
    // self_hosted 节点：必须 owner 匹配
    if (node.self_hosted_owner_id !== viewerUserId) {
      throw new NodeNotOwnedError('无权操作他人节点');
    }
  }

  /**
   * 校验通信密钥（slave 调用 master verify-token/heartbeat 端点时使用）
   * @returns NodeRow | null（null 表示无效）
   */
  async verifyCommsKey(commsKey: string): Promise<NodeRow | null> {
    if (!isValidCommsKeyFormat(commsKey)) {
      return null;
    }
    const node = await this.db<NodeRow>('nodes')
      .where({ comms_key: commsKey, node_type: 'slave' })
      .first();
    return node ?? null;
  }

  /**
   * 接收 slave heartbeat 上报
   * 更新 last_seen_at + status='online'，可选缓存指标到日志
   * @param nodeId slave 节点 ID
   * @param payload 系统指标（可选）
   */
  async heartbeat(nodeId: string, payload: NodeHeartbeatPayload): Promise<void> {
    const now = new Date().toISOString();
    const updated = await this.db('nodes').where({ id: nodeId, node_type: 'slave' }).update({
      last_seen_at: now,
      status: 'online',
    });
    if (updated === 0) {
      throw new NodeNotFoundError(`slave 节点不存在: ${nodeId}`);
    }
    this.logger.debug(
      { nodeId, ...payload },
      'slave heartbeat 已接收',
    );
  }

  /**
   * 离线扫描（scheduler 定时调用）
   * 将超过 staleMs 未上报的 slave 节点标记为 offline
   * @param staleMs 超时阈值（默认 15s）
   * @returns 被标记为 offline 的节点数
   */
  async markStaleNodesOffline(staleMs = 15_000): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const staleNodes = await this.db<NodeRow>('nodes')
      .where({ node_type: 'slave', status: 'online' })
      .where('last_seen_at', '<', cutoff)
      .select(
        'id',
        'name',
        'fqdn',
        'public_ip',
        'last_seen_at',
        'linked_at',
        'display_fqdn',
        // v4.28.0 节点归属字段（广播事件需要）
        'node_source',
        'self_hosted_owner_id',
        'approval_status',
        'approved_by',
        'approved_at',
      );

    if (staleNodes.length === 0) {
      return 0;
    }

    const staleIds = staleNodes.map((n) => n.id);
    await this.db('nodes').whereIn('id', staleIds).update({ status: 'offline' });

    for (const n of staleNodes) {
      this.logger.warn({ nodeId: n.id, name: n.name }, 'slave 节点超时未上报，标记为 offline');
      // 广播 node.status 事件，通知前端节点已离线
      this.broadcastNodeStatus({
        id: n.id,
        name: n.name,
        fqdn: n.fqdn,
        public_ip: n.public_ip,
        status: 'offline',
        last_seen_at: n.last_seen_at,
        node_type: 'slave',
        linked_at: n.linked_at,
        display_fqdn: n.display_fqdn,
        link_key_expires_at: null, // 离线节点必然已注册（非 pending），link_key_expires_at 为 null
        // v4.28.0 节点归属字段
        node_source: n.node_source as 'platform_managed' | 'self_hosted',
        self_hosted_owner_id: n.self_hosted_owner_id,
        approval_status: n.approval_status as 'pending' | 'approved' | 'rejected',
        approved_by: n.approved_by,
        approved_at: n.approved_at,
      });
    }
    return staleNodes.length;
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

export function createNodeService(db: Knex, logger: Logger): NodeService {
  return new NodeService(db, logger);
}
