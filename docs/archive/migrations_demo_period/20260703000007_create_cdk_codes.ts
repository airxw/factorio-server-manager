// ============================================================================
// P2：cdk_codes 表
// 依据：cdk-codes-schema.json
// CDK 兑换码，使用乐观锁状态机 unused→claiming→claimed→expired
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('cdk_codes')) return;
  await knex.schema.createTable('cdk_codes', (table) => {
    table.increments('id').primary(); // 自增整数
    table.string('server_id').notNullable(); // 引用 servers.id (UUID)
    table.string('code').notNullable().unique(); // CDK 兑换码，UNIQUE
    table.string('item_name').notNullable();
    table.integer('count').notNullable();
    // quality 枚举：normal / uncommon / rare / epic / legendary
    table.string('quality').notNullable().defaultTo('normal');
    // status 枚举：unused / claiming / claimed / expired（乐观锁）
    table.string('status').notNullable().defaultTo('unused');
    table.string('claimed_player').nullable().defaultTo(null);
    table.text('claimed_at').nullable().defaultTo(null); // ISO 8601
    table.text('expires_at').notNullable(); // ISO 8601
    table.string('created_by').notNullable(); // 引用 users.id (UUID)
    table.text('created_at').notNullable(); // ISO 8601
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cdk_codes');
}
