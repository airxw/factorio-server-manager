// ============================================================================
// 20260830000003_create_instance_billing_settings.ts
// v3-billing：实例计费设置表（instance_billing_settings）
//
// 设计目标：
//   每个实例一行的计费配置——类型/覆盖月费/豁免标记/自动续扣。
//   首次访问自动创建（instance_type 默认 'small'）。
//
// 字段说明（对齐 public/schema/instance-billing-settings-schema.json）：
//   id                          UUID 主键
//   instance_id                 实例 ID（UNIQUE，一对一）
//   instance_type               实例类型
//   custom_monthly_price        实例级覆盖月费（null=用类型默认）
//   billing_exempt              免计费标记
//   exempt_reason               免计费原因（owner_self/self_hosted_node/manual）
//   auto_renew_enabled          是否启用自动续扣
//   last_billing_cycle_months   上次续费周期（自动续扣沿用）
//   created_at / updated_at
//
// 约束：
//   UNIQUE(instance_id)——每个实例仅一行计费设置
//
// 免计费判定优先级（见方案 §5）：
//   1. billing_exempt=true → 豁免
//   2. node_source=self_hosted 且 approval_status=approved → 豁免
//   3. servers.owner_user_id == 操作者 → 豁免（创建时自动设 billing_exempt=true）
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS（幂等）
//   - down：DROP TABLE
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.2
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`instance_billing_settings\` (
      \`id\` TEXT PRIMARY KEY,
      \`instance_id\` TEXT NOT NULL,
      \`instance_type\` TEXT NOT NULL DEFAULT 'small' CHECK(instance_type IN ('micro', 'small', 'medium', 'large', 'xlarge')),
      \`custom_monthly_price\` INTEGER,
      \`billing_exempt\` BOOLEAN NOT NULL DEFAULT 0,
      \`exempt_reason\` TEXT CHECK(exempt_reason IS NULL OR exempt_reason IN ('owner_self', 'self_hosted_node', 'manual')),
      \`auto_renew_enabled\` BOOLEAN NOT NULL DEFAULT 1,
      \`last_billing_cycle_months\` INTEGER CHECK(last_billing_cycle_months IS NULL OR last_billing_cycle_months IN (1, 3, 6, 12)),
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // UNIQUE(instance_id)——每个实例仅一行计费设置
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS `idx_instance_billing_settings_instance` ON `instance_billing_settings` (`instance_id`)',
  );

  console.log(
    '[migration 20260830000003] instance_billing_settings 建表完成（含 UNIQUE(instance_id) 约束）',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_billing_settings');
  console.log('[migration 20260830000003] 回滚：删除 instance_billing_settings 表');
}
