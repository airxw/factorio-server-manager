/**
 * admin-wallet-service.d.ts — adminWalletService 接口存根
 *
 * 职责：腐竹（instance_admin）跨实例聚合账户管理 / 充值加款 / 提现申请与审批 / 资源费扣款（事务+行锁）
 * 数据契约：
 *   - public/schema/admin-wallets-schema.json（腐竹账户主表）
 *   - public/schema/admin-wallet-transactions-schema.json（流水审计表）
 *   - public/schema/instance-renewals-schema.json（续费记录，wallet_source='admin_wallets'）
 * 来源：docs/plans/role-permission-economy-system-plan.md §3.3 / §4.3 / §4.4（决策 D1/D2/D3）
 *
 * 设计要点：
 * - 一腐竹一账户：UNIQUE(admin_user_id)，首次访问管理后台自动创建（balance=0）
 * - 账户隔离：admin_wallets 与 user_wallets 物理隔离，禁止互转（防洗钱）
 * - 冻结期：分账资金先入 pending_balance（T+7），仅 balance 可消费/提现
 * - 并发安全：余额变更必须 DB 事务（BEGIN → 校验 → 扣款 → 写流水 → COMMIT）+ 行锁（SELECT ... FOR UPDATE）
 * - 审计完备：所有流水写 admin_wallet_transactions（含 balance_after / pending_balance_after 快照），同步写 audit_logs
 *
 * 调度任务（见 scheduler.d.ts）：
 *   - SETTLEMENT_RUNNER（每小时）：分账结算扫描（settlementService 承载）
 *   - PENDING_BALANCE_RELEASER（每小时）：冻结期满释放（settlementService 承载）
 */

import type {
  AdminWallet,
  AdminWalletInfo,
  AdminWalletTransaction,
  AdminWalletTransactionStatus,
  AdminRenewInstanceInput,
  AdminRenewInstanceResult,
  WithdrawalRequestInput,
} from './shared-types';
import {
  AdminWalletNotFoundError,
  AdminWalletInsufficientBalanceError,
  AdminWalletPendingNotSpendableError,
  AdminWalletTransferForbiddenError,
  AdminTierNotFoundError,
  SelfHostedNodeNotApprovedError,
  WithdrawalNotFoundError,
  WithdrawalNotPendingError,
  WithdrawalBelowMinAmountError,
} from './shared-types';

/**
 * 提现申请状态机（提现申请单为服务层内嵌结构，不独立建表；记录于 admin_wallet_transactions + metadata）
 *
 * 存储映射（admin-wallet-transactions-schema.json）：
 *   - 申请：transaction_type='withdraw', source_type='withdrawal', status='pending', metadata={payout_info, note}
 *   - 审批通过：status 保持 'pending'（等待线下转账），metadata 追加 {approved: true, processed_by, admin_note}
 *   - 审批拒绝：status='failed'，同时新增一条 credit 流水退回 balance，metadata.admin_note 记录拒绝原因
 *   - 线下转账完成：status='completed', completed_at 写入
 * 服务层 approved/rejected 为存储层 pending/failed 的细分视图，由 metadata.approved 区分。
 */
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'completed';

/** 提现申请单（adminWalletService.requestWithdrawal 返回 / 审批操作对象） */
export interface WithdrawalRequest {
  id: number;
  admin_user_id: string;
  amount: number;
  /** 收款方式快照（JSON 字符串，敏感字段；前端渲染用 SensitiveInput） */
  payout_info: string;
  note: string | null;
  status: WithdrawalStatus;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  admin_note: string | null;
  completed_at: string | null;
}

export interface AdminWalletService {
  // ===== 账户查询 =====

  /**
   * 获取或创建腐竹账户（首次访问管理后台自动创建，balance=0 / pending_balance=0）。
   * 对外暴露，供路由层 / settlementService 调用。
   * @param adminUserId 腐竹用户 ID（必须 roles 含 instance_admin）
   * @throws {AdminWalletNotFoundError} 仅在极端情况（插入后查询失败）抛出
   */
  getOrCreateAdminWallet(adminUserId: string): Promise<AdminWallet>;

  /**
   * 查询腐竹钱包信息（含等级 / 可提现金额）。
   * GET /api/admin/wallet（instance_admin 查自己；server_admin 可查任意腐竹）
   */
  getWalletInfo(adminUserId: string): Promise<AdminWalletInfo>;

