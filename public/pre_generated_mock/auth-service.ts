// ============================================================================
// auth-service.ts — v4.17.0 认证服务 Mock（预生成稳定 Mock）
//
// 用途：契约冻结后，下游模块（auth 路由、前端联调、单元测试）可在真实
//       AuthService 实现就位前，通过 tsconfig paths alias 切换到本 Mock
//       进行并行开发。覆盖多角色登录、角色切换、JWT 黑名单等场景。
//
// 覆盖场景：
//   1. 单角色账号登录（roles=['user']，无需选角色）
//   2. 多角色账号登录（roles=['user','instance_admin']，需选角色）
//   3. select-role 流程（二次校验密码 + 签发新 JWT）
//   4. JWT 黑名单（角色变更后旧 token 失效）
//   5. token_version 校验（密码修改后 +1）
//   6. revoke-tokens（管理员强制下线）
//
// 切换路径（rules-3 §四 可覆盖）：通过 tsconfig paths alias 切换，
//   调用方零改动。开发者可在 global_mock/ 下覆盖本 Mock 适配特殊测试场景。
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §3 + §9
// ============================================================================

import type {
  UserRole,
  UserRoles,
  AdminUserSummary,
  UserInfo,
  LoginRequest,
  LoginResponse,
  SelectRoleRequest,
  SelectRoleResponse,
  ListUserRolesResponse,
  UpdateUserRolesRequest,
  UpdateUserRolesResponse,
  RevokeUserTokensResponse,
} from '../schema/panel-api-types';

/**
 * Mock 错误类，模拟 PanelErrorResponse 抛出
 */
export class MockAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'MockAuthError';
  }
}

/**
 * 内置 Mock 用户库（覆盖单角色 / 多角色场景）
 */
interface MockUserRecord {
  id: string;
  email: string;
  username: string;
  password_hash: string; // Mock 中存明文便于测试
  role: UserRole; // 旧字段（@deprecated，等同 active_role）
  roles: UserRoles; // v4.17.0 新增
  active_role: UserRole; // v4.17.0 新增
  status: 'active' | 'disabled' | 'deleted';
  is_built_in?: number;
  token_version: number;
  created_at: string;
}

function buildMockUsers(): MockUserRecord[] {
  return [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      username: '普通用户',
      password_hash: 'password123',
      role: 'user',
      roles: ['user'],
      active_role: 'user',
      status: 'active',
      token_version: 0,
      created_at: '2026-07-01T10:00:00.000Z',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'admin@example.com',
      username: '实例管理员',
      password_hash: 'admin123',
      role: 'instance_admin',
      roles: ['instance_admin'],
      active_role: 'instance_admin',
      status: 'active',
      token_version: 0,
      created_at: '2026-07-01T10:00:00.000Z',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'superadmin@example.com',
      username: '服务器管理员',
      password_hash: 'super123',
      role: 'server_admin',
      roles: ['server_admin'],
      active_role: 'server_admin',
      status: 'active',
      is_built_in: 1,
      token_version: 0,
      created_at: '2026-07-01T10:00:00.000Z',
    },
    {
      // 多角色账号：同时是 user + instance_admin
      id: '44444444-4444-4444-4444-444444444444',
      email: 'multi@example.com',
      username: '多角色用户',
      password_hash: 'multi123',
      role: 'user', // 旧字段默认取最低角色
      roles: ['user', 'instance_admin'],
      active_role: 'user', // 默认活动角色
      status: 'active',
      token_version: 0,
      created_at: '2026-07-15T10:00:00.000Z',
    },
    {
      // 已禁用账号
      id: '55555555-5555-5555-5555-555555555555',
      email: 'disabled@example.com',
      username: '已禁用',
      password_hash: 'disabled123',
      role: 'user',
      roles: ['user'],
      active_role: 'user',
      status: 'disabled',
      token_version: 0,
      created_at: '2026-06-01T10:00:00.000Z',
    },
  ];
}

/**
 * Mock JWT 黑名单条目
 */
interface BlacklistedToken {
  token: string;
  user_id: string;
  revoked_at: string;
  reason: string;
}

/**
 * 将 MockUserRecord 转为 UserInfo（脱敏）
 */
