// ============================================================================
// 20260727000008_create_withdraw_codes.ts
// 用户中心经济系统：提现码表（withdraw_codes）
//
// 设计目标：
//   余额提现载体——用户申请提现后生成提现码（code 唯一），余额先冻结；
//   管理员线下打款后审核通过，冻结金额转为 total_withdrawn；拒绝或过期
//   则解冻退回。
//
// 字段说明：
//   code             提现码（全局唯一，展示给用户/客服核销）
//   user_id          申请人
//   amount           申请金额（冻结额度）
//   actual_amount    实际到账金额（按 ratio 折算）
//   ratio            提现折算比率（申请时快照）
//   status           'pending'（默认）/ 'approved' / 'rejected' / 'expired'
//   operator_user_id 审核管理员
//   approved_at      审核时间
//   expires_at       过期时间（必填，过期未审核自动解冻）
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + code 唯一索引（幂等）
//   - down：DROP TABLE
//
// 方案文档：docs/plans/user-center-consolidation-plan.md
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`withdraw_codes\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`code\` TEXT NOT NULL UNIQUE,
      \`user_id\` TEXT NOT NULL,
      \`amount\` INTEGER NOT NULL,
      \`actual_amount\` INTEGER NOT NULL,
      \`ratio\` REAL NOT NULL,
      \`status\` TEXT NOT NULL DEFAULT 'pending',
      \`operator_user_id\` TEXT,
      \`approved_at\` TEXT,
      \`expires_at\` TEXT NOT NULL,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log('[migration 20260727000008] withdraw_codes 建表完成');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('withdraw_codes');
  console.log('[migration 20260727000008] 回滚：删除 withdraw_codes 表');
}
