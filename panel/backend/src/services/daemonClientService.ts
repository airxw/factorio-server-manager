// ============================================================================
// daemonClientService — DaemonClient 接口实现（适配器模式）
// 接口契约：@public/interface_stub/daemon-client.d.ts
// 适配现有 DaemonHttpClient（REST 客户端），扩展支持 nodeId 多节点
// 来源：scheme-final-merged.md §2.3 / §7.1 P1
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type {
  InstanceState,
  DaemonEvent,
  InstanceConfig,
} from '@public/interface_stub/shared-types';
import type {
  ExecCommandRequest,
  ExecCommandResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  ScanJavasResult,
} from '@public/schema/daemon-api-types';
// v4.3.0 新增：文件列表 + mod 切换类型
import type {
  ListFilesResponse,
  ToggleModFileResponse,
} from '@public/schema/panel-api-types';
import { DaemonHttpClient } from '../daemonClient/client.js';
// L2：ModMetadata 已提升到 public/ 契约（从 daemon-api-types 导入）
import type { ModMetadata } from '@public/schema/daemon-api-types';
// 重新导出 ModMetadata 供上层（modService / 路由）使用
export type { ModMetadata } from '@public/schema/daemon-api-types';
import type { StartInstanceBody } from '../daemonClient/types.js';
import { DaemonApiError } from '../daemonClient/types.js';
import type { PackRegistry } from '../core/packs/registry.js';
import {
  DaemonUnreachableError,
  InstanceNotFoundError,
  InstanceNotRunningError,
  PackNotFoundError,
} from './errors.js';

// ----- DB 行类型 -----
interface NodeRow {
  id: string;
  name: string;
  fqdn: string;
  daemon_token_hash: string;
  public_ip: string | null;
  status: string;
  last_seen_at: string | null;
  /** L2: 主从通信密钥（slave 节点持有，master 节点为 null） */
  comms_key: string | null;
  /** L2: 节点类型（master/slave） */
  node_type: string;
}

/**
 * DaemonClient 实现（适配器模式）
 *
 * 设计要点：
 * - 适配现有 DaemonHttpClient（REST 客户端）为 DaemonClient 接口
 * - 支持 nodeId 多节点：查询 nodes 表获取节点地址，缓存 DaemonHttpClient 实例
 * - 错误转换：DaemonApiError → DaemonUnreachableError/InstanceNotFoundError/InstanceNotRunningError
 * - subscribeEvents P0 简化：由 index.ts 的 DaemonEventStream 统一管理，此处仅 warn
 */
export class DaemonClientImpl implements DaemonClient {
  private clients: Map<string, DaemonHttpClient> = new Map();

  constructor(
    private db: Knex,
    private registry: PackRegistry,
    private defaultBaseUrl: string,
    private defaultToken: string,
  ) {}

  /**
   * 探测节点健康状态（GET /health）并用于测速
   */
  async getHealth(nodeId: string): Promise<any> {
    const client = await this.getHttpClient(nodeId);
    return client.getHealth();
  }

