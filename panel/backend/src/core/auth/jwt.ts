// ============================================================================
// JWT 签发与验证（Panel ↔ Frontend 鉴权）
// 使用 jsonwebtoken 库，密钥从环境变量 JWT_SECRET 读取
//
// v4.17.0 升级：多角色支持
//   - 新增 roles: Role[]（角色集合，至少一个）
//   - 新增 active_role: Role（当前活动角色，会话级）
//   - role 字段保留为 @deprecated，等同 active_role（过渡期 v4.18.0 删除）
//   - 旧 JWT（无 roles/active_role）由 auth 中间件降级处理：role → [role], active_role = role
// ============================================================================

import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from './roles.js';

/**
 * JWT Payload 结构
 *
 * token_version（v3.4.0 新增，可选）：
 *   - 签发时写入 users.token_version 当前值
 *   - authenticateToken 校验：若 user.token_version > 0 且 JWT.token_version !== user.token_version → 401
 *   - 缺失（旧 JWT）视为 0；user.token_version = 0 时跳过校验（向后兼容）
 *
 * roles / active_role（v4.17.0 新增，可选）：
 *   - roles: 角色集合（多值），至少包含一个角色
 *   - active_role: 当前活动角色（会话级，登录时选定），必须 ∈ roles
 *   - 缺失时由 auth 中间件从 role 降级推导
 */
export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  /** @deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除 */
  role: Role;
  token_version?: number;
  /** v4.17.0 新增：角色集合（多值） */
  roles?: Role[];
  /** v4.17.0 新增：当前活动角色 */
  active_role?: Role;
}

/**
 * JWT 签发
 * @param payload 用户信息
 * @param secret JWT 密钥（从环境变量读取）
 * @param expiresIn 过期时间，默认 24h
 */
export function signToken(
  payload: JwtPayload,
  secret: string,
  expiresIn: SignOptions['expiresIn'] = '24h',
): string {
  const options: SignOptions = { expiresIn };
  return jwt.sign(payload, secret, options);
}

/**
 * JWT 验证
 * @returns 验证成功返回 payload，失败抛出异常
 */
export function verifyToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret) as unknown;
  return decoded as JwtPayload;
}

/**
 * 从 Authorization 头提取 Bearer token
 * @returns token 字符串，格式不正确返回 null
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  return parts[1] ?? null;
}
