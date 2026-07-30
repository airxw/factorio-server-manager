// ============================================================================
// Panel Frontend API 客户端 — fetch 封装 + JWT 自动附加 + 401 触发登出
// 依据契约：public/schema/panel-api-types.ts
// 所有 REST 调用走相对路径 /api/...（Vite dev server proxy 转发到 Panel 后端）
// ============================================================================

import type {
  ClaimShopOrderResponse,
  CreateCdkCodesResponse,
  CreateChatTriggerResponse,
  CreatePeriodicMessageResponse,
  CreatePlayerBindingResponse,
  CreateServerResponse,
  CreateShopOrderResponse,
  CreateUserResponse,
  CreateVipPermissionResponse,
  CreateVoteResponse,
  DeleteCdkCodeResponse,
  // v4.24.0 用户批量管理与分析
  BatchUserOperationResponse,
  UserStatsResponse,
  DeleteChatTriggerResponse,
  DeletePeriodicMessageResponse,
  DeletePlayerBindingResponse,
  DeleteServerResponse,
  DeleteShopItemResponse,
  DeleteSystemConfigResponse,
  DeleteUserResponse,
  DeleteVipPermissionResponse,
  GetCdkCodeResponse,
  GetChatSettingsResponse,
  GetPlayerJoinSettingsResponse,
  GetShopOrderResponse,
  GetStartupGuideResponse,
  GetSystemConfigResponse,
  GetUserResponse,
  GetMyOverviewResponse,
  GetVoteResponse,
  GetVoteSettingsResponse,
  GetWalletResponse,
  ClaimDailyRewardResponse,
  ListCdkCodesResponse,
  ListChatTriggersResponse,
  ListGiftClaimsResponse,
  ListPeriodicMessagesResponse,
  ListPlayerBindingsResponse,
  ListPlayerHistoriesResponse,
  ListShopItemsResponse,
  ListShopOrdersResponse,
  ListItemSyncLogsResponse,
  ListMyOrdersResponse,
  ListPackItemsResponse,
  ListPacksResponse,
  ListServersResponse,
  ListSystemConfigsResponse,
  ListVipPermissionsResponse,
  ListVotesResponse,
  ListUsersResponse,
  LoginResponse,
  MeResponse,
  RedeemCdkResponse,
  RegisterResponse,
  RejectPlayerBindingResponse,
  // v4.17.0 多角色管理
  SelectRoleRequest,
  SelectRoleResponse,
  SwitchRoleRequest,
  SwitchRoleResponse,
  RevokeUserTokensResponse,
  SaveStartupConfigResponse,
  ServerCommandResponse,
  ServerDetailResponse,
  ServerResetStateResponse,
  ServerStartResponse,
  ServerStopResponse,
  ServerSummary,
  NodeInstancesResponse,
  SetSystemConfigResponse,
  TriggerItemSyncResponse,
  UpdateChatTriggerResponse,
  UpdatePeriodicMessageResponse,
  UpdateUserResponse,
  UpdateUserRoleResponse,
  UpdateVipPermissionResponse,
  UpsertChatSettingsResponse,
  UpsertPlayerJoinSettingsResponse,
  UpsertShopItemResponse,
  UpsertVoteSettingsResponse,
  VerifyPlayerBindingResponse,
  CastVoteResponse,
  CancelVoteResponse,
  GetVipPermissionResponse,
  // P4: mod / save / backup / monitor / list
  ActivateSaveResponse,
  CreateBackupResponse,
  CreateListEntryResponse,
  CreateModResponse,
  CreateMonitorSnapshotResponse,
  CreateSaveResponse,
  DeleteBackupResponse,
  DeleteListEntryResponse,
  DeleteModResponse,
  DeleteSaveResponse,
  GetLatestSnapshotResponse,
  ListBackupsResponse,
  ListListEntriesResponse,
  ListModsResponse,
  ListModFilesResponse,
  ListMonitorSnapshotsResponse,
  ListSavesResponse,
  // P5: webhook + auditLog
  CreateWebhookResponse,
  DeleteWebhookResponse,
  ListAuditLogsResponse,
  ListWebhooksResponse,
  TriggerWebhookTestResponse,
  ToggleModFileResponse,
  UpdateWebhookResponse,
  UpdateBackupResponse,
  UpdateModResponse,
  // Task 11: configFile / worldGen / chatLog / update
  ListConfigFilesResponse,
  ReadConfigFileResponse,
  WriteConfigFileResponse,
  GetConfigFileSchemaResponse,
  RegenerateMapResponse,
  GetMapSettingsSchemaResponse,
  UpdateMapSettingsResponse,
  ListChatLogsResponse,
  CheckUpdateResponse,
  ApplyUpdateResponse,
  UpdateProgressResponse,
  // 模块10: 玩家验证码 + server 级玩家绑定
  CreateVerifyCodeResponse,
  ListMyVerifyCodesResponse,
  ListServerPlayerBindingsResponse,
  DeleteServerPlayerBindingResponse,
  // P6: 日志文件管理 + 在线玩家查询（转发 Daemon）
  ListLogFilesResponse,
  ReadLogFileResponse,
  ListOnlinePlayersResponse,
  // 实例绑定契约（线格式 snake_case，前端通过 snakeToCamel 转换为 camelCase）
  ListUserBindingsResponse,
  ListInstanceBindingsResponse as ListInstanceBindingsWireResponse,
  // v4.18.0: 初始化向导修复（preflight + password-policy + 扩展 submitInit）
  InitPreflightResponse,
  PasswordPolicyResponse,
  InitRequest,
  InitSubmitResponse,
  // v4.20.0: Setup Wizard v2 新增（数据库测试连接 + 触发重启）
  TestDatabaseConnectionRequest,
  TestDatabaseConnectionResponse,
  RestartTriggerResponse,
  // v4.22.0: Setup Wizard v3 新增（Daemon 测试连接 + Pack 同步/上传）
  TestDaemonConnectionRequest,
  TestDaemonConnectionResponse,
  SyncPacksRequest,
  SyncPacksResponse,
  UploadPackResponse,
  // v4.22.1: 本机 Daemon 自动检测
  AutoDetectLocalDaemonResponse,
} from '@public/schema/panel-api-types';

// 四.4: 领域接口切片 — PanelApiClient 通过 extends 组合
import type {
  AuthApi,
  MyBinding,
  ChangePasswordResponse,
  PasswordResetRequestResponse,
  PasswordResetConfirmResponse,
  EmailVerifyStatusResponse,
  EmailVerifyRequestResponse,
  EmailVerifyConfirmResponse,
  LegalContentResponse,
} from './modules/auth';
import type {
  ServersApi,
  ListNodesResponse,
  PackItemsConfig,
  ScanModsResponse,
  GetPackYamlResponse,
  UpdatePackYamlResponse,
  CreatePackResponse,
  DeletePackResponse,
  DeletePackPreviewResponse,
} from './modules/servers';
import type {
  AdminApi,
  ReloadPacksResult,
  ListPendingWithdrawsResponse,
} from './modules/admin';
import type { ShopApi } from './modules/shop';
// 第十一章：系统级自助运维切片（版本/更新/健康/诊断）
import type { SystemApi } from './modules/system';
// v3.8.0: 结构化设置面板切片
import type { SettingsApi } from './modules/settings';
// v4.11.0: 商业化资产切片
import type { AssetApi } from './modules/asset';
// v4.13.0: 实例店铺外观配置 API 切片
import type { ShopConfigApi } from './modules/shop-config';
// v4.13.0: GM Workbench 后端 API 切片（玩家CRM/流水/时长/服主实例列表）
import type { StoreGmApi } from './modules/store-gm';
// v4.13.0 步骤16: GM Workbench 玩家操作 API 切片（发放补偿/封禁/调整时长）
import type { StorePlayerActionsApi } from './modules/store-player-actions';
// v4.15.0: 玩家门户聚合 API（/api/my/*）
import type { MyApi, MyOrdersStatusFilter } from './modules/my';
// v3-billing: VPS 式预付费实例计费 API 切片
import type { InstanceBillingApi } from './modules/instance-billing';
export type { MyOrdersStatusFilter } from './modules/my';
// 领域类型重新导出，保持 client.ts 公共 API 不变
export type {
  MyBinding,
  ChangePasswordResponse,
  PasswordResetRequestResponse,
  PasswordResetConfirmResponse,
  EmailVerifyStatusResponse,
  EmailVerifyRequestResponse,
  EmailVerifyConfirmResponse,
  LegalContentResponse,
} from './modules/auth';
export type { ReloadPacksResult } from './modules/admin';
export type {
  NodeInfo,
  ListNodesResponse,
  PackItemsConfig,
  ModLoader,
  ModEnvironment,
  ModMetadata,
  ScanModsResponse,
  GetPackYamlResponse,
  UpdatePackYamlRequest,
  UpdatePackYamlResponse,
  CreatePackRequest,
  CreatePackResponse,
  DeletePackResponse,
  DeletePackPreviewResponse,
} from './modules/servers';
// 第十一章：SystemApi 领域类型重新导出
export type {
  BuildInfo,
  SystemUpdateInfo,
  PerformUpdateResponse,
  UpdateStatus,
  SystemMetrics,
  ServiceHealth,
  SystemHealth,
  DiagnosticProblem,
  DiagnosticsResult,
  ApplyFixResponse,
  // I1: SSL 证书管理（v4.4.0-L1）
  CertificateInfo,
  GetSslInfoResponse,
  StageCertificateRequest,
  StageCertificateResponse,
  DeployCertificateRequest,
  DeployCertificateResponse,
  ReloadNginxResponse,
  GenerateSelfSignedRequest,
  GenerateSelfSignedResponse,
  // I2: Tunnel 管理（v4.4.0-O1）
  TunnelType,
  TunnelMapping,
  TunnelConfig,
  TunnelLogEntry,
  TunnelStatus,
  GetTunnelStatusResponse,
  GetTunnelConfigResponse,
  UpdateTunnelConfigResponse,
  TunnelActionResponse,
  GetTunnelLogsResponse,
} from './modules/system';
// I3: API Key 领域类型重新导出
export type {
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  GetApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyResponse,
  ListUsersQuery,
  // B2.1: 提现审批领域类型（待 B7 契约治理后迁入 public/schema）
  PendingWithdrawItem,
  ListPendingWithdrawsResponse,
} from './modules/admin';

import pkg from '../../package.json';
import { REST_BASE } from '../config/env';
import {
  loginResponseSchema,
  meResponseSchema,
  listServersResponseSchema,
  selectRoleResponseSchema,
  switchRoleResponseSchema,
  revokeUserTokensResponseSchema,
  validateResponse,
} from './schemas';

