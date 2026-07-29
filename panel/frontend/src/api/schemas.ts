// ============================================================================
// 运行时响应校验 Schema — 四.11
// 关键 API 响应（auth/me/login/servers）补充 zod schema，
// 防御后端契约漂移导致的运行时 undefined 字段访问
// 校验失败时抛 SCHEMA_VALIDATION_FAILED PanelApiError，便于前端定位
// ============================================================================

import { z } from 'zod';
import { PanelApiError } from './client';

// ---------------------------------------------------------------------------
// 基础枚举（与 daemon-api-types / panel-api-types 对齐）
// ---------------------------------------------------------------------------
const instanceStateSchema = z.enum(['stopped', 'starting', 'running', 'stopping', 'error']);
const userRoleSchema = z.enum(['server_admin', 'instance_admin', 'user']);
const userStatusSchema = z.enum(['active', 'disabled', 'deleted']);

// ---------------------------------------------------------------------------
// UserInfo / MeResponse / LoginResponse
// ---------------------------------------------------------------------------
export const userInfoSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  created_at: z.string(),
  // v4.17.0 多角色字段（过渡期可选，旧后端响应可能缺失）
  roles: z.array(userRoleSchema).optional(),
  active_role: userRoleSchema.optional(),
  // v4.0.2 系统内置账号标记
  is_built_in: z.number().optional(),
});

export const meResponseSchema = z.object({
  user: userInfoSchema,
});

export const loginResponseSchema = z.object({
  token: z.string(),
  user: userInfoSchema,
  // v3.8.0-S8: 可选字段，管理员密码已过期时由后端附加
  // 前端据此提示用户立即修改密码（不阻断登录）
  password_expired: z.boolean().optional(),
});

// v4.17.0: 角色切换响应（POST /api/auth/select-role）
export const selectRoleResponseSchema = z.object({
  token: z.string(),
  user: userInfoSchema,
});

// v4.28.0: 免密角色切换响应（POST /api/auth/switch-role，全员服主同级身份切换）
export const switchRoleResponseSchema = z.object({
  token: z.string(),
  user: userInfoSchema,
});

// v4.17.0: 撤销 token 响应（POST /api/auth/revoke-tokens）
export const revokeUserTokensResponseSchema = z.object({
  user_id: z.string(),
  revoked_token_count: z.number(),
  revoked_at: z.string(),
});

// ---------------------------------------------------------------------------
// ServerSummary / ListServersResponse
// ---------------------------------------------------------------------------
export const serverSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  pack_id: z.string(),
  game_type: z.string(),
  node_id: z.string(),
  owner_user_id: z.string(),
  owner_username: z.string(),
  status: instanceStateSchema,
  port: z.number(),
  rcon_port: z.number(),
  current_version: z.string().nullable(),
  last_activity_at: z.string().nullable(),
  // v3.6.1: 磁盘占用缓存字段
  disk_usage_bytes: z.number().nullable(),
  disk_usage_updated_at: z.string().nullable(),
  // v1.1.0: 启动前置引导完成时间（null=未完成引导，前端据此判断是否弹向导）
  startup_config_set_at: z.string().nullable(),
  // v3-billing: 有效期字段
  expires_at: z.string().nullable(),
  expiry_status: z.enum(['permanent', 'active', 'grace', 'expired', 'cleaned']),
  // v4.31.0: 部署节点名称
  node_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const listServersResponseSchema = z.object({
  servers: z.array(serverSummarySchema),
});

// ---------------------------------------------------------------------------
// 校验工具：运行时校验并在失败时抛 PanelApiError
// ---------------------------------------------------------------------------

/**
 * 用 zod schema 校验响应数据。
 * 校验通过返回解析后的数据（已剔除未知字段，类型收窄为 schema 推导类型）；
 * 校验失败抛 SCHEMA_VALIDATION_FAILED PanelApiError，附带路径与原因。
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpoint: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
      .join('; ');
    // 开发环境打印完整数据便于调试
    if (import.meta.env.DEV) {
      console.error(
        `[SchemaValidation] ${endpoint} 校验失败:\n${issues}\n原始数据:`,
        data,
      );
    }
    throw new PanelApiError(
      'SCHEMA_VALIDATION_FAILED',
      `响应格式校验失败 (${endpoint}): ${issues}`,
      0,
    );
  }
  return result.data;
}
