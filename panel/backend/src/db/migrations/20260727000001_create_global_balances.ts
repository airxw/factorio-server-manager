// ============================================================================
// 20260727000001_create_global_balances.ts
// 用户中心经济系统：全局余额表（global_balances）
//
// 设计目标：
//   全平台统一余额账户——每个用户一行，承载充值/消费/冻结/提现的总量视图。
//   与实例积分（instance_points，见 20260727000002）分离：余额是全局货币，
//   积分是实例级消耗品。
//
// 字段说明：
//   balance          可用余额（CHECK balance >= 0）
//   total_earned     累计收入
//   total_spent      累计消费
//   frozen_balance   冻结余额（CDKey 生成 / 提现申请时冻结）
//   total_withdrawn  累计已提现
//   last_income_at   最近一笔入账时间（充值超限等规则使用）
//
// 数据迁移：
//   存量 user_wallets（实例级钱包）按 user_id 聚合 SUM 合并进 global_balances，
//   frozen_balance / total_withdrawn 初始化为 0；onConflict ignore 保证幂等。
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + 存量聚合合并（幂等，可重复执行）
//   - down：DROP TABLE（回滚后存量合并数据随之删除，user_wallets 原表不受影响）
//   - user_wallets 表不存在时（全新部署）跳过存量合并
//
// 方案文档：docs/plans/user-center-consolidation-plan.md
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`global_balances\` (
      \`user_id\` TEXT PRIMARY KEY,
      \`balance\` INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      \`total_earned\` INTEGER NOT NULL DEFAULT 0,
      \`total_spent\` INTEGER NOT NULL DEFAULT 0,
      \`frozen_balance\` INTEGER NOT NULL DEFAULT 0,
      \`total_withdrawn\` INTEGER NOT NULL DEFAULT 0,
      \`last_income_at\` TEXT,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ------------------------------------------------------------------
  // 存量数据迁移：user_wallets 按 user_id 聚合合并进 global_balances
  // ------------------------------------------------------------------
  if (!(await knex.schema.hasTable('user_wallets'))) {
    console.log(
      '[migration 20260727000001] global_balances 建表完成（user_wallets 表不存在，跳过存量合并）',
    );
    return;
  }

  const walletSums = await knex('user_wallets')
    .select('user_id')
    .sum('balance as total_balance')
    .sum('total_earned as total_earned_sum')
    .sum('total_spent as total_spent_sum')
    .groupBy('user_id');

  for (const row of walletSums) {
    await knex('global_balances')
      .insert({
        user_id: row.user_id as string,
        balance: Number(row.total_balance ?? 0),
        total_earned: Number(row.total_earned_sum ?? 0),
        total_spent: Number(row.total_spent_sum ?? 0),
        frozen_balance: 0,
        total_withdrawn: 0,
        last_income_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .onConflict('user_id')
      .ignore();
  }

  console.log(
    `[migration 20260727000001] global_balances 建表完成，合并 ${walletSums.length} 个用户的存量钱包余额`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('global_balances');
  console.log('[migration 20260727000001] 回滚：删除 global_balances 表');
}
