/**
 * recharge-cdk-service.d.ts — rechargeCdkService 接口存根
 *
 * 职责：充值 CDK 批次管理 / 用户兑换（卡商机制，决策 V2）
 * 数据契约：
 *   - public/schema/recharge-cdks-schema.json
 *   - public/schema/recharge-cdk-batches-schema.json
 * 来源：docs/plans/business-logic-system-completion-plan.md §4.1 步骤 1（决策 V2）
 *
 * 机制说明（决策 V2）：
 *   - 不接入第三方支付，通过"卡商机制"实现充值闭环
 *   - 系统管理员批量生成充值 CDK（指定面值/数量/过期时间）
 *   - 卡商线下向平台付费购买 CDK 批次，转卖给玩家
 *   - 玩家在钱包页输入 CDK 码，校验后点券入账 user_wallets.balance
 *
 * 兑换流程（乐观锁，与 cdkService.redeem 一致）：
 *   1. 乐观锁 UPDATE recharge_cdks SET status='claiming', claiming_locked_at=now
 *      WHERE code=? AND status='unused' AND expires_at > now
 *      失败（rows=0）→ 抛 RechargeCdkInvalidError 或 RechargeCdkAlreadyRedeemedError
 *   2. 调用 walletService.credit(userId, serverId, face_value, 'RECHARGE_CDK_REDEEMED')
 *   3. 成功 → UPDATE status='used', claimed_by=userId, claimed_at=now
 *   4. 失败 → 回滚 status='unused', 清空 claiming_locked_at
 *   5. 写入 audit_logs（事件类型 RECHARGE_CDK_REDEEMED）
 *
 * 超时回滚（调度任务复用既有 OPTIMISTIC_LOCK_CLEANUP）：
 *   - claiming_locked_at + 5min < now → 回滚为 unused
 */

import type {
  RechargeCdk,
  RechargeCdkBatch,
  RechargeCdkStatus,
  RechargeCdkCreateBatchInput,
  RechargeCdkListFilter,
} from './shared-types';
import {
  RechargeCdkInvalidError,
  RechargeCdkAlreadyRedeemedError,
  RechargeCdkBatchNotFoundError,
  RechargeCdkBatchCreateFailedError,
  RechargeCdkExpiredError,
} from './shared-types';

export interface RechargeCdkService {
  /**
   * 创建充值 CDK 批次（POST /api/recharge-cdks/batches，管理员）。
   *
   * 流程：
   *   1. 写入 recharge_cdk_batches（total_count / face_value / expires_at）
   *   2. 批量生成 total_count 个 code（^[A-Za-z0-9]{8,32}$，UNIQUE）
   *   3. 批量插入 recharge_cdks（status='unused', batch_id=新批次 id）
   *   4. 写入 audit_logs（事件类型 RECHARGE_CDK_BATCH_CREATED）
   *
   * @param input 批次创建输入（batch_name / total_count / face_value / expires_at）
   * @param createdBy 创建者用户 ID（系统管理员）
   * @returns 创建的批次 + 生成的 CDK 列表
   * @throws {RechargeCdkBatchCreateFailedError} 批次参数校验失败（total_count 超限等）
   */
  createBatch(
    input: RechargeCdkCreateBatchInput,
    createdBy: string,
  ): Promise<{ batch: RechargeCdkBatch; codes: RechargeCdk[] }>;

  /**
   * 查询批次列表（GET /api/recharge-cdks/batches，管理员）。
   * @param filter 过滤条件（status / created_after / created_before）
   * @returns 批次列表（含 used_count 进度）
   */
  listBatches(filter?: RechargeCdkListFilter): Promise<RechargeCdkBatch[]>;

  /**
   * 查询批次下 CDK 列表（GET /api/recharge-cdks/batches/:id/codes，管理员）。
   * 支持状态过滤与 CSV 导出。
   * @param batchId 批次 ID
   * @param statusFilter 状态过滤（可选）
   * @returns CDK 列表
   * @throws {RechargeCdkBatchNotFoundError} 批次不存在
   */
  listCodesByBatch(
    batchId: number,
    statusFilter?: RechargeCdkStatus,
  ): Promise<RechargeCdk[]>;

  /**
   * 用户兑换充值 CDK（POST /api/wallet/recharge-cdk/redeem）。
   *
   * 流程（乐观锁，见文件头注释）：
   *   1. 乐观锁抢占 unused → claiming
   *   2. walletService.credit 加款
   *   3. 更新 status='used'
   *   4. 写入 audit_logs
   *
   * @param code 充值 CDK 码（玩家输入）
   * @param userId 兑换者用户 ID
   * @param serverId 实例 ID（钱包按实例作用域）
   * @returns 兑换结果（面值 / 新余额）
   * @throws {RechargeCdkInvalidError} CDK 不存在
   * @throws {RechargeCdkAlreadyRedeemedError} CDK 已兑换或正在兑换中
   * @throws {RechargeCdkExpiredError} CDK 已过期
   */
  redeem(
    code: string,
    userId: string,
    serverId: string,
  ): Promise<{ face_value: number; new_balance: number; batch_id: number }>;

  /**
   * 回滚超时 claiming 状态的 CDK（调度任务调用）。
   * 触发条件：status='claiming' AND claiming_locked_at + 5min < now
   * @returns 回滚数量
   */
  rollbackStaleClaiming(): Promise<{ rolled_back: number }>;

  /**
   * 归档批次（POST /api/recharge-cdks/batches/:id/archive，管理员）。
   * 已归档批次不再展示在卡商列表，但保留审计记录。
   * @param batchId 批次 ID
   * @param archivedBy 归档操作者
   * @throws {RechargeCdkBatchNotFoundError} 批次不存在
   */
  archiveBatch(batchId: number, archivedBy: string): Promise<void>;
}

export {
  RechargeCdkInvalidError,
  RechargeCdkAlreadyRedeemedError,
  RechargeCdkBatchNotFoundError,
  RechargeCdkBatchCreateFailedError,
  RechargeCdkExpiredError,
} from './shared-types';
