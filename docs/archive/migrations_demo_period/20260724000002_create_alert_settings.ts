// ============================================================================
// v4.6.0: alert_settings 表 — 用户告警通道配置
// 每用户一份记录，存储 email/webhook 通道开关 + 订阅的规则类型
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('alert_settings')) return;
  await knex.schema.createTable('alert_settings', (table) => {
    table.string('user_id').primary(); // FK users.id
    table.integer('email_enabled').notNullable().defaultTo(0); // 0/1
    table.text('webhook_url').notNullable().defaultTo(''); // 空字符串=未配置
    table.integer('webhook_enabled').notNullable().defaultTo(0); // 0/1
    table.text('subscribed_rules').notNullable().defaultTo('[]'); // JSON 数组字符串
    table.text('updated_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alert_settings');
}
