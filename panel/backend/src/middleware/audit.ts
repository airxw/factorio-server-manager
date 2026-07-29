// ============================================================================
// 审计日志中间件 (v3.9.0-S10)
//
// 职责：
//   - 自动记录 mutating 请求（POST/PUT/PATCH/DELETE）到 audit_logs 表
//   - 仅记录已认证用户的请求（req.user 存在）
//   - 排除登录/注册/密码找回/邮箱验证等公开端点（避免登录前无 user）
//   - 在响应完成后异步写入，不阻塞请求；写入失败仅记录日志不抛出
//
// 设计要点：
//   - 通过 res.on('finish') 在响应结束后触发记录，确保 status code 可读
//   - target_type 由路径推断（如 /api/servers → server，/api/users → user）
//   - target_id 优先取路径参数（如 /api/servers/:id → id），无则 null
//   - details 包含 method / path / statusCode / userAgent，便于追溯
//   - 高频只读路径（GET）不记录，避免日志爆炸
//
// 与既有 auditLogService 关系：
//   - 各业务路由内部已通过 auditLogService.create 显式记录关键业务事件
//     （如 创建/删除实例、修改 VIP 权限等），那些记录带有更丰富的业务上下文
//   - 本中间件作为「兜底层」捕获所有 mutating 请求，避免遗漏
//   - 重复记录可接受（同一动作两条日志，业务层 + 兜底层）
// ============================================================================
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';

/** 不记录审计日志的路径前缀（公开端点 + 健康检查 + 静态资源） */
const AUDIT_EXCLUDE_PREFIXES: readonly string[] = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password-reset',
  '/api/auth/email-verify',
  '/api/legal',
  '/api/settings/site-info',
  '/api/init',
];

/** 需要记录审计的 HTTP 方法（mutating only） */
const AUDITED_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** 从路径推断 target_type */
function inferTargetType(path: string): string | null {
  // /api/servers/:id → server
  if (path.startsWith('/api/servers')) return 'server';
  if (path.startsWith('/api/users')) return 'user';
  if (path.startsWith('/api/packs')) return 'pack';
  if (path.startsWith('/api/nodes')) return 'node';
  if (path.startsWith('/api/settings')) return 'setting';
  if (path.startsWith('/api/system-config')) return 'system_config';
  if (path.startsWith('/api/audit-logs')) return 'audit_log';
  if (path.startsWith('/api/webhooks')) return 'webhook';
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/api/vip-permissions')) return 'vip_permission';
  if (path.startsWith('/api/player-bindings')) return 'player_binding';
  if (path.startsWith('/api/verify-codes')) return 'verify_code';
  if (path.startsWith('/api/notifications')) return 'notification';
  if (path.startsWith('/api/auth')) return 'auth';
  return null;
}

/** 从路径提取 target_id（取第一个路径段后的 UUID/数字） */
function inferTargetId(path: string): string | null {
  // 匹配 /api/<resource>/<id> 或 /api/<resource>/<id>/<sub>
  // id 形如 UUID 或 数字
  const match = path.match(/^\/api\/[^/]+\/([a-f0-9-]{8,}|[0-9]+)/i);
  return match ? match[1] : null;
}

/** 从 /api/servers/:serverId/... 提取 server_id */
function inferServerId(path: string): string | null {
  const match = path.match(/^\/api\/servers\/([a-f0-9-]{8,})/i);
  return match ? match[1] : null;
}

function isExcluded(path: string): boolean {
  for (const prefix of AUDIT_EXCLUDE_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * 创建审计中间件
 *
//  @param db Knex 实例（注入 audit_logs 表）
//  @param logger pino logger（写入失败时记录）
 */
export function createAuditMiddleware(db: Knex, logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 仅记录 mutating 方法
    if (!AUDITED_METHODS.includes(req.method.toUpperCase())) {
      next();
      return;
    }
    // 排除公开端点
    if (isExcluded(req.path)) {
      next();
      return;
    }

    // 响应结束后异步写入审计日志
    res.on('finish', () => {
      // 异步执行，不 await
      void (async () => {
        try {
          // 仅记录已认证用户的请求；未认证（req.user 缺失）跳过
          const userId = req.user?.userId;
          if (!userId) return;

          const targetType = inferTargetType(req.path);
          const targetId = inferTargetId(req.path);
          const serverId = inferServerId(req.path);
          const ip =
            (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
            req.ip ||
            null;

          await db('audit_logs').insert({
            server_id: serverId,
            user_id: userId,
            action: `${req.method.toUpperCase()} ${req.path}`,
            target_type: targetType,
            target_id: targetId,
            details_json: JSON.stringify({
              method: req.method.toUpperCase(),
              path: req.path,
              status_code: res.statusCode,
              user_agent: req.headers['user-agent']?.slice(0, 255) ?? null,
            }),
            ip_address: ip,
            created_at: new Date().toISOString(),
            retention_days: 90,
          });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), path: req.path },
            '[audit middleware] 审计日志写入失败（不阻塞请求）',
          );
        }
      })();
    });

    next();
  };
}
