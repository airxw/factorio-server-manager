// ============================================================================
// 20260901000000_add_cdk_reusable.ts
// v4.37.0: CDK 可重复使用支持
//
// 设计目标：
//   将 cdk_codes 从「一次性兑换码」扩展为支持多次兑换的权益码：
//   - max_uses=1（默认）：一次性，保持原 unused→claiming→claimed 流程不变
//   - max_uses=N（>1）：可被 N 个不同玩家兑换，每次兑换写入 cdk_redemptions
//   - max_uses=0：无限次，直到过期前任意已登录玩家均可兑换
//
// 新增列（cdk_codes）：
//   max_uses    最大使用次数（NOT NULL DEFAULT 1，向后兼容存量数据）
//   use_count   已使用次数（NOT NULL DEFAULT 0；一次性 CDK 兑换后更新为 1）
//
// 新增表（cdk_redemptions）：
//   记录多次用 CDK 的每次兑换（玩家名 + 时间）。
//   - 一次性 CDK（max_uses=1）不写入此表，仍用 cdk_codes.claimed_player/claimed_at
//   - 通过 (cdk_code_id, player_name) 唯一索引防止同一玩家重复兑换同一 CDK
//   - ON DELETE CASCADE：删除 CDK 时自动清理兑换记录
//
// 兼容性说明：
//   - SQLite ALTER TABLE ADD COLUMN 支持 DEFAULT，存量行自动获得 max_uses=1, use_count=0
//   - 一次性 CDK 兑换后服务层会将 use_count 同步为 1（迁移不回填，避免歧义；
//     use_count=0 + status='claimed' 仅出现在历史一次性 CDK 上，不影响多次用逻辑判断）
//   - 多次用判断前提：max_uses !== 1；存量数据 max_uses=1 全部走原一次性分支
//
// 方案：本文件对应 CDK 机制改造完整方案（用户审批通过）
// ============================================================================

import type { Knex } from 'knex';

const NEW_COLUMNS = ['max_uses', 'use_count'] as const;

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('cdk_codes'))) {
    console.log('[migration 20260901000000] cdk_codes 表不存在，跳过可重复使用扩展');
    return;
  }

  // 逐列 hasColumn 检查，仅添加缺失列（幂等）
  const added: string[] = [];
  for (const col of NEW_COLUMNS) {
    if (await knex.schema.hasColumn('cdk_codes', col)) {
      continue;
    }
    await knex.schema.alterTable('cdk_codes', (table) => {
      if (col === 'max_uses') {
        table.integer('max_uses').notNullable().defaultTo(1);
      } else if (col === 'use_count') {
        table.integer('use_count').notNullable().defaultTo(0);
      }
    });
    added.push(col);
  }

  console.log(
    added.length > 0
      ? `[migration 20260901000000] cdk_codes 扩展完成：新增 ${added.join('/')} 共 ${added.length} 列`
      : '[migration 20260901000000] cdk_codes 扩展列已全部存在，幂等跳过',
  );

  // 新建 cdk_redemptions 表（多次用 CDK 的每次兑换记录）
  if (!(await knex.schema.hasTable('cdk_redemptions'))) {
    await knex.schema.createTable('cdk_redemptions', (table) => {
      table.increments('id').primary();
      table.integer('cdk_code_id').notNullable();
      table.string('player_name', 255).notNullable();
      table.text('redeemed_at').notNullable();
      table.foreign('cdk_code_id').references('cdk_codes.id').onDelete('CASCADE');
      table.index(['cdk_code_id'], 'idx_cdk_redemptions_code_id');
      // 唯一约束：同一玩家不能重复兑换同一 CDK（防刷）
      table.unique(['cdk_code_id', 'player_name'], 'uq_cdk_redemptions_code_player');
    });
    console.log('[migration 20260901000000] cdk_redemptions 表创建完成');
  } else {
    console.log('[migration 20260901000000] cdk_redemptions 表已存在，跳过创建');
  }
}

export async function down(knex: Knex): Promise<void> {
  // 先删表（含外键依赖）
  if (await knex.schema.hasTable('cdk_redemptions')) {
    await knex.schema.dropTable('cdk_redemptions');
    console.log('[migration 20260901000000] 回滚：删除 cdk_redemptions 表');
  }

  if (await knex.schema.hasTable('cdk_codes')) {
    for (const col of NEW_COLUMNS) {
      if (await knex.schema.hasColumn('cdk_codes', col)) {
        await knex.schema.alterTable('cdk_codes', (table) => {
          table.dropColumn(col);
        });
      }
    }
    console.log('[migration 20260901000000] 回滚：删除 cdk_codes 的 max_uses/use_count 列');
  }
}