function toUserInfo(user: MockUserRecord): UserInfo {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.active_role, // 过渡期回填旧字段
    roles: [...user.roles],
    active_role: user.active_role,
    status: user.status,
    created_at: user.created_at,
    is_built_in: user.is_built_in,
  };
}

function toAdminUserSummary(user: MockUserRecord): AdminUserSummary {
  return {
    ...toUserInfo(user),
    display_name: user.username,
    is_verified: true,
    last_login_at: null,
    last_login_ip: null,
    updated_at: user.created_at,
  };
}

/**
 * Mock 生成 JWT（仅用于测试，无真实签名）
 */
function mockJwt(user: MockUserRecord): string {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.active_role,
    roles: user.roles,
    active_role: user.active_role,
    token_version: user.token_version,
    iat: Math.floor(Date.now() / 1000),
  };
  // Mock：base64 编码 payload（无签名，仅测试用）
  return `mock.${Buffer.from(JSON.stringify(payload)).toString('base64')}.signature`;
}

/**
 * Mock 认证服务
 *
 * 设计说明：
 *   - 内存用户库 + JWT 黑名单
 *   - 多角色账号登录：返回 token + user（含 roles），前端据 requires_role_selection 提示选角色
 *   - select-role：二次校验密码 → 更新 active_role → 签发新 JWT
 *   - JWT 黑名单：role 变更后旧 token 加入黑名单
 *   - token_version：密码修改后 +1
 */
export class MockAuthService {
  private users: MockUserRecord[] = buildMockUsers();
  private blacklist: BlacklistedToken[] = [];

  /**
   * 重置 Mock 状态（测试用例 setup 时调用）
   */
  resetMockAuthService(): void {
    this.users = buildMockUsers();
    this.blacklist = [];
  }

