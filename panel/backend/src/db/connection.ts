// ============================================================================
// Knex 数据库连接配置
// 默认使用 SQLite（sqlite3 驱动，自带预编译二进制）
// L3 迁移预备：DATABASE_URL 以 postgres:// 或 postgresql:// 开头时自动切换 PostgreSQL
// ============================================================================

import knex, { type Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance: Knex | null = null;

/**
 * v4.39.2: 迁移目录双模式解析（build pipeline 重构）
 * - tsx/dev 模式：__dirname = src/db → src/db/migrations（.ts 源文件，tsx 加载）
 * - node dist 生产模式：__dirname = dist → dist/db/migrations（esbuild 编译的 .js）
 * 通过目录存在性判定，不依赖硬编码路径假设。
 */
function resolveMigrationsConfig(): { directory: string; extension: string } {
  const bundledDir = path.join(__dirname, 'db', 'migrations');
  if (fs.existsSync(bundledDir)) {
    return { directory: bundledDir, extension: 'js' };
  }
  return { directory: path.join(__dirname, 'migrations'), extension: 'ts' };
}

/**
 * 解析 SQLite 数据库文件路径，确保父目录存在
 */
function resolveDbPath(databaseUrl: string): string {
  const dbPath = path.isAbsolute(databaseUrl)
    ? databaseUrl
    : path.resolve(process.cwd(), databaseUrl);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dbPath;
}

/**
 * 判断 DATABASE_URL 是否为 PostgreSQL 连接串
 */
function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

/**
 * 初始化 Knex 实例（单例）
 * @param databaseUrl 数据库连接串：
 *   - `postgres://` / `postgresql://` 前缀 → PostgreSQL
 *   - 其他 → SQLite 文件路径（默认 ./data/panel.db）
 */
export function initDatabase(databaseUrl: string = './data/panel.db'): Knex {
  if (dbInstance) {
    return dbInstance;
  }
  if (isPostgresUrl(databaseUrl)) {
    dbInstance = knex({
      client: 'pg',
      connection: { connectionString: databaseUrl },
      migrations: {
        ...resolveMigrationsConfig(),
        // v4.21.1: 旧 v4.17 前的 58 个增量 migration 已归档到 docs/archive/，
        //   baseline_v4_post_demo.ts 接管所有 schema 建立。
        //   knex_migrations 表残留旧记录会导致 validateMigrationList 抛错，
        //   禁用列表校验让 latest() 仅执行未应用的新 migration。
        disableMigrationsListValidation: true,
      },
    });
  } else {
    const filename = resolveDbPath(databaseUrl);
    dbInstance = knex({
      client: 'sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      migrations: {
        ...resolveMigrationsConfig(),
        disableMigrationsListValidation: true,
      },
    });
  }
  return dbInstance;
}

/**
 * 运行所有未执行的 migrations（latest）
 * 优先使用 migrations 替代 schema.ts 的 createTables
 */
export async function runMigrations(): Promise<void> {
  const db = getDatabase();
  await db.migrate.latest();
}

/**
 * 获取已初始化的 Knex 实例
 */
export function getDatabase(): Knex {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * 关闭数据库连接（用于优雅退出）
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
