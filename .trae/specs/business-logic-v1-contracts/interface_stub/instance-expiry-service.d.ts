/**
 * instance-expiry-service.d.ts — instanceExpiryService 接口存根
 *
 * 职责：实例有效期管理 / 到期扫描 / 宽限期处理 / 续费 / 磁盘清理
 * 数据契约：
 *   - public/schema/server-schema.json（servers.expires_at / expiry_status / expiry_grace_until）
 *   - public/schema/instance-renewals-schema.json（续费记录）
 * 来源：docs/plans/business-logic-system-completion-plan.md §5.1（核心体系）
 *       决策 V4：到期策略全参数系统管理员可配（system_config.instance.expiry.*）
 *       决策 V5：不引入试用实例
 *       决策 V6：续费定价全可配（pack.business.instance.pricing.* + vip.renewal_discount_levels）
 *
 * 调度任务注册（在 scheduler.ts）：
 *   - INSTANCE_EXPIRY_SCAN (cron '0 * * * *')：每小时扫描
 *   - INSTANCE_GRACE_CLEANUP (cron '0 3 * * *')：每日 3 点清理宽限期
 *   - INSTANCE_DISK_CLEANUP (cron '0 4 * * *')：每日 4 点清理磁盘
 *   - INSTANCE_EXPIRY_REMINDER (cron '0 9 * * *')：每日 9 点发送提醒
 */

import type {
  InstanceExpiryStatus,
  InstanceRenewal,
  InstanceRenewalType,
  ExpiryScanResult,
  ExpiryConfig,
} from './shared-types';
import {
  InstanceNotFoundError,
  InstanceNotRenewableError,
  InsufficientBalanceError,
  InstanceExpiryConfigError,
} from './shared-types';

export interface InstanceExpiryService {
  /**
   * 创建实例时设置有效期。
   * 由 servers.ts POST /api/servers 调用（接收 duration_days 参数）。
   * @param serverId 实例 ID
   * @param durationDays 有效期天数。null=永久（expires_at=NULL, expiry_status='permanent'）
   * @throws {InstanceNotFoundError} 实例不存在
   */
  setInstanceExpiry(serverId: string, durationDays: number | null): Promise<void>;

  /**
   * 查询实例有效期状态（GET /api/servers/:id/expiry）。
   * @returns 含 expires_at / expiry_status / expiry_grace_until / days_remaining
   * @throws {InstanceNotFoundError} 实例不存在
   */
  getInstanceExpiry(
    serverId: string,
  ): Promise<{
    expires_at: string | null;
    expiry_status: InstanceExpiryStatus;
    expiry_grace_until: string | null;
    days_remaining: number | null; // null=永久；正数=剩余天数；负数=已过期 |days| 天
  }>;

  /**
   * 扫描即将到期的实例（调度任务 INSTANCE_EXPIRY_SCAN，每小时）。
   * 触发条件：expires_at < now + 3day 且 expiry_status='active'
   * 动作：发送站内信提醒（复用 notificationService）
   * @returns 扫描结果统计
   */
  scanExpiringInstances(): Promise<ExpiryScanResult>;

  /**
   * 处理已到期实例（调度任务 INSTANCE_EXPIRY_SCAN 内部调用）。
   * 触发条件：expires_at < now 且 expiry_status='active'
   * 动作：
   *   1. 调用 daemon stop 停止实例
   *   2. 更新 expiry_status='grace'，设置 expiry_grace_until = now + grace_days
   *   3. 发送"已过期进入宽限期"通知
   * @returns 处理结果统计
   */
  processExpiredInstances(): Promise<ExpiryScanResult>;

  /**
   * 处理宽限期结束的实例（调度任务 INSTANCE_GRACE_CLEANUP，每日 3 点）。
   * 触发条件：expiry_grace_until < now 且 expiry_status='grace'
   * 动作：
   *   1. 更新 expiry_status='expired'
   *   2. 发送"宽限期结束，即将清理"通知（提前 1 天）
   * @returns 处理结果统计
   */
  processGraceExpiredInstances(): Promise<ExpiryScanResult>;

  /**
   * 清理已过期超 retention_days 的实例磁盘（调度任务 INSTANCE_DISK_CLEANUP，每日 4 点）。
   * 触发条件：expiry_status='expired' 且 expired_at < now - retention_days
   * 动作：
   *   1. 调用 safeRemoveService 清理磁盘（路径白名单校验）
   *   2. 更新 expiry_status='cleaned'
   *   3. 写入 audit_logs（事件类型 INSTANCE_DISK_CLEANED）
   * @returns 处理结果统计（含 freed_bytes）
   */
  cleanupExpiredInstances(): Promise<ExpiryScanResult & { freed_bytes: number }>;

  /**
   * 发送到期前提醒（调度任务 INSTANCE_EXPIRY_REMINDER，每日 9 点）。
   * 提醒天数由 system_config.instance.expiry.reminder_days_before 配置（默认 [7, 3, 1]）。
   * @returns 发送提醒数量
   */
  sendExpiryReminders(): Promise<{ reminders_sent: number }>;

  /**
   * 续费实例（POST /api/servers/:id/renew）。
   *
   * 流程（决策 V6 全可配定价）：
   *   1. 校验实例 expiry_status ∈ {active, grace, expired}（cleaned 不可续费）
   *   2. 计算续费金额：
   *      - base_amount = daily_price × duration_days（来自 pack.business.instance.pricing）
   *      - tier_discount = 匹配 tier_discounts（未匹配则 1.0）
   *      - vip_discount = 匹配 vip.renewal_discount_levels（按用户 VIP 等级，未匹配则 1.0）
   *      - amount_paid = round(base_amount × tier_discount × vip_discount)
   *   3. 若 use_wallet=true 且 amount_paid > 0：调用 walletService.debit 扣款
   *   4. 更新 servers.expires_at = max(now, old_expires_at) + duration_days
   *   5. 重置 expiry_status='active'，清空 expiry_grace_until
   *   6. 写入 instance_renewals 审计记录
   *   7. 写入 audit_logs（事件类型 INSTANCE_RENEWED）
   *
   * @param serverId 实例 ID
   * @param userId 续费操作发起者
   * @param durationDays 续费天数（7/30/90/365/36500，36500 视为永久）
   * @param useWallet 是否从钱包扣款（false=仅 gift 类型，需管理员权限）
   * @returns 续费记录（含新旧过期时间、扣款金额、折扣明细）
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {InstanceNotRenewableError} expiry_status='cleaned' 不可续费
   * @throws {InsufficientBalanceError} 钱包余额不足
   */
  renewInstance(
    serverId: string,
    userId: string,
    durationDays: number,
    useWallet: boolean,
  ): Promise<InstanceRenewal>;

  /**
   * 查询实例续费历史（GET /api/servers/:id/renewals）。
   * @param serverId 实例 ID
   * @returns 续费记录列表（按 renewed_at 降序）
   */
  listRenewals(serverId: string): Promise<InstanceRenewal[]>;

  /**
   * 获取到期处置配置（系统管理员可配）。
   * 从 system_config 读取 instance.expiry.* 配置项。
   * @returns 配置对象（含 grace_days / retention_days / reminder_days_before 等）
   */
  getExpiryConfig(): Promise<ExpiryConfig>;
}

export {
  InstanceNotFoundError,
  InstanceNotRenewableError,
  InsufficientBalanceError,
  InstanceExpiryConfigError,
} from './shared-types';
