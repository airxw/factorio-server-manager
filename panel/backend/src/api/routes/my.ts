// ============================================================================
// my.ts — 玩家门户聚合路由（v4.15.0）
//
// 路由本身不套鉴权中间件（在 routes-registry.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/my
//
// 端点：
//   GET /orders?status=   — 当前用户跨实例订单列表（含实例名/物品明细/领取码）
//                           status 过滤：pending（含 claiming）/ claimed / expired
//   GET /overview         — 玩家门户首页聚合概览（绑定/通知/进行中订单/钱包/可领福利）
//
// 权限：任何已登录用户，仅返回本人数据（user_id 强制过滤）
// 设计：所有查询 try-catch 保护，表不存在时返回空值（与 myAssetsService 同策略）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
// v4.33.0: 日期键统一走公共 utils（W3 提炼批）
import { utcDateKey } from '../../utils/date.js';
import type {
  GetMyOverviewResponse,
  ListMyOrdersResponse,
  MyOrderItem,
  MyOrderSummary,
  MyOverview,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface OrderJoinRow {
  id: number;
  server_id: string;
  instance_name: string | null;
  total_price: number | null;
  status: string;
  claim_code: string;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
}

interface OrderItemRow {
  order_id: number;
  item_name: string;
  count: number;
  price: number | null;
  quality: string;
}

type OrderStatus = MyOrderSummary['status'];

const VALID_STATUS: ReadonlySet<string> = new Set(['pending', 'claiming', 'claimed', 'expired']);

/**
 * 创建玩家门户聚合路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createMyRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/my/orders?status=pending|claimed|expired
  //   - 跨实例聚合当前用户订单（联 servers 取实例名，联 shop_order_items 取明细）
  //   - status=pending 时同时包含 claiming（领取中并入"待领取"）
  //   - 按 created_at 倒序，上限 100 条
  // ----------------------------------------------------------------
  router.get('/orders', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const statusParam = typeof req.query.status === 'string' ? req.query.status : null;
      const statusFilter = statusParam && VALID_STATUS.has(statusParam) ? statusParam : null;

      let query = db<OrderJoinRow>('shop_orders')
        .select(
          'shop_orders.id',
          'shop_orders.server_id',
          'servers.name as instance_name',
          'shop_orders.total_price',
          'shop_orders.status',
          'shop_orders.claim_code',
          'shop_orders.claimed_at',
          'shop_orders.expires_at',
          'shop_orders.created_at',
        )
        .leftJoin('servers', 'shop_orders.server_id', 'servers.id')
        .where('shop_orders.user_id', userId)
        .orderBy('shop_orders.created_at', 'desc')
        .limit(100);

      if (statusFilter === 'pending') {
        query = query.whereIn('shop_orders.status', ['pending', 'claiming']);
      } else if (statusFilter) {
        query = query.where('shop_orders.status', statusFilter);
      }

      const rows = await query.catch(() => [] as OrderJoinRow[]);

      // 批量取物品明细（一次 IN 查询，避免 N+1）
      const orderIds = rows.map((r) => r.id);
      const itemRows: OrderItemRow[] =
        orderIds.length > 0
          ? await db<OrderItemRow>('shop_order_items')
              .select('order_id', 'item_name', 'count', 'price', 'quality')
              .whereIn('order_id', orderIds)
              .orderBy('id', 'asc')
              .catch(() => [] as OrderItemRow[])
          : [];

      const itemsByOrder = new Map<number, MyOrderItem[]>();
      for (const item of itemRows) {
        const list = itemsByOrder.get(item.order_id) ?? [];
        list.push({
          item_name: item.item_name,
          count: item.count,
          price: item.price ?? 0,
          quality: item.quality ?? 'normal',
        });
        itemsByOrder.set(item.order_id, list);
      }

      const orders: MyOrderSummary[] = rows.map((r) => ({
        id: String(r.id),
        instance_id: r.server_id,
        instance_name: r.instance_name ?? '',
        items: itemsByOrder.get(r.id) ?? [],
        total_price: r.total_price ?? 0,
        status: (VALID_STATUS.has(r.status) ? r.status : 'pending') as OrderStatus,
        claim_code: r.claim_code,
        claimed_at: r.claimed_at ?? null,
        expires_at: r.expires_at,
        created_at: r.created_at,
      }));

      const response: ListMyOrdersResponse = { orders };
      res.json(response);
    } catch (err) {
      handleMyError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/my/overview — 玩家门户首页聚合概览
  //   返回：绑定总数/已验证绑定/未读通知/进行中订单/钱包余额合计/今日可领福利数
  // ----------------------------------------------------------------
  router.get('/overview', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const today = utcDateKey(); // YYYY-MM-DD

      // 绑定统计（v4.17.0: 旧表 player_bindings 已合并到统一 bindings 表，
      // v4.27.0: binding_type='player', scope_type='instance' 表示实例级玩家绑定）
      let bindingsTotal = 0;
      let bindingsVerified = 0;
      try {
        const rows = (await db('bindings')
          .select('verify_status as status')
          .count('* as cnt')
          .where({
            user_id: userId,
            binding_type: 'player',
            scope_type: 'instance',
          })
          .groupBy('verify_status')) as unknown as Array<{ status: string; cnt: number }>;
        for (const row of rows) {
          const cnt = Number(row.cnt ?? 0);
          bindingsTotal += cnt;
          if (row.status === 'verified') bindingsVerified = cnt;
        }
      } catch {
        // 表不存在时保持 0
      }

      // 未读通知数
      let unreadNotifications = 0;
      try {
        const row = await db('user_notifications')
          .where('user_id', userId)
          .where('is_read', 0)
          .count<{ cnt: number }[]>('* as cnt')
          .first();
        unreadNotifications = Number(row?.cnt ?? 0);
      } catch {
        // 表不存在时保持 0
      }

      // 进行中订单数（pending + claiming）
      let pendingOrders = 0;
      try {
        const row = await db('shop_orders')
          .where('user_id', userId)
          .whereIn('status', ['pending', 'claiming'])
          .count<{ cnt: number }[]>('* as cnt')
          .first();
        pendingOrders = Number(row?.cnt ?? 0);
      } catch {
        // 表不存在时保持 0
      }

      // 钱包余额合计 + 今日可领福利数（user_wallets 表）
      let walletBalance = 0;
      let dailyClaimable = 0;
      try {
        const rows = await db<{ balance: number; last_daily_claim_date: string | null }>(
          'user_wallets',
        )
          .select('balance', 'last_daily_claim_date')
          .where('user_id', userId);
        for (const row of rows) {
          walletBalance += row.balance ?? 0;
          if (row.last_daily_claim_date !== today) dailyClaimable += 1;
        }
      } catch {
        // 表不存在时保持 0
      }

      const overview: MyOverview = {
        bindings_total: bindingsTotal,
        bindings_verified: bindingsVerified,
        unread_notifications: unreadNotifications,
        pending_orders: pendingOrders,
        wallet_balance: walletBalance,
        daily_claimable: dailyClaimable,
      };
      const response: GetMyOverviewResponse = { overview };
      res.json(response);
    } catch (err) {
      handleMyError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleMyError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'my router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
