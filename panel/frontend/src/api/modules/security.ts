// ============================================================================
// security API — 个人安全中心 API（v4.31.0）
//
// 后端路由：panel/backend/src/api/routes/meSecurity.ts（挂载于 /api/me）
//   GET /api/me/login-history?page=&page_size=  — 本人登录历史（含失败尝试）
//   GET /api/me/audit-logs?page=&page_size=&action=&target_type=&from=&to=  — 本人活动记录
//   GET /api/me/last-login                      — 上次成功登录信息
//
// 权限：任意已登录用户，仅返回本人数据（路由层强制按当前 user_id 过滤）
//
// 设计：复用 user-center/api.ts 的 request 封装模式（Bearer + PanelApiError）
//       保持与现有经济系统 API 一致的错误语义
// ============================================================================

import { REST_BASE } from '../../config/env';
import { PanelApiError } from '../../api/client';
import type {
  LoginHistoryListResponse,
  MyActivityListResponse,
  LastLoginResponse,
  LastLoginInfo,
} from '@public/schema/panel-api-types';

// ============================================================================
// 本地 request 封装（语义对齐 client.ts 内部 request）
// ============================================================================

async function request<T>(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${REST_BASE}${path}`, { ...init, headers });
  } catch (err) {
    throw new PanelApiError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : '网络请求失败',
      0,
    );
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText || `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // 非 JSON 错误体，保留默认 message
    }
    throw new PanelApiError(code, message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ============================================================================
// 类型再导出（前端只引用本模块，不直接引用 public/schema）
// ============================================================================

export type { LoginHistoryListResponse, MyActivityListResponse, LastLoginInfo };

// ============================================================================
// API 函数
// ============================================================================

/**
 * 查询本人登录历史（含失败尝试）
 * @param token JWT
 * @param page 页码（从 1 开始，默认 1）
 * @param pageSize 每页条数（默认 20，后端上限 100）
 */
export async function getMyLoginHistory(
  token: string | null,
  page = 1,
  pageSize = 20,
): Promise<LoginHistoryListResponse> {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  return request<LoginHistoryListResponse>(
    token,
    `/me/login-history?${search.toString()}`,
  );
}

/**
 * 查询本人活动记录（强制按当前 user_id 过滤）
 * @param token JWT
 * @param opts 过滤与分页参数（action/target_type/from/to/page/page_size）
 */
export async function getMyActivity(
  token: string | null,
  opts: {
    action?: string;
    target_type?: string;
    from?: string;
    to?: string;
    page?: number;
    page_size?: number;
} = {},
): Promise<MyActivityListResponse> {
  const search = new URLSearchParams();
  if (opts.action) search.set('action', opts.action);
  if (opts.target_type) search.set('target_type', opts.target_type);
  if (opts.from) search.set('from', opts.from);
  if (opts.to) search.set('to', opts.to);
  search.set('page', String(opts.page ?? 1));
  search.set('page_size', String(opts.page_size ?? 20));
  return request<MyActivityListResponse>(
    token,
    `/me/audit-logs?${search.toString()}`,
  );
}

/**
 * 查询上次成功登录信息（供登录后弹窗与安全中心顶部卡片）
 * @returns 上次登录信息；首次登录返回 null
 */
export async function getLastLogin(
  token: string | null,
): Promise<LastLoginInfo | null> {
  const res = await request<LastLoginResponse>(token, `/me/last-login`);
  return res.last_login;
}

// ============================================================================
// 辅助函数：登录类型徽章样式
// ============================================================================

/** 登录类型徽章样式映射（成功=绿、失败密码=橙、其他失败=红） */
export function loginTypeBadgeClass(loginType: string): string {
  switch (loginType) {
    case 'success':
      return 'badge badge-running'; // 绿色（运行中样式）
    case 'fail_password':
      return 'badge badge-pending'; // 橙色（待处理样式）
    case 'fail_disabled':
    case 'fail_unverified':
    case 'fail_not_found':
      return 'badge badge-stopped'; // 红色（已停止样式）
    default:
      return 'badge';
  }
}
