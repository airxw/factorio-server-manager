// ============================================================================
// 模块7_Panel业务API — 商店路由（P2）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 对应服务：app.locals.shopService（ShopServiceImpl）
//
// 挂载前缀：/api/servers（与 servers.ts 同前缀，路径不冲突）
//   GET    /:serverId/shop-items         → list（任意用户）
//   PUT    /:serverId/shop-items         → upsert（requireAdmin）
//   DELETE /:serverId/shop-items/:id     → remove（requireAdmin）
//   POST   /:serverId/shop-orders        → create（任意用户，下单）
//   GET    /:serverId/shop-orders        → list（任意用户，仅自己；admin 全部）
//   GET    /:serverId/shop-orders/:id    → get（任意用户，仅自己；admin 全部）
//   POST   /:serverId/shop-orders/claim  → claim（任意用户，输入 claim_code + player_name）
// ============================================================================

import { Router, type Response } from 'express';
import type { ShopServiceImpl } from '../../services/shopService.js';
import { AppError } from '../../services/errors.js';
import { requireInstanceAccess, requireInstanceAdmin } from '../../middleware/auth.js';
import type {
  ClaimShopOrderRequest,
  ClaimShopOrderResponse,
  CreateShopOrderRequest,
  CreateShopOrderResponse,
  DeleteShopItemResponse,
  GetShopOrderResponse,
  ListShopItemsResponse,
  ListShopOrdersResponse,
  PanelErrorResponse,
  ShopItemSummary,
  UpsertShopItemRequest,
  UpsertShopItemResponse,
} from '@public/schema/panel-api-types';

const VALID_QUALITIES = ['normal', 'uncommon', 'rare', 'epic', 'legendary'] as const;

function isValidQuality(value: unknown): value is ShopItemSummary['quality'] {
  return typeof value === 'string' && (VALID_QUALITIES as readonly string[]).includes(value);
}

function isAdminRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'system_admin' || role === 'server_admin';
}

/**
 * 创建 Shop 路由
 * 依赖通过 req.app.locals 注入：shopService
 */
