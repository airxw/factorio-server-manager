/**
 * instance-billing-mock.ts — InstanceBillingService 预生成默认稳定 Mock
 *
 * @description 预生成的默认稳定 Mock，用于支持下游并行开发。
 * 提供预设数据和固定行为，保证多次调用返回一致。
 *
 * 契约来源：public/interface_stub/instance-billing-service.d.ts
 * 数据契约：public/schema/instance-type-pricing-schema.json
 *          public/schema/instance-billing-settings-schema.json
 *          public/schema/instance-renewals-schema.json
 *
 * 用途：模块 D/E/F/H 在模块 C（instanceBillingService 真实实现）就绪前，
 *      通过 tsconfig paths alias 切换导入本 Mock，零等待联调。
 *      真实实现就绪后，仅切 alias 指向真实文件，调用方零改动。
 *
 * Mock 规则（s0202）：
 *   - 返回符合数据契约的模拟值
 *   - 固定行为，多次调用返回一致
 *   - 不依赖 DB / 外部服务
 */

import type {
  InstanceBillingService,
  BillingAmountResult,
  BillingExemptResult,
  InstanceBillingResult,
} from '../interface_stub/instance-billing-service';
import type {
  InstanceType,
  BillingCycleMonths,
  InstanceTypePricing,
  InstanceBillingSettings,
  BillingExemptReason,
  InstanceRenewal,
  InstanceRenewalType,
  WalletSource,
  NodeSource,
} from '../interface_stub/shared-types';
import {
  InstanceNotFoundError,
  InstanceTypePricingNotFoundError,
  InstanceBillingSettingsNotFoundError,
  GlobalBalanceInsufficientError,
  InvalidBillingCycleError,
} from '../interface_stub/shared-types';

/** 默认 days_per_month（与 system_config.instance.billing.days_per_month 默认值一致） */
const DEFAULT_DAYS_PER_MONTH = 30;

/** 默认 5 种类型定价（与模块B seed_instance_type_pricing 对齐）
 * v4.35.1: 原 v4.35.0 定价整体除以 100（用户反馈过贵） */
const DEFAULT_TYPE_PRICINGS: InstanceTypePricing[] = [
  {
    id: 'mock-tp-micro',
    instance_type: 'micro',
    display_name: '微型',
    monthly_price: 15,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 5,
    cpu_limit: '1.0',
    memory_limit_mb: 1024,
    disk_limit_gb: 10,
    description: '适合 1-5 人小服',
    status: 'active',
    created_by: 'mock-system-admin',
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'mock-tp-small',
    instance_type: 'small',
    display_name: '小型',
    monthly_price: 30,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 15,
    cpu_limit: '2.0',
    memory_limit_mb: 2048,
    disk_limit_gb: 20,
    description: '适合 5-15 人服',
    status: 'active',
    created_by: 'mock-system-admin',
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'mock-tp-medium',
    instance_type: 'medium',
    display_name: '标准',
    monthly_price: 90,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 30,
    cpu_limit: '4.0',
    memory_limit_mb: 4096,
    disk_limit_gb: 40,
    description: '适合 15-30 人服',
    status: 'active',
    created_by: 'mock-system-admin',
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'mock-tp-large',
    instance_type: 'large',
    display_name: '大型',
    monthly_price: 240,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 60,
    cpu_limit: '8.0',
    memory_limit_mb: 8192,
    disk_limit_gb: 80,
    description: '适合 30-60 人服',
    status: 'active',
    created_by: 'mock-system-admin',
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'mock-tp-xlarge',
    instance_type: 'xlarge',
    display_name: '超大',
    monthly_price: 600,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 120,
    cpu_limit: '16.0',
    memory_limit_mb: 16384,
    disk_limit_gb: 160,
    description: '适合 60+ 人大型服',
    status: 'active',
    created_by: 'mock-system-admin',
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:00:00.000Z',
  },
];

/** 周期 → 折扣系数映射辅助 */
function cycleDiscountOf(typePricing: InstanceTypePricing, cycle: BillingCycleMonths): number {
  switch (cycle) {
    case 1:
      return 1.0;
    case 3:
      return typePricing.quarterly_discount;
    case 6:
      return typePricing.semiannual_discount;
    case 12:
      return typePricing.annual_discount;
    default:
      throw new InvalidBillingCycleError(`invalid billing_cycle_months: ${cycle}`);
  }
}

