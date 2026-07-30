// ============================================================================
// pointsService.test.ts — 实例点券服务核心资金路径单元测试
// 覆盖：getOrCreatePoints 幂等 / credit / debit（原子扣减、不足拒绝、实例隔离） /
//       grantPoints（管理员发放审计字段）
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createPointsService, type PointsServiceImpl } from './pointsService.js';
import { InsufficientBalanceError, ValidationError } from './errors.js';

const USER = 'user-1';
const SERVER = 'srv-1';

describe('pointsService 资金核心路径', () => {
  let db: Knex;
  let svc: PointsServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    svc = createPointsService(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  async function getPoints(userId = USER, serverId = SERVER): Promise<Record<string, unknown>> {
    return db('instance_points').where({ user_id: userId, server_id: serverId }).first();
  }

  describe('getOrCreatePoints', () => {
    it('首次访问自动创建 balance=0，重复调用幂等（PK(user_id,server_id)）', async () => {
      const first = await svc.getOrCreatePoints(USER, SERVER);
      expect(first.balance).toBe(0);

      await svc.getOrCreatePoints(USER, SERVER);
      const rows = await db('instance_points').where({ user_id: USER, server_id: SERVER });
      expect(rows).toHaveLength(1);
    });
  });

  describe('credit（加点券）', () => {
    it('正常入账：balance/total_earned 增加，写正金额流水（currency_type=points）', async () => {
      const txId = await svc.credit(USER, SERVER, 300, 'cdk_recharge', 'CDK点券充值');

      const row = await getPoints();
      expect(row.balance).toBe(300);
      expect(row.total_earned).toBe(300);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.currency_type).toBe('points');
      expect(tx.type).toBe('cdk_recharge');
      expect(tx.amount).toBe(300);
      expect(tx.balance_after).toBe(300);
      expect(tx.server_id).toBe(SERVER);
    });

    it('非正整数金额 → ValidationError，不产生任何记录', async () => {
      await expect(svc.credit(USER, SERVER, 0, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.credit(USER, SERVER, -5, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.credit(USER, SERVER, 2.5, 'admin_credit', 'x')).rejects.toBeInstanceOf(ValidationError);
      // 非法金额被前置校验拒绝，点券记录与流水均未创建
      const row = await getPoints();
      expect(row).toBeUndefined();
      const txs = await db('wallet_transactions').where({ user_id: USER });
      expect(txs).toHaveLength(0);
    });
  });

  describe('debit（扣点券）', () => {
    it('余额充足：balance/total_spent 正确变动，写负金额流水', async () => {
      await svc.credit(USER, SERVER, 200, 'admin_credit', '发放');
      const txId = await svc.debit(USER, SERVER, 80, 'shop_purchase', '商城消费');

      const row = await getPoints();
      expect(row.balance).toBe(120);
      expect(row.total_spent).toBe(80);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.amount).toBe(-80);
      expect(tx.balance_after).toBe(120);
    });

    it('余额不足 → InsufficientBalanceError，余额与流水均不变（原子 UPDATE 防超扣）', async () => {
      await svc.credit(USER, SERVER, 50, 'admin_credit', '发放');
      const txCountBefore = (await db('wallet_transactions').where({ user_id: USER })).length;

      await expect(
        svc.debit(USER, SERVER, 51, 'shop_purchase', '商城消费'),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      const row = await getPoints();
      expect(row.balance).toBe(50);
      expect(row.total_spent).toBe(0);
      const txCountAfter = (await db('wallet_transactions').where({ user_id: USER })).length;
      expect(txCountAfter).toBe(txCountBefore); // 无新增流水
    });

    it('实例隔离：A 服点券不能用于 B 服扣款', async () => {
      await svc.credit(USER, 'srv-a', 100, 'admin_credit', '发放');
      // B 服无点券 → 扣款拒绝
      await expect(
        svc.debit(USER, 'srv-b', 1, 'shop_purchase', '跨服消费'),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      const rowA = await getPoints(USER, 'srv-a');
      expect(rowA.balance).toBe(100); // A 服不受影响
    });

    it('非正整数金额 → ValidationError', async () => {
      await expect(svc.debit(USER, SERVER, 0, 'shop_purchase', 'x')).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.debit(USER, SERVER, -1, 'shop_purchase', 'x')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('grantPoints（管理员发放）', () => {
    it('等价 credit(type=admin_credit)，operator_user_id 记录发放管理员', async () => {
      const txId = await svc.grantPoints('admin-1', USER, SERVER, 500);

      const row = await getPoints();
      expect(row.balance).toBe(500);

      const tx = await db('wallet_transactions').where({ id: txId }).first();
      expect(tx.type).toBe('admin_credit');
      expect(tx.operator_user_id).toBe('admin-1');
      expect(tx.user_id).toBe(USER); // 收款方
    });
  });
});
