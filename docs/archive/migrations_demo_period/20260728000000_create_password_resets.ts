// ============================================================================
// v3.9.0-S4: 密码找回 token 表
// 字段：id / user_id / token_hash / expires_at / used_at / created_at
// 索引：idx_password_resets_token_hash（按 token 查询）/ idx_password_resets_user_id（按用户查询）
// 安全：仅存 token_hash（sha256），不存明文 token；token 通过邮件发送给用户
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('password_resets', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable();
    table.text('expires_at').notNullable();
    table.text('used_at').nullable();
    table.text('created_at').notNullable();

    table.index(['token_hash'], 'idx_password_resets_token_hash');
    table.index(['user_id'], 'idx_password_resets_user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_resets');
}
