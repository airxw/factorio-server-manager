// ============================================================================
// Panel ↔ Frontend REST API 类型契约
// 依据：spec §3.7.2
// 鉴权：JWT（除 /api/health 和 /api/auth/login 外）
// @version 3.1.0
//   - 3.1.0: UserRole 升 3 级 (server_admin/instance_admin/user)；
//            新增 RegisterRequest/RegisterResponse、CreateUserRequest、
//            UpdateUserRoleRequest、DeleteUserResponse；
//            UserInfo/AdminUserSummary.status 扩展 'deleted'；
// @version 4.17.0
//   - 4.17.0: 统一绑定 + 多角色切换重构（方案C-激进重设计）
//            新增：Binding / BindingType / BindingScopeType / BindingVerifyStatus
//                  PermissionPoint / PermissionCategory / RolePermissionTemplate
//                  SelectRoleRequest/Response、ListUserRolesResponse、UpdateUserRolesRequest/Response
//                  RevokeUserTokensResponse、WebhookEvent / WebhookEventType / WebhookEventPayload
//                  VerifyBindingViaWebhookRequest/Response
//            UserInfo/AdminUserSummary 新增 roles / active_role（过渡期保留 role 字段）
//            旧 PlayerBindingSummary 标记 @deprecated（v4.18.0 删除）
// @version 4.20.0
//   - 4.20.0: Setup Wizard v2 全面重构（方案 setup-wizard-v2-configuration-plan.md）
//            新增：DatabaseType / DatabaseConfig / DaemonNodeInput
//                  TestDatabaseConnectionRequest / TestDatabaseConnectionResponse
//                  RestartTriggerRequest / RestartTriggerResponse
//            InitRequest 扩展可选字段：database / daemon_nodes / public_base_url / skip_daemon
//            InitSubmitResponse 扩展可选字段：restart_token / env_updated / nodes_added
//            InitPreflightCheck.actionable 语义强化（true=可在向导内修复）
//            旧字段保留向后兼容（admin_password / database_ack）
// @version 4.28.0
//   - 4.28.0: 全员服主——同级身份免密切换（方案 universal-role-switching-plan.md）
//            新增：SwitchRoleRequest / SwitchRoleResponse（POST /api/auth/switch-role，
//            JWT-only 免密，等级闸门 ≤2；server_admin 仍走 select-role 密码通道）
// @version 4.29.8
//   - 4.29.8: 修复 error 状态死锁（方案 error-state-recovery-plan.md）
//            DELETE /api/servers/:id 放开 error 状态（best-effort 调 daemon 清理）
//            POST /api/servers/:id/stop 放开 error 状态（daemon 失败 DB 回滚到 error）
//            新增：ServerResetStateRequest / ServerResetStateResponse
//                  （POST /api/servers/:id/reset-state，仅 server_admin，仅 error 状态）
// @version 4.30.0  (MINOR, 2026-07-29)
//   - 启动前置引导机制（方案 instance-startup-guide-and-action-bar-plan.md）
//     新增：GetStartupGuideResponse / SaveStartupConfigRequest / SaveStartupConfigResponse
//           StartupConfigIncompleteDetails
//           （GET /api/servers/:id/startup-guide、PUT /api/servers/:id/startup-config）
//     新增错误码：STARTUP_CONFIG_INCOMPLETE / STARTUP_CONFIG_INVALID
//     ServerSummary 新增 startup_config_set_at（null=未完成引导，前端据此弹向导）
//     CreateServerRequest.port / rcon_port 标记 @deprecated（端口锁定为实例不可变属性）
//   - 变更类型：MINOR（新增可选字段 + 新增接口），按 rules-3 §六 通知依赖模块，不阻断
// @version 4.31.0  (MINOR, 2026-07-29)
//   - 管理员实例管理入口完善（方案 admin-instance-mgmt-plan.md）
//     ServerSummary 新增 node_name（JOIN nodes 表，孤儿节点为 null）
//     新增：NodeInstancesResponse（GET /api/nodes/:id/instances 响应）
//     新增：UpdateServerExpiryRequest（PATCH /api/servers/:id 请求体）
//   - 变更类型：MINOR（新增可选字段 + 新增接口），按 rules-3 §六 通知依赖模块，不阻断
// ============================================================================

import type { InstanceState } from './daemon-api-types';
import type { UITabObject } from './pack-schema';

// ----- 用户与鉴权 -----
/** 3 级用户角色：server_admin > instance_admin > user */
export type UserRole = 'server_admin' | 'instance_admin' | 'user';

/**
 * v4.17.0 角色集合（多值）
 * - 一个账号可同时拥有多身份（如 ['user', 'instance_admin']）
 * - 数组元素唯一，至少一个角色
 * - active_role 必须 ∈ roles（应用层校验）
 */
export type UserRoles = UserRole[];

export interface UserInfo {
  id: string;
  email: string;
  username: string;
  /** @deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除。新代码用 active_role */
  role: UserRole;
  /** v4.17.0 新增：角色集合（多值），至少包含一个角色 */
  roles?: UserRoles;
  /** v4.17.0 新增：当前活动角色（会话级，登录时选定） */
  active_role?: UserRole;
  status: 'active' | 'disabled' | 'deleted';
  created_at: string;
  /** v4.0.2: 系统内置账号标记，1=演示账号（前端 Profile 改密时拦截） */
  is_built_in?: number;
}

// POST /api/auth/login
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserInfo;
}

// POST /api/auth/register
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface RegisterResponse {
  userId: string;
  verifyCode: string;
  token: string;
  user: UserInfo;
}

// GET /api/auth/me
export interface MeResponse {
  user: UserInfo;
}

// ----- Pack -----
// GET /api/packs
export interface PackSummary {
  id: string;
  game: string;
  variant: string;
  display_name: string;
  version: string;
  /**
   * Pack 声明的 UI tab 列表（前端据此动态渲染 tab）
   *
   * v3.7.0: 统一为对象数组格式（loader 已规范化 string 形式为 { tab, group, order })
   * - tab: tab 标识（console/config-files/players/...）
   * - group: 分组（runtime/config/ops/business）
   * - order: 组内排序（数字越小越靠前，默认 100）
   * - require_state: 仅在指定实例状态下显示
   */
  ui_tabs?: UITabObject[];
}

export interface ListPacksResponse {
  packs: PackSummary[];
}

// ----- Server（实例，Panel 视角） -----
export interface ServerSummary {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  node_id: string;
  owner_user_id: string;
  owner_username: string;
  status: InstanceState;
  port: number;
  rcon_port: number;
  /** v3.4.0: 实例当前使用的游戏版本号 */
  current_version: string | null;
  /** v3.4.0: 最后活跃时间 */
  last_activity_at: string | null;
  /** v3.6.1: 实例磁盘占用（字节），由 scheduler 每日刷新缓存 */
  disk_usage_bytes: number | null;
  /** v3.6.1: 磁盘占用上次刷新时间（ISO 8601） */
  disk_usage_updated_at: string | null;
  /** v1.1.0: 启动前置引导配置完成时间（ISO 8601），null 表示尚未完成引导（首次启动需弹向导） */
  startup_config_set_at: string | null;
  /** v3-billing: 实例过期时间（ISO 8601），null=永久实例。对齐 server-schema.json expires_at */
  expires_at: string | null;
  /** v3-billing: 过期状态机：permanent=永久；active=有效期内；grace=宽限期；expired=已过期；cleaned=已清理 */
  expiry_status: 'permanent' | 'active' | 'grace' | 'expired' | 'cleaned';
  /** v4.31.0: 部署节点名称（JOIN nodes 表，孤儿节点为 null） */
  node_name: string | null;
  created_at: string;
  updated_at: string;
}

/** v4.31.0: GET /api/nodes/:id/instances 响应体 */
export interface NodeInstancesResponse {
  node_name: string;
  instances: ServerSummary[];
}

/** v4.31.0: PATCH /api/servers/:id 请求体（管理员修改实例有效期） */
export interface UpdateServerExpiryRequest {
  /** 有效期天数。null=永久；36500 视为永久；其他正整数=对应天数 */
  duration_days: number | null;
}

// v3.6.1: 节点磁盘占用（GET /api/nodes/:id/disk-usage）
export interface NodeDiskUsage {
  node_id: string;
  filesystem: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  /** 0-100 整数 */
  used_percent: number;
  mount: string;
}

export interface NodeDiskUsageResponse {
  usage: NodeDiskUsage;
}

// ----- L2: Daemon 集群化管理（主从节点） -----
export type NodeType = 'master' | 'slave';
export type NodeStatus = 'online' | 'offline' | 'pending' | 'degraded';

/**
 * v4.28.0 节点归属类型
 *   - platform_managed：平台托管节点（server_admin 创建，归属平台）
 *   - self_hosted：自带节点（instance_admin 创建，归属创建者）
 */
export type NodeSource = 'platform_managed' | 'self_hosted';

/**
 * v4.28.0 节点审批状态
 *   - pending：待审批（self_hosted 节点创建后默认状态）
 *   - approved：已通过（platform_managed 节点默认状态；self_hosted 经 server_admin 审批后通过）
 *   - rejected：已驳回
 */
export type NodeApprovalStatus = 'pending' | 'approved' | 'rejected';

/** 节点信息（GET /api/nodes / GET /api/nodes/:id） */
export interface NodeClusterInfo {
  id: string;
  name: string;
  /** slave 节点的 daemon HTTP 访问地址（master 为空字符串） */
  fqdn: string;
  public_ip: string | null;
  status: NodeStatus;
  last_seen_at: string | null;
  node_type: NodeType;
  /** slave 注册成功时间（master 为 null） */
  linked_at: string | null;
  /** 对外展示地址（区别于内部通信 fqdn） */
  display_fqdn: string | null;
  /** linkKey 过期时间（ISO 8601），仅 pending 状态有意义；online 节点为 null */
  link_key_expires_at: string | null;
  /** v4.28.0 节点归属：platform_managed=平台托管 / self_hosted=自带节点 */
  node_source: NodeSource;
  /** v4.28.0 自带节点归属用户 ID（仅 self_hosted 节点有值，platform_managed 为 null） */
  self_hosted_owner_id: string | null;
  /** v4.28.0 节点审批状态：platform_managed 默认 approved；self_hosted 默认 pending */
  approval_status: NodeApprovalStatus;
  /** v4.28.0 审批人用户 ID（仅 self_hosted 节点经审批后有值） */
  approved_by: string | null;
  /** v4.28.0 审批时间（ISO 8601，仅 self_hosted 节点经审批后有值） */
  approved_at: string | null;
}

/** GET /api/nodes 响应（L2 扩展，从 DB 读取） */
export interface ListNodeClusterResponse {
  nodes: NodeClusterInfo[];
}

/** GET /api/nodes/:id 响应 */
export interface NodeDetailResponse {
  node: NodeClusterInfo;
}

/** POST /api/nodes 请求体（server_admin 创建邀请） */
export interface CreateNodeInviteRequest {
  name: string;
  /** 可选的对外展示地址 */
  display_fqdn?: string;
}

/** POST /api/nodes 响应（创建邀请成功，linkKey 仅此一次返回） */
export interface CreateNodeInviteResponse {
  node_id: string;
  /** 邀请密钥明文（仅此一次返回，需妥善保存） */
  link_key: string;
  /** slave daemon 启动命令模板（前端展示，用户复制到 slave 机器执行） */
  slave_command: string;
  /** linkKey 过期时间（ISO 8601），超时后 slave 无法用此 linkKey 注册。由 SLAVE_LINK_KEY_TTL_HOURS 配置控制（默认 24h） */
  expires_at: string;
}

/** POST /api/nodes/link 请求体（slave daemon 启动时调用，公开端点） */
export interface LinkSlaveRequest {
  /** slave daemon 的 HTTP 访问地址，如 http://192.168.1.10:8080 */
  slave_url: string;
  /** 邀请密钥明文 */
  link_key: string;
  /** 可选的对外展示地址 */
  display_fqdn?: string;
}

/** POST /api/nodes/link 响应（slave 注册成功，commsKey 仅此一次返回） */
export interface LinkSlaveResponse {
  node_id: string;
  /** 通信密钥明文（slave 持久化，用于后续 heartbeat/verify-token 调用） */
  comms_key: string;
}

/** POST /api/nodes/:id/heartbeat 请求体（slave 定时上报，commsKey 鉴权） */
export interface NodeHeartbeatRequest {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  instance_count?: number;
  daemon_version?: string;
}

/** POST /api/nodes/:id/heartbeat 响应 */
export interface NodeHeartbeatResponse {
  received: true;
}

/** POST /api/nodes/verify-token 请求体（slave 调用 master 验证 panel user token，commsKey 鉴权） */
export interface VerifyTokenRequest {
  /** panel 用户 JWT 或 API Key */
  token: string;
  /** 资源范围校验（可选）：如 instance_id */
  resource?: string;
}

/** POST /api/nodes/verify-token 响应 */
export interface VerifyTokenResponse {
  valid: boolean;
  /** 用户 ID（valid=true 时返回） */
  user_id?: string;
  /** 用户角色（valid=true 时返回） */
  role?: string;
  /** 错误原因（valid=false 时返回） */
  reason?: string;
}

/** DELETE /api/nodes/:id 响应 */
export interface DeleteNodeResponse {
  id: string;
  deleted: true;
}

// v3.6.1: 实例磁盘占用（GET /api/servers/:id/disk-usage）
export interface ServerDiskUsageSubdir {
  /** 子目录名：backups/saves/mods/logs */
  name: string;
  bytes: number;
}

export interface ServerDiskUsage {
  server_id: string;
  /** 实例根目录总占用（字节） */
  total_bytes: number;
  /** 子目录占用明细 */
  subdirs: ServerDiskUsageSubdir[];
  /** 统计时间（ISO 8601） */
  updated_at: string;
}

export interface ServerDiskUsageResponse {
  usage: ServerDiskUsage;
}

// GET /api/servers
export interface ListServersResponse {
  servers: ServerSummary[];
}

// POST /api/servers
export interface CreateServerRequest {
  name: string;
  pack_id: string;
  node_id: string;
  /** v3.4.0: 实例使用的游戏版本 ID（取自 game_versions.id），不传则默认最新 */
  version_id?: string;
  /** @deprecated v1.1.0 端口锁定为实例不可变属性，前端不再传，后端强制自动分配并忽略此字段 */
  port?: number;
  /** @deprecated v1.1.0 同上，RCON 端口锁定，前端不再传 */
  rcon_port?: number;
  resource_limits?: {
    memory?: string;
    disk?: string;
    cpu?: number;
  };
}

export interface CreateServerResponse {
  server: ServerSummary;
}

// GET /api/servers/:id
export interface ServerDetailResponse {
  server: ServerSummary;
}

// DELETE /api/servers/:id（stopped 或 error 状态可删除；error 状态下 best-effort 调 daemon 清理）
export interface DeleteServerResponse {
  id: string;
  deleted: boolean;
}

// ----- Server 生命周期动作（转发到 Daemon） -----
// POST /api/servers/:id/start
export interface ServerStartResponse {
  server_id: string;
  status: 'starting';
  pid: number;
}

// POST /api/servers/:id/stop（running/starting/error 状态可停止；error 状态下 daemon 失败 DB 回滚到 error）
export interface ServerStopResponse {
  server_id: string;
  status: 'stopping';
}

// POST /api/servers/:id/reset-state — 强制将 error 状态重置为 stopped（仅 server_admin，v4.29.8）
// 异常契约：
//   - 409 INVALID_SERVER_STATE：当前状态非 error
//   - 403 PANEL_FORBIDDEN：当前用户非 server_admin
export interface ServerResetStateRequest {}

export interface ServerResetStateResponse {
  server_id: string;
  previous_status: InstanceState;
  current_status: 'stopped';
}

// ----- 启动前置引导（v1.1.0 新增，方案 instance-startup-guide-and-action-bar-plan.md） -----
// GET /api/servers/:id/startup-guide
//   返回该实例对应 Pack 的 startup_guide 声明 + 当前已填写的 startup_config
//   前端启动向导据此渲染分步表单
export interface GetStartupGuideResponse {
  /** Pack 声明的启动前置引导（无声明则 null，表示该游戏无需引导，可直接启动） */
  guide: import('./pack-schema').StartupGuide | null;
  /** 当前已保存的启动配置（startup_config_json 解析结果，未填写则为空对象） */
  current_config: Record<string, string | number | boolean>;
  /** 是否已完成引导（已覆盖所有 required 字段） */
  completed: boolean;
}

