// ============================================================================
// userCenter.ts — 用户中心经济系统 REST API 路由（v5）
//
// 路由本身不套鉴权中间件（在 routes-registry.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api（路由内部自带 /me、/servers/:serverId、/admin 路径段）
//
// 端点（数据契约：docs/plans/user-center-consolidation-plan.md §十三）：
//   用户端（JWT 即可，仅本人数据）：
//     GET  /me/balance                     — 全局余额（含冻结/可用/累计收支）
//     GET  /me/balance/summary             — 余额 + 跨实例点券/VIP 汇总
//     POST /me/withdraw                    — 申请提现 {amount} → 提现码
//     GET  /me/withdraw/history            — 提现记录分页
//     GET  /me/transactions                — 本人流水查询（可选过滤 + 分页）
//     GET  /me/transactions/export         — 本人流水 CSV 导出（上限 10000 行）
//     GET  /me/stats                       — 消费统计（分类汇总/月度趋势/Top 实例）
//   实例端（/servers/:serverId/...）：
//     GET   /servers/:serverId/points              — 实例点券余额 + 兑换比例（requireInstanceAccess）
//     POST  /servers/:serverId/points/exchange     — 余额兑换点券（requireInstanceAccess）
//     POST  /servers/:serverId/points/grant        — 管理员发放点券（requireInstanceAdmin）
//     GET   /servers/:serverId/vip/status          — VIP 状态 + 定价（requireInstanceAccess）
//     POST  /servers/:serverId/vip/purchase        — 购买 VIP（requireInstanceAccess）
//     GET   /servers/:serverId/pricing             — 查询实例定价（requireInstanceAccess）
//     PUT   /servers/:serverId/pricing             — 更新实例定价（requireInstanceAdmin）
//     GET   /servers/:serverId/transactions        — 实例全用户流水（requireInstanceAdmin）
//     GET   /servers/:serverId/transactions/export — 全服流水 CSV（requireInstanceAdmin）
//     GET   /servers/:serverId/stats               — 实例消费概况（requireInstanceAdmin）
//     PATCH /servers/:serverId/integrals/:userId   — 管理员调整积分（requireInstanceAdmin）
//     POST  /servers/:serverId/wallet/credit       — 订单号充值，幂等（requireAdmin）
//   管理端（requireAdmin，即 server_admin）：
//     GET  /admin/withdraw/pending          — 待审批提现列表（含用户 username/email）
//     POST /admin/withdraw/:code/approve    — 核销提现码
//     POST /admin/withdraw/:code/reject     — 拒绝提现（解冻退回）
//     GET  /admin/cdk/report                — CDK 批次追溯报表（批次使用率 + 兑换时间线）
//
// 错误处理：AppError（含 code + httpStatus）按其状态码返回 {error:{code,message}}；
//           其他异常记日志并返回 500 PANEL_INTERNAL_ERROR。
// ============================================================================

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  requireAdmin,
  requireInstanceAccess,
  requireInstanceAdmin,
} from '../../middleware/auth.js';
import {
  AppError,
  DailyLimitExceededError,
  RechargeLimitExceededError,
  ValidationError,
} from '../../services/errors.js';
import type { BalanceServiceImpl } from '../../services/balanceService.js';
import type { InstancePointsRow, PointsServiceImpl } from '../../services/pointsService.js';
import type { IntegralServiceImpl } from '../../services/integralService.js';
import type { PurchaseVipResult, VipServiceImpl, VipStatus } from '../../services/vipService.js';
import type {
  InstancePricingRow,
  PricingServiceImpl,
  PricingUpdates,
} from '../../services/pricingService.js';
import type {
  WithdrawCodeRow,
  WithdrawHistoryPage,
  WithdrawServiceImpl,
} from '../../services/withdrawService.js';
import type { AuditLogServiceImpl } from '../../services/auditLogService.js';
// v4.33.0: 分页解析统一走公共 utils（W3 提炼批）
import { parsePagination } from '../../utils/pagination.js';

// ---------------------------------------------------------------------------
// 依赖注入
// ---------------------------------------------------------------------------

