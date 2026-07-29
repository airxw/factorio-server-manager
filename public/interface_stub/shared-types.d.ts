/**
 * shared-types.d.ts — 共享类型定义（被多个服务接口存根引用）
 *
 * 数据契约对齐：public/schema/ 下 28 个 JSON Schema 文件
 * 一致性约定：
 *   - server_id / user_id 统一 string (UUID)
 *   - 时间戳统一 string (ISO 8601)
 *   - 乐观锁状态字段使用字面量联合类型
 *   - 错误码与 error-codes-schema.json 对齐
 *
 * 来源：scheme-final-merged.md §4 数据库 Schema / §5 关键业务流程
 */

// ============================================================================
// 一、基础字面量类型（与 JSON Schema enum 对齐）
// ============================================================================

/** 物品品质（shop-items / cdk-codes / vip-permissions / pack 共用） */
export type ItemQuality = 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** 用户角色（user-schema.json role 字段，v1.2.0 升 3 级） */
export type UserRole = 'server_admin' | 'instance_admin' | 'user';

/** 用户账号状态（user-schema.json status 字段，v1.2.0 扩展 'deleted'） */
export type UserStatus = 'active' | 'disabled' | 'deleted';

/** 服务器进程状态（server-schema.json status 字段） */
export type InstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/** 订单状态机（shop-orders-schema.json status 字段，乐观锁） */
export type ShopOrderStatus = 'pending' | 'claiming' | 'claimed' | 'expired';

/** CDK 状态机（cdk-codes-schema.json status 字段，乐观锁） */
export type CdkStatus = 'unused' | 'claiming' | 'claimed' | 'expired';

/** 命令队列状态机（command-queue-schema.json status 字段） */
export type CommandQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

/** 命令优先级（command-queue-schema.json priority 字段） */
export type CommandPriority = 'low' | 'normal' | 'high';

/** 投票状态机（votes-schema.json status 字段） */
export type VoteStatus = 'active' | 'passed' | 'failed' | 'cancelled';

/** 投票选择（vote-records-schema.json vote_choice 字段） */
export type VoteChoice = 'yes' | 'no';

/** 备份状态（backup-records-schema.json status 字段） */
export type BackupStatus = 'in_progress' | 'completed' | 'failed' | 'deleted';

/** 名单类型（list-entries-schema.json list_type 字段） */
export type ListType = 'whitelist' | 'banlist';

/** 物品同步状态（item-sync-log-schema.json status 字段） */
export type ItemSyncStatus = 'success' | 'failed';

// v4.19.3 M3.4: PlayerBindingStatus 已物理删除，统一使用 panel-api-types.ts 的 BindingVerifyStatus。

// ============================================================================
// 二、用户域类型（user-schema.json）
// ============================================================================

/** users 表记录（user-schema.json） */
export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  /** @deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除 */
  role: UserRole;
  status: UserStatus;
  display_name: string | null;
  vip_level: number;
  vip_expires_at: string | null;
  is_verified: boolean;
  /** v4.0.2: 系统内置账号标记，1=演示账号（不可改密，前端展示 🔒 系统内置） */
  is_built_in?: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
  /** v4.17.0 新增：角色集合（多值），至少包含一个角色 */
  roles?: UserRole[];
  /** v4.17.0 新增：当前活动角色（会话级，登录时选定） */
  active_role?: UserRole;
  /** v4.28.0 新增：当前腐竹等级 ID（仅 roles 含 instance_admin 时有值；查询加速冗余，主表 user_admin_tiers） */
  admin_tier_id?: number | null;
}

/** 用户更新输入（仅允许修改的字段子集） */
export interface UserUpdate {
  username?: string;
  password_hash?: string;
  /** @deprecated v4.17.0 单值 role；新代码用 roles + active_role */
  role?: UserRole;
  status?: UserStatus;
  display_name?: string | null;
  vip_level?: number;
  vip_expires_at?: string | null;
  is_verified?: boolean;
  /** v4.17.0 新增：角色集合（多值） */
  roles?: UserRole[];
  /** v4.17.0 新增：当前活动角色 */
  active_role?: UserRole;
}

// ============================================================================
// 三、商店域类型（shop-items / shop-orders / shop-order-items schema）
// ============================================================================