// PUT /api/servers/:id/startup-config
//   保存用户在启动向导中填写的基础设定，并按 config_writes 写入实例配置文件
//   异常契约：
//     - 400 STARTUP_CONFIG_INVALID：字段值类型/范围不符
//     - 409 STARTUP_CONFIG_INCOMPLETE：未覆盖所有 required 字段（附 missing_fields）
export interface SaveStartupConfigRequest {
  /** 字段 key → 字段值（key 对应 StartupGuideField.key） */
  config: Record<string, string | number | boolean>;
}

export interface SaveStartupConfigResponse {
  server_id: string;
  /** 是否已覆盖所有 required 字段 */
  completed: boolean;
  /** 仍缺失的 required 字段 key 清单（completed=false 时非空） */
  missing_fields: string[];
  /** 配置文件写入结果（file → 是否成功） */
  config_writes: { file: string; success: boolean; error?: string }[];
}

// POST /api/servers/:id/start 在启动配置未完成时的 409 响应扩展
// 错误码 STARTUP_CONFIG_INCOMPLETE 的 details 字段结构
export interface StartupConfigIncompleteDetails {
  /** 缺失的 required 字段 key 清单 */
  missing_fields: string[];
  /** 缺失字段所属步骤 key 清单 */
  missing_steps: string[];
}

// POST /api/servers/:id/command
export interface ServerCommandRequest {
  command: string;
}

export interface ServerCommandResponse {
  server_id: string;
  output: string | null;
  success: boolean;
}

// ----- 错误码与异常契约 -----
export const PanelErrorCode = {
  UNAUTHORIZED: 'PANEL_UNAUTHORIZED',
  FORBIDDEN: 'PANEL_FORBIDDEN',
  VALIDATION_ERROR: 'PANEL_VALIDATION_ERROR',
  SERVER_NOT_FOUND: 'SERVER_NOT_FOUND',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  DAEMON_UNREACHABLE: 'DAEMON_UNREACHABLE',
  INVALID_SERVER_STATE: 'INVALID_SERVER_STATE',
  // v1.1.0 启动前置引导相关错误码
  STARTUP_CONFIG_INCOMPLETE: 'STARTUP_CONFIG_INCOMPLETE',
  STARTUP_CONFIG_INVALID: 'STARTUP_CONFIG_INVALID',
  INTERNAL_ERROR: 'PANEL_INTERNAL_ERROR',
  // P1 新增错误码
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
  VERIFY_CODE_INVALID: 'VERIFY_CODE_INVALID',
  VIP_PERMISSION_NOT_FOUND: 'VIP_PERMISSION_NOT_FOUND',
  VIP_LEVEL_INSUFFICIENT: 'VIP_LEVEL_INSUFFICIENT',
  COMMAND_RENDER_FAILED: 'COMMAND_RENDER_FAILED',
  COMMAND_QUEUE_FULL: 'COMMAND_QUEUE_FULL',
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  INSTANCE_NOT_RUNNING: 'INSTANCE_NOT_RUNNING',
  ITEM_SYNC_FAILED: 'ITEM_SYNC_FAILED',
  // P2 新增错误码
  SHOP_ITEM_NOT_FOUND: 'SHOP_ITEM_NOT_FOUND',
  SHOP_ORDER_NOT_FOUND: 'SHOP_ORDER_NOT_FOUND',
  SHOP_ORDER_ALREADY_CLAIMED: 'SHOP_ORDER_ALREADY_CLAIMED',
  SHOP_ORDER_EXPIRED: 'SHOP_ORDER_EXPIRED',
  CDK_NOT_FOUND: 'CDK_NOT_FOUND',
  CDK_ALREADY_CLAIMED: 'CDK_ALREADY_CLAIMED',
  CDK_EXPIRED: 'CDK_EXPIRED',
  // v3.6.1 新增错误码
  PANEL_SERVICE_UNAVAILABLE: 'PANEL_SERVICE_UNAVAILABLE',
  NODE_DISK_USAGE_FAILED: 'NODE_DISK_USAGE_FAILED',
  NODE_DISK_USAGE_PARSE_FAILED: 'NODE_DISK_USAGE_PARSE_FAILED',
  // v3.6.2 新增错误码
  MAINTENANCE_TABLE_NOT_FOUND: 'MAINTENANCE_TABLE_NOT_FOUND',
  MAINTENANCE_INVALID_RETENTION: 'MAINTENANCE_INVALID_RETENTION',
  SUBDIR_CLEANUP_FAILED: 'SUBDIR_CLEANUP_FAILED',
  SUBDIR_NOT_ALLOWED: 'SUBDIR_NOT_ALLOWED',
  // v3.9.0 新增错误码（安全加固 / 邮箱验证 / 密码找回 / 维护模式）
  RATE_LIMITED: 'PANEL_RATE_LIMITED',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
  PASSWORD_RESET_TOKEN_INVALID: 'PASSWORD_RESET_TOKEN_INVALID',
  PASSWORD_RESET_TOKEN_EXPIRED: 'PASSWORD_RESET_TOKEN_EXPIRED',
  EMAIL_VERIFY_TOKEN_INVALID: 'EMAIL_VERIFY_TOKEN_INVALID',
  EMAIL_VERIFY_TOKEN_EXPIRED: 'EMAIL_VERIFY_TOKEN_EXPIRED',
  // v4.0.2 新增错误码（演示模式管理）
  DEMO_MODE_DISABLED: 'DEMO_MODE_DISABLED',
  // v4.3.0 新增错误码（文件管理 + 异步任务 + Mods 文件操作）
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_CONCURRENT_LIMIT: 'TASK_CONCURRENT_LIMIT',
  TASK_ALREADY_CANCELED: 'TASK_ALREADY_CANCELED',
  FILE_PATH_INVALID: 'FILE_PATH_INVALID',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_BINARY_NOT_EDITABLE: 'FILE_BINARY_NOT_EDITABLE',
  FILE_UPLOAD_ID_INVALID: 'FILE_UPLOAD_ID_INVALID',
  FILE_UPLOAD_EXPIRED: 'FILE_UPLOAD_EXPIRED',
  FILE_UPLOAD_CHUNK_INVALID: 'FILE_UPLOAD_CHUNK_INVALID',
  MOD_FILE_NOT_FOUND: 'MOD_FILE_NOT_FOUND',
  MOD_FILE_STATE_INVALID: 'MOD_FILE_STATE_INVALID',
  // v4.4.0 新增错误码（第三方反向代理）
  PROXY_SERVICE_NOT_ALLOWED: 'PROXY_SERVICE_NOT_ALLOWED',
  PROXY_TARGET_INVALID: 'PROXY_TARGET_INVALID',
  PROXY_UPSTREAM_ERROR: 'PROXY_UPSTREAM_ERROR',
  PROXY_TIMEOUT: 'PROXY_TIMEOUT',
  PROXY_API_KEY_MISSING: 'PROXY_API_KEY_MISSING',
  // v4.4.0 新增错误码（API Key 旁路认证）
  API_KEY_NOT_FOUND: 'API_KEY_NOT_FOUND',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  // v4.4.0-M1 新增错误码（Java 扫描）
  NODE_JAVAS_SCAN_FAILED: 'NODE_JAVAS_SCAN_FAILED',
  // v4.4.0-L1 新增错误码（SSL 证书管理）
  SSL_CERT_READ_FAILED: 'SSL_CERT_READ_FAILED',
  SSL_CERT_FORMAT_INVALID: 'SSL_CERT_FORMAT_INVALID',
  SSL_KEY_FORMAT_INVALID: 'SSL_KEY_FORMAT_INVALID',
  SSL_STAGE_FAILED: 'SSL_STAGE_FAILED',
  SSL_DEPLOY_FAILED: 'SSL_DEPLOY_FAILED',
  SSL_NGINX_RELOAD_FAILED: 'SSL_NGINX_RELOAD_FAILED',
  SSL_SELF_SIGNED_FAILED: 'SSL_SELF_SIGNED_FAILED',
  // v4.4.0-O1 新增错误码（FRP 隧道管理）
  TUNNEL_STATUS_FAILED: 'TUNNEL_STATUS_FAILED',
  TUNNEL_CONFIG_FAILED: 'TUNNEL_CONFIG_FAILED',
  TUNNEL_START_FAILED: 'TUNNEL_START_FAILED',
  TUNNEL_STOP_FAILED: 'TUNNEL_STOP_FAILED',
  TUNNEL_LOGS_FAILED: 'TUNNEL_LOGS_FAILED',
  // v4.5.0 新增错误码（实例共管）
  INSTANCE_ADMIN_ALREADY_EXISTS: 'INSTANCE_ADMIN_ALREADY_EXISTS',
  INSTANCE_ADMIN_NOT_FOUND: 'INSTANCE_ADMIN_NOT_FOUND',
  INSTANCE_ADMIN_ASSIGNMENT_FAILED: 'INSTANCE_ADMIN_ASSIGNMENT_FAILED',
  // v4.6.0 新增错误码（资源配额）
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  QUOTA_NOT_FOUND: 'QUOTA_NOT_FOUND',
  QUOTA_UPDATE_FAILED: 'QUOTA_UPDATE_FAILED',
  // v4.6.0 新增错误码（告警系统）
  ALERT_NOT_FOUND: 'ALERT_NOT_FOUND',
  ALERT_DISPATCH_FAILED: 'ALERT_DISPATCH_FAILED',
  ALERT_SETTINGS_UPDATE_FAILED: 'ALERT_SETTINGS_UPDATE_FAILED',
  ALERT_WEBHOOK_TEST_FAILED: 'ALERT_WEBHOOK_TEST_FAILED',
  // v4.7.0 新增错误码（实例级角色覆盖）
  INSTANCE_ROLE_ALREADY_EXISTS: 'INSTANCE_ROLE_ALREADY_EXISTS',
  INSTANCE_ROLE_NOT_FOUND: 'INSTANCE_ROLE_NOT_FOUND',
  INSTANCE_ROLE_GRANT_FAILED: 'INSTANCE_ROLE_GRANT_FAILED',
  // v4.7.0 新增错误码（批量操作）
  BATCH_LIMIT_EXCEEDED: 'BATCH_LIMIT_EXCEEDED',
  // v4.8.0 新增错误码（好友系统）
  FRIEND_REQUEST_ALREADY_EXISTS: 'FRIEND_REQUEST_ALREADY_EXISTS',
  FRIEND_REQUEST_SELF: 'FRIEND_REQUEST_SELF',
  FRIEND_NOT_FOUND: 'FRIEND_NOT_FOUND',
  FRIEND_USER_NOT_FOUND: 'FRIEND_USER_NOT_FOUND',
  // v5.0.0 新增错误码（L2 Daemon 集群化管理）
  NODE_LINK_KEY_INVALID: 'NODE_LINK_KEY_INVALID',
  NODE_ALREADY_LINKED: 'NODE_ALREADY_LINKED',
  NODE_HAS_ACTIVE_INSTANCES: 'NODE_HAS_ACTIVE_INSTANCES',
  NODE_COMMS_KEY_INVALID: 'NODE_COMMS_KEY_INVALID',
  NODE_MASTER_NOT_DELETABLE: 'NODE_MASTER_NOT_DELETABLE',
  NODE_LINK_KEY_EXPIRED: 'NODE_LINK_KEY_EXPIRED',
} as const;

export type PanelErrorCodeType = typeof PanelErrorCode[keyof typeof PanelErrorCode];

export interface PanelErrorResponse {
  error: {
    code: PanelErrorCodeType;
    message: string;
    /** v1.1.0: 可选的错误详情（如 STARTUP_CONFIG_INCOMPLETE 的 missing_fields） */
    details?: Record<string, unknown>;
  };
}

// ============================================================================
// v3.6.2: 运维清理聚合页（/admin/maintenance）+ 子目录清理
// ============================================================================

/** 可管理的日志表名（maintenance 聚合页支持的四张表） */
export type MaintenanceTableName = 'audit_logs' | 'user_notifications' | 'item_sync_log' | 'chat_logs';

/** 单张表的 retention 与行数概览 */
export interface MaintenanceTableSummary {
  table_name: MaintenanceTableName;
  /** 当前表行数 */
  row_count: number;
  /** retention 天数（chat_logs 取 Pack 配置，其余取表字段） */
  retention_days: number;
  /** 上次清理时间（ISO 8601），无记录则为 null */
  last_cleanup_at: string | null;
}

/** GET /api/admin/maintenance/overview 响应 */
export interface MaintenanceOverviewResponse {
  tables: MaintenanceTableSummary[];
  /** scheduler 是否已注册每日清理任务 */
  scheduler_enabled: boolean;
}

/** POST /api/admin/maintenance/cleanup 请求体 */
export interface CleanupRequest {
  /** 指定单表清理；未指定则清理全部 */
  table_name?: MaintenanceTableName;
}

/** POST /api/admin/maintenance/cleanup 响应（单表结果） */
export interface CleanupResultEntry {
  table_name: MaintenanceTableName;
  /** 删除的行数 */
  deleted_rows: number;
}

/** POST /api/admin/maintenance/cleanup 响应 */
export interface CleanupResponse {
  results: CleanupResultEntry[];
}

/** PUT /api/admin/maintenance/retention 请求体 */
export interface RetentionUpdateRequest {
  table_name: MaintenanceTableName;
  /** retention 天数，1-365 */
  retention_days: number;
}

/** PUT /api/admin/maintenance/retention 响应 */
export interface RetentionUpdateResponse {
  table_name: MaintenanceTableName;
  retention_days: number;
}

// ============================================================================
// v4.32.2: 数据量监控告警（B2.8，决策点 3 = B）
// 来源：docs/plans/admin-pages-polish-and-consistency-plan.md §五 B2.8
// 路由：GET /api/admin/maintenance/data-volume
// 设计：监控 7 张关键表的行数增长，超阈值时告警，驱动后续分页改造决策
// ============================================================================

/** 监控的数据量表名（4 张运维清理表 + 3 张全量加载页表） */
export type DataVolumeTableName =
  | 'audit_logs'
  | 'user_notifications'
  | 'item_sync_log'
  | 'chat_logs'
  | 'player_bindings'
  | 'webhooks'
  | 'api_keys';

/** 告警等级：normal(<80%) / warning(80-95%) / critical(>95%) */
export type DataVolumeLevel = 'normal' | 'warning' | 'critical';

/** 单张表的数据量监控状态 */
export interface DataVolumeTableStatus {
  /** 表名 */
  table_name: DataVolumeTableName;
  /** 当前行数 */
  row_count: number;
  /** 告警阈值（来自 system_config KV，默认值见后端常量） */
  threshold: number;
  /** 当前告警等级（按 row_count / threshold 比例判定） */
  level: DataVolumeLevel;
  /** 行数占阈值百分比，0-∞（>100 表示超阈值） */
  percent: number;
}

/** GET /api/admin/maintenance/data-volume 响应 */
export interface DataVolumeResponse {
  /** 各表监控状态（按 table_name 升序） */
  tables: DataVolumeTableStatus[];
  /** 是否存在任一告警（warning 或 critical） */
  has_alert: boolean;
  /** critical 等级的表数量 */
  critical_count: number;
  /** warning 等级的表数量 */
  warning_count: number;
  /** 数据采集时间（ISO 8601） */
  checked_at: string;
}

/** DELETE /api/servers/:id/subdir/:subdir 响应 */
export interface SubdirCleanupResponse {
  server_id: string;
  subdir: string;
  /** 释放的字节数 */
  freed_bytes: number;
}

// ============================================================================
// v4.0.2: 演示模式管理 API 类型（追加，不修改已有类型）
// 来源：v4.0.2-demo-mode-execution-plan.md §E3
// ============================================================================

// GET /api/demo/status
export interface DemoStatusResponse {
  /** VITE_ENABLE_DEMO 环境变量是否启用 */
  enabled: boolean;
  /** 演示账号邮箱清单（仅 enabled=true 时返回） */
  builtin_emails: string[];
  /** 当前 demo 实例数（DB 中匹配的固定 UUID 数） */
  demo_instance_count: number;
  /** demo 实例固定 UUID 清单（仅 enabled=true 时返回） */
  demo_instance_ids: string[];
  /** 上次重置时间（ISO 8601），从未重置则为 null */
  last_reset_at: string | null;
}

// POST /api/demo/reset
export interface DemoResetResponse {
  reset: boolean;
  /** 重置前删除的 demo 实例数 */
  deleted_instances: number;
  /** 重新 seed 创建的实例数 */
  recreated_instances: number;
  /** 重置时间（ISO 8601） */
  reset_at: string;
}

// ============================================================================
// P1 扩展：管理员 API 类型（追加，不修改已有类型）
// 来源：scheme-final-merged.md §7.1 P1
// ============================================================================

// ----- 用户管理（管理员功能）-----

