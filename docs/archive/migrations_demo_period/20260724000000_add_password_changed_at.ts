// ============================================================================
// 20260724000000_add_password_changed_at.ts
// v3.8.0-S8: users 表新增 password_changed_at 字段
//
// 用途：admin.expiry_days 设置项要求强制管理员 N 天后重置密码，
//       需要记录上次密码修改时间作为计算基准。
//
// 兼容性：
//   - 字段 nullable，DEFAULT NULL，既有用户初始为 NULL（视为「未知」，不强制过期）
//   - 后续修改密码时由 passwordService 显式写入 NOW()
//   - 既有的 token_version / user_password_history 表逻辑不受影响
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'password_changed_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // 上次密码修改时间（ISO 8601 字符串），NULL=未知（既有用户初始为 NULL）
      // 注：SQLite 无法在 ALTER TABLE ADD COLUMN 中使用 NOW() 作为 DEFAULT，
      //     故此处仅添加 nullable 字段，由应用层在密码变更时显式写入。
      table.text('password_changed_at').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('users', 'password_changed_at')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('password_changed_at');
    });
  }
}
