// ============================================================================
// Vitest 配置 — node 环境 + @ / @public 别名 + v8 覆盖率
// 别名与 tsconfig.json 的 paths 保持一致，确保测试代码与生产代码解析路径相同
// ============================================================================

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@public': fileURLToPath(new URL('../../public', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      // 排除非业务文件：迁移脚本、类型声明、测试基础设施、测试文件本身、构建产物
      exclude: [
        'src/db/migrations/**',
        'src/**/*.d.ts',
        'src/types/**',
        'src/test/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'dist/**',
      ],
      // 基线阈值：当前仅 3 个 Service 有测试（apiKeyService/passwordPolicy/safeRemoveService），
      // 全局 lines/statements ≈ 0.76%、functions 8.64%、branches 24.44%。
      // 随测试补充逐步提高至 5%（T1 计划目标）。
      thresholds: { lines: 0.5, functions: 5, branches: 5, statements: 0.5 },
    },
  },
});
