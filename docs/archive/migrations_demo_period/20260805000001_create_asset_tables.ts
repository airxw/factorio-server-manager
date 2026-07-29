// ============================================================================
// v4.11.0: 商业化资产服务 — global_assets / instance_assets 表
// 依据：public/schema/global_asset.schema.json / instance_asset.schema.json
//       public/interface_stub/asset_interfaces.d.ts (IAssetService)
// global_assets：系统管理员维护的全局基础资产（COMMODITY/TEMPLATE/RULE）
// instance_assets：实例管理员重写或 UGC 自定义的资产（override_* 字段 + is_ugc）
// 热更新安全：全部用 hasTable/hasColumn 保护，已存在则跳过。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- global_assets -----
  if (!(await knex.schema.hasTable('global_assets'))) {
    await knex.schema.createTable('global_assets', (table) => {
      table.string('id').primary(); // UUID
      // type 枚举：COMMODITY / TEMPLATE / RULE
      table.string('type').notNullable();
      table.string('name').notNullable();
      table.float('default_price').nullable().defaultTo(null); // 默认价格（商品类）
      table.text('execution_logic').nullable().defaultTo(null); // 底层执行逻辑（如 RCON 指令）
      table.boolean('is_active').notNullable().defaultTo(true); // 系统级启用状态
      table.string('game_pack_id').nullable().defaultTo(null); // 所属游戏 Pack
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('global_assets', (table) => {
      table.index(['is_active'], 'idx_global_assets_active');
      table.index(['game_pack_id'], 'idx_global_assets_pack');
    });
  }

  // ----- instance_assets -----
  if (!(await knex.schema.hasTable('instance_assets'))) {
    await knex.schema.createTable('instance_assets', (table) => {
      table.string('id').primary(); // UUID
      table.string('instance_id').notNullable(); // 引用 servers.id
      table.string('global_asset_id').nullable().defaultTo(null); // 引用 global_assets.id（UGC 时为 null）
      table.boolean('is_ugc').notNullable().defaultTo(false); // 是否为服主完全自定义
      table.float('override_price').nullable().defaultTo(null); // 服主重写价格
      table.string('override_name').nullable().defaultTo(null); // 服主重写名称
      table.boolean('override_is_active').nullable().defaultTo(null); // 服主重写上下架状态
      table.text('custom_execution_logic').nullable().defaultTo(null); // 服主自定义逻辑（仅 UGC）
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('instance_assets', (table) => {
      table.index(['instance_id'], 'idx_instance_assets_instance');
      table.index(['instance_id', 'global_asset_id'], 'idx_instance_assets_inst_global');
      table.index(['instance_id', 'is_ugc'], 'idx_instance_assets_inst_ugc');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_assets');
  await knex.schema.dropTableIfExists('global_assets');
}
