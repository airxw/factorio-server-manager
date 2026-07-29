// ============================================================================
// 测试工具 — 自定义 render 包装 MemoryRouter + AuthProvider + QueryClientProvider
// 让页面组件在测试中获得与生产一致的上下文（路由 + 鉴权/API 客户端 + 查询缓存）
// 用法：import { render, screen, userEvent } from '../test/utils';
// ============================================================================

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { AuthProvider } from '../api/auth';
import { ToastProvider } from '../context/ToastContext';
import { ConfirmProvider } from '../context/ConfirmContext';

export { render, screen, within, waitFor, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** MemoryRouter 初始入口，默认 ['/'] */
  initialEntries?: MemoryRouterProps['initialEntries'];
}

interface WrapperProps {
  children: ReactNode;
  initialEntries: NonNullable<RenderWithProvidersOptions['initialEntries']>;
  queryClient: QueryClient;
}

function ProvidersWrapper({ children, initialEntries, queryClient }: WrapperProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * 在 MemoryRouter + AuthProvider + QueryClientProvider 上下文中渲染组件。
 * 默认未登录（无 token）；如需登录态，配合 MSW 拦截 /api/auth/me 并预置 token。
 * 每次渲染创建独立的 QueryClient（关闭 retry 避免测试抖动），隔离缓存。
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { initialEntries = ['/'], ...rest } = options;
  // 四.7: 独立 QueryClient，关闭重试与 gcTime 避免测试间状态泄漏
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ProvidersWrapper initialEntries={initialEntries} queryClient={queryClient}>
      {children}
    </ProvidersWrapper>
  );
  return render(ui, { wrapper: Wrapper, ...rest });
}
