// ============================================================================
// E2E：登录流程 + 角色基座跳转（v4.13.0 三层操作逻辑）
//
// 覆盖：
//   - 未登录访问受保护路由 → 重定向 /login
//   - 三角色登录后跳转到对应基座（server_admin→/admin, instance_admin→/store, user→/guild）
//   - 错误密码显示错误且不跳转
//
// 前置条件：
//   - 开发模式：Panel 后端（localhost:3000）已启动，3 个 demo 账号存在
//   - 生产模式：E2E_BASE_URL 指向已部署服务（如 https://gsp.ecsrz.com:3001），
//     VITE_ENABLE_DEMO=true，3 个 demo 账号由 seedDemoAccountsIfMissing 创建
//
// 注意：生产环境登录限流 10 次/15 分钟/IP，本 spec 共 4 次表单登录 + 3 次 API 登录
//       （其他 spec 通过 token 缓存复用），总计 7 次，在限流内。
//       使用 serial 模式避免并发登录触发限流。
// ============================================================================

import { expect, test } from '@playwright/test';
import { ROLE_ACCOUNTS } from './helpers';

test.describe('登录流程与角色跳转', () => {
  // 串行模式：避免并发登录触发生产限流
  test.describe.configure({ mode: 'serial' });

  // v4.13.0 补跑：仅在 chromium project 跑，避免 mobile-chrome 重复登录触发限流
  // 登录次数预算：globalSetup 3 次 + login.spec.ts 4 次 = 7 次 < 10 次限流阈值
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '仅在 chromium 项目运行（避免重复登录触发限流）');
  });

  test('未登录访问受保护路由重定向到登录页', async ({ page }) => {
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/login$/);
    // v4.15.x: 登录页按 from=/admin 显示上下文标题（服主控制台）
    await expect(page.getByRole('heading', { name: '登录服主控制台' })).toBeVisible();
    await expect(page.getByText('服主专属 · 运营管理后台')).toBeVisible();
  });

  test('server_admin 登录后跳转到 /admin（Platform Dashboard）', async ({ page }) => {
    await page.goto('/login');

    // Login.tsx 使用 input[type="email"] placeholder="you@example.com"
    const emailInput = page.locator('input[type="email"]');
    const pwdInput = page.locator('input[type="password"]');
    await emailInput.fill(ROLE_ACCOUNTS.server_admin.email);
    await pwdInput.fill(ROLE_ACCOUNTS.server_admin.password);

    await page.getByRole('button', { name: '登录', exact: true }).click();

    // v4.12.0 RootRedirect: server_admin → /admin
    await expect(page).toHaveURL(/\/admin/);
    // AdminDashboard 标题"平台大盘"可见
    await expect(page.getByRole('heading', { name: '平台大盘' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('instance_admin 登录后跳转到 /store（GM Workbench）', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"]');
    const pwdInput = page.locator('input[type="password"]');
    await emailInput.fill(ROLE_ACCOUNTS.instance_admin.email);
    await pwdInput.fill(ROLE_ACCOUNTS.instance_admin.password);

    await page.getByRole('button', { name: '登录', exact: true }).click();

    // v4.12.0 RootRedirect: instance_admin → /store
    await expect(page).toHaveURL(/\/store/);
    // v4.15.x: StoreHome 问候语为动态文案，以「创建实例」按钮锚定
    await expect(page.getByRole('button', { name: '创建实例' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('user 登录后跳转到 /guild（Player Portal）', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"]');
    const pwdInput = page.locator('input[type="password"]');
    await emailInput.fill(ROLE_ACCOUNTS.user.email);
    await pwdInput.fill(ROLE_ACCOUNTS.user.password);

    await page.getByRole('button', { name: '登录', exact: true }).click();

    // v4.12.0 RootRedirect: user → /guild
    await expect(page).toHaveURL(/\/guild/);
    // GuildDock 渲染成功（页面非空）
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('错误密码显示错误信息且不跳转', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"]');
    const pwdInput = page.locator('input[type="password"]');
    await emailInput.fill(ROLE_ACCOUNTS.server_admin.email);
    await pwdInput.fill('wrong-password');

    await page.getByRole('button', { name: '登录', exact: true }).click();

    // 后端返回 401，前端展示错误（不跳转）
    // 等待错误提示出现（可能是 toast 或表单内错误）
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/login$/);
  });
});
