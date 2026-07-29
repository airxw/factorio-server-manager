// ============================================================================
// 20260830000002_create_instance_type_pricing.ts
// v3-billing：实例类型定价表（instance_type_pricing）
//
// 设计目标：
//   系统管理员配置每种实例类型（micro/small/medium/large/xlarge）的月费与
//   周期折扣（月/季/半年/年）。VPS 式预付费计费的核心定价源。
//
// 字段说明（对齐 public/schema/instance-type-pricing-schema.json）：
//   id                    UUID 主键
//   instance_type         实例类型枚举
//   display_name          展示名
//   monthly_price         基础月费（点券，0=免费）
//   quarterly_discount    季付折扣（1.0=无折扣，0.95=95 折）
//   semiannual_discount   半年付折扣
//   annual_discount       年付折扣
//   recommended_slots     推荐人数（仅展示）
//   cpu_limit             CPU 限制建议（仅展示）
//   memory_limit_mb       内存限制建议（仅展示）
//   disk_limit_gb         磁盘限制建议（仅展示）
//   status                状态机：active/archived
//   description           类型描述
//   created_by            创建者 user_id（仅 system_admin）
//   created_at / updated_at
//
// 约束：
//   UNIQUE(instance_type) WHERE status='active'（同类型同时仅一个 active）
//   —— SQLite 部分唯一索引实现
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS（幂等）
//   - down：DROP TABLE
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.1
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`instance_type_pricing\` (
      \`id\` TEXT PRIMARY KEY,
      \`instance_type\` TEXT NOT NULL CHECK(instance_type IN ('micro', 'small', 'medium', 'large', 'xlarge')),
      \`display_name\` TEXT NOT NULL,
      \`monthly_price\` INTEGER NOT NULL,
      \`quarterly_discount\` REAL NOT NULL DEFAULT 1.0,
      \`semiannual_discount\` REAL NOT NULL DEFAULT 1.0,
      \`annual_discount\` REAL NOT NULL DEFAULT 1.0,
      \`recommended_slots\` INTEGER,
      \`cpu_limit\` TEXT,
      \`memory_limit_mb\` INTEGER,
      \`disk_limit_gb\` INTEGER,
      \`status\` TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      \`description\` TEXT,
      \`created_by\` TEXT NOT NULL,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 部分唯一索引：同 instance_type 同时仅一个 active（SQLite 部分索引）
  await knex.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_instance_type_pricing_active_unique` ON `instance_type_pricing` (`instance_type`) WHERE `status` = 'active'",
  );

  console.log(
    '[migration 20260830000002] instance_type_pricing 建表完成（含部分唯一索引：同类型同时仅一个 active）',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_type_pricing');
  console.log('[migration 20260830000002] 回滚：删除 instance_type_pricing 表');
}
