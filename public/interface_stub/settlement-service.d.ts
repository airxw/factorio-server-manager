/**
 * settlement-service.d.ts — settlementService 接口存根
 *
 * 职责：分账规则配置与匹配 / 异步分账结算 / 冻结期满释放 / 退款冲正
 * 数据契约：
 *   - public/schema/settlement-rules-schema.json（分账规则配置表）
 *   - public/schema/settlement-records-schema.json（分账结算记录表）
 *   - public/schema/admin-wallets-schema.json（pending_balance 入账目标）
 * 来源：docs/plans/role-permission-economy-system-plan.md §4.2（决策 D2：仅平台收钱再分账，不新建腐竹直充通道）
 *
 * 设计要点：
 * - 资金路径：玩家消费（shop_orders / instance_renewals, wallet_source=user_wallets）→ 平台收款 → 按规则分账给腐竹
 * - 规则匹配：按优先级取最高（instance+tier > game_type+tier > global+tier > instance > game_type > global）；
 *   未匹配默认 platform_share=1.0（不分账）
 * - 冻结期：分账先入 pending_balance，T+7（settlement_delay_hours，默认 168h）后释放到 balance
 * - 规则快照：写入 settlement_records.rule_snapshot，防规则后续修改导致追溯失真
 * - 退款冲正：优先扣 pending_balance（未释放），再扣 balance（已释放），不足记 owed_amount 由后续分账自动抵扣（最多 30 天）
 * - 幂等：settlementRunner 重复扫描不得重复入账（source_type+source_ref 唯一约束）
 *
 * 调度任务（见 scheduler.d.ts）：
 *   - SETTLEMENT_RUNNER（每小时）：扫描已结算订单，匹配规则写入 pending_balance
 *   - PENDING_BALANCE_RELEASER（每小时）：扫描冻结期满记录，迁移 pending_balance → balance
 */

import type {
  SettlementRule,
  SettlementRecord,
  SettlementRecordStatus,
  SettlementRuleMatch,
  SettlementScopeType,
  AdminTierLevel,
} from './shared-types';
import {
  SettlementRuleNotFoundError,
  SettlementRuleInvalidError,
  SettlementRecordNotFoundError,
} from './shared-types';

/** 分账规则创建/更新输入（仅 server_admin） */
export interface SettlementRuleInput {
  rule_name: string;
  scope_type: SettlementScopeType;
  scope_ref?: string | null;
  admin_tier?: AdminTierLevel | null;
  platform_share: number;
  admin_share: number;
  min_settlement_amount?: number;
  settlement_delay_hours?: number;
  effective_from: string;
  effective_until?: string | null;
  priority?: number;
}

export interface SettlementService {
  // ===== 规则配置（仅 server_admin） =====

  /**
   * 创建分账规则（POST /api/admin/settlement-rules）。
   * 校验：platform_share + admin_share = 1.0（允许 ±0.0001 浮点误差）；比例 ∈ [0,1]；effective_until > effective_from。
   * @throws {SettlementRuleInvalidError} 规则非法（HTTP 400）
   */
  createRule(input: SettlementRuleInput, operatorId: string): Promise<SettlementRule>;

  /**
   * 更新分账规则（PUT /api/admin/settlement-rules/:id）。
   * 注意：仅影响新结算记录；既有 settlement_records.rule_snapshot 不变（审计追溯）。
   * @throws {SettlementRuleNotFoundError} 规则不存在
   * @throws {SettlementRuleInvalidError} 规则非法
   */
  updateRule(ruleId: number, input: Partial<SettlementRuleInput>, operatorId: string): Promise<SettlementRule>;

  /**
   * 查询规则列表（server_admin 查全部；instance_admin 只读适用自己的规则）。
   */
  listRules(filter?: {
    scope_type?: SettlementScopeType;
    admin_tier?: AdminTierLevel;
    active_only?: boolean;
  }): Promise<SettlementRule[]>;

