// ============================================================================
// integralService — 实例积分管理（user_integrals）+ VIP 等级区间判定 + 每日衰减
// 数据契约：docs/plans/user-center-consolidation-plan.md §2.4 user_integrals / §2.5 VIP 等级
//           §6.1 wallet_transactions（所有变动写入流水）
// 表结构：  user_integrals（PK(user_id, server_id)）、wallet_transactions
//
// 设计要点：
// - total_integral 只增不减（永久保留最高积分记录）
// - current_integral 每日衰减 1 点（保底 0，不出现负值），VIP 等级由其所在区间决定
// - 积分仅与余额消费相关（1 余额消费 = integral_ratio 积分），点券消费不产生积分
// - 管理员调整仅改 current_integral，total_integral 不变
// - 所有变动写 wallet_transactions（currency_type='integral'）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { ValidationError } from './errors.js';
import type { WalletTxType } from './balanceService.js';

// ----- 常量 -----

/** VIP 等级门槛表（current_integral 所在区间决定等级） */
export const VIP_THRESHOLDS: ReadonlyArray<{ level: number; min: number; max: number }> = [
  { level: 0, min: 0, max: 0 },
  { level: 1, min: 1, max: 500 },
  { level: 2, min: 501, max: 1500 },
  { level: 3, min: 1501, max: 4000 },
  { level: 4, min: 4001, max: 10000 },
  { level: 5, min: 10001, max: Infinity },
];

/** VIP 每日点券奖励阶梯表 */
const VIP_DAILY_REWARD_MAP: Record<number, number> = {
  0: 100,
  1: 200,
  2: 400,
  3: 800,
  4: 1600,
  5: 3200,
};

/** 每日衰减点数（相当于 1 元等值积分，比例 1:1 默认） */
const DAILY_DECAY_POINTS = 1;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ----- DB 行类型 -----

export interface UserIntegralRow {
  user_id: string;
  server_id: string;
  total_integral: number;
  current_integral: number;
  last_decay_at: string | null;
  created_at: string;
  updated_at: string;
}

// ----- 服务实现 -----

