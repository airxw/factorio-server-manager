// ============================================================================
// v4.8.0: friendships 表 — 玩家好友关系（L1）
// 存储 user_id → friend_user_id 的单向请求记录，accept 时更新为 accepted。
//   status: 'pending' | 'accepted' | 'blocked'
//   created_at: 请求创建时间
//   accepted_at: 接受时间（nullable，pending 时为 NULL）
// UNIQUE(user_id, friend_user_id) 防止重复请求
// 关联 users(id) ON DELETE CASCADE（任一方向用户删除时清理记录）
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('friendships')) return;
  await knex.schema.createTable('friendships', (table) => {
    table.string('id').primary(); // UUID
    table.string('user_id').notNullable(); // 请求发起者
    table.string('friend_user_id').notNullable(); // 请求接收者
    table.string('status').notNullable().defaultTo('pending'); // 'pending' | 'accepted' | 'blocked'
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.text('accepted_at').nullable(); // 接受时间，pending 时为 NULL
    // 唯一约束：同一方向不可重复请求
    table.unique(['user_id', 'friend_user_id'], 'idx_friendships_user_friend_unique');
    // 索引：按用户查好友列表、按接收者查待处理请求
    table.index(['user_id'], 'idx_friendships_user');
    table.index(['friend_user_id'], 'idx_friendships_friend');
    // 外键：用户删除时级联清理好友记录
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.foreign('friend_user_id').references('id').inTable('users').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('friendships');
}
