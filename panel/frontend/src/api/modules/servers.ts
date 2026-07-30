// ============================================================================
// Servers API 领域切片 — 实例生命周期 + 服务器级配置管理
// PanelApiClient 通过 extends 组合各领域接口
// ============================================================================

import type {
  CreateServerRequest,
  CreateServerResponse,
  DeleteServerResponse,
  GetStartupGuideResponse,
  ListServersResponse,
  ListPacksResponse,
  SaveStartupConfigRequest,
  SaveStartupConfigResponse,
  ServerCommandResponse,
  ServerDetailResponse,
  ServerResetStateResponse,
  ServerStartResponse,
  ServerStopResponse,
  NodeInstancesResponse,
  UpdateServerExpiryRequest,
  CreateChatTriggerRequest,
  CreateChatTriggerResponse,
  DeleteChatTriggerResponse,
  GetChatSettingsResponse,
  ListChatTriggersResponse,
  UpdateChatTriggerRequest,
  UpdateChatTriggerResponse,
  UpsertChatSettingsRequest,
  UpsertChatSettingsResponse,
  CreateVoteRequest,
  CreateVoteResponse,
  CancelVoteResponse,
  CastVoteRequest,
  CastVoteResponse,
  GetVoteResponse,
  GetVoteSettingsResponse,
  ListVotesResponse,
  UpsertVoteSettingsRequest,
  UpsertVoteSettingsResponse,
  CreatePlayerBindingRequest,
  CreatePlayerBindingResponse,
  DeletePlayerBindingResponse,
  GetPlayerJoinSettingsResponse,
  ListPlayerBindingsResponse,
  ListPlayerHistoriesResponse,
  ListGiftClaimsResponse,
  RejectPlayerBindingResponse,
  UpsertPlayerJoinSettingsRequest,
  UpsertPlayerJoinSettingsResponse,
  VerifyPlayerBindingRequest,
  VerifyPlayerBindingResponse,
  CreatePeriodicMessageRequest,
  CreatePeriodicMessageResponse,
  DeletePeriodicMessageResponse,
  ListPeriodicMessagesResponse,
  UpdatePeriodicMessageRequest,
  UpdatePeriodicMessageResponse,
  UploadInitResponse,
  UploadChunkResponse,
  UploadFinishResponse,
  CreateModRequest,
  CreateModResponse,
  DeleteModResponse,
  ListModsResponse,
  UpdateModRequest,
  UpdateModResponse,
  ListModFilesResponse,
  ToggleModFileResponse,
  ActivateSaveResponse,
  CreateSaveRequest,
  CreateSaveResponse,
  DeleteSaveResponse,
  ListSavesResponse,
  CreateBackupRequest,
  CreateBackupResponse,
  DeleteBackupResponse,
  ListBackupsResponse,
  UpdateBackupRequest,
  UpdateBackupResponse,
  CreateMonitorSnapshotRequest,
  CreateMonitorSnapshotResponse,
  GetLatestSnapshotResponse,
  ListMonitorSnapshotsResponse,
  CreateListEntryRequest,
  CreateListEntryResponse,
  DeleteListEntryResponse,
  ListListEntriesResponse,
  ListType,
  CreateWebhookRequest,
  CreateWebhookResponse,
  DeleteWebhookResponse,
  ListWebhooksResponse,
  TriggerWebhookTestRequest,
  TriggerWebhookTestResponse,
  UpdateWebhookRequest,
  UpdateWebhookResponse,
  ListConfigFilesResponse,
  ReadConfigFileResponse,
  WriteConfigFileRequest,
  WriteConfigFileResponse,
  GetConfigFileSchemaResponse,
  CreateConfigFileRequest,
  CreateConfigFileResponse,
  RegenerateMapResponse,
  GetMapSettingsSchemaResponse,
  UpdateMapSettingsRequest,
  UpdateMapSettingsResponse,
  ListChatLogsResponse,
  ListChatLogsQuery,
  CheckUpdateResponse,
  ApplyUpdateRequest,
  ApplyUpdateResponse,
  UpdateProgressResponse,
  ListServerPlayerBindingsResponse,
  DeleteServerPlayerBindingResponse,
  ListLogFilesResponse,
  ReadLogFileResponse,
  ListOnlinePlayersResponse,
  NodeClusterInfo,
  ListNodeClusterResponse,
  NodeDetailResponse,
  CreateNodeInviteRequest,
  CreateNodeInviteResponse,
  DeleteNodeResponse,
  ListBindableServersQuery,
  ListBindableServersResponse,
} from '@public/schema/panel-api-types';

