// ============================================================================
// E2E：v4.15.0 玩家门户四新页面可达性 + 版本管理迁移（G1-G4/G7 闭合验证）
//
// 覆盖 plan（player-portal-completion-redesign-plan）E2E 项：
//   - user 登录 → /guild 首页（GuildDock）可达且无 404
//   - 四新页面逐一可达：/guild/servers、/guild/bind、/guild/cdk、/guild/orders
//   - 首页快捷入口点击跳转 /guild/bind
//   - /guild/versions 不再可达（命中 404 NotFound）
//   - user 访问 /versions → 重定向 /store/versions → 角色门控命中 403 Forbidden
//
// 前置条件：同 instance-flow.spec.ts（demo 账号 + demo 实例已 seed）
// ============================================================================

import { expect, test } from '@playwright/test';
import { ROLE_ACCOUNTS, injectTokenAndGoto } from './helpers';

test.describe('v4.15.0 玩家门户新页面可达性', () => {
  // 桌面端验证；移动端 375px 由 mobile-viewport.spec.ts 覆盖
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '仅在 chromium 项目运行');
  });

  test('user 登录后 /guild 首页渲染（GuildDock 快捷入口可见）', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild');

    await expect(page).toHaveURL(/\/guild$/);
    // GuildDock：游戏角色绑定分区（v4.17.0 起为独立分区，原"绑定角色"快捷入口已移除）+ CDK兑换
    await expect(page.getByText('游戏角色绑定').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('CDK兑换').first()).toBeVisible({ timeout: 10_000 });
    // 不命中 404
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });

  test('/guild/servers 我的服务器列表可达', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild/servers');

    await expect(page).toHaveURL(/\/guild\/servers$/);
    await expect(
      page.getByRole('heading', { name: '我的服务器' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });

  test('/guild/bind 绑定角色管理可达', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild/bind');

    await expect(page).toHaveURL(/\/guild\/bind$/);
    // GuildBind 页头为「绑定管理」h1 + 游戏角色绑定/账户级绑定 双 tab（v4.17.0 向导分支结构）
    await expect(
      page.getByRole('heading', { name: '绑定管理' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: '游戏角色绑定' })).toBeVisible();
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });

  test('/guild/cdk CDK 兑换页可达', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild/cdk');

    await expect(page).toHaveURL(/\/guild\/cdk$/);
    await expect(
      page.getByRole('heading', { name: 'CDK 兑换' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });

  test('/guild/orders 我的订单（跨实例聚合）可达', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild/orders');

    await expect(page).toHaveURL(/\/guild\/orders$/);
    await expect(
      page.getByRole('heading', { name: '我的订单' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });

  test('首页「游戏角色绑定」分区管理入口点击跳转 /guild/bind', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild');

    // GuildDock「游戏角色绑定」分区的「管理」按钮（无条件渲染，不依赖绑定空态）
    const entry = page.getByRole('button', { name: '管理', exact: true }).first();
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await entry.click();
    await expect(page).toHaveURL(/\/guild\/bind$/);
    await expect(
      page.getByRole('heading', { name: '绑定管理' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('/guild/versions 不再可达（版本管理已迁出玩家门户）', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild/versions');

    // 路由已移除 → 命中全局 404
    await expect(page.getByText('404')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('抱歉，您访问的页面不存在')).toBeVisible();
  });

  test('user 访问 /versions 重定向 /store/versions 后命中 403', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/versions');

    // /versions → Navigate /store/versions → RequireRole(instance_admin+) 拦截 → /forbidden
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 15_000 });
    await expect(page.getByText('403')).toBeVisible();
    await expect(page.getByText('抱歉，您没有权限访问该页面')).toBeVisible();
  });

  test('instance_admin 访问 /versions 重定向后正常进入版本管理', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.instance_admin, '/versions');

    // instance_admin 有权限：URL 落在 /store/versions，不命中 403/404
    await expect(page).toHaveURL(/\/store\/versions$/, { timeout: 15_000 });
    await expect(page.getByText('抱歉，您没有权限访问该页面')).not.toBeVisible();
    await expect(page.getByText('抱歉，您访问的页面不存在')).not.toBeVisible();
  });
});
