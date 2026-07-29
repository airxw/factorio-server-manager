/**
 * daemon-client.d.ts — daemonClient 接口存根（扩展现有 daemonClient）
 *
 * 职责：Panel → Daemon 的 REST + WS 双通道客户端
 *   - REST：start / stop / state
 *   - WS：sendCommand 下行 / subscribeEvents 上行
 * 数据契约：scheme-final-merged.md §2.3 / §7.1 P1（已有，扩展 sendCommand 下行）
 */

import type { InstanceState, DaemonEvent, InstanceConfig } from './shared-types';
import type {
  ExecCommandRequest,
  ExecCommandResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  ScanJavasResult,
  ModMetadata,
} from '@public/schema/daemon-api-types';
// v4.3.0 新增：文件列表 + mod 切换类型
import type {
  ListFilesResponse,
  ToggleModFileResponse,
} from '@public/schema/panel-api-types';
import {
  DaemonUnreachableError,
  InstanceNotFoundError,
  InstanceNotRunningError,
} from './shared-types';

export interface DaemonClient {
  /**
   * 探测节点健康状态（GET /health）并用于测速。
   * @param nodeId 目标节点 ID
   * @throws {DaemonUnreachableError} 节点不可达
   */
  getHealth(nodeId: string): Promise<any>;

  /**
   * 启动实例（POST /start）。
   * @param nodeId 目标节点 ID
   * @param serverId 目标服务器 ID
   * @param config 实例启动配置（端口 / RCON / 业务开关）
   * @returns {success} success=true 表示 Daemon 已接受启动请求
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  startInstance(
    nodeId: string,
    serverId: string,
    config: InstanceConfig,
  ): Promise<{ success: boolean }>;

  /**
   * 停止实例（POST /stop）。
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  stopInstance(nodeId: string, serverId: string): Promise<{ success: boolean }>;

  /**
   * 查询实例状态（GET /state）。
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  getInstanceState(nodeId: string, serverId: string): Promise<InstanceState>;

  /**
   * 下发命令（WS sendCommand 下行）。
   * @param requestId 请求追踪 ID，用于关联响应
   * @returns {success, error?} error 在 success=false 时给出失败原因
   * @throws {DaemonUnreachableError} WS 未连接或超时
   * @throws {InstanceNotRunningError} 实例未运行，命令无法发送
   */
  sendCommand(
    nodeId: string,
    serverId: string,
    command: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * 订阅实例事件（WS subscribe 下行 + 上行事件回调）。
   * 回调在收到 console.output / state.change / resource.metrics 等事件时触发。
   */
  subscribeEvents(
    nodeId: string,
    serverId: string,
    callback: (event: DaemonEvent) => void,
  ): void;

  /**
   * 在实例 workdir 下执行任意二进制命令（POST /exec，Task 3.5 新增）。
   * 用途：factorio --create 生成地图、版本查询、安装命令等离线命令。
   * @param body 命令请求（binary/args/cwd/env/timeout）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  execCommand(
    nodeId: string,
    serverId: string,
    body: ExecCommandRequest,
  ): Promise<ExecCommandResponse>;

  /**
   * 读取实例 workdir 下的文件（GET /files?path=，Task 3.5 新增）。
   * @param relPath 相对 workdir 的路径（防穿越校验）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  readFile(
    nodeId: string,
    serverId: string,
    relPath: string,
  ): Promise<FileReadResponse>;

  /**
   * 写入实例 workdir 下的文件（PUT /files?path=，Task 3.5 新增）。
   * @param relPath 相对 workdir 的路径（防穿越校验）
   * @param body 写入请求（content/encoding）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  writeFile(
    nodeId: string,
    serverId: string,
    relPath: string,
    body: FileWriteRequest,
  ): Promise<FileWriteResponse>;

  /**
   * v4.3.0-F1 新增：列出实例 workdir 下指定目录的内容。
   * @param relPath 相对 workdir 的目录路径（空字符串或 "." 表示 workdir 本身）
   * @param recursive 是否递归列出（默认 false）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  listFiles(
    nodeId: string,
    serverId: string,
    relPath: string,
    recursive?: boolean,
  ): Promise<ListFilesResponse>;

  /**
   * v4.3.0-H1 新增：切换 mod 启用状态（.jar ↔ .jar.disabled）。
   * @param modName 纯文件名（无路径，必须以 .jar 或 .jar.disabled 结尾）
   * @returns 新状态
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  toggleModFile(
    nodeId: string,
    serverId: string,
    modName: string,
  ): Promise<ToggleModFileResponse>;

  /**
   * v4.4.0-M1 新增：扫描 Daemon 节点上可用的 Java 安装。
   *
   * 用于 Panel 在创建 Minecraft 实例前查询可用 Java 版本，匹配实例兼容性。
   * 扫描在 Daemon 端完成（GET /api/env/javas），结果不缓存。
   *
   * @param nodeId 目标节点 ID
   * @returns 扫描结果（含所有 Java 安装信息，按版本降序）
   * @throws {DaemonUnreachableError} 节点不可达
   */
  scanJavas(nodeId: string): Promise<ScanJavasResult>;

  /**
   * L4 新增 → L2 提升到 public/：扫描实例 mods 目录所有 jar 的元数据。
   *
   * 用于识别客户端 mod（environment === 'client' 或命中黑名单），避免误装到服务端
   * 导致启动失败。扫描在 Daemon 端完成（GET /api/instances/:id/mods/scan）。
   *
   * @param nodeId 目标节点 ID
   * @param serverId 目标服务器 ID
   * @returns mod 元数据数组（mods 目录不存在时返回空数组）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} serverId 在节点上不存在
   */
  scanMods(nodeId: string, serverId: string): Promise<ModMetadata[]>;

  /**
   * L2: 使指定节点的 HTTP 客户端缓存失效。
   * 用途：slave 重新注册后 comms_key 变化，需清缓存让下次调用重新从 DB 读取。
   * @param nodeId 目标节点 ID
   */
  invalidateClient(nodeId: string): void;
}

export {
  DaemonUnreachableError,
  InstanceNotFoundError,
  InstanceNotRunningError,
} from './shared-types';