/**
 * MockInstanceBillingService — InstanceBillingService 默认 Mock 实现
 *
 * 行为约定：
 *   - 定价数据：内存常量，upsert/archive 修改内存副本
 *   - 计费设置：内存 Map<instanceId, InstanceBillingSettings>
 *   - 续费记录：内存 Map<instanceId, InstanceRenewal[]>
 *   - 扣款：不调用真实 balanceService，仅记录；余额永远充足（除非显式触发失败标记）
 *   - 豁免判定：billing_exempt > owner_self（Mock 不查 node_source）
 */
export class MockInstanceBillingService implements InstanceBillingService {
  private typePricings: Map<InstanceType, InstanceTypePricing> = new Map();
  private settingsStore: Map<string, InstanceBillingSettings> = new Map();
  private renewalsStore: Map<string, InstanceRenewal[]> = new Map();
  private renewalIdSeq = 1;
  /** 余额不足模拟标记：加入此 Set 的实例下次扣款抛 GlobalBalanceInsufficientError */
  private insufficientBalanceInstances: Set<string> = new Set();
  /** 豁免实例标记：instanceId → exemptReason */
  private exemptInstances: Map<string, BillingExemptReason> = new Map();

  constructor() {
    for (const tp of DEFAULT_TYPE_PRICINGS) {
      this.typePricings.set(tp.instance_type, { ...tp });
    }
  }

  // ===== 定价查询 =====

  async listActiveTypePricings(): Promise<InstanceTypePricing[]> {
    return Array.from(this.typePricings.values())
      .filter((tp) => tp.status === 'active')
      .sort((a, b) => a.monthly_price - b.monthly_price);
  }

  async getTypePricing(instanceType: InstanceType): Promise<InstanceTypePricing> {
    const tp = this.typePricings.get(instanceType);
    if (!tp || tp.status !== 'active') {
      throw new InstanceTypePricingNotFoundError(`instance type ${instanceType} not found or archived`);
    }
    return { ...tp };
  }