/** shop_items 表记录（shop-items-schema.json，瘦身版） */
export interface ShopItem {
  id: number;
  server_id: string;
  item_name: string;
  quality: ItemQuality;
  vip_level_required: number;
  daily_limit: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** 商品上架/更新输入 */
export interface ShopItemInput {
  item_name: string;
  quality?: ItemQuality;
  vip_level_required?: number;
  daily_limit?: number | null;
  enabled?: boolean;
}

/** shop_orders 表记录（shop-orders-schema.json，订单头，乐观锁） */
export interface ShopOrder {
  id: number;
  server_id: string;
  user_id: string;
  status: ShopOrderStatus;
  claim_code: string;
  items_count: number;
  claimed_at: string | null;
  expires_at: string;
  claimed_player: string | null;
  created_at: string;
}

/** 订单明细输入（对应 shop_order_items 表） */
export interface ShopOrderItemInput {
  item_name: string;
  count: number;
  quality: ItemQuality;
}

// ============================================================================
// 四、CDK 域类型（cdk-codes-schema.json）
// ============================================================================

/** cdk_codes 表记录（cdk-codes-schema.json，乐观锁） */
export interface CdkCode {
  id: number;
  server_id: string;
  code: string;
  item_name: string;
  count: number;
  quality: ItemQuality;
  status: CdkStatus;
  claimed_player: string | null;
  claimed_at: string | null;
  expires_at: string;
  created_by: string;
  created_at: string;
}

/** CDK 生成输入 */
export interface CdkItemInput {
  item_name: string;
  count: number;
  quality?: ItemQuality;
  expires_at?: string;
}

/** CDK 兑换后输出的物品描述 */
export interface CdkItemOutput {
  item_name: string;
  count: number;
  quality: ItemQuality;
}

// ============================================================================
// 五、VIP 权限类型（vip-permissions-schema.json）
// ============================================================================

/** vip_permissions 表记录（vip-permissions-schema.json） */
export interface VipPermission {
  id: number;
  vip_level: number;
  display_name: string;
  permissions: string[];
  max_quality: ItemQuality | 'none';
  daily_limit: number | null;
  /** VIP 每日可领取点券金额（阶梯固定：VIP0=100, VIP1=200, VIP2=400, VIP3=800, VIP4=1600, VIP5=3200） */
  daily_reward_amount: number;
}

// ============================================================================
// 六、Pack 扩展类型（pack-schema-extension.json）
// ============================================================================

/** Pack 物品来源配置 */
export interface PackItemSource {
  type: 'github_sync' | 'static' | 'local_file';
  url?: string;
  sync_interval_hours?: number;
}

/** Pack 内联静态物品（static 模式） */
export interface PackItem {
  name: string;
  display_name?: string;
  category?: string;
}

/** Pack.items 字段（pack-schema-extension.json items） */
export interface PackItems {
  source: PackItemSource;
  qualities: ItemQuality[];
  quality_tiers: number;
  categories: string[];
  static_list?: PackItem[];
}

/** Pack.event_parsers 字段（pack-schema-extension.json event_parsers） */
export interface PackEventParsers {
  chat?: {
    pattern: string;
    groups: Array<'timestamp' | 'level' | 'player' | 'message'>;
  };
  join?: {
    pattern: string;
    player_group: number;
  };
  leave?: {
    pattern: string;
    player_group: number;
  };
}

/** Pack.business.shop 字段 */
export interface PackBusinessShop {
  enabled: boolean;
  give_command?: string;
  quality_tiers?: number;
  support_quality?: boolean;
}

/** Pack.business.cdk 字段 */
export interface PackBusinessCdk {
  enabled: boolean;
  redeem_command?: string;
}

/** Pack.business.chat_enhancement 字段（P1-P4） */
export interface PackBusinessChatEnhancement {
  welcome?: { enabled: boolean; first_gift_command?: string };
  periodic_messages?: { enabled: boolean; broadcast_command?: string };
  response_rules?: { enabled: boolean };
  vote_kick?: { enabled: boolean; kick_command?: string };
}

/** Pack.business.players 字段 */
export interface PackBusinessPlayers {
  kick_command?: string;
  ban_command?: string;
}

/** Pack.business.lists 字段 */
export interface PackBusinessLists {
  whitelist_add?: string;
  banlist_add?: string;
}

/** Pack.business.verify 字段 */
export interface PackBusinessVerify {
  enabled: boolean;
}

/** Pack.business 字段（pack-schema-extension.json business） */
export interface PackBusiness {
  shop?: PackBusinessShop;
  cdk?: PackBusinessCdk;
  chat_enhancement?: PackBusinessChatEnhancement;
  players?: PackBusinessPlayers;
  lists?: PackBusinessLists;
  verify?: PackBusinessVerify;
}

/** Pack.commands 字段（通用运维命令模板） */
export interface PackCommands {
  broadcast?: string;
  list_players?: string;
  save_world?: string;
  say_private?: string;
  [key: string]: string | undefined;
}

/** 完整 Pack 对象（packLoader.load 返回值） */
export interface GamePack {
  pack_id: string;
  game: string;
  version: string;
  items?: PackItems;
  event_parsers?: PackEventParsers;
  business?: PackBusiness;
  commands?: PackCommands;
}

// ============================================================================
// 七、聊天/事件解析类型（scheme §5.4 / §2.3.1）
// ============================================================================

/** stdout 解析后的事件类型 */
export type ParsedEventType = 'chat' | 'join' | 'leave';

/** chatMonitor.parseStdout 解析结果 */
export interface ParsedEvent {
  type: ParsedEventType;
  player?: string;
  message?: string;
  timestamp?: string;
  level?: string;
  raw: string;
}

/** 结构化聊天事件（解析后路由用） */
export interface ChatEvent {
  server_id: string;
  player: string;
  message: string;
  timestamp?: string;
  level?: string;
}

// ============================================================================
// 八、Daemon 事件与实例类型（scheme §2.3.1 / server-schema.json）
// ============================================================================

/** Daemon WS 上行事件类型 */
export type DaemonEventType =
  | 'console.output'
  | 'state.change'
  | 'instance.started'
  | 'instance.stopped'
  | 'resource.metrics';

/** Daemon WS 上行事件（scheme §2.3.1） */
export interface DaemonEvent {
  type: DaemonEventType;
  instance_id: string;
  line?: string;
  from?: string;
  to?: string;
  exit_code?: number;
  cpu?: number;
  memory?: number;
  tick?: number;
  players?: number;
  timestamp: string;
}

/** 实例启动配置（daemonClient.startInstance 入参） */
export interface InstanceConfig {
  pack_id: string;
  port: number;
  rcon_port: number;
  rcon_password?: string;
  resource_limits?: Record<string, unknown>;
  shop_enabled?: boolean;
  chat_enabled?: boolean;
  mods_enabled?: boolean;
}

// ============================================================================
// 九、运维管理域类型
// ============================================================================

/** mod_records 表记录（mod-records-schema.json） */
export interface ModRecord {
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

/** save_records 表记录（save-records-schema.json） */
export interface SaveRecord {
  id: number;
  server_id: string;
  save_name: string;
  file_path: string;
  size_bytes: number;
  modified_at: string;
  is_active: boolean;
  created_at: string;
}

/** backup_records 表记录（backup-records-schema.json） */
export interface BackupRecord {
  id: number;
  server_id: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  status: BackupStatus;
}

/** 监控指标输入（recordSnapshot 入参） */
export interface MonitorMetrics {
  cpu_percent?: number | null;
  memory_mb?: number | null;
  tick_rate?: number | null;
  player_count?: number | null;
  json_extra?: string | null;
}

/** monitor_snapshots 表记录（monitor-snapshots-schema.json） */
export interface MonitorSnapshot extends MonitorMetrics {
  id: number;
  server_id: string;
  timestamp: string;
}

/** list_entries 表记录（list-entries-schema.json） */
export interface ListEntry {
  id: number;
  server_id: string;
  list_type: ListType;
  player_name: string;
  added_at: string;
  added_by: string;
  reason: string | null;
}

// ============================================================================
// 十、P5 / 日志 / 配置 / 玩家域类型
// ============================================================================

/** Webhook 配置输入（createWebhook 入参，scheme §4.2.2 P5 待细化） */
export interface WebhookConfig {
  url: string;
  event_types: string[];
  secret?: string;
  enabled?: boolean;
}

/** Webhook 记录（webhook 表，P5 新设计） */
export interface Webhook {
  id: number;
  server_id: string;
  url: string;
  event_types: string[];
  secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** audit_logs 表记录（audit-logs-schema.json） */
export interface AuditLog {
  id: number;
  server_id: string | null;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  ip_address: string | null;
  created_at: string;
}

/** 审计日志查询过滤 */
export interface AuditLogFilter {
  server_id?: string;
  user_id?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** system_config 表记录（system-config-schema.json） */
export interface SystemConfig {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

/** player_histories 表记录（player-histories-schema.json） */
export interface PlayerHistory {
  id: number;
  server_id: string;
  game_player_name: string;
  joined_at: string;
  left_at: string | null;
  ip_address: string | null;
  session_duration: number | null;
  created_at: string;
}

/** periodic_messages 表记录（periodic-messages-schema.json） */
export interface PeriodicMessage {
  id: number;
  server_id: string;
  message: string;
  interval_minutes: number;
  enabled: boolean;
  next_run_at: string;
  created_at: string;
}

/** item_sync_log 表记录（item-sync-log-schema.json） */
export interface ItemSyncLog {
  id: number;
  pack_id: string;
  source_url: string;
  status: ItemSyncStatus;
  items_count: number | null;
  synced_at: string;
  error_message: string | null;
  created_at: string;
}

// ============================================================================
// 十一、调度器类型
// ============================================================================

/** 预定义调度任务类型 */
export type SchedulerTaskType =
  | 'PERIODIC_MESSAGE'
  | 'ITEM_SYNC'
  | 'OPTIMISTIC_LOCK_TIMEOUT_SCAN'
  | 'MONITOR_SNAPSHOT'
  | 'COMMAND_QUEUE_PROCESS'
  | 'STATE_TIMEOUT_SCAN'
  | 'CHAT_LOG_CLEANUP'
  | 'DISK_USAGE_REFRESH'
  | 'AUDIT_LOG_CLEANUP'
  | 'NOTIFICATION_CLEANUP'
  | 'ITEM_SYNC_LOG_CLEANUP'
  | 'AUTO_BACKUP'
  // v3.9.0 新增
  | 'DB_BACKUP'
  | 'DISK_SPACE_MONITOR'
  // v4.2.0-D4 新增：CRON 调度的实例生命周期任务（与 interval_ms/next_run_at 模式互补）
  // CRON_COMMAND: 定时下发游戏控制台命令（如 say/save-all）
  // CRON_START/STOP/RESTART: 定时启动/停止/重启实例
  // CRON_BACKUP: 定时备份（替代 AUTO_BACKUP 的固定 24h 周期，支持 cron 表达式如 "0 3 * * *"）
  | 'CRON_COMMAND'
  | 'CRON_START'
  | 'CRON_STOP'
  | 'CRON_RESTART'
  | 'CRON_BACKUP'
  // v4.6.0-F 新增：告警主动通知系统调度任务
  | 'ALERT_SSL_EXPIRY_CHECK'
  | 'ALERT_BACKUP_HEALTH_CHECK'
  // v5.0.0 L2 新增：节点离线扫描
  | 'NODE_OFFLINE_SCAN'
  // v1 business-logic 新增（business-logic-v1-contracts）：9 个新成员
  | 'VIP_EXPIRY_SCAN' // 激活既有死代码：VIP 过期扫描（每小时）
  | 'VIP_POINTS_CHECK' // 新增：VIP 积分升级检查（每 6 小时）
  | 'INSTANCE_EXPIRY_SCAN' // 新增：实例到期扫描（每小时）
  | 'INSTANCE_GRACE_CLEANUP' // 新增：宽限期清理（每日 3 点）
  | 'INSTANCE_DISK_CLEANUP' // 新增：磁盘清理（每日 4 点）
  | 'INSTANCE_EXPIRY_REMINDER' // 新增：到期提醒（每日 9 点）
  | 'WALLET_DAILY_SNAPSHOT' // 新增：钱包日快照（每日 1 点）
  | 'WALLET_SNAPSHOT_CLEANUP' // 新增：快照清理（每日 5 点）
  | 'QUOTA_ALERT_SCAN' // 新增：配额预警扫描（每日 9 点）
  // v4.28.0 新增（role-permission-economy）：3 个新成员
  | 'SETTLEMENT_RUNNER' // 新增：分账结算扫描（每小时，已结算订单匹配规则写入 pending_balance）
  | 'PENDING_BALANCE_RELEASER' // 新增：冻结期满释放（每小时，pending_balance → balance）
  | 'ADMIN_TIER_EVALUATOR'; // 新增：腐竹等级自动评估（每日凌晨，近 30 天双指标）

/** 调度任务（scheduler.schedule 入参） */
export interface SchedulerTask {
  id?: string;
  type: SchedulerTaskType;
  server_id?: string;
  /** 周期触发间隔（毫秒）。与 cron_expr 二选一，不可同时指定。 */
  interval_ms?: number;
  /** 一次性触发时间（ISO 8601）。可与 interval_ms 组合：首次在 next_run_at 触发，之后按 interval_ms 周期 */
  next_run_at?: string;
  /**
   * v4.2.0-D4 新增：标准 5 字段 cron 表达式（分 时 日 月 周），如 "0 3 * * *" 表示每日 3:00。
   * 与 interval_ms 二选一。若同时指定，cron_expr 优先，interval_ms 被忽略并记录警告。
   * 由 cron-parser 库解析，支持星号斜杠 N 步长、范围（1-5）、列表（1,3,5）、L（最后）/W（最近工作日）等扩展语法。
   */
  cron_expr?: string;
  enabled?: boolean;
  payload?: Record<string, unknown>;
}

// ============================================================================
// 十一-A、系统更新/诊断/改密域类型（v3.4.0 新增）
// 数据契约：system_update_jobs-schema.json / user_password_history-schema.json
// 来源：s0103 融合定稿 v3.4.0
// ============================================================================

/** 系统更新任务类型（system_update_jobs.type） */
export type SystemUpdateJobType = 'git_pull' | 'tar_blue_green';

/** 系统更新任务状态机（system_update_jobs.status） */
export type SystemUpdateJobStatus =
  | 'pending'
  | 'downloading'
  | 'verifying'
  | 'migrating'
  | 'switching'
  | 'smoke_testing'
  | 'succeeded'
  | 'failed'
  | 'rolled_back';

/** system_update_jobs 表记录（system_update_jobs-schema.json） */
export interface SystemUpdateJob {
  id: string;
  user_id: string;
  type: SystemUpdateJobType;
  status: SystemUpdateJobStatus;
  step: string;
  progress: number;
  target_version: string | null;
  is_rollback: boolean;
  rollback_from_job_id: string | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** user_password_history 表记录（user_password_history-schema.json） */
export interface UserPasswordHistory {
  id: string;
  user_id: string;
  password_hash: string;
  created_at: string;
}

/** 构建信息（getBuildInfo 返回） */
export interface BuildInfo {
  version: string;
  commit: string;
  buildTime: string;
  gitBranch: string;
  gitCommit: string;
}

/** 系统更新检查结果（checkSystemUpdate 返回） */
export interface SystemUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseNotes: string;
  downloadUrl: string;
  sha256: string;
}

/** 触发更新响应（performUpdate / rollbackUpdate 返回） */
export interface PerformUpdateResponse {
  jobId: string;
  status: 'started' | 'rollback_started';
}

/** 更新任务状态（getUpdateStatus 返回） */
export interface UpdateStatus {
  jobId: string;
  status: SystemUpdateJobStatus;
  progress: number;
  step: string;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 系统指标快照（getSystemMetrics 返回） */
export interface SystemMetrics {
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptimeSeconds: number;
  nodeVersion: string;
  loadAvg: [number, number, number];
}

/** 服务健康状态（SystemHealth.services 数组元素） */
export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message: string;
}

/** 系统健康聚合状态（getSystemHealth 返回） */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealth[];
  timestamp: string;
}

/** 诊断问题（DiagnosticsResult.problems 数组元素） */
export interface DiagnosticProblem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  fixId: string | null;
}

/** 诊断结果（runDiagnostics 返回） */
export interface DiagnosticsResult {
  problems: DiagnosticProblem[];
  summary: string;
  timestamp: string;
  duration: number;
}

/** 修复响应（applyFix 返回） */
export interface ApplyFixResponse {
  fixId: string;
  success: boolean;
  message: string;
  appliedAt: string;
}

// ============================================================================
// 十二、自定义错误类型（与 error-codes-schema.json 对齐）
// 所有错误继承 Error，含 code 字段；与 error-codes-schema.json predefined_codes 对齐
// ============================================================================

/** 应用错误基类（含 code 字段，对应 error-codes-schema.json 错误码） */
export abstract class AppError extends Error {
  /** 错误码（对应 error-codes-schema.json 中的 code） */
  abstract readonly code: string;
  readonly category?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;
  constructor(message?: string);
}

// 用户/认证域
export class UserNotFoundError extends AppError { readonly code = 'USER_NOT_FOUND'; }
export class UserAlreadyExistsError extends AppError { readonly code = 'USER_ALREADY_EXISTS'; }
export class InvalidCredentialError extends AppError { readonly code = 'INVALID_CREDENTIAL'; }
export class VerifyCodeInvalidError extends AppError { readonly code = 'VERIFY_CODE_INVALID'; }

// VIP 域
export class VipLevelInsufficientError extends AppError { readonly code = 'VIP_LEVEL_INSUFFICIENT'; }
export class VipPermissionNotFoundError extends AppError { readonly code = 'VIP_PERMISSION_NOT_FOUND'; }

// 商店域
export class ShopItemNotFoundError extends AppError { readonly code = 'SHOP_ITEM_NOT_FOUND'; }
export class OrderAlreadyClaimedError extends AppError { readonly code = 'SHOP_ORDER_ALREADY_CLAIMED'; }
export class DailyLimitExceededError extends AppError { readonly code = 'DAILY_LIMIT_EXCEEDED'; }

// CDK 域
export class CdkCodeInvalidError extends AppError { readonly code = 'CDK_CODE_INVALID'; }
export class CdkAlreadyRedeemedError extends AppError { readonly code = 'CDK_ALREADY_REDEEMED'; }

// 命令域
export class CommandRenderError extends AppError { readonly code = 'COMMAND_RENDER_FAILED'; }
export class CommandQueueFullError extends AppError { readonly code = 'COMMAND_QUEUE_FULL'; }

// Pack 域
export class PackLoadError extends AppError { readonly code = 'PACK_LOAD_FAILED'; }
export class PackValidationError extends AppError { readonly code = 'PACK_VALIDATION_FAILED'; }
export class PackNotFoundError extends AppError { readonly code = 'PACK_NOT_FOUND'; }

// 物品同步域
export class ItemSyncFailedError extends AppError { readonly code = 'ITEM_SYNC_FAILED'; }

// 投票域
export class VoteNotFoundError extends AppError { readonly code = 'VOTE_NOT_FOUND'; }
export class VoteAlreadyClosedError extends AppError { readonly code = 'VOTE_ALREADY_CLOSED'; }
export class VoteThresholdNotMetError extends AppError { readonly code = 'VOTE_THRESHOLD_NOT_MET'; }

// 礼包域
export class GiftAlreadyClaimedError extends AppError { readonly code = 'GIFT_ALREADY_CLAIMED'; }

// Mod/存档/备份/监控/名单域
export class ModNotFoundError extends AppError { readonly code = 'MOD_NOT_FOUND'; }
export class ModInstallFailedError extends AppError { readonly code = 'MOD_INSTALL_FAILED'; }
export class SaveNotFoundError extends AppError { readonly code = 'SAVE_NOT_FOUND'; }
export class BackupNotFoundError extends AppError { readonly code = 'BACKUP_NOT_FOUND'; }
export class BackupFailedError extends AppError { readonly code = 'BACKUP_FAILED'; }
export class MonitorDataNotFoundError extends AppError { readonly code = 'MONITOR_DATA_NOT_FOUND'; }
export class EntryNotFoundError extends AppError { readonly code = 'ENTRY_NOT_FOUND'; }
export class EntryAlreadyExistsError extends AppError { readonly code = 'ENTRY_ALREADY_EXISTS'; }

// Webhook 域
export class WebhookNotFoundError extends AppError { readonly code = 'WEBHOOK_NOT_FOUND'; }
export class WebhookDeliveryFailedError extends AppError { readonly code = 'WEBHOOK_DELIVERY_FAILED'; }

// 定时消息域
export class MessageNotFoundError extends AppError { readonly code = 'MESSAGE_NOT_FOUND'; }

// Daemon/实例域
export class DaemonUnreachableError extends AppError { readonly code = 'DAEMON_UNREACHABLE'; }
export class InstanceNotFoundError extends AppError { readonly code = 'INSTANCE_NOT_FOUND'; }
export class InstanceNotRunningError extends AppError { readonly code = 'INSTANCE_NOT_RUNNING'; }

// 并发域
export class OptimisticLockTimeoutError extends AppError { readonly code = 'OPTIMISTIC_LOCK_TIMEOUT'; }

// 系统更新/诊断/改密域（v3.4.0 新增）
export class SystemUpdateDownloadFailedError extends AppError { readonly code = 'SYSTEM_UPDATE_001'; }
export class SystemUpdateVerifyFailedError extends AppError { readonly code = 'SYSTEM_UPDATE_002'; }
export class SystemUpdateMigrationFailedError extends AppError { readonly code = 'SYSTEM_UPDATE_003'; }
export class SystemMetricsCollectionFailedError extends AppError { readonly code = 'SYSTEM_METRICS_001'; }
export class SystemFixInvalidError extends AppError { readonly code = 'SYSTEM_FIX_001'; }
export class UpdateJobNotFoundError extends AppError { readonly code = 'SYSTEM_JOB_NOT_FOUND'; }
export class PasswordStrengthInsufficientError extends AppError { readonly code = 'AUTH_PWD_002'; }
export class PasswordReusedError extends AppError { readonly code = 'AUTH_PWD_003'; }

// ===== v1 business-logic 扩展（合并自 shared-types-extension.d.ts） =====
// 来源：.trae/specs/business-logic-v1-contracts/interface_stub/shared-types-extension.d.ts
// 说明：本节为 business-logic v1 实施新增的共享类型，与既有类型保持命名约定一致
//   - server_id / user_id 统一 string (UUID)
//   - 时间戳统一 string (ISO 8601)
//   - 乐观锁状态字段使用字面量联合类型
//   - 错误码与 error-codes-schema.json predefined_codes 对齐（v1 已扩展 wallet/recharge/refund/coupon/expiry/quota/points 七类）

// ----------------------------------------------------------------------------
// v1-A、新增字面量类型
// ----------------------------------------------------------------------------

/** 实例过期状态机（server-schema.json expiry_status 字段） */
export type InstanceExpiryStatus =
  | 'permanent' // 永久实例（默认）
  | 'active' // 有效期内
  | 'grace' // 宽限期内（已停止但可续费）
  | 'expired' // 已过期（待清理）
  | 'cleaned'; // 已清理磁盘

/** VIP 类型分层（user_instance_bindings.vip_type 字段） */
export type VipType = 'permanent' | 'monthly' | 'quarterly' | 'yearly';

/** 充值 CDK 状态机（recharge-cdks-schema.json status 字段） */
export type RechargeCdkStatus = 'unused' | 'claiming' | 'used' | 'expired';

/** 退款申请状态机（wallet-refund-orders-schema.json status 字段） */
export type RefundOrderStatus =
  | 'pending' // 待审批
  | 'approved' // 已批准（待执行退款）
  | 'rejected' // 已拒绝
  | 'completed' // 已完成（点券已退回）
  | 'cancelled'; // 已撤销（用户主动撤销）

/** 用户优惠券状态机（user-coupons-schema.json status 字段） */
export type UserCouponStatus = 'unused' | 'used' | 'expired';

/** 优惠券折扣类型（coupons-schema.json discount_type 字段） */
export type CouponDiscountType = 'percent' | 'fixed';

/** 优惠券适用范围（coupons-schema.json scope 字段） */
export type CouponScope = 'global' | 'server' | 'item';

/** 续费类型（instance-renewals-schema.json renewal_type 字段）
 * v3-billing 扩展：新增 'auto'（VPS 自动续扣） */
export type InstanceRenewalType = 'manual' | 'gift' | 'auto';

/** 积分来源（vipPointService.addPoints source 参数） */
export type PointsSource = 'purchase' | 'checkin' | 'cdk_redeem' | 'admin_adjust';

// ----------------------------------------------------------------------------
// v1-B、新增实体类型（对应 JSON Schema）
// ----------------------------------------------------------------------------

/** instance_renewals 表记录（instance-renewals-schema.json） */
export interface InstanceRenewal {
  id: number;
  instance_id: string;
  user_id: string;
  duration_days: number;
  amount_paid: number;
  base_amount: number;
  tier_discount_applied: number;
  vip_discount_applied: number;
  vip_level_at_renewal: number;
  renewal_type: InstanceRenewalType;
  use_wallet: boolean;
  old_expires_at: string | null;
  new_expires_at: string | null;
  renewed_at: string;
  /** v4.28.0 新增：扣款源（默认 user_wallets；腐竹续费自有实例时为 admin_wallets） */
  wallet_source: WalletSource;
  /** v4.28.0 新增：应用的腐竹等级折扣快照（1.0=无折扣，审计用；玩家续费为 null） */
  admin_tier_discount_applied: number | null;
  /** v4.28.0 新增：续费时点节点来源快照（审计用，便于追溯豁免依据） */
  node_source_at_renewal: NodeSource | null;
  /** v3-billing 新增：VPS 计费周期（月）。1/3/6/12；null=非 VPS 计费（如 gift 赠送） */
  billing_cycle_months?: BillingCycleMonths | null;
  /** v3-billing 新增：续费时实例类型快照（审计用，防后续 instance_type 修改导致追溯失真） */
  instance_type_snapshot?: InstanceType | null;
}

/** recharge_cdks 表记录（recharge-cdks-schema.json） */
export interface RechargeCdk {
  id: number;
  code: string;
  face_value: number;
  batch_id: number;
  status: RechargeCdkStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  claiming_locked_at: string | null;
  expires_at: string;
  created_by: string;
  created_at: string;
}

/** recharge_cdk_batches 表记录（recharge-cdk-batches-schema.json） */
export interface RechargeCdkBatch {
  id: number;
  batch_name: string;
  batch_description: string | null;
  total_count: number;
  used_count: number;
  face_value: number;
  total_face_value: number;
  expires_at: string;
  status: 'active' | 'archived';
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

/** wallet_refund_orders 表记录（wallet-refund-orders-schema.json） */
export interface WalletRefundOrder {
  id: number;
  user_id: string;
  server_id: string;
  order_id: number | null;
  amount: number;
  reason: string;
  admin_note: string | null;
  status: RefundOrderStatus;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  completed_at: string | null;
}

/** wallet_daily_snapshots 表记录（wallet-daily-snapshots-schema.json） */
export interface WalletDailySnapshot {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  snapshot_date: string; // YYYY-MM-DD
  snapshot_at: string;
}

/** coupons 表记录（coupons-schema.json） */
export interface Coupon {
  id: number;
  code: string;
  display_name: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
  valid_from: string;
  valid_until: string;
  usage_limit: number | null;
  used_count: number;
  scope: CouponScope;
  scope_id: string | null;
  created_by: string;
  created_at: string;
}

/** user_coupons 表记录（user-coupons-schema.json） */
export interface UserCoupon {
  id: number;
  user_id: string;
  coupon_id: number;
  server_id: string | null;
  status: UserCouponStatus;
  claimed_at: string;
  used_at: string | null;
  order_id: number | null;
}

/** user_vip_points 表记录（user-vip-points-schema.json） */
export interface UserVipPoints {
  id: number;
  user_id: string;
  server_id: string;
  points: number;
  total_earned: number;
  last_checkin_at: string | null;
  last_checkin_date: string | null;
  last_upgrade_at: string | null;
  highest_vip_level: number;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------------
// v1-B-补、既有实体类型首次纳入契约（B-NEW-1 修复）
// ----------------------------------------------------------------------------
// 以下类型在既有 impl 已使用但从未在 public/interface_stub 声明，
// 本次 v1 契约首次纳入。字段定义与 panel/backend/src/services/walletService.ts / quotaService.ts
// 及 public/schema/panel-api-types.ts 完全对齐。

/** 配额作用域类型（与 panel-api-types.ts QuotaScopeType 对齐） */
export type QuotaScopeType = 'role' | 'user';

/** user_wallets 表记录（user-wallets-schema.json，DB 行类型） */
export interface UserWallet {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  last_daily_claim_at: string | null;
  last_daily_claim_date: string | null;
  created_at: string;
  updated_at: string;
}

/** 钱包信息（含 can_claim_daily 状态 + daily_reward_amount，与 panel-api-types.ts WalletInfo 对齐） */
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

/** resource_quotas 表记录（与 panel-api-types.ts ResourceQuota 对齐） */
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

/** 用户当前用量（与 panel-api-types.ts QuotaUsage 对齐） */
export interface QuotaUsage {
  user_id: string;
  instances_used: number;
  disk_used_mb: number;
  players_online: number;
}

/** 配额预警结果（v1 新增 DTO，quotaService.getQuotaAlerts 返回） */
export interface QuotaAlertResult {
  user_id: string;
  alerts: Array<{
    resource_type: 'instances' | 'disk' | 'players';
    used: number;
    limit: number | null; // null=不限
    percent: number; // 0-100，limit=null 时为 0
    level: 'warning' | 'critical';
  }>;
  has_alerts: boolean;
}

// ----------------------------------------------------------------------------
// v1-C、服务调用 DTO 类型
// ----------------------------------------------------------------------------

/** 创建充值 CDK 批次输入（rechargeCdkService.createBatch） */
export interface RechargeCdkCreateBatchInput {
  batch_name: string;
  batch_description?: string | null;
  total_count: number;
  face_value: number;
  expires_at: string;
}

/** 充值 CDK 列表查询过滤（rechargeCdkService.listBatches） */
export interface RechargeCdkListFilter {
  status?: 'active' | 'archived';
  created_after?: string;
  created_before?: string;
}

/** 到期扫描结果统计（instanceExpiryService 调度任务返回） */
export interface ExpiryScanResult {
  scanned: number;
  processed: number;
  notified: number;
  errors: number;
  error_details?: Array<{ server_id: string; reason: string }>;
}

/** 到期处置配置（instanceExpiryService.getExpiryConfig） */
export interface ExpiryConfig {
  reminder_days_before: number[];
  grace_days: number;
  retention_days: number;
  stop_on_expire: boolean;
  cleanup_disk_after_retention: boolean;
  scan_interval_hours: number;
}

// ----------------------------------------------------------------------------
// v1-D、新增错误类（与 error-codes-schema.json predefined_codes v1 扩展对齐）
// 注意：本节错误类继承 Error 而非 AppError，与草案 shared-types-extension.d.ts 原样保留
// ----------------------------------------------------------------------------

export class WalletNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletNotFoundError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export class RechargeCdkInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkInvalidError';
  }
}

export class RechargeCdkAlreadyRedeemedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkAlreadyRedeemedError';
  }
}

export class RechargeCdkExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkExpiredError';
  }
}