const API_BASE = REST_BASE;

/** 前端构建版本号（来自 package.json，作为 getVersion API 不可用时的兜底） */
export const APP_VERSION: string = pkg.version;

/**
 * 错误详情结构（v4.19.1: 用于 WEAK_PASSWORD 等 4xx 错误传递字段级失败清单）
 * 后端返回 `{ error: { code, message, details: {...} } }` 时，details 会原样透传到此处。
 */
export interface PanelApiErrorDetails {
  /** 字段级失败清单（如密码规则的失败项） */
  failures?: string[];
  /** 建议清单 */
  suggestions?: string[];
  /** zxcvbn 评分（0-4） */
  score?: number;
  /** 其他动态字段 */
  [key: string]: unknown;
}

/** 携带 code + message + details 的 API 错误 */
export class PanelApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: PanelApiErrorDetails;
  constructor(code: string, message: string, status: number, details?: PanelApiErrorDetails) {
    super(message);
    this.name = 'PanelApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** GET /api/version 响应体 */
export interface VersionResponse {
  version: string;
}

/**
 * 获取系统版本号。
 * 优先调用后端 /api/version；当后端未提供该端点时回退到前端 package.json 的版本号，
 * 保证侧边栏始终能展示版本信息。
 */
export async function getVersion(): Promise<VersionResponse> {
  try {
    const res = await fetch(`${API_BASE}/version`);
    if (!res.ok) {
      throw new PanelApiError('HTTP_ERROR', `获取版本失败 (${res.status})`, res.status);
    }
    return (await res.json()) as VersionResponse;
  } catch {
    // 后端未提供 /api/version 或网络异常时，回退到前端 package.json 版本号
    return { version: APP_VERSION };
  }
}

interface ApiClientOptions {
  token?: string | null;
  onUnauthorized?: () => void;
}

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 一.6: 带超时控制的 fetch 封装（不再使用 AbortController）。
 * - 默认 30s 超时，超时后通过 Promise.race 让 timeout promise 先 settle，
 *   调用方收到 TIMEOUT 错误；原 fetch 仍在后台运行直到完成。
 * - 关键变更：完全不在 JS 层调用 abort。AbortController.abort() 触发的
 *   net::ERR_ABORTED 会被浏览器网络层写入控制台，JS try/catch 无法抑制。
 * - 权衡：超时场景下后到的响应被丢弃（不读 body），浏览器会自动清理连接。
 *   这是为换取"控制台无 ERR_ABORTED 日志"所付出的可接受代价。
 * - 允许通过 init.signal 传入外部 AbortSignal（透传给 fetch；外部 abort
 *   仍会触发 ERR_ABORTED，但这是调用方主动行为，不再由本封装产生）。
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PanelApiError('TIMEOUT', `请求超时 (${timeoutMs}ms)`, 0));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(input, init), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 将单个 snake_case 键转换为 camelCase */
function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 递归将对象 / 数组的 snake_case 键转换为 camelCase。
 * 基本类型（string/number/null/boolean）原样返回。
 * 用于部分后端返回 snake_case 的端点（bindings / packs）。
 */
function snakeToCamel<T>(data: unknown): T {
  if (Array.isArray(data)) {
    return data.map((item) => snakeToCamel<unknown>(item)) as unknown as T;
  }
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[snakeToCamelKey(k)] = snakeToCamel<unknown>(v);
    }
    return result as unknown as T;
  }
  return data as T;
}

/**
 * Panel API 客户端总接口 — 通过 extends 组合各领域接口切片（四.4）
 * 领域定义见 src/api/modules/{auth,servers,admin,shop}.ts
 * 实现集中在 createApiClient 工厂内，保持单一运行时入口。
 */
export interface PanelApiClient extends AuthApi, ServersApi, AdminApi, ShopApi, SystemApi, SettingsApi, AssetApi, ShopConfigApi, StoreGmApi, StorePlayerActionsApi, MyApi, InstanceBillingApi {}

