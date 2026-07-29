// ============================================================================
// balanceService — 全局余额管理（冻结/解冻/可用余额校验/充值上限/账期时间戳）
// 数据契约：docs/plans/user-center-consolidation-plan.md §2.2 global_balances
//           §6.1 wallet_transactions（所有变动写入流水）
// 表结构：  global_balances（user_id PK）、wallet_transactions
//
// 设计要点：
// - 全局余额按用户维度（不按实例），可用余额 = balance - frozen_balance
// - 所有写操作（credit/debit/freeze/unfreeze/unfreezeAndDebit）均写 wallet_transactions
// - debit/freeze 采用原子 UPDATE ... WHERE (balance - frozen_balance) >= amount 防并发超扣
// - credit 视为收入类交易，自动更新 last_income_at（提现账期检查依据）
// - 流水 amount 为带符号整数：收入为正、支出/冻结为负；balance_after 为操作后 balance
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import {
  InsufficientBalanceError,
  InsufficientFrozenBalanceError,
  ValidationError,
} from './errors.js';

// ----- 共享流水类型（与 wallet_transactions.type CHECK 约束一致） -----

/** wallet_transactions.type 枚举（与表 CHECK 约束一致）
 * 注：模块B（数据层迁移）需同步扩展 DB wallet_transactions.type CHECK 约束追加 'instance_billing' */
export type WalletTxType =
  | 'daily_reward'
  | 'shop_purchase'
  | 'shop_refund'
  | 'cdk_recharge'
  | 'admin_credit'
  | 'admin_debit'
  | 'vip_purchase'
  | 'points_exchange'
  | 'cdk_generate'
  | 'cdk_redeem'
  | 'cdk_refund'
  | 'withdraw'
  | 'integral_earn'
  | 'integral_decay'
  | 'integral_adjust'
  | 'gift'
  | 'system'
  | 'instance_billing'; // v3-billing 新增：VPS 式实例预付费计费扣款/收款

/** wallet_transactions.currency_type 枚举 */
export type WalletCurrencyType = 'balance' | 'points' | 'integral';

/** 流水写入参数（各服务 writeTransaction 统一模式） */
export interface WalletTxParams {
  userId: string;
  serverId?: string | null;
  currencyType: WalletCurrencyType;
  type: WalletTxType;
  /** 带符号金额：收入为正，支出/冻结为负，不得为 0 */
  amount: number;
  /** 操作后的对应余额（balance 流水为 balance，points/integral 流水为其余额字段） */
  balanceAfter: number;
  linkedTxId?: number | null;
  orderId?: string | null;
  cdkId?: number | null;
  withdrawCodeId?: number | null;
  description?: string | null;
  operatorUserId?: string | null;
  /** 请求追踪 ID，缺省自动生成 UUID */
  traceId?: string;
}

/** 写操作可选的流水关联字段 */
export interface BalanceTxOpts {
  linkedTxId?: number | null;
  orderId?: string | null;
  cdkId?: number | null;
  withdrawCodeId?: number | null;
}

/** 计入单日消费上限的流水类型（买 VIP / 余额兑点券 / 生成 CDKey） */
const DAILY_CONSUMPTION_TX_TYPES: WalletTxType[] = [
  'vip_purchase',
  'points_exchange',
  'cdk_generate',
];

// ----- DB 行类型 -----

