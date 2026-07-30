// ============================================================================
// utils/date — 日期公共工具
//
// v4.33.0 技术债提炼批（W3 / L6）：收敛 6 处散落的 `toISOString().slice(0, 10)` 内联。
// ============================================================================

/**
 * UTC 日期键（YYYY-MM-DD）。
 * 等价于 `d.toISOString().slice(0, 10)`，默认取当前时间。
 */
export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
