// ============================================================================
// 20260717000002_add_token_version_and_password_history.ts
// 模块3_用户安全：users.token_version + user_password_history 表迁移（knex 扫描入口）
//
// 实际实现位于 modules/模块3_用户安全/migration_20260717000002_add_token_version_and_password_history.ts
// 本文件为 knex migrations 目录的扫描入口，re-export up/down 以便 knex CLI 加载。
// ============================================================================

export { up, down } from '../../../../../modules/模块3_用户安全/migration_20260717000002_add_token_version_and_password_history.js';
