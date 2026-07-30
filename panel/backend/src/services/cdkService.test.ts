// ============================================================================
// cdkService.test.ts — CDK 兑换码核心资金路径单元测试
// 覆盖：redeem 两段事务（并发抢占幂等 / 过期拒绝 / 命令失败回滚 unused）/
//       generateUserCdk（冻结余额、余额不足清理落库行、日限额拒绝）/
//       redeemEconomic（balance 发放 + 生成者冻结核销 + 积分回赠）/
//       refundExpiredCdk（过期解冻退费幂等）
// 说明：instanceBindingService 走 getDatabase() 单例，以 vi.mock 隔离；
//       commandDispatcher / PackRegistry 使用内存 stub，聚焦资金路径。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createCdkService, type CdkServiceImpl } from './cdkService.js';
import { createBalanceService } from './balanceService.js';
import { createPointsService } from './pointsService.js';
import { createIntegralService } from './integralService.js';
import { createPricingService } from './pricingService.js';
import {
  CdkAlreadyClaimedError,
  CdkExpiredError,
  CdkNotFoundError,
  DailyLimitExceededError,
  InsufficientBalanceError,
} from './errors.js';
import type { PackRegistry } from '../core/packs/registry.js';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';

// mock 实例绑定服务：redeemGlobal 自动关注实例使用，测试聚焦资金路径
vi.mock('./instanceBindingService.js', () => ({
  isBound: vi.fn().mockResolvedValue(true),
  bindInstance: vi.fn().mockResolvedValue(undefined),
  getUserVipLevel: vi.fn().mockResolvedValue(0),
}));

const ADMIN = 'admin-1';
const USER = 'user-1';
const CREATOR = 'creator-1';
const SERVER = 'srv-1';

/** 内存 commandDispatcher stub：renderCommand 直接替换变量，enqueue 记录调用 */
function createDispatcherStub() {
  const enqueued: string[] = [];
  const stub: CommandDispatcher = {
    renderCommand(template: string, vars: Record<string, string>): string {
      return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
    },
    enqueue: vi.fn(async (_serverId: string, command: string) => {
      enqueued.push(command);
      return enqueued.length;
    }),
    sendViaDaemon: vi.fn(async () => ({ success: true })),
    retry: vi.fn(async () => undefined),
    processQueue: vi.fn(async () => undefined),
  };
  return { stub, enqueued };
}

/** PackRegistry stub：返回带 cdk/shop 命令模板的 Pack */
function createRegistryStub(): PackRegistry {
  return {
    get: (packId: string) =>
      packId === 'pack-1'
        ? {
            id: 'pack-1',
            business: {
              cdk: { enabled: true, redeem_command: 'give {{player}} {{item}} {{count}}' },
              shop: { give_command: 'give {{player}} {{item}} {{count}}' },
            },
          }
        : undefined,
  } as unknown as PackRegistry;
}

