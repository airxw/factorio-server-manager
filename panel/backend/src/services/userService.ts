// ============================================================================
// userService — 用户注册 / 登录 / 查询 / 更新 / 玩家绑定验证 / 多角色管理实现
// 接口契约：@public/interface_stub/user-service.d.ts
// 数据契约：public/schema/user-schema.json
// 来源：scheme-final-merged.md §7.1 P1 / §6.1 用户表迁移
// @version 4.17.0
//   - 4.17.0: 多角色支持
//     - UserRow 增加 roles + active_role 字段
//     - toUser/toUserInfo 输出 roles + active_role
//     - register() 初始化 roles = [role] + active_role = role
//     - login() 签名改为 (email, password, options?: LoginOptions)，JWT 含 roles + active_role
//     - 新增 updateUserRoles / listUserRoles / selectActiveRole / revokeUserTokens 方法
//   - 3.1.0: 适配公共契约 UserRole 升 3 级；toUser() 直传新 3 级 role
// ============================================================================

import bcrypt from 'bcryptjs';
import zxcvbn from 'zxcvbn';
import crypto from 'node:crypto';
import type { Knex } from 'knex';

import { signToken } from '../core/auth/jwt.js';
import {
  Role,
  ROLE_LEVEL,
  normalizeRole,
  normalizeRoles,
  resolveActiveRole,
  toContractUserRole,
  toContractUserRoles,
  universalRolesFor,
} from '../core/auth/roles.js';
import { getTokenBlacklistService } from '../core/auth/tokenBlacklist.js';

import type { UserService, LoginOptions } from '@public/interface_stub/user-service';
import type {
  BatchUserOperationResult,
  UserStatsResponse,
} from '@public/schema/panel-api-types';
import type {
  User,
  UserUpdate,
  UserRole,
  UserStatus,
} from '@public/interface_stub/shared-types';

// ---------------------------------------------------------------------------
// 错误类统一从 errors.ts 导入（避免跨模块重复定义）
// re-export 保持对外 API 稳定
// ---------------------------------------------------------------------------
export {
  AppError,
  UserNotFoundError,
  UserAlreadyExistsError,
  InvalidCredentialError,
  VerifyCodeInvalidError,
  PasswordStrengthInsufficientError,
  PasswordReusedError,
} from './errors.js';
import {
  UserNotFoundError,
  UserAlreadyExistsError,
  InvalidCredentialError,
  VerifyCodeInvalidError,
  PasswordStrengthInsufficientError,
  PasswordReusedError,
} from './errors.js';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

/** users 表行类型（is_verified 在 SQLite 中以 0/1 存储） */
interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  /**
   * @deprecated v4.17.0 过渡期保留；v4.19.2 M5 基线已 DROP 此列。
   * 保留为可选字段仅为向后兼容旧 SELECT * 查询结果（实际恒为 undefined）。
   * 严禁向此字段写入（INSERT/UPDATE），DB 列已不存在会抛 SQL 错误。
   */
  role?: string;
  status: string;
  display_name: string | null;
  vip_level: number;
  vip_expires_at: string | null;
  is_verified: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  /** JWT 失效版本号（v3.4.0 新增，migration 20260717000002 添加，DEFAULT 0） */
  token_version: number;
  created_at: string;
  updated_at: string;
  /** v4.17.0 新增：角色集合 JSON 字符串（如 '["user","instance_admin"]'） */
  roles?: string | null;
  /** v4.17.0 新增：当前活动角色（会话级） */
  active_role?: string | null;
  /** v4.0.2: 系统内置账号标记（0/1，演示场景密码不可改） */
  is_built_in?: number;
}

/**
 * v4.17.0: 旧表 player_bindings 迁移说明（历史参考，无运行时引用）。
 * 旧表 player_bindings 已物理删除，数据统一到 bindings 表（binding_type='player', scope_type='game_type'）。
 * v4.27.0: scope_type 由 'game_type' 改为 'instance'，scope_ref 含义由 game_type 改为 server_id（实例级玩家绑定）。
 * 旧表字段映射：
 *   * player_bindings.user_id          ↔ bindings.user_id
 *   * player_bindings.game_player_name ↔ bindings.player_name
 *   * player_bindings.game_type        ↔ bindings.scope_ref (binding_type='player', scope_type='game_type')
 *     （v4.27.0: scope_type='instance', scope_ref=server_id）
 *   * player_bindings.verify_code      ↔ bindings.verify_code
 *   * player_bindings.status           ↔ bindings.verify_status ('pending'→'pending', 'verified'→'verified', 'rejected'→'revoked')
 *   * player_bindings.verified_at      ↔ bindings.verified_at
 *   * player_bindings.created_at       ↔ bindings.created_at
 *   * player_bindings.updated_at       ↔ bindings.updated_at
 *
 * 实际 DB 操作已改用 BindingRow（统一 bindings 表行类型）。
 */

/**
 * v4.17.0: 统一 bindings 表行类型（仅声明玩家全局绑定相关字段）。
 * v4.27.0: scope_type 由 'game_type' 改为 'instance'（实例级玩家绑定）。
 * 用于 register / verifyPlayerBinding / registerFromGame 流程的 DB 读写。
 */
