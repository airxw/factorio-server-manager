// ============================================================================
// 鉴权领域 Query Hooks — 当前用户信息 / 登出后清空
// AuthProvider 仍负责 token 管理与登录/注册，此处仅提供只读查询视角
// ============================================================================

import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { MeResponse } from '@public/schema/panel-api-types';
import { useAuth } from '../auth';
import { queryKeys } from './keys';

/** 查询当前登录用户信息（与 AuthProvider.user 同源，便于在非 Auth 消费场景复用） */
export function useMe(options?: Omit<UseQueryOptions<MeResponse>, 'queryKey' | 'queryFn'>) {
  const { api, token } = useAuth();
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: () => api.me(),
    enabled: !!token,
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** 登出时清空所有用户相关缓存（供 AuthProvider.logout 调用） */
export function useClearUserCache() {
  const qc = useQueryClient();
  return () => {
    qc.clear();
  };
}