export class IntegralServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 获取或创建积分记录（首次访问自动创建，全部为 0）。
   * onConflict ignore + 重读，避免并发创建竞态。
   */
  async getOrCreateIntegral(userId: string, serverId: string): Promise<UserIntegralRow> {
    const existing = await this.db<UserIntegralRow>('user_integrals')
      .where({ user_id: userId, server_id: serverId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    await this.db('user_integrals')
      .insert({
        user_id: userId,
        server_id: serverId,
        total_integral: 0,
        current_integral: 0,
        last_decay_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['user_id', 'server_id'])
      .ignore();
    const row = await this.db<UserIntegralRow>('user_integrals')
      .where({ user_id: userId, server_id: serverId })
      .first();
    return row as UserIntegralRow;
  }

  /**
   * 由 current_integral 计算 VIP 等级（纯函数，区间判定）。
   * VIP0: 0 / VIP1: 1-500 / VIP2: 501-1500 / VIP3: 1501-4000 / VIP4: 4001-10000 / VIP5: 10001+
   */
  getVipLevel(currentIntegral: number): number {
    for (const t of VIP_THRESHOLDS) {
      if (currentIntegral >= t.min && currentIntegral <= t.max) {
        return t.level;
      }
    }
    return 0;
  }

  /**
   * 增加积分（消费产生 / 购买 VIP 赠送）。
   * total_integral += amount, current_integral += amount。
   *
   * @returns 流水 ID
   */
  async addIntegral(
    userId: string,
    serverId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    traceId?: string,
  ): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ValidationError(`addIntegral amount 必须为正整数: ${amount}`);
    }

    await this.getOrCreateIntegral(userId, serverId);
    const now = new Date().toISOString();
    await this.db('user_integrals')
      .where({ user_id: userId, server_id: serverId })
      .update({
        total_integral: this.db.raw('total_integral + ?', [amount]),
        current_integral: this.db.raw('current_integral + ?', [amount]),
        updated_at: now,
      });

    const fresh = await this.getOrCreateIntegral(userId, serverId);
    return this.writeTransaction({
      userId,
      serverId,
      type,
      amount,
      balanceAfter: fresh.current_integral,
      description,
      traceId,
    });
  }

  /**
   * 管理员调整积分（仅改 current_integral，total_integral 不变）。
   * amount 带符号（正=增加，负=减少）；current_integral 保底 0。
   * 实际变动量（截断后）写入流水；实际变动为 0 时不写流水。
   *
   * @returns 流水 ID；无实际变动时返回 null
   */
  async adjustIntegral(
    adminUserId: string,
    targetUserId: string,
    serverId: string,
    amount: number,
    description: string,
    traceId?: string,
  ): Promise<number | null> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new ValidationError(`adjustIntegral amount 必须为非零整数: ${amount}`);
    }

    const row = await this.getOrCreateIntegral(targetUserId, serverId);
    const newCurrent = Math.max(0, row.current_integral + amount);
    const appliedDelta = newCurrent - row.current_integral;
    if (appliedDelta === 0) {
      return null;
    }

    const now = new Date().toISOString();
    await this.db('user_integrals')
      .where({ user_id: targetUserId, server_id: serverId })
      .update({ current_integral: newCurrent, updated_at: now });

    return this.writeTransaction({
      userId: targetUserId,
      serverId,
      type: 'integral_adjust',
      amount: appliedDelta,
      balanceAfter: newCurrent,
      description,
      operatorUserId: adminUserId,
      traceId,
    });
  }

  /**
   * 每日衰减任务（调度器周期调用）。
   * 按 last_decay_at（缺省回退 created_at）到当前的自然日数 × 1 点衰减，
   * current_integral 保底 0；total_integral 不变。
   * 每条实际衰减的记录写一条 integral_decay 流水。
   *
   * @returns { decayed } 实际发生衰减的记录数
   */
  async dailyDecay(): Promise<{ decayed: number }> {
    const rows = await this.db<UserIntegralRow>('user_integrals').where('current_integral', '>', 0);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    let decayed = 0;

    for (const row of rows) {
      const baseline = row.last_decay_at ?? row.created_at;
      const baselineMs = new Date(baseline).getTime();
      if (Number.isNaN(baselineMs)) continue;
      const days = Math.floor((nowMs - baselineMs) / MS_PER_DAY);
      if (days <= 0) continue;

      const decay = Math.min(days * DAILY_DECAY_POINTS, row.current_integral);
      if (decay <= 0) continue;

      const newCurrent = row.current_integral - decay;
      await this.db('user_integrals')
        .where({ user_id: row.user_id, server_id: row.server_id })
        .update({ current_integral: newCurrent, last_decay_at: now, updated_at: now });

      await this.writeTransaction({
        userId: row.user_id,
        serverId: row.server_id,
        type: 'integral_decay',
        amount: -decay,
        balanceAfter: newCurrent,
        description: '积分每日衰减',
      });
      decayed++;
    }

    return { decayed };
  }

  /**
   * VIP 等级对应的每日点券奖励金额（纯函数）。
   * VIP0: 100 / VIP1: 200 / VIP2: 400 / VIP3: 800 / VIP4: 1600 / VIP5: 3200
   */
  getDailyRewardAmount(vipLevel: number): number {
    const level = Math.max(0, Math.min(5, Math.floor(vipLevel)));
    return VIP_DAILY_REWARD_MAP[level] ?? VIP_DAILY_REWARD_MAP[0] ?? 100;
  }

  // ----- 内部辅助 -----

  /** 写入 wallet_transactions 流水（与 balanceService 统一模式） */
  private async writeTransaction(params: {
    userId: string;
    serverId: string;
    type: WalletTxType;
    amount: number;
    balanceAfter: number;
    description?: string | null;
    operatorUserId?: string | null;
    traceId?: string;
  }): Promise<number> {
    if (params.amount === 0) {
      throw new ValidationError('流水金额不能为 0');
    }
    const inserted = await this.db('wallet_transactions')
      .insert({
        user_id: params.userId,
        server_id: params.serverId,
        currency_type: 'integral',
        type: params.type,
        amount: params.amount,
        balance_after: params.balanceAfter,
        linked_tx_id: null,
        order_id: null,
        cdk_id: null,
        withdraw_code_id: null,
        description: params.description ?? null,
        operator_user_id: params.operatorUserId ?? null,
        trace_id: params.traceId ?? crypto.randomUUID(),
        created_at: new Date().toISOString(),
      })
      .returning('id');
    const first = Array.isArray(inserted) ? inserted[0] : inserted;
    return typeof first === 'object' && first !== null
      ? Number((first as { id: number }).id)
      : Number(first);
  }
}

// ----- 工厂 -----

export function createIntegralService(db: Knex): IntegralServiceImpl {
  return new IntegralServiceImpl(db);
}
