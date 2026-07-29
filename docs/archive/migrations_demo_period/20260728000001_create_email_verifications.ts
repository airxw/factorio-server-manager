// ============================================================================
// v3.9.0-S5: 邮箱验证 token 表
// 字段：id / user_id / token_hash / expires_at / verified_at / created_at
// 索引：idx_email_verifications_token_hash / idx_email_verifications_user_id
// 安全：仅存 token_hash（sha256），不存明文 token
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('email_verifications', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable();
    table.text('expires_at').notNullable();
    table.text('verified_at').nullable();
    table.text('created_at').notNullable();

    table.index(['token_hash'], 'idx_email_verifications_token_hash');
    table.index(['user_id'], 'idx_email_verifications_user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_verifications');
}
