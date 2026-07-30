// ============================================================================
// Admin API 领域切片 — 管理员功能（用户/系统配置/VIP/Pack/审计日志）
// PanelApiClient 通过 extends 组合各领域接口
// ============================================================================

import type {
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserResponse,
  GetUserResponse,
  ListUsersResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  UpdateUserRoleRequest,
  UpdateUserRoleResponse,
  // v4.24.0: 用户批量管理与分析
  BatchUserOperationRequest,
  BatchUserOperationResponse,
  UserStatsResponse,
  DeleteSystemConfigResponse,
  GetSystemConfigResponse,
  ListSystemConfigsResponse,
  SetSystemConfigRequest,
  SetSystemConfigResponse,
  CreateVipPermissionRequest,
  CreateVipPermissionResponse,
  DeleteVipPermissionResponse,
  GetVipPermissionResponse,
  ListVipPermissionsResponse,
  UpdateVipPermissionRequest,
  UpdateVipPermissionResponse,
  TriggerItemSyncResponse,
  ListItemSyncLogsResponse,
  ListPackItemsResponse,
  ListAuditLogsQuery,
  ListAuditLogsResponse,
  // v3.6.2: 运维清理聚合页
  MaintenanceOverviewResponse,
  CleanupRequest,
  CleanupResponse,
  RetentionUpdateRequest,
  RetentionUpdateResponse,
  // I3: API Key 管理（v4.4.0-J1）
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  GetApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyResponse,
  // v4.33.0: B7 类型契约漂移治理——提现审批与清理预览类型已上推 public 契约（s0601）
  // 注：PendingWithdrawItem / ListPendingWithdrawsResponse / CleanupAllPreviewResponse
  //     已在下方 re-export 直接 from public 契约，此处无需重复 import
  ListPendingWithdrawsResponse,
  CleanupAllPreviewResponse,
} from '@public/schema/panel-api-types';

// I3: API Key 领域类型重新导出，供页面直接 import 自 modules/admin
export type {
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  GetApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyResponse,
} from '@public/schema/panel-api-types';

// v4.33.0: 提现审批 / 清理预览类型重新导出（唯一真相源为 public/schema/panel-api-types.ts）
export type {
  PendingWithdrawItem,
  ListPendingWithdrawsResponse,
  CleanupAllPreviewResponse,
} from '@public/schema/panel-api-types';

/** POST /api/packs/reload 响应体（camelCase，已从后端 snake_case 转换） */
export interface ReloadPacksResult {
  loaded: string[];
  failed: Array<{ pack: string; error: string }>;
  total: number;
}

/**
 * GET /api/users 查询参数
 *
 * 不传 page/page_size 时后端返回全部用户（向后兼容旧行为）。
 * 传 page/page_size 时后端按服务端分页返回，total 为过滤后总条数（非分页后行数）。
 */
export interface ListUsersQuery {
  /** 页码（从 1 开始），不传则不分页 */
  page?: number;
  /** 每页大小（1-100，默认 20），仅 page 传入时生效 */
  page_size?: number;
  /** 服务端关键字搜索（email / username 模糊匹配） */
  keyword?: string;
}

export interface AdminApi {
  // P1 管理员 API
  listUsers(query?: ListUsersQuery): Promise<ListUsersResponse>;
  getUser(id: string): Promise<GetUserResponse>;
  /** v3.1.0 新增：管理员创建用户 */
  createUser(req: CreateUserRequest): Promise<CreateUserResponse>;
  updateUser(id: string, req: UpdateUserRequest): Promise<UpdateUserResponse>;
  /** v3.1.0 新增：仅修改用户角色 */
  updateUserRole(id: string, req: UpdateUserRoleRequest): Promise<UpdateUserRoleResponse>;
  /** v3.1.0 新增：软删除用户 */
  deleteUser(id: string): Promise<DeleteUserResponse>;
  /** v4.24.0 新增：批量操作用户（启用/禁用/删除/改角色） */
  batchOperateUsers(req: BatchUserOperationRequest): Promise<BatchUserOperationResponse>;
  /** v4.24.0 新增：用户分析统计 */
  getUserStats(): Promise<UserStatsResponse>;
  listSystemConfigs(): Promise<ListSystemConfigsResponse>;
  getSystemConfig(key: string): Promise<GetSystemConfigResponse>;
  setSystemConfig(key: string, req: SetSystemConfigRequest): Promise<SetSystemConfigResponse>;
  deleteSystemConfig(key: string): Promise<DeleteSystemConfigResponse>;
  listVipPermissions(): Promise<ListVipPermissionsResponse>;
  getVipPermission(level: number): Promise<GetVipPermissionResponse>;
  createVipPermission(req: CreateVipPermissionRequest): Promise<CreateVipPermissionResponse>;
  updateVipPermission(
    level: number,
    req: UpdateVipPermissionRequest,
  ): Promise<UpdateVipPermissionResponse>;
  deleteVipPermission(level: number): Promise<DeleteVipPermissionResponse>;
  triggerItemSync(packId: string): Promise<TriggerItemSyncResponse>;
  listItemSyncLogs(packId: string): Promise<ListItemSyncLogsResponse>;
  listPackItems(packId: string): Promise<ListPackItemsResponse>;