interface BindingRow {
  id: number;
  user_id: string;
  binding_type: string;
  scope_type: string;
  scope_ref: string | null;
  player_name: string | null;
  vip_level: number;
  wallet_id: string | null;
  verify_status: string;
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/**
 * 将 DB 行转换为公共契约的 User 记录。
 * 注意：User 类型含 password_hash 字段（契约要求），调用方不应主动暴露该字段。
 *
 * v4.17.0: 输出 roles + active_role 字段
 *   - roles: 从 row.roles（JSON 字符串）解析并归一化
 *   - active_role: 优先 row.active_role；缺失时 resolveActiveRole(roles[0])
 *   - role: 过渡期保留，等同 active_role（v4.19.2: users.role 列已 DROP，不再从 DB 读取）
 */
function toUser(row: UserRow): User {
  const roles = normalizeRoles(row.roles);
  const activeRole = resolveActiveRole(row.active_role, roles);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    password_hash: row.password_hash,
    role: toContractUserRole(activeRole) as unknown as UserRole,
    status: row.status as UserStatus,
    display_name: row.display_name,
    vip_level: row.vip_level,
    vip_expires_at: row.vip_expires_at,
    is_verified: !!row.is_verified,
    last_login_at: row.last_login_at,
    last_login_ip: row.last_login_ip,
    created_at: row.created_at,
    updated_at: row.updated_at,
    roles: toContractUserRoles(roles),
    active_role: toContractUserRole(activeRole),
  };
}

/**
 * 将 DB 行转换为公共契约的 UserInfo（不含 password_hash、vip 等敏感字段）
 * 用于 /api/auth/register、/api/auth/login、/api/auth/me 响应。
 * @version 4.17.0 输出 roles + active_role
 */
export function toUserInfo(row: UserRow): {
  id: string;
  email: string;
  username: string;
  role: ReturnType<typeof toContractUserRole>;
  status: 'active' | 'disabled' | 'deleted';
  created_at: string;
  roles?: ReturnType<typeof toContractUserRoles>;
  active_role?: ReturnType<typeof toContractUserRole>;
} {
  const roles = normalizeRoles(row.roles);
  const activeRole = resolveActiveRole(row.active_role, roles);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: toContractUserRole(activeRole),
    status: row.status as 'active' | 'disabled' | 'deleted',
    created_at: row.created_at,
    roles: toContractUserRoles(roles),
    active_role: toContractUserRole(activeRole),
  };
}

// ---------------------------------------------------------------------------
// UserServiceImpl
// ---------------------------------------------------------------------------

/**
 * 用户服务实现
 *
 * 设计要点：
 * - register：bcrypt(10 rounds) 哈希密码，同时创建 pending 玩家绑定记录
 *   v3.1.0 扩展：支持可选 role / display_name 参数（管理员创建用户时使用）
 * - login：不区分"邮箱不存在"与"密码错误"以防枚举攻击；签发 JWT 并更新登录信息
 * - getUser/updateUser：返回完整 User 记录（含 password_hash，契约类型要求）
 * - softDeleteUser：v3.1.0 新增；将 users.status 置为 'deleted'（保留外键约束）
 * - verifyPlayerBinding：事务保证绑定验证与 users.is_verified 更新的原子性
 */
export class UserServiceImpl implements UserService {
  /** zxcvbn 最低强度分（来自 PASSWORD_MIN_ZXCVBN_SCORE，默认 3） */
  private readonly minZxcvbnScore: number;
  /** 密码历史保留条数（来自 PASSWORD_MAX_HISTORY，默认 5） */
  private readonly maxHistory: number;

  constructor(
    private readonly db: Knex,
    private readonly jwtSecret: string,
  ) {
    this.minZxcvbnScore = parseInt(process.env.PASSWORD_MIN_ZXCVBN_SCORE ?? '3', 10);
    this.maxHistory = parseInt(process.env.PASSWORD_MAX_HISTORY ?? '5', 10);
  }

