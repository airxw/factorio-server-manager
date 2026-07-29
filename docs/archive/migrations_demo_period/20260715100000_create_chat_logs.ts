// ============================================================================
// Factorio 集成：chat_logs 表
// 依据：extend-pack-schema-for-factorio spec §数据库变更
// 用途：chatLogService 解析实例 stdout 聊天行后持久化到此表
// 与现有 chatService 边界：chatService 管理 chat_settings/chat_triggers 业务配置；
//                        chatLogService 解析 stdout 并持久化到 chat_logs
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- chat_logs -----
  if (!(await knex.schema.hasTable('chat_logs'))) {
    await knex.schema.createTable('chat_logs', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('player_name').notNullable();
      table.text('message').notNullable();
      table.text('sent_at').notNullable(); // ISO 8601，消息发送时间
      table.text('created_at').notNullable(); // ISO 8601，记录创建时间
    });
    await knex.schema.alterTable('chat_logs', (table) => {
      table.index(
        ['server_id', 'sent_at'],
        'idx_chat_logs_server_sent_at',
      );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chat_logs');
}
