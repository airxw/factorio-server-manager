// ============================================================================
// CDK 礼包逻辑重做：新增 cdk_code_items 子表（支持礼包包含多个物品）
// 依据：用户需求 "CDK 兑换逻辑重做：礼包由1个或多个物品组成"
//
// 设计：
//   - cdk_codes 表保留原 item_name/count/quality 字段作为"主物品"兼容字段（向后兼容旧数据）
//   - 新增 gift_name / gift_description 字段（可选，礼包名称和描述）
//   - 新增 cdk_code_items 子表存储礼包内每个物品（支持多物品）
//   - 兑换时：若 cdk_code_items 有记录，逐个渲染并发送命令；否则降级用主物品
//
// 向后兼容：旧 CDK 数据（仅 item_name/count/quality）无需迁移，兑换时自动降级为单物品礼包
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. 新增 cdk_codes.gift_name / gift_description 字段（hasColumn guard 避免重复添加）
  const hasGiftName = await knex.schema.hasColumn('cdk_codes', 'gift_name');
  if (!hasGiftName) {
    await knex.schema.alterTable('cdk_codes', (table) => {
      table.string('gift_name').nullable().defaultTo(null).comment('礼包名称（可选）');
      table.string('gift_description').nullable().defaultTo(null).comment('礼包描述（可选）');
    });
  }

  // 2. 新增 cdk_code_items 子表
  if (await knex.schema.hasTable('cdk_code_items')) return;
  await knex.schema.createTable('cdk_code_items', (table) => {
    table.increments('id').primary();
    // 外键关联 cdk_codes.id，删除 CDK 时级联删除其物品列表
    table.integer('cdk_code_id').notNullable()
      .references('id').inTable('cdk_codes').onDelete('CASCADE');
    table.string('item_name').notNullable().comment('物品名，应 ∈ Pack.items');
    table.integer('count').notNullable().comment('物品数量，1-999999');
    table.string('quality').notNullable().defaultTo('normal')
      .comment('品质：normal / uncommon / rare / epic / legendary');
    table.integer('sort_order').notNullable().defaultTo(0)
      .comment('排序序号（控制兑换命令发送顺序）');
    table.index(['cdk_code_id'], 'idx_cdk_code_items_code_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cdk_code_items');
  const hasGiftName = await knex.schema.hasColumn('cdk_codes', 'gift_name');
  if (hasGiftName) {
    await knex.schema.alterTable('cdk_codes', (table) => {
      table.dropColumn('gift_name');
      table.dropColumn('gift_description');
    });
  }
}
