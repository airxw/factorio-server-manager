// ============================================================================
// scheduler — Panel 内部定时任务调度器实现
// 支持三种时序模式：
//   1. interval_ms 周期任务（兼容历史用法）
//   2. next_run_at 一次性任务（可与 interval_ms 组合）
//   3. cron_expr 标准 5 字段 cron 表达式（v4.2.0-D4 新增，由 cron-parser 解析）
// 接口契约：@public/interface_stub/scheduler.d.ts
// 来源：scheme-final-merged.md §7.1 P1 / §8.1 R5（乐观锁超时回滚）/ §5.4 定时消息
//      mslx-upgrade-plan.md §D4（CRON 调度器增强）
// ============================================================================

import crypto from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Scheduler } from '@public/interface_stub/scheduler';
import type { SchedulerTask } from '@public/interface_stub/shared-types';

// 预定义任务类型常量（与 scheduler.d.ts 契约对齐）
// 注：.d.ts 中 `export declare const` 仅为类型声明，运行时无值；实现在此提供值
export const PERIODIC_MESSAGE = 'PERIODIC_MESSAGE' as const;
export const ITEM_SYNC = 'ITEM_SYNC' as const;
export const OPTIMISTIC_LOCK_TIMEOUT_SCAN = 'OPTIMISTIC_LOCK_TIMEOUT_SCAN' as const;
export const MONITOR_SNAPSHOT = 'MONITOR_SNAPSHOT' as const;
// 命令队列定时处理：每 5s 调用 commandDispatcher.processQueue() 把 pending 命令下发给 daemon
export const COMMAND_QUEUE_PROCESS = 'COMMAND_QUEUE_PROCESS' as const;
// 状态超时扫描：每 30s 扫描 DB 中 stuck 在 starting/stopping 的实例，向 Daemon 查询真实状态修正
export const STATE_TIMEOUT_SCAN = 'STATE_TIMEOUT_SCAN' as const;
// v3.6.0-C1: chat_logs 每日清理任务，遍历所有实例调用 chatLogService.cleanupOldLogs
export const CHAT_LOG_CLEANUP = 'CHAT_LOG_CLEANUP' as const;
// v3.6.1-A4: disk_usage_bytes 每日刷新任务，遍历所有 servers 调用 du -sb 更新 DB 缓存
export const DISK_USAGE_REFRESH = 'DISK_USAGE_REFRESH' as const;
// v3.6.2-A1: audit_logs 每日清理任务，清理超过 retention_days 的审计日志
export const AUDIT_LOG_CLEANUP = 'AUDIT_LOG_CLEANUP' as const;
// v3.6.2-A2: user_notifications 每日清理任务，清理超过 retention_days 的用户通知
export const NOTIFICATION_CLEANUP = 'NOTIFICATION_CLEANUP' as const;
// v3.6.2-A3: item_sync_log 每日清理任务，清理超过 retention_days 的物品同步日志
export const ITEM_SYNC_LOG_CLEANUP = 'ITEM_SYNC_LOG_CLEANUP' as const;
// v3.8.0-S9/S10: 自动备份任务，每日检查 backup.auto_enabled，为所有实例创建备份并按 max_count 清理
export const AUTO_BACKUP = 'AUTO_BACKUP' as const;
// v3.9.0-D1: 数据库自动备份任务，每日将 SQLite DB 文件复制到 backups/ 目录，保留 N 份
export const DB_BACKUP = 'DB_BACKUP' as const;
// v3.9.0-D2: 磁盘空间监控任务，每小时检查磁盘使用率超阈值时通知所有管理员
export const DISK_SPACE_MONITOR = 'DISK_SPACE_MONITOR' as const;
// v4.2.0-D4: CRON 调度的实例生命周期任务（payload.cron_expr 决定触发时机）
// CRON_COMMAND: 定时下发游戏控制台命令
// CRON_START/STOP/RESTART: 定时启动/停止/重启实例
// CRON_BACKUP: 定时备份（支持 cron 表达式如 "0 3 * * *"，替代 AUTO_BACKUP 的固定 24h 周期）
export const CRON_COMMAND = 'CRON_COMMAND' as const;
export const CRON_START = 'CRON_START' as const;
export const CRON_STOP = 'CRON_STOP' as const;
export const CRON_RESTART = 'CRON_RESTART' as const;
export const CRON_BACKUP = 'CRON_BACKUP' as const;
// v4.6.0-F3: 告警定时检查任务
// ALERT_SSL_EXPIRY_CHECK: 每日检查 SSL 证书到期情况
export const ALERT_SSL_EXPIRY_CHECK = 'ALERT_SSL_EXPIRY_CHECK' as const;
// ALERT_BACKUP_HEALTH_CHECK: 每日检查备份健康度（连续失败）
export const ALERT_BACKUP_HEALTH_CHECK = 'ALERT_BACKUP_HEALTH_CHECK' as const;
// L2: NODE_OFFLINE_SCAN — 每 15s 扫描 slave 节点，超时未上报标记 offline
export const NODE_OFFLINE_SCAN = 'NODE_OFFLINE_SCAN' as const;
// v5 用户中心经济系统：4 个每日定时任务
// 注：以下 type 未加入 public/interface_stub/shared-types.d.ts 的 SchedulerTaskType 联合
// （public/ 契约冻结不可改），schedule() 调用点在 scheduler-init.ts 做类型断言，运行时仅为字符串。
// CDK_REFUND_SCAN: CDK 过期退费扫描（每日，扫描过期未兑换的经济 CDK，用户自生成的解冻退费）
export const CDK_REFUND_SCAN = 'CDK_REFUND_SCAN' as const;
// WITHDRAW_EXPIRE_SCAN: 提现码过期扫描（每日，过期提现码自动取消并解冻余额）
export const WITHDRAW_EXPIRE_SCAN = 'WITHDRAW_EXPIRE_SCAN' as const;
// INTEGRAL_DAILY_DECAY: 积分每日衰减（每日，current_integral 每日衰减 1 点，保底 0）
export const INTEGRAL_DAILY_DECAY = 'INTEGRAL_DAILY_DECAY' as const;
// VIP_SUBSCRIPTION_SCAN: VIP 订阅过期扫描（每日，订阅制到期 vip_type 置 null）
export const VIP_SUBSCRIPTION_SCAN = 'VIP_SUBSCRIPTION_SCAN' as const;
// WALLET_ANOMALY_SCAN: 经济异常流水告警扫描（每日，方案 §8.3：单日大额流入/负余额/CDK 批次异常兑换率）
export const WALLET_ANOMALY_SCAN = 'WALLET_ANOMALY_SCAN' as const;

