/**
 * quota-service.d.ts — quotaService 接口存根（完整契约，含既有方法 + v1 新增方法）
 *
 * 职责：资源配额管理 / VIP 派生配额 / 配额预警
 * 数据契约：public/schema/system-config-schema.json（resource_quotas 表 + system_config.vip.quota_overrides）
 * 来源：
 *   - 既有实现：panel/backend/src/services/quotaService.ts（v4.6.0 资源配额）
 *   - v1 扩展：docs/plans/business-logic-system-completion-plan.md §3.1 步骤 2、§6.1 步骤 1
 *
 * 配额优先级（v1 扩展，决策 A2/D3）：
 *   1. user 配额（resource_quotas WHERE scope_type='user'）
 *   2. role 配额（resource_quotas WHERE scope_type='role'）
 *   3. VIP 派生配额（system_config.vip.quota_overrides，按用户 VIP 等级匹配）
 *   4. 默认不限（null）
 *
 * 调度任务（v1 新增）：
 *   - QUOTA_ALERT_SCAN (cron '0 9 * * *')：每日 9 点扫描配额预警
 */

import type { ResourceQuota, QuotaUsage, QuotaAlertResult } from './shared-types';
import {
  QuotaLimitReachedError,
  QuotaConfigError,
} from './shared-types';

export interface QuotaService {
  // ===== 既有方法（v4.6.0 实现，本次首次发布契约） =====

  /**
   * 查询指定 scope 的配额。
   * @param scopeType 'role' | 'user'
   * @param scopeId role 名或 user_id
   * @returns 配额记录；不存在或表异常返回 null（即不限）
   */
  getQuota(
    scopeType: 'role' | 'user',
    scopeId: string,
  ): Promise<ResourceQuota | null>;

  /**
   * upsert 配额（不存在则 insert，存在则 update）。
   * @param scopeType 'role' | 'user'
   * @param scopeId role 名或 user_id
   * @param limits 可选限制字段（未提供的字段保持原值或 NULL）
   * @returns 更新后的配额记录
   * @throws {Error} QUOTA_UPDATE_FAILED 写入失败
   */
  setQuota(
    scopeType: 'role' | 'user',
    scopeId: string,
    limits: {
      max_instances?: number | null;
      max_disk_mb?: number | null;
      max_players_total?: number | null;
    },
  ): Promise<ResourceQuota>;

  /**
   * 获取用户生效配额（v1 扩展：增加 VIP 派生配额优先级）。
   *
   * 优先级（高 → 低）：
   *   1. user 配额（resource_quotas WHERE scope_type='user'）
   *   2. role 配额（resource_quotas WHERE scope_type='role'）
   *   3. VIP 派生配额（system_config.vip.quota_overrides，按用户 VIP 等级匹配）
   *   4. 默认不限（null）
   *
   * v1 签名扩展：增加 serverId + userRole 参数（用于查询用户 VIP 等级）。
   * 既有调用方需补传这两个参数（破坏性变更，但既有调用方数量有限，可在 v1 一次性迁移）。
   *
   * @param userId 用户 ID
   * @param serverId 实例 ID（v1 新增，用于查询用户 VIP 等级）
   * @param userRole 用户角色（v1 新增，用于 VIP 等级融合判定）
   * @returns 生效配额 + 来源标记；无任何配额记录返回 null
   */
  getEffectiveQuota(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<(ResourceQuota & { source: 'user' | 'role' | 'vip' | 'default' }) | null>;

  /**
   * 获取用户当前用量。
   * - instances_used: owner 实例数 + instance_admins 共管实例数（去重）
   * - disk_used_mb: owner + 共管实例的 disk_usage_bytes 求和 / 1024 / 1024
   * - players_online: 实时查询需调 daemon，简化返回 0
   */
  getUsage(userId: string): Promise<QuotaUsage>;

  /**
   * 校验是否可创建新实例。
   * @returns allowed=true 可创建；allowed=false 不可创建并附 reason
   */
  checkInstanceQuota(userId: string): Promise<{ allowed: boolean; reason?: string }>;

  /**
   * 校验是否可上传指定大小的文件。
   * @param additionalMb 额外需要的磁盘 MB
   * @returns allowed=true 可上传；allowed=false 不可上传并附 reason
   */
  checkDiskQuota(
    userId: string,
    additionalMb: number,
  ): Promise<{ allowed: boolean; reason?: string }>;

  // ===== v1 新增方法（VIP 派生配额 + 预警） =====

  /**
   * 查询配额预警（GET /api/quotas/alerts）。
   * percent ≥ warning_threshold（默认 80%）标记预警，
   * ≥ critical_threshold（默认 95%）标记严重预警。
   * 阈值由 system_config.quota.alerts.* 配置。
   */
  getQuotaAlerts(userId: string): Promise<QuotaAlertResult>;

  /**
   * 扫描配额预警并发送通知（调度任务 QUOTA_ALERT_SCAN，cron '0 9 * * *'）。
   * 对所有 percent ≥ warning_threshold 的用户发送站内信预警。
   * @returns 预警发送数量
   */
  scanQuotaAlerts(): Promise<{ alerts_sent: number }>;
}

export {
  QuotaLimitReachedError,
  QuotaConfigError,
} from './shared-types';
