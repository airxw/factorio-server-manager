// ============================================================================
// 20260727100000_delete_legacy_player_game_type_bindings.ts
// v4.27.0: 玩家角色绑定从 game_type 全局语义迁移至 instance 实例级语义
//
// 设计目标：
//   1. 物理删除 bindings 表中 scope_type='game_type' 的 player 绑定记录
//      （这些记录是旧语义遗留：scope_ref 存的是 game_type 字符串，非 server_id）
//   2. 保留 scope_type='instance' / scope_type='wallet' / 其他类型的 bindings 记录
//   3. 保留 binding_type != 'player' 的记录（gm/admin 等不受影响）
//
// 用户决策来源：
//   - 用户明确批准「完全替换为实例级」+「直接物理删除」旧 game_type 记录
//   - 详见 docs/plans/player-binding-instance-scope-migration-plan.md
//   - current-note.md v4.27.0 s0601 留痕
//
// 兼容性：
//   - up：DELETE 语句，幂等（无匹配行时不报错）
//   - down：不可逆（物理删除，无备份）；如需回退需从备份恢复
//
// 影响：
//   - 旧版 register() 创建的占位绑定（scope_ref='default'）会被删除
//   - 旧版 registerFromGame() 创建的 game_type 绑定（scope_ref=具体游戏类型）会被删除
//   - 新版 registerFromGame() 创建的 instance 绑定（scope_ref=server_id）不受影响
//   - 新版 /guild/bind?type=player 创建的 instance 绑定不受影响
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 容错：bindings 表由 baseline_v4_post_demo（20260808000000）创建，但本迁移时间戳更早，
  // 在干净安装场景下执行时表尚未创建。对齐 20260822000000 的 hasTable 模式，表不存在时跳过。
  const hasBindingsTable = await knex.schema.hasTable('bindings');
  if (!hasBindingsTable) {
    console.log(
      "[migration 20260727100000] bindings 表不存在（干净安装，baseline 尚未执行），跳过 game_type 绑定清理",
    );
    return;
  }

  // 统计待删除的记录数（日志用）
  const countResult = await knex('bindings')
    .where({
      binding_type: 'player',
      scope_type: 'game_type',
    })
    .count<{ count: number }[]>({ count: '*' })
    .first();
  const deletedCount = Number(countResult?.count ?? 0);

  // 物理删除旧 scope_type='game_type' 的 player 绑定记录
  await knex('bindings')
    .where({
      binding_type: 'player',
      scope_type: 'game_type',
    })
    .delete();

  console.log(
    `[migration 20260727100000] 已物理删除 ${deletedCount} 条 scope_type='game_type' 的 player 绑定记录（v4.27.0 语义迁移）`,
  );
}

export async function down(_knex: Knex): Promise<void> {
  // 不可逆：物理删除无法自动回滚
  // 如需恢复，需从 backup/v4.27.0-pre-migration-*/ 备份中恢复 bindings 表
  console.warn(
    '[migration 20260727100000] down() 不可逆：物理删除的 scope_type=\'game_type\' player 绑定记录无法自动恢复',
  );
}
