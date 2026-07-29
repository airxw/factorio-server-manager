// ============================================================================
// 字节数格式化工具（v3.6.1）— 统一全站磁盘占用展示
// 默认格式：自动选择 B/KB/MB/GB/TB 单位，保留 2 位小数（B 不保留小数）
// 用法：formatBytes(1234567) → '1.18 MB'
//      formatBytes(null) → '-'
// ============================================================================

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * 将字节数格式化为可读字符串。
 * @param bytes 字节数，null/undefined/<=0 返回 '-'
 * @returns 形如 '1.18 MB' / '500 B' / '-'
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0 || !Number.isFinite(bytes)) return '-';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, i);
  // B 整数显示，其他单位保留 2 位小数
  return `${value.toFixed(i === 0 ? 0 : 2)} ${UNITS[i]}`;
}
