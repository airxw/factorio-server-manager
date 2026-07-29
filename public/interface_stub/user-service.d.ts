/**
 * user-service.d.ts — userService 接口存根
 *
 * 职责：用户注册 / 登录 / JWT / VIP 等级管理 / 多角色管理
 * 数据契约：public/schema/user-schema.json
 * 来源：scheme-final-merged.md §7.1 P1 / §6.1 用户表迁移
 *
 * @version 1.5.0
 * @changelog
 *   1.5.0 (MINOR): v4.24.0 用户批量管理与分析
 *     - 新增 batchUpdateStatus / batchSoftDelete / batchSetRole / getUserStats 方法
 *     - 批量方法接受外部事务 trx，由路由层包裹原子事务
 *     - 单条失败不抛异常，记入 BatchUserOperationResult[] 返回
 *   1.4.0 (MINOR): v4.17.0 多角色支持
 *     - login() 新增 activeRole 可选参数，签发 JWT 包含 roles + active_role
 *     - 新增 updateUserRoles / listUserRoles / selectActiveRole / revokeUserTokens 方法
 *   1.3.0 (MINOR): 新增 updatePassword 方法（zxcvbn + 历史 + token_version 三重校验）。
 *   1.2.0 (MINOR): 新增 softDeleteUser / countActiveServerAdmins 方法。
 *                  register() 可选参数 role/display_name 扩展（不破坏现有调用）。
 *   1.1.0 (MINOR): 新增 registerFromGame 方法，支持游戏内 !register 命令注册面板账号。
 *   1.0.0: 初始版本（register / login / getUser / updateUser / verifyPlayerBinding）
 */

import type { User, UserUpdate, UserRole } from './shared-types';
import type { Knex } from 'knex';
import type {
  BatchUserOperationResult,
  UserStatsResponse,
} from '@public/schema/panel-api-types';
import {
  UserNotFoundError,
  InvalidCredentialError,
  UserAlreadyExistsError,
  VerifyCodeInvalidError,
  PasswordStrengthInsufficientError,
  PasswordReusedError,
} from './shared-types';

/** register() 可选参数（v1.2.0 新增） */
export interface RegisterOptions {
  /** 指定创建用户的角色（默认 Role.USER） */
  role?: UserRole;
  /** 自定义 display_name（默认等于 username） */
  display_name?: string;
}

/** login() 可选参数（v1.4.0 新增） */
export interface LoginOptions {
  /**
   * 指定登录后激活的角色（必须 ∈ users.roles）
   * 缺省时取 roles[0]
   */
  activeRole?: UserRole;
  /** 客户端 IP（用于 last_login_ip 审计） */
  ip?: string;
}

export interface UserService {
  /**
   * 用户注册。生成新 UUID，写入 users 表（status=active, vip_level=0）。
   * 同时生成 player_bindings 验证码（verify_code），返回给调用方由其引导用户完成游戏内绑定。
   *
   * v4.17.0: 同时初始化 users.roles = [role] + users.active_role = role
   *
   * @param options 可选；v1.2.0 扩展支持指定 role（管理员创建用户）与 display_name。
   * @throws {UserAlreadyExistsError} email 已存在
   */
  register(
    email: string,
    username: string,
    password: string,
    options?: RegisterOptions,
  ): Promise<{ userId: string; verifyCode: string }>;

  /**
   * 用户登录。校验密码后签发 JWT，更新 last_login_at / last_login_ip。
   * 不区分"邮箱不存在"与"密码错误"以防枚举攻击。
   *
   * v4.17.0: JWT 包含 roles + active_role 字段；activeRole 可选参数指定会话级活动角色
   *
   * @param options v1.4.0 新增；activeRole 指定活动角色，ip 用于审计
   * @throws {InvalidCredentialError} 邮箱或密码不匹配
   * @throws {UserNotFoundError} 用户不存在（与 InvalidCredentialError 二选一，实现可合并）
   */
  login(
    email: string,
    password: string,
    options?: LoginOptions,
  ): Promise<{ token: string; user: User }>;

  /**
   * 查询用户。返回完整 User 记录（不含明文密码）。
   * @throws {UserNotFoundError} userId 不存在
   */
  getUser(userId: string): Promise<User>;

