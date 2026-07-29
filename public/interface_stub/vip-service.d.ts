/**
 * vip-service.d.ts — vipService 接口存根
 *
 * 职责：VIP 等级查询 / 品质校验 / 每日限额（按实例作用域，v3.2.0 同步）
 * 数据契约：public/schema/vip-permissions-schema.json（全局模板，0-5 级权限定义）
 *          user_instance_bindings 表（按实例的 vip_level + vip_expires_at）
 * 来源：scheme-final-merged.md §5.3 VIP 品质校验规则 / §7.1 P1
 *
 * v3.2.0 同步要点：
 * - VIP 等级按实例存储（user_instance_bindings），委托 instanceBindingService 读写
 * - server_admin / instance_admin+owner 在查询时融合为 VIP5
 * - getVipLevel/setVipLevel/checkDailyLimit 均需 serverId + userRole 参数
 * - vip_permissions 表为全局模板，不按实例区分
 * - 支持 vip_expires_at 过期机制
 */

import type { User, VipPermission, GamePack, ItemQuality } from './shared-types';
import { VipLevelInsufficientError, VipPermissionNotFoundError, BindingNotFoundError } from './shared-types';

export interface VipService {
  /**
   * 品质权限校验（同步纯函数，对应 scheme §5.3）。
   * 规则：
   *   - server_admin / instance_admin 不受限，直接返回 true
   *   - Pack 无品质概念（items.quality_tiers=0），跳过校验返回 true
   *   - VIP N 可购品质 tier ≤ N-1（qualities 数组索引）
   * @param user 当前用户（含 vip_level / role）
   * @param itemQuality 物品品质
   * @param pack 当前服务器关联的 GamePack
   * @returns true=允许购买；false=VIP 等级不足
   */
  checkQualityPermission(user: User, itemQuality: string, pack: GamePack): boolean;

  /**
   * 查询用户在某实例的 VIP 等级与到期时间（按实例作用域）。
   * 委托 instanceBindingService.getUserVipLevel（融合角色所有权 + 绑定记录）。
   * 内联过期检查：已过期的绑定记录视为 level 0（角色融合的最高等级不受影响）。
   * @param serverId 实例 ID
   * @param userRole 用户角色（用于角色融合判定）
   * @throws {UserNotFoundError} userId 不存在
   */
  getVipLevel(userId: string, serverId: string, userRole: string): Promise<{ level: number; expiresAt: string | null }>;

  /**
   * 设置用户在某实例的 VIP 等级（按实例作用域）。
   * @throws {BindingNotFoundError} 无 active 绑定记录
   */
  setVipLevel(userId: string, serverId: string, level: number): Promise<void>;

  /**
   * 设置用户在某实例的 VIP 等级（带过期时间）。
   * @param expiresAt 过期时间（ISO 字符串），null=永久
   * @throws {BindingNotFoundError} 无 active 绑定记录
   */
  setVipWithExpiry(userId: string, serverId: string, level: number, expiresAt?: string | null): Promise<void>;

  /**
   * 批量降级已过期的 VIP 记录（调度器周期调用）。
   * @returns 被降级的记录数
   */
  checkAndDowngradeExpiredVip(): Promise<{ downgraded: number }>;

  /**
   * 查询指定 VIP 等级的权限配置（max_quality / daily_limit / daily_reward_amount / permissions）。
   * @throws {VipPermissionNotFoundError} level 未配置
   */
  getVipPermissions(level: number): Promise<VipPermission>;

  /**
   * 列出全部 VIP 等级权限配置（0-5 级）。
   * v3.2.0: server_admin + instance_admin 均可查看。
   */
  listVipPermissions(): Promise<VipPermission[]>;

  /**
   * 查询用户在某实例的当日剩余购买次数（按实例统计）。
   */
  checkDailyLimit(
    userId: string,
    serverId: string,
    userRole: string,
  ): Promise<{ remaining: number; limit: number }>;

  /**
   * 设置用户在某实例的 VIP 等级（带类型，决策 V1/V3）。
   * 根据 vip_type 自动计算 vip_expires_at：
   *   - monthly → +30 天
   *   - quarterly → +90 天
   *   - yearly → +365 天
   *   - permanent → NULL（永久）
   *   - trial → 由"试用实例机制"另行控制（v1 不引入）
   *
   * @param vipType VIP 类型（permanent/monthly/quarterly/yearly）
   * @throws {BindingNotFoundError} 无 active 绑定记录
   */
  setVipWithType(
    userId: string,
    serverId: string,
    level: number,
    vipType: 'permanent' | 'monthly' | 'quarterly' | 'yearly',
  ): Promise<void>;

  /**
   * 查询 VIP 套餐类型列表（GET /api/vip/types）。
   * 返回 4 档套餐配置（月/季/年/永久），前端 VIP 开通页使用。
   * @returns 套餐列表（含 type / display_name / duration_days / 推荐价格）
   */
  listVipTypes(): Promise<Array<{
    type: 'permanent' | 'monthly' | 'quarterly' | 'yearly';
    display_name: string;
    duration_days: number | null; // null=永久
    recommended_price: number; // 建议售价（点券，由 system_config 配置）
  }>>;
}

export { VipLevelInsufficientError, VipPermissionNotFoundError, BindingNotFoundError } from './shared-types';
