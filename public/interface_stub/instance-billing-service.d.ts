/**
 * instance-billing-service.d.ts — instanceBillingService 接口存根
 *
 * 职责：VPS 式预付费计费——按实例类型月费 × 周期 × 折扣计算金额、预付费扣款、
 *       自动续扣、免计费判定（owner_self / self_hosted_node / manual）
 *
 * 数据契约：
 *   - public/schema/instance-type-pricing-schema.json（类型定价表）
 *   - public/schema/instance-billing-settings-schema.json（实例计费设置表）
 *   - public/schema/instance-renewals-schema.json（计费记录，扩展 billing_cycle_months / instance_type_snapshot）
 *   - public/schema/server-schema.json（servers.billing_type / expires_at / expiry_status）
 *
 * 来源：docs/plans/instance-billing-rules-plan.md §8.3（VPS 式简化定稿，2026-07-28）
 *
 * 设计要点：
 * - 定价公式：amount = monthly_price_effective × billing_cycle_months × cycle_discount
 *   - monthly_price_effective = instance_billing_settings.custom_monthly_price ?? instance_type_pricing.monthly_price
 *   - cycle_discount：1→1.0, 3→quarterly_discount, 6→semiannual_discount, 12→annual_discount
 *   - duration_days = billing_cycle_months × days_per_month（days_per_month 由 system_config.instance.billing.days_per_month 配置，默认 30）
 * - 扣款源：腐竹 global_balances（通过 user_id 自然隔离），调用 balanceService.debit(userId, amount, 'instance_billing', ...)
 * - 收款方：管理员 global_balances，调用 balanceService.credit(admin_user_id, amount, 'instance_billing', ...)
 * - 并发安全：扣款必须 DB 事务 + 行锁（balanceService.debit 已实现原子 UPDATE ... WHERE (balance - frozen_balance) >= amount）
 * - 失败回滚：创建实例时若扣款成功但实例创建失败，必须 balanceService.credit 退款
 *
 * 免计费判定（见方案 §5，优先级从高到低）：
 *   1. instance_billing_settings.billing_exempt=true → 豁免（exempt_reason 标识原因）
 *   2. nodes.node_source='self_hosted' 且 approval_status='approved' → 豁免
 *   3. servers.owner_user_id == operatorUserId → 豁免（创建时自动设置 billing_exempt=true, exempt_reason='owner_self'）
 *
 * 调度任务：
 *   - INSTANCE_AUTO_RENEWAL（每日 03:00）：自动续扣扫描（见 autoRenewInstance）
 *   - INSTANCE_BILLING_ALERT（每日 09:00）：欠费告警
 */

import type {
  InstanceType,
  BillingCycleMonths,
  InstanceTypePricing,
  InstanceBillingSettings,
  BillingExemptReason,
  InstanceRenewal,
} from './shared-types';
import {
  InstanceNotFoundError,
  InstanceTypePricingNotFoundError,
  InstanceBillingSettingsNotFoundError,
  GlobalBalanceInsufficientError,
  InstanceExpiredError,
  BillingExemptError,
  InvalidBillingCycleError,
} from './shared-types';

/** 计费金额计算结果 */
export interface BillingAmountResult {
  /** 基础月费生效值（custom_monthly_price ?? instance_type_pricing.monthly_price） */
  monthly_price_effective: number;
  /** 计费周期（月） */
  billing_cycle_months: BillingCycleMonths;
  /** 应用的周期折扣系数（1.0=无折扣） */
  cycle_discount_applied: number;
  /** 续费天数（= billing_cycle_months × days_per_month，days_per_month 由 system_config.instance.billing 配置，默认 30） */
  duration_days: number;
  /** 基础金额（= monthly_price_effective × billing_cycle_months，未应用折扣） */
  base_amount: number;
  /** 实际应扣金额（= base_amount × cycle_discount_applied，按 system_config.instance.billing.rounding_mode 取整，默认 round） */
  amount: number;
}

/** 免计费判定结果 */
export interface BillingExemptResult {
  /** 是否豁免 */
  exempt: boolean;
  /** 豁免原因（仅 exempt=true 时有值） */
  reason: BillingExemptReason | null;
}