/** 用户管理 API 返回的用户信息（不含 password_hash） */
export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  /** @deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除 */
  role: UserRole;
  /** v4.17.0 新增：角色集合（多值） */
  roles?: UserRoles;
  /** v4.17.0 新增：当前活动角色 */
  active_role?: UserRole;
  status: 'active' | 'disabled' | 'deleted';
  display_name: string | null;
  is_verified: boolean;
  /** v4.0.2: 系统内置账号标记，1=演示账号（前端展示 🔒 系统内置 + 不可改密） */
  is_built_in?: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/users
// v4.x.x: 支持服务端分页（page/page_size/keyword 查询参数）
//       - 不传 page/page_size → 全量返回（向后兼容）
//       - 传 page/page_size → 分页返回，total 为过滤后总条数
export interface ListUsersResponse {
  users: AdminUserSummary[];
  /** 过滤后总条数（非分页后行数） */
  total: number;
  /** 分页后总页数（仅请求时带 page 参数才返回） */
  total_pages?: number;
  /** 当前页码（仅请求时带 page 参数才返回） */
  page?: number;
  /** 当前页大小（仅请求时带 page 参数才返回） */
  page_size?: number;
}

// GET /api/users/:id
export interface GetUserResponse {
  user: AdminUserSummary;
}

// POST /api/users（仅 server_admin）
export interface CreateUserRequest {
  email: string;
  username: string;
  password: string;
  role: UserRole;
  display_name?: string;
}

export interface CreateUserResponse {
  user: AdminUserSummary;
}

// PATCH /api/users/:id
export interface UpdateUserRequest {
  username?: string;
  role?: UserRole;
  status?: 'active' | 'disabled';
  display_name?: string | null;
  is_verified?: boolean;
}

export interface UpdateUserResponse {
  user: AdminUserSummary;
}

// PATCH /api/users/:id/role（仅 server_admin，调整用户角色）
// @deprecated v4.17.0 单值 role 接口；新代码用 PUT /api/users/:id/roles（数组）
export interface UpdateUserRoleRequest {
  role: UserRole;
}

export interface UpdateUserRoleResponse {
  user: AdminUserSummary;
}

// v4.17.0: PUT /api/users/:id/roles（仅 server_admin，多角色集合调整）
// ⚠️ 触发 JWT 黑名单：该用户所有未过期 token 被撤销，需重新登录
export interface UpdateUserRolesRequest {
  /** 角色集合（数组），至少一个角色；元素唯一；元素必须 ∈ UserRole 枚举 */
  roles: UserRoles;
  /** 可选：同时设置 active_role；若不传则取 roles[0]；active_role 必须 ∈ roles */
  active_role?: UserRole;
}

export interface UpdateUserRolesResponse {
  user: AdminUserSummary;
  /** 被撤销的 token 数量（JWT 黑名单命中数） */
  revoked_token_count: number;
}

// v4.17.0: GET /api/users/:id/roles（查询用户角色集合）
export interface ListUserRolesResponse {
  user_id: string;
  roles: UserRoles;
  active_role: UserRole;
  /** 是否需要选角色（roles.length > 1 时为 true） */
  requires_role_selection: boolean;
}

// v4.17.0: POST /api/auth/select-role（多角色账号登录后选定活动角色）
export interface SelectRoleRequest {
  /** 凭证（email + password），用于二次校验 */
  email: string;
  password: string;
  /** 选定的活动角色，必须 ∈ users.roles */
  active_role: UserRole;
}

export interface SelectRoleResponse {
  token: string;
  user: UserInfo;
}

// v4.28.0: POST /api/auth/switch-role（全员服主——同级身份免密切换）
// 与 select-role 的区别：
//   - 免密：仅凭 JWT 会话切换，无需 email+password 二次校验
//   - 等级闸门：目标角色等级必须 ≤ 2（user / instance_admin）；
//     server_admin 目标一律拒绝，须走 select-role 密码通道
export interface SwitchRoleRequest {
  /** 目标活动角色，必须 ∈ users.roles 且等级 ≤ 2 */
  active_role: UserRole;
}

export interface SwitchRoleResponse {
  token: string;
  user: UserInfo;
}

// v4.17.0: POST /api/auth/revoke-tokens（管理员强制下线用户）
export interface RevokeUserTokensResponse {
  user_id: string;
  revoked_token_count: number;
  revoked_at: string;
}

// DELETE /api/users/:id（仅 server_admin，软删除）
export interface DeleteUserResponse {
  id: string;
  deleted: boolean;
}

// POST /api/users/batch（仅 server_admin，批量操作）
// v4.22.9: 批量启用/禁用/删除/改角色，事务保证原子性
export type BatchUserAction = 'enable' | 'disable' | 'delete' | 'set_role';

export interface BatchUserOperationRequest {
  /** 目标用户 ID 列表 */
  user_ids: string[];
  /** 批量操作类型 */
  action: BatchUserAction;
  /** action='set_role' 时必填，目标角色 */
  role?: UserRole;
}

export interface BatchUserOperationResult {
  /** 单个用户 ID */
  user_id: string;
  /** 是否成功 */
  ok: boolean;
  /** 失败原因（ok=false 时返回） */
  error?: string;
}

export interface BatchUserOperationResponse {
  /** 总数 */
  total: number;
  /** 成功数 */
  succeeded: number;
  /** 失败数 */
  failed: number;
  /** 详细结果 */
  results: BatchUserOperationResult[];
}

// GET /api/users/stats（仅 server_admin，用户分析统计）
// v4.24.0: 用户分析统计概览，配合批量管理使用
export interface UserStatsResponse {
  /** 总用户数（含 deleted 软删除） */
  total: number;
  /** 各状态计数 */
  by_status: { active: number; disabled: number; deleted: number };
  /** 各角色计数（基于 active_role，仅统计 status !== 'deleted' 的用户） */
  by_role: Record<UserRole, number>;
  /** 最近 7 天注册数 */
  registered_last_7d: number;
  /** 最近 30 天注册数 */
  registered_last_30d: number;
  /** 最近 7 天活跃登录数 */
  active_last_7d: number;
  /** 最近 30 天活跃登录数 */
  active_last_30d: number;
  /** 系统内置账号数 */
  built_in_count: number;
}

// ----- 系统配置（管理员功能）-----