export class RechargeCdkBatchNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkBatchNotFoundError';
  }
}

export class RechargeCdkBatchCreateFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkBatchCreateFailedError';
  }
}

export class BindingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingNotFoundError';
  }
}

export class RefundOrderNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundOrderNotFoundError';
  }
}

export class RefundOrderNotPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundOrderNotPendingError';
  }
}

export class OrderNotRefundableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderNotRefundableError';
  }
}

export class CouponInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponInvalidError';
  }
}

export class CouponAlreadyClaimedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponAlreadyClaimedError';
  }
}

export class CouponUsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponUsageLimitExceededError';
  }
}

export class CouponNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponNotApplicableError';
  }
}

export class InstanceNotRenewableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceNotRenewableError';
  }
}

export class InstanceExpiryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceExpiryConfigError';
  }
}

export class VipPointsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VipPointsConfigError';
  }
}

/** VIP 等级升级失败（无 active 绑定记录等，对应 VIP_LEVEL_UPGRADE_FAILED） */
export class VipLevelUpgradeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VipLevelUpgradeFailedError';
  }
}

/** 今日已签到（防重，对应 VIP_CHECKIN_ALREADY_TODAY） */
export class CheckinAlreadyTodayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckinAlreadyTodayError';
  }
}

