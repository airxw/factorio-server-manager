// ============================================================================
// E2E：v4.13.0 旧路径重定向验证（步骤29）
//
// 覆盖 plan §29：
//   - /instances/:id → 按角色重定向到 /admin/servers/:id | /store/servers/:id | /guild/servers/:id
//   - /instances → 按角色重定向到 /admin/servers | /store/servers | /guild
//   - /servers/:id → /instances/:id → 角色基座（链式重定向）
//   - /dashboard → /admin（v4.12.0 已完成，回归验证）
//
// 前置条件同 instance-flow.spec.ts
// ============================================================================

import { test } from '@playwright/test';
import { ROLE_ACCOUNTS, injectTokenAndWaitForUrl } from './helpers';

test.describe('v4.13.0 旧路径重定向', () => {
  test('server_admin 访问 /instances/:id 重定向到 /admin/servers/:id', async ({ page }) => {
    const instanceId = ROLE_ACCOUNTS.server_admin.demoInstanceId;
    await injectTokenAndWaitForUrl(
      page,
      ROLE_ACCOUNTS.server_admin,
      `/instances/${instanceId}`,
      new RegExp(`/admin/servers/${instanceId}$`),
    );
  });

  test('instance_admin 访问 /instances/:id 重定向到 /store/servers/:id', async ({ page }) => {
    const instanceId = ROLE_ACCOUNTS.instance_admin.demoInstanceId;
    await injectTokenAndWaitForUrl(
      page,
      ROLE_ACCOUNTS.instance_admin,
      `/instances/${instanceId}`,
      new RegExp(`/store/servers/${instanceId}$`),
    );
  });

  test('user 访问 /instances/:id 重定向到 /guild/servers/:id', async ({ page }) => {
    const instanceId = ROLE_ACCOUNTS.user.demoInstanceId;
    await injectTokenAndWaitForUrl(
      page,
      ROLE_ACCOUNTS.user,
      `/instances/${instanceId}`,
      new RegExp(`/guild/servers/${instanceId}$`),
    );
  });

  test('server_admin 访问 /instances 重定向到 /admin/servers', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.server_admin, '/instances', /\/admin\/servers/);
  });

  test('instance_admin 访问 /instances 重定向到 /store/servers', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.instance_admin, '/instances', /\/store\/servers/);
  });

  test('user 访问 /instances 重定向到 /guild', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.user, '/instances', /\/guild/);
  });

  test('/servers/:id → /instances/:id → 角色基座（链式重定向）', async ({ page }) => {
    const instanceId = ROLE_ACCOUNTS.server_admin.demoInstanceId;
    await injectTokenAndWaitForUrl(
      page,
      ROLE_ACCOUNTS.server_admin,
      `/servers/${instanceId}`,
      new RegExp(`/admin/servers/${instanceId}$`),
    );
  });

  test('/dashboard → /admin（v4.12.0 回归验证）', async ({ page }) => {
    await injectTokenAndWaitForUrl(page, ROLE_ACCOUNTS.server_admin, '/dashboard', /\/admin/);
  });
});