  async startInstance(
    nodeId: string,
    serverId: string,
    config: InstanceConfig,
  ): Promise<{ success: boolean }> {
    const client = await this.getHttpClient(nodeId);
    const pack = this.registry.get(config.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack not found: ${config.pack_id}`);
    }

    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const body: StartInstanceBody = {
      pack,
      instance: {
        name: serverId,
        port: config.port,
        rcon_port: config.rcon_port,
        rcon_password: config.rcon_password ?? '',
        workdir: `${instancesDir}/${serverId}`,
      },
    };

    try {
      const resp = await client.startInstance(serverId, body);
      // status 为 starting/running 视为成功
      return { success: resp.status === 'starting' || resp.status === 'running' };
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  async stopInstance(nodeId: string, serverId: string): Promise<{ success: boolean }> {
    const client = await this.getHttpClient(nodeId);
    try {
      await client.stopInstance(serverId);
      return { success: true };
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * 带存档重启（POST /restart-with-save）。
   * 停止当前实例 → 以指定 save_path 重新启动，用于实际切换服务器使用的存档。
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async restartWithSave(
    nodeId: string,
    serverId: string,
    savePath: string,
  ): Promise<{ pid: number }> {
    const client = await this.getHttpClient(nodeId);
    try {
      const resp = await client.restartWithSave(serverId, savePath);
      return { pid: resp.pid };
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  async getInstanceState(nodeId: string, serverId: string): Promise<InstanceState> {
    const client = await this.getHttpClient(nodeId);
    try {
      const resp = await client.getInstanceState(serverId);
      return resp.status as InstanceState;
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  async sendCommand(
    nodeId: string,
    serverId: string,
    command: string,
    _requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const client = await this.getHttpClient(nodeId);
    try {
      const resp = await client.sendCommand(serverId, { command });
      return {
        success: resp.success,
        error: resp.success ? undefined : 'Command execution failed',
      };
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * v4.11.0: 卡密/商城发货沙箱入口（POST /api/instances/:id/execute-logic）。
   *
   * 将原始 logicString（含 {Var} 单花括号占位符）与 variables 转发给 daemon，
   * 由 daemon 侧 ExecutionEngine 沙箱完成变量替换 + 正则白名单校验后投递。
   *
   * 注意：此方法不在 DaemonClient 接口中（避免 public/ 契约变更），
   * 由 ExecutionEngineClient（IExecutionEngine 实现）直接调用。
   *
   * @param nodeId 目标节点 ID
   * @param serverId 目标服务器 ID（= daemon 实例 ID）
   * @param logicString 含 {Var} 占位符的原始指令模板
   * @param variables 变量名 → 变量值映射
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async executeLogic(
    nodeId: string,
    serverId: string,
    logicString: string,
    variables: Record<string, string>,
  ): Promise<{ success: boolean }> {
    const client = await this.getHttpClient(nodeId);
    try {
      const resp = await client.executeLogic(serverId, logicString, variables);
      return { success: resp.success };
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  subscribeEvents(
    _nodeId: string,
    _serverId: string,
    _callback: (event: DaemonEvent) => void,
  ): void {
    // P0 简化：事件订阅由 index.ts 的 DaemonEventStream 统一管理
    // 此处不实现单独订阅，避免与全局事件流冲突
    console.warn(
      '[daemonClient] subscribeEvents not implemented; use DaemonEventStream in index.ts instead',
    );
  }

  /**
   * 在实例 workdir 下执行任意二进制命令（Task 3.5 新增）。
   * 用途：factorio --create 生成地图、版本查询、安装命令等离线命令。
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async execCommand(
    nodeId: string,
    serverId: string,
    body: ExecCommandRequest,
  ): Promise<ExecCommandResponse> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.execCommand(serverId, body);
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * 读取实例 workdir 下的文件（Task 3.5 新增）。
   * @param relPath 相对 workdir 的路径（防穿越校验由 Daemon 端执行）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async readFile(
    nodeId: string,
    serverId: string,
    relPath: string,
  ): Promise<FileReadResponse> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.readFile(serverId, relPath);
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * 写入实例 workdir 下的文件（Task 3.5 新增）。
   * @param relPath 相对 workdir 的路径（防穿越校验由 Daemon 端执行）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async writeFile(
    nodeId: string,
    serverId: string,
    relPath: string,
    body: FileWriteRequest,
  ): Promise<FileWriteResponse> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.writeFile(serverId, relPath, body);
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * v4.3.0-F1 新增：列出实例 workdir 下指定目录的内容。
   */
  async listFiles(
    nodeId: string,
    serverId: string,
    relPath: string,
    recursive = false,
  ): Promise<ListFilesResponse> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.listFiles(serverId, relPath, recursive);
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * v4.3.0-H1 新增：切换 mod 启用状态（.jar ↔ .jar.disabled）。
   */
  async toggleModFile(
    nodeId: string,
    serverId: string,
    modName: string,
  ): Promise<ToggleModFileResponse> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.toggleModFile(serverId, modName);
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * v4.4.0-M1 新增：扫描 Daemon 节点上可用的 Java 安装。
   *
   * 转发到 Daemon 的 GET /api/env/javas 端点。扫描在 Daemon 端完成，
   * 结果不缓存（每次调用都重新扫描）。
   *
   * @throws {DaemonUnreachableError} 节点不可达
   */
  async scanJavas(nodeId: string): Promise<ScanJavasResult> {
    const client = await this.getHttpClient(nodeId);
    try {
      return await client.scanJavas();
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * L4 新增：扫描实例 mods 目录所有 jar 的元数据。
   *
   * 转发到 Daemon 的 GET /api/instances/:id/mods/scan 端点。扫描在 Daemon 端完成，
   * 用于识别客户端 mod（environment === 'client' 或命中黑名单）。
   *
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  async scanMods(nodeId: string, serverId: string): Promise<ModMetadata[]> {
    const client = await this.getHttpClient(nodeId);
    try {
      const resp = await client.scanMods(serverId);
      return resp.mods;
    } catch (err) {
      throw this.wrapDaemonError(err);
    }
  }

  /**
   * 获取节点的 DaemonHttpClient（带缓存）
   * L2 改造：
   *   - slave 节点：用 nodes.comms_key 作为 Bearer token（主从通信密钥）
   *   - master 节点（node-local）：comms_key 为 null，回退到 defaultToken（环境变量 DAEMON_TOKEN）
   *   - baseUrl 推导：slave 用 nodes.fqdn（slave 注册时自报的 HTTP 地址）；
   *     master 用 defaultBaseUrl（环境变量 DAEMON_URL）
   *
   * 缓存失效：slave 重新注册后 comms_key 变化，需调用 invalidateClient(nodeId) 清缓存。
   * 当前 P0 不实现自动失效（slave 重新注册是低频操作，重启 Panel 即可清缓存）。
   */
  private async getHttpClient(nodeId: string): Promise<DaemonHttpClient> {
    const cached = this.clients.get(nodeId);
    if (cached) {
      return cached;
    }

    // 查询 nodes 表获取节点信息
    const node = await this.db<NodeRow>('nodes').where({ id: nodeId }).first();
    // baseUrl 推导：
    //   - slave 节点 fqdn 为 slave 注册时自报的 HTTP 地址（如 http://192.168.1.10:8080）
    //   - master 节点 fqdn 可能为 'localhost' 或空，用 defaultBaseUrl
    // v4.22.3 修复：fqdn 不含端口时附加默认端口（从 defaultBaseUrl 解析或 fallback 8080）
    //   原逻辑对 fqdn='127.0.0.1' 拼成 'http://127.0.0.1'（端口 80），
    //   导致 fetch ECONNREFUSED → "fetch failed"（preflight 报"节点健康检查失败"）
    const baseUrl = node?.fqdn && node.fqdn !== 'localhost'
      ? this.composeBaseUrl(node.fqdn)
      : this.defaultBaseUrl;
    // token 选择：
    //   - slave 节点用 comms_key（主从通信密钥）
    //   - master 节点 comms_key 为 null，回退到 defaultToken（DAEMON_TOKEN 环境变量）
    const token = node?.comms_key ?? this.defaultToken;

    const client = new DaemonHttpClient({ baseUrl, token });
    this.clients.set(nodeId, client);
    return client;
  }

  /**
   * v4.22.3: 根据节点 fqdn 拼装 baseUrl，确保始终带端口。
   *
   * 拼装规则：
   *   - fqdn 已含 http(s):// 前缀：直接用（假设已带端口或 path）
   *   - fqdn 已含端口（host:port）：拼成 http://host:port
   *   - fqdn 仅 host：附加默认端口（从 defaultBaseUrl 解析，fallback 8080）
   *
   * 默认端口解析：从 `this.defaultBaseUrl`（DAEMON_URL）中提取 :port，
   * 例如 'http://localhost:8080' → '8080'。若 defaultBaseUrl 不含端口，fallback 8080。
   */
  private composeBaseUrl(fqdn: string): string {
    if (fqdn.startsWith('http://') || fqdn.startsWith('https://')) {
      return fqdn;
    }
    if (fqdn.includes(':')) {
      return `http://${fqdn}`;
    }
    // 仅 host，附加默认端口
    const portMatch = this.defaultBaseUrl.match(/:(\d+)(?:\/|$)/);
    const defaultPort = portMatch?.[1] ?? '8080';
    return `http://${fqdn}:${defaultPort}`;
  }

