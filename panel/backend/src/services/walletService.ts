// ============================================================================
// walletService — 用户钱包管理 + VIP 每日点券奖励领取
// 数据契约：public/schema/user-wallets-schema.json
// 表结构：  user_wallets（见 db/migrations/20260715200000_add_economy_system.ts）
// 来源：经济系统改造需求（2026-07-15）
//
// 设计要点：
// - 钱包按实例作用域：UNIQUE(user_id, server_id)，余额在 A 服不能在 B 服使用
// - getOrCreateWallet：首次访问自动创建钱包（balance=0）
// - claimDailyReward：基于 VIP 等级阶梯金额，每日只能领一次（按 last_daily_claim_date 判断）
// - debit：供 shopService.createOrder 调用，扣款 + 累计消费
// - credit：供未来充值/赠送使用，加款 + 累计获得
// - v5 用户中心改造：debit/credit/refund/claimDailyReward 均写 wallet_transactions
//   （currency_type='points'，与 balanceService 统一的 writeTransaction 模式）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { WalletInfo } from '@public/schema/panel-api-types';
import {
  DailyRewardAlreadyClaimedError,
  InsufficientBalanceError,
  ValidationError,
} from './errors.js';
import * as instanceBindingService from './instanceBindingService.js';
import type { WalletTxType } from './balanceService.js';

// ----- 常量 -----

/** VIP 每日点券奖励阶梯表（与 migration 20260715200000 一致） */
const VIP_DAILY_REWARD_MAP: Record<number, number> = {
  0: 100,
  1: 200,
  2: 400,
  3: 800,
  4: 1600,
  5: 3200,
};

/** 服务端管理员兜底每日奖励（与 VIP5 一致） */
const ADMIN_DAILY_REWARD = 3200;

// ----- DB 行类型 -----

interface UserWalletRow {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  last_daily_claim_at: string | null;
  last_daily_claim_date: string | null;
  created_at: string;
  updated_at: string;
}

/** 写操作可选的流水元数据（wallet_transactions） */
export interface WalletTxOpts {
  /** 流水类型（缺省：debit='shop_purchase' / credit='admin_credit' / refund='shop_refund'） */
  type?: WalletTxType;
  description?: string | null;
  operatorUserId?: string | null;
  traceId?: string;
  orderId?: string | null;
  linkedTxId?: number | null;
}

// ----- 服务实现 -----

