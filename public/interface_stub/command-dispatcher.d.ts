/**
 * command-dispatcher.d.ts — commandDispatcher 接口存根
 *
 * 职责：命令模板渲染 / 队列 / 重试 / 成就预热
 * 数据契约：public/schema/command-queue-schema.json
 * 来源：scheme-final-merged.md §4.3.5 / §5.1 / §5.5 防注入校验 / §7.1 P1
 */

import type { CommandPriority } from './shared-types';
import { CommandRenderError, CommandQueueFullError, DaemonUnreachableError } from './shared-types';

export interface CommandDispatcher {
  /**
   * 渲染命令模板。严格按 VARIABLE_PATTERNS 正则校验变量值（防 Lua/SQL 注入）。
   * 校验失败抛 CommandRenderError，命令不入队、不下发。
   * @param template 含 {{var}} 占位的模板字符串
   * @param vars 变量名到变量值的映射
   * @returns 渲染后的完整命令字符串
   * @throws {CommandRenderError} 变量值不匹配正则 / 含未知变量
   */
  renderCommand(template: string, vars: Record<string, string>): string;

  /**
   * 命令入队。返回队列 ID（command_queue.id）。
   * 队列上限 1000，超限抛 CommandQueueFullError。
   * @returns 队列记录 ID
   * @throws {CommandQueueFullError} 队列已满
   */
  enqueue(
    serverId: string,
    command: string,
    priority?: CommandPriority,
  ): Promise<number>;

  /**
   * 通过 daemonClient 直接下发命令（绕过队列，用于实时性要求高的场景）。
   * @param requestId 请求追踪 ID，用于关联 Daemon 响应
   * @returns {success, error?} error 在 success=false 时给出失败原因
   * @throws {DaemonUnreachableError} Daemon 不可达
   * @throws {InstanceNotRunningError} 实例未运行
   */
  sendViaDaemon(
    serverId: string,
    command: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * 重试队列中失败的命令。attempts +1，达 max_attempts 则 status=failed。
   * @throws {CommandQueueFullError} 重试入队时队列已满
   */
  retry(queueId: number): Promise<void>;

  /**
   * 定时处理待发送命令。由 scheduler 周期调用，按优先级调度 pending 命令。
   */
  processQueue(): Promise<void>;
}

export {
  CommandRenderError,
  CommandQueueFullError,
  DaemonUnreachableError,
} from './shared-types';
