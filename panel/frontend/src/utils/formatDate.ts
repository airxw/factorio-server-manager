// ============================================================================
// 日期格式化工具（五.16）— 统一全站日期展示
// 默认格式：YYYY-MM-DD HH:mm:ss
// 用法：formatDate(isoString) / formatDate(isoString, 'YYYY-MM-DD')
// ============================================================================

/**
 * 将 ISO 字符串 / Date / 时间戳格式化为指定模式。
 * @param date ISO 字符串、Date 对象或毫秒时间戳
 * @param pattern 格式模式，默认 'YYYY-MM-DD HH:mm:ss'
 *                支持 YYYY MM DD HH mm ss
 */
export function formatDate(
  date: string | Date | number | null | undefined,
  pattern: string = 'YYYY-MM-DD HH:mm:ss',
): string {
  if (date === null || date === undefined) return '—';
  const d = typeof date === 'object' ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';

  const pad = (n: number) => String(n).padStart(2, '0');
  return pattern
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}

/** 仅日期：YYYY-MM-DD */
export function formatDateOnly(date: string | Date | number | null | undefined): string {
  return formatDate(date, 'YYYY-MM-DD');
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function formatRelative(date: string | Date | number | null | undefined): string {
  if (date === null || date === undefined) return '—';
  const d = typeof date === 'object' ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(d, 'YYYY-MM-DD');
}
