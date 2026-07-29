// ============================================================================
// rateLimiter — v3.9.0-S2 速率限制中间件模块
//
// 说明：
//   - v3.8.0 已在 index.ts 内联实现 createLoginRateLimiter / createGlobalRateLimiter
//   - v3.9.0-S2 抽离至独立模块 + 新增 createCdkRedeemLimiter（10 次/小时，按 IP + 用户 ID）
//   - 后续版本若需引入 Redis 等外部存储，仅需替换 hits Map 实现
//
// 实现策略：
//   - 内存 Map 存储（适合单实例部署）
//   - 进程重启后重置（可接受——429 仅是兜底防御，不依赖持久化）
//   - 定期清理过期条目防止内存无限增长（interval.unref 避免阻塞退出）
// ============================================================================

import express from 'express';

/** 滑动窗口计数器：Map<key, timestamps[]> */
type HitMap = Map<string, number[]>;

/**
 * 通用滑动窗口限流器工厂。
 * @param windowMs 窗口大小（毫秒）
 * @param maxRequests 窗口内最大请求数
 * @param keyFn 从请求中提取限流键（默认按 IP）
 * @param cleanupIntervalMs 清理间隔（默认 5 分钟）
 * @param code 错误码（默认 PANEL_RATE_LIMITED）
 * @param message 错误消息
 */
function createSlidingWindowLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: express.Request) => string;
  cleanupIntervalMs?: number;
  code?: string;
  message: string;
}): express.RequestHandler {
  const {
    windowMs,
    maxRequests,
    keyFn = (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown',
    cleanupIntervalMs = 5 * 60 * 1000,
    code = 'PANEL_RATE_LIMITED',
    message,
  } = options;

  const hits: HitMap = new Map();

  // 定期清理过期条目
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits.entries()) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      res.status(429).json({
        error: {
          code,
          message,
        },
      });
      return;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

/**
 * 登录速率限制：每 IP 每 15 分钟最多 10 次（v3.8.0 引入，v3.9.0 抽离）
 */
export function createLoginRateLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    message: '登录尝试过于频繁，请稍后再试',
  });
}

/**
 * 全局 API 速率限制：每 IP 每秒最多 50 次（v3.8.0 引入，v3.9.0 抽离）
 */
export function createGlobalRateLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 1000,
    maxRequests: 50,
    cleanupIntervalMs: 10 * 1000,
    message: '请求过于频繁，请稍后再试',
  });
}

/**
 * CDK 兑换速率限制：每用户每小时最多 10 次（v3.9.0-S2 新增）
 * - 未登录用户按 IP 限流
 * - 登录用户按 user_id 限流（避免暴力枚举 CDK）
 * - 实际 key 格式：`user:<uuid>` 或 `ip:<ip>`
 */
export function createCdkRedeemLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 60 * 60 * 1000, // 1 小时
    maxRequests: 10,
    keyFn: (req) => {
      const userId = (req as express.Request & { user?: { id?: string } }).user?.id;
      return userId ? `user:${userId}` : `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    },
    message: 'CDK 兑换次数过多，请稍后再试',
  });
}

/**
 * CDK 兑换频率限制：每用户每小时最多 20 次（v5 用户中心经济系统配套）
 * - 按 userId+IP 复合键限流（未登录时 userId 回退 'anon'）
 * - 应用于 POST /api/cdk/redeem 全局兑换端点
 * - 实际 key 格式：`cdkredeem:<userId|anon>:<ip>`
 */
export function createCdkRedeemRateLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 60 * 60 * 1000, // 1 小时
    maxRequests: 20,
    keyFn: (req) => {
      const userId = (req as express.Request & { user?: { userId?: string } }).user?.userId ?? 'anon';
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      return `cdkredeem:${userId}:${ip}`;
    },
    message: '兑换过于频繁，请稍后再试',
  });
}

/**
 * 密码找回请求速率限制：每 IP 每小时最多 5 次（v3.9.0-S4 配套）
 * - 防止邮件轰炸（攻击者反复触发发送邮件）
 */
export function createPasswordResetLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
    message: '密码找回请求过于频繁，请稍后再试',
  });
}

/**
 * 邮箱验证重发速率限制：每用户每小时最多 3 次（v3.9.0-S5 配套）
 */
export function createEmailVerifyLimiter(): express.RequestHandler {
  return createSlidingWindowLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 3,
    keyFn: (req) => {
      const userId = (req as express.Request & { user?: { id?: string } }).user?.id;
      return userId ? `user:${userId}` : `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    },
    message: '验证邮件重发过于频繁，请稍后再试',
  });
}
