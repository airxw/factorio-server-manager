// ============================================================================
// meSecurity.ts — 个人安全中心路由（v4.31.0）
//
// 路由本身不套鉴权中间件（在 routes-registry.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/me
//
// 端点：
//   GET /login-history  — 本人登录历史（含失败尝试，便于发现异常）
//   GET /audit-logs     — 本人活动记录（强制按当前 user_id 过滤）
//   GET /last-login     — 上次成功登录信息（供登录后弹窗）
//
// 权限：任何已登录用户均可查询自己的安全数据（auth.ts 已保证 req.user 有效）
//
// 数据隔离：
//   - login-history / audit-logs 强制按 req.user.userId 过滤，路由层覆盖任何客户端传入的 user_id
//   - 不暴露 login_input 字段（即使是本人，也不展示攻击者输入的猜测值）
//   - last-login 排除当前会话（取第 2 条 success 记录）
// ============================================================================

import { Router, type Response } from 'express';
import type { Logger } from 'pino';
import type { LoginHistoryServiceImpl } from '../../services/loginHistoryService.js';
import type { AuditLogServiceImpl } from '../../services/auditLogService.js';
// v4.33.0: 分页解析统一走公共 utils（W3 提炼批，替换文件内局部 parsePositiveInt）
import { parsePositiveInt } from '../../utils/pagination.js';
import type {
  LoginHistoryListResponse,
  MyActivityListResponse,
  LastLoginResponse,
  MyActivityEntry,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

/**
 * 创建个人安全中心路由
 *
 * @param logger 日志器
 * 依赖通过 req.app.locals 注入：loginHistoryService / auditLogService
 */
export function createMeSecurityRouter(logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/me/login-history — 本人登录历史（分页，含失败尝试）
  // ----------------------------------------------------------------
  router.get('/login-history', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = parsePositiveInt(req.query.page_size, 20);

      const service = req.app.locals.loginHistoryService as LoginHistoryServiceImpl | undefined;
      if (!service) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: 'loginHistoryService 未注入' },
        };
        res.status(500).json(body);
        return;
      }

      const result = await service.listByUser(user.userId, page, pageSize);
      const response: LoginHistoryListResponse = {
        items: result.items,
        total: result.total,
        page: result.page,
        page_size: result.page_size,
      };
      res.json(response);
    } catch (err) {
      handleSecurityError(res, err, logger, 'login-history');
    }
  });

  // ----------------------------------------------------------------
  // GET /api/me/audit-logs — 本人活动记录（分页，强制 user_id 过滤）
  // ----------------------------------------------------------------
  router.get('/audit-logs', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const page = parsePositiveInt(req.query.page, 1);
      const pageSize = parsePositiveInt(req.query.page_size, 20);
      // v4.31.0: 强制按当前 user_id 过滤，路由层覆盖任何客户端传入的 user_id
      // 客户端可仍传 action/target_type/from/to 过滤条件
      const opts: {
        action?: string;
        target_type?: string;
        from?: string;
        to?: string;
      } = {};
      if (typeof req.query.action === 'string' && req.query.action) {
        opts.action = req.query.action;
      }
      if (typeof req.query.target_type === 'string' && req.query.target_type) {
        opts.target_type = req.query.target_type;
      }
      if (typeof req.query.from === 'string' && req.query.from) {
        opts.from = req.query.from;
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        opts.to = req.query.to;
      }

      const service = req.app.locals.auditLogService as AuditLogServiceImpl | undefined;
      if (!service) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: 'auditLogService 未注入' },
        };
        res.status(500).json(body);
        return;
      }

      const result = await service.listByUser(user.userId, { ...opts, page, page_size: pageSize });
      // v4.31.0: 转换为 MyActivityEntry（去除 server_id / user_id，避免泄露其他实例信息）
      const items: MyActivityEntry[] = result.logs.map((log) => ({
        id: log.id,
        action: log.action,
        target_type: log.target_type,
        target_id: log.target_id,
        details: log.details,
        ip_address: log.ip_address,
        created_at: log.created_at,
      }));
      const response: MyActivityListResponse = {
        items,
        total: result.total,
        page: result.page,
        page_size: result.page_size,
      };
      res.json(response);
    } catch (err) {
      handleSecurityError(res, err, logger, 'audit-logs');
    }
  });

  // ----------------------------------------------------------------
  // GET /api/me/last-login — 上次成功登录信息（供登录后弹窗）
  // 排除当前会话：取最近 2 条 success，返回第 2 条（首次登录返回 null）
  // ----------------------------------------------------------------
  router.get('/last-login', async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const service = req.app.locals.loginHistoryService as LoginHistoryServiceImpl | undefined;
      if (!service) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: 'loginHistoryService 未注入' },
        };
        res.status(500).json(body);
        return;
      }

      const lastLogin = await service.getLastLoginInfo(user.userId);
      const response: LastLoginResponse = { last_login: lastLogin };
      res.json(response);
    } catch (err) {
      handleSecurityError(res, err, logger, 'last-login');
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

// v4.33.0: 局部 parsePositiveInt 已删除，统一使用 ../../utils/pagination.js 的公共实现

/** 统一错误处理 */
function handleSecurityError(res: Response, err: unknown, logger: Logger, endpoint: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message, endpoint }, 'meSecurity router internal error');

  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
