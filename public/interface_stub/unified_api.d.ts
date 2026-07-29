/** 
 * 全局错误码定义
 */
export enum ErrorCode {
  INVALID_PRESET = 'INVALID_PRESET',
  INSUFFICIENT_SLOTS = 'INSUFFICIENT_SLOTS',
  INSTANCE_NOT_FOUND = 'INSTANCE_NOT_FOUND',
  DAEMON_OFFLINE = 'DAEMON_OFFLINE',
  UNAUTHORIZED = 'UNAUTHORIZED'
}

export class APIError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
}

export interface AdminInstanceDetail {
  id: string;
  nodeId: string;
  packId: string;
  status: 'running' | 'stopped' | 'deploying' | 'error';
  tags: string[];
  metrics: { cpu: number; memory: number; players: number };
}

export interface BatchResult {
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface UnifiedServerAPI {
  /** 
   * [Store 视图专用] 一键极简部署
   * @throws {APIError(ErrorCode.INVALID_PRESET)} 当请求的预设规格不存在时抛出
   * @throws {APIError(ErrorCode.INSUFFICIENT_SLOTS)} 当节点资源槽位不足防超卖时抛出
   * @throws {APIError(ErrorCode.UNAUTHORIZED)} 权限不足时抛出
   */
  quickDeploy(req: { packId: string; presetSize: 'basic' | 'pro' | 'max' }): Promise<{ instanceId: string; connectUrl: string }>;

  /** 
   * [Admin 视图专用] 高密度实例列表查询
   * @throws {APIError(ErrorCode.UNAUTHORIZED)} 权限不足时抛出
   */
  listInstances(query: { tags?: string[]; nodeId?: string; page: number }): Promise<Paginated<AdminInstanceDetail>>;

  /**
   * [Admin/Guild 视图复用] 批量操作
   * @throws {APIError(ErrorCode.UNAUTHORIZED)} 权限不足时抛出
   * @throws {APIError(ErrorCode.DAEMON_OFFLINE)} 目标Daemon节点失联时抛出
   */
  batchOperate(req: { instanceIds: string[]; action: 'start' | 'stop' | 'restart' | 'kill' }): Promise<BatchResult>;

  /**
   * [Guild 视图专用] 服务器坞极简状态 (Server Dock)
   * @throws {APIError(ErrorCode.UNAUTHORIZED)} 权限不足时抛出
   */
  getDockStatus(): Promise<Array<{ id: string; icon: string; status: 'running'|'stopped' }>>;
}

/** WebSocket 实时遥测契约 (Guild/Admin复用) */
export interface WSTelemetry {
  topic: 'server.telemetry';
  payload: {
    instanceId: string;
    logStream?: string[]; 
    advancedMetrics?: { loadAvg: number; tcpCongestion: boolean; diskIops: number }; 
  };
}