  async register(
    email: string,
    username: string,
    password: string,
    options?: { role?: Role; display_name?: string },
  ): Promise<{ userId: string; verifyCode: string }> {
    const existing = await this.db<UserRow>('users').where({ email }).first();
    if (existing) {
      throw new UserAlreadyExistsError();
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    // crypto.randomUUID 形如 "550e8400-e29b-..."，取前 8 位作为短码
    const verifyCode = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    // 默认 role=Role.USER；管理员可传 Role.SERVER_ADMIN/Role.INSTANCE_ADMIN
    const role = options?.role ?? Role.USER;
    const displayName = options?.display_name ?? username;

    // v4.19.2: users.role 列已由 M5 基线 DROP，不再 INSERT 此列
    // 角色信息统一写入 roles（JSON）+ active_role
    await this.db<UserRow>('users').insert({
      id: userId,
      email,
      username,
      password_hash: passwordHash,
      status: 'active',
      display_name: displayName,
      vip_level: 0,
      vip_expires_at: null,
      is_verified: 0,
      last_login_at: null,
      last_login_ip: null,
      created_at: now,
      updated_at: now,
      // v4.17.0 初始化 roles + active_role
      // v4.28.0 全员服主：roles 初始化为全集合（玩家与服主同层两面，自由切换）
      roles: JSON.stringify(universalRolesFor(role)),
      active_role: role,
    });

    // v4.27.0: 移除注册时的占位 player binding 创建
    //   旧版（≤ v4.26.0）：register() 创建 scope_type='game_type', scope_ref='default' 占位绑定
    //   迁移版（v4.27.0 草稿）：改为 scope_type='instance', scope_ref='default'（语义不一致）
    //   最终版（v4.27.0）：不再创建占位绑定
    //   原因：
    //     1. 'default' 不是合法 server_id，与 scope_type='instance' 语义冲突
    //     2. verifyCode 实际从未被后端任何路由消费（verifyPlayerBinding 是死代码）
    //     3. 用户应通过 /guild/bind?type=player 显式创建实例级绑定
    //   兼容性：verifyCode 仍生成并返回以保持 RegisterResponse 响应形状，但不再写入 bindings 表
    //   邮箱验证走独立的 email_verifications 表流程（见 routes-registry.ts /api/auth/register）

    return { userId, verifyCode };
  }

  async login(
    email: string,
    password: string,
    options?: LoginOptions,
  ): Promise<{ token: string; user: User }> {
    const ip = options?.ip;
    const user = await this.db<UserRow>('users').where({ email }).first();
    // 防枚举：邮箱不存在时同样抛 InvalidCredentialError
    if (!user) {
      throw new InvalidCredentialError();
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new InvalidCredentialError();
    }

    if (user.status !== 'active') {
      throw new InvalidCredentialError();
    }

    // v4.17.0 解析多角色 + 活动角色
    // v4.19.2 M3: users.role 列已 DROP，移除 ?? user.role fallback；
    //   roles=null 时 normalizeRoles 返回 [USER]（最低权限默认）
    const roles = normalizeRoles(user.roles);
    // v4.28.5: 角色切换是会话级语义。未显式指定 activeRole 的新登录应回到账号默认身份
    // （roles[0]），而不是沿用上次会话残留到 DB 的 active_role。
    const activeRole = resolveActiveRole(options?.activeRole, roles);

    const token = signToken(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        // normalizeRole 兼容未迁移的旧角色值，确保 JWT 内为合法的 3 级角色
        role: activeRole,
        // v3.4.0: 签发时写入 token_version，供 authenticateToken 校验改密后失效旧 JWT
        token_version: user.token_version,
        // v4.17.0: 多角色字段
        roles,
        active_role: activeRole,
      },
      this.jwtSecret,
    );

    const now = new Date().toISOString();
    await this.db<UserRow>('users').where({ id: user.id }).update({
      last_login_at: now,
      last_login_ip: ip ?? null,
    });

    // v4.17.0 修复：options.activeRole 只影响 JWT 不影响 user 对象会导致前端显示错误角色
    // 用 login 时解析的 activeRole 覆盖 toUser 输出的 active_role + role（过渡期同步）
    const userOut = toUser(user);
    if (activeRole !== userOut.active_role) {
      userOut.active_role = toContractUserRole(activeRole);
      userOut.role = toContractUserRole(activeRole) as unknown as UserRole;
    }

    return {
      token,
      user: { ...userOut, last_login_at: now, last_login_ip: ip ?? null },
    };
  }

