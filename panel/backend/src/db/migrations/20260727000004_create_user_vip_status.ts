// ============================================================================
// 20260727000004_create_user_vip_status.ts
// 用户中心经济系统：用户 VIP 状态表（user_vip_status）
//
// 设计目标：
//   实例级 VIP 状态——（user_id, server_id）复合主键，记录用户在单个实例内
//   的 VIP 类型与到期时间。VIP 为实例级权益，与全局余额分离。
//
// 字段说明：
//   vip_type        VIP 类型：'lifetime'（买断）/ 'monthly'（订阅），NULL 表示非 VIP
//   vip_expires_at  VIP 到期时间（lifetime 可为 NULL 表示永久）
//   purchased_at    最近购买时间
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
    CREATE TABLE IF NOT EXISTS \`user_vip_status\` (
      \`user_id\` TEXT NOT NULL,
      \`server_id\` TEXT NOT NULL,
      \`vip_type\` TEXT CHECK(vip_type IN ('lifetime', 'monthly') OR vip_type IS NULL),
      \`vip_expires_at\` TEXT,
      \`purchased_at\` TEXT,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (\`user_id\`, \`server_id\`)
    )
  `);

  console.log('[migration 20260727000004] user_vip_status 建表完成');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_vip_status');
  console.log('[migration 20260727000004] 回滚：删除 user_vip_status 表');
}
