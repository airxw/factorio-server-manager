// ============================================================================
// P3：gift_claims / chat_settings / chat_trigger_responses
//      / player_join_settings / periodic_messages
// 依据：gift-claims / chat-settings / chat-trigger-responses
//       / player-join-settings / periodic-messages schema.json
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- gift_claims -----
  if (!(await knex.schema.hasTable('gift_claims'))) {
    await knex.schema.createTable('gift_claims', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('user_id').notNullable(); // 引用 users.id (UUID)
      table.string('game_player_name').notNullable();
      // claim_type 枚举：welcome_gift / shop_order / cdk_redeem / manual
      table.string('claim_type').notNullable();
      table.text('claimed_at').notNullable(); // ISO 8601
    });
  }

  // ----- chat_settings -----
  if (!(await knex.schema.hasTable('chat_settings'))) {
    await knex.schema.createTable('chat_settings', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable().unique(); // 每服务器一条配置
      table.boolean('enabled').notNullable().defaultTo(true);
      table.text('settings_json').notNullable(); // JSON 字符串
      table.text('updated_at').notNullable(); // ISO 8601
    });
  }

  // ----- chat_trigger_responses -----
  if (!(await knex.schema.hasTable('chat_trigger_responses'))) {
    await knex.schema.createTable('chat_trigger_responses', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('trigger').notNullable();
      table.text('response').notNullable(); // 响应命令模板
      table.integer('priority').notNullable().defaultTo(50);
      table.boolean('enabled').notNullable().defaultTo(true);
      table.text('created_at').notNullable(); // ISO 8601
    });
  }

  // ----- player_join_settings -----
  if (!(await knex.schema.hasTable('player_join_settings'))) {
    await knex.schema.createTable('player_join_settings', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable().unique(); // 每服务器一条配置
      table.string('welcome_message').nullable().defaultTo(null);
      table.boolean('gift_enabled').notNullable().defaultTo(false);
      table.string('gift_item').nullable().defaultTo(null);
      table.integer('gift_count').nullable().defaultTo(null);
      // gift_quality 枚举：normal / uncommon / rare / epic / legendary / null
      table.string('gift_quality').nullable().defaultTo(null);
      table.text('updated_at').notNullable(); // ISO 8601
    });
  }

  // ----- periodic_messages -----
  if (!(await knex.schema.hasTable('periodic_messages'))) {
    await knex.schema.createTable('periodic_messages', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.text('message').notNullable();
      table.integer('interval_minutes').notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.text('next_run_at').notNullable(); // ISO 8601
      table.text('created_at').notNullable(); // ISO 8601
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('periodic_messages');
  await knex.schema.dropTableIfExists('player_join_settings');
  await knex.schema.dropTableIfExists('chat_trigger_responses');
  await knex.schema.dropTableIfExists('chat_settings');
  await knex.schema.dropTableIfExists('gift_claims');
}
