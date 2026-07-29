// ============================================================================
// vipService — VIP 购买与状态管理（用户中心经济系统版）
// 数据契约：docs/plans/user-center-consolidation-plan.md §3 VIP 体系
//           §2.5 VIP 等级（积分区间制）/ §3.4 user_vip_status / §6.1 wallet_transactions
// 表结构：  user_vip_status（PK(user_id, server_id)）、vip_permissions（全局模板，保留查询）
//
// 设计要点（v5 经济系统改造，替换旧 bindings 版）：
// - VIP 权益资格（是否购买：lifetime/monthly）与 VIP 等级（积分区间）两层概念分离
// - purchaseVip：校验定价 → 扣余额 → 赠送 VIP1 门槛积分 → 按 integral_ratio 赠送消费积分
//   → upsert user_vip_status（monthly 有效期 +30 天）
// - 余额扣款写 wallet_transactions(type='vip_purchase')，积分赠送写 type='integral_earn'
//   （由 balanceService / integralService 内部统一写流水，共用同一 trace_id）
// - checkExpiredSubscriptions：订阅制到期后 vip_type 置 null（权益失效，等级称号保留）
// - 保留 vip_permissions 只读查询（routes/vipPermissions.ts 消费）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { VipPermission } from '@public/interface_stub/shared-types';
import {
  VipAlreadyActiveError,
  VipPermissionNotFoundError,
  VipPricingNotConfiguredError,
  ValidationError,
} from './errors.js';
import type { BalanceServiceImpl } from './balanceService.js';
import { VIP_THRESHOLDS, type IntegralServiceImpl } from './integralService.js';
import type { PricingServiceImpl } from './pricingService.js';

// ----- 常量 -----

/** 订阅制有效期（天） */
const MONTHLY_DURATION_DAYS = 30;

// ----- DB 行类型 -----

/** user_vip_status 表行 */
export interface UserVipStatusRow {
  user_id: string;
  server_id: string;
  vip_type: 'lifetime' | 'monthly' | null;
  vip_expires_at: string | null;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
}

/** vip_permissions 表行（permissions 在 DB 中以 JSON 文本存储） */
interface VipPermissionRow {
  id: number;
  vip_level: number;
  display_name: string;
  permissions: string;
  max_quality: string;
  daily_limit: number | null;
  daily_reward_amount: number;
}

/** VIP 状态视图（购买状态 + 积分 + 计算等级） */
export interface VipStatus {
  user_id: string;
  server_id: string;
  vip_type: 'lifetime' | 'monthly' | null;
  vip_expires_at: string | null;
  purchased_at: string | null;
  /** 权益资格是否有效（lifetime 恒有效；monthly 需未过期） */
  is_active: boolean;
  total_integral: number;
  current_integral: number;
  /** 由 current_integral 所在区间计算的 VIP 等级 */
  vip_level: number;
}

export interface PurchaseVipResult {
  status: VipStatus;
  price: number;
  /** 赠送的门槛积分（确保购买后等级 >= VIP1） */
  threshold_integral_granted: number;
  /** 消费积分（price × integral_ratio） */
  consumption_integral_granted: number;
}

// ----- 服务实现 -----

