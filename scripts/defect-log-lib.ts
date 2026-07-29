import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DEFECT_LOG_PATH = path.join(ROOT, 'docs/defect-log.md');
export const DEFECT_CHECKLIST_PATH = path.join(ROOT, 'docs/defect-checklist.md');

export type DefectLevel = 'P0' | 'P1' | 'P2';
export type DefectCategory = 'deploy' | 'code' | 'fullstack' | 'config' | 'security';

export interface DefectEntry {
  id: string;
  title: string;
  level: DefectLevel | null;
  levelRaw: string;
  category: DefectCategory | null;
  categoryRaw: string;
  firstVersion: string;
  phenomenon: string;
  rootCause: string;
  solution: string;
  prevention: string;
  status: string;
  artifacts: string;
}

const VALID_CATEGORIES: readonly DefectCategory[] = [
  'deploy',
  'code',
  'fullstack',
  'config',
  'security',
];

export function normalizeLevel(raw: string): DefectLevel | null {
  const value = raw.trim().toUpperCase();
  if (value.startsWith('P0')) return 'P0';
  if (value.startsWith('P1')) return 'P1';
  if (value.startsWith('P2')) return 'P2';
  return null;
}

export function normalizeCategory(raw: string): DefectCategory | null {
  const value = raw.trim().toLowerCase();
  return VALID_CATEGORIES.includes(value as DefectCategory) ? (value as DefectCategory) : null;
}

function parseTable(sectionBody: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = sectionBody.split('\n');
  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key === '字段' || /^-+$/.test(key)) continue;
    fields[key] = value;
  }
  return fields;
}

export function ensureDefectLogFile(): void {
  if (fs.existsSync(DEFECT_LOG_PATH)) return;
  const initial = `# 缺陷隐患库

> 本文件由 \`scripts/defect-record.ts\` / \`scripts/defect-sync.ts\` 维护。
> 
> 结构说明：
> - 新条目统一以 \`### DEF-xxx: 标题\` 开头
> - P0/P1 条目必须补齐“转化状态=已转化”和“转化产物”
> - 录入入口：\`npm run defect:record -- ...\`
>
> 若当前没有条目，本文件仅保留表头说明。
`;
  fs.writeFileSync(DEFECT_LOG_PATH, initial, 'utf8');
}

export function parseDefectLog(): DefectEntry[] {
  ensureDefectLogFile();
  const raw = fs.readFileSync(DEFECT_LOG_PATH, 'utf8');
  const headerRegex = /^###\s+(DEF-\d+):\s*(.+)$/gm;
  const headers = [...raw.matchAll(headerRegex)];
  const entries: DefectEntry[] = [];

  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];
    const bodyStart = current.index! + current[0].length;
    const bodyEnd = next ? next.index! : raw.length;
    const fields = parseTable(raw.slice(bodyStart, bodyEnd).trim());

    entries.push({
      id: current[1],
      title: current[2].trim(),
      level: normalizeLevel(fields['等级'] ?? ''),
      levelRaw: fields['等级'] ?? '',
      category: normalizeCategory(fields['类别'] ?? ''),
      categoryRaw: fields['类别'] ?? '',
      firstVersion: fields['首次发生版本'] ?? '',
      phenomenon: fields['现象'] ?? '',
      rootCause: fields['根因'] ?? '',
      solution: fields['解决方案'] ?? '',
      prevention: fields['预防措施'] ?? '',
      status: fields['转化状态'] ?? '',
      artifacts: fields['转化产物'] ?? '',
    });
  }

  return entries;
}

