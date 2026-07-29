/**
 * vote-service.d.ts — voteService 接口存根
 *
 * 职责：投票踢人状态机（active → passed/failed/cancelled）
 * 数据契约：public/schema/votes-schema.json / vote-records-schema.json
 * 来源：scheme-final-merged.md §5.4 聊天增强 P4 / §3.5 vote_kick / §7.1 P3
 */

import {
  VoteNotFoundError,
  VoteAlreadyClosedError,
  VoteThresholdNotMetError,
} from './shared-types';

export interface VoteService {
  /**
   * 发起投票踢人。
   * INSERT votes (status=active) + vote_settings 读取阈值与时长。
   * @param serverId 目标服务器 ID
   * @param initiator 投票发起者游戏内玩家名
   * @param target 被投票目标玩家名（kick 对象）
   * @param reason 投票原因（实际 kick reason = vote_settings.reason_prefix + ' ' + reason）
   * @returns {voteId, duration} voteId 为投票记录 ID；duration 为投票时长（秒）
   */
  startVote(
    serverId: string,
    initiator: string,
    target: string,
    reason: string,
  ): Promise<{ voteId: number; duration: number }>;

  /**
   * 投票。INSERT vote_records (UNIQUE(vote_id, voter) 防重复)。
   * @param choice 'yes' 赞成 / 'no' 反对
   * @throws {VoteNotFoundError} voteId 不存在
   * @throws {VoteAlreadyClosedError} 投票已结束（非 active 状态）
   */
  castVote(voteId: number, voter: string, choice: 'yes' | 'no'): Promise<void>;

  /**
   * 检查阈值。
   * @returns {passed, yesCount, noCount, threshold} passed=true 表示已达通过阈值
   * @throws {VoteNotFoundError} voteId 不存在
   */
  checkThreshold(
    voteId: number,
  ): Promise<{ passed: boolean; yesCount: number; noCount: number; threshold: number }>;

  /**
   * 执行 kick。达阈值后按 Pack.business.chat_enhancement.vote_kick.kick_command 渲染命令，
   * 通过 commandDispatcher 下发到 Daemon。
   * @returns {success, message} success=true 表示 kick 命令已发送
   * @throws {VoteNotFoundError} voteId 不存在
   * @throws {VoteThresholdNotMetError} 未达通过阈值
   * @throws {VoteAlreadyClosedError} 投票已结束
   */
  executeKick(voteId: number): Promise<{ success: boolean; message: string }>;

  /**
   * 取消投票（发起者撤回或管理员干预）。UPDATE votes SET status='cancelled'。
   * @throws {VoteNotFoundError} voteId 不存在
   * @throws {VoteAlreadyClosedError} 投票已结束
   */
  cancelVote(voteId: number, reason: string): Promise<void>;
}

export {
  VoteNotFoundError,
  VoteAlreadyClosedError,
  VoteThresholdNotMetError,
} from './shared-types';
