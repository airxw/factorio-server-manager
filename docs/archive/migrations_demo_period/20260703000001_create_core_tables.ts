// ============================================================================
// P0 既有表：users / nodes / servers / packs
// 依据：user-schema.json / server-schema.json / db/schema.ts (nodes/packs)
// users 扩展字段：vip_level / vip_expires_at / is_verified / display_name
//                 / last_login_at / last_login_ip / updated_at
// servers 扩展字段：shop_enabled / chat_enabled / mods_enabled
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- users -----
  if (await knex.schema.hasTable('users')) return;
  await knex.schema.createTable('users', (table) => {
    table.string('id').primary(); // UUID
    table.string('email').notNullable().unique();
    table.string('username').notNullable();
    table.string('password_hash').notNullable();
    // role 枚举：system_admin / admin / operator / viewer
    table.string('role').notNullable().defaultTo('viewer');
    // status 枚举：active / disabled
    table.string('status').notNullable().defaultTo('active');
    table.string('display_name').nullable().defaultTo(null);
    // vip_level 0-5
    table.integer('vip_level').notNullable().defaultTo(0);
    table.text('vip_expires_at').nullable().defaultTo(null); // ISO 8601
    table.boolean('is_verified').notNullable().defaultTo(false);
    table.text('last_login_at').nullable().defaultTo(null); // ISO 8601
    table.string('last_login_ip').nullable().defaultTo(null);
    table.text('created_at').notNullable(); // ISO 8601
    table.text('updated_at').notNullable(); // ISO 8601
  });

  // ----- nodes -----
  if (await knex.schema.hasTable('nodes')) {
    return;
  }
  await knex.schema.createTable('nodes', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('fqdn').notNullable();
    table.string('daemon_token_hash').notNullable();
    table.string('public_ip').nullable();
    // status 枚举：online / offline / degraded
    table.string('status').notNullable().defaultTo('offline');
    table.text('last_seen_at').nullable(); // ISO 8601
  });

  // ----- servers -----
  if (await knex.schema.hasTable('servers')) {
    return;
  }
  await knex.schema.createTable('servers', (table) => {
    table.string('id').primary(); // UUID
    table.string('name').notNullable();
    table.string('pack_id').notNullable(); // 引用 packs.id
    table.string('game_type').notNullable();
    table.string('node_id').notNullable(); // 引用 nodes.id
    table.string('owner_user_id').notNullable(); // 引用 users.id (UUID)
    // status 枚举：stopped / starting / running / stopping / error
    table.string('status').notNullable().defaultTo('stopped');
    table.integer('port').notNullable();
    table.integer('rcon_port').notNullable();
    table.text('rcon_password_enc').nullable();
    table.text('resource_limits_json').nullable(); // JSON 字符串
    table.boolean('shop_enabled').notNullable().defaultTo(true);
    table.boolean('chat_enabled').notNullable().defaultTo(true);
    table.boolean('mods_enabled').notNullable().defaultTo(true);
    table.text('created_at').notNullable(); // ISO 8601
    table.text('updated_at').notNullable(); // ISO 8601
  });

  // ----- packs -----
  if (await knex.schema.hasTable('packs')) {
    return;
  }
  await knex.schema.createTable('packs', (table) => {
    table.string('id').primary();
    table.string('game').notNullable();
    table.string('variant').notNullable();
    table.string('display_name').notNullable();
    table.string('version').notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.text('loaded_at').notNullable(); // ISO 8601
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('packs');
  await knex.schema.dropTableIfExists('servers');
  await knex.schema.dropTableIfExists('nodes');
  await knex.schema.dropTableIfExists('users');
}
