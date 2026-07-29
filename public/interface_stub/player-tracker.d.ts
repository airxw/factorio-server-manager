/**
 * player-tracker.d.ts — playerTracker 接口存根
 *
 * 职责：玩家在线状态跟踪 / 登录历史记录
 * 数据契约：public/schema/player-histories-schema.json
 * 来源：scheme-final-merged.md §4.2.2 P3 / §5.4 / §7.1 P3
 *
 * 设计说明：本服务不抛出业务异常，DB 写入失败时静默记录日志（不影响主流程）
 */

import type { PlayerHistory } from './shared-types';

export interface PlayerTracker {
  /**
   * 记录玩家加入。INSERT player_histories (left_at=null)。
   * @param serverId 目标服务器 ID
   * @param player 加入的玩家名
   * @param ip 玩家 IP（部分游戏不暴露，可空）
   */
  recordJoin(serverId: string, player: string, ip?: string): Promise<void>;

  /**
   * 记录玩家离开。UPDATE 最近一条 left_at=null 的记录，置 left_at=NOW()，
   * 并计算 session_duration。
   */
  recordLeave(serverId: string, player: string): Promise<void>;

  /**
   * 获取当前在线玩家列表（player_histories 中 left_at=null 的玩家）。
   */
  getOnlinePlayers(serverId: string): Promise<string[]>;

  /**
   * 获取玩家登录历史（按时间倒序）。
   */
  getPlayerHistory(serverId: string, player: string): Promise<PlayerHistory[]>;
}
