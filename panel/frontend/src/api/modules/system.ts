// ============================================================================
// System API 领域切片 — 系统级自助运维（版本/更新/健康/诊断）
// 第十一章 11.1-11.5：前端可视化版本更新、版本回退、系统健康仪表盘、一键诊断
// PanelApiClient 通过 extends 组合各领域接口切片
// 所有端点采用优雅降级：后端未实现时（404/错误）前端展示"功能暂未开放"
// ============================================================================

/** GET /api/system/build-info 响应体 — 系统构建信息 */
export interface BuildInfo {
  /** 构建时间（ISO 字符串或可读字符串） */
  buildTime: string;
  /** Git commit hash */
  gitHash: string;
}

/** GET /api/system/check-update 响应体 — 系统级更新检查结果 */
export interface SystemUpdateInfo {
  /** 是否存在可用更新 */
  hasUpdate: boolean;
  /** 最新版本号 */
  latestVersion?: string;
  /** 更新日志条目列表 */
  changelog?: string[];
}

/** POST /api/system/update 响应体 — 触发系统更新后返回的任务 ID */
export interface PerformUpdateResponse {
  /** 更新任务 ID，用于轮询进度 */
  jobId: string;
}

/** GET /api/system/update-status/:jobId 响应体 — 更新任务进度 */
export interface UpdateStatus {
  /** 任务状态：运行中 / 完成 / 失败 */
  status: 'running' | 'done' | 'failed';
  /** 当前步骤描述 */
  step?: string;
  /** 进度百分比 0-100 */
  progress?: number;
}

/** GET /api/system/metrics 响应体 — 系统资源指标
 *  字段对齐 modules/模块1_系统监控/systemMetricsService.getSystemMetrics() 实际返回结构。
 *  内存/磁盘使用率需前端自行用 memUsedMb/memTotalMb、diskUsedGb/diskTotalGb 换算。 */
export interface SystemMetrics {
  /** CPU 使用率 0-100 */
  cpuPercent?: number;
  /** 内存已用（MB） */
  memUsedMb?: number;
  /** 内存总量（MB） */
  memTotalMb?: number;
  /** 磁盘已用（GB） */
  diskUsedGb?: number;
  /** 磁盘总量（GB） */
  diskTotalGb?: number;
  /** 系统负载平均值（1/5/15 分钟） */
  loadAvg?: [number, number, number];
  /** 系统运行时长（秒） */
  uptimeSeconds?: number;
  /** Node 版本 */
  nodeVersion?: string;
}

/** 单个服务健康状态（对齐 modules/模块1_系统监控 ServiceHealth） */
export interface ServiceHealth {
  /** 服务名称（panel-backend / panel-database / panel-daemon） */
  name: string;
  /** 服务状态 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 响应延迟（毫秒） */
  latencyMs?: number;
  /** 附加信息 */
  message?: string;
}

/** GET /api/system/health 响应体 — 系统整体健康状态 */
export interface SystemHealth {
  /** 整体状态 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 各服务健康明细 */
  services?: ServiceHealth[];
}

/** 单个诊断问题 */
export interface DiagnosticProblem {
  /** 问题 ID（用于触发修复） */
  id: string;
  /** 问题标题 */
  title: string;
  /** 问题描述 */
  description: string;
  /** 严重程度：info / warning / error */
  severity: 'info' | 'warning' | 'error';
  /** 是否可自动修复 */
  fixable: boolean;
  /** 修复建议 */
  fixSuggestion?: string;
}

/** 单个诊断检查项（含通过和未通过） */
export interface DiagnosticCheck {
  /** 检查项 ID */
  id: string;
  /** 检查项标题 */
  title: string;
  /** 检查分类 */
  category: string;
  /** 状态：通过 / 警告 / 错误 */
  status: 'pass' | 'warning' | 'error';
  /** 严重程度 */
  severity: 'critical' | 'warning' | 'info';
  /** 详细消息 */
  message: string;
  /** 是否可自动修复 */
  fixable: boolean;
  /** 修复 ID */
  fixId: string | null;
  /** 描述 */
  description?: string;
}

/** POST /api/system/diagnostics 响应体 — 诊断结果 */
export interface DiagnosticsResult {
  /** 发现的问题列表（向后兼容） */
  problems: DiagnosticProblem[];
  /** 全量检查结果（新增） */
  checks?: DiagnosticCheck[];
  /** v3.8.0-D4: 运行环境标记——production / development */
  environment?: 'production' | 'development';
}

