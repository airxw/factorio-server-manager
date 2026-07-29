/**
 * admin-tier-service.d.ts — adminTierService 接口存根
 *
 * 职责：腐竹（instance_admin）等级查询 / 限额校验 / 高级功能判定 / 手动分配 / 自动升降级评估
 * 数据契约：
 *   - public/schema/admin-tiers-schema.json（等级配置表，tier 0-4 共 5 级）
 *   - public/schema/user-admin-tiers-schema.json（用户↔等级一对一关联主表）
 *   - public/schema/user-schema.json（users.admin_tier_id 查询加速冗余字段）
 * 来源：docs/plans/role-permission-economy-system-plan.md §2.2（决策 D1：不新增角色，叠加 admin_tier 维度）
 *
 * 设计要点：
 * - 与玩家 VIP（bindings.vip_level + vip_permissions）完全解耦，不复用
 * - user_admin_tiers 为主表（含 assigned_by/assigned_at/last_evaluated_at 审计字段）；
 *   users.admin_tier_id 为查询加速冗余，写入时同事务同步
 * - 新 instance_admin 用户默认 tier 1（基础腐竹）
 * - 升降级：自动（adminTierEvaluator 每日凌晨，近 30 天日均活跃玩家 + 月度分账流水双指标）+ 手动（server_admin）
 * - 降级超限处理：禁止创建新实例/新玩家绑定（已有保留），30 天未升级则冻结超额实例（不删除）
 *
 * 调度任务（见 scheduler.d.ts）：
 *   - ADMIN_TIER_EVALUATOR（每日凌晨）：自动评估全量 instance_admin 等级
 */

import type {
  AdminTier,
  AdminTierLevel,
  AdminAdvancedFeature,
  UserAdminTier,
} from './shared-types';
import {
  AdminTierNotFoundError,
  AdminTierLimitExceededError,
  AdminTierFeatureLockedError,
} from './shared-types';

/** 限额校验资源类型 */
export type AdminTierLimitResource = 'instances' | 'players_per_instance' | 'api_keys';

export interface AdminTierService {
  // ===== 等级查询 =====

  /**
   * 获取全部等级配置（5 条种子记录）。
   * GET /api/admin/tier/permissions（等级权益表，登录即可见）
   */
  listTiers(): Promise<AdminTier[]>;

  /**
   * 按 tier 值获取等级配置。
   * @throws {AdminTierNotFoundError} 等级配置不存在（migration 未初始化种子数据）
   */
  getTierByLevel(tier: AdminTierLevel): Promise<AdminTier>;

  /**
   * 获取用户当前腐竹等级（含关联记录）。
   * 读取路径：users.admin_tier_id（加速）→ 缺失时回退 user_admin_tiers 主表。
   * 非 instance_admin 用户返回 null。
   * GET /api/admin/tier（腐竹查自己）
   */
  getUserTier(userId: string): Promise<{ tier: AdminTier; association: UserAdminTier } | null>;

  // ===== 限额校验（供 instanceService / bindingService / apiKeyService 调用） =====

  /**
   * 校验资源是否超限额。
   * @param userId 腐竹用户 ID
   * @param resource 资源类型
   * @param requested 请求增量（如新建 1 个实例 → 1）
   * @returns { allowed, used, limit } limit=null 表示不限
   * @throws {AdminTierNotFoundError} 等级配置缺失
   */
  checkLimit(
    userId: string,
    resource: AdminTierLimitResource,
    requested?: number,
  ): Promise<{ allowed: boolean; used: number; limit: number | null }>;

  /**
   * 断言资源未超限（超限时抛错，供写路径直接调用）。
   * @throws {AdminTierLimitExceededError} 超上限（HTTP 429）
   */
  assertLimit(userId: string, resource: AdminTierLimitResource, requested?: number): Promise<void>;

  /**
   * 判定高级功能是否解锁。
   * @throws {AdminTierFeatureLockedError} 未解锁（HTTP 403）
   */
  assertFeature(userId: string, feature: AdminAdvancedFeature): Promise<void>;

  /**
   * 获取资源费折扣系数（供 adminWalletService.renewOwnInstance 折扣链调用）。
   * 非 instance_admin 用户返回 1.0（无折扣）。
   */
  getResourceFeeDiscount(userId: string): Promise<number>;

  // ===== 等级分配与评估 =====

  /**
   * 手动分配/调整腐竹等级（POST /api/admin/admin-tiers/assign，仅 server_admin）。
   * 流程：
   *   1. UPSERT user_admin_tiers（assigned_by=operatorId, assigned_at=now）
   *   2. 同事务同步 users.admin_tier_id 冗余字段
   *   3. 写 audit_logs
   * 降级超限处理：不删除既有实例/玩家，仅限制新增（见 checkLimit）
   * @throws {AdminTierNotFoundError} 目标等级配置不存在
   */
  assignTier(userId: string, tier: AdminTierLevel, operatorId: string): Promise<UserAdminTier>;

  /**
   * 自动评估单个用户等级（adminTierEvaluator 调用，也可手动触发复评）。
   * 指标：近 30 天日均活跃玩家数 + 月度分账流水（双指标，阈值由配置契约 economy.config 提供）。
   * 规则：
   *   - 升级：达到阈值立即生效
   *   - 降级：连续 30 天未活跃 → 降一级（最低 tier 0）；欠费超 7 天 → 降一级
   *   - 自动评估写 user_admin_tiers（assigned_by=null, last_evaluated_at=now）
   * @returns { old_tier, new_tier, changed, reason }
   */
  evaluateUserTier(
    userId: string,
  ): Promise<{ old_tier: AdminTierLevel; new_tier: AdminTierLevel; changed: boolean; reason: string }>;

  /**
   * 自动评估全量 instance_admin（调度任务 ADMIN_TIER_EVALUATOR，每日凌晨）。
   * @returns 评估统计
   */
  evaluateAllTiers(): Promise<{ evaluated: number; upgraded: number; downgraded: number; errors: number }>;
}

export {
  AdminTierNotFoundError,
  AdminTierLimitExceededError,
  AdminTierFeatureLockedError,
} from './shared-types';
