// ============================================================================
// v4.7.0: instance_roles 表 — 实例级角色覆盖
// 存储 instance 粒度的角色授权（覆盖全局 users.role）。
//   role 取值：'instance_admin' | 'user'
//   server_admin 全局角色不可被实例级覆盖（由 service 层兜底）
//   expires_at 为 NULL 表示永久；非 NULL 表示过期后失效
// 关联 servers(id) ON DELETE CASCADE、users(id) ON DELETE CASCADE
// UNIQUE(instance_id, user_id) 防止重复授权
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('instance_roles')) return;
  await knex.schema.createTable('instance_roles', (table) => {
    table.string('id').primary(); // UUID
    table.string('instance_id').notNullable(); // 关联 servers.id
    table.string('user_id').notNullable(); // 被授权的用户 ID
    table.string('role').notNullable(); // 'instance_admin' | 'user'
    table.string('granted_by').notNullable(); // 授权人用户 ID
    table.timestamp('granted_at').notNullable().defaultTo(knex.fn.now()); // 授权时间
    table.text('expires_at').nullable(); // NULL=永久
    // 唯一约束：同一实例不可重复授权同一用户
    table.unique(['instance_id', 'user_id'], 'idx_instance_roles_instance_user_unique');
    // 索引：按实例查找角色列表、按用户查找其被授权的实例
    table.index(['instance_id'], 'idx_instance_roles_instance');
    table.index(['user_id'], 'idx_instance_roles_user');
    // 外键：实例删除时级联清理角色记录；用户删除时级联清理
    table.foreign('instance_id').references('id').inTable('servers').onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_roles');
}
