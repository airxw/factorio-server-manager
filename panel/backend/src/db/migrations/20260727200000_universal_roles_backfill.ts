// ============================================================================
// 20260727200000_universal_roles_backfill.ts
// v4.28.0: 全员服主——存量用户角色集合补齐
//
// 设计目标：
//   玩家和服主是同层级的两面（玩家自己开服就是服主，玩别人的服就是玩家）。
//   让每个账号的 roles 都包含 user 与 instance_admin，身份切换仅改变 active_role。
//
// 补齐规则（保留原有序与 active_role，仅追加缺失项，幂等）：
//   ['user']           → ['user', 'instance_admin']
//   ['instance_admin'] → ['instance_admin', 'user']
//   ['server_admin']   → ['server_admin', 'instance_admin', 'user']
//   null / 坏 JSON     → normalizeRoles 回退 ['user'] → ['user', 'instance_admin']
//
// 兼容性：
//   - up：仅 UPDATE roles 列；active_role 不变；已补齐的行跳过（幂等，可重复执行）
//   - down：不自动回滚（追加的角色无害——权限门控仍按 active_role / roles 判定）；
//          如需回退需从备份恢复 users 表
//
// 注意：
//   - 既有会话 JWT 中烧有旧 roles，在线用户需重新登录或执行一次角色切换才获得新 roles
//   - users 表不存在时（全新部署 baseline 未跑）直接跳过——新部署由 register/seed/init
//     路径以 universalRolesFor 写入全集合，无需 backfill
//
// 方案文档：docs/plans/universal-role-switching-plan.md
// ============================================================================

import type { Knex } from 'knex';
import { Role, normalizeRoles } from '../../core/auth/roles.js';

interface UserRolesRow {
  id: string;
  roles: string | null;
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('users'))) {
    console.log('[migration 20260727200000] users 表不存在，跳过（全新部署由写入路径保证全集合）');
    return;
  }

  const rows = await knex<UserRolesRow>('users').select('id', 'roles');
  let updatedCount = 0;

  for (const row of rows) {
    const current = normalizeRoles(row.roles);
    const next = [...current];
    if (!next.includes(Role.INSTANCE_ADMIN)) {
      next.push(Role.INSTANCE_ADMIN);
    }
    if (!next.includes(Role.USER)) {
      next.push(Role.USER);
    }

    const currentJson = JSON.stringify(current);
    const nextJson = JSON.stringify(next);
    if (currentJson === nextJson) {
      continue; // 已补齐，幂等跳过
    }

    await knex('users').where({ id: row.id }).update({ roles: nextJson });
    updatedCount += 1;
  }

  console.log(
    `[migration 20260727200000] 全员服主 roles 补齐完成：共 ${rows.length} 个用户，更新 ${updatedCount} 个（active_role 均未变更）`,
  );
}

export async function down(_knex: Knex): Promise<void> {
  // 不自动回滚：追加的角色成员资格无害（门控仍按 active_role / roles 全集判定）。
  // 如需回退，从备份恢复 users 表。
  console.warn(
    '[migration 20260727200000] down() 不执行回滚：补齐的 roles 需从备份恢复（如有需要）',
  );
}
