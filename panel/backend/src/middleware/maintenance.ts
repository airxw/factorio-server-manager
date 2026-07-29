// ============================================================================
// 维护模式中间件 (v3.9.0-S8)
//
// 职责：
//   - 读取 `maintenance.enabled` 设置；为 true 时拒绝非管理员请求
//   - 公开接口白名单（login/register/password-reset/email-verify/legal/site-info/init/health）放行
//   - 管理员（server_admin/system_admin/admin）请求放行，允许登录后台关闭维护模式
//   - 其余请求返回 503 + MAINTENANCE_MODE 错误码，前端据此跳转 /maintenance 页面
//
// 设计要点：
//   - JWT 验证采用"尽力校验"策略——无 token / token 无效时视为非管理员，拒绝请求
//   - 设置读取失败时降级放行（避免设置服务故障导致全站 503）
//   - 中间件挂载顺序：helmet → cors → json → 请求日志 → 全局速率限制 → 维护模式 → 路由
// ============================================================================
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SettingSchemaService } from '../services/settingSchemaService.js';
import { extractBearerToken, verifyToken } from '../core/auth/jwt.js';

/**
 * 维护模式白名单路径前缀
 *
//    - /api/health: 健康检查（监控用）
//    - /api/auth/login: 管理员需登录后台关闭维护模式
//    - /api/auth/register: 注册入口（维护期间保持一致行为）
//    - /api/auth/password-reset: 密码找回
//    - /api/auth/email-verify: 邮箱验证（含 /status /request /confirm）
//    - /api/legal: 用户协议 / 隐私政策
//    - /api/settings/site-info: 站点信息（登录页展示）
//    - /api/init: 首启动向导
 */
const MAINTENANCE_WHITELIST: readonly string[] = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/password-reset',
  '/api/auth/email-verify',
  '/api/legal',
  '/api/settings/site-info',
  '/api/init',
];

function isWhitelisted(path: string): boolean {
  for (const prefix of MAINTENANCE_WHITELIST) {
    if (path === prefix || path.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * 判定请求者是否为管理员（server_admin/system_admin/admin）
 *
//  尽力校验：无 token / token 无效 / DB 异常时一律返回 false（保守拒绝）
 */
async function isAdminRequest(req: Request, jwtSecret: string): Promise<boolean> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return false;
  let payload;
  try {
    payload = verifyToken(token, jwtSecret);
  } catch {
    return false;
  }
  const normalizedRole = (payload.role ?? '').toLowerCase();
  return (
    normalizedRole === 'server_admin' ||
    normalizedRole === 'system_admin' ||
    normalizedRole === 'admin'
  );
}

/**
 * 创建维护模式中间件
 *
//  @param settingSchemaService 设置服务（注入）
//  @param jwtSecret JWT 密钥（用于识别管理员请求）
 */
export function createMaintenanceMiddleware(
  settingSchemaService: SettingSchemaService,
  jwtSecret: string,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 白名单路径直接放行
    if (isWhitelisted(req.path)) {
      next();
      return;
    }

    // 读取维护模式开关——失败时降级放行
    let maintenanceEnabled = false;
    try {
      maintenanceEnabled = await settingSchemaService.getBoolean('maintenance.enabled');
    } catch {
      next();
      return;
    }
    if (!maintenanceEnabled) {
      next();
      return;
    }

    // 维护模式开启：管理员放行，其余 503
    const isAdmin = await isAdminRequest(req, jwtSecret);
    if (isAdmin) {
      next();
      return;
    }

    // 返回 503 + 维护提示消息
    let message = '系统维护中，请稍后再试';
    try {
      const custom = await settingSchemaService.getString('maintenance.message');
      if (custom) message = custom;
    } catch {
      // 使用默认消息
    }
    res.status(503).json({
      error: {
        code: 'MAINTENANCE_MODE',
        message,
      },
    });
  };
}