  /**
   * 登录
   *
   * 多角色账号行为：
   *   - 返回 token + user，user.roles.length > 1
   *   - 前端应据 ListUserRolesResponse.requires_role_selection 提示用户选角色
   *   - 用户选角色后调用 selectRole() 签发携带 active_role 的新 JWT
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const user = this.users.find((u) => u.email === request.email);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${request.email} not found`);
    }
    if (user.status === 'disabled') {
      throw new MockAuthError('PANEL_FORBIDDEN', 'account disabled');
    }
    if (user.status === 'deleted') {
      throw new MockAuthError('USER_NOT_FOUND', `user ${request.email} not found`);
    }
    if (user.password_hash !== request.password) {
      throw new MockAuthError('INVALID_CREDENTIAL', 'password mismatch');
    }

    const token = mockJwt(user);
    return { token, user: toUserInfo(user) };
  }

  /**
   * 查询用户角色集合
   */
  async listUserRoles(userId: string): Promise<ListUserRolesResponse> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${userId} not found`);
    }
    return {
      user_id: user.id,
      roles: [...user.roles],
      active_role: user.active_role,
      requires_role_selection: user.roles.length > 1,
    };
  }

  /**
   * 选定活动角色（多角色账号登录后）
   *
   * 流程：
   *   1. 二次校验密码
   *   2. 校验 active_role ∈ roles
   *   3. 更新 user.active_role
   *   4. 签发新 JWT（携带新 active_role）
   *   5. 旧 token 不主动加入黑名单（用户可保留多 token，但 active_role 不同）
   */
  async selectRole(request: SelectRoleRequest): Promise<SelectRoleResponse> {
    const user = this.users.find((u) => u.email === request.email);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${request.email} not found`);
    }
    if (user.password_hash !== request.password) {
      throw new MockAuthError('INVALID_CREDENTIAL', 'password mismatch for role selection');
    }
    if (!user.roles.includes(request.active_role)) {
      throw new MockAuthError('PANEL_VALIDATION_ERROR', `active_role ${request.active_role} not in roles ${JSON.stringify(user.roles)}`);
    }

    user.active_role = request.active_role;
    user.role = request.active_role; // 同步旧字段

    const token = mockJwt(user);
    return { token, user: toUserInfo(user) };
  }

  /**
   * 更新用户角色集合（仅 server_admin）
   *
   * 副作用：
   *   1. 该用户所有未过期 token 加入黑名单（强制重新登录）
   *   2. token_version +1（双重保险）
   *   3. active_role 若不在新 roles 中则 fallback 到 roles[0]
   */
  async updateUserRoles(userId: string, request: UpdateUserRolesRequest): Promise<UpdateUserRolesResponse> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${userId} not found`);
    }

    // 校验：roles 非空
    if (request.roles.length === 0) {
      throw new MockAuthError('PANEL_VALIDATION_ERROR', 'roles must not be empty');
    }

    // 校验：元素唯一
    const uniqueRoles = new Set(request.roles);
    if (uniqueRoles.size !== request.roles.length) {
      throw new MockAuthError('PANEL_VALIDATION_ERROR', 'roles must be unique');
    }

    // 校验：元素合法
    const validRoles: UserRole[] = ['user', 'instance_admin', 'server_admin'];
    for (const r of request.roles) {
      if (!validRoles.includes(r)) {
        throw new MockAuthError('PANEL_VALIDATION_ERROR', `invalid role: ${r}`);
      }
    }

    // 校验：active_role ∈ roles（若提供）
    if (request.active_role && !request.roles.includes(request.active_role)) {
      throw new MockAuthError('PANEL_VALIDATION_ERROR', 'active_role must be in roles');
    }

    // 系统内置账号保护
    if (user.is_built_in === 1) {
      throw new MockAuthError('PANEL_FORBIDDEN', 'cannot modify built-in account roles');
    }

    // 模拟将该用户所有 token 加入黑名单
    // 真实实现需查 active_tokens 表；Mock 中假设有 1 个活跃 token
    const revokedCount = 1;
    this.blacklist.push({
      token: `mock-token-for-${user.id}`,
      user_id: user.id,
      revoked_at: new Date().toISOString(),
      reason: 'roles_updated',
    });

    // 更新用户
    user.roles = [...request.roles];
    user.active_role = request.active_role ?? request.roles[0];
    user.role = user.active_role; // 同步旧字段
    user.token_version += 1;

    return {
        user: toAdminUserSummary(user),
      revoked_token_count: revokedCount,
    };
  }

  /**
   * 管理员强制下线用户（撤销全部 token）
   */
  async revokeUserTokens(userId: string): Promise<RevokeUserTokensResponse> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${userId} not found`);
    }

    // Mock：假设有 1 个活跃 token
    const revokedCount = 1;
    this.blacklist.push({
      token: `mock-token-for-${user.id}`,
      user_id: user.id,
      revoked_at: new Date().toISOString(),
      reason: 'admin_revoke',
    });
    user.token_version += 1;

    return {
      user_id: user.id,
      revoked_token_count: revokedCount,
      revoked_at: new Date().toISOString(),
    };
  }

  /**
   * 检查 token 是否在黑名单中
   */
  isTokenBlacklisted(token: string): boolean {
    return this.blacklist.some((b) => b.token === token);
  }

  /**
   * 获取黑名单条目数（调试用）
   */
  getBlacklistSize(): number {
    return this.blacklist.length;
  }

  /**
   * 通过 ID 获取用户（脱敏）
   */
  async getUserById(userId: string): Promise<UserInfo | null> {
    const user = this.users.find((u) => u.id === userId);
    return user ? toUserInfo(user) : null;
  }

  /**
   * 修改密码（Mock：仅更新 password_hash + token_version +1）
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = this.users.find((u) => u.id === userId);
    if (!user) {
      throw new MockAuthError('USER_NOT_FOUND', `user ${userId} not found`);
    }
    if (user.password_hash !== oldPassword) {
      throw new MockAuthError('INVALID_CREDENTIAL', 'old password mismatch');
    }
    if (newPassword.length < 8) {
      throw new MockAuthError('WEAK_PASSWORD', 'password must be at least 8 chars');
    }
    // 系统内置账号禁止改密
    if (user.is_built_in === 1) {
      throw new MockAuthError('PANEL_FORBIDDEN', 'cannot modify built-in account password');
    }

    user.password_hash = newPassword;
    user.token_version += 1;
  }
}

/**
 * 默认导出单例（开发联调用）
 * 单元测试请通过 resetMockAuthService() 重置状态
 */
export const mockAuthService = new MockAuthService();
