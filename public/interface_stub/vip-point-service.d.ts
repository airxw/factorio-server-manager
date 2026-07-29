/**
 * vip-point-service.d.ts — vipPointService 接口存根
 *
 * 职责：VIP 积分管理 / 签到 / 积分达标自动升级 VIP 等级
 * 数据契约：public/schema/user-vip-points-schema.json
 * 来源：docs/plans/business-logic-system-completion-plan.md §3.1 步骤 4（决策 V1 引入积分制）
 *
 * 积分规则（决策 V1）：
 *   - 每消费 1 点券 = 1 积分（shopService.createOrder 成功后埋点）
 *   - 每日签到 = +10 积分（与 walletService.claimDailyReward 联动）
 *   - CDK 兑换 = +5 积分（cdkService.redeem 成功后埋点）
 *
 * 升级规则：
 *   - 积分达标自动升级 VIP 等级（checkAndUpgradeVip）
 *   - 积分→VIP 等级映射：vip.points_thresholds（system_config）
 *   - 默认：{ '1': 100, '2': 500, '3': 2000, '4': 8000, '5': 30000 }
 *   - 积分只升不降（避免退款/到期产生负向体验）
 *   - 降级仍由 user_instance_bindings.vip_expires_at 控制（与积分解耦）
 *
 * 调度任务：VIP_POINTS_CHECK（每 6 小时批量检查升级，推荐 cron 表达式：`0 0,6,12,18 * * *`）
 */

import type { UserVipPoints, VipLevel, PointsSource } from './shared-types';
import {
  BindingNotFoundError,
  VipPointsConfigError,
  VipLevelUpgradeFailedError,
  CheckinAlreadyTodayError,
} from './shared-types';

export interface VipPointService {
  /**
   * 增加积分（埋点调用，幂等性由调用方保证）。
   *
   * 使用场景：
   *   - shopService.createOrder 成功后：addPoints(userId, serverId, total_price, 'purchase')
   *   - walletService.claimDailyReward 成功后：addPoints(userId, serverId, 10, 'checkin')
   *   - cdkService.redeem 成功后：addPoints(userId, serverId, 5, 'cdk_redeem')
   *
   * @param userId 用户 ID
   * @param serverId 实例 ID（积分按实例作用域独立计算）
   * @param points 增加的积分（正整数）
   * @param source 积分来源（purchase/checkin/cdk_redeem/admin_adjust）
   * @returns 更新后的积分记录
   * @throws {BindingNotFoundError} 无 active 绑定记录（需先绑定实例）
   */
  addPoints(
    userId: string,
    serverId: string,
    points: number,
    source: PointsSource,
  ): Promise<UserVipPoints>;

  /**
   * 查询用户积分（GET /api/vip/points）。
   * @returns 积分记录（含 points / total_earned / highest_vip_level / 当前 VIP 等级进度）
   */
  getPoints(userId: string, serverId: string): Promise<UserVipPoints | null>;

  /**
   * 每日签到（POST /api/vip/checkin）。
   * 流程：
   *   1. 校验今日未签到（last_checkin_date != today）
   *   2. 调用 walletService.claimDailyReward 领取每日点券（VIP 等级决定金额）
   *   3. addPoints(userId, serverId, 10, 'checkin')
   *   4. 更新 last_checkin_at / last_checkin_date
   * @returns 签到结果（含领取点券数 + 积分增加数）
   * @throws {BindingNotFoundError} 无 active 绑定记录
   * @throws {CheckinAlreadyTodayError} 今日已签到（防重）
   */
  checkin(
    userId: string,
    serverId: string,
  ): Promise<{ points_earned: number; wallet_credited: number; new_total_points: number }>;

  /**
   * 检查并升级 VIP 等级（调度任务 VIP_POINTS_CHECK，每 6 小时）。
   * 流程：
   *   1. 扫描所有 user_vip_points 记录
   *   2. 对每条记录，根据 points 匹配 vip.points_thresholds，计算应达 VIP 等级
   *   3. 若应达等级 > 当前 user_instance_bindings.vip_level → 调用 vipService.setVipLevel 升级
   *   4. 更新 user_vip_points.highest_vip_level / last_upgrade_at
   *   5. 发送升级通知（复用 notificationService）
   * @returns 升级结果统计
   * @throws {VipLevelUpgradeFailedError} 单条升级失败（无 active 绑定记录等，调度任务内捕获并记入 errors 不中断）
   */
  checkAndUpgradeVip(): Promise<{ upgraded_count: number; details: Array<{ user_id: string; server_id: string; old_level: number; new_level: number }> }>;

  /**
   * 查询积分→VIP 等级映射配置（GET /api/vip/points-thresholds）。
   * 从 system_config.vip.points_thresholds 读取。
   * @returns 阈值映射对象（如 { '1': 100, '2': 500, '3': 2000, '4': 8000, '5': 30000 }）
   */
  getPointsThresholds(): Promise<Record<string, number>>;

  /**
   * 查询用户当前 VIP 等级进度（前端 VIP 权益页用）。
   * @returns 当前等级 / 当前积分 / 下一等级阈值 / 升级进度百分比
   */
  getVipProgress(
    userId: string,
    serverId: string,
  ): Promise<{
    current_level: number;
    current_points: number;
    next_level: number | null; // null=已满级（VIP5）
    next_level_threshold: number | null;
    progress_percent: number; // 0-100
  }>;
}

export {
  BindingNotFoundError,
  VipPointsConfigError,
  VipLevelUpgradeFailedError,
  CheckinAlreadyTodayError,
} from './shared-types';
