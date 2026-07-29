// ============================================================================
// Query Keys 工厂 — 集中管理所有 query/mutation 的缓存键
// 层级化结构便于按维度失效（invalidateQueries）
// ============================================================================

export const queryKeys = {
  // 鉴权 / 当前用户
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
  },

  // 实例（servers）
  servers: {
    all: ['servers'] as const,
    lists: () => [...queryKeys.servers.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.servers.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.servers.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.servers.details(), id] as const,
  },

  // 部署节点
  nodes: {
    all: ['nodes'] as const,
    list: () => [...queryKeys.nodes.all, 'list'] as const,
    // v4.31.0: 节点上的实例列表
    instances: (nodeId: string) => [...queryKeys.nodes.all, 'instances', nodeId] as const,
  },

  // 游戏包（packs）
  packs: {
    all: ['packs'] as const,
    list: () => [...queryKeys.packs.all, 'list'] as const,
    items: (packId: string) => [...queryKeys.packs.all, 'items', packId] as const,
  },

  // 当前用户实例绑定
  myBindings: {
    all: ['my-bindings'] as const,
    list: () => [...queryKeys.myBindings.all, 'list'] as const,
  },

  // 实例绑定（admin 视角）
  instanceBindings: {
    all: ['instance-bindings'] as const,
    list: (serverId: string) => [...queryKeys.instanceBindings.all, 'list', serverId] as const,
  },

  // 用户管理（admin）
  users: {
    all: ['users'] as const,
    list: () => [...queryKeys.users.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.users.all, 'detail', id] as const,
  },

  // 系统配置（admin）
  systemConfigs: {
    all: ['system-configs'] as const,
    list: () => [...queryKeys.systemConfigs.all, 'list'] as const,
  },

  // VIP 权限（admin）
  vipPermissions: {
    all: ['vip-permissions'] as const,
    list: () => [...queryKeys.vipPermissions.all, 'list'] as const,
  },

  // 商城
  shop: {
    all: ['shop'] as const,
    items: (serverId: string) => [...queryKeys.shop.all, 'items', serverId] as const,
    orders: (serverId: string) => [...queryKeys.shop.all, 'orders', serverId] as const,
    wallet: (serverId: string) => [...queryKeys.shop.all, 'wallet', serverId] as const,
  },

  // 监控快照
  monitor: {
    all: ['monitor'] as const,
    snapshots: (serverId: string) => [...queryKeys.monitor.all, 'snapshots', serverId] as const,
    latest: (serverId: string) => [...queryKeys.monitor.all, 'latest', serverId] as const,
  },

  // 平台总览（admin dashboard）
  platform: {
    all: ['platform'] as const,
    overview: () => [...queryKeys.platform.all, 'overview'] as const,
    globalAssets: () => [...queryKeys.platform.all, 'global-assets'] as const,
    usersTrend: (range: string) => [...queryKeys.platform.all, 'users-trend', range] as const,
    revenueTrend: (days: number) => [...queryKeys.platform.all, 'revenue-trend', days] as const,
    diskUsageTop: (limit: number) => [...queryKeys.platform.all, 'disk-usage-top', limit] as const,
    userStats: () => [...queryKeys.platform.all, 'user-stats'] as const,
  },

  // 系统健康/监控（admin SystemHealth 页）
  systemHealth: {
    all: ['system-health'] as const,
    metrics: () => [...queryKeys.systemHealth.all, 'metrics'] as const,
    health: () => [...queryKeys.systemHealth.all, 'health'] as const,
    nodesDiskUsage: () => [...queryKeys.systemHealth.all, 'nodes-disk-usage'] as const,
    // v4.32.2 B2.8: 数据量监控告警
    dataVolume: () => [...queryKeys.systemHealth.all, 'data-volume'] as const,
  },
} as const;
