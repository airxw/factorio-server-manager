// ============================================================================
// vipService.test.ts — VIP 购买与状态管理核心资金路径单元测试
// 覆盖：purchaseVip 定价未配置拒绝 / 重复购买拒绝（状态机）/ 余额不足拒绝（原子性）/
//       成功购买资金链路（扣款 + 门槛积分 + 消费积分 + 状态写入 + trace_id 串联）/
//       订阅到期失效 / 买断永久有效
// 说明：balance/integral/pricing 使用真实实现（同一内存 DB），仅验证 vipService 编排逻辑
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createBalanceService, type BalanceServiceImpl } from './balanceService.js';
import { createIntegralService, VIP_THRESHOLDS, type IntegralServiceImpl } from './integralService.js';
import { createPricingService, type PricingServiceImpl } from './pricingService.js';
import { createVipService, type VipServiceImpl } from './vipService.js';
import {
  InsufficientBalanceError,
  VipAlreadyActiveError,
  VipPricingNotConfiguredError,
} from './errors.js';

const USER = 'user-1';
const SERVER = 'srv-1';

describe('vipService 资金核心路径', () => {
  let db: Knex;
  let balanceSvc: BalanceServiceImpl;
  let integralSvc: IntegralServiceImpl;
  let pricingSvc: PricingServiceImpl;
  let svc: VipServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    balanceSvc = createBalanceService(db);
    integralSvc = createIntegralService(db);
    pricingSvc = createPricingService(db);
    svc = createVipService(db, balanceSvc, integralSvc, pricingSvc);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 预置全局余额 */
  async function seedBalance(amount: number): Promise<void> {
    await balanceSvc.credit(USER, amount, 'admin_credit', '测试预置');
  }

  /** 配置实例 VIP 定价 */
  async function seedPricing(monthly: number | null, lifetime: number | null, ratio = 1.0): Promise<void> {
    await pricingSvc.updatePricing(
      SERVER,
      { vip_monthly_price: monthly, vip_lifetime_price: lifetime, integral_ratio: ratio },
      'instance_admin',
    );
  }

  describe('purchaseVip（前置校验）', () => {
    it('实例未开放对应购买方式（定价 NULL）→ VipPricingNotConfiguredError，余额不变', async () => {
      await seedBalance(1000);
      // 默认定价 monthly/lifetime 均为 NULL
      await expect(svc.purchaseVip(USER, SERVER, 'monthly')).rejects.toBeInstanceOf(
        VipPricingNotConfiguredError,
      );
      await expect(svc.purchaseVip(USER, SERVER, 'lifetime')).rejects.toBeInstanceOf(
        VipPricingNotConfiguredError,
      );

      const bal = await balanceSvc.getBalance(USER);
      expect(bal.balance).toBe(1000); // 未扣款
    });

    it('余额不足 → InsufficientBalanceError，VIP 状态不写入（原子性）', async () => {
      await seedPricing(100, 1000);
      await seedBalance(50); // 不足 100

      await expect(svc.purchaseVip(USER, SERVER, 'monthly')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );

      const vip = await svc.getVipStatus(USER, SERVER);
      expect(vip.vip_type).toBeNull();
      expect(vip.is_active).toBe(false);
      const bal = await balanceSvc.getBalance(USER);
      expect(bal.balance).toBe(50); // 未扣款
    });

    it('非法 VIP 类型 → ValidationError', async () => {
      await expect(
        svc.purchaseVip(USER, SERVER, 'yearly' as 'monthly'),
      ).rejects.toThrow('非法 VIP 类型');
    });
  });

  describe('purchaseVip（成功链路）', () => {
    it('订阅制：扣款 → 赠门槛积分 → 赠消费积分 → 状态写入，30 天有效期，trace_id 串联', async () => {
      await seedPricing(100, null, 2.0); // 月价 100，积分比率 2.0
      await seedBalance(500);

      const r = await svc.purchaseVip(USER, SERVER, 'monthly', 'trace-vip-1');

      // 余额扣款
      const bal = await balanceSvc.getBalance(USER);
      expect(bal.balance).toBe(400);
      expect(bal.total_spent).toBe(100);

      // 门槛积分（VIP1 下限）+ 消费积分（100 × 2.0）
      expect(r.threshold_integral_granted).toBe(VIP_THRESHOLDS[1].min);
      expect(r.consumption_integral_granted).toBe(200);
      expect(r.status.current_integral).toBe(VIP_THRESHOLDS[1].min + 200);
      expect(r.status.vip_level).toBeGreaterThanOrEqual(1);

      // VIP 状态：monthly + 约 30 天后过期
      expect(r.status.vip_type).toBe('monthly');
      expect(r.status.is_active).toBe(true);
      expect(r.status.vip_expires_at).not.toBeNull();
      const expiresMs = new Date(r.status.vip_expires_at as string).getTime();
      const deltaDays = (expiresMs - Date.now()) / (24 * 60 * 60 * 1000);
      expect(deltaDays).toBeGreaterThan(29);
      expect(deltaDays).toBeLessThan(31);

      // 流水串联：同 trace_id 下含 vip_purchase 扣款与 integral_earn 赠送
      const txs = await db('wallet_transactions').where({ trace_id: 'trace-vip-1' });
      const types = txs.map((t) => t.type).sort();
      expect(types).toEqual(['integral_earn', 'integral_earn', 'vip_purchase']);
      const debitTx = txs.find((t) => t.type === 'vip_purchase');
      expect(debitTx.amount).toBe(-100);
    });

    it('买断制：vip_expires_at 为 NULL，is_active 恒为 true', async () => {
      await seedPricing(null, 1000, 1.0);
      await seedBalance(2000);

      const r = await svc.purchaseVip(USER, SERVER, 'lifetime');
      expect(r.status.vip_type).toBe('lifetime');
      expect(r.status.vip_expires_at).toBeNull();
      expect(r.status.is_active).toBe(true);
    });

    it('消费积分四舍五入为 0 时跳过赠送（仅门槛积分 1 条 integral_earn）', async () => {
      // 注：integral_ratio 必须为正数（pricingService 校验），0 不可达；
      // 用极小比率使 Math.round(price × ratio) === 0，覆盖 vipService 的跳过分支
      await seedPricing(100, null, 0.001);
      await seedBalance(500);

      const r = await svc.purchaseVip(USER, SERVER, 'monthly', 'trace-zero-ratio');
      expect(r.consumption_integral_granted).toBe(0);

      const txs = await db('wallet_transactions').where({ trace_id: 'trace-zero-ratio', type: 'integral_earn' });
      expect(txs).toHaveLength(1); // 仅门槛积分
    });
  });

  describe('purchaseVip（重复购买状态机）', () => {
    it('买断后再次购买（任意类型）→ VipAlreadyActiveError，不重复扣款', async () => {
      await seedPricing(100, 1000);
      await seedBalance(5000);
      await svc.purchaseVip(USER, SERVER, 'lifetime');

      await expect(svc.purchaseVip(USER, SERVER, 'lifetime')).rejects.toBeInstanceOf(
        VipAlreadyActiveError,
      );
      await expect(svc.purchaseVip(USER, SERVER, 'monthly')).rejects.toBeInstanceOf(
        VipAlreadyActiveError,
      );

      const bal = await balanceSvc.getBalance(USER);
      expect(bal.total_spent).toBe(1000); // 仅扣一次
    });

    it('订阅未到期续购 → VipAlreadyActiveError；到期失效后可再次购买', async () => {
      await seedPricing(100, null);
      await seedBalance(1000);
      await svc.purchaseVip(USER, SERVER, 'monthly');

      await expect(svc.purchaseVip(USER, SERVER, 'monthly')).rejects.toBeInstanceOf(
        VipAlreadyActiveError,
      );

      // 手工把到期时间改到过去 → 失效后可再购
      const past = new Date(Date.now() - 1000).toISOString();
      await db('user_vip_status')
        .where({ user_id: USER, server_id: SERVER })
        .update({ vip_expires_at: past });

      const r = await svc.purchaseVip(USER, SERVER, 'monthly');
      expect(r.status.is_active).toBe(true);
      const bal = await balanceSvc.getBalance(USER);
      expect(bal.total_spent).toBe(200); // 两次成功扣款
    });
  });

  describe('checkExpiredSubscriptions（订阅到期失效）', () => {
    it('过期 monthly → vip_type 置 null、is_active=false；lifetime 与未过期不受影响', async () => {
      const now = new Date().toISOString();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      // 过期订阅
      await db('user_vip_status').insert({
        user_id: 'u-expired', server_id: SERVER, vip_type: 'monthly',
        vip_expires_at: past, purchased_at: past, created_at: past, updated_at: past,
      });
      // 未过期订阅
      await db('user_vip_status').insert({
        user_id: 'u-active', server_id: SERVER, vip_type: 'monthly',
        vip_expires_at: future, purchased_at: now, created_at: now, updated_at: now,
      });
      // 买断
      await db('user_vip_status').insert({
        user_id: 'u-lifetime', server_id: SERVER, vip_type: 'lifetime',
        vip_expires_at: null, purchased_at: now, created_at: now, updated_at: now,
      });

      const r = await svc.checkExpiredSubscriptions();
      expect(r.expired).toBe(1);

      const expired = await svc.getVipStatus('u-expired', SERVER);
      expect(expired.vip_type).toBeNull();
      expect(expired.is_active).toBe(false);
      expect(expired.vip_expires_at).toBe(past); // 保留历史记录

      const active = await svc.getVipStatus('u-active', SERVER);
      expect(active.vip_type).toBe('monthly');
      expect(active.is_active).toBe(true);

      const lifetime = await svc.getVipStatus('u-lifetime', SERVER);
      expect(lifetime.vip_type).toBe('lifetime');
      expect(lifetime.is_active).toBe(true);
    });
  });
});
