// ============================================================================
// 20260727000005_create_instance_pricing.ts
// 用户中心经济系统：实例定价配置表（instance_pricing）
//
// 设计目标：
//   实例级经济配置——server_id 主键，每个实例一行，由服主自定义 VIP 定价、
//   积分兑换比率与每日消费上限。缺省行时由应用层回退到平台默认值。
//
// 字段说明：
//   vip_monthly_price       订阅 VIP 月价（积分），NULL 表示该实例不售卖
//   vip_lifetime_price      买断 VIP 价格（积分），NULL 表示该实例不售卖
//   points_exchange_ratio   余额 → 积分兑换比率（默认 1.0）
//   integral_ratio          消费 → 成长积分累计比率（默认 1.0）
//   daily_consumption_limit 每日消费上限（积分），NULL 表示不限
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS（无存量数据来源，纯新表）
//   - down：DROP TABLE
//
// 方案文档：docs/plans/user-center-consolidation-plan.md
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`instance_pricing\` (
      \`server_id\` TEXT PRIMARY KEY,
      \`vip_monthly_price\` INTEGER,
      \`vip_lifetime_price\` INTEGER,
      \`points_exchange_ratio\` REAL NOT NULL DEFAULT 1.0,
      \`integral_ratio\` REAL NOT NULL DEFAULT 1.0,
      \`daily_consumption_limit\` INTEGER,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log('[migration 20260727000005] instance_pricing 建表完成');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_pricing');
  console.log('[migration 20260727000005] 回滚：删除 instance_pricing 表');
}
