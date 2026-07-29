// ============================================================================
// Shop API 领域切片 — 商城 + 经济系统 + CDK 兑换
// PanelApiClient 通过 extends 组合各领域接口
// ============================================================================

import type {
  ClaimShopOrderRequest,
  ClaimShopOrderResponse,
  CreateShopOrderRequest,
  CreateShopOrderResponse,
  DeleteShopItemResponse,
  GetShopOrderResponse,
  GetWalletResponse,
  ClaimDailyRewardResponse,
  ListShopItemsResponse,
  ListShopOrdersResponse,
  UpsertShopItemRequest,
  UpsertShopItemResponse,
  CreateCdkCodesRequest,
  CreateCdkCodesResponse,
  DeleteCdkCodeResponse,
  GetCdkCodeResponse,
  ListCdkCodesResponse,
  RedeemCdkRequest,
  RedeemCdkResponse,
} from '@public/schema/panel-api-types';

export interface ShopApi {
  // P2 商店 API
  listShopItems(serverId: string): Promise<ListShopItemsResponse>;
  upsertShopItem(serverId: string, req: UpsertShopItemRequest): Promise<UpsertShopItemResponse>;
  deleteShopItem(serverId: string, id: number): Promise<DeleteShopItemResponse>;
  createShopOrder(serverId: string, req: CreateShopOrderRequest): Promise<CreateShopOrderResponse>;
  listShopOrders(serverId: string): Promise<ListShopOrdersResponse>;
  getShopOrder(serverId: string, orderId: number): Promise<GetShopOrderResponse>;
  claimShopOrder(serverId: string, req: ClaimShopOrderRequest): Promise<ClaimShopOrderResponse>;

  // 经济系统 API：钱包余额 + 每日点券领取
  getWallet(serverId: string): Promise<GetWalletResponse>;
  claimDailyReward(serverId: string): Promise<ClaimDailyRewardResponse>;

  // P2 CDK API
  createCdkCodes(serverId: string, req: CreateCdkCodesRequest): Promise<CreateCdkCodesResponse>;
  listCdkCodes(serverId: string): Promise<ListCdkCodesResponse>;
  getCdkCode(serverId: string, id: number): Promise<GetCdkCodeResponse>;
  deleteCdkCode(serverId: string, id: number): Promise<DeleteCdkCodeResponse>;
  redeemCdk(serverId: string, req: RedeemCdkRequest): Promise<RedeemCdkResponse>;
  lookupCdk(code: string): Promise<{ code: { gift_name: string | null; gift_description: string | null; item_name: string; count: number; quality: string; items: Array<{ item_name: string; count: number; quality: string }>; expires_at: string; status: string; server_id: string } }>;
  redeemCdkGlobal(req: { code: string; player_name?: string }): Promise<RedeemCdkResponse & { followed: boolean }>;
}
