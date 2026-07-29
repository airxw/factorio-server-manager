// ============================================================================
// 20260829000000_create_login_history.ts
// 登录历史表（login_history）
//
// 设计目标：
//   记录每一次登录尝试（成功 + 失败），补齐登录环节审计断链。
//   与 audit_logs 解耦——audit_logs 记录已认证用户的业务操作，
//   login_history 专记登录流水（含设备/失败维度），便于用户查看本人登录历史
//   与"上次登录信息"提示，并支持失败尝试追溯（暴力破解/撞库排查）。
//
// 字段说明：
//   user_id          目标用户 ID。成功=本人；失败但用户存在=目标用户；用户不存在=NULL
//   login_type       登录结果枚举：success / fail_password / fail_disabled /
//                    fail_unverified / fail_not_found
//   login_input      登录输入（email 或 username）。仅在失败且用户不存在时记录
//                    （脱敏：邮箱保留首字符+域名，用户名保留首尾各 1 字符）；
//                    成功与密码错误时不记（隐私）
//   ip_address       客户端 IP（优先 X-Forwarded-For 首段，回退 req.ip）
//   user_agent       原始 UA 字符串（截断 512 字符）
//   device_summary   解析后可读设备名（ua-parser-js 生成，如 "Chrome 120 / Windows 10"）
//   session_id       JWT jti（若签发），用于关联会话与登出/吊销追溯
//   failure_reason   失败详情（account_disabled / email_not_verified / password_mismatch 等）
//   retention_days   保留天数（与 audit_logs 对齐，默认 90）
//   created_at       记录时间
//
// 索引：
//   idx_login_history_user_created  (user_id, created_at) — 用户侧查询主索引
//   idx_login_history_created       (created_at)          — 清理任务用
//   idx_login_history_ip            (ip_address, created_at) — 风控查询（按 IP 聚合异常）
//
// 兼容性：
//   - up：CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS（幂等）
//   - down：DROP TABLE（索引随表删除）
//   - 不修改任何现有表（users / audit_logs 字段不动），无破坏性变更
//
// 方案文档：docs/plans/login-history-and-personal-activity-log-plan.md §2.1 / §5.1
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS \`login_history\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`user_id\` TEXT,
      \`login_type\` TEXT NOT NULL,
      \`login_input\` TEXT,
      \`ip_address\` TEXT,
      \`user_agent\` TEXT,
      \`device_summary\` TEXT,
      \`session_id\` TEXT,
      \`failure_reason\` TEXT,
      \`retention_days\` INTEGER NOT NULL DEFAULT 90,
      \`created_at\` TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_login_history_user_created` ON `login_history` (`user_id`, `created_at`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_login_history_created` ON `login_history` (`created_at`)');
  await knex.raw('CREATE INDEX IF NOT EXISTS `idx_login_history_ip` ON `login_history` (`ip_address`, `created_at`)');

  console.log('[migration 20260829000000] login_history 建表完成（3 个索引）');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('login_history');
  console.log('[migration 20260829000000] 回滚：删除 login_history 表');
}
