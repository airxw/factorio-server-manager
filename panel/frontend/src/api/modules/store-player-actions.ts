// ============================================================================
// StorePlayerActionsApi 领域切片 — v4.13.0 步骤16 GM Workbench 玩家操作 API
// 后端路由：panel/backend/src/api/routes/store-player-actions.ts（挂载于 /api）
//   POST /api/store/players/:userId/compensate       → 发放补偿（RCON give）
//   POST /api/store/players/:userId/ban              → 封禁玩家（RCON ban）
//   POST /api/store/players/:userId/adjust-playtime  → 调整 VIP 时长
// 契约：public/schema/panel-api-types.ts
// ============================================================================

/** 发放补偿请求 */
export interface CompensatePlayerRequest {
  instance_id: string;
  item: string;
  count: number;
  reason?: string;
}

/** 发放补偿响应 */
export interface CompensatePlayerResponse {
  success: boolean;
  command: string;
  error?: string;
}

/** 封禁玩家请求 */
export interface BanPlayerRequest {
  instance_id: string;
  reason?: string;
}

/** 封禁玩家响应 */
export interface BanPlayerResponse {
  success: boolean;
  command: string;
  error?: string;
}

/** 调整 VIP 时长请求 */
export interface AdjustPlaytimeRequest {
  instance_id: string;
  /** VIP 时长增量（秒）；正数=延长，负数=缩短 */
  delta_seconds: number;
  reason?: string;
}

/** 调整 VIP 时长响应 */
export interface AdjustPlaytimeResponse {
  success: boolean;
  previous_expires_at: string | null;
  current_expires_at: string | null;
  delta_seconds: number;
}

/**
 * v4.13.0 步骤16 玩家操作 API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface StorePlayerActionsApi {
  /** 发放补偿（give 物品，通过 RCON 下发到游戏进程） */
  compensatePlayer(userId: string, req: CompensatePlayerRequest): Promise<CompensatePlayerResponse>;

  /** 封禁玩家（通过 RCON 下发 ban 命令，GM Workbench 作用域） */
  banStorePlayer(userId: string, req: BanPlayerRequest): Promise<BanPlayerResponse>;

  /** 调整 VIP 时长（修改 bindings.metadata.vip_expires_at，binding_type='account'） */
  adjustPlayerPlaytime(userId: string, req: AdjustPlaytimeRequest): Promise<AdjustPlaytimeResponse>;
}
