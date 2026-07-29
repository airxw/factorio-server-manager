// ============================================================================
// 扩展 player_join_settings 表：添加回归礼包 + VIP 专属欢迎语字段
// 用途：
//   - relogin_gift_enabled: 是否启用回归礼包
//   - relogin_gift_items:   回归礼包物品 JSON（[{item, count, quality}]）
//   - relogin_cooldown_hours: 回归礼包离线时长阈值（小时），超过才触发
//   - relogin_daily_limit:   每日领取上限（null=不限）
//   - relogin_total_limit:   总领取上限（null=不限）
//   - vip_welcome_messages:  VIP 专属欢迎语 JSON（[{min_vip_level, message}]）
// 依赖表：player_join_settings（已由 20260703000008_create_chat_tables.ts 创建）
// 幂等设计：用 hasTable 检查表存在，用 hasColumn 检查字段避免重复添加
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('player_join_settings'))) {
    return;
  }

  const columnsToAdd: Array<{ name: string; add: () => Promise<void> }> = [
    {
      name: 'relogin_gift_enabled',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.boolean('relogin_gift_enabled').notNullable().defaultTo(false);
        });
      },
    },
    {
      name: 'relogin_gift_items',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.text('relogin_gift_items').nullable().defaultTo(null);
        });
      },
    },
    {
      name: 'relogin_cooldown_hours',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.integer('relogin_cooldown_hours').nullable().defaultTo(24);
        });
      },
    },
    {
      name: 'relogin_daily_limit',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.integer('relogin_daily_limit').nullable().defaultTo(1);
        });
      },
    },
    {
      name: 'relogin_total_limit',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.integer('relogin_total_limit').nullable().defaultTo(null);
        });
      },
    },
    {
      name: 'vip_welcome_messages',
      add: async () => {
        await knex.schema.alterTable('player_join_settings', (table) => {
          table.text('vip_welcome_messages').nullable().defaultTo(null);
        });
      },
    },
  ];

  for (const col of columnsToAdd) {
    if (!(await knex.schema.hasColumn('player_join_settings', col.name))) {
      await col.add();
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('player_join_settings'))) {
    return;
  }

  const columnsToDrop = [
    'relogin_gift_enabled',
    'relogin_gift_items',
    'relogin_cooldown_hours',
    'relogin_daily_limit',
    'relogin_total_limit',
    'vip_welcome_messages',
  ];

  for (const col of columnsToDrop) {
    if (await knex.schema.hasColumn('player_join_settings', col)) {
      await knex.schema.alterTable('player_join_settings', (table) => {
        table.dropColumn(col);
      });
    }
  }
}
