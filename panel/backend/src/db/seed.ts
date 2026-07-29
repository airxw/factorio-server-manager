// ============================================================================
// 数据库 Seed 脚本 — 3 级演示账号
// 演示场景：server_admin / instance_admin / user 三个层级，覆盖完整权限矩阵
// 邮箱：admin@local.dev / manager@local.dev / user@local.dev
// 密码：admin123（统一，便于演示切换角色）
// 角色：server_admin（最高）/ instance_admin（实例管理）/ user（普通）
// ============================================================================

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { Role, universalRolesFor } from '../core/auth/roles.js';

// 3 级演示账号清单——email 唯一，password 统一为 admin123（演示场景）
// 角色对应：server_admin=3 / instance_admin=2 / user=1
// vip_level：server_admin=999（admin 不受限）；instance_admin=3；user=0
const SEED_DEMO_ACCOUNTS = [
  {
    email: 'admin@local.dev',
    username: 'admin',
    display_name: '服务器管理员',
    role: Role.SERVER_ADMIN,
    vip_level: 999, // admin 不受限（scheme §5.3）
  },
  {
    email: 'manager@local.dev',
    username: 'manager',
    display_name: '实例管理员',
    role: Role.INSTANCE_ADMIN,
    vip_level: 3, // 中等 VIP
  },
  {
    email: 'user@local.dev',
    username: 'user',
    display_name: '普通用户',
    role: Role.USER,
    vip_level: 0, // 基础用户
  },
] as const;

const SEED_DEMO_PASSWORD = 'admin123';

/**
 * 幂等 seed 3 级演示账号——按 email 检查存在性，逐条插入
 * 用途：
 *   1. 全新部署：users 表为空时插入 3 条
 *   2. 现有部署：仅补缺（不影响已存在的账号或自定义用户）
 * 安全性：仅在受控环境（VITE_ENABLE_DEMO=true 或 dev mode）使用，
 *         生产环境若不需要演示账号，可手动 DELETE FROM users WHERE email LIKE '%@local.dev'
 */
export async function seedDemoAccountsIfMissing(db: Knex): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_DEMO_PASSWORD, 10);
  const now = new Date().toISOString();

  for (const account of SEED_DEMO_ACCOUNTS) {
    const existing = await db('users').where({ email: account.email }).first();
    if (existing) {
      continue;
    }
    await db('users').insert({
      id: crypto.randomUUID(),
      email: account.email,
      username: account.username,
      password_hash: passwordHash,
      // v4.28.0: 移除 role 列写入（users.role 列已被基线 DROP，写入必抛 SQL 错误）
      status: 'active',
      display_name: account.display_name,
      vip_level: account.vip_level,
      vip_expires_at: null,
      is_verified: true,
      is_built_in: 1, // v4.0.2: 演示账号标记为系统内置（改密拦截 + 前端展示）
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      // v4.28.0 全员服主：演示账号同样写入完整角色集合（此前缺失 roles/active_role）
      roles: JSON.stringify(universalRolesFor(account.role)),
      active_role: account.role,
    });
  }
}

/**
 * 兼容旧接口：仅当 users 表为空时插入（保留原有空表初始化语义）。
 * 推荐改用 seedDemoAccountsIfMissing（幂等、对现有部署友好）。
 * @deprecated use seedDemoAccountsIfMissing
 */
export async function seedAdminIfEmpty(db: Knex): Promise<void> {
  const userCount = await db('users').count('id as cnt').first();
  const count = Number(userCount?.cnt ?? 0);
  if (count > 0) {
    return;
  }
  await seedDemoAccountsIfMissing(db);
}

// ============================================================================
// v4.22.0: 生产模式 seed——不再创建任何默认账号
//
// 设计目标（v4.22.0 重构）：
//   1. 移除 admin@local.dev/admin123 内置默认账号（安全风险：未运行 SetupWizard
//      即可用 admin123 登录）
//   2. 生产环境首启动时 users 表保持空，由 Setup Wizard 引导用户创建首个管理员
//      （POST /api/init 接收 admin.{email, username, display_name, password} 后创建）
//   3. detectInitStatus 改为检测 users 表为空（count=0）→ needs_init=true
//   4. 仅在 VITE_ENABLE_DEMO=true 时通过 seedDemoAccountsIfMissing 创建演示账号
//
// 历史背景：
//   - v4.18.0: 此函数曾创建 admin@local.dev/admin123 作为"待初始化凭据"，
//      SetupWizard 完成后覆盖密码
//   - v4.22.0: 彻底移除默认账号创建逻辑，避免任何未初始化场景下的安全风险
//      （旧 admin@local.dev/admin123 已被 migration 20260822000000 清理）
//
// 保留函数签名：避免调用方（如 bootstrap / services-init）需要同步修改
// ============================================================================

/**
 * v4.22.0: 生产模式 seed——不再创建任何账号，直接返回。
 *
 * 行为变更：
 *   - v4.18.0: users 表为空时插入 admin@local.dev（密码 admin123）
 *   - v4.22.0: 直接返回，users 表保持空，由 Setup Wizard 创建首个管理员
 *
 * 兼容性：
 *   - 函数签名不变（接受 db 参数），调用方无需修改
 *   - 演示模式由调用方判断 VITE_ENABLE_DEMO 后调用 seedDemoAccountsIfMissing
 *
 * 安全收益：
 *   - 移除未运行 SetupWizard 即可用 admin123 登录的风险窗口
 *   - users 表为空 → detectInitStatus 判定 needs_init=true → 强制进入 SetupWizard
 */
export async function seedProvisionalAdminIfEmpty(_db: Knex): Promise<void> {
  // v4.22.0: 不再创建默认 admin 账号
  // users 表保持空，由 POST /api/init 接收向导提交后创建首个管理员
  return;
}

// ----- 默认本地节点（P0 单机模式） -----
const SEED_LOCAL_NODE = {
  id: 'node-local',
  name: '本地节点',
  fqdn: 'localhost',
  public_ip: '127.0.0.1',
  status: 'online',
};

/**
 * 当 nodes 表为空时，插入默认本地节点（node-local），
 * 供 CreateServerRequest.node_id 缺省时使用。
 * daemon_token_hash 留空字符串（P0 不校验节点 token）。
 */
export async function seedLocalNodeIfEmpty(db: Knex): Promise<void> {
  const nodeCount = await db('nodes').count('id as cnt').first();
  const count = Number(nodeCount?.cnt ?? 0);
  if (count > 0) {
    return;
  }

  await db('nodes').insert({
    id: SEED_LOCAL_NODE.id,
    name: SEED_LOCAL_NODE.name,
    fqdn: SEED_LOCAL_NODE.fqdn,
    daemon_token_hash: '',
    public_ip: SEED_LOCAL_NODE.public_ip,
    status: SEED_LOCAL_NODE.status,
    last_seen_at: new Date().toISOString(),
  });
}
