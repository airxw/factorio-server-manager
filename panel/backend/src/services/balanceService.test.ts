// ============================================================================
// balanceService.test.ts — 全局余额服务核心资金路径单元测试
// 覆盖：getOrCreateBalance 幂等 / credit（入账+账期时间戳） / debit（原子扣减、
//       冻结占用下的可用余额口径） / freeze / unfreeze / unfreezeAndDebit /
//       checkDailyLimit（单日消费上限统计口径） / incrementTotalWithdrawn
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createBalanceService, type BalanceServiceImpl } from './balanceService.js';
import {
  InsufficientBalanceError,
  InsufficientFrozenBalanceError,
  ValidationError,
} from './errors.js';

const USER = 'user-1';

describe('balanceService 资金核心路径', () => {
  let db: Knex;
  let svc: BalanceServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    svc = createBalanceService(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 直接落库一条余额记录（绕过 credit，避免 last_income_at 干扰） */
  async function seedBalance(over: Partial<Record<string, unknown>> = {}): Promise<void> {
    const now = new Date().toISOString();
    await db('global_balances').insert({
      user_id: USER,
      balance: 0,
      total_earned: 0,
      total_spent: 0,
      frozen_balance: 0,
      total_withdrawn: 0,
      last_income_at: null,
      created_at: now,
      updated_at: now,
      ...over,
    });
  }

  describe('getOrCreateBalance / getBalance', () => {
    it('首次访问自动创建全 0 记录，重复调用幂等返回同一行', async () => {
      const first = await svc.getOrCreateBalance(USER);
      expect(first.balance).toBe(0);
      expect(first.frozen_balance).toBe(0);

      const second = await svc.getOrCreateBalance(USER);
      expect(second.user_id).toBe(USER);
      // 全表仍只有一行（onConflict ignore 不重复插入）
      const rows = await db('global_balances').where({ user_id: USER });
      expect(rows).toHaveLength(1);
    });

    it('getBalance 返回 available_balance = balance - frozen_balance', async () => {
      await seedBalance({ balance: 100, frozen_balance: 30 });
      const info = await svc.getBalance(USER);
      expect(info.available_balance).toBe(70);
    });
  });

  describe('credit（入账）', () => {
    it('正常入账：balance/total_earned 增加，last_income_at 更新，写正金额流水', async () => {
      const txId = await svc.credit(USER, 500, 'cdk_recharge', 'CDK充值');

      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(500);
      expect(row.total_earned).toBe(500);
      expect(row.last_income_at).not.toBeNull(); // 账期依据

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx).toBeDefined();
      expect(tx.currency_type).toBe('balance');
      expect(tx.type).toBe('cdk_recharge');
      expect(tx.amount).toBe(500);
      expect(tx.balance_after).toBe(500);
    });

    it('非正整数金额（0 / 负数 / 小数）→ ValidationError，余额不变', async () => {
      await expect(svc.credit(USER, 0, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.credit(USER, -10, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.credit(USER, 1.5, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);

      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(0);
      // 无流水写入
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });
  });

  describe('debit（原子扣减）', () => {
    it('余额充足：balance/total_spent 正确变动，写负金额流水', async () => {
      await seedBalance({ balance: 200, total_earned: 200 });
      const txId = await svc.debit(USER, 80, 'vip_purchase', '买VIP');

      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(120);
      expect(row.total_spent).toBe(80);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.amount).toBe(-80);
      expect(tx.balance_after).toBe(120);
    });

    it('余额恰好等于扣减额 → 扣到 0 成功（边界值）', async () => {
      await seedBalance({ balance: 100 });
      await svc.debit(USER, 100, 'vip_purchase', '买VIP');
      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(0);
    });

    it('余额不足 → InsufficientBalanceError，余额与流水均不变（原子性）', async () => {
      await seedBalance({ balance: 50 });
      await expect(svc.debit(USER, 51, 'vip_purchase', '买VIP')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );

      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(50);
      expect(row.total_spent).toBe(0);
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });

    it('冻结占用可用余额：balance=100 frozen=60 时扣 50 被拒绝（可用口径=40）', async () => {
      await seedBalance({ balance: 100, frozen_balance: 60 });
      await expect(svc.debit(USER, 50, 'vip_purchase', '买VIP')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
      // 可用 40 内的扣减成功
      await svc.debit(USER, 40, 'vip_purchase', '买VIP');
      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(60);
      expect(row.frozen_balance).toBe(60);
    });

    it('非正整数金额 → ValidationError', async () => {
      await expect(svc.debit(USER, 0, 'vip_purchase', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.debit(USER, -5, 'vip_purchase', 'x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('freeze / unfreeze / unfreezeAndDebit（冻结生命周期）', () => {
    it('freeze：balance 不变、frozen 增加，可用余额同步收缩', async () => {
      await seedBalance({ balance: 100 });
      await svc.freeze(USER, 30, 'withdraw', '提现冻结');

      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(100);
      expect(row.frozen_balance).toBe(30);
      expect(row.available_balance).toBe(70);
    });

    it('freeze 超出可用余额 → InsufficientBalanceError，状态不变', async () => {
      await seedBalance({ balance: 100, frozen_balance: 80 });
      await expect(svc.freeze(USER, 30, 'withdraw', 'x')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
      const row = await svc.getBalance(USER);
      expect(row.frozen_balance).toBe(80);
    });

    it('unfreeze：frozen 减少、balance 不变；冻结不足 → InsufficientFrozenBalanceError', async () => {
      await seedBalance({ balance: 100, frozen_balance: 50 });
      await svc.unfreeze(USER, 20, 'system', '解冻退回');
      let row = await svc.getBalance(USER);
      expect(row.frozen_balance).toBe(30);
      expect(row.balance).toBe(100);

      await expect(svc.unfreeze(USER, 31, 'system', 'x')).rejects.toBeInstanceOf(
        InsufficientFrozenBalanceError,
      );
      row = await svc.getBalance(USER);
      expect(row.frozen_balance).toBe(30);
    });

    it('unfreezeAndDebit（提现核销）：frozen 与 balance 同步扣减、total_spent 累加', async () => {
      await seedBalance({ balance: 100, frozen_balance: 40 });
      await svc.unfreezeAndDebit(USER, 40, 'withdraw', '提现核销');

      const row = await svc.getBalance(USER);
      expect(row.frozen_balance).toBe(0);
      expect(row.balance).toBe(60);
      expect(row.total_spent).toBe(40);
    });

    it('unfreezeAndDebit 冻结不足 → InsufficientFrozenBalanceError，balance 不被误扣', async () => {
      await seedBalance({ balance: 100, frozen_balance: 10 });
      await expect(svc.unfreezeAndDebit(USER, 50, 'withdraw', 'x')).rejects.toBeInstanceOf(
        InsufficientFrozenBalanceError,
      );
      const row = await svc.getBalance(USER);
      expect(row.balance).toBe(100);
      expect(row.frozen_balance).toBe(10);
      expect(row.total_spent).toBe(0);
    });
  });

  describe('checkDailyLimit（单日消费上限统计口径）', () => {
    it('仅统计 balance 币种的 vip_purchase/points_exchange/cdk_generate，按 |amount| 求和', async () => {
      await seedBalance({ balance: 10000 });
      // 计入：vip_purchase 100 + cdk_generate 200
      await svc.debit(USER, 100, 'vip_purchase', 'x');
      await svc.debit(USER, 200, 'cdk_generate', 'x');
      // 不计入：balance 币种的其他类型（admin_debit）、points 币种流水
      const now = new Date().toISOString();
      await db('wallet_transactions').insert([
        {
          user_id: USER, server_id: null, currency_type: 'balance', type: 'admin_debit',
          amount: -999, balance_after: 0, trace_id: 't1', created_at: now,
        },
        {
          user_id: USER, server_id: 'srv-1', currency_type: 'points', type: 'shop_purchase',
          amount: -999, balance_after: 0, trace_id: 't2', created_at: now,
        },
      ]);

      const r = await svc.checkDailyLimit(USER, 348, 648);
      expect(r.today_spent).toBe(300);
      expect(r.allowed).toBe(true); // 300+348=648 <= 648（边界值）

      const r2 = await svc.checkDailyLimit(USER, 349, 648);
      expect(r2.allowed).toBe(false); // 300+349 > 648
    });

    it('昨日流水不计入今日统计', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await db('wallet_transactions').insert({
        user_id: USER, server_id: null, currency_type: 'balance', type: 'vip_purchase',
        amount: -600, balance_after: 0, trace_id: 't-old', created_at: yesterday,
      });
      const r = await svc.checkDailyLimit(USER, 100, 648);
      expect(r.today_spent).toBe(0);
      expect(r.allowed).toBe(true);
    });
  });

  describe('incrementTotalWithdrawn / updateLastIncome', () => {
    it('incrementTotalWithdrawn 累加；非正金额 → ValidationError', async () => {
      await seedBalance({ balance: 100 });
      await svc.incrementTotalWithdrawn(USER, 30);
      await svc.incrementTotalWithdrawn(USER, 20);
      const row = await svc.getBalance(USER);
      expect(row.total_withdrawn).toBe(50);

      await expect(svc.incrementTotalWithdrawn(USER, 0)).rejects.toBeInstanceOf(ValidationError);
    });

    it('updateLastIncome 刷新账期时间戳', async () => {
      await seedBalance({ balance: 100, last_income_at: null });
      await svc.updateLastIncome(USER);
      const row = await svc.getBalance(USER);
      expect(row.last_income_at).not.toBeNull();
    });
  });
});
