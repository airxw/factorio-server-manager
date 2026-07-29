// ============================================================================
// P3：player_bindings / player_histories
// 依据：player-bindings / player-histories schema.json
// player_bindings：UNIQUE(user_id, game_type) 与
//                  UNIQUE(game_player_name, game_type, status) 双唯一约束
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- player_bindings -----
  if (!(await knex.schema.hasTable('player_bindings'))) {
    await knex.schema.createTable('player_bindings', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('user_id').notNullable(); // 引用 users.id (UUID)
      table.string('game_player_name').notNullable();
      table.string('game_type').notNullable();
      table.string('verify_code').notNullable();
      // status 枚举：pending / verified / rejected
      table.string('status').notNullable().defaultTo('pending');
      table.text('verified_at').nullable().defaultTo(null); // ISO 8601
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('player_bindings', (table) => {
      table.unique(['user_id', 'game_type'], 'idx_player_bindings_user_game');
      table.unique(
        ['game_player_name', 'game_type', 'status'],
        'idx_player_bindings_name_game_status',
      );
    });
  }

  // ----- player_histories -----
  if (!(await knex.schema.hasTable('player_histories'))) {
    await knex.schema.createTable('player_histories', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('game_player_name').notNullable();
      table.text('joined_at').notNullable(); // ISO 8601
      table.text('left_at').nullable().defaultTo(null); // ISO 8601
      table.string('ip_address').nullable().defaultTo(null);
      table.integer('session_duration').nullable().defaultTo(null);
      table.text('created_at').notNullable(); // ISO 8601
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('player_histories');
  await knex.schema.dropTableIfExists('player_bindings');
}
