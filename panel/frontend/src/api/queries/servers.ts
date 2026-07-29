// ============================================================================
// Servers 领域 Query Hooks — 实例列表 / 详情 / 生命周期操作
// 替代各页面 useEffect+useState 手拉数据模式，统一缓存与失效
// ============================================================================

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  CreateServerRequest,
  CreateServerResponse,
  DeleteServerResponse,
  ListServersResponse,
  ServerDetailResponse,
  ServerStartResponse,
  ServerStopResponse,
  ServerSummary,
  UpdateServerExpiryRequest,
} from '@public/schema/panel-api-types';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { useAuth } from '../auth';
import { queryKeys } from './keys';

// ---------------------------------------------------------------------------
// 读取：实例列表
// ---------------------------------------------------------------------------
/** 获取当前用户可见的实例列表 */
export function useServers(
  options?: Omit<UseQueryOptions<ListServersResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.servers.list(),
    queryFn: () => api.listServers(),
    staleTime: 30_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// 读取：实例详情
// ---------------------------------------------------------------------------
/** 获取单个实例的详情（含 daemon 转发的运行时状态） */
export function useServerDetail(
  serverId: string | undefined,
  options?: Omit<UseQueryOptions<ServerDetailResponse>, 'queryKey' | 'queryFn'>,
) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.servers.detail(serverId ?? ''),
    queryFn: () => api.getServer(serverId!),
    enabled: !!serverId,
    staleTime: 10_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// 乐观更新辅助：在缓存中就地修改某实例的状态字段
// ---------------------------------------------------------------------------
function patchServerStateInCache(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<ServerSummary>,
) {
  qc.setQueryData<ListServersResponse>(queryKeys.servers.list(), (old) => {
    if (!old) return old;
    return {
      ...old,
      servers: old.servers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    };
  });
  qc.setQueryData<ServerDetailResponse>(queryKeys.servers.detail(id), (old) => {
    if (!old) return old;
    return { ...old, server: { ...old.server, ...patch } };
  });
}

// ---------------------------------------------------------------------------
// Mutation：启动实例（乐观更新 status → starting）
// ---------------------------------------------------------------------------
export function useStartServer() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation<ServerStartResponse, Error, string>({
    mutationFn: (id) => api.startServer(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.servers.all });
      patchServerStateInCache(qc, id, { status: 'starting' as InstanceState });
    },
    onError: (_err, id) => {
      // 回退由 onSettled 的 invalidate 触发重新拉取覆盖
      void qc.invalidateQueries({ queryKey: queryKeys.servers.detail(id) });
    },
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.servers.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.servers.list() });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation：停止实例（乐观更新 status → stopping）
// ---------------------------------------------------------------------------
export function useStopServer() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation<ServerStopResponse, Error, string>({
    mutationFn: (id) => api.stopServer(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.servers.all });
      patchServerStateInCache(qc, id, { status: 'stopping' as InstanceState });
    },
    onError: (_err, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.servers.detail(id) });
    },
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.servers.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.servers.list() });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation：删除实例（成功后从列表缓存移除）
// ---------------------------------------------------------------------------
export function useDeleteServer() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation<DeleteServerResponse, Error, string>({
    mutationFn: (id) => api.deleteServer(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<ListServersResponse>(queryKeys.servers.list(), (old) => {
        if (!old) return old;
        return { ...old, servers: old.servers.filter((s) => s.id !== id) };
      });
      qc.removeQueries({ queryKey: queryKeys.servers.detail(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation：创建实例（成功后将新实例加入列表缓存并跳转）
// ---------------------------------------------------------------------------
export function useCreateServer() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation<CreateServerResponse, Error, CreateServerRequest>({
    mutationFn: (req) => api.createServer(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.servers.list() });
    },
  });
}

// ---------------------------------------------------------------------------
// v4.31.0: 读取——节点上的实例列表
// ---------------------------------------------------------------------------
export function useNodeInstances(nodeId: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: queryKeys.nodes.instances(nodeId ?? ''),
    queryFn: () => api.listNodeInstances(nodeId!),
    enabled: !!nodeId,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// v4.31.0: Mutation——管理员修改实例有效期
// ---------------------------------------------------------------------------
export function useUpdateServerExpiry() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation<{ server: ServerSummary }, Error, { id: string; req: UpdateServerExpiryRequest }>({
    mutationFn: ({ id, req }) => api.updateServerExpiry(id, req),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.servers.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.servers.list() });
    },
  });
}
