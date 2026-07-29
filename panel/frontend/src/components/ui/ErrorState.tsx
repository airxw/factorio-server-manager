// ============================================================================
// ErrorState — 加载失败错误态组件（五.12）
// 替代各页面散落的 <div className="alert alert-error"> + 手写重试按钮
// 统一为 <ErrorState error={err} onRetry={refresh} />
// ============================================================================

import type { ReactNode } from 'react';

interface ErrorStateProps {
  /** 错误对象或错误文案 */
  error: Error | string | null;
  /** 重试回调（不传则不展示重试按钮） */
  onRetry?: () => void;
  /** 重试按钮文字 */
  retryLabel?: string;
  /** 是否正在重试中（禁用按钮） */
  retrying?: boolean;
  /** 自定义辅助说明 */
  description?: ReactNode;
}

export default function ErrorState({
  error,
  onRetry,
  retryLabel = '重试',
  retrying = false,
  description,
}: ErrorStateProps) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || '未知错误';

  return (
    <div className="alert alert-error" role="alert">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 200 }}>
          <strong>加载失败：</strong>
          {message}
          {description && (
            <div className="form-hint" style={{ marginTop: 4 }}>
              {description}
            </div>
          )}
        </span>
        {onRetry && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={onRetry}
            disabled={retrying}
            style={{ flexShrink: 0 }}
          >
            {retrying ? '重试中…' : retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
