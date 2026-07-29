// ============================================================================
// S7-1：shop_orders / cdk_codes 添加 claiming_at 字段
// 依据：scheme-final-merged.md §5.1/§5.2 乐观锁两段事务
// 用途：记录进入 claiming 状态的时间戳，供 OPTIMISTIC_LOCK_TIMEOUT_SCAN
//       周期任务扫描超时未完成的 claiming 记录并回滚。
// 字段：claiming_at TEXT NULL（ISO 8601），进入 claiming 时写入，离开时清空。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // shop_orders 添加 claiming_at
  if (!(await knex.schema.hasColumn('shop_orders', 'claiming_at'))) {
    await knex.schema.alterTable('shop_orders', (table) => {
      table.text('claiming_at').nullable().defaultTo(null); // ISO 8601
    });
  }

  // cdk_codes 添加 claiming_at
  if (!(await knex.schema.hasColumn('cdk_codes', 'claiming_at'))) {
    await knex.schema.alterTable('cdk_codes', (table) => {
      table.text('claiming_at').nullable().defaultTo(null); // ISO 8601
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('shop_orders', 'claiming_at')) {
    await knex.schema.alterTable('shop_orders', (table) => {
      table.dropColumn('claiming_at');
    });
  }
  if (await knex.schema.hasColumn('cdk_codes', 'claiming_at')) {
    await knex.schema.alterTable('cdk_codes', (table) => {
      table.dropColumn('claiming_at');
    });
  }
}