export interface SystemConfigItem {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

// GET /api/system-config
export interface ListSystemConfigsResponse {
  configs: SystemConfigItem[];
}

// GET /api/system-config/:key
export interface GetSystemConfigResponse {
  config: SystemConfigItem | null;
}

// PUT /api/system-config/:key
export interface SetSystemConfigRequest {
  value: string;
  description?: string;
}

export interface SetSystemConfigResponse {
  config: SystemConfigItem;
}

// DELETE /api/system-config/:key
export interface DeleteSystemConfigResponse {
  key: string;
  deleted: boolean;
}

// ----- VIP 权限管理（管理员功能）-----

export interface VipPermissionItem {
  id: number;
  vip_level: number;
  display_name: string;
  permissions: string[];
  max_quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  daily_limit: number | null;
  /** VIP 每日可领取点券金额 */
  daily_reward_amount: number;
}

// GET /api/vip-permissions
export interface ListVipPermissionsResponse {
  permissions: VipPermissionItem[];
}

// GET /api/vip-permissions/:level
export interface GetVipPermissionResponse {
  permission: VipPermissionItem;
}

// POST /api/vip-permissions
export interface CreateVipPermissionRequest {
  vip_level: number;
  display_name: string;
  permissions?: string[];
  max_quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  daily_limit?: number | null;
  daily_reward_amount?: number;
}

export interface CreateVipPermissionResponse {
  permission: VipPermissionItem;
}

// PATCH /api/vip-permissions/:level
export interface UpdateVipPermissionRequest {
  display_name?: string;
  permissions?: string[];
  max_quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  daily_limit?: number | null;
  daily_reward_amount?: number;
}

export interface UpdateVipPermissionResponse {
  permission: VipPermissionItem;
}

// DELETE /api/vip-permissions/:level
export interface DeleteVipPermissionResponse {
  vip_level: number;
  deleted: boolean;
}

// ----- 物品同步（管理员功能）-----

export interface PackItemSummary {
  name: string;
  display_name?: string;
  category?: string;
}

export interface ItemSyncLogItem {
  id: number;
  pack_id: string;
  source_url: string;
  status: 'success' | 'failed';
  items_count: number | null;
  synced_at: string;
  error_message: string | null;
  created_at: string;
}

// POST /api/packs/:packId/item-sync
export interface TriggerItemSyncResponse {
  pack_id: string;
  success: boolean;
  items_count: number;
  error?: string;
}

// GET /api/packs/:packId/item-sync/logs
export interface ListItemSyncLogsResponse {
  logs: ItemSyncLogItem[];
}

// GET /api/packs/:packId/items
export interface ListPackItemsResponse {
  pack_id: string;
  items: PackItemSummary[];
}

// ============================================================================
// P2 扩展：商店 + CDK API 类型
// 来源：scheme-final-merged.md §5.2 商店/CDK + §7.1 P2
// DB schema：migrations/20260703000006_create_shop_tables.ts + 20260703000007_create_cdk_codes.ts
// ============================================================================

// ----- 商店物品（server 级配置，引用 Pack.items.name） -----

export interface ShopItemSummary {
  id: number;
  server_id: string;
  item_name: string;
  quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  vip_level_required: number;
  price: number;
  daily_limit: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// GET /api/servers/:serverId/shop-items
export interface ListShopItemsResponse {
  items: ShopItemSummary[];
}

// PUT /api/servers/:serverId/shop-items
export interface UpsertShopItemRequest {
  item_name: string;
  quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  vip_level_required?: number;
  price?: number;
  daily_limit?: number | null;
  enabled?: boolean;
}

export interface UpsertShopItemResponse {
  item: ShopItemSummary;
}

// DELETE /api/servers/:serverId/shop-items/:id
export interface DeleteShopItemResponse {
  id: number;
  deleted: boolean;
}

// ----- 商店订单（乐观锁 pending→claiming→claimed/expired） -----

export interface ShopOrderItemSummary {
  id: number;
  order_id: number;
  item_name: string;
  count: number;
  price: number;
  quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface ShopOrderSummary {
  id: number;
  server_id: string;
  user_id: string;
  status: 'pending' | 'claiming' | 'claimed' | 'expired';
  claim_code: string;
  items_count: number;
  total_price: number;
  claimed_at: string | null;
  expires_at: string;
  claimed_player: string | null;
  created_at: string;
}

// POST /api/servers/:serverId/shop-orders
export interface CreateShopOrderRequest {
  items: Array<{
    item_name: string;
    count: number;
    quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  }>;
  /** v3.3.0: 'claim_code'（默认，生成领取码）或 'direct'（立即发放） */
  delivery_mode?: 'claim_code' | 'direct';
  /** delivery_mode='direct' 时必填，指定接收物品的玩家名 */
  player_name?: string;
}

export interface CreateShopOrderResponse {
  order: ShopOrderSummary;
  items: ShopOrderItemSummary[];
}

// GET /api/servers/:serverId/shop-orders
export interface ListShopOrdersResponse {
  orders: ShopOrderSummary[];
}

// GET /api/servers/:serverId/shop-orders/:id
export interface GetShopOrderResponse {
  order: ShopOrderSummary;
  items: ShopOrderItemSummary[];
}

// POST /api/servers/:serverId/shop-orders/claim
export interface ClaimShopOrderRequest {
  claim_code: string;
  player_name: string;
}

export interface ClaimShopOrderResponse {
  order: ShopOrderSummary;
  items: ShopOrderItemSummary[];
  delivered: boolean;
}

// ----- CDK 兑换码（乐观锁 unused→claiming→claimed/expired） -----
// v2: 支持礼包（gift）包含多个物品，通过 cdk_code_items 子表存储

export interface CdkCodeItem {
  item_name: string;
  count: number;
  quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  sort_order?: number;
}

export interface CdkCodeSummary {
  id: number;
  server_id: string;
  code: string;
  /** 礼包名称（可选），便于识别和分发。null=未命名 */
  gift_name: string | null;
  /** 礼包描述（可选），记录礼包内容说明。null=无描述 */
  gift_description: string | null;
  /** 主物品名（向后兼容字段）。新创建的多物品礼包存第一个物品或占位值 */
  item_name: string;
  /** 主物品数量（向后兼容字段） */
  count: number;
  /** 主物品品质（向后兼容字段） */
  quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  /** 礼包物品列表（来自 cdk_code_items 子表）。空数组表示单物品礼包（降级使用 item_name/count/quality） */
  items: CdkCodeItem[];
  status: 'unused' | 'claiming' | 'claimed' | 'expired';
  claimed_player: string | null;
  claimed_at: string | null;
  expires_at: string;
  created_by: string;
  created_at: string;
}

// POST /api/servers/:serverId/cdk-codes
export interface CreateCdkCodesRequest {
  codes: Array<{
    code?: string; // 不指定则自动生成
    /** 礼包名称（可选） */
    gift_name?: string;
    /** 礼包描述（可选） */
    gift_description?: string;
    /** 旧字段（向后兼容，单物品礼包）：物品名。新用法优先使用 items 数组 */
    item_name?: string;
    /** 旧字段（向后兼容，单物品礼包）：数量 */
    count?: number;
    /** 旧字段（向后兼容，单物品礼包）：品质 */
    quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    /**
     * 礼包物品列表（新字段，支持多物品礼包）。
     * - 提供 items 时：创建多物品礼包，item_name/count/quality 被忽略
     * - 未提供 items 时：降级为单物品礼包，使用 item_name/count/quality
     */
    items?: Array<{
      item_name: string;
      count: number;
      quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    }>;
  }>;
  expires_in_days?: number; // 默认 30 天
}

export interface CreateCdkCodesResponse {
  codes: CdkCodeSummary[];
}

// GET /api/servers/:serverId/cdk-codes
export interface ListCdkCodesResponse {
  codes: CdkCodeSummary[];
}

// GET /api/servers/:serverId/cdk-codes/:id
export interface GetCdkCodeResponse {
  code: CdkCodeSummary;
}

// DELETE /api/servers/:serverId/cdk-codes/:id（仅 unused 可删）
export interface DeleteCdkCodeResponse {
  id: number;
  deleted: boolean;
}

// POST /api/servers/:serverId/cdk/redeem
export interface RedeemCdkRequest {
  code: string;
  player_name: string;
}

export interface RedeemCdkResponse {
  code: CdkCodeSummary;
  delivered: boolean;
}

// ============================================================================
// P3：聊天 / 触发响应 / 玩家加入 / 定时消息 / 投票 / 玩家绑定与历史
// ============================================================================

// ----- 聊天设置（chat_settings，每服务器一条） -----
export interface ChatSettings {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface ChatSettingsSummary {
  server_id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  updated_at: string;
}

export interface GetChatSettingsResponse {
  settings: ChatSettingsSummary;
}

export interface UpsertChatSettingsRequest {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface UpsertChatSettingsResponse {
  settings: ChatSettingsSummary;
}

// ----- 聊天触发响应（chat_trigger_responses） -----
export type ChatTriggerMode = 'prefix' | 'exact' | 'contains';

export interface ChatTriggerResponseSummary {
  id: number;
  server_id: string;
  trigger: string;
  response: string;
  priority: number;
  enabled: boolean;
  mode: ChatTriggerMode;
  cooldown_seconds: number;
  created_at: string;
}

export interface ListChatTriggersResponse {
  triggers: ChatTriggerResponseSummary[];
}

export interface CreateChatTriggerRequest {
  trigger: string;
  response: string;
  priority?: number;
  enabled?: boolean;
  mode?: ChatTriggerMode;
  cooldown_seconds?: number;
}

export interface CreateChatTriggerResponse {
  trigger: ChatTriggerResponseSummary;
}

export interface UpdateChatTriggerRequest {
  trigger?: string;
  response?: string;
  priority?: number;
  enabled?: boolean;
  mode?: ChatTriggerMode;
  cooldown_seconds?: number;
}

export interface UpdateChatTriggerResponse {
  trigger: ChatTriggerResponseSummary;
}

export interface DeleteChatTriggerResponse {
  id: number;
  deleted: boolean;
}

// ----- 玩家加入设置（player_join_settings，每服务器一条） -----

/** 回归礼包物品条目 */
export interface ReloginGiftItem {
  item: string;
  count: number;
  quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary' | null;
}

/** VIP 专属欢迎语条目 */
export interface VipWelcomeMessage {
  /** 最低 VIP 等级（0-5），玩家 VIP >= 此值时匹配 */
  min_vip_level: number;
  /** 欢迎语模板，支持 {{player_name}} 等变量 */
  message: string;
}

export interface PlayerJoinSettingsSummary {
  server_id: string;
  welcome_message: string | null;
  gift_enabled: boolean;
  gift_item: string | null;
  gift_count: number | null;
  gift_quality: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary' | null;
  leave_message: string | null;
  // P3 回归礼包字段
  relogin_gift_enabled: boolean;
  relogin_gift_items: ReloginGiftItem[] | null;
  relogin_cooldown_hours: number | null;
  relogin_daily_limit: number | null;
  relogin_total_limit: number | null;
  // P4 VIP 专属欢迎语
  vip_welcome_messages: VipWelcomeMessage[] | null;
  updated_at: string;
}

export interface GetPlayerJoinSettingsResponse {
  settings: PlayerJoinSettingsSummary;
}

export interface UpsertPlayerJoinSettingsRequest {
  welcome_message?: string | null;
  gift_enabled?: boolean;
  gift_item?: string | null;
  gift_count?: number | null;
  gift_quality?: 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary' | null;
  leave_message?: string | null;
  // P3 回归礼包字段
  relogin_gift_enabled?: boolean;
  relogin_gift_items?: ReloginGiftItem[] | null;
  relogin_cooldown_hours?: number | null;
  relogin_daily_limit?: number | null;
  relogin_total_limit?: number | null;
  // P4 VIP 专属欢迎语
  vip_welcome_messages?: VipWelcomeMessage[] | null;
}

export interface UpsertPlayerJoinSettingsResponse {
  settings: PlayerJoinSettingsSummary;
}

// ----- 定时消息（periodic_messages） -----
export interface PeriodicMessageSummary {
  id: number;
  server_id: string;
  message: string;
  interval_minutes: number;
  enabled: boolean;
  next_run_at: string;
  created_at: string;
}

export interface ListPeriodicMessagesResponse {
  messages: PeriodicMessageSummary[];
}

export interface CreatePeriodicMessageRequest {
  message: string;
  interval_minutes: number;
  enabled?: boolean;
}

export interface CreatePeriodicMessageResponse {
  message: PeriodicMessageSummary;
}

export interface UpdatePeriodicMessageRequest {
  message?: string;
  interval_minutes?: number;
  enabled?: boolean;
}

export interface UpdatePeriodicMessageResponse {
  message: PeriodicMessageSummary;
}

export interface DeletePeriodicMessageResponse {
  id: number;
  deleted: boolean;
}

// ============================================================================
// 经济系统：用户钱包 + 每日点券奖励（2026-07-15 新增）
// ============================================================================

/** 用户钱包信息（按实例作用域） */
export interface WalletInfo {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  last_daily_claim_at: string | null;
  last_daily_claim_date: string | null;
  can_claim_daily: boolean;
  daily_reward_amount: number;
}

// GET /api/servers/:serverId/wallet
export interface GetWalletResponse {
  wallet: WalletInfo;
}

// POST /api/servers/:serverId/wallet/claim-daily
export interface ClaimDailyRewardResponse {
  wallet: WalletInfo;
  claimed_amount: number;
}

// ----- 投票（votes + vote_records） -----
export type VoteStatus = 'active' | 'passed' | 'failed' | 'cancelled';
export type VoteChoice = 'yes' | 'no';

export interface VoteSummary {
  id: number;
  server_id: string;
  initiator: string;
  target: string;
  reason: string;
  status: VoteStatus;
  start_time: string;
  end_time: string | null;
  created_at: string;
}

export interface VoteRecordSummary {
  id: number;
  vote_id: number;
  voter: string;
  vote_choice: VoteChoice;
  created_at: string;
}

export interface ListVotesResponse {
  votes: VoteSummary[];
}

export interface CreateVoteRequest {
  initiator: string;
  target: string;
  reason: string;
}

export interface CreateVoteResponse {
  vote: VoteSummary;
}

export interface GetVoteResponse {
  vote: VoteSummary;
  records: VoteRecordSummary[];
}

export interface CastVoteRequest {
  voter: string;
  vote_choice: VoteChoice;
}

export interface CastVoteResponse {
  vote: VoteSummary;
  record: VoteRecordSummary;
}

export interface CancelVoteResponse {
  vote: VoteSummary;
}

// ----- 投票设置（vote_settings，每服务器一条） -----
export interface VoteSettingsSummary {
  server_id: string;
  enabled: boolean;
  threshold: number;
  duration_seconds: number;
  reason_prefix: string;
  updated_at: string;
  // Task 4 新增字段（游戏内 !vk 命令支持，DB 迁移 20260716000002 添加列）
  // 设为可选以保持向后兼容；toVoteSettingsSummary 实际总是返回这些字段
  trigger_keywords?: string[];
  cooldown_seconds?: number;
  target_cooldown_seconds?: number;
  admin_immune?: boolean;
  vip_immune_min_level?: number;
}

export interface GetVoteSettingsResponse {
  settings: VoteSettingsSummary;
}

export interface UpsertVoteSettingsRequest {
  enabled?: boolean;
  threshold?: number;
  duration_seconds?: number;
  reason_prefix?: string;
  // Task 4 新增字段（可选更新）
  trigger_keywords?: string[];
  cooldown_seconds?: number;
  target_cooldown_seconds?: number;
  admin_immune?: boolean;
  vip_immune_min_level?: number;
}

export interface UpsertVoteSettingsResponse {
  settings: VoteSettingsSummary;
}

// ----- 玩家绑定（player_bindings） -----
// v4.19.3 M3.4: PlayerBindingSummary / PlayerBindingStatus 已物理删除，
// 全部使用方改用统一 `Binding` 契约（见本文件 L3050+ Binding 接口定义）。
// 字段映射：game_player_name → player_name；game_type → scope_ref；status → verify_status（'rejected' → 'revoked'）。
// v4.27.0: 请求体 CreatePlayerBindingRequest 字段 game_type → server_id（BREAKING）。
//   语义变更：玩家角色绑定从 scope_type='game_type'（跨实例全局）改为 scope_type='instance', scope_ref=server_id（实例级）。
//   后端写入 bindings 表：binding_type='player', scope_type='instance', scope_ref=server_id, player_name=game_player_name。
//   旧 scope_type='game_type' 的 player 绑定记录由迁移脚本 20260727100000 物理删除。
//   详见 docs/plans/player-binding-instance-scope-migration-plan.md。

export interface ListPlayerBindingsResponse {
  bindings: Binding[];
}

export interface CreatePlayerBindingRequest {
  game_player_name: string;
  /** v4.27.0: 实例 ID（替代旧 game_type 字段，对应 bindings.scope_ref 当 scope_type='instance'） */
  server_id: string;
}

export interface CreatePlayerBindingResponse {
  binding: Binding;
}

export interface VerifyPlayerBindingRequest {
  verify_code: string;
}

export interface VerifyPlayerBindingResponse {
  binding: Binding;
}

export interface RejectPlayerBindingResponse {
  binding: Binding;
}

export interface DeletePlayerBindingResponse {
  id: number;
  deleted: boolean;
}

// ----- server 级玩家绑定管理（admin，模块10 新增） -----
// GET /api/servers/:serverId/player-bindings
export interface ListServerPlayerBindingsResponse {
  bindings: Array<Binding & { username: string }>;
}

// DELETE /api/servers/:serverId/player-bindings/:id（软删除 + 同步解绑）
export interface DeleteServerPlayerBindingResponse {
  id: number;
  deleted: boolean;
}

// ----- 玩家验证码（游戏内 !verify 命令使用，TTL 5 分钟） -----
export interface VerifyCodeSummary {
  id: number;
  user_id: string;
  server_id: string;
  game_player_name: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

// POST /api/verify-codes
export interface CreateVerifyCodeRequest {
  server_id: string;
  game_player_name: string;
}

export interface CreateVerifyCodeResponse {
  code: VerifyCodeSummary;
}

// GET /api/verify-codes/mine
export interface ListMyVerifyCodesResponse {
  codes: VerifyCodeSummary[];
}

// ----- 玩家历史（player_histories） -----
export interface PlayerHistorySummary {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
  ip_address: string | null;
  session_duration: number | null;
  created_at: string;
}

export interface ListPlayerHistoriesResponse {
  histories: PlayerHistorySummary[];
}

// ----- 礼包领取记录（gift_claims） -----
export type GiftClaimType = 'welcome_gift' | 'relogin_gift' | 'shop_order' | 'cdk_redeem' | 'manual';

export interface GiftClaimSummary {
  id: number;
  server_id: string;
  user_id: string;
  game_player_name: string;
  claim_type: GiftClaimType;
  claimed_at: string;
}

export interface ListGiftClaimsResponse {
  claims: GiftClaimSummary[];
}

// ============================================================================
// P4：Mods / 存档 / 备份 / 监控 / 白名单黑名单
// ============================================================================

// ----- Mod 记录（mod_records） -----
export interface ModRecordSummary {
  id: number;
  server_id: string;
  mod_name: string;
  version: string;
  enabled: boolean;
  source_url: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListModsResponse {
  mods: ModRecordSummary[];
}

export interface CreateModRequest {
  mod_name: string;
  version: string;
  enabled?: boolean;
  source_url?: string | null;
}

export interface CreateModResponse {
  mod: ModRecordSummary;
}

export interface UpdateModRequest {
  enabled?: boolean;
  source_url?: string | null;
}

export interface UpdateModResponse {
  mod: ModRecordSummary;
}

export interface DeleteModResponse {
  id: number;
  deleted: boolean;
}

// ----- 存档记录（save_records） -----
export interface SaveRecordSummary {
  id: number;
  server_id: string;
  save_name: string;
  file_path: string;
  size_bytes: number;
  modified_at: string;
  is_active: boolean;
  created_at: string;
}

export interface ListSavesResponse {
  saves: SaveRecordSummary[];
}

export interface CreateSaveRequest {
  save_name: string;
  file_path: string;
  size_bytes: number;
  modified_at: string;
  is_active?: boolean;
}

export interface CreateSaveResponse {
  save: SaveRecordSummary;
}

export interface ActivateSaveResponse {
  save: SaveRecordSummary;
}

export interface DeleteSaveResponse {
  id: number;
  deleted: boolean;
}

// ----- 备份记录（backup_records） -----
export type BackupStatus = 'in_progress' | 'completed' | 'failed' | 'deleted';

export interface BackupRecordSummary {
  id: number;
  server_id: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  status: BackupStatus;
}

export interface ListBackupsResponse {
  backups: BackupRecordSummary[];
}

export interface CreateBackupRequest {
  file_path: string;
  size_bytes?: number;
}

export interface CreateBackupResponse {
  backup: BackupRecordSummary;
}

export interface UpdateBackupRequest {
  status: BackupStatus;
  size_bytes?: number;
}

export interface UpdateBackupResponse {
  backup: BackupRecordSummary;
}

export interface DeleteBackupResponse {
  id: number;
  deleted: boolean;
}

// ----- 监控快照（monitor_snapshots） -----
export interface MonitorSnapshotSummary {
  id: number;
  server_id: string;
  timestamp: string;
  cpu_percent: number | null;
  memory_mb: number | null;
  tick_rate: number | null;
  player_count: number | null;
  json_extra: Record<string, unknown> | null;
}

export interface ListMonitorSnapshotsResponse {
  snapshots: MonitorSnapshotSummary[];
}

export interface ListMonitorSnapshotsQuery {
  start?: string;
  end?: string;
  limit?: number;
}

export interface CreateMonitorSnapshotRequest {
  cpu_percent?: number | null;
  memory_mb?: number | null;
  tick_rate?: number | null;
  player_count?: number | null;
  json_extra?: Record<string, unknown> | null;
}

export interface CreateMonitorSnapshotResponse {
  snapshot: MonitorSnapshotSummary;
}

export interface GetLatestSnapshotResponse {
  snapshot: MonitorSnapshotSummary | null;
}

// ----- 白名单/黑名单（list_entries） -----
export type ListType = 'whitelist' | 'banlist';

export interface ListEntrySummary {
  id: number;
  server_id: string;
  list_type: ListType;
  player_name: string;
  added_at: string;
  added_by: string;
  reason: string | null;
}

export interface ListListEntriesResponse {
  entries: ListEntrySummary[];
}

export interface CreateListEntryRequest {
  player_name: string;
  reason?: string | null;
}

export interface CreateListEntryResponse {
  entry: ListEntrySummary;
}

export interface DeleteListEntryResponse {
  player_name: string;
  deleted: boolean;
}

// ============================================================================
// P5: Webhooks + Audit Logs
// 依据：20260703000012_create_webhooks_audit.ts
// ============================================================================

// ----- Webhooks -----

export interface WebhookSummary {
  id: number;
  server_id: string;
  url: string;
  event_types: string[];
  secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListWebhooksResponse {
  webhooks: WebhookSummary[];
}

export interface CreateWebhookRequest {
  url: string;
  event_types?: string[];
  secret?: string | null;
  enabled?: boolean;
}

export interface CreateWebhookResponse {
  webhook: WebhookSummary;
}

export interface UpdateWebhookRequest {
  url?: string;
  event_types?: string[];
  secret?: string | null;
  enabled?: boolean;
}

export interface UpdateWebhookResponse {
  webhook: WebhookSummary;
}

export interface DeleteWebhookResponse {
  deleted: boolean;
}

export interface TriggerWebhookTestRequest {
  event_type: string;
  payload?: Record<string, unknown>;
}

export interface TriggerWebhookTestResponse {
  delivered: boolean;
  status_code: number | null;
  error: string | null;
}

// ----- Audit Logs -----

export interface AuditLogSummary {
  id: number;
  server_id: string | null;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface ListAuditLogsResponse {
  logs: AuditLogSummary[];
}

export interface ListAuditLogsQuery {
  server_id?: string;
  user_id?: string;
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// ----- Login History (v4.31.0: 登录日志，独立于 audit_logs) -----

/** 登录尝试结果枚举 */
export type LoginType =
  | 'success'
  | 'fail_password'
  | 'fail_disabled'
  | 'fail_unverified'
  | 'fail_not_found';

/** 登录历史条目（用户侧视图，不含 login_input 等敏感字段） */
export interface LoginHistoryEntry {
  id: number;
  user_id: string | null;
  login_type: LoginType;
  /** 后端返回的可读标签（如"成功"/"密码错误"/"账号禁用"等），便于前端直接展示 */
  login_type_label: string;
  ip_address: string | null;
  device_summary: string | null;
  created_at: string;
}

export interface LoginHistoryListResponse {
  items: LoginHistoryEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface LoginHistoryListQuery {
  page?: number;
  page_size?: number;
}

// ----- My Activity (v4.31.0: 个人活动日志，复用 audit_logs 按 user_id 过滤) -----

/** 个人活动条目（用户侧视图，强制按当前 user_id 过滤，不含 server_id/user_id） */
export interface MyActivityEntry {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface MyActivityListResponse {
  items: MyActivityEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface MyActivityListQuery {
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

// ----- Last Login (v4.31.0: 上次登录信息，供登录后弹窗) -----

/** 上次成功登录信息（排除当前会话）；首次登录时为 null */
export interface LastLoginInfo {
  last_login_at: string;
  ip_address: string | null;
  device_summary: string | null;
}

export interface LastLoginResponse {
  last_login: LastLoginInfo | null;
}

// ----- Config Files (Task 11.1) -----

export interface ConfigFileMeta {
  name: string;
  path: string;
  format: 'json' | 'yaml' | 'properties' | 'ini';
  read_only: boolean;
}

export interface ListConfigFilesResponse {
  config_files: ConfigFileMeta[];
}

export interface ReadConfigFileResponse {
  name: string;
  data: unknown;
}

export interface WriteConfigFileRequest {
  data: unknown;
}

export interface WriteConfigFileResponse {
  name: string;
  written: boolean;
}

export interface GetConfigFileSchemaResponse {
  name: string;
  schema: Record<string, unknown>;
}

// ----- World Generation (Task 11.2) -----

export interface RegenerateMapResponse {
  server_id: string;
  regenerated: boolean;
}

export interface WorldGenSettingsFileMeta {
  name: string;
  path: string;
  format: string;
}

export interface GetMapSettingsSchemaResponse {
  settings_files: WorldGenSettingsFileMeta[];
}

export interface UpdateMapSettingsRequest {
  data: unknown;
}

export interface UpdateMapSettingsResponse {
  settings_name: string;
  written: boolean;
}

// ----- Chat Logs (Task 11.3) -----

export interface ChatLogSummary {
  id: number;
  server_id: string;
  player_name: string | null;
  message: string;
  sent_at: string;
}

export interface ListChatLogsResponse {
  logs: ChatLogSummary[];
  total: number;
}

export interface ListChatLogsQuery {
  player_name?: string;
  message_contains?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
}

// ----- Game Update (Task 11.4) -----

export interface CheckUpdateResponse {
  pack_id: string;
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

/** POST /api/servers/:serverId/update/apply 请求体（union，向兼容） */
export type ApplyUpdateRequest =
  | { version_id: string; download_path?: never }
  | { download_path: string; version_id?: never };

export interface ApplyUpdateResponse {
  server_id: string;
  applied: boolean;
  installed_version: string | null;
}

/** @deprecated 一键自动下载并安装游戏更新（v3.5.0起已将下载与应用解耦，实例侧仅做版本选择） */
export interface DownloadUpdateResponse {
  pack_id: string;
  downloaded: boolean;
  applied: boolean;
  download_path: string;
  latest_version: string | null;
}

/** 更新任务阶段 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'installing' | 'completed' | 'failed';

/** 更新进度查询响应 */
export interface UpdateProgressResponse {
  server_id: string;
  phase: UpdatePhase;
  progress_percent: number;
  message: string;
  error?: string;
  download_path?: string;
  latest_version?: string;
  started_at?: string;
  finished_at?: string;
}

// ----- P6: 日志文件管理（转发 Daemon） -----

/** 日志文件元信息（与 daemon LogFileInfo 对齐） */
export interface LogFileInfo {
  filename: string;
  size: number;
  /** 最后修改时间 ISO 字符串 */
  mtime: string;
}

/** GET /api/servers/:id/log-files 响应 */
export interface ListLogFilesResponse {
  files: LogFileInfo[];
}

/** GET /api/servers/:id/log-files/:filename 响应 */
export interface ReadLogFileResponse {
  filename: string;
  lines: string[];
}

/** DELETE /api/servers/:id/log-files/:filename 响应（204 No Content，无响应体） */
export interface DeleteLogFileResponse {
  deleted: boolean;
}

// ----- P6: 在线玩家实时查询（转发 Daemon） -----

/** 在线玩家信息（与 daemon OnlinePlayer 对齐） */
export interface OnlinePlayer {
  username: string;
  /** 加入时间（Unix 毫秒） */
  joined_at: number;
}

/** GET /api/servers/:id/players 响应 */
export interface ListOnlinePlayersResponse {
  players: OnlinePlayer[];
}

// ----- D1-D3: 玩家管理操作（kick/ban/pardon/op/deop/whitelist） -----

/** 玩家操作请求（kick/ban/pardon/op/deop/whitelist add/remove 通用） */
export interface PlayerActionRequest {
  player_name: string;
  reason?: string | null;
}

/** 玩家操作响应 */
export interface PlayerActionResponse {
  success: boolean;
  /** 渲染后下发的命令文本（便于前端展示） */
  command?: string;
  /** 失败原因（success=false 时） */
  error?: string;
}

// ----- 实例绑定（user_instance_bindings，用户自助绑定 + instance_admin 管理） -----

/** user_instance_bindings 表行（线格式，snake_case） */
export interface UserInstanceBindingRecord {
  id: number;
  user_id: string;
  server_id: string;
  vip_level: number;
  vip_expires_at: string | null;
  status: string; // 'active' | 'unbound'
  bound_at: string; // ISO 8601
  unbound_at: string | null; // ISO 8601
}

/** GET /api/profile/bindings 响应（用户查看自己的绑定列表） */
export interface ListUserBindingsResponse {
  bindings: UserInstanceBindingRecord[];
}

/** listInstanceBindings 返回行：绑定记录 + 用户名（JOIN users） */
export interface InstanceBindingWithUsername extends UserInstanceBindingRecord {
  username: string;
}

/** GET /api/instances/:serverId/bindings 响应（instance_admin 查看实例绑定列表） */
export interface ListInstanceBindingsResponse {
  bindings: InstanceBindingWithUsername[];
}

/** POST/DELETE /api/instances/:serverId/bindings 响应 */
export interface BindingActionResponse {
  user_id: string;
  server_id: string;
  bound: boolean;
}

/** PATCH /api/instances/:serverId/bindings/:userId 响应 */
export interface UpdateBindingVipResponse {
  user_id: string;
  server_id: string;
  vip_level: number;
  vip_expires_at: string | null;
}

// ============================================================================
// v3.4.0: 版本池（game_versions）+ 实例清理面板
// ============================================================================

/** 游戏版本记录 */
export interface GameVersionSummary {
  id: string;
  pack_id: string;
  version: string;
  node_id: string;
  download_path: string;
  file_size_bytes: number | null;
  downloaded_by: string;
  /** 下载触发者用户名 */
  downloaded_by_username: string;
  downloaded_at: string;
  created_at: string;
  /** v3.6.0: 被多少实例引用（用于删除前判断） */
  reference_count: number;
}

/** GET /api/packs/:packId/versions */
export interface ListGameVersionsResponse {
  versions: GameVersionSummary[];
}

/** POST /api/packs/:packId/versions/download */
export interface DownloadVersionRequest {
  /** 指定版本号，不传则下载最新版 */
  version?: string;
}

export interface DownloadVersionResponse {
  task_id: string;
  message: string;
}

/** GET /api/packs/:packId/versions/download/progress */
export interface VersionDownloadProgressResponse {
  task_id: string;
  phase: 'queued' | 'checking' | 'downloading' | 'completed' | 'failed';
  progress_percent: number;
  message: string;
  error?: string;
}

/** DELETE /api/packs/:packId/versions/:versionId */
export interface DeleteGameVersionResponse {
  id: string;
  deleted: boolean;
  /** v3.6.0: 删除磁盘文件释放的字节数（du 失败时为 null） */
  freed_bytes: number | null;
}

/** GET /api/packs/:packId/versions/available — 远程可用版本列表 */
export interface AvailableVersionEntry {
  /** 版本号字符串 */
  version: string;
  /** 版本类型（release/snapshot/stable/experimental 等） */
  type?: string;
  /** 是否已下载到本地 */
  downloaded: boolean;
}

export interface AvailableVersionsResponse {
  /** 远程最新稳定版 */
  latest: string;
  /** 可用版本列表（按版本号降序） */
  versions: AvailableVersionEntry[];
}

/** 待清理实例条目（server_admin 可见） */
export interface CleanupInstanceSummary {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  current_version: string | null;
  owner_username: string;
  last_activity_at: string | null;
  idle_days: number;
  /** 比当前版本更新的版本数 */
  newer_versions_count: number;
  marked_for_deletion: boolean;
  status: string;
}

/** GET /api/admin/cleanup-instances */
export interface ListCleanupInstancesResponse {
  instances: CleanupInstanceSummary[];
}

/** POST /api/admin/cleanup-instances/:id/confirm-delete */
export interface ConfirmCleanupDeleteResponse {
  id: string;
  deleted: boolean;
  /** v3.6.0: 删除实例目录释放的字节数（du 失败时为 null） */
  freed_bytes: number | null;
}

/** POST /api/admin/cleanup-instances/:id/ignore */
export interface IgnoreCleanupResponse {
  id: string;
  ignored: boolean;
}

// ============================================================================
// v4.3.0: 异步任务 + 文件管理 + Mods 文件操作（追加，不修改已有类型）
// 来源：mslx-upgrade-plan.md §E1 / §F1-F5 / §H1
// ============================================================================

// ----- 异步任务（E1）-----

/** POST /api/servers/:id/tasks/submit 请求体 */
export interface SubmitTaskRequest {
  /** 任务类型 */
  type: 'download' | 'compress' | 'decompress' | 'deploy';
  /** 任务特定参数（按 type 解释） */
  payload: Record<string, unknown>;
}

/** POST /api/servers/:id/tasks/submit 响应 */
export interface SubmitTaskResponse {
  task_id: string;
  status: 'running';
}

/** GET /api/servers/:id/tasks/:taskId 响应 */
export interface GetTaskStatusResponse {
  task: {
    id: string;
    type: string;
    status: 'running' | 'completed' | 'failed' | 'canceled';
    progress: { percent: number; message: string | null };
    result: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
    expires_at: string;
  };
}

/** POST /api/servers/:id/tasks/:taskId/cancel 响应 */
export interface CancelTaskResponse {
  task_id: string;
  canceled: boolean;
}

// ----- 文件管理（F1-F5）-----

/** 文件/目录条目 */
export interface FileEntry {
  /** 相对实例根目录的路径 */
  path: string;
  /** 名称（最后一段） */
  name: string;
  /** 类型：file / directory / symlink（symlink 拒绝访问） */
  type: 'file' | 'directory';
  /** 字节数（仅 file） */
  size: number;
  /** 最后修改时间 ISO */
  modified_at: string;
  /** 文件扩展名（小写，不含点；目录为空字符串） */
  extension: string;
  /** 是否为二进制文件（按扩展名黑名单判定，仅 file） */
  is_binary: boolean;
}

/** GET /api/servers/:id/files?path=xxx 响应（目录列表） */
export interface ListFilesResponse {
  path: string;
  entries: FileEntry[];
}

/** GET /api/servers/:id/files/content?path=xxx 响应（文件内容） */
export interface ReadFileContentResponse {
  path: string;
  content: string;
  size: number;
  modified_at: string;
  encoding: 'utf-8';
}

/** PUT /api/servers/:id/files/content?path=xxx 请求体 */
export interface WriteFileContentRequest {
  content: string;
}

/** PUT /api/servers/:id/files/content?path=xxx 响应 */
export interface WriteFileContentResponse {
  path: string;
  size: number;
  modified_at: string;
}

/** POST /api/servers/:id/files/upload/init 响应 */
export interface UploadInitResponse {
  upload_id: string;
  expires_at: string;
}

/** POST /api/servers/:id/files/upload/chunk 请求体 */
export interface UploadChunkRequest {
  upload_id: string;
  index: number;
  /** base64 编码的分片内容 */
  content: string;
}

/** POST /api/servers/:id/files/upload/chunk 响应 */
export interface UploadChunkResponse {
  upload_id: string;
  index: number;
  received: boolean;
}

/** POST /api/servers/:id/files/upload/finish 请求体 */
export interface UploadFinishRequest {
  upload_id: string;
  /** 目标相对路径（合并后写入的位置） */
  target_path: string;
}

/** POST /api/servers/:id/files/upload/finish 响应 */
export interface UploadFinishResponse {
  path: string;
  size: number;
}

/** POST /api/servers/:id/files/download 请求体 */
export interface DownloadFileRequest {
  /** 远程 URL */
  url: string;
  /** 下载到实例根目录下的相对路径 */
  target_path: string;
  /** 可选 SHA256 校验值 */
  sha256?: string;
}

/** POST /api/servers/:id/files/download 响应（异步任务） */
export interface DownloadFileResponse {
  task_id: string;
  status: 'running';
}

/** POST /api/servers/:id/files/compress 请求体 */
export interface CompressFileRequest {
  /** 要压缩的相对路径（文件或目录） */
  source_path: string;
  /** 输出压缩包相对路径（必须以 .zip 或 .tar.gz 结尾） */
  target_path: string;
  /** 格式（自动从 target_path 推断，可显式指定） */
  format?: 'zip' | 'tar.gz';
}

/** POST /api/servers/:id/files/compress 响应（异步任务） */
export interface CompressFileResponse {
  task_id: string;
  status: 'running';
}

/** POST /api/servers/:id/files/decompress 请求体 */
export interface DecompressFileRequest {
  /** 压缩包相对路径 */
  source_path: string;
  /** 解压目标目录相对路径 */
  target_path: string;
}

/** POST /api/servers/:id/files/decompress 响应（异步任务） */
export interface DecompressFileResponse {
  task_id: string;
  status: 'running';
}

// ----- Mods 文件操作（H1）-----

/** Mod 文件信息（扫描 mods/ 目录得到） */
export interface ModFileInfo {
  /** 文件名（如 example-mod-1.0.jar） */
  name: string;
  /** 状态：enabled（.jar）/ disabled（.jar.disabled） */
  state: 'enabled' | 'disabled';
  /** 字节数 */
  size: number;
  /** 最后修改时间 ISO */
  modified_at: string;
}

/** GET /api/servers/:id/mods/files 响应（扫描文件系统） */
export interface ListModFilesResponse {
  mods: ModFileInfo[];
}

/** POST /api/servers/:id/mods/files/:name/toggle 响应 */
export interface ToggleModFileResponse {
  name: string;
  new_state: 'enabled' | 'disabled';
}

// ============================================================================
// v4.4.0: 第三方服务反向代理（I1）
// 来源：mslx-upgrade-plan.md §I1
// 端点：
//   GET  /api/proxy                      — 列出可用代理服务
//   ALL  /api/proxy/:service/*           — 透传请求到第三方 API
// ============================================================================

/** 受支持的第三方代理服务白名单 */
export const PROXY_SERVICES = ['modrinth', 'curseforge', 'mojang', 'steam'] as const;
export type ProxyService = (typeof PROXY_SERVICES)[number];

/** 单个代理服务的元信息（GET /api/proxy 响应元素） */
export interface ProxyServiceInfo {
  /** 服务标识（URL 路径段） */
  name: ProxyService;
  /** 展示名称 */
  display_name: string;
  /** 上游 base URL */
  base_url: string;
  /** 是否需要 API Key 才能调用 */
  requires_api_key: boolean;
  /** 上游 API Key 头名称（如 'Authorization' / 'x-api-key' / 'key'）；null 表示无 key 头 */
  api_key_header: string | null;
  /** 服务端是否已在 system_config 配置 API Key（仅 requires_api_key=true 时有意义） */
  api_key_configured: boolean;
  /** 服务描述 */
  description: string;
}

/** GET /api/proxy 响应 */
export interface ProxyListServicesResponse {
  services: ProxyServiceInfo[];
}

/**
 * 透传响应体。
 * 结构由第三方 API 决定，后端不解析、不约束，直接透传到前端。
 */
export type ProxyPassthroughResponse = Record<string, unknown>;

// ============================================================================
// v4.4.0-J1: API Key 旁路认证（API 类型，追加）
//
// 用途：允许 server_admin 生成 API Key 用于 CI/CD、自动化脚本等场景，
//       通过 `x-api-key` header 旁路 JWT 认证，权限与 JWT 一致。
//
// 端点：
//   GET    /api/api-keys           — 列出所有 API Key（仅 server_admin）
//   POST   /api/api-keys           — 创建 API Key（仅 server_admin，返回明文仅一次）
//   GET    /api/api-keys/:id       — 查询单个 API Key 详情
//   DELETE /api/api-keys/:id       — 撤销 API Key（软删除，设置 revoked_at）
// ============================================================================

/**
 * API Key 信息（列表/详情返回，不含明文与 hash）
 */
export interface ApiKeyInfo {
  id: string;
  /** 人类可读名称（如 "CI/CD Pipeline"） */
  name: string;
  /** key 前缀（前 12 字符，用于列表展示识别"哪个 key"） */
  key_prefix: string;
  /** 关联用户 ID */
  user_id: string;
  /**
   * 关联角色（创建时冻结，权限等同 JWT 的 role 字段）
   *
   * v4.30.1 起：新创建的 API Key 一律为 'instance_admin'（前端移除「关联角色」选择器，
   * 服务端硬编码）。历史 Key 可能保留 'user' 或（已撤销的）'server_admin' 旧值，
   * 列表展示时仍按此字段渲染。
   */
  role: UserRole;
  /** 创建时间（ISO 8601） */
  created_at: string;
  /** 可选过期时间（ISO 8601），null = 永不过期 */
  expires_at: string | null;
  /** 最后使用时间（ISO 8601），null = 从未使用 */
  last_used_at: string | null;
  /** 最后使用 IP，null = 从未使用 */
  last_used_ip: string | null;
  /** 撤销时间（ISO 8601），null = 未撤销 */
  revoked_at: string | null;
}

// GET /api/api-keys
export interface ListApiKeysResponse {
  api_keys: ApiKeyInfo[];
}

// POST /api/api-keys
export interface CreateApiKeyRequest {
  /** 人类可读名称（≤ 100 字符） */
  name: string;
  /**
   * 关联角色（v4.30.1 起已废弃——服务端硬编码为 instance_admin，此字段被忽略）
   *
   * 历史：v4.4.0-J1 引入，server_admin 可选 instance_admin / user
   * 简化原因：v4.28.0 全员服主后每个账号天然拥有 user + instance_admin 双角色，
   *           API Key 单选一个角色反而比账号本身权限更窄，语义割裂；
   *           CI/CD 用例下天然是 instance_admin 诉求
   *           （"当你需要 API Key 时，你一定是想当服主的"）
   * 向后兼容：保留字段以兼容旧客户端，传入不报错但被服务端忽略
   *
   * @deprecated v4.30.1 起服务端忽略此字段，一律冻结为 instance_admin
   */
  role?: UserRole;
  /** 关联用户 ID（默认当前登录用户；server_admin 可指定其他 active 用户） */
  user_id?: string;
  /** 可选过期时间（ISO 8601），不传 = 永不过期 */
  expires_at?: string | null;
}

export interface CreateApiKeyResponse {
  /** 明文 API Key（gsp_<32hex>）—— 仅此一次返回，客户端必须保存 */
  api_key: string;
  /** API Key 元信息（不含明文） */
  info: ApiKeyInfo;
}

// GET /api/api-keys/:id
export interface GetApiKeyResponse {
  api_key: ApiKeyInfo;
}

// DELETE /api/api-keys/:id
export interface RevokeApiKeyResponse {
  id: string;
  revoked: boolean;
  /** 撤销时间（ISO 8601） */
  revoked_at: string;
}

// ============================================================================
// v4.5.0: instance_admins 共管 API
// ============================================================================

/** 实例共管管理员记录 */
export interface InstanceAdmin {
  id: string;
  instance_id: string;
  user_id: string;
  username: string;
  assigned_by: string;
  assigned_at: string;
}

// GET /api/servers/:serverId/admins
export interface ListInstanceAdminsResponse {
  admins: InstanceAdmin[];
  owner: { user_id: string; username: string };
}

// POST /api/servers/:serverId/admins
export interface AssignInstanceAdminRequest {
  user_id: string;
}

export interface AssignInstanceAdminResponse {
  admin: InstanceAdmin;
}

// ============================================================================
// v4.5.0: 我的资产聚合（GET /api/me/assets）
// ============================================================================

/** 我的资产中的实例摘要（精简版，不含完整 ServerSummary 字段） */
export interface MyAssetsInstance {
  id: string;
  name: string;
  status: InstanceState;
  online_players: number;
}

/** 我的资产中的订单摘要（与 ShopOrderSummary 字段不同，避免命名冲突） */
export interface MyAssetsOrderSummary {
  id: string;
  instance_id: string;
  instance_name: string;
  item_name: string;
  price: number;
  status: string;
  created_at: string;
}

/** 我的资产中的 CDK 兑换摘要 */
export interface CdkRedeemSummary {
  id: string;
  instance_id: string;
  instance_name: string;
  cdk_code: string;
  reward: string;
  redeemed_at: string;
}

export interface MyAssetsResponse {
  user: UserInfo;
  wallet: { balance: number; last_daily_claim: string | null };
  vip: { level: number; exp: number };
  instances: MyAssetsInstance[];
  recent_orders: MyAssetsOrderSummary[];
  recent_cdk_redeems: CdkRedeemSummary[];
  unread_notifications: number;
}

// ============================================================================
// v4.6.0: instance_admin 跨实例运营仪表盘（GET /api/operations/instance-admin/*）
// ============================================================================

/** 备份健康度项 */
export interface BackupHealthItem {
  instance_id: string;
  instance_name: string;
  last_backup_at: string | null;
  /** 'healthy' = 24h 内有备份; 'stale' = 超过 24h; 'never' = 从未备份 */
  status: 'healthy' | 'stale' | 'never';
}

/** 告警项（运营仪表盘展示用） */
export interface OperationsAlertItem {
  id: string;
  instance_id: string | null;
  instance_name: string | null;
  severity: 'info' | 'warning' | 'error';
  message: string;
  created_at: string;
}

/** instance_admin 跨实例总览响应 */
export interface InstanceAdminOverviewResponse {
  total_instances: number;
  running_instances: number;
  total_players_online: number;
  total_players_24h: number;
  revenue_today: number;
  revenue_30d: number;
  orders_today: number;
  cdk_redeems_today: number;
  backup_health: BackupHealthItem[];
  alerts: OperationsAlertItem[];
}

/** 收入曲线数据点 */
export interface RevenuePoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

/** 玩家活跃度数据点 */
export interface PlayerActivityPoint {
  date: string;
  unique_players: number;
  peak_online: number;
}

/** 实例对比表行 */
export interface InstanceCompareRow {
  instance_id: string;
  instance_name: string;
  status: InstanceState;
  online_players: number;
  revenue_30d: number;
  disk_used_mb: number;
}

// GET /api/operations/instance-admin/revenue
export interface OperationsRevenueResponse {
  points: RevenuePoint[];
}

// GET /api/operations/instance-admin/players
export interface OperationsPlayersResponse {
  points: PlayerActivityPoint[];
}

// GET /api/operations/instance-admin/instances-compare
export interface OperationsInstancesCompareResponse {
  instances: InstanceCompareRow[];
}

// ============================================================================
// v4.6.0: 资源配额系统（/api/quotas/*）
// ============================================================================

/** 配额范围类型 */
export type QuotaScopeType = 'role' | 'user';

/** 资源配额定义 */
export interface ResourceQuota {
  id: string;
  scope_type: QuotaScopeType;
  scope_id: string;
  max_instances: number | null;
  max_disk_mb: number | null;
  max_players_total: number | null;
  created_at: string;
  updated_at: string;
}

/** 用户当前用量 */
export interface QuotaUsage {
  user_id: string;
  instances_used: number;
  disk_used_mb: number;
  players_online: number;
}

/** GET /api/quotas 响应（当前用户配额 + 用量） */
export interface MyQuotaResponse {
  quota: ResourceQuota | null; // NULL 表示使用默认（不限）
  usage: QuotaUsage;
  /** 是否可创建新实例 */
  can_create_instance: boolean;
  /** 剩余可用磁盘 MB；NULL=不限 */
  disk_available_mb: number | null;
}

/** GET /api/quotas/role/:role 响应 */
export interface RoleQuotaResponse {
  quota: ResourceQuota | null;
}

/** PUT /api/quotas/role/:role 请求 */
export interface UpdateRoleQuotaRequest {
  max_instances?: number | null;
  max_disk_mb?: number | null;
  max_players_total?: number | null;
}

/** PUT /api/quotas/role/:role 响应 */
export interface UpdateRoleQuotaResponse {
  quota: ResourceQuota;
}

/** GET /api/quotas/user/:userId 响应 */
export interface UserQuotaResponse {
  quota: ResourceQuota | null;
}

/** PUT /api/quotas/user/:userId 请求 */
export interface UpdateUserQuotaRequest {
  max_instances?: number | null;
  max_disk_mb?: number | null;
  max_players_total?: number | null;
}

/** PUT /api/quotas/user/:userId 响应 */
export interface UpdateUserQuotaResponse {
  quota: ResourceQuota;
}

// ============================================================================
// v4.6.0: 告警主动通知系统（/api/alert-settings + /api/alert-rules + /api/alert-events）
// ============================================================================

/** 告警规则类型（预置规则 ID） */
export type AlertRuleType =
  | 'instance_crash'         // 实例崩溃（崩溃熔断触发）
  | 'instance_abnormal_exit' // 实例异常退出（非主动停止）
  | 'disk_high'              // 磁盘使用率 > 90%
  | 'ssl_expiring'           // SSL 证书 30 天内到期
  | 'backup_failing';        // 备份连续 3 天失败

/** 告警严重级别 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** 告警分发通道 */
export type AlertChannel = 'in_app' | 'email' | 'webhook';

/** 告警规则元数据（预置规则清单） */
export interface AlertRule {
  type: AlertRuleType;
  name: string;
  description: string;
  severity: AlertSeverity;
  /** 默认启用的通道 */
  default_channels: AlertChannel[];
}

/** 告警事件记录（已触发的告警历史） */
export interface AlertEvent {
  id: string;
  rule_type: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  content: string;
  /** 关联实例 ID（可选） */
  related_server_id: string | null;
  /** 触发时间（ISO 8601） */
  triggered_at: string;
  /** 分发到的通道 */
  dispatched_channels: AlertChannel[];
}

/** 用户告警通道配置（每用户一份） */
export interface AlertSettings {
  user_id: string;
  /** 邮箱通道是否启用（依赖已验证邮箱） */
  email_enabled: boolean;
  /** Webhook URL（空字符串=未配置） */
  webhook_url: string;
  /** Webhook 是否启用 */
  webhook_enabled: boolean;
  /** 订阅的告警规则类型列表 */
  subscribed_rules: AlertRuleType[];
  updated_at: string;
}

/** GET /api/alert-settings 响应 */
export interface AlertSettingsResponse {
  settings: AlertSettings;
  /** 当前用户邮箱（用于前端提示是否可启用 email 通道） */
  email: string;
  /** 邮箱是否已验证 */
  email_verified: boolean;
}

/** PUT /api/alert-settings 请求 */
export interface UpdateAlertSettingsRequest {
  email_enabled?: boolean;
  webhook_url?: string;
  webhook_enabled?: boolean;
  subscribed_rules?: AlertRuleType[];
}

/** PUT /api/alert-settings 响应 */
export interface UpdateAlertSettingsResponse {
  settings: AlertSettings;
}

/** GET /api/alert-rules 响应（预置规则清单） */
export interface AlertRulesListResponse {
  rules: AlertRule[];
}

/** GET /api/alert-events 响应（告警历史，按 triggered_at DESC 排序） */
export interface AlertEventsListResponse {
  events: AlertEvent[];
  total: number;
}

/** POST /api/alert-settings/test-webhook 请求 */
export interface TestWebhookRequest {
  webhook_url: string;
}

/** POST /api/alert-settings/test-webhook 响应 */
export interface TestWebhookResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// v4.7.0: server_admin 全平台总览仪表盘（GET /api/platform/*）
// ============================================================================

/** 磁盘用量 TopN 项 */
export interface PlatformDiskUsageItem {
  instance_id: string;
  name: string;
  used_mb: number;
  owner: string;
}

/** 实例状态分布 */
export interface PlatformInstanceStatusDistribution {
  running: number;
  stopped: number;
  error: number;
}

/** GET /api/platform/overview 响应 */
export interface PlatformOverview {
  total_users: number;
  active_users_24h: number;
  active_users_30d: number;
  total_instances: number;
  running_instances: number;
  total_nodes: number;
  healthy_nodes: number;
  total_disk_used_mb: number;
  total_disk_capacity_mb: number;
  revenue_today: number;
  revenue_30d: number;
  alerts_24h: number;
  top_disk_usage: PlatformDiskUsageItem[];
  instance_status_distribution: PlatformInstanceStatusDistribution;
}

/** 用户活跃度曲线数据点 */
export interface PlatformUsersTrendPoint {
  date: string; // YYYY-MM-DD
  active_users: number;
}

/** GET /api/platform/users?range=24h|30d 响应 */
export interface PlatformUsersTrendResponse {
  range: '24h' | '30d';
  points: PlatformUsersTrendPoint[];
}

/** 收入曲线数据点（复用 RevenuePoint 语义，单独命名以区分平台级） */
export interface PlatformRevenueTrendPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

/** GET /api/platform/revenue?days=30 响应 */
export interface PlatformRevenueTrendResponse {
  days: number;
  points: PlatformRevenueTrendPoint[];
}

/** GET /api/platform/disk-usage-top?limit=10 响应 */
export interface DiskUsageTopResponse {
  items: PlatformDiskUsageItem[];
}

// ============================================================================
// v4.7.0: 实例级角色覆盖（/api/servers/:serverId/roles）
// ============================================================================

/** 实例级角色记录（JOIN users 取 username / granted_by username） */
export interface InstanceRole {
  id: string;
  instance_id: string;
  user_id: string;
  username: string;
  role: 'instance_admin' | 'user';
  granted_by: string;
  granted_username: string;
  granted_at: string;
  expires_at: string | null;
}

/** GET /api/servers/:serverId/roles 响应 */
export interface InstanceRoleListResponse {
  roles: InstanceRole[];
}

/** POST /api/servers/:serverId/roles 请求 */
export interface GrantInstanceRoleRequest {
  user_id: string;
  role: 'instance_admin' | 'user';
  expires_at?: string | null;
}

/** POST /api/servers/:serverId/roles 响应 */
export interface GrantInstanceRoleResponse {
  role: InstanceRole;
}

// ============================================================================
// v4.7.0: 批量操作（POST /api/batch/*）
// ============================================================================

/** 批量操作请求体（start/stop/restart/backup 仅用 instance_ids；update 额外用 version_id） */
export interface BatchActionRequest {
  instance_ids: string[];
  version_id?: string;
}

/** 单个实例的批量操作结果 */
export interface BatchActionResult {
  instance_id: string;
  success: boolean;
  message?: string;
}

/** 批量操作聚合响应 */
export interface BatchActionResponse {
  results: BatchActionResult[];
}

// ============================================================================
// v4.8.0: 服务器推荐位（K1 — /api/discover/* + /api/admin/servers/*）
// ============================================================================

/** 发现页服务器条目 */
export interface DiscoverServer {
  id: string;
  name: string;
  pack_id: string;
  status: string;
  /** 在线人数（servers 表无该字段时为 0） */
  online_players: number;
  is_public: boolean;
  is_recommended: boolean;
  created_at: string;
  /** 所有者用户名（JOIN users，可能为空） */
  owner_username?: string;
}

/** GET /api/discover/hot|new|recommended 响应 */
export interface DiscoverListResponse {
  servers: DiscoverServer[];
}

/** PUT /api/admin/servers/:serverId/visibility 请求 */
export interface SetServerVisibilityRequest {
  is_public: boolean;
}

/** PUT /api/admin/servers/:serverId/recommend 请求 */
export interface SetServerRecommendRequest {
  is_recommended: boolean;
}

// ============================================================================
// v4.8.0: 好友系统（L1 — /api/friends/*）
// ============================================================================

/** 好友关系记录（双向，含双方用户名） */
export interface Friendship {
  id: string;
  user_id: string;
  friend_user_id: string;
  /** user_id 对应的用户名 */
  username: string;
  /** friend_user_id 对应的用户名 */
  friend_username: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  accepted_at: string | null;
}

/** GET /api/friends 响应 */
export interface FriendListResponse {
  friends: Friendship[];
}

/** 待处理好友请求（发给我的 pending 请求） */
export interface PendingFriendRequest {
  id: string;
  from_user_id: string;
  from_username: string;
  created_at: string;
}

/** GET /api/friends/pending 响应 */
export interface PendingFriendRequestsResponse {
  requests: PendingFriendRequest[];
}

/** POST /api/friends/request 请求 */
export interface SendFriendRequestRequest {
  friend_user_id: string;
}

/** 好友操作（accept/reject/remove）响应 */
export interface FriendActionResponse {
  success: boolean;
}

/** 好友关系状态类型 */
export type FriendStatusType = 'none' | 'pending' | 'accepted' | 'blocked';

/** GET /api/friends/:friendUserId/status 响应 */
export interface FriendStatusResponse {
  status: FriendStatusType;
}

// ============================================================================
// v4.8.0: 玩家档案（L2 — /api/players/:userId/profile）
// ============================================================================

/** 玩家档案中的用户信息 */
export interface PlayerProfileUser {
  id: string;
  username: string;
  vip_level: number;
  created_at: string;
  avatar?: string | null;
}

/** 玩家档案中的实例条目 */
export interface PlayerProfileInstance {
  id: string;
  name: string;
  status: string;
}

/** 玩家档案（公开信息 + 登录后附加的个性化信息） */
export interface PlayerProfile {
  user: PlayerProfileUser;
  bound_instances: PlayerProfileInstance[];
  /** 登录后返回：两人共同参与的公开实例 */
  mutual_instances?: PlayerProfileInstance[];
  /** 登录后返回：两人的好友关系状态 */
  friend_status?: FriendStatusType;
  /** 近期公开活动（预留，当前为空数组） */
  recent_activity?: unknown[];
}

/** GET /api/players/:userId/profile 响应 */
export type PlayerProfileResponse = PlayerProfile;

// ============================================================================
// v4.13.0: Instance Shop Config（服主店铺外观配置）
// 来源：docs/plans/v4.13.0-instances-split-plan.md 阶段一
// DB schema：migrations/20260806000001_create_instance_shop_configs.ts
// 端点：
//   GET  /api/store/servers/:serverId/shop-config   — 读取店铺外观配置（user+ 可读，instance_admin+ 可写）
//   PUT  /api/store/servers/:serverId/shop-config   — 更新店铺外观配置（instance_admin+）
// ============================================================================

/**
 * 实例店铺外观配置（一实例一行，未配置时各字段为 null）
 *
 * 设计说明：店铺外观属实例级配置（非资产级），独立于 global_assets / instance_assets 表，
 * 避免在资产行上冗余存储店铺级字段。
 */
export interface InstanceShopConfig {
  /** 实例 ID（主键，引用 servers.id） */
  server_id: string;
  /** 服主店铺 Banner 图片 URL（可空，前端用默认 banner 占位） */
  banner_url: string | null;
  /** Banner 点击跳转链接（可空） */
  banner_link: string | null;
  /** 服主店铺描述文案（可空，支持简单文本） */
  shop_description: string | null;
  /** 服主店铺主题色（HEX 格式如 #f59e0b，可空则用全局默认色） */
  shop_theme_color: string | null;
  /** 最后更新时间（ISO 8601） */
  updated_at: string;
}

/** GET /api/store/servers/:serverId/shop-config 响应 */
export interface GetInstanceShopConfigResponse {
  config: InstanceShopConfig;
}

/** PUT /api/store/servers/:serverId/shop-config 请求体（所有字段可选，未传字段保留原值） */
export interface UpdateInstanceShopConfigRequest {
  banner_url?: string | null;
  banner_link?: string | null;
  shop_description?: string | null;
  shop_theme_color?: string | null;
}

/** PUT /api/store/servers/:serverId/shop-config 响应 */
export interface UpdateInstanceShopConfigResponse {
  config: InstanceShopConfig;
}

// ============================================================================
// v4.15.0: 玩家门户聚合 API（/api/my/*）——跨实例"我的"数据
// ============================================================================

/** 我的订单物品明细（对应 shop_order_items 行） */
export interface MyOrderItem {
  item_name: string;
  count: number;
  /** 单价（点券），来自 shop_order_items.price */
  price: number;
  /** 品质：normal / uncommon / rare / epic / legendary */
  quality: string;
}

/**
 * 我的订单摘要（跨实例聚合，GET /api/my/orders）
 * status 枚举：pending / claiming / claimed / expired
 * 其中 claiming（领取中）在前端并入"待领取"展示
 */
export interface MyOrderSummary {
  id: string;
  instance_id: string;
  instance_name: string;
  items: MyOrderItem[];
  /** 订单总价（点券） */
  total_price: number;
  status: 'pending' | 'claiming' | 'claimed' | 'expired';
  /** 领取码（玩家凭此码在游戏内/领取页兑换） */
  claim_code: string;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
}

/** GET /api/my/orders 响应 */
export interface ListMyOrdersResponse {
  orders: MyOrderSummary[];
}

/**
 * 玩家门户首页聚合概览（GET /api/my/overview）
 * 一次调用返回 GuildDock 首页所需的全部计数数据
 */
export interface MyOverview {
  /** 游戏角色绑定总数 */
  bindings_total: number;
  /** 已验证绑定数 */
  bindings_verified: number;
  /** 未读通知数 */
  unread_notifications: number;
  /** 进行中订单数（status 为 pending 或 claiming） */
  pending_orders: number;
  /** 钱包余额合计（跨实例 user_wallets 汇总，点券） */
  wallet_balance: number;
  /** 今日可领取每日福利的钱包数（last_daily_claim_date != 今日） */
  daily_claimable: number;
}

/** GET /api/my/overview 响应 */
export interface GetMyOverviewResponse {
  overview: MyOverview;
}

// ============================================================================
// v4.17.0: 统一绑定体系（替代旧 player_bindings / user_instance_bindings / player_verify_codes 三套表）
// 依据：docs/plans/binding-unification-multi-role-plan.md §2.1
// ============================================================================

/** 绑定类型：account=账户级（用户↔实例VIP/钱包）；player=游戏角色级 */
export type BindingType = 'account' | 'player';

/** 作用域类型：instance=实例级；game_type=游戏类型级（跨实例全局）；global=全局 */
export type BindingScopeType = 'instance' | 'game_type' | 'global';

/** 验证状态：pending=待验证；verified=已验证；expired=验证码过期；revoked=已撤销 */
export type BindingVerifyStatus = 'pending' | 'verified' | 'expired' | 'revoked';

/** 统一绑定记录（替代旧 PlayerBindingSummary + UserInstanceBindingRecord） */
export interface Binding {
  id: number;
  user_id: string;
  binding_type: BindingType;
  scope_type: BindingScopeType;
  /** 作用域引用：scope_type='instance' → server_id；'game_type' → game_type；'global' → null */
  scope_ref: string | null;
  /** 游戏内玩家名（仅 binding_type='player' 有值） */
  player_name: string | null;
  vip_level: number;
  /** 钱包外键（仅 binding_type='account' 可有值） */
  wallet_id: number | null;
  verify_status: BindingVerifyStatus;
  /** 验证码（仅 verify_status='pending' 时有值；其他状态为 null） */
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  /** 扩展字段（JSON 字符串），存储游戏特有属性、来源标记等 */
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** POST /api/bindings（创建绑定） */
export interface CreateBindingRequest {
  binding_type: BindingType;
  scope_type: BindingScopeType;
  scope_ref: string | null;
  player_name?: string;
  /** 仅 binding_type='account' 时可指定 VIP 等级（默认 0；instance_admin 可设） */
  vip_level?: number;
}

export interface CreateBindingResponse {
  binding: Binding;
}

/** PATCH /api/bindings/:id（更新绑定，仅 vip_level/wallet_id/metadata 可改） */
export interface UpdateBindingRequest {
  vip_level?: number;
  wallet_id?: number | null;
  metadata?: string;
}

export interface UpdateBindingResponse {
  binding: Binding;
}

/** GET /api/bindings（查询绑定列表） */
export interface ListBindingsQuery {
  binding_type?: BindingType;
  scope_type?: BindingScopeType;
  scope_ref?: string;
  user_id?: string;
  verify_status?: BindingVerifyStatus;
  /** 玩家视角强制过滤自己的数据；admin 不传则看全量 */
  for_user_id?: string;
}

export interface ListBindingsResponse {
  bindings: Binding[];
}

/** GET /api/bindings/:id */
export interface GetBindingResponse {
  binding: Binding;
}

/** POST /api/bindings/:id/verify（消费验证码，pending → verified） */
export interface VerifyBindingRequest {
  verify_code: string;
}

export interface VerifyBindingResponse {
  binding: Binding;
}

/** POST /api/bindings/:id/revoke（撤销绑定，→ revoked） */
export interface RevokeBindingResponse {
  binding: Binding;
}

/** DELETE /api/bindings/:id（物理删除，仅 server_admin） */
export interface DeleteBindingResponse {
  id: number;
  deleted: boolean;
}

// ============================================================================
// v4.17.0: 权限点字典 + 角色权限模板
// 依据：docs/plans/binding-unification-multi-role-plan.md §3.3
// ============================================================================

/** 权限点分类（与 permission-points-schema.json category 枚举一致） */
export type PermissionCategory =
  | 'instance' | 'binding' | 'wallet' | 'vip' | 'user'
  | 'node' | 'asset' | 'pack' | 'cdk' | 'store' | 'shop'
  | 'backup' | 'save' | 'mod' | 'file' | 'cleanup' | 'batch' | 'operation'
  | 'chat' | 'vote' | 'periodic_message' | 'player' | 'lists'
  | 'system' | 'quota' | 'monitor' | 'maintenance'
  | 'apikey' | 'ssl' | 'tunnel' | 'webhook' | 'audit'
  | 'settings' | 'discover' | 'platform_stats';

/** 权限点（permission_points 表行） */
export interface PermissionPoint {
  code: string;
  description: string;
  category: PermissionCategory;
  created_at: string;
}

/** 角色权限模板（role_permission_templates 表行） */
export interface RolePermissionTemplate {
  role: UserRole;
  permission_code: string;
  created_at: string;
}

/** GET /api/permission-points */
export interface ListPermissionPointsResponse {
  permission_points: PermissionPoint[];
}

/** GET /api/role-permission-templates */
export interface ListRolePermissionTemplatesResponse {
  templates: RolePermissionTemplate[];
}

/** PUT /api/role-permission-templates（仅 server_admin + role_template_editable=true） */
export interface UpdateRolePermissionTemplateRequest {
  role: UserRole;
  /** 全量覆盖该角色的权限点集合（增删改均在全量覆盖中体现） */
  permission_codes: string[];
}

export interface UpdateRolePermissionTemplateResponse {
  role: UserRole;
  permission_codes: string[];
  updated_at: string;
}

// ============================================================================
// v4.17.0: Webhook 事件（替代旧 !verify 命令模式）
// 依据：docs/plans/binding-unification-multi-role-plan.md §10
// ============================================================================

/** Webhook 事件类型（与 webhook.config.json allowed_event_types 对齐） */
export type WebhookEventType =
  | 'player.join'
  | 'player.leave'
  | 'player.chat'
  | 'player.verify_command'
  | 'binding.verify_request';

/** Webhook 事件负载（Daemon → Panel） */
export interface WebhookEventPayload {
  /** 事件类型 */
  event_type: WebhookEventType;
  /** 事件发生时间（Unix 秒级时间戳） */
  timestamp: number;
  /** 实例 ID（scope_type='instance' 时的 scope_ref） */
  server_id: string;
  /** 游戏类型（scope_type='game_type' 时的 scope_ref） */
  game_type?: string;
  /** 游戏内玩家名 */
  player_name?: string;
  /** 玩家 SteamID / UUID（可选，用于反查绑定） */
  player_steam_id?: string;
  /** 聊天消息内容（event_type='player.chat' 时有值） */
  chat_message?: string;
  /** 验证码（event_type='player.verify_command' 时有值） */
  verify_code?: string;
  /** 扩展字段（游戏特有属性） */
  metadata?: Record<string, unknown>;
}

/** Webhook 事件（含签名信息） */
export interface WebhookEvent {
  /** 事件 ID（UUID，由 Daemon 生成） */
  event_id: string;
  /** 事件负载 */
  payload: WebhookEventPayload;
  /** 签名（HMAC-SHA256，sha256=<hex> 格式） */
  signature: string;
  /** 时间戳（Unix 秒级） */
  timestamp: string;
  /** nonce（防重放） */
  nonce: string;
}

/** POST /api/webhooks/events（Daemon → Panel 回调） */
export interface ReceiveWebhookEventResponse {
  status: 'accepted' | 'rejected';
  reason?: string;
}

/** POST /api/webhooks/verify-command（专用：处理游戏内 !verify 命令） */
export interface VerifyBindingViaWebhookRequest {
  server_id: string;
  game_type: string;
  player_name: string;
  verify_code: string;
}

export interface VerifyBindingViaWebhookResponse {
  /** 验证结果 */
  result: 'verified' | 'invalid_code' | 'expired' | 'binding_not_found' | 'already_verified';
  /** 验证成功时返回绑定 ID；其他情况为 null */
  binding_id: number | null;
  /** 验证成功时返回用户 ID；其他情况为 null */
  user_id: string | null;
  /** 处理消息（人类可读） */
  message: string;
}

// ============================================================================
// v4.18.0: 初始化向导（Setup Wizard）契约
// 来源：docs/plans/setup-wizard-fix-plan.md
// 变更类型：MINOR（新增字段、新增接口；旧字段保留向后兼容）
// ============================================================================

/** GET /api/init/status 响应（公开接口） */
export interface InitStatusResponse {
  /** 是否需要初始化（true=首次启动或未完成向导） */
  needs_init: boolean;
  /** 当前运行模式（由后端 process.env.VITE_ENABLE_DEMO 决定，运行时可读） */
  mode?: 'demo' | 'production';
}

/** 单项预检结果 */
export interface InitPreflightCheck {
  /** 检查项 key：'database' | 'migrations' | 'daemon' | 'packs' | 'db_config' | 'mode' | 'disk' | 'public_url' */
  key: string;
  /** 中文展示名 */
  label: string;
  /** 状态：'ok' | 'warn' | 'error' */
  status: 'ok' | 'warn' | 'error';
  /** 详情（如 "SQLite at /opt/.../panel.db" / "3 packs loaded"） */
  detail: string;
  /** 是否可在向导内修复（true=可修复，false=需 SSH 操作） */
  actionable?: boolean;
}

/** GET /api/init/preflight 响应（公开接口） */
export interface InitPreflightResponse {
  /** 是否需要初始化（与 /api/init/status 一致） */
  needs_init: boolean;
  /** 全部检查是否通过（无 error 项） */
  all_ok: boolean;
  /** 检查项列表（8 项） */
  checks: InitPreflightCheck[];
}

/** GET /api/auth/password-policy 响应（公开接口） */
export interface PasswordPolicyResponse {
  /** 最小密码长度 */
  min_length: number;
  /** 最大密码长度 */
  max_length: number;
  /** 最低 zxcvbn 评分（0-4） */
  min_zxcvbn_score: number;
  /** 是否必须包含字母 */
  require_letter: boolean;
  /** 是否必须包含数字 */
  require_digit: boolean;
  /** 禁用密码列表（如 admin123、12345678 等常见弱密码） */
  forbidden_passwords: string[];
}

/**
 * POST /api/init 请求体（公开接口，门控：needs_init=true）
 *
 * v4.18.0 扩展：
 *   - 新增 admin 对象（生产模式必填，演示模式忽略）
 *   - 新增 mode 字段（运行模式确认）
 *   - 新增 database_ack 字段（数据库配置确认）
 *   - admin_password 字段保留向后兼容（旧客户端仍可使用）
 *
 * v4.20.0 扩展（Setup Wizard v2）：
 *   - 新增 database 字段（数据库类型 + 连接串，写入 .env DATABASE_URL）
 *   - 新增 daemon_nodes 字段（Daemon 节点列表，写入 nodes 表）
 *   - 新增 public_base_url 字段（公网入口，写入 .env PUBLIC_BASE_URL）
 *   - 新增 skip_daemon 字段（单机模式跳过 Daemon 配置）
 *   - 旧字段保留向后兼容（admin_password / database_ack）
 */
export interface InitRequest {
  /** 站点名称（1-64 字符） */
  site_name: string;
  /** 管理员账号配置（生产模式必填）
   *
   * v4.22.0 改造：移除 admin@local.dev/admin123 默认账号，users 表清空后由本字段创建首个管理员。
   *   - email / username / display_name 在前端向导中均为必填
   *   - 后端 detectInitStatus 检测 users 表为空时 needs_init=true
   *   - 后端 init API 收到 admin 对象后调用 userService.createUser 创建首条记录（role=server_admin, is_built_in=0）
   *   - 旧字段 admin_password 保留向后兼容（等价于 admin.password）
   */
  admin?: {
    /** 管理员邮箱（向导内必填；登录可用邮箱或用户名） */
    email?: string;
    /** 管理员用户名（向导内必填；登录可用邮箱或用户名） */
    username?: string;
    /** v4.22.0 新增：管理员昵称（向导内必填，对应 users.display_name） */
    display_name?: string;
    /** 管理员密码（必填，需通过 password-policy 校验） */
    password: string;
  };
  /** 旧字段，与 admin.password 等价（向后兼容） */
  admin_password?: string;
  /** 启用的游戏 Pack ID 列表（空数组=全部启用；v4.22.0 起与 pack_source 二选一） */
  enabled_packs: string[];
  /** 运行模式确认（写入 system_config 'system.mode'） */
  mode?: 'demo' | 'production';
  /** 数据库配置确认（true=用户已知悉当前数据库配置） */
  database_ack?: boolean;
  /** v4.20.0 新增：数据库连接配置（写入 .env DATABASE_URL，需重启生效） */
  database?: DatabaseConfig;
  /** v4.20.0 新增：Daemon 节点列表（写入 nodes 表，首个节点同步写入 .env DAEMON_URL） */
  daemon_nodes?: DaemonNodeInput[];
  /** v4.20.0 新增：公网入口 URL（写入 .env PUBLIC_BASE_URL） */
  public_base_url?: string;
  /** v4.20.0 新增：单机模式跳过 Daemon 配置（true=不配置 Daemon，DAEMON_URL 留空） */
  skip_daemon?: boolean;
  /** v4.22.0 新增：Pack 来源配置（与 enabled_packs 二选一；优先于 enabled_packs） */
  pack_source?: PackSyncConfig;
}

/** POST /api/init 响应 */
export interface InitSubmitResponse {
  /** 是否已初始化 */
  initialized: boolean;
  /** 站点名称 */
  site_name: string;
  /** 管理员密码是否已更新 */
  admin_password_updated: boolean;
  /** 启用的游戏 Pack 列表 */
  enabled_packs: string[];
  /** 演示模式标记（true=演示模式仅走过场，未真正写库） */
  demo_mode?: boolean;
  /** v4.18.0 新增：管理员邮箱（向导完成后用于登录提示） */
  admin_email?: string;
  /** v4.18.0 新增：运行模式 */
  mode?: 'demo' | 'production';
  /** v4.20.0 新增：是否已更新 .env 文件（database/public_base_url/daemon_url） */
  env_updated?: boolean;
  /** v4.20.0 新增：新增 Daemon 节点数量 */
  nodes_added?: number;
  /** v4.20.0 新增：重启触发 token（用于 POST /api/init/restart 一次性调用） */
  restart_token?: string;
  /** v4.20.0 新增：是否需要重启（database 变更时为 true） */
  restart_required?: boolean;
  /** v4.22.0 新增：Pack 同步数量（pack_source.source=github/custom-url 时返回） */
  pack_synced_count?: number;
  /** v4.22.0 新增：Pack 同步错误信息（packSyncService 未注入等非阻断性警告） */
  pack_sync_error?: string | null;
}

// ----- v4.20.0 Setup Wizard v2 新增类型 -----

/** 数据库类型枚举 */
export type DatabaseType = 'sqlite' | 'mysql' | 'postgresql';

/** 数据库连接配置（向导提交用） */
export interface DatabaseConfig {
  /** 数据库类型 */
  type: DatabaseType;
  /** 完整连接串：
   *  - sqlite: 文件路径（如 `./data/panel.db`）
   *  - mysql: `mysql://user:password@host:port/database`
   *  - postgresql: `postgresql://user:password@host:port/database`
   */
  url: string;
}

/** Daemon 节点配置（向导提交用，明文 token 由后端 hash 后存储） */
export interface DaemonNodeInput {
  /** 节点显示名（如 "主节点"） */
  name: string;
  /** 节点 FQDN 或 IP（如 `gsp.ecsrz.com`） */
  fqdn: string;
  /** 公网 IP（可选） */
  public_ip?: string;
  /** Daemon 通信 token（明文输入，后端 bcrypt hash 后存 daemon_token_hash） */
  daemon_token: string;
  /** 节点类型（默认 master） */
  node_type?: 'master' | 'worker';
}

/** POST /api/init/test-database 请求体（公开接口，向导内测试连接用） */
export interface TestDatabaseConnectionRequest {
  /** 数据库类型 */
  type: DatabaseType;
  /** 连接串（与 DatabaseConfig.url 相同格式） */
  url: string;
}

/** POST /api/init/test-database 响应 */
export interface TestDatabaseConnectionResponse {
  /** 是否连接成功 */
  ok: boolean;
  /** 连接耗时（毫秒，ok=true 时返回） */
  latency_ms?: number;
  /** 错误信息（ok=false 时返回） */
  error?: string;
  /** 数据库版本号（ok=true 时返回，如 "16.4" / "8.0.36" / "3.45.1"） */
  server_version?: string;
}

/** POST /api/init/restart 请求体（公开接口，一次性 token） */
export interface RestartTriggerRequest {
  /** 由 POST /api/init 返回的一次性 restart_token */
  restart_token: string;
}

/** POST /api/init/restart 响应 */
export interface RestartTriggerResponse {
  /** 是否已触发重启 */
  triggered: boolean;
  /** 触发时间戳（ISO 8601） */
  triggered_at?: string;
}

// ----- v4.22.0 Setup Wizard v3 新增类型 -----

/**
 * Daemon 节点导入链接 payload
 *
 * deploy-daemon.sh 脚本部署完成后输出 `gsp-daemon-import://<base64-json>` 链接，
 * 前端解析 base64 后得到本对象，调用 POST /api/init/test-daemon 测试连接，
 * 通过后转换为 DaemonNodeInput 加入节点列表。
 *
 * 字段说明：
 *   - port: Daemon 监听端口（默认 8080）
 *   - token: 明文 DAEMON_TOKEN（与 daemon/.env 一致）
 *   - public_ip: 可选，公网 IP（用于节点列表展示）
 */
export interface DaemonNodeImportPayload {
  /** 节点显示名（如 "主节点" / "上海节点"） */
  name: string;
  /** 节点 FQDN 或 IP（如 `gsp.ecsrz.com` 或 `192.168.5.14`） */
  fqdn: string;
  /** Daemon 监听端口（默认 8080） */
  port: number;
  /** Daemon 通信 token（明文） */
  token: string;
  /** 公网 IP（可选） */
  public_ip?: string;
  /** 节点类型（默认 master） */
  node_type?: 'master' | 'worker';
}

/** POST /api/init/test-daemon 请求体（公开接口，向导内测试 Daemon 连接） */
export interface TestDaemonConnectionRequest {
  /** 节点 FQDN 或 IP */
  fqdn: string;
  /** Daemon 监听端口 */
  port: number;
  /** Daemon 通信 token（明文，后端转发给 daemon /health 验证） */
  token: string;
}

/** POST /api/init/test-daemon 响应 */
export interface TestDaemonConnectionResponse {
  /** 是否连接成功 */
  ok: boolean;
  /** 连接耗时（毫秒，ok=true 时返回） */
  latency_ms?: number;
  /** 错误信息（ok=false 时返回） */
  error?: string;
  /** Daemon 版本号（ok=true 时返回，从 /health 响应获取） */
  daemon_version?: string;
}

/**
 * POST /api/init/auto-detect-local-daemon 响应（公开接口，向导内自动检测本机 Daemon）
 *
 * v4.22.1 新增：本机单节点模式下，Panel 后端自动读取 daemon/.env 中的 DAEMON_TOKEN
 * 并探测 /health，前端无需用户手动粘贴 token。
 *
 * 字段说明：
 *   - ok: 是否成功读取 token 并通过 /health 探测
 *   - daemon_token: 从 daemon/.env 读取的明文 token（ok=true 时返回）
 *   - port: 从 daemon/.env 读取的端口（默认 8080）
 *   - daemon_version: Daemon /health 返回的版本号（可选）
 *   - latency_ms: /health 探测耗时（可选）
 *   - error: 失败原因（ok=false 时返回，如 .env 不存在/token 缺失/Daemon 不可达）
 */
export interface AutoDetectLocalDaemonResponse {
  /** 是否成功读取 token 并通过 /health 探测 */
  ok: boolean;
  /** 从 daemon/.env 读取的明文 token（ok=true 时返回） */
  daemon_token?: string;
  /** 从 daemon/.env 读取的端口（默认 8080） */
  port?: number;
  /** Daemon 版本号（ok=true 时返回） */
  daemon_version?: string;
  /** /health 探测耗时（毫秒） */
  latency_ms?: number;
  /** 失败原因（ok=false 时返回） */
  error?: string;
  /** daemon/.env 文件路径（用于错误提示） */
  env_path?: string;
}

/**
 * Pack 来源类型枚举
 *
 * v4.22.0 起 SetupWizard Step 6 改为 Tab 切换四种来源：
 *   - github: 从 GitHub 仓库同步 packs/ 目录（默认 airxw/GSP-Panel）
 *   - custom-url: 从自定义 URL 同步（git URL 或 tarball URL）
 *   - upload: 手动上传 pack.zip 文件
 *   - skip: 跳过，部署后通过 Pack 管理页面配置
 */
export type PackSourceType = 'github' | 'custom-url' | 'upload' | 'skip';

/** Pack 同步配置（向导提交用） */
export interface PackSyncConfig {
  /** 来源类型 */
  source: PackSourceType;
  /** GitHub 仓库地址（source=github 时必填，格式 `owner/repo`，默认 `airxw/GSP-Panel`） */
  github_repo?: string;
  /** GitHub 分支/Tag（默认 `main`） */
  github_ref?: string;
  /** 自定义 URL（source=custom-url 时必填，支持 git URL 或 tarball URL） */
  custom_url?: string;
  /** 上传的 pack zip 文件标识（source=upload 时由上传接口返回） */
  upload_id?: string;
}

/** POST /api/init/packs/sync 请求体（公开接口，向导内同步 packs） */
export interface SyncPacksRequest extends PackSyncConfig {}

/** POST /api/init/packs/sync 响应 */
export interface SyncPacksResponse {
  /** 是否同步成功 */
  ok: boolean;
  /** 同步的 pack 数量（ok=true 时返回） */
  synced_count?: number;
  /** 错误信息（ok=false 时返回） */
  error?: string;
  /** 同步后的 pack 列表（ok=true 时返回） */
  packs?: PackSummary[];
}

/** POST /api/init/packs/upload 响应（公开接口，向导内上传 pack zip） */
export interface UploadPackResponse {
  /** 是否上传成功 */
  ok: boolean;
  /** 上传标识（用于后续 submitInit 时关联 pack_source.upload_id） */
  upload_id?: string;
  /** 解析出的 pack ID（ok=true 时返回） */
  pack_id?: string;
  /** 错误信息（ok=false 时返回） */
  error?: string;
}

// ============================================================================
// 个人中心经济系统 v2（2026-07-27 新增）
// 全局余额 / 实例点券 / 积分 / VIP / 提现 / 交易流水
// 方案：docs/plans/user-center-consolidation-plan.md
// ============================================================================

// ----- 全局余额 -----

/** 全局余额信息（一个用户只有一个余额账户） */
export interface GlobalBalance {
  user_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  frozen_balance: number;
  total_withdrawn: number;
  last_income_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/me/balance */
export interface GetBalanceResponse {
  balance: GlobalBalance;
  /** 可用余额 = balance - frozen_balance */
  available_balance: number;
  /** 是否可充值（余额 < recharge_max） */
  can_recharge: boolean;
  /** 充值上限 */
  recharge_max: number;
}

/** GET /api/me/balance/summary — 跨实例汇总 */
export interface BalanceSummaryResponse {
  balance: GlobalBalance;
  available_balance: number;
  can_recharge: boolean;
  recharge_max: number;
  /** 各实例点券 + VIP 状态 */
  instances: Array<{
    server_id: string;
    server_name: string;
    points_balance: number;
    vip_level: number;
    current_integral: number;
  }>;
}

// ----- 实例点券 -----

/** 实例点券信息 */
export interface InstancePoints {
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

/** GET /api/servers/:serverId/points */
export interface GetPointsResponse {
  points: InstancePoints;
}

/** POST /api/servers/:serverId/points/exchange — 余额兑换点券 */
export interface ExchangePointsRequest {
  /** 余额金额（正数） */
  amount: number;
}

export interface ExchangePointsResponse {
  /** 兑换后余额 */
  balance: GlobalBalance;
  /** 兑换后点券 */
  points: InstancePoints;
  /** 实际获得的点券数 */
  points_received: number;
}

/** POST /api/servers/:serverId/points/grant — 管理员发放点券 */
export interface GrantPointsRequest {
  user_id: string;
  amount: number;
}

export interface GrantPointsResponse {
  points: InstancePoints;
}

// ----- 积分与 VIP -----

/** 用户积分信息 */
export interface UserIntegral {
  user_id: string;
  server_id: string;
  total_integral: number;
  current_integral: number;
  last_decay_at: string | null;
  created_at: string;
  updated_at: string;
}

/** VIP 购买类型 */
export type VipType = 'lifetime' | 'monthly';

/** VIP 状态 */
export interface UserVipStatus {
  user_id: string;
  server_id: string;
  vip_type: VipType | null;
  vip_expires_at: string | null;
  purchased_at: string | null;
  /** 由积分区间决定的 VIP 等级 */
  vip_level: number;
  /** 当前积分 */
  current_integral: number;
  /** 累计积分 */
  total_integral: number;
  created_at: string;
  updated_at: string;
}

/** GET /api/servers/:serverId/vip/status */
export interface GetVipStatusResponse {
  vip: UserVipStatus;
  /** VIP 等级对应的每日点券奖励金额 */
  daily_reward_amount: number;
  /** 是否可领取每日奖励 */
  can_claim_daily: boolean;
}

/** POST /api/servers/:serverId/vip/purchase */
export interface PurchaseVipRequest {
  type: VipType;
}

export interface PurchaseVipResponse {
  vip: UserVipStatus;
  balance: GlobalBalance;
}

// ----- 实例定价配置 -----

/** 实例定价配置 */
export interface InstancePricing {
  server_id: string;
  vip_monthly_price: number | null;
  vip_lifetime_price: number | null;
  points_exchange_ratio: number;
  integral_ratio: number;
  daily_consumption_limit: number | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/servers/:serverId/pricing */
export interface GetPricingResponse {
  pricing: InstancePricing;
}

/** PUT /api/servers/:serverId/pricing */
export interface UpdatePricingRequest {
  vip_monthly_price?: number | null;
  vip_lifetime_price?: number | null;
  points_exchange_ratio?: number;
  integral_ratio?: number;
  daily_consumption_limit?: number | null;
}

export interface UpdatePricingResponse {
  pricing: InstancePricing;
}

// ----- 交易流水 -----

/** 货币类型 */
export type CurrencyType = 'balance' | 'points' | 'integral';

/** 交易类型 */
export type TransactionType =
  | 'daily_reward'
  | 'shop_purchase'
  | 'shop_refund'
  | 'cdk_recharge'
  | 'admin_credit'
  | 'admin_debit'
  | 'vip_purchase'
  | 'points_exchange'
  | 'cdk_generate'
  | 'cdk_redeem'
  | 'cdk_refund'
  | 'withdraw'
  | 'integral_earn'
  | 'integral_decay'
  | 'integral_adjust'
  | 'gift'
  | 'system';

/** 交易流水记录 */
export interface WalletTransaction {
  id: number;
  user_id: string;
  server_id: string | null;
  currency_type: CurrencyType;
  type: TransactionType;
  amount: number;
  balance_after: number;
  linked_tx_id: number | null;
  order_id: string | null;
  cdk_id: number | null;
  withdraw_code_id: number | null;
  description: string | null;
  operator_user_id: string | null;
  trace_id: string;
  created_at: string;
}

/** GET /api/me/transactions */
export interface ListTransactionsResponse {
  transactions: WalletTransaction[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /api/me/transactions/export — CSV 导出（返回 text/csv） */

// ----- 提现 -----

/** 提现码状态 */
export type WithdrawCodeStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** 提现码记录 */
export interface WithdrawCode {
  id: number;
  code: string;
  user_id: string;
  amount: number;
  actual_amount: number;
  ratio: number;
  status: WithdrawCodeStatus;
  operator_user_id: string | null;
  approved_at: string | null;
  expires_at: string;
  created_at: string;
}

/** POST /api/me/withdraw — 申请提现 */
export interface CreateWithdrawRequest {
  amount: number;
}

export interface CreateWithdrawResponse {
  withdraw_code: string;
  actual_amount: number;
  expires_at: string;
}

/** GET /api/me/withdraw/history */
export interface ListWithdrawHistoryResponse {
  withdrawals: WithdrawCode[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /api/admin/withdraw/pending — 管理端待审批列表 */
export interface ListPendingWithdrawalsResponse {
  withdrawals: Array<WithdrawCode & { username?: string }>;
  total: number;
  page: number;
  page_size: number;
}

/** POST /api/admin/withdraw/:code/approve */
export interface ApproveWithdrawResponse {
  withdrawal: WithdrawCode;
}

/** POST /api/admin/withdraw/:code/reject */
export interface RejectWithdrawResponse {
  withdrawal: WithdrawCode;
}

// ----- 消费统计 -----

/** GET /api/me/stats */
export interface GetMyStatsResponse {
  /** 按类型汇总 */
  by_type: Array<{ type: TransactionType; total_amount: number; count: number }>;
  /** 按月趋势（最近 12 个月） */
  monthly: Array<{ month: string; total_spent: number; total_earned: number }>;
  /** Top 消费实例 */
  top_servers: Array<{ server_id: string; server_name: string; total_spent: number }>;
}

/** GET /api/servers/:serverId/stats */
export interface GetServerStatsResponse {
  /** 今日消费总额 */
  today_revenue: number;
  /** 本月消费总额 */
  month_revenue: number;
  /** 总消费额 */
  total_revenue: number;
  /** 消费用户数 */
  unique_spenders: number;
  /** 按类型汇总 */
  by_type: Array<{ type: TransactionType; total_amount: number; count: number }>;
}

// ----- CDK 类型扩展 -----

/** CDK 类型 */
export type CdkType = 'item' | 'balance' | 'points' | 'vip';

/** 扩展后的 CDK 信息（含新类型字段） */
export interface CdkKeyInfo {
  id: number;
  code: string;
  type: CdkType;
  server_id: string | null;
  amount: number | null;
  vip_duration: string | null;
  creator_user_id: string | null;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  refunded_at: string | null;
  created_at: string;
}

/** POST /api/cdk/generate — 用户自生成转赠 CDKey */
export interface GenerateCdkRequest {
  type: 'points' | 'vip';
  server_id: string;
  amount?: number;
  vip_duration?: 'monthly' | 'lifetime';
}

export interface GenerateCdkResponse {
  cdk: CdkKeyInfo;
}

// ----- 管理员订单号充值 -----

/** POST /api/servers/:serverId/wallet/credit — 管理员订单号充值 */
export interface AdminCreditRequest {
  user_id: string;
  amount: number;
  order_id: string;
}

export interface AdminCreditResponse {
  balance: GlobalBalance;
  transaction: WalletTransaction;
}

// ----- 管理员调整积分 -----

/** PATCH /api/servers/:serverId/integrals/:userId — 管理员调整积分 */
export interface AdjustIntegralRequest {
  amount: number;
  description?: string;
}

export interface AdjustIntegralResponse {
  integral: UserIntegral;
}

// ----- 平台经济配置 -----

/** 平台经济配置（/admin/settings 读取） */
export interface PlatformEconomyConfig {
  'balance.recharge_max': number;
  'consumption.daily_max': number;
  'withdraw.ratio': number;
}


