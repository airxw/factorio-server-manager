// ============================================================================
// MobileCardList — 移动端卡片列表共享组件
// 替代各页面重复的 <div className="mobile-card-list mobile-only">…</div> 结构
// 调用方通过 renderHeader/renderBody/renderActions 控制每张卡片内容
// ============================================================================

import type { ReactNode } from 'react';
import EmptyState from './EmptyState';

interface MobileCardListProps<T> {
  /** 数据项列表 */
  items: T[];
  /** 从 item 提取 React key */
  keyExtractor: (item: T) => string | number;
  /** 卡片头部（标题 + 徽章等），渲染于 .mc-item-header */
  renderHeader: (item: T) => ReactNode;
  /** 卡片主体（多个 .mc-row），渲染于 .mc-item 下，与 header/actions 同级以兼容现有 CSS */
  renderBody?: (item: T) => ReactNode;
  /** 卡片操作区（按钮等），渲染于 .mc-actions */
  renderActions?: (item: T) => ReactNode;
  /** 空状态主文案 */
  emptyText?: string;
  /** 空状态辅助说明 */
  emptyDescription?: ReactNode;
  /** 空状态操作区 */
  emptyAction?: ReactNode;
}

/**
 * 移动端卡片列表。仅在 <768px 视口显示（依赖 .mobile-only CSS）。
 * 桌面端隐藏，调用方需自行渲染桌面表格（.desktop-only）。
 */
export default function MobileCardList<T>({
  items,
  keyExtractor,
  renderHeader,
  renderBody,
  renderActions,
  emptyText,
  emptyDescription,
  emptyAction,
}: MobileCardListProps<T>) {
  if (items.length === 0) {
    return (
      <div className="mobile-only">
        <EmptyState
          title={emptyText ?? '暂无数据'}
          description={emptyDescription}
          action={emptyAction}
        />
      </div>
    );
  }

  return (
    <div className="mobile-card-list mobile-only">
      {items.map((item) => (
        <div key={keyExtractor(item)} className="mc-item">
          <div className="mc-item-header">{renderHeader(item)}</div>
          {renderBody && renderBody(item)}
          {renderActions && <div className="mc-actions">{renderActions(item)}</div>}
        </div>
      ))}
    </div>
  );
}
