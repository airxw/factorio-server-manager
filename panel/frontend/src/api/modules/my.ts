// ============================================================================
// My API 领域切片 — v4.15.0 玩家门户聚合（跨实例"我的"数据）
// 后端路由：panel/backend/src/api/routes/my.ts（挂载于 /api/my）
//   GET /api/my/orders?status=pending|claimed|expired  — 跨实例订单（含领取码/明细）
//   GET /api/my/overview                                — 首页聚合概览计数
// 权限：任意已登录用户，仅返回本人数据
// ============================================================================

import type {
  GetMyOverviewResponse,
  ListMyOrdersResponse,
} from '@public/schema/panel-api-types';

/** 订单状态过滤值（pending 在后端含 claiming 中间态） */
export type MyOrdersStatusFilter = 'pending' | 'claimed' | 'expired';

/**
 * v4.15.0 玩家门户聚合 API 切片
 * PanelApiClient 通过 extends 组合（见 client.ts）
 */
export interface MyApi {
  /** 跨实例"我的订单"列表（按 created_at 倒序，上限 100 条） */
  listMyOrders(status?: MyOrdersStatusFilter): Promise<ListMyOrdersResponse>;
  /** 玩家门户首页聚合概览（绑定/通知/进行中订单/钱包/可领福利计数） */
  getMyOverview(): Promise<GetMyOverviewResponse>;
}
