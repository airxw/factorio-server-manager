// ============================================================================
// 模块6_Panel通信客户端 — Daemon HTTP 客户端
// 用全局 fetch（Node 18+）+ Authorization: Bearer token
// 方法签名对齐 public/interface_stub/daemon-rest.ts 的 IDaemonRestApi
// 注：startInstance 扩展了 body 参数（spec §3.7.1，Daemon 期望接收 pack 内联）
// ============================================================================

import type {
  HealthResponse,
  ListInstancesResponse,
  InstanceStateResponse,
  StartInstanceResponse,
  StopInstanceResponse,
  CommandResponse,
  DaemonErrorResponse,
  DaemonErrorCodeType,
  ExecCommandRequest,
  ExecCommandResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  ScanJavasResult,
  ScanModsResponse,
} from '@public/schema/daemon-api-types';
import type { CommandRequest } from '@public/schema/daemon-api-types';
// P6 新增：日志文件管理 + 在线玩家查询（Panel 转发 Daemon）
// v4.3.0 新增：文件列表 + mod 切换
import type {
  ListLogFilesResponse,
  ReadLogFileResponse,
  ListOnlinePlayersResponse,
  ListFilesResponse,
  ToggleModFileResponse,
} from '@public/schema/panel-api-types';
import type { DaemonClientConfig, StartInstanceBody } from './types.js';
import { DaemonApiError } from './types.js';

// L4 → L2：ModMetadata / ModLoader / ModEnvironment / ScanModsResponse 已提升到
// public/schema/daemon-api-types.ts，此处重新导出保持向后兼容（modService / 路由层
// 原本从本模块 import 这些类型）。
export type { ModMetadata, ModLoader, ModEnvironment, ScanModsResponse } from '@public/schema/daemon-api-types';

/**
 * Daemon REST API 客户端
 *
 * 实现公共契约 public/interface_stub/daemon-rest.ts 的 IDaemonRestApi。
 * 所有请求附带 `Authorization: Bearer <token>` 头；非 2xx 响应解析为 DaemonApiError。
 */
