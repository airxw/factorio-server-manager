/**
 * cdk-service.d.ts — cdkService 接口存根
 *
 * 职责：CDK 批量生成 / 兑换（乐观锁）/ 命令下发
 * 数据契约：public/schema/cdk-codes-schema.json
 * 来源：scheme-final-merged.md §5.2 CDK 兑换 / §7.1 P2
 */

import type { CdkCode, CdkItemInput, CdkItemOutput, CdkStatus } from './shared-types';
import { CdkCodeInvalidError, CdkAlreadyRedeemedError, CommandRenderError, InsufficientBalanceError } from './shared-types';

export interface CdkService {
  /**
   * 批量生成 CDK。
   * 写入 cdk_codes (status=unused)，code 随机生成（^[A-Za-z0-9_-]{4,64}$）。
   * @param serverId 目标服务器 ID
   * @param item 物品定义（item_name / count / quality?）
   * @param count 生成数量
   * @param createdBy 创建者用户 ID（一般为管理员）
   * @returns 生成的 CDK 列表
   */
  generateCodes(
    serverId: string,
    item: CdkItemInput,
    count: number,
    createdBy: string,
  ): Promise<CdkCode[]>;

  /**
   * 兑换 CDK（v4.x 扩展：支持付费 CDK，乐观锁）。
   * 流程（scheme §5.2）：
   *   1. 乐观锁 UPDATE cdk_codes SET status='claiming' WHERE code=? AND status='unused'
   *      失败（rows=0）→ 抛 CdkAlreadyRedeemedError 或 CdkCodeInvalidError
   *   2. 按 Pack.business.cdk.redeem_command 渲染命令
   *   3. 通过 commandDispatcher 下发到 Daemon
   *   4. 全部成功 → status='claimed'；失败 → 回滚 status='unused'
   *
   * 付费 CDK 流程（cdk_codes.price > 0，v1 新增）：
   *   1. 乐观锁抢占 unused → claiming
   *   2. 校验钱包余额 ≥ price
   *   3. walletService.debit 扣款
   *   4. 按 Pack.business.cdk.redeem_command 渲染命令并下发
   *   5. 成功 → status='claimed'；失败 → walletService.credit 退还 + 回滚 status='unused'
   *
   * 免费 CDK 流程（cdk_codes.price = 0）：
   *   沿用既有逻辑，无扣款步骤
   *
   * @param code CDK 兑换码（玩家在游戏内输入 '!redeem <code>'）
   * @param gamePlayerName 兑换的游戏内玩家名
   * @param userId 兑换者用户 ID（v1 新增，可选）。付费 CDK 必填，免费 CDK 可空
   * @returns {success, message, items?, amount_paid?} items 为本次兑换的物品清单；amount_paid 为付费 CDK 扣款金额（v1 新增）
   * @throws {CdkCodeInvalidError} CDK 不存在或已过期
   * @throws {CdkAlreadyRedeemedError} CDK 已兑换或正在兑换中
   * @throws {CommandRenderError} 命令模板渲染失败
   * @throws {InsufficientBalanceError} 钱包余额不足（付费 CDK，v1 新增）
   */
  redeem(
    code: string,
    gamePlayerName: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string; items?: CdkItemOutput[]; amount_paid?: number }>;

  /**
   * 查询 CDK 列表。可按状态过滤。
   */
  listCodes(serverId: string, status?: CdkStatus): Promise<CdkCode[]>;

  /**
   * 删除 CDK（仅允许删除 unused / expired 状态）。
   */
  deleteCode(codeId: number): Promise<void>;
}

export {
  CdkCodeInvalidError,
  CdkAlreadyRedeemedError,
  CommandRenderError,
  InsufficientBalanceError,
} from './shared-types';
