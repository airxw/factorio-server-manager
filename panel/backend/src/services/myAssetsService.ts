// ============================================================================
// myAssetsService — 我的资产聚合服务（v4.5.0）
//
// 用途：聚合用户个人中心所需的全维度数据，一次 API 调用返回：
//   - 用户基本信息（users 表）
//   - 钱包余额（user_wallets 表，跨实例汇总，若不存在则 balance=0）
//   - VIP 等级（users.vip_level 字段，若不存在则 level=0）
//   - 用户的实例列表（owner_user_id = userId OR bindings 表 account/instance/verified 绑定）
//   - 最近 10 笔订单（shop_orders 表 JOIN servers，若表不存在返回空数组）
//   - 最近 10 笔 CDK 兑换（cdk_codes 表 JOIN servers，通过 bindings 表 player/game_type 匹配用户）
//   - 未读通知数（user_notifications 表 count where is_read=0）
//
// 所有查询用 try-catch 保护，表不存在时返回默认值。
// ============================================================================

import type { Knex } from 'knex';
import type {
  MyAssetsResponse,
  MyAssetsInstance,
  MyAssetsOrderSummary,
  CdkRedeemSummary,
  UserInfo,
} from '@public/schema/panel-api-types';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { toContractUserRole, Role } from '../core/auth/roles.js';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  vip_level?: number;
  created_at: string;
}

interface UserWalletRow {
  balance: number;
  last_daily_claim_at: string | null;
}

interface ServerRow {
  id: string;
  name: string;
  status: string;
  owner_user_id: string;
}

interface ShopOrderJoinRow {
  id: number;
  server_id: string;
  instance_name: string;
  item_name: string | null;
  total_price: number;
  status: string;
  created_at: string;
}

interface CdkCodeJoinRow {
  id: number;
  server_id: string;
  instance_name: string;
  code: string;
  item_name: string;
  claimed_at: string | null;
}

interface PlayerBindingRow {
  player_name: string | null;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

/**
 * 我的资产聚合服务
 */
export class MyAssetsService {
  constructor(private readonly db: Knex) {}

  /**
   * 获取用户的全维度资产数据
   * @param userId 用户 ID
   * @returns MyAssetsResponse
   */
  async getMyAssets(userId: string): Promise<MyAssetsResponse> {
    // 1. 用户信息 + VIP 等级
    const { user, vipLevel } = await this.getUserInfo(userId);

    // 2. 钱包余额（跨实例汇总）
    const wallet = await this.getWalletSummary(userId);

    // 3. 用户的实例列表
    const instances = await this.getUserInstances(userId);

    // 4. 最近 10 笔订单
    const recentOrders = await this.getRecentOrders(userId);

    // 5. 最近 10 笔 CDK 兑换
    const recentCdkRedeems = await this.getRecentCdkRedeems(userId);

    // 6. 未读通知数
    const unreadNotifications = await this.getUnreadNotificationCount(userId);

    return {
      user,
      wallet,
      vip: { level: vipLevel, exp: 0 },
      instances,
      recent_orders: recentOrders,
      recent_cdk_redeems: recentCdkRedeems,
      unread_notifications: unreadNotifications,
    };
  }

  // -------------------------------------------------------------------------
  // 私有方法：各维度数据查询
  // -------------------------------------------------------------------------

