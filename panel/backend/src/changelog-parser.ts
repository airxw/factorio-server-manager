// ============================================================================
// 版本更新日志解析（GET /api/version/changelog）
// 从 index.ts 拆分而来，行为等价。
// ============================================================================

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  body: string;
}

export function parseChangelog(): ChangelogEntry[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // From src/changelog-parser.ts → ../../.. → project root
  const versionMdPath = path.resolve(__dirname, '..', '..', '..', 'version.md');
  const raw = fs.readFileSync(versionMdPath, 'utf-8');
  const entries: ChangelogEntry[] = [];

  // 按 "## vX.Y.Z" 分割
  const sections = raw.split(/(?=^## v\d)/m);
  for (const section of sections) {
    const headerMatch = section.match(/^##\s+v([\d.]+)\s*\((.+?)\)/m);
    if (!headerMatch) continue;

    const version = headerMatch[1];
    const date = headerMatch[2];

    // 提取标题（下一行 ### 或 ** 开头的行）
    const bodyStart = section.indexOf('\n', headerMatch.index! + headerMatch[0].length);
    const bodyText = bodyStart > 0 ? section.slice(bodyStart).trim() : '';

    // 取第一行有意义的文字作为标题
    const titleLine = bodyText.split('\n').find((l) =>
      l.startsWith('### ') || l.startsWith('**') || (l.length > 5 && !l.startsWith('- ') && !l.startsWith('  '))
    );
    const title = titleLine ? titleLine.replace(/^###\s+/, '').replace(/\*\*/g, '').trim() : '更新';

    entries.push({ version, date, title, body: bodyText });
  }

  return entries.slice(0, 20); // 最多返回最近 20 条
}