export class VipServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly balanceService: BalanceServiceImpl,
    private readonly integralService: IntegralServiceImpl,
    private readonly pricingService: PricingServiceImpl,
  ) {}

  /**
   * 查询用户在某实例的 VIP 状态（购买状态 + 积分 + 计算等级）。
   */
  async getVipStatus(userId: string, serverId: string): Promise<VipStatus> {
    const row = await this.getOrCreateVipStatus(userId, serverId);
    const integral = await this.integralService.getOrCreateIntegral(userId, serverId);
    const vipLevel = this.integralService.getVipLevel(integral.current_integral);

    return {
      user_id: row.user_id,
      server_id: row.server_id,
      vip_type: row.vip_type,
      vip_expires_at: row.vip_expires_at,
      purchased_at: row.purchased_at,
      is_active: isVipActive(row),
      total_integral: integral.total_integral,
      current_integral: integral.current_integral,
      vip_level: vipLevel,
    };
  }

  /**
   * 购买 VIP（买断制 lifetime / 订阅制 monthly）。
   *
   * 流程：
   *   1. 校验实例定价（对应购买方式价格为 NULL → VipPricingNotConfiguredError）
   *   2. 校验当前无有效 VIP（买断不可重复购买；订阅未到期不可续购）
   *   3. 余额扣款（写流水 type='vip_purchase'）
   *   4. 赠送 VIP1 门槛积分（确保购买后等级 >= VIP1）
   *   5. 按 integral_ratio 赠送消费积分（price × ratio，四舍五入）
   *   6. upsert user_vip_status（monthly → vip_expires_at = now + 30 天）
   *
   * @throws {VipPricingNotConfiguredError} 该实例未开放此购买方式
   * @throws {VipAlreadyActiveError} 已拥有有效 VIP
   * @throws {InsufficientBalanceError} 可用余额不足
   */
  async purchaseVip(
    userId: string,
    serverId: string,
    type: 'lifetime' | 'monthly',
    traceId?: string,
  ): Promise<PurchaseVipResult> {
    if (type !== 'lifetime' && type !== 'monthly') {
      throw new ValidationError(`非法 VIP 类型: ${type}`);
    }
    const txTraceId = traceId ?? crypto.randomUUID();

    // 1. 定价校验
    const pricing = await this.pricingService.getPricing(serverId);
    const price = type === 'lifetime' ? pricing.vip_lifetime_price : pricing.vip_monthly_price;
    if (price === null || price === undefined) {
      throw new VipPricingNotConfiguredError(
        type === 'lifetime' ? '该实例未开放买断制 VIP' : '该实例未开放订阅制 VIP',
      );
    }

    // 2. 重复购买校验
    const existing = await this.getOrCreateVipStatus(userId, serverId);
    if (isVipActive(existing)) {
      throw new VipAlreadyActiveError(
        existing.vip_type === 'lifetime'
          ? '已拥有买断制 VIP，不可重复购买'
          : '订阅制 VIP 未到期，到期后方可再次购买',
      );
    }

    // 3. 余额扣款（写流水 type='vip_purchase'）
    await this.balanceService.debit(
      userId,
      price,
      'vip_purchase',
      type === 'lifetime' ? '购买买断制 VIP' : '购买订阅制 VIP（30 天）',
      userId,
      txTraceId,
    );

    // 4. 赠送门槛积分（确保购买后等级 >= VIP1）
    const thresholdIntegral = VIP_THRESHOLDS[1]?.min ?? 1;
    await this.integralService.addIntegral(
      userId,
      serverId,
      thresholdIntegral,
      'integral_earn',
      '购买 VIP 赠送门槛积分',
      txTraceId,
    );

    // 5. 消费积分（price × integral_ratio，四舍五入；为 0 时跳过）
    const consumptionIntegral = Math.round(price * pricing.integral_ratio);
    if (consumptionIntegral > 0) {
      await this.integralService.addIntegral(
        userId,
        serverId,
        consumptionIntegral,
        'integral_earn',
        `VIP 消费积分（${price} × ${pricing.integral_ratio}）`,
        txTraceId,
      );
    }

    // 6. upsert user_vip_status
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt =
      type === 'monthly'
        ? new Date(now.getTime() + MONTHLY_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null;
    await this.db('user_vip_status')
      .insert({
        user_id: userId,
        server_id: serverId,
        vip_type: type,
        vip_expires_at: expiresAt,
        purchased_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .onConflict(['user_id', 'server_id'])
      .merge({
        vip_type: type,
        vip_expires_at: expiresAt,
        purchased_at: nowIso,
        updated_at: nowIso,
      });

    const status = await this.getVipStatus(userId, serverId);
    return {
      status,
      price,
      threshold_integral_granted: thresholdIntegral,
      consumption_integral_granted: consumptionIntegral,
    };
  }

  /**
   * 检查并失效已到期的订阅制 VIP（调度器周期调用）。
   * vip_type 置 null（权益资格失效），vip_expires_at 保留作历史记录；
   * 积分与等级称号不受影响（等级由积分区间自动判定）。
   *
   * @returns { expired } 本次失效的订阅数
   */
  async checkExpiredSubscriptions(): Promise<{ expired: number }> {
    const nowIso = new Date().toISOString();
    const expired = await this.db('user_vip_status')
      .where({ vip_type: 'monthly' })
      .whereNotNull('vip_expires_at')
      .where('vip_expires_at', '<', nowIso)
      .update({ vip_type: null, updated_at: nowIso });
    return { expired };
  }

  // ----- vip_permissions 只读查询（保留，routes/vipPermissions.ts 消费） -----

  async getVipPermissions(level: number): Promise<VipPermission> {
    const row = await this.db<VipPermissionRow>('vip_permissions').where({ vip_level: level }).first();
    if (!row) {
      throw new VipPermissionNotFoundError(`VIP permission not found for level: ${level}`);
    }
    return toVipPermission(row);
  }

  async listVipPermissions(): Promise<VipPermission[]> {
    const rows = await this.db<VipPermissionRow>('vip_permissions').orderBy('vip_level', 'asc');
    return rows.map(toVipPermission);
  }

  // ----- 内部辅助 -----

  /** 获取或创建 VIP 状态记录（默认 vip_type=null 未购买） */
  private async getOrCreateVipStatus(userId: string, serverId: string): Promise<UserVipStatusRow> {
    const existing = await this.db<UserVipStatusRow>('user_vip_status')
      .where({ user_id: userId, server_id: serverId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    await this.db('user_vip_status')
      .insert({
        user_id: userId,
        server_id: serverId,
        vip_type: null,
        vip_expires_at: null,
        purchased_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['user_id', 'server_id'])
      .ignore();
    const row = await this.db<UserVipStatusRow>('user_vip_status')
      .where({ user_id: userId, server_id: serverId })
      .first();
    return row as UserVipStatusRow;
  }
}

// ----- 纯函数 -----

/** VIP 权益资格是否有效（lifetime 恒有效；monthly 需未过期） */
function isVipActive(row: UserVipStatusRow): boolean {
  if (row.vip_type === 'lifetime') return true;
  if (row.vip_type === 'monthly') {
    return row.vip_expires_at !== null && new Date(row.vip_expires_at).getTime() > Date.now();
  }
  return false;
}

/** 将 DB 行转换为 VipPermission（permissions 字段从 JSON 文本解析） */
function toVipPermission(row: VipPermissionRow): VipPermission {
  let permissions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.permissions);
    if (Array.isArray(parsed)) {
      permissions = parsed.map(String);
    }
  } catch {
    // permissions 字段非法 JSON → 回退为空数组
    permissions = [];
  }
  return {
    id: row.id,
    vip_level: row.vip_level,
    display_name: row.display_name,
    permissions,
    max_quality: row.max_quality as VipPermission['max_quality'],
    daily_limit: row.daily_limit,
    daily_reward_amount: row.daily_reward_amount,
  };
}

// ----- 工厂 -----

/**
 * 创建 vipService 的工厂函数
 * 依赖：balanceService（扣款）/ integralService（赠送积分 + 等级计算）/ pricingService（定价）
 */
export function createVipService(
  db: Knex,
  balanceService: BalanceServiceImpl,
  integralService: IntegralServiceImpl,
  pricingService: PricingServiceImpl,
): VipServiceImpl {
  return new VipServiceImpl(db, balanceService, integralService, pricingService);
}
