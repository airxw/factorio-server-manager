// ============================================================================
// P4：mod_records / save_records / backup_records / monitor_snapshots / list_entries
// 依据：mod-records / save-records / backup-records / monitor-snapshots
//       / list-entries schema.json
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- mod_records -----
  if (!(await knex.schema.hasTable('mod_records'))) {
    await knex.schema.createTable('mod_records', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('mod_name').notNullable();
      table.string('version').notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.string('source_url').nullable().defaultTo(null);
      table.text('installed_at').nullable().defaultTo(null); // ISO 8601
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('mod_records', (table) => {
      table.unique(
        ['server_id', 'mod_name', 'version'],
        'idx_mod_records_server_mod_version',
      );
    });
  }

  // ----- save_records -----
  if (!(await knex.schema.hasTable('save_records'))) {
    await knex.schema.createTable('save_records', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('save_name').notNullable();
      table.string('file_path').notNullable();
      table.integer('size_bytes').notNullable();
      table.text('modified_at').notNullable(); // ISO 8601
      table.boolean('is_active').notNullable().defaultTo(false);
      table.text('created_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('save_records', (table) => {
      table.unique(['server_id', 'save_name'], 'idx_save_records_server_save');
    });
  }

  // ----- backup_records -----
  if (!(await knex.schema.hasTable('backup_records'))) {
    await knex.schema.createTable('backup_records', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('file_path').notNullable();
      table.integer('size_bytes').notNullable();
      table.text('created_at').notNullable(); // ISO 8601
      table.string('created_by').notNullable(); // 引用 users.id (UUID)
      // status 枚举：in_progress / completed / failed / deleted
      table.string('status').notNullable().defaultTo('in_progress');
    });
  }

  // ----- monitor_snapshots -----
  if (!(await knex.schema.hasTable('monitor_snapshots'))) {
    await knex.schema.createTable('monitor_snapshots', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.text('timestamp').notNullable(); // ISO 8601
      table.float('cpu_percent').nullable().defaultTo(null);
      table.float('memory_mb').nullable().defaultTo(null);
      table.float('tick_rate').nullable().defaultTo(null);
      table.integer('player_count').nullable().defaultTo(null);
      table.text('json_extra').nullable().defaultTo(null); // JSON 字符串
    });
    await knex.schema.alterTable('monitor_snapshots', (table) => {
      table.index(
        ['server_id', 'timestamp'],
        'idx_monitor_snapshots_server_timestamp',
      );
    });
  }

  // ----- list_entries -----
  if (!(await knex.schema.hasTable('list_entries'))) {
    await knex.schema.createTable('list_entries', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      // list_type 枚举：whitelist / banlist
      table.string('list_type').notNullable();
      table.string('player_name').notNullable();
      table.text('added_at').notNullable(); // ISO 8601
      table.string('added_by').notNullable(); // 引用 users.id (UUID)
      table.string('reason').nullable().defaultTo(null);
    });
    await knex.schema.alterTable('list_entries', (table) => {
      table.unique(
        ['server_id', 'list_type', 'player_name'],
        'idx_list_entries_server_type_player',
      );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('list_entries');
  await knex.schema.dropTableIfExists('monitor_snapshots');
  await knex.schema.dropTableIfExists('backup_records');
  await knex.schema.dropTableIfExists('save_records');
  await knex.schema.dropTableIfExists('mod_records');
}
