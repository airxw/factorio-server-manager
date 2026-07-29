// ============================================================================
// player_verify_codes 表：游戏内 !verify 命令验证码
// 用途：用户在游戏内通过 !verify <code> 完成玩家绑定校验
// 依赖表：users（id）/ servers（id）
// 幂等设计：建表用 hasTable 保护；索引在表内创建，dropTable 时一并清理
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- 建表 -----
  if (!(await knex.schema.hasTable('player_verify_codes'))) {
    await knex.schema.createTable('player_verify_codes', (table) => {
      table.increments('id').primary(); // 自增整数主键
      table.string('user_id').notNullable(); // 引用 users.id (UUID)
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('game_player_name').notNullable(); // 玩家游戏内名称
      table.string('code').notNullable(); // 6 位大写字母+数字验证码
      table.text('expires_at').notNullable(); // ISO 8601，TTL 5 分钟
      table.text('used_at').nullable().defaultTo(null); // 标记是否已使用，null 表示未使用
      table.text('created_at').notNullable(); // ISO 8601
    });

    // 索引：用于游戏内 !verify 命令快速查找验证码
    await knex.schema.alterTable('player_verify_codes', (table) => {
      table.index('code', 'idx_pvc_code');
      table.index(['user_id', 'server_id'], 'idx_pvc_user_server');
      table.index('expires_at', 'idx_pvc_expires');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('player_verify_codes');
}