/** 创建/续费实例计费结果 */
export interface InstanceBillingResult {
  /** 计费记录（instance_renewals 表记录） */
  renewal: InstanceRenewal;
  /** 实际扣款金额（0=豁免或免费） */
  amount_paid: number;
  /** 是否豁免 */
  exempt: boolean;
  /** 豁免原因（仅 exempt=true 时有值） */
  exempt_reason: BillingExemptReason | null;
  /** 新过期时间 */
  new_expires_at: string;
}

export interface InstanceBillingService {
  // ===== 定价查询 =====

  /**
   * 查询所有生效的实例类型定价列表。
   * GET /api/admin/instance-billing/types
   * @returns active 状态的类型定价列表（按 monthly_price 升序）
   */
  listActiveTypePricings(): Promise<InstanceTypePricing[]>;

  /**
   * 查询指定类型的生效定价。
   * @param instanceType 实例类型
   * @throws {InstanceTypePricingNotFoundError} 类型不存在或已归档
   */
  getTypePricing(instanceType: InstanceType): Promise<InstanceTypePricing>;

  /**
   * 创建或更新类型定价（仅 system_admin）。
   * POST /api/admin/instance-billing/types
   * @throws {InvalidBillingCycleError} 折扣系数超出 [0,1] 范围
   */
  upsertTypePricing(
    instanceType: InstanceType,
    data: {
      display_name: string;
      monthly_price: number;
      quarterly_discount?: number;
      semiannual_discount?: number;
      annual_discount?: number;
      recommended_slots?: number | null;
      cpu_limit?: string | null;
      memory_limit_mb?: number | null;
      disk_limit_gb?: number | null;
      description?: string | null;
    },
    operatorUserId: string,
  ): Promise<InstanceTypePricing>;

  /**
   * 归档类型定价（仅 system_admin，不可逆）。
   * 已归档类型不再用于新计费，但存量记录保留。
   */
  archiveTypePricing(instanceType: InstanceType, operatorUserId: string): Promise<void>;

  // ===== 实例计费设置 =====

  /**
   * 获取或创建实例计费设置（首次访问自动创建，instance_type 默认 'small'）。
   * GET /api/admin/instance-billing/settings/:instance_id
   * @throws {InstanceNotFoundError} 实例不存在
   */
  getOrCreateBillingSettings(instanceId: string): Promise<InstanceBillingSettings>;

  /**
   * 更新实例计费设置（腐竹可更新自己的实例，system_admin 可更新任意实例）。
   * PUT /api/admin/instance-billing/settings/:instance_id
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {InstanceTypePricingNotFoundError} instance_type 不存在或已归档
   */
  updateBillingSettings(
    instanceId: string,
    data: {
      instance_type?: InstanceType;
      custom_monthly_price?: number | null;
      billing_exempt?: boolean;
      exempt_reason?: BillingExemptReason | null;
      auto_renew_enabled?: boolean;
    },
    operatorUserId: string,
  ): Promise<InstanceBillingSettings>;

  // ===== 金额计算（纯函数，无副作用） =====

  /**
   * 计算计费金额（纯函数，不扣款）。
   *
   * 公式：amount = monthly_price_effective × billing_cycle_months × cycle_discount
   *   - monthly_price_effective = customMonthlyPrice ?? typePricing.monthly_price
   *   - cycle_discount：1→1.0, 3→quarterly_discount, 6→semiannual_discount, 12→annual_discount
   *   - duration_days = billing_cycle_months × days_per_month（system_config.instance.billing.days_per_month，默认 30）
   *   - amount 按 rounding_mode 取整（system_config.instance.billing.rounding_mode，默认 round）
   *
   * @param typePricing 类型定价（来自 instance_type_pricing 表）
   * @param cycleMonths 计费周期（1/3/6/12）
   * @param customMonthlyPrice 实例级覆盖月费（null=用类型默认）
   * @throws {InvalidBillingCycleError} cycleMonths 不在 {1,3,6,12} 范围
   */
  calculateAmount(
    typePricing: InstanceTypePricing,
    cycleMonths: BillingCycleMonths,
    customMonthlyPrice?: number | null,
  ): BillingAmountResult;

