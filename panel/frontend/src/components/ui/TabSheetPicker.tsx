// ============================================================================
// TabSheetPicker — v4.38.0 移动端 Tab 选择器（底部 ActionSheet）
// 替代 ServerDetailCore 旧版打平横滑条（.mobile-tab-scroller）：
//   - 触发器：底部固定按钮，显示当前 tab 名 + 展开图标，点击拉起 sheet
//   - Sheet：从底部滑入，按分组（runtime/config/ops/business）列出全部可见 tab
//   - 关闭：遮罩点击 / ESC / 选中任意 tab 后自动关闭
// 不接管滑动手势——useSwipe 仍由外层 tabContentRef 绑定（E6 裁决）
// 仅在 <768px 视口渲染（由调用方 isMobileTabView 控制），桌面端不挂载
// ============================================================================

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronUp, X } from 'lucide-react';

export interface TabSheetPickerGroup {
  group: string;
  tabs: Array<{ tab: string; order?: number }>;
}

export interface TabSheetPickerProps {
  /** 当前激活 tab key */
  activeTab: string;
  /** 分组后的 tab 列表（有序：runtime → config → ops → business） */
  groupedTabs: TabSheetPickerGroup[];
  /** 分组显示名映射（group → 中文名） */
  groupLabels: Record<string, string>;
  /** tab key → 显示名（调用方处理 businessLabel 等动态名） */
  getTabLabel: (tabKey: string) => string;
  /** 选中普通 tab 时回调（组件内部会关闭 sheet 后调用） */
  onSelectTab: (tabKey: string) => void;
  /** 选中 business pseudo-tab 时回调（点击即跳转 /business） */
  onSelectBusiness?: () => void;
  /** business pseudo-tab 的 key，默认 '__business__' */
  businessTabKey?: string;
  /** 无障碍标签 */
  ariaLabel?: string;
}

export default function TabSheetPicker({
  activeTab,
  groupedTabs,
  groupLabels,
  getTabLabel,
  onSelectTab,
  onSelectBusiness,
  businessTabKey = '__business__',
  ariaLabel = '实例标签页选择器',
}: TabSheetPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // 打开时聚焦 sheet，关闭时还原焦点到触发器
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (sheet) {
      // 聚焦 sheet 容器本身（tabindex=-1），便于 ESC 立即生效
      sheet.focus();
    }
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  // ESC 关闭（sheet 打开时）
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // 打开时锁定背景滚动（避免 sheet 滚动串到 body）
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleSelect = useCallback(
    (tabKey: string) => {
      const isBusiness = tabKey === businessTabKey;
      setOpen(false);
      // 关闭动画后再触发跳转，避免 sheet 卸载与导航竞争
      // 但 React 状态更新批处理下，先关闭再调用回调即可
      if (isBusiness) {
        onSelectBusiness?.();
        return;
      }
      onSelectTab(tabKey);
    },
    [businessTabKey, onSelectBusiness, onSelectTab],
  );

  // 当前 tab 显示名（找不到时回落到 activeTab 原值）
  const currentLabel = (() => {
    for (const g of groupedTabs) {
      const found = g.tabs.find((t) => t.tab === activeTab);
      if (found) return getTabLabel(activeTab);
    }
    // business pseudo-tab 可能不在 groupedTabs（已折叠为单项），用 getTabLabel 兜底
    return getTabLabel(activeTab) || activeTab;
  })();

  const totalTabs = groupedTabs.reduce((sum, g) => sum + g.tabs.length, 0);

  // 触发器键盘：Enter/Space 已由 <button> 默认处理；ArrowDown 打开 sheet
  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  // sheet 内键盘：←→ 在可见 tab 间循环
  const handleSheetKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const allKeys = groupedTabs.flatMap((g) => g.tabs.map((t) => t.tab));
    if (allKeys.length === 0) return;
    const idx = allKeys.indexOf(activeTab);
    const baseIdx = idx === -1 ? 0 : idx;
    const next =
      e.key === 'ArrowRight'
        ? (baseIdx + 1) % allKeys.length
        : (baseIdx - 1 + allKeys.length) % allKeys.length;
    handleSelect(allKeys[next]);
  };

  return (
    <div className="tab-sheet-picker" role="tablist" aria-label={ariaLabel}>
      <button
        ref={triggerRef}
        type="button"
        className="tab-sheet-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="tab-sheet-trigger-label">{currentLabel}</span>
        <span className="tab-sheet-trigger-meta" aria-hidden="true">
          {totalTabs > 0 ? `${totalTabs} 项` : ''}
        </span>
        <ChevronUp size={16} className={`tab-sheet-trigger-icon${open ? ' open' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="tab-sheet-overlay"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            className="tab-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={handleSheetKeyDown}
          >
            <div className="tab-sheet-header">
              <span className="tab-sheet-title">选择标签页</span>
              <button
                type="button"
                className="tab-sheet-close"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="tab-sheet-body">
              {groupedTabs.length === 0 && (
                <div className="tab-sheet-empty">暂无可用标签页</div>
              )}
              {groupedTabs.map(({ group, tabs }) => (
                <div key={group} className="tab-sheet-group">
                  <div className="tab-sheet-group-label">
                    {groupLabels[group] ?? group}
                    <span className="tab-sheet-group-count" aria-hidden="true">
                      {tabs.length}
                    </span>
                  </div>
                  <div className="tab-sheet-group-items">
                    {tabs.map((tabObj) => {
                      const tabKey = tabObj.tab;
                      const active = activeTab === tabKey;
                      const isBusiness = tabKey === businessTabKey;
                      return (
                        <button
                          key={tabKey}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`tab-sheet-item${active ? ' active' : ''}`}
                          onClick={() => handleSelect(tabKey)}
                        >
                          <span>{getTabLabel(tabKey)}</span>
                          {isBusiness && (
                            <span className="tab-sheet-item-hint" aria-hidden="true">
                              跳转
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
