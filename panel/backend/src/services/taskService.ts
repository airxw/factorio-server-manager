// ============================================================================
// taskService — 异步任务框架（v4.3.0-E1）
//
// 用途：长时间运行操作（下载 / 压缩 / 解压 / 部署）的统一抽象。
// 生命周期：submitTask → running → completed/failed/canceled
// 存储：内存 Map + 30 分钟 TTL（非持久化，短生命周期，重启即丢）
//
// 契约：public/interface_stub/task-service.d.ts
// 数据：public/schema/task-schema.json（任务状态/类型/进度结构）
//
// 设计：
//   - 任务执行器（executor）为异步函数，接收 ctx 对象（含 reportProgress / shouldCancel）
//   - 进度节流：reportProgress 内部 1s 节流，避免高频更新压垮前端
//   - 取消机制：调用方 cancel(taskId) → ctx.shouldCancel 变 true，executor 自行检查并退出
//   - 结果与错误：executor 返回值作为 result；抛错则记为 failed + error_message
//   - TTL 清理：30 分钟后自动从 Map 中移除（避免内存泄漏）
// ============================================================================

import { randomUUID } from 'node:crypto';
import type {
  TaskId,
  TaskType,
  TaskStatus,
  TaskState,
  TaskProgress,
  TaskResult,
  TaskExecutor,
  TaskService,
  TaskSubmitOptions,
} from '@public/interface_stub/task-service';
import type { CommandPriority } from '@public/interface_stub/shared-types';

// ----- 常量 -----

/** 任务最大存活时间（30 分钟，从 submit 起算） */
const TASK_TTL_MS = 30 * 60 * 1000;
/** 进度上报最小间隔（1 秒，避免压垮前端） */
const PROGRESS_THROTTLE_MS = 1000;
/** TTL 清理周期（5 分钟扫描一次） */
const TTL_SCAN_INTERVAL_MS = 5 * 60 * 1000;
/** 任务并发上限（避免无限制并发拖垮服务器） */
const MAX_CONCURRENT_TASKS = 8;

// ----- 任务上下文（传给 executor） -----

export interface TaskContext {
  /** 任务 ID */
  taskId: TaskId;
  /** 上报进度（0-100 + 可选 message）。内部 1s 节流。 */
  reportProgress: (percent: number, message?: string) => void;
  /** 检查取消标志。executor 应在长循环中定期调用，true 时应主动退出。 */
  shouldCancel: () => boolean;
}

// ----- 内部任务记录 -----

interface InternalTask {
  id: TaskId;
  type: TaskType;
  server_id: string | null;
  status: TaskStatus;
  progress: TaskProgress;
  result: TaskResult | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string; // ISO 时间，TTL 到期
  executor: TaskExecutor | null; // 完成后置 null
  cancelRequested: boolean;
  lastProgressReportAt: number; // ms 时间戳，节流用
  runningPromise: Promise<TaskResult> | null;
}

// ----- 实现 -----

