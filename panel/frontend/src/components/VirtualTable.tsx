// ============================================================================
// VirtualTable — 通用虚拟化表格（三.2）
// 用于千行级数据滚动保持 60fps。基于 @tanstack/react-virtual。
// 仅渲染可视区域行 + overscan，行高可变（measureElement 动态测量）。
// 列宽通过 CSS grid 模板控制，header 固定在滚动容器顶部。
// ============================================================================

import { type ReactNode, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS grid 列宽（如 '120px' / '1fr' / '2fr'），默认 '1fr' */
  width?: string;
  /** 单元格额外 className */
  className?: string;
  render: (row: T, index: number) => ReactNode;
}

interface VirtualTableProps<T> {
  columns: VirtualColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  /** 行高估算值，默认 44px */
  estimateRowHeight?: number;
  rowClassName?: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  /** 滚动容器最大高度（px），默认 600 */
  maxHeight?: number;
  emptyState?: ReactNode;
}

export default function VirtualTable<T>({
  columns,
  rows,
  rowKey,
  estimateRowHeight = 44,
  rowClassName,
  onRowClick,
  maxHeight = 600,
  emptyState,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  const gridTemplate = columns.map((c) => c.width ?? '1fr').join(' ');

  if (rows.length === 0 && emptyState) {
    return <div className="virtual-table-wrap">{emptyState}</div>;
  }

  return (
    <div className="virtual-table-wrap" style={{ maxHeight }}>
      {/* 固定表头：与行使用同一 grid 模板保证列对齐 */}
      <div className="virtual-table-header" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((c) => (
          <div key={c.key} className={c.className}>
            {c.header}
          </div>
        ))}
      </div>

      <div className="virtual-table-body" ref={scrollRef}>
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <div
                key={rowKey(row, vi.index)}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className={`virtual-table-row${rowClassName ? ` ${rowClassName(row, vi.index)}` : ''}${onRowClick ? ' clickable' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  gridTemplateColumns: gridTemplate,
                }}
                onClick={onRowClick ? () => onRowClick(row, vi.index) : undefined}
              >
                {columns.map((c) => (
                  <div key={c.key} className={c.className}>
                    {c.render(row, vi.index)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
