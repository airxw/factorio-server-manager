// ============================================================================
// InstanceBilling API 领域切片 — VPS 式预付费实例计费
// 路由前缀：/api/admin/instance-billing（在 routes-registry.ts 挂载）
// PanelApiClient 通过 extends 组合各领域接口
// ============================================================================

import type {
  InstanceType,
  BillingCycleMonths,
  InstanceTypePricing,
  InstanceBillingSettings,
  InstanceRenewal,
  BillingExemptReason,
} from '@public/interface_stub/shared-types';

/** GET /api/admin/instance-billing/types 响应体 */
export interface ListInstanceTypePricingsResponse {
  types: InstanceTypePricing[];
}

/** POST /api/admin/instance-billing/types 请求体（仅 server_admin） */
export interface UpsertInstanceTypePricingRequest {
  instance_type: InstanceType;
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
}

export interface UpsertInstanceTypePricingResponse {
  pricing: InstanceTypePricing;
}

/** GET /api/admin/instance-billing/preview 响应体 */
export interface BillingAmountPreview {
  monthly_price_effective: number;
  billing_cycle_months: BillingCycleMonths;
  cycle_discount_applied: number;
  duration_days: number;
  base_amount: number;
  amount: number;
}

export interface PreviewBillingAmountResponse {
  preview: BillingAmountPreview;
}

/** GET /api/admin/instance-billing/settings/:instance_id 响应体 */
export interface GetInstanceBillingSettingsResponse {
  settings: InstanceBillingSettings;
}

/** PUT /api/admin/instance-billing/settings/:instance_id 请求体 */
export interface UpdateInstanceBillingSettingsRequest {
  instance_type?: InstanceType;
  custom_monthly_price?: number | null;
  billing_exempt?: boolean;
  exempt_reason?: BillingExemptReason | null;
  auto_renew_enabled?: boolean;
}

export interface UpdateInstanceBillingSettingsResponse {
  settings: InstanceBillingSettings;
}

/** POST /api/admin/instance-billing/renew/:instance_id 请求体 */
export interface RenewInstanceRequest {
  billing_cycle_months: BillingCycleMonths;
}

export interface RenewInstanceResponse {
  renewal: {
    renewal: InstanceRenewal;
    amount_paid: number;
    exempt: boolean;
    exempt_reason: BillingExemptReason | null;
    new_expires_at: string;
  };
}

/** GET /api/admin/instance-billing/:instance_id/renewals 响应体 */
export interface ListInstanceRenewalsResponse {
  renewals: InstanceRenewal[];
}

/**
 * 实例计费 API 切片
 * - 类型定价查询：任意已登录用户可读（前端创建实例时展示价格）
 * - 类型定价写操作：仅 server_admin（路由层校验）
 * - 计费设置/续费/记录：腐竹可操作自己的实例，admin 可操作任意（路由层校验）
 */
export interface InstanceBillingApi {
  /** 查询所有生效类型定价（创建实例时展示价格卡片） */
  listInstanceTypePricings(): Promise<ListInstanceTypePricingsResponse>;
  /** 创建/更新类型定价（仅 server_admin） */
  upsertInstanceTypePricing(
    req: UpsertInstanceTypePricingRequest,
  ): Promise<UpsertInstanceTypePricingResponse>;
  /** 归档类型定价（仅 server_admin） */
  archiveInstanceTypePricing(instanceType: InstanceType): Promise<void>;
  /** 金额预览（创建实例/续费时实时预览价格） */
  previewBillingAmount(
    instanceType: InstanceType,
    billingCycleMonths: BillingCycleMonths,
    customMonthlyPrice?: number | null,
  ): Promise<PreviewBillingAmountResponse>;
  /** 获取实例计费设置 */
  getInstanceBillingSettings(instanceId: string): Promise<GetInstanceBillingSettingsResponse>;
  /** 更新实例计费设置 */
  updateInstanceBillingSettings(
    instanceId: string,
    req: UpdateInstanceBillingSettingsRequest,
  ): Promise<UpdateInstanceBillingSettingsResponse>;
  /** 手动续费实例 */
  renewInstance(
    instanceId: string,
    req: RenewInstanceRequest,
  ): Promise<RenewInstanceResponse>;
  /** 查询实例续费记录 */
  listInstanceRenewals(
    instanceId: string,
    limit?: number,
  ): Promise<ListInstanceRenewalsResponse>;
}
