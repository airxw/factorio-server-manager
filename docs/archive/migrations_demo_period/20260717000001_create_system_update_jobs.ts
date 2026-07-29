// ============================================================================
// 20260717000001_create_system_update_jobs.ts
// 模块0_系统自更新：system_update_jobs 表迁移（knex 扫描入口）
//
// 实际实现位于 modules/模块0_系统自更新/migration_20260717000001_create_system_update_jobs.ts
// 本文件为 knex migrations 目录的扫描入口，re-export up/down 以便 knex CLI 加载。
//
// 若 knex CLI 不支持 re-export（ESM loader 限制），则需将完整实现复制到本文件。
// ============================================================================

export { up, down } from '../../../../../modules/模块0_系统自更新/migration_20260717000001_create_system_update_jobs.js';
