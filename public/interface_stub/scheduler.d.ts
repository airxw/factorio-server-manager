/**
 * scheduler.d.ts — scheduler 接口存根
 *
 * 职责：Panel 内部定时任务调度器（periodic_message / item_sync / optimistic_lock 超时扫描 / monitor 快照）
 * 来源：scheme-final-merged.md §7.1 P1 / §8.1 R5（乐观锁超时回滚）/ §5.4 定时消息
 */

import type { SchedulerTask, SchedulerTaskType } from './shared-types';

/** 预定义任务类型常量 */
export declare const PERIODIC_MESSAGE: 'PERIODIC_MESSAGE';
export declare const ITEM_SYNC: 'ITEM_SYNC';
export declare const OPTIMISTIC_LOCK_TIMEOUT_SCAN: 'OPTIMISTIC_LOCK_TIMEOUT_SCAN';
export declare const MONITOR_SNAPSHOT: 'MONITOR_SNAPSHOT';

export { SchedulerTaskType } from './shared-types';

export interface Scheduler {
  /**
   * 注册定时任务。返回 taskId。
   * @param task 任务定义（type / interval_ms / next_run_at / payload 等）
   * @returns taskId，用于后续 cancel / 查询
   */
  schedule(task: SchedulerTask): string;

  /**
   * 取消任务。
   * @returns true=取消成功；false=任务不存在或已执行完毕
   */
  cancel(taskId: string): boolean;

  /**
   * 列出全部已注册任务（含已暂停但未取消的）。
   */
  list(): SchedulerTask[];
}
