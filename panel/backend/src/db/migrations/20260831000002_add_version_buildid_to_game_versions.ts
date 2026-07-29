// ============================================================================
// v4.21.x: game_versions 表新增 version_buildid 列（基线遗漏补加）
//
// 原因：v4.19.0 基线迁移 20260808000000_baseline_v4_post_demo.ts 重建 game_versions
//   表时遗漏了 version_buildid 列，而原始迁移 20260724000001_add_version_buildid
//   已归档到 docs/archive/，导致新部署缺少该列。
//
// 用途：存储 Steam 游戏的 depot buildid（数字字符串）。
//   - 非 Steam 游戏或无 buildid 的版本：NULL（向后兼容）
//   - Steam 游戏版本比对时优先用 buildid（官网版本号与 buildid 无法自动映射）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('game_versions', 'version_buildid');
  if (!hasColumn) {
    await knex.schema.alterTable('game_versions', (t) => {
      t.text('version_buildid').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('game_versions', 'version_buildid');
  if (hasColumn) {
    await knex.schema.alterTable('game_versions', (t) => {
      t.dropColumn('version_buildid');
    });
  }
}
