/**
 * wallet-service.d.ts — walletService 接口存根（完整契约，含既有方法 + v1 新增方法）
 *
 * 职责：用户钱包管理 / VIP 每日点券奖励 / 退款 / 月度账单 / 日快照
 * 数据契约：
 *   - public/schema/user-wallets-schema.json（钱包主表）
 *   - public/schema/wallet-refund-orders-schema.json（v1 新增：退款申请）
 *   - public/schema/wallet-daily-snapshots-schema.json（v1 新增：日快照）
 * 来源：
 *   - 既有实现：panel/backend/src/services/walletService.ts（v3.2.0 经济系统改造）
 *   - v1 扩展：docs/plans/business-logic-system-completion-plan.md §4.1 步骤 2、3
 *
 * 设计要点：
 * - 钱包按实例作用域：UNIQUE(user_id, server_id)，余额在 A 服不能在 B 服使用
 * - getOrCreateWallet：首次访问自动创建钱包（balance=0）
 * - claimDailyReward：基于 VIP 等级阶梯金额（VIP0=100, VIP1=200, VIP2=400, VIP3=800, VIP4=1600, VIP5=3200）
 * - debit/credit/refund：原子操作，更新 balance + total_earned/total_spent
 *
 * 调度任务（v1 新增）：
 *   - WALLET_DAILY_SNAPSHOT (cron '0 1 * * *')：每日凌晨 1 点快照
 *   - WALLET_SNAPSHOT_CLEANUP (cron '0 5 * * *')：每日凌晨 5 点清理 90 天前快照
 */

import type { UserWallet, WalletInfo, WalletRefundOrder, WalletDailySnapshot, RefundOrderStatus } from './shared-types';
import {
  WalletNotFoundError,
  InsufficientBalanceError,
  DailyRewardAlreadyClaimedError,
  RefundOrderNotFoundError,
  RefundOrderNotPendingError,
  OrderNotRefundableError,
  RefundAmountExceedsLimitError,
} from './shared-types';

export interface WalletService {
  // ===== 既有方法（v3.2.0 实现，本次首次发布契约） =====

  /**
   * 获取或创建钱包（首次访问自动创建，balance=0）。
   * 对外暴露，供路由层 / shopService / rechargeCdkService 调用。
   * @throws {WalletNotFoundError} 仅在极端情况（插入后查询失败）抛出
   */
  getOrCreateWallet(userId: string, serverId: string): Promise<UserWallet>;

  /**
   * 查询钱包信息（含 can_claim_daily 状态 + 当前 VIP 等级的 daily_reward_amount）。
   * @param userRole 用户角色（用于 VIP 等级融合判定）
   */
  getWalletInfo(userId: string, serverId: string, userRole: string): Promise<WalletInfo>;

