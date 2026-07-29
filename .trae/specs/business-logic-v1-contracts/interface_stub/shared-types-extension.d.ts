/**
 * shared-types-extension.d.ts — 共享类型扩展（v1 实施）
 *
 * 本文件声明新增的共享类型，待落位时合并到 public/interface_stub/shared-types.d.ts。
 * 与既有类型保持一致的命名约定：
 *   - server_id / user_id 统一 string (UUID)
 *   - 时间戳统一 string (ISO 8601)
 *   - 乐观锁状态字段使用字面量联合类型
 *   - 错误码与 error-codes-extension.json 对齐
 */

// ============================================================================
// 一、新增字面量类型
// ============================================================================

/** 实例过期状态机（server-schema.json expiry_status 字段） */
export type InstanceExpiryStatus =
  | 'permanent' // 永久实例（默认）
  | 'active' // 有效期内
  | 'grace' // 宽限期内（已停止但可续费）
  | 'expired' // 已过期（待清理）
  | 'cleaned'; // 已清理磁盘

/** VIP 类型分层（user_instance_bindings.vip_type 字段） */
export type VipType = 'permanent' | 'monthly' | 'quarterly' | 'yearly';

/** 充值 CDK 状态机（recharge-cdks-schema.json status 字段） */
export type RechargeCdkStatus = 'unused' | 'claiming' | 'used' | 'expired';

/** 退款申请状态机（wallet-refund-orders-schema.json status 字段） */
export type RefundOrderStatus =
  | 'pending' // 待审批
  | 'approved' // 已批准（待执行退款）
  | 'rejected' // 已拒绝
  | 'completed' // 已完成（点券已退回）
  | 'cancelled'; // 已撤销（用户主动撤销）

/** 用户优惠券状态机（user-coupons-schema.json status 字段） */
export type UserCouponStatus = 'unused' | 'used' | 'expired';

/** 优惠券折扣类型（coupons-schema.json discount_type 字段） */
export type CouponDiscountType = 'percent' | 'fixed';

/** 优惠券适用范围（coupons-schema.json scope 字段） */
export type CouponScope = 'global' | 'server' | 'item';

/** 续费类型（instance-renewals-schema.json renewal_type 字段） */
export type InstanceRenewalType = 'manual' | 'gift';

/** 积分来源（vipPointService.addPoints source 参数） */
export type PointsSource = 'purchase' | 'checkin' | 'cdk_redeem' | 'admin_adjust';

// ============================================================================
// 二、新增实体类型（对应 JSON Schema）
// ============================================================================

/** instance_renewals 表记录（instance-renewals-schema.json） */
export interface InstanceRenewal {
  id: number;
  instance_id: string;
  user_id: string;
  duration_days: number;
  amount_paid: number;
  base_amount: number;
  tier_discount_applied: number;
  vip_discount_applied: number;
  vip_level_at_renewal: number;
  renewal_type: InstanceRenewalType;
  use_wallet: boolean;
  old_expires_at: string | null;
  new_expires_at: string | null;
  renewed_at: string;
}

/** recharge_cdks 表记录（recharge-cdks-schema.json） */
export interface RechargeCdk {
  id: number;
  code: string;
  face_value: number;
  batch_id: number;
  status: RechargeCdkStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  claiming_locked_at: string | null;
  expires_at: string;
  created_by: string;
  created_at: string;
}