// ----- 以下为 B-NEW-1 / S-NEW-2 修复：补齐 Error 类声明 -----
// - DailyRewardAlreadyClaimedError：既有 impl errors.ts:507 已用，本次首次纳入契约
// - RefundAmountExceedsLimitError / QuotaLimitReachedError / QuotaConfigError：v1 新增契约类（impl 待实现）

/** 今日已领取每日奖励（既有 impl errors.ts:507 已用，本次首次纳入契约） */
export class DailyRewardAlreadyClaimedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyRewardAlreadyClaimedError';
  }
}

/** 退款金额超限（amount > system_config.wallet.refund_max_amount） */
export class RefundAmountExceedsLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundAmountExceedsLimitError';
  }
}

/** 配额已达上限（max_instances / max_disk_mb / max_players_total） */
export class QuotaLimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaLimitReachedError';
  }
}

/** 配额配置错误（vip.quota_overrides JSON 解析失败等） */
export class QuotaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaConfigError';
  }
}

/** VipLevel 类型别名（0-5） */
export type VipLevel = 0 | 1 | 2 | 3 | 4 | 5;

// ============================================================================
// v4.28.0、腐竹经济域类型（role-permission-economy-system-plan）
// 数据契约：admin-wallets / admin-wallet-transactions / admin-tiers /
//           user-admin-tiers / settlement-rules / settlement-records / nodes-schema
// 来源：docs/plans/role-permission-economy-system-plan.md（决策 D1-D4，人类裁决批准）
// 设计要点：
//   - 腐竹 = instance_admin（不新增角色，叠加 admin_tier 维度承载权限分级）
//   - admin_wallets 与 user_wallets 物理隔离，禁止互转（防洗钱）
//   - 分账资金 T+7 冻结期（settlement_delay_hours=168），仅 balance 可消费/提现
//   - 自带节点（node_source=self_hosted）完全免费 + 完全自主，需 server_admin 审核
// ============================================================================

