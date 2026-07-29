// ============================================================================
// P1：item_sync_log 表
// 依据：item-sync-log-schema.json
// 物品同步日志，记录 Panel 按 Pack.items.source.url 定时拉取结果
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('item_sync_log')) return;
  await knex.schema.createTable('item_sync_log', (table) => {
    table.increments('id').primary(); // 自增整数
    table.string('pack_id').notNullable(); // 引用 packs.id
    table.string('source_url').notNullable(); // GitHub raw JSON URL
    // status 枚举：success / failed
    table.string('status').notNullable();
    table.integer('items_count').nullable().defaultTo(null);
    table.text('synced_at').notNullable(); // ISO 8601
    table.text('error_message').nullable().defaultTo(null);
    table.text('created_at').notNullable(); // ISO 8601
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('item_sync_log');
}
