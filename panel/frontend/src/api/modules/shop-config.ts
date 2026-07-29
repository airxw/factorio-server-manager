// ============================================================================
// ShopConfig API 领域切片 — v4.13.0 实例店铺外观配置
// 后端路由：panel/backend/src/api/routes/store_shop_config.ts（挂载于 /api）
//   GET  /api/store/servers/:serverId/shop-config   → 读取店铺外观配置
//   PUT  /api/store/servers/:serverId/shop-config   → 更新店铺外观配置
// 契约：public/schema/panel-api-types.ts (InstanceShopConfig)
// ============================================================================

import type {
  GetInstanceShopConfigResponse,
  UpdateInstanceShopConfigRequest,
  UpdateInstanceShopConfigResponse,
} from '@public/schema/panel-api-types';

// 重新导出，便于 client.ts 通过 import('./modules/shop-config').XXX 引用
export type {
  GetInstanceShopConfigResponse,
  UpdateInstanceShopConfigRequest,
  UpdateInstanceShopConfigResponse,
};

/**
 * v4.13.0 实例店铺外观配置 API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface ShopConfigApi {
  /** 读取店铺外观配置（user+ 拥有实例访问权即可读） */
  getInstanceShopConfig(serverId: string): Promise<GetInstanceShopConfigResponse>;
  /** 更新店铺外观配置（instance_admin+ 服主才能改） */
  updateInstanceShopConfig(
    serverId: string,
    req: UpdateInstanceShopConfigRequest,
  ): Promise<UpdateInstanceShopConfigResponse>;
}
