// ============================================================================
// instanceBillingService — VPS 式预付费实例计费核心服务
//
// 接口契约：@public/interface_stub/instance-billing-service.d.ts（12 方法）
// 数据契约：
//   - public/schema/instance-type-pricing-schema.json（类型定价表）
//   - public/schema/instance-billing-settings-schema.json（实例计费设置表）
//   - public/schema/instance-renewals-schema.json（计费记录表）
//   - public/schema/server-schema.json（servers.billing_type/expires_at/expiry_status）
//
// 设计要点（来源：docs/plans/instance-billing-rules-plan.md §8 + instance-billing-service.d.ts）：
// - 定价公式：amount = monthly_price_effective × billing_cycle_months × cycle_discount
//   - monthly_price_effective = instance_billing_settings.custom_monthly_price ?? instance_type_pricing.monthly_price
//   - cycle_discount：1→1.0, 3→quarterly_discount, 6→semiannual_discount, 12→annual_discount
//   - duration_days = billing_cycle_months × days_per_month（system_config.instance.billing.days_per_month，默认 30）
//   - amount 按 rounding_mode 取整（system_config.instance.billing.rounding_mode，默认 round）
// - 扣款源：腐竹 global_balances（通过 owner_user_id 隔离），调 balanceService.debit
// - 收款方：server_admin global_balances，调 balanceService.credit
// - 并发安全：balanceService.debit 已实现原子 UPDATE ... WHERE (balance - frozen_balance) >= amount
// - 失败回滚：debit 成功后续失败 → 反向 credit 退款（best-effort，退款失败仅日志）
// - 免计费优先级：billing_exempt > self_hosted_node > owner_self
//
// 配置项（system_config KV）：
//   - instance.billing.days_per_month（默认 30）
//   - instance.billing.rounding_mode（默认 'round'，可选 'floor'/'ceil'）
//   - instance.billing.auto_renew_lookahead_days（默认 3，到期前 N 天触发自动续扣）
//   - billing.admin_user_id（可选，收款方管理员 user_id；缺失时 fallback 到首个 server_admin）
// ============================================================================

import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import type { SystemConfigService } from '@public/interface_stub/system-config-service';
import type {
  InstanceType,
  BillingCycleMonths,
  InstanceTypePricing,
  InstanceBillingSettings,
  BillingExemptReason,
  InstanceRenewal,
} from '@public/interface_stub/shared-types';
import type {
  BillingAmountResult,
  BillingExemptResult,
  InstanceBillingResult,
} from '@public/interface_stub/instance-billing-service';
import type { BalanceServiceImpl } from './balanceService.js';
import {
  InstanceNotFoundError,
  InstanceTypePricingNotFoundError,
  GlobalBalanceInsufficientError,
  InvalidBillingCycleError,
} from './errors.js';
import { InsufficientBalanceError } from './errors.js';

// ----- DB 行类型 -----

interface InstanceTypePricingRow {
  id: string;
  instance_type: InstanceType;
  display_name: string;
  monthly_price: number;
  quarterly_discount: number;
  semiannual_discount: number;
  annual_discount: number;
  recommended_slots: number | null;
  cpu_limit: string | null;
  memory_limit_mb: number | null;
  disk_limit_gb: number | null;
  status: 'active' | 'archived';
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface InstanceBillingSettingsRow {
  id: string;
  instance_id: string;
  instance_type: InstanceType;
  custom_monthly_price: number | null;
  billing_exempt: number; // SQLite boolean as 0/1
  exempt_reason: BillingExemptReason | null;
  auto_renew_enabled: number; // SQLite boolean as 0/1
  last_billing_cycle_months: BillingCycleMonths | null;
  created_at: string;
  updated_at: string;
}

interface InstanceRenewalInsertRow {
  instance_id: string;
  user_id: string;
  duration_days: number;
  amount_paid: number;
  base_amount: number;
  tier_discount_applied: number;
  vip_discount_applied: number;
  vip_level_at_renewal: number;
  renewal_type: 'manual' | 'gift' | 'auto';
  use_wallet: number; // SQLite boolean as 0/1
  old_expires_at: string | null;
  new_expires_at: string | null;
  renewed_at: string;
  wallet_source: 'user_wallets' | 'admin_wallets';
  admin_tier_discount_applied: number | null;
  node_source_at_renewal: 'platform_managed' | 'self_hosted' | null;
  billing_cycle_months: BillingCycleMonths | null;
  instance_type_snapshot: InstanceType | null;
}

interface ServerBillingRow {
  id: string;
  name: string;
  node_id: string;
  owner_user_id: string;
  status: string;
  billing_type: string | null;
  expires_at: string | null;
  expiry_status: string;
  expiry_grace_until: string | null;
}

interface NodeBillingRow {
  id: string;
  node_source: string | null;
  approval_status: string | null;
}

// ----- 常量 -----

const CYCLE_MONTHS_VALUES: ReadonlySet<number> = new Set([1, 3, 6, 12]);
const DEFAULT_DAYS_PER_MONTH = 30;
const DEFAULT_ROUNDING_MODE = 'round';
const DEFAULT_AUTO_RENEW_LOOKAHEAD_DAYS = 3;
const ADMIN_USER_ID_CACHE_TTL_MS = 60_000; // 1 分钟缓存
const MS_PER_DAY = 86_400_000;

const WALLET_SOURCE_ADMIN = 'admin_wallets' as const;
const NODE_SOURCE_SELF_HOSTED = 'self_hosted' as const;
const NODE_APPROVAL_APPROVED = 'approved' as const;

// ----- 服务实现 -----

export class InstanceBillingServiceImpl {
  private adminUserIdCache: { value: string | null; expiresAt: number } = {
    value: null,
    expiresAt: 0,
  };

