// ============================================================================
// Auth API 领域切片 — 鉴权 + 用户自助（绑定/通知/验证码）
// PanelApiClient 通过 extends 组合各领域接口
// ============================================================================

import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  MeResponse,
  CreateVerifyCodeRequest,
  CreateVerifyCodeResponse,
  ListMyVerifyCodesResponse,
  SelectRoleRequest,
  SelectRoleResponse,
  SwitchRoleRequest,
  SwitchRoleResponse,
  RevokeUserTokensResponse,
} from '@public/schema/panel-api-types';

/** 用户自己的实例绑定记录（camelCase，已从后端 snake_case 转换） */
export interface MyBinding {
  id: number;
  userId: string;
  serverId: string;
  vipLevel: number;
  status: string;
  boundAt: string;
  unboundAt: string | null;
}

/** POST /api/auth/change-password 响应体 — 改密后返回新的 token_version
 *  后端模块3（用户安全）提供：zxcvbn + bcrypt 历史密码 + token_version 三重校验 */
export interface ChangePasswordResponse {
  /** 修改后 users.token_version 新值。旧 JWT 在下次请求时被 authenticateToken 拒绝（401） */
  tokenVersion: number;
}

// v3.9.0-S4: 密码找回 — 公开端点，无需 JWT
//   /request 防枚举：无论 email 是否存在均返回 200
//   /confirm  token 1h 过期，使用后立即失效；成功后 token_version+1 强制其他设备重登
export interface PasswordResetRequestPayload {
  email: string;
}
export interface PasswordResetConfirmPayload {
  token: string;
  new_password: string;
}
export interface PasswordResetRequestResponse {
  requested: boolean;
}
export interface PasswordResetConfirmResponse {
  confirmed: boolean;
}

// v3.9.0-S5: 邮箱验证
//   /status  需鉴权——返回当前登录用户 email_verified 状态
//   /request 需鉴权——重发验证邮件（限流 3 次/小时/用户）
//   /confirm 公开——通过 token 完成邮箱验证
export interface EmailVerifyStatusResponse {
  email_verified: boolean;
}
export interface EmailVerifyRequestResponse {
  sent: boolean;
  reason?: 'already_verified';
}
export interface EmailVerifyConfirmPayload {
  token: string;
}
export interface EmailVerifyConfirmResponse {
  verified: boolean;
}

// v3.9.0-S7: 公开法律内容（用户协议 + 隐私政策）
//   管理员在设置面板配置 legal.terms_content / legal.privacy_content
//   未配置时返回空字符串
export interface LegalContentResponse {
  content: string;
}

// v4.16.x: 身份体系重构——用户身份管理
export interface UserIdentity {
  id: number;
  identity_type: 'instance_admin' | 'player';
  instance_id?: number;
  instance_name?: string;
  is_default: boolean;
}

export interface ListIdentitiesResponse {
  identities: UserIdentity[];
}

export interface CreateIdentityRequest {
  identity_type: 'instance_admin' | 'player';
  instance_id?: number;
}

export interface CreateIdentityResponse {
  id: number;
  identity_type: 'instance_admin' | 'player';
  instance_id?: number;
  is_default: boolean;
}

export interface AuthApi {
  login(req: LoginRequest): Promise<LoginResponse>;
  /** v3.1.0 新增：公开注册入口，注册成功后自动签发 JWT */
  register(req: RegisterRequest): Promise<RegisterResponse>;
  me(): Promise<MeResponse>;

  // v3.4.0: 修改当前用户密码（POST /api/auth/change-password）
  //   成功：返回 { tokenVersion }，旧 JWT 在下次请求时失效（user.token_version + 1）
  //   401 INVALID_CREDENTIAL: 旧密码错误
  //   400 AUTH_PWD_002: 新密码强度不足（zxcvbn 分 < PASSWORD_MIN_ZXCVBN_SCORE，默认 3）
  //   409 AUTH_PWD_003: 新密码与近期使用过的密码重复（默认 5 条历史）
  changePassword(oldPassword: string, newPassword: string): Promise<ChangePasswordResponse>;

  // v3.9.0-S4: 密码找回（公开端点）
  requestPasswordReset(email: string): Promise<PasswordResetRequestResponse>;
  confirmPasswordReset(token: string, newPassword: string): Promise<PasswordResetConfirmResponse>;

  // v3.9.0-S5: 邮箱验证
  getEmailVerifyStatus(): Promise<EmailVerifyStatusResponse>;
  requestEmailVerify(): Promise<EmailVerifyRequestResponse>;
  confirmEmailVerify(token: string): Promise<EmailVerifyConfirmResponse>;