// ----------------------------------------------------------------------------
// v4.28.0-A、新增字面量类型
// ----------------------------------------------------------------------------

/** 节点来源（nodes-schema.json node_source 字段） */
export type NodeSource = 'platform_managed' | 'self_hosted';

/** 自带节点审核状态（nodes-schema.json approval_status 字段） */
export type NodeApprovalStatus = 'pending' | 'approved' | 'rejected';

/** 续费扣款源（instance-renewals-schema.json wallet_source 字段） */
export type WalletSource = 'user_wallets' | 'admin_wallets';

/** 结算周期（admin-wallets-schema.json settlement_cycle 字段） */
export type SettlementCycle = 'daily' | 'weekly' | 'monthly';

/** 腐竹账户流水类型（admin-wallet-transactions-schema.json transaction_type 字段） */
export type AdminWalletTransactionType =
  | 'credit' // 加款（充值/赠送/退款回滚）
  | 'debit' // 扣款（资源费/手续费）
  | 'freeze' // 冻结（分账入 pending_balance）
  | 'unfreeze' // 解冻（pending_balance → balance）
  | 'settle' // 分账结算
  | 'withdraw' // 提现
  | 'refund'; // 退款冲正

/** 流水方向（admin-wallet-transactions-schema.json direction 字段） */
export type AdminWalletDirection = 'in' | 'out';

