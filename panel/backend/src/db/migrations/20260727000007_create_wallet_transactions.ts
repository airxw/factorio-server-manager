// ============================================================================
// 20260727000007_create_wallet_transactions.ts
// 用户中心经济系统：交易流水表（wallet_transactions）
//
// 设计目标：
//   全经济系统统一流水——余额 / 积分 / 成长积分的每一笔变动都必须落一条
//   流水，支撑审计、对账、退费关联（refund_tx_id）与幂等（order_id 部分唯一索引）。
//
// 字段说明：
//   user_id          变动主体
//   server_id        关联实例（全局余额变动为 NULL）
//   currency_type    币种：'balance' / 'points' / 'integral'
//   type             变动类型（如 recharge/consume/exchange/freeze/unfreeze/withdraw/refund 等）
//   amount           变动金额（正=入账，负=出账）
//   balance_after    变动后余额（冗余快照，便于审计）
//   linked_tx_id     关联交易（如冻结 ↔ 解冻互链）
//   order_id         外部订单号（幂等键，部分唯一索引：非 NULL 时唯一）
//   cdk_id           关联 CDKey（cdk_keys.id）
//   withdraw_code_id 关联提现码（withdraw_codes.id）
//   description      人类可读描述
//   operator_user_id 操作者（管理员调整时与 user_id 不同）
//   trace_id         请求级追踪 ID（必填）
//
// 索引：
//   idx_wallet_tx_user / server / type / currency / created 五个普通索引
//   idx_wallet_tx_order_id 部分唯一索引（WHERE order_id IS NOT NULL）
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS（幂等）
//   - down：DROP TABLE（索引随表删除）
//
// 方案文档：docs/plans/user-center-consolidation-plan.md §六
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`wallet_transactions\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`user_id\` TEXT NOT NULL,
      \`server_id\` TEXT,
      \`currency_type\` TEXT NOT NULL,
      \`type\` TEXT NOT NULL,
      \`amount\` INTEGER NOT NULL,
      \`balance_after\` INTEGER NOT NULL,
      \`linked_tx_id\` INTEGER,
      \`order_id\` TEXT,
      \`cdk_id\` INTEGER,
      \`withdraw_code_id\` INTEGER,
      \`description\` TEXT,
      \`operator_user_id\` TEXT,
      \`trace_id\` TEXT NOT NULL,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_wallet_tx_user` ON `wallet_transactions` (`user_id`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_wallet_tx_server` ON `wallet_transactions` (`server_id`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_wallet_tx_type` ON `wallet_transactions` (`type`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_wallet_tx_currency` ON `wallet_transactions` (`currency_type`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_wallet_tx_created` ON `wallet_transactions` (`created_at`)');
  // 幂等键：order_id 非 NULL 时全局唯一（SQLite 部分索引）
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS `idx_wallet_tx_order_id` ON `wallet_transactions` (`order_id`) WHERE `order_id` IS NOT NULL',
  );

  console.log('[migration 20260727000007] wallet_transactions 建表完成（5 个普通索引 + 1 个部分唯一索引）');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wallet_transactions');
  console.log('[migration 20260727000007] 回滚：删除 wallet_transactions 表');
}