export class DaemonHttpClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: DaemonClientConfig) {
    // 去掉末尾斜杠，避免拼接出双斜杠
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
  }

  /**
   * GET /health（无需 token）
   */
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health', undefined, false);
  }

  /**
   * GET /api/instances
   */
  async listInstances(): Promise<ListInstancesResponse> {
    return this.request<ListInstancesResponse>('GET', '/api/instances');
  }

  /**
   * GET /api/instances/:id/state
   */
  async getInstanceState(id: string): Promise<InstanceStateResponse> {
    return this.request<InstanceStateResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/state`,
    );
  }

  /**
   * POST /api/instances/:id/start
   * @param id 实例 ID
   * @param body pack + instance（spec §3.7.1，Daemon 期望接收 pack 内联）
   */
  async startInstance(id: string, body: StartInstanceBody): Promise<StartInstanceResponse> {
    return this.request<StartInstanceResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/start`,
      body,
    );
  }

  /**
   * POST /api/instances/:id/stop
   */
  async stopInstance(id: string): Promise<StopInstanceResponse> {
    return this.request<StopInstanceResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/stop`,
    );
  }

  /**
   * POST /api/instances/:id/restart-with-save — 带存档重启。
   * 停止当前实例 → 以指定 save_path 重新启动，用于实际切换服务器使用的存档。
   * @param id 实例 ID
   * @param savePath 新的存档路径，覆盖启动参数模板中的 {{save_path}}
   */
  async restartWithSave(id: string, savePath: string): Promise<StartInstanceResponse> {
    return this.request<StartInstanceResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/restart-with-save`,
      { save_path: savePath },
    );
  }

  /**
   * POST /api/instances/:id/command
   */
  async sendCommand(id: string, command: CommandRequest): Promise<CommandResponse> {
    return this.request<CommandResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/command`,
      command,
    );
  }

  /**
   * POST /api/instances/:id/execute-logic — v4.11.0 卡密/商城发货沙箱入口。
   *
   * 将原始 logicString（含 {Var} 单花括号占位符）与 variables 映射转发给 daemon，
   * 由 daemon 侧 ExecutionEngine 沙箱完成变量替换 + 正则白名单校验后投递。
   * 适用于 UGC 自定义资产发货——logicString 不在 Panel 侧渲染，直接交 daemon 沙箱。
   *
   * @param id 实例 ID
   * @param logicString 含 {Var} 占位符的原始指令模板
   * @param variables 变量名 → 变量值映射
   * @returns { id, success } 投递成功返回 success=true
   */
  async executeLogic(
    id: string,
    logicString: string,
    variables: Record<string, string>,
  ): Promise<{ id: string; success: boolean }> {
    return this.request<{ id: string; success: boolean }>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/execute-logic`,
      { logic_string: logicString, variables },
    );
  }

  /**
   * POST /api/instances/:id/exec — 在实例 workdir 下执行任意二进制命令（Task 3.5 新增）。
   * 用途：factorio --create 生成地图、版本查询、安装命令等离线命令。
   */
  async execCommand(id: string, body: ExecCommandRequest): Promise<ExecCommandResponse> {
    return this.request<ExecCommandResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/exec`,
      body,
    );
  }

  /**
   * GET /api/instances/:id/files?path=<relPath> — 读取实例 workdir 下的文件（Task 3.5 新增）。
   */
  async readFile(id: string, relPath: string): Promise<FileReadResponse> {
    const query = `?path=${encodeURIComponent(relPath)}`;
    return this.request<FileReadResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/files${query}`,
    );
  }

  /**
   * PUT /api/instances/:id/files?path=<relPath> — 写入实例 workdir 下的文件（Task 3.5 新增）。
   */
  async writeFile(
    id: string,
    relPath: string,
    body: FileWriteRequest,
  ): Promise<FileWriteResponse> {
    const query = `?path=${encodeURIComponent(relPath)}`;
    return this.request<FileWriteResponse>(
      'PUT',
      `/api/instances/${encodeURIComponent(id)}/files${query}`,
      body,
    );
  }

  /**
   * v4.3.0-F1 新增：列出实例 workdir 下指定目录的内容。
   */
  async listFiles(id: string, relPath: string, recursive = false): Promise<ListFilesResponse> {
    const query = `?path=${encodeURIComponent(relPath)}${recursive ? '&recursive=1' : ''}`;
    return this.request<ListFilesResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/files/list${query}`,
    );
  }

  /**
   * v4.3.0-H1 新增：切换 mod 启用状态（.jar ↔ .jar.disabled）。
   */
  async toggleModFile(id: string, modName: string, opts?: { modsDir?: string }): Promise<ToggleModFileResponse> {
    const query = opts?.modsDir ? `?dir=${encodeURIComponent(opts.modsDir)}` : '';
    return this.request<ToggleModFileResponse>(
      'POST',
      `/api/instances/${encodeURIComponent(id)}/mods/files/${encodeURIComponent(modName)}/toggle${query}`,
    );
  }

  // ----------------------------------------------------------------------
  // P6 新增：日志文件管理 + 在线玩家查询（Panel 转发 Daemon）
  // ----------------------------------------------------------------------

  /**
   * GET /api/instances/:id/logs?limit=N — 读取实例控制台历史日志行（环形缓冲）。
   *
   * Daemon 端由 InstanceManager.logWriters 维护内存环形缓冲，实例未启动过时返回空数组。
   * 用于 RconConsole 挂载时预填历史日志，避免用户离开后返回时丢失之前的输出。
   *
   * @returns 原始日志行字符串数组（不含时间戳/流信息，由前端包装）
   */
  async getInstanceLogs(id: string, limit: number = 500): Promise<string[]> {
    const query = limit > 0 ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.request<string[]>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/logs${query}`,
    );
  }

  /**
   * GET /api/instances/:id/log-files — 列出实例所有日志文件（按修改时间倒序）。
   */
  async listLogFiles(id: string): Promise<ListLogFilesResponse> {
    return this.request<ListLogFilesResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/log-files`,
    );
  }

  /**
   * GET /api/instances/:id/log-files/:filename?count=N — 读取指定日志文件的最后 N 行。
   * count 留空时由 Daemon 决定默认行数。
   */
  async readLogFile(
    id: string,
    filename: string,
    count?: number,
  ): Promise<ReadLogFileResponse> {
    const query =
      count !== undefined && count > 0
        ? `?count=${encodeURIComponent(String(count))}`
        : '';
    return this.request<ReadLogFileResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/log-files/${encodeURIComponent(filename)}${query}`,
    );
  }

  /**
   * DELETE /api/instances/:id/log-files/:filename — 删除指定的日志备份文件。
   */
  async deleteLogFile(id: string, filename: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/api/instances/${encodeURIComponent(id)}/log-files/${encodeURIComponent(filename)}`,
    );
  }

  /**
   * GET /api/instances/:id/players — 获取实例在线玩家列表（PlayerTracker 维护）。
   */
  async getOnlinePlayers(id: string): Promise<ListOnlinePlayersResponse> {
    return this.request<ListOnlinePlayersResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/players`,
    );
  }

  // ----------------------------------------------------------------------
  // v4.4.0-M1 新增：Java 环境扫描（转发 Daemon /api/env/javas）
  // ----------------------------------------------------------------------

  /**
   * GET /api/env/javas — 扫描 Daemon 节点上可用的 Java 安装。
   *
   * 用于 Panel 在创建 Minecraft 实例前查询可用 Java 版本，匹配实例兼容性。
   * 扫描在 Daemon 端完成，结果不缓存（每次调用都重新扫描）。
   */
  async scanJavas(): Promise<ScanJavasResult> {
    return this.request<ScanJavasResult>('GET', '/api/env/javas');
  }

  // ----------------------------------------------------------------------
  // L4 新增：jar 元数据扫描（转发 Daemon GET /api/instances/:id/mods/scan）
  // ----------------------------------------------------------------------

  /**
   * GET /api/instances/:id/mods/scan — 扫描实例 mods 目录所有 jar 的元数据。
   *
   * 用于识别客户端 mod（environment === 'client' 或命中黑名单），
   * 避免误装到服务端导致启动失败。
   *
   * @param id 实例 ID
   * @returns 扫描结果（含每个 jar 的 name/version/loader/environment/isClientSide）
   */
  async scanMods(id: string, opts?: { modsDir?: string; fileExtensions?: string[]; gameType?: string }): Promise<ScanModsResponse> {
    const params = new URLSearchParams();
    if (opts?.modsDir) params.set('dir', opts.modsDir);
    if (opts?.fileExtensions?.length) params.set('ext', opts.fileExtensions.join(','));
    if (opts?.gameType) params.set('game', opts.gameType);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<ScanModsResponse>(
      'GET',
      `/api/instances/${encodeURIComponent(id)}/mods/scan${query}`,
    );
  }

  // ----------------------------------------------------------------------

  /**
   * 统一请求封装
   * @param method HTTP 方法
   * @param path 以 / 开头的路径
   * @param body 可选请求体（JSON.stringify）
   * @param withAuth 是否附带 Authorization 头（默认 true）
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    withAuth = true,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (withAuth) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // 网络错误 / DNS / 连接拒绝
      const message = err instanceof Error ? err.message : String(err);
      throw new DaemonApiError(
        'DAEMON_UNREACHABLE',
        `无法连接 Daemon: ${message}`,
        0,
      );
    }

    if (!response.ok) {
      throw await this.toDaemonApiError(response);
    }

    // 部分端点可能返回空 body，按 JSON 解析失败时返回空对象
    const text = await response.text();
    if (text.length === 0) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DaemonApiError(
        'DAEMON_INTERNAL_ERROR',
        `Daemon 响应非 JSON: ${text.slice(0, 200)}`,
        response.status,
      );
    }
  }

  private async toDaemonApiError(response: Response): Promise<DaemonApiError> {
    let code: string = 'DAEMON_INTERNAL_ERROR';
    let message = `Daemon 返回 ${response.status}`;
    try {
      const text = await response.text();
      if (text.length > 0) {
        const parsed = JSON.parse(text) as Partial<DaemonErrorResponse>;
        if (parsed?.error?.code) {
          code = parsed.error.code as DaemonErrorCodeType;
        }
        if (parsed?.error?.message) {
          message = parsed.error.message;
        }
      }
    } catch {
      // 忽略解析失败，使用默认 message
    }
    return new DaemonApiError(code, message, response.status);
  }
}