/** POST /api/system/diagnostics/fix/:fixId 响应体 — 修复结果 */
export interface ApplyFixResponse {
  /** 修复项 ID */
  fixId: string;
  /** 是否修复成功 */
  success: boolean;
  /** 附加消息 */
  message?: string;
}

// ============================================================================
// v4.4.0-L1: SSL 证书管理（I1）
// ============================================================================

/** 当前 nginx 使用的证书信息（对齐后端 CertificateInfo） */
export interface CertificateInfo {
  cert_path: string;
  key_path: string;
  available: boolean;
  subject_cn: string | null;
  issuer_cn: string | null;
  san_domains: string[];
  valid_from: string | null;
  valid_to: string | null;
  days_remaining: number | null;
  fingerprint: string | null;
  self_signed: boolean;
}

/** GET /api/system/ssl 响应 */
export interface GetSslInfoResponse {
  certificate: CertificateInfo;
}

/** POST /api/system/ssl/stage 请求 */
export interface StageCertificateRequest {
  pem_content: string;
  key_content: string;
}

/** POST /api/system/ssl/stage 响应 */
export interface StageCertificateResponse {
  cert_path: string;
  key_path: string;
  message: string;
}

/** POST /api/system/ssl/deploy 请求 */
export interface DeployCertificateRequest {
  cert_path: string;
  key_path: string;
}

/** POST /api/system/ssl/deploy 响应 */
export interface DeployCertificateResponse {
  success: boolean;
  message: string;
}

/** POST /api/system/ssl/deploy/preview 请求 */
export interface DeployPreviewRequest {
  /** PEM 格式证书内容（fullchain），用于计算新指纹（不实际部署） */
  pem_content: string;
}

/** POST /api/system/ssl/deploy/preview 响应 */
export interface DeployPreviewResponse {
  /** 当前证书指纹 SHA-256（无证书时为 null） */
  current_fingerprint: string | null;
  /** 新证书指纹 SHA-256（解析失败时为 null） */
  new_fingerprint: string | null;
  /** nginx 配置语法是否通过（nginx -t） */
  nginx_config_valid: boolean;
  /** 错误信息（PEM 解析错误 / nginx -t 错误），无错误为 null */
  errors: string | null;
}

/** POST /api/system/ssl/rollback 响应 */
export interface RollbackCertificateResponse {
  success: boolean;
  /** 回滚到的备份文件名 */
  rolled_back_to: string | null;
  /** 回滚后证书指纹 SHA-256 */
  fingerprint: string | null;
  message: string;
}

/** POST /api/system/ssl/reload 响应 */
export interface ReloadNginxResponse {
  success: boolean;
  message: string;
}

/** POST /api/system/ssl/self-signed 请求 */
export interface GenerateSelfSignedRequest {
  common_name: string;
  san_domains: string[];
  days?: number;
  organization?: string;
}

/** POST /api/system/ssl/self-signed 响应 */
export interface GenerateSelfSignedResponse {
  cert_path: string;
  key_path: string;
  message: string;
}

// ============================================================================
// v4.4.0-O1: Tunnel 管理（I2）
// ============================================================================

/** 隧道类型 */
export type TunnelType = 'tcp' | 'udp' | 'http' | 'https';

/** 单个隧道映射配置 */
export interface TunnelMapping {
  name: string;
  type: TunnelType;
  local_ip: string;
  local_port: number;
  remote_port?: number;
  custom_domains?: string[];
}

/** 隧道服务完整配置 */
export interface TunnelConfig {
  server_addr: string;
  server_port: number;
  token?: string;
  tunnels: TunnelMapping[];
  enabled: boolean;
}

/** 隧道日志条目 */
export interface TunnelLogEntry {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}

/** 隧道运行状态 */
export interface TunnelStatus {
  running: boolean;
  pid: number | null;
  enabled: boolean;
  server_addr: string;
  tunnel_count: number;
  started_at: string | null;
  stopped_at: string | null;
}

/** GET /api/system/tunnel/status 响应 */
export interface GetTunnelStatusResponse {
  status: TunnelStatus;
}

/** GET /api/system/tunnel/config 响应 */
export interface GetTunnelConfigResponse {
  config: TunnelConfig;
}

/** PUT /api/system/tunnel/config 响应 */
export interface UpdateTunnelConfigResponse {
  message: string;
}