export class TaskServiceImpl implements TaskService {
  private readonly tasks = new Map<TaskId, InternalTask>();
  private ttlTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startTtlScan();
  }

  /**
   * 提交任务并立即开始执行。
   * @returns taskId（32 位 hex）
   * @throws 若并发任务数达上限
   */
  submitTask(type: TaskType, options: TaskSubmitOptions): TaskId {
    if (this.tasks.size >= MAX_CONCURRENT_TASKS) {
      // 清理已完成的过期任务后再检查
      this.evictExpired();
      if (this.tasks.size >= MAX_CONCURRENT_TASKS) {
        throw new Error(
          `任务并发已达上限 ${MAX_CONCURRENT_TASKS}，请稍后重试`,
        );
      }
    }

    const taskId = randomUUID().replace(/-/g, '') as TaskId;
    const now = new Date();
    const isoNow = now.toISOString();
    const expiresAt = new Date(now.getTime() + TASK_TTL_MS).toISOString();

    const record: InternalTask = {
      id: taskId,
      type,
      server_id: options.server_id ?? null,
      status: 'running',
      progress: { percent: 0, message: null },
      result: null,
      error_message: null,
      created_at: isoNow,
      updated_at: isoNow,
      expires_at: expiresAt,
      executor: options.executor,
      cancelRequested: false,
      lastProgressReportAt: 0,
      runningPromise: null,
    };

    this.tasks.set(taskId, record);

    // 立即启动执行（异步，不阻塞 submitTask 返回）
    record.runningPromise = this.runExecutor(taskId);

    return taskId;
  }

  /**
   * 查询任务状态。任务不存在或已过期返回 null。
   */
  getTaskStatus(taskId: TaskId): TaskState | null {
    const t = this.tasks.get(taskId);
    if (!t) return null;
    return {
      id: t.id,
      type: t.type,
      server_id: t.server_id,
      status: t.status,
      progress: t.progress,
      result: t.result,
      error_message: t.error_message,
      created_at: t.created_at,
      updated_at: t.updated_at,
      expires_at: t.expires_at,
    };
  }

  /**
   * 请求取消任务。仅置 cancelRequested=true，executor 自行检查退出。
   * 已完成/已取消的任务返回 false。
   */
  cancelTask(taskId: TaskId): boolean {
    const t = this.tasks.get(taskId);
    if (!t) return false;
    if (t.status !== 'running') return false;
    t.cancelRequested = true;
    t.updated_at = new Date().toISOString();
    return true;
  }

  /**
   * 列出当前所有任务（含已完成未过期的）。
   */
  listTasks(): TaskState[] {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.id,
      type: t.type,
      server_id: t.server_id,
      status: t.status,
      progress: t.progress,
      result: t.result,
      error_message: t.error_message,
      created_at: t.created_at,
      updated_at: t.updated_at,
      expires_at: t.expires_at,
    }));
  }

  /**
   * 销毁：停止 TTL 扫描，清空任务表。用于优雅停机。
   */
  destroy(): void {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    // 标记所有运行中任务为 canceled（不等待 executor 退出）
    for (const t of this.tasks.values()) {
      if (t.status === 'running') {
        t.status = 'canceled';
        t.updated_at = new Date().toISOString();
      }
    }
    this.tasks.clear();
  }

  // ----- 内部 -----

  /**
   * 执行任务。捕获异常 → failed；正常返回 → completed；取消 → canceled。
   */
  private async runExecutor(taskId: TaskId): Promise<TaskResult> {
    const t = this.tasks.get(taskId);
    if (!t || !t.executor) {
      throw new Error(`任务不存在或无执行器: ${taskId}`);
    }

    const ctx: TaskContext = {
      taskId,
      reportProgress: (percent: number, message?: string) => {
        this.reportProgress(taskId, percent, message);
      },
      shouldCancel: () => t.cancelRequested,
    };

    try {
      // 执行前再检查一次取消
      if (t.cancelRequested) {
        this.markCanceled(taskId);
        return { canceled: true };
      }
      const result = await t.executor(ctx);
      // executor 退出后再次检查取消标志（可能 executor 主动检测后返回）
      if (t.cancelRequested) {
        this.markCanceled(taskId);
        return result ?? { canceled: true };
      }
      this.markCompleted(taskId, result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.markFailed(taskId, message);
      throw err;
    } finally {
      // 释放执行器引用，便于 GC
      t.executor = null;
      t.runningPromise = null;
    }
  }

  private reportProgress(taskId: TaskId, percent: number, message?: string): void {
    const t = this.tasks.get(taskId);
    if (!t || t.status !== 'running') return;
    const now = Date.now();
    if (now - t.lastProgressReportAt < PROGRESS_THROTTLE_MS) {
      // 节流：仅更新 message 不更新时间戳（避免高频上报）
      if (message !== undefined) t.progress.message = message;
      return;
    }
    t.lastProgressReportAt = now;
    t.progress = {
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message: message ?? t.progress.message,
    };
    t.updated_at = new Date().toISOString();
  }

  private markCompleted(taskId: TaskId, result: TaskResult): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.status = 'completed';
    t.progress = { percent: 100, message: t.progress.message };
    t.result = result;
    t.updated_at = new Date().toISOString();
  }

  private markFailed(taskId: TaskId, message: string): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.status = 'failed';
    t.error_message = message;
    t.updated_at = new Date().toISOString();
  }

  private markCanceled(taskId: TaskId): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.status = 'canceled';
    t.updated_at = new Date().toISOString();
  }

  // ----- TTL 扫描 -----

  private startTtlScan(): void {
    if (this.ttlTimer) return;
    this.ttlTimer = setInterval(() => {
      this.evictExpired();
    }, TTL_SCAN_INTERVAL_MS);
    // 不阻止进程退出
    if (typeof this.ttlTimer.unref === 'function') {
      this.ttlTimer.unref();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, t] of this.tasks.entries()) {
      const expiresAt = new Date(t.expires_at).getTime();
      if (expiresAt < now) {
        // 仍在运行的任务先标记 canceled 再删除
        if (t.status === 'running') {
          t.cancelRequested = true;
          t.status = 'canceled';
        }
        this.tasks.delete(id);
      }
    }
  }
}

// ----- 工厂 -----

let singleton: TaskServiceImpl | null = null;

/**
 * 获取 TaskService 单例（全应用共享一个任务表）。
 */
export function getTaskService(): TaskServiceImpl {
  if (!singleton) {
    singleton = new TaskServiceImpl();
  }
  return singleton;
}

// ----- 重新导出公共类型（便于其他模块导入） -----

export type {
  TaskId,
  TaskType,
  TaskStatus,
  TaskState,
  TaskProgress,
  TaskResult,
  TaskExecutor,
  TaskService,
  TaskSubmitOptions,
  CommandPriority,
};