export function createApiClient(opts: ApiClientOptions = {}): PanelApiClient {
  const token = opts.token ?? null;
  const onUnauthorized = opts.onUnauthorized;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let res: Response;
    try {
      // 一.6: 接入 fetchWithTimeout，默认 30s 超时
      res = await fetchWithTimeout(`${API_BASE}${path}`, { ...init, headers });
    } catch (err) {
      // fetchWithTimeout 已将超时转换为 PanelApiError('TIMEOUT')
      if (err instanceof PanelApiError) {
        throw err;
      }
      // 3.3.7: AbortController.abort() 触发的 DOMException(name='AbortError') 原样抛出，
      // 让调用方能区分"主动取消"与"真实网络错误"。主动取消不应触发退避/重试。
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw new PanelApiError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : '网络请求失败',
        0,
      );
    }

    if (res.status === 401) {
      onUnauthorized?.();
      throw new PanelApiError('PANEL_UNAUTHORIZED', '未授权或登录已过期', 401);
    }

    // v3.9.0-S8: 维护模式 503 → 硬跳转到 /maintenance 页面
    //   - 后端开启 maintenance.enabled 时所有非管理员 API 返回 503 + MAINTENANCE_MODE
    //   - 公开接口（login/register 等）已在白名单内不触发此码
    //   - 使用 window.location 而非 React Router 是为了打破任何当前页面状态（包括已挂载组件）
    if (res.status === 503) {
      let code503 = `HTTP_${res.status}`;
      let message503 = res.statusText || '服务不可用';
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        if (body?.error?.code) code503 = body.error.code;
        if (body?.error?.message) message503 = body.error.message;
      } catch {
        // 非 JSON 错误体，保留默认 message
      }
      if (code503 === 'MAINTENANCE_MODE' && typeof window !== 'undefined') {
        // 避免重复跳转——已在 /maintenance 页面时不再跳转
        if (!window.location.pathname.startsWith('/maintenance')) {
          window.location.href = '/maintenance';
        }
      }
      throw new PanelApiError(code503, message503, res.status);
    }

    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      let message = res.statusText || `请求失败 (${res.status})`;
      let details: PanelApiErrorDetails | undefined;
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string; details?: PanelApiErrorDetails };
        };
        if (body?.error?.code) code = body.error.code;
        if (body?.error?.message) message = body.error.message;
        // v4.19.1: 透传 details（如 WEAK_PASSWORD 的 failures 列表）
        if (body?.error?.details) details = body.error.details;
      } catch {
        // 非 JSON 错误体，保留默认 message
      }
      throw new PanelApiError(code, message, res.status, details);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  return {
    async login(req) {
      const raw = await request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return validateResponse(loginResponseSchema, raw, 'POST /auth/login');
    },
    register(req) {
      // 注册入口无需 token（公开 API）
      return request<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    async me() {
      const raw = await request<MeResponse>('/auth/me');
      return validateResponse(meResponseSchema, raw, 'GET /auth/me');
    },
    // v4.17.0: 切换会话级活动角色（POST /api/auth/select-role）
    //   成功：返回新 token + 更新后的 user（含新 active_role）
    //   401 PANEL_UNAUTHORIZED 邮箱或密码错误
    //   403 PANEL_FORBIDDEN JWT 用户与凭证用户不一致
    //   400 PANEL_VALIDATION_ERROR active_role 不在用户角色集合中
    async selectRole(req: SelectRoleRequest) {
      const raw = await request<SelectRoleResponse>('/auth/select-role', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return validateResponse(selectRoleResponseSchema, raw, 'POST /auth/select-role');
    },
    // v4.28.0: 免密切换同级身份（POST /api/auth/switch-role，全员服主）
    //   仅凭 JWT 切换 user ↔ instance_admin；server_admin 目标被后端 403 拒绝
    //   400 PANEL_VALIDATION_ERROR / 403 PANEL_FORBIDDEN 由调用方处理
    async switchRole(req: SwitchRoleRequest) {
      const raw = await request<SwitchRoleResponse>('/auth/switch-role', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      return validateResponse(switchRoleResponseSchema, raw, 'POST /auth/switch-role');
    },
    // v4.17.0: 撤销目标用户所有未过期 token（POST /api/auth/revoke-tokens）
    //   仅 server_admin 可调用；强制目标用户重新登录
    async revokeUserTokens(userId: string) {
      const raw = await request<RevokeUserTokensResponse>('/auth/revoke-tokens', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      return validateResponse(revokeUserTokensResponseSchema, raw, 'POST /auth/revoke-tokens');
    },
    // v3.4.0: 修改当前用户密码（模块3 用户安全）
    //   成功：返回 { tokenVersion }，旧 JWT 失效（需重新登录）
    //   401 INVALID_CREDENTIAL / 400 AUTH_PWD_002 / 409 AUTH_PWD_003 由调用方处理
    changePassword(oldPassword, newPassword) {
      return request<ChangePasswordResponse>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
    },
    // v3.9.0-S4: 密码找回（公开端点，使用匿名客户端调用即可，但放在这里便于统一管理）
    requestPasswordReset(email) {
      return request<PasswordResetRequestResponse>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    },
    confirmPasswordReset(token, newPassword) {
      return request<PasswordResetConfirmResponse>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
      });
    },
    // v3.9.0-S5: 邮箱验证
    getEmailVerifyStatus() {
      return request<EmailVerifyStatusResponse>('/auth/email-verify/status');
    },
    requestEmailVerify() {
      return request<EmailVerifyRequestResponse>('/auth/email-verify/request', {
        method: 'POST',
      });
    },
    confirmEmailVerify(token) {
      return request<EmailVerifyConfirmResponse>('/auth/email-verify/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
    },
    // v3.9.0-S7: 公开法律内容（用户协议 + 隐私政策）
    getLegalTerms() {
      return request<LegalContentResponse>('/legal/terms');
    },
    getLegalPrivacy() {
      return request<LegalContentResponse>('/legal/privacy');
    },
    // v4.16.x: 身份体系重构——用户身份管理
    listIdentities() {
        return request<import('./modules/auth').ListIdentitiesResponse>('/auth/identities');
    },
    createIdentity(req) {
        return request<import('./modules/auth').CreateIdentityResponse>('/auth/identities', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    activateIdentity(id) {
      return request<void>(`/auth/identities/${id}/activate`, {
        method: 'POST',
      });
    },
    setDefaultIdentity(id) {
      return request<void>(`/auth/identities/${id}/set-default`, {
        method: 'POST',
      });
    },
    listPacks() {
      return request<ListPacksResponse>('/packs');
    },
    getPackYaml(packId) {
      return request<GetPackYamlResponse>(`/packs/${encodeURIComponent(packId)}`);
    },
    updatePackYaml(packId, req) {
      return request<UpdatePackYamlResponse>(`/packs/${encodeURIComponent(packId)}`, {
        method: 'PUT',
        body: JSON.stringify(req),
      });
    },
    createPack(req) {
      return request<CreatePackResponse>('/packs', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    deletePack(packId) {
      return request<DeletePackResponse>(`/packs/${encodeURIComponent(packId)}`, {
        method: 'DELETE',
      });
    },
    previewDeletePack(packId) {
      return request<DeletePackPreviewResponse>(
        `/packs/${encodeURIComponent(packId)}?dry_run=true`,
        { method: 'DELETE' },
      );
    },
    listNodes() {
      return request<ListNodesResponse>('/nodes');
    },
    pingNode(id: string) {
      return request<{ latency_ms: number }>(`/nodes/${id}/ping`);
    },
    async listServers() {
      const raw = await request<ListServersResponse>('/servers');
      return validateResponse(listServersResponseSchema, raw, 'GET /servers');
    },
    getServer(id) {
      return request<ServerDetailResponse>(`/servers/${encodeURIComponent(id)}`);
    },
    createServer(req) {
      return request<CreateServerResponse>('/servers', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    deleteServer(id) {
      return request<DeleteServerResponse>(`/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    startServer(id) {
      return request<ServerStartResponse>(`/servers/${encodeURIComponent(id)}/start`, {
        method: 'POST',
      });
    },
    // v1.1.0: 启动前置引导——获取引导声明 + 当前已填配置
    getStartupGuide(id) {
      return request<GetStartupGuideResponse>(
        `/servers/${encodeURIComponent(id)}/startup-guide`,
      );
    },
    // v1.1.0: 启动前置引导——保存用户填写的启动配置（含 config_writes 写入）
    saveStartupConfig(id, req) {
      return request<SaveStartupConfigResponse>(
        `/servers/${encodeURIComponent(id)}/startup-config`,
        {
          method: 'PUT',
          body: JSON.stringify(req),
        },
      );
    },
    stopServer(id) {
      return request<ServerStopResponse>(`/servers/${encodeURIComponent(id)}/stop`, {
        method: 'POST',
      });
    },
    // v4.29.8: 强制重置 error → stopped（仅 server_admin，仅 error 状态）
    resetServerState(id) {
      return request<ServerResetStateResponse>(
        `/servers/${encodeURIComponent(id)}/reset-state`,
        { method: 'POST' },
      );
    },
    // v4.31.0: 管理员修改实例有效期（仅 server_admin）
    updateServerExpiry(id, req) {
      return request<{ server: ServerSummary }>(
        `/servers/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    // v4.31.0: 获取节点上的实例列表
    listNodeInstances(nodeId) {
      return request<NodeInstancesResponse>(
        `/nodes/${encodeURIComponent(nodeId)}/instances`,
      );
    },
    sendCommand(id, command) {
      return request<ServerCommandResponse>(`/servers/${encodeURIComponent(id)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    },
    listUsers(query) {
      const qs = new URLSearchParams();
      if (query?.page !== undefined) qs.set('page', String(query.page));
      if (query?.page_size !== undefined) qs.set('page_size', String(query.page_size));
      if (query?.keyword) qs.set('keyword', query.keyword);
      const tail = qs.toString() ? `?${qs.toString()}` : '';
      return request<ListUsersResponse>(`/users${tail}`);
    },
    getUser(id) {
      return request<GetUserResponse>(`/users/${encodeURIComponent(id)}`);
    },
    createUser(req) {
      return request<CreateUserResponse>('/users', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateUser(id, req) {
      return request<UpdateUserResponse>(`/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(req),
      });
    },
    updateUserRole(id, req) {
      return request<UpdateUserRoleResponse>(`/users/${encodeURIComponent(id)}/role`, {
        method: 'PATCH',
        body: JSON.stringify(req),
      });
    },
    deleteUser(id) {
      return request<DeleteUserResponse>(`/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    batchOperateUsers(req) {
      return request<BatchUserOperationResponse>('/users/batch', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    getUserStats() {
      return request<UserStatsResponse>('/users/stats');
    },
    listSystemConfigs() {
      return request<ListSystemConfigsResponse>('/system-config');
    },
    getSystemConfig(key) {
      return request<GetSystemConfigResponse>(`/system-config/${encodeURIComponent(key)}`);
    },
    setSystemConfig(key, req) {
      return request<SetSystemConfigResponse>(`/system-config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify(req),
      });
    },
    deleteSystemConfig(key) {
      return request<DeleteSystemConfigResponse>(`/system-config/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    },
    listVipPermissions() {
      return request<ListVipPermissionsResponse>('/vip-permissions');
    },
    getVipPermission(level) {
      return request<GetVipPermissionResponse>(`/vip-permissions/${encodeURIComponent(level)}`);
    },
    createVipPermission(req) {
      return request<CreateVipPermissionResponse>('/vip-permissions', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateVipPermission(level, req) {
      return request<UpdateVipPermissionResponse>(`/vip-permissions/${encodeURIComponent(level)}`, {
        method: 'PATCH',
        body: JSON.stringify(req),
      });
    },
    deleteVipPermission(level) {
      return request<DeleteVipPermissionResponse>(`/vip-permissions/${encodeURIComponent(level)}`, {
        method: 'DELETE',
      });
    },
    triggerItemSync(packId) {
      return request<TriggerItemSyncResponse>(`/packs/${encodeURIComponent(packId)}/item-sync`, {
        method: 'POST',
      });
    },
    listItemSyncLogs(packId) {
      return request<ListItemSyncLogsResponse>(
        `/packs/${encodeURIComponent(packId)}/item-sync/logs`,
      );
    },
    listPackItems(packId) {
      return request<ListPackItemsResponse>(`/packs/${encodeURIComponent(packId)}/items`);
    },
    // 3.4.5: Pack 物品池配置（仅元信息，无 static_list）— 前端用于动态品质列
    getPackItemsConfig(packId) {
      return request<PackItemsConfig>(`/packs/${encodeURIComponent(packId)}/items-config`);
    },
    listShopItems(serverId) {
      return request<ListShopItemsResponse>(`/servers/${encodeURIComponent(serverId)}/shop-items`);
    },
    upsertShopItem(serverId, req) {
      return request<UpsertShopItemResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-items`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    deleteShopItem(serverId, id) {
      return request<DeleteShopItemResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-items/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    createShopOrder(serverId, req) {
      return request<CreateShopOrderResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-orders`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    listShopOrders(serverId) {
      return request<ListShopOrdersResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-orders`,
      );
    },
    getShopOrder(serverId, orderId) {
      return request<GetShopOrderResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-orders/${encodeURIComponent(orderId)}`,
      );
    },
    claimShopOrder(serverId, req) {
      return request<ClaimShopOrderResponse>(
        `/servers/${encodeURIComponent(serverId)}/shop-orders/claim`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    // 经济系统：钱包余额查询 + 每日点券领取
    getWallet(serverId) {
      return request<GetWalletResponse>(`/servers/${encodeURIComponent(serverId)}/wallet`);
    },
    claimDailyReward(serverId) {
      return request<ClaimDailyRewardResponse>(
        `/servers/${encodeURIComponent(serverId)}/wallet/claim-daily`,
        { method: 'POST' },
      );
    },
    createCdkCodes(serverId, req) {
      return request<CreateCdkCodesResponse>(`/servers/${encodeURIComponent(serverId)}/cdk-codes`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    listCdkCodes(serverId) {
      return request<ListCdkCodesResponse>(`/servers/${encodeURIComponent(serverId)}/cdk-codes`);
    },
    getCdkCode(serverId, id) {
      return request<GetCdkCodeResponse>(
        `/servers/${encodeURIComponent(serverId)}/cdk-codes/${encodeURIComponent(id)}`,
      );
    },
    deleteCdkCode(serverId, id) {
      return request<DeleteCdkCodeResponse>(
        `/servers/${encodeURIComponent(serverId)}/cdk-codes/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    redeemCdk(serverId, req) {
      return request<RedeemCdkResponse>(`/servers/${encodeURIComponent(serverId)}/cdk/redeem`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    lookupCdk(code: string) {
      return request<{ code: { gift_name: string | null; gift_description: string | null; item_name: string; count: number; quality: string; items: Array<{ item_name: string; count: number; quality: string }>; expires_at: string; status: string; server_id: string } }>(
        `/cdk/lookup?code=${encodeURIComponent(code)}`,
      );
    },
    redeemCdkGlobal(req: { code: string; player_name?: string }) {
      return request<RedeemCdkResponse & { followed: boolean }>('/cdk/redeem', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    // ----- P3 聊天 -----
    getChatSettings(serverId) {
      return request<GetChatSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/settings`,
      );
    },
    upsertChatSettings(serverId, req) {
      return request<UpsertChatSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/settings`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    listChatTriggers(serverId) {
      return request<ListChatTriggersResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/triggers`,
      );
    },
    createChatTrigger(serverId, req) {
      return request<CreateChatTriggerResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/triggers`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    updateChatTrigger(serverId, id, req) {
      return request<UpdateChatTriggerResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/triggers/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    deleteChatTrigger(serverId, id) {
      return request<DeleteChatTriggerResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat/triggers/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    // ----- P3 投票 -----
    getVoteSettings(serverId) {
      return request<GetVoteSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/vote-settings`,
      );
    },
    upsertVoteSettings(serverId, req) {
      return request<UpsertVoteSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/vote-settings`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    listVotes(serverId) {
      return request<ListVotesResponse>(`/servers/${encodeURIComponent(serverId)}/votes`);
    },
    createVote(serverId, req) {
      return request<CreateVoteResponse>(`/servers/${encodeURIComponent(serverId)}/votes`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    getVote(serverId, id) {
      return request<GetVoteResponse>(
        `/servers/${encodeURIComponent(serverId)}/votes/${encodeURIComponent(id)}`,
      );
    },
    castVote(serverId, id, req) {
      return request<CastVoteResponse>(
        `/servers/${encodeURIComponent(serverId)}/votes/${encodeURIComponent(id)}/cast`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    cancelVote(serverId, id) {
      return request<CancelVoteResponse>(
        `/servers/${encodeURIComponent(serverId)}/votes/${encodeURIComponent(id)}/cancel`,
        { method: 'POST' },
      );
    },
    // ----- P3 玩家 -----
    getPlayerJoinSettings(serverId) {
      return request<GetPlayerJoinSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/player-join/settings`,
      );
    },
    upsertPlayerJoinSettings(serverId, req) {
      return request<UpsertPlayerJoinSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/player-join/settings`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    listPlayerBindings() {
      return request<ListPlayerBindingsResponse>(`/player-bindings`);
    },
    createPlayerBinding(req) {
      return request<CreatePlayerBindingResponse>(`/player-bindings`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    verifyPlayerBinding(id, req) {
      return request<VerifyPlayerBindingResponse>(
        `/player-bindings/${encodeURIComponent(id)}/verify`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    rejectPlayerBinding(id) {
      return request<RejectPlayerBindingResponse>(
        `/player-bindings/${encodeURIComponent(id)}/reject`,
        { method: 'POST' },
      );
    },
    deletePlayerBinding(id) {
      return request<DeletePlayerBindingResponse>(`/player-bindings/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    // v4.15.0: 玩家门户聚合 API（/api/my/*）
    listMyOrders(status?: MyOrdersStatusFilter) {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      return request<ListMyOrdersResponse>(`/my/orders${qs}`);
    },
    getMyOverview() {
      return request<GetMyOverviewResponse>(`/my/overview`);
    },
    listPlayerHistories(serverId) {
      return request<ListPlayerHistoriesResponse>(
        `/servers/${encodeURIComponent(serverId)}/player-histories`,
      );
    },
    listGiftClaims(serverId) {
      return request<ListGiftClaimsResponse>(
        `/servers/${encodeURIComponent(serverId)}/gift-claims`,
      );
    },
    // ----- P3 定时消息 -----
    listPeriodicMessages(serverId) {
      return request<ListPeriodicMessagesResponse>(
        `/servers/${encodeURIComponent(serverId)}/periodic-messages`,
      );
    },
    createPeriodicMessage(serverId, req) {
      return request<CreatePeriodicMessageResponse>(
        `/servers/${encodeURIComponent(serverId)}/periodic-messages`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    updatePeriodicMessage(serverId, id, req) {
      return request<UpdatePeriodicMessageResponse>(
        `/servers/${encodeURIComponent(serverId)}/periodic-messages/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    deletePeriodicMessage(serverId, id) {
      return request<DeletePeriodicMessageResponse>(
        `/servers/${encodeURIComponent(serverId)}/periodic-messages/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- P4: Mods ----------
    listMods(serverId) {
      return request<ListModsResponse>(`/servers/${encodeURIComponent(serverId)}/mods`);
    },
    createMod(serverId, req) {
      return request<CreateModResponse>(`/servers/${encodeURIComponent(serverId)}/mods`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateMod(serverId, id, req) {
      return request<UpdateModResponse>(
        `/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    deleteMod(serverId, id) {
      return request<DeleteModResponse>(
        `/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    // v4.3.0-H1: 文件系统级 Mod 管理
    listModFiles(serverId) {
      return request<ListModFilesResponse>(
        `/servers/${encodeURIComponent(serverId)}/mods/files`,
      );
    },
    toggleModFile(serverId, modName) {
      return request<ToggleModFileResponse>(
        `/servers/${encodeURIComponent(serverId)}/mods/files/${encodeURIComponent(modName)}/toggle`,
        { method: 'POST' },
      );
    },
    // L4: jar 元数据扫描（识别客户端 mod，转发到 Panel GET /api/servers/:id/mods/scan）
    scanMods(serverId) {
      return request<ScanModsResponse>(
        `/servers/${encodeURIComponent(serverId)}/mods/scan`,
      );
    },

    // ---------- P4: Saves ----------
    listSaves(serverId) {
      return request<ListSavesResponse>(`/servers/${encodeURIComponent(serverId)}/saves`);
    },
    createSave(serverId, req) {
      return request<CreateSaveResponse>(`/servers/${encodeURIComponent(serverId)}/saves`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    activateSave(serverId, id) {
      return request<ActivateSaveResponse>(
        `/servers/${encodeURIComponent(serverId)}/saves/${encodeURIComponent(id)}/activate`,
        { method: 'POST' },
      );
    },
    deleteSave(serverId, id) {
      return request<DeleteSaveResponse>(
        `/servers/${encodeURIComponent(serverId)}/saves/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- P4: Backups ----------
    listBackups(serverId) {
      return request<ListBackupsResponse>(`/servers/${encodeURIComponent(serverId)}/backups`);
    },
    createBackup(serverId, req) {
      return request<CreateBackupResponse>(`/servers/${encodeURIComponent(serverId)}/backups`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateBackup(serverId, id, req) {
      return request<UpdateBackupResponse>(
        `/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    deleteBackup(serverId, id) {
      return request<DeleteBackupResponse>(
        `/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- P4: Monitor ----------
    listMonitorSnapshots(serverId, query) {
      const qs = new URLSearchParams();
      if (query.from) qs.set('from', query.from);
      if (query.to) qs.set('to', query.to);
      if (query.limit !== undefined) qs.set('limit', String(query.limit));
      const search = qs.toString();
      const path = `/servers/${encodeURIComponent(serverId)}/monitor/snapshots${search ? `?${search}` : ''}`;
      return request<ListMonitorSnapshotsResponse>(path);
    },
    createMonitorSnapshot(serverId, req) {
      return request<CreateMonitorSnapshotResponse>(
        `/servers/${encodeURIComponent(serverId)}/monitor/snapshots`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    getLatestMonitorSnapshot(serverId) {
      return request<GetLatestSnapshotResponse>(
        `/servers/${encodeURIComponent(serverId)}/monitor/latest`,
      );
    },

    // ---------- P4: Lists (whitelist / banlist) ----------
    listListEntries(serverId, listType) {
      return request<ListListEntriesResponse>(
        `/servers/${encodeURIComponent(serverId)}/lists/${encodeURIComponent(listType)}`,
      );
    },
    createListEntry(serverId, listType, req) {
      return request<CreateListEntryResponse>(
        `/servers/${encodeURIComponent(serverId)}/lists/${encodeURIComponent(listType)}`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    deleteListEntry(serverId, listType, playerName) {
      return request<DeleteListEntryResponse>(
        `/servers/${encodeURIComponent(serverId)}/lists/${encodeURIComponent(listType)}/${encodeURIComponent(playerName)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- P5: Webhooks ----------
    listWebhooks(serverId) {
      return request<ListWebhooksResponse>(`/servers/${encodeURIComponent(serverId)}/webhooks`);
    },
    createWebhook(serverId, req) {
      return request<CreateWebhookResponse>(`/servers/${encodeURIComponent(serverId)}/webhooks`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateWebhook(serverId, id, req) {
      return request<UpdateWebhookResponse>(
        `/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(req) },
      );
    },
    deleteWebhook(serverId, id) {
      return request<DeleteWebhookResponse>(
        `/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },
    triggerWebhookTest(serverId, id, req) {
      return request<TriggerWebhookTestResponse>(
        `/servers/${encodeURIComponent(serverId)}/webhooks/${encodeURIComponent(id)}/test`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },

    // ---------- P5: Audit Logs ----------
    listAuditLogs(query) {
      const qs = new URLSearchParams();
      if (query.server_id) qs.set('server_id', query.server_id);
      if (query.user_id) qs.set('user_id', query.user_id);
      if (query.action) qs.set('action', query.action);
      if (query.target_type) qs.set('target_type', query.target_type);
      if (query.from) qs.set('from', query.from);
      if (query.to) qs.set('to', query.to);
      if (query.limit !== undefined) qs.set('limit', String(query.limit));
      const search = qs.toString();
      return request<ListAuditLogsResponse>(`/audit-logs${search ? `?${search}` : ''}`);
    },

    // ---------- Task 11: Config Files ----------
    listConfigFiles(serverId) {
      return request<ListConfigFilesResponse>(
        `/servers/${encodeURIComponent(serverId)}/config-files`,
      );
    },
    readConfigFile(serverId, name) {
      return request<ReadConfigFileResponse>(
        `/servers/${encodeURIComponent(serverId)}/config-files/${encodeURIComponent(name)}`,
      );
    },
    writeConfigFile(serverId, name, req) {
      return request<WriteConfigFileResponse>(
        `/servers/${encodeURIComponent(serverId)}/config-files/${encodeURIComponent(name)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    getConfigFileSchema(serverId, name) {
      return request<GetConfigFileSchemaResponse>(
        `/servers/${encodeURIComponent(serverId)}/config-files/${encodeURIComponent(name)}/schema`,
      );
    },

    // ---------- Task 11: World Gen ----------
    regenerateMap(serverId, saveName) {
      return request<RegenerateMapResponse>(
        `/servers/${encodeURIComponent(serverId)}/world/regenerate`,
        { method: 'POST', body: JSON.stringify({ save_name: saveName }) },
      );
    },
    getMapSettingsSchema(serverId) {
      return request<GetMapSettingsSchemaResponse>(
        `/servers/${encodeURIComponent(serverId)}/world/map-settings`,
      );
    },
    updateMapSettings(serverId, settingsName, req) {
      return request<UpdateMapSettingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/world/map-settings/${encodeURIComponent(settingsName)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },

    // ---------- Task 11: Chat Logs ----------
    listChatLogs(serverId, query) {
      const qs = new URLSearchParams();
      if (query.player_name) qs.set('player_name', query.player_name);
      if (query.message_contains) qs.set('message_contains', query.message_contains);
      if (query.start_time) qs.set('start_time', query.start_time);
      if (query.end_time) qs.set('end_time', query.end_time);
      if (query.limit !== undefined) qs.set('limit', String(query.limit));
      if (query.offset !== undefined) qs.set('offset', String(query.offset));
      const search = qs.toString();
      return request<ListChatLogsResponse>(
        `/servers/${encodeURIComponent(serverId)}/chat-logs${search ? `?${search}` : ''}`,
      );
    },

    // ---------- Task 11: Game Update ----------
    checkUpdate(serverId) {
      return request<CheckUpdateResponse>(`/servers/${encodeURIComponent(serverId)}/update/check`);
    },
    applyUpdate(serverId, body) {
      return request<ApplyUpdateResponse>(`/servers/${encodeURIComponent(serverId)}/update/apply`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getUpdateProgress(serverId) {
      return request<UpdateProgressResponse>(
        `/servers/${encodeURIComponent(serverId)}/update/progress`,
      );
    },

    // ---------- 模块10: 玩家验证码 ----------
    createVerifyCode(req) {
      return request<CreateVerifyCodeResponse>('/verify-codes', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    listMyVerifyCodes() {
      return request<ListMyVerifyCodesResponse>('/verify-codes/mine');
    },

    // ---------- 模块10: server 级玩家绑定管理（admin） ----------
    listServerPlayerBindings(serverId) {
      return request<ListServerPlayerBindingsResponse>(
        `/servers/${encodeURIComponent(serverId)}/player-bindings`,
      );
    },
    deleteServerPlayerBinding(serverId, id) {
      return request<DeleteServerPlayerBindingResponse>(
        `/servers/${encodeURIComponent(serverId)}/player-bindings/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- 实例VIP管理（instance_admin+） ----------
    async listInstanceBindings(serverId) {
      const raw = await request<ListInstanceBindingsWireResponse>(
        `/instances/${encodeURIComponent(serverId)}/bindings`,
      );
      return {
        bindings: snakeToCamel<
          Array<{
            id: number;
            userId: string;
            username: string;
            vipLevel: number;
            vipExpiresAt: string | null;
            status: string;
            boundAt: string;
          }>
        >(raw.bindings ?? []),
      };
    },
    updateBindingVip(serverId, userId, vipLevel, vipExpiresAt) {
      const body: Record<string, unknown> = { vip_level: vipLevel };
      if (vipExpiresAt !== undefined) {
        body.vip_expires_at = vipExpiresAt;
      }
      return request<void>(
        `/instances/${encodeURIComponent(serverId)}/bindings/${encodeURIComponent(userId)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
    },

    // ---------- 用户自助实例绑定管理 ----------
    async listMyBindings() {
      const raw = await request<ListUserBindingsResponse>('/profile/bindings');
      return snakeToCamel<MyBinding[]>(raw.bindings ?? []);
    },
    async bindInstance(serverId) {
      try {
        await request<void>(`/instances/${encodeURIComponent(serverId)}/bindings`, {
          method: 'POST',
        });
      } catch (err) {
        if (err instanceof PanelApiError && err.status === 409) {
          throw new PanelApiError('ALREADY_BOUND', '已绑定该实例', 409);
        }
        throw err;
      }
    },
    unbindInstance(serverId) {
      return request<void>(`/instances/${encodeURIComponent(serverId)}/bindings`, {
        method: 'DELETE',
      });
    },

    // ---------- Pack 管理 ----------
    async reloadPacks() {
      const raw = await request<unknown>('/packs/reload', { method: 'POST' });
      return snakeToCamel<ReloadPacksResult>(raw);
    },

    // ---------- I3: API Key 管理（v4.4.0-J1，仅 server_admin） ----------
    listApiKeys() {
      return request<import('@public/schema/panel-api-types').ListApiKeysResponse>('/api-keys');
    },
    createApiKey(req) {
      return request<import('@public/schema/panel-api-types').CreateApiKeyResponse>('/api-keys', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    getApiKey(id) {
      return request<import('@public/schema/panel-api-types').GetApiKeyResponse>(
        `/api-keys/${encodeURIComponent(id)}`,
      );
    },
    revokeApiKey(id) {
      return request<import('@public/schema/panel-api-types').RevokeApiKeyResponse>(
        `/api-keys/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- B2.1: 提现审批（用户中心经济系统，后端 requireAdmin） ----------
    // 后端：panel/backend/src/api/routes/userCenter.ts（挂载于 /api/admin/withdraw/*）
    listPendingWithdraws(page, pageSize) {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      return request<ListPendingWithdrawsResponse>(
        `/admin/withdraw/pending?${qs.toString()}`,
      );
    },
    approveWithdraw(code) {
      return request<{ approved: true; code: string }>(
        `/admin/withdraw/${encodeURIComponent(code)}/approve`,
        { method: 'POST' },
      );
    },
    rejectWithdraw(code) {
      return request<{ rejected: true; code: string }>(
        `/admin/withdraw/${encodeURIComponent(code)}/reject`,
        { method: 'POST' },
      );
    },

    // ---------- v4.5.0: 实例共管管理员管理 ----------
    listInstanceAdmins(serverId) {
      return request<import('@public/schema/panel-api-types').ListInstanceAdminsResponse>(
        `/servers/${encodeURIComponent(serverId)}/admins`,
      );
    },
    assignInstanceAdmin(serverId, req) {
      return request<import('@public/schema/panel-api-types').AssignInstanceAdminResponse>(
        `/servers/${encodeURIComponent(serverId)}/admins`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    removeInstanceAdmin(serverId, userId) {
      return request<void>(
        `/servers/${encodeURIComponent(serverId)}/admins/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
    },
    // ---------- v4.5.0: 我的资产聚合 ----------
    getMyAssets() {
      return request<import('@public/schema/panel-api-types').MyAssetsResponse>('/me/assets');
    },

    // ---------- v4.6.0-D: 运营仪表盘（instance_admin+ 可见） ----------
    getOperationsOverview() {
      return request<import('@public/schema/panel-api-types').InstanceAdminOverviewResponse>(
        '/operations/instance-admin/overview',
      );
    },
    getOperationsRevenue(days = 30) {
      return request<import('@public/schema/panel-api-types').OperationsRevenueResponse>(
        `/operations/instance-admin/revenue?days=${days}`,
      );
    },
    getOperationsPlayers(days = 30) {
      return request<import('@public/schema/panel-api-types').OperationsPlayersResponse>(
        `/operations/instance-admin/players?days=${days}`,
      );
    },
    getOperationsInstancesCompare() {
      return request<import('@public/schema/panel-api-types').OperationsInstancesCompareResponse>(
        '/operations/instance-admin/instances-compare',
      );
    },

    // ---------- v4.6.0-E: 资源配额系统 ----------
    getMyQuota() {
      return request<import('@public/schema/panel-api-types').MyQuotaResponse>('/quotas');
    },
    getRoleQuota(role: string) {
      return request<import('@public/schema/panel-api-types').RoleQuotaResponse>(
        `/quotas/role/${encodeURIComponent(role)}`,
      );
    },
    updateRoleQuota(role: string, req: import('@public/schema/panel-api-types').UpdateRoleQuotaRequest) {
      return request<import('@public/schema/panel-api-types').UpdateRoleQuotaResponse>(
        `/quotas/role/${encodeURIComponent(role)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    getUserQuota(userId: string) {
      return request<import('@public/schema/panel-api-types').UserQuotaResponse>(
        `/quotas/user/${encodeURIComponent(userId)}`,
      );
    },
    updateUserQuota(userId: string, req: import('@public/schema/panel-api-types').UpdateUserQuotaRequest) {
      return request<import('@public/schema/panel-api-types').UpdateUserQuotaResponse>(
        `/quotas/user/${encodeURIComponent(userId)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },

    // ---------- v4.6.0-F: 告警系统 ----------
    getAlertSettings() {
      return request<import('@public/schema/panel-api-types').AlertSettingsResponse>('/alert-settings');
    },
    updateAlertSettings(req: import('@public/schema/panel-api-types').UpdateAlertSettingsRequest) {
      return request<import('@public/schema/panel-api-types').UpdateAlertSettingsResponse>(
        '/alert-settings',
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    listAlertRules() {
      return request<import('@public/schema/panel-api-types').AlertRulesListResponse>('/alert-settings/rules');
    },
    listAlertEvents() {
      return request<import('@public/schema/panel-api-types').AlertEventsListResponse>('/alert-settings/events');
    },
    testAlertWebhook(req: import('@public/schema/panel-api-types').TestWebhookRequest) {
      return request<import('@public/schema/panel-api-types').TestWebhookResponse>(
        '/alert-settings/test-webhook',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },

    // ---------- v4.7.0-G1: 全平台总览（server_admin 专用） ----------
    getPlatformOverview() {
      return request<import('@public/schema/panel-api-types').PlatformOverview>(
        '/platform/overview',
      );
    },
    getPlatformUsersTrend(range: '24h' | '30d') {
      return request<import('@public/schema/panel-api-types').PlatformUsersTrendResponse>(
        `/platform/users?range=${encodeURIComponent(range)}`,
      );
    },
    getPlatformRevenueTrend(days: number) {
      return request<import('@public/schema/panel-api-types').PlatformRevenueTrendResponse>(
        `/platform/revenue?days=${days}`,
      );
    },
    getDiskUsageTop(limit: number) {
      return request<import('@public/schema/panel-api-types').DiskUsageTopResponse>(
        `/platform/disk-usage-top?limit=${limit}`,
      );
    },

    // ---------- v4.7.0-H1: 实例级角色覆盖（instance_admin+） ----------
    listInstanceRoles(serverId: string) {
      return request<import('@public/schema/panel-api-types').InstanceRoleListResponse>(
        `/servers/${encodeURIComponent(serverId)}/roles`,
      );
    },
    grantInstanceRole(serverId: string, req: import('@public/schema/panel-api-types').GrantInstanceRoleRequest) {
      return request<import('@public/schema/panel-api-types').GrantInstanceRoleResponse>(
        `/servers/${encodeURIComponent(serverId)}/roles`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    revokeInstanceRole(serverId: string, userId: string) {
      return request<{ success: true }>(
        `/servers/${encodeURIComponent(serverId)}/roles/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- v4.7.0-I1: 批量操作（已登录用户，按实例权限校验） ----------
    batchStart(req: import('@public/schema/panel-api-types').BatchActionRequest) {
      return request<import('@public/schema/panel-api-types').BatchActionResponse>(
        '/batch/start',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    batchStop(req: import('@public/schema/panel-api-types').BatchActionRequest) {
      return request<import('@public/schema/panel-api-types').BatchActionResponse>(
        '/batch/stop',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    batchRestart(req: import('@public/schema/panel-api-types').BatchActionRequest) {
      return request<import('@public/schema/panel-api-types').BatchActionResponse>(
        '/batch/restart',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    batchBackup(req: import('@public/schema/panel-api-types').BatchActionRequest) {
      return request<import('@public/schema/panel-api-types').BatchActionResponse>(
        '/batch/backup',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    batchUpdate(req: import('@public/schema/panel-api-types').BatchActionRequest) {
      return request<import('@public/schema/panel-api-types').BatchActionResponse>(
        '/batch/update',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },

    // ---------- 站内通知 ----------
    // 3.3.7: 重新引入可选 signal 参数，移除 keepalive。
    //   keepalive: true 与 abort 交互时仍会触发 net::ERR_ABORTED；改用 signal
    //   主动 abort，Chrome 100+ 不再记录 ERR_ABORTED。
    //   调用方负责在 hidden/cleanup 时调用 controller.abort()。
    //   不传 signal 时请求自然完成（兼容 Shop/NotificationsPage 一次性调用）。
    listNotifications(signal?: AbortSignal) {
      return request<{
        notifications: Array<{
          id: number;
          type: string;
          title: string;
          content: string;
          related_server_id: string | null;
          related_order_id: number | null;
          is_read: boolean;
          created_at: string;
        }>;
        unread_count: number;
      }>('/notifications', signal ? { signal } : {});
    },
    markNotificationRead(id) {
      return request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
    },
    markAllNotificationsRead() {
      return request<void>('/notifications/read-all', { method: 'PATCH' });
    },

    // ---------- P6: 日志文件管理（转发 Daemon） ----------
    /** 读取实例控制台历史日志行（Daemon 内存环形缓冲），用于 RconConsole 挂载时预填 */
    getConsoleLogs(serverId, limit = 500) {
      return request<{ lines: string[] }>(
        `/servers/${encodeURIComponent(serverId)}/logs?limit=${limit}`,
      );
    },
    listLogFiles(serverId) {
      return request<ListLogFilesResponse>(`/servers/${encodeURIComponent(serverId)}/log-files`);
    },
    readLogFile(serverId, filename, count) {
      const qs = new URLSearchParams();
      if (count !== undefined && count > 0) qs.set('count', String(count));
      const search = qs.toString();
      return request<ReadLogFileResponse>(
        `/servers/${encodeURIComponent(serverId)}/log-files/${encodeURIComponent(filename)}${search ? `?${search}` : ''}`,
      );
    },
    deleteLogFile(serverId, filename) {
      return request<void>(
        `/servers/${encodeURIComponent(serverId)}/log-files/${encodeURIComponent(filename)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- P6: 在线玩家实时查询（转发 Daemon） ----------
    listOnlinePlayers(serverId) {
      return request<ListOnlinePlayersResponse>(`/servers/${encodeURIComponent(serverId)}/players`);
    },

    // ---------- v4.2.0-D1: 玩家管理操作（kick/ban/pardon/op/deop/whitelist） ----------
    kickPlayer(serverId, playerName, reason) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/kick`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName, reason: reason ?? null }) },
      );
    },
    banPlayer(serverId, playerName, reason) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/ban`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName, reason: reason ?? null }) },
      );
    },
    pardonPlayer(serverId, playerName) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/pardon`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName }) },
      );
    },
    opPlayer(serverId, playerName) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/op`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName }) },
      );
    },
    deopPlayer(serverId, playerName) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/deop`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName }) },
      );
    },
    whitelistAdd(serverId, playerName) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/whitelist/add`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName }) },
      );
    },
    whitelistRemove(serverId, playerName) {
      return request<import('@public/schema/panel-api-types').PlayerActionResponse>(
        `/servers/${encodeURIComponent(serverId)}/players/whitelist/remove`,
        { method: 'POST', body: JSON.stringify({ player_name: playerName }) },
      );
    },

    // ---------- v3.4.0: 版本池 ----------
    listVersions(packId) {
      return request<import('@public/schema/panel-api-types').ListGameVersionsResponse>(
        `/packs/${encodeURIComponent(packId)}/versions`,
      );
    },
    fetchAvailableVersions(packId) {
      return request<import('@public/schema/panel-api-types').AvailableVersionsResponse>(
        `/packs/${encodeURIComponent(packId)}/versions/available`,
      );
    },
    downloadVersion(packId, version) {
      return request<import('@public/schema/panel-api-types').DownloadVersionResponse>(
        `/packs/${encodeURIComponent(packId)}/versions/download`,
        { method: 'POST', body: JSON.stringify(version ? { version } : {}) },
      );
    },
    getVersionDownloadProgress(packId, taskId) {
      return request<import('@public/schema/panel-api-types').VersionDownloadProgressResponse>(
        `/packs/${encodeURIComponent(packId)}/versions/download/progress?task_id=${encodeURIComponent(taskId)}`,
      );
    },
    deleteVersion(packId, versionId) {
      return request<import('@public/schema/panel-api-types').DeleteGameVersionResponse>(
        `/packs/${encodeURIComponent(packId)}/versions/${encodeURIComponent(versionId)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- v3.6.1: 磁盘占用 ----------
    /** 节点磁盘占用（df -B1 解析） */
    getNodeDiskUsage(nodeId) {
      return request<import('@public/schema/panel-api-types').NodeDiskUsageResponse>(
        `/nodes/${encodeURIComponent(nodeId)}/disk-usage`,
      );
    },
    /** 实例磁盘占用明细（du -sb 实时统计） */
    getServerDiskUsage(serverId) {
      return request<import('@public/schema/panel-api-types').ServerDiskUsageResponse>(
        `/servers/${encodeURIComponent(serverId)}/disk-usage`,
      );
    },

    // I4: Java 扫描（v4.4.0-M1，透传到 Daemon GET /api/env/javas）
    scanNodeJavas(nodeId) {
      return request<import('@public/schema/daemon-api-types').ScanJavasResult>(
        `/nodes/${encodeURIComponent(nodeId)}/javas`,
      );
    },

    // ---------- L2: Daemon 集群化管理 ----------
    getNode(nodeId) {
      return request<import('@public/schema/panel-api-types').NodeDetailResponse>(
        `/nodes/${encodeURIComponent(nodeId)}`,
      );
    },
    createNodeInvite(req) {
      return request<import('@public/schema/panel-api-types').CreateNodeInviteResponse>(
        '/nodes',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    regenerateInvite(nodeId) {
      return request<import('@public/schema/panel-api-types').CreateNodeInviteResponse>(
        `/nodes/${encodeURIComponent(nodeId)}/regenerate-invite`,
        { method: 'POST' },
      );
    },
    deleteNode(nodeId) {
      return request<import('@public/schema/panel-api-types').DeleteNodeResponse>(
        `/nodes/${encodeURIComponent(nodeId)}`,
        { method: 'DELETE' },
      );
    },
    /**
     * v4.22.9: 通过 linkKey 下载 slave-bootstrap.sh 部署脚本（由后端生成）
     * 端点 GET /api/nodes/invite/:linkKey/bootstrap-script 是公开端点（slave 机器此时尚未注册）
     * @param linkKey 邀请密钥明文
     * @returns 脚本文本（text/x-shellscript）
     */
    async downloadNodeBootstrapScript(linkKey) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${API_BASE}/nodes/invite/${encodeURIComponent(linkKey)}/bootstrap-script`,
          { method: 'GET', headers },
        );
      } catch (err) {
        if (err instanceof PanelApiError) throw err;
        if (err instanceof Error && err.name === 'AbortError') throw err;
        throw new PanelApiError(
          'NETWORK_ERROR',
          err instanceof Error ? err.message : '网络请求失败',
          0,
        );
      }
      if (res.status === 401) {
        // linkKey 过期或无效（公开端点返回 401）
        let code401 = `HTTP_${res.status}`;
        let message401 = res.statusText;
        try {
          const body = (await res.json()) as { error?: { code?: string; message?: string } };
          if (body?.error?.code) code401 = body.error.code;
          if (body?.error?.message) message401 = body.error.message;
        } catch {
          // 非 JSON 错误体
        }
        throw new PanelApiError(code401, message401, res.status);
      }
      if (!res.ok) {
        let code = `HTTP_${res.status}`;
        let message = res.statusText || `请求失败 (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { code?: string; message?: string } };
          if (body?.error?.code) code = body.error.code;
          if (body?.error?.message) message = body.error.message;
        } catch {
          // 非 JSON 错误体
        }
        throw new PanelApiError(code, message, res.status);
      }
      return await res.text();
    },

    // ---------- v3.4.0: 实例清理面板 ----------
    listCleanupInstances() {
      return request<import('@public/schema/panel-api-types').ListCleanupInstancesResponse>(
        '/admin/cleanup-instances',
      );
    },
    confirmCleanupDelete(id) {
      return request<import('@public/schema/panel-api-types').ConfirmCleanupDeleteResponse>(
        `/admin/cleanup-instances/${encodeURIComponent(id)}/confirm-delete`,
        { method: 'POST' },
      );
    },
    previewCleanupInstance(id) {
      return request<import('./modules/servers').CleanupInstancePreviewResponse>(
        `/admin/cleanup-instances/${encodeURIComponent(id)}/confirm-delete?dry_run=true`,
        { method: 'POST' },
      );
    },
    ignoreCleanup(id) {
      return request<import('@public/schema/panel-api-types').IgnoreCleanupResponse>(
        `/admin/cleanup-instances/${encodeURIComponent(id)}/ignore`,
        { method: 'POST' },
      );
    },

    // ---------- v3.6.2: 运维清理聚合页 + 子目录清理 ----------
    getMaintenanceOverview() {
      return request<import('@public/schema/panel-api-types').MaintenanceOverviewResponse>(
        '/admin/maintenance/overview',
      );
    },
    triggerCleanup(req) {
      return request<import('@public/schema/panel-api-types').CleanupResponse>(
        '/admin/maintenance/cleanup',
        { method: 'POST', body: JSON.stringify(req ?? {}) },
      );
    },
    previewCleanupAll() {
      return request<import('./modules/admin').CleanupAllPreviewResponse>(
        '/admin/maintenance/cleanup-all/preview',
        { method: 'POST' },
      );
    },
    updateRetention(req) {
      return request<import('@public/schema/panel-api-types').RetentionUpdateResponse>(
        '/admin/maintenance/retention',
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    // v4.32.2 B2.8: 数据量监控告警——返回 7 张关键表的行数/阈值/告警等级
    getDataVolume() {
      return request<import('@public/schema/panel-api-types').DataVolumeResponse>(
        '/admin/maintenance/data-volume',
      );
    },
    cleanupSubdir(serverId, subdir) {
      return request<import('@public/schema/panel-api-types').SubdirCleanupResponse>(
        `/servers/${encodeURIComponent(serverId)}/subdir/${encodeURIComponent(subdir)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- 第十一章 11.1-11.5: 系统级自助运维 ----------
    // 所有端点优雅降级：后端未实现时抛 PanelApiError，调用方 try/catch 后展示"功能暂未开放"
    getBuildInfo() {
      return request<{ buildTime: string; gitHash: string }>('/system/build-info');
    },
    checkSystemUpdate() {
      return request<{
        hasUpdate: boolean;
        latestVersion?: string;
        changelog?: string[];
      }>('/system/check-update');
    },
    performUpdate() {
      return request<{ jobId: string }>('/system/update', { method: 'POST' });
    },
    getUpdateStatus(jobId) {
      return request<{
        status: 'running' | 'done' | 'failed';
        step?: string;
        progress?: number;
      }>(`/system/update-status/${encodeURIComponent(jobId)}`);
    },
    // 11.2: 版本回退
    rollbackUpdate() {
      return request<{ jobId: string }>('/system/rollback', { method: 'POST' });
    },
    // 11.4: 系统健康状态仪表盘（字段对齐 systemMetricsService 实际返回）
    getSystemMetrics() {
      return request<{
        cpuPercent?: number;
        memUsedMb?: number;
        memTotalMb?: number;
        diskUsedGb?: number;
        diskTotalGb?: number;
        loadAvg?: [number, number, number];
        uptimeSeconds?: number;
        nodeVersion?: string;
      }>('/system/metrics');
    },
    getSystemHealth() {
      return request<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        services?: Array<{
          name: string;
          status: 'healthy' | 'degraded' | 'unhealthy';
          latencyMs?: number;
          message?: string;
        }>;
      }>('/system/health');
    },
    // 11.5: 一键诊断与修复
    runDiagnostics() {
      return request<{
        problems: Array<{
          id: string;
          title: string;
          description: string;
          severity: 'info' | 'warning' | 'error';
          fixable: boolean;
          fixSuggestion?: string;
        }>;
      }>('/system/diagnostics', { method: 'POST' });
    },
    /**
     * 流式一键诊断（SSE）——逐条即时返回结果。
     * 使用 ReadableStream 解析 SSE 事件，每收到一条即刻回调 onCheck。
     * 完成后回调 onDone；出错时回调 onError。
     */
    async runDiagnosticsStream(opts: {
      onCheck: (check: import('./modules/system').DiagnosticCheck, meta: { environment: 'production' | 'development' | null; ruleIndex: number; totalRules: number }) => void;
      onDone: (summary: { total: number; pass: number; warning: number; error: number; environment: 'production' | 'development' | null }) => void;
      onError: (message: string) => void;
      signal?: AbortSignal;
    }) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/system/diagnostics/stream`, {
        method: 'POST',
        headers,
        signal: opts.signal,
      });

      if (!res.ok) {
        throw new PanelApiError(
          `HTTP_${res.status}`,
          res.statusText || '诊断流请求失败',
          res.status,
        );
      }

      if (!res.body) {
        throw new PanelApiError('NETWORK_ERROR', '浏览器不支持流式响应', 0);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 最后一个可能是不完整的行，保留到下次
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === 'check') {
                opts.onCheck(data.check, {
                  environment: data.environment ?? null,
                  ruleIndex: data.ruleIndex ?? 0,
                  totalRules: data.totalRules ?? 0,
                });
              } else if (data.type === 'done') {
                opts.onDone({
                  total: data.total ?? 0,
                  pass: data.pass ?? 0,
                  warning: data.warning ?? 0,
                  error: data.error ?? 0,
                  environment: data.environment ?? null,
                });
              } else if (data.type === 'error') {
                opts.onError(data.message ?? '诊断流错误');
              }
            } catch {
              // JSON 解析失败，跳过此条
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
    applyFix(fixId) {
      return request<{
        fixId: string;
        success: boolean;
        message?: string;
      }>(`/system/diagnostics/fix/${encodeURIComponent(fixId)}`, { method: 'POST' });
    },

    // ---------- I1: SSL 证书管理（v4.4.0-L1） ----------
    getSslCertInfo() {
      return request<import('./modules/system').GetSslInfoResponse>('/system/ssl');
    },
    reloadNginx() {
      return request<import('./modules/system').ReloadNginxResponse>('/system/ssl/reload', {
        method: 'POST',
      });
    },
    stageCertificate(req) {
      return request<import('./modules/system').StageCertificateResponse>('/system/ssl/stage', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    deployStagedCertificate(req) {
      return request<import('./modules/system').DeployCertificateResponse>(
        '/system/ssl/deploy',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    previewSslDeploy(req) {
      return request<import('./modules/system').DeployPreviewResponse>(
        '/system/ssl/deploy/preview',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    rollbackSslCertificate() {
      return request<import('./modules/system').RollbackCertificateResponse>(
        '/system/ssl/rollback',
        { method: 'POST' },
      );
    },
    generateSelfSignedCert(req) {
      return request<import('./modules/system').GenerateSelfSignedResponse>(
        '/system/ssl/self-signed',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },

    // ---------- I2: Tunnel 管理（v4.4.0-O1） ----------
    getTunnelStatus() {
      return request<import('./modules/system').GetTunnelStatusResponse>(
        '/system/tunnel/status',
      );
    },
    getTunnelConfig() {
      return request<import('./modules/system').GetTunnelConfigResponse>(
        '/system/tunnel/config',
      );
    },
    updateTunnelConfig(config) {
      return request<import('./modules/system').UpdateTunnelConfigResponse>(
        '/system/tunnel/config',
        { method: 'PUT', body: JSON.stringify({ config }) },
      );
    },
    startTunnel() {
      return request<import('./modules/system').TunnelActionResponse>('/system/tunnel/start', {
        method: 'POST',
      });
    },
    stopTunnel() {
      return request<import('./modules/system').TunnelActionResponse>('/system/tunnel/stop', {
        method: 'POST',
      });
    },
    getTunnelLogs(limit) {
      const qs = limit !== undefined ? `?limit=${limit}` : '';
      return request<import('./modules/system').GetTunnelLogsResponse>(
        `/system/tunnel/logs${qs}`,
      );
    },

    // ----- v3.8.0: 结构化设置面板 -----
    listSettingsSchema() {
      return request<{
        settings: Array<{
          key: string;
          label: string;
          type: 'boolean' | 'number' | 'string' | 'json' | 'enum';
          group: 'site' | 'registration' | 'games' | 'vip' | 'admin' | 'backup';
          defaultValue: string;
          description: string;
          enumValues?: string[];
          min?: number;
          max?: number;
          order: number;
          sensitive?: boolean;
          currentValue: string | null;
        }>;
      }>('/settings/schema');
    },
    getSettingSchema(key) {
      return request<{
        setting: {
          key: string;
          label: string;
          type: 'boolean' | 'number' | 'string' | 'json' | 'enum';
          group: 'site' | 'registration' | 'games' | 'vip' | 'admin' | 'backup';
          defaultValue: string;
          description: string;
          enumValues?: string[];
          min?: number;
          max?: number;
          order: number;
          sensitive?: boolean;
          currentValue: string | null;
        };
      }>(`/settings/schema/${encodeURIComponent(key)}`);
    },
    updateSetting(key, value) {
      return request<{
        setting: {
          key: string;
          label: string;
          type: 'boolean' | 'number' | 'string' | 'json' | 'enum';
          group: 'site' | 'registration' | 'games' | 'vip' | 'admin' | 'backup';
          defaultValue: string;
          description: string;
          enumValues?: string[];
          min?: number;
          max?: number;
          order: number;
          sensitive?: boolean;
          currentValue: string | null;
        };
      }>(`/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
    },
    resetSetting(key) {
      return request<{
        setting: {
          key: string;
          label: string;
          type: 'boolean' | 'number' | 'string' | 'json' | 'enum';
          group: 'site' | 'registration' | 'games' | 'vip' | 'admin' | 'backup';
          defaultValue: string;
          description: string;
          enumValues?: string[];
          min?: number;
          max?: number;
          order: number;
          sensitive?: boolean;
          currentValue: string | null;
        };
      }>(`/settings/${encodeURIComponent(key)}/reset`, { method: 'POST' });
    },
    getSiteInfo() {
      return request<{
        name: string;
        announcement: string;
        logoUrl: string;
      }>('/settings/site-info');
    },
    // v3.8.0-S13: 初始化引导向导——公开接口，未登录可用
    getInitStatus() {
      return request<{ needs_init: boolean; mode?: 'demo' | 'production' }>('/init/status');
    },
    // v4.18.0: 首启动环境预检（8 项检查：db/migrations/daemon/packs/db_config/mode/disk/public_url）
    getInitPreflight() {
      return request<InitPreflightResponse>('/init/preflight');
    },
    // v4.18.0: 公开密码策略（供前端实时 zxcvbn 校验展示，与后端规则 1:1 对齐）
    getPasswordPolicy() {
      return request<PasswordPolicyResponse>('/auth/password-policy');
    },
    // v4.18.0: 扩展 submitInit——支持 admin 对象（邮箱/用户名可改）、mode、database_ack
    //   旧字段 admin_password 保留向后兼容（与 admin.password 等价，优先取 admin.password）
    // v4.20.0: 新增 database / daemon_nodes / public_base_url / skip_daemon 字段
    submitInit(req: InitRequest) {
      return request<InitSubmitResponse>('/init', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    // v4.20.0: 测试数据库连接（向导内"测试连接"按钮调用，不写入 .env）
    testDatabaseConnection(req: TestDatabaseConnectionRequest) {
      return request<TestDatabaseConnectionResponse>('/init/test-database', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    // v4.20.0: 触发 Panel 后端重启（一次性 token，提交向导后调用）
    triggerRestart(restartToken: string) {
      return request<RestartTriggerResponse>('/init/restart', {
        method: 'POST',
        body: JSON.stringify({ restart_token: restartToken }),
      });
    },
    // v4.22.0: 测试 Daemon 连接（向导内"测试连接"按钮调用，不写入 nodes 表）
    testDaemonConnection(req: TestDaemonConnectionRequest) {
      return request<TestDaemonConnectionResponse>('/init/test-daemon', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    // v4.22.1: 自动检测本机 Daemon（向导本机模式加载时自动调用，读取 daemon/.env 并探测 /health）
    autoDetectLocalDaemon() {
      return request<AutoDetectLocalDaemonResponse>('/init/auto-detect-local-daemon', {
        method: 'POST',
        body: '{}',
      });
    },
    // v4.22.0: 同步 Pack（GitHub / 自定义 URL，向导内"同步 Pack"按钮调用）
    syncPacks(req: SyncPacksRequest) {
      return request<SyncPacksResponse>('/init/packs/sync', {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    // v4.22.0: 上传 Pack zip（向导内"上传 zip"按钮调用，multipart/form-data）
    uploadPack(file: File) {
      const formData = new FormData();
      formData.append('pack', file);
      return request<UploadPackResponse>('/init/packs/upload', {
        method: 'POST',
        body: formData,
        // FormData 由 fetch 自动设置 Content-Type，不要手动设置 JSON
        headers: {},
      });
    },

    // ---------- v4.8.0-K1: 发现页（公开接口） ----------
    discoverHot(limit?: number) {
      const qs = limit !== undefined ? `?limit=${limit}` : '';
      return request<import('@public/schema/panel-api-types').DiscoverListResponse>(
        `/discover/hot${qs}`,
      );
    },
    discoverNew(limit?: number) {
      const qs = limit !== undefined ? `?limit=${limit}` : '';
      return request<import('@public/schema/panel-api-types').DiscoverListResponse>(
        `/discover/new${qs}`,
      );
    },
    discoverRecommended(limit?: number) {
      const qs = limit !== undefined ? `?limit=${limit}` : '';
      return request<import('@public/schema/panel-api-types').DiscoverListResponse>(
        `/discover/recommended${qs}`,
      );
    },
    // v4.8.0-K1: 服务器推荐位管理（server_admin）
    setServerVisibility(serverId, isPublic) {
      return request<{ success: true }>(
        `/admin/servers/${encodeURIComponent(serverId)}/visibility`,
        {
          method: 'PUT',
          body: JSON.stringify({ is_public: isPublic }),
        },
      );
    },
    setServerRecommend(serverId, isRecommended) {
      return request<{ success: true }>(
        `/admin/servers/${encodeURIComponent(serverId)}/recommend`,
        {
          method: 'PUT',
          body: JSON.stringify({ is_recommended: isRecommended }),
        },
      );
    },

    // ---------- v4.8.0-L1: 好友系统（已登录用户） ----------
    sendFriendRequest(friendUserId) {
      return request<import('@public/schema/panel-api-types').FriendActionResponse>(
        '/friends/request',
        {
          method: 'POST',
          body: JSON.stringify({ friend_user_id: friendUserId }),
        },
      );
    },
    acceptFriendRequest(friendUserId) {
      return request<import('@public/schema/panel-api-types').FriendActionResponse>(
        `/friends/${encodeURIComponent(friendUserId)}/accept`,
        { method: 'POST' },
      );
    },
    rejectFriendRequest(friendUserId) {
      return request<import('@public/schema/panel-api-types').FriendActionResponse>(
        `/friends/${encodeURIComponent(friendUserId)}/reject`,
        { method: 'POST' },
      );
    },
    listFriends() {
      return request<import('@public/schema/panel-api-types').FriendListResponse>('/friends');
    },
    listPendingFriendRequests() {
      return request<import('@public/schema/panel-api-types').PendingFriendRequestsResponse>(
        '/friends/pending',
      );
    },
    listOnlineFriends() {
      return request<import('@public/schema/panel-api-types').FriendListResponse>(
        '/friends/online',
      );
    },
    // v4.36.0-D8: 同实例已绑定玩家推荐
    listFriendRecommendations() {
      return request<import('@public/schema/panel-api-types').FriendRecommendationsResponse>(
        '/friends/recommendations',
      );
    },
    removeFriend(friendUserId) {
      return request<import('@public/schema/panel-api-types').FriendActionResponse>(
        `/friends/${encodeURIComponent(friendUserId)}`,
        { method: 'DELETE' },
      );
    },
    getFriendStatus(friendUserId) {
      return request<import('@public/schema/panel-api-types').FriendStatusResponse>(
        `/friends/${encodeURIComponent(friendUserId)}/status`,
      );
    },

    // ---------- v4.8.0-L2: 玩家档案（公开，带 token 返回更多） ----------
    getPlayerProfile(userId) {
      return request<import('@public/schema/panel-api-types').PlayerProfileResponse>(
        `/players/${encodeURIComponent(userId)}/profile`,
      );
    },

    // ---------- v4.11.0: 商业化资产（AssetApi 实现） ----------
    // 后端：panel/backend/src/api/routes/assets.ts（挂载于 /api）
    // 实例级端点 requireInstanceAdmin('instanceId')，全局资产 CRUD requireAdmin
    listMergedAssets(instanceId) {
      return request<import('./modules/asset').ListMergedAssetsResponse>(
        `/admin/instances/${encodeURIComponent(instanceId)}/assets`,
      );
    },
    overrideAsset(instanceId, globalAssetId, req) {
      return request<{ overridden: boolean }>(
        `/admin/instances/${encodeURIComponent(instanceId)}/assets/${encodeURIComponent(globalAssetId)}/override`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    createUgcAsset(instanceId, req) {
      return request<import('./modules/asset').CreateUgcAssetResponse>(
        `/admin/instances/${encodeURIComponent(instanceId)}/assets/ugc`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    listGlobalAssets() {
      return request<import('./modules/asset').ListGlobalAssetsResponse>(`/admin/assets`);
    },
    createGlobalAsset(req) {
      return request<import('./modules/asset').UpsertGlobalAssetResponse>(`/admin/assets`, {
        method: 'POST',
        body: JSON.stringify(req),
      });
    },
    updateGlobalAsset(id, req) {
      return request<import('./modules/asset').UpsertGlobalAssetResponse>(
        `/admin/assets/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    deleteGlobalAsset(id) {
      return request<import('./modules/asset').DeleteGlobalAssetResponse>(
        `/admin/assets/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    // ---------- v4.13.0: 实例店铺外观配置（ShopConfigApi 实现） ----------
    // 后端：panel/backend/src/api/routes/store_shop_config.ts（挂载于 /api）
    // GET  requireInstanceAccess（user+ 拥有实例访问权即可读）
    // PUT  requireInstanceAdmin（instance_admin+ 服主才能改）
    getInstanceShopConfig(serverId) {
      return request<import('./modules/shop-config').GetInstanceShopConfigResponse>(
        `/store/servers/${encodeURIComponent(serverId)}/shop-config`,
      );
    },
    updateInstanceShopConfig(serverId, req) {
      return request<import('./modules/shop-config').UpdateInstanceShopConfigResponse>(
        `/store/servers/${encodeURIComponent(serverId)}/shop-config`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },

    // ---------- v4.13.0: GM Workbench 后端 API（StoreGmApi 实现） ----------
    // 后端：panel/backend/src/api/routes/store-gm.ts（挂载于 /api）
    // 门控：requireRole(INSTANCE_ADMIN, SERVER_ADMIN) + 实例级权限校验
    listStorePlayers(instanceId, page = 1, limit = 20, search = '') {
      const params = new URLSearchParams({
        instance_id: instanceId,
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set('search', search);
      return request<import('./modules/store-gm').ListStorePlayersResponse>(
        `/store/players?${params.toString()}`,
      );
    },
    getStoreRevenueReport(instanceId, days = 30) {
      return request<import('./modules/store-gm').GetStoreRevenueReportResponse>(
        `/store/reports/revenue?instance_id=${encodeURIComponent(instanceId)}&days=${days}`,
      );
    },
    getStorePlaytimeReport(instanceId, days = 30) {
      return request<import('./modules/store-gm').GetStorePlaytimeReportResponse>(
        `/store/reports/playtime?instance_id=${encodeURIComponent(instanceId)}&days=${days}`,
      );
    },
    listStoreServers(all = false) {
      const query = all ? '?all=true' : '';
      return request<import('./modules/store-gm').ListStoreServersResponse>(
        `/store/servers${query}`,
      );
    },
    // ---------- v4.13.0 步骤16: GM Workbench 玩家操作 API（StorePlayerActionsApi 实现） ----------
    // 后端：panel/backend/src/api/routes/store-player-actions.ts（挂载于 /api）
    // 门控：requireRole(INSTANCE_ADMIN, SERVER_ADMIN) + authorizeInstanceAccess
    compensatePlayer(userId, req) {
      return request<import('./modules/store-player-actions').CompensatePlayerResponse>(
        `/store/players/${encodeURIComponent(userId)}/compensate`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    banStorePlayer(userId, req) {
      return request<import('./modules/store-player-actions').BanPlayerResponse>(
        `/store/players/${encodeURIComponent(userId)}/ban`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    adjustPlayerPlaytime(userId, req) {
      return request<import('./modules/store-player-actions').AdjustPlaytimeResponse>(
        `/store/players/${encodeURIComponent(userId)}/adjust-playtime`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    // ---------- v3-billing: VPS 式预付费实例计费 API（InstanceBillingApi 实现） ----------
    // 后端：panel/backend/src/api/routes/instance-billing.ts（挂载于 /api/admin/instance-billing）
    // 门控：types 写操作仅 server_admin；settings/renew/renewals 按实例归属校验
    listInstanceTypePricings() {
      return request<import('./modules/instance-billing').ListInstanceTypePricingsResponse>(
        '/admin/instance-billing/types',
      );
    },
    upsertInstanceTypePricing(req) {
      return request<import('./modules/instance-billing').UpsertInstanceTypePricingResponse>(
        '/admin/instance-billing/types',
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    async archiveInstanceTypePricing(instanceType) {
      await request<void>(
        `/admin/instance-billing/types/${encodeURIComponent(instanceType)}`,
        { method: 'DELETE' },
      );
    },
    previewBillingAmount(instanceType, billingCycleMonths, customMonthlyPrice) {
      const params = new URLSearchParams({
        instance_type: instanceType,
        billing_cycle_months: String(billingCycleMonths),
      });
      if (customMonthlyPrice !== undefined && customMonthlyPrice !== null) {
        params.set('custom_monthly_price', String(customMonthlyPrice));
      }
      return request<import('./modules/instance-billing').PreviewBillingAmountResponse>(
        `/admin/instance-billing/preview?${params.toString()}`,
      );
    },
    getInstanceBillingSettings(instanceId) {
      return request<import('./modules/instance-billing').GetInstanceBillingSettingsResponse>(
        `/admin/instance-billing/settings/${encodeURIComponent(instanceId)}`,
      );
    },
    updateInstanceBillingSettings(instanceId, req) {
      return request<import('./modules/instance-billing').UpdateInstanceBillingSettingsResponse>(
        `/admin/instance-billing/settings/${encodeURIComponent(instanceId)}`,
        { method: 'PUT', body: JSON.stringify(req) },
      );
    },
    renewInstance(instanceId, req) {
      return request<import('./modules/instance-billing').RenewInstanceResponse>(
        `/admin/instance-billing/renew/${encodeURIComponent(instanceId)}`,
        { method: 'POST', body: JSON.stringify(req) },
      );
    },
    listInstanceRenewals(instanceId, limit) {
      const query = limit ? `?limit=${limit}` : '';
      return request<import('./modules/instance-billing').ListInstanceRenewalsResponse>(
        `/admin/instance-billing/${encodeURIComponent(instanceId)}/renewals${query}`,
      );
    },
  };
}
