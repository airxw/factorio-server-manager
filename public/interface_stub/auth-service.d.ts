// ============================================================================
// auth-service.d.ts — v4.17.0 多角色认证服务接口存根
//
// 用途：扩展旧单值 role 为多值 roles + active_role 机制；
//       提供角色选择、JWT 黑名单、token 撤销等能力。
//
// 实现方：panel/backend/src/services/authService.ts（待创建，复用现有 userService 部分逻辑）
// 调用方：panel/backend/src/api/routes/auth.ts + middleware/auth.ts
//
// 契约约束：
//   - 零实现逻辑，仅声明签名（rules-3 §二）
//   - 异常类型与 panel-api-types.ts PanelErrorResponse 一致
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3 + §9.4 (JWT 黑名单)
// ============================================================================

import type {
  UserRole,
  LoginRequest,
  LoginResponse,
  SelectRoleRequest,
  SelectRoleResponse,
  ListUserRolesResponse,
  UpdateUserRolesRequest,
  UpdateUserRolesResponse,
  RevokeUserTokensResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 多角色认证服务接口（v4.17.0）
 *
 * 设计原则：
 *   1. roles 多值：一个账号可同时拥有多身份（如 user + instance_admin）
 *   2. active_role 会话固定：登录时选定，token 生命周期内不可变
 *   3. JWT 黑名单：角色变更时撤销该用户所有未过期 token
 *   4. token_version 兼容：旧字段保留，与新黑名单机制并行工作
 */
export interface IAuthService {
  /**
   * 登录（支持多角色分叉）
   *
   * 流程：
   *   1. 校验凭证
   *   2. 读取 users.roles
   *   3. 若 roles.length > 1 → 返回角色列表，前端展示"选择工作台视角"
   *   4. 若 roles.length === 1 → 直接签发 token（active_role = roles[0]）
   *
   * @param request 登录请求（email + password）
   * @param ip 客户端 IP（审计日志用）
   * @returns 登录响应；若需选角色，token 字段为 null，roles 字段有值
   * @throws {PanelErrorResponse} PANEL_UNAUTHORIZED | PANEL_FORBIDDEN | EMAIL_NOT_VERIFIED
   */
  login(request: LoginRequest, ip: string): Promise<LoginResponse | ListUserRolesResponse>;

  /**
   * 选定活动角色（多角色账号登录后调用）
   *
   * @param request 选角色请求（active_role 必须 ∈ users.roles）
   * @param ip 客户端 IP
   * @returns 含 token 的登录响应（token 含 active_role claim）
   * @throws {PanelErrorResponse} PANEL_FORBIDDEN | PANEL_VALIDATION_ERROR
   */
  selectRole(request: SelectRoleRequest, ip: string): Promise<SelectRoleResponse>;

  /**
   * 获取用户角色列表
   *
   * @param userId 用户 ID
   * @returns 角色列表 + active_role
   */
  getUserRoles(userId: string): Promise<ListUserRolesResponse>;

  /**
   * 修改用户角色集合（仅 server_admin）
   *
   * ⚠️ 触发 JWT 黑名单：将该用户所有未过期 token 的 jti 加入黑名单
   *
   * @param userId 目标用户 ID
   * @param request 更新请求（roles 数组）
   * @param operatorId 操作者用户 ID（审计日志用）
   * @returns 更新后的用户角色信息
   * @throws {PanelErrorResponse} PANEL_FORBIDDEN | PANEL_VALIDATION_ERROR | USER_NOT_FOUND
   */
  updateUserRoles(
    userId: string,
    request: UpdateUserRolesRequest,
    operatorId: string,
  ): Promise<UpdateUserRolesResponse>;

  /**
   * 撤销用户所有 token（加入 JWT 黑名单）
   *
   * 触发场景：
   *   1. 角色变更（updateUserRoles 内部调用）
   *   2. 管理员强制下线
   *   3. 用户改密（与 token_version +1 并行）
   *
   * @param userId 目标用户 ID
   * @returns 撤销的 token 数量
   */
  revokeUserTokens(userId: string): Promise<RevokeUserTokensResponse>;

  /**
   * 检查 token 是否在黑名单中（auth 中间件调用）
   *
   * @param jti JWT ID（签发时生成的唯一标识）
   * @returns true=已撤销（拒绝请求）；false=有效
   */
  isTokenRevoked(jti: string): Promise<boolean>;

  /**
   * 清理过期黑名单条目（定时任务调用，LRU 自动过期，此方法用于主动清理）
   *
   * @returns 清理的条目数
   */
  cleanupExpiredRevokedTokens(): Promise<{ cleaned_count: number }>;

  /**
   * 兼容旧代码：根据 active_role 返回单值 role
   *
   * @param userId 用户 ID
   * @returns active_role（若用户不存在或无 active_role，返回 'user'）
   * @deprecated v4.17.0 过渡期保留，下版本删除。新代码应直接读 req.user.activeRole
   */
  getLegacyRole(userId: string): Promise<UserRole>;
}

/**
 * 认证服务异常码
 */
export type AuthServiceErrorCode =
  | 'PANEL_UNAUTHORIZED' // 凭证错误
  | 'PANEL_FORBIDDEN' // 账号禁用/删除
  | 'EMAIL_NOT_VERIFIED' // 邮箱未验证
  | 'PANEL_VALIDATION_ERROR' // 角色不合法
  | 'USER_NOT_FOUND' // 用户不存在
  | 'ROLE_NOT_IN_USER_ROLES' // 选定的 active_role 不在 users.roles 中
  | 'JWT_REVOKED' // token 已被撤销（黑名单命中）
  | 'JWT_EXPIRED' // token 已过期
  | 'JWT_INVALID' // token 格式不合法
  | 'PANEL_INTERNAL_ERROR';
