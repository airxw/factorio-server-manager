// ============================================================================
// v3.6.1: servers 表新增 disk_usage_bytes / disk_usage_updated_at 字段
// 用于缓存实例磁盘占用，由 scheduler 每日刷新，避免每次列表请求实时 du。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.integer('disk_usage_bytes').nullable();
    t.text('disk_usage_updated_at').nullable(); // ISO 8601
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.dropColumn('disk_usage_bytes');
    t.dropColumn('disk_usage_updated_at');
  });
}
