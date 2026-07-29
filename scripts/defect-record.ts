import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  appendDefectEntry,
  formatDefectEntry,
  nextDefectId,
  parseDefectLog,
  type DefectCategory,
} from './defect-log-lib.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VALID_CATEGORIES = new Set<DefectCategory>(['deploy', 'code', 'fullstack', 'config', 'security']);

interface RecordOptions {
  error?: string;
  solution?: string;
  rootCause?: string;
  category?: string;
  level?: string;
  title?: string;
  prevention?: string;
  firstVersion?: string;
}

function parseArgs(argv: string[]): RecordOptions {
  const options: RecordOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--error' && next) {
      options.error = next;
      i += 1;
    } else if (arg === '--solution' && next) {
      options.solution = next;
      i += 1;
    } else if (arg === '--root-cause' && next) {
      options.rootCause = next;
      i += 1;
    } else if (arg === '--category' && next) {
      options.category = next;
      i += 1;
    } else if (arg === '--level' && next) {
      options.level = next;
      i += 1;
    } else if (arg === '--title' && next) {
      options.title = next;
      i += 1;
    } else if (arg === '--prevention' && next) {
      options.prevention = next;
      i += 1;
    } else if (arg === '--first-version' && next) {
      options.firstVersion = next;
      i += 1;
    }
  }
  return options;
}

async function promptMissing(options: RecordOptions): Promise<RecordOptions> {
  if (options.error && options.solution && options.category) return options;
  if (!process.stdin.isTTY) {
    throw new Error('缺少必填参数：--error、--solution、--category');
  }
  const rl = readline.createInterface({ input, output });
  try {
    const nextOptions = { ...options };
    if (!nextOptions.error) nextOptions.error = await rl.question('现象 / 错误：');
    if (!nextOptions.solution) nextOptions.solution = await rl.question('解决方案：');
    if (!nextOptions.rootCause) nextOptions.rootCause = await rl.question('根因（可留空）：');
    if (!nextOptions.category) nextOptions.category = await rl.question('类别（deploy/code/fullstack/config/security）：');
    if (!nextOptions.level) nextOptions.level = await rl.question('等级（默认 P2）：');
    if (!nextOptions.prevention) nextOptions.prevention = await rl.question('预防措施（可留空）：');
    return nextOptions;
  } finally {
    rl.close();
  }
}

function normalizeLevel(raw?: string): string {
  if (!raw) return 'P2一般';
  const value = raw.trim().toUpperCase();
  if (value.startsWith('P0')) return 'P0致命';
  if (value.startsWith('P1')) return 'P1严重';
  return 'P2一般';
}

async function main(): Promise<void> {
  const initial = parseArgs(process.argv.slice(2));
  const options = await promptMissing(initial);

  if (!options.error?.trim()) {
    throw new Error('缺少错误现象（--error）');
  }
  if (!options.solution?.trim()) {
    throw new Error('缺少解决方案（--solution）');
  }
  if (!options.category?.trim() || !VALID_CATEGORIES.has(options.category.trim().toLowerCase() as DefectCategory)) {
    throw new Error('类别必须是 deploy/code/fullstack/config/security 之一');
  }

  const entries = parseDefectLog();
  const id = nextDefectId(entries);
  const title = options.title?.trim() || options.error.trim().slice(0, 48);
  const category = options.category.trim().toLowerCase();
  const level = normalizeLevel(options.level);

  appendDefectEntry(
    formatDefectEntry({
      id,
      title,
      level,
      levelRaw: level,
      category,
      categoryRaw: category,
      firstVersion: options.firstVersion?.trim() || '待补',
      phenomenon: options.error.trim(),
      rootCause: options.rootCause?.trim() || '待补',
      solution: options.solution.trim(),
      prevention: options.prevention?.trim() || '待补',
      status: '未转化',
      artifacts: '—',
    }),
  );

  execFileSync('npx', ['tsx', 'scripts/defect-sync.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  console.log(`✅ 已录入 ${id}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

