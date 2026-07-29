// ============================================================================
// friends.ts — 好友系统路由（v4.8.0 L1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/friends
//
// 端点（任何已登录用户）：
//   POST   /request              — 发送好友请求（body: { friend_user_id }）
//   POST   /:friendUserId/accept — 接受好友请求
//   POST   /:friendUserId/reject — 拒绝好友请求
//   GET    /                     — 好友列表
//   GET    /pending              — 待处理请求列表
//   GET    /online               — 在线好友列表
//   DELETE /:friendUserId        — 删除好友
//   GET    /:friendUserId/status — 查询两人关系状态
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  FriendNotFoundError,
  FriendRequestAlreadyExistsError,
  FriendRequestSelfError,
  FriendUserNotFoundError,
  FriendService,
} from '../../services/friendService.js';
import type {
  FriendActionResponse,
  FriendListResponse,
  FriendStatusResponse,
  FriendStatusType,
  PanelErrorResponse,
  PendingFriendRequestsResponse,
  SendFriendRequestRequest,
} from '@public/schema/panel-api-types';

/**
 * 创建好友系统路由
 *
 * @param friendService 好友服务实例
 * @param logger 日志器
 */
export function createFriendsRouter(
  _db: Knex,
  friendService: FriendService,
  logger: Logger,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /request — 发送好友请求
  // ----------------------------------------------------------------
  router.post('/request', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const reqBody = req.body as Partial<SendFriendRequestRequest>;
      const friendUserId = reqBody.friend_user_id;
      if (typeof friendUserId !== 'string' || friendUserId.length === 0) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 friend_user_id' },
        };
        res.status(400).json(body);
        return;
      }

      try {
        await friendService.sendRequest(userId, friendUserId);
        const response: FriendActionResponse = { success: true };
        res.status(201).json(response);
      } catch (e) {
        handleFriendError(res, e);
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /:friendUserId/accept — 接受好友请求
  // ----------------------------------------------------------------
  router.post('/:friendUserId/accept', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friendUserId = req.params.friendUserId;

      try {
        await friendService.acceptRequest(userId, friendUserId);
        const response: FriendActionResponse = { success: true };
        res.json(response);
      } catch (e) {
        handleFriendError(res, e);
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /:friendUserId/reject — 拒绝好友请求
  // ----------------------------------------------------------------
  router.post('/:friendUserId/reject', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friendUserId = req.params.friendUserId;

      try {
        await friendService.rejectRequest(userId, friendUserId);
        const response: FriendActionResponse = { success: true };
        res.json(response);
      } catch (e) {
        handleFriendError(res, e);
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET / — 好友列表
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friends = await friendService.listFriends(userId);
      const response: FriendListResponse = { friends };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /pending — 待处理请求列表
  // ----------------------------------------------------------------
  router.get('/pending', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const requests = await friendService.listPendingRequests(userId);
      const response: PendingFriendRequestsResponse = { requests };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /online — 在线好友列表
  // ----------------------------------------------------------------
  router.get('/online', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friends = await friendService.listOnlineFriends(userId);
      const response: FriendListResponse = { friends };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /:friendUserId — 删除好友
  // ----------------------------------------------------------------
  router.delete('/:friendUserId', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friendUserId = req.params.friendUserId;

      const removed = await friendService.removeFriend(userId, friendUserId);
      if (!removed) {
        const body: PanelErrorResponse = {
          error: { code: 'FRIEND_NOT_FOUND', message: '好友关系不存在' },
        };
        res.status(404).json(body);
        return;
      }
      const response: FriendActionResponse = { success: true };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /:friendUserId/status — 查询两人关系状态
  // ----------------------------------------------------------------
  router.get('/:friendUserId/status', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const friendUserId = req.params.friendUserId;
      const status = await friendService.getFriendshipStatus(userId, friendUserId);
      const response: FriendStatusResponse = { status: status as FriendStatusType };
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

/** 将 friendService 抛出的领域错误映射为 HTTP 响应 */
function handleFriendError(res: Response, err: unknown): void {
  if (err instanceof FriendRequestSelfError) {
    res.status(400).json({
      error: { code: 'FRIEND_REQUEST_SELF', message: '不能添加自己为好友' },
    });
    return;
  }
  if (err instanceof FriendUserNotFoundError) {
    res.status(404).json({
      error: { code: 'FRIEND_USER_NOT_FOUND', message: '目标用户不存在' },
    });
    return;
  }
  if (err instanceof FriendRequestAlreadyExistsError) {
    res.status(409).json({
      error: { code: 'FRIEND_REQUEST_ALREADY_EXISTS', message: '好友请求已存在或已是好友' },
    });
    return;
  }
  if (err instanceof FriendNotFoundError) {
    res.status(404).json({
      error: { code: 'FRIEND_NOT_FOUND', message: '好友请求或好友关系不存在' },
    });
    return;
  }
  throw err;
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'friends router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