export interface GlobalBalanceRow {
  user_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  frozen_balance: number;
  total_withdrawn: number;
  last_income_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BalanceInfo extends GlobalBalanceRow {
  /** 可用余额 = balance - frozen_balance */
  available_balance: number;
}

export interface DailyLimitCheckResult {
  allowed: boolean;
  today_spent: number;
  daily_max: number;
}

// ----- 服务实现 -----

export class BalanceServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 获取或创建全局余额记录（首次访问自动创建，全部字段为 0）。
   * onConflict ignore + 重读，避免并发创建竞态。
   */
  async getOrCreateBalance(userId: string): Promise<GlobalBalanceRow> {
    const existing = await this.db<GlobalBalanceRow>('global_balances')
      .where({ user_id: userId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    await this.db('global_balances')
      .insert({
        user_id: userId,
        balance: 0,
        total_earned: 0,
        total_spent: 0,
        frozen_balance: 0,
        total_withdrawn: 0,
        last_income_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict('user_id')
      .ignore();
    const row = await this.db<GlobalBalanceRow>('global_balances')
      .where({ user_id: userId })
      .first();
    return row as GlobalBalanceRow;
  }

  /** 查询余额信息（含 available_balance 计算字段） */
  async getBalance(userId: string): Promise<BalanceInfo> {
    const row = await this.getOrCreateBalance(userId);
    return { ...row, available_balance: row.balance - row.frozen_balance };
  }

  /**
   * 充值入口检查：balance < recharge_max 才允许充值。
   * 注意：仅禁用入口，不截断已成功的充值（余额本身可超过上限）。
   */
  async canRecharge(userId: string, rechargeMax: number): Promise<boolean> {
    const row = await this.getOrCreateBalance(userId);
    return row.balance < rechargeMax;
  }

  /**
   * 加款（收入类交易：CDK 充值 / 管理员加款 / 赠送等）。
   * balance += amount, total_earned += amount，并更新 last_income_at（账期依据）。
   *
   * @returns 流水 ID
   */
  async credit(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    operatorUserId: string | null = null,
    traceId?: string,
    opts?: BalanceTxOpts,
  ): Promise<number> {
    assertPositiveAmount(amount, 'credit');

    await this.getOrCreateBalance(userId);
    const now = new Date().toISOString();
    await this.db('global_balances')
      .where({ user_id: userId })
      .update({
        balance: this.db.raw('balance + ?', [amount]),
        total_earned: this.db.raw('total_earned + ?', [amount]),
        last_income_at: now,
        updated_at: now,
      });

    const fresh = await this.getOrCreateBalance(userId);
    return this.writeTransaction({
      userId,
      serverId: null,
      currencyType: 'balance',
      type,
      amount,
      balanceAfter: fresh.balance,
      description,
      operatorUserId,
      traceId,
      ...spreadOpts(opts),
    });
  }

  /**
   * 扣款（消费类交易：买 VIP / 余额兑点券等）。
   * 原子操作：仅当可用余额 (balance - frozen_balance) >= amount 时扣减。
   *
   * @throws {InsufficientBalanceError} 可用余额不足
   * @returns 流水 ID
   */
  async debit(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    operatorUserId: string | null = null,
    traceId?: string,
    opts?: BalanceTxOpts,
  ): Promise<number> {
    assertPositiveAmount(amount, 'debit');

    await this.getOrCreateBalance(userId);
    const now = new Date().toISOString();
    const updated = await this.db('global_balances')
      .where({ user_id: userId })
      .whereRaw('(balance - frozen_balance) >= ?', [amount])
      .update({
        balance: this.db.raw('balance - ?', [amount]),
        total_spent: this.db.raw('total_spent + ?', [amount]),
        updated_at: now,
      });

    if (updated === 0) {
      const row = await this.getOrCreateBalance(userId);
      throw new InsufficientBalanceError(
        `可用余额不足：当前可用 ${row.balance - row.frozen_balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreateBalance(userId);
    return this.writeTransaction({
      userId,
      serverId: null,
      currencyType: 'balance',
      type,
      amount: -amount,
      balanceAfter: fresh.balance,
      description,
      operatorUserId,
      traceId,
      ...spreadOpts(opts),
    });
  }

  /**
   * 冻结余额（生成 CDKey / 提现申请）。
   * balance 不变，frozen_balance += amount；要求可用余额 >= amount。
   *
   * @throws {InsufficientBalanceError} 可用余额不足
   * @returns 流水 ID
   */
  async freeze(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    traceId?: string,
    opts?: BalanceTxOpts,
  ): Promise<number> {
    assertPositiveAmount(amount, 'freeze');

    await this.getOrCreateBalance(userId);
    const now = new Date().toISOString();
    const updated = await this.db('global_balances')
      .where({ user_id: userId })
      .whereRaw('(balance - frozen_balance) >= ?', [amount])
      .update({
        frozen_balance: this.db.raw('frozen_balance + ?', [amount]),
        updated_at: now,
      });

    if (updated === 0) {
      const row = await this.getOrCreateBalance(userId);
      throw new InsufficientBalanceError(
        `可用余额不足，无法冻结：当前可用 ${row.balance - row.frozen_balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreateBalance(userId);
    return this.writeTransaction({
      userId,
      serverId: null,
      currencyType: 'balance',
      type,
      amount: -amount,
      balanceAfter: fresh.balance,
      description,
      traceId,
      ...spreadOpts(opts),
    });
  }

  /**
   * 解冻余额（CDKey 过期退费 / 提现拒绝或过期退回）。
   * frozen_balance -= amount，balance 不变。
   *
   * @throws {InsufficientFrozenBalanceError} 冻结余额不足
   * @returns 流水 ID
   */
  async unfreeze(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    traceId?: string,
    opts?: BalanceTxOpts,
  ): Promise<number> {
    assertPositiveAmount(amount, 'unfreeze');

    await this.getOrCreateBalance(userId);
    const now = new Date().toISOString();
    const updated = await this.db('global_balances')
      .where({ user_id: userId })
      .where('frozen_balance', '>=', amount)
      .update({
        frozen_balance: this.db.raw('frozen_balance - ?', [amount]),
        updated_at: now,
      });

    if (updated === 0) {
      const row = await this.getOrCreateBalance(userId);
      throw new InsufficientFrozenBalanceError(
        `冻结余额不足，无法解冻：当前冻结 ${row.frozen_balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreateBalance(userId);
    return this.writeTransaction({
      userId,
      serverId: null,
      currencyType: 'balance',
      type,
      amount,
      balanceAfter: fresh.balance,
      description,
      traceId,
      ...spreadOpts(opts),
    });
  }

  /**
   * 解冻并正式扣款（提现核销 / CDKey 被兑换）。
   * frozen_balance -= amount, balance -= amount, total_spent += amount。
   * 不变量 frozen_balance <= balance 保证 balance 不会扣成负数。
   *
   * @throws {InsufficientFrozenBalanceError} 冻结余额不足
   * @returns 流水 ID
   */
  async unfreezeAndDebit(
    userId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    traceId?: string,
    opts?: BalanceTxOpts,
  ): Promise<number> {
    assertPositiveAmount(amount, 'unfreezeAndDebit');

    await this.getOrCreateBalance(userId);
    const now = new Date().toISOString();
    const updated = await this.db('global_balances')
      .where({ user_id: userId })
      .where('frozen_balance', '>=', amount)
      .update({
        frozen_balance: this.db.raw('frozen_balance - ?', [amount]),
        balance: this.db.raw('balance - ?', [amount]),
        total_spent: this.db.raw('total_spent + ?', [amount]),
        updated_at: now,
      });

    if (updated === 0) {
      const row = await this.getOrCreateBalance(userId);
      throw new InsufficientFrozenBalanceError(
        `冻结余额不足，无法核销：当前冻结 ${row.frozen_balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreateBalance(userId);
    return this.writeTransaction({
      userId,
      serverId: null,
      currencyType: 'balance',
      type,
      amount: -amount,
      balanceAfter: fresh.balance,
      description,
      traceId,
      ...spreadOpts(opts),
    });
  }

  /**
   * 单日消费上限检查：今日已消费 + 本次金额 <= daily_max。
   * 统计口径：wallet_transactions 中 currency_type='balance' 且
   * type ∈ (vip_purchase, points_exchange, cdk_generate) 的当日 |amount| 之和。
   */
  async checkDailyLimit(
    userId: string,
    amount: number,
    dailyMax: number,
  ): Promise<DailyLimitCheckResult> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const row = await this.db('wallet_transactions')
      .where({ user_id: userId, currency_type: 'balance' })
      .whereIn('type', DAILY_CONSUMPTION_TX_TYPES)
      .where('created_at', '>=', todayStart.toISOString())
      .select(this.db.raw('COALESCE(SUM(ABS(amount)), 0) AS total'))
      .first();
    const todaySpent = Number((row as { total?: number } | undefined)?.total ?? 0);

    return {
      allowed: todaySpent + amount <= dailyMax,
      today_spent: todaySpent,
      daily_max: dailyMax,
    };
  }

  /** 更新最后一笔收入时间（提现账期检查依据） */
  async updateLastIncome(userId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.getOrCreateBalance(userId);
    await this.db('global_balances')
      .where({ user_id: userId })
      .update({ last_income_at: now, updated_at: now });
  }

  /** 累计提现金额（提现核销成功后调用） */
  async incrementTotalWithdrawn(userId: string, amount: number): Promise<void> {
    assertPositiveAmount(amount, 'incrementTotalWithdrawn');
    await this.getOrCreateBalance(userId);
    await this.db('global_balances')
      .where({ user_id: userId })
      .update({
        total_withdrawn: this.db.raw('total_withdrawn + ?', [amount]),
        updated_at: new Date().toISOString(),
      });
  }

  // ----- 内部辅助 -----

  /**
   * 写入 wallet_transactions 流水（各服务统一模式）。
   * @returns 流水 ID
   */
  private async writeTransaction(params: WalletTxParams): Promise<number> {
    if (params.amount === 0) {
      throw new ValidationError('流水金额不能为 0');
    }
    const inserted = await this.db('wallet_transactions')
      .insert({
        user_id: params.userId,
        server_id: params.serverId ?? null,
        currency_type: params.currencyType,
        type: params.type,
        amount: params.amount,
        balance_after: params.balanceAfter,
        linked_tx_id: params.linkedTxId ?? null,
        order_id: params.orderId ?? null,
        cdk_id: params.cdkId ?? null,
        withdraw_code_id: params.withdrawCodeId ?? null,
        description: params.description ?? null,
        operator_user_id: params.operatorUserId ?? null,
        trace_id: params.traceId ?? crypto.randomUUID(),
        created_at: new Date().toISOString(),
      })
      .returning('id');
    return extractInsertId(inserted);
  }
}

// ----- 工厂 -----

export function createBalanceService(db: Knex): BalanceServiceImpl {
  return new BalanceServiceImpl(db);
}

// ----- 纯函数 -----

/** 校验金额为正整数 */
function assertPositiveAmount(amount: number, op: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError(`${op} amount 必须为正整数: ${amount}`);
  }
}

/** 展开流水关联字段（供 writeTransaction 参数透传） */
function spreadOpts(opts?: BalanceTxOpts): Pick<
  WalletTxParams,
  'linkedTxId' | 'orderId' | 'cdkId' | 'withdrawCodeId'
> {
  return {
    linkedTxId: opts?.linkedTxId ?? null,
    orderId: opts?.orderId ?? null,
    cdkId: opts?.cdkId ?? null,
    withdrawCodeId: opts?.withdrawCodeId ?? null,
  };
}

/** 从 knex insert(...).returning('id') 结果中提取 ID（兼容 sqlite3 返回形态） */
function extractInsertId(inserted: unknown): number {
  const first = Array.isArray(inserted) ? inserted[0] : inserted;
  if (typeof first === 'object' && first !== null) {
    return Number((first as { id: number }).id);
  }
  return Number(first);
}
