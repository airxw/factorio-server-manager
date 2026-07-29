// ============================================================================
// 新建 mod_dependencies 表 — Mod 依赖检测结果存储
// 用途：记录每个 mod 的依赖项及是否满足，支持依赖冲突检测
// 约束：hasTable 守卫（安全建表）；不建外键（与现有 mod_records 风格一致，
//       mod_records 亦未对 server_id 建外键，避免 SQLite 迁移顺序耦合）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('mod_dependencies');
  if (!hasTable) {
    await knex.schema.createTable('mod_dependencies', (table) => {
      table.increments('id').primary();
      table.integer('mod_id').notNullable(); // 引用 mod_records.id
      table.string('depends_on').notNullable(); // 依赖的 mod 名
      table.string('version_required').nullable(); // 版本要求
      table.boolean('satisfied').notNullable().defaultTo(false); // 是否满足
      table.timestamp('checked_at').defaultTo(knex.fn.now()); // 检测时间
    });
    await knex.schema.alterTable('mod_dependencies', (table) => {
      table.index(['mod_id'], 'idx_mod_dependencies_mod_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('mod_dependencies');
  if (hasTable) {
    await knex.schema.dropTable('mod_dependencies');
  }
}
