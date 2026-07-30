// ============================================================================
// integralService.test.ts — 实例成长积分服务核心路径单元测试
// 覆盖：addIntegral（total/current 双增） / adjustIntegral（仅改 current、保底 0
//       截断、零变动不写流水） / getVipLevel（区间边界） / dailyDecay（按天衰减、
//       保底 0、total 不变） / getDailyRewardAmount（阶梯 + 钳制）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createIntegralService, type IntegralServiceImpl } from './integralService.js';
import { ValidationError } from './errors.js';

const USER = 'user-1';
const SERVER = 'srv-1';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('integralService 核心路径', () => {
  let db: Knex;
  let svc: IntegralServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    svc = createIntegralService(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  async function getIntegral(userId = USER): Promise<Record<string, unknown>> {
    return db('user_integrals').where({ user_id: userId, server_id: SERVER }).first();
  }

  /** 直接落库积分记录 */
  async function seedIntegral(
    total: number,
    current: number,
    lastDecayAt: string | null = null,
    createdAt?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await db('user_integrals').insert({
      user_id: USER,
      server_id: SERVER,
      total_integral: total,
      current_integral: current,
      last_decay_at: lastDecayAt,
      created_at: createdAt ?? now,
      updated_at: now,
    });
  }

  describe('addIntegral（增加积分）', () => {
    it('total_integral 与 current_integral 同步增加，写 integral 币种流水', async () => {
      const txId = await svc.addIntegral(USER, SERVER, 100, 'integral_earn', '消费积分');

      const row = await getIntegral();
      expect(row.total_integral).toBe(100);
      expect(row.current_integral).toBe(100);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.currency_type).toBe('integral');
      expect(tx.type).toBe('integral_earn');
      expect(tx.amount).toBe(100);
      expect(tx.balance_after).toBe(100);
    });

    it('非正整数金额 → ValidationError', async () => {
      await expect(svc.addIntegral(USER, SERVER, 0, 'integral_earn', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.addIntegral(USER, SERVER, -5, 'integral_earn', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.addIntegral(USER, SERVER, 1.5, 'integral_earn', 'x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('adjustIntegral（管理员调整）', () => {
    it('正调整：current 增加，total_integral 不变', async () => {
      await seedIntegral(500, 300);
      await svc.adjustIntegral('admin-1', USER, SERVER, 100, '补偿');

      const row = await getIntegral();
      expect(row.current_integral).toBe(400);
      expect(row.total_integral).toBe(500); // 不变

      const tx = await db('wallet_transactions').where({ user_id: USER }).first();
      expect(tx.type).toBe('integral_adjust');
      expect(tx.amount).toBe(100);
      expect(tx.operator_user_id).toBe('admin-1');
    });

    it('负调整超过当前积分 → current 保底 0，流水记录截断后的实际变动量', async () => {
      await seedIntegral(500, 30);
      const txId = await svc.adjustIntegral('admin-1', USER, SERVER, -100, '处罚扣减');

      const row = await getIntegral();
      expect(row.current_integral).toBe(0);
      expect(row.total_integral).toBe(500);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.amount).toBe(-30); // 实际只扣了 30（截断）
      expect(tx.balance_after).toBe(0);
    });

    it('current=0 时负调整无实际变动 → 返回 null 且不写流水', async () => {
      await seedIntegral(500, 0);
      const r = await svc.adjustIntegral('admin-1', USER, SERVER, -50, '处罚扣减');
      expect(r).toBeNull();

      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });

    it('amount=0 或小数 → ValidationError', async () => {
      await expect(svc.adjustIntegral('admin-1', USER, SERVER, 0, 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.adjustIntegral('admin-1', USER, SERVER, 1.5, 'x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('getVipLevel（区间边界判定）', () => {
    it('VIP0~VIP5 全区间边界值', () => {
      expect(svc.getVipLevel(0)).toBe(0);
      expect(svc.getVipLevel(1)).toBe(1);
      expect(svc.getVipLevel(500)).toBe(1);
      expect(svc.getVipLevel(501)).toBe(2);
      expect(svc.getVipLevel(1500)).toBe(2);
      expect(svc.getVipLevel(1501)).toBe(3);
      expect(svc.getVipLevel(4000)).toBe(3);
      expect(svc.getVipLevel(4001)).toBe(4);
      expect(svc.getVipLevel(10000)).toBe(4);
      expect(svc.getVipLevel(10001)).toBe(5);
      expect(svc.getVipLevel(999999)).toBe(5);
    });
  });

  describe('dailyDecay（每日衰减）', () => {
    it('按自然日数衰减：last_decay_at 3 天前 → -3，写 integral_decay 流水', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * MS_PER_DAY).toISOString();
      await seedIntegral(100, 100, threeDaysAgo);

      const r = await svc.dailyDecay();
      expect(r.decayed).toBe(1);

      const row = await getIntegral();
      expect(row.current_integral).toBe(97);
      expect(row.total_integral).toBe(100); // total 不衰减

      const tx = await db('wallet_transactions').where({ user_id: USER }).first();
      expect(tx.type).toBe('integral_decay');
      expect(tx.amount).toBe(-3);
      expect(tx.balance_after).toBe(97);
    });

    it('衰减量超过当前积分 → 保底 0 不出现负值', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * MS_PER_DAY).toISOString();
      await seedIntegral(50, 2, tenDaysAgo);

      await svc.dailyDecay();
      const row = await getIntegral();
      expect(row.current_integral).toBe(0);
    });

    it('当天已衰减（days=0）→ 不重复衰减；current=0 的记录跳过', async () => {
      await seedIntegral(100, 100, new Date().toISOString());
      // 另一用户 current=0 的记录不进入衰减扫描
      const now = new Date().toISOString();
      await db('user_integrals').insert({
        user_id: 'user-zero', server_id: SERVER, total_integral: 50, current_integral: 0,
        last_decay_at: null, created_at: now, updated_at: now,
      });

      const r = await svc.dailyDecay();
      expect(r.decayed).toBe(0);
      const row = await getIntegral();
      expect(row.current_integral).toBe(100);
    });

    it('last_decay_at 为 NULL 时回退 created_at 作为衰减基线', async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * MS_PER_DAY).toISOString();
      await seedIntegral(100, 100, null, fiveDaysAgo);

      const r = await svc.dailyDecay();
      expect(r.decayed).toBe(1);
      const row = await getIntegral();
      expect(row.current_integral).toBe(95);
    });
  });

  describe('getDailyRewardAmount（VIP 每日奖励阶梯）', () => {
    it('VIP0~VIP5 阶梯金额 + 超范围钳制', () => {
      expect(svc.getDailyRewardAmount(0)).toBe(100);
      expect(svc.getDailyRewardAmount(1)).toBe(200);
      expect(svc.getDailyRewardAmount(2)).toBe(400);
      expect(svc.getDailyRewardAmount(3)).toBe(800);
      expect(svc.getDailyRewardAmount(4)).toBe(1600);
      expect(svc.getDailyRewardAmount(5)).toBe(3200);
      // 钳制：负数按 VIP0，超 5 按 VIP5，小数向下取整
      expect(svc.getDailyRewardAmount(-1)).toBe(100);
      expect(svc.getDailyRewardAmount(99)).toBe(3200);
      expect(svc.getDailyRewardAmount(2.7)).toBe(400);
    });
  });
});
