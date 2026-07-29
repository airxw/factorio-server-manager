// ============================================================================
// useUndoToast — 撤销通知钩子（7.4 撤销 / 软删除机制）
// 显示带「撤销」按钮的 Toast，超时后自动消失并视为操作确认。
// 用法：
//   const { showUndo, undoToastElement } = useUndoToast();
//   showUndo('已删除实例', () => { void refetch(); }, 5000);
//   // 在组件 JSX 中渲染 {undoToastElement}
// ============================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface UndoToastState {
  id: number;
  message: string;
  onUndo: () => void;
  /** 撤销按钮显示文案，执行中切换为「恢复中…」 */
  status: 'idle' | 'recovering';
}

/** 默认撤销窗口时长（毫秒） */
const DEFAULT_UNDO_TIMEOUT = 5000;

let undoToastIdCounter = 0;

export function useUndoToast(): {
  showUndo: (message: string, onUndo: () => void, timeout?: number) => void;
  /** 需在组件 JSX 中渲染此元素 */
  undoToastElement: ReactNode | null;
} {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUndoRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    onUndoRef.current = null;
    setToast(null);
  }, [clearTimer]);

  const showUndo = useCallback(
    (message: string, onUndo: () => void, timeout: number = DEFAULT_UNDO_TIMEOUT) => {
      clearTimer();
      onUndoRef.current = onUndo;
      const id = ++undoToastIdCounter;
      setToast({ id, message, onUndo, status: 'idle' });
      if (timeout > 0) {
        timerRef.current = setTimeout(() => {
          dismiss();
        }, timeout);
      }
    },
    [clearTimer, dismiss],
  );

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const handleUndo = useCallback(async () => {
    const fn = onUndoRef.current;
    if (!fn) return;
    setToast((prev) => (prev ? { ...prev, status: 'recovering' } : prev));
    try {
      await fn();
    } finally {
      dismiss();
    }
  }, [dismiss]);

  const undoToastElement = toast ? (
    <div className="toast-container undo-toast-container" aria-live="polite" aria-atomic="true">
      <div className="toast toast-info undo-toast" role="status">
        <span className="toast-icon" aria-hidden="true">
          ↺
        </span>
        <div className="toast-content">
          <div className="toast-message">{toast.message}</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm undo-toast-btn"
          onClick={handleUndo}
          disabled={toast.status === 'recovering'}
          aria-label="撤销此操作"
        >
          {toast.status === 'recovering' ? '恢复中…' : '撤销'}
        </button>
        <button
          type="button"
          className="toast-close"
          onClick={dismiss}
          aria-label="关闭通知"
        >
          ×
        </button>
      </div>
    </div>
  ) : null;

  return { showUndo, undoToastElement };
}
