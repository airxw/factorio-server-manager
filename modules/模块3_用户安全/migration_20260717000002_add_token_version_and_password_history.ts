// ============================================================================
// migration_20260717000002_add_token_version_and_password_history.ts
// 模块3_用户安全：users.token_version 字段 + user_password_history 表迁移
//
// 数据契约：
//   - public/schema/user-schema.json → token_version 字段（v3.4.0 新增）
//   - public/schema/user_password_history-schema.json → 历史表数据契约
// 来源：s0103 融合定稿 v3.4.0 §互斥点④ B 路径（密码历史防重用 + token_version 失效）
//
// up():
//   1. ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0
//      （SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 hasColumn 守卫）
//   2. CREATE TABLE user_password_history
//   3. CREATE INDEX idx_password_history_user_id ON user_password_history(user_id, created_at)
//
// down():
//   1. DROP TABLE IF EXISTS user_password_history
//   2. ALTER TABLE users DROP COLUMN token_version（knex 内部处理 SQLite 表重建）
//
// 兼容性：
//   - token_version DEFAULT 0，既有用户不受影响（0 = 兼容旧行为，JWT 不受约束）
//   - authenticateToken 中间件：user.token_version = 0 时跳过校验
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- 1. users 表新增 token_version 字段（幂等：hasColumn 守卫） -----
  if (!(await knex.schema.hasColumn('users', 'token_version'))) {
    await knex.schema.alterTable('users', (table) => {
      // JWT 失效版本号：每次密码修改后 +1，0 = 兼容旧行为（JWT 不受 token_version 约束）
      table.integer('token_version').notNullable().defaultTo(0);
    });
  }

  // ----- 2. user_password_history 表（幂等：hasTable 守卫） -----
  if (!(await knex.schema.hasTable('user_password_history'))) {
    await knex.schema.createTable('user_password_history', (table) => {
      // UUID 主键：SQLite 用 randomblob(16) 生成 32 字符 hex（无横线 UUID）
      // service 层优先用 crypto.randomUUID() 显式写入，此 default 作为兜底
      table
        .string('id', 64)
        .primary()
        .defaultTo(knex.raw("(lower(hex(randomblob(16))))"));

      // 用户 ID（FK → users.id，ON DELETE CASCADE）
      // SQLite 不强制外键（默认 off），但保留 references 声明语义
      table
        .string('user_id', 64)
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');

      // 历史密码哈希（bcrypt）
      table.text('password_hash').notNullable();

      // 密码设置时间（该密码生效的开始时间）
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      // 索引：按 user_id 查询历史 + created_at 排序（SQLite 可双向扫描索引）
      table.index(['user_id', 'created_at'], 'idx_password_history_user_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // 1. 删除 user_password_history 表
  await knex.schema.dropTableIfExists('user_password_history');

  // 2. 删除 users.token_version 字段
  //    knex 内部处理 SQLite DROP COLUMN（SQLite 3.35+ 原生支持；旧版由 knex 表重建完成）
  if (await knex.schema.hasColumn('users', 'token_version')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('token_version');
    });
  }
}
