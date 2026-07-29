// ============================================================================
// Panel ↔ Daemon REST API 类型契约
// 依据：spec §3.7.1
// 鉴权：Bearer Token（除 /health 外）
// ============================================================================

// 实例状态机：stopped → starting → running → stopping → stopped
// error 为终态，任意状态可转入，需人工干预恢复
export type InstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

// 实例摘要（Daemon 视角）
export interface InstanceSummary {
  id: string;
  name: string;
  pack_id: string;
  status: InstanceState;
  port: number;
  rcon_port: number;
}

// ----- GET /health（无需 token） -----
export interface HealthResponse {
  status: 'ok';
  uptime: number;
  version: string;
}

// ----- GET /api/instances -----
export interface ListInstancesResponse {
  instances: InstanceSummary[];
}

// ----- GET /api/instances/:id/state -----
export interface InstanceStateResponse {
  id: string;
  status: InstanceState;
  started_at: string | null;
  pid: number | null;
}

// ----- POST /api/instances/:id/start -----
export interface StartInstanceResponse {
  id: string;
  status: 'starting';
  pid: number;
}

// ----- POST /api/instances/:id/stop -----
export interface StopInstanceResponse {
  id: string;
  status: 'stopping';
}

// ----- POST /api/instances/:id/command -----
export interface CommandRequest {
  command: string;
}

export interface CommandResponse {
  id: string;
  output: string | null;
  success: boolean;
}

// ----- POST /api/instances/:id/exec（在实例 workdir 下执行任意二进制命令） -----
// 用途：factorio --create 生成地图、版本查询命令、安装命令等离线命令
// 安全：binary 必须在 Pack 声明范围内，cwd 必须在 instance.workdir 内
export interface ExecCommandRequest {
  /** 可执行二进制路径（绝对路径或相对 cwd 的路径） */
  binary: string;
  /** 命令行参数 */
  args: string[];
  /** 工作目录（绝对路径，必须在 instance.workdir 内）；不填默认 instance.workdir */
  cwd?: string;
  /** 环境变量（合并到 process.env） */
  env?: Record<string, string>;
  /** 超时毫秒，默认 60000（60s） */
  timeout?: number;
}

export interface ExecCommandResponse {
  /** 进程退出码（null 表示被信号杀死） */
  exit_code: number | null;
  /** 标准输出（UTF-8） */
  stdout: string;
  /** 标准错误（UTF-8） */
  stderr: string;
  /** 执行耗时毫秒 */
  duration_ms: number;
  /** 是否超时被强杀 */
  timed_out: boolean;
}

// ----- GET /api/instances/:id/files?path=<relPath>（读取实例 workdir 下的文件） -----
export interface FileReadResponse {
  /** 相对 workdir 的路径 */
  path: string;
  /** 文件内容（UTF-8 文本；二进制文件请使用 base64 编码后写入） */
  content: string;
  /** 文件字节数 */
  size: number;
  /** 最后修改时间 ISO */
  modified_at: string;
}

// ----- PUT /api/instances/:id/files?path=<relPath>（写入实例 workdir 下的文件） -----
export interface FileWriteRequest {
  /** 文件内容 */
  content: string;
  /** 编码：utf-8（默认）或 base64（用于二进制文件） */
  encoding?: 'utf-8' | 'base64';
}

export interface FileWriteResponse {
  /** 相对 workdir 的路径 */
  path: string;
  /** 写入后文件字节数 */
  size: number;
  /** 最后修改时间 ISO */
  modified_at: string;
}

// ----- 错误码与异常契约 -----
export const DaemonErrorCode = {
  UNAUTHORIZED: 'DAEMON_UNAUTHORIZED',
  FORBIDDEN: 'DAEMON_FORBIDDEN',
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  INSTANCE_ALREADY_RUNNING: 'INSTANCE_ALREADY_RUNNING',
  INSTANCE_NOT_RUNNING: 'INSTANCE_NOT_RUNNING',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  COMMAND_FAILED: 'COMMAND_FAILED',
  INTERNAL_ERROR: 'DAEMON_INTERNAL_ERROR',
  // 文件操作错误码（Task 3.5 新增）
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_PATH_INVALID: 'FILE_PATH_INVALID',
  // 命令执行错误码（Task 3.5 新增）
  EXEC_COMMAND_FAILED: 'EXEC_COMMAND_FAILED',
  EXEC_TIMEOUT: 'EXEC_TIMEOUT',
  // v4.3.0: mod 文件状态错误（.jar ↔ .jar.disabled 切换时文件名不合法）
  MOD_FILE_STATE_INVALID: 'MOD_FILE_STATE_INVALID',
} as const;

export type DaemonErrorCodeType = typeof DaemonErrorCode[keyof typeof DaemonErrorCode];

export interface DaemonErrorResponse {
  error: {
    code: DaemonErrorCodeType;
    message: string;
  };
}

// ============================================================================
// v4.4.0-M1: Java 环境扫描（Daemon → Panel）
//
// 端点：GET /api/env/javas（鉴权：Bearer Token）
// 用途：Panel 在创建 Minecraft 实例前查询可用 Java 版本，匹配实例兼容性
// ============================================================================

/** Java 安装信息（单个 JRE / JDK） */
export interface JavaInstallation {
  /** java 可执行文件绝对路径 */
  path: string;
  /** JAVA_HOME 路径（如可推断） */
  java_home: string | null;
  /** 主版本号（如 8 / 11 / 17 / 21） */
  version: number;
  /** 完整版本字符串（如 "17.0.2"） */
  version_string: string;
  /** 供应商（如 "Oracle Corporation" / "Eclipse Adoptium" / "Azul Systems, Inc."） */
  vendor: string;
  /** 是否为 JDK（含 javac）；false = JRE */
  is_jdk: boolean;
  /** 探测到的位置来源（如 "JAVA_HOME" / "PATH" / "/usr/lib/jvm/java-17-openjdk-amd64"） */
  source: string;
}

/** GET /api/env/javas 响应 */
export interface ScanJavasResult {
  /** 扫描到的所有 Java 安装（按版本号降序排序） */
  installations: JavaInstallation[];
  /** 扫描耗时（ms） */
  elapsed_ms: number;
  /** 扫描的路径数量 */
  scanned_paths: number;
  /** 扫描失败次数（被忽略的路径） */
  failed_paths: number;
}

// ============================================================================
// L4 新增 → L2 提升到 public/：jar 元数据扫描（Daemon → Panel）
//
// 端点：GET /api/instances/:id/mods/scan（鉴权：Bearer Token）
// 用途：识别客户端 mod（environment === 'client' 或命中黑名单），
//       避免误装到服务端导致启动失败。
// ============================================================================

/** Mod 加载器类型 */
export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'unknown';

/** Mod 运行环境 */
export type ModEnvironment = 'client' | 'server' | 'both';

/** 扫描得到的 Mod 元数据（与 daemon 端 ModMetadata 结构对齐） */
export interface ModMetadata {
  /** Mod 显示名称 */
  name: string;
  /** Mod 版本 */
  version: string;
  /** 加载器：fabric / forge / neoforge / unknown */
  loader: ModLoader;
  /** 运行环境：client（仅客户端）/ server（仅服务端）/ both（双端） */
  environment: ModEnvironment;
  /** 是否为客户端 mod（environment === 'client' 或命中黑名单） */
  isClientSide: boolean;
  /** jar 源文件名 */
  sourceFile: string;
}

/** GET /api/instances/:id/mods/scan 响应体 */
export interface ScanModsResponse {
  mods: ModMetadata[];
}