  async getUser(userId: string): Promise<User> {
    const row = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!row) {
      throw new UserNotFoundError();
    }
    return toUser(row);
  }

  async updateUser(userId: string, updates: Partial<UserUpdate>): Promise<User> {
    // 角色变更约束：仅 server_admin 可改他人角色。
    // 本服务层不持有调用方上下文，该约束由路由层（users.ts 挂载 requireAdmin
    // = requireRole(Role.SERVER_ADMIN)）落地；服务层仅负责字段写入。
    const existing = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!existing) {
      throw new UserNotFoundError();
    }

    const updateFields: Partial<UserRow> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.username !== undefined) updateFields.username = updates.username;
    if (updates.password_hash !== undefined) updateFields.password_hash = updates.password_hash;
    // v4.19.2: users.role 列已 DROP，不再写入 updateFields.role
    // v4.17.0 同步 active_role（updates.role 来自 API 契约，映射到 active_role）
    if (updates.role !== undefined) {
      updateFields.active_role = updates.role;
    }
    if (updates.status !== undefined) updateFields.status = updates.status;
    if (updates.display_name !== undefined) updateFields.display_name = updates.display_name;
    if (updates.is_verified !== undefined) updateFields.is_verified = updates.is_verified ? 1 : 0;
    // v4.17.0 多角色字段
    if (updates.roles !== undefined) {
      const normalizedRoles = normalizeRoles(updates.roles);
      updateFields.roles = JSON.stringify(normalizedRoles);
      // 若未显式传 active_role，取 roles[0]
      if (updates.active_role !== undefined) {
        const ar = normalizeRole(updates.active_role);
        if (normalizedRoles.includes(ar)) {
          updateFields.active_role = ar;
        }
      } else if (existing.active_role == null || !normalizedRoles.includes(normalizeRole(existing.active_role))) {
        updateFields.active_role = normalizedRoles[0];
      }
    } else if (updates.active_role !== undefined) {
      const existingRoles = normalizeRoles(existing.roles);
      const ar = normalizeRole(updates.active_role);
      if (existingRoles.includes(ar)) {
        updateFields.active_role = ar;
      }
    }

    await this.db<UserRow>('users').where({ id: userId }).update(updateFields);

    const updated = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!updated) {
      throw new UserNotFoundError();
    }
    return toUser(updated);
  }

  /**
   * 软删除用户（v3.1.0 / user-service 1.2.0 新增）
   * 将 users.status 置为 'deleted'，保留外键约束。
   * 已 deleted 的用户将被 login() 拒绝（因 status !== 'active'）。
   * @throws {UserNotFoundError} userId 不存在
   */
  async softDeleteUser(userId: string): Promise<void> {
    const existing = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!existing) {
      throw new UserNotFoundError();
    }
    if (existing.status === 'deleted') {
      // 幂等：已删除的再次调用直接返回
      return;
    }
    const now = new Date().toISOString();
    await this.db<UserRow>('users').where({ id: userId }).update({
      status: 'deleted',
      updated_at: now,
    });
  }

  /**
   * 统计当前 active 状态的 server_admin 数量（v3.1.0 / user-service 1.2.0 新增）
   * excludeUserId：排除指定用户（删除前/降级前自检用，避免误判自身）
   *
   * v4.29.10 修复：原实现 `where({ role: Role.SERVER_ADMIN, ... })` 引用 v4.19.0 基线
   * 已 DROP 的 `users.role` 列，会抛 `SQLITE_ERROR: no such column: role`。
   * 改用 `active_role` 字段查询，与 batchSoftDelete 实现一致。
   */
  async countActiveServerAdmins(excludeUserId?: string): Promise<number> {
    let qb = this.db<UserRow>('users')
      .where({ active_role: Role.SERVER_ADMIN, status: 'active' });
    if (excludeUserId) {
      qb = qb.whereNot('id', excludeUserId);
    }
    const row = await qb.count<{ count: number }[]>({ count: '*' }).first();
    return Number(row?.count ?? 0);
  }

  async verifyPlayerBinding(
    userId: string,
    gamePlayerName: string,
    code: string,
  ): Promise<void> {
    const user = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!user) {
      throw new UserNotFoundError();
    }

    await this.db.transaction(async (trx) => {
      // v4.17.0: 统一 bindings 表，binding_type='player', scope_type='game_type' 表示玩家全局绑定
      // v4.27.0: scope_type 由 'game_type' 改为 'instance'（实例级玩家绑定）
      // 旧表字段映射：verify_code → verify_code, status='pending' → verify_status='pending'
      const binding = await trx<BindingRow>('bindings')
        .where({
          binding_type: 'player',
          scope_type: 'instance',
          user_id: userId,
          verify_code: code,
          verify_status: 'pending',
        })
        .first();
      if (!binding) {
        throw new VerifyCodeInvalidError();
      }

      const now = new Date().toISOString();
      // 旧表字段映射：status='verified' → verify_status='verified', game_player_name → player_name
      await trx('bindings').where({ id: binding.id }).update({
        verify_status: 'verified',
        player_name: gamePlayerName,
        verified_at: now,
        updated_at: now,
      });
      await trx('users').where({ id: userId }).update({
        is_verified: 1,
        updated_at: now,
      });
    });
  }

  /**
   * 游戏内 !register 命令调用：注册面板账号并创建 pending 玩家绑定。
   *
   * v4.27.0: 语义变更——从「绑定到 game_type 全局」改为「绑定到 instance 实例级」
   *   - 旧签名：registerFromGame(email, username, password, gamePlayerName, gameType)
   *   - 新签名：registerFromGame(email, username, password, gamePlayerName, serverId)
   *   - 写入 bindings 表：scope_type='instance', scope_ref=serverId（替代旧 gameType）
   *
   * 与 register() 区别：
   * - 使用传入的 gamePlayerName 填充 bindings.player_name（非空串占位）
   * - 绑定到具体实例（serverId），而非全局占位
   * - 返回 { success, message } 而非 { userId, verifyCode }，便于 inGameCommandService 直接回复
   */
  async registerFromGame(
    email: string,
    username: string,
    password: string,
    gamePlayerName: string,
    serverId: string,
  ): Promise<{ success: boolean; message: string }> {
    const existing = await this.db<UserRow>('users').where({ email }).first();
    if (existing) {
      return { success: false, message: `注册失败: 邮箱 ${email} 已被注册` };
    }

    // v4.27.0: 检查该 (server_id, player_name) 是否已存在 verified/pending 绑定
    // 排除 revoked（旧 rejected）状态，因为 revoked 视为软删除可重新绑定
    const existingBinding = await this.db<BindingRow>('bindings')
      .where({
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: serverId,
        player_name: gamePlayerName,
      })
      .whereNot('verify_status', 'revoked')
      .first();
    if (existingBinding) {
      return { success: false, message: `注册失败: 玩家名 ${gamePlayerName} 已绑定该实例` };
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const verifyCode = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    try {
      await this.db<UserRow>('users').insert({
        id: userId,
        email,
        username,
        password_hash: passwordHash,
        // v4.28.0: 移除 role 列写入（users.role 列已被基线 DROP，写入必抛 SQL 错误）
        status: 'active',
        display_name: username,
        vip_level: 0,
        vip_expires_at: null,
        is_verified: 0,
        last_login_at: null,
        last_login_ip: null,
        created_at: now,
        updated_at: now,
        // v4.17.0 初始化 roles + active_role
        // v4.28.0 全员服主：游戏内注册同样获得玩家+服主全集合
        roles: JSON.stringify(universalRolesFor(Role.USER)),
        active_role: Role.USER,
      });

      // v4.27.0: 写入实例级绑定（scope_type='instance', scope_ref=serverId）
      await this.db<BindingRow>('bindings').insert({
        user_id: userId,
        binding_type: 'player',
        scope_type: 'instance',
        scope_ref: serverId,
        player_name: gamePlayerName,
        vip_level: 0,
        wallet_id: null,
        verify_status: 'pending',
        verify_code: verifyCode,
        verify_expires_at: null,
        verified_at: null,
        metadata: JSON.stringify({ source: 'userService.registerFromGame' }),
        created_at: now,
        updated_at: now,
      });
    } catch {
      return { success: false, message: '注册失败: 数据库写入异常，请稍后重试' };
    }

    return {
      success: true,
      message: `注册成功！账号: ${email}，请前往 Web 面板登录并使用 !verify ${verifyCode} 完成绑定验证`,
    };
  }

  /**
   * 修改当前用户密码（v3.4.0 / user-service 1.3.0 新增）。
   *
   * 三重安全校验（s0103 融合定稿 §互斥点④ 全保留 A+B+C）：
   *   Layer 0: 旧密码校验 bcrypt.compare(oldPassword, user.password_hash)
   *            不匹配 → InvalidCredentialError（INVALID_CREDENTIAL, 401，复用既有码防枚举）
   *   Layer 1: zxcvbn 强度校验 score < minZxcvbnScore → PasswordStrengthInsufficientError（400）
   *   Layer 2: bcrypt 历史对比最近 maxHistory 条 → PasswordReusedError（409）
   *   Layer 3: token_version +1，使旧 JWT 在下次请求被 authenticateToken 拒绝
   *
   * 事务保护：UPDATE users + INSERT user_password_history 在同一 knex transaction 内。
   * 自包含实现（不依赖模块3 passwordService），与 register/login 共用 bcryptjs。
   *
   * @throws {InvalidCredentialError} oldPassword 不匹配（401）
   * @throws {PasswordStrengthInsufficientError} zxcvbn score 不达标（400）
   * @throws {PasswordReusedError} 新密码命中历史（409）
   * @throws {UserNotFoundError} userId 不存在
   */
  async updatePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ tokenVersion: number }> {
    // ----- Layer 0: 取用户 + 旧密码校验 -----
    const user = await this.db<UserRow>('users').where({ id: userId }).first();
    // 防枚举：用户不存在时同样抛 InvalidCredentialError
    if (!user) {
      throw new InvalidCredentialError();
    }

    const oldMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!oldMatch) {
      throw new InvalidCredentialError();
    }

    // ----- Layer 1: zxcvbn 强度校验 -----
    // minZxcvbnScore = 0 时禁用强度校验（仅开发环境，配置契约允许）
    if (this.minZxcvbnScore > 0) {
      const strength = zxcvbn(newPassword);
      if (strength.score < this.minZxcvbnScore) {
        throw new PasswordStrengthInsufficientError(
          `密码强度不足: zxcvbn score ${strength.score} < required ${this.minZxcvbnScore}`,
        );
      }
    }

    // ----- Layer 2: bcrypt 历史对比 -----
    // maxHistory = 0 时禁用历史校验（配置契约允许）
    if (this.maxHistory > 0) {
      const history = await this.db<{ user_id: string; password_hash: string }>('user_password_history')
        .select('password_hash')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(this.maxHistory);

      for (const row of history) {
        const reused = await bcrypt.compare(newPassword, row.password_hash);
        if (reused) {
          throw new PasswordReusedError();
        }
      }
    }

    // ----- Layer 3: 事务保护 — UPDATE users + INSERT history -----
    const newHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();
    const nextTokenVersion = user.token_version + 1;

    await this.db.transaction(async (trx) => {
      // 1. UPDATE users：password_hash + token_version+1 + updated_at
      await trx<UserRow>('users').where({ id: userId }).update({
        password_hash: newHash,
        token_version: nextTokenVersion,
        updated_at: now,
      });

      // 2. INSERT user_password_history：记录旧密码哈希（旧密码生效时间 = 当前）
      await trx('user_password_history').insert({
        user_id: userId,
        password_hash: user.password_hash,
        created_at: now,
      });

      // 3. 历史条数超限时删除旧行（保留最近 maxHistory 条）
      if (this.maxHistory > 0) {
        const overflowRows = await trx<{ id: string; user_id: string }>('user_password_history')
          .select('id')
          .where({ user_id: userId })
          .orderBy('created_at', 'desc')
          .offset(this.maxHistory)
          .limit(this.maxHistory);

        if (overflowRows.length > 0) {
          await trx('user_password_history')
            .whereIn(
              'id',
              overflowRows.map((r) => r.id),
            )
            .delete();
        }
      }
    });

    return { tokenVersion: nextTokenVersion };
  }

  // ==========================================================================
  // v4.17.0 多角色管理（@since 1.4.0）
  // ==========================================================================

  /**
   * 更新用户角色集合（v1.4.0 新增）。
   *
   * 流程：
   *   1. 校验 roles 非空、元素合法、元素唯一
   *   2. 校验 activeRole ∈ roles（若未传则取 roles[0]）
   *   3. UPDATE users SET roles = JSON, active_role = activeRole, role = activeRole（过渡期同步）
   *   4. 撤销该用户所有未过期 token（tokenBlacklist + token_version+1）
   *   5. 返回更新后的用户 + 被撤销的 token 数
   *
   * v4.19.0 R3-11-1 修复：activeRole 显式传入但不在 roles 中时抛
   * InvalidCredentialError（原 resolveActiveRole 静默降级到 roles[0] 违反契约）。
   * v4.19.0 R3-11-2 修复：UPDATE + revokeAllUserTokens 包进同一事务，
   * 撤销失败自动回滚 UPDATE，避免高权限旧 token 窗口残留。
   */
  async updateUserRoles(
    userId: string,
    roles: UserRole[],
    activeRole?: UserRole,
  ): Promise<{ user: User; revokedTokenCount: number }> {
    const existing = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!existing) {
      throw new UserNotFoundError();
    }

    // 校验 roles 非空
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new InvalidCredentialError('角色集合不能为空');
    }

    // 归一化 + 去重
    const normalizedRoles = normalizeRoles(roles);
    if (normalizedRoles.length === 0) {
      throw new InvalidCredentialError('角色集合归一化后为空');
    }

    // v4.19.0 R3-11-1: 显式校验 activeRole ∈ roles（不再静默降级）
    // - activeRole 未传（undefined）→ 取 roles[0]（契约允许）
    // - activeRole 已传但不在 roles 中 → 抛 InvalidCredentialError（契约要求）
    let finalActiveRole: Role;
    if (activeRole !== undefined) {
      const normalizedActive = normalizeRole(activeRole);
      if (!normalizedRoles.includes(normalizedActive)) {
        throw new InvalidCredentialError(
          `活动角色 ${activeRole} 不在角色集合 [${normalizedRoles.join(', ')}] 中`,
        );
      }
      finalActiveRole = normalizedActive;
    } else {
      finalActiveRole = normalizedRoles[0];
    }

    // v4.19.0 R3-11-2: UPDATE + revoke 在同一事务内
    // 撤销失败（任何异常）→ 事务自动回滚 UPDATE，避免高权限旧 token 窗口残留
    const blacklist = getTokenBlacklistService();
    const oldTokenVersion = await this.db.transaction(async (trx) => {
      const now = new Date().toISOString();
      await trx<UserRow>('users').where({ id: userId }).update({
        roles: JSON.stringify(normalizedRoles),
        active_role: finalActiveRole,
        role: finalActiveRole, // 过渡期同步 role 字段
        updated_at: now,
      });

      // 事务内：SELECT token_version + UPDATE token_version+1（与 revokeAllUserTokens 等价）
      // 不直接调 revokeAllUserTokens 是因为它内部会再开事务，导致事务嵌套语义混乱
      const user = await trx<{ id: string; token_version: number }>('users')
        .select('token_version')
        .where({ id: userId })
        .first();

      if (!user) {
        // 理论上不会发生（刚 UPDATE 成功），事务回滚
        throw new UserNotFoundError();
      }

      const oldVersion = user.token_version ?? 0;
      await trx('users').where({ id: userId }).increment('token_version', 1);
      return oldVersion;
    });

    // 事务提交成功后：写入内存黑名单（无法回滚，须在事务提交后执行）
    // 即便黑名单写入失败（理论上不会，revokeTokenVersion 不抛异常），
    // token_version 已递增，旧 JWT 仍会被 auth 中间件 token_version 校验兜底拒绝
    const added = blacklist.revokeTokenVersion(userId, oldTokenVersion);
    const revokedTokenCount = added ? 1 : 0;

    const updated = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!updated) {
      throw new UserNotFoundError();
    }
    return { user: toUser(updated), revokedTokenCount };
  }

  /**
   * 查询用户角色集合 + 活动角色（v1.4.0 新增）。
   */
  async listUserRoles(
    userId: string,
  ): Promise<{
    user_id: string;
    roles: UserRole[];
    active_role: UserRole;
    requires_role_selection: boolean;
  }> {
    const row = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!row) {
      throw new UserNotFoundError();
    }
    const roles = normalizeRoles(row.roles);
    const activeRole = resolveActiveRole(row.active_role, roles);
    return {
      user_id: userId,
      roles: toContractUserRoles(roles),
      active_role: toContractUserRole(activeRole),
      requires_role_selection: roles.length > 1,
    };
  }

  /**
   * 切换会话级活动角色（v1.4.0 新增；v4.19.0 R3-4 修复）。
   *
   * v4.19.0 R3-4 修复：角色权限降级（高→低）时强制撤销旧 token，
   * 避免用户先用 instance_admin 操作、切换回 user 后旧 JWT 仍在有效期内
   * 可继续 instance_admin 操作、审计归属混淆。同级或升级不撤销。
   *
   * 流程：
   *   1. 校验 activeRole ∈ users.roles
   *   2. UPDATE users SET active_role = activeRole, role = activeRole（过渡期同步）
   *   3. 若 activeRole 等级 < 原 active_role 等级且原角色为 server_admin → revokeAllUserTokens
   *      （v4.28.0 收窄：user ↔ instance_admin 同层互切不撤销其他会话）
   *   4. 签发新 JWT（包含 roles + active_role）
   *   5. 返回新 token + 更新后的用户
   *
   * 撤销失败处理：撤销异常会向上抛出（不静默吞掉），此时 active_role 已更新、
   * 新 token 未签发，用户需重新登录获取新角色 token。这是 R3-4 的安全语义：
   * 宁可让用户重登，也不允许高权限旧 token 窗口残留。
   */
  async selectActiveRole(
    userId: string,
    activeRole: UserRole,
  ): Promise<{ token: string; user: User }> {
    const row = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!row) {
      throw new UserNotFoundError();
    }

    const roles = normalizeRoles(row.roles);
    const targetRole = normalizeRole(activeRole);
    if (!roles.includes(targetRole)) {
      throw new InvalidCredentialError(`角色 ${activeRole} 不在用户角色集合中`);
    }

    // v4.19.0 R3-4: 计算角色优先级，判断是否为降级
    // v4.28.0 收窄（SB-4）：仅当原 active_role 为 server_admin（level 3）的降级才撤销全部 token。
    //   user ↔ instance_admin 为同层身份两面（全员服主决策），互切不再踢掉其他设备会话——
    //   这是快捷互切的必要条件；两级均为低权限同层身份，JWT 本身已含全量 roles，安全影响可接受。
    const oldActiveRole = normalizeRole(row.active_role ?? Role.USER);
    const isDowngrade =
      ROLE_LEVEL[targetRole] < ROLE_LEVEL[oldActiveRole] &&
      ROLE_LEVEL[oldActiveRole] >= ROLE_LEVEL[Role.SERVER_ADMIN];

    const now = new Date().toISOString();
    // v4.19.2: users.role 列已 DROP，仅更新 active_role
    await this.db<UserRow>('users').where({ id: userId }).update({
      active_role: targetRole,
      updated_at: now,
    });

    // v4.19.0 R3-4: 角色降级时撤销旧 token（必须在 UPDATE 之后、签发新 token 之前）
    // 撤销失败 → 抛异常，前端捕获后引导用户重新登录（不签发新 token）
    if (isDowngrade) {
      const blacklist = getTokenBlacklistService();
      await blacklist.revokeAllUserTokens(this.db, userId);
    }

    const updated = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!updated) {
      throw new UserNotFoundError();
    }

    const token = signToken(
      {
        userId: updated.id,
        email: updated.email,
        username: updated.username,
        role: targetRole,
        token_version: updated.token_version,
        roles,
        active_role: targetRole,
      },
      this.jwtSecret,
    );

    return { token, user: toUser(updated) };
  }

  /**
   * 撤销用户所有未过期 token（v1.4.0 新增）。
   *
   * 用途：管理员强制下线用户、安全事件应急响应
   */
  async revokeUserTokens(userId: string): Promise<{ revokedTokenCount: number }> {
    const existing = await this.db<UserRow>('users').where({ id: userId }).first();
    if (!existing) {
      throw new UserNotFoundError();
    }
    const blacklist = getTokenBlacklistService();
    const revokedTokenCount = await blacklist.revokeAllUserTokens(this.db, userId);
    return { revokedTokenCount };
  }

  // ==========================================================================
  // v4.24.0 用户批量管理（user-service 1.5.0）
  // ==========================================================================

  /**
   * 批量更新用户状态（启用/禁用）。
   *
   * 设计要点：
   * - 接受外部事务 trx，由路由层包裹 db.transaction 保证原子性
   * - 单条失败不抛异常，记入 results 数组返回
   * - 已 deleted 的用户再次 disable 视为非法（不允许跨状态恢复）
   * - 已 deleted 的用户尝试 enable 视为非法（恢复需走专门流程）
   *
   * 保护逻辑（operatorId 命中、is_built_in=1）由路由层在调用前过滤。
   */
  async batchUpdateStatus(
    trx: Knex.Transaction,
    userIds: string[],
    status: 'active' | 'disabled',
  ): Promise<BatchUserOperationResult[]> {
    const results: BatchUserOperationResult[] = [];
    if (userIds.length === 0) return results;

    const now = new Date().toISOString();
    // 一次性查出所有目标用户，避免 N+1
    const rows = await trx<UserRow>('users').whereIn('id', userIds).select('id', 'status');
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    for (const userId of userIds) {
      const row = rowMap.get(userId);
      if (!row) {
        results.push({ user_id: userId, ok: false, error: '用户不存在' });
        continue;
      }
      if (row.status === 'deleted') {
        results.push({
          user_id: userId,
          ok: false,
          error: '已删除用户不可直接启用/禁用（需走恢复流程）',
        });
        continue;
      }
      if (row.status === status) {
        // 幂等：状态一致视为成功
        results.push({ user_id: userId, ok: true });
        continue;
      }
      try {
        await trx<UserRow>('users').where({ id: userId }).update({
          status,
          updated_at: now,
        });
        results.push({ user_id: userId, ok: true });
      } catch (err) {
        results.push({
          user_id: userId,
          ok: false,
          error: err instanceof Error ? err.message : '更新失败',
        });
      }
    }
    return results;
  }

  /**
   * 批量软删除用户。
   *
   * 保护逻辑：
   * - operatorId 命中 → 该条返回 ok=false, error='不能操作自己'
   * - is_built_in=1 → 该条返回 ok=false, error='系统内置账号不可批量操作'
   * - 目标含 server_admin 且删除后剩余 0 → 该条返回 ok=false, error='不能删除最后一个 server_admin'
   * - 已 deleted 的用户再次删除视为幂等成功
   */
  async batchSoftDelete(
    trx: Knex.Transaction,
    userIds: string[],
    operatorId: string,
  ): Promise<BatchUserOperationResult[]> {
    const results: BatchUserOperationResult[] = [];
    if (userIds.length === 0) return results;

    const now = new Date().toISOString();
    const rows = await trx<UserRow>('users')
      .whereIn('id', userIds)
      .select('id', 'status', 'is_built_in', 'active_role');
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    // 预检查：删除后剩余 active server_admin 数（排除本次待删除的 server_admin）
    const targetServerAdminIds: string[] = [];
    for (const userId of userIds) {
      const row = rowMap.get(userId);
      if (!row) continue;
      if (row.status === 'deleted') continue; // 已删除不参与计数
      if (row.is_built_in === 1) continue; // 内置账号不会被删除
      if (userId === operatorId) continue; // 自保护拦截，不会真正删除
      const ar = normalizeRole(row.active_role ?? Role.USER);
      if (ar === Role.SERVER_ADMIN) targetServerAdminIds.push(userId);
    }

    let remainingServerAdmins = 0;
    if (targetServerAdminIds.length > 0) {
      // SQLite 不支持 JSON 查询，遍历筛选 active server_admin
      const candidates = await trx<UserRow>('users')
        .where({ status: 'active' })
        .whereNotIn('id', targetServerAdminIds)
        .select('id', 'active_role');
      remainingServerAdmins = candidates.filter((r) => {
        const ar = normalizeRole(r.active_role ?? Role.USER);
        return ar === Role.SERVER_ADMIN;
      }).length;
    }

    for (const userId of userIds) {
      const row = rowMap.get(userId);
      if (!row) {
        results.push({ user_id: userId, ok: false, error: '用户不存在' });
        continue;
      }
      if (userId === operatorId) {
        results.push({ user_id: userId, ok: false, error: '不能操作自己' });
        continue;
      }
      if (row.is_built_in === 1) {
        results.push({ user_id: userId, ok: false, error: '系统内置账号不可批量操作' });
        continue;
      }
      if (row.status === 'deleted') {
        // 幂等
        results.push({ user_id: userId, ok: true });
        continue;
      }
      const ar = normalizeRole(row.active_role ?? Role.USER);
      if (ar === Role.SERVER_ADMIN && remainingServerAdmins === 0) {
        results.push({
          user_id: userId,
          ok: false,
          error: '不能删除最后一个 server_admin',
        });
        continue;
      }
      try {
        await trx<UserRow>('users').where({ id: userId }).update({
          status: 'deleted',
          updated_at: now,
        });
        // 删除成功后，若该用户是 server_admin，则剩余数 -1
        if (ar === Role.SERVER_ADMIN) remainingServerAdmins -= 1;
        results.push({ user_id: userId, ok: true });
      } catch (err) {
        results.push({
          user_id: userId,
          ok: false,
          error: err instanceof Error ? err.message : '删除失败',
        });
      }
    }
    return results;
  }

  /**
   * 批量设置用户角色（覆盖式：roles=[role] + active_role=role）。
   *
   * 保护逻辑（operatorId 命中、is_built_in=1）由路由层在调用前过滤。
   * 已 deleted 的用户也允许改角色（不影响 deleted 状态）。
   */
  async batchSetRole(
    trx: Knex.Transaction,
    userIds: string[],
    role: UserRole,
  ): Promise<BatchUserOperationResult[]> {
    const results: BatchUserOperationResult[] = [];
    if (userIds.length === 0) return results;

    const now = new Date().toISOString();
    const normalizedRole = normalizeRole(role);
    const rolesJson = JSON.stringify([normalizedRole]);

    const rows = await trx<UserRow>('users').whereIn('id', userIds).select('id');
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    for (const userId of userIds) {
      const row = rowMap.get(userId);
      if (!row) {
        results.push({ user_id: userId, ok: false, error: '用户不存在' });
        continue;
      }
      try {
        await trx<UserRow>('users').where({ id: userId }).update({
          roles: rolesJson,
          active_role: normalizedRole,
          updated_at: now,
        });
        results.push({ user_id: userId, ok: true });
      } catch (err) {
        results.push({
          user_id: userId,
          ok: false,
          error: err instanceof Error ? err.message : '更新失败',
        });
      }
    }
    return results;
  }

  /**
   * 用户分析统计（只读，单条 SQL 聚合）。
   */
  async getUserStats(): Promise<UserStatsResponse> {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. 总数 + 状态分布 + 内置账号数
    const allRows = await this.db<UserRow>('users').select(
      'id',
      'status',
      'active_role',
      'roles',
      'is_built_in',
      'created_at',
      'last_login_at',
    );

    const byStatus = { active: 0, disabled: 0, deleted: 0 };
    const byRole: Record<UserRole, number> = {
      server_admin: 0,
      instance_admin: 0,
      user: 0,
    };
    let registeredLast7d = 0;
    let registeredLast30d = 0;
    let activeLast7d = 0;
    let activeLast30d = 0;
    let builtInCount = 0;

    for (const r of allRows) {
      // 状态分布
      if (r.status === 'active') byStatus.active += 1;
      else if (r.status === 'disabled') byStatus.disabled += 1;
      else if (r.status === 'deleted') byStatus.deleted += 1;

      // 内置账号
      if (r.is_built_in === 1) builtInCount += 1;

      // 角色分布（仅统计非 deleted）
      if (r.status !== 'deleted') {
        const ar = normalizeRole(r.active_role ?? Role.USER);
        const contractRole = toContractUserRole(ar);
        if (contractRole in byRole) {
          byRole[contractRole] += 1;
        }
      }

      // 注册时间
      if (r.created_at) {
        if (r.created_at >= sevenDaysAgo) registeredLast7d += 1;
        if (r.created_at >= thirtyDaysAgo) registeredLast30d += 1;
      }

      // 最近登录时间
      if (r.last_login_at) {
        if (r.last_login_at >= sevenDaysAgo) activeLast7d += 1;
        if (r.last_login_at >= thirtyDaysAgo) activeLast30d += 1;
      }
    }

    return {
      total: allRows.length,
      by_status: byStatus,
      by_role: byRole,
      registered_last_7d: registeredLast7d,
      registered_last_30d: registeredLast30d,
      active_last_7d: activeLast7d,
      active_last_30d: activeLast30d,
      built_in_count: builtInCount,
    };
  }
}

/**
 * 创建 userService 的工厂函数
 */
export function createUserService(db: Knex, jwtSecret: string): UserService {
  return new UserServiceImpl(db, jwtSecret);
}
