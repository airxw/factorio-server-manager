// ============================================================================
// shopService.test.ts — 商店订单核心资金路径单元测试
// 覆盖：createOrder（余额扣减、不足拒绝不落单、VIP 等级校验）/
//       claimOrder 两段事务（并发抢占幂等、过期拒绝、命令失败回滚 pending）
// 说明：instanceBindingService 走 getDatabase() 单例，以 vi.mock 隔离；
//       walletService 使用真实实现（同一内存 DB），commandDispatcher 用内存 stub。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDb, destroyTestDb, createEconomyTables } from '../test/db-helper.js';
import { createShopService, type ShopServiceImpl } from './shopService.js';
import { createWalletService } from './walletService.js';
import {
  InsufficientBalanceError,
  ShopOrderAlreadyClaimedError,
  ShopOrderExpiredError,
  ShopOrderNotFoundError,
  VipLevelInsufficientError,
} from './errors.js';
import type { PackRegistry } from '../core/packs/registry.js';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import * as instanceBindingService from './instanceBindingService.js';

// mock 实例绑定服务：createOrder 的绑定/VIP 等级校验使用
vi.mock('./instanceBindingService.js', () => ({
  isBound: vi.fn(),
  bindInstance: vi.fn(),
  getUserVipLevel: vi.fn(),
}));

const USER = 'user-1';
const SERVER = 'srv-1';

const isBoundMock = instanceBindingService.isBound as unknown as ReturnType<typeof vi.fn>;
const getUserVipLevelMock = instanceBindingService.getUserVipLevel as unknown as ReturnType<typeof vi.fn>;

/** 内存 commandDispatcher stub */
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

/** PackRegistry stub（shop.give_command 模板） */
function createRegistryStub(): PackRegistry {
  return {
    get: (packId: string) =>
      packId === 'pack-1'
        ? { id: 'pack-1', business: { shop: { give_command: 'give {{player}} {{item}} {{count}}' } } }
        : undefined,
  } as unknown as PackRegistry;
}

