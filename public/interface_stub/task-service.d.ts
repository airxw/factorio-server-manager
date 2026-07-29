// ============================================================================
// TaskService 接口契约（v4.3.0-E1）
// 异步任务框架：长时间运行操作（download/compress/decompress/deploy）的统一抽象
// 实现：panel/backend/src/services/taskService.ts
// ============================================================================

/** 任务 ID（32 位 hex，UUID v4 去掉连字符） */
export type TaskId = string;

/**
 * 任务类型。
 * - download: 远程文件下载到实例目录（离线下载）
 * - compress: 目录/文件压缩为 zip/tar.gz
 * - decompress: 压缩包解压到指定目录
 * - deploy: 部署操作（如安装包解压 + 配置生成）
 * - upload: 分片上传合并（F3 内部使用）
 */
export type TaskType = 'download' | 'compress' | 'decompress' | 'deploy' | 'upload';

/**
 * 任务状态。
 * - running: 执行中
 * - completed: 成功完成（result 已填充）
 * - failed: 失败（error_message 已填充）
 * - canceled: 被取消（cancelTask 调用或 TTL 过期）
 */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'canceled';

/** 任务进度（0-100 整数 + 可选消息） */
export interface TaskProgress {
  /** 0-100 整数 */
  percent: number;
  /** 人类可读进度消息，如 "正在下载 chunk 5/8" */
  message: string | null;
}

/**
 * 任务结果。executor 返回值的结构契约。
 * 不同任务类型填充不同字段，所有字段可选。
 */
export interface TaskResult {
  /** 下载/解压的目标路径 */
  output_path?: string;
  /** 下载/处理的字节数 */
  bytes?: number;
  /** 释放/占用的字节数 */
  freed_bytes?: number;
  /** 自定义元数据 */
  meta?: Record<string, unknown>;
  /** 内部用：标记取消 */
  canceled?: boolean;
}

/**
 * 任务上下文（传给 executor）。
 * executor 通过 ctx 上报进度 / 检查取消标志。
 */
export interface TaskContext {
  taskId: TaskId;
  reportProgress: (percent: number, message?: string) => void;
  shouldCancel: () => boolean;
}

/**
 * 任务执行器函数签名。
 * @param ctx 任务上下文（进度上报 + 取消检查）
 * @returns 任务结果
 */
export type TaskExecutor = (ctx: TaskContext) => Promise<TaskResult>;

/** 提交任务时的入参 */
export interface TaskSubmitOptions {
  /** 关联的实例 ID（用于按实例过滤任务） */
  server_id?: string;
  /** 任务执行器 */
  executor: TaskExecutor;
}

/** 任务完整状态快照（getTaskStatus / listTasks 返回值） */
export interface TaskState {
  id: TaskId;
  type: TaskType;
  server_id: string | null;
  status: TaskStatus;
  progress: TaskProgress;
  result: TaskResult | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/**
 * TaskService 接口。
 * 实现类：TaskServiceImpl（panel/backend/src/services/taskService.ts）
 */
export interface TaskService {
  /** 提交任务并立即开始执行。返回 taskId。 */
  submitTask(type: TaskType, options: TaskSubmitOptions): TaskId;
  /** 查询任务状态。不存在返回 null。 */
  getTaskStatus(taskId: TaskId): TaskState | null;
  /** 请求取消任务。仅置标志，executor 自行检查退出。已完成返回 false。 */
  cancelTask(taskId: TaskId): boolean;
  /** 列出所有未过期任务。 */
  listTasks(): TaskState[];
}
