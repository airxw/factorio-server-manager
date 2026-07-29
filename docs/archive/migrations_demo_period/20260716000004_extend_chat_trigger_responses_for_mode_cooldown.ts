// ============================================================================
// 扩展 chat_trigger_responses 表：添加 mode / cooldown_seconds 字段
// 用途：支持 prefix/exact/contains 匹配模式与每触发器冷却时间
// 依赖表：chat_trigger_responses（已由 20260703000008_create_chat_tables.ts 创建）
// 幂等设计：用 hasTable 检查表存在，用 hasColumn 检查字段避免重复添加
// 注意：knex.schema.alterTable 的回调不 await 内部 Promise，因此 hasColumn
//       检查必须在 alterTable 调用之前完成，回调内只做无条件添加
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 仅在 chat_trigger_responses 表已存在时执行扩展
  if (!(await knex.schema.hasTable('chat_trigger_responses'))) {
    return;
  }

  // 先收集需要新增的列，避免在 alterTable 回调内 await
  const needAdd: Array<(table: Knex.AlterTableBuilder) => void> = [];

  if (!(await knex.schema.hasColumn('chat_trigger_responses', 'mode'))) {
    needAdd.push((table) =>
      // mode：匹配模式 prefix/exact/contains，默认 prefix
      table.string('mode').notNullable().defaultTo('prefix'),
    );
  }
  if (!(await knex.schema.hasColumn('chat_trigger_responses', 'cooldown_seconds'))) {
    needAdd.push((table) =>
      // cooldown_seconds：冷却时间（秒），0 表示无冷却
      table.integer('cooldown_seconds').notNullable().defaultTo(0),
    );
  }

  if (needAdd.length > 0) {
    await knex.schema.alterTable('chat_trigger_responses', (table) => {
      for (const add of needAdd) {
        add(table);
      }
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('chat_trigger_responses'))) {
    return;
  }

  // 先收集需要删除的列
  const toDrop: string[] = [];
  const candidates = ['mode', 'cooldown_seconds'];
  for (const col of candidates) {
    if (await knex.schema.hasColumn('chat_trigger_responses', col)) {
      toDrop.push(col);
    }
  }

  if (toDrop.length > 0) {
    await knex.schema.alterTable('chat_trigger_responses', (table) => {
      for (const col of toDrop) {
        table.dropColumn(col);
      }
    });
  }
}