  // P5: Audit Logs
  listAuditLogs(query: ListAuditLogsQuery): Promise<ListAuditLogsResponse>;

  // Pack 管理
  /** 重载 Pack 配置，返回加载/失败清单（camelCase，已转换） */
  reloadPacks(): Promise<ReloadPacksResult>;

  // v3.6.2: 运维清理聚合页（/api/admin/maintenance/*）
  /** 获取四张表（audit_logs/user_notifications/item_sync_log/chat_logs）行数/retention/上次清理时间概览 */
  getMaintenanceOverview(): Promise<MaintenanceOverviewResponse>;
  /** 手动触发清理（单表或全部），返回每张表删除的行数 */
  triggerCleanup(req: CleanupRequest): Promise<CleanupResponse>;
  /** 一键清理预览：返回将影响的表 + 行数 + 总大小，不实际清理（B2 dry-run） */
  previewCleanupAll(): Promise<CleanupAllPreviewResponse>;
  /** 修改 retention_days（1-365，仅 audit_logs/user_notifications/item_sync_log 可改） */
  updateRetention(req: RetentionUpdateRequest): Promise<RetentionUpdateResponse>;
  /**
   * v4.32.2 B2.8: 数据量监控告警——返回 7 张关键表行数/阈值/告警等级
   * 监控表：audit_logs / user_notifications / item_sync_log / chat_logs / player_bindings / webhooks / api_keys
   */
  getDataVolume(): Promise<import('@public/schema/panel-api-types').DataVolumeResponse>;

  // v4.5.0: 实例共管管理员管理（instance_admin+）
  listInstanceAdmins(serverId: string): Promise<import('@public/schema/panel-api-types').ListInstanceAdminsResponse>;
  assignInstanceAdmin(
    serverId: string,
    req: import('@public/schema/panel-api-types').AssignInstanceAdminRequest,
  ): Promise<import('@public/schema/panel-api-types').AssignInstanceAdminResponse>;
  removeInstanceAdmin(serverId: string, userId: string): Promise<void>;
  // v4.5.0: 我的资产聚合（所有已登录用户）
  getMyAssets(): Promise<import('@public/schema/panel-api-types').MyAssetsResponse>;

  // v4.6.0-D: 运营仪表盘（instance_admin+ 可见）
  getOperationsOverview(): Promise<import('@public/schema/panel-api-types').InstanceAdminOverviewResponse>;
  getOperationsRevenue(days?: number): Promise<import('@public/schema/panel-api-types').OperationsRevenueResponse>;
  getOperationsPlayers(days?: number): Promise<import('@public/schema/panel-api-types').OperationsPlayersResponse>;
  getOperationsInstancesCompare(): Promise<import('@public/schema/panel-api-types').OperationsInstancesCompareResponse>;

  // v4.6.0-E: 资源配额系统
  getMyQuota(): Promise<import('@public/schema/panel-api-types').MyQuotaResponse>;
  getRoleQuota(role: string): Promise<import('@public/schema/panel-api-types').RoleQuotaResponse>;
  updateRoleQuota(
    role: string,
    req: import('@public/schema/panel-api-types').UpdateRoleQuotaRequest,
  ): Promise<import('@public/schema/panel-api-types').UpdateRoleQuotaResponse>;
  getUserQuota(userId: string): Promise<import('@public/schema/panel-api-types').UserQuotaResponse>;
  updateUserQuota(
    userId: string,
    req: import('@public/schema/panel-api-types').UpdateUserQuotaRequest,
  ): Promise<import('@public/schema/panel-api-types').UpdateUserQuotaResponse>;

  // v4.6.0-F: 告警系统
  getAlertSettings(): Promise<import('@public/schema/panel-api-types').AlertSettingsResponse>;
  updateAlertSettings(
    req: import('@public/schema/panel-api-types').UpdateAlertSettingsRequest,
  ): Promise<import('@public/schema/panel-api-types').UpdateAlertSettingsResponse>;
  listAlertRules(): Promise<import('@public/schema/panel-api-types').AlertRulesListResponse>;
  listAlertEvents(): Promise<import('@public/schema/panel-api-types').AlertEventsListResponse>;
  testAlertWebhook(
    req: import('@public/schema/panel-api-types').TestWebhookRequest,
  ): Promise<import('@public/schema/panel-api-types').TestWebhookResponse>;

  // v4.7.0-G1: 全平台总览（server_admin 专用）
  getPlatformOverview(): Promise<import('@public/schema/panel-api-types').PlatformOverview>;
  getPlatformUsersTrend(
    range: '24h' | '30d',
  ): Promise<import('@public/schema/panel-api-types').PlatformUsersTrendResponse>;
  getPlatformRevenueTrend(
    days: number,
  ): Promise<import('@public/schema/panel-api-types').PlatformRevenueTrendResponse>;
  getDiskUsageTop(
    limit: number,
  ): Promise<import('@public/schema/panel-api-types').DiskUsageTopResponse>;