export function nextDefectId(entries: DefectEntry[]): string {
  const max = entries.reduce((acc, entry) => {
    const match = entry.id.match(/^DEF-(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `DEF-${String(max + 1).padStart(3, '0')}`;
}

interface DefectEntryDraft {
  id: string;
  title: string;
  level: string;
  levelRaw?: string;
  category: string;
  categoryRaw?: string;
  firstVersion: string;
  phenomenon: string;
  rootCause: string;
  solution: string;
  prevention: string;
  status: string;
  artifacts: string;
}

export function formatDefectEntry(entry: DefectEntryDraft): string {
  const artifacts = entry.artifacts.trim() || '—';
  return `### ${entry.id}: ${entry.title}

| 字段 | 值 |
|------|-----|
| ID | ${entry.id} |
| 等级 | ${entry.levelRaw ?? entry.level} |
| 类别 | ${entry.categoryRaw ?? entry.category} |
| 首次发生版本 | ${entry.firstVersion} |
| 现象 | ${entry.phenomenon} |
| 根因 | ${entry.rootCause} |
| 解决方案 | ${entry.solution} |
| 预防措施 | ${entry.prevention} |
| 转化状态 | ${entry.status} |
| 转化产物 | ${artifacts} |
`;
}

export function appendDefectEntry(markdownBlock: string): void {
  ensureDefectLogFile();
  const existing = fs.readFileSync(DEFECT_LOG_PATH, 'utf8').trimEnd();
  const next = `${existing}\n\n${markdownBlock.trim()}\n`;
  fs.writeFileSync(DEFECT_LOG_PATH, next, 'utf8');
}

export function renderChecklist(entries: DefectEntry[]): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const levels: DefectLevel[] = ['P0', 'P1', 'P2'];
  const categories: DefectCategory[] = ['deploy', 'code', 'fullstack', 'config', 'security'];
  const total = entries.length;
  const countByLevel = Object.fromEntries(levels.map((level) => [level, entries.filter((e) => e.level === level).length])) as Record<DefectLevel, number>;
  const lines: string[] = [
    '# 隐患转化检查清单',
    '',
    `> 生成时间：${now}`,
    `> 总条目：${total}（P0: ${countByLevel.P0} / P1: ${countByLevel.P1} / P2: ${countByLevel.P2}）`,
    '',
  ];

  for (const level of levels) {
    lines.push(`## ${level}`);
    lines.push('');
    const levelEntries = entries.filter((entry) => entry.level === level);
    if (levelEntries.length === 0) {
      lines.push('- 暂无条目');
      lines.push('');
      continue;
    }
    for (const category of categories) {
      const group = levelEntries.filter((entry) => entry.category === category);
      if (group.length === 0) continue;
      lines.push(`### ${category}`);
      lines.push('');
      for (const entry of group) {
        const statusOk = entry.status.trim() === '已转化';
        const icon = !statusOk && (entry.level === 'P0' || entry.level === 'P1') ? '⚠️' : statusOk ? '✅' : '📝';
        lines.push(`- ${icon} \`${entry.id}\` ${entry.title}`);
        lines.push(`  - 转化状态：${entry.status || '未填写'}`);
        lines.push(`  - 转化产物：${entry.artifacts || '未填写'}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeChecklist(content: string): void {
  fs.writeFileSync(DEFECT_CHECKLIST_PATH, content, 'utf8');
}

export function summarize(entries: DefectEntry[]): Record<string, number> {
  return {
    total: entries.length,
    p0: entries.filter((entry) => entry.level === 'P0').length,
    p1: entries.filter((entry) => entry.level === 'P1').length,
    p2: entries.filter((entry) => entry.level === 'P2').length,
    unconverted: entries.filter((entry) => entry.status.trim() !== '已转化').length,
  };
}

export function validateEntries(entries: DefectEntry[]): string[] {
  const problems: string[] = [];
  const ids = entries.map((entry) => entry.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    problems.push('DEF-ID 出现重复');
  }

  const numericIds = ids
    .map((id) => id.match(/^DEF-(\d+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  for (let i = 0; i < numericIds.length; i += 1) {
    if (numericIds[i] !== i + 1) {
      problems.push(`DEF-ID 不连续：期望 DEF-${String(i + 1).padStart(3, '0')}，实际缺失`);
      break;
    }
  }

  for (const entry of entries) {
    if (!entry.level) {
      problems.push(`${entry.id} 缺少合法等级（P0/P1/P2）`);
    }
    if (!entry.category) {
      problems.push(`${entry.id} 缺少合法类别（deploy/code/fullstack/config/security）`);
    }
    if ((entry.level === 'P0' || entry.level === 'P1') && entry.status.trim() !== '已转化') {
      problems.push(`${entry.id} 为 ${entry.level}，但转化状态不是“已转化”`);
    }
    if ((entry.level === 'P0' || entry.level === 'P1') && !entry.artifacts.trim()) {
      problems.push(`${entry.id} 为 ${entry.level}，但转化产物为空`);
    }
  }

  return problems;
}