  async upsertTypePricing(
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
  ): Promise<InstanceTypePricing> {
    const now = new Date().toISOString();
    const existing = this.typePricings.get(instanceType);
    const merged: InstanceTypePricing = {
      id: existing?.id ?? `mock-tp-${instanceType}-${Date.now()}`,
      instance_type: instanceType,
      display_name: data.display_name,
      monthly_price: data.monthly_price,
      quarterly_discount: data.quarterly_discount ?? existing?.quarterly_discount ?? 1.0,
      semiannual_discount: data.semiannual_discount ?? existing?.semiannual_discount ?? 1.0,
      annual_discount: data.annual_discount ?? existing?.annual_discount ?? 1.0,
      recommended_slots: data.recommended_slots ?? existing?.recommended_slots ?? null,
      cpu_limit: data.cpu_limit ?? existing?.cpu_limit ?? null,
      memory_limit_mb: data.memory_limit_mb ?? existing?.memory_limit_mb ?? null,
      disk_limit_gb: data.disk_limit_gb ?? existing?.disk_limit_gb ?? null,
      description: data.description ?? existing?.description ?? null,
      status: 'active',
      created_by: existing?.created_by ?? operatorUserId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.typePricings.set(instanceType, merged);
    return { ...merged };
  }

  async archiveTypePricing(instanceType: InstanceType, _operatorUserId: string): Promise<void> {
    const tp = this.typePricings.get(instanceType);
    if (!tp) {
      throw new InstanceTypePricingNotFoundError(`instance type ${instanceType} not found`);
    }
    tp.status = 'archived';
    tp.updated_at = new Date().toISOString();
  }

  // ===== 实例计费设置 =====

  async getOrCreateBillingSettings(instanceId: string): Promise<InstanceBillingSettings> {
    if (!instanceId) {
      throw new InstanceNotFoundError('instance id is required');
    }
    const existing = this.settingsStore.get(instanceId);
    if (existing) {
      return { ...existing };
    }
    const now = new Date().toISOString();
    const created: InstanceBillingSettings = {
      id: `mock-bs-${instanceId}-${Date.now()}`,
      instance_id: instanceId,
      instance_type: 'small',
      custom_monthly_price: null,
      billing_exempt: false,
      exempt_reason: null,
      auto_renew_enabled: true,
      last_billing_cycle_months: null,
      created_at: now,
      updated_at: now,
    };
    this.settingsStore.set(instanceId, created);
    return { ...created };
  }

  async updateBillingSettings(
    instanceId: string,
    data: {
      instance_type?: InstanceType;
      custom_monthly_price?: number | null;
      billing_exempt?: boolean;
      exempt_reason?: BillingExemptReason | null;
      auto_renew_enabled?: boolean;
    },
    _operatorUserId: string,
  ): Promise<InstanceBillingSettings> {
    const settings = this.settingsStore.get(instanceId);
    if (!settings) {
      throw new InstanceBillingSettingsNotFoundError(`settings not found for instance ${instanceId}`);
    }
    if (data.instance_type !== undefined) settings.instance_type = data.instance_type;
    if (data.custom_monthly_price !== undefined) settings.custom_monthly_price = data.custom_monthly_price;
    if (data.billing_exempt !== undefined) settings.billing_exempt = data.billing_exempt;
    if (data.exempt_reason !== undefined) settings.exempt_reason = data.exempt_reason;
    if (data.auto_renew_enabled !== undefined) settings.auto_renew_enabled = data.auto_renew_enabled;
    settings.updated_at = new Date().toISOString();
    return { ...settings };
  }

  // ===== 金额计算（纯函数） =====

  calculateAmount(
    typePricing: InstanceTypePricing,
    cycleMonths: BillingCycleMonths,
    customMonthlyPrice?: number | null,
  ): BillingAmountResult {
    if (![1, 3, 6, 12].includes(cycleMonths)) {
      throw new InvalidBillingCycleError(`invalid billing_cycle_months: ${cycleMonths}`);
    }
    const monthlyPriceEffective = customMonthlyPrice ?? typePricing.monthly_price;
    const cycleDiscount = cycleDiscountOf(typePricing, cycleMonths);
    const durationDays = cycleMonths * DEFAULT_DAYS_PER_MONTH;
    const baseAmount = monthlyPriceEffective * cycleMonths;
    const amount = Math.round(baseAmount * cycleDiscount);
    return {
      monthly_price_effective: monthlyPriceEffective,
      billing_cycle_months: cycleMonths,
      cycle_discount_applied: cycleDiscount,
      duration_days: durationDays,
      base_amount: baseAmount,
      amount,
    };
  }

  // ===== 免计费判定 =====

  async isBillingExempt(
    instanceId: string,
    operatorUserId: string,
  ): Promise<BillingExemptResult> {
    if (!instanceId) {
      throw new InstanceNotFoundError('instance id is required');
    }
    // 优先级 1: billing_exempt 标记
    const settings = this.settingsStore.get(instanceId);
    if (settings?.billing_exempt) {
      return { exempt: true, reason: settings.exempt_reason ?? 'manual' };
    }
    // 优先级 2: Mock 豁免标记（模拟 self_hosted_node）
    const markedExempt = this.exemptInstances.get(instanceId);
    if (markedExempt) {
      return { exempt: true, reason: markedExempt };
    }
    // 优先级 3: owner_self（Mock 用 operatorUserId === 'owner-self' 触发）
    if (operatorUserId === 'owner-self') {
      return { exempt: true, reason: 'owner_self' };
    }
    return { exempt: false, reason: null };
  }

  // ===== 计费操作（有副作用，扣款） =====

  async chargeInstanceCreation(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult> {
    return this.doCharge(instanceId, operatorUserId, cycleMonths, 'manual');
  }

  async chargeInstanceRenewal(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult> {
    return this.doCharge(instanceId, operatorUserId, cycleMonths, 'manual');
  }

  async autoRenewInstance(instanceId: string): Promise<{
    success: boolean;
    amount_paid: number;
    failure_reason?: string;
  }> {
    const settings = this.settingsStore.get(instanceId);
    if (!settings) {
      return { success: false, amount_paid: 0, failure_reason: 'settings not found' };
    }
    if (!settings.auto_renew_enabled) {
      return { success: false, amount_paid: 0, failure_reason: 'auto_renew disabled' };
    }
    const cycleMonths: BillingCycleMonths = settings.last_billing_cycle_months ?? 1;
    try {
      const result = await this.doCharge(instanceId, 'mock-scheduler', cycleMonths, 'auto');
      return { success: true, amount_paid: result.amount_paid };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { success: false, amount_paid: 0, failure_reason: reason };
    }
  }

  async scanAndAutoRenew(): Promise<{
    scanned: number;
    renewed: number;
    failed: number;
    exempt: number;
  }> {
    let scanned = 0;
    let renewed = 0;
    let failed = 0;
    let exempt = 0;
    for (const instanceId of this.settingsStore.keys()) {
      scanned++;
      const result = await this.autoRenewInstance(instanceId);
      if (result.success) {
        renewed++;
      } else if (result.failure_reason?.includes('exempt')) {
        exempt++;
      } else {
        failed++;
      }
    }
    return { scanned, renewed, failed, exempt };
  }

  // ===== Mock 专用辅助方法（非契约方法，仅供测试驱动） =====

  /** 标记某实例下次扣款余额不足 */
  markInsufficientBalance(instanceId: string): void {
    this.insufficientBalanceInstances.add(instanceId);
  }

  /** 标记某实例豁免（模拟 self_hosted_node） */
  markExempt(instanceId: string, reason: BillingExemptReason): void {
    this.exemptInstances.set(instanceId, reason);
  }

  /** 查询某实例的续费记录（Mock 调试用） */
  listRenewalsFor(instanceId: string): InstanceRenewal[] {
    return this.renewalsStore.get(instanceId) ?? [];
  }

  // ===== 内部扣款实现 =====

  private async doCharge(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
    renewalType: InstanceRenewalType,
  ): Promise<InstanceBillingResult> {
    if (!instanceId) {
      throw new InstanceNotFoundError('instance id is required');
    }
    // 免计费判定
    const exemptResult = await this.isBillingExempt(instanceId, operatorUserId);
    if (exemptResult.exempt) {
      const now = new Date();
      const newExpiresAt = new Date(
        now.getTime() + cycleMonths * DEFAULT_DAYS_PER_MONTH * 86400000,
      ).toISOString();
      const renewal = this.writeRenewal({
        instanceId,
        userId: operatorUserId,
        cycleMonths,
        amountPaid: 0,
        baseAmount: 0,
        renewalType,
        oldExpiresAt: null,
        newExpiresAt,
      });
      return {
        renewal,
        amount_paid: 0,
        exempt: true,
        exempt_reason: exemptResult.reason,
        new_expires_at: newExpiresAt,
      };
    }
    // 余额不足模拟
    if (this.insufficientBalanceInstances.has(instanceId)) {
      throw new GlobalBalanceInsufficientError(
        `mock: insufficient balance for instance ${instanceId}`,
      );
    }
    // 取定价
    const settings = await this.getOrCreateBillingSettings(instanceId);
    const typePricing = await this.getTypePricing(settings.instance_type);
    // 计算金额
    const amountResult = this.calculateAmount(
      typePricing,
      cycleMonths,
      settings.custom_monthly_price,
    );
    // 写续费记录
    const now = new Date();
    const newExpiresAt = new Date(
      now.getTime() + amountResult.duration_days * 86400000,
    ).toISOString();
    const renewal = this.writeRenewal({
      instanceId,
      userId: operatorUserId,
      cycleMonths,
      amountPaid: amountResult.amount,
      baseAmount: amountResult.base_amount,
      renewalType,
      oldExpiresAt: null,
      newExpiresAt,
    });
    // 更新 last_billing_cycle_months
    settings.last_billing_cycle_months = cycleMonths;
    settings.updated_at = now.toISOString();
    return {
      renewal,
      amount_paid: amountResult.amount,
      exempt: false,
      exempt_reason: null,
      new_expires_at: newExpiresAt,
    };
  }

  private writeRenewal(args: {
    instanceId: string;
    userId: string;
    cycleMonths: BillingCycleMonths;
    amountPaid: number;
    baseAmount: number;
    renewalType: InstanceRenewalType;
    oldExpiresAt: string | null;
    newExpiresAt: string;
  }): InstanceRenewal {
    const id = this.renewalIdSeq++;
    const renewal: InstanceRenewal = {
      id,
      instance_id: args.instanceId,
      user_id: args.userId,
      duration_days: args.cycleMonths * DEFAULT_DAYS_PER_MONTH,
      amount_paid: args.amountPaid,
      base_amount: args.baseAmount,
      tier_discount_applied: 1.0,
      vip_discount_applied: 1.0,
      vip_level_at_renewal: 0,
      renewal_type: args.renewalType,
      use_wallet: args.renewalType !== 'gift',
      old_expires_at: args.oldExpiresAt,
      new_expires_at: args.newExpiresAt,
      renewed_at: new Date().toISOString(),
      wallet_source: 'admin_wallets' as WalletSource,
      admin_tier_discount_applied: null,
      node_source_at_renewal: null as NodeSource | null,
      billing_cycle_months: args.cycleMonths,
      instance_type_snapshot: null,
    };
    const list = this.renewalsStore.get(args.instanceId) ?? [];
    list.push(renewal);
    this.renewalsStore.set(args.instanceId, list);
    return renewal;
  }
}

/** 默认导出单例，便于直接 import 使用 */
export const mockInstanceBillingService = new MockInstanceBillingService();