  /**
   * L2: 使指定节点的 HTTP 客户端缓存失效。
   * 用途：slave 重新注册后 comms_key 变化，需清缓存让下次调用重新从 DB 读取。
   */
  invalidateClient(nodeId: string): void {
    this.clients.delete(nodeId);
  }

  /**
   * 将 DaemonApiError 转换为契约定义的错误类
   */
  private wrapDaemonError(err: unknown): Error {
    if (err instanceof DaemonApiError) {
      if (err.code === 'DAEMON_UNREACHABLE' || err.statusCode === 0) {
        return new DaemonUnreachableError(err.message);
      }
      if (err.code === 'INSTANCE_NOT_FOUND') {
        return new InstanceNotFoundError(err.message);
      }
      if (err.code === 'INSTANCE_NOT_RUNNING') {
        return new InstanceNotRunningError(err.message);
      }
      // 其他 Daemon 错误归为不可达
      return new DaemonUnreachableError(`Daemon error: ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * 创建 DaemonClient 的工厂函数
 *
 * v4.11.0: 返回类型从 DaemonClient 接口改为 DaemonClientImpl 具体类，
 * 因为 ExecutionEngineClient 需要调用 DaemonClientImpl.executeLogic（尚未入接口契约）。
 * DaemonClientImpl 仍实现 DaemonClient 接口，现有依赖 DaemonClient 类型的代码不受影响。
 */
export function createDaemonClient(
  db: Knex,
  registry: PackRegistry,
  baseUrl: string,
  token: string,
): DaemonClientImpl {
  return new DaemonClientImpl(db, registry, baseUrl, token);
}
