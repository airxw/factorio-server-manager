// ============================================================================
// Vitest 全局 setup — 注册 jest-dom 自定义匹配器 + jsdom 环境补丁
// 该文件由 vitest.config.ts 的 setupFiles 加载，每个测试文件执行前运行
// ============================================================================

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试结束后卸载已挂载的组件，避免泄漏影响后续用例
afterEach(() => {
  cleanup();
});

// jsdom 不实现 matchMedia，部分组件依赖该 API；缺失时调用会抛错
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom 不实现 URL.createObjectURL / revokeObjectURL，部分代码路径可能引用
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// 每个测试之间重置 localStorage / sessionStorage，避免 token / user 缓存跨用例污染
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
