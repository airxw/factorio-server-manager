// ============================================================================
// v4.39.2: Daemon 生产打包（esbuild）
// 产物：dist/index.js —— 单文件 ESM bundle（node dist/index.js 直接运行）
// 设计：
//   - packages: 'external' —— node_modules 全部保持外部依赖（生产 npm install 提供）
//   - alias @public → 仓库根 public/（编译期解析路径别名，运行时无依赖）
//   - adapters 中的 await import('../bootstrap.js') 为字面量动态导入，esbuild 内联处理
//   - index.ts 的 package.json 版本号 import 编译期内联（构建时版本即运行版本）
// ============================================================================

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const daemonDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(daemonDir, '..');
const outDir = path.join(daemonDir, 'dist');

// 清理旧产物（历史 tsc 输出为嵌套结构，esbuild 产物为单文件）
fs.rmSync(outDir, { recursive: true, force: true });

await build({
  platform: 'node',
  format: 'esm',
  target: 'node20',
  bundle: true,
  packages: 'external',
  alias: { '@public': path.join(repoRoot, 'public') },
  logLevel: 'warning',
  entryPoints: [path.join(daemonDir, 'src', 'index.ts')],
  outfile: path.join(outDir, 'index.js'),
});

console.log('[build-dist] 完成: dist/index.js');
