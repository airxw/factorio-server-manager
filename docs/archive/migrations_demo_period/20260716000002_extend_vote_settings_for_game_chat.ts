// ============================================================================
// 扩展 vote_settings 表：为游戏内投票踢人添加配置字段
// 用途：支撑游戏内聊天 !vk 命令触发投票踢人，扩展原 vote_settings 配置
// 依赖表：vote_settings（已由 20260703000009_create_vote_tables.ts 创建）
// 幂等设计：用 hasTable 检查表存在，用 hasColumn 检查每个字段避免重复添加
// 注意：knex.schema.alterTable 的回调不 await 内部 Promise，因此 hasColumn
//       检查必须在 alterTable 调用之前完成，回调内只做无条件添加
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 仅在 vote_settings 表已存在时执行扩展
  if (!(await knex.schema.hasTable('vote_settings'))) {
    return;
  }

  // 先收集需要新增的列，避免在 alterTable 回调内 await
  const needAdd: Array<(table: Knex.AlterTableBuilder) => void> = [];

  if (!(await knex.schema.hasColumn('vote_settings', 'trigger_keywords'))) {
    needAdd.push((table) =>
      // trigger_keywords：投票触发关键词列表（JSON 数组字符串），默认 ["!vk"]
      table.text('trigger_keywords').notNullable().defaultTo('["!vk"]'),
    );
  }
  if (!(await knex.schema.hasColumn('vote_settings', 'cooldown_seconds'))) {
    needAdd.push((table) =>
      // cooldown_seconds：同一发起人冷却时间（秒）
      table.integer('cooldown_seconds').notNullable().defaultTo(60),
    );
  }
  if (!(await knex.schema.hasColumn('vote_settings', 'target_cooldown_seconds'))) {
    needAdd.push((table) =>
      // target_cooldown_seconds：同一目标冷却时间（秒）
      table.integer('target_cooldown_seconds').notNullable().defaultTo(300),
    );
  }
  if (!(await knex.schema.hasColumn('vote_settings', 'admin_immune'))) {
    needAdd.push((table) =>
      // admin_immune：管理员是否免疫被踢（0/1 布尔）
      table.integer('admin_immune').notNullable().defaultTo(1),
    );
  }
  if (!(await knex.schema.hasColumn('vote_settings', 'vip_immune_min_level'))) {
    needAdd.push((table) =>
      // vip_immune_min_level：VIP N 级以上免疫被踢，0 表示不免疫
      table.integer('vip_immune_min_level').notNullable().defaultTo(0),
    );
  }

  if (needAdd.length > 0) {
    await knex.schema.alterTable('vote_settings', (table) => {
      for (const add of needAdd) {
        add(table);
      }
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('vote_settings'))) {
    return;
  }

  // 先收集需要删除的列
  const toDrop: string[] = [];
  const candidates = [
    'trigger_keywords',
    'cooldown_seconds',
    'target_cooldown_seconds',
    'admin_immune',
    'vip_immune_min_level',
  ];
  for (const col of candidates) {
    if (await knex.schema.hasColumn('vote_settings', col)) {
      toDrop.push(col);
    }
  }

  if (toDrop.length > 0) {
    await knex.schema.alterTable('vote_settings', (table) => {
      for (const col of toDrop) {
        table.dropColumn(col);
      }
    });
  }
}