  // v3.9.0-S7: 公开法律内容（用户协议 + 隐私政策）
  getLegalTerms(): Promise<LegalContentResponse>;
  getLegalPrivacy(): Promise<LegalContentResponse>;

  // 用户自助实例绑定管理
  /** 用户查看自己的绑定列表（camelCase，已转换） */
  listMyBindings(): Promise<MyBinding[]>;
  /** 用户绑定实例（自动 VIP1；409 表示已绑定） */
  bindInstance(serverId: string): Promise<void>;
  /** 用户解绑实例 */
  unbindInstance(serverId: string): Promise<void>;

  // 站内通知
  // 3.3.7: 重新引入可选 signal 参数——Chrome 100+ 对 AbortController.abort()
  // 触发的取消不再写入 net::ERR_ABORTED 控制台日志，可安全用于：
  //   - 页面卸载前置信号（visibilitychange='hidden'）前 abort in-flight 请求
  //   - 组件卸载/会话切换时 abort，避免 SPA 路由切换遗留请求
  // 旧版 Chrome（<100）可能仍记录 ERR_ABORTED，但当前部署浏览器均已 ≥100。
  // 不传 signal 时行为与 3.3.5 一致（请求自然完成，由调用方 cancelled 标志丢弃结果）。
  listNotifications(signal?: AbortSignal): Promise<{
    notifications: Array<{
      id: number;
      type: string;
      title: string;
      content: string;
      related_server_id: string | null;
      related_order_id: number | null;
      is_read: boolean;
      created_at: string;
    }>;
    unread_count: number;
  }>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  // 模块10: 玩家验证码（游戏内 !verify 命令使用）
  createVerifyCode(req: CreateVerifyCodeRequest): Promise<CreateVerifyCodeResponse>;
  listMyVerifyCodes(): Promise<ListMyVerifyCodesResponse>;

  // v4.16.x: 身份体系重构——用户身份管理
  listIdentities(): Promise<ListIdentitiesResponse>;
  createIdentity(req: CreateIdentityRequest): Promise<CreateIdentityResponse>;
  activateIdentity(id: number): Promise<void>;
  setDefaultIdentity(id: number): Promise<void>;

  // v4.17.0: 多角色管理
  /**
   * 切换会话级活动角色（POST /api/auth/select-role）
   *
   * 已登录用户选定新的 active_role；后端会：
   *   1. 二次密码校验（防 session hijack 后提权）
   *   2. 校验 active_role ∈ users.roles
   *   3. 签发新 JWT（含新 active_role + roles 集合）
   *
   * @param req email + password（二次校验）+ active_role（目标角色）
   * @returns 新 token + 更新后的 user 对象
   * @throws 401 PANEL_UNAUTHORIZED 邮箱或密码错误
   * @throws 403 PANEL_FORBIDDEN 不能为其他用户切换角色
   * @throws 400 PANEL_VALIDATION_ERROR active_role 不在用户角色集合中
   */
  selectRole(req: SelectRoleRequest): Promise<SelectRoleResponse>;

  /**
   * 免密切换同级身份（POST /api/auth/switch-role）—— v4.28.0 全员服主
   *
   * 与 selectRole 的区别：
   *   - 免密：仅凭 JWT 会话切换，无需 email+password 二次校验（快捷互切）
   *   - 等级闸门：目标角色等级必须 ≤ 2（user / instance_admin）；
   *     server_admin 目标一律被后端 403 拒绝，须走 selectRole 密码通道
   *
   * 后端会校验 active_role ∈ users.roles 并签发新 JWT；
   * user ↔ instance_admin 同层互切不撤销其他设备会话（SB-4 收窄）。
   *
   * @param req active_role（目标角色，仅 user / instance_admin）
   * @returns 新 token + 更新后的 user 对象
   * @throws 400 PANEL_VALIDATION_ERROR active_role 缺失/非法/不在用户角色集合中
   * @throws 401 PANEL_UNAUTHORIZED 未认证或用户不存在
   * @throws 403 PANEL_FORBIDDEN 目标为 server_admin 或账号状态异常
   */
  switchRole(req: SwitchRoleRequest): Promise<SwitchRoleResponse>;

  /**
   * 撤销目标用户所有未过期 token（POST /api/auth/revoke-tokens）
   *
   * 仅 server_admin 可调用；将该用户所有旧 JWT 加入黑名单 + token_version+1，
   * 强制其在下次请求时重新登录。用于安全事件应急响应或管理员强制下线。
   *
   * @param userId 目标用户 ID
   * @returns 撤销信息（user_id + revoked_token_count + revoked_at）
   */
  revokeUserTokens(userId: string): Promise<RevokeUserTokensResponse>;
}