  /**
   * 更新用户。仅允许修改 UserUpdate 子集字段。
   * @throws {UserNotFoundError} userId 不存在
   */
  updateUser(userId: string, updates: Partial<UserUpdate>): Promise<User>;

  /**
   * 完成玩家游戏名绑定验证。校验 verify_code 后将 player_bindings.status 置为 verified，
   * 并将 users.is_verified 置为 true。
   * @throws {VerifyCodeInvalidError} 验证码错误或已过期
   * @throws {UserNotFoundError} userId 不存在
   */
  verifyPlayerBinding(
    userId: string,
    gamePlayerName: string,
    code: string,
  ): Promise<void>;

  /**
   * 游戏内 !register 命令调用：注册面板账号并创建 pending 玩家绑定。
   *
   * v4.27.0: 语义变更——从「绑定到 game_type 全局」改为「绑定到 instance 实例级」
   *   - 旧签名最后一个参数为 gameType（写入 bindings.scope_ref，scope_type='game_type'）
   *   - 新签名最后一个参数为 serverId（写入 bindings.scope_ref，scope_type='instance'）
   *
   * 与 register() 区别：
   * - 使用传入的 gamePlayerName 填充 bindings.player_name（非空串占位）
   * - 绑定到具体实例（serverId），而非全局占位
   * - 返回 { success, message } 而非 { userId, verifyCode }，便于 inGameCommandService 直接回复
   *
   * 失败原因（不抛异常，返回 success=false）：
   * - 邮箱已被注册
   * - (serverId, player_name) 已存在 verified/pending 绑定
   * - 数据库写入异常
   *
   * @since 1.1.0
   * @version 4.27.0 参数 gameType → serverId（BREAKING）
   */
  registerFromGame(
    email: string,
    username: string,
    password: string,
    gamePlayerName: string,
    serverId: string,
  ): Promise<{ success: boolean; message: string }>;

  /**
   * 软删除用户（v1.2.0 新增）。
   * 将 users.status 置为 'deleted'，保留外键约束。deleted 用户不可登录。
   * 不级联删除 player_bindings / servers / wallets 等关联数据。
   * @throws {UserNotFoundError} userId 不存在
   * @since 1.2.0
   */
  softDeleteUser(userId: string): Promise<void>;

  /**
   * 统计当前 active 状态的 server_admin 数量（v1.2.0 新增）。
   * 用于防止删除最后一个 server_admin 导致系统失去管理入口。
   * @since 1.2.0
   */
  countActiveServerAdmins(excludeUserId?: string): Promise<number>;

