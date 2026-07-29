// ============================================================================
// operationsService — 运营仪表盘聚合服务（v4.6.0）
//
// 用途：为 instance_admin / server_admin 提供跨实例运营视图，聚合：
//   - 实例总数 / 运行中实例数
//   - 在线玩家数 / 24h 活跃玩家数
//   - 今日 / 30 日收入、订单数、CDK 兑换数
//   - 备份健康度（每实例最近备份时间）
//   - 告警（F 阶段实现，当前返回空数组）
//   - 收入曲线（按天聚合）
//   - 玩家活跃度曲线（按天聚合）
//   - 实例对比表
//
// 实例过滤逻辑复用 servers.ts listServers 的 instance_admin 分支：
//   owner_user_id = userId OR instance_admins.user_id = userId
//
// 所有查询用 try-catch 保护，表不存在时返回安全默认值（0 / 空数组）。
// ============================================================================

import type { Knex } from 'knex';
import type {
  InstanceAdminOverviewResponse,
  OperationsRevenueResponse,
  OperationsPlayersResponse,
  OperationsInstancesCompareResponse,
  BackupHealthItem,
  RevenuePoint,
  PlayerActivityPoint,
  InstanceCompareRow,
} from '@public/schema/panel-api-types';
import type { InstanceState } from '@public/schema/daemon-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface ServerRow {
  id: string;
  name: string;
  status: string;
  disk_usage_bytes: number | null;
}

interface CountRow {
  cnt: number;
}

interface SumRow {
  total: number | null;
}

interface ShopOrderDailyRow {
  date: string;
  revenue: number;
  orders: number;
}

interface PlayerHistoryDailyRow {
  date: string;
  unique_players: number;
}

interface BackupRow {
  server_id: string;
  latest_backup: string | null;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 运营仪表盘聚合服务
 */
export class OperationsService {
  constructor(private readonly db: Knex) {}

  /**
   * 获取 instance_admin 跨实例总览
   * @param userId 用户 ID（instance_admin / server_admin）
   */
  async getOverview(userId: string): Promise<InstanceAdminOverviewResponse> {
    const instanceIds = await this.getUserInstanceIds(userId);

    const totalInstances = instanceIds.length;
    const runningInstances = await this.countRunningInstances(instanceIds);
    const totalPlayers24h = await this.countPlayers24h(instanceIds);
    const { revenueToday, revenue30d, ordersToday } = await this.getRevenueStats(instanceIds);
    const cdkRedeemsToday = await this.countCdkRedeemsToday(instanceIds);
    const backupHealth = await this.getBackupHealth(instanceIds);

    return {
      total_instances: totalInstances,
      running_instances: runningInstances,
      total_players_online: 0, // 实时查询需调 daemon，简化返回 0
      total_players_24h: totalPlayers24h,
      revenue_today: revenueToday,
      revenue_30d: revenue30d,
      orders_today: ordersToday,
      cdk_redeems_today: cdkRedeemsToday,
      backup_health: backupHealth,
      alerts: [], // F 阶段实现告警后填充
    };
  }

