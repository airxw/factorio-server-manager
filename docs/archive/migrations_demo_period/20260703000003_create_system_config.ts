// ============================================================================
// P1：system_config 表
// 依据：system-config-schema.json
// 系统配置 KV 表，key 作为主键（非自增整数）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('system_config')) return;
  await knex.schema.createTable('system_config', (table) => {
    table.string('key').primary(); // 配置键，主键
    table.string('value').notNullable(); // 配置值（字符串形式）
    table.string('description').nullable().defaultTo(null);
    table.text('updated_at').notNullable(); // ISO 8601
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_config');
}