/**
 * 部署节点信息（对应后端 /api/nodes 返回项）
 *
 * L2 扩展：从原 { id, name, status, daemon_url? } 升级为 cluster 信息。
 * 保留 `daemon_url` 作为兼容字段（= fqdn），CreateServer 等历史代码仍可用。
 */
export interface NodeInfo extends NodeClusterInfo {
  /** 兼容字段：= fqdn（slave 节点的 daemon HTTP 地址，master 为空字符串） */
  daemon_url?: string;
}

/** GET /api/nodes 响应体 */
export interface ListNodesResponse extends ListNodeClusterResponse {
  /** 节点列表（覆盖父类型，元素类型为本模块的 NodeInfo） */
  nodes: NodeInfo[];
}

/** 3.4.5: GET /api/packs/:id/items-config 响应体（内联契约，未走 public/）
 *  返回 Pack 物品池配置元信息。前端据此判断是否渲染品质列 / 生成品质下拉。 */
export interface PackItemsConfig {
  pack_id: string;
  qualities: string[];
  quality_tiers: number;
  categories: string[];
  support_quality: boolean;
  quality_tiers_shop: number;
}

/**
 * POST /api/admin/cleanup-instances/:id/confirm-delete?dry_run=true 响应体
 *
 * 本地类型定义（前端临时）：B2 批次破坏性操作 dry-run 集成需要。
 * 待 B7 类型契约漂移治理走 s0601 流程时统一升级到 public/schema/panel-api-types.ts。
 */
export interface CleanupInstancePreviewResponse {
  instance_id: string;
  instance_root: string;
  size_bytes: number | null;
  file_count: number | null;
  /** DB 记录（servers 表对应行） */
  db_record: Record<string, unknown> | null;
  /** 预览是否成功（daemon 不可达等情况下为 false） */
  preview_success: boolean;
  /** 预览失败时的错误信息 */
  preview_error: string | null;
}

/**
 * DELETE /api/packs/:id?dry_run=true 响应体
 *
 * 本地类型定义（前端临时）：B2 批次破坏性操作 dry-run 集成需要。
 * 待 B7 类型契约漂移治理走 s0601 流程时统一升级到 public/schema/panel-api-types.ts。
 */
export interface DeletePackPreviewResponse {
  pack_id: string;
  pack_dir: string;
  /** 依赖该 Pack 的实例列表（非空时禁止删除） */
  dependent_instances: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  /** 是否可安全删除（dependent_instances 为空时为 true） */
  can_delete: boolean;
}

/** GET /api/packs/:id 响应体（Pack YAML 详情） */
export interface GetPackYamlResponse {
  id: string;
  yaml_path: string;
  content: string;
}

/** PUT /api/packs/:id 请求体 */
export interface UpdatePackYamlRequest {
  content: string;
}

/** PUT /api/packs/:id 响应体 */
export interface UpdatePackYamlResponse {
  success: boolean;
  pack_id: string;
  yaml_path: string;
}

/** POST /api/packs 请求体 */
export interface CreatePackRequest {
  pack_id: string;
  content: string;
}

/** POST /api/packs 响应体 */
export interface CreatePackResponse {
  success: boolean;
  pack_id: string;
  yaml_path: string;
}

/** DELETE /api/packs/:id 响应体（非 dry_run） */
export interface DeletePackResponse {
  success: boolean;
  pack_id: string;
}

// ---------------------------------------------------------------------------
// L4: jar 元数据扫描类型（与后端 panel/backend/src/daemonClient/client.ts 对齐）
// 注：该类型未放入 public/ 契约（L4 不修改 public/），在此本地定义。
// ---------------------------------------------------------------------------

/** Mod 加载器类型 */
export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'unknown';

/** Mod 运行环境 */
export type ModEnvironment = 'client' | 'server' | 'both';

/** 扫描得到的 Mod 元数据 */
export interface ModMetadata {
  name: string;
  version: string;
  loader: ModLoader;
  environment: ModEnvironment;
  isClientSide: boolean;
  sourceFile: string;
}