  // ===== 免计费判定 =====

  /**
   * 判定实例是否免计费（纯函数，不扣款）。
   * 优先级：billing_exempt > node_source=self_hosted > owner_user_id==operator
   *
   * @param instanceId 实例 ID
   * @param operatorUserId 操作者 user_id
   * @throws {InstanceNotFoundError} 实例不存在
   */
  isBillingExempt(instanceId: string, operatorUserId: string): Promise<BillingExemptResult>;

  // ===== 计费操作（有副作用，扣款） =====

  /**
   * 创建实例时计费（预付费扣全额）。
   *
   * 流程：
   *   1. 免计费判定 → 豁免则 amount=0
   *   2. 计算 amount
   *   3. balanceService.debit(fuzhu_user_id, amount, 'instance_billing', ...)
   *      - 余额不足 → 抛 GlobalBalanceInsufficientError（402），实例创建失败
   *   4. balanceService.credit(admin_user_id, amount, 'instance_billing', ...)
   *   5. 写 instance_renewals 记录（renewal_type='manual', wallet_source='admin_wallets'）
   *   6. 设置 servers.expires_at = now + duration_days × 86400000
   *   7. 设置 servers.expiry_status = 'active', billing_type = 'vps_prepaid'
   *
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {InstanceTypePricingNotFoundError} 类型定价不存在
   * @throws {GlobalBalanceInsufficientError} 腐竹全局余额不足（402）
   */
  chargeInstanceCreation(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult>;

  /**
   * 手动续费（预付费扣全额，可不同于上次周期）。
   *
   * 流程：
   *   1. 免计费判定 → 豁免则 amount=0
   *   2. 计算 amount
   *   3. balanceService.debit + credit
   *   4. 写 instance_renewals（renewal_type='manual'）
   *   5. servers.expires_at = max(old_expires_at, now) + duration_days × 86400000
   *   6. servers.expiry_status = 'active'（从 grace/expired 恢复）
   *   7. 更新 instance_billing_settings.last_billing_cycle_months
   *
   * POST /api/admin/instance-billing/renew/:instance_id
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {InstanceTypePricingNotFoundError} 类型定价不存在
   * @throws {GlobalBalanceInsufficientError} 腐竹全局余额不足（402）
   */
  chargeInstanceRenewal(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult>;

  /**
   * 自动续扣（scheduler 调用，沿用上次周期）。
   *
   * 触发：INSTANCE_AUTO_RENEWAL 任务（每日 03:00）
   * 扫描范围：expires_at <= now + auto_renew_lookahead_days（system_config.instance.billing.auto_renew_lookahead_days，默认 3）且 expiry_status='active' 且 auto_renew_enabled=true
   *
   * 流程：
   *   1. 取 last_billing_cycle_months 作为续扣周期（默认 1=月付）
   *   2. 免计费判定 → 豁免则直接延长 expires_at（amount=0）
   *   3. 计算 amount 并尝试扣款
   *      - 余额足够 → 扣款 + 写 instance_renewals（renewal_type='auto'）+ 延长 expires_at
   *      - 余额不足 → 不扣款，记录告警日志，等待到期进入宽限期
   *
   * @returns 续扣结果统计（成功数 / 失败数 / 豁免数）
   */
  autoRenewInstance(instanceId: string): Promise<{
    success: boolean;
    amount_paid: number;
    failure_reason?: string;
  }>;

  /**
   * 批量扫描并自动续扣临近到期实例（scheduler 调用）。
   * @returns 统计：{ scanned, renewed, failed, exempt }
   */
  scanAndAutoRenew(): Promise<{
    scanned: number;
    renewed: number;
    failed: number;
    exempt: number;
  }>;
}

export {
  InstanceNotFoundError,
  InstanceTypePricingNotFoundError,
  InstanceBillingSettingsNotFoundError,
  GlobalBalanceInsufficientError,
  InstanceExpiredError,
  BillingExemptError,
  InvalidBillingCycleError,
} from './shared-types';
