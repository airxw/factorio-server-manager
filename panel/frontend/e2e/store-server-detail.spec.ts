import { expect, test } from '@playwright/test';
import { ROLE_ACCOUNTS } from './helpers';

const STORE_INSTANCE_ID =
  process.env.E2E_STORE_INSTANCE_ID || '73baf630-6b56-4f1d-acee-9d5050980c9f';

async function gotoWithGatewayRetry(
  page: import('@playwright/test').Page,
  path: string,
  attempts = 2,
) {
  for (let index = 0; index < attempts; index += 1) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const gatewayError = page.getByRole('heading', { name: '502 Bad Gateway' });
    if (!(await gatewayError.isVisible().catch(() => false))) return;
  }
}

async function openStoreServerAsInstanceAdmin(page: import('@playwright/test').Page) {
  const targetPath = `/store/servers/${STORE_INSTANCE_ID}`;

  await gotoWithGatewayRetry(page, `/login?from=${encodeURIComponent(targetPath)}`);
  if (new RegExp(`${targetPath}$`).test(page.url())) return;

  const emailInput = page.locator('input[type="text"], input[type="email"]').first();
  const pwdInput = page.locator('input[type="password"]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(ROLE_ACCOUNTS.instance_admin.email);
    await pwdInput.fill(ROLE_ACCOUNTS.instance_admin.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  }

  await page.waitForURL(
    (url) =>
      /\/select-identity/.test(url.pathname) ||
      url.pathname === targetPath ||
      url.pathname === '/store',
    { timeout: 15_000 },
  );

  if (/\/select-identity/.test(page.url())) {
    const adminOption = page.getByRole('button', { name: /腐竹/ }).first();
    if (await adminOption.isVisible().catch(() => false)) {
      await adminOption.click();
      await page.waitForURL((url) => url.pathname === '/store' || url.pathname === targetPath, {
        timeout: 15_000,
      });
    }
  }

  if (!new RegExp(`${targetPath}$`).test(page.url())) {
    await gotoWithGatewayRetry(page, targetPath);
  }
  await expect(page).toHaveURL(new RegExp(`${targetPath}$`));
}

test.describe('/store/servers/:id 结构回归', () => {
  test('桌面端显示 store 嵌入态结构与产品化字段', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '仅在桌面项目验证桌面结构');

    await openStoreServerAsInstanceAdmin(page);
    await expect(page.getByText('当前实例')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /返回列表/ })).toHaveCount(0);

    const infoToggle = page.locator('button.info-card-toggle[aria-label="展开信息卡"]');
    await expect(infoToggle).toBeVisible({ timeout: 15_000 });
    await infoToggle.click();

    await expect(page.getByText('游戏模板')).toBeVisible();
    await expect(page.getByText('部署节点')).toBeVisible();
    await expect(page.getByText('实例归属')).toBeVisible();
    await expect(page.getByText('目录清理')).toBeVisible();
    await expect(page.getByText(/实例状态:/)).toBeVisible();
  });

  test('移动端仅渲染移动版 tab 导航', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', '仅在移动项目验证移动结构');

    await openStoreServerAsInstanceAdmin(page);
    await expect(page.getByRole('tablist', { name: '移动端标签页' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('tablist', { name: '实例详情标签页' })).toHaveCount(0);
  });
});
