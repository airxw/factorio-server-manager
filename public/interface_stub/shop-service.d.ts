/**
 * shop-service.d.ts — shopService 接口存根
 *
 * 职责：商品管理 / 订单创建 / claimOrder 两段事务（乐观锁）/ 命令下发
 * 数据契约：public/schema/shop-items-schema.json / shop-orders-schema.json / shop-order-items-schema.json
 * 来源：scheme-final-merged.md §5.1 商店购买 + 物品发放 / §4.3.3 shop_items 瘦身 / §7.1 P2
 */

import type {
  ShopItem,
  ShopItemInput,
  ShopOrder,
  ShopOrderItemInput,
  UserCoupon,
} from './shared-types';
import {
  ShopItemNotFoundError,
  VipLevelInsufficientError,
  DailyLimitExceededError,
  OrderAlreadyClaimedError,
  CommandRenderError,
  CouponInvalidError,
  CouponNotApplicableError,
  CouponAlreadyClaimedError,
  CouponUsageLimitExceededError,
} from './shared-types';

export interface ShopService {
  /**
   * 创建订单（v1 扩展：支持优惠券）。
   * 流程（scheme §5.1）：
   *   1. 校验商品 enabled + 用户 VIP 品质权限 + 每日限额
   *   2. INSERT shop_orders (status=pending) + shop_order_items
   *   3. 返回 claim_code 给用户
   *
   * 折扣叠加规则（v1 新增，强校验）：
   *   - VIP 折扣与优惠券不叠加，取最优
   *   - 0 元订单仅允许 total_price = 0 的免费商品
   *
   * @param userId 用户 ID（既有，位置不变）
   * @param serverId 实例 ID（既有，位置不变）
   * @param items 物品列表（既有，位置不变）
   * @param couponCode 优惠券码（v1 新增，可选）。提供则校验并应用折扣
   * @returns {orderId, claimCode} 订单 ID 与领取码 + v1 新增可选 applied_discount
   * @throws {ShopItemNotFoundError} 商品不存在或已下架
   * @throws {VipLevelInsufficientError} VIP 等级不足
   * @throws {DailyLimitExceededError} 超出每日购买限额
   * @throws {CouponInvalidError} 优惠券不存在或已过期（v1 新增）
   * @throws {CouponNotApplicableError} 优惠券不适用于当前订单（v1 新增）
   */
  createOrder(
    userId: string,
    serverId: string,
    items: ShopOrderItemInput[],
    couponCode?: string,
  ): Promise<{
    orderId: number;
    claimCode: string;
    /** v1 新增：折扣明细。无优惠券时为 undefined */
    applied_discount?: {
      type: 'vip' | 'coupon' | 'none';
      original_amount: number;
      discount_amount: number;
      final_amount: number;
      coupon_id?: number;
    };
  }>;

  /**
   * 领取订单（两段事务，乐观锁）。
   * 流程（scheme §5.1）：
   *   1. 乐观锁 UPDATE shop_orders SET status='claiming' WHERE claim_code=? AND status='pending'
   *      失败（rows=0）→ 抛 OrderAlreadyClaimedError
   *   2. 遍历 order_items，按 Pack.business.shop.give_command 渲染命令
   *   3. 通过 commandDispatcher 下发到 Daemon
   *   4. 全部成功 → status='claimed'；任一失败 → 回滚 status='pending'
   * @param claimCode 订单领取码（玩家在游戏内输入 '!claim <claimCode>'）
   * @param gamePlayerName 实际领取的游戏内玩家名
   * @returns {success, message} success=true 表示物品已发放
   * @throws {OrderAlreadyClaimedError} 订单已被领取或不存在
   * @throws {CommandRenderError} 命令模板渲染失败（含注入校验失败）
   */
  claimOrder(
    claimCode: string,
    gamePlayerName: string,
  ): Promise<{ success: boolean; message: string }>;

  /**
   * 查询用户订单列表。
   * @param serverId 可选，限定服务器范围
   */
  listOrders(userId: string, serverId?: string): Promise<ShopOrder[]>;

  /**
   * 列出服务器上架商品（仅 enabled=true）。
   */
  listShopItems(serverId: string): Promise<ShopItem[]>;

  /**
   * 新增商品上架。校验 item_name ∈ Pack.items（运行时校验）。
   * @throws {ShopItemNotFoundError} item_name 不在 Pack.items 中
   */
  addShopItem(serverId: string, item: ShopItemInput): Promise<ShopItem>;

  /**
   * 更新商品。
   * @throws {ShopItemNotFoundError} itemId 不存在
   */
  updateShopItem(itemId: number, updates: Partial<ShopItemInput>): Promise<ShopItem>;

  /**
   * 删除商品（物理删除或 enabled=false，由实现决定）。
   * @throws {ShopItemNotFoundError} itemId 不存在
   */
  deleteShopItem(itemId: number): Promise<void>;

  /**
   * 领取优惠券（v1 新增，POST /api/coupons/:code/claim）。
   *
   * 流程：
   *   1. 校验优惠券存在且未过期（status='active' AND expires_at > now）
   *   2. 校验未达总使用上限（used_count < total_limit）
   *   3. 校验用户未领取过（user_coupons 无该 code + userId 记录）
   *   4. INSERT user_coupons（status='unused'）
   *   5. UPDATE coupons.used_count += 1
   *   6. 写入 audit_logs（事件类型 COUPON_CLAIMED）
   *
   * @param userId 用户 ID
   * @param code 优惠券码
   * @param serverId 实例 ID（可选，scope_type='server' 时必填）
   * @returns 用户优惠券记录
   * @throws {CouponInvalidError} 优惠券不存在或已过期
   * @throws {CouponAlreadyClaimedError} 用户已领取过
   * @throws {CouponUsageLimitExceededError} 优惠券已达使用上限
   */
  claimCoupon(userId: string, code: string, serverId?: string): Promise<UserCoupon>;
}

export {
  ShopItemNotFoundError,
  VipLevelInsufficientError,
  DailyLimitExceededError,
  OrderAlreadyClaimedError,
  CommandRenderError,
  CouponInvalidError,
  CouponNotApplicableError,
  CouponAlreadyClaimedError,
  CouponUsageLimitExceededError,
} from './shared-types';
