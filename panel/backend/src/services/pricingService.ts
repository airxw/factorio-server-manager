// ============================================================================
// pricingService — 实例定价配置管理（instance_pricing）
// 数据契约：docs/plans/user-center-consolidation-plan.md §2.6 instance_pricing / §2.7 平台级限额
// 表结构：  instance_pricing（server_id PK）
//
// 设计要点：
// - VIP 定价为 NULL 表示不开放对应购买方式（买断/订阅）
// - daily_consumption_limit 不得超过平台单日消费上限（system_config: consumption.daily_max，默认 648）
// - 仅实例管理员（instance_admin / server_admin）可更新定价
// ============================================================================

import type { Knex } from 'knex';
import { ForbiddenError, ValidationError } from './errors.js';

// ----- 常量 -----

/** 平台单日消费上限配置键与默认值 */
const PLATFORM_DAILY_MAX_KEY = 'consumption.daily_max';
const PLATFORM_DAILY_MAX_DEFAULT = 648;

/** 允许更新定价的角色 */
const PRICING_UPDATE_ROLES = ['instance_admin', 'server_admin'];

// ----- DB 行类型 -----

export interface InstancePricingRow {
  server_id: string;
  vip_monthly_price: number | null;
  vip_lifetime_price: number | null;
  points_exchange_ratio: number;
  integral_ratio: number;
  daily_consumption_limit: number | null;
  created_at: string;
  updated_at: string;
}

/** 定价更新载荷（部分字段） */
export interface PricingUpdates {
  vip_monthly_price?: number | null;
  vip_lifetime_price?: number | null;
  points_exchange_ratio?: number;
  integral_ratio?: number;
  daily_consumption_limit?: number | null;
}

// ----- 服务实现 -----

export class PricingServiceImpl {
  constructor(private readonly db: Knex) {}

  /**
   * 查询实例定价配置（不存在则创建默认配置）。
   * 默认：VIP 定价 NULL（不开放），兑换/积分比例 1.0，消费上限 NULL（使用平台默认）。
   */
  async getPricing(serverId: string): Promise<InstancePricingRow> {
    const existing = await this.db<InstancePricingRow>('instance_pricing')
      .where({ server_id: serverId })
      .first();
    if (existing) return existing;

    const now = new Date().toISOString();
    await this.db('instance_pricing')
      .insert({
        server_id: serverId,
        vip_monthly_price: null,
        vip_lifetime_price: null,
        points_exchange_ratio: 1.0,
        integral_ratio: 1.0,
        daily_consumption_limit: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict('server_id')
      .ignore();
    const row = await this.db<InstancePricingRow>('instance_pricing')
      .where({ server_id: serverId })
      .first();
    return row as InstancePricingRow;
  }

  /**
   * 更新实例定价配置（部分更新）。
   *
   * 校验：
   * - 仅 instance_admin / server_admin 可更新
   * - 价格字段必须为非负整数或 null
   * - 比例字段必须为正数
   * - daily_consumption_limit <= 平台单日消费上限（consumption.daily_max）
   *
   * @throws {ForbiddenError} 非实例管理员
   * @throws {ValidationError} 字段取值不合法
   */
  async updatePricing(
    serverId: string,
    updates: PricingUpdates,
    operatorRole: string,
  ): Promise<InstancePricingRow> {
    if (!PRICING_UPDATE_ROLES.includes(operatorRole)) {
      throw new ForbiddenError('仅实例管理员可修改定价配置');
    }

    if (updates.vip_monthly_price !== undefined) {
      assertNullableNonNegativeInt(updates.vip_monthly_price, 'vip_monthly_price');
    }
    if (updates.vip_lifetime_price !== undefined) {
      assertNullableNonNegativeInt(updates.vip_lifetime_price, 'vip_lifetime_price');
    }
    if (updates.points_exchange_ratio !== undefined) {
      assertPositiveNumber(updates.points_exchange_ratio, 'points_exchange_ratio');
    }
    if (updates.integral_ratio !== undefined) {
      assertPositiveNumber(updates.integral_ratio, 'integral_ratio');
    }
    if (updates.daily_consumption_limit !== undefined && updates.daily_consumption_limit !== null) {
      assertNullableNonNegativeInt(updates.daily_consumption_limit, 'daily_consumption_limit');
      const platformMax = await this.getPlatformDailyMax();
      if (updates.daily_consumption_limit > platformMax) {
        throw new ValidationError(
          `单日消费上限不得超过平台上限 ${platformMax}：${updates.daily_consumption_limit}`,
        );
      }
    }

    await this.getPricing(serverId);
    const now = new Date().toISOString();
    await this.db('instance_pricing')
      .where({ server_id: serverId })
      .update({ ...updates, updated_at: now });

    return this.getPricing(serverId);
  }

  /** 平台单日消费上限（system_config: consumption.daily_max，默认 648） */
  async getPlatformDailyMax(): Promise<number> {
    const row = await this.db<{ key: string; value: string }>('system_config')
      .where({ key: PLATFORM_DAILY_MAX_KEY })
      .first();
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : PLATFORM_DAILY_MAX_DEFAULT;
  }
}

// ----- 工厂 -----

export function createPricingService(db: Knex): PricingServiceImpl {
  return new PricingServiceImpl(db);
}

// ----- 纯函数 -----

/** 校验可空非负整数 */
function assertNullableNonNegativeInt(value: number | null, field: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} 必须为非负整数或 null: ${value}`);
  }
}

/** 校验正数（比例字段） */
function assertPositiveNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} 必须为正数: ${value}`);
  }
}
