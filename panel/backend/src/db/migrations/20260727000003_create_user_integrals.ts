// ============================================================================
// 20260727000003_create_user_integrals.ts
// 用户中心经济系统：用户积分（成长值）表（user_integrals）
//
// 设计目标：
//   实例级成长积分账户——（user_id, server_id）复合主键，用于 VIP 等级区间
//   判定与每日衰减：total_integral 只增不减（历史成长值），current_integral
//   参与每日衰减（CHECK >= 0）。
//
// 字段说明：
//   total_integral    累计积分（只增不减，等级判定的历史依据）
//   current_integral  当前积分（每日衰减作用于该字段，CHECK >= 0）
//   last_decay_at     最近一次衰减执行时间（防重复衰减）
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
    CREATE TABLE IF NOT EXISTS \`user_integrals\` (
      \`user_id\` TEXT NOT NULL,
      \`server_id\` TEXT NOT NULL,
      \`total_integral\` INTEGER NOT NULL DEFAULT 0,
      \`current_integral\` INTEGER NOT NULL DEFAULT 0 CHECK(current_integral >= 0),
      \`last_decay_at\` TEXT,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (\`user_id\`, \`server_id\`)
    )
  `);

  console.log('[migration 20260727000003] user_integrals 建表完成');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_integrals');
  console.log('[migration 20260727000003] 回滚：删除 user_integrals 表');
}
