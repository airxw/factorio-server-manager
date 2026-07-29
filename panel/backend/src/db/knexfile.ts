// ============================================================================
// Knex CLI 配置（knexfile）
// 用法：npx knex migrate:latest --knexfile src/db/knexfile.ts
// ============================================================================

import type { Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载项目根目录的 .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbUrl = process.env.DATABASE_URL ?? './data/panel.db';
// 如果是相对路径，相对于 panel/backend 目录解析
const filename = path.isAbsolute(dbUrl) ? dbUrl : path.resolve(__dirname, '../../', dbUrl);

const config: Knex.Config = {
  client: 'sqlite3',
  connection: {
    filename,
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: 'ts',
    // v4.21.1: 旧 v4.17 前的 58 个增量 migration 已归档到 docs/archive/，
    //   禁用列表校验，避免 knex_migrations 表残留旧记录导致 CLI 失败
    disableMigrationsListValidation: true,
  },
};

export default config;
