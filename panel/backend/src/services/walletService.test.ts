// ============================================================================
// walletService.test.ts — 实例点券钱包核心资金路径单元测试
// 覆盖：getOrCreateWallet 幂等 / debit（原子扣减、不足拒绝、0/负数边界） /
//       credit / refund（total_spent 保底） / claimDailyReward（VIP 阶梯金额 +
//       同日重复领取幂等拒绝）
// 说明：instanceBindingService 走 getDatabase() 单例，本文件以 vi.mock 隔离，
//       仅控制 getUserVipLevel 返回值，聚焦钱包自身资金逻辑。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createWalletService, type WalletServiceImpl } from './walletService.js';
import { DailyRewardAlreadyClaimedError, InsufficientBalanceError } from './errors.js';
import * as instanceBindingService from './instanceBindingService.js';

// mock 实例绑定服务：仅 getUserVipLevel 被 walletService 消费
vi.mock('./instanceBindingService.js', () => ({
  getUserVipLevel: vi.fn(),
}));

const USER = 'user-1';
const SERVER = 'srv-1';

const getUserVipLevelMock = instanceBindingService.getUserVipLevel as unknown as ReturnType<typeof vi.fn>;

describe('walletService 资金核心路径', () => {
  let db: Knex;
  let svc: WalletServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    svc = createWalletService(db);
    // 默认 VIP0（每日奖励 100）
    getUserVipLevelMock.mockResolvedValue(0);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 直接落库一条钱包记录 */
  async function seedWallet(balance: number, over: Partial<Record<string, unknown>> = {}): Promise<void> {
    const now = new Date().toISOString();
    await db('user_wallets').insert({
      user_id: USER,
      server_id: SERVER,
      balance,
      total_earned: balance,
      total_spent: 0,
      last_daily_claim_at: null,
      last_daily_claim_date: null,
      created_at: now,
      updated_at: now,
      ...over,
    });
  }

  async function getWallet(): Promise<Record<string, unknown>> {
    return db('user_wallets').where({ user_id: USER, server_id: SERVER }).first();
  }

  describe('getOrCreateWallet', () => {
    it('首次访问自动创建 balance=0 钱包，重复调用幂等（UNIQUE(user_id,server_id)）', async () => {
      const first = await svc.getOrCreateWallet(USER, SERVER);
      expect(first.balance).toBe(0);

      await svc.getOrCreateWallet(USER, SERVER);
      const rows = await db('user_wallets').where({ user_id: USER, server_id: SERVER });
      expect(rows).toHaveLength(1);
    });

    it('钱包按实例隔离：A 服余额不影响 B 服', async () => {
      await seedWallet(500);
      const other = await svc.getOrCreateWallet(USER, 'srv-2');
      expect(other.balance).toBe(0);
    });
  });

  describe('debit（扣款）', () => {
    it('余额充足：balance/total_spent 正确变动，写负金额流水（默认 type=shop_purchase）', async () => {
      await seedWallet(200);
      await svc.debit(USER, SERVER, 80);

      const row = await getWallet();
      expect(row.balance).toBe(120);
      expect(row.total_spent).toBe(80);

      const tx = await db('wallet_transactions').where({ user_id: USER, server_id: SERVER }).first();
      expect(tx.currency_type).toBe('points');
      expect(tx.type).toBe('shop_purchase');
      expect(tx.amount).toBe(-80);
      expect(tx.balance_after).toBe(120);
    });

    it('余额恰好等于扣款额 → 扣到 0 成功（边界值）', async () => {
      await seedWallet(100);
      await svc.debit(USER, SERVER, 100);
      const row = await getWallet();
      expect(row.balance).toBe(0);
    });

    it('余额不足 → InsufficientBalanceError，余额与流水均不变（原子 UPDATE 防超扣）', async () => {
      await seedWallet(50);
      await expect(svc.debit(USER, SERVER, 51)).rejects.toBeInstanceOf(InsufficientBalanceError);

      const row = await getWallet();
      expect(row.balance).toBe(50);
      expect(row.total_spent).toBe(0);
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });

    it('amount=0 直接返回（免费订单不扣款、不写流水）；负数抛错', async () => {
      await seedWallet(100);
      await svc.debit(USER, SERVER, 0);
      let row = await getWallet();
      expect(row.balance).toBe(100);

      await expect(svc.debit(USER, SERVER, -1)).rejects.toThrow(/不能为负/);
      row = await getWallet();
      expect(row.balance).toBe(100);
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });
  });

  describe('credit / refund', () => {
    it('credit：balance/total_earned 增加，写正金额流水（默认 type=admin_credit）', async () => {
      await seedWallet(100);
      await svc.credit(USER, SERVER, 50);

      const row = await getWallet();
      expect(row.balance).toBe(150);
      expect(row.total_earned).toBe(150);

      const tx = await db('wallet_transactions')
        .where({ user_id: USER, server_id: SERVER })
        .orderBy('id', 'desc')
        .first();
      expect(tx.type).toBe('admin_credit');
      expect(tx.amount).toBe(50);
    });

    it('refund：balance 回补，total_spent 扣回且保底不为负', async () => {
      await seedWallet(100, { total_spent: 30 });
      await svc.refund(USER, SERVER, 80); // 退款额超过 total_spent

      const row = await getWallet();
      expect(row.balance).toBe(180);
      expect(row.total_spent).toBe(0); // Math.max(0, 30-80)

      const tx = await db('wallet_transactions')
        .where({ user_id: USER, server_id: SERVER })
        .orderBy('id', 'desc')
        .first();
      expect(tx.type).toBe('shop_refund');
      expect(tx.amount).toBe(80);
    });
  });

  describe('claimDailyReward（每日点券奖励）', () => {
    it('VIP0 首次领取：+100，更新领取日期，写 daily_reward 流水', async () => {
      const { wallet, claimed_amount } = await svc.claimDailyReward(USER, SERVER, 'user');
      expect(claimed_amount).toBe(100);
      expect(wallet.balance).toBe(100);
      expect(wallet.can_claim_daily).toBe(false);

      const tx = await db('wallet_transactions').where({ user_id: USER }).first();
      expect(tx.type).toBe('daily_reward');
      expect(tx.amount).toBe(100);
    });

    it('VIP 阶梯金额：VIP3 领 800；server_admin 融合 VIP5 领 3200', async () => {
      getUserVipLevelMock.mockResolvedValue(3);
      const r1 = await svc.claimDailyReward(USER, SERVER, 'user');
      expect(r1.claimed_amount).toBe(800);

      getUserVipLevelMock.mockResolvedValue(5);
      const r2 = await svc.claimDailyReward('admin-1', SERVER, 'server_admin');
      expect(r2.claimed_amount).toBe(3200);
    });

    it('同日重复领取 → DailyRewardAlreadyClaimedError，余额不重复增加（幂等）', async () => {
      await svc.claimDailyReward(USER, SERVER, 'user');
      await expect(svc.claimDailyReward(USER, SERVER, 'user')).rejects.toBeInstanceOf(
        DailyRewardAlreadyClaimedError,
      );

      const row = await getWallet();
      expect(row.balance).toBe(100); // 仅领取一次
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(1);
    });

    it('昨日已领今日可再领（last_daily_claim_date 按日判断）', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, '0');
      const d = String(yesterday.getDate()).padStart(2, '0');
      await seedWallet(100, { last_daily_claim_date: `${y}-${m}-${d}` });

      const { claimed_amount } = await svc.claimDailyReward(USER, SERVER, 'user');
      expect(claimed_amount).toBe(100);
      const row = await getWallet();
      expect(row.balance).toBe(200);
    });
  });
});