  /**
   * 查询流水列表（分页/筛选）。
   * GET /api/admin/wallet/transactions
   * @param filter 筛选条件；instance_admin 强制 admin_user_id=自己
   */
  listTransactions(
    adminUserId: string,
    filter?: {
      transaction_type?: string;
      source_type?: string;
      status?: AdminWalletTransactionStatus;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: AdminWalletTransaction[]; total: number }>;

  // ===== 资金变动（内部原子操作，供 settlementService / instanceRenewalService 调用） =====

  /**
   * 扣款（资源费/手续费）。原子操作：balance -= amount, total_spent += amount + 写流水。
   * 必须 DB 事务 + 行锁（SELECT ... FOR UPDATE）。
   * @throws {AdminWalletInsufficientBalanceError} 余额不足（HTTP 402）
   * @throws {AdminWalletNotFoundError} 账户不存在（需先 getOrCreateAdminWallet）
   */
  debit(adminUserId: string, amount: number, sourceRef: string, metadata?: string): Promise<void>;

  /**
   * 加款到可用余额（腐竹充值/平台赠送/退款回滚）。原子操作：balance += amount + 写流水。
   * @param sourceType 仅限 'recharge' | 'gift' | 'refund' | 'adjustment'
   * @throws {AdminWalletNotFoundError} 账户不存在
   */
  credit(
    adminUserId: string,
    amount: number,
    sourceType: 'recharge' | 'gift' | 'refund' | 'adjustment',
    sourceRef: string,
    metadata?: string,
  ): Promise<void>;

  /**
   * 分账入账到冻结余额（仅 settlementService 调用）。
   * 原子操作：pending_balance += amount（先抵扣 owed_amount）+ 写流水（type=freeze/settle）。
   * @throws {AdminWalletNotFoundError} 账户不存在
   */
  creditPending(adminUserId: string, amount: number, sourceRef: string, metadata?: string): Promise<void>;

  /**
   * 冻结期满释放（仅 settlementService.pendingBalanceReleaser 调用）。
   * 原子操作：pending_balance -= amount, balance += amount + 写流水（type=unfreeze）。
   * @throws {AdminWalletNotFoundError} 账户不存在
   */
  releasePending(adminUserId: string, amount: number, sourceRef: string): Promise<void>;

  // ===== 腐竹续费自有实例（扣 admin_wallets） =====

  /**
   * 腐竹续费自有实例（POST /api/admin/wallet/renew-instance）。
   * 流程：
   *   1. 校验实例归属（owner_user_id = adminUserId）
   *   2. 查询实例节点来源：
   *      - node_source=self_hosted 且 approval_status='approved' → amount_paid=0 豁免（platform_fee.exempt）
   *      - node_source=self_hosted 且 approval_status != 'approved' → 抛 SelfHostedNodeNotApprovedError（D4 审核闸门，未过审不得豁免）
   *      - node_source=platform_managed → 进入步骤 3 计费
   *   3. 折扣链：阶梯折扣（tier_discounts）× 腐竹等级折扣（admin_tiers.resource_fee_discount）
   *   4. 扣款 debit（platform_managed 且 amount_paid>0 时）
   *   5. 写 instance_renewals（wallet_source='admin_wallets' + admin_tier_discount_applied + node_source_at_renewal 快照）
   *   6. 延长 servers.expires_at = max(old_expires_at, now) + duration_days
   * @throws {AdminWalletInsufficientBalanceError} 余额不足（HTTP 402，实例保留 7 天宽限期）
   * @throws {AdminTierNotFoundError} 腐竹等级配置缺失
   * @throws {SelfHostedNodeNotApprovedError} 自带节点未通过 server_admin 审核（approval_status != 'approved'）
   */
  renewOwnInstance(adminUserId: string, input: AdminRenewInstanceInput): Promise<AdminRenewInstanceResult>;

  // ===== 提现 =====

  /**
   * 腐竹提现申请（POST /api/admin/wallet/withdraw）。
   * 校验：amount ≤ balance（pending_balance 不可提现）且 amount ≥ withdrawal_min_amount（配置契约）。
   * 申请后立即冻结等额 balance（防重复提现），写流水（type=withdraw, status=pending）。
   * @throws {AdminWalletInsufficientBalanceError} 可提现余额不足
   * @throws {AdminWalletPendingNotSpendableError} 尝试提现 pending_balance
   * @throws {WithdrawalBelowMinAmountError} 低于最低提现限额
   */
  requestWithdrawal(adminUserId: string, input: WithdrawalRequestInput): Promise<WithdrawalRequest>;

  /**
   * 提现审批通过（POST /api/admin/withdrawals/:id/approve，仅 server_admin）。
   * 流程：status=approved → 平台线下转账 → status=completed, total_withdrawn += amount。
   * @throws {WithdrawalNotFoundError} 申请不存在
   * @throws {WithdrawalNotPendingError} 非 pending 状态
   */
  approveWithdrawal(withdrawalId: number, processedBy: string, adminNote?: string): Promise<WithdrawalRequest>;

  /**
   * 提现审批拒绝（POST /api/admin/withdrawals/:id/reject，仅 server_admin）。
   * 流程：status=rejected + 解冻等额 balance（退回可提现余额）+ 写流水（type=withdraw, status=reversed）。
   * @throws {WithdrawalNotFoundError} 申请不存在
   * @throws {WithdrawalNotPendingError} 非 pending 状态
   */
  rejectWithdrawal(withdrawalId: number, processedBy: string, adminNote: string): Promise<WithdrawalRequest>;

  /**
   * 查询提现申请列表（instance_admin 查自己；server_admin 查全部，可按 status 筛选）。
   */
  listWithdrawals(
    adminUserId: string | null,
    filter?: { status?: WithdrawalStatus; limit?: number; offset?: number },
  ): Promise<{ items: WithdrawalRequest[]; total: number }>;
}

export {
  AdminWalletNotFoundError,
  AdminWalletInsufficientBalanceError,
  AdminWalletPendingNotSpendableError,
  AdminWalletTransferForbiddenError,
  AdminTierNotFoundError,
  SelfHostedNodeNotApprovedError,
  WithdrawalNotFoundError,
  WithdrawalNotPendingError,
  WithdrawalBelowMinAmountError,
} from './shared-types';
