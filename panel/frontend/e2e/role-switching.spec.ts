// ============================================================================
// E2E：v4.28.0 全员服主——玩家↔服主免密快捷切换
//
// 覆盖 plan（universal-role-switching-plan）步骤 8.3：
//   1. user（roles=[user,instance_admin]）/guild 头像菜单「切换为服主」免密直达 /store；
//      /store 侧边栏「切换为玩家」免密回到 /guild（恢复原 active_role）
//   2. user 直接访问 /store → 403 Forbidden 页给出「切换为服主身份继续」引导 → 免密切换回跳 /store
//   3. admin（3 角色）经弹窗免密切到 user（/guild）；再经弹窗密码通道切回 server_admin（/admin）
//
// 状态卫生：每个用例结束（含失败）都通过 afterEach 调 /api/auth/switch-role 恢复
// 该账号原 active_role，避免污染其他 spec 的 demo 账号前置状态。
// ============================================================================

import { expect, test } from '@playwright/test';
import { injectTokenAndGoto, loginViaApi, ROLE_ACCOUNTS, type RoleAccount } from './helpers';

/** 恢复账号 active_role 到原值（免密端点，复用缓存 token，不触发登录限流） */
async function restoreActiveRole(
  page: import('@playwright/test').Page,
  account: RoleAccount,
): Promise<void> {
  try {
    const token = await loginViaApi(page, account);
    await page.request.post('/api/auth/switch-role', {
      headers: { Authorization: `Bearer ${token}` },
      data: { active_role: account.role },
    });
  } catch {
    // 恢复失败不阻断测试结果（下一个 spec 的 globalSetup token 仍可用）
  }
}

test.describe('v4.28.0 全员服主——玩家↔服主快捷切换', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', '仅在 chromium 项目运行');
  });

  test('user 头像菜单一键切服主 → /store；侧边栏一键切回玩家 → /guild', async ({ page }) => {
    try {
      await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/guild');
      await expect(page).toHaveURL(/\/guild$/, { timeout: 15_000 });

      // 头像菜单 → 「切换为服主」一键项（免密，不开弹窗）
      await page.getByRole('button', { name: '用户菜单' }).click();
      await page.getByRole('button', { name: '切换为服主' }).click();

      // 免密切换并跳转服主工作台
      await expect(page).toHaveURL(/\/store/, { timeout: 15_000 });

      // 侧边栏用户菜单 → 「切换为玩家」一键切回
      await page.getByRole('button', { name: '用户菜单' }).click();
      await page.getByRole('menuitem', { name: '切换为玩家' }).click();

      await expect(page).toHaveURL(/\/guild/, { timeout: 15_000 });
      // 玩家门户正常渲染（绑定区块标题可见，未命中 404/403）
      await expect(page.getByRole('heading', { name: /游戏角色绑定/ })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await restoreActiveRole(page, ROLE_ACCOUNTS.user);
    }
  });

  test('user 直访 /store 命中 403 → Forbidden 页「切换为服主身份继续」回跳 /store', async ({
    page,
  }) => {
    try {
      await injectTokenAndGoto(page, ROLE_ACCOUNTS.user, '/store');

      // RequireRole 拦截 → /forbidden，且 roles 含 instance_admin → 显示切换引导
      await expect(page).toHaveURL(/\/forbidden/, { timeout: 15_000 });
      const switchBtn = page.getByRole('button', { name: /切换为服主身份继续/ });
      await expect(switchBtn).toBeVisible({ timeout: 10_000 });
      await switchBtn.click();

      // 免密切换后回跳原目标页
      await expect(page).toHaveURL(/\/store/, { timeout: 15_000 });
    } finally {
      await restoreActiveRole(page, ROLE_ACCOUNTS.user);
    }
  });

  test('admin 弹窗免密切到玩家；切回平台管理员需密码二次校验', async ({ page }) => {
    try {
      await injectTokenAndGoto(page, ROLE_ACCOUNTS.server_admin, '/admin');
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });

      // 3 角色账号 → 侧边栏显示「切换角色…」开弹窗
      await page.getByRole('button', { name: '用户菜单' }).click();
      await page.getByRole('menuitem', { name: '切换角色…' }).click();

      // 弹窗内点选「玩家」卡片 → 免密切换直达 /guild
      const dialog = page.getByRole('dialog', { name: '切换角色' });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // 精确前缀匹配「玩家」卡片（/玩家/ 会同时命中服主卡片的"店铺 / 玩家"描述文本）
      await dialog.getByRole('button', { name: /^玩家 / }).click();
      await expect(page).toHaveURL(/\/guild/, { timeout: 15_000 });

      // 再开弹窗点选「平台管理员」→ 进入密码二次校验表单
      await page.getByRole('button', { name: '用户菜单' }).click();
      await page.getByRole('button', { name: '切换角色…' }).click();
      const dialog2 = page.getByRole('dialog', { name: '切换角色' });
      await expect(dialog2).toBeVisible({ timeout: 10_000 });
      await dialog2.getByRole('button', { name: /平台管理员/ }).click();

      // 密码表单出现（免密通道不适用于 server_admin）
      const passwordInput = dialog2.getByPlaceholder('输入当前账号密码以确认');
      await expect(passwordInput).toBeVisible({ timeout: 5_000 });
      await passwordInput.fill(ROLE_ACCOUNTS.server_admin.password);
      await dialog2.getByRole('button', { name: '确认切换' }).click();

      // 密码校验通过 → 回到 /admin（恢复原 active_role）
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 });
    } finally {
      await restoreActiveRole(page, ROLE_ACCOUNTS.server_admin);
    }
  });
});
