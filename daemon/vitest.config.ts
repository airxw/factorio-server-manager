// ============================================================================
// Vitest 配置 — node 环境 + @public 别名 + v8 覆盖率
// 别名与 tsconfig.json paths 保持一致，确保测试代码与生产代码解析路径相同
// ============================================================================

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@public': fileURLToPath(new URL('../public', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      // 排除非业务文件：类型声明、steamcmd 外部命令包装、测试基础设施
      exclude: [
        'src/**/*.d.ts',
        'src/steamcmd/**',
        'src/test/**',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      // 初始阈值基线 5%，随测试补充逐步提高
      thresholds: { lines: 5, functions: 5, branches: 5, statements: 5 },
    },
  },
});
