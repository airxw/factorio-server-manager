// ============================================================================
// 经济系统改造：物品定价 + 用户钱包 + VIP 每日点券奖励
// 变更：
//   1. shop_items 新增 price（物品定价，点券）
//   2. shop_orders 新增 total_price（订单总金额快照）
//   3. shop_order_items 新增 price（下单时单价快照）
//   4. vip_permissions 新增 daily_reward_amount（VIP 每日领取点券金额）
//   5. 新增 user_wallets 表（按实例作用域的钱包）
// 依据：shop-items-schema.json / user-wallets-schema.json
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. shop_items 新增 price 列
  await knex.schema.alterTable('shop_items', (table) => {
    table.integer('price').notNullable().defaultTo(0);
  });

  // 2. shop_orders 新增 total_price 列（订单总金额快照，下单时写入）
  await knex.schema.alterTable('shop_orders', (table) => {
    table.integer('total_price').notNullable().defaultTo(0);
  });

  // 3. shop_order_items 新增 price 列（下单时单价快照，防止后续改价影响历史订单）
  await knex.schema.alterTable('shop_order_items', (table) => {
    table.integer('price').notNullable().defaultTo(0);
  });

  // 4. vip_permissions 新增 daily_reward_amount 列
  //    阶梯固定金额：VIP0=100, VIP1=200, VIP2=400, VIP3=800, VIP4=1600, VIP5=3200
  await knex.schema.alterTable('vip_permissions', (table) => {
    table.integer('daily_reward_amount').notNullable().defaultTo(0);
  });
  // 回填现有 vip_permissions 行的 daily_reward_amount（按阶梯固定金额）
  const rewardMap: Record<number, number> = { 0: 100, 1: 200, 2: 400, 3: 800, 4: 1600, 5: 3200 };
  const existingRows = await knex('vip_permissions').select('vip_level');
  for (const row of existingRows) {
    const amount = rewardMap[row.vip_level] ?? 0;
    await knex('vip_permissions').where({ vip_level: row.vip_level }).update({ daily_reward_amount: amount });
  }

  // 5. 新增 user_wallets 表（按实例作用域的钱包）
  if (!(await knex.schema.hasTable('user_wallets'))) {
    await knex.schema.createTable('user_wallets', (table) => {
      table.increments('id').primary();
      table.string('user_id').notNullable();       // 引用 users.id (UUID)
      table.string('server_id').notNullable();     // 引用 servers.id (UUID)
      table.integer('balance').notNullable().defaultTo(0);          // 当前余额
      table.integer('total_earned').notNullable().defaultTo(0);    // 累计获得
      table.integer('total_spent').notNullable().defaultTo(0);     // 累计消费
      table.text('last_daily_claim_at').nullable().defaultTo(null);  // 上次领取时间戳 ISO 8601
      table.text('last_daily_claim_date').nullable().defaultTo(null); // 上次领取日期 YYYY-MM-DD（用于判断今日是否已领取）
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
    await knex.schema.alterTable('user_wallets', (table) => {
      table.unique(['user_id', 'server_id'], 'idx_user_wallets_user_server');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_wallets');
  await knex.schema.alterTable('vip_permissions', (table) => {
    table.dropColumn('daily_reward_amount');
  });
  await knex.schema.alterTable('shop_order_items', (table) => {
    table.dropColumn('price');
  });
  await knex.schema.alterTable('shop_orders', (table) => {
    table.dropColumn('total_price');
  });
  await knex.schema.alterTable('shop_items', (table) => {
    table.dropColumn('price');
  });
}
