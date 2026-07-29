// ============================================================================
// P1：command_queue 表
// 依据：command-queue-schema.json
// 命令下发队列，INDEX(server_id, status) / INDEX(priority, created_at)
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('command_queue')) return;
  await knex.schema.createTable('command_queue', (table) => {
    table.increments('id').primary(); // 自增整数
    table.string('server_id').notNullable(); // 引用 servers.id (UUID)
    table.text('command_text').notNullable(); // 已渲染的完整命令
    // priority 枚举：low / normal / high
    table.string('priority').notNullable().defaultTo('normal');
    // status 枚举：pending / sending / sent / failed
    table.string('status').notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(3);
    table.text('last_error').nullable().defaultTo(null);
    table.text('created_at').notNullable(); // ISO 8601
    table.text('sent_at').nullable().defaultTo(null); // ISO 8601
  });
  // 队列查询索引
  await knex.schema.alterTable('command_queue', (table) => {
    table.index(['server_id', 'status'], 'idx_command_queue_server_status');
    table.index(['priority', 'created_at'], 'idx_command_queue_priority_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('command_queue');
}