  constructor(
    private readonly db: Knex,
    private readonly balanceService: BalanceServiceImpl,
    private readonly systemConfigService: SystemConfigService,
    private readonly logger: Logger,
  ) {}

  // ===== 定价查询 =====

  /** GET /api/admin/instance-billing/types：查询所有生效的类型定价（按月费升序） */
  async listActiveTypePricings(): Promise<InstanceTypePricing[]> {
    const rows = await this.db<InstanceTypePricingRow>('instance_type_pricing')
      .where({ status: 'active' })
      .orderBy('monthly_price', 'asc');
    return rows.map(toInstanceTypePricing);
  }

  /** 查询指定类型的生效定价 */
  async getTypePricing(instanceType: InstanceType): Promise<InstanceTypePricing> {
    const row = await this.db<InstanceTypePricingRow>('instance_type_pricing')
      .where({ instance_type: instanceType, status: 'active' })
      .first();
    if (!row) {
      throw new InstanceTypePricingNotFoundError(
        `实例类型定价不存在或已归档: ${instanceType}`,
      );
    }
    return toInstanceTypePricing(row);
  }

  /** POST /api/admin/instance-billing/types：创建或更新类型定价（仅 server_admin） */
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
    // 校验折扣系数 [0, 1]
    const q = data.quarterly_discount ?? 1.0;
    const s = data.semiannual_discount ?? 1.0;
    const a = data.annual_discount ?? 1.0;
    if (!isValidDiscount(q) || !isValidDiscount(s) || !isValidDiscount(a)) {
      throw new InvalidBillingCycleError('折扣系数必须在 [0, 1] 范围内');
    }
    if (!Number.isInteger(data.monthly_price) || data.monthly_price < 0) {
      throw new InvalidBillingCycleError('monthly_price 必须为非负整数');
    }
    if (!data.display_name || data.display_name.length > 32) {
      throw new InvalidBillingCycleError('display_name 必填且长度不超过 32');
    }

    const now = new Date().toISOString();
    const existing = await this.db<InstanceTypePricingRow>('instance_type_pricing')
      .where({ instance_type: instanceType, status: 'active' })
      .first();

    if (existing) {
      // UPDATE 现有 active 记录
      await this.db<InstanceTypePricingRow>('instance_type_pricing')
        .where({ id: existing.id })
        .update({
          display_name: data.display_name,
          monthly_price: data.monthly_price,
          quarterly_discount: q,
          semiannual_discount: s,
          annual_discount: a,
          recommended_slots: data.recommended_slots ?? null,
          cpu_limit: data.cpu_limit ?? null,
          memory_limit_mb: data.memory_limit_mb ?? null,
          disk_limit_gb: data.disk_limit_gb ?? null,
          description: data.description ?? null,
          updated_at: now,
        });
      const refreshed = await this.db<InstanceTypePricingRow>('instance_type_pricing')
        .where({ id: existing.id })
        .first();
      return toInstanceTypePricing(refreshed as InstanceTypePricingRow);
    }

    // INSERT 新记录
    const id = crypto.randomUUID();
    await this.db<InstanceTypePricingRow>('instance_type_pricing').insert({
      id,
      instance_type: instanceType,
      display_name: data.display_name,
      monthly_price: data.monthly_price,
      quarterly_discount: q,
      semiannual_discount: s,
      annual_discount: a,
      recommended_slots: data.recommended_slots ?? null,
      cpu_limit: data.cpu_limit ?? null,
      memory_limit_mb: data.memory_limit_mb ?? null,
      disk_limit_gb: data.disk_limit_gb ?? null,
      status: 'active',
      description: data.description ?? null,
      created_by: operatorUserId,
      created_at: now,
      updated_at: now,
    });
    const row = await this.db<InstanceTypePricingRow>('instance_type_pricing')
      .where({ id })
      .first();
    return toInstanceTypePricing(row as InstanceTypePricingRow);
  }

