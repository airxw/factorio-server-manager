// ============================================================================
// Knex CLI 配置（PostgreSQL 专用）
// 用法：DATABASE_URL=postgres://user:pass@host:5432/dbname \
//      npx knex migrate:latest --knexfile src/db/knexfile.pg.ts
//
// L3 迁移预备：SQLite → PostgreSQL 双数据库支持
// 与 knexfile.ts 共用同一套 migrations 目录，便于双数据库 CI 校验
// ============================================================================

import type { Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: Knex.Config = {
  client: 'pg',
  connection:
    process.env.DATABASE_URL || 'postgres://localhost/gameserver_panel',
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: 'ts',
    disableMigrationsListValidation: true,
  },
};

export default config;