/** 流水来源类型（admin-wallet-transactions-schema.json source_type 字段） */
export type AdminWalletSourceType =
  | 'settlement' // 平台分账
  | 'recharge' // 腐竹充值（线下付费，server_admin 手动加款）
  | 'gift' // 平台赠送
  | 'refund' // 退款回滚
  | 'fee' // 资源费支出
  | 'withdrawal' // 提现
  | 'adjustment'; // 人工调整（server_admin）

/** 流水状态（admin-wallet-transactions-schema.json status 字段） */
export type AdminWalletTransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

/** 分账规则作用域（settlement-rules-schema.json scope_type 字段） */
export type SettlementScopeType = 'instance' | 'game_type' | 'global';

/** 分账来源类型（settlement-records-schema.json source_type 字段） */
export type SettlementSourceType = 'shop_order' | 'instance_renewal';

/** 分账记录状态机（settlement-records-schema.json status 字段） */
export type SettlementRecordStatus =
  | 'pending' // 冻结中（T+7 冻结期内）
  | 'released' // 已释放（pending_balance → balance）
  | 'reversed'; // 已冲正（退款触发）

/** 腐竹高级功能（admin-tiers-schema.json advanced_features JSON 数组可选值） */
export type AdminAdvancedFeature =
  | 'cross_server_vote' // 跨服投票
  | 'cross_server_chat' // 跨服聊天
  | 'cloud_backup' // 云备份
  | 'analytics_dashboard' // 数据分析仪表盘
  | 'self_hosted_node' // 自带节点接入
  | 'priority_support'; // 优先技术支持

/** 腐竹等级字面量（0-4） */
export type AdminTierLevel = 0 | 1 | 2 | 3 | 4;

// ----------------------------------------------------------------------------
// v4.28.0-B、新增实体类型（对应 JSON Schema）
// ----------------------------------------------------------------------------