export class WalletServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 获取或创建钱包（首次访问自动创建，balance=0）。
   * 对外暴露，供路由层 / shopService 调用。
   */
  async getOrCreateWallet(userId: string, serverId: string): Promise<UserWalletRow> {
    const existing = await this.db<UserWalletRow>('user_wallets')
      .where({ user_id: userId, server_id: serverId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    const inserted = await this.db<UserWalletRow>('user_wallets')
      .insert({
        user_id: userId,
        server_id: serverId,
        balance: 0,
        total_earned: 0,
        total_spent: 0,
        last_daily_claim_at: null,
        last_daily_claim_date: null,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return row;
  }

  /**
   * 查询钱包信息（含 can_claim_daily 状态 + 当前 VIP 等级的 daily_reward_amount）。
   */
  async getWalletInfo(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<WalletInfo> {
    const row = await this.getOrCreateWallet(userId, serverId);
    const vipLevel = await instanceBindingService.getUserVipLevel(userId, serverId, userRole);
    const dailyRewardAmount = this.resolveDailyRewardAmount(vipLevel);
    const todayDate = todayDateString();
    const canClaimDaily = row.last_daily_claim_date !== todayDate;

    return {
      id: row.id,
      user_id: row.user_id,
      server_id: row.server_id,
      balance: row.balance,
      total_earned: row.total_earned,
      total_spent: row.total_spent,
      last_daily_claim_at: row.last_daily_claim_at,
      last_daily_claim_date: row.last_daily_claim_date,
      can_claim_daily: canClaimDaily,
      daily_reward_amount: dailyRewardAmount,
    };
  }

  /**
   * 领取每日点券奖励。
   * 规则：
   *   - 按 last_daily_claim_date 判断今日是否已领（YYYY-MM-DD）
   *   - 奖励金额 = 当前 VIP 等级对应的 daily_reward_amount
   *   - 成功后：balance += amount, total_earned += amount, 更新 last_daily_claim_at / last_daily_claim_date
   *
   * @throws {DailyRewardAlreadyClaimedError} 今日已领取
   */
  async claimDailyReward(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<{ wallet: WalletInfo; claimed_amount: number }> {
    const row = await this.getOrCreateWallet(userId, serverId);
    const todayDate = todayDateString();

    if (row.last_daily_claim_date === todayDate) {
      throw new DailyRewardAlreadyClaimedError();
    }

    const vipLevel = await instanceBindingService.getUserVipLevel(userId, serverId, userRole);
    const amount = this.resolveDailyRewardAmount(vipLevel);
    if (amount <= 0) {
      // 兜底：VIP 配置异常时按 VIP0 处理
      const fallback = VIP_DAILY_REWARD_MAP[0] ?? 100;
      throw new Error(`VIP${vipLevel} 每日奖励金额配置异常（amount=0），请联系管理员。预期: ${fallback}`);
    }

    const now = new Date().toISOString();
    await this.db<UserWalletRow>('user_wallets')
      .where({ id: row.id })
      .update({
        balance: row.balance + amount,
        total_earned: row.total_earned + amount,
        last_daily_claim_at: now,
        last_daily_claim_date: todayDate,
        updated_at: now,
      });

    // v5: 写每日领取流水（currency_type='points', type='daily_reward'）
    await this.writeTransaction({
      userId,
      serverId,
      type: 'daily_reward',
      amount,
      balanceAfter: row.balance + amount,
      description: '每日点券奖励领取',
    });

    const wallet = await this.getWalletInfo(userId, serverId, userRole);
    return { wallet, claimed_amount: amount };
  }

  /**
   * 扣款（供 shopService.createOrder 调用）。
   * 原子操作：UPDATE ... WHERE balance >= amount，影响行数 0 即余额不足。
   * v5: 成功后写流水（currency_type='points'，默认 type='shop_purchase'）。
   *
   * @throws {InsufficientBalanceError} 余额不足
   */
  async debit(
    userId: string,
    serverId: string,
    amount: number,
    opts?: WalletTxOpts,
  ): Promise<void> {
    if (amount < 0) {
      throw new Error(`debit amount 不能为负: ${amount}`);
    }
    if (amount === 0) return; // 免费订单无需扣款

    const updated = await this.db<UserWalletRow>('user_wallets')
      .where({ user_id: userId, server_id: serverId })
      .where('balance', '>=', amount)
      .update({
        balance: this.db.raw('balance - ?', [amount]),
        total_spent: this.db.raw('total_spent + ?', [amount]),
        updated_at: new Date().toISOString(),
      });

    if (updated === 0) {
      const row = await this.getOrCreateWallet(userId, serverId);
      throw new InsufficientBalanceError(
        `点券余额不足：当前 ${row.balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreateWallet(userId, serverId);
    await this.writeTransaction({
      userId,
      serverId,
      type: opts?.type ?? 'shop_purchase',
      amount: -amount,
      balanceAfter: fresh.balance,
      description: opts?.description ?? null,
      operatorUserId: opts?.operatorUserId ?? null,
      traceId: opts?.traceId,
      orderId: opts?.orderId ?? null,
      linkedTxId: opts?.linkedTxId ?? null,
    });
  }

  /**
   * 加款（供未来充值 / 赠送 / 管理员发放使用）。
   * v5: 成功后写流水（currency_type='points'，默认 type='admin_credit'；
   *     每日领取由 claimDailyReward 直接写 'daily_reward'）。
   */
  async credit(
    userId: string,
    serverId: string,
    amount: number,
    opts?: WalletTxOpts,
  ): Promise<void> {
    if (amount < 0) {
      throw new Error(`credit amount 不能为负: ${amount}`);
    }
    if (amount === 0) return;

    const row = await this.getOrCreateWallet(userId, serverId);
    const now = new Date().toISOString();
    await this.db<UserWalletRow>('user_wallets')
      .where({ id: row.id })
      .update({
        balance: row.balance + amount,
        total_earned: row.total_earned + amount,
        updated_at: now,
      });

    await this.writeTransaction({
      userId,
      serverId,
      type: opts?.type ?? 'admin_credit',
      amount,
      balanceAfter: row.balance + amount,
      description: opts?.description ?? null,
      operatorUserId: opts?.operatorUserId ?? null,
      traceId: opts?.traceId,
      orderId: opts?.orderId ?? null,
      linkedTxId: opts?.linkedTxId ?? null,
    });
  }

  /**
   * 退款（订单取消时使用，从 total_spent 扣回）。
   * v5: 成功后写流水（currency_type='points'，默认 type='shop_refund'）。
   */
  async refund(
    userId: string,
    serverId: string,
    amount: number,
    opts?: WalletTxOpts,
  ): Promise<void> {
    if (amount < 0) {
      throw new Error(`refund amount 不能为负: ${amount}`);
    }
    if (amount === 0) return;

    const row = await this.getOrCreateWallet(userId, serverId);
    const now = new Date().toISOString();
    await this.db<UserWalletRow>('user_wallets')
      .where({ id: row.id })
      .update({
        balance: row.balance + amount,
        total_spent: Math.max(0, row.total_spent - amount),
        updated_at: now,
      });

    await this.writeTransaction({
      userId,
      serverId,
      type: opts?.type ?? 'shop_refund',
      amount,
      balanceAfter: row.balance + amount,
      description: opts?.description ?? null,
      operatorUserId: opts?.operatorUserId ?? null,
      traceId: opts?.traceId,
      orderId: opts?.orderId ?? null,
      linkedTxId: opts?.linkedTxId ?? null,
    });
  }

  // ----- 内部辅助 -----

  /**
   * 写入 wallet_transactions 流水（v5 用户中心改造，与 balanceService 统一模式）。
   * currency_type 固定为 'points'（实例点券钱包）。
   */
  private async writeTransaction(params: {
    userId: string;
    serverId: string;
    type: WalletTxType;
    amount: number;
    balanceAfter: number;
    linkedTxId?: number | null;
    orderId?: string | null;
    description?: string | null;
    operatorUserId?: string | null;
    traceId?: string;
  }): Promise<void> {
    if (params.amount === 0) {
      throw new ValidationError('流水金额不能为 0');
    }
    await this.db('wallet_transactions').insert({
      user_id: params.userId,
      server_id: params.serverId,
      currency_type: 'points',
      type: params.type,
      amount: params.amount,
      balance_after: params.balanceAfter,
      linked_tx_id: params.linkedTxId ?? null,
      order_id: params.orderId ?? null,
      cdk_id: null,
      withdraw_code_id: null,
      description: params.description ?? null,
      operator_user_id: params.operatorUserId ?? null,
      trace_id: params.traceId ?? crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
  }

  /**
   * 解析 VIP 等级对应的每日奖励金额。
   * server_admin / instance_admin+owner 在 instanceBindingService 中已融合为 VIP5（=OWNER_VIP_LEVEL）。
   */
  private resolveDailyRewardAmount(vipLevel: number): number {
    // VIP 等级 ≥ 5（admin 融合为 VIP5）→ 取 VIP5 金额
    if (vipLevel >= 5) return ADMIN_DAILY_REWARD;
    return VIP_DAILY_REWARD_MAP[vipLevel] ?? VIP_DAILY_REWARD_MAP[0] ?? 0;
  }
}

// ----- 工厂 -----

export function createWalletService(db: Knex): WalletServiceImpl {
  return new WalletServiceImpl(db);
}

// ----- 纯函数 -----

/** 获取今日日期字符串 YYYY-MM-DD（本地时区，与 checkDailyLimit 一致） */
function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
