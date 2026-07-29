// ============================================================================
// 20260830000001_create_instance_renewals.ts
// v3-billing：实例续费记录表（instance_renewals）
//
// 设计目标：
//   审计追踪每次续费操作——续费时长、扣款金额、新旧过期时间、续费类型、
//   计费周期（VPS 式月费）与实例类型快照。
//
// 字段说明（对齐 public/schema/instance-renewals-schema.json）：
//   id                      自增主键
//   instance_id             续费实例 ID（引用 servers.id）
//   user_id                 续费操作发起者
//   duration_days           续费时长（天）
//   amount_paid             实际扣款点券数（0=免费/豁免）
//   base_amount             基础金额（未应用折扣）
//   tier_discount_applied   阶梯折扣系数（1.0=无折扣）
//   vip_discount_applied    VIP 折扣系数
//   vip_level_at_renewal    续费时 VIP 等级快照
//   renewal_type            续费类型：manual/gift/auto（v3-billing 新增 auto）
//   use_wallet              是否从钱包扣款
//   old_expires_at          续费前过期时间
//   new_expires_at          续费后过期时间
//   renewed_at              续费操作时间
//   wallet_source           [v-economy] 扣款源：user_wallets/admin_wallets
//   admin_tier_discount_applied [v-economy] 腐竹等级折扣快照
//   node_source_at_renewal  [v-economy] 续费时节点来源快照
//   billing_cycle_months    [v3-billing] 计费周期（月）：1/3/6/12
//   instance_type_snapshot  [v3-billing] 计费时实例类型快照
//
// 索引：
//   idx_instance_renewals_instance（instance_id 查询）
//   idx_instance_renewals_user（user_id 查询）
//   idx_instance_renewals_renewed_at（按时间排序）
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS（幂等）
//   - down：DROP TABLE
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.4 + §8.3
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`instance_renewals\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`instance_id\` TEXT NOT NULL,
      \`user_id\` TEXT NOT NULL,
      \`duration_days\` INTEGER NOT NULL,
      \`amount_paid\` INTEGER NOT NULL,
      \`base_amount\` INTEGER NOT NULL,
      \`tier_discount_applied\` REAL NOT NULL DEFAULT 1.0,
      \`vip_discount_applied\` REAL NOT NULL DEFAULT 1.0,
      \`vip_level_at_renewal\` INTEGER NOT NULL DEFAULT 0,
      \`renewal_type\` TEXT NOT NULL DEFAULT 'manual' CHECK(renewal_type IN ('manual', 'gift', 'auto')),
      \`use_wallet\` BOOLEAN NOT NULL DEFAULT 1,
      \`old_expires_at\` TEXT,
      \`new_expires_at\` TEXT,
      \`renewed_at\` TEXT NOT NULL,
      \`wallet_source\` TEXT NOT NULL DEFAULT 'user_wallets' CHECK(wallet_source IN ('user_wallets', 'admin_wallets')),
      \`admin_tier_discount_applied\` REAL,
      \`node_source_at_renewal\` TEXT CHECK(node_source_at_renewal IS NULL OR node_source_at_renewal IN ('platform_managed', 'self_hosted')),
      \`billing_cycle_months\` INTEGER CHECK(billing_cycle_months IS NULL OR billing_cycle_months IN (1, 3, 6, 12)),
      \`instance_type_snapshot\` TEXT CHECK(instance_type_snapshot IS NULL OR instance_type_snapshot IN ('micro', 'small', 'medium', 'large', 'xlarge'))
    )
  `);

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_instance_renewals_instance` ON `instance_renewals` (`instance_id`)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_instance_renewals_user` ON `instance_renewals` (`user_id`)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_instance_renewals_renewed_at` ON `instance_renewals` (`renewed_at`)',
  );

  console.log('[migration 20260830000001] instance_renewals 建表完成（3 个索引）');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_renewals');
  console.log('[migration 20260830000001] 回滚：删除 instance_renewals 表');
}
