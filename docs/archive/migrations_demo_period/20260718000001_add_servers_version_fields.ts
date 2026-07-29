// ============================================================================
// v3.4.0: servers 表新增字段 — 实例多版本共存 + 自动清理
//   - current_version: 实例当前使用的游戏版本号
//   - version_id: 关联 game_versions 表
//   - last_activity_at: 最后一次被调用的时间
//   - marked_for_deletion: 是否已标记待删除
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.string('current_version').nullable();
    t.string('version_id').nullable().references('id').inTable('game_versions').onDelete('SET NULL');
    t.text('last_activity_at').nullable();
    t.boolean('marked_for_deletion').notNullable().defaultTo(false);
  });

  // 对存量数据：last_activity_at 取 updated_at 作为初始值
  await knex.raw(`UPDATE servers SET last_activity_at = updated_at WHERE last_activity_at IS NULL`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('servers', (t) => {
    t.dropColumn('marked_for_deletion');
    t.dropColumn('last_activity_at');
    t.dropColumn('version_id');
    t.dropColumn('current_version');
  });
}
