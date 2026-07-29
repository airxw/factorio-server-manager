// ============================================================================
// 模块2_Daemon后端骨架 — 双重鉴权模块
// 依据：daemon/AGENTS.md §模块专属约束 2/3/4
//
// L2-2 扩展：支持双 token 鉴权
//   - master 模式：仅校验 DAEMON_TOKEN 环境变量
//   - slave 模式：除 DAEMON_TOKEN 外，还接受 master 颁发的 commsKey
//     （master 调用 slave daemon 时用 commsKey 作为 Bearer token）
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Logger } from 'pino';

/**
 * 可选的 commsKey 提供函数（slave 模式下由 SlaveModeClient 注入）。
 * - master 模式：不注入（undefined），仅 DAEMON_TOKEN 鉴权
 * - slave 模式：注入 () => commsKey，同时接受 DAEMON_TOKEN 和 commsKey
 */
let commsKeyProvider: (() => string | null) | null = null;

/**
 * 注入 commsKey 提供函数（slave 模式启动时调用）。
 * 传 null 取消注入（恢复为仅 DAEMON_TOKEN 鉴权）。
 */
export function setCommsKeyProvider(provider: (() => string | null) | null): void {
  commsKeyProvider = provider;
}

/**
 * 从环境变量读取 DAEMON_TOKEN
 *
 * L2-2：slave 模式下 DAEMON_TOKEN 可选（用 commsKey 替代）。
 * 但本函数仍按原有契约在 master 模式下抛错——master 模式启动时 index.ts
 * 会先检查；slave 模式下 index.ts 不会调用本函数。
 */
export function getDaemonToken(): string {
  const token = process.env.DAEMON_TOKEN;
  if (!token) {
    throw new Error('DAEMON_TOKEN environment variable is not set');
  }
  return token;
}

/**
 * 校验 token 是否有效（双路径）。
 * - master 模式：仅 DAEMON_TOKEN
 * - slave 模式：DAEMON_TOKEN 或 commsKey 任一匹配即可
 */
function isValidToken(token: string): boolean {
  // 路径 1: DAEMON_TOKEN（若环境变量未设则跳过此路径）
  const daemonToken = process.env.DAEMON_TOKEN;
  if (daemonToken && token === daemonToken) {
    return true;
  }
  // 路径 2: commsKey（slave 模式下由 SlaveModeClient 提供）
  if (commsKeyProvider) {
    const commsKey = commsKeyProvider();
    if (commsKey && token === commsKey) {
      return true;
    }
  }
  return false;
}

/**
 * REST Bearer Token 鉴权中间件
 * - 无 Authorization 头 → 401 { error: "missing_authorization" }
 * - token 不匹配 → 403 { error: "invalid_token" }
 *
 * 错误码与 PoC 一致（poc/panel-daemon/daemon.ts:42-53）
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_authorization' });
    return;
  }
  const token = auth.slice('Bearer '.length);
  if (!isValidToken(token)) {
    res.status(403).json({ error: 'invalid_token' });
    return;
  }
  next();
}

/**
 * WS query token 鉴权
 * - 从 URL query 提取 token 参数：ws://host:8080/ws?token=<token>
 * - token 不匹配 → ws.close(4001, "invalid_token")
 *
 * 关键时序（PoC 验证）：
 *   ws 库的 connection 事件触发时连接已 open，server 端调用 ws.close(4001)
 *   后，client 端会先收到 open 事件，再收到 close 事件。
 *   因此 server 端调用 close 后必须立即 return，不再注册任何 message/close
 *   监听器；client 端测试需等 close 事件确认鉴权拒绝，不能仅凭 open 判定成功。
 *
 * @returns true=鉴权通过；false=鉴权失败（已调用 ws.close，调用方必须 return）
 */
export function handleWsAuth(
  ws: WebSocket,
  req: IncomingMessage,
  logger?: Logger,
): boolean {
  const url = new URL(req.url || '', 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token || !isValidToken(token)) {
    logger?.warn({ hasToken: !!token }, 'WS connection rejected: invalid token');
    // 鉴权拒绝：关闭连接，code=4001（与 PoC 一致）
    ws.close(4001, 'invalid_token');
    return false;
  }

  logger?.info('WS connection authorized');
  return true;
}
