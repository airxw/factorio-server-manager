// ============================================================================
// v3.3.3: 演示账号扩展 — 补齐 3 级权限矩阵
// 此前 seed.ts 只创建 server_admin 账号（admin@local.dev / admin123），
// 现扩展为 3 级演示账号：server_admin / instance_admin / user
//
// 新增账号：
//   - manager@local.dev / admin123 / instance_admin / vip_level=3
//   - user@local.dev     / admin123 / user           / vip_level=0
//
// 幂等执行：按 email 检查存在性，已存在则跳过
// ============================================================================

import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Role } from '../../core/auth/roles.js';

const NEW_DEMO_ACCOUNTS = [
  {
    email: 'manager@local.dev',
    username: 'manager',
    display_name: '实例管理员',
    role: Role.INSTANCE_ADMIN,
    vip_level: 3,
  },
  {
    email: 'user@local.dev',
    username: 'user',
    display_name: '普通用户',
    role: Role.USER,
    vip_level: 0,
  },
] as const;

const SEED_PASSWORD = 'admin123';

export async function up(knex: Knex): Promise<void> {
  // 防御性检查：users 表不存在时跳过（不应发生，create_core_tables 早于此迁移）
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const now = new Date().toISOString();

  for (const account of NEW_DEMO_ACCOUNTS) {
    const existing = await knex('users').where({ email: account.email }).first();
    if (existing) {
      // 已存在则跳过——保留用户在数据库中可能已修改的角色/状态
      continue;
    }
    await knex('users').insert({
      id: crypto.randomUUID(),
      email: account.email,
      username: account.username,
      password_hash: passwordHash,
      role: account.role,
      status: 'active',
      display_name: account.display_name,
      vip_level: account.vip_level,
      vip_expires_at: null,
      is_verified: true,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // 回滚：删除本迁移新增的 2 个演示账号
  // 不删除 admin@local.dev（属于早期 seed，不归本迁移管理）
  await knex('users')
    .whereIn('email', NEW_DEMO_ACCOUNTS.map((a) => a.email))
    .del();
}
