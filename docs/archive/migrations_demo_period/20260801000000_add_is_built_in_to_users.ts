// ============================================================================
// v4.0.2: 为 users 表添加 is_built_in 字段
// 用途：标记系统内置账号（演示账号），前端展示 + 改密拦截
// 幂等：hasColumn 守卫，已存在则跳过（避免 v4.0.0 历史 bug 复现）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'is_built_in'))) {
    await knex.schema.alterTable('users', (table) => {
      // 0 = 普通账号，1 = 系统内置（演示账号）
      table.integer('is_built_in').notNullable().defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('users', 'is_built_in')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('is_built_in');
    });
  }
}
