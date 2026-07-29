// ============================================================================
// 扩展 player_join_settings 表：添加 leave_message 字段
// 用途：玩家离开时下发的消息，null 表示使用固定文案
// 依赖表：player_join_settings（已由 20260703000008_create_chat_tables.ts 创建）
// 幂等设计：用 hasTable 检查表存在，用 hasColumn 检查字段避免重复添加
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 仅在 player_join_settings 表已存在时执行扩展
  if (!(await knex.schema.hasTable('player_join_settings'))) {
    return;
  }

  if (!(await knex.schema.hasColumn('player_join_settings', 'leave_message'))) {
    await knex.schema.alterTable('player_join_settings', (table) => {
      // leave_message：玩家离开时下发的消息，null 表示使用固定文案
      table.text('leave_message').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('player_join_settings'))) {
    return;
  }

  if (await knex.schema.hasColumn('player_join_settings', 'leave_message')) {
    await knex.schema.alterTable('player_join_settings', (table) => {
      table.dropColumn('leave_message');
    });
  }
}
