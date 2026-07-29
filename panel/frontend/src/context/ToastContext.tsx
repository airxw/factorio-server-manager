// ============================================================================
// ToastContext — 全局通知系统（context + provider + useToast hook）
// 提供 success / error / info / warning 四个方法：
//   - 3 秒自动消失 + 手动关闭按钮
//   - 错误 Toast 附带「查看详情」展开（显示完整错误信息）
//   - 最多同时显示 5 条，超出时底部追加 + 顶部移除（保留最新 5 条）
//   - 容器固定右上角，z-index 9999，aria-live="polite"
//   - 错误/警告 role="alert"，成功/信息 role="status"
// 用法：
//   1. 在 App 顶层包裹 <ToastProvider>
//   2. 组件内 const toast = useToast();
//      toast.success('保存成功');
//      toast.error('保存失败', err);  // err 可为 string | Error | 对象
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  detail?: string;
  duration: number;
}

interface ToastContextValue {
  /** 成功通知（绿色，role=status） */
  success: (message: string, duration?: number) => void;
  /** 错误通知（红色，role=alert）。detail 附带「查看详情」展开，可为 string | Error | 对象 */
  error: (message: string, detail?: unknown, duration?: number) => void;
  /** 信息通知（蓝色，role=status） */
  info: (message: string, duration?: number) => void;
  /** 警告通知（橙色，role=alert） */
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 最多同时显示的 Toast 条数 */
const MAX_TOASTS = 5;
/** 默认自动消失时长（毫秒） */
const DEFAULT_DURATION = 3000;

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

/** 将任意 detail 归一化为可展示字符串 */
function normalizeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (typeof detail === 'string') return detail;
  if (detail instanceof Error) {
    return detail.stack || `${detail.name}: ${detail.message}`;
  }
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 展开了「查看详情」的 Toast id 集合
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setExpandedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, detail: unknown, duration: number) => {
      const id = ++toastIdCounter;
      const normalizedDetail = normalizeDetail(detail);
      setToasts((prev) => {
        const next = [...prev, { id, variant, message, detail: normalizedDetail, duration }];
        // 最多 5 条：超出时保留最新 5 条（顶部移除最旧的，底部追加新的）
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const toggleDetail = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value: ToastContextValue = useMemo(
    () => ({
      success: (m, d) => push('success', m, undefined, d ?? DEFAULT_DURATION),
      error: (m, detail, d) => push('error', m, detail, d ?? DEFAULT_DURATION),
      info: (m, d) => push('info', m, undefined, d ?? DEFAULT_DURATION),
      warning: (m, d) => push('warning', m, undefined, d ?? DEFAULT_DURATION),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器：固定右上角，z-index 9999 */}
      <div className="toast-container" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => {
          const isError = t.variant === 'error' || t.variant === 'warning';
          const expanded = expandedIds.has(t.id);
          return (
            <div
              key={t.id}
              className={`toast toast-${t.variant}`}
              role={isError ? 'alert' : 'status'}
            >
              <span className="toast-icon" aria-hidden="true">
                {VARIANT_ICON[t.variant]}
              </span>
              <div className="toast-content">
                <div className="toast-message">{t.message}</div>
                {t.detail && (
                  <div className="toast-detail-wrapper">
                    <button
                      type="button"
                      className="toast-detail-toggle"
                      onClick={() => toggleDetail(t.id)}
                      aria-expanded={expanded}
                    >
                      {expanded ? '收起详情' : '查看详情'}
                    </button>
                    {expanded && <pre className="toast-detail">{t.detail}</pre>}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="toast-close"
                onClick={() => dismiss(t.id)}
                aria-label="关闭通知"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 ToastProvider 内部使用');
  }
  return ctx;
}
