// ============================================================================
// shopService — 商店物品管理 / 订单创建 / claimOrder 两段事务（乐观锁）
// 数据契约：public/schema/shop-items-schema.json / shop-orders-schema.json / shop-order-items-schema.json
// 表结构：  shop_items / shop_orders / shop_order_items（见 db/migrations/20260703000006_create_shop_tables.ts）
// 来源：scheme-final-merged.md §5.1 商店购买 + 物品发放 / §7.1 P2
//
// 说明：本服务按 P2 任务清单要求实现，签名与 @public/interface_stub/shop-service.d.ts
//      存根不完全一致（任务清单优先），因此不 implements ShopService 接口。
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import type { PackRegistry } from '../core/packs/registry.js';
import { Role, normalizeRole } from '../core/auth/roles.js';
import type { SettingSchemaService } from './settingSchemaService.js';
import * as instanceBindingService from './instanceBindingService.js';
import {
  ShopItemNotFoundError,
  ShopOrderNotFoundError,
  ShopOrderAlreadyClaimedError,
  ShopOrderExpiredError,
  VipLevelInsufficientError,
  BindingRequiredError,
} from './errors.js';
import type {
  ShopItemSummary,
  ShopOrderSummary,
  ShopOrderItemSummary,
  UpsertShopItemRequest,
  CreateShopOrderRequest,
  ClaimShopOrderRequest,
} from '@public/schema/panel-api-types';
import type { WalletServiceImpl } from './walletService.js';
import { InsufficientBalanceError } from './errors.js';

// ----- 常量 -----

/** 订单领取码长度（取自 UUID 去连字符前 12 位） */
const CLAIM_CODE_LEN = 12;
/** 订单过期时长（7 天，毫秒） */
const ORDER_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
/** 默认 give 命令模板（Pack 未配置时兜底） */
const DEFAULT_GIVE_COMMAND = 'give {{player}} {{item}} {{count}}';

// ----- DB 行类型 -----

interface ShopItemRow {
  id: number;
  server_id: string;
  item_name: string;
  quality: string;
  vip_level_required: number;
  price: number;
  daily_limit: number | null;
  enabled: number; // SQLite boolean as 0/1
  created_at: string;
  updated_at: string;
}

interface ShopOrderRow {
  id: number;
  server_id: string;
  user_id: string;
  status: string;
  claim_code: string;
  items_count: number;
  total_price: number;
  claimed_at: string | null;
  claiming_at: string | null; // S7-1: 进入 claiming 的时间戳，用于超时回滚
  expires_at: string;
  claimed_player: string | null;
  created_at: string;
  /** v4.36.1: LEFT JOIN users.username 得到，用户被删除时为 null */
  buyer_username?: string | null;
}

interface ShopOrderItemRow {
  id: number;
  order_id: number;
  item_name: string;
  count: number;
  price: number;
  quality: string;
}

interface ServerRow {
  id: string;
  pack_id: string;
  owner_user_id: string;
}

// ----- 服务实现 -----

