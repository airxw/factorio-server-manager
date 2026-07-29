// ============================================================================
// Pagination — 分页组件
// 替代各页面手写分页 UI，统一 prev/next + 页码展示逻辑
// ============================================================================

interface PaginationProps {
  /** 当前页（从 1 开始） */
  page: number;
  /** 总页数 */
  totalPages: number;
  /** 页码切换回调 */
  onPageChange: (page: number) => void;
  /** 是否禁用（加载中） */
  disabled?: boolean;
}

/** 计算应展示的页码按钮（最多 5 个，当前页居中） */
function getPageRange(current: number, total: number): number[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - 2);
  const end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageRange(page, totalPages);
  const btn = (p: number, label: string, disabledBtn: boolean) => (
    <button
      key={label}
      className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
      onClick={() => !disabledBtn && onPageChange(p)}
      disabled={disabledBtn || disabled}
      aria-label={label}
    >
      {label}
    </button>
  );

  return (
    <div className="pagination" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {btn(1, '«', page === 1)}
      {btn(page - 1, '‹', page === 1)}
      {pages.map((p) => (
        <button
          key={p}
          className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onPageChange(p)}
          disabled={disabled}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}
      {btn(page + 1, '›', page === totalPages)}
      {btn(totalPages, '»', page === totalPages)}
    </div>
  );
}