  /** DELETE /api/admin/instance-billing/types/:instance_type：归档类型定价（不可逆） */
  async archiveTypePricing(instanceType: InstanceType, _operatorUserId: string): Promise<void> {
    const now = new Date().toISOString();
    const updated = await this.db<InstanceTypePricingRow>('instance_type_pricing')
      .where({ instance_type: instanceType, status: 'active' })
      .update({ status: 'archived', updated_at: now });
    if (updated === 0) {
      throw new InstanceTypePricingNotFoundError(
        `实例类型定价不存在或已归档: ${instanceType}`,
      );
    }
  }

  // ===== 实例计费设置 =====

  /** GET /api/admin/instance-billing/settings/:instance_id：获取或创建实例计费设置 */
  async getOrCreateBillingSettings(instanceId: string): Promise<InstanceBillingSettings> {
    // 验证实例存在
    await this.assertInstanceExists(instanceId);

    const existing = await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .first();
    if (existing) {
      return toInstanceBillingSettings(existing);
    }

    // 首次访问自动创建（instance_type 默认 'small'）
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .insert({
        id,
        instance_id: instanceId,
        instance_type: 'small',
        custom_monthly_price: null,
        billing_exempt: 0,
        exempt_reason: null,
        auto_renew_enabled: 1,
        last_billing_cycle_months: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict('instance_id')
      .ignore();
    const row = await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .first();
    return toInstanceBillingSettings(row as InstanceBillingSettingsRow);
  }

  /** PUT /api/admin/instance-billing/settings/:instance_id：更新实例计费设置 */
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
    // 确保设置记录存在
    await this.getOrCreateBillingSettings(instanceId);

    // 验证 instance_type 存在
    if (data.instance_type) {
      await this.getTypePricing(data.instance_type);
    }

    // 校验豁免字段一致性
    if (data.billing_exempt === true && !data.exempt_reason && data.exempt_reason !== null) {
      // 未传 exempt_reason 时保留原值，不强制报错
    }
    if (data.billing_exempt === false) {
      // 取消豁免时清空 reason
      data.exempt_reason = null;
    }
    if (data.custom_monthly_price !== null && data.custom_monthly_price !== undefined) {
      if (!Number.isInteger(data.custom_monthly_price) || data.custom_monthly_price < 0) {
        throw new InvalidBillingCycleError('custom_monthly_price 必须为非负整数或 null');
      }
    }

    const update: Partial<InstanceBillingSettingsRow> = { updated_at: new Date().toISOString() };
    if (data.instance_type) update.instance_type = data.instance_type;
    if (data.custom_monthly_price !== undefined) {
      update.custom_monthly_price = data.custom_monthly_price ?? null;
    }
    if (data.billing_exempt !== undefined) {
      update.billing_exempt = data.billing_exempt ? 1 : 0;
      if (data.billing_exempt && data.exempt_reason) {
        update.exempt_reason = data.exempt_reason;
      } else if (!data.billing_exempt) {
        update.exempt_reason = null;
      }
    } else if (data.exempt_reason !== undefined) {
      update.exempt_reason = data.exempt_reason;
    }
    if (data.auto_renew_enabled !== undefined) {
      update.auto_renew_enabled = data.auto_renew_enabled ? 1 : 0;
    }

    await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .update(update);
    const row = await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .first();
    return toInstanceBillingSettings(row as InstanceBillingSettingsRow);
  }

  // ===== 金额计算（纯函数，无副作用） =====

  /** 计算计费金额（不扣款）。读 system_config 获取 days_per_month/rounding_mode */
  async calculateAmount(
    typePricing: InstanceTypePricing,
    cycleMonths: BillingCycleMonths,
    customMonthlyPrice?: number | null,
  ): Promise<BillingAmountResult> {
    if (!CYCLE_MONTHS_VALUES.has(cycleMonths)) {
      throw new InvalidBillingCycleError(`计费周期非法: ${cycleMonths}，必须为 1/3/6/12`);
    }

    const monthlyPriceEffective =
      customMonthlyPrice !== null && customMonthlyPrice !== undefined
        ? customMonthlyPrice
        : typePricing.monthly_price;

    const cycleDiscount = cycleDiscountFor(cycleMonths, typePricing);
    const baseAmount = monthlyPriceEffective * cycleMonths;
    const rawAmount = baseAmount * cycleDiscount;

    const roundingMode = await this.getRoundingMode();
    const amount = applyRounding(rawAmount, roundingMode);

    const daysPerMonth = await this.getDaysPerMonth();
    const durationDays = cycleMonths * daysPerMonth;

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

  /** 判定实例是否免计费。优先级：billing_exempt > self_hosted_node > owner_self */
  async isBillingExempt(
    instanceId: string,
    operatorUserId: string,
  ): Promise<BillingExemptResult> {
    const server = await this.getServerBillingRow(instanceId);
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${instanceId}`);
    }

    // 优先级 1：billing_exempt=true
    const settings = await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .first();
    if (settings && settings.billing_exempt === 1) {
      return { exempt: true, reason: settings.exempt_reason ?? 'manual' };
    }

    // 优先级 2：node_source=self_hosted 且 approval_status=approved
    const node = await this.db<NodeBillingRow>('nodes')
      .where({ id: server.node_id })
      .first();
    if (
      node &&
      node.node_source === NODE_SOURCE_SELF_HOSTED &&
      node.approval_status === NODE_APPROVAL_APPROVED
    ) {
      return { exempt: true, reason: 'self_hosted_node' };
    }

    // 优先级 3：owner_user_id == operatorUserId
    if (server.owner_user_id === operatorUserId) {
      return { exempt: true, reason: 'owner_self' };
    }

    return { exempt: false, reason: null };
  }

  // ===== 计费操作（有副作用，扣款） =====

  /** 创建实例时计费（预付费扣全额） */
  async chargeInstanceCreation(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult> {
    const server = await this.getServerBillingRow(instanceId);
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${instanceId}`);
    }

    const settings = await this.getOrCreateBillingSettings(instanceId);
    const exemptResult = await this.isBillingExempt(instanceId, operatorUserId);

    const typePricing = await this.getTypePricing(settings.instance_type);
    const amountResult = await this.calculateAmount(
      typePricing,
      cycleMonths,
      settings.custom_monthly_price,
    );

    const now = Date.now();
    const newExpiresAt = new Date(now + amountResult.duration_days * MS_PER_DAY).toISOString();
    const renewedAt = new Date(now).toISOString();

    if (exemptResult.exempt || amountResult.amount === 0) {
      // 豁免或免费类型：不扣款，仅写记录 + 更新 servers
      const renewal = await this.writeRenewalRecord({
        instanceId,
        userId: operatorUserId,
        durationDays: amountResult.duration_days,
        amountPaid: 0,
        baseAmount: amountResult.base_amount,
        tierDiscount: amountResult.cycle_discount_applied,
        renewalType: 'manual',
        useWallet: false,
        oldExpiresAt: server.expires_at,
        newExpiresAt,
        renewedAt,
        billingCycleMonths: cycleMonths,
        instanceTypeSnapshot: settings.instance_type,
      });

      await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');
      await this.updateLastBillingCycle(instanceId, cycleMonths);

      return {
        renewal,
        amount_paid: 0,
        exempt: exemptResult.exempt,
        exempt_reason: exemptResult.reason,
        new_expires_at: newExpiresAt,
      };
    }

    // 非豁免扣款路径
    const adminUserId = await this.resolveAdminUserId();
    if (!adminUserId) {
      throw new GlobalBalanceInsufficientError('无法解析收款方管理员 user_id（system_config.billing.admin_user_id 未配置且无 server_admin 用户）');
    }

    const description = `实例创建计费: ${instanceId} (${settings.instance_type} × ${cycleMonths}月)`;
    let debitTxId: number | null = null;

    try {
      debitTxId = await this.balanceService.debit(
        server.owner_user_id,
        amountResult.amount,
        'instance_billing',
        description,
        operatorUserId,
        undefined,
        { orderId: instanceId },
      );
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new GlobalBalanceInsufficientError(
          `腐竹全局余额不足：需要 ${amountResult.amount}，${err.message}`,
        );
      }
      throw err;
    }

