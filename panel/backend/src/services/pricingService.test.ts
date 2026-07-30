// ============================================================================
// pricingService.test.ts — 实例定价配置核心路径单元测试
// 覆盖：getPricing 默认值回填与幂等 / updatePricing 角色闸门 /
//       字段校验（非负整数、正比例）/ 平台单日消费上限钳制
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createPricingService, type PricingServiceImpl } from './pricingService.js';
import { ForbiddenError, ValidationError } from './errors.js';

const SERVER = 'srv-1';

describe('pricingService 资金核心路径', () => {
  let db: Knex;
  let svc: PricingServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    svc = createPricingService(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  describe('getPricing（默认值回填）', () => {
    it('首次访问自动创建默认配置：VIP 定价 NULL（不开放），比例 1.0，上限 NULL', async () => {
      const row = await svc.getPricing(SERVER);
      expect(row.server_id).toBe(SERVER);
      expect(row.vip_monthly_price).toBeNull();
      expect(row.vip_lifetime_price).toBeNull();
      expect(row.points_exchange_ratio).toBe(1.0);
      expect(row.integral_ratio).toBe(1.0);
      expect(row.daily_consumption_limit).toBeNull();
    });

    it('重复调用幂等（onConflict ignore），不产生重复行', async () => {
      await svc.getPricing(SERVER);
      await svc.getPricing(SERVER);
      const rows = await db('instance_pricing').where({ server_id: SERVER });
      expect(rows).toHaveLength(1);
    });
  });

  describe('updatePricing（角色闸门）', () => {
    it('非实例管理员（user/admin 等角色）→ ForbiddenError，配置不变', async () => {
      await expect(
        svc.updatePricing(SERVER, { vip_monthly_price: 100 }, 'user'),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        svc.updatePricing(SERVER, { vip_monthly_price: 100 }, 'platform_admin'),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const row = await svc.getPricing(SERVER);
      expect(row.vip_monthly_price).toBeNull();
    });

    it('instance_admin / server_admin 均可更新', async () => {
      const r1 = await svc.updatePricing(SERVER, { vip_monthly_price: 100 }, 'instance_admin');
      expect(r1.vip_monthly_price).toBe(100);

      const r2 = await svc.updatePricing(SERVER, { vip_monthly_price: 200 }, 'server_admin');
      expect(r2.vip_monthly_price).toBe(200);
    });
  });

  describe('updatePricing（字段校验）', () => {
    it('价格字段：负数/小数 → ValidationError；0 与 null（关闭售卖）合法', async () => {
      await expect(
        svc.updatePricing(SERVER, { vip_lifetime_price: -1 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        svc.updatePricing(SERVER, { vip_lifetime_price: 9.9 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);

      const r = await svc.updatePricing(
        SERVER,
        { vip_lifetime_price: 0, vip_monthly_price: null },
        'instance_admin',
      );
      expect(r.vip_lifetime_price).toBe(0);
      expect(r.vip_monthly_price).toBeNull();
    });

    it('比例字段：0 / 负数 / NaN → ValidationError', async () => {
      await expect(
        svc.updatePricing(SERVER, { points_exchange_ratio: 0 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        svc.updatePricing(SERVER, { integral_ratio: -0.5 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        svc.updatePricing(SERVER, { integral_ratio: Number.NaN }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('部分更新：仅更新提交字段，其他字段保持原值', async () => {
      await svc.updatePricing(
        SERVER,
        { vip_monthly_price: 100, integral_ratio: 2.0 },
        'instance_admin',
      );
      const r = await svc.updatePricing(SERVER, { vip_monthly_price: 300 }, 'instance_admin');
      expect(r.vip_monthly_price).toBe(300);
      expect(r.integral_ratio).toBe(2.0); // 未被覆盖
      expect(r.points_exchange_ratio).toBe(1.0); // 默认保持
    });
  });

  describe('updatePricing（平台单日消费上限钳制）', () => {
    it('超过平台上限（默认 648）→ ValidationError；等于上限合法；null（不限）合法', async () => {
      await expect(
        svc.updatePricing(SERVER, { daily_consumption_limit: 649 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);

      const r1 = await svc.updatePricing(
        SERVER,
        { daily_consumption_limit: 648 },
        'instance_admin',
      );
      expect(r1.daily_consumption_limit).toBe(648);

      const r2 = await svc.updatePricing(
        SERVER,
        { daily_consumption_limit: null },
        'instance_admin',
      );
      expect(r2.daily_consumption_limit).toBeNull();
    });

    it('平台配置 consumption.daily_max=100 → 实例上限 101 被拒、100 通过', async () => {
      await db('system_config').insert({
        key: 'consumption.daily_max',
        value: '100',
        description: null,
        updated_at: new Date().toISOString(),
      });
      await expect(
        svc.updatePricing(SERVER, { daily_consumption_limit: 101 }, 'instance_admin'),
      ).rejects.toBeInstanceOf(ValidationError);

      const r = await svc.updatePricing(
        SERVER,
        { daily_consumption_limit: 100 },
        'instance_admin',
      );
      expect(r.daily_consumption_limit).toBe(100);
    });
  });

  describe('getPlatformDailyMax', () => {
    it('配置缺失或非法（非正数）→ 回退默认 648', async () => {
      expect(await svc.getPlatformDailyMax()).toBe(648);

      await db('system_config').insert({
        key: 'consumption.daily_max',
        value: '-5',
        description: null,
        updated_at: new Date().toISOString(),
      });
      expect(await svc.getPlatformDailyMax()).toBe(648);
    });
  });
});
