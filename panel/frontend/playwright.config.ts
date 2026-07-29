// ============================================================================
// Playwright E2E 配置（v2：双模式）
//
// 【开发模式】（默认，向后兼容）
// $ npx playwright test
// - baseURL = http://localhost:5173
// - webServer 自动拉起 Vite dev server
// - /api 请求由 vite.config.ts proxy 转发到后端 localhost:3000
// - 凭证默认 admin@local.dev / admin123
//
// 【生产验证模式】（E2E_BASE_URL 指向 https://... 时自动启用）
// $ E2E_BASE_URL=https://gsp.ecsrz.com:3001 npx playwright test
// - baseURL = https://gsp.ecsrz.com:3001（符合 .trae/rules/0.md 最高规则）
// - ignoreHTTPSErrors = true（自签名 *.ecsrz.com 证书）
// - 不启动 webServer（服务器已就绪，禁止 npm run dev）
// - 凭证从 E2E_EMAIL / E2E_PASSWORD 环境变量读取
//
// 也可以指定局域网地址：
// $ E2E_BASE_URL=https://192.168.5.23:3001 npx playwright test
// ============================================================================

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const isProduction = E2E_BASE_URL.startsWith('https://');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // v4.13.0 补跑：生产模式 workers=1，避免多 worker 触发登录限流（10次/15分钟/IP）
  // globalSetup 预登录 3 角色写入文件，workers=1 确保 token 文件读写无竞态
  workers: process.env.CI ? 1 : (isProduction ? 1 : undefined),
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // v4.13.0 补跑：globalSetup 预登录 3 角色，避免多 worker 重复登录触发 429
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(isProduction ? { ignoreHTTPSErrors: true } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // v4.13.0 步骤28: 移动端 375px 视口验证（Player Portal 店铺化布局）
    // 用于验证 rules-0 §3.1.6 移动端视口守卫：禁止 height: 100vh 强制
    // 验证 plan §28: Banner 占顶部 ≥30% 视口高度
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
      },
    },
  ],

  // 仅开发模式启动 Vite dev server；生产模式服务器已就绪，严禁 npm run dev
  ...(isProduction
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          cwd: __dirname,
        },
      }),
});
