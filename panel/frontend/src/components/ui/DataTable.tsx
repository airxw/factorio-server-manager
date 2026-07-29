// ============================================================================
// DataTable — 通用数据表格（loading / empty / error / 分页态统一）
// 替代各页面重复的 if(loading)/if(error)/if(empty)/<table> 模板代码
// 列定义通过 columns prop 声明，支持自定义单元格渲染
// ============================================================================

import type { ReactNode } from 'react';
import EmptyState from './EmptyState';
import Skeleton from './Skeleton';
import Pagination from './Pagination';

export interface DataTableColumn<T> {
  /** 列标题 */
  header: ReactNode;
  /** 从行数据取值的键（或自定义渲染） */
  accessor?: keyof T;
  /** 自定义单元格渲染 */
  render?: (row: T, index: number) => ReactNode;
  /** 列样式类（如 col-actions） */
  className?: string;
  /** 列宽 */
  width?: string | number;
}

interface DataTableProps<T> {
  /** 数据行 */
  rows: T[];
  /** 列定义 */
  columns: DataTableColumn<T>[];
  /** 行唯一键 */
  rowKey: (row: T) => string | number;
  /** 加载中 */
  loading?: boolean;
  /** 加载骨架行数（loading=true 时展示），默认 5 */
  skeletonRows?: number;
  /** 错误信息（非 null 时展示错误态） */
  error?: string | null;
  /** 空状态文案 */
  emptyTitle?: string;
  /** 空状态操作区 */
  emptyAction?: ReactNode;
  /** 空状态描述 */
  emptyDescription?: ReactNode;
  /** 分页：当前页（从 1 开始），不传则不分页 */
  page?: number;
  /** 分页：总页数 */
  totalPages?: number;
  /** 分页：页码切换回调 */
  onPageChange?: (page: number) => void;
  /** 点击行回调 */
  onRowClick?: (row: T) => void;
  /** 表格容器自定义类名 */
  className?: string;
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  skeletonRows = 5,
  error = null,
  emptyTitle = '暂无数据',
  emptyAction,
  emptyDescription,
  page,
  totalPages,
  onPageChange,
  onRowClick,
  className,
}: DataTableProps<T>) {
  // 错误态
  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  // 加载态：骨架屏
  if (loading) {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} className={col.className} style={{ width: col.width }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: skeletonRows }).map((_, r) => (
              <tr key={r}>
                {columns.map((col, c) => (
                  <td key={c} className={col.className}>
                    <Skeleton lines={1} lineHeight={14} lastLineWidth={80} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 空态
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  // 数据态
  return (
    <>
      <div className="table-wrap">
        <table className={`data-table ${className ?? ''}`}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} className={col.className} style={{ width: col.width }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((col, c) => (
                  <td key={c} className={col.className}>
                    {col.render
                      ? col.render(row, rIdx)
                      : col.accessor
                        ? String(row[col.accessor] ?? '')
                        : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page !== undefined && totalPages !== undefined && onPageChange && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      )}
    </>
  );
}
