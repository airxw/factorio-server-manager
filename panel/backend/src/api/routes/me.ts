// ============================================================================
// me.ts — 我的资产聚合路由（v4.5.0）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/me
//
// 端点：
//   GET /assets — 返回当前登录用户的全维度资产数据（MyAssetsResponse）
//                 聚合：用户信息 + 钱包余额 + VIP 等级 + 实例列表
//                       + 最近订单 + 最近 CDK 兑换 + 未读通知数
//
// 权限：任何已登录用户均可查询自己的资产（auth.ts 已保证 req.user 有效）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { MyAssetsService } from '../../services/myAssetsService.js';
import type {
  MyAssetsResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建我的资产聚合路由
 *
 * @param db Knex 实例
 * @param logger 日志器
 */
export function createMeRouter(db: Knex, logger: Logger): Router {
  const router = Router();
  const myAssetsService = new MyAssetsService(db);

  // ----------------------------------------------------------------
  // GET /assets — 返回当前登录用户的全维度资产数据
  // ----------------------------------------------------------------
  router.get('/assets', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const assets: MyAssetsResponse = await myAssetsService.getMyAssets(user.userId);
      res.json(assets);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'me router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
