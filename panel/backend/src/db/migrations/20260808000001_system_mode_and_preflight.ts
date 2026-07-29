// ============================================================================
// 20260808000001_system_mode_and_preflight.ts
// v4.18.0 初始化向导（Setup Wizard）修复
//
// 用途：
//   1. seed system_config 'system.mode' = 'production'（演示模式由 env 覆盖）
//   2. seed system_config 'system.preflight_passed' = 'false'
//   3. 兼容性检测：若现有部署已完成初始化（admin 已改密 / site.name 已改），
//      则同步写入 system.mode='production' + system.preflight_passed='true'，
//      避免已初始化的部署被强制再次进入向导
//
// 依赖：system_config 表（20260703000003_create_system_config.ts）
// 依赖：users 表（admin@local.dev 检测 password_changed_at）
// 不可逆操作：无（仅 KV 写入，回滚时仅删除新增的 key）
//
// 来源：docs/plans/setup-wizard-fix-plan.md §4.9
// ============================================================================

import type { Knex } from 'knex';

const KEY_SYSTEM_MODE = 'system.mode';
const KEY_SYSTEM_PREFLIGHT_PASSED = 'system.preflight_passed';

const DEFAULT_SITE_NAME = 'GameServer Panel';
const DEFAULT_ADMIN_EMAIL = 'admin@local.dev';

export async function up(knex: Knex): Promise<void> {
  // 检测 system_config 表是否存在（防御性：理论上 20260703000003 已创建）
  const hasSystemConfig = await knex.schema.hasTable('system_config');
  if (!hasSystemConfig) {
    console.log('[migration 20260808000001] system_config 表不存在，跳过 seed');
    return;
  }

  // 兼容性检测：判断现有部署是否已完成初始化
  //   条件 A：默认 admin 不存在 OR admin.password_changed_at IS NOT NULL
  //   条件 B：site.name != 'GameServer Panel'
  //   满足 A 或 B 任一即视为已初始化（与 settings.ts detectInitStatus 逻辑对齐）
  const hasUsersTable = await knex.schema.hasTable('users');

  let alreadyInitialized = false;
  if (hasUsersTable) {
    // 条件 A：默认 admin 不存在 OR 已改密
    const defaultAdmin: { password_changed_at: string | null } | undefined = await knex('users')
      .select('password_changed_at')
      .where({ email: DEFAULT_ADMIN_EMAIL })
      .first();
    const adminChanged = defaultAdmin === undefined || defaultAdmin.password_changed_at !== null;

    // 条件 B：site.name != 默认值
    const siteNameRow: { value: string | null } | undefined = await knex('system_config')
      .select('value')
      .where({ key: 'site.name' })
      .first();
    const siteNameChanged = siteNameRow?.value !== undefined && siteNameRow.value !== DEFAULT_SITE_NAME;

    alreadyInitialized = adminChanged || siteNameChanged;
  }

  const now = new Date().toISOString();

  // 写入 system.mode
  //   - 已初始化部署：production
  //   - 未初始化部署：production（待 SetupWizard 确认，演示模式由 env 覆盖）
  await knex('system_config')
    .insert({
      key: KEY_SYSTEM_MODE,
      value: 'production',
      description: 'v4.18.0: 运行模式（production / demo），演示模式由 VITE_ENABLE_DEMO 覆盖',
      updated_at: now,
    })
    .onConflict('key')
    .ignore();

  // 写入 system.preflight_passed
  //   - 已初始化部署：true（避免被强制再次进入向导）
  //   - 未初始化部署：false（SetupWizard 完成后由 POST /api/init 写入 true）
  await knex('system_config')
    .insert({
      key: KEY_SYSTEM_PREFLIGHT_PASSED,
      value: alreadyInitialized ? 'true' : 'false',
      description: 'v4.18.0: 是否完成首启动环境预检（true=已完成，false=待 SetupWizard 处理）',
      updated_at: now,
    })
    .onConflict('key')
    .ignore();

  console.log(
    `[migration 20260808000001] system.mode=production, system.preflight_passed=${alreadyInitialized ? 'true' : 'false'}（已初始化=${alreadyInitialized}）`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasSystemConfig = await knex.schema.hasTable('system_config');
  if (!hasSystemConfig) return;

  await knex('system_config').where({ key: KEY_SYSTEM_MODE }).delete();
  await knex('system_config').where({ key: KEY_SYSTEM_PREFLIGHT_PASSED }).delete();

  console.log('[migration 20260808000001] 回滚：删除 system.mode + system.preflight_passed 配置项');
}
