// ============================================================================
// Daemon REST API 接口存根（零实现，仅声明签名）
// 依据：spec §3.7.1
// 实现方：daemon/src/api/
// 调用方：panel/backend/src/daemonClient/
// ============================================================================

import type {
  HealthResponse,
  ListInstancesResponse,
  InstanceStateResponse,
  StartInstanceResponse,
  StopInstanceResponse,
  CommandRequest,
  CommandResponse,
  ExecCommandRequest,
  ExecCommandResponse,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
} from '@public/schema/daemon-api-types';

export interface IDaemonRestApi {
  // GET /health（无需 token）
  getHealth(): Promise<HealthResponse>;

  // GET /api/instances
  listInstances(): Promise<ListInstancesResponse>;

  // GET /api/instances/:id/state
  getInstanceState(id: string): Promise<InstanceStateResponse>;

  // POST /api/instances/:id/start
  startInstance(id: string): Promise<StartInstanceResponse>;

  // POST /api/instances/:id/stop
  stopInstance(id: string): Promise<StopInstanceResponse>;

  // POST /api/instances/:id/command
  sendCommand(id: string, command: CommandRequest): Promise<CommandResponse>;

  // POST /api/instances/:id/exec — 在实例 workdir 下执行任意二进制命令（Task 3.5 新增）
  // 用途：factorio --create 生成地图、版本查询、安装命令等离线命令
  execCommand(id: string, body: ExecCommandRequest): Promise<ExecCommandResponse>;

  // GET /api/instances/:id/files?path=<relPath> — 读取实例 workdir 下的文件（Task 3.5 新增）
  readFile(id: string, path: string): Promise<FileReadResponse>;

  // PUT /api/instances/:id/files?path=<relPath> — 写入实例 workdir 下的文件（Task 3.5 新增）
  writeFile(id: string, path: string, body: FileWriteRequest): Promise<FileWriteResponse>;
}
