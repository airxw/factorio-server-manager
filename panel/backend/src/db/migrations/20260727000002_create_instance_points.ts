// ============================================================================
// 20260727000002_create_instance_points.ts
// 用户中心经济系统：实例积分表（instance_points）
//
// 设计目标：
//   实例级积分账户——（user_id, server_id）复合主键，承载用户在单个实例内
//   的积分余额与累计收支。积分是实例级消耗品，与全局余额（global_balances）分离。
//
// 字段说明：
//   balance       当前积分余额（CHECK balance >= 0）
//   total_earned  累计获得
//   total_spent   累计消耗
//
// 数据迁移：
//   存量 user_wallets 全量行拷贝进 instance_points（user_id/server_id/balance/
//   total_earned/total_spent 直接映射，保留原 created_at/updated_at）；
//   onConflict ignore 保证幂等。
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + 存量拷贝（幂等，可重复执行）
//   - down：DROP TABLE（user_wallets 原表不受影响）
//   - user_wallets 表不存在时（全新部署）跳过存量拷贝
//
// 方案文档：docs/plans/user-center-consolidation-plan.md
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`instance_points\` (
      \`user_id\` TEXT NOT NULL,
      \`server_id\` TEXT NOT NULL,
      \`balance\` INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      \`total_earned\` INTEGER NOT NULL DEFAULT 0,
      \`total_spent\` INTEGER NOT NULL DEFAULT 0,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      \`updated_at\` TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (\`user_id\`, \`server_id\`)
    )
  `);

  // ------------------------------------------------------------------
  // 存量数据迁移：user_wallets 全量行映射进 instance_points
  // ------------------------------------------------------------------
  if (!(await knex.schema.hasTable('user_wallets'))) {
    console.log(
      '[migration 20260727000002] instance_points 建表完成（user_wallets 表不存在，跳过存量拷贝）',
    );
    return;
  }

  const wallets = await knex('user_wallets').select('*');
  for (const w of wallets) {
    await knex('instance_points')
      .insert({
        user_id: w.user_id as string,
        server_id: w.server_id as string,
        balance: Number(w.balance ?? 0),
        total_earned: Number(w.total_earned ?? 0),
        total_spent: Number(w.total_spent ?? 0),
        created_at: (w.created_at as string | null) ?? new Date().toISOString(),
        updated_at: (w.updated_at as string | null) ?? new Date().toISOString(),
      })
      .onConflict(['user_id', 'server_id'])
      .ignore();
  }

  console.log(
    `[migration 20260727000002] instance_points 建表完成，拷贝 ${wallets.length} 条存量钱包记录`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_points');
  console.log('[migration 20260727000002] 回滚：删除 instance_points 表');
}