/** GET /api/servers/:id/mods/scan 响应体 */
export interface ScanModsResponse {
  mods: ModMetadata[];
}

export interface ServersApi {
  listPacks(): Promise<ListPacksResponse>;
  /** 获取 Pack YAML 详情（GET /api/packs/:id） */
  getPackYaml(packId: string): Promise<GetPackYamlResponse>;
  /** 更新 Pack YAML（PUT /api/packs/:id） */
  updatePackYaml(packId: string, req: UpdatePackYamlRequest): Promise<UpdatePackYamlResponse>;
  /** 创建 Pack（POST /api/packs） */
  createPack(req: CreatePackRequest): Promise<CreatePackResponse>;
  /** 删除 Pack（DELETE /api/packs/:id，非 dry_run） */
  deletePack(packId: string): Promise<DeletePackResponse>;
  /** Pack 删除预览（DELETE /api/packs/:id?dry_run=true） */
  previewDeletePack(packId: string): Promise<DeletePackPreviewResponse>;
  /** 3.4.5: 获取 Pack 物品池配置（仅元信息，不含 static_list 完整列表） */
  getPackItemsConfig(packId: string): Promise<PackItemsConfig>;
  listNodes(): Promise<ListNodesResponse>;
  /** 主动探测节点延迟 */
  pingNode(id: string): Promise<{ latency_ms: number }>;
  listServers(): Promise<ListServersResponse>;
  /**
   * v4.38.0: 获取可绑定实例市场列表（GET /api/servers/bindable）
   * 返回 is_public=1 的所有实例 + owner_user_id=当前用户 的实例（合并去重），
   * 附带 is_owner/is_bound/has_pending_request/can_direct_bind/can_request_bind 标记
   */
  listBindableServers(query?: ListBindableServersQuery): Promise<ListBindableServersResponse>;
  getServer(id: string): Promise<ServerDetailResponse>;
  createServer(req: CreateServerRequest): Promise<CreateServerResponse>;
  deleteServer(id: string): Promise<DeleteServerResponse>;
  /**
   * 启动实例。
   * @param id 实例 ID
   * @param opts.savePath 可选：指定启动存档路径（如 saves/world.zip），覆盖默认存档
   */
  startServer(id: string, opts?: { savePath?: string }): Promise<ServerStartResponse>;
  /** v1.1.0: 获取启动前置引导声明 + 当前已填配置 */
  getStartupGuide(id: string): Promise<GetStartupGuideResponse>;
  /** v1.1.0: 保存启动配置（含 config_writes 写入） */
  saveStartupConfig(
    id: string,
    req: SaveStartupConfigRequest,
  ): Promise<SaveStartupConfigResponse>;
  stopServer(id: string): Promise<ServerStopResponse>;
  /** v4.29.8: 强制重置 error → stopped（仅 server_admin，仅 error 状态） */
  resetServerState(id: string): Promise<ServerResetStateResponse>;
  /** v4.31.0: 管理员修改实例有效期（仅 server_admin） */
  updateServerExpiry(id: string, req: UpdateServerExpiryRequest): Promise<{ server: import('@public/schema/panel-api-types').ServerSummary }>;
  /** v4.31.0: 获取节点上的实例列表 */
  listNodeInstances(nodeId: string): Promise<NodeInstancesResponse>;
  sendCommand(id: string, command: string): Promise<ServerCommandResponse>;