export type { SchedulerTaskType } from '@public/interface_stub/shared-types';

/**
 * 任务执行器类型（依赖注入点）
 * 调度器仅负责时序触发，实际业务逻辑由业务模块通过 setExecutor 注入
 */
export type TaskExecutor = (task: SchedulerTask) => void;

/**
 * Panel 内部定时任务调度器实现
 *
 * 设计要点：
 * - 时序与业务解耦：scheduler 只管"何时触发"，业务模块通过 setExecutor 注入"做什么"
 * - 严格匹配契约签名：schedule/cancel/list 与 .d.ts 一致；setExecutor/destroy 为实现扩展点
 * - 双模式：interval_ms 周期任务 / next_run_at 一次性任务（二者可组合：首次延迟 + 周期）
 * - 异常隔离：executor 抛错不影响后续触发
 * - 优雅退出：destroy 清理所有定时器
 */
export class SchedulerImpl implements Scheduler {
  private tasks: Map<string, SchedulerTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private executor: TaskExecutor | null = null;

  /**
   * 设置任务执行器（依赖注入）
   * 业务模块初始化时调用此方法注入执行逻辑（如通过 eventBus 派发任务）
   */
  setExecutor(fn: TaskExecutor): void {
    this.executor = fn;
  }

  /**
   * 注册定时任务。返回 taskId。
   *
   * 调度规则（v4.2.0-D4 扩展）：
   * - 若 cron_expr 存在：按标准 5 字段 cron 表达式触发（cron-parser 解析）。
   *   若 interval_ms 也存在，记录警告并忽略 interval_ms。
   *   若 next_run_at 也存在，next_run_at 仍作为首次触发时间，后续按 cron_expr 周期。
   * - 否则若 next_run_at 存在：首次在 next_run_at 触发；若 interval_ms 也存在，之后按 interval_ms 周期触发
   * - 否则若仅 interval_ms 存在：首次在 interval_ms 后触发，之后按 interval_ms 周期触发
   * - 若三者均无：抛错
   * - 若 enabled=false：注册但不启动定时器（暂停状态）
   */
  schedule(task: SchedulerTask): string {
    const taskId = task.id ?? crypto.randomUUID();
    const now = Date.now();

    const hasCron = typeof task.cron_expr === 'string' && task.cron_expr.length > 0;
    const hasInterval = typeof task.interval_ms === 'number' && task.interval_ms > 0;
    const hasNextRun = typeof task.next_run_at === 'string' && task.next_run_at.length > 0;

    // 校验：至少有一种时序模式
    if (!hasCron && !hasInterval && !hasNextRun) {
      throw new Error(
        `[scheduler] task must have either cron_expr, next_run_at or positive interval_ms, taskId=${taskId}`,
      );
    }

    // cron_expr 与 interval_ms 同时存在时，cron 优先
    if (hasCron && hasInterval) {
      console.warn(
        `[scheduler] task ${taskId} (${task.type}) 同时指定 cron_expr 和 interval_ms，cron_expr 优先，interval_ms 被忽略`,
      );
    }

    // 预解析 cron 表达式（提前抛错，避免运行时炸）
    let cronIterator: ReturnType<typeof CronExpressionParser.parse> | null = null;
    if (hasCron) {
      try {
        cronIterator = CronExpressionParser.parse(task.cron_expr!, { currentDate: new Date(now) });
      } catch (err) {
        throw new Error(
          `[scheduler] invalid cron_expr "${task.cron_expr}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 计算首次执行延迟
    let initialDelayMs: number;
    if (hasNextRun) {
      const scheduledTime = new Date(task.next_run_at!).getTime();
      if (Number.isNaN(scheduledTime)) {
        throw new Error(`[scheduler] invalid next_run_at: ${task.next_run_at}`);
      }
      initialDelayMs = Math.max(0, scheduledTime - now);
    } else if (hasCron && cronIterator) {
      // 无 next_run_at：从 cron 表达式取下一次触发时间
      const next = cronIterator.next();
      initialDelayMs = Math.max(0, next.getTime() - now);
    } else if (hasInterval) {
      initialDelayMs = task.interval_ms!;
    } else {
      // 理论不可达（前面已校验）
      throw new Error(`[scheduler] unreachable: no scheduling mode for taskId=${taskId}`);
    }

    const intervalMs = hasCron ? undefined : task.interval_ms;
    const enabled = task.enabled !== false; // 默认 true

    // 注册任务（剥离原 id 避免污染）
    const registeredTask: SchedulerTask = { ...task, id: taskId, enabled };
    this.tasks.set(taskId, registeredTask);

    if (!enabled) {
      // 暂停状态：仅注册不启动定时器
      return taskId;
    }

    this.startTimer(taskId, initialDelayMs, intervalMs, cronIterator);
    return taskId;
  }

  /**
   * 取消任务
   * @returns true=取消成功；false=任务不存在
   */
  cancel(taskId: string): boolean {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
    return this.tasks.delete(taskId);
  }

  /**
   * 列出全部已注册任务（含已暂停但未取消的）
   */
  list(): SchedulerTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 按 ID 获取任务（实现扩展点，非契约方法）
   */
  get(taskId: string): SchedulerTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 关闭所有定时器（用于优雅退出）
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.tasks.clear();
    this.executor = null;
  }

  /**
   * 启动任务的定时器
   *
   * v4.2.0-D4 扩展：支持 cron_expr 周期任务。
   * - cron 模式：每次 fire 后通过 cronIterator.next() 取下一次触发时间并 setTimeout
   * - interval_ms 模式：每次 fire 后按固定间隔 setTimeout（原逻辑）
   * - 一次性模式：fire 后清理定时器（原逻辑）
   *
   * 注：cronIterator 由 schedule() 在调用前预解析并传入；若任务定义后续被修改（如 cron_expr 字符串变更），
   * 当前实现不会重新解析（tasks Map 中的快照在 schedule 时已固定）。如需动态修改 cron，应 cancel + 重新 schedule。
   */
  private startTimer(
    taskId: string,
    initialDelayMs: number,
    intervalMs?: number,
    cronIterator?: ReturnType<typeof CronExpressionParser.parse> | null,
  ): void {
    const fire = () => {
      this.executeTask(taskId);
      // 任务已被 cancel 或 destroy：不再调度下一轮
      if (!this.tasks.has(taskId)) {
        this.timers.delete(taskId);
        return;
      }
      // 周期任务：继续调度下一轮
      if (cronIterator) {
        // cron 模式：从迭代器取下一次触发时间
        try {
          const next = cronIterator.next();
          const delay = Math.max(0, next.getTime() - Date.now());
          const timer = setTimeout(fire, delay);
          this.timers.set(taskId, timer);
        } catch (err) {
          // cron 迭代器耗尽或异常：停止调度并记录
          console.error(
            `[scheduler] cron iterator error for task ${taskId}, stopping:`,
            err,
          );
          this.timers.delete(taskId);
        }
      } else if (intervalMs && intervalMs > 0) {
        // interval_ms 模式：固定间隔
        const timer = setTimeout(fire, intervalMs);
        this.timers.set(taskId, timer);
      } else {
        // 一次性任务：触发后清理定时器记录
        this.timers.delete(taskId);
      }
    };

    const timer = setTimeout(fire, initialDelayMs);
    this.timers.set(taskId, timer);
  }

  /**
   * 执行任务（时序触发点）
   * 调用注入的 executor；若未设置 executor，记录警告
   */
  private executeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.enabled === false) {
      return;
    }

    if (this.executor) {
      try {
        this.executor(task);
      } catch (err) {
        // 异常隔离：executor 抛错不影响后续触发
        console.error(`[scheduler] executor error for task ${taskId} (${task.type}):`, err);
      }
    } else {
      // 未设置 executor：仅记录，不阻断调度
      console.warn(`[scheduler] no executor set, task ${taskId} (${task.type}) skipped`);
    }
  }
}

/** 全局单例调度器 */
export const scheduler = new SchedulerImpl();
