// ============================================================================
// LoadingButton — 异步按钮组件
// 五.11: loading 状态显示 spinner + 文字，禁用同时保持可读性
// 用法：<LoadingButton loading={submitting} onClick={...}>保存</LoadingButton>
// ============================================================================

import { type ButtonHTMLAttributes, type ReactNode } from 'react';

interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 是否处于加载态 */
  loading?: boolean;
  /** 加载态显示的文字（默认沿用 children） */
  loadingText?: ReactNode;
  /** 按钮变体（沿用现有 .btn-xxx 类名） */
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'ghost';
  /** 尺寸 */
  size?: 'sm' | 'md' | 'block';
  children: ReactNode;
}

export default function LoadingButton({
  loading = false,
  loadingText,
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled,
  ...rest
}: LoadingButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    size === 'block' ? 'btn-block' : '',
    'btn-loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-live="polite"
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      <span className={loading ? 'btn-text-loading' : 'btn-text'}>
        {loading ? loadingText ?? children : children}
      </span>
    </button>
  );
}
