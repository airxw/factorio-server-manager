// ============================================================================
// apiKeyService — API Key 旁路认证（v4.4.0-J1）
//
// 用途：允许 server_admin 生成 API Key 用于 CI/CD、自动化脚本等场景，
//       通过 `x-api-key` header 旁路 JWT 认证，权限与 JWT 一致。
//
// 设计要点：
// - API Key 格式：`gsp_<32 hex chars>`（前缀 gsp_ + 128 位熵）
// - 存储：仅存 SHA-256 hash（key_hash），不存明文（与密码 hash 同等保护级别）
// - key_prefix：明文前 12 字符（gsp_ + 8 hex），用于列表识别"哪个 key"
// - 角色冻结：API Key 关联的角色在创建时冻结（即使后续用户角色变化，key 权限不变）
// - 用户状态校验：verifyApiKey 时查 users 表，status !== 'active' 拒绝
// - 撤销与过期：revoked_at IS NOT NULL 或 expires_at < now 均拒绝
// - 审计：last_used_at / last_used_ip 在每次成功认证后更新
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { Role, normalizeRole } from '../core/auth/roles.js';
import type { JwtPayload } from '../core/auth/jwt.js';
import { AppError, ValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** API Key 前缀（识别用途，便于日志中辨识） */
const API_KEY_PREFIX = 'gsp_';

/** API Key 随机部分长度（hex 字符数，32 hex = 128 位熵） */
const API_KEY_RANDOM_HEX_LEN = 32;

/** key_prefix 长度（前缀 + 8 hex = 12 字符） */
const KEY_PREFIX_LEN = API_KEY_PREFIX.length + 8;

/** SHA-256 hex 长度 */
const SHA256_HEX_LEN = 64;

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  user_id: string;
  role: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  token_version: number;
}

// ---------------------------------------------------------------------------
// 公共类型（与 panel-api-types.ts 中的 ApiKeyInfo 对齐）
// ---------------------------------------------------------------------------

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  user_id: string;
  role: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// 错误类
// ---------------------------------------------------------------------------

/** API Key 未找到 */
export class ApiKeyNotFoundError extends AppError {
  readonly code = 'API_KEY_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'API Key 不存在') {
    super(message);
  }
}

/** API Key 已撤销 */
export class ApiKeyRevokedError extends AppError {
  readonly code = 'API_KEY_REVOKED';
  readonly httpStatus = 409;
  constructor(message = 'API Key 已撤销') {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 生成新的 API Key 明文：`gsp_<32 hex chars>`
 * @returns 明文 key（仅在创建时返回一次，客户端需自行保存）
 */
export function generateApiKey(): string {
  const randomHex = crypto.randomBytes(API_KEY_RANDOM_HEX_LEN / 2).toString('hex');
  return `${API_KEY_PREFIX}${randomHex}`;
}

/**
 * 计算 API Key 的 SHA-256 hex hash
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * 从明文 key 提取 key_prefix（前 12 字符）
 */
export function extractKeyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LEN);
}

/**
 * 校验 API Key 明文格式
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const randomPart = key.slice(API_KEY_PREFIX.length);
  return /^[a-fA-F0-9]{32}$/.test(randomPart);
}

function toApiKeyInfo(row: ApiKeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    user_id: row.user_id,
    role: row.role,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    last_used_ip: row.last_used_ip,
    revoked_at: row.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * API Key 服务
 *
 * 方法：
 * - createApiKey：生成新 key，返回 { plaintext, info }（plaintext 仅此一次返回）
 * - listApiKeys：列出所有 key（不含 hash 与明文）
 * - listApiKeysByUser：按 user_id 列出 key
 * - getApiKey：按 id 查询单个 key
 * - revokeApiKey：按 id 撤销 key（软删除，设置 revoked_at）
 * - deleteApiKey：按 id 硬删除 key（仅用于清理已撤销的历史数据）
 * - verifyApiKey：用明文 key 认证，返回 JwtPayload | null
 */
export class ApiKeyService {
  constructor(private readonly db: Knex) {}

  /**
   * 创建 API Key
   * @param userId 关联用户 ID（必须是 active 用户）
   * @param role 关联角色（冻结于创建时）
   * @param name 人类可读名称
   * @param expiresAt 可选过期时间（ISO 8601）
   * @returns { plaintext, info } —— plaintext 仅此一次返回，客户端必须保存
   */
  async createApiKey(
    userId: string,
    role: Role,
    name: string,
    expiresAt?: string | null,
  ): Promise<{ plaintext: string; info: ApiKeyInfo }> {
    // 参数校验
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('name 必填');
    }
    if (name.length > 100) {
      throw new ValidationError('name 长度不能超过 100');
    }
    if (expiresAt !== undefined && expiresAt !== null) {
      const expDate = new Date(expiresAt);
      if (isNaN(expDate.getTime())) {
        throw new ValidationError('expiresAt 必须为有效的 ISO 8601 时间');
      }
      if (expDate.getTime() <= Date.now()) {
        throw new ValidationError('expiresAt 必须为未来时间');
      }
    }

    // 校验用户存在且 active
    const user = await this.db<UserRow>('users')
      .select('id', 'status')
      .where({ id: userId })
      .first();
    if (!user) {
      throw new ValidationError(`用户不存在: ${userId}`);
    }
    if (user.status !== 'active') {
      throw new ValidationError(`用户状态非 active，无法创建 API Key: ${user.status}`);
    }

