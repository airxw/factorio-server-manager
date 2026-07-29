// ============================================================================
// v3.6.2-A3: item_sync_log 表增加 retention_days 字段（默认 30 天）
// 用于 maintenance 聚合页配置 + scheduler 定时清理
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('item_sync_log', (table) => {
    table.integer('retention_days').notNullable().defaultTo(30);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('item_sync_log', (table) => {
    table.dropColumn('retention_days');
  });
}
