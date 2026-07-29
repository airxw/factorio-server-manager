// ============================================================================
// v4.0.2: 标记 3 个演示账号为系统内置
// 用途：v3.3.3 早期 seed 出的 admin@local.dev / manager@local.dev / user@local.dev
//       没有 is_built_in=1 标记，本迁移补齐
// 幂等：WHERE 条件带 is_built_in=0 守卫，重复执行无副作用
// ============================================================================

import type { Knex } from 'knex';

const BUILT_IN_EMAILS = [
  'admin@local.dev',
  'manager@local.dev',
  'user@local.dev',
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'is_built_in'))) {
    // 防御：is_built_in 字段不存在时跳过（依赖 20260801000000 先执行）
    return;
  }

  await knex('users')
    .whereIn('email', BUILT_IN_EMAILS)
    .where('is_built_in', 0)
    .update({ is_built_in: 1 });
}

export async function down(knex: Knex): Promise<void> {
  // 回滚：把 3 个 demo 账号的 is_built_in 还原为 0
  await knex('users')
    .whereIn('email', BUILT_IN_EMAILS)
    .update({ is_built_in: 0 });
}
