// ============================================================================
// 20260902000000_revoke_account_only_bindings.ts
// v4.38.0: 强制游戏角色绑定才能获得 VIP — 存量数据治理（spec 决策 2）
//
// 设计目标：
//   扫描所有 verified 账户级绑定（binding_type='account', scope_type='instance',
//   verify_status='verified'），若同一 user_id + scope_ref(server_id) 下不存在
//   verified 的 player 绑定（binding_type='player', scope_type='instance',
//   verify_status='verified'），则将该账户级绑定软删除：
//     - verify_status → 'revoked'
//     - vip_level → 0
//     - metadata 追加 unbound_at + source='migration_revoke_account_only'
//
// 用户决策来源：
//   - 用户裁决：改为强制绑定，绑定才能有 VIP（spec 决策 1 + 决策 2）
//   - 详见 .trae/specs/force-player-binding-for-vip/spec.md
//
// 幂等性：
//   - 已 revoked 的记录不再匹配（WHERE verify_status='verified'）
//   - 重复执行不报错，仅跳过已处理的记录
//
// 回滚：
//   - down() 不自动恢复（需人工确认 + 从备份恢复 vip_level）
//   - 原因：revoked 前的 vip_level 值被覆盖为 0，无法区分原始值
//
// 影响范围：
//   - 仅账户级绑定（binding_type='account', scope_type='instance'）
//   - 不影响 player 绑定、wallet 绑定、gm/admin 绑定
//   - 不影响已有 verified player 绑定的账户（这些账户保留 VIP）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 容错：bindings 表由 baseline_v4_post_demo（20260808000000）创建。
  // 干净安装场景下表已存在（本迁移时间戳晚于 baseline），但仍保留 hasTable 检查以防异常。
  const hasBindingsTable = await knex.schema.hasTable('bindings');
  if (!hasBindingsTable) {
    console.log(
      "[migration 20260902000000] bindings 表不存在，跳过 account-only 绑定清理",
    );
    return;
  }

  const now = new Date().toISOString();

  // 查找需要 revoke 的账户级绑定：
  // verified 账户绑定 + 同 user_id + scope_ref 下无 verified player 绑定
  const accountOnlyBindings = await knex('bindings as a')
    .where({
      'a.binding_type': 'account',
      'a.scope_type': 'instance',
      'a.verify_status': 'verified',
    })
    .whereNotExists(function () {
      this.select(1)
        .from('bindings as p')
        .whereRaw('p.user_id = a.user_id')
        .whereRaw('p.scope_ref = a.scope_ref')
        .where({
          'p.binding_type': 'player',
          'p.scope_type': 'instance',
          'p.verify_status': 'verified',
        });
    })
    .select('a.id', 'a.metadata');

  const revokeCount = accountOnlyBindings.length;

  if (revokeCount === 0) {
    console.log(
      "[migration 20260902000000] 无仅账户绑定记录需清理（所有 verified 账户绑定均有对应 verified player 绑定）",
    );
    return;
  }

  // 逐条 revoke（保留原 metadata 并追加 unbound_at + source）
  for (const row of accountOnlyBindings) {
    let oldMeta: Record<string, unknown> = {};
    try {
      oldMeta = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      oldMeta = {};
    }
    await knex('bindings').where({ id: row.id }).update({
      verify_status: 'revoked',
      vip_level: 0,
      metadata: JSON.stringify({
        ...oldMeta,
        unbound_at: now,
        source: 'migration_revoke_account_only',
      }),
      updated_at: now,
    });
  }

  console.log(
    `[migration 20260902000000] 已 revoke ${revokeCount} 条仅账户绑定记录（无对应 verified player 绑定），vip_level 降为 0`,
  );
}

export async function down(_knex: Knex): Promise<void> {
  // 不自动回滚：revoked 前的 vip_level 值已被覆盖为 0，无法区分原始值。
  // 如需恢复，需从 backup 中恢复 bindings 表并人工确认。
  console.warn(
    "[migration 20260902000000] down() 不执行回滚：revoked 的 account-only 绑定需从备份恢复（如有需要）",
  );
}
