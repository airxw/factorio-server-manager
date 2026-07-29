// ============================================================================
// Panel REST API 接口存根（零实现，仅声明签名）
// 依据：spec §3.7.2
// 实现方：panel/backend/src/api/
// 调用方：panel/frontend/
// ============================================================================

import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  ListPacksResponse,
  ListServersResponse,
  CreateServerRequest,
  CreateServerResponse,
  ServerDetailResponse,
  DeleteServerResponse,
  ServerStartResponse,
  ServerStopResponse,
  ServerCommandRequest,
  ServerCommandResponse,
  ApplyUpdateRequest,
  ApplyUpdateResponse,
  CheckUpdateResponse,
  InitStatusResponse,
  InitPreflightResponse,
  PasswordPolicyResponse,
  InitRequest,
  InitSubmitResponse,
} from '@public/schema/panel-api-types';

export interface IPanelRestApi {
  // ----- 鉴权 -----
  // POST /api/auth/login
  login(req: LoginRequest): Promise<LoginResponse>;

  // GET /api/auth/me（需 JWT）
  getMe(token: string): Promise<MeResponse>;

  // v4.18.0: GET /api/auth/password-policy（公开接口，供前端实时密码校验）
  getPasswordPolicy(): Promise<PasswordPolicyResponse>;

  // ----- Pack -----
  // GET /api/packs（需 JWT）
  listPacks(token: string): Promise<ListPacksResponse>;

  // ----- Server CRUD -----
  // GET /api/servers（需 JWT）
  listServers(token: string): Promise<ListServersResponse>;

  // POST /api/servers（需 JWT）
  createServer(token: string, req: CreateServerRequest): Promise<CreateServerResponse>;

  // GET /api/servers/:id（需 JWT）
  getServer(token: string, id: string): Promise<ServerDetailResponse>;

  // DELETE /api/servers/:id（需 JWT，仅 stopped 可删）
  deleteServer(token: string, id: string): Promise<DeleteServerResponse>;

  // ----- Server 生命周期（转发 Daemon） -----
  // POST /api/servers/:id/start
  startServer(token: string, id: string): Promise<ServerStartResponse>;

  // POST /api/servers/:id/stop
  stopServer(token: string, id: string): Promise<ServerStopResponse>;

  // POST /api/servers/:id/command
  sendServerCommand(token: string, id: string, req: ServerCommandRequest): Promise<ServerCommandResponse>;

  // ----- Game Update (v3.5.0) -----
  // GET /api/servers/:id/update/check
  checkUpdate(token: string, id: string): Promise<CheckUpdateResponse>;

  // POST /api/servers/:id/update/apply（version_id 或 download_path）
  applyUpdate(token: string, id: string, req: ApplyUpdateRequest): Promise<ApplyUpdateResponse>;

  // ----- v4.18.0: 初始化向导（公开接口，未登录可用） -----
  // GET /api/init/status — 查询首启动状态
  getInitStatus(): Promise<InitStatusResponse>;

  // GET /api/init/preflight — 服务器环境预检（8 项检查）
  getInitPreflight(): Promise<InitPreflightResponse>;

  // POST /api/init — 一次性提交向导数据
  submitInit(req: InitRequest): Promise<InitSubmitResponse>;
}
