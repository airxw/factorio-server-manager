// ============================================================================
// 20260727000006_extend_cdk_keys.ts
// 用户中心经济系统：CDKey 表扩展（cdk_codes）
//
// 设计目标：
//   将 cdk_codes 从单一物品兑换码扩展为通用权益载体，支持余额 / 点券 / VIP
//   三类新经济 CDKey，并补齐生成者、过期退费字段，支撑 7 天未兑换自动
//   解冻退回的生命周期。
//
// 新增列：
//   type            CDKey 类型：'item'（默认，兼容存量）/ 'balance' / 'points' / 'vip'
//   amount          金额或点券数量（type=balance/points 时使用）
//   vip_duration    VIP 时长：'monthly' / 'lifetime'（type=vip 时使用）
//   creator_user_id 生成者用户 ID（用户自购生成场景；管理员生成为 NULL）
//   refunded_at     过期退费时间（每日定时任务扫描未兑换且过期的 CDKey 后写入）
//   refund_tx_id    退费关联交易流水 ID（wallet_transactions.id）
//
// 兼容性说明：
//   - 目标表为 cdk_codes（基线 20260808000000 中的真实表名）。
//     早期版本误写为 cdk_keys，hasTable 检查会直接跳过导致列从未添加；
//     本版本修正为 cdk_codes。server_id / expires_at 列基线已存在，自动跳过。
//   - SQLite 的 ALTER TABLE ADD COLUMN 不支持 CHECK 约束（新增列的 CHECK
//     不会对存量行生效且语法受限），故 type 等列的取值校验由应用层保证
//   - up：ADD COLUMN（SQLite 支持，不锁表）
//   - down：DROP COLUMN（SQLite 3.35+ 支持）
//   - cdk_codes 表不存在时（基线未跑到对应版本）直接跳过
//   - 非 item 类型 CDKey 的 item_name 由应用层写入占位文案（列 NOT NULL 保留）
//
// 方案文档：docs/plans/user-center-consolidation-plan.md §5.2
// ============================================================================

import type { Knex } from 'knex';

// 新增列定义（up/down 共用，保证一致）
// 注：server_id / expires_at 在 cdk_codes 基线中已存在，hasColumn 检查会自动跳过
const NEW_COLUMNS = [
  'type',
  'amount',
  'vip_duration',
  'creator_user_id',
  'refunded_at',
  'refund_tx_id',
] as const;

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('cdk_codes'))) {
    console.log('[migration 20260727000006] cdk_codes 表不存在，跳过字段扩展');
    return;
  }

  // 逐列 hasColumn 检查，仅添加缺失列（幂等，可重复执行）
  const added: string[] = [];
  for (const col of NEW_COLUMNS) {
    if (await knex.schema.hasColumn('cdk_codes', col)) {
      continue;
    }
    await knex.schema.alterTable('cdk_codes', (table) => {
      switch (col) {
        case 'type':
          table.text('type').notNullable().defaultTo('item');
          break;
        case 'amount':
          table.integer('amount').nullable();
          break;
        case 'vip_duration':
          table.text('vip_duration').nullable();
          break;
        case 'creator_user_id':
          table.text('creator_user_id').nullable();
          break;
        case 'refunded_at':
          table.text('refunded_at').nullable();
          break;
        case 'refund_tx_id':
          table.integer('refund_tx_id').nullable();
          break;
      }
    });
    added.push(col);
  }

  console.log(
    added.length > 0
      ? `[migration 20260727000006] cdk_codes 扩展完成：新增 ${added.join('/')} 共 ${added.length} 列`
      : '[migration 20260727000006] cdk_codes 扩展列已全部存在，幂等跳过',
  );
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('cdk_codes'))) {
    return;
  }

  for (const col of NEW_COLUMNS) {
    if (await knex.schema.hasColumn('cdk_codes', col)) {
      await knex.schema.alterTable('cdk_codes', (table) => {
        table.dropColumn(col);
      });
    }
  }

  console.log('[migration 20260727000006] 回滚：删除 cdk_codes 扩展的 6 列');
}
