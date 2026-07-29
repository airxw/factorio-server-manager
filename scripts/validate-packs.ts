// ============================================================================
// validate-packs — 全量 Pack YAML 校验脚本
//
// 步骤 11: 每个 Pack 的 pack.yaml 通过 zod 校验(契约测试)
//
// 扫描 packs/ 目录下所有 pack.yaml,用 GamePackSchema 逐条校验,
// 输出每个 Pack 的校验结果(通过/失败 + 详细错误),并按 exit code 反映整体状态。
//
// 运行方式:npx tsx scripts/validate-packs.ts
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { GamePackSchema } from '../public/schema/pack-schema.js';

// v4.31.0：用 process.cwd() 代替 fileURLToPath(import.meta.url)，
// tsx 在某些环境下 import.meta.url 解析到缓存路径而非源文件路径，导致 PACKS_DIR 找不到
const ROOT = process.cwd();
const PACKS_DIR = path.resolve(ROOT, 'packs');

interface PackResult {
  packId: string;
  filePath: string;
  valid: boolean;
  errors?: string[];
}

/** 收集 packs/ 目录下所有 pack.yaml 文件路径(支持子目录形式) */
function collectPackFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subFile = path.join(dir, entry.name, 'pack.yaml');
      if (fs.existsSync(subFile)) {
        files.push(subFile);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files.sort();
}

/** 从 pack.yaml 内容提取 pack.id(用于日志展示,失败时用文件名兜底) */
function extractPackId(filePath: string, raw: string): string {
  try {
    const parsed = yaml.load(raw) as { pack?: { id?: string } };
    return parsed?.pack?.id ?? path.basename(path.dirname(filePath));
  } catch {
    return path.basename(path.dirname(filePath));
  }
}

function main(): void {
  if (!fs.existsSync(PACKS_DIR)) {
    console.error(`❌ packs 目录不存在: ${PACKS_DIR}`);
    process.exit(1);
  }

  const files = collectPackFiles(PACKS_DIR);
  if (files.length === 0) {
    console.error(`❌ packs 目录下未找到任何 pack.yaml: ${PACKS_DIR}`);
    process.exit(1);
  }

  console.log(`\n📦 Pack 校验开始 (共 ${files.length} 个 Pack)\n`);
  console.log('='.repeat(60));

  const results: PackResult[] = [];
  for (const filePath of files) {
    const relPath = path.relative(ROOT, filePath);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      const packId = path.basename(path.dirname(filePath));
      results.push({
        packId,
        filePath: relPath,
        valid: false,
        errors: [`读取文件失败: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch (e) {
      const packId = extractPackId(filePath, raw);
      results.push({
        packId,
        filePath: relPath,
        valid: false,
        errors: [`YAML 解析失败: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }

    const packId = extractPackId(filePath, raw);
    const result = GamePackSchema.safeParse(parsed);
    if (result.success) {
      results.push({ packId, filePath: relPath, valid: true });
    } else {
      const errors = result.error.issues.map(
        (i) => `  - ${i.path.join('.')}: ${i.message}`,
      );
      results.push({ packId, filePath: relPath, valid: false, errors });
    }
  }

  // 输出每个 Pack 的校验结果
  const passed = results.filter((r) => r.valid);
  const failed = results.filter((r) => !r.valid);

  for (const r of results) {
    if (r.valid) {
      console.log(`✅ ${r.packId.padEnd(28)} ${r.filePath}`);
    } else {
      console.log(`❌ ${r.packId.padEnd(28)} ${r.filePath}`);
      if (r.errors) {
        for (const err of r.errors) {
          console.log(`   ${err}`);
        }
      }
    }
  }

  console.log('='.repeat(60));
  console.log(`\n总计:${passed.length} 通过 / ${failed.length} 失败 / ${results.length} 项\n`);

  if (failed.length > 0) {
    console.log('❌ Pack 校验未通过,请修复上述失败项');
    process.exit(1);
  } else {
    console.log('✅ 全部 Pack 校验通过');
    process.exit(0);
  }
}

main();
