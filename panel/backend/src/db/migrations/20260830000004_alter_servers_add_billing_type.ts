// ============================================================================
// 20260830000004_alter_servers_add_billing_type.ts
// v3-billing：servers 表新增 billing_type 字段
//
// 设计目标：
//   servers 表新增 billing_type 列（TEXT，nullable），标记实例计费类型。
//   null=未接入计费（存量兼容）；'vps_prepaid'=VPS 预付费。
//
// 兼容性：
//   - up：ADD COLUMN（SQLite 支持，不锁表，nullable 默认 null）
//   - down：DROP COLUMN（SQLite 3.35+ 支持）
//   - **不自动填充存量实例**——保持 null 表示"未接入计费"，
//     避免存量实例被错误计费或被启动守卫拦截
//
// 启动守卫（由模块F 路由层实现）：
//   billing_type='vps_prepaid' 且 expiry_status ∈ {grace, expired} 时禁止启动（返回 402）
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.3
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 幂等检查：列已存在则跳过
  const hasColumn = await knex.schema.hasColumn('servers', 'billing_type');
  if (hasColumn) {
    console.log('[migration 20260830000004] servers.billing_type 列已存在，跳过');
    return;
  }

  await knex.schema.alterTable('servers', (table) => {
    // 计费类型：null=未接入计费（存量兼容）；'vps_prepaid'=VPS 预付费
    table.text('billing_type').nullable().defaultTo(null);
  });

  console.log(
    '[migration 20260830000004] servers.billing_type 列已创建（默认 null，不自动填充存量实例）',
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('servers', 'billing_type');
  if (!hasColumn) {
    console.log('[migration 20260830000004] servers.billing_type 列不存在，跳过回滚');
    return;
  }
  await knex.schema.alterTable('servers', (table) => {
    table.dropColumn('billing_type');
  });
  console.log('[migration 20260830000004] 回滚：删除 servers.billing_type 列');
}