export function createShopRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/shop-items — 列出服务器上架商品
  //   v2.1.0: 加 requireInstanceAccess（商城入口绑定校验）
  // ----------------------------------------------------------------
  router.get('/:serverId/shop-items', requireInstanceAccess(), async (req, res) => {
    try {
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const items = await shopService.listShopItems(req.params.serverId);
      const response: ListShopItemsResponse = { items };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/servers/:serverId/shop-items — upsert 商品（实例管理员）
  // ----------------------------------------------------------------
  router.put('/:serverId/shop-items', requireInstanceAdmin('serverId'), async (req, res) => {
    try {
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const body = req.body as Partial<UpsertShopItemRequest>;
      if (typeof body.item_name !== 'string' || body.item_name.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 item_name' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.quality !== undefined && !isValidQuality(body.quality)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `quality 无效: ${String(body.quality)}` },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.vip_level_required !== undefined &&
        (!Number.isInteger(body.vip_level_required) || body.vip_level_required < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'vip_level_required 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      // 经济系统：price 校验（非负整数，default 0）
      if (
        body.price !== undefined &&
        (!Number.isInteger(body.price) || body.price < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'price 需为非负整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (
        body.daily_limit !== null &&
        body.daily_limit !== undefined &&
        (!Number.isInteger(body.daily_limit) || body.daily_limit < 0)
      ) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'daily_limit 需为非负整数或 null' },
        };
        res.status(400).json(errBody);
        return;
      }
      const item = await shopService.upsertShopItem(req.params.serverId, {
        item_name: body.item_name,
        quality: body.quality,
        vip_level_required: body.vip_level_required,
        price: body.price,
        daily_limit: body.daily_limit ?? null,
        enabled: body.enabled,
      });
      const response: UpsertShopItemResponse = { item };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/shop-items/:id — 删除商品（实例管理员，幂等）
  // ----------------------------------------------------------------
  router.delete('/:serverId/shop-items/:id', requireInstanceAdmin('serverId'), async (req, res) => {
    try {
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      await shopService.deleteShopItem(req.params.serverId, id);
      const response: DeleteShopItemResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/shop-orders — 创建订单（任意用户）
  //   v2.1.0: 加 requireInstanceAccess（入口绑定校验）+ 传 userRole 给 createOrder
  // ----------------------------------------------------------------
  router.post('/:serverId/shop-orders', requireInstanceAccess(), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const body = req.body as Partial<CreateShopOrderRequest>;
      if (!Array.isArray(body.items) || body.items.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 items 或为空' },
        };
        res.status(400).json(errBody);
        return;
      }
      for (const it of body.items) {
        if (typeof it.item_name !== 'string' || it.item_name.length === 0) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'items[].item_name 缺失' },
          };
          res.status(400).json(errBody);
          return;
        }
        if (!Number.isInteger(it.count) || it.count < 1 || it.count > 999999) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `items[].count 非法: ${String(it.count)}` },
          };
          res.status(400).json(errBody);
          return;
        }
        if (it.quality !== undefined && !isValidQuality(it.quality)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `items[].quality 无效: ${String(it.quality)}` },
          };
          res.status(400).json(errBody);
          return;
        }
      }
      // v2.1.0: 传 userRole 用于按实例 VIP 校验
      const userRole = req.user?.role ?? 'user';
      const result = await shopService.createOrder(userId, req.params.serverId, {
        items: body.items.map((it) => ({
          item_name: it.item_name,
          count: it.count,
          quality: it.quality,
        })),
      }, userRole);

      // v3.3.0: delivery_mode='direct' — 下单后立即自动领取（需要 player_name）
      const deliveryMode = (req.body as Record<string, unknown>).delivery_mode;
      const directPlayerName = (req.body as Record<string, unknown>).player_name;
      if (deliveryMode === 'direct' && typeof directPlayerName === 'string' && directPlayerName.length > 0) {
        const claimResult = await shopService.claimOrder(req.params.serverId, {
          claim_code: result.order.claim_code,
          player_name: directPlayerName,
        });
        const response: CreateShopOrderResponse = {
          order: claimResult.order,
          items: claimResult.items,
        };
        res.status(201).json(response);
        return;
      }

      const response: CreateShopOrderResponse = {
        order: result.order,
        items: result.items,
      };
      res.status(201).json(response);
    } catch (err) {
      handleShopError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/shop-orders — 列订单（仅自己；admin 全部）
  //   query: ?userId=xxx&status=pending
  //   v2.1.0: 加 requireInstanceAccess（入口绑定校验）
  // ----------------------------------------------------------------
  router.get('/:serverId/shop-orders', requireInstanceAccess(), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const admin = isAdminRole(req.user?.role);
      const filter: { userId?: string; status?: string } = {};
      // 非 admin 强制只看自己的订单；admin 可通过 ?userId= 看任意用户
      const queryUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      const queryStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (admin && queryUserId) {
        filter.userId = queryUserId;
      } else if (!admin) {
        filter.userId = userId;
      }
      if (queryStatus) {
        filter.status = queryStatus;
      }
      const orders = await shopService.listOrders(req.params.serverId, filter);
      const response: ListShopOrdersResponse = { orders };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/shop-orders/:id — 订单详情（仅自己；admin 全部）
  //   v2.1.0: 加 requireInstanceAccess（入口绑定校验）
  // ----------------------------------------------------------------
  router.get('/:serverId/shop-orders/:id', requireInstanceAccess(), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const orderId = parseInt(req.params.id, 10);
      if (Number.isNaN(orderId)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await shopService.getOrder(req.params.serverId, orderId);
      // 所有权校验：非 admin 只能看自己的订单
      if (!isAdminRole(req.user?.role) && result.order.user_id !== userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_FORBIDDEN', message: '无权查看该订单' },
        };
        res.status(403).json(errBody);
        return;
      }
      const response: GetShopOrderResponse = {
        order: result.order,
        items: result.items,
      };
      res.json(response);
    } catch (err) {
      handleShopError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/shop-orders/claim — 领取订单（任意用户）
  //   注意：此路由需在 /:id 之前不会被吃掉——Express 按挂载顺序匹配，
  //   '/shop-orders/claim' 字面量路径优先于 '/:id'，但为稳妥起见放在 /:id 之后。
  //   实际上 Express 4+ 中字面量段比 :param 优先级高，此处顺序不影响。
  //   v2.1.0: 加 requireInstanceAccess（入口绑定校验）
  // ----------------------------------------------------------------
  router.post('/:serverId/shop-orders/claim', requireInstanceAccess(), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const shopService = req.app.locals.shopService as ShopServiceImpl;
      const body = req.body as Partial<ClaimShopOrderRequest>;
      if (typeof body.claim_code !== 'string' || body.claim_code.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 claim_code' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (typeof body.player_name !== 'string' || body.player_name.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 player_name' },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await shopService.claimOrder(req.params.serverId, {
        claim_code: body.claim_code,
        player_name: body.player_name,
      });
      // S7-2: 审计日志注入（不阻塞主流程）
      const auditLogService = req.app.locals.auditLogService;
      if (auditLogService) {
        void auditLogService.create({
          server_id: req.params.serverId,
          user_id: userId,
          action: 'shop.claim',
          target_type: 'shop_order',
          target_id: String(result.order.id),
          details: { claim_code: body.claim_code, player_name: body.player_name, items_count: result.order.items_count },
          ip_address: req.ip ?? null,
        }).catch(() => { /* 审计日志失败不影响主流程 */ });
      }
      // v3.3.0: 订单领取通知
      const notifService = req.app.locals.notificationService;
      if (notifService) {
        void notifService.create({
          userId: result.order.user_id,
          type: 'order_delivered',
          title: '订单已领取',
          content: `订单 #${result.order.id} 已由玩家 ${body.player_name} 领取`,
          relatedServerId: req.params.serverId,
          relatedOrderId: result.order.id,
        }).catch(() => { /* 通知失败不影响主流程 */ });
      }
      const response: ClaimShopOrderResponse = {
        order: result.order,
        items: result.items,
        delivered: result.delivered,
      };
      res.json(response);
    } catch (err) {
      handleShopError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  SHOP_ITEM_NOT_FOUND: 404,
  SHOP_ORDER_NOT_FOUND: 404,
  SHOP_ORDER_ALREADY_CLAIMED: 409,
  SHOP_ORDER_EXPIRED: 410,
  COMMAND_RENDER_FAILED: 400,
  COMMAND_QUEUE_FULL: 503,
  VIP_LEVEL_INSUFFICIENT: 403,
  BINDING_REQUIRED: 403,
  PANEL_FORBIDDEN: 403,
  // 经济系统：余额不足 400 / 今日已领取 409
  INSUFFICIENT_BALANCE: 400,
  DAILY_REWARD_ALREADY_CLAIMED: 409,
};

function handleShopError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  handleInternal(res, err);
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
