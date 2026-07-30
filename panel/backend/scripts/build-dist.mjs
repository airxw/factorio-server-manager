// ============================================================================
// v4.39.2: Panel Backend 生产打包（esbuild）
// 产物：
//   dist/index.js          —— 应用单文件 ESM bundle（node dist/index.js 直接运行）
//   dist/db/migrations/*.js —— migrations 编译产物（knex 启动迁移目录加载）
//   dist/db/chunks/*.js    —— migrations 共享 chunk（与 migrations 目录隔离，
//                            避免 knex 把共享 chunk 误当 migration 加载）
// 设计：
//   - packages: 'external' —— node_modules 全部保持外部依赖（sqlite3 原生模块、
//     knex 动态 dialect、pino worker transport 等不打入 bundle，生产 npm install 提供）
//   - alias @public → 仓库根 public/（编译期解析路径别名，运行时无依赖）
//   - 源文件统一使用 .js 扩展名导入，bundler resolution 下 esbuild 自动映射 .ts
// ============================================================================

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '../..');
const outDir = path.join(backendDir, 'dist');

// 清理旧产物，保证迁移文件删除后产物同步消失
fs.rmSync(outDir, { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
  platform: 'node',
  format: 'esm',
  target: 'node20',
  bundle: true,
  packages: 'external',
  alias: { '@public': path.join(repoRoot, 'public') },
  logLevel: 'warning',
};

// 1) 应用入口 → dist/index.js
await build({
  ...common,
  entryPoints: [path.join(backendDir, 'src', 'index.ts')],
  outfile: path.join(outDir, 'index.js'),
});

// 2) migrations 多入口编译 → dist/db/migrations/*.js
//    启动时 connection.ts 检测到 dist/db/migrations 存在即切换为 .js 加载模式
const migrationsDir = path.join(backendDir, 'src', 'db', 'migrations');
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(migrationsDir, f));

await build({
  ...common,
  entryPoints: migrationFiles,
  outbase: migrationsDir,
  outdir: path.join(outDir, 'db', 'migrations'),
  splitting: true,
  chunkNames: '../chunks/[name]-[hash]',
});

console.log(
  `[build-dist] 完成: dist/index.js + ${migrationFiles.length} 个 migration 编译产物`,
);
