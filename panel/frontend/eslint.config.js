// ============================================================================
// ESLint Flat Config — React 19 + Vite 6 + TypeScript 5.5
// 依据四.5：typescript-eslint + react-hooks + react-refresh + prettier
// ============================================================================

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // ---------------------------------------------------------------------------
  // 全局忽略
  // ---------------------------------------------------------------------------
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'node_modules/**',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
    ],
  },

  // ---------------------------------------------------------------------------
  // 基础规则集
  // ---------------------------------------------------------------------------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------------------
  // TypeScript / TSX 文件 — React + Hooks + Refresh + Prettier
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier: prettierPlugin,
    },
    settings: {
      react: {
        version: '19',
      },
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // React Hooks（官方推荐规则）
      ...reactHooks.configs.recommended.rules,

      // set-state-in-effect：v7 新增的严格规则，禁止在 effect 中同步调用 setState。
      // 本项目数据获取普遍采用 useEffect + setState 模式，63 处实例的彻底修复
      // 依赖四.7 的 React Query 迁移。此处降级为 warn，保持 lint 通过且可见提醒。
      'react-hooks/set-state-in-effect': 'warn',

      // incompatible-library：React Compiler 对 TanStack Virtual 的 useVirtualizer
      // 返回非可记忆函数的告警，属已知兼容性提示（Compiler 自动跳过记忆化），非真实缺陷。
      'react-hooks/incompatible-library': 'off',

      // react-refresh：仅允许导出组件（HMR 安全）
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // React 19 + jsx: react-jsx → 关闭未使用 React 导入的告警
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Prettier：格式问题作为 warn（不阻断 lint:fix 之外的流程）
      'prettier/prettier': 'warn',

      // TypeScript：允许未显式标注返回类型（项目现有风格）
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // 允许 any（逐步收敛，当前不强制禁用）
      '@typescript-eslint/no-explicit-any': 'off',

      // 未使用变量：允许以 _ 前缀显式忽略
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // 测试文件 — 放宽部分规则
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // Prettier 兼容层 — 关闭与 Prettier 冲突的格式化规则（必须放最后）
  // ---------------------------------------------------------------------------
  prettierConfig,
);
