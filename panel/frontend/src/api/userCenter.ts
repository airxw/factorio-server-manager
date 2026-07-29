// ============================================================================
// userCenter — 用户中心经济系统前端请求封装
// client.ts 未收录经济系统端点（/servers/:id/pricing、/admin/withdraw 等），
// 本模块用 token + REST_BASE 发起请求，错误形态与 client.ts 对齐（PanelApiError）。
// 数据契约：docs/plans/user-center-consolidation-plan.md §十三
// ============================================================================

import { PanelApiError } from './client';
import { REST_BASE } from '../config/env';

/**
 * 附加 JWT 发起经济系统 REST 请求。
 * 错误体 {error:{code,message}} 转 PanelApiError；204 返回 undefined。
 */
export async function userCenterRequest<T>(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
