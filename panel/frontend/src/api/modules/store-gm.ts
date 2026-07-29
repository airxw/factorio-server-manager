// ============================================================================
// StoreGmApi 领域切片 — v4.13.0 GM Workbench 后端 API
// 后端路由：panel/backend/src/api/routes/store-gm.ts（挂载于 /api）
//   GET  /api/store/players?instance_id=&page=&limit=&search=   → 玩家列表（CRM）
//   GET  /api/store/reports/revenue?instance_id=&days=          → 流水报表
//   GET  /api/store/reports/playtime?instance_id=&days=         → 时长统计
//   GET  /api/store/servers[?all=true]                          → 服主实例列表
// 契约：public/schema/panel-api-types.ts
// ============================================================================

/** 玩家列表项（CRM 视图） */
export interface StorePlayer {
  user_id: string;
  username: string;
  email: string;
  game_player_name: string;
  game_type: string;
  status: string;
  vip_level: number;
  vip_expires_at: string | null;
  total_spent: number;
  order_count: number;
  total_playtime_seconds: number;
  session_count: number;
  bound_at: string;
}

/** 玩家列表响应 */
export interface ListStorePlayersResponse {
  players: StorePlayer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

/** 流水报表单日数据 */
export interface RevenueDailyItem {
  date: string;
  order_count: number;
  revenue: number;
  cdk_redeemed: number;
}

/** 流水报表响应 */
export interface GetStoreRevenueReportResponse {
  daily: RevenueDailyItem[];
  summary: {
    total_revenue: number;
    total_orders: number;
    total_cdk_redeemed: number;
    days: number;
  };
}

/** 时长统计单日数据 */
export interface PlaytimeDailyItem {
  date: string;
  session_count: number;
  total_seconds: number;
  active_players: number;
  avg_seconds: number;
}

/** 时长统计响应 */
export interface GetStorePlaytimeReportResponse {
  daily: PlaytimeDailyItem[];
  summary: {
    total_playtime_seconds: number;
    total_sessions: number;
    active_players: number;
    days: number;
  };
  note?: string;
}

/** 服主实例列表项 */
export interface StoreServerItem {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  owner_user_id: string;
  status: string;
  port: number;
  rcon_port: number;
  online_players: number;
  today_revenue: number;
  today_orders: number;
  created_at: string;
}

/** 服主实例列表响应 */
export interface ListStoreServersResponse {
  servers: StoreServerItem[];
}

/**
 * v4.13.0 GM Workbench API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface StoreGmApi {
  /** 玩家列表（CRM）— 聚合 users + bindings(player/game_type) + shop_orders + player_sessions */
  listStorePlayers(
    instanceId: string,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<ListStorePlayersResponse>;

  /** 流水报表 — 按日聚合 shop_orders + cdk_codes */
  getStoreRevenueReport(instanceId: string, days?: number): Promise<GetStoreRevenueReportResponse>;

  /** 时长统计 — 按日聚合 player_sessions（依赖 daemon 写入链路） */
  getStorePlaytimeReport(instanceId: string, days?: number): Promise<GetStorePlaytimeReportResponse>;

  /** 服主实例列表 — servers + 在线玩家数 + 今日收入 */
  listStoreServers(all?: boolean): Promise<ListStoreServersResponse>;
}
