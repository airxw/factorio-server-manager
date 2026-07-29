// D1: user_instance_bindings 表增加 vip_expires_at 列
// 用途：支持限时 VIP，NULL=永久 VIP；非 NULL=到期时间（ISO 字符串）
// 注意：不能用 hasTable guard clause 跳过整个迁移，否则已存在的表会缺失新列

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 检查列是否已存在，避免重复添加（不能跳过迁移，仅跳过 ALTER 操作）
  const hasColumn = await knex.schema.hasColumn('user_instance_bindings', 'vip_expires_at');
  if (!hasColumn) {
    await knex.schema.alterTable('user_instance_bindings', (table) => {
      // TEXT 存储 ISO 时间字符串；NULL 表示永久 VIP
      table.text('vip_expires_at').nullable().comment('VIP 到期时间（ISO 字符串），NULL=永久');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('user_instance_bindings', 'vip_expires_at');
  if (hasColumn) {
    await knex.schema.alterTable('user_instance_bindings', (table) => {
      table.dropColumn('vip_expires_at');
    });
  }
}
