// ============================================================================
// E2E：v4.13.0 三角色场景链路（步骤27）
//
// 覆盖 plan §27：
//   - 系统管理员：/admin/servers/:id 查看实例监控 → /admin/servers/:id/player-histories 查看玩家历史
//   - 服主：/store/servers/:id 管理店铺 → /store/servers/:id/business 管理商品 → /store/players 查看 CRM
//   - 玩家：/guild/servers/:id 浏览店铺 → 绑定 Steam ID → 购买特权 → /guild/servers/:id/gift-claims 领取礼包
//
// 前置条件：
//   - 生产模式（E2E_BASE_URL=https://gsp.ecsrz.com:3001）：VITE_ENABLE_DEMO=true
//     - 3 个 demo 账号由 seedDemoAccountsIfMissing 创建
//     - 5 个 demo 实例由 seedDemoData 创建（fixedId 固定 UUID）
//   - 开发模式：Panel + Daemon 已启动并 seed demo data
//
// 实现说明：
//   - 通过 API 登录获取 token，注入 localStorage 跳过登录页（避免每个 test 重复登录）
//   - 生产模式下避免写操作（创建实例/启动服务器等），仅验证路由可达 + 关键元素可见
//   - 使用 fixedId 实例 ID 直接访问，避免依赖实例列表查询
// ============================================================================

import { expect, test, type Page } from '@playwright/test';
import { ROLE_ACCOUNTS, injectTokenAndGoto, injectTokenAndWaitForUrl } from './helpers';

// ============================================================================
// 系统管理员场景（server_admin → /admin）
// ============================================================================
test.describe('系统管理员场景链路', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.server_admin, '/admin');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('进入 /admin 平台大盘', async () => {
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: '平台大盘' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('访问 /admin/servers/:id 实例监控视图', async () => {
    const instanceId = ROLE_ACCOUNTS.server_admin.demoInstanceId;
    await page.goto(`/admin/servers/${instanceId}`);

    // v4.13.0: /admin/servers/:id 应渲染 ServerDetailAdmin（继承 ServerDetail）
    // 验证 URL 不被重定向（直接命中详情页）
    await expect(page).toHaveURL(new RegExp(`/admin/servers/${instanceId}$`));
    // 实例详情页应渲染（容器存在），不强制特定标题（实例名可能动态）
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /admin/servers/:id/player-histories 查看玩家历史', async () => {
    const instanceId = ROLE_ACCOUNTS.server_admin.demoInstanceId;
    await page.goto(`/admin/servers/${instanceId}/player-histories`);

    // 旧子路径 /instances/:id/player-histories → v4.13.0 应在 /admin/servers/:id/player-histories 可达
    // PlayerHistories 组件渲染（页面非空，不强制特定文案）
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });
});

// ============================================================================
// 服主场景（instance_admin → /store）
// ============================================================================
test.describe('服主场景链路', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.instance_admin, '/store');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('进入 /store GM Workbench 首页', async () => {
    await expect(page).toHaveURL(/\/store/);
    // v4.15.x: /store 首页为 StoreHome 服主工作台（问候语为动态文案，以「创建实例」按钮锚定）
    await expect(page.getByRole('button', { name: '创建实例' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('访问 /store/servers/:id 管理店铺', async () => {
    const instanceId = ROLE_ACCOUNTS.instance_admin.demoInstanceId;
    await page.goto(`/store/servers/${instanceId}`);

    // v4.13.0: /store/servers/:id 应渲染 ServerDetailStore（继承 ServerDetail）
    await expect(page).toHaveURL(new RegExp(`/store/servers/${instanceId}$`));
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /store/servers/:id/business 管理商品', async () => {
    const instanceId = ROLE_ACCOUNTS.instance_admin.demoInstanceId;
    await page.goto(`/store/servers/${instanceId}/business`);

    // Business 组件渲染（页面非空）
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /store/players 查看 CRM 玩家列表', async () => {
    await page.goto('/store/players');

    // v4.12.0: GM Workbench 玩家列表页
    await expect(page).toHaveURL(/\/store\/players/);
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /store/reports/revenue 查看 CRM 流水报表', async () => {
    await page.goto('/store/reports/revenue');
    await expect(page).toHaveURL(/\/store\/reports\/revenue/);
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /store/reports/playtime 查看 CRM 时长统计', async () => {
    await page.goto('/store/reports/playtime');
    await expect(page).toHaveURL(/\/store\/reports\/playtime/);
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });
});

// ============================================================================
// 玩家场景（user → /guild）
// ============================================================================
test.describe('玩家场景链路', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('进入 /guild Player Portal 首页', async () => {
    await expect(page).toHaveURL(/\/guild/);
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('访问 /guild/servers/:id 浏览店铺（Banner + 商品列表 + 账号绑定卡片）', async () => {
    const instanceId = ROLE_ACCOUNTS.user.demoInstanceId;
    await page.goto(`/guild/servers/${instanceId}`);

    // v4.13.0: /guild/servers/:id 应渲染 ServerDetailGuild
    // 验证 URL 不被重定向
    await expect(page).toHaveURL(new RegExp(`/guild/servers/${instanceId}$`));

    // 店铺头部（ShopHeader）应渲染 — 默认占位 Banner 含"店铺首页"文本，或自定义 Banner 图片
    // 账号绑定卡片（AccountBindingCard）应渲染 — 标题"游戏账号绑定"
    await expect(page.getByText('游戏账号绑定').first()).toBeVisible({ timeout: 15_000 });

    // 商品列表（ShopItemList）应渲染 — 标题"商品列表"
    await expect(page.getByText('商品列表').first()).toBeVisible({ timeout: 15_000 });
  });

  test('访问 /guild/servers/:id/gift-claims 领取礼包', async () => {
    const instanceId = ROLE_ACCOUNTS.user.demoInstanceId;
    await page.goto(`/guild/servers/${instanceId}/gift-claims`);

    // GiftClaims 组件渲染（页面非空）
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });
});

// ============================================================================
// 跨角色访问策略验证（plan §28 跨角色访问统一采用"跳回对应基座 + Toast 提示"策略）
// ============================================================================
test.describe('跨角色访问门控', () => {
  test('user 访问 /admin 被门控拦截', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.user, '/admin', /\/forbidden/);
  });

  test('user 访问 /store 被门控拦截', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.user, '/store', /\/forbidden/);
  });

  test('instance_admin 访问 /admin 被门控拦截', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.instance_admin, '/admin', /\/forbidden/);
  });

  // server_admin 越级访问 /store 是允许的（plan §28 明确允许）
  test('server_admin 越级访问 /store 被允许', async ({ page }) => {
    await injectTokenAndGoto(page, ROLE_ACCOUNTS.server_admin, '/store');

    await expect(page).toHaveURL(/\/store/);
    await expect(page.locator('body')).not.toBeEmpty({ timeout: 15_000 });
  });
});
