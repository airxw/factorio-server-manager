// ============================================================================
// pointsService — 实例点券管理（instance_points）
// 数据契约：docs/plans/user-center-consolidation-plan.md §2.3 instance_points
//           §6.1 wallet_transactions（所有变动写入流水）
// 表结构：  instance_points（PK(user_id, server_id)）、wallet_transactions
//
// 设计要点：
// - 点券按实例作用域：A 服点券不能在 B 服使用
// - 来源：管理员发放、CDK 点券兑换、余额兑换；用途：仅在该实例商城消费
// - 点券消费不产生积分（与积分体系无关）
// - 所有写操作均写 wallet_transactions（currency_type='points'）
// - debit 采用原子 UPDATE ... WHERE balance >= amount 防并发超扣
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import {
  InsufficientBalanceError,
  ValidationError,
} from './errors.js';
import type { WalletTxType } from './balanceService.js';

// ----- DB 行类型 -----

export interface InstancePointsRow {
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

// ----- 服务实现 -----

export class PointsServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 获取或创建实例点券记录（首次访问自动创建，balance=0）。
   * onConflict ignore + 重读，避免并发创建竞态。
   */
  async getOrCreatePoints(userId: string, serverId: string): Promise<InstancePointsRow> {
    const existing = await this.db<InstancePointsRow>('instance_points')
      .where({ user_id: userId, server_id: serverId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    await this.db('instance_points')
      .insert({
        user_id: userId,
        server_id: serverId,
        balance: 0,
        total_earned: 0,
        total_spent: 0,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['user_id', 'server_id'])
      .ignore();
    const row = await this.db<InstancePointsRow>('instance_points')
      .where({ user_id: userId, server_id: serverId })
      .first();
    return row as InstancePointsRow;
  }

  /** 查询实例点券信息 */
  async getPoints(userId: string, serverId: string): Promise<InstancePointsRow> {
    return this.getOrCreatePoints(userId, serverId);
  }

  /**
   * 加点券（管理员发放 / CDK 兑换 / 余额兑换）。
   * balance += amount, total_earned += amount。
   *
   * @returns 流水 ID
   */
  async credit(
    userId: string,
    serverId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    operatorUserId: string | null = null,
    traceId?: string,
    linkedTxId?: number | null,
  ): Promise<number> {
    assertPositiveAmount(amount, 'credit');

    await this.getOrCreatePoints(userId, serverId);
    const now = new Date().toISOString();
    await this.db('instance_points')
      .where({ user_id: userId, server_id: serverId })
      .update({
        balance: this.db.raw('balance + ?', [amount]),
        total_earned: this.db.raw('total_earned + ?', [amount]),
        updated_at: now,
      });

    const fresh = await this.getOrCreatePoints(userId, serverId);
    return this.writeTransaction({
      userId,
      serverId,
      type,
      amount,
      balanceAfter: fresh.balance,
      description,
      operatorUserId,
      traceId,
      linkedTxId: linkedTxId ?? null,
    });
  }

  /**
   * 扣点券（实例商城消费）。
   * 原子操作：仅当 balance >= amount 时扣减，total_spent += amount。
   *
   * @throws {InsufficientBalanceError} 点券余额不足
   * @returns 流水 ID
   */
  async debit(
    userId: string,
    serverId: string,
    amount: number,
    type: WalletTxType,
    description: string,
    operatorUserId: string | null = null,
    traceId?: string,
    linkedTxId?: number | null,
  ): Promise<number> {
    assertPositiveAmount(amount, 'debit');

    await this.getOrCreatePoints(userId, serverId);
    const now = new Date().toISOString();
    const updated = await this.db('instance_points')
      .where({ user_id: userId, server_id: serverId })
      .where('balance', '>=', amount)
      .update({
        balance: this.db.raw('balance - ?', [amount]),
        total_spent: this.db.raw('total_spent + ?', [amount]),
        updated_at: now,
      });

    if (updated === 0) {
      const row = await this.getOrCreatePoints(userId, serverId);
      throw new InsufficientBalanceError(
        `点券余额不足：当前 ${row.balance}，需要 ${amount}`,
      );
    }

    const fresh = await this.getOrCreatePoints(userId, serverId);
    return this.writeTransaction({
      userId,
      serverId,
      type,
      amount: -amount,
      balanceAfter: fresh.balance,
      description,
      operatorUserId,
      traceId,
      linkedTxId: linkedTxId ?? null,
    });
  }

  /**
   * 管理员发放点券（运营工具）。
   * 等价于 credit(type='admin_credit')，operator_user_id 记录发放管理员。
   *
   * @returns 流水 ID
   */
  async grantPoints(
    adminUserId: string,
    targetUserId: string,
    serverId: string,
    amount: number,
    traceId?: string,
  ): Promise<number> {
    return this.credit(
      targetUserId,
      serverId,
      amount,
      'admin_credit',
      '管理员发放点券',
      adminUserId,
      traceId,
    );
  }

  // ----- 内部辅助 -----

  /** 写入 wallet_transactions 流水（与 balanceService 统一模式） */
  private async writeTransaction(params: {
    userId: string;
    serverId: string;
    type: WalletTxType;
    amount: number;
    balanceAfter: number;
    linkedTxId?: number | null;
    orderId?: string | null;
    cdkId?: number | null;
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
        currency_type: 'points',
        type: params.type,
        amount: params.amount,
        balance_after: params.balanceAfter,
        linked_tx_id: params.linkedTxId ?? null,
        order_id: params.orderId ?? null,
        cdk_id: params.cdkId ?? null,
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

export function createPointsService(db: Knex): PointsServiceImpl {
  return new PointsServiceImpl(db);
}

// ----- 纯函数 -----

/** 校验金额为正整数 */
function assertPositiveAmount(amount: number, op: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError(`${op} amount 必须为正整数: ${amount}`);
  }
}
