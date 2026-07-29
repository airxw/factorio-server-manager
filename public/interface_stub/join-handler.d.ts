/**
 * join-handler.d.ts — joinHandler 接口存根
 *
 * 职责：玩家加入处理 / 欢迎礼包发放 / !verify 玩家绑定验证
 * 数据契约：scheme-final-merged.md §4.3.4 player_bindings / §5.4 聊天增强 P1
 *
 * 修复 note：scheme §8.1 R10 指出 factorio joinHandler 字段名 level 应为 vip_level，迁移时直接修复
 */

import { VerifyCodeInvalidError, GiftAlreadyClaimedError } from './shared-types';

export interface JoinHandler {
  /**
   * 处理玩家加入事件。
   * 流程（scheme §5.4）：
   *   1. 查 player_join_settings 是否启用欢迎礼包
   *   2. 启用则按 Pack.business.chat_enhancement.welcome.first_gift_command 渲染命令
   *   3. 通过 commandDispatcher 下发
   *   4. INSERT gift_claims（防重复领取）
   *   5. playerTracker.recordJoin
   * @param serverId 目标服务器 ID
   * @param player 加入的玩家名
   */
  handleJoin(serverId: string, player: string): Promise<void>;

  /**
   * 处理 !verify 命令。校验 verify_code 后将 player_bindings.status 置为 verified。
   * 不下发游戏命令（scheme §3.5 verify 说明）。
   * @returns {success, message} success=true 表示验证通过
   * @throws {VerifyCodeInvalidError} 验证码错误或已过期
   */
  handleVerify(
    player: string,
    code: string,
  ): Promise<{ success: boolean; message: string }>;

  /**
   * 发送欢迎礼包。
   * @returns {success, message} success=false 时 message 给出原因（如已领取）
   * @throws {GiftAlreadyClaimedError} 该玩家已领取过欢迎礼包
   */
  sendWelcomeGift(
    serverId: string,
    player: string,
  ): Promise<{ success: boolean; message: string }>;

  /**
   * 生成玩家绑定验证码（6 位）。写入 player_bindings (status=pending)。
   * @returns 6 位验证码字符串
   */
  generateVerifyCode(userId: string): Promise<string>;
}

export { VerifyCodeInvalidError, GiftAlreadyClaimedError } from './shared-types';