  /**
   * 匹配适用规则（内部方法，settlementRunner / 试算接口调用）。
   * 匹配算法（按优先级从高到低）：
   *   1. scope_type=instance + scope_ref=实例ID + admin_tier=等级
   *   2. scope_type=game_type + scope_ref=游戏类型 + admin_tier=等级
   *   3. scope_type=global + admin_tier=等级
   *   4. scope_type=instance + scope_ref=实例ID（不限等级）
   *   5. scope_type=game_type + scope_ref=游戏类型（不限等级）
   *   6. scope_type=global（不限等级）
   * 未匹配：rule=null, platform_share=1.0, admin_share=0（不分账给腐竹）
   */
  matchRule(instanceId: string, gameType: string, adminTier: AdminTierLevel | null): Promise<SettlementRuleMatch>;

  // ===== 结算执行 =====

  /**
   * 分账结算扫描（调度任务 SETTLEMENT_RUNNER，每小时）。
   * 流程：
   *   1. 扫描未分账的 shop_orders / instance_renewals（wallet_source=user_wallets 且 amount_paid>0）
   *   2. 定位实例归属腐竹（servers.owner_user_id）
   *   3. matchRule 计算分成（低于 min_settlement_amount 累计到下次）
   *   4. 写 settlement_records（status=pending + rule_snapshot）
   *   5. adminWalletService.creditPending 入账冻结余额（先抵扣 owed_amount）
   * 幂等：source_type+source_ref 唯一约束，重复扫描跳过
   * @returns 结算统计
   */
  runSettlement(): Promise<{ scanned: number; settled: number; skipped: number; accumulated: number; errors: number }>;

  /**
   * 冻结期满释放（调度任务 PENDING_BALANCE_RELEASER，每小时）。
   * 流程：
   *   1. 扫描 settlement_records.status='pending' 且 settled_at + settlement_delay_hours < now
   *   2. adminWalletService.releasePending 迁移 pending_balance → balance
   *   3. 标记 status='released', released_at=now
   * @returns 释放统计
   */
  releasePendingBalances(): Promise<{ scanned: number; released: number; errors: number }>;

  /**
   * 即时结算（tier 4 专属，腐竹手动申请）。
   * 跳过冻结期，收取手续费（economy.config instant_settlement_fee_rate，默认 5%）。
   * @throws {AdminTierFeatureLockedError} 非 tier 4（instant_settlement=false）
   * @throws {SettlementRecordNotFoundError} 记录不存在
   */
  instantSettle(recordId: number, adminUserId: string): Promise<SettlementRecord>;

  /**
   * 退款冲正（walletService.approveRefund 链路调用）。
   * 规则：
   *   - status=pending（未释放）→ status=reversed，pending_balance -= admin_share_amount
   *   - status=released（已释放）→ balance -= admin_share_amount；不足部分记 owed_amount，
   *     由后续分账自动抵扣（最多 30 天，超期 server_admin 介入）
   * @param sourceType 来源类型（'shop_order' | 'instance_renewal'）
   * @param sourceRef 关联订单/续费记录 ID
   * @param reason 冲正原因
   * @returns 冲正的记录数
   */
  reverseBySource(sourceType: 'shop_order' | 'instance_renewal', sourceRef: string, reason: string): Promise<{ reversed: number }>;

  // ===== 记录查询 =====

  /**
   * 查询分账记录（GET /api/admin/settlements）。
   * instance_admin 强制 admin_user_id=自己；server_admin 可查全部。
   */
  listRecords(
    adminUserId: string | null,
    filter?: {
      status?: SettlementRecordStatus;
      instance_id?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: SettlementRecord[]; total: number }>;

  /**
   * 分账汇总统计（腐竹工作台仪表盘：待结算/已结算/累计收入）。
   */
  getSummary(adminUserId: string): Promise<{
    pending_amount: number;
    released_amount: number;
    total_earned: number;
    owed_amount: number;
  }>;
}

export {
  SettlementRuleNotFoundError,
  SettlementRuleInvalidError,
  SettlementRecordNotFoundError,
} from './shared-types';
