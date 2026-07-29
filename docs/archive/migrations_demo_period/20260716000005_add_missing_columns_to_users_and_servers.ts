// ============================================================================
// 为 users 和 servers 表补充第一次迁移被跳过的字段
// 根因：20260703000001_create_core_tables.ts 中 hasTable 守卫导致
//       早期数据库跳过了扩展字段的创建
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- users 表：逐个检查并添加缺失字段 -----

  if (!(await knex.schema.hasColumn('users', 'display_name'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('display_name').nullable().defaultTo(null);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'vip_level'))) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('vip_level').notNullable().defaultTo(0);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'vip_expires_at'))) {
    await knex.schema.alterTable('users', (table) => {
      table.text('vip_expires_at').nullable().defaultTo(null);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'is_verified'))) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_verified').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'last_login_at'))) {
    await knex.schema.alterTable('users', (table) => {
      table.text('last_login_at').nullable().defaultTo(null);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'last_login_ip'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('last_login_ip').nullable().defaultTo(null);
    });
  }

  if (!(await knex.schema.hasColumn('users', 'updated_at'))) {
    await knex.schema.alterTable('users', (table) => {
      // SQLite ALTER TABLE 不支持 CURRENT_TIMESTAMP，使用静态默认值
      table.text('updated_at').notNullable().defaultTo('2026-01-01T00:00:00.000Z');
    });
  }

  // ----- servers 表：逐个检查并添加缺失字段 -----

  if (!(await knex.schema.hasColumn('servers', 'shop_enabled'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.boolean('shop_enabled').notNullable().defaultTo(true);
    });
  }

  if (!(await knex.schema.hasColumn('servers', 'chat_enabled'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.boolean('chat_enabled').notNullable().defaultTo(true);
    });
  }

  if (!(await knex.schema.hasColumn('servers', 'mods_enabled'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.boolean('mods_enabled').notNullable().defaultTo(true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const userCols = ['display_name', 'vip_level', 'vip_expires_at', 'is_verified',
                    'last_login_at', 'last_login_ip', 'updated_at'];
  for (const col of userCols) {
    if (await knex.schema.hasColumn('users', col)) {
      await knex.schema.alterTable('users', (table) => table.dropColumn(col));
    }
  }

  const serverCols = ['shop_enabled', 'chat_enabled', 'mods_enabled'];
  for (const col of serverCols) {
    if (await knex.schema.hasColumn('servers', col)) {
      await knex.schema.alterTable('servers', (table) => table.dropColumn(col));
    }
  }
}
