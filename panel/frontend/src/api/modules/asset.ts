// ============================================================================
// Asset API 领域切片 — v4.11.0 商业化资产管理（全局资产 + 实例资产合并/覆盖/UGC）
// 后端路由：panel/backend/src/api/routes/assets.ts（挂载于 /api）
//   GET    /api/admin/instances/:instanceId/assets
//   POST   /api/admin/instances/:instanceId/assets/:globalAssetId/override
//   POST   /api/admin/instances/:instanceId/assets/ugc
//   GET    /api/admin/assets
//   POST   /api/admin/assets
//   PUT    /api/admin/assets/:id
//   DELETE /api/admin/assets/:id
// 契约：public/interface_stub/asset_interfaces.d.ts (IAssetService)
// ============================================================================

import type { MergedAsset } from '@public/interface_stub/asset_interfaces';

/** 全局资产类型（与后端 GlobalAsset 对齐） */
export type GlobalAssetType = 'COMMODITY' | 'TEMPLATE' | 'RULE';

/** 全局资产（系统管理员视角，含 type / default_price 等字段） */
export interface GlobalAssetDto {
  id: string;
  type: GlobalAssetType;
  name: string;
  default_price?: number;
  execution_logic?: string;
  is_active: boolean;
  game_pack_id?: string;
  created_at: string;
  updated_at: string;
}

/** GET /api/admin/instances/:instanceId/assets 响应 */
export interface ListMergedAssetsResponse {
  assets: MergedAsset[];
}

/** POST /api/admin/instances/:instanceId/assets/:globalAssetId/override 请求 */
export interface OverrideAssetRequest {
  name?: string;
  price?: number;
  is_active?: boolean;
  execution_logic?: string;
}

/** POST /api/admin/instances/:instanceId/assets/ugc 请求 */
export interface CreateUgcAssetRequest {
  name: string;
  price?: number;
  is_active?: boolean;
  execution_logic?: string;
}

/** POST /api/admin/instances/:instanceId/assets/ugc 响应 */
export interface CreateUgcAssetResponse {
  id: string;
}

/** GET /api/admin/assets 响应 */
export interface ListGlobalAssetsResponse {
  assets: GlobalAssetDto[];
}

/** POST /api/admin/assets 请求 */
export interface CreateGlobalAssetRequest {
  type: GlobalAssetType;
  name: string;
  default_price?: number;
  execution_logic?: string;
  is_active?: boolean;
  game_pack_id?: string;
}

/** POST /api/admin/assets / PUT /api/admin/assets/:id 响应 */
export interface UpsertGlobalAssetResponse {
  asset: GlobalAssetDto;
}

/** PUT /api/admin/assets/:id 请求 */
export interface UpdateGlobalAssetRequest {
  type?: GlobalAssetType;
  name?: string;
  default_price?: number;
  execution_logic?: string;
  is_active?: boolean;
  game_pack_id?: string;
}

/** DELETE /api/admin/assets/:id 响应 */
export interface DeleteGlobalAssetResponse {
  deleted: boolean;
  id: string;
}

/**
 * v4.11.0 商业化资产 API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface AssetApi {
  // ----- 实例级端点（instance_admin 门控，路由参数 instanceId）-----
  listMergedAssets(instanceId: string): Promise<ListMergedAssetsResponse>;
  overrideAsset(
    instanceId: string,
    globalAssetId: string,
    req: OverrideAssetRequest,
  ): Promise<{ overridden: boolean }>;
  createUgcAsset(
    instanceId: string,
    req: CreateUgcAssetRequest,
  ): Promise<CreateUgcAssetResponse>;

  // ----- 全局资产 CRUD（server_admin 门控）-----
  listGlobalAssets(): Promise<ListGlobalAssetsResponse>;
  createGlobalAsset(req: CreateGlobalAssetRequest): Promise<UpsertGlobalAssetResponse>;
  updateGlobalAsset(id: string, req: UpdateGlobalAssetRequest): Promise<UpsertGlobalAssetResponse>;
  deleteGlobalAsset(id: string): Promise<DeleteGlobalAssetResponse>;
}
