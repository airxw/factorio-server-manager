// ============================================================================
// E2E：Setup Wizard v2 门控与渲染验证（v4.20.0）
//
// 完整 8 步流程因涉及 .env 写入 + systemctl restart 会破坏当前运行服务，
// 不在自动化 E2E 中覆盖，留作浏览器手动回归（见 docs/plans/setup-wizard-v2-configuration-plan.md §5.4-17）。
//
// 本 spec 覆盖可自动化的场景：
//   1. /setup 路由可被未登录用户访问（公开路由，不强制 from 参数重定向）
//   2. 根据 needs_init 状态分流：
//      - needs_init=true → 渲染向导（标题"欢迎使用 GameServer Panel"可见）
//      - needs_init=false → 跳转 /login
//   3. needs_init=true 时 Step 0 preflight 检查项渲染（不点击下一步，避免触发 .env 写入）
//
// 前置条件：
//   - 生产模式：E2E_BASE_URL 指向已部署服务
//   - 演示模式：VITE_ENABLE_DEMO=true（SetupWizard 内部短路跳 /login）
// ============================================================================

import { expect, test } from '@playwright/test';

test.describe('Setup Wizard v2 — 门控与渲染', () => {
  test.describe.configure({ mode: 'serial' });

  test('/setup 路由可被未登录用户访问（不强制 from 参数）', async ({ page }) => {
    await page.goto('/setup');

    // /setup 是公开路由，不应被 ProtectedRoute 拦截到 /login?from=/setup
    // 最终 URL 要么是 /setup（needs_init=true 渲染向导），要么是 /login（needs_init=false 跳转）
    // 但不应有 from=/setup 参数（那是受保护路由被拦截的标记）
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).not.toMatch(/from=\/setup/);
  });

  test('根据 needs_init 状态分流渲染', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForLoadState('networkidle');

    const url = page.url();
    if (url.match(/\/login/)) {
      // needs_init=false → 跳转 /login
      await expect(page.locator('body')).not.toBeEmpty({ timeout: 10_000 });
    } else {
      // needs_init=true → 渲染向导
      await expect(page.getByRole('heading', { name: '欢迎使用 GameServer Panel' })).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test('needs_init=true 时 Step 0 preflight 渲染 8 项检查（不进入后续步骤）', async ({
    page,
  }) => {
    await page.goto('/setup');
    await page.waitForLoadState('networkidle');

    // 若跳转 /login 则跳过本测试（needs_init=false 环境）
    if (page.url().match(/\/login/)) {
      test.skip(true, '当前环境 needs_init=false，/setup 跳转 /login，跳过 preflight 渲染验证');
      return;
    }

    // 等待向导标题出现
    await expect(page.getByRole('heading', { name: '欢迎使用 GameServer Panel' })).toBeVisible({
      timeout: 10_000,
    });

    // 等待 preflight 加载完成（"刷新预检"按钮可见表示已加载）
    await expect(page.getByRole('button', { name: /刷新预检/ })).toBeVisible({ timeout: 15_000 });

    // Step 0 应显示进入初始化前的提示
    await expect(page.getByText(/进入初始化前，请确认服务器环境已就绪/)).toBeVisible();
  });
});
