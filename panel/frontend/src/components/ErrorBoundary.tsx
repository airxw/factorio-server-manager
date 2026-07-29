// ============================================================================
// ErrorBoundary — React 错误边界（五.2）
// 捕获子组件渲染/生命周期异常，展示友好错误页 + 重试按钮
// 顶层包裹 App，路由级包裹主要页面
// ============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** 自定义错误 UI（默认使用内置友好页） */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** 错误日志标签（用于区分顶层/路由级） */
  name?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发环境打印完整堆栈，生产环境可接入日志上报
    if (import.meta.env.DEV) {
      console.error(
        `[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
        error,
        info.componentStack,
      );
    }
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry);
      }
      return <DefaultErrorFallback error={this.state.error} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// 默认错误页：友好提示 + 重试按钮
// ---------------------------------------------------------------------------
function DefaultErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="page" role="alert">
      <div className="empty-state" style={{ maxWidth: 480, margin: '64px auto' }}>
        <h2 className="page-title" style={{ marginBottom: 8 }}>
          页面出错了
        </h2>
        <p className="form-hint" style={{ marginBottom: 16 }}>
          抱歉，页面渲染时发生错误。可以尝试重试，或返回上一页。
        </p>
        {import.meta.env.DEV && (
          <pre
            style={{
              background: '#1f2933',
              color: '#f87171',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              overflow: 'auto',
              marginBottom: 16,
              textAlign: 'left',
            }}
          >
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={onRetry}>
            重试
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.history.back()}
          >
            返回上一页
          </button>
        </div>
      </div>
    </div>
  );
}