    try {
      await this.balanceService.credit(
        adminUserId,
        amountResult.amount,
        'instance_billing',
        description,
        operatorUserId,
        undefined,
        { orderId: instanceId, linkedTxId: debitTxId },
      );
    } catch (err) {
      // credit 失败 → 反向退款给腐竹
      await this.bestEffortRefund(server.owner_user_id, amountResult.amount, instanceId, 'credit失败退款');
      throw err;
    }

    try {
      const renewal = await this.writeRenewalRecord({
        instanceId,
        userId: operatorUserId,
        durationDays: amountResult.duration_days,
        amountPaid: amountResult.amount,
        baseAmount: amountResult.base_amount,
        tierDiscount: amountResult.cycle_discount_applied,
        renewalType: 'manual',
        useWallet: true,
        oldExpiresAt: server.expires_at,
        newExpiresAt,
        renewedAt,
        billingCycleMonths: cycleMonths,
        instanceTypeSnapshot: settings.instance_type,
      });

      await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');
      await this.updateLastBillingCycle(instanceId, cycleMonths);

      return {
        renewal,
        amount_paid: amountResult.amount,
        exempt: false,
        exempt_reason: null,
        new_expires_at: newExpiresAt,
      };
    } catch (finalErr) {
      // 写记录或更新 servers 失败 → 双向退款
      await this.bestEffortRefund(server.owner_user_id, amountResult.amount, instanceId, '创建失败退款');
      await this.bestEffortRefundAdmin(adminUserId, amountResult.amount, instanceId, '创建失败退款');
      throw finalErr;
    }
  }

  /** 手动续费（预付费扣全额，可不同于上次周期） */
  async chargeInstanceRenewal(
    instanceId: string,
    operatorUserId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<InstanceBillingResult> {
    const server = await this.getServerBillingRow(instanceId);
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${instanceId}`);
    }

    const settings = await this.getOrCreateBillingSettings(instanceId);
    const exemptResult = await this.isBillingExempt(instanceId, operatorUserId);

    const typePricing = await this.getTypePricing(settings.instance_type);
    const amountResult = await this.calculateAmount(
      typePricing,
      cycleMonths,
      settings.custom_monthly_price,
    );

    // 续费：未过期叠加 old_expires_at，已过期从 now 起算
    const nowMs = Date.now();
    const oldExpiresMs = server.expires_at ? new Date(server.expires_at).getTime() : 0;
    const baseMs = oldExpiresMs > nowMs ? oldExpiresMs : nowMs;
    const newExpiresAt = new Date(baseMs + amountResult.duration_days * MS_PER_DAY).toISOString();
    const renewedAt = new Date(nowMs).toISOString();

    if (exemptResult.exempt || amountResult.amount === 0) {
      const renewal = await this.writeRenewalRecord({
        instanceId,
        userId: operatorUserId,
        durationDays: amountResult.duration_days,
        amountPaid: 0,
        baseAmount: amountResult.base_amount,
        tierDiscount: amountResult.cycle_discount_applied,
        renewalType: 'manual',
        useWallet: false,
        oldExpiresAt: server.expires_at,
        newExpiresAt,
        renewedAt,
        billingCycleMonths: cycleMonths,
        instanceTypeSnapshot: settings.instance_type,
      });

      await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');
      await this.updateLastBillingCycle(instanceId, cycleMonths);

      return {
        renewal,
        amount_paid: 0,
        exempt: exemptResult.exempt,
        exempt_reason: exemptResult.reason,
        new_expires_at: newExpiresAt,
      };
    }

    const adminUserId = await this.resolveAdminUserId();
    if (!adminUserId) {
      throw new GlobalBalanceInsufficientError('无法解析收款方管理员 user_id');
    }

    const description = `实例续费: ${instanceId} (${settings.instance_type} × ${cycleMonths}月)`;
    let debitTxId: number | null = null;
    try {
      debitTxId = await this.balanceService.debit(
        server.owner_user_id,
        amountResult.amount,
        'instance_billing',
        description,
        operatorUserId,
        undefined,
        { orderId: instanceId },
      );
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new GlobalBalanceInsufficientError(
          `腐竹全局余额不足：需要 ${amountResult.amount}，${err.message}`,
        );
      }
      throw err;
    }

    try {
      await this.balanceService.credit(
        adminUserId,
        amountResult.amount,
        'instance_billing',
        description,
        operatorUserId,
        undefined,
        { orderId: instanceId, linkedTxId: debitTxId },
      );

      const renewal = await this.writeRenewalRecord({
        instanceId,
        userId: operatorUserId,
        durationDays: amountResult.duration_days,
        amountPaid: amountResult.amount,
        baseAmount: amountResult.base_amount,
        tierDiscount: amountResult.cycle_discount_applied,
        renewalType: 'manual',
        useWallet: true,
        oldExpiresAt: server.expires_at,
        newExpiresAt,
        renewedAt,
        billingCycleMonths: cycleMonths,
        instanceTypeSnapshot: settings.instance_type,
      });

      await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');
      await this.updateLastBillingCycle(instanceId, cycleMonths);

      return {
        renewal,
        amount_paid: amountResult.amount,
        exempt: false,
        exempt_reason: null,
        new_expires_at: newExpiresAt,
      };
    } catch (finalErr) {
      await this.bestEffortRefund(server.owner_user_id, amountResult.amount, instanceId, '续费失败退款');
      await this.bestEffortRefundAdmin(adminUserId, amountResult.amount, instanceId, '续费失败退款');
      throw finalErr;
    }
  }

  /** 自动续扣（scheduler 调用，沿用上次周期）。失败不抛错，返回失败原因 */
  async autoRenewInstance(instanceId: string): Promise<{
    success: boolean;
    amount_paid: number;
    failure_reason?: string;
  }> {
    const server = await this.getServerBillingRow(instanceId);
    if (!server) {
      return { success: false, amount_paid: 0, failure_reason: 'instance_not_found' };
    }

    const settings = await this.getOrCreateBillingSettings(instanceId);
    if (!settings.auto_renew_enabled) {
      return { success: false, amount_paid: 0, failure_reason: 'auto_renew_disabled' };
    }

    const cycleMonths: BillingCycleMonths = settings.last_billing_cycle_months ?? 1;
    const exemptResult = await this.isBillingExempt(instanceId, server.owner_user_id);

    const typePricing = await this.getTypePricing(settings.instance_type);
    const amountResult = await this.calculateAmount(
      typePricing,
      cycleMonths,
      settings.custom_monthly_price,
    );

    const nowMs = Date.now();
    const oldExpiresMs = server.expires_at ? new Date(server.expires_at).getTime() : 0;
    const baseMs = oldExpiresMs > nowMs ? oldExpiresMs : nowMs;
    const newExpiresAt = new Date(baseMs + amountResult.duration_days * MS_PER_DAY).toISOString();
    const renewedAt = new Date(nowMs).toISOString();

    if (exemptResult.exempt || amountResult.amount === 0) {
      await this.writeRenewalRecord({
        instanceId,
        userId: server.owner_user_id,
        durationDays: amountResult.duration_days,
        amountPaid: 0,
        baseAmount: amountResult.base_amount,
        tierDiscount: amountResult.cycle_discount_applied,
        renewalType: 'auto',
        useWallet: false,
        oldExpiresAt: server.expires_at,
        newExpiresAt,
        renewedAt,
        billingCycleMonths: cycleMonths,
        instanceTypeSnapshot: settings.instance_type,
      });
      await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');
      return { success: true, amount_paid: 0 };
    }

    const adminUserId = await this.resolveAdminUserId();
    if (!adminUserId) {
      this.logger.warn({ instanceId }, 'autoRenewInstance: 无法解析收款方管理员 user_id');
      return { success: false, amount_paid: 0, failure_reason: 'no_admin_user' };
    }

    const description = `实例自动续扣: ${instanceId} (${settings.instance_type} × ${cycleMonths}月)`;
    try {
      const debitTxId = await this.balanceService.debit(
        server.owner_user_id,
        amountResult.amount,
        'instance_billing',
        description,
        server.owner_user_id,
        undefined,
        { orderId: instanceId },
      );
      try {
        await this.balanceService.credit(
          adminUserId,
          amountResult.amount,
          'instance_billing',
          description,
          server.owner_user_id,
          undefined,
          { orderId: instanceId, linkedTxId: debitTxId },
        );

        await this.writeRenewalRecord({
          instanceId,
          userId: server.owner_user_id,
          durationDays: amountResult.duration_days,
          amountPaid: amountResult.amount,
          baseAmount: amountResult.base_amount,
          tierDiscount: amountResult.cycle_discount_applied,
          renewalType: 'auto',
          useWallet: true,
          oldExpiresAt: server.expires_at,
          newExpiresAt,
          renewedAt,
          billingCycleMonths: cycleMonths,
          instanceTypeSnapshot: settings.instance_type,
        });
        await this.updateServerAfterBilling(instanceId, newExpiresAt, 'active', 'vps_prepaid');

        return { success: true, amount_paid: amountResult.amount };
      } catch (finalErr) {
        // credit 或写记录失败 → 退款
        await this.bestEffortRefund(server.owner_user_id, amountResult.amount, instanceId, '自动续扣失败退款');
        this.logger.warn({ err: String(finalErr), instanceId }, 'autoRenewInstance: 续扣后续操作失败，已退款');
        return { success: false, amount_paid: 0, failure_reason: 'post_debit_failure' };
      }
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // 余额不足：不抛错，记录告警，等过期处理
        this.logger.warn(
          { instanceId, amount: amountResult.amount, ownerUserId: server.owner_user_id },
          'autoRenewInstance: 腐竹余额不足，自动续扣失败，等待过期处理',
        );
        return { success: false, amount_paid: 0, failure_reason: 'insufficient_balance' };
      }
      this.logger.error({ err: String(err), instanceId }, 'autoRenewInstance: 未知错误');
      return { success: false, amount_paid: 0, failure_reason: 'unknown_error' };
    }
  }

  /** 批量扫描并自动续扣临近到期实例（scheduler 调用） */
  async scanAndAutoRenew(): Promise<{
    scanned: number;
    renewed: number;
    failed: number;
    exempt: number;
  }> {
    const lookaheadDays = await this.getAutoRenewLookaheadDays();
    const now = new Date();
    const cutoff = new Date(now.getTime() + lookaheadDays * MS_PER_DAY).toISOString();

    // 扫描 expires_at <= cutoff 且 expiry_status='active' 的实例
    const servers = await this.db<ServerBillingRow>('servers')
      .where({ expiry_status: 'active' })
      .whereNotNull('expires_at')
      .where('expires_at', '<=', cutoff)
      .select('id', 'owner_user_id');

    let renewed = 0;
    let failed = 0;
    let exempt = 0;

    for (const server of servers) {
      // 检查是否启用自动续扣
      const settings = await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
        .where({ instance_id: server.id })
        .first();
      if (!settings || settings.auto_renew_enabled !== 1) {
        continue;
      }

      // 检查豁免
      const exemptResult = await this.isBillingExempt(server.id, server.owner_user_id);
      if (exemptResult.exempt) {
        // 豁免实例直接延长 expires_at
        const result = await this.autoRenewInstance(server.id);
        if (result.success) {
          renewed++;
          exempt++;
        } else {
          failed++;
        }
        continue;
      }

      const result = await this.autoRenewInstance(server.id);
      if (result.success) {
        renewed++;
      } else {
        failed++;
      }
    }

    return { scanned: servers.length, renewed, failed, exempt };
  }

  // ----- 内部辅助方法 -----

  private async assertInstanceExists(instanceId: string): Promise<void> {
    const row = await this.db<{ id: string }>('servers').where({ id: instanceId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${instanceId}`);
    }
  }

  private async getServerBillingRow(instanceId: string): Promise<ServerBillingRow | null> {
    const row = await this.db<ServerBillingRow>('servers')
      .select('id', 'name', 'node_id', 'owner_user_id', 'status', 'billing_type', 'expires_at', 'expiry_status', 'expiry_grace_until')
      .where({ id: instanceId })
      .first();
    return row ?? null;
  }

  private async writeRenewalRecord(params: {
    instanceId: string;
    userId: string;
    durationDays: number;
    amountPaid: number;
    baseAmount: number;
    tierDiscount: number;
    renewalType: 'manual' | 'gift' | 'auto';
    useWallet: boolean;
    oldExpiresAt: string | null;
    newExpiresAt: string;
    renewedAt: string;
    billingCycleMonths: BillingCycleMonths;
    instanceTypeSnapshot: InstanceType;
  }): Promise<InstanceRenewal> {
    // 查节点来源快照
    const server = await this.db<{ id: string; node_id: string }>('servers')
      .where({ id: params.instanceId })
      .first();
    let nodeSource: 'platform_managed' | 'self_hosted' | null = null;
    if (server) {
      const node = await this.db<NodeBillingRow>('nodes')
        .where({ id: server.node_id })
        .first();
      if (node?.node_source === NODE_SOURCE_SELF_HOSTED) {
        nodeSource = NODE_SOURCE_SELF_HOSTED;
      } else if (node?.node_source) {
        nodeSource = 'platform_managed';
      }
    }

    const insertRow: InstanceRenewalInsertRow = {
      instance_id: params.instanceId,
      user_id: params.userId,
      duration_days: params.durationDays,
      amount_paid: params.amountPaid,
      base_amount: params.baseAmount,
      tier_discount_applied: params.tierDiscount,
      vip_discount_applied: 1.0, // VPS 计费无 VIP 折扣
      vip_level_at_renewal: 0, // VPS 计费不查 VIP
      renewal_type: params.renewalType,
      use_wallet: params.useWallet ? 1 : 0,
      old_expires_at: params.oldExpiresAt,
      new_expires_at: params.newExpiresAt,
      renewed_at: params.renewedAt,
      wallet_source: WALLET_SOURCE_ADMIN, // 腐竹付管理员
      admin_tier_discount_applied: null, // 腐竹等级折扣暂不启用
      node_source_at_renewal: nodeSource,
      billing_cycle_months: params.billingCycleMonths,
      instance_type_snapshot: params.instanceTypeSnapshot,
    };

    const inserted = await this.db('instance_renewals')
      .insert(insertRow)
      .returning('id');
    const id = extractInsertId(inserted);

    return {
      id,
      instance_id: params.instanceId,
      user_id: params.userId,
      duration_days: params.durationDays,
      amount_paid: params.amountPaid,
      base_amount: params.baseAmount,
      tier_discount_applied: params.tierDiscount,
      vip_discount_applied: 1.0,
      vip_level_at_renewal: 0,
      renewal_type: params.renewalType,
      use_wallet: params.useWallet,
      old_expires_at: params.oldExpiresAt,
      new_expires_at: params.newExpiresAt,
      renewed_at: params.renewedAt,
      wallet_source: WALLET_SOURCE_ADMIN,
      admin_tier_discount_applied: null,
      node_source_at_renewal: nodeSource,
      billing_cycle_months: params.billingCycleMonths,
      instance_type_snapshot: params.instanceTypeSnapshot,
    };
  }

  private async updateServerAfterBilling(
    instanceId: string,
    newExpiresAt: string,
    expiryStatus: string,
    billingType: string,
  ): Promise<void> {
    await this.db('servers').where({ id: instanceId }).update({
      expires_at: newExpiresAt,
      expiry_status: expiryStatus,
      billing_type: billingType,
      updated_at: new Date().toISOString(),
    });
  }

  private async updateLastBillingCycle(
    instanceId: string,
    cycleMonths: BillingCycleMonths,
  ): Promise<void> {
    await this.db<InstanceBillingSettingsRow>('instance_billing_settings')
      .where({ instance_id: instanceId })
      .update({
        last_billing_cycle_months: cycleMonths,
        updated_at: new Date().toISOString(),
      });
  }

  /** 反向退款给腐竹（best-effort，失败仅日志） */
  private async bestEffortRefund(
    userId: string,
    amount: number,
    instanceId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.balanceService.credit(
        userId,
        amount,
        'instance_billing',
        `退款-${reason}: ${instanceId}`,
        null,
      );
    } catch (err) {
      this.logger.error(
        { err: String(err), userId, amount, instanceId, reason },
        'bestEffortRefund: 退款失败（腐竹侧）',
      );
    }
  }

  /** 反向从管理员扣回（best-effort，失败仅日志） */
  private async bestEffortRefundAdmin(
    adminUserId: string,
    amount: number,
    instanceId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.balanceService.debit(
        adminUserId,
        amount,
        'instance_billing',
        `退款-${reason}: ${instanceId}`,
        null,
      );
    } catch (err) {
      this.logger.error(
        { err: String(err), adminUserId, amount, instanceId, reason },
        'bestEffortRefundAdmin: 管理员侧退款失败',
      );
    }
  }

  /** 解析收款方管理员 user_id（缓存 1 分钟） */
  private async resolveAdminUserId(): Promise<string | null> {
    const now = Date.now();
    if (now < this.adminUserIdCache.expiresAt && this.adminUserIdCache.value) {
      return this.adminUserIdCache.value;
    }

    // 优先从 system_config.billing.admin_user_id 读取
    const configured = await this.systemConfigService.get('billing.admin_user_id');
    if (configured) {
      this.adminUserIdCache = { value: configured, expiresAt: now + ADMIN_USER_ID_CACHE_TTL_MS };
      return configured;
    }

    // Fallback：users 表首个 roles 含 server_admin 的 user
    const admin = await this.db<{ id: string; roles: string }>('users')
      .whereLike('roles', '%server_admin%')
      .orderBy('created_at', 'asc')
      .first();
    const adminId = admin?.id ?? null;
    this.adminUserIdCache = { value: adminId, expiresAt: now + ADMIN_USER_ID_CACHE_TTL_MS };
    return adminId;
  }

  private async getDaysPerMonth(): Promise<number> {
    const raw = await this.systemConfigService.getWithDefault(
      'instance.billing.days_per_month',
      String(DEFAULT_DAYS_PER_MONTH),
    );
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAYS_PER_MONTH;
  }

  private async getRoundingMode(): Promise<'round' | 'floor' | 'ceil'> {
    const raw = await this.systemConfigService.getWithDefault(
      'instance.billing.rounding_mode',
      DEFAULT_ROUNDING_MODE,
    );
    if (raw === 'floor' || raw === 'ceil' || raw === 'round') return raw;
    return DEFAULT_ROUNDING_MODE;
  }

  private async getAutoRenewLookaheadDays(): Promise<number> {
    const raw = await this.systemConfigService.getWithDefault(
      'instance.billing.auto_renew_lookahead_days',
      String(DEFAULT_AUTO_RENEW_LOOKAHEAD_DAYS),
    );
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AUTO_RENEW_LOOKAHEAD_DAYS;
  }
}

