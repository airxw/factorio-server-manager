// ============================================================================
// platform-stats.ts — 全平台统计路由（v4.7.0 G1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 挂载前缀：/api/platform
//
// 端点（仅 server_admin 可访问，由 index.ts 挂载时 requireAdmin 控制）：
//   GET /overview               — 全平台总览（用户/实例/节点/磁盘/收入/告警/状态分布）
//   GET /users?range=24h|30d    — 用户活跃度曲线
//   GET /revenue?days=30        — 收入曲线（默认 30 天，范围 1-90）
//   GET /disk-usage-top?limit=10 — 磁盘占用 TopN 实例
//
// 查询策略：所有聚合查询用 try-catch 保护，表不存在时返回安全默认值（0 / 空数组）。
// Knex 聚合查询的 TS 类型不包含别名列，统一用 `as unknown as RowType` 转型。
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type {
  DiskUsageTopResponse,
  PlatformDiskUsageItem,
  PlatformInstanceStatusDistribution,
  PlatformOverview,
  PlatformRevenueTrendPoint,
  PlatformRevenueTrendResponse,
  PlatformUsersTrendPoint,
  PlatformUsersTrendResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型（聚合查询结果）
// ---------------------------------------------------------------------------

interface CountRow {
  cnt: number;
}

interface SumRow {
  total: number | null;
}

interface DailyUsersRow {
  date: string;
  active_users: number;
}

interface DailyRevenueRow {
  date: string;
  revenue: number;
  orders: number;
}

interface ServerDiskRow {
  id: string;
  name: string;
  disk_usage_bytes: number | null;
  owner_user_id: string;
}

// ---------------------------------------------------------------------------
// 服务类（平台级统计聚合，无用户过滤）
// ---------------------------------------------------------------------------

class PlatformStatsService {
  constructor(private readonly db: Knex) {}

  /**
   * 全平台总览
   */
  async getOverview(): Promise<PlatformOverview> {
    const totalUsers = await this.countUsers();
    const activeUsers24h = await this.countActiveUsers(24 * 60 * 60 * 1000);
    const activeUsers30d = await this.countActiveUsers(30 * 24 * 60 * 60 * 1000);
    const totalInstances = await this.countInstances();
    const runningInstances = await this.countInstancesByStatus('running');
    const totalNodes = await this.countNodes();
    const healthyNodes = await this.countNodesByStatus('online');
    const totalDiskUsedMb = await this.sumDiskUsageMb();
    const { revenueToday, revenue30d } = await this.getRevenueStats();
    const alerts24h = await this.countAlerts24h();
    const topDiskUsage = await this.getTopDiskUsage(10);
    const instanceStatusDistribution = await this.getInstanceStatusDistribution();

    return {
      total_users: totalUsers,
      active_users_24h: activeUsers24h,
      active_users_30d: activeUsers30d,
      total_instances: totalInstances,
      running_instances: runningInstances,
      total_nodes: totalNodes,
      healthy_nodes: healthyNodes,
      total_disk_used_mb: totalDiskUsedMb,
      total_disk_capacity_mb: 0, // 节点磁盘容量需 daemon 实时查询，DB 无缓存，返回 0
      revenue_today: revenueToday,
      revenue_30d: revenue30d,
      alerts_24h: alerts24h,
      top_disk_usage: topDiskUsage,
      instance_status_distribution: instanceStatusDistribution,
    };
  }

  /**
   * 用户活跃度曲线（按天聚合 users.last_login_at）
   * @param range '24h' | '30d'
   */
  async getUsersTrend(range: '24h' | '30d'): Promise<PlatformUsersTrendResponse> {
    const days = range === '24h' ? 1 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      // date() 是 SQLite 特有函数，PostgreSQL 用 DATE(col)::text 返回等价格式
      const dateExpr =
        this.db.client.dialect === 'sqlite'
          ? 'date(last_login_at)'
          : 'DATE(last_login_at)::text';
      const rows = (await this.db('users')
        .select(this.db.raw(`${dateExpr} as date`))
        .count('* as active_users')
        .whereNotNull('last_login_at')
        .where('last_login_at', '>=', since)
        .groupByRaw(dateExpr)
        .orderBy('date', 'asc')) as unknown as DailyUsersRow[];
      const points: PlatformUsersTrendPoint[] = rows.map((r) => ({
        date: String(r.date),
        active_users: Number(r.active_users) || 0,
      }));
      return { range, points };
    } catch {
      return { range, points: [] };
    }
  }

  /**
   * 收入曲线（按天聚合 shop_orders，status='claimed'）
   * @param days 天数（1-90）
   */
  async getRevenueTrend(days: number): Promise<PlatformRevenueTrendResponse> {
    const safeDays = Math.max(1, Math.min(days, 90));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      // date() 是 SQLite 特有函数，PostgreSQL 用 DATE(col)::text 返回等价格式
      const dateExpr =
        this.db.client.dialect === 'sqlite'
          ? 'date(created_at)'
          : 'DATE(created_at)::text';
      const rows = (await this.db('shop_orders')
        .select(
          this.db.raw(`${dateExpr} as date`),
          this.db.raw("COALESCE(SUM(total_price), 0) as revenue"),
          this.db.raw("COUNT(*) as orders"),
        )
        .where('status', 'claimed')
        .where('created_at', '>=', since)
        .groupByRaw(dateExpr)
        .orderBy('date', 'asc')) as unknown as DailyRevenueRow[];
      const points: PlatformRevenueTrendPoint[] = rows.map((r) => ({
        date: String(r.date),
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      }));
      return { days: safeDays, points };
    } catch {
      return { days: safeDays, points: [] };
    }
  }

  /**
   * 磁盘占用 TopN 实例
   * @param limit 返回条数（1-100）
   */
  async getDiskUsageTop(limit: number): Promise<DiskUsageTopResponse> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const items = await this.getTopDiskUsage(safeLimit);
    return { items };
  }

  // -------------------------------------------------------------------------
  // 私有查询方法
  // -------------------------------------------------------------------------

  private async countUsers(): Promise<number> {
    try {
      const row = (await this.db('users')
        .whereNot('status', 'deleted')
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async countActiveUsers(sinceMs: number): Promise<number> {
    try {
      const since = new Date(Date.now() - sinceMs).toISOString();
      const row = (await this.db('users')
        .whereNot('status', 'deleted')
        .whereNotNull('last_login_at')
        .where('last_login_at', '>=', since)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async countInstances(): Promise<number> {
    try {
      const row = (await this.db('servers')
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async countInstancesByStatus(status: string): Promise<number> {
    try {
      const row = (await this.db('servers')
        .where('status', status)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async countNodes(): Promise<number> {
    try {
      const row = (await this.db('nodes')
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async countNodesByStatus(status: string): Promise<number> {
    try {
      const row = (await this.db('nodes')
        .where('status', status)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  private async sumDiskUsageMb(): Promise<number> {
    try {
      const row = (await this.db('servers')
        .whereNotNull('disk_usage_bytes')
        .sum('disk_usage_bytes as total')
        .first()) as unknown as SumRow | undefined;
      const bytes = Number(row?.total ?? 0);
      return Math.floor(bytes / (1024 * 1024));
    } catch {
      return 0;
    }
  }

  private async getRevenueStats(): Promise<{ revenueToday: number; revenue30d: number }> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const todaySum = (await this.db('shop_orders')
        .where('status', 'claimed')
        .where('created_at', '>=', todayStart)
        .sum('total_price as total')
        .first()) as unknown as SumRow | undefined;
      const revenueToday = Number(todaySum?.total ?? 0);

      const sum30d = (await this.db('shop_orders')
        .where('status', 'claimed')
        .where('created_at', '>=', since30d)
        .sum('total_price as total')
        .first()) as unknown as SumRow | undefined;
      const revenue30d = Number(sum30d?.total ?? 0);

      return { revenueToday, revenue30d };
    } catch {
      return { revenueToday: 0, revenue30d: 0 };
    }
  }

  private async countAlerts24h(): Promise<number> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = (await this.db('alert_events')
        .where('triggered_at', '>=', since)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      // alert_events 表不存在时返回 0
      return 0;
    }
  }

  private async getTopDiskUsage(limit: number): Promise<PlatformDiskUsageItem[]> {
    try {
      const rows = await this.db<ServerDiskRow>('servers')
        .select('id', 'name', 'disk_usage_bytes', 'owner_user_id')
        .whereNotNull('disk_usage_bytes')
        .orderBy('disk_usage_bytes', 'desc')
        .limit(limit);

      if (rows.length === 0) return [];

      // 批量查 owner username（避免 N+1）
      const ownerIds = Array.from(new Set(rows.map((r) => r.owner_user_id)));
      const ownerRows = await this.db<{ id: string; username: string }>('users')
        .select('id', 'username')
        .whereIn('id', ownerIds);
      const ownerMap = new Map(ownerRows.map((o) => [o.id, o.username]));

      return rows.map((r) => ({
        instance_id: r.id,
        name: r.name,
        used_mb: r.disk_usage_bytes ? Math.floor(r.disk_usage_bytes / (1024 * 1024)) : 0,
        owner: ownerMap.get(r.owner_user_id) ?? '',
      }));
    } catch {
      return [];
    }
  }

  private async getInstanceStatusDistribution(): Promise<PlatformInstanceStatusDistribution> {
    try {
      const rows = (await this.db('servers')
        .select('status')
        .count('* as cnt')
        .groupBy('status')) as unknown as Array<{ status: string; cnt: number }>;
      const distribution: PlatformInstanceStatusDistribution = {
        running: 0,
        stopped: 0,
        error: 0,
      };
      for (const row of rows) {
        if (row.status === 'running') {
          distribution.running = Number(row.cnt) || 0;
        } else if (row.status === 'stopped') {
          distribution.stopped = Number(row.cnt) || 0;
        } else if (row.status === 'error') {
          distribution.error = Number(row.cnt) || 0;
        }
        // 其他状态（starting/stopping）不计入三项分布
      }
      return distribution;
    } catch {
      return { running: 0, stopped: 0, error: 0 };
    }
  }
}

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

/**
 * 创建全平台统计路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createPlatformStatsRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const service = new PlatformStatsService(db);

  // ----------------------------------------------------------------
  // GET /overview — 全平台总览
  // ----------------------------------------------------------------
  router.get('/overview', async (_req, res) => {
    try {
      const overview: PlatformOverview = await service.getOverview();
      res.json(overview);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /users?range=24h|30d — 用户活跃度曲线
  // ----------------------------------------------------------------
  router.get('/users', async (req, res) => {
    try {
      const rawRange = req.query.range;
      const range: '24h' | '30d' = rawRange === '30d' ? '30d' : '24h';
      const response: PlatformUsersTrendResponse = await service.getUsersTrend(range);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /revenue?days=30 — 收入曲线
  // ----------------------------------------------------------------
  router.get('/revenue', async (req, res) => {
    try {
      const days = parseDaysParam(req.query.days);
      const response: PlatformRevenueTrendResponse = await service.getRevenueTrend(days);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /disk-usage-top?limit=10 — 磁盘占用 TopN 实例
  // ----------------------------------------------------------------
  router.get('/disk-usage-top', async (req, res) => {
    try {
      const limit = parseLimitParam(req.query.limit);
      const response: DiskUsageTopResponse = await service.getDiskUsageTop(limit);
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

/** 解析 days 查询参数：默认 30，范围 1-90 */
function parseDaysParam(raw: unknown): number {
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.min(n, 90));
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(Math.floor(raw), 90));
  }
  return 30;
}

/** 解析 limit 查询参数：默认 10，范围 1-100 */
function parseLimitParam(raw: unknown): number {
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.min(n, 100));
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(Math.floor(raw), 100));
  }
  return 10;
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'platform-stats router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