/** admin_wallets 表记录（admin-wallets-schema.json，腐竹跨实例聚合账户） */
export interface AdminWallet {
  id: number;
  admin_user_id: string;
  /** 可用余额（可消费/可提现） */
  balance: number;
  /** 待结算分账余额（冻结期内不可用） */
  pending_balance: number;
  /** 欠款金额（退款时已分账资金不足，由后续分账自动抵扣） */
  owed_amount: number;
  total_earned: number;
  total_spent: number;
  total_withdrawn: number;
  settlement_cycle: SettlementCycle;
  last_settled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** admin_wallet_transactions 表记录（admin-wallet-transactions-schema.json，流水审计） */
export interface AdminWalletTransaction {
  id: number;
  admin_user_id: string;
  wallet_id: number;
  transaction_type: AdminWalletTransactionType;
  /** 金额（正数） */
  amount: number;
  direction: AdminWalletDirection;
  source_type: AdminWalletSourceType;
  /** 关联 ID（订单ID/续费记录ID/分账记录ID） */
  source_ref: string | null;
  /** 操作后余额快照（审计用） */
  balance_after: number;
  /** 操作后冻结余额快照 */
  pending_balance_after: number;
  status: AdminWalletTransactionStatus;
  /** 扩展字段（JSON 字符串：规则快照、操作员ID 等） */
  metadata: string | null;
  created_at: string;
  completed_at: string | null;
}

/** admin_tiers 表记录（admin-tiers-schema.json，腐竹等级配置） */
export interface AdminTier {
  id: number;
  tier: AdminTierLevel;
  display_name: string;
  /** 实例数上限，null=不限 */
  max_instances: number | null;
  /** 单实例玩家上限，null=不限 */
  max_players_per_instance: number | null;
  /** 资源费折扣系数（1.0=无折扣，0.7=7 折） */
  resource_fee_discount: number;
  /** 腐竹默认分账比例（实际以 settlement_rules 匹配为准） */
  settlement_share: number;
  /** 高级功能列表（JSON 数组字符串，元素为 AdminAdvancedFeature） */
  advanced_features: string;
  /** API 密钥数上限，null=不限，0=不可用 */
  max_api_keys: number | null;
  /** 是否支持即时分账结算（跳过 T+7，收手续费） */
  instant_settlement: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** user_admin_tiers 表记录（user-admin-tiers-schema.json，用户↔腐竹等级一对一关联） */
export interface UserAdminTier {
  id: number;
  user_id: string;
  tier_id: number;
  /** 分配操作者（server_admin）；null=系统自动评估 */
  assigned_by: string | null;
  assigned_at: string;
  /** 最近自动评估时间；null=从未评估 */
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** settlement_rules 表记录（settlement-rules-schema.json，分账规则配置） */
export interface SettlementRule {
  id: number;
  rule_name: string;
  scope_type: SettlementScopeType;
  /** 作用域引用（instance_id / game_type / null=global） */
  scope_ref: string | null;
  /** 适用腐竹等级，null=全部 */
  admin_tier: AdminTierLevel | null;
  /** 平台分成比例（platform_share + admin_share = 1.0） */
  platform_share: number;
  /** 腐竹分成比例 */
  admin_share: number;
  /** 最低结算金额（低于此值累计到下次） */
  min_settlement_amount: number;
  /** 结算延迟/冻结期（小时，默认 168=7 天） */
  settlement_delay_hours: number;
  effective_from: string;
  /** null=永久有效 */
  effective_until: string | null;
  /** 优先级（多规则匹配时取最高） */
  priority: number;
  created_at: string;
  updated_at: string;
}

/** settlement_records 表记录（settlement-records-schema.json，分账结算记录） */
export interface SettlementRecord {
  id: number;
  admin_user_id: string;
  source_type: SettlementSourceType;
  /** 关联订单ID/续费记录ID */
  source_ref: string;
  instance_id: string;
  order_amount: number;
  platform_share_amount: number;
  admin_share_amount: number;
  /** 应用的分账规则 ID。null=未匹配到规则（默认 platform_share=1.0 全归平台，与 settlement-records-schema.json 对齐） */
  rule_id: number | null;
  /** 规则快照（JSON 字符串，防规则后续修改导致追溯失真） */
  rule_snapshot: string;
  status: SettlementRecordStatus;
  settled_at: string;
  released_at: string | null;
  reversed_at: string | null;
  reversed_reason: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// v4.28.0-C、服务调用 DTO 类型
// ----------------------------------------------------------------------------

/** 腐竹钱包信息（adminWalletService.getWalletInfo 返回，含等级与可提现状态） */
export interface AdminWalletInfo extends AdminWallet {
  /** 当前腐竹等级（0-4） */
  tier: AdminTierLevel;
  tier_display_name: string;
  /** 可提现金额（= balance，pending_balance 不可提现） */
  withdrawable_amount: number;
}

/** 腐竹提现申请输入（adminWalletService.requestWithdrawal） */
export interface WithdrawalRequestInput {
  amount: number;
  /** 收款方式快照（JSON：银行卡号/户名/开户行等，敏感字段前端用 SensitiveInput） */
  payout_info: string;
  note?: string | null;
}

/** 腐竹续费自有实例输入（adminWalletService.renewOwnInstance） */
export interface AdminRenewInstanceInput {
  instance_id: string;
  duration_days: number;
}

/** 腐竹续费结果（含折扣链快照） */
export interface AdminRenewInstanceResult {
  renewal: InstanceRenewal;
  base_amount: number;
  tier_discount_applied: number;
  admin_tier_discount_applied: number;
  amount_paid: number;
  /** true=自带节点豁免（amount_paid=0） */
  exempted: boolean;
}

/** 分账规则匹配结果（settlementService.matchRule 返回；null=未匹配，默认 platform_share=1.0 不分账） */
export interface SettlementRuleMatch {
  rule: SettlementRule | null;
  platform_share: number;
  admin_share: number;
}

// ----------------------------------------------------------------------------
// v4.28.0-D、新增错误类（与 error-codes-schema.json predefined_codes v4.28.0 扩展对齐）
// 风格与 v1-D 节一致：继承 Error，name 与类名相同
// ----------------------------------------------------------------------------

/** 腐竹账户不存在（对应 ADMIN_WALLET_NOT_FOUND） */
export class AdminWalletNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletNotFoundError';
  }
}

/** 腐竹账户余额不足（对应 ADMIN_WALLET_INSUFFICIENT_BALANCE，HTTP 402） */
export class AdminWalletInsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletInsufficientBalanceError';
  }
}

/** 冻结期分账不可消费/提现（对应 ADMIN_WALLET_PENDING_NOT_SPENDABLE） */
export class AdminWalletPendingNotSpendableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletPendingNotSpendableError';
  }
}

/** 账户体系隔离禁止互转（对应 ADMIN_WALLET_TRANSFER_FORBIDDEN） */
export class AdminWalletTransferForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminWalletTransferForbiddenError';
  }
}

/** 提现申请不存在（对应 WITHDRAWAL_NOT_FOUND） */
export class WithdrawalNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalNotFoundError';
  }
}

/** 提现申请非 pending 状态（对应 WITHDRAWAL_NOT_PENDING） */
export class WithdrawalNotPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalNotPendingError';
  }
}

/** 提现金额低于最低限额（对应 WITHDRAWAL_BELOW_MIN_AMOUNT） */
export class WithdrawalBelowMinAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalBelowMinAmountError';
  }
}

/** 分账规则不存在（对应 SETTLEMENT_RULE_NOT_FOUND） */
export class SettlementRuleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementRuleNotFoundError';
  }
}