  /** 用户信息 + VIP 等级 */
  private async getUserInfo(
    userId: string,
  ): Promise<{ user: UserInfo; vipLevel: number }> {
    try {
      // v4.19.2: users.role 列已 DROP，改用 active_role
      const row = await this.db<UserRow>('users')
        .select('id', 'email', 'username', 'active_role', 'status', 'created_at', 'vip_level')
        .where('id', userId)
        .first();
      if (!row) {
        // 用户不存在时返回空壳（不应发生，由 authenticateToken 保证）
        return {
          user: {
            id: userId,
            email: '',
            username: '',
            role: 'user',
            status: 'active',
            created_at: new Date().toISOString(),
          },
          vipLevel: 0,
        };
      }
      const userInfo: UserInfo = {
        id: row.id,
        email: row.email,
        username: row.username,
        role: toContractUserRole((row.active_role ?? Role.USER) as Role),
        status: row.status as 'active' | 'disabled' | 'deleted',
        created_at: row.created_at,
      };
      return {
        user: userInfo,
        vipLevel: typeof row.vip_level === 'number' ? row.vip_level : 0,
      };
    } catch {
      // vip_level 列不存在时降级查询
      try {
        const row = await this.db<UserRow>('users')
          .select('id', 'email', 'username', 'active_role', 'status', 'created_at')
          .where('id', userId)
          .first();
        if (!row) {
          return {
            user: {
              id: userId,
              email: '',
              username: '',
              role: 'user',
              status: 'active',
              created_at: new Date().toISOString(),
            },
            vipLevel: 0,
          };
        }
        return {
          user: {
            id: row.id,
            email: row.email,
            username: row.username,
            role: toContractUserRole((row.active_role ?? Role.USER) as Role),
            status: row.status as 'active' | 'disabled' | 'deleted',
            created_at: row.created_at,
          },
          vipLevel: 0,
        };
      } catch {
        return {
          user: {
            id: userId,
            email: '',
            username: '',
            role: 'user',
            status: 'active',
            created_at: new Date().toISOString(),
          },
          vipLevel: 0,
        };
      }
    }
  }

  /** 钱包余额（跨实例汇总，user_wallets 表不存在则 balance=0） */
  private async getWalletSummary(
    userId: string,
  ): Promise<{ balance: number; last_daily_claim: string | null }> {
    try {
      const rows = await this.db<UserWalletRow>('user_wallets')
        .select('balance', 'last_daily_claim_at')
        .where('user_id', userId);
      if (rows.length === 0) {
        return { balance: 0, last_daily_claim: null };
      }
      const totalBalance = rows.reduce((sum, r) => sum + (r.balance ?? 0), 0);
      // 取最近一次领取时间
      const lastClaim = rows
        .map((r) => r.last_daily_claim_at)
        .filter((v): v is string => v !== null)
        .sort()
        .pop() ?? null;
      return { balance: totalBalance, last_daily_claim: lastClaim };
    } catch {
      // user_wallets 表不存在时返回默认值
      return { balance: 0, last_daily_claim: null };
    }
  }

  /** 用户的实例列表（owner_user_id = userId OR bindings 表 account/instance/verified 绑定） */
  private async getUserInstances(userId: string): Promise<MyAssetsInstance[]> {
    try {
      // 先查 owner 的实例
      const ownedRows = await this.db<ServerRow>('servers')
        .select('id', 'name', 'status', 'owner_user_id')
        .where('owner_user_id', userId);

      let instances: MyAssetsInstance[] = ownedRows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status as InstanceState,
        online_players: 0, // 无缓存字段，默认 0
      }));

