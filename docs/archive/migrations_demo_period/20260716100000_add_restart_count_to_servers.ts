// ============================================================================
// 为 servers 表新增 restart_count 与 last_save_id 字段
// 用途：支持"带存档重启"能力——记录重启次数与最近激活的存档 ID
// 约束：列级检查（hasColumn），避免 hasTable 守卫导致已有表缺列
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 列级检查：不存在才添加
  const hasRestartCount = await knex.schema.hasColumn('servers', 'restart_count');
  if (!hasRestartCount) {
    await knex.schema.alterTable('servers', (table) => {
      table.integer('restart_count').defaultTo(0).notNullable();
    });
  }

  const hasLastSaveId = await knex.schema.hasColumn('servers', 'last_save_id');
  if (!hasLastSaveId) {
    await knex.schema.alterTable('servers', (table) => {
      table.integer('last_save_id').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasRestartCount = await knex.schema.hasColumn('servers', 'restart_count');
  if (hasRestartCount) {
    await knex.schema.alterTable('servers', (table) => {
      table.dropColumn('restart_count');
    });
  }

  const hasLastSaveId = await knex.schema.hasColumn('servers', 'last_save_id');
  if (hasLastSaveId) {
    await knex.schema.alterTable('servers', (table) => {
      table.dropColumn('last_save_id');
    });
  }
}