/** 分账规则非法（对应 SETTLEMENT_RULE_INVALID：比例和≠1.0 / 越界 / 时间反转） */
export class SettlementRuleInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementRuleInvalidError';
  }
}

/** 分账记录不存在（对应 SETTLEMENT_RECORD_NOT_FOUND） */
export class SettlementRecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementRecordNotFoundError';
  }
}

/** 腐竹等级配置不存在（对应 ADMIN_TIER_NOT_FOUND） */
export class AdminTierNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTierNotFoundError';
  }
}

/** 腐竹等级限额已达上限（对应 ADMIN_TIER_LIMIT_EXCEEDED，HTTP 429） */
export class AdminTierLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTierLimitExceededError';
  }
}

/** 高级功能未解锁（对应 ADMIN_TIER_FEATURE_LOCKED） */
export class AdminTierFeatureLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminTierFeatureLockedError';
  }
}

/** 自带节点未通过审核（对应 SELF_HOSTED_NODE_NOT_APPROVED） */
export class SelfHostedNodeNotApprovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfHostedNodeNotApprovedError';
  }
}

// ============================================================================
// v3-billing 域类型（instance-billing-rules-plan，VPS 式预付费计费）
// 数据契约：
//   - public/schema/instance-type-pricing-schema.json
//   - public/schema/instance-billing-settings-schema.json
//   - public/schema/instance-renewals-schema.json（扩展 billing_cycle_months / instance_type_snapshot）
//   - public/schema/server-schema.json（扩展 billing_type）
// 来源：docs/plans/instance-billing-rules-plan.md §0（VPS 式简化定稿，2026-07-28）
// 设计要点：
//   - 实例按类型（micro/small/medium/large/xlarge）月费 × 周期 × 折扣计费，与人数无关
//   - 预付费扣全额，周期内不再扣款；到期自动续扣（沿用上次周期）
//   - 免计费判定：billing_exempt > self_hosted node > owner_self
// ============================================================================

// ----------------------------------------------------------------------------
// v3-billing-A、新增字面量类型
// ----------------------------------------------------------------------------

/** 实例类型（instance-type-pricing-schema.json instance_type 字段）
 * 与 pack.business.instance.type 解耦——本枚举仅承载计费维度，pack 仍按游戏自由扩展 */
export type InstanceType = 'micro' | 'small' | 'medium' | 'large' | 'xlarge';

/** VPS 计费周期（月）
 * - 1=月付，3=季付，6=半年付，12=年付
 * - duration_days = billing_cycle_months × days_per_month（days_per_month 由 system_config.instance.billing.days_per_month 配置，默认 30）
 */
export type BillingCycleMonths = 1 | 3 | 6 | 12;

/** 实例计费类型快照（server-schema.json billing_type 字段）
 * - null=未接入计费（兼容历史实例）
 * - 'vps_prepaid'=VPS 预付费 */
export type InstanceBillingType = 'vps_prepaid';

/** 免计费原因（instance-billing-settings-schema.json exempt_reason 字段）
 * 优先级：billing_exempt(manual) > self_hosted_node > owner_self */
export type BillingExemptReason =
  | 'owner_self' // 实例管理员自有实例（servers.owner_user_id == operator）
  | 'self_hosted_node' // 自带节点实例（nodes.node_source='self_hosted' 且 approval_status='approved'）
  | 'manual'; // 系统管理员手动豁免（instance_billing_settings.billing_exempt=true）

// ----------------------------------------------------------------------------
// v3-billing-B、新增实体类型（对应 JSON Schema）
// ----------------------------------------------------------------------------

/** instance_type_pricing 表记录（instance-type-pricing-schema.json，类型定价配置） */
export interface InstanceTypePricing {
  id: string;
  instance_type: InstanceType;
  /** 显示名（如 "微型 / 1C2G"） */
  display_name: string;
  /** 基础月费（点券）。0=免费类型 */
  monthly_price: number;
  /** 季付折扣系数（1.0=无折扣，0.9=9 折） */
  quarterly_discount: number;
  /** 半年付折扣系数 */
  semiannual_discount: number;
  /** 年付折扣系数 */
  annual_discount: number;
  /** 推荐玩家数（仅展示参考，不参与计费） */
  recommended_slots: number | null;
  /** CPU 限额（如 "1.0"=1 核，仅展示参考） */
  cpu_limit: string | null;
  /** 内存限额（MB，仅展示参考） */
  memory_limit_mb: number | null;
  /** 磁盘限额（GB，仅展示参考） */
  disk_limit_gb: number | null;
  /** 描述（前台展示） */
  description: string | null;
  /** 状态：active=生效中，archived=已归档（不可用于新计费，存量保留） */
  status: 'active' | 'archived';
  /** 创建者 user_id（仅 system_admin 可创建/修改） */
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** instance_billing_settings 表记录（instance-billing-settings-schema.json，实例计费设置）
 * 每个实例一行，首次访问自动创建（instance_type 默认 'small'） */
export interface InstanceBillingSettings {
  id: string;
  instance_id: string;
  /** 实例类型（决定月费来源） */
  instance_type: InstanceType;
  /** 实例级覆盖月费（null=用 instance_type_pricing.monthly_price） */
  custom_monthly_price: number | null;
  /** 是否豁免计费 */
  billing_exempt: boolean;
  /** 豁免原因（仅 billing_exempt=true 时有值） */
  exempt_reason: BillingExemptReason | null;
  /** 是否启用自动续扣（默认 true） */
  auto_renew_enabled: boolean;
  /** 上次计费周期（自动续扣沿用此值）。null=尚未续费过（首次自动续扣默认 1=月付） */
  last_billing_cycle_months: BillingCycleMonths | null;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------------
// v3-billing-D、新增错误类（与 error-codes-schema.json v3-billing 扩展对齐）
// ----------------------------------------------------------------------------

/** 实例类型定价不存在或已归档（对应 INSTANCE_TYPE_PRICING_NOT_FOUND） */
export class InstanceTypePricingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceTypePricingNotFoundError';
  }
}

/** 实例计费设置不存在（对应 INSTANCE_BILLING_SETTINGS_NOT_FOUND） */
export class InstanceBillingSettingsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceBillingSettingsNotFoundError';
  }
}

/** 实例已过期且未续费，禁止启动（对应 INSTANCE_EXPIRED_NOT_RENEWED） */
export class InstanceExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceExpiredError';
  }
}

/** 计费豁免冲突（如尝试对豁免实例执行扣款）（对应 BILLING_EXEMPT_CONFLICT） */
export class BillingExemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingExemptError';
  }
}

/** 计费周期非法（不在 {1,3,6,12} 范围）（对应 INVALID_BILLING_CYCLE） */
export class InvalidBillingCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBillingCycleError';
  }
}

/** 腐竹全局余额不足（对应 GLOBAL_BALANCE_INSUFFICIENT，HTTP 402）
 * 区别于 InsufficientBalanceError(400, 玩家 user_wallets) 与
 * AdminWalletInsufficientBalanceError(402, 腐竹 admin_wallets)。
 * VPS 计费扣 global_balances 表（通过 user_id 隔离的腐竹全局账户）。 */
export class GlobalBalanceInsufficientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobalBalanceInsufficientError';
  }
}