      // 再查 bindings 表中 account/instance/verified 绑定的实例（统一表必然存在）
      const boundRows = await this.db<ServerRow & { uib_user_id: string }>(
        'servers',
      )
        .select('servers.id', 'servers.name', 'servers.status', 'servers.owner_user_id')
        .leftJoin('bindings as uib', (builder) =>
          builder
            .on('servers.id', 'uib.scope_ref')
            .andOnVal('uib.binding_type', 'account')
            .andOnVal('uib.scope_type', 'instance')
            .andOnVal('uib.verify_status', 'verified'),
        )
        .where('uib.user_id', userId)
        .whereNot('servers.owner_user_id', userId); // 排除已作为 owner 查到的
      const boundInstances: MyAssetsInstance[] = boundRows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status as InstanceState,
        online_players: 0,
      }));
      instances = [...instances, ...boundInstances];

      return instances;
    } catch {
      return [];
    }
  }

  /** 最近 10 笔订单（shop_orders 表 JOIN servers） */
  private async getRecentOrders(userId: string): Promise<MyAssetsOrderSummary[]> {
    try {
      const rows = await this.db<ShopOrderJoinRow>('shop_orders')
        .select(
          'shop_orders.id',
          'shop_orders.server_id',
          'servers.name as instance_name',
          'shop_orders.total_price',
          'shop_orders.status',
          'shop_orders.created_at',
        )
        .leftJoin('servers', 'shop_orders.server_id', 'servers.id')
        .where('shop_orders.user_id', userId)
        .orderBy('shop_orders.created_at', 'desc')
        .limit(10);

      // 取每个订单的第一件物品名作为 item_name
      const result: MyAssetsOrderSummary[] = [];
      for (const row of rows) {
        let itemName = '';
        try {
          const itemRow = await this.db<{ item_name: string }>('shop_order_items')
            .select('item_name')
            .where('order_id', row.id)
            .orderBy('id', 'asc')
            .first();
          itemName = itemRow?.item_name ?? '';
        } catch {
          // shop_order_items 表不存在时 item_name 为空
        }
        result.push({
          id: String(row.id),
          instance_id: row.server_id,
          instance_name: row.instance_name ?? '',
          item_name: itemName,
          price: row.total_price,
          status: row.status,
          created_at: row.created_at,
        });
      }
      return result;
    } catch {
      // shop_orders 表不存在时返回空数组
      return [];
    }
  }

  /** 最近 10 笔 CDK 兑换（cdk_codes 表 JOIN servers，通过 bindings 表 player/instance 匹配用户） */
  private async getRecentCdkRedeems(userId: string): Promise<CdkRedeemSummary[]> {
    try {
      // 1. 获取用户的游戏玩家名（bindings 表 player/instance/verified）
      // v4.27.0: scope_type 由 'game_type' 改为 'instance'（实例级玩家绑定）
      let gamePlayerNames: string[] = [];
      try {
        const bindingRows = await this.db<PlayerBindingRow>('bindings')
          .select('player_name')
          .where('user_id', userId)
          .where('binding_type', 'player')
          .where('scope_type', 'instance')
          .where('verify_status', 'verified');
        gamePlayerNames = bindingRows
          .map((r) => r.player_name)
          .filter((name): name is string => name !== null && name !== '');
      } catch {
        // bindings 表查询失败时返回空数组
        return [];
      }
      if (gamePlayerNames.length === 0) {
        return [];
      }

      // 2. 查询已兑换的 CDK 码
      const rows = await this.db<CdkCodeJoinRow>('cdk_codes')
        .select(
          'cdk_codes.id',
          'cdk_codes.server_id',
          'servers.name as instance_name',
          'cdk_codes.code',
          'cdk_codes.item_name',
          'cdk_codes.claimed_at',
        )
        .leftJoin('servers', 'cdk_codes.server_id', 'servers.id')
        .where('cdk_codes.status', 'claimed')
        .whereIn('cdk_codes.claimed_player', gamePlayerNames)
        .orderBy('cdk_codes.claimed_at', 'desc')
        .limit(10);

      return rows.map((r) => ({
        id: String(r.id),
        instance_id: r.server_id,
        instance_name: r.instance_name ?? '',
        cdk_code: r.code,
        reward: r.item_name ?? '',
        redeemed_at: r.claimed_at ?? r.claimed_at ?? '',
      }));
    } catch {
      // cdk_codes 表不存在时返回空数组
      return [];
    }
  }

  /** 未读通知数（user_notifications 表 count where is_read=0） */
  private async getUnreadNotificationCount(userId: string): Promise<number> {
    try {
      const row = await this.db('user_notifications')
        .where('user_id', userId)
        .where('is_read', 0)
        .count<{ cnt: number }[]>('* as cnt')
        .first();
      return Number(row?.cnt ?? 0);
    } catch {
      // user_notifications 表不存在时返回 0
      return 0;
    }
  }
}