/** recharge_cdk_batches 表记录（recharge-cdk-batches-schema.json） */
export interface RechargeCdkBatch {
  id: number;
  batch_name: string;
  batch_description: string | null;
  total_count: number;
  used_count: number;
  face_value: number;
  total_face_value: number;
  expires_at: string;
  status: 'active' | 'archived';
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

/** wallet_refund_orders 表记录（wallet-refund-orders-schema.json） */
export interface WalletRefundOrder {
  id: number;
  user_id: string;
  server_id: string;
  order_id: number | null;
  amount: number;
  reason: string;
  admin_note: string | null;
  status: RefundOrderStatus;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  completed_at: string | null;
}

/** wallet_daily_snapshots 表记录（wallet-daily-snapshots-schema.json） */
export interface WalletDailySnapshot {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  snapshot_date: string; // YYYY-MM-DD
  snapshot_at: string;
}

/** coupons 表记录（coupons-schema.json） */
export interface Coupon {
  id: number;
  code: string;
  display_name: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
  valid_from: string;
  valid_until: string;
  usage_limit: number | null;
  used_count: number;
  scope: CouponScope;
  scope_id: string | null;
  created_by: string;
  created_at: string;
}

/** user_coupons 表记录（user-coupons-schema.json） */
export interface UserCoupon {
  id: number;
  user_id: string;
  coupon_id: number;
  server_id: string | null;
  status: UserCouponStatus;
  claimed_at: string;
  used_at: string | null;
  order_id: number | null;
}

/** user_vip_points 表记录（user-vip-points-schema.json） */
export interface UserVipPoints {
  id: number;
  user_id: string;
  server_id: string;
  points: number;
  total_earned: number;
  last_checkin_at: string | null;
  last_checkin_date: string | null;
  last_upgrade_at: string | null;
  highest_vip_level: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 二·补、既有实体类型首次纳入契约（B-NEW-1 修复）
// ============================================================================
// 以下类型在既有 impl 已使用但从未在 public/interface_stub 声明，
// 本次 v1 契约首次纳入。落位时合并到 public/interface_stub/shared-types.d.ts。
// 字段定义与 panel/backend/src/services/walletService.ts / quotaService.ts
// 及 public/schema/panel-api-types.ts 完全对齐。

/** 配额作用域类型（与 panel-api-types.ts QuotaScopeType 对齐） */
export type QuotaScopeType = 'role' | 'user';

/** user_wallets 表记录（user-wallets-schema.json，DB 行类型） */
export interface UserWallet {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  last_daily_claim_at: string | null;
  last_daily_claim_date: string | null;
  created_at: string;
  updated_at: string;
}

/** 钱包信息（含 can_claim_daily 状态 + daily_reward_amount，与 panel-api-types.ts WalletInfo 对齐） */
export interface WalletInfo {
  id: number;
  user_id: string;
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  last_daily_claim_at: string | null;
  last_daily_claim_date: string | null;
  can_claim_daily: boolean;
  daily_reward_amount: number;
}

/** resource_quotas 表记录（与 panel-api-types.ts ResourceQuota 对齐） */
export interface ResourceQuota {
  id: string;
  scope_type: QuotaScopeType;
  scope_id: string;
  max_instances: number | null;
  max_disk_mb: number | null;
  max_players_total: number | null;
  created_at: string;
  updated_at: string;
}

/** 用户当前用量（与 panel-api-types.ts QuotaUsage 对齐） */
export interface QuotaUsage {
  user_id: string;
  instances_used: number;
  disk_used_mb: number;
  players_online: number;
}

/** 配额预警结果（v1 新增 DTO，quotaService.getQuotaAlerts 返回） */
export interface QuotaAlertResult {
  user_id: string;
  alerts: Array<{
    resource_type: 'instances' | 'disk' | 'players';
    used: number;
    limit: number | null; // null=不限
    percent: number; // 0-100，limit=null 时为 0
    level: 'warning' | 'critical';
  }>;
  has_alerts: boolean;
}

// ============================================================================
// 三、服务调用 DTO 类型
// ============================================================================

/** 创建充值 CDK 批次输入（rechargeCdkService.createBatch） */
export interface RechargeCdkCreateBatchInput {
  batch_name: string;
  batch_description?: string | null;
  total_count: number;
  face_value: number;
  expires_at: string;
}

/** 充值 CDK 列表查询过滤（rechargeCdkService.listBatches） */
export interface RechargeCdkListFilter {
  status?: 'active' | 'archived';
  created_after?: string;
  created_before?: string;
}

/** 到期扫描结果统计（instanceExpiryService 调度任务返回） */
export interface ExpiryScanResult {
  scanned: number;
  processed: number;
  notified: number;
  errors: number;
  error_details?: Array<{ server_id: string; reason: string }>;
}

/** 到期处置配置（instanceExpiryService.getExpiryConfig） */
export interface ExpiryConfig {
  reminder_days_before: number[];
  grace_days: number;
  retention_days: number;
  stop_on_expire: boolean;
  cleanup_disk_after_retention: boolean;
  scan_interval_hours: number;
}

// ============================================================================
// 四、新增错误类（与 error-codes-extension.json 对齐）
// ============================================================================

export class WalletNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletNotFoundError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export class RechargeCdkInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkInvalidError';
  }
}

export class RechargeCdkAlreadyRedeemedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkAlreadyRedeemedError';
  }
}

export class RechargeCdkExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkExpiredError';
  }
}

export class RechargeCdkBatchNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkBatchNotFoundError';
  }
}

export class RechargeCdkBatchCreateFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RechargeCdkBatchCreateFailedError';
  }
}

export class BindingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingNotFoundError';
  }
}

export class RefundOrderNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundOrderNotFoundError';
  }
}

export class RefundOrderNotPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundOrderNotPendingError';
  }
}

export class OrderNotRefundableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderNotRefundableError';
  }
}

export class CouponInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponInvalidError';
  }
}

export class CouponAlreadyClaimedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponAlreadyClaimedError';
  }
}

export class CouponUsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponUsageLimitExceededError';
  }
}

export class CouponNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponNotApplicableError';
  }
}

export class InstanceNotRenewableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceNotRenewableError';
  }
}

export class InstanceExpiryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceExpiryConfigError';
  }
}

export class VipPointsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VipPointsConfigError';
  }
}

/** VIP 等级升级失败（无 active 绑定记录等，对应 VIP_LEVEL_UPGRADE_FAILED） */
export class VipLevelUpgradeFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VipLevelUpgradeFailedError';
  }
}

/** 今日已签到（防重，对应 VIP_CHECKIN_ALREADY_TODAY） */
export class CheckinAlreadyTodayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckinAlreadyTodayError';
  }
}

// ----- 以下为 B-NEW-1 / S-NEW-2 修复：补齐 Error 类声明 -----
// - DailyRewardAlreadyClaimedError：既有 impl errors.ts:507 已用，本次首次纳入契约
// - RefundAmountExceedsLimitError / QuotaLimitReachedError / QuotaConfigError：v1 新增契约类（impl 待实现）

/** 今日已领取每日奖励（既有 impl errors.ts:507 已用，本次首次纳入契约） */
export class DailyRewardAlreadyClaimedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyRewardAlreadyClaimedError';
  }
}

/** 退款金额超限（amount > system_config.wallet.refund_max_amount） */
export class RefundAmountExceedsLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundAmountExceedsLimitError';
  }
}

/** 配额已达上限（max_instances / max_disk_mb / max_players_total） */
export class QuotaLimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaLimitReachedError';
  }
}

/** 配额配置错误（vip.quota_overrides JSON 解析失败等） */
export class QuotaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaConfigError';
  }
}

/** VipLevel 类型别名（0-5） */
export type VipLevel = 0 | 1 | 2 | 3 | 4 | 5;
