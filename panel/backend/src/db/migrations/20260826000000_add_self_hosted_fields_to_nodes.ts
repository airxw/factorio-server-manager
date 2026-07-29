// ============================================================================
// 20260826000000_add_self_hosted_fields_to_nodes.ts
// v4.28.0 节点归属字段落地（自带节点 self_hosted 概念）
//
// 设计目标：
//   1. nodes 表新增 5 个字段（v4.28.0 契约 nodes-schema.json 已规划，本迁移负责 DB 落地）
//      - node_source: 'platform_managed' | 'self_hosted'（节点来源）
//      - self_hosted_owner_id: string | null（自带节点归属用户 ID）
//      - approval_status: 'pending' | 'approved' | 'rejected'（接入审核状态）
//      - approved_by: string | null（审核操作者 user_id）
//      - approved_at: string | null（审核时间 ISO 8601）
//   2. 为存量节点保守赋默认值（platform_managed / NULL / approved）—— 与 v4.28.0 §0.4 一致
//   3. 新增索引：self_hosted_owner_id（按归属查询）+ node_source（按来源筛选）
//
// 兼容性：
//   - up：ADD COLUMN（SQLite 支持不锁表）+ CREATE INDEX
//   - down：DROP COLUMN（SQLite 3.35+ 支持，更早版本需重建表）
//   - 外键约束：SQLite 不支持 ALTER TABLE ADD FOREIGN KEY，本迁移保守不加 FK，
//     由应用层 NodeService.assertNodeOwnedByUser 校验归属
//
// 来源：
//   - 契约：public/schema/nodes-schema.json（v4.28.0 已规划）
//   - 方案：docs/plans/role-permission-economy-system-plan.md §3.1（决策 D4 自带节点完全免费+自主）
//   - 落地：docs/plans/nodes-instance-admin-access-plan.md §步骤 1
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasNodeSource = await knex.schema.hasColumn('nodes', 'node_source');
  const hasSelfHostedOwnerId = await knex.schema.hasColumn('nodes', 'self_hosted_owner_id');
  const hasApprovalStatus = await knex.schema.hasColumn('nodes', 'approval_status');
  const hasApprovedBy = await knex.schema.hasColumn('nodes', 'approved_by');
  const hasApprovedAt = await knex.schema.hasColumn('nodes', 'approved_at');

  // 1. 新增 5 个字段（保守默认值，与 v4.28.0 §0.4 保守原则一致）
  if (!hasNodeSource || !hasSelfHostedOwnerId || !hasApprovalStatus || !hasApprovedBy || !hasApprovedAt) {
    await knex.schema.alterTable('nodes', (table) => {
      // 节点来源：platform_managed=平台资源（计费）；self_hosted=腐竹自带节点（免费+自主，需审核）
      if (!hasNodeSource) table.string('node_source').notNullable().defaultTo('platform_managed');
      // 自带节点归属用户 ID（node_source=self_hosted 时必填；platform_managed 时为 NULL）
      if (!hasSelfHostedOwnerId) table.string('self_hosted_owner_id').nullable().defaultTo(null);
      // 接入审核状态：self_hosted 默认 pending（需 server_admin 审核）；platform_managed 默认 approved
      if (!hasApprovalStatus) table.string('approval_status').notNullable().defaultTo('approved');
      // 审核操作者 user_id（server_admin）
      if (!hasApprovedBy) table.string('approved_by').nullable().defaultTo(null);
      // 审核时间（ISO 8601）
      if (!hasApprovedAt) table.text('approved_at').nullable().defaultTo(null);
    });
  }

  // 2. 新增索引（按归属查询、按来源筛选）
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_nodes_self_hosted_owner_id` ON `nodes` (`self_hosted_owner_id`)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS `idx_nodes_node_source` ON `nodes` (`node_source`)',
  );

  console.log(
    '[migration 20260826000000] nodes 表已落地/校正 v4.28.0 自带节点 5 字段：' +
      'node_source / self_hosted_owner_id / approval_status / approved_by / approved_at',
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasNodeSource = await knex.schema.hasColumn('nodes', 'node_source');
  const hasSelfHostedOwnerId = await knex.schema.hasColumn('nodes', 'self_hosted_owner_id');
  const hasApprovalStatus = await knex.schema.hasColumn('nodes', 'approval_status');
  const hasApprovedBy = await knex.schema.hasColumn('nodes', 'approved_by');
  const hasApprovedAt = await knex.schema.hasColumn('nodes', 'approved_at');

  if (!hasNodeSource && !hasSelfHostedOwnerId && !hasApprovalStatus && !hasApprovedBy && !hasApprovedAt) {
    console.log('[migration 20260826000000] nodes 自带节点字段不存在，跳过回滚');
    return;
  }

  // 删除索引（SQLite 删列会自动删索引，但显式删更安全）
  await knex.raw('DROP INDEX IF EXISTS `idx_nodes_self_hosted_owner_id`');
  await knex.raw('DROP INDEX IF EXISTS `idx_nodes_node_source`');

  // 删除 5 个字段
  await knex.schema.alterTable('nodes', (table) => {
    if (hasNodeSource) table.dropColumn('node_source');
    if (hasSelfHostedOwnerId) table.dropColumn('self_hosted_owner_id');
    if (hasApprovalStatus) table.dropColumn('approval_status');
    if (hasApprovedBy) table.dropColumn('approved_by');
    if (hasApprovedAt) table.dropColumn('approved_at');
  });

  console.log('[migration 20260826000000] 回滚：删除 nodes 表 v4.28.0 自带节点 5 字段');
}