describe('shopService 资金核心路径', () => {
  let db: Knex;
  let svc: ShopServiceImpl;
  let dispatcher: ReturnType<typeof createDispatcherStub>;

  beforeEach(async () => {
    db = await createTestDb();
    await createEconomyTables(db);
    dispatcher = createDispatcherStub();
    svc = createShopService(
      db,
      createRegistryStub(),
      dispatcher.stub,
      createWalletService(db),
    );
    getUserVipLevelMock.mockResolvedValue(0);
    // 默认已绑定实例（assertInstanceAccess 第一道闸门直接通过）
    isBoundMock.mockResolvedValue(true);

    // servers + shop_items 落库
    const now = new Date().toISOString();
    await db('servers').insert({
      id: SERVER, name: 's1', pack_id: 'pack-1', game_type: 'mc', node_id: 'n1',
      owner_user_id: 'owner-1', status: 'running', port: 25565, rcon_port: 25575,
      rcon_password_enc: null, resource_limits_json: null, created_at: now, updated_at: now,
    });
    await db('shop_items').insert([
      { server_id: SERVER, item_name: '钻石', quality: 'normal', vip_level_required: 0, price: 50, daily_limit: null, enabled: 1, created_at: now, updated_at: now },
      { server_id: SERVER, item_name: '下界之星', quality: 'legendary', vip_level_required: 3, price: 500, daily_limit: null, enabled: 1, created_at: now, updated_at: now },
      { server_id: SERVER, item_name: '下架物品', quality: 'normal', vip_level_required: 0, price: 10, daily_limit: null, enabled: 0, created_at: now, updated_at: now },
    ]);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  /** 预置实例钱包点券 */
  async function seedWallet(amount: number): Promise<void> {
    const now = new Date().toISOString();
    await db('user_wallets').insert({
      user_id: USER, server_id: SERVER, balance: amount, total_earned: amount,
      total_spent: 0, last_daily_claim_at: null, last_daily_claim_date: null,
      created_at: now, updated_at: now,
    });
  }

  async function getWallet(): Promise<Record<string, unknown>> {
    return db('user_wallets').where({ user_id: USER, server_id: SERVER }).first();
  }

  describe('createOrder（下单扣款）', () => {
    it('正常下单：按价格快照扣款，订单 pending + 明细落库', async () => {
      await seedWallet(200);

      const { order, items } = await svc.createOrder(USER, SERVER, {
        items: [{ item_name: '钻石', count: 2 }],
      }, 'user');

      expect(order.status).toBe('pending');
      expect(order.total_price).toBe(100); // 50 × 2
      expect(order.items_count).toBe(2);
      expect(items).toHaveLength(1);
      expect(items[0].price).toBe(50); // 价格快照

      const w = await getWallet();
      expect(w.balance).toBe(100);
      expect(w.total_spent).toBe(100);
    });

    it('余额不足 → InsufficientBalanceError，订单不落库、余额不变（原子性）', async () => {
      await seedWallet(30); // 不足 50

      await expect(
        svc.createOrder(USER, SERVER, { items: [{ item_name: '钻石', count: 1 }] }, 'user'),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      const orders = await db('shop_orders').where({ user_id: USER });
      expect(orders).toHaveLength(0);
      const w = await getWallet();
      expect(w.balance).toBe(30);
    });

    it('VIP 等级不足 → VipLevelInsufficientError，不扣款不落单', async () => {
      await seedWallet(10000);
      getUserVipLevelMock.mockResolvedValue(1); // 需 VIP3

      await expect(
        svc.createOrder(USER, SERVER, { items: [{ item_name: '下界之星', count: 1 }] }, 'user'),
      ).rejects.toBeInstanceOf(VipLevelInsufficientError);

      const orders = await db('shop_orders').where({ user_id: USER });
      expect(orders).toHaveLength(0);
      const w = await getWallet();
      expect(w.balance).toBe(10000);
    });

    it('下架物品 → ShopItemNotFoundError，不扣款', async () => {
      await seedWallet(200);

      await expect(
        svc.createOrder(USER, SERVER, { items: [{ item_name: '下架物品', count: 1 }] }, 'user'),
      ).rejects.toThrow('物品未上架或已下架');

      const w = await getWallet();
      expect(w.balance).toBe(200);
    });
  });

  describe('claimOrder（两段事务）', () => {
    /** 下单并返回 claim_code */
    async function createPendingOrder(): Promise<string> {
      await seedWallet(200);
      const { order } = await svc.createOrder(USER, SERVER, {
        items: [{ item_name: '钻石', count: 1 }],
      }, 'user');
      return order.claim_code;
    }

    it('正常领取：pending → claimed，give 命令入队', async () => {
      const code = await createPendingOrder();

      const r = await svc.claimOrder(SERVER, { claim_code: code, player_name: 'Steve' });
      expect(r.delivered).toBe(true);
      expect(r.order.status).toBe('claimed');
      expect(r.order.claimed_player).toBe('Steve');
      expect(dispatcher.enqueued).toEqual(['give Steve 钻石 1']);
    });

    it('重复领取 → ShopOrderAlreadyClaimedError，命令不重复入队（幂等）', async () => {
      const code = await createPendingOrder();
      await svc.claimOrder(SERVER, { claim_code: code, player_name: 'Steve' });

      await expect(
        svc.claimOrder(SERVER, { claim_code: code, player_name: 'Alex' }),
      ).rejects.toBeInstanceOf(ShopOrderAlreadyClaimedError);
      expect(dispatcher.enqueued).toHaveLength(1);
    });

    it('过期订单 → ShopOrderExpiredError；无效领取码 → ShopOrderNotFoundError', async () => {
      const code = await createPendingOrder();
      // 手工改成已过期
      const past = new Date(Date.now() - 1000).toISOString();
      await db('shop_orders').where({ claim_code: code }).update({ expires_at: past });

      await expect(
        svc.claimOrder(SERVER, { claim_code: code, player_name: 'Steve' }),
      ).rejects.toBeInstanceOf(ShopOrderExpiredError);
      await expect(
        svc.claimOrder(SERVER, { claim_code: 'NO-SUCH-CODE', player_name: 'Steve' }),
      ).rejects.toBeInstanceOf(ShopOrderNotFoundError);
    });

    it('命令入队失败 → 回滚 pending，可重试领取', async () => {
      const code = await createPendingOrder();
      (dispatcher.stub.enqueue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('queue full'),
      );

      await expect(
        svc.claimOrder(SERVER, { claim_code: code, player_name: 'Steve' }),
      ).rejects.toThrow('queue full');

      // 回滚后恢复 pending，重试成功
      const row = await db('shop_orders').where({ claim_code: code }).first();
      expect(row.status).toBe('pending');
      const r = await svc.claimOrder(SERVER, { claim_code: code, player_name: 'Steve' });
      expect(r.order.status).toBe('claimed');
    });
  });
});
