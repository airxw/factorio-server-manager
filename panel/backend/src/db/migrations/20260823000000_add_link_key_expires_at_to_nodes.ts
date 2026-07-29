// ============================================================================
// 20260823000000_add_link_key_expires_at_to_nodes.ts
// v4.22.9 nodes linkKey 过期机制
//
// 设计目标：
//   1. nodes 表新增 link_key_expires_at 列（ISO 8601 字符串，nullable）
//   2. 为 status='pending' 的历史节点回填 link_key_expires_at = now + 24h
//      （默认 TTL，由后端 SLAVE_LINK_KEY_TTL_HOURS 配置控制，迁移时用 24h 兜底）
//   3. status='online'/'offline' 的已注册节点不需要回填（linkKey 已消费或已废弃）
//
// 兼容性：
//   - up：ADD COLUMN（SQLite 支持，不锁表）+ UPDATE pending 行
//   - down：DROP COLUMN（SQLite 3.35+ 支持，若更早版本需重建表）
//
// 来源：docs/plans/nodes-add-node-fix-plan.md §步骤 6
// ============================================================================

import type { Knex } from 'knex';

const DEFAULT_TTL_HOURS = 24;

export async function up(knex: Knex): Promise<void> {
  const hasLinkKeyExpiresAt = await knex.schema.hasColumn('nodes', 'link_key_expires_at');
  if (!hasLinkKeyExpiresAt) {
  // 1. 新增列
    await knex.schema.alterTable('nodes', (table) => {
      table.string('link_key_expires_at').nullable().defaultTo(null);
    });
  }

  // 2. 为 pending 节点回填过期时间（now + 24h）
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const updated = await knex('nodes')
    .where({ status: 'pending' })
    .whereNull('link_key_expires_at')
    .update({ link_key_expires_at: expiresAt });

  console.log(
    `[migration 20260823000000] nodes.link_key_expires_at ${hasLinkKeyExpiresAt ? '列已存在' : '列已创建'}，为 ${updated} 个 pending 节点回填过期时间 ${expiresAt}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasLinkKeyExpiresAt = await knex.schema.hasColumn('nodes', 'link_key_expires_at');
  if (!hasLinkKeyExpiresAt) {
    console.log('[migration 20260823000000] nodes.link_key_expires_at 列不存在，跳过回滚');
    return;
  }

  await knex.schema.alterTable('nodes', (table) => {
    table.dropColumn('link_key_expires_at');
  });

  console.log('[migration 20260823000000] 回滚：删除 nodes.link_key_expires_at 列');
}