export class ShopServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly commandDispatcher: CommandDispatcher,
    private readonly walletService: WalletServiceImpl,
    /** v3.8.0-S7: 可选注入——用于读取 vip.discount_levels 应用 VIP 折扣 */
    private readonly settingSchemaService?: SettingSchemaService,
  ) {}

  // ---- 商店物品 ----

  async listShopItems(serverId: string): Promise<ShopItemSummary[]> {
    const rows = await this.db<ShopItemRow>('shop_items')
      .where({ server_id: serverId })
      .orderBy('id', 'asc');
    return rows.map(toShopItemSummary);
  }

  async upsertShopItem(
    serverId: string,
    req: UpsertShopItemRequest,
  ): Promise<ShopItemSummary> {
    if (!req.item_name) {
      throw new ShopItemNotFoundError('缺少 item_name');
    }
    const quality = req.quality ?? 'normal';
    const vipLevel = req.vip_level_required ?? 0;
    const price = req.price ?? 0;
    const dailyLimit = req.daily_limit ?? null;
    const enabled = req.enabled ?? true;
    const now = new Date().toISOString();

    // ON CONFLICT(server_id, item_name) DO UPDATE
    const inserted = await this.db<ShopItemRow>('shop_items')
      .insert({
        server_id: serverId,
        item_name: req.item_name,
        quality,
        vip_level_required: vipLevel,
        price,
        daily_limit: dailyLimit,
        enabled: enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['server_id', 'item_name'] as never)
      .merge({
        quality,
        vip_level_required: vipLevel,
        price,
        daily_limit: dailyLimit,
        enabled: enabled ? 1 : 0,
        updated_at: now,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toShopItemSummary(row);
  }

  async deleteShopItem(serverId: string, id: number): Promise<void> {
    await this.db<ShopItemRow>('shop_items')
      .where({ server_id: serverId, id })
      .delete();
    // 幂等：不存在也不报错
  }

  // ---- 订单 ----

  async createOrder(
    userId: string,
    serverId: string,
    req: CreateShopOrderRequest,
    userRole: string,
  ): Promise<{ order: ShopOrderSummary; items: ShopOrderItemSummary[] }> {
    if (!req.items || req.items.length === 0) {
      throw new ShopItemNotFoundError('订单物品列表为空');
    }

    // 校验每个 item 在 shop_items 中存在且 enabled
    const itemNames = req.items.map((it) => it.item_name);
    const rows = await this.db<ShopItemRow>('shop_items')
      .where({ server_id: serverId })
      .whereIn('item_name', itemNames);

    const enabledMap = new Map<string, ShopItemRow>();
    for (const r of rows) {
      if (r.enabled === 1) {
        enabledMap.set(r.item_name, r);
      }
    }
    for (const it of req.items) {
      const found = enabledMap.get(it.item_name);
      if (!found) {
        throw new ShopItemNotFoundError(
          `物品未上架或已下架: ${it.item_name}`,
        );
      }
    }

    // v2.1.0: 入口绑定校验 —— 未绑定且非 owner/server_admin → 403
    await this.assertInstanceAccess(userId, serverId, userRole);

    // v2.1.0: VIP 等级校验 —— 按实例查询用户 VIP 等级，需 >= item.vip_level_required
    const userVipLevel = await instanceBindingService.getUserVipLevel(
      userId,
      serverId,
      userRole,
    );
    for (const it of req.items) {
      const found = enabledMap.get(it.item_name);
      if (!found) continue; // 前面已校验存在性，这里仅防御
      if (userVipLevel < found.vip_level_required) {
        throw new VipLevelInsufficientError(
          `VIP 等级不足：购买 ${it.item_name} 需 VIP${found.vip_level_required}，当前 VIP${userVipLevel}`,
        );
      }
    }

    // 经济系统：计算订单总金额 + 校验余额 + 扣款
    //   total_price = Σ(item.price × count)
    //   扣款在事务之前进行（原子 UPDATE），事务失败时退款
    let totalPrice = req.items.reduce((sum, it) => {
      const found = enabledMap.get(it.item_name);
      if (!found) return sum;
      return sum + found.price * it.count;
    }, 0);

    // v3.8.0-S7: 应用 VIP 折扣（vip.discount_levels JSON: {vip_level: 折扣百分比}）
    //   - 折扣百分比 100 = 原价，75 = 75折
    //   - settingSchemaService 未注入或读取失败时降级为不打折
    if (totalPrice > 0 && this.settingSchemaService) {
      try {
        const discountLevels = await this.settingSchemaService.getJSON<Record<string, number>>(
          'vip.discount_levels',
        );
        if (discountLevels && typeof discountLevels === 'object') {
          const key = String(userVipLevel);
          const discountPercent = discountLevels[key];
          if (typeof discountPercent === 'number' && Number.isFinite(discountPercent) && discountPercent > 0 && discountPercent < 100) {
            // 向下取整避免少扣（对平台有利），最低 0
            totalPrice = Math.max(0, Math.floor((totalPrice * discountPercent) / 100));
          }
        }
      } catch {
        // 折扣读取失败 → 不打折
      }
    }

    if (totalPrice > 0) {
      try {
        await this.walletService.debit(userId, serverId, totalPrice);
      } catch (err) {
        // 余额不足直接透传 InsufficientBalanceError
        if (err instanceof InsufficientBalanceError) throw err;
        throw err;
      }
    }

    // 生成 claim_code + 过期时间
    const claimCode = randomUUID().replace(/-/g, '').slice(0, CLAIM_CODE_LEN);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresIso = new Date(now + ORDER_EXPIRES_MS).toISOString();
    const itemsCount = req.items.reduce((sum, it) => sum + it.count, 0);

    // 事务插入 shop_orders + shop_order_items（含 price 快照）
    const orderItems: ShopOrderItemSummary[] = [];
    try {
      const orderId = await this.db.transaction(async (trx) => {
        const inserted = await trx<ShopOrderRow>('shop_orders')
          .insert({
            server_id: serverId,
            user_id: userId,
            status: 'pending',
            claim_code: claimCode,
            items_count: itemsCount,
            total_price: totalPrice,
            claimed_at: null,
            claiming_at: null,
            expires_at: expiresIso,
            claimed_player: null,
            created_at: nowIso,
          })
          .returning('id');
        const newId = Array.isArray(inserted) ? (inserted[0] as unknown as { id: number }).id : (inserted as unknown as { id: number }).id;

        const itemRows: Array<{
          order_id: number;
          item_name: string;
          count: number;
          price: number;
          quality: string;
        }> = req.items.map((it) => {
          const found = enabledMap.get(it.item_name);
          return {
            order_id: newId,
            item_name: it.item_name,
            count: it.count,
            price: found?.price ?? 0,
            quality: (it.quality ?? 'normal'),
          };
        });
        await trx<ShopOrderItemRow>('shop_order_items').insert(itemRows);

        // 收集返回的 items（id 由 DB 自增生成，回查以拿到 id）
        const createdItems = await trx<ShopOrderItemRow>('shop_order_items')
          .where({ order_id: newId })
          .orderBy('id', 'asc');
        for (const r of createdItems) {
          orderItems.push({
            id: r.id,
            order_id: r.order_id,
            item_name: r.item_name,
            count: r.count,
            price: r.price,
            quality: r.quality as ShopOrderItemSummary['quality'],
          });
        }
        return newId;
      });

      const order: ShopOrderSummary = {
        id: orderId,
        server_id: serverId,
        user_id: userId,
        status: 'pending',
        claim_code: claimCode,
        items_count: itemsCount,
        total_price: totalPrice,
        claimed_at: null,
        expires_at: expiresIso,
        claimed_player: null,
        created_at: nowIso,
      };
      return { order, items: orderItems };
    } catch (err) {
      // 事务失败：退款已扣的金额（totalPrice > 0 时才扣过）
      if (totalPrice > 0) {
        try {
          await this.walletService.refund(userId, serverId, totalPrice);
        } catch (refundErr) {
          // 退款失败不掩盖原错，仅记录日志
          console.error('[shopService] 退款失败:', refundErr);
        }
      }
      throw err;
    }
  }

  async listOrders(
    serverId: string,
    filter?: { userId?: string; status?: string },
  ): Promise<ShopOrderSummary[]> {
    // v4.36.1: LEFT JOIN users 取 buyer_username，供 admin「销售记录」展示
    const q = this.db<ShopOrderRow>('shop_orders')
      .leftJoin('users', 'shop_orders.user_id', 'users.id')
      .select('shop_orders.*', 'users.username as buyer_username')
      .where({ server_id: serverId });
    if (filter?.userId) {
      q.andWhere({ user_id: filter.userId });
    }
    if (filter?.status) {
      q.andWhere({ status: filter.status });
    }
    const rows = await q.orderBy('created_at', 'desc');
    return rows.map(toShopOrderSummary);
  }

  async getOrder(
    serverId: string,
    orderId: number,
  ): Promise<{ order: ShopOrderSummary; items: ShopOrderItemSummary[] }> {
    // v4.36.1: LEFT JOIN users 取 buyer_username
    const orderRow = await this.db<ShopOrderRow>('shop_orders')
      .leftJoin('users', 'shop_orders.user_id', 'users.id')
      .select('shop_orders.*', 'users.username as buyer_username')
      .where({ server_id: serverId, id: orderId })
      .first();
    if (!orderRow) {
      throw new ShopOrderNotFoundError(`订单不存在: server=${serverId}, id=${orderId}`);
    }
    const itemRows = await this.db<ShopOrderItemRow>('shop_order_items')
      .where({ order_id: orderId })
      .orderBy('id', 'asc');
    return {
      order: toShopOrderSummary(orderRow),
      items: itemRows.map(toShopOrderItemSummary),
    };
  }

  // ---- claimOrder 两段事务（核心） ----

  async claimOrder(
    serverId: string,
    req: ClaimShopOrderRequest,
  ): Promise<{ order: ShopOrderSummary; items: ShopOrderItemSummary[]; delivered: boolean }> {
    const claimCode = req.claim_code;
    const playerName = req.player_name;
    const nowIso = new Date().toISOString();

    // 阶段1：乐观锁抢占 pending → claiming
    //   条件：claim_code + server_id + status=pending + 未过期
    //   影响行数 0 → 区分 AlreadyClaimed / Expired / NotFound
    const updated = await this.db<ShopOrderRow>('shop_orders')
      .where({
        server_id: serverId,
        claim_code: claimCode,
        status: 'pending',
      })
      .where('expires_at', '>', nowIso)
      .update({ status: 'claiming', claiming_at: nowIso });

    if (updated === 0) {
      // 区分失败原因
      const row = await this.db<ShopOrderRow>('shop_orders')
        .where({ server_id: serverId, claim_code: claimCode })
        .first();
      if (!row) {
        throw new ShopOrderNotFoundError(`领取码无效: ${claimCode}`);
      }
      if (row.status === 'claimed' || row.status === 'claiming') {
        throw new ShopOrderAlreadyClaimedError(
          `订单已被领取或正在领取中: ${claimCode}`,
        );
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        throw new ShopOrderExpiredError(`订单已过期: ${claimCode}`);
      }
      // 状态非 pending 但未过期（理论上不会到这），统一按已被领取处理
      throw new ShopOrderAlreadyClaimedError(
        `订单状态不可领取: ${claimCode} (status=${row.status})`,
      );
    }

    // 阶段2：渲染命令 + 入队
    //   任一失败 → 回滚 status=pending，重新抛错
    try {
      const orderRow = await this.db<ShopOrderRow>('shop_orders')
        .where({ server_id: serverId, claim_code: claimCode })
        .first();
      if (!orderRow) {
        // 极小概率：刚 update 成功就查不到
        throw new ShopOrderNotFoundError(`领取码无效: ${claimCode}`);
      }
      const orderId = orderRow.id;

      const itemRows = await this.db<ShopOrderItemRow>('shop_order_items')
        .where({ order_id: orderId })
        .orderBy('id', 'asc');

      // 解析命令模板：server → pack → business.shop.give_command
      const giveTemplate = await this.resolveGiveCommand(serverId);

      // 逐条渲染 + 入队
      for (const it of itemRows) {
        const vars: Record<string, string> = {
          player: playerName,
          item: it.item_name,
          count: String(it.count),
        };
        // 渲染（失败抛 CommandRenderError）
        const rendered = this.commandDispatcher.renderCommand(giveTemplate, vars);
        // 入队（队列满抛 CommandQueueFullError）
        await this.commandDispatcher.enqueue(serverId, rendered, 'normal');
      }

      // 阶段3：全部成功 → 标记 claimed
      await this.db<ShopOrderRow>('shop_orders')
        .where({ id: orderId })
        .update({
          status: 'claimed',
          claimed_at: nowIso,
          claimed_player: playerName,
          claiming_at: null,
        });

      const refreshed = await this.db<ShopOrderRow>('shop_orders')
        .where({ id: orderId })
        .first();
      return {
        order: toShopOrderSummary(refreshed!),
        items: itemRows.map(toShopOrderItemSummary),
        delivered: true,
      };
    } catch (err) {
      // 回滚：claiming → pending（仅当仍为 claiming 时）
      await this.db<ShopOrderRow>('shop_orders')
        .where({ server_id: serverId, claim_code: claimCode, status: 'claiming' })
        .update({ status: 'pending', claiming_at: null });
      throw err;
    }
  }

  // ---- 内部辅助 ----

  /**
   * 实例访问入口校验（v2.1.0 改造为按实例作用域）。
   *
   * 规则：
   *   1. 已绑定实例（bindings.verify_status='verified'，binding_type='account', scope_type='instance'）→ 通过
   *   2. 未绑定：server_admin → 通过
   *   3. 未绑定：instance_admin + servers.owner_user_id === userId → 通过
   *   4. 其他 → 抛 BindingRequiredError（路由层映射 403）
   *
   * 与 middleware/auth.ts 的 requireInstanceAccess 中间件逻辑一致，
   * 此处为服务层兜底校验（防止路由层中间件遗漏）。
   */
  private async assertInstanceAccess(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<void> {
    // 1. 已绑定 → 通过
    const bound = await instanceBindingService.isBound(userId, serverId);
    if (bound) return;

    // 2. 未绑定：检查是否为 server_admin
    const role = normalizeRole(userRole);
    if (role === Role.SERVER_ADMIN) return;

    // 3. 未绑定：instance_admin + owner 匹配
    if (role === Role.INSTANCE_ADMIN) {
      const server = await this.db<ServerRow>('servers')
        .select('owner_user_id')
        .where({ id: serverId })
        .first();
      if (server?.owner_user_id === userId) return;
    }

    // 4. 未绑定且非 admin/owner → 拒绝
    throw new BindingRequiredError(
      `用户 ${userId} 未绑定实例 ${serverId}，需先绑定才能下单`,
    );
  }

  /**
   * 解析 server → pack → business.shop.give_command 模板。
   * Pack 未配置 shop 或 give_command 时返回 DEFAULT_GIVE_COMMAND。
   */
  private async resolveGiveCommand(serverId: string): Promise<string> {
    const server = await this.db<ServerRow>('servers')
      .where({ id: serverId })
      .first();
    if (!server) {
      return DEFAULT_GIVE_COMMAND;
    }
    const pack = this.registry.get(server.pack_id);
    const tmpl = pack?.business?.shop?.give_command;
    return tmpl ?? DEFAULT_GIVE_COMMAND;
  }

  /**
   * 回滚超时未完成的 claiming 记录（S7-1 实现）
   *
   * 由 OPTIMISTIC_LOCK_TIMEOUT_SCAN 周期任务调用：
   *   - 查询 status='claiming' 且 claiming_at < (now - timeoutMs) 的记录
   *   - 批量回滚为 status='pending'，清空 claiming_at
   *
   * @param timeoutMs 超时阈值（毫秒），默认 5 分钟
   * @returns 回滚的记录数
   */
  async rollbackStaleClaiming(timeoutMs: number = 5 * 60 * 1000): Promise<number> {
    const cutoffIso = new Date(Date.now() - timeoutMs).toISOString();
    const updated = await this.db<ShopOrderRow>('shop_orders')
      .where({ status: 'claiming' })
      .where('claiming_at', '<', cutoffIso)
      .update({ status: 'pending', claiming_at: null });
    return updated;
  }
}

// ----- 纯函数 / 转换函数 -----

function toShopItemSummary(row: ShopItemRow): ShopItemSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    item_name: row.item_name,
    quality: row.quality as ShopItemSummary['quality'],
    vip_level_required: row.vip_level_required,
    price: row.price,
    daily_limit: row.daily_limit,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toShopOrderSummary(row: ShopOrderRow): ShopOrderSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    user_id: row.user_id,
    status: row.status as ShopOrderSummary['status'],
    claim_code: row.claim_code,
    items_count: row.items_count,
    total_price: row.total_price,
    claimed_at: row.claimed_at,
    expires_at: row.expires_at,
    claimed_player: row.claimed_player,
    created_at: row.created_at,
    // v4.36.1: LEFT JOIN 结果；未 join 时（如 createOrder 返回）为 null
    buyer_username: row.buyer_username ?? null,
  };
}

function toShopOrderItemSummary(row: ShopOrderItemRow): ShopOrderItemSummary {
  return {
    id: row.id,
    order_id: row.order_id,
    item_name: row.item_name,
    count: row.count,
    price: row.price,
    quality: row.quality as ShopOrderItemSummary['quality'],
  };
}

// ----- 工厂 -----

export function createShopService(
  db: Knex,
  registry: PackRegistry,
  commandDispatcher: CommandDispatcher,
  walletService: WalletServiceImpl,
  settingSchemaService?: SettingSchemaService,
): ShopServiceImpl {
  return new ShopServiceImpl(db, registry, commandDispatcher, walletService, settingSchemaService);
}
