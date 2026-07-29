// ============================================================================
// 20260831000001_add_expiry_fields_to_servers.ts
// v3-billing：servers 表新增 expires_at / expiry_status / expiry_grace_until 字段
//
// 设计目标：
//   补齐 instance-billing-rules-plan.md §2.3 假设"已存在"但实际缺失的有效期字段。
//   server-schema.json 契约已定义这三个字段（L92-L108），本 migration 将其落地到 DB。
//
// 字段说明（对齐 public/schema/server-schema.json）：
//   expires_at          TEXT NULL        过期时间（ISO 8601）。null=永久实例（默认）
//   expiry_status       TEXT NOT NULL    过期状态机：permanent/active/grace/expired/cleaned
//                                        默认 'permanent'（存量实例视为永久）
//   expiry_grace_until  TEXT NULL        宽限期结束时间。仅 expiry_status='grace' 时有值
//
// 兼容性：
//   - up：ADD COLUMN（SQLite 支持，不锁表，nullable/not null with default 均可）
//   - 存量实例：expires_at=NULL, expiry_status='permanent'（视为永久，不触发到期处理）
//   - down：DROP COLUMN（SQLite 3.35+ 支持）
//
// 索引：
//   idx_servers_expiry_status —— scheduler 按状态扫描实例
//   idx_servers_expires_at    —— scheduler 按过期时间扫描实例
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.3
//       public/schema/server-schema.json L92-L108
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 幂等检查：expires_at 列已存在则跳过（三个字段同批次添加，检查一个即可）
  const hasExpiresAt = await knex.schema.hasColumn('servers', 'expires_at');
  if (hasExpiresAt) {
    console.log('[migration 20260831000001] servers.expires_at 列已存在，跳过');
    return;
  }

  await knex.schema.alterTable('servers', (table) => {
    // 过期时间：null=永久实例（存量兼容，默认 null）
    table.text('expires_at').nullable().defaultTo(null);
    // 过期状态机：默认 'permanent'（存量实例视为永久，不触发到期处理）
    table.text('expiry_status').notNullable().defaultTo('permanent');
    // 宽限期结束时间：仅 expiry_status='grace' 时有值
    table.text('expiry_grace_until').nullable().defaultTo(null);
  });

  // 索引：scheduler 按状态/过期时间扫描实例
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_servers_expiry_status` ON `servers` (`expiry_status`)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_servers_expires_at` ON `servers` (`expires_at`)',
  );

  console.log(
    '[migration 20260831000001] servers 表新增 expires_at / expiry_status / expiry_grace_until 字段完成（含 2 个索引）',
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasExpiresAt = await knex.schema.hasColumn('servers', 'expires_at');
  if (!hasExpiresAt) {
    console.log('[migration 20260831000001] servers.expires_at 列不存在，跳过回滚');
    return;
  }

  // 先删索引再删字段
  await knex.raw('DROP INDEX IF EXISTS `idx_servers_expires_at`');
  await knex.raw('DROP INDEX IF EXISTS `idx_servers_expiry_status`');

  await knex.schema.alterTable('servers', (table) => {
    table.dropColumn('expiry_grace_until');
    table.dropColumn('expiry_status');
    table.dropColumn('expires_at');
  });

  console.log(
    '[migration 20260831000001] 回滚：删除 servers.expires_at / expiry_status / expiry_grace_until 字段及索引',
  );
}
