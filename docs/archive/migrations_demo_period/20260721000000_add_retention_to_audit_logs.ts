// ============================================================================
// v3.6.2-A1: audit_logs 表增加 retention_days 字段（默认 90 天）
// 用于 maintenance 聚合页配置 + scheduler 定时清理
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_logs', (table) => {
    table.integer('retention_days').notNullable().defaultTo(90);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('audit_logs', (table) => {
    table.dropColumn('retention_days');
  });
}
