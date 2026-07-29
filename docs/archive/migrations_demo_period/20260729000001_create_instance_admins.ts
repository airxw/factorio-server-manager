// ============================================================================
// v4.5.0: instance_admins 表 — 实例共管关联
// 存储 instance_admin 级别的共管授权（一个实例可有多个管理员，owner + 共管）
// 关联 servers(id) ON DELETE CASCADE、users(id) ON DELETE CASCADE
// UNIQUE(instance_id, user_id) 防止重复授权
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('instance_admins')) return;
  await knex.schema.createTable('instance_admins', (table) => {
    table.string('id').primary(); // UUID
    table.string('instance_id').notNullable(); // 关联 servers.id
    table.string('user_id').notNullable(); // 被授权的管理员用户 ID
    table.string('assigned_by').notNullable(); // 授权人用户 ID
    table.timestamp('assigned_at').notNullable().defaultTo(knex.fn.now()); // 授权时间
    // 唯一约束：同一实例不可重复授权同一用户
    table.unique(['instance_id', 'user_id'], 'idx_instance_admins_instance_user_unique');
    // 索引：按实例查找管理员列表、按用户查找其共管的实例
    table.index(['instance_id'], 'idx_instance_admins_instance');
    table.index(['user_id'], 'idx_instance_admins_user');
    // 外键：实例删除时级联清理共管记录；用户删除时级联清理
    table.foreign('instance_id').references('id').inTable('servers').onDelete('CASCADE');
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_admins');
}
