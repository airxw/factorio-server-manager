// ============================================================================
// P3：votes / vote_records / vote_settings
// 依据：votes / vote-records / vote-settings schema.json
// 投票踢人：votes 状态机 active→passed/failed/cancelled
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- votes -----
  if (!(await knex.schema.hasTable('votes'))) {
    await knex.schema.createTable('votes', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('initiator').notNullable(); // 发起者玩家名
      table.string('target').notNullable(); // 被投票目标玩家名
      table.string('reason').notNullable();
      // status 枚举：active / passed / failed / cancelled
      table.string('status').notNullable().defaultTo('active');
      table.text('start_time').notNullable(); // ISO 8601
      table.text('end_time').nullable().defaultTo(null); // ISO 8601
      table.text('created_at').notNullable(); // ISO 8601
    });
  }

  // ----- vote_records -----
  if (!(await knex.schema.hasTable('vote_records'))) {
    await knex.schema.createTable('vote_records', (table) => {
      table.increments('id').primary(); // 自增整数
      table.integer('vote_id').notNullable(); // 引用 votes.id (integer)
      table.string('voter').notNullable();
      // vote_choice 枚举：yes / no
      table.string('vote_choice').notNullable();
      table.text('created_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('vote_records', (table) => {
      table.index('vote_id', 'idx_vote_records_vote');
      table.unique(['vote_id', 'voter'], 'idx_vote_records_vote_voter');
    });
  }

  // ----- vote_settings -----
  if (!(await knex.schema.hasTable('vote_settings'))) {
    await knex.schema.createTable('vote_settings', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable().unique(); // 每服务器一条配置
      table.boolean('enabled').notNullable().defaultTo(false);
      table.integer('threshold').notNullable().defaultTo(3);
      table.integer('duration_seconds').notNullable().defaultTo(60);
      table.string('reason_prefix').notNullable().defaultTo('[VoteKick]');
      table.text('updated_at').notNullable(); // ISO 8601
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vote_settings');
  await knex.schema.dropTableIfExists('vote_records');
  await knex.schema.dropTableIfExists('votes');
}