  /**
   * 领取每日点券奖励（基于 VIP 等级阶梯金额）。
   * 防重领：按 last_daily_claim_date 判断今日是否已领取。
   * @returns { amount, new_balance } 领取金额 + 新余额
   * @throws {DailyRewardAlreadyClaimedError} 今日已领取
   */
  claimDailyReward(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<{ amount: number; new_balance: number }>;

  /**
   * 扣款（供 shopService.createOrder / cdkService.redeem / instanceExpiryService.renewInstance 调用）。
   * 原子操作：balance -= amount, total_spent += amount。
   * @throws {InsufficientBalanceError} 余额不足
   * @throws {WalletNotFoundError} 钱包不存在（需先 getOrCreateWallet）
   */
  debit(userId: string, serverId: string, amount: number): Promise<void>;

  /**
   * 加款（供 rechargeCdkService.redeem / walletService.refund 调用）。
   * 原子操作：balance += amount, total_earned += amount。
   * @throws {WalletNotFoundError} 钱包不存在
   */
  credit(userId: string, serverId: string, amount: number): Promise<void>;

  /**
   * 退款（供 walletService.approveRefund 内部调用）。
   * 原子操作：balance += amount, total_earned += amount（退款计入获得而非冲减消费）。
   * @throws {WalletNotFoundError} 钱包不存在
   */
  refund(userId: string, serverId: string, amount: number): Promise<void>;

  // ===== v1 新增方法（退款流程 + 月度账单 + 日快照） =====

  /**
   * 发起退款申请（POST /api/wallet/refund/request）。
   * @param userId 申请人
   * @param serverId 实例 ID
   * @param amount 退款金额
   * @param reason 退款原因
   * @param orderId 关联订单 ID（可空，null=直接申请余额退款）
   * @returns 退款申请记录
   * @throws {RefundAmountExceedsLimitError} 退款金额超过 system_config.wallet.refund_max_amount
   * @throws {OrderNotRefundableError} 订单已领取（status != 'pending'）
   */
  requestRefund(
    userId: string,
    serverId: string,
    amount: number,
    reason: string,
    orderId?: number | null,
  ): Promise<WalletRefundOrder>;

  /**
   * 管理员审批退款（POST /api/wallet/refund/:id/approve）。
   * 流程：
   *   1. 更新 wallet_refund_orders.status='approved', processed_at, processed_by
   *   2. 调用 walletService.refund 加款到 user_wallets.balance
   *   3. 更新 status='completed', completed_at
   *   4. 写入 audit_logs
   *
   * 注：积分不扣减（决策 V1：积分只升不降，避免退款产生负向体验）。
   *     退款产生的积分"漂移"由 v2 评估是否引入积分过期机制。
   *
   * @throws {RefundOrderNotFoundError} 退款申请不存在
   * @throws {RefundOrderNotPendingError} 退款申请非 pending 状态
   */
  approveRefund(
    refundId: number,
    processedBy: string,
    adminNote?: string,
  ): Promise<WalletRefundOrder>;

  /**
   * 管理员拒绝退款（POST /api/wallet/refund/:id/reject）。
   * @throws {RefundOrderNotFoundError} 退款申请不存在
   * @throws {RefundOrderNotPendingError} 退款申请非 pending 状态
   */
  rejectRefund(
    refundId: number,
    processedBy: string,
    adminNote: string,
  ): Promise<WalletRefundOrder>;

  /**
   * 查询退款申请列表（管理员后台）。
   */
  listRefundOrders(filter?: {
    user_id?: string;
    server_id?: string;
    status?: RefundOrderStatus;
  }): Promise<WalletRefundOrder[]>;

  /**
   * 获取月度账单（GET /api/wallet/bill?year=&month=）。
   * 聚合当月 shop_orders（消费）+ recharge_cdks（充值）+ wallet_refund_orders（退款）。
   * @returns 结构化账单（含收支明细 + 余额变化曲线）
   */
  getMonthlyBill(
    userId: string,
    serverId: string,
    year: number,
    month: number,
  ): Promise<{
    opening_balance: number;
    closing_balance: number;
    total_recharged: number;
    total_spent: number;
    total_refunded: number;
    transactions: Array<{
      type: 'recharge' | 'purchase' | 'refund' | 'daily_reward';
      amount: number;
      description: string;
      timestamp: string;
    }>;
    balance_curve: Array<{ date: string; balance: number }>;
  }>;

  /**
   * 每日钱包快照（调度任务 WALLET_DAILY_SNAPSHOT，cron '0 1 * * *'）。
   * 快照所有 active 钱包的余额到 wallet_daily_snapshots 表。
   * @returns 快照数量
   */
  snapshotAllWallets(): Promise<{ snapshotted: number }>;

  /**
   * 清理旧快照（调度任务 WALLET_SNAPSHOT_CLEANUP，cron '0 5 * * *'）。
   * 保留 90 天（可由 system_config.wallet.snapshot_retention_days 配置），超期清理。
   * @param retentionDays 保留天数（默认 90，由调用方从 system_config 读取传入）
   * @returns 清理数量
   */
  cleanupOldSnapshots(retentionDays?: number): Promise<{ cleaned: number }>;
}

export {
  WalletNotFoundError,
  InsufficientBalanceError,
  DailyRewardAlreadyClaimedError,
  RefundOrderNotFoundError,
  RefundOrderNotPendingError,
  OrderNotRefundableError,
  RefundAmountExceedsLimitError,
} from './shared-types';
