// ============================================================================
// v3.3.0: user_notifications — 用户通知系统
// 支持类型：order_delivered / order_expired / cdk_gift / vip_changed / system_announcement
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('user_notifications')) return;
  await knex.schema.createTable('user_notifications', (table) => {
    table.increments('id').primary();
    table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('type').notNullable();
    table.string('title').notNullable();
    table.text('content').defaultTo('');
    table.string('related_server_id').nullable();
    table.integer('related_order_id').nullable();
    table.integer('is_read').notNullable().defaultTo(0);
    table.string('created_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_notifications');
}
