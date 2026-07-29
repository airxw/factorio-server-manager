// ============================================================================
// L2: nodes 表扩展 — Daemon 集群化管理（主从节点）
// 新增字段：
//   node_type      — 节点类型（master/slave），默认 master（兼容现有 node-local）
//   comms_key      — 主从通信密钥（明文存储，双向信任 token）
//   link_key_hash  — 邀请链接 key 的 SHA-256 hash（一次性，slave 注册后清空）
//   linked_at      — slave 注册成功时间
//   display_fqdn   — slave 自报的对外访问地址（区别于 master 推导的 fqdn）
// 兼容性：已有 node-local 记录自动补 node_type='master'，其余字段为 null/默认值
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasNodeType = await knex.schema.hasColumn('nodes', 'node_type');
  if (!hasNodeType) {
    await knex.schema.alterTable('nodes', (table) => {
      table.string('node_type').notNullable().defaultTo('master');
    });
    // 已有 node-local 标记为 master
    await knex('nodes').where({ id: 'node-local' }).update({ node_type: 'master' });
  }

  const hasCommsKey = await knex.schema.hasColumn('nodes', 'comms_key');
  if (!hasCommsKey) {
    await knex.schema.alterTable('nodes', (table) => {
      table.string('comms_key').nullable().defaultTo(null);
    });
  }

  const hasLinkKeyHash = await knex.schema.hasColumn('nodes', 'link_key_hash');
  if (!hasLinkKeyHash) {
    await knex.schema.alterTable('nodes', (table) => {
      table.string('link_key_hash').nullable().defaultTo(null);
    });
  }

  const hasLinkedAt = await knex.schema.hasColumn('nodes', 'linked_at');
  if (!hasLinkedAt) {
    await knex.schema.alterTable('nodes', (table) => {
      table.text('linked_at').nullable().defaultTo(null);
    });
  }

  const hasDisplayFqdn = await knex.schema.hasColumn('nodes', 'display_fqdn');
  if (!hasDisplayFqdn) {
    await knex.schema.alterTable('nodes', (table) => {
      table.string('display_fqdn').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const cols = ['node_type', 'comms_key', 'link_key_hash', 'linked_at', 'display_fqdn'];
  for (const col of cols) {
    const has = await knex.schema.hasColumn('nodes', col);
    if (has) {
      await knex.schema.alterTable('nodes', (table) => {
        table.dropColumn(col);
      });
    }
  }
}