  // 文件分片上传
  uploadFileInit(serverId: string): Promise<UploadInitResponse>;
  uploadFileChunk(
    serverId: string,
    uploadId: string,
    index: number,
    content: string,
  ): Promise<UploadChunkResponse>;
  uploadFileFinish(
    serverId: string,
    uploadId: string,
    targetPath: string,
  ): Promise<UploadFinishResponse>;
  /** 封装完整上传流程（init → chunk* → finish），onProgress 回调报告进度 */
  uploadFile(
    serverId: string,
    file: File,
    targetPath: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<UploadFinishResponse>;

  // P3 聊天 API
  getChatSettings(serverId: string): Promise<GetChatSettingsResponse>;
  upsertChatSettings(
    serverId: string,
    req: UpsertChatSettingsRequest,
  ): Promise<UpsertChatSettingsResponse>;
  listChatTriggers(serverId: string): Promise<ListChatTriggersResponse>;
  createChatTrigger(
    serverId: string,
    req: CreateChatTriggerRequest,
  ): Promise<CreateChatTriggerResponse>;
  updateChatTrigger(
    serverId: string,
    id: number,
    req: UpdateChatTriggerRequest,
  ): Promise<UpdateChatTriggerResponse>;
  deleteChatTrigger(serverId: string, id: number): Promise<DeleteChatTriggerResponse>;

  // P3 投票 API
  getVoteSettings(serverId: string): Promise<GetVoteSettingsResponse>;
  upsertVoteSettings(
    serverId: string,
    req: UpsertVoteSettingsRequest,
  ): Promise<UpsertVoteSettingsResponse>;
  listVotes(serverId: string): Promise<ListVotesResponse>;
  createVote(serverId: string, req: CreateVoteRequest): Promise<CreateVoteResponse>;
  getVote(serverId: string, id: number): Promise<GetVoteResponse>;
  castVote(serverId: string, id: number, req: CastVoteRequest): Promise<CastVoteResponse>;
  cancelVote(serverId: string, id: number): Promise<CancelVoteResponse>;

  // P3 玩家 API
  getPlayerJoinSettings(serverId: string): Promise<GetPlayerJoinSettingsResponse>;
  upsertPlayerJoinSettings(
    serverId: string,
    req: UpsertPlayerJoinSettingsRequest,
  ): Promise<UpsertPlayerJoinSettingsResponse>;
  listPlayerBindings(): Promise<ListPlayerBindingsResponse>;
  createPlayerBinding(req: CreatePlayerBindingRequest): Promise<CreatePlayerBindingResponse>;
  verifyPlayerBinding(
    id: number,
    req: VerifyPlayerBindingRequest,
  ): Promise<VerifyPlayerBindingResponse>;
  rejectPlayerBinding(id: number): Promise<RejectPlayerBindingResponse>;
  deletePlayerBinding(id: number): Promise<DeletePlayerBindingResponse>;
  listPlayerHistories(serverId: string): Promise<ListPlayerHistoriesResponse>;
  listGiftClaims(serverId: string): Promise<ListGiftClaimsResponse>;

  // P3 定时消息 API
  listPeriodicMessages(serverId: string): Promise<ListPeriodicMessagesResponse>;
  createPeriodicMessage(
    serverId: string,
    req: CreatePeriodicMessageRequest,
  ): Promise<CreatePeriodicMessageResponse>;
  updatePeriodicMessage(
    serverId: string,
    id: number,
    req: UpdatePeriodicMessageRequest,
  ): Promise<UpdatePeriodicMessageResponse>;
  deletePeriodicMessage(serverId: string, id: number): Promise<DeletePeriodicMessageResponse>;

  // P4: Mods
  listMods(serverId: string): Promise<ListModsResponse>;
  createMod(serverId: string, req: CreateModRequest): Promise<CreateModResponse>;
  updateMod(serverId: string, id: number, req: UpdateModRequest): Promise<UpdateModResponse>;
  deleteMod(serverId: string, id: number): Promise<DeleteModResponse>;
  // v4.3.0-H1: 文件系统级 Mod 管理
  listModFiles(serverId: string): Promise<ListModFilesResponse>;
  toggleModFile(serverId: string, modName: string): Promise<ToggleModFileResponse>;
  // L4: jar 元数据扫描（识别客户端 mod）
  scanMods(serverId: string): Promise<ScanModsResponse>;

  // P4: Saves
  listSaves(serverId: string): Promise<ListSavesResponse>;
  createSave(serverId: string, req: CreateSaveRequest): Promise<CreateSaveResponse>;
  activateSave(serverId: string, id: number): Promise<ActivateSaveResponse>;
  deleteSave(serverId: string, id: number): Promise<DeleteSaveResponse>;

  // P4: Backups
  listBackups(serverId: string): Promise<ListBackupsResponse>;
  createBackup(serverId: string, req: CreateBackupRequest): Promise<CreateBackupResponse>;
  updateBackup(
    serverId: string,
    id: number,
    req: UpdateBackupRequest,
  ): Promise<UpdateBackupResponse>;
  deleteBackup(serverId: string, id: number): Promise<DeleteBackupResponse>;

  // P4: Monitor
  listMonitorSnapshots(
    serverId: string,
    query: { from?: string; to?: string; limit?: number },
  ): Promise<ListMonitorSnapshotsResponse>;
  createMonitorSnapshot(
    serverId: string,
    req: CreateMonitorSnapshotRequest,
  ): Promise<CreateMonitorSnapshotResponse>;
  getLatestMonitorSnapshot(serverId: string): Promise<GetLatestSnapshotResponse>;

  // P4: Lists (whitelist / banlist)
  listListEntries(serverId: string, listType: ListType): Promise<ListListEntriesResponse>;
  createListEntry(
    serverId: string,
    listType: ListType,
    req: CreateListEntryRequest,
  ): Promise<CreateListEntryResponse>;
  deleteListEntry(
    serverId: string,
    listType: ListType,
    playerName: string,
  ): Promise<DeleteListEntryResponse>;

  // P5: Webhooks
  listWebhooks(serverId: string): Promise<ListWebhooksResponse>;
  createWebhook(serverId: string, req: CreateWebhookRequest): Promise<CreateWebhookResponse>;
  updateWebhook(
    serverId: string,
    id: number,
    req: UpdateWebhookRequest,
  ): Promise<UpdateWebhookResponse>;
  deleteWebhook(serverId: string, id: number): Promise<DeleteWebhookResponse>;
  triggerWebhookTest(
    serverId: string,
    id: number,
    req: TriggerWebhookTestRequest,
  ): Promise<TriggerWebhookTestResponse>;

  // Task 11: Config Files
  listConfigFiles(serverId: string): Promise<ListConfigFilesResponse>;
  readConfigFile(serverId: string, name: string): Promise<ReadConfigFileResponse>;
  writeConfigFile(
    serverId: string,
    name: string,
    req: WriteConfigFileRequest,
  ): Promise<WriteConfigFileResponse>;
  getConfigFileSchema(serverId: string, name: string): Promise<GetConfigFileSchemaResponse>;
  createConfigFile(
    serverId: string,
    req: CreateConfigFileRequest,
  ): Promise<CreateConfigFileResponse>;

  // Task 11: Game Update
  checkUpdate(serverId: string): Promise<CheckUpdateResponse>;
  applyUpdate(serverId: string, req: ApplyUpdateRequest): Promise<ApplyUpdateResponse>;
  getUpdateProgress(serverId: string): Promise<UpdateProgressResponse>;
  regenerateMap(serverId: string, saveName: string): Promise<RegenerateMapResponse>;
  getMapSettingsSchema(serverId: string): Promise<GetMapSettingsSchemaResponse>;
  updateMapSettings(
    serverId: string,
    settingsName: string,
    req: UpdateMapSettingsRequest,
  ): Promise<UpdateMapSettingsResponse>;

  // Task 11: Chat Logs
  listChatLogs(serverId: string, query: ListChatLogsQuery): Promise<ListChatLogsResponse>;

  // 模块10: server 级玩家绑定管理（admin）
  listServerPlayerBindings(serverId: string): Promise<ListServerPlayerBindingsResponse>;
  deleteServerPlayerBinding(
    serverId: string,
    id: number,
  ): Promise<DeleteServerPlayerBindingResponse>;

  // 实例VIP管理（instance_admin+ 可见）
  /** 查看某实例的绑定用户列表（含用户名、VIP等级、过期时间） */
  listInstanceBindings(serverId: string): Promise<{
    bindings: Array<{
      id: number;
      userId: string;
      username: string;
      vipLevel: number;
      vipExpiresAt: string | null;
      status: string;
      boundAt: string;
    }>;
  }>;
  /** 调整某用户在某实例的 VIP 等级和过期时间 */
  updateBindingVip(
    serverId: string,
    userId: string,
    vipLevel: number,
    vipExpiresAt?: string | null,
  ): Promise<void>;

  // P6: 日志文件管理（转发 Daemon）
  /** 读取实例控制台历史日志行（Daemon 内存环形缓冲），用于 RconConsole 挂载时预填 */
  getConsoleLogs(serverId: string, limit?: number): Promise<{ lines: string[] }>;
  listLogFiles(serverId: string): Promise<ListLogFilesResponse>;
  readLogFile(serverId: string, filename: string, count?: number): Promise<ReadLogFileResponse>;
  deleteLogFile(serverId: string, filename: string): Promise<void>;

  // P6: 在线玩家实时查询（转发 Daemon）
  listOnlinePlayers(serverId: string): Promise<ListOnlinePlayersResponse>;

  // v4.2.0-D1: 玩家管理操作（kick/ban/pardon/op/deop/whitelist add/remove）
  // 通过 commandDispatcher 渲染 pack 命令模板并下发到游戏服务器
  kickPlayer(serverId: string, playerName: string, reason?: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  banPlayer(serverId: string, playerName: string, reason?: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  pardonPlayer(serverId: string, playerName: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  opPlayer(serverId: string, playerName: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  deopPlayer(serverId: string, playerName: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  whitelistAdd(serverId: string, playerName: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;
  whitelistRemove(serverId: string, playerName: string): Promise<import('@public/schema/panel-api-types').PlayerActionResponse>;

  // v3.4.0: 版本池
  listVersions(packId: string): Promise<import('@public/schema/panel-api-types').ListGameVersionsResponse>;
  fetchAvailableVersions(packId: string): Promise<import('@public/schema/panel-api-types').AvailableVersionsResponse>;
  downloadVersion(packId: string, version?: string): Promise<import('@public/schema/panel-api-types').DownloadVersionResponse>;
  getVersionDownloadProgress(packId: string, taskId: string): Promise<import('@public/schema/panel-api-types').VersionDownloadProgressResponse>;
  deleteVersion(packId: string, versionId: string): Promise<import('@public/schema/panel-api-types').DeleteGameVersionResponse>;

  // v3.6.1: 磁盘占用
  getNodeDiskUsage(nodeId: string): Promise<import('@public/schema/panel-api-types').NodeDiskUsageResponse>;
  getServerDiskUsage(serverId: string): Promise<import('@public/schema/panel-api-types').ServerDiskUsageResponse>;

  // v3.4.0: 实例清理面板（server_admin）
  listCleanupInstances(): Promise<import('@public/schema/panel-api-types').ListCleanupInstancesResponse>;
  confirmCleanupDelete(id: string): Promise<import('@public/schema/panel-api-types').ConfirmCleanupDeleteResponse>;
  /** 实例删除预览（B2 dry-run）：返回将删除的 instance_root + 大小 + DB 记录，不实际删除 */
  previewCleanupInstance(id: string): Promise<CleanupInstancePreviewResponse>;
  ignoreCleanup(id: string): Promise<import('@public/schema/panel-api-types').IgnoreCleanupResponse>;

  // v3.6.2-B2: 实例子目录清理（backups/saves/mods/logs/cache）
  cleanupSubdir(
    serverId: string,
    subdir: string,
  ): Promise<import('@public/schema/panel-api-types').SubdirCleanupResponse>;

  // I4: Java 扫描（v4.4.0-M1，透传到 Daemon GET /api/env/javas）
  /** 扫描指定节点上的 Java 安装（用于实例创建前的版本兼容性检查） */
  scanNodeJavas(
    nodeId: string,
  ): Promise<import('@public/schema/daemon-api-types').ScanJavasResult>;

  // L2: Daemon 集群化管理（slave 节点注册/详情/删除）
  /** 获取单个节点详情（cluster 字段） */
  getNode(nodeId: string): Promise<NodeDetailResponse>;
  /** 创建 slave 节点邀请（返回 linkKey + slave 启动命令，仅 server_admin 可调用） */
  createNodeInvite(req: CreateNodeInviteRequest): Promise<CreateNodeInviteResponse>;
  /** 重新生成邀请密钥（失败重试时调用，仅对 pending 节点有效） */
  regenerateInvite(nodeId: string): Promise<CreateNodeInviteResponse>;
  /** 删除 slave 节点（master 节点不可删；删除前校验无活跃实例） */
  deleteNode(nodeId: string): Promise<DeleteNodeResponse>;
  /**
   * v4.22.9: 通过 linkKey 下载 slave-bootstrap.sh 部署脚本（由后端生成）
   * @param linkKey 邀请密钥明文
   * @returns 脚本文本（text/x-shellscript）
   */
  downloadNodeBootstrapScript(linkKey: string): Promise<string>;
}
