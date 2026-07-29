// ============================================================================
// 模块7_Panel业务API — 钱包路由（经济系统）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 对应服务：注入的 WalletServiceImpl
//
// 挂载前缀：/api/servers（与 servers.ts 同前缀，路径不冲突）
//   GET  /:serverId/wallet               → 查询钱包信息（任意已登录用户）
//   POST /:serverId/wallet/claim-daily   → 领取每日点券（任意已登录用户）
//
// 设计：
// - 钱包按实例作用域（user_id + server_id 唯一），与 VIP 按实例绑定设计一致
// - 首次访问自动创建钱包（balance=0）
// - 每日领取判断基于 last_daily_claim_date（YYYY-MM-DD）
// - VIP 越高，每日领取金额越多（VIP0=100, VIP1=200, ..., VIP5=3200）
// ============================================================================

import { Router, type Response } from 'express';
import type { WalletServiceImpl } from '../../services/walletService.js';
import { AppError } from '../../services/errors.js';
import type {
  ClaimDailyRewardResponse,
  GetWalletResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  DAILY_REWARD_ALREADY_CLAIMED: 409,
  PANEL_FORBIDDEN: 403,
};

/**
 * 创建 Wallet 路由
 * @param walletService 钱包服务实例（按实例作用域的钱包余额 + 每日领取）
 */
export function createWalletRouter(walletService: WalletServiceImpl): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/wallet — 查询钱包信息
  //   返回：balance / total_earned / total_spent / can_claim_daily /
  //         daily_reward_amount / last_daily_claim_at / last_daily_claim_date
  //   首次访问自动创建钱包（balance=0）
  // ----------------------------------------------------------------
  router.get('/:serverId/wallet', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const userRole = req.user?.role ?? 'user';
      const wallet = await walletService.getWalletInfo(userId, req.params.serverId, userRole);
      const response: GetWalletResponse = { wallet };
      res.json(response);
    } catch (err) {
      handleWalletError(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/wallet/claim-daily — 领取每日点券
  //   规则：
  //   - 按 last_daily_claim_date 判断今日是否已领取
  //   - 已领取 → 409 DAILY_REWARD_ALREADY_CLAIMED
  //   - 领取金额 = VIP 阶梯固定金额（VIP0=100, VIP1=200, ..., VIP5=3200）
  //   - 领取后更新 balance（原子加） + total_earned + last_daily_claim_at/date
  // ----------------------------------------------------------------
  router.post('/:serverId/wallet/claim-daily', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const userRole = req.user?.role ?? 'user';
      const result = await walletService.claimDailyReward(userId, req.params.serverId, userRole);
      const response: ClaimDailyRewardResponse = {
        wallet: result.wallet,
        claimed_amount: result.claimed_amount,
      };
      res.json(response);
    } catch (err) {
      handleWalletError(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleWalletError(res: Response, err: unknown): void {
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
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
