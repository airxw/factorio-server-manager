// ============================================================================
// playerProfile.ts — 玩家档案路由（v4.8.0 L2）
//
// 挂载前缀：/api/players（不在 index.ts 挂载时套 authenticateToken，路由内手动解析可选 JWT）
//
// 端点：
//   GET /:userId/profile — 公开档案
//     - 公开信息：user（id/username/vip_level/created_at/avatar）+ bound_instances（公开实例）
//     - 登录后附加：mutual_instances（两人共同参与的公开实例）+ friend_status
//     - recent_activity：预留，当前返回空数组
//
// 可选认证：路由内手动解析 Authorization: Bearer <token>，解析失败/无 token 时按未登录处理
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { extractBearerToken, verifyToken, type JwtPayload } from '../../core/auth/jwt.js';
import type {
  PanelErrorResponse,
  PlayerProfileInstance,
  PlayerProfileResponse,
  PlayerProfileUser,
  FriendStatusType,
} from '@public/schema/panel-api-types';

// ---------------------------------------------------------------------------
// DB 行类型
// ---------------------------------------------------------------------------

interface UserProfileDbRow {
  id: string;
  username: string;
  vip_level: number;
  created_at: string;
  display_name: string | null;
}

interface InstanceBriefRow {
  id: string;
  name: string;
  status: string;
}

// ---------------------------------------------------------------------------
// 路由工厂
// ---------------------------------------------------------------------------

/**
 * 创建玩家档案路由（挂载 /api/players，可选认证）
 *
 * @param db Knex 实例
 * @param logger 日志器
 * @param jwtSecret JWT 密钥（用于可选认证解析）
 */
export function createPlayerProfileRouter(
  db: Knex,
  logger: Logger,
  jwtSecret: string,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /:userId/profile — 公开档案
  // ----------------------------------------------------------------
  router.get('/:userId/profile', async (req, res) => {
    try {
      const profileUserId = req.params.userId;

      // 可选认证：解析 JWT（失败/无 token 时按未登录处理）
      const caller = parseOptionalCaller(req.headers.authorization, jwtSecret);

      // 1. 查询档案用户
      const userRow = await db<UserProfileDbRow>('users')
        .select('id', 'username', 'vip_level', 'created_at', 'display_name')
        .where('id', profileUserId)
        .first();
      if (!userRow) {
        const body: PanelErrorResponse = {
          error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
        };
        res.status(404).json(body);
        return;
      }

      const user: PlayerProfileUser = {
        id: userRow.id,
        username: userRow.username,
        vip_level: userRow.vip_level,
        created_at: userRow.created_at,
        avatar: userRow.display_name,
      };

      // 2. bound_instances：该用户 owner 或 instance_admins 关联的公开实例
      const boundInstances = await listBoundPublicInstances(db, profileUserId);

      const response: PlayerProfileResponse = {
        user,
        bound_instances: boundInstances,
        recent_activity: [],
      };

      // 3. 登录后附加 mutual_instances + friend_status
      if (caller) {
        const callerBound = await listBoundPublicInstances(db, caller.userId);
        response.mutual_instances = intersectInstances(boundInstances, callerBound);
        response.friend_status = await getFriendStatus(db, caller.userId, profileUserId);
      }

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

/** 解析可选 JWT，返回 caller payload；无 token 或解析失败返回 null */
function parseOptionalCaller(
  authHeader: string | undefined,
  secret: string,
): JwtPayload | null {
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  try {
    return verifyToken(token, secret);
  } catch {
    return null;
  }
}

/**
 * 列出用户关联的公开实例（owner 或 instance_admins，is_public=1）
 */
async function listBoundPublicInstances(
  db: Knex,
  userId: string,
): Promise<PlayerProfileInstance[]> {
  // owner 的公开实例
  const ownedRows = await db<InstanceBriefRow>('servers')
    .select('id', 'name', 'status')
    .where('owner_user_id', userId)
    .where('is_public', 1)
    .whereNotIn('status', ['deleted', 'removing']);

  // instance_admins 共管的公开实例
  let adminRows: InstanceBriefRow[] = [];
  try {
    adminRows = await db<InstanceBriefRow>('servers as s')
      .select('s.id', 's.name', 's.status')
      .join('instance_admins as ia', 's.id', 'ia.instance_id')
      .where('ia.user_id', userId)
      .where('s.is_public', 1)
      .whereNotIn('s.status', ['deleted', 'removing']);
  } catch {
    // instance_admins 表不存在时降级为空
  }

  // 合并去重（owner 与 instance_admins 理论上不重叠，去重兜底）
  const map = new Map<string, PlayerProfileInstance>();
  for (const r of [...ownedRows, ...adminRows]) {
    if (!map.has(r.id)) {
      map.set(r.id, { id: r.id, name: r.name, status: r.status });
    }
  }
  return Array.from(map.values());
}

/** 取两个实例列表的交集（按 id） */
function intersectInstances(
  a: PlayerProfileInstance[],
  b: PlayerProfileInstance[],
): PlayerProfileInstance[] {
  const idsB = new Set(b.map((i) => i.id));
  return a.filter((i) => idsB.has(i.id));
}

/** 查询两人之间的关系状态（直接查 friendships 表） */
async function getFriendStatus(
  db: Knex,
  userId: string,
  otherUserId: string,
): Promise<FriendStatusType> {
  if (userId === otherUserId) return 'accepted';
  try {
    const row = await db<{ status: string }>('friendships')
      .where(function () {
        this.where(function () {
          this.where('user_id', userId).andWhere('friend_user_id', otherUserId);
        });
        this.orWhere(function () {
          this.where('user_id', otherUserId).andWhere('friend_user_id', userId);
        });
      })
      .first();
    if (!row) return 'none';
    return row.status as FriendStatusType;
  } catch {
    return 'none';
  }
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'playerProfile router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
