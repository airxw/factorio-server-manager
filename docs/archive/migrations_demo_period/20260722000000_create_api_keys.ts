// ============================================================================
// v4.4.0-J1: API Key 旁路认证 — api_keys 表
// 存储 server_admin 生成的 API Key（SHA-256 hash），关联用户角色
// 旁路 JWT 认证：x-api-key header → 查表 → 构造 JwtPayload 附加到 req.user
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('api_keys')) return;
  await knex.schema.createTable('api_keys', (table) => {
    table.string('id').primary(); // UUID
    table.string('name').notNullable(); // 人类可读名称（如 "CI/CD Pipeline"）
    table.string('key_prefix').notNullable(); // key 前缀（前 12 字符，用于列表展示识别）
    table.string('key_hash', 64).notNullable().unique(); // SHA-256 hex hash
    table.string('user_id').notNullable(); // 关联用户 ID
    table.string('role').notNullable(); // 关联角色（server_admin / instance_admin / user）
    table.text('created_at').notNullable(); // ISO 8601
    table.text('expires_at').nullable().defaultTo(null); // 可选过期时间
    table.text('last_used_at').nullable().defaultTo(null); // 最后使用时间
    table.text('last_used_ip').nullable().defaultTo(null); // 最后使用 IP
    table.text('revoked_at').nullable().defaultTo(null); // 撤销时间（NULL = 未撤销）
    // 索引：按 hash 查找（认证路径），按 user_id 查找（列表路径）
    table.index(['key_hash'], 'idx_api_keys_key_hash');
    table.index(['user_id'], 'idx_api_keys_user_id');
    // 外键：user_id → users.id（用户删除时 API Key 保留但认证会失败因 user 不存在）
    table.foreign('user_id').references('id').inTable('users');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_keys');
}