    // 生成 key
    const plaintext = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    const keyPrefix = extractKeyPrefix(plaintext);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const row: Omit<ApiKeyRow, 'last_used_at' | 'last_used_ip' | 'revoked_at'> = {
      id,
      name: name.trim(),
      key_prefix: keyPrefix,
      key_hash: keyHash,
      user_id: userId,
      role,
      created_at: now,
      expires_at: expiresAt ?? null,
    };

    await this.db('api_keys').insert({
      ...row,
      last_used_at: null,
      last_used_ip: null,
      revoked_at: null,
    });

    const info: ApiKeyInfo = {
      ...row,
      last_used_at: null,
      last_used_ip: null,
      revoked_at: null,
    };

    return { plaintext, info };
  }

  /**
   * 列出所有 API Key（不含 hash）
   */
  async listApiKeys(): Promise<ApiKeyInfo[]> {
    const rows = await this.db<ApiKeyRow>('api_keys').orderBy('created_at', 'desc');
    return rows.map(toApiKeyInfo);
  }

  /**
   * 按 user_id 列出 API Key
   */
  async listApiKeysByUser(userId: string): Promise<ApiKeyInfo[]> {
    const rows = await this.db<ApiKeyRow>('api_keys')
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc');
    return rows.map(toApiKeyInfo);
  }

  /**
   * 按 id 查询单个 API Key
   */
  async getApiKey(id: string): Promise<ApiKeyInfo> {
    const row = await this.db<ApiKeyRow>('api_keys').where('id', '=', id).first();
    if (!row) {
      throw new ApiKeyNotFoundError(`API Key 不存在: ${id}`);
    }
    return toApiKeyInfo(row);
  }

  /**
   * 撤销 API Key（软删除，设置 revoked_at）
   * 幂等：已撤销的 key 再次撤销不报错
   */
  async revokeApiKey(id: string): Promise<ApiKeyInfo> {
    const row = await this.db<ApiKeyRow>('api_keys').where('id', '=', id).first();
    if (!row) {
      throw new ApiKeyNotFoundError(`API Key 不存在: ${id}`);
    }
    if (row.revoked_at) {
      // 幂等：已撤销直接返回当前状态
      return toApiKeyInfo(row);
    }
    const now = new Date().toISOString();
    await this.db('api_keys').where('id', '=', id).update({ revoked_at: now });
    return toApiKeyInfo({ ...row, revoked_at: now });
  }

  /**
   * 硬删除 API Key（仅用于清理已撤销的历史数据）
   */
  async deleteApiKey(id: string): Promise<void> {
    await this.db('api_keys').where('id', '=', id).delete();
  }

  /**
   * 验证 API Key 明文，返回 JwtPayload | null
   *
   * 验证流程：
   * 1. 校验明文格式（gsp_ + 32 hex）
   * 2. 计算 hash 并查 api_keys 表（SQL 层硬校验：revoked_at IS NULL）
   * 3. 校验未过期
   * 4. 查关联 user，校验 status === 'active'
   * 5. 构造 JwtPayload（不签发实际 JWT，仅附加到 req.user）
   * 6. 更新 last_used_at / last_used_ip
   *
   * 安全说明：v4.x 安全补强——将 revoked_at IS NULL 下推到 SQL WHERE 子句，
   *           避免"先查再判"的软校验在并发撤销场景下被绕过。已撤销的 key
   *           在 SQL 层即被过滤，调用方查不到即视为认证失败。
   *
   * @param plaintextKey 客户端提供的明文 key
   * @param clientIp 客户端 IP（用于审计）
   * @returns JwtPayload | null（null 表示认证失败，调用方返回 401 API_KEY_REVOKED）
   */
  async verifyApiKey(
    plaintextKey: string,
    clientIp?: string,
  ): Promise<JwtPayload | null> {
    // 1. 格式校验
    if (!isValidApiKeyFormat(plaintextKey)) {
      return null;
    }

    // 2. hash 查表（硬校验：SQL 层过滤已撤销的 key）
    //    v4.x 安全补强：revoked_at IS NULL 下推到 WHERE，避免软校验绕过
    const keyHash = hashApiKey(plaintextKey);
    const row = await this.db<ApiKeyRow>('api_keys')
      .where('key_hash', '=', keyHash)
      .whereNull('revoked_at')
      .first();
    if (!row) {
      return null;
    }

    // 3. 校验未过期
    if (row.expires_at) {
      const expTime = new Date(row.expires_at).getTime();
      if (Date.now() >= expTime) {
        return null;
      }
    }

    // 4. 查关联 user
    const user = await this.db<UserRow>('users')
      .select('id', 'email', 'username', 'role', 'status', 'token_version')
      .where({ id: row.user_id })
      .first();
    if (!user || user.status !== 'active') {
      return null;
    }

    // 5. 更新 last_used_at / last_used_ip（失败不影响认证）
    try {
      const now = new Date().toISOString();
      await this.db('api_keys').where('id', '=', row.id).update({
        last_used_at: now,
        last_used_ip: clientIp ?? null,
      });
    } catch {
      // 更新审计字段失败不应阻断认证
    }

    // 6. 构造 JwtPayload
    // 注意：使用 api_keys.role（创建时冻结的角色），不使用 user.role（可能已变化）
    // 这样 API Key 的权限可预测，不会因 admin 调整角色而突然破坏集成
    const role = normalizeRole(row.role);
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role,
      // API Key 不受 token_version 失效机制约束（无 JWT session 概念）
      // 但用户改密后 token_version 会 +1，API Key 仍可继续使用（与设计一致）
    };

    return payload;
  }
}

// ---------------------------------------------------------------------------
// 公共工具函数导出（供路由层调用）
// ---------------------------------------------------------------------------

export { API_KEY_PREFIX, KEY_PREFIX_LEN, SHA256_HEX_LEN };
