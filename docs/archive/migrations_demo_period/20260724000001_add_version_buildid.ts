// ============================================================================
// v4.12.0: game_versions 表新增 version_buildid 列 — Pack 系统重构(步骤 2)
//
// 用途:存储 Steam 游戏的 depot buildid(数字字符串)。
//   - 非 Steam 游戏或无 buildid 的版本:NULL(向后兼容)
//   - Steam 游戏版本比对时优先用 buildid(官网版本号与 buildid 无法自动映射)
//
// 迁移策略:ALTER TABLE ADD COLUMN,默认 NULL,不影响已有数据。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 幂等保护:列已存在时跳过(避免重复迁移报错)
  const hasColumn = await knex.schema.hasColumn('game_versions', 'version_buildid');
  if (!hasColumn) {
    await knex.schema.alterTable('game_versions', (t) => {
      // Steam depot buildid(数字字符串,可空)
      // 非 semver 版本(如纯 buildid)的 version_major/minor/patch 统一存 0,
      // 比对时优先用 version_buildid
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
