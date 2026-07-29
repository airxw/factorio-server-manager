// ============================================================================
// 角色枚举迁移：4 级 → 3 级
// 旧角色（4 级）：system_admin / admin / operator / viewer
// 新角色（3 级）：server_admin / instance_admin / user
// 映射关系：
//   system_admin → server_admin   （系统管理员 → 服务器管理员）
//   admin        → instance_admin （管理员     → 实例管理员）
//   operator     → user           （操作员     → 普通用户）
//   viewer       → user           （查看者     → 普通用户）
// 幂等设计：UPDATE 的 WHERE 子句限定旧角色值，重复执行不会二次修改已迁移的记录
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // system_admin → server_admin
  // 等价 SQL: UPDATE users SET role='server_admin' WHERE role='system_admin'
  await knex('users')
    .where('role', 'system_admin')
    .update({ role: 'server_admin' });

  // admin → instance_admin
  // 等价 SQL: UPDATE users SET role='instance_admin' WHERE role='admin'
  await knex('users')
    .where('role', 'admin')
    .update({ role: 'instance_admin' });

  // operator / viewer → user
  // 等价 SQL: UPDATE users SET role='user' WHERE role IN ('operator', 'viewer')
  await knex('users')
    .whereIn('role', ['operator', 'viewer'])
    .update({ role: 'user' });
}

export async function down(knex: Knex): Promise<void> {
  // 反向迁移说明：
  // operator 与 viewer 均被映射为 user，无法从 'user' 区分原始角色。
  // 此处采用保守回滚策略：将 'user' 统一回退为 'viewer'（最低权限原则），
  // 其余两级按映射关系逆向回退。
  // 生产环境回滚前请结合数据库备份手动核对，避免权限提升风险。

  // server_admin → system_admin
  await knex('users')
    .where('role', 'server_admin')
    .update({ role: 'system_admin' });

  // instance_admin → admin
  await knex('users')
    .where('role', 'instance_admin')
    .update({ role: 'admin' });

  // user → viewer（保守回滚，无法区分原 operator / viewer）
  await knex('users')
    .where('role', 'user')
    .update({ role: 'viewer' });
}