  // v4.7.0-H1: 实例级角色覆盖（instance_admin+）
  listInstanceRoles(
    serverId: string,
  ): Promise<import('@public/schema/panel-api-types').InstanceRoleListResponse>;
  grantInstanceRole(
    serverId: string,
    req: import('@public/schema/panel-api-types').GrantInstanceRoleRequest,
  ): Promise<import('@public/schema/panel-api-types').GrantInstanceRoleResponse>;
  revokeInstanceRole(serverId: string, userId: string): Promise<{ success: true }>;

  // v4.7.0-I1: 批量操作（已登录用户，按实例权限校验）
  batchStart(
    req: import('@public/schema/panel-api-types').BatchActionRequest,
  ): Promise<import('@public/schema/panel-api-types').BatchActionResponse>;
  batchStop(
    req: import('@public/schema/panel-api-types').BatchActionRequest,
  ): Promise<import('@public/schema/panel-api-types').BatchActionResponse>;
  batchRestart(
    req: import('@public/schema/panel-api-types').BatchActionRequest,
  ): Promise<import('@public/schema/panel-api-types').BatchActionResponse>;
  batchBackup(
    req: import('@public/schema/panel-api-types').BatchActionRequest,
  ): Promise<import('@public/schema/panel-api-types').BatchActionResponse>;
  batchUpdate(
    req: import('@public/schema/panel-api-types').BatchActionRequest,
  ): Promise<import('@public/schema/panel-api-types').BatchActionResponse>;

  // v4.8.0-K1: 发现页公开接口（未登录可访问）
  discoverHot(limit?: number): Promise<import('@public/schema/panel-api-types').DiscoverListResponse>;
  discoverNew(limit?: number): Promise<import('@public/schema/panel-api-types').DiscoverListResponse>;
  discoverRecommended(
    limit?: number,
  ): Promise<import('@public/schema/panel-api-types').DiscoverListResponse>;
  // v4.8.0-K1: 服务器推荐位管理（server_admin）
  setServerVisibility(
    serverId: string,
    isPublic: boolean,
  ): Promise<{ success: true }>;
  setServerRecommend(
    serverId: string,
    isRecommended: boolean,
  ): Promise<{ success: true }>;

  // v4.8.0-L1: 好友系统（已登录用户）
  sendFriendRequest(
    friendUserId: string,
  ): Promise<import('@public/schema/panel-api-types').FriendActionResponse>;
  acceptFriendRequest(
    friendUserId: string,
  ): Promise<import('@public/schema/panel-api-types').FriendActionResponse>;
  rejectFriendRequest(
    friendUserId: string,
  ): Promise<import('@public/schema/panel-api-types').FriendActionResponse>;
  listFriends(): Promise<import('@public/schema/panel-api-types').FriendListResponse>;
  listPendingFriendRequests(): Promise<import('@public/schema/panel-api-types').PendingFriendRequestsResponse>;
  listOnlineFriends(): Promise<import('@public/schema/panel-api-types').FriendListResponse>;
  /** v4.36.0-D8: 同实例已绑定玩家推荐 */
  listFriendRecommendations(): Promise<import('@public/schema/panel-api-types').FriendRecommendationsResponse>;
  removeFriend(
    friendUserId: string,
  ): Promise<import('@public/schema/panel-api-types').FriendActionResponse>;
  getFriendStatus(
    friendUserId: string,
  ): Promise<import('@public/schema/panel-api-types').FriendStatusResponse>;

  // v4.8.0-L2: 玩家档案（公开，带 token 返回更多）
  getPlayerProfile(
    userId: string,
  ): Promise<import('@public/schema/panel-api-types').PlayerProfileResponse>;

  // I3: API Key 管理（v4.4.0-J1，仅 server_admin）
  /** 列出所有 API Key（不含明文与 hash） */
  listApiKeys(): Promise<ListApiKeysResponse>;
  /** 创建 API Key（成功后明文仅返回一次） */
  createApiKey(req: CreateApiKeyRequest): Promise<CreateApiKeyResponse>;
  /** 查询单个 API Key 详情 */
  getApiKey(id: string): Promise<GetApiKeyResponse>;
  /** 撤销 API Key（软删除） */
  revokeApiKey(id: string): Promise<RevokeApiKeyResponse>;

  // B2.1: 提现审批（用户中心经济系统，仅 server_admin+，后端 requireAdmin）
  /** 获取待审批提现码分页列表 */
  listPendingWithdraws(
    page: number,
    pageSize: number,
  ): Promise<ListPendingWithdrawsResponse>;
  /** 核销提现码（标记已线下打款） */
  approveWithdraw(code: string): Promise<{ approved: true; code: string }>;
  /** 拒绝提现（解冻并退回用户余额） */
  rejectWithdraw(code: string): Promise<{ rejected: true; code: string }>;
}
