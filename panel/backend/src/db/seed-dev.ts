// ============================================================================
// Dev Seed 独立脚本 — 供 Test2 浏览器核对前一键填充 dev 数据库
// 用法：npm run seed:dev
// 填充内容：3 个演示账号 (admin/manager/user @local.dev，密码 admin123) + 本地节点
// 幂等：已存在的记录跳过，可重复执行
// ============================================================================

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, runMigrations, closeDatabase } from './connection.js';
import { seedDemoAccountsIfMissing, seedLocalNodeIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  const dbUrl = process.env.DATABASE_URL ?? './data/panel.db';
  console.log(`[seed:dev] DATABASE_URL=${dbUrl}`);

  const db = initDatabase(dbUrl);

  console.log('[seed:dev] 运行 migrations...');
  await runMigrations();

  console.log('[seed:dev] seed 演示账号 (admin@local.dev / manager@local.dev / user@local.dev，密码 admin123)...');
  await seedDemoAccountsIfMissing(db);

  console.log('[seed:dev] seed 本地节点 (node-local)...');
  await seedLocalNodeIfEmpty(db);

  await closeDatabase();
  console.log('[seed:dev] 完成。可用凭据：admin@local.dev / admin123');
}

main().catch((err) => {
  console.error('[seed:dev] 失败:', err);
  process.exit(1);
});
