import { expect, test } from '@playwright/test';

const MARKETING_PAGES = [
  {
    path: '/',
    buildText: 'BUILD: 20260725-013',
    heroText: '把开服',
    ctaText: '5 分钟开服 →',
  },
  {
    path: '/home',
    buildText: 'BUILD: 20260725-013',
    heroText: '一个面板，',
    ctaText: '进入控制台',
  },
  {
    path: '/player',
    buildText: 'BUILD: 20260725-013',
    heroText: '你玩的服务器，',
    ctaText: '查看我的福利',
  },
] as const;

test.describe('marketing pages shell', () => {
  for (const pageCase of MARKETING_PAGES) {
    test(`${pageCase.path} 暴露统一的 BUILD 标识和首屏入口`, async ({ page }) => {
      await page.goto(pageCase.path);

      await expect(page.getByText(pageCase.buildText)).toBeVisible();
      await expect(page.getByText(pageCase.heroText)).toBeVisible();
      await expect(page.getByRole('button', { name: pageCase.ctaText })).toBeVisible();
    });
  }
});
