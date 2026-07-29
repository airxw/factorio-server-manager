// ============================================================================
// v3.9.0-S5: users 表新增 email_verified 字段
// 默认 0（未验证），注册后通过邮件链接验证后置 1
// 不强制 NOT NULL（向后兼容存量用户，视作未验证）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    // SQLite 不支持 BOOLEAN，用 INTEGER 0/1 表示
    table.integer('email_verified').defaultTo(0).notNullable();
  });

  // 将存量管理员账号视为已验证（避免影响现有部署的登录）
  await knex('users').where({ role: 'server_admin' }).update({ email_verified: 1 });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('email_verified');
  });
}
