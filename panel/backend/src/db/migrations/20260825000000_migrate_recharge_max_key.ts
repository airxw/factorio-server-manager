// ============================================================================
// 20260825000000_migrate_recharge_max_key.ts
// v4.x.x 修复：前端 Settings.tsx 历史写入 key 为 `balance.recharge_max`，
// 但后端 userCenter.ts 实际读取的是 `recharge.max`——前端写入的值从未生效。
//
// 本迁移将 system_config 中的孤儿 key `balance.recharge_max` 重命名为 `recharge.max`，
// 让管理员历史设置的自定义值得以保留并真正生效。
//
// 注意：
//   - 如果 `recharge.max` 已存在（理论上不会，因为前端写不进去），则删除孤儿
//     `balance.recharge_max` 避免冲突
//   - 默认值 100000 不在本迁移范围内——前端 UI 默认值已对齐后端
// ============================================================================

import type { Knex } from 'knex';

const LEGACY_KEY = 'balance.recharge_max';
const CORRECT_KEY = 'recharge.max';

export async function up(knex: Knex): Promise<void> {
  console.log('[migration 20260825000000_migrate_recharge_max_key] 开始迁移...');

  const hasTable = await knex.schema.hasTable('system_config');
  if (!hasTable) {
    console.log('[migration 20260825000000_migrate_recharge_max_key] system_config 表不存在，跳过');
    return;
  }

  const legacyRow = await knex<{ key: string; value: string; description: string | null }>(
    'system_config',
  )
    .where({ key: LEGACY_KEY })
    .first();

  if (!legacyRow) {
    console.log(
      '[migration 20260825000000_migrate_recharge_max_key] 未找到孤儿 key balance.recharge_max，无需迁移',
    );
    return;
  }

  const correctExists = await knex<{ key: string }>('system_config')
    .where({ key: CORRECT_KEY })
    .first();

  if (correctExists) {
    // recharge.max 已存在（可能后端某次直接写入），删除孤儿避免冲突
    await knex('system_config').where({ key: LEGACY_KEY }).del();
    console.log(
      '[migration 20260825000000_migrate_recharge_max_key] recharge.max 已存在，已删除孤儿 balance.recharge_max',
    );
  } else {
    // 重命名 key：UPDATE key 字段
    await knex('system_config').where({ key: LEGACY_KEY }).update({ key: CORRECT_KEY });
    console.log(
      `[migration 20260825000000_migrate_recharge_max_key] 已将 balance.recharge_max 重命名为 recharge.max（值: ${legacyRow.value}）`,
    );
  }

  console.log('[migration 20260825000000_migrate_recharge_max_key] 迁移完成');
}

export async function down(_knex: Knex): Promise<void> {
  // 不可逆——key 重命名后不回滚（旧 key 是 bug 产物）
}
