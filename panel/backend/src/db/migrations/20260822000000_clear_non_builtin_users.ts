// ============================================================================
// 20260822000000_clear_non_builtin_users.ts
// v4.22.0 Setup Wizard 重构：清理非内置用户，移除 admin@local.dev/admin123 默认账号
//
// 设计目标：
//   1. 删除所有 is_built_in=0 的用户记录（生产模式下 seedProvisionalAdminIfEmpty
//      创建的 admin@local.dev/admin123 + 用户自定义账号）
//   2. 保留 is_built_in=1 的演示账号（admin@local.dev / manager@local.dev /
//      user@local.dev 在 VITE_ENABLE_DEMO=true 模式下仍需要）
//   3. 清空后 users 表为空 → detectInitStatus 判定 needs_init=true →
//      Setup Wizard 引导用户创建首个管理员（不再有内置默认账号风险）
//
// 不可逆性说明：
//   - DELETE 操作不可逆，down 函数为空（不恢复数据）
//   - 关联数据（servers / user_wallets / bindings 等）通过外键 ON DELETE CASCADE
//     自动级联删除，与生产 admin 关联的实例配置等会一并清理
//   - 演示模式下 is_built_in=1 的账号不受影响，仍可正常登录
//
// 影响范围：
//   - users 表（DELETE WHERE is_built_in=0）
//   - 关联表通过外键级联（servers / user_wallets / user_notifications /
//     password_resets / email_verifications / api_keys / instance_admins /
//     instance_roles / friendships / user_password_history / system_update_jobs）
//   - bindings 表无外键约束（仅按 user_id 字段保留），需手动清理孤儿记录
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('[migration 20260822000000_clear_non_builtin_users] 开始清理非内置用户...');

  // ------------------------------------------------------------------
  // Step 1: 检查 users 表是否存在（防御性：基线 migration 未跑时跳过）
  // ------------------------------------------------------------------
  const hasUsersTable = await knex.schema.hasTable('users');
  if (!hasUsersTable) {
    console.log('[migration 20260822000000_clear_non_builtin_users] users 表不存在，跳过清理');
    return;
  }

  // ------------------------------------------------------------------
  // Step 2: 统计待清理的非内置用户数量（便于日志审计）
  // ------------------------------------------------------------------
  const countRow = await knex('users')
    .where({ is_built_in: 0 })
    .count('* as cnt')
    .first();
  const deletedCount = Number((countRow as { cnt: number | string } | undefined)?.cnt ?? 0);
  console.log(
    `[migration 20260822000000_clear_non_builtin_users] 待清理非内置用户数: ${deletedCount}`,
  );

  if (deletedCount === 0) {
    console.log('[migration 20260822000000_clear_non_builtin_users] 无需清理，Forward 迁移完成');
    return;
  }

  // ------------------------------------------------------------------
  // Step 3: 收集待删除用户的 ID（用于清理 bindings 孤儿记录）
  // ------------------------------------------------------------------
  const userIdsToDelete: Array<{ id: string }> = await knex('users')
    .select('id')
    .where({ is_built_in: 0 });
  const userIds = userIdsToDelete.map((r) => r.id);

  // ------------------------------------------------------------------
  // Step 4: DELETE FROM users WHERE is_built_in = 0
  //   关联表通过外键 ON DELETE CASCADE 自动级联（servers / user_wallets /
  //   user_notifications / password_resets / email_verifications / api_keys /
  //   instance_admins / instance_roles / friendships / user_password_history /
  //   system_update_jobs）
  // ------------------------------------------------------------------
  await knex('users').where({ is_built_in: 0 }).del();
  console.log(
    `[migration 20260822000000_clear_non_builtin_users] 已删除 ${deletedCount} 条非内置用户记录（关联表通过外键级联清理）`,
  );

  // ------------------------------------------------------------------
  // Step 5: 清理 bindings 表孤儿记录（无外键约束，需手动清理）
  //   bindings 表用 user_id 字段引用 users.id，但未声明 FOREIGN KEY，
  //   不会自动级联删除。需按收集到的 userIds 手动 DELETE。
  // ------------------------------------------------------------------
  const hasBindingsTable = await knex.schema.hasTable('bindings');
  if (hasBindingsTable && userIds.length > 0) {
    const bindingsDeleted = await knex('bindings').whereIn('user_id', userIds).del();
    console.log(
      `[migration 20260822000000_clear_non_builtin_users] 已清理 bindings 孤儿记录 ${bindingsDeleted} 条`,
    );
  }

  // ------------------------------------------------------------------
  // Step 6: 清理 user_password_history 孤儿记录
  //   （表有 FOREIGN KEY ON DELETE CASCADE，但 SQLite 默认不启用外键约束，
  //    需手动清理以避免脏数据残留）
  // ------------------------------------------------------------------
  const hasPwdHistoryTable = await knex.schema.hasTable('user_password_history');
  if (hasPwdHistoryTable && userIds.length > 0) {
    const pwdHistoryDeleted = await knex('user_password_history')
      .whereIn('user_id', userIds)
      .del();
    if (pwdHistoryDeleted > 0) {
      console.log(
        `[migration 20260822000000_clear_non_builtin_users] 已清理 user_password_history 孤儿记录 ${pwdHistoryDeleted} 条`,
      );
    }
  }

  console.log('[migration 20260822000000_clear_non_builtin_users] Forward 迁移完成');
}

// ============================================================================
// Rollback 迁移：不可逆（数据已删除无法恢复）
// ============================================================================
export async function down(_knex: Knex): Promise<void> {
  // 数据清理不可逆——不执行任何回滚操作
  // 如需恢复管理员账号，请通过 Setup Wizard 重新创建首个管理员
}
