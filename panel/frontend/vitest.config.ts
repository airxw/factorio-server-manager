// ============================================================================
// Vitest 配置 — jsdom 环境 + @ / @public 别名 + setupFiles
// 别名与 vite.config.ts 保持一致，确保测试代码与生产代码解析路径相同
// ============================================================================

import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@public': fileURLToPath(new URL('../../public', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost:3000/' },
    },
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      // 排除非业务文件：入口、测试基础设施、类型声明、mock
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/mocks/**',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.d.ts',
        'e2e/**',
      ],
      // 七.4: 覆盖率阈值——基于当前基线设置安全网，随测试补充逐步提高
      // 目标：核心工具(src/utils/) 100%，组件(src/components/) 60%+，整体 50%+
      // 当前阶段：整体阈值设为基线以下，避免 CI 阻断；通过 test:coverage:utils 单独强制 utils 100%
      ...(process.env.COVERAGE_SCOPE === 'utils'
        ? {
            include: ['src/utils/**'],
            thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
          }
        : {
            thresholds: { lines: 4, functions: 15, branches: 15, statements: 4 },
          }),
    },
  },
});
