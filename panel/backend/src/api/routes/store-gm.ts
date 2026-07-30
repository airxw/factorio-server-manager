// ============================================================================
// v4.13.0: GM Workbench 后端 API（服主工作台数据接口）
// 依据：docs/plans/v4.13.0-instances-split-plan.md 步骤15-19
//
// 端点清单：
//   GET  /api/store/players?instance_id=&page=&limit=&search=
//        玩家列表（CRM）— 聚合 users + player_bindings + shop_orders + player_sessions
//   GET  /api/store/reports/revenue?instance_id=&days=
//        流水报表 — 按日聚合 shop_orders + cdk_codes
//   GET  /api/store/reports/playtime?instance_id=&days=
//        时长统计 — 按日聚合 player_sessions
//   GET  /api/store/servers
//        服主实例列表 — servers + 在线玩家数 + 今日收入
//
// 门控：
//   - 路由层 requireRole(INSTANCE_ADMIN, SERVER_ADMIN)
//   - 处理器内部校验实例级权限：
//     server_admin 可访问任何实例
//     instance_admin 只能访问 owner_user_id = 当前用户 的实例
//
// 数据源：直接操作 Knex db 实例（聚合查询，不需要 services 注入）
// 契约：public/schema/panel-api-types.ts
// ============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import { Role } from '../../core/auth/roles.js';
import { requireRole } from '../../middleware/auth.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';
// v4.33.0: 分页/日期统一走公共 utils（W3 提炼批）
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePositiveInt } from '../../utils/pagination.js';
import { utcDateKey } from '../../utils/date.js';

/** DB 行类型 */
interface ServerRow {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  owner_user_id: string;
  status: string;
  port: number;
  rcon_port: number;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  vip_level: number;
  vip_expires_at: string | null;
  created_at: string;
}

interface PlayerBindingRow {
  id: number;
  user_id: string;
  game_player_name: string;
  game_type: string;
  status: string;
  verified_at: string | null;
}

interface ShopOrderRow {
  id: number;
  server_id: string;
  user_id: string;
  status: string;
  total_price: number;
  items_count: number;
  created_at: string;
  claimed_at: string | null;
}

interface CdkCodeRow {
  id: number;
  server_id: string;
  status: string;
  claimed_at: string | null;
  created_at: string;
}

interface PlayerSessionRow {
  session_id: string;
  player_user_id: string;
  instance_id: string;
  game_player_name: string | null;
  join_at: string;
  leave_at: string | null;
  duration_seconds: number | null;
}

