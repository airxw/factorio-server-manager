// ============================================================================
// P1：vip_permissions 表
// 依据：vip-permissions-schema.json
// VIP 等级权限映射表，0-5 级，含 max_quality / daily_limit
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('vip_permissions')) return;
  await knex.schema.createTable('vip_permissions', (table) => {
    table.increments('id').primary(); // 自增整数
    // vip_level 0-5，UNIQUE
    table.integer('vip_level').notNullable().unique();
    table.string('display_name').notNullable();
    // permissions: JSON 数组字符串，默认 '[]'
    table.text('permissions').defaultTo('[]');
    // max_quality 枚举：normal / uncommon / rare / epic / legendary / none
    table.string('max_quality').notNullable().defaultTo('normal');
    // daily_limit：null=不限，0=禁止
    table.integer('daily_limit').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vip_permissions');
}
