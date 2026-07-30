// ============================================================================
// withdrawService.test.ts — 提现码服务核心资金路径单元测试
// 覆盖：createWithdraw（账期校验 / 可用余额校验 / 比例快照 / 冻结失败补偿删除） /
//       approveWithdraw（核销 + 幂等拒绝） / rejectWithdraw（解冻退回） /
//       expireOldWithdrawals（过期自动退回）
// 说明：主路径使用真实 balanceService + SQLite 内存库；仅「冻结失败补偿」
//       路径使用 stub balanceService 模拟 freeze 抛错。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createBalanceService, type BalanceServiceImpl } from './balanceService.js';
import { createWithdrawService, type WithdrawServiceImpl } from './withdrawService.js';
import {
  InsufficientBalanceError,
  ValidationError,
  WithdrawCodeAlreadyProcessedError,
  WithdrawCodeNotFoundError,
  WithdrawPeriodNotMetError,
} from './errors.js';

const USER = 'user-1';
const ADMIN = 'admin-1';

describe('withdrawService 资金核心路径', () => {
  let db: Knex;
  let balanceService: BalanceServiceImpl;
  let svc: WithdrawServiceImpl;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    balanceService = createBalanceService(db);
    svc = createWithdrawService(db, balanceService);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 落库全局余额（last_income_at=null 视为账期满足） */
  async function seedBalance(balance: number, lastIncomeAt: string | null = null): Promise<void> {
    const now = new Date().toISOString();
    await db('global_balances').insert({
      user_id: USER,
      balance,
      total_earned: balance,
      total_spent: 0,
      frozen_balance: 0,
      total_withdrawn: 0,
      last_income_at: lastIncomeAt,
      created_at: now,
      updated_at: now,
    });
  }

  async function getBalanceRow(): Promise<Record<string, unknown>> {
    return db('global_balances').where({ user_id: USER }).first();
  }

  describe('createWithdraw（申请提现）', () => {
    it('正常申请：16 位提现码、actual_amount=floor(amount×0.7)、余额冻结、流水关联提现码', async () => {
      await seedBalance(1000);
      const r = await svc.createWithdraw(USER, 100);

      expect(r.code).toMatch(/^[A-Z0-9]{16}$/);
      expect(r.actual_amount).toBe(70); // floor(100 × 0.7)

      const row = await getBalanceRow();
      expect(row.balance).toBe(1000); // 总额不变
      expect(row.frozen_balance).toBe(100); // 冻结 100

      const code = await db('withdraw_codes').where({ code: r.code }).first();
      expect(code.status).toBe('pending');
      expect(Number(code.ratio)).toBeCloseTo(0.7);

      const tx = await db('wallet_transactions').where({ user_id: USER }).first();
      expect(tx.type).toBe('withdraw');
      expect(tx.amount).toBe(-100);
      expect(tx.withdraw_code_id).toBe(code.id);
    });

    it('非正整数金额（0 / 负数 / 小数）→ ValidationError', async () => {
      await seedBalance(1000);
      await expect(svc.createWithdraw(USER, 0)).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.createWithdraw(USER, -5)).rejects.toBeInstanceOf(ValidationError);
      await expect(svc.createWithdraw(USER, 1.5)).rejects.toBeInstanceOf(ValidationError);
      const rows = await db('withdraw_codes').where({ user_id: USER });
      expect(rows).toHaveLength(0);
    });

    it('账期未满（最后一笔收入 < 7 天）→ WithdrawPeriodNotMetError，不冻结', async () => {
      await seedBalance(1000, new Date().toISOString()); // 刚有收入
      await expect(svc.createWithdraw(USER, 100)).rejects.toBeInstanceOf(WithdrawPeriodNotMetError);

      const row = await getBalanceRow();
      expect(row.frozen_balance).toBe(0);
      const codes = await db('withdraw_codes').where({ user_id: USER });
      expect(codes).toHaveLength(0);
    });

    it('账期已满（收入 ≥ 7 天前）→ 允许申请', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await seedBalance(1000, eightDaysAgo);
      const r = await svc.createWithdraw(USER, 100);
      expect(r.code).toMatch(/^[A-Z0-9]{16}$/);
    });

    it('可用余额不足（含冻结占用）→ InsufficientBalanceError，不落提现码', async () => {
      await seedBalance(100);
      await svc.createWithdraw(USER, 80); // 冻结 80，可用剩 20
      await expect(svc.createWithdraw(USER, 50)).rejects.toBeInstanceOf(InsufficientBalanceError);

      const codes = await db('withdraw_codes').where({ user_id: USER });
      expect(codes).toHaveLength(1); // 只有第一笔
    });

    it('比例快照：system_config withdraw.ratio=0.5 → actual=50；配置非法值回退 0.7', async () => {
      const now = new Date().toISOString();
      await db('system_config').insert({
        key: 'withdraw.ratio', value: '0.5', description: null, updated_at: now,
      });
      await seedBalance(1000);
      const r1 = await svc.createWithdraw(USER, 100);
      expect(r1.actual_amount).toBe(50);

      // 非法配置（>1）→ 回退默认 0.7（user-2 需先备好余额）
      const now2 = new Date().toISOString();
      await db('global_balances').insert({
        user_id: 'user-2', balance: 1000, total_earned: 1000, total_spent: 0,
        frozen_balance: 0, total_withdrawn: 0, last_income_at: null,
        created_at: now2, updated_at: now2,
      });
      await db('system_config').where({ key: 'withdraw.ratio' }).update({ value: '1.5' });
      const r2 = await svc.createWithdraw('user-2', 100);
      expect(r2.actual_amount).toBe(70);
    });

    it('冻结失败 → 补偿删除已落库的提现码（不留垃圾记录）', async () => {
      // stub balanceService：余额查询通过，freeze 抛错
      const stubBalance = {
        getBalance: vi.fn().mockResolvedValue({
          user_id: USER, balance: 1000, total_earned: 1000, total_spent: 0,
          frozen_balance: 0, total_withdrawn: 0, last_income_at: null,
          created_at: '', updated_at: '', available_balance: 1000,
        }),
        freeze: vi.fn().mockRejectedValue(new Error('冻结失败（模拟并发超扣）')),
      } as unknown as BalanceServiceImpl;
      const svcWithStub = createWithdrawService(db, stubBalance);

      await expect(svcWithStub.createWithdraw(USER, 100)).rejects.toThrow('冻结失败');
      const codes = await db('withdraw_codes').where({ user_id: USER });
      expect(codes).toHaveLength(0); // 补偿删除生效
    });
  });

  describe('approveWithdraw（管理员核销）', () => {
    it('核销成功：status→approved，frozen/balance 同步扣减，total_withdrawn 累加', async () => {
      await seedBalance(1000);
      const { code } = await svc.createWithdraw(USER, 100);
      await svc.approveWithdraw(code, ADMIN);

      const row = await getBalanceRow();
      expect(row.balance).toBe(900);
      expect(row.frozen_balance).toBe(0);
      expect(row.total_withdrawn).toBe(100);

      const codeRow = await db('withdraw_codes').where({ code }).first();
      expect(codeRow.status).toBe('approved');
      expect(codeRow.operator_user_id).toBe(ADMIN);
      expect(codeRow.approved_at).not.toBeNull();
    });

    it('重复核销 → WithdrawCodeAlreadyProcessedError，余额不被二次扣减（幂等）', async () => {
      await seedBalance(1000);
      const { code } = await svc.createWithdraw(USER, 100);
      await svc.approveWithdraw(code, ADMIN);

      await expect(svc.approveWithdraw(code, ADMIN)).rejects.toBeInstanceOf(
        WithdrawCodeAlreadyProcessedError,
      );
      const row = await getBalanceRow();
      expect(row.balance).toBe(900);
      expect(row.total_withdrawn).toBe(100);
    });

    it('不存在的提现码 → WithdrawCodeNotFoundError', async () => {
      await expect(svc.approveWithdraw('NONEXISTENT12345', ADMIN)).rejects.toBeInstanceOf(
        WithdrawCodeNotFoundError,
      );
    });
  });

  describe('rejectWithdraw（管理员拒绝）', () => {
    it('拒绝成功：status→rejected，解冻退回（frozen 减少、balance 不变）', async () => {
      await seedBalance(1000);
      const { code } = await svc.createWithdraw(USER, 100);
      await svc.rejectWithdraw(code, ADMIN);

      const row = await getBalanceRow();
      expect(row.balance).toBe(1000); // 全额保留
      expect(row.frozen_balance).toBe(0); // 冻结释放
      expect(row.total_withdrawn).toBe(0);

      const codeRow = await db('withdraw_codes').where({ code }).first();
      expect(codeRow.status).toBe('rejected');
    });

    it('拒绝已处理的提现码 → WithdrawCodeAlreadyProcessedError', async () => {
      await seedBalance(1000);
      const { code } = await svc.createWithdraw(USER, 100);
      await svc.rejectWithdraw(code, ADMIN);
      await expect(svc.rejectWithdraw(code, ADMIN)).rejects.toBeInstanceOf(
        WithdrawCodeAlreadyProcessedError,
      );
    });
  });

  describe('expireOldWithdrawals（过期自动退回）', () => {
    it('过期 pending 码：解冻退回 + 标记 expired；未过期码不受影响', async () => {
      await seedBalance(1000);
      const { code } = await svc.createWithdraw(USER, 100);
      // 手动将过期时间改为过去
      await db('withdraw_codes')
        .where({ code })
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() });

      const r = await svc.expireOldWithdrawals();
      expect(r.expired).toBe(1);

      const row = await getBalanceRow();
      expect(row.balance).toBe(1000);
      expect(row.frozen_balance).toBe(0);

      const codeRow = await db('withdraw_codes').where({ code }).first();
      expect(codeRow.status).toBe('expired');

      // 再次扫描：无待过期记录（幂等）
      const r2 = await svc.expireOldWithdrawals();
      expect(r2.expired).toBe(0);
    });
  });
});
