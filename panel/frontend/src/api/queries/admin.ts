// ============================================================================
// Admin 领域 Query Hooks — 用户/系统配置/VIP权限/节点/Packs 查询
// ============================================================================

import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type {
  DataVolumeResponse,
  DiskUsageTopResponse,
  ListPacksResponse,
  ListSystemConfigsResponse,
  ListUsersResponse,
  ListVipPermissionsResponse,
  PlatformOverview,
  PlatformRevenueTrendResponse,
  PlatformUsersTrendResponse,
  UserStatsResponse,
} from '@public/schema/panel-api-types';
import type { ListNodesResponse } from '../modules/servers';
import type { ListGlobalAssetsResponse } from '../modules/asset';
import type { SystemHealth, SystemMetrics } from '../modules/system';
import { useAuth } from '../auth';
import { queryKeys } from './keys';

/** 部署节点列表 */
export function useNodes(
  options?: Omit<UseQueryOptions<ListNodesResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.nodes.list(),
    queryFn: () => api.listNodes(),
    staleTime: 60_000,
    ...options,
  });
}

/** 游戏包列表（创建实例时选择） */
export function usePacks(
  options?: Omit<UseQueryOptions<ListPacksResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.packs.list(),
    queryFn: () => api.listPacks(),
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** 用户列表（admin） */
export function useUsers(
  options?: Omit<UseQueryOptions<ListUsersResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: () => api.listUsers(),
    staleTime: 30_000,
    ...options,
  });
}

/** 系统配置列表（admin） */
export function useSystemConfigs(
  options?: Omit<UseQueryOptions<ListSystemConfigsResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.systemConfigs.list(),
    queryFn: () => api.listSystemConfigs(),
    staleTime: 30_000,
    ...options,
  });
}

/** VIP 权限列表（admin） */
export function useVipPermissions(
  options?: Omit<UseQueryOptions<ListVipPermissionsResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.vipPermissions.list(),
    queryFn: () => api.listVipPermissions(),
    staleTime: 60_000,
    ...options,
  });
}

/** 平台总览 KPI（主数据，失败阻断） */
export function usePlatformOverview(
  options?: Omit<UseQueryOptions<PlatformOverview>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.overview(),
    queryFn: () => api.getPlatformOverview(),
    retry: 1,
    staleTime: 30_000,
    ...options,
  });
}

/** 全局资产模板列表（附属数据，失败非阻断） */
export function useGlobalAssets(
  options?: Omit<UseQueryOptions<ListGlobalAssetsResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.globalAssets(),
    queryFn: () => api.listGlobalAssets(),
    retry: false,
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** 平台用户活跃度曲线（24h/30d 切换，range 变化自动重新查询） */
export function usePlatformUsersTrend(
  range: '24h' | '30d',
  options?: Omit<UseQueryOptions<PlatformUsersTrendResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.usersTrend(range),
    queryFn: () => api.getPlatformUsersTrend(range),
    retry: 1,
    staleTime: 60_000,
    ...options,
  });
}

/** 平台收入趋势（按天数） */
export function usePlatformRevenueTrend(
  days: number,
  options?: Omit<UseQueryOptions<PlatformRevenueTrendResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.revenueTrend(days),
    queryFn: () => api.getPlatformRevenueTrend(days),
    retry: 1,
    staleTime: 60_000,
    ...options,
  });
}

/** 磁盘用量 Top N */
export function useDiskUsageTop(
  limit: number,
  options?: Omit<UseQueryOptions<DiskUsageTopResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.diskUsageTop(limit),
    queryFn: () => api.getDiskUsageTop(limit),
    retry: 1,
    staleTime: 60_000,
    ...options,
  });
}

/** 用户统计（按状态/角色/时间窗口细分，server_admin 专用） */
export function useUserStats(
  options?: Omit<UseQueryOptions<UserStatsResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.platform.userStats(),
    queryFn: () => api.getUserStats(),
    retry: 1,
    staleTime: 60_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// 系统健康/监控（SystemHealth 页）— B2.6 批次
// ---------------------------------------------------------------------------

/** 系统资源指标（CPU/内存/磁盘），端点未实现时由页面层降级占位 */
export function useSystemMetrics(
  options?: Omit<UseQueryOptions<SystemMetrics>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.systemHealth.metrics(),
    queryFn: () => api.getSystemMetrics(),
    retry: 1,
    staleTime: 30_000,
    ...options,
  });
}

/** 系统整体健康状态（后端/数据库/Daemon 服务明细） */
export function useSystemHealth(
  options?: Omit<UseQueryOptions<SystemHealth>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.systemHealth.health(),
    queryFn: () => api.getSystemHealth(),
    retry: 1,
    staleTime: 30_000,
    ...options,
  });
}

/**
 * 各节点磁盘用量批量查询（基于已加载的节点 ID 列表）。
 * 单个节点查询失败不阻塞其他节点——页面层仅收集 data?.usage，
 * 与原 Promise.allSettled 行为一致。
 */
export function useNodesDiskUsage(nodeIds: string[]) {
  const { api } = useAuth();
  return useQueries({
    queries: nodeIds.map((id) => ({
      queryKey: [...queryKeys.systemHealth.nodesDiskUsage(), id],
      queryFn: () => api.getNodeDiskUsage(id),
      retry: 1,
      staleTime: 30_000,
    })),
  });
}

/**
 * v4.32.2 B2.8: 数据量监控告警。
 * 监控 7 张关键表行数增长，超阈值时返回 warning/critical 等级。
 * staleTime 60s——数据量增长缓慢，1 分钟内重复访问不重复请求。
 */
export function useDataVolume(
  options?: Omit<UseQueryOptions<DataVolumeResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.systemHealth.dataVolume(),
    queryFn: () => api.getDataVolume(),
    retry: 1,
    staleTime: 60_000,
    ...options,
  });
}