// ----- 工厂 -----

export function createInstanceBillingService(
  db: Knex,
  balanceService: BalanceServiceImpl,
  systemConfigService: SystemConfigService,
  logger: Logger,
): InstanceBillingServiceImpl {
  return new InstanceBillingServiceImpl(db, balanceService, systemConfigService, logger);
}

// ----- 纯函数辅助 -----

function cycleDiscountFor(cycleMonths: BillingCycleMonths, pricing: InstanceTypePricing): number {
  switch (cycleMonths) {
    case 1:
      return 1.0;
    case 3:
      return pricing.quarterly_discount;
    case 6:
      return pricing.semiannual_discount;
    case 12:
      return pricing.annual_discount;
    default:
      return 1.0;
  }
}

function applyRounding(amount: number, mode: 'round' | 'floor' | 'ceil'): number {
  switch (mode) {
    case 'floor':
      return Math.floor(amount);
    case 'ceil':
      return Math.ceil(amount);
    case 'round':
    default:
      return Math.round(amount);
  }
}

function isValidDiscount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function toInstanceTypePricing(row: InstanceTypePricingRow): InstanceTypePricing {
  return {
    id: row.id,
    instance_type: row.instance_type,
    display_name: row.display_name,
    monthly_price: row.monthly_price,
    quarterly_discount: row.quarterly_discount,
    semiannual_discount: row.semiannual_discount,
    annual_discount: row.annual_discount,
    recommended_slots: row.recommended_slots,
    cpu_limit: row.cpu_limit,
    memory_limit_mb: row.memory_limit_mb,
    disk_limit_gb: row.disk_limit_gb,
    description: row.description,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toInstanceBillingSettings(row: InstanceBillingSettingsRow): InstanceBillingSettings {
  return {
    id: row.id,
    instance_id: row.instance_id,
    instance_type: row.instance_type,
    custom_monthly_price: row.custom_monthly_price,
    billing_exempt: row.billing_exempt === 1,
    exempt_reason: row.exempt_reason,
    auto_renew_enabled: row.auto_renew_enabled === 1,
    last_billing_cycle_months: row.last_billing_cycle_months,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function extractInsertId(inserted: unknown): number {
  const first = Array.isArray(inserted) ? inserted[0] : inserted;
  if (typeof first === 'object' && first !== null) {
    return Number((first as { id: number }).id);
  }
  return Number(first);
}
