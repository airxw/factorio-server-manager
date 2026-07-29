import {
  parseDefectLog,
  renderChecklist,
  summarize,
  validateEntries,
  writeChecklist,
} from './defect-log-lib.js';

const entries = parseDefectLog();
const checklist = renderChecklist(entries);
writeChecklist(checklist);

const problems = validateEntries(entries);
const stats = summarize(entries);

console.log(`已生成 docs/defect-checklist.md（总数 ${stats.total}，P0 ${stats.p0} / P1 ${stats.p1} / P2 ${stats.p2}）`);

if (problems.length > 0) {
  console.error('\n缺陷隐患库完整性校验失败：');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log('✅ defect-log 完整性校验通过');

