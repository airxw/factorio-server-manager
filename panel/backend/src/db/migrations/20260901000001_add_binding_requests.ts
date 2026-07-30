// ============================================================================
// 20260901000001_add_binding_requests.ts
// v4.38.0: 绑定申请审批表 + servers 表新增 binding_requests_enabled / auto_approve_binding_requests 字段
//
// 设计目标：
//   支持"私有实例走申请-审批"绑定流程（公开实例仍直接绑）。
//   - 新建 binding_requests 表：记录用户对私有实例的绑定申请 + 服主审批结果
//   - servers 表新增 binding_requests_enabled 字段：服主可开启/关闭申请通道
//   - servers 表新增 auto_approve_binding_requests 字段（v4.38.1）：开启后用户申请即自动通过（无需服主审批）
//
// 字段说明（binding_requests）：
//   id                   TEXT (UUID) 主键
//   server_id            目标实例 ID（FK → servers.id ON DELETE CASCADE）
//   requester_user_id    申请人 ID（FK → users.id ON DELETE CASCADE）
//   status               审批状态：pending/approved/rejected/cancelled
//   message              申请留言（用户填，选填）
//   reviewer_user_id     审批人 ID（FK → users.id ON DELETE SET NULL；pending 时为 null）
//   review_note          审批备注（服主填，选填）
//   reviewed_at          审批时间（ISO8601；pending 时为 null）
//   created_at           创建时间
//   updated_at           更新时间
//
// 索引：
//   idx_binding_requests_server         (server_id)                  — 服主查申请列表
//   idx_binding_requests_requester      (requester_user_id)          — 用户查自己的申请
//   idx_binding_requests_status         (status)                     — 按状态筛选
//   idx_binding_requests_pending_unique (server_id, requester_user_id) WHERE status='pending'
//                                                                      — 同一用户对同一实例只能有一个 pending
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN（幂等）
//   - down：DROP TABLE + DROP COLUMN（SQLite 3.35+ 支持）
//   - binding_requests_enabled 默认 1（开启），存量实例自动获得"申请通道开启"语义
//   - auto_approve_binding_requests 默认 0（关闭），存量实例保持手动审批
//
// 来源：docs/plans/guild-servers-market-rework-plan.md §2
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- 1) 建 binding_requests 表 -----
  const tableExists = await knex.schema.hasTable('binding_requests');
  if (!tableExists) {
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS \`binding_requests\` (
        \`id\` TEXT PRIMARY KEY NOT NULL,
        \`server_id\` TEXT NOT NULL,
        \`requester_user_id\` TEXT NOT NULL,
        \`status\` TEXT NOT NULL DEFAULT 'pending',
        \`message\` TEXT,
        \`reviewer_user_id\` TEXT,
        \`review_note\` TEXT,
        \`reviewed_at\` TEXT,
        \`created_at\` TEXT NOT NULL,
        \`updated_at\` TEXT NOT NULL,
        FOREIGN KEY (\`server_id\`) REFERENCES \`servers\`(\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`requester_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`reviewer_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
      )
    `);

    await knex.raw('CREATE INDEX IF NOT EXISTS `idx_binding_requests_server` ON `binding_requests` (`server_id`)');
    await knex.raw('CREATE INDEX IF NOT EXISTS `idx_binding_requests_requester` ON `binding_requests` (`requester_user_id`)');
    await knex.raw('CREATE INDEX IF NOT EXISTS `idx_binding_requests_status` ON `binding_requests` (`status`)');
    // 部分唯一索引：同一用户对同一实例只能有一个 pending 申请（rejected/cancelled 不阻止重新申请）
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS `idx_binding_requests_pending_unique` ON `binding_requests` (`server_id`, `requester_user_id`) WHERE `status` = \'pending\'',
    );

    console.log('[migration 20260901000001] binding_requests 建表完成（4 个索引，含 pending 唯一约束）');
  } else {
    console.log('[migration 20260901000001] binding_requests 表已存在，跳过建表');
  }

  // ----- 2) servers 表新增 binding_requests_enabled 字段 -----
  const hasColumn = await knex.schema.hasColumn('servers', 'binding_requests_enabled');
  if (!hasColumn) {
    await knex.schema.alterTable('servers', (table) => {
      // 是否接受绑定申请（1=开启 / 0=关闭）；只对私有实例（is_public=0）有意义
      // 默认 1（开启），存量实例自动获得"申请通道开启"语义
      table.integer('binding_requests_enabled').notNullable().defaultTo(1);
    });
    console.log('[migration 20260901000001] servers.binding_requests_enabled 列已创建（默认 1=开启）');
  } else {
    console.log('[migration 20260901000001] servers.binding_requests_enabled 列已存在，跳过');
  }

  // ----- 3) servers 表新增 auto_approve_binding_requests 字段（v4.38.1） -----
  const hasAutoApproveColumn = await knex.schema.hasColumn('servers', 'auto_approve_binding_requests');
  if (!hasAutoApproveColumn) {
    await knex.schema.alterTable('servers', (table) => {
      // 是否对申请自动审批（1=自动通过 / 0=手动审批）；只对私有实例 + 已开启申请通道时有意义
      // 默认 0（关闭），存量实例保持手动审批语义
      table.integer('auto_approve_binding_requests').notNullable().defaultTo(0);
    });
    console.log('[migration 20260901000001] servers.auto_approve_binding_requests 列已创建（默认 0=关闭）');
  } else {
    console.log('[migration 20260901000001] servers.auto_approve_binding_requests 列已存在，跳过');
  }
}

export async function down(knex: Knex): Promise<void> {
  // ----- 3) 回滚 servers 表 auto_approve_binding_requests 字段 -----
  const hasAutoApproveColumn = await knex.schema.hasColumn('servers', 'auto_approve_binding_requests');
  if (hasAutoApproveColumn) {
    await knex.schema.alterTable('servers', (table) => {
      table.dropColumn('auto_approve_binding_requests');
    });
    console.log('[migration 20260901000001] 回滚：删除 servers.auto_approve_binding_requests 列');
  }

  // ----- 2) 回滚 servers 表 binding_requests_enabled 字段 -----
  const hasColumn = await knex.schema.hasColumn('servers', 'binding_requests_enabled');
  if (hasColumn) {
    await knex.schema.alterTable('servers', (table) => {
      table.dropColumn('binding_requests_enabled');
    });
    console.log('[migration 20260901000001] 回滚：删除 servers.binding_requests_enabled 列');
  }

  // ----- 1) 回滚 binding_requests 表 -----
  await knex.schema.dropTableIfExists('binding_requests');
  console.log('[migration 20260901000001] 回滚：删除 binding_requests 表');
}
