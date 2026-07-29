// ============================================================================
// v3.4.0: 创建 game_versions 表 — 版本池
// 每个 Pack 可同时存在多个已下载的游戏版本，存放在节点本地存储中。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('game_versions', (t) => {
    t.string('id').primary();
    t.string('pack_id').notNullable().references('id').inTable('packs').onDelete('CASCADE');
    t.string('version').notNullable();
    t.string('node_id').notNullable().references('id').inTable('nodes').onDelete('CASCADE');
    t.text('download_path').notNullable();
    t.integer('file_size_bytes').nullable();
    t.string('downloaded_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('downloaded_at').notNullable(); // ISO 8601
    // 语义版本整数列，便于 SQL 排序和比较
    t.integer('version_major').notNullable().defaultTo(0);
    t.integer('version_minor').notNullable().defaultTo(0);
    t.integer('version_patch').notNullable().defaultTo(0);
    t.text('created_at').notNullable(); // ISO 8601

    t.index('pack_id');
    t.index('node_id');
    t.index(['pack_id', 'version']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('game_versions');
}
