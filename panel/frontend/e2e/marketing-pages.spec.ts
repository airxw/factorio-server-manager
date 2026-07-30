import { expect, test } from '@playwright/test';

// BUILD 编号随每次部署递增（buildInfo.ts 单一来源），硬编码必然过期；
// 按规则 1.md 的 footer 规范断言格式 `BUILD YYYYMMDD-XXX`（无冒号），而非具体编号。
const BUILD_PATTERN = /BUILD \d{8}-\d{3}/;

const MARKETING_PAGES = [
  {
    path: '/',
    // LandingV6：h1「把开服 从技术活 变成运营活」（footer 亦含"把开服"，须用 heading role 锚定）
    heroHeading: /把开服 从技术活 变成运营活/,
    ctaText: '5 分钟开服 →',
  },
  {
    path: '/home',
    // /home 与 / 未登录时同渲染 LandingV6（App.tsx 路由表）
    heroHeading: /把开服 从技术活 变成运营活/,
    ctaText: '5 分钟开服 →',
  },
  {
    path: '/player',
    heroHeading: /你玩的服务器，/,
    ctaText: '查看我的福利',
  },
] as const;

test.describe('marketing pages shell', () => {
  for (const pageCase of MARKETING_PAGES) {
    test(`${pageCase.path} 暴露统一的 BUILD 标识和首屏入口`, async ({ page }) => {
      await page.goto(pageCase.path);

      await expect(page.getByText(BUILD_PATTERN).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: pageCase.heroHeading })).toBeVisible();
      await expect(page.getByRole('button', { name: pageCase.ctaText })).toBeVisible();
    });
  }
});