/** POST /api/system/tunnel/start | /stop 响应 */
export interface TunnelActionResponse {
  success: boolean;
  message: string;
}

/** GET /api/system/tunnel/logs 响应 */
export interface GetTunnelLogsResponse {
  logs: TunnelLogEntry[];
}

export interface SystemApi {
  // ----- 11.1 前端可视化版本更新 -----
  /** 系统构建信息（构建时间 + git hash），后端未实现时抛 PanelApiError */
  getBuildInfo(): Promise<BuildInfo>;
  /**
   * 检查系统级更新（与游戏服务器更新 checkUpdate(serverId) 区分）。
   * 注意：命名为 checkSystemUpdate 以避免与 ServersApi.checkUpdate 冲突。
   */
  checkSystemUpdate(): Promise<SystemUpdateInfo>;
  /** 触发系统更新，返回任务 ID 用于轮询进度 */
  performUpdate(): Promise<PerformUpdateResponse>;
  /** 查询更新任务进度 */
  getUpdateStatus(jobId: string): Promise<UpdateStatus>;

  // ----- 11.2 版本回退 -----
  /** 回退到上一版本，返回任务 ID */
  rollbackUpdate(): Promise<PerformUpdateResponse>;

  // ----- 11.4 系统健康状态仪表盘 -----
  /** 系统资源指标（CPU/内存/磁盘） */
  getSystemMetrics(): Promise<SystemMetrics>;
  /** 系统健康状态（后端/数据库/Daemon） */
  getSystemHealth(): Promise<SystemHealth>;

  // ----- 11.5 一键诊断与修复 -----
  /** 执行一键诊断，返回问题列表 */
  runDiagnostics(): Promise<DiagnosticsResult>;
  /** 流式一键诊断（SSE），逐条即时返回结果 */
  runDiagnosticsStream(opts: {
    onCheck: (check: DiagnosticCheck, meta: { environment: 'production' | 'development' | null; ruleIndex: number; totalRules: number }) => void;
    onDone: (summary: { total: number; pass: number; warning: number; error: number; environment: 'production' | 'development' | null }) => void;
    onError: (message: string) => void;
    signal?: AbortSignal;
  }): Promise<void>;
  /** 应用单个修复 */
  applyFix(fixId: string): Promise<ApplyFixResponse>;

  // ----- I1: SSL 证书管理（v4.4.0-L1） -----
  /** 获取当前 nginx 使用的证书信息 */
  getSslCertInfo(): Promise<GetSslInfoResponse>;
  /** 触发 nginx 热重载（不替换证书文件） */
  reloadNginx(): Promise<ReloadNginxResponse>;
  /** 暂存上传的证书文件（不部署） */
  stageCertificate(req: StageCertificateRequest): Promise<StageCertificateResponse>;
  /** 部署暂存证书到 nginx 路径并热重载 */
  deployStagedCertificate(req: DeployCertificateRequest): Promise<DeployCertificateResponse>;
  /** SSL 部署预览：返回当前/新证书指纹 + nginx -t 校验结果，不实际部署 */
  previewSslDeploy(req: DeployPreviewRequest): Promise<DeployPreviewResponse>;
  /** SSL 回滚：回滚到上一份证书备份 + nginx 热重载 */
  rollbackSslCertificate(): Promise<RollbackCertificateResponse>;
  /** 生成自签证书（仅写入暂存目录，需再调用 deploy 才生效） */
  generateSelfSignedCert(req: GenerateSelfSignedRequest): Promise<GenerateSelfSignedResponse>;

  // ----- I2: Tunnel 管理（v4.4.0-O1） -----
  /** 查询 frpc 隧道运行状态 */
  getTunnelStatus(): Promise<GetTunnelStatusResponse>;
  /** 获取当前隧道配置 */
  getTunnelConfig(): Promise<GetTunnelConfigResponse>;
  /** 更新隧道配置（不自动重启，需手动调用 start/stop） */
  updateTunnelConfig(config: TunnelConfig): Promise<UpdateTunnelConfigResponse>;
  /** 启动 frpc 隧道 */
  startTunnel(): Promise<TunnelActionResponse>;
  /** 停止 frpc 隧道 */
  stopTunnel(): Promise<TunnelActionResponse>;
  /** 获取最近日志 */
  getTunnelLogs(limit?: number): Promise<GetTunnelLogsResponse>;
}
