/**
 * chat-monitor.d.ts — chatMonitor 接口存根
 *
 * 职责：订阅 Daemon stdout → 按 Pack.event_parsers 解析 → 路由到业务命令
 * 数据契约：scheme-final-merged.md §3.4 event_parsers / §5.4 聊天增强数据流 / §2.3.1
 *
 * 关键约束：Daemon 不解析事件，仅转发原始 stdout；Panel 端按 Pack 吸收日志格式差异
 */

import type { GamePack, ParsedEvent, ChatEvent } from './shared-types';

export interface ChatMonitor {
  /**
   * 解析 stdout 日志行。按 serverId 关联的 Pack.event_parsers 正则匹配。
   * 三种事件类型：chat / join / leave，匹配失败返回 null。
   * @param serverId 目标服务器 ID（用于查找关联 Pack）
   * @param line 原始 stdout 行
   * @param pack 服务器关联的 GamePack（含 event_parsers）
   * @returns 解析结果；未匹配返回 null
   */
  parseStdout(serverId: string, line: string, pack: GamePack): ParsedEvent | null;

  /**
   * 处理聊天事件。检测命令前缀（!verify / !claim / !redeem / !vote）并路由到对应业务服务。
   * 非命令的普通聊天仅记录日志。
   * @param serverId 目标服务器 ID
   * @param event 结构化聊天事件
   */
  handleChatEvent(serverId: string, event: ChatEvent): Promise<void>;

  /**
   * 命令路由。根据 message 前缀分发到 joinHandler / shopService / cdkService / voteService。
   * @param serverId 目标服务器 ID
   * @param player 发命令的玩家名
   * @param message 完整消息（含 ! 前缀）
   */
  routeCommand(serverId: string, player: string, message: string): Promise<void>;

  /**
   * 订阅 Daemon stdout 流。注册回调，每收到 console.output 事件触发。
   * chatMonitor 内部对每行调用 parseStdout → 派发到 handleChatEvent / joinHandler。
   * @param callback 行级回调
   */
  subscribeStdout(serverId: string, callback: (line: string) => void): void;
}

// 重新导出类型供消费方使用
export type { ParsedEvent, ChatEvent } from './shared-types';