export interface UserCenterRouterDeps {
  db: Knex;
  balanceService: BalanceServiceImpl;
  pointsService: PointsServiceImpl;
  integralService: IntegralServiceImpl;
  vipService: VipServiceImpl;
  pricingService: PricingServiceImpl;
  withdrawService: WithdrawServiceImpl;
  auditLogService: AuditLogServiceImpl;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// 局部响应类型（本文件内部使用，禁止修改 public/ 契约）
// ---------------------------------------------------------------------------

/** 统一错误响应形态（与 PanelErrorResponse 结构一致，code 放开为 string） */
interface ErrorResponse {
  error: { code: string; message: string };
}

/** 跨实例汇总条目 */
interface BalanceSummaryInstance {
  server_id: string;
  server_name: string;
  points: Pick<InstancePointsRow, 'balance' | 'total_earned' | 'total_spent'>;
  vip_status: VipStatus;
}

/** 流水分页响应 */
interface TransactionPage {
  items: WalletTransactionRow[];
  total: number;
  page: number;
  page_size: number;
}

/** 待审批提现条目（附加用户信息） */
interface PendingWithdrawItem extends WithdrawCodeRow {
  user_username: string | null;
  user_email: string | null;
}

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface WalletTransactionRow {
  id: number;
  user_id: string;
  server_id: string | null;
  currency_type: string;
  type: string;
  amount: number;
  balance_after: number;
  linked_tx_id: number | null;
  order_id: string | null;
  cdk_id: number | null;
  withdraw_code_id: number | null;
  description: string | null;
  operator_user_id: string | null;
  trace_id: string;
  created_at: string;
}

interface InstancePointsJoinRow {
  server_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  server_name: string | null;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** CSV 导出列（顺序即输出顺序） */
const CSV_HEADER =
  'id,created_at,currency_type,type,amount,balance_after,server_id,description,order_id,operator_user_id,trace_id';

/** CSV 导出行数上限 */
const CSV_EXPORT_LIMIT = 10000;

/** 合法 currency_type 过滤值 */
const VALID_CURRENCY_TYPES: ReadonlySet<string> = new Set(['balance', 'points', 'integral']);

/** 充值上限配置键与默认值 */
const RECHARGE_MAX_KEY = 'recharge.max';
const RECHARGE_MAX_DEFAULT = 100000;

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

/**
 * 创建用户中心经济系统路由
 *
 * @param deps 服务依赖（balance/points/integral/vip/pricing/withdraw/auditLog + db + logger）
 */
export function createUserCenterRouter(deps: UserCenterRouterDeps): Router {
  const {
    db,
    balanceService,
    pointsService,
    integralService,
    vipService,
    pricingService,
    withdrawService,
    auditLogService,
    logger,
  } = deps;
  const router = Router();

  /** 审计日志异步写入（失败静默，不阻断主流程） */
  function audit(
    req: Request,
    operatorUserId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>,
  ): void {
    void auditLogService
      .create({
        user_id: operatorUserId,
        action,
        target_type: targetType,
        target_id: targetId,
        details,
        ip_address: req.ip ?? null,
      })
      .catch(() => undefined);
  }

  // ==========================================================================
  // 用户端（/me/*）—— JWT 即可，仅本人数据
  // ==========================================================================

  // ----------------------------------------------------------------
  // GET /me/balance — 查询当前用户全局余额
  // ----------------------------------------------------------------
  router.get('/me/balance', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const balance = await balanceService.getBalance(userId);
      res.json({ balance });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /me/balance/summary — 全局余额 + 跨实例点券/VIP 汇总
  // ----------------------------------------------------------------
  router.get('/me/balance/summary', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const balance = await balanceService.getBalance(userId);
      const pointsRows = (await db('instance_points')
        .select(
          'instance_points.server_id',
          'instance_points.balance',
          'instance_points.total_earned',
          'instance_points.total_spent',
          'servers.name as server_name',
        )
        .leftJoin('servers', 'instance_points.server_id', 'servers.id')
        .where('instance_points.user_id', userId)) as unknown as InstancePointsJoinRow[];

      const instances: BalanceSummaryInstance[] = [];
      for (const row of pointsRows) {
        const vipStatus = await vipService.getVipStatus(userId, row.server_id);
        instances.push({
          server_id: row.server_id,
          server_name: row.server_name ?? '',
          points: {
            balance: row.balance,
            total_earned: row.total_earned,
            total_spent: row.total_spent,
          },
          vip_status: vipStatus,
        });
      }

      res.json({ balance, instances });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /me/withdraw — 申请提现 {amount} → 返回提现码
  // ----------------------------------------------------------------
  router.post('/me/withdraw', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const body = (req.body ?? {}) as { amount?: unknown };
      const amount = parsePositiveInt(body.amount, 'amount');
      const result = await withdrawService.createWithdraw(userId, amount, crypto.randomUUID());
      res.json({
        withdraw_code: result.code,
        actual_amount: result.actual_amount,
        expires_at: result.expires_at,
      });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /me/withdraw/history?page=&page_size= — 提现记录分页
  // ----------------------------------------------------------------
  router.get('/me/withdraw/history', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { page, pageSize } = parsePagination(req.query);
      const result: WithdrawHistoryPage = await withdrawService.getHistory(userId, page, pageSize);
      res.json(result);
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /me/transactions?currency_type=&type=&server_id=&page=&page_size=
  //   本人流水查询（created_at 倒序分页）
  // ----------------------------------------------------------------
  router.get('/me/transactions', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const filters = parseTxFilters(req.query);
      const { page, pageSize, offset } = parsePagination(req.query);

      const base = () => {
        let qb = db<WalletTransactionRow>('wallet_transactions').where('user_id', userId);
        if (filters.currencyType) qb = qb.where('currency_type', filters.currencyType);
        if (filters.type) qb = qb.where('type', filters.type);
        if (filters.serverId) qb = qb.where('server_id', filters.serverId);
        return qb;
      };

      const countRow = (await base().count('id as cnt').first()) as { cnt?: number } | undefined;
      const items = await base().orderBy('created_at', 'desc').limit(pageSize).offset(offset);

      const response: TransactionPage = {
        items,
        total: Number(countRow?.cnt ?? 0),
        page,
        page_size: pageSize,
      };
      res.json(response);
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /me/transactions/export?currency_type=&type=&server_id=
  //   本人流水 CSV 导出（BOM 头防 Excel 乱码，上限 10000 行）
  // ----------------------------------------------------------------
  router.get('/me/transactions/export', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const filters = parseTxFilters(req.query);
      let qb = db<WalletTransactionRow>('wallet_transactions').where('user_id', userId);
      if (filters.currencyType) qb = qb.where('currency_type', filters.currencyType);
      if (filters.type) qb = qb.where('type', filters.type);
      if (filters.serverId) qb = qb.where('server_id', filters.serverId);
      const rows = await qb.orderBy('created_at', 'desc').limit(CSV_EXPORT_LIMIT);

      sendCsv(res, 'transactions.csv', rows);
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /me/stats — 消费统计
  //   ① 按 currency_type+type 汇总（总额/笔数）
  //   ② 近 12 个月按月趋势（收入/支出分列）
  //   ③ Top 5 消费实例（balance 支出，JOIN servers 取名）
  // ----------------------------------------------------------------
  router.get('/me/stats', async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      // ① 按 currency_type + type 汇总
      const byType = (await db('wallet_transactions')
        .where('user_id', userId)
        .select('currency_type', 'type')
        .select(db.raw('SUM(ABS(amount)) as total_amount'))
        .select(db.raw('COUNT(*) as tx_count'))
        .groupBy('currency_type', 'type')) as unknown as Array<{
        currency_type: string;
        type: string;
        total_amount: number;
        tx_count: number;
      }>;

      // ② 近 12 个月趋势（当月 + 前 11 个月）
      const now = new Date();
      const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
      const monthlyTrend = (await db('wallet_transactions')
        .where('user_id', userId)
        .where('created_at', '>=', trendStart)
        .select(db.raw("strftime('%Y-%m', created_at) as month"))
        .select(db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income'))
        .select(db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense'))
        .groupBy('month')
        .orderBy('month', 'asc')) as unknown as Array<{
        month: string;
        income: number;
        expense: number;
      }>;

      // ③ Top 5 消费实例（balance 支出）
      const topServers = (await db('wallet_transactions')
        .leftJoin('servers', 'wallet_transactions.server_id', 'servers.id')
        .where('wallet_transactions.user_id', userId)
        .where('wallet_transactions.currency_type', 'balance')
        .where('wallet_transactions.amount', '<', 0)
        .whereNotNull('wallet_transactions.server_id')
        .select('wallet_transactions.server_id')
        .select(db.raw('COALESCE(servers.name, wallet_transactions.server_id) as server_name'))
        .select(db.raw('SUM(ABS(wallet_transactions.amount)) as total_spent'))
        .groupBy('wallet_transactions.server_id')
        .orderBy('total_spent', 'desc')
        .limit(5)) as unknown as Array<{
        server_id: string;
        server_name: string;
        total_spent: number;
      }>;

      res.json({
        by_type: byType.map((r) => ({
          currency_type: r.currency_type,
          type: r.type,
          total_amount: Number(r.total_amount ?? 0),
          tx_count: Number(r.tx_count ?? 0),
        })),
        monthly_trend: monthlyTrend.map((r) => ({
          month: r.month,
          income: Number(r.income ?? 0),
          expense: Number(r.expense ?? 0),
        })),
        top_servers: topServers.map((r) => ({
          server_id: r.server_id,
          server_name: r.server_name,
          total_spent: Number(r.total_spent ?? 0),
        })),
      });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ==========================================================================
  // 实例端（/servers/:serverId/*）
  // ==========================================================================

  // ----------------------------------------------------------------
  // GET /servers/:serverId/points — 实例点券余额 + 兑换比例
  // ----------------------------------------------------------------
  router.get('/servers/:serverId/points', requireInstanceAccess('serverId'), async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const serverId = req.params.serverId;

      const points = await pointsService.getPoints(userId, serverId);
      const pricing = await pricingService.getPricing(serverId);
      res.json({ points, points_exchange_ratio: pricing.points_exchange_ratio });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /servers/:serverId/points/exchange — 余额兑换点券 {amount}
  //   流程：金额校验 → 日消费上限 → 扣余额 → 加点券（同一 traceId，失败退回余额）
  // ----------------------------------------------------------------
  router.post(
    '/servers/:serverId/points/exchange',
    requireInstanceAccess('serverId'),
    async (req, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const serverId = req.params.serverId;

        const body = (req.body ?? {}) as { amount?: unknown };
        const amount = parsePositiveInt(body.amount, 'amount');

        const pricing = await pricingService.getPricing(serverId);
        const dailyMax = pricing.daily_consumption_limit ?? (await pricingService.getPlatformDailyMax());
        const limit = await balanceService.checkDailyLimit(userId, amount, dailyMax);
        if (!limit.allowed) {
          throw new DailyLimitExceededError(
            `超出单日消费上限：今日已消费 ${limit.today_spent}，本次兑换 ${amount}，上限 ${limit.daily_max}`,
          );
        }

        const pointsCredited = Math.floor(amount * pricing.points_exchange_ratio);
        if (pointsCredited <= 0) {
          throw new ValidationError(
            `兑换金额过小，按当前比例（${pricing.points_exchange_ratio}）折算点券为 0`,
          );
        }

        const traceId = crypto.randomUUID();
        const balanceTxId = await balanceService.debit(
          userId,
          amount,
          'points_exchange',
          `余额兑换点券（${serverId}）`,
          null,
          traceId,
        );

        try {
          await pointsService.credit(
            userId,
            serverId,
            pointsCredited,
            'points_exchange',
            '余额兑换点券',
            null,
            traceId,
            balanceTxId,
          );
        } catch (creditErr) {
          // 补偿：点券入账失败退回已扣余额，避免资金丢失
          await balanceService.credit(
            userId,
            amount,
            'system',
            `余额兑换点券失败退回（${serverId}）`,
            null,
            traceId,
          );
          throw creditErr;
        }

        const points = await pointsService.getPoints(userId, serverId);
        res.json({
          points_credited: pointsCredited,
          balance_tx_id: balanceTxId,
          points,
        });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /servers/:serverId/points/grant — 管理员发放点券 {user_id, amount}
  // ----------------------------------------------------------------
  router.post(
    '/servers/:serverId/points/grant',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const operatorUserId = requireUserId(req, res);
        if (!operatorUserId) return;
        const serverId = req.params.serverId;

        const body = (req.body ?? {}) as { user_id?: unknown; amount?: unknown };
        const targetUserId = parseNonEmptyString(body.user_id, 'user_id');
        const amount = parsePositiveInt(body.amount, 'amount');

        const txId = await pointsService.grantPoints(
          operatorUserId,
          targetUserId,
          serverId,
          amount,
          crypto.randomUUID(),
        );

        audit(req, operatorUserId, 'points.grant', 'user', targetUserId, {
          server_id: serverId,
          amount,
          transaction_id: txId,
        });

        res.json({ transaction_id: txId });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /servers/:serverId/vip/status — VIP 状态 + 定价
  // ----------------------------------------------------------------
  router.get(
    '/servers/:serverId/vip/status',
    requireInstanceAccess('serverId'),
    async (req, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const serverId = req.params.serverId;

        const vip = await vipService.getVipStatus(userId, serverId);
        const pricing = await pricingService.getPricing(serverId);
        res.json({
          vip,
          pricing: {
            vip_monthly_price: pricing.vip_monthly_price,
            vip_lifetime_price: pricing.vip_lifetime_price,
          },
        });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /servers/:serverId/vip/purchase — 购买 VIP {type: 'lifetime'|'monthly'}
  //   先按定价做日消费上限校验（超限消息含今日已消费/上限），再调 purchaseVip
  // ----------------------------------------------------------------
  router.post(
    '/servers/:serverId/vip/purchase',
    requireInstanceAccess('serverId'),
    async (req, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const serverId = req.params.serverId;

        const body = (req.body ?? {}) as { type?: unknown };
        if (body.type !== 'lifetime' && body.type !== 'monthly') {
          const errBody: ErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: "type 必须为 'lifetime' 或 'monthly'" },
          };
          res.status(400).json(errBody);
          return;
        }

        const pricing = await pricingService.getPricing(serverId);
        const price =
          body.type === 'lifetime' ? pricing.vip_lifetime_price : pricing.vip_monthly_price;
        if (price !== null) {
          const dailyMax =
            pricing.daily_consumption_limit ?? (await pricingService.getPlatformDailyMax());
          const limit = await balanceService.checkDailyLimit(userId, price, dailyMax);
          if (!limit.allowed) {
            throw new DailyLimitExceededError(
              `超出单日消费上限：今日已消费 ${limit.today_spent}，本次消费 ${price}，上限 ${limit.daily_max}`,
            );
          }
        }
        // price === null 时由 vipService.purchaseVip 抛 VipPricingNotConfiguredError

        const result: PurchaseVipResult = await vipService.purchaseVip(
          userId,
          serverId,
          body.type,
          crypto.randomUUID(),
        );
        res.json(result);
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /servers/:serverId/pricing — 查询实例定价
  // ----------------------------------------------------------------
  router.get(
    '/servers/:serverId/pricing',
    requireInstanceAccess('serverId'),
    async (req, res) => {
      try {
        const pricing: InstancePricingRow = await pricingService.getPricing(req.params.serverId);
        res.json({ pricing });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // PUT /servers/:serverId/pricing — 更新实例定价（部分更新）
  // ----------------------------------------------------------------
  router.put(
    '/servers/:serverId/pricing',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const operatorUserId = requireUserId(req, res);
        if (!operatorUserId) return;
        const serverId = req.params.serverId;

        const body = (req.body ?? {}) as Partial<Record<keyof PricingUpdates, unknown>>;
        const updates: PricingUpdates = {};
        if (body.vip_monthly_price !== undefined) {
          updates.vip_monthly_price = body.vip_monthly_price as number | null;
        }
        if (body.vip_lifetime_price !== undefined) {
          updates.vip_lifetime_price = body.vip_lifetime_price as number | null;
        }
        if (body.points_exchange_ratio !== undefined) {
          updates.points_exchange_ratio = body.points_exchange_ratio as number;
        }
        if (body.integral_ratio !== undefined) {
          updates.integral_ratio = body.integral_ratio as number;
        }
        if (body.daily_consumption_limit !== undefined) {
          updates.daily_consumption_limit = body.daily_consumption_limit as number | null;
        }

        const operatorRole = req.activeRole ?? req.user?.role ?? 'user';
        const pricing = await pricingService.updatePricing(serverId, updates, operatorRole);

        audit(req, operatorUserId, 'pricing.update', 'server', serverId, {
          updates: updates as Record<string, unknown>,
        });

        res.json({ pricing });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /servers/:serverId/transactions?page=&page_size=&user_id=&currency_type=&type=
  //   实例全用户流水（requireInstanceAdmin）
  // ----------------------------------------------------------------
  router.get(
    '/servers/:serverId/transactions',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const serverId = req.params.serverId;
        const filters = parseTxFilters(req.query);
        const filterUserId =
          typeof req.query.user_id === 'string' && req.query.user_id.trim().length > 0
            ? req.query.user_id.trim()
            : null;
        const { page, pageSize, offset } = parsePagination(req.query);

        const base = () => {
          let qb = db<WalletTransactionRow>('wallet_transactions').where('server_id', serverId);
          if (filterUserId) qb = qb.where('user_id', filterUserId);
          if (filters.currencyType) qb = qb.where('currency_type', filters.currencyType);
          if (filters.type) qb = qb.where('type', filters.type);
          return qb;
        };

        const countRow = (await base().count('id as cnt').first()) as { cnt?: number } | undefined;
        const items = await base().orderBy('created_at', 'desc').limit(pageSize).offset(offset);

        const response: TransactionPage = {
          items,
          total: Number(countRow?.cnt ?? 0),
          page,
          page_size: pageSize,
        };
        res.json(response);
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /servers/:serverId/transactions/export — 全服流水 CSV（上限 10000 行）
  // ----------------------------------------------------------------
  router.get(
    '/servers/:serverId/transactions/export',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const serverId = req.params.serverId;
        const filters = parseTxFilters(req.query);
        const filterUserId =
          typeof req.query.user_id === 'string' && req.query.user_id.trim().length > 0
            ? req.query.user_id.trim()
            : null;

        let qb = db<WalletTransactionRow>('wallet_transactions').where('server_id', serverId);
        if (filterUserId) qb = qb.where('user_id', filterUserId);
        if (filters.currencyType) qb = qb.where('currency_type', filters.currencyType);
        if (filters.type) qb = qb.where('type', filters.type);
        const rows = await qb.orderBy('created_at', 'desc').limit(CSV_EXPORT_LIMIT);

        sendCsv(res, 'transactions.csv', rows);
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /servers/:serverId/stats — 实例消费概况（requireInstanceAdmin）
  //   余额消费总额 / 点券发放与消费总额 / 近30天趋势 / VIP购买人数
  // ----------------------------------------------------------------
  router.get(
    '/servers/:serverId/stats',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const serverId = req.params.serverId;

        // 余额消费总额（balance 支出）
        const balanceRow = (await db('wallet_transactions')
          .where({ server_id: serverId, currency_type: 'balance' })
          .where('amount', '<', 0)
          .select(db.raw('COALESCE(SUM(ABS(amount)), 0) as total'))
          .first()) as { total?: number } | undefined;

        // 点券发放（正）与消费（负）总额
        const pointsRow = (await db('wallet_transactions')
          .where({ server_id: serverId, currency_type: 'points' })
          .select(db.raw('COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as earned'))
          .select(db.raw('COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as spent'))
          .first()) as { earned?: number; spent?: number } | undefined;

        // 近 30 天趋势（按日分组，收入/支出分列）
        const trendStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const dailyTrend = (await db('wallet_transactions')
          .where('server_id', serverId)
          .where('created_at', '>=', trendStart)
          .select(db.raw("strftime('%Y-%m-%d', created_at) as day"))
          .select(db.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income'))
          .select(db.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense'))
          .groupBy('day')
          .orderBy('day', 'asc')) as unknown as Array<{
          day: string;
          income: number;
          expense: number;
        }>;

        // VIP 购买人数（user_vip_status 中该实例 vip_type 非 NULL 的用户数）
        const vipRow = (await db('user_vip_status')
          .where('server_id', serverId)
          .whereNotNull('vip_type')
          .count('user_id as cnt')
          .first()) as { cnt?: number } | undefined;

        res.json({
          balance_spent_total: Number(balanceRow?.total ?? 0),
          points_earned_total: Number(pointsRow?.earned ?? 0),
          points_spent_total: Number(pointsRow?.spent ?? 0),
          daily_trend: dailyTrend.map((r) => ({
            day: r.day,
            income: Number(r.income ?? 0),
            expense: Number(r.expense ?? 0),
          })),
          vip_purchased_users: Number(vipRow?.cnt ?? 0),
        });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // PATCH /servers/:serverId/integrals/:userId — 管理员调整积分
  //   body: {amount(非零整数，带符号), description}
  // ----------------------------------------------------------------
  router.patch(
    '/servers/:serverId/integrals/:userId',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const operatorUserId = requireUserId(req, res);
        if (!operatorUserId) return;
        const serverId = req.params.serverId;
        const targetUserId = req.params.userId;

        const body = (req.body ?? {}) as { amount?: unknown; description?: unknown };
        if (typeof body.amount !== 'number' || !Number.isInteger(body.amount) || body.amount === 0) {
          const errBody: ErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `amount 必须为非零整数: ${String(body.amount)}`,
            },
          };
          res.status(400).json(errBody);
          return;
        }
        const description = parseNonEmptyString(body.description, 'description');

        const txId = await integralService.adjustIntegral(
          operatorUserId,
          targetUserId,
          serverId,
          body.amount,
          description,
          crypto.randomUUID(),
        );

        audit(req, operatorUserId, 'integral.adjust', 'user', targetUserId, {
          server_id: serverId,
          amount: body.amount,
          description,
          transaction_id: txId,
        });

        const integral = await integralService.getOrCreateIntegral(targetUserId, serverId);
        res.json({ transaction_id: txId, integral });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /servers/:serverId/wallet/credit — 订单号充值（requireAdmin，幂等）
  //   body: {user_id, amount, order_id}
  //   幂等：order_id 已存在流水 → 200 {duplicated:true, transaction}
  // ----------------------------------------------------------------
  router.post(
    '/servers/:serverId/wallet/credit',
    requireAdmin,
    async (req, res) => {
      try {
        const operatorUserId = requireUserId(req, res);
        if (!operatorUserId) return;
        const serverId = req.params.serverId;

        const body = (req.body ?? {}) as {
          user_id?: unknown;
          amount?: unknown;
          order_id?: unknown;
        };
        const targetUserId = parseNonEmptyString(body.user_id, 'user_id');
        const amount = parsePositiveInt(body.amount, 'amount');
        const orderId = parseNonEmptyString(body.order_id, 'order_id');

        // 幂等：同一 order_id 已入账 → 直接返回已有流水
        const existing = await db<WalletTransactionRow>('wallet_transactions')
          .where('order_id', orderId)
          .first();
        if (existing) {
          res.json({ duplicated: true, transaction: existing });
          return;
        }

        // 充值上限检查（目标用户余额已达 recharge.max → 拒绝）
        const targetBalance = await balanceService.getBalance(targetUserId);
        const rechargeMax = await getRechargeMax(db);
        const canRecharge = await balanceService.canRecharge(targetUserId, rechargeMax);
        if (!canRecharge) {
          throw new RechargeLimitExceededError(
            `目标用户余额已达充值上限：当前 ${targetBalance.balance}，上限 ${rechargeMax}`,
          );
        }

        const traceId = crypto.randomUUID();
        let txId: number;
        try {
          txId = await balanceService.credit(
            targetUserId,
            amount,
            'admin_credit',
            `订单号充值 ${orderId}`,
            operatorUserId,
            traceId,
            { orderId },
          );
        } catch (creditErr) {
          // 并发兜底：order_id 部分唯一索引冲突 → 重查并返回已有流水
          const message = creditErr instanceof Error ? creditErr.message : String(creditErr);
          if (message.includes('UNIQUE constraint failed') && message.includes('order_id')) {
            const raced = await db<WalletTransactionRow>('wallet_transactions')
              .where('order_id', orderId)
              .first();
            if (raced) {
              res.json({ duplicated: true, transaction: raced });
              return;
            }
          }
          throw creditErr;
        }

        audit(req, operatorUserId, 'wallet.credit', 'user', targetUserId, {
          server_id: serverId,
          amount,
          order_id: orderId,
          transaction_id: txId,
        });

        res.json({ transaction_id: txId });
      } catch (err) {
        handleUserCenterError(res, err, logger);
      }
    },
  );

  // ==========================================================================
  // 管理端（/admin/withdraw/*）—— requireAdmin（server_admin）
  // ==========================================================================

  // ----------------------------------------------------------------
  // GET /admin/withdraw/pending?page=&page_size= — 待审批提现列表
  //   附加申请用户的 username / email
  // ----------------------------------------------------------------
  router.get('/admin/withdraw/pending', requireAdmin, async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await withdrawService.getPendingList(page, pageSize);

      const userIds = [...new Set(result.items.map((item) => item.user_id))];
      const userRows =
        userIds.length > 0
          ? await db<{ id: string; username: string; email: string }>('users')
              .select('id', 'username', 'email')
              .whereIn('id', userIds)
          : [];
      const userMap = new Map(userRows.map((u) => [u.id, u]));

      const items: PendingWithdrawItem[] = result.items.map((item) => {
        const u = userMap.get(item.user_id);
        return {
          ...item,
          user_username: u?.username ?? null,
          user_email: u?.email ?? null,
        };
      });

      res.json({ items, total: result.total, page: result.page, page_size: result.page_size });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /admin/withdraw/:code/approve — 核销提现码（确认已线下打款）
  // ----------------------------------------------------------------
  router.post('/admin/withdraw/:code/approve', requireAdmin, async (req, res) => {
    try {
      const operatorUserId = requireUserId(req, res);
      if (!operatorUserId) return;
      const code = req.params.code;

      await withdrawService.approveWithdraw(code, operatorUserId, crypto.randomUUID());

      audit(req, operatorUserId, 'withdraw.approve', 'withdraw_code', code, {});

      res.json({ approved: true, code });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /admin/withdraw/:code/reject — 拒绝提现（解冻退回余额）
  // ----------------------------------------------------------------
  router.post('/admin/withdraw/:code/reject', requireAdmin, async (req, res) => {
    try {
      const operatorUserId = requireUserId(req, res);
      if (!operatorUserId) return;
      const code = req.params.code;

      await withdrawService.rejectWithdraw(code, operatorUserId, crypto.randomUUID());

      audit(req, operatorUserId, 'withdraw.reject', 'withdraw_code', code, {});

      res.json({ rejected: true, code });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /admin/cdk/report — CDK 批次追溯报表（方案 §8.2）
  //   批次维度（创建者 + 日期 + 类型）使用率 + 最近兑换时间线
  // ----------------------------------------------------------------
  router.get('/admin/cdk/report', requireAdmin, async (req, res) => {
    try {
      const operatorUserId = requireUserId(req, res);
      if (!operatorUserId) return;

      interface BatchRow {
        created_by: string;
        creator_username: string | null;
        type: string;
        day: string;
        total: number;
        redeemed: number;
      }
      const batchRows = (await db('cdk_codes')
        .leftJoin('users', 'cdk_codes.created_by', 'users.id')
        .select(
          'cdk_codes.created_by',
          'users.username as creator_username',
          'cdk_codes.type',
          db.raw("date(cdk_codes.created_at) as day"),
          db.raw('COUNT(*) as total'),
          db.raw('SUM(CASE WHEN cdk_codes.claimed_at IS NOT NULL THEN 1 ELSE 0 END) as redeemed'),
        )
        .groupBy(
          'cdk_codes.created_by',
          'users.username',
          'cdk_codes.type',
          db.raw('date(cdk_codes.created_at)'),
        )
        .orderBy(db.raw('date(cdk_codes.created_at)'), 'desc')
        .limit(100)
        .catch(() => [] as unknown[])) as BatchRow[];

      const batches = batchRows.map((r) => {
        const total = Number(r.total ?? 0);
        const redeemed = Number(r.redeemed ?? 0);
        return {
          created_by: r.created_by,
          creator_username: r.creator_username ?? null,
          type: r.type,
          day: r.day,
          total,
          redeemed,
          usage_rate: total > 0 ? Math.round((redeemed / total) * 1000) / 1000 : 0,
        };
      });

      interface TimelineRow {
        id: number;
        code: string;
        type: string;
        item_name: string | null;
        amount: number | null;
        server_id: string;
        claimed_player: string | null;
        claimed_at: string;
        created_by: string;
      }
      const timelineRows = (await db('cdk_codes')
        .select(
          'id',
          'code',
          'type',
          'item_name',
          'amount',
          'server_id',
          'claimed_player',
          'claimed_at',
          'created_by',
        )
        .whereNotNull('claimed_at')
        .orderBy('claimed_at', 'desc')
        .limit(50)
        .catch(() => [] as unknown[])) as TimelineRow[];

      res.json({ batches, timeline: timelineRows });
    } catch (err) {
      handleUserCenterError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 提取当前用户 ID；缺失时写 401 并返回 null */
function requireUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    const body: ErrorResponse = {
      error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
    };
    res.status(401).json(body);
    return null;
  }
  return userId;
}

/** 校验并返回正整数；非法时抛 400（由统一错误处理转译） */
function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`字段 ${field} 必须为正整数: ${String(value)}`);
  }
  return value;
}

/** 校验并返回非空字符串；非法时抛 400 */
function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`字段 ${field} 必须为非空字符串`);
  }
  return value.trim();
}

/** 解析流水查询过滤参数（currency_type 白名单校验，type/server_id 透传） */
function parseTxFilters(query: Request['query']): {
  currencyType: string | null;
  type: string | null;
  serverId: string | null;
} {
  const rawCurrency = typeof query.currency_type === 'string' ? query.currency_type : null;
  return {
    currencyType: rawCurrency && VALID_CURRENCY_TYPES.has(rawCurrency) ? rawCurrency : null,
    type: typeof query.type === 'string' && query.type.trim().length > 0 ? query.type.trim() : null,
    serverId:
      typeof query.server_id === 'string' && query.server_id.trim().length > 0
        ? query.server_id.trim()
        : null,
  };
}

/** 发送 CSV 响应（BOM 头防 Excel 乱码 + Content-Disposition attachment） */
function sendCsv(res: Response, filename: string, rows: WalletTransactionRow[]): void {
  const lines = rows.map((r) =>
    [
      r.id,
      r.created_at,
      r.currency_type,
      r.type,
      r.amount,
      r.balance_after,
      r.server_id ?? '',
      r.description ?? '',
      r.order_id ?? '',
      r.operator_user_id ?? '',
      r.trace_id,
    ]
      .map(csvCell)
      .join(','),
  );
  const csv = '﻿' + [CSV_HEADER, ...lines].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/** CSV 单元格转义（含逗号/引号/换行时加引号并双写引号） */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 读取平台充值上限（system_config key='recharge.max'，默认 100000） */
async function getRechargeMax(db: Knex): Promise<number> {
  try {
    const row = await db<{ key: string; value: string }>('system_config')
      .where({ key: RECHARGE_MAX_KEY })
      .first();
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : RECHARGE_MAX_DEFAULT;
  } catch {
    return RECHARGE_MAX_DEFAULT;
  }
}

/** 统一错误处理：AppError 按 code/httpStatus 返回；其他异常 500 */
function handleUserCenterError(res: Response, err: unknown, logger: Logger): void {
  if (
    err instanceof AppError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      'httpStatus' in (err as Record<string, unknown>))
  ) {
    const e = err as { code: string; message: string; httpStatus?: number };
    const body: ErrorResponse = { error: { code: e.code, message: e.message } };
    res.status(e.httpStatus ?? 500).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'userCenter router internal error');
  const body: ErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
