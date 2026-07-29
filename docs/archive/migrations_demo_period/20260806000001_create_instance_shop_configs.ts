// ============================================================================
// v4.13.0: 实例店铺外观配置表（instance_shop_configs）
// 依据：public/schema/panel-api-types.ts (InstanceShopConfig)
//       docs/plans/v4.13.0-instances-split-plan.md 阶段一
//
// 设计说明：店铺外观（Banner/描述/主题色）属实例级配置（一实例一行），
// 独立于 global_assets / instance_assets 表，避免在资产行上冗余存储店铺级字段。
// 热更新安全：使用 hasTable 保护，已存在则跳过。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('instance_shop_configs'))) {
    await knex.schema.createTable('instance_shop_configs', (table) => {
      // 主键 = 实例 ID（一对一，引用 servers.id，不设外键约束以避免删除顺序依赖）
      table.string('server_id').primary();
      // 服主店铺 Banner 图片 URL（可空，前端用默认 banner 占位）
      table.text('banner_url').nullable().defaultTo(null);
      // Banner 点击跳转链接（可空）
      table.text('banner_link').nullable().defaultTo(null);
      // 服主店铺描述文案（可空，支持简单文本）
      table.text('shop_description').nullable().defaultTo(null);
      // 服主店铺主题色（HEX 格式如 #f59e0b，可空则用全局默认色）
      table.string('shop_theme_color', 16).nullable().defaultTo(null);
      // 最后更新时间（ISO 8601）
      table.text('updated_at').notNullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_shop_configs');
}