  /**
   * 获取收入曲线（按天聚合 shop_orders）
   * @param userId 用户 ID
   * @param days 天数（1-90）
   */
  async getRevenue(
    userId: string,
    days: number,
  ): Promise<OperationsRevenueResponse> {
    const instanceIds = await this.getUserInstanceIds(userId);
    if (instanceIds.length === 0) {
      return { points: [] };
    }
    const safeDays = Math.max(1, Math.min(days, 90));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      // 按天聚合已支付订单（status='claimed'）的收入与订单数
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
        .whereIn('server_id', instanceIds)
        .where('status', 'claimed')
        .where('created_at', '>=', since)
        .groupByRaw(dateExpr)
        .orderBy('date', 'asc')) as unknown as ShopOrderDailyRow[];
      const points: RevenuePoint[] = rows.map((r) => ({
        date: String(r.date),
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      }));
      return { points };
    } catch {
      return { points: [] };
    }
  }

  /**
   * 获取玩家活跃度曲线（按天聚合 player_histories）
   * @param userId 用户 ID
   * @param days 天数（1-90）
   */
  async getPlayers(
    userId: string,
    days: number,
  ): Promise<OperationsPlayersResponse> {
    const instanceIds = await this.getUserInstanceIds(userId);
    if (instanceIds.length === 0) {
      return { points: [] };
    }
    const safeDays = Math.max(1, Math.min(days, 90));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      // 按天聚合 distinct game_player_name（unique_players）；peak_online 实时查询较复杂，简化返回 0
      const dateExpr =
        this.db.client.dialect === 'sqlite'
          ? 'date(joined_at)'
          : 'DATE(joined_at)::text';
      const rows = (await this.db('player_histories')
        .select(
          this.db.raw(`${dateExpr} as date`),
          this.db.raw("COUNT(DISTINCT game_player_name) as unique_players"),
        )
        .whereIn('server_id', instanceIds)
        .where('joined_at', '>=', since)
        .groupByRaw(dateExpr)
        .orderBy('date', 'asc')) as unknown as PlayerHistoryDailyRow[];
      const points: PlayerActivityPoint[] = rows.map((r) => ({
        date: String(r.date),
        unique_players: Number(r.unique_players) || 0,
        peak_online: 0, // 简化：实时查询需调 daemon
      }));
      return { points };
    } catch {
      return { points: [] };
    }
  }

  /**
   * 获取实例对比表
   * @param userId 用户 ID
   */
  async getInstancesCompare(
    userId: string,
  ): Promise<OperationsInstancesCompareResponse> {
    const instanceIds = await this.getUserInstanceIds(userId);
    if (instanceIds.length === 0) {
      return { instances: [] };
    }
    try {
      const rows = await this.db<ServerRow>('servers')
        .select('id', 'name', 'status', 'disk_usage_bytes')
        .whereIn('id', instanceIds)
        .orderBy('name', 'asc');

      // 为每个实例查询 30 日收入
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const instances: InstanceCompareRow[] = [];
      for (const row of rows) {
        let revenue30d = 0;
        try {
          const sumRow = (await this.db('shop_orders')
            .where('server_id', row.id)
            .where('status', 'claimed')
            .where('created_at', '>=', since30d)
            .sum('total_price as total')
            .first()) as unknown as SumRow | undefined;
          revenue30d = Number(sumRow?.total ?? 0);
        } catch {
          // shop_orders 表不存在时收入为 0
        }
        const diskUsedMb = row.disk_usage_bytes
          ? Math.floor(row.disk_usage_bytes / (1024 * 1024))
          : 0;
        instances.push({
          instance_id: row.id,
          instance_name: row.name,
          status: row.status as InstanceState,
          online_players: 0, // 实时查询需调 daemon
          revenue_30d: revenue30d,
          disk_used_mb: diskUsedMb,
        });
      }
      return { instances };
    } catch {
      return { instances: [] };
    }
  }

  // -------------------------------------------------------------------------
  // 私有方法
  // -------------------------------------------------------------------------

  /**
   * 获取用户管辖的实例 ID 集合（owner + instance_admins 共管，去重）
   * 表不存在时返回空数组
   */
  private async getUserInstanceIds(userId: string): Promise<string[]> {
    const ids = new Set<string>();

    try {
      const ownedRows = await this.db<{ id: string }>('servers')
        .select('id')
        .where('owner_user_id', userId);
      for (const r of ownedRows) ids.add(r.id);
    } catch {
      // servers 表不存在时返回空
    }

    try {
      const adminRows = await this.db<{ instance_id: string }>('instance_admins')
        .select('instance_id')
        .where('user_id', userId);
      for (const r of adminRows) ids.add(r.instance_id);
    } catch {
      // instance_admins 表不存在时忽略
    }

    return Array.from(ids);
  }

  /** 统计运行中实例数 */
  private async countRunningInstances(instanceIds: string[]): Promise<number> {
    if (instanceIds.length === 0) return 0;
    try {
      const row = (await this.db('servers')
        .where('status', 'running')
        .whereIn('id', instanceIds)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  /** 统计近 24h 活跃玩家数（distinct game_player_name） */
  private async countPlayers24h(instanceIds: string[]): Promise<number> {
    if (instanceIds.length === 0) return 0;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = await this.db('player_histories')
        .where('joined_at', '>=', since)
        .whereIn('server_id', instanceIds)
        .countDistinct<{ cnt: number }[]>('game_player_name as cnt')
        .first();
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  /** 获取收入统计（今日 + 30 日收入 + 今日订单数） */
  private async getRevenueStats(
    instanceIds: string[],
  ): Promise<{ revenueToday: number; revenue30d: number; ordersToday: number }> {
    if (instanceIds.length === 0) {
      return { revenueToday: 0, revenue30d: 0, ordersToday: 0 };
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    try {
      // 今日已支付订单收入
      const todaySum = (await this.db('shop_orders')
        .where('server_id', 'in', instanceIds)
        .where('status', 'claimed')
        .where('created_at', '>=', todayStart)
        .sum('total_price as total')
        .first()) as unknown as SumRow | undefined;
      const revenueToday = Number(todaySum?.total ?? 0);

      // 30 日已支付订单收入
      const sum30d = (await this.db('shop_orders')
        .where('server_id', 'in', instanceIds)
        .where('status', 'claimed')
        .where('created_at', '>=', since30d)
        .sum('total_price as total')
        .first()) as unknown as SumRow | undefined;
      const revenue30d = Number(sum30d?.total ?? 0);

      // 今日订单数（不限 status）
      const todayCount = (await this.db('shop_orders')
        .where('server_id', 'in', instanceIds)
        .where('created_at', '>=', todayStart)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      const ordersToday = Number(todayCount?.cnt ?? 0);

      return { revenueToday, revenue30d, ordersToday };
    } catch {
      return { revenueToday: 0, revenue30d: 0, ordersToday: 0 };
    }
  }

  /** 统计今日 CDK 兑换数 */
  private async countCdkRedeemsToday(instanceIds: string[]): Promise<number> {
    if (instanceIds.length === 0) return 0;
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const row = (await this.db('cdk_codes')
        .where('server_id', 'in', instanceIds)
        .where('status', 'claimed')
        .where('claimed_at', '>=', todayStart)
        .count('* as cnt')
        .first()) as unknown as CountRow | undefined;
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  /** 获取每实例备份健康度（最近备份时间 + 状态判定） */
  private async getBackupHealth(instanceIds: string[]): Promise<BackupHealthItem[]> {
    if (instanceIds.length === 0) return [];
    try {
      // 查询每个实例的最近备份时间
      // backups 表可能不存在；status='completed' 的备份才算有效
      const now = Date.now();
      const healthyThreshold = 24 * 60 * 60 * 1000; // 24h

      // 先取实例基本信息
      const servers = await this.db<{ id: string; name: string }>('servers')
        .select('id', 'name')
        .whereIn('id', instanceIds);
      const serverMap = new Map(servers.map((s) => [s.id, s.name]));

      const result: BackupHealthItem[] = [];
      for (const instanceId of instanceIds) {
        let lastBackupAt: string | null = null;
        try {
          const row = (await this.db('backups')
            .select('server_id', this.db.raw('MAX(created_at) as latest_backup'))
            .where('server_id', instanceId)
            .where('status', 'completed')
            .groupBy('server_id')
            .first()) as unknown as BackupRow | undefined;
          lastBackupAt = row?.latest_backup ?? null;
        } catch {
          // backups 表不存在时 lastBackupAt 保持 null
        }

        let status: 'healthy' | 'stale' | 'never' = 'never';
        if (lastBackupAt) {
          const ts = Date.parse(lastBackupAt);
          if (Number.isFinite(ts) && now - ts <= healthyThreshold) {
            status = 'healthy';
          } else {
            status = 'stale';
          }
        }

        result.push({
          instance_id: instanceId,
          instance_name: serverMap.get(instanceId) ?? '',
          last_backup_at: lastBackupAt,
          status,
        });
      }
      return result;
    } catch {
      return [];
    }
  }
}
