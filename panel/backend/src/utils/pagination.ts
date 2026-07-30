// ============================================================================
// utils/pagination — 分页参数归一化公共工具
//
// v4.33.0 技术债提炼批（W3 / M5）：收敛 5 处散落的内联分页解析
// （userCenter 局部函数 / auditLogService / store-gm / users / meSecurity）。
//
// 统一口径：page >= 1；1 <= pageSize <= MAX_PAGE_SIZE；默认 DEFAULT_PAGE_SIZE。
// ============================================================================

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * 将 Express query 原始值（string | number | 其他）归一化为正整数，非法值回落 fallback。
 * 与原各内联实现语义一致：非数字 / < 1 一律回退；"3.7" 截断为 3。
 */
export function parsePositiveInt(raw: unknown, fallback: number): number {
  const n =
    typeof raw === 'string' || typeof raw === 'number'
      ? Number.parseInt(String(raw), 10)
      : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/**
 * 从 Express req.query 解析分页参数（字符串语义：page / page_size）。
 * 返回 { page, pageSize, offset }，pageSize 上限 MAX_PAGE_SIZE。
 */
export function parsePagination(query: { page?: unknown; page_size?: unknown }): PaginationParams {
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(query.page_size, DEFAULT_PAGE_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * 数字入参变体（服务层已持有 number | undefined 的 opts 对象时使用）。
 */
export function clampPagination(page?: number, pageSize?: number): PaginationParams {
  const p = Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
  const psRaw =
    Number.isInteger(pageSize) && (pageSize as number) >= 1
      ? (pageSize as number)
      : DEFAULT_PAGE_SIZE;
  const ps = Math.min(MAX_PAGE_SIZE, psRaw);
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}