/**
 * 创建 GM Workbench 路由
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createStoreGmRouter(db: Knex, logger: Logger): Router {
  const router = Router();

  // ========================================================================
  // GET /api/store/players — 玩家列表（CRM）
  // Query: instance_id (必填) / page (默认 1) / limit (默认 20, 上限 100) / search (可选)
  // ========================================================================
  router.get(
    '/store/players',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const instanceId = String(req.query.instance_id ?? '');
        // v4.33.0: 分页解析统一走公共 utils（W3 提炼批；本路由第二参数名为 limit）
        const page = parsePositiveInt(req.query.page, 1);
        const limit = Math.min(MAX_PAGE_SIZE, parsePositiveInt(req.query.limit, DEFAULT_PAGE_SIZE));
        const search = req.query.search ? String(req.query.search).trim() : '';

        if (!instanceId) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 参数' },
          } as PanelErrorResponse);
          return;
        }

        // 实例级权限校验
        const authResult = await authorizeInstanceAccess(db, req, instanceId);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        // 1. 校验实例存在（v4.27.0: 不再查 game_type，仅校验存在性）
        const server = await db<ServerRow>('servers').select('id').where({ id: instanceId }).first();
        if (!server) {
          res.status(404).json({
            error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' },
          } as PanelErrorResponse);
          return;
        }

        // 2. 查询该实例的玩家（v4.17.0: 旧表 player_bindings 已合并到统一 bindings 表，
        //    v4.27.0: binding_type='player', scope_type='instance' 表示实例级玩家绑定）
        //    字段映射：game_player_name→player_name, game_type→scope_ref(=server_id), status→verify_status
        //    通过 SELECT 别名保持对外字段名（PlayerBindingRow）不变
        const baseQuery = db<PlayerBindingRow>('bindings')
          .select(
            'id',
            'user_id',
            'player_name as game_player_name',
            'scope_ref as game_type',
            'verify_status as status',
            'verified_at',
          )
          .where('binding_type', '=', 'player')
          .where('scope_type', '=', 'instance')
          .where('scope_ref', '=', instanceId)
          .where('verify_status', '=', 'verified');

        const bindingQuery = search
          ? baseQuery.where(function (this: Knex.QueryBuilder) {
              this.where('player_name', 'like', `%${search}%`)
                .orWhereIn('user_id', function (this: Knex.QueryBuilder) {
                  this.select('id').from<UserRow>('users')
                    .where('username', 'like', `%${search}%`)
                    .orWhere('email', 'like', `%${search}%`);
                });
            })
          : baseQuery;

        const totalRow = await bindingQuery.clone().count('* as cnt').first() as unknown as { cnt: number } | undefined;
        const totalCount = Number(totalRow?.cnt ?? 0);

        const bindings = await bindingQuery
          .clone()
          .orderBy('verified_at', 'desc')
          .offset((page - 1) * limit)
          .limit(limit);

        // 3. 批量查询关联的 users / 累计消费 / 在线时长
        const userIds = bindings.map((b) => b.user_id);
        const users = userIds.length > 0
          ? await db<UserRow>('users').whereIn('id', userIds)
          : [];

        // 累计消费：shop_orders 按 user_id 聚合 total_price（仅 claimed 订单）
        const spendings = userIds.length > 0
          ? await db<ShopOrderRow>('shop_orders')
              .select('user_id')
              .sum('total_price as total_spent')
              .count('id as order_count')
              .where({ server_id: instanceId, status: 'claimed' })
              .whereIn('user_id', userIds)
              .groupBy('user_id')
          : [];

        // 在线时长：player_sessions 按 player_user_id 聚合 duration_seconds
        const playtimes = userIds.length > 0
          ? await db<PlayerSessionRow>('player_sessions')
              .select('player_user_id')
              .sum('duration_seconds as total_seconds')
              .count('session_id as session_count')
              .where({ instance_id: instanceId })
              .whereNotNull('duration_seconds')
              .whereIn('player_user_id', userIds)
              .groupBy('player_user_id')
          : [];

        // 4. 组装响应
        const userMap = new Map(users.map((u) => [u.id, u]));
        const spendMap = new Map(spendings.map((s: any) => [s.user_id, s]));
        const playMap = new Map(playtimes.map((p: any) => [p.player_user_id, p]));

        const players = bindings.map((b) => {
          const user = userMap.get(b.user_id);
          const spend = spendMap.get(b.user_id) as any;
          const play = playMap.get(b.user_id) as any;
          return {
            user_id: b.user_id,
            username: user?.username ?? '(未知用户)',
            email: user?.email ?? '',
            game_player_name: b.game_player_name,
            game_type: b.game_type,
            status: user?.status ?? 'unknown',
            vip_level: user?.vip_level ?? 0,
            vip_expires_at: user?.vip_expires_at ?? null,
            total_spent: Number(spend?.total_spent ?? 0),
            order_count: Number(spend?.order_count ?? 0),
            total_playtime_seconds: Number(play?.total_seconds ?? 0),
            session_count: Number(play?.session_count ?? 0),
            bound_at: b.verified_at ?? '',
          };
        });

        res.json({
          players,
          pagination: {
            page,
            limit,
            total: totalCount,
            total_pages: Math.ceil(totalCount / limit),
          },
        });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-gm router error');
        next(err);
      }
    },
  );

  // ========================================================================
  // GET /api/store/reports/revenue — 流水报表
  // Query: instance_id (必填) / days (默认 30, 上限 90)
  // ========================================================================
  router.get(
    '/store/reports/revenue',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const instanceId = String(req.query.instance_id ?? '');
        const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));

        if (!instanceId) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 参数' },
          } as PanelErrorResponse);
          return;
        }

        const authResult = await authorizeInstanceAccess(db, req, instanceId);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        // 计算日期范围（ISO 8601）
        const now = new Date();
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const startDateIso = startDate.toISOString();

        // 1. 订单按日聚合（仅 claimed 计入收入）
        const orderAgg = await db<ShopOrderRow>('shop_orders')
          .select(db.raw("substr(created_at, 1, 10) as date"))
          .count('id as order_count')
          .sum('total_price as revenue')
          .where({ server_id: instanceId, status: 'claimed' })
          .where('created_at', '>=', startDateIso)
          .groupByRaw("substr(created_at, 1, 10)")
          .orderBy('date', 'asc');

        // 2. CDK 兑换按日聚合
        const cdkAgg = await db<CdkCodeRow>('cdk_codes')
          .select(db.raw("substr(claimed_at, 1, 10) as date"))
          .count('id as cdk_redeemed')
          .where({ server_id: instanceId, status: 'claimed' })
          .where('claimed_at', '>=', startDateIso)
          .groupByRaw("substr(claimed_at, 1, 10)")
          .orderBy('date', 'asc');

        // 3. 合并按日期对齐
        const cdkMap = new Map(cdkAgg.map((r: any) => [r.date, Number(r.cdk_redeemed)]));
        const daily = orderAgg.map((r: any) => ({
          date: r.date,
          order_count: Number(r.order_count),
          revenue: Number(r.revenue ?? 0),
          cdk_redeemed: cdkMap.get(r.date) ?? 0,
        }));

        // 补全缺失日期（无数据的日子填 0）
        const dateSet = new Set<string>();
        for (let i = 0; i < days; i++) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          dateSet.add(utcDateKey(d));
        }
        for (const date of dateSet) {
          if (!daily.find((d) => d.date === date)) {
            daily.push({ date, order_count: 0, revenue: 0, cdk_redeemed: 0 });
          }
        }
        daily.sort((a, b) => a.date.localeCompare(b.date));

        // 4. 汇总
        const summary = {
          total_revenue: daily.reduce((sum, d) => sum + d.revenue, 0),
          total_orders: daily.reduce((sum, d) => sum + d.order_count, 0),
          total_cdk_redeemed: daily.reduce((sum, d) => sum + d.cdk_redeemed, 0),
          days,
        };

        res.json({ daily, summary });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-gm router error');
        next(err);
      }
    },
  );

  // ========================================================================
  // GET /api/store/reports/playtime — 时长统计
  // Query: instance_id (必填) / days (默认 30, 上限 90)
  // 数据源：player_sessions（依赖步骤18a migration + 步骤18b daemon 写入链路）
  // ========================================================================
  router.get(
    '/store/reports/playtime',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const instanceId = String(req.query.instance_id ?? '');
        const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));

        if (!instanceId) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 instance_id 参数' },
          } as PanelErrorResponse);
          return;
        }

        const authResult = await authorizeInstanceAccess(db, req, instanceId);
        if (!authResult.ok) {
          res.status(authResult.status).json(authResult.body);
          return;
        }

        // 检查 player_sessions 表是否存在（防止 migration 未执行时崩溃）
        const hasTable = await db.schema.hasTable('player_sessions');
        if (!hasTable) {
          res.json({
            daily: [],
            summary: { total_playtime_seconds: 0, total_sessions: 0, active_players: 0, days },
            note: 'player_sessions 表不存在，请先执行 migration',
          });
          return;
        }

        const now = new Date();
        const startDateIso = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

        // 按日聚合（基于 join_at 日期）
        const agg = await db<PlayerSessionRow>('player_sessions')
          .select(db.raw("substr(join_at, 1, 10) as date"))
          .count('session_id as session_count')
          .sum('duration_seconds as total_seconds')
          .countDistinct('player_user_id as active_players')
          .where({ instance_id: instanceId })
          .where('join_at', '>=', startDateIso)
          .groupByRaw("substr(join_at, 1, 10)")
          .orderBy('date', 'asc');

        const daily = agg.map((r: any) => ({
          date: r.date,
          session_count: Number(r.session_count),
          total_seconds: Number(r.total_seconds ?? 0),
          active_players: Number(r.active_players),
          avg_seconds: Number(r.session_count) > 0
            ? Math.floor(Number(r.total_seconds ?? 0) / Number(r.session_count))
            : 0,
        }));

        // 补全缺失日期
        const dateSet = new Set<string>();
        for (let i = 0; i < days; i++) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          dateSet.add(utcDateKey(d));
        }
        for (const date of dateSet) {
          if (!daily.find((d) => d.date === date)) {
            daily.push({ date, session_count: 0, total_seconds: 0, active_players: 0, avg_seconds: 0 });
          }
        }
        daily.sort((a, b) => a.date.localeCompare(b.date));

        const summary = {
          total_playtime_seconds: daily.reduce((sum, d) => sum + d.total_seconds, 0),
          total_sessions: daily.reduce((sum, d) => sum + d.session_count, 0),
          active_players: daily.reduce((max, d) => Math.max(max, d.active_players), 0),
          days,
        };

        res.json({ daily, summary });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-gm router error');
        next(err);
      }
    },
  );

  // ========================================================================
  // GET /api/store/servers — 服主实例列表
  // Query: all (可选, server_admin 专用, 看所有实例)
  // ========================================================================
  router.get(
    '/store/servers',
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = req.user!;
        const role = (user.role ?? '').toLowerCase();
        const showAll = req.query.all === 'true' && role === 'server_admin';

        // 过滤条件：instance_admin 只看自己的实例，server_admin 可选看所有
        let query = db<ServerRow>('servers').select('id', 'name', 'pack_id', 'game_type', 'owner_user_id', 'status', 'port', 'rcon_port', 'created_at');
        if (!showAll) {
          query = query.where({ owner_user_id: user.userId });
        }
        const servers = await query.orderBy('created_at', 'desc');

        if (servers.length === 0) {
          res.json({ servers: [] });
          return;
        }

        // 批量查询在线玩家数 + 今日收入
        const serverIds = servers.map((s) => s.id);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayIso = todayStart.toISOString();

        // 在线玩家数：player_sessions 中 leave_at IS NULL 的会话数
        const hasSessionsTable = await db.schema.hasTable('player_sessions');
        let onlineCounts: any[] = [];
        if (hasSessionsTable) {
          onlineCounts = await db<PlayerSessionRow>('player_sessions')
            .select('instance_id')
            .count('session_id as online_count')
            .whereNull('leave_at')
            .whereIn('instance_id', serverIds)
            .groupBy('instance_id');
        }

        // 今日收入：shop_orders 中 status=claimed 且 created_at >= 今日
        const revenueAgg = await db<ShopOrderRow>('shop_orders')
          .select('server_id')
          .sum('total_price as today_revenue')
          .count('id as today_orders')
          .where({ status: 'claimed' })
          .where('created_at', '>=', todayIso)
          .whereIn('server_id', serverIds)
          .groupBy('server_id');

        const onlineMap = new Map(onlineCounts.map((r: any) => [r.instance_id, Number(r.online_count)]));
        const revenueMap = new Map(revenueAgg.map((r: any) => [r.server_id, {
          revenue: Number(r.today_revenue),
          orders: Number(r.today_orders),
        }]));

        const result = servers.map((s) => {
          const rev = revenueMap.get(s.id);
          return {
            id: s.id,
            name: s.name,
            pack_id: s.pack_id,
            game_type: s.game_type,
            owner_user_id: s.owner_user_id,
            status: s.status,
            port: s.port,
            rcon_port: s.rcon_port,
            online_players: onlineMap.get(s.id) ?? 0,
            today_revenue: rev?.revenue ?? 0,
            today_orders: rev?.orders ?? 0,
            created_at: s.created_at,
          };
        });

        res.json({ servers: result });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'store-gm router error');
        next(err);
      }
    },
  );

  return router;
}

// ============================================================================
// 实例级权限校验辅助函数
// server_admin 可访问任何实例
// instance_admin 只能访问 owner_user_id = 当前用户 的实例
// ============================================================================

interface AuthResult {
  ok: boolean;
  status: number;
  body: PanelErrorResponse;
}

async function authorizeInstanceAccess(
  db: Knex,
  req: Request,
  instanceId: string,
): Promise<AuthResult> {
  const user = req.user;
  if (!user) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' } },
    };
  }

  const role = (user.role ?? '').toLowerCase();
  // server_admin / system_admin / admin 直接通过
  if (role === 'server_admin' || role === 'system_admin' || role === 'admin') {
    return { ok: true, status: 0, body: {} as PanelErrorResponse };
  }

  // instance_admin 校验 owner
  const server = await db<ServerRow>('servers')
    .select('owner_user_id')
    .where({ id: instanceId })
    .first();

  if (!server) {
    return {
      ok: false,
      status: 404,
      body: { error: { code: 'SERVER_NOT_FOUND', message: '实例不存在' } },
    };
  }

  if (server.owner_user_id !== user.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: { code: 'PANEL_FORBIDDEN', message: '无权访问该实例' } },
    };
  }

  return { ok: true, status: 0, body: {} as PanelErrorResponse };
}
