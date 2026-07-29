// ============================================================================
// P2：shop_items / shop_orders / shop_order_items
// 依据：shop-items-schema.json / shop-orders-schema.json / shop-order-items-schema.json
// shop_orders 使用乐观锁状态机 pending→claiming→claimed→expired
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- shop_items -----
  if (!(await knex.schema.hasTable('shop_items'))) {
    await knex.schema.createTable('shop_items', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('item_name').notNullable();
      // quality 枚举：normal / uncommon / rare / epic / legendary
      table.string('quality').notNullable().defaultTo('normal');
      table.integer('vip_level_required').notNullable().defaultTo(0);
      table.integer('daily_limit').nullable().defaultTo(null);
      table.boolean('enabled').notNullable().defaultTo(false);
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('shop_items', (table) => {
      table.unique(['server_id', 'item_name'], 'idx_shop_items_server_item');
    });
  }

  // ----- shop_orders -----
  if (!(await knex.schema.hasTable('shop_orders'))) {
    await knex.schema.createTable('shop_orders', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('user_id').notNullable(); // 引用 users.id (UUID)
      // status 枚举：pending / claiming / claimed / expired（乐观锁）
      table.string('status').notNullable().defaultTo('pending');
      table.string('claim_code').notNullable().unique(); // 领取码，UNIQUE
      table.integer('items_count').notNullable();
      table.text('claimed_at').nullable().defaultTo(null); // ISO 8601
      table.text('expires_at').notNullable(); // ISO 8601
      table.string('claimed_player').nullable().defaultTo(null);
      table.text('created_at').notNullable(); // ISO 8601
    });
  }

  // ----- shop_order_items -----
  if (!(await knex.schema.hasTable('shop_order_items'))) {
    await knex.schema.createTable('shop_order_items', (table) => {
      table.increments('id').primary(); // 自增整数
      table.integer('order_id').notNullable(); // 引用 shop_orders.id (integer)
      table.string('item_name').notNullable();
      table.integer('count').notNullable();
      // quality 枚举：normal / uncommon / rare / epic / legendary
      table.string('quality').notNullable().defaultTo('normal');
    });
    await knex.schema.alterTable('shop_order_items', (table) => {
      table.index('order_id', 'idx_shop_order_items_order');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_order_items');
  await knex.schema.dropTableIfExists('shop_orders');
  await knex.schema.dropTableIfExists('shop_items');
}