describe('cdkService 资金核心路径', () => {
  let db: Knex;
  let svc: CdkServiceImpl;
  let balanceSvc: ReturnType<typeof createBalanceService>;
  let dispatcher: ReturnType<typeof createDispatcherStub>;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    balanceSvc = createBalanceService(db);
    dispatcher = createDispatcherStub();
    svc = createCdkService(db, createRegistryStub(), dispatcher.stub, {
      balanceService: balanceSvc,
      pointsService: createPointsService(db),
      integralService: createIntegralService(db),
      pricingService: createPricingService(db),
    });
    // servers 表落库（renderRedeemCommand 查 pack_id）
    const now = new Date().toISOString();
    await db('servers').insert({
      id: SERVER, name: 's1', pack_id: 'pack-1', game_type: 'mc', node_id: 'n1',
      owner_user_id: ADMIN, status: 'running', port: 25565, rcon_port: 25575,
      rcon_password_enc: null, resource_limits_json: null, created_at: now, updated_at: now,
    });
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 创建单个物品 CDK 并返回 code */
  async function seedItemCdk(code: string, expiresInDays = 30): Promise<void> {
    await svc.createCodes(ADMIN, SERVER, {
      codes: [{ code, item_name: '钻石剑', count: 1 }],
      expires_in_days: expiresInDays,
    });
  }

  describe('redeem（两段事务：物品类）', () => {
    it('正常兑换：unused → claimed，命令入队，claimed_player 记录', async () => {
      await seedItemCdk('CODE-OK-1');

      const r = await svc.redeem(SERVER, { code: 'CODE-OK-1', player_name: 'Steve' });
      expect(r.delivered).toBe(true);
      expect(r.code.status).toBe('claimed');
      expect(r.code.claimed_player).toBe('Steve');
      expect(dispatcher.enqueued).toEqual(['give Steve 钻石剑 1']);
    });

    it('重复兑换 → CdkAlreadyClaimedError，命令不重复入队（幂等）', async () => {
      await seedItemCdk('CODE-DUP-1');
      await svc.redeem(SERVER, { code: 'CODE-DUP-1', player_name: 'Steve' });

      await expect(
        svc.redeem(SERVER, { code: 'CODE-DUP-1', player_name: 'Alex' }),
      ).rejects.toBeInstanceOf(CdkAlreadyClaimedError);
      expect(dispatcher.enqueued).toHaveLength(1); // 仅第一次入队
    });

    it('过期 CDK → CdkExpiredError；不存在 → CdkNotFoundError', async () => {
      await seedItemCdk('CODE-EXP-1', -1); // 已过期

      await expect(
        svc.redeem(SERVER, { code: 'CODE-EXP-1', player_name: 'Steve' }),
      ).rejects.toBeInstanceOf(CdkExpiredError);
      await expect(
        svc.redeem(SERVER, { code: 'NO-SUCH', player_name: 'Steve' }),
      ).rejects.toBeInstanceOf(CdkNotFoundError);
    });

    it('命令入队失败 → 回滚 unused，可再次兑换', async () => {
      await seedItemCdk('CODE-FAIL-1');
      (dispatcher.stub.enqueue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('queue full'),
      );

      await expect(
        svc.redeem(SERVER, { code: 'CODE-FAIL-1', player_name: 'Steve' }),
      ).rejects.toThrow('queue full');

      // 回滚后状态恢复 unused，重试成功
      const row = await db('cdk_codes').where({ code: 'CODE-FAIL-1' }).first();
      expect(row.status).toBe('unused');
      const r = await svc.redeem(SERVER, { code: 'CODE-FAIL-1', player_name: 'Steve' });
      expect(r.code.status).toBe('claimed');
    });
  });

  describe('generateUserCdk（用户自生成：冻结余额）', () => {
    it('points CDK：按兑换比折算冻结成本，7 天有效期，流水 cdk_generate 关联 cdkId', async () => {
      await balanceSvc.credit(USER, 1000, 'admin_credit', '预置');
      // points_exchange_ratio=2.0 → 面值 100 点券冻结 50 余额
      await db('instance_pricing').insert({
        server_id: SERVER, vip_monthly_price: null, vip_lifetime_price: null,
        points_exchange_ratio: 2.0, integral_ratio: 1.0, daily_consumption_limit: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });

      const r = await svc.generateUserCdk(USER, { type: 'points', server_id: SERVER, amount: 100 });
      expect(r.frozen_amount).toBe(50); // ceil(100 / 2.0)

      const bal = await balanceSvc.getBalance(USER);
      // freeze 语义：balance 总额不变，frozen_balance 增加（可用 = balance - frozen）
      expect(bal.balance).toBe(1000);
      expect(bal.frozen_balance).toBe(50);

      const cdkRow = await db('cdk_codes').where({ code: r.code }).first();
      expect(cdkRow.type).toBe('points');
      expect(cdkRow.amount).toBe(100); // 面值
      expect(cdkRow.count).toBe(50); // 冻结成本
      expect(cdkRow.creator_user_id).toBe(USER);
      // 7 天有效期
      const deltaDays = (new Date(r.expires_at).getTime() - Date.now()) / 86400000;
      expect(deltaDays).toBeGreaterThan(6);
      expect(deltaDays).toBeLessThan(8);
    });

    it('余额不足冻结 → InsufficientBalanceError，已落库 CDK 行被清理', async () => {
      await balanceSvc.credit(USER, 10, 'admin_credit', '预置'); // 远不够 100

      await expect(
        svc.generateUserCdk(USER, { type: 'points', server_id: SERVER, amount: 100 }),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      const rows = await db('cdk_codes').where({ creator_user_id: USER });
      expect(rows).toHaveLength(0); // 落库行已清理
    });

    it('超出单日消费上限 → DailyLimitExceededError，无冻结无落库', async () => {
      await balanceSvc.credit(USER, 10000, 'admin_credit', '预置');
      await db('instance_pricing').insert({
        server_id: SERVER, vip_monthly_price: null, vip_lifetime_price: null,
        points_exchange_ratio: 1.0, integral_ratio: 1.0, daily_consumption_limit: 50,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });

      await expect(
        svc.generateUserCdk(USER, { type: 'points', server_id: SERVER, amount: 51 }),
      ).rejects.toBeInstanceOf(DailyLimitExceededError);

      const bal = await balanceSvc.getBalance(USER);
      expect(bal.frozen_balance).toBe(0);
    });
  });

  describe('redeemEconomic（经济类兑换 + 生成者核销）', () => {
    it('管理员 balance CDK：兑换者入账，无生成者核销，重复兑换拒绝', async () => {
      await svc.createCodes(ADMIN, '', {
        codes: [{ code: 'BAL-100', type: 'balance', amount: 100 }],
        expires_in_days: 30,
      });

      const r = await svc.redeemEconomic(USER, 'BAL-100');
      expect(r.delivered).toBe(true);

      const bal = await balanceSvc.getBalance(USER);
      expect(bal.balance).toBe(100);
      const tx = await db('wallet_transactions').where({ user_id: USER, type: 'cdk_recharge' }).first();
      expect(tx.amount).toBe(100);

      await expect(svc.redeemEconomic('user-2', 'BAL-100')).rejects.toBeInstanceOf(
        CdkAlreadyClaimedError,
      );
      // user-2 无入账
      const bal2 = await balanceSvc.getBalance('user-2');
      expect(bal2.balance).toBe(0);
    });

    it('用户自生成 points CDK 被兑换：兑换者得点券，生成者冻结核销 + 积分回赠', async () => {
      // 生成者预置余额并生成 points CDK（ratio=1.0：面值 100 = 冻结 100）
      await balanceSvc.credit(CREATOR, 500, 'admin_credit', '预置');
      const gen = await svc.generateUserCdk(CREATOR, {
        type: 'points', server_id: SERVER, amount: 100,
      });
      expect(gen.frozen_amount).toBe(100);

      await svc.redeemEconomic(USER, gen.code);

      // 兑换者：点券 +100
      const points = await db('instance_points').where({ user_id: USER, server_id: SERVER }).first();
      expect(points.balance).toBe(100);

      // 生成者：冻结 100 正式核销（frozen=0, total_spent=100）
      const creatorBal = await balanceSvc.getBalance(CREATOR);
      expect(creatorBal.balance).toBe(400);
      expect(creatorBal.frozen_balance).toBe(0);
      expect(creatorBal.total_spent).toBe(100);
      const settleTx = await db('wallet_transactions')
        .where({ user_id: CREATOR, type: 'cdk_redeem' }).first();
      expect(settleTx.amount).toBe(-100);

      // 生成者积分回赠：100 × integral_ratio(1.0) = 100
      const integral = await db('user_integrals').where({ user_id: CREATOR, server_id: SERVER }).first();
      expect(integral.current_integral).toBe(100);
    });
  });

  describe('refundExpiredCdk（过期退费）', () => {
    it('用户自生成 CDK 过期：解冻退费（cdk_refund），标记 expired + refunded_at，二次扫描幂等', async () => {
      await balanceSvc.credit(CREATOR, 500, 'admin_credit', '预置');
      const gen = await svc.generateUserCdk(CREATOR, {
        type: 'points', server_id: SERVER, amount: 100,
      });
      // 手工改成已过期
      const past = new Date(Date.now() - 1000).toISOString();
      await db('cdk_codes').where({ code: gen.code }).update({ expires_at: past });

      const r = await svc.refundExpiredCdk();
      expect(r.refunded).toBe(1);

      // 冻结解冻退回可用余额
      const bal = await balanceSvc.getBalance(CREATOR);
      expect(bal.balance).toBe(500);
      expect(bal.frozen_balance).toBe(0);
      expect(bal.total_spent).toBe(0); // 退费不算消费

      const row = await db('cdk_codes').where({ code: gen.code }).first();
      expect(row.status).toBe('expired');
      expect(row.refunded_at).not.toBeNull();
      expect(row.refund_tx_id).not.toBeNull();
      const refundTx = await db('wallet_transactions').where({ id: row.refund_tx_id }).first();
      expect(refundTx.type).toBe('cdk_refund');

      // 二次扫描：refunded_at 已写，不再处理
      const r2 = await svc.refundExpiredCdk();
      expect(r2.refunded).toBe(0);
    });
  });
});
