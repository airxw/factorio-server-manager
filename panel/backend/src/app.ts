// ============================================================================
// Express 应用工厂
// 从 index.ts 拆分而来，行为等价。
// 职责：创建 Express 实例 + 注册中间件（cors/json/helmet/logger/rateLimiter/maintenance/audit）
// 注意：/api 404 回退 + 全局错误处理（4 参数中间件）必须在所有路由注册之后，
//       因此由 routes-registry.ts 的 registerRoutes() 在路由注册完毕后追加。
// ============================================================================

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import { createGlobalRateLimiter } from './middleware/rateLimiter.js';
import { createMaintenanceMiddleware } from './middleware/maintenance.js';
import { createAuditMiddleware } from './middleware/audit.js';
import type { SettingSchemaService } from './services/settingSchemaService.js';

export interface CreateAppConfig {
  logger: Logger;
  settingSchemaService: SettingSchemaService;
  JWT_SECRET: string;
  db: Knex;
  corsOrigin?: string;
}

export function createApp(config: CreateAppConfig): express.Express {
  const { logger, settingSchemaService, JWT_SECRET, db, corsOrigin } = config;

  const app = express();

  // 信任 nginx 反向代理（单层代理，trust proxy = 1）
  // nginx 监听 0.0.0.0:3000/3001 反代到 127.0.0.1:3002
  // 启用后 req.ip 取自 X-Forwarded-For 首段而非 127.0.0.1
  // 影响：登录 IP 记录、速率限制、审计日志 等所有使用 req.ip 的中间件和路由
  app.set('trust proxy', 1);

  // D7: CORS 白名单——从环境变量 CORS_ORIGIN 读取（逗号分隔），未配置时降级为通配（仅开发环境）
  const corsOptions: cors.CorsOptions = corsOrigin
    ? {
        origin: corsOrigin.split(',').map((s) => s.trim()).filter(Boolean),
        credentials: true,
      }
    : { origin: true };
  app.use(cors(corsOptions));
  app.use(express.json());

  // v3.9.0-S1: Helmet 安全头中间件——替代 v3.8.0 手动 CSP，提供完整的 HTTP 安全头
  //   - contentSecurityPolicy: 沿用 v3.8.0 配置（允许 React 内联样式 + WS 连接）
  //   - crossOriginEmbedderPolicy: false（避免破坏第三方资源加载）
  //   - HSTS 关闭：非标准端口部署（3000=HTTP / 3001=HTTPS）下 HSTS 会导致浏览器
  //     把 http://host:3000 强制升级为 https://host:3000，而 3000 端口无 SSL，
  //     触发 ERR_SSL_PROTOCOL_ERROR，使 HTTP→HTTPS 跳转失效
  //   - 保留 X-Frame-Options / X-Content-Type-Options / Referrer-Policy 默认值
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    }),
  );

  // 请求日志
  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, '->');
    next();
  });

  // D11: 全局 API 速率限制——每 IP 每秒最多 50 次请求
  const globalRateLimiter = createGlobalRateLimiter();
  app.use('/api', globalRateLimiter);

  // v3.9.0-S8: 维护模式中间件——开启后非管理员请求返回 503
  //   - 挂载顺序：helmet → cors → json → 请求日志 → 全局速率限制 → 维护模式 → 审计 → 路由
  //   - 白名单（login/register/password-reset/email-verify/legal/site-info/init/health）放行
  //   - 管理员请求放行，允许登录后台关闭维护模式
  app.use('/api', createMaintenanceMiddleware(settingSchemaService, JWT_SECRET));

  // v3.9.0-S10: 审计中间件——记录 mutating 请求（POST/PUT/PATCH/DELETE）到 audit_logs
  //   - 仅记录已认证用户的请求（依赖 authenticateToken 填充 req.user）
  //   - 注意：本中间件在路由挂载前注册，但 res.on('finish') 在响应结束时才触发写入
  //     届时路由内部的 authenticateToken 已执行，req.user 已填充
  //   - 排除公开端点（登录/注册/密码找回/邮箱验证等）
  app.use('/api', createAuditMiddleware(db, logger));

  return app;
}

/**
 * 注册全局错误处理 + /api 404 回退。
 * 必须在所有路由注册完毕后调用（由 registerRoutes 末尾调用）。
 */
export function registerErrorHandlers(app: express.Express, logger: Logger): void {
  // v3.9.0-S9: 友好错误页面——API 未匹配路由返回 JSON 404
  //   - 仅对 /api/* 路径生效，避免拦截 SPA 路由回退
  //   - 必须放在所有 API 路由挂载之后、SPA 回退之后（app.get('*') 已注册，此处专用于 API 404）
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: {
        code: 'PANEL_NOT_FOUND',
        message: `路径 ${req.method} ${req.path} 不存在`,
      },
    });
  });

  // v3.9.0-S9: 全局错误处理——捕获未处理异常返回 JSON 500
  //   - 必须放在所有路由之后（Express 错误中间件约定：4 个参数）
  //   - 记录完整 error 到日志，前端只看到通用消息避免敏感信息泄漏
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    logger.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        method: req.method,
        path: req.path,
      },
      '未处理的请求异常（全局错误中间件）',
    );
    res.status(500).json({
      error: {
        code: 'PANEL_INTERNAL_ERROR',
        message: '服务器内部错误，请稍后重试或联系管理员',
      },
    });
  });
}
