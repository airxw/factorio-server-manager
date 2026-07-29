// ============================================================================
// check-all — 根目录统一自检入口
// 串联三项目 verify（typecheck + test + build）+ 版本号校验 + 契约校验
// 用法：npx tsx scripts/check-all.ts
// ============================================================================

import { execSync, type ExecSyncOptions } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const execOpts: ExecSyncOptions = {
  cwd: ROOT,
  stdio: 'inherit',
  encoding: 'utf8',
};

interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: CheckResult[] = [];

function runCheck(name: string, fn: () => void): void {
  const start = Date.now();
  try {
    fn();
    const durationMs = Date.now() - start;
    results.push({ name, passed: true, durationMs });
    console.log(`\n✅ ${name} (${durationMs}ms)\n`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, durationMs, error: errorMsg });
    console.log(`\n❌ ${name} (${durationMs}ms)\n`);
  }
}

// ---------------------------------------------------------------------------
// 1. 版本号同步校验
// ---------------------------------------------------------------------------
runCheck('版本号同步校验', () => {
  execSync('npx tsx scripts/check-version-sync.ts', execOpts);
});

// ---------------------------------------------------------------------------
// 1.5 隐患库完整性校验
// ---------------------------------------------------------------------------
runCheck('隐患库完整性校验', () => {
  execSync('npx tsx scripts/defect-sync.ts', { ...execOpts, stdio: 'pipe' });
});

// ---------------------------------------------------------------------------
// 1.6 Pack YAML 契约校验(步骤11新增)
// ---------------------------------------------------------------------------
runCheck('Pack YAML 契约校验', () => {
  execSync('npx tsx scripts/validate-packs.ts', { ...execOpts, stdio: 'pipe' });
});

// ---------------------------------------------------------------------------
// 2. 后端 verify（typecheck + test + build）
// ---------------------------------------------------------------------------
runCheck('后端 verify（typecheck + test + build）', () => {
  execSync('npm run verify', { ...execOpts, cwd: path.join(ROOT, 'panel/backend') });
});

// ---------------------------------------------------------------------------
// 3. Daemon verify（typecheck + test + build）
// ---------------------------------------------------------------------------
runCheck('Daemon verify（typecheck + test + build）', () => {
  execSync('npm run verify', { ...execOpts, cwd: path.join(ROOT, 'daemon') });
});

// ---------------------------------------------------------------------------
// 4. 前端 verify（typecheck + test + build + localhost 合规校验）
// ---------------------------------------------------------------------------
runCheck('前端 verify（typecheck + build + localhost 合规校验）', () => {
  // 前端 build 已含 typecheck（tsc && vite build && verify）
  // test 单独跑以避免 build 失败掩盖测试失败
  execSync('npm run test', { ...execOpts, cwd: path.join(ROOT, 'panel/frontend') });
  execSync('npm run build', { ...execOpts, cwd: path.join(ROOT, 'panel/frontend') });
});

// ---------------------------------------------------------------------------
// 5. 契约存在性校验
// ---------------------------------------------------------------------------
runCheck('契约文件存在性校验', () => {
  const fs = require('node:fs');
  const requiredPaths = [
    'public/schema/pack-schema.ts',
    'public/schema/panel-api-types.ts',
    'public/schema/ws-events.ts',
    'public/schema/daemon-api-types.ts',
  ];
  const missing: string[] = [];
  for (const p of requiredPaths) {
    if (!fs.existsSync(path.join(ROOT, p))) {
      missing.push(p);
    }
  }
  if (missing.length > 0) {
    throw new Error(`缺失契约文件：\n${missing.map((m) => `  - ${m}`).join('\n')}`);
  }
  console.log('  契约文件全部存在');
});

// ---------------------------------------------------------------------------
// 汇总报告
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log('自检汇总报告');
console.log('='.repeat(60));

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

for (const r of results) {
  const icon = r.passed ? '✅' : '❌';
  console.log(`${icon} ${r.name} (${r.durationMs}ms)`);
  if (!r.passed && r.error) {
    console.log(`   错误：${r.error.split('\n')[0]}`);
  }
}

console.log('='.repeat(60));
console.log(`总计：${passed} 通过 / ${failed} 失败 / ${results.length} 项 (${totalMs}ms)`);

if (failed > 0) {
  console.log('\n❌ 自检未通过，请修复上述失败项');
  process.exit(1);
} else {
  console.log('\n✅ 全部自检通过');
  process.exit(0);
}