  /**
   * 修改当前用户密码（v1.3.0 新增）。
   *
   * 三重安全校验（s0103 融合定稿 §互斥点④ 全保留 A+B+C）：
   * A. zxcvbn 密码强度校验：score < auth.password_policy.min_zxcvbn_score（默认 3）时拒绝
   * B. 密码历史校验：新密码哈希与 user_password_history 最近 max_history（默认 5）条任意一条
   *    通过 bcrypt.compare 命中时拒绝（防重用）
   * C. token_version 失效：成功修改后 users.token_version += 1，使所有旧 JWT 在下次
   *    请求时被 authenticateToken 中间件拒绝（前端捕获 401 后跳登录页）
   *
   * 成功路径：
   * 1. bcrypt.hash(newPassword) → 写入 users.password_hash
   * 2. 旧 password_hash 写入 user_password_history（保留 created_at = 旧密码生效时间）
   * 3. users.token_version += 1
   * 4. users.updated_at = now()
   * 5. 返回新的 token_version（前端可选用新 token 重新登录，或强制下线）
   *
   * 审计：记 'user.change_password' 事件，不含明文密码
   *
   * @throws {InvalidCredentialError} oldPassword 不匹配当前密码（错误码 AUTH_PWD_001，401）
   * @throws {PasswordStrengthInsufficientError} zxcvbn score 不达标（错误码 AUTH_PWD_002，400）
   * @throws {PasswordReusedError} 新密码命中历史（错误码 AUTH_PWD_003，409）
   * @throws {UserNotFoundError} userId 不存在
   * @since 1.3.0
   */
  updatePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ tokenVersion: number }>;

  // ==========================================================================
  // v4.17.0 多角色管理（@since 1.4.0）
  // ==========================================================================

  /**
   * 更新用户角色集合（v1.4.0 新增；v4.19.0 R3-11 修订）。
   *
   * v4.19.0 R3-11-1 修订：activeRole 显式传入但不在 roles 中时抛
   * InvalidCredentialError（与契约声明一致，不再静默降级到 roles[0]）。
   * v4.19.0 R3-11-2 修订：UPDATE users + token_version+1 包进同一 knex 事务，
   * 撤销失败自动回滚 UPDATE，避免高权限旧 token 窗口残留。
   *
   * 流程：
   *   1. 校验 roles 非空、元素合法、元素唯一
   *   2. 校验 activeRole ∈ roles（若未传则取 roles[0]；显式传入但不在 roles 中 → 抛错）
   *   3. 事务内：UPDATE users SET roles = JSON, active_role, role（过渡期同步）
   *   4. 事务内：SELECT token_version + UPDATE token_version+1（原子化）
   *   5. 事务提交后：写入内存黑名单 (userId, old_token_version)
   *   6. 返回更新后的用户 + 被撤销的 token 数
   *
   * 权限：仅 server_admin 可调用（路由层落地，服务层不校验）
   *
   * @param userId 目标用户 ID
   * @param roles 角色集合（至少一个角色）
   * @param activeRole 可选活动角色，缺省取 roles[0]；显式传入时必须在 roles 中
   * @throws {UserNotFoundError} userId 不存在
   * @throws {InvalidCredentialError} roles 为空或 activeRole 不在 roles 中
   * @throws {Error} 事务异常（撤销失败时事务回滚，异常向上抛出）
   * @since 1.4.0
   */
  updateUserRoles(
    userId: string,
    roles: UserRole[],
    activeRole?: UserRole,
  ): Promise<{ user: User; revokedTokenCount: number }>;

  /**
   * 查询用户角色集合 + 活动角色（v1.4.0 新增）。
   *
   * @param userId 用户 ID
   * @throws {UserNotFoundError} userId 不存在
   * @since 1.4.0
   */
  listUserRoles(
    userId: string,
  ): Promise<{
    user_id: string;
    roles: UserRole[];
    active_role: UserRole;
    /** roles.length > 1 时为 true，前端展示角色切换入口 */
    requires_role_selection: boolean;
  }>;

  /**
   * 切换会话级活动角色（v1.4.0 新增；v4.19.0 R3-4 修订）。
   *
   * 流程：
   *   1. 校验 activeRole ∈ users.roles
   *   2. UPDATE users SET active_role = activeRole, role = activeRole（过渡期同步）
   *   3. v4.19.0 R3-4: 若 activeRole 等级 < 原 active_role 等级（角色降级），
   *      调用 revokeAllUserTokens 撤销旧 token；同级或升级不撤销。
   *   4. 签发新 JWT（包含 roles + active_role）
   *   5. 返回新 token + 更新后的用户
   *
   * v4.19.0 R3-4 行为变更：角色降级时撤销旧 token（不再"不撤销"）。
   * 原因：避免用户先用 instance_admin 操作、切换回 user 后旧 JWT 仍在有效期内
   * 可继续 instance_admin 操作，导致审计归属混淆。
   *
   * 撤销失败时抛异常（不静默吞掉），此时 active_role 已更新、新 token 未签发，
   * 用户需重新登录获取新角色 token。
   *
   * @param userId 用户 ID
   * @param activeRole 要激活的角色（必须 ∈ users.roles）
   * @throws {UserNotFoundError} userId 不存在
   * @throws {InvalidCredentialError} activeRole 不在用户角色集合中
   * @throws {Error} 角色降级时撤销 token 失败（事务异常等）
   * @since 1.4.0
   */
  selectActiveRole(
    userId: string,
    activeRole: UserRole,
  ): Promise<{ token: string; user: User }>;

  /**
   * 撤销用户所有未过期 token（v1.4.0 新增；v4.19.0 R3-3 修订）。
   *
   * v4.19.0 R3-3 修订：SELECT token_version + UPDATE token_version+1 包进
   * knex transaction，避免 DB 异常 + 旧用户（token_version=0）场景下黑名单失效。
   * 事务异常时抛出（不再静默降级），由调用方决定回滚/阻断策略。
   *
   * 流程：
   *   1. 事务内：SELECT users.token_version + UPDATE token_version+1（原子化）
   *   2. 事务外：将 (userId, old_token_version) 加入 JWT 黑名单
   *   3. 返回被撤销的 token 版本数（0 或 1）
   *
   * 用途：管理员强制下线用户、安全事件应急响应、角色降级时撤销旧 token
   *
   * @param userId 用户 ID
   * @throws {UserNotFoundError} userId 不存在（注：当前实现返回 0，不抛此异常；
   *         事务异常会向上抛出）
   * @since 1.4.0
   */
  revokeUserTokens(userId: string): Promise<{ revokedTokenCount: number }>;

  // ==========================================================================
  // v4.24.0 用户批量管理（@since 1.5.0）
  // ==========================================================================

  /**
   * 批量更新用户状态（启用/禁用）（v1.5.0 新增）。
   *
   * 设计要点：
   * - 接受外部事务 trx，由路由层包裹 db.transaction 保证原子性
   * - 单条失败不抛异常，记入 results 数组返回
   * - 保护逻辑（调用方在路由层执行，本方法仅做纯写入）：
   *     · operatorId 命中 → 调用方应跳过
   *     · is_built_in=1 命中 → 调用方应跳过
   * - 已 deleted 的用户再次 disable 视为幂等成功；将 status='deleted' 改为 'active'/'disabled' 视为非法（返回失败）
   *
   * @param trx knex 事务
   * @param userIds 目标用户 ID 列表（已去重）
   * @param status 目标状态：'active' | 'disabled'
   * @returns 每个用户的操作结果（顺序与输入一致）
   * @since 1.5.0
   */
  batchUpdateStatus(
    trx: Knex.Transaction,
    userIds: string[],
    status: 'active' | 'disabled',
  ): Promise<BatchUserOperationResult[]>;

  /**
   * 批量软删除用户（v1.5.0 新增）。
   *
   * 设计要点：
   * - 接受外部事务 trx
   * - 单条失败不抛异常，记入 results 数组返回
   * - 保护逻辑：
   *     · operatorId 命中 → 该条返回 ok=false, error='不能操作自己'
   *     · is_built_in=1 → 该条返回 ok=false, error='系统内置账号不可批量操作'
   *     · 目标含 server_admin 且删除后剩余 0 → 该条返回 ok=false, error='不能删除最后一个 server_admin'
   * - 已 deleted 的用户再次删除视为幂等成功
   *
   * @param trx knex 事务
   * @param userIds 目标用户 ID 列表（已去重）
   * @param operatorId 当前操作者用户 ID（用于自保护）
   * @returns 每个用户的操作结果
   * @since 1.5.0
   */
  batchSoftDelete(
    trx: Knex.Transaction,
    userIds: string[],
    operatorId: string,
  ): Promise<BatchUserOperationResult[]>;

  /**
   * 批量设置用户角色（v1.5.0 新增）。
   *
   * 设计要点：
   * - 仅设置 active_role + roles=[role]（覆盖式，不保留原角色集合）
   * - 接受外部事务 trx
   * - 单条失败不抛异常，记入 results 数组返回
   * - 保护逻辑（调用方在路由层执行）：
   *     · operatorId 命中 → 调用方应跳过
   *     · is_built_in=1 → 调用方应跳过
   * - 角色合法性由调用方校验（normalizeRole）
   *
   * @param trx knex 事务
   * @param userIds 目标用户 ID 列表（已去重）
   * @param role 目标角色
   * @returns 每个用户的操作结果
   * @since 1.5.0
   */
  batchSetRole(
    trx: Knex.Transaction,
    userIds: string[],
    role: UserRole,
  ): Promise<BatchUserOperationResult[]>;

  /**
   * 用户分析统计（v1.5.0 新增）。
   *
   * 单条 SQL 聚合查询，无副作用。
   * 返回 UserStatsResponse，包含总数 / 状态分布 / 角色分布 / 最近 7/30 天注册与登录数 / 内置账号数。
   *
   * @returns 用户分析统计概览
   * @since 1.5.0
   */
  getUserStats(): Promise<UserStatsResponse>;
}

export {
  UserNotFoundError,
  InvalidCredentialError,
  UserAlreadyExistsError,
  VerifyCodeInvalidError,
} from './shared-types';
