// ============================================================================
// v4.6.0: resource_quotas 表 — 资源配额系统
// 存储 role 级 / user 级的资源配额（max_instances / max_disk_mb / max_players_total）
// scope_type: 'role'（按角色）| 'user'（按用户，优先级高于 role）
// scope_id: role 名（server_admin/instance_admin/user）或 user_id
// UNIQUE(scope_type, scope_id) 防止重复配额记录
// 所有字段 nullable：NULL 表示该项不限
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('resource_quotas')) return;
  await knex.schema.createTable('resource_quotas', (table) => {
    table.string('id').primary(); // UUID
    table.string('scope_type').notNullable(); // 'role' | 'user'
    table.string('scope_id').notNullable(); // role 名或 user_id
    table.integer('max_instances').nullable().defaultTo(null);
    table.bigInteger('max_disk_mb').nullable().defaultTo(null);
    table.integer('max_players_total').nullable().defaultTo(null);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.unique(['scope_type', 'scope_id'], 'idx_resource_quotas_scope');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('resource_quotas');
}
