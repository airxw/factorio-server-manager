import {
  parseDefectLog,
  summarize,
  type DefectEntry,
} from './defect-log-lib.js';

interface QueryOptions {
  task?: string;
  error?: string;
  category?: string;
  level?: string;
  keyword?: string;
  id?: string;
  human: boolean;
}

function parseArgs(argv: string[]): QueryOptions {
  const options: QueryOptions = { human: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--human') {
      options.human = true;
    } else if (arg === '--task' && next) {
      options.task = next;
      i += 1;
    } else if (arg === '--error' && next) {
      options.error = next;
      i += 1;
    } else if (arg === '--category' && next) {
      options.category = next;
      i += 1;
    } else if (arg === '--level' && next) {
      options.level = next;
      i += 1;
    } else if (arg === '--keyword' && next) {
      options.keyword = next;
      i += 1;
    } else if (arg === '--id' && next) {
      options.id = next;
      i += 1;
    }
  }
  return options;
}

function scoreEntry(entry: DefectEntry, terms: string[]): number {
  const haystack = [
    entry.id,
    entry.title,
    entry.phenomenon,
    entry.rootCause,
    entry.solution,
    entry.prevention,
    entry.artifacts,
    entry.categoryRaw,
    entry.levelRaw,
  ].join('\n').toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
}

function filterEntries(entries: DefectEntry[], options: QueryOptions): DefectEntry[] {
  let filtered = [...entries];

  if (options.id) {
    filtered = filtered.filter((entry) => entry.id === options.id);
  }
  if (options.category) {
    filtered = filtered.filter((entry) => entry.categoryRaw.toLowerCase() === options.category!.toLowerCase());
  }
  if (options.level) {
    filtered = filtered.filter((entry) => entry.levelRaw.toUpperCase().startsWith(options.level!.toUpperCase()));
  }

  const searchTerms = [options.task, options.error, options.keyword]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.toLowerCase().split(/\s+/).filter(Boolean));

  if (searchTerms.length > 0) {
    filtered = filtered
      .map((entry) => ({ entry, score: scoreEntry(entry, searchTerms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
      .map(({ entry }) => entry);
  }

  return filtered;
}

function printHumanSummary(entries: DefectEntry[]): void {
  const stats = summarize(entries);
  console.log('隐患库摘要');
  console.log('==========');
  console.log(`总数: ${stats.total}`);
  console.log(`P0: ${stats.p0}`);
  console.log(`P1: ${stats.p1}`);
  console.log(`P2: ${stats.p2}`);
  console.log(`未转化: ${stats.unconverted}`);
}

function printHumanEntries(entries: DefectEntry[]): void {
  if (entries.length === 0) {
    console.log('未找到匹配隐患。');
    return;
  }
  for (const entry of entries) {
    console.log(`- ${entry.id} [${entry.levelRaw || '未分级'} / ${entry.categoryRaw || '未分类'}] ${entry.title}`);
    console.log(`  现象: ${entry.phenomenon || '—'}`);
    console.log(`  根因: ${entry.rootCause || '—'}`);
    console.log(`  解决方案: ${entry.solution || '—'}`);
    console.log(`  预防措施: ${entry.prevention || '—'}`);
    console.log(`  转化状态: ${entry.status || '—'}`);
    console.log(`  转化产物: ${entry.artifacts || '—'}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const entries = parseDefectLog();
const hasFilter =
  Boolean(options.task) ||
  Boolean(options.error) ||
  Boolean(options.category) ||
  Boolean(options.level) ||
  Boolean(options.keyword) ||
  Boolean(options.id);

if (!hasFilter) {
  if (options.human) {
    printHumanSummary(entries);
  } else {
    console.log(JSON.stringify({ summary: summarize(entries) }, null, 2));
  }
  process.exit(0);
}

const matched = filterEntries(entries, options);
if (options.human) {
  printHumanEntries(matched);
} else {
  console.log(JSON.stringify({ count: matched.length, entries: matched }, null, 2));
}

