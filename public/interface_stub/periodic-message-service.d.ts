/**
 * periodic-message-service.d.ts — periodicMessageService 接口存根
 *
 * 职责：定时消息任务管理 + 到点下发 broadcast 命令
 * 数据契约：public/schema/periodic-messages-schema.json
 * 来源：scheme-final-merged.md §5.4 聊天增强 P2 / §3.5 periodic_messages / §7.1 P3
 */

import type { PeriodicMessage } from './shared-types';
import { MessageNotFoundError } from './shared-types';

export interface PeriodicMessageService {
  /**
   * 创建定时消息任务。INSERT periodic_messages (enabled=true, next_run_at=NOW())。
   * @param serverId 目标服务器 ID
   * @param message 消息内容（1-500 字符）
   * @param intervalMinutes 发送间隔（分钟），1-10080
   */
  createMessage(
    serverId: string,
    message: string,
    intervalMinutes: number,
  ): Promise<PeriodicMessage>;

  /**
   * 列出服务器的全部定时消息任务。
   */
  listMessages(serverId: string): Promise<PeriodicMessage[]>;

  /**
   * 启用/禁用定时消息。
   * @throws {MessageNotFoundError} messageId 不存在
   */
  toggleMessage(messageId: number, enabled: boolean): Promise<void>;

  /**
   * 删除定时消息。
   * @throws {MessageNotFoundError} messageId 不存在
   */
  deleteMessage(messageId: number): Promise<void>;

  /**
   * 处理到期消息。由 scheduler 周期调用：
   *   1. 查询 next_run_at <= NOW() 且 enabled=true 的消息
   *   2. 按 Pack.business.chat_enhancement.periodic_messages.broadcast_command 渲染
   *   3. 通过 commandDispatcher 下发 broadcast 命令
   *   4. 更新 next_run_at = NOW() + interval_minutes
   */
  processDueMessages(): Promise<void>;
}

export { MessageNotFoundError } from './shared-types';
