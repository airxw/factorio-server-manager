// ============================================================================
// alertSettings.ts — 告警系统路由（v4.6.0-F）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 挂载前缀：/api/alert-settings
//
// 端点：
//   GET    /              — 查询当前用户告警配置（任何已认证用户）
//   PUT    /              — 更新当前用户告警配置（任何已认证用户）
//   GET    /rules         — 列出所有可用告警规则（任何已认证用户）
//   GET    /events        — 查询告警历史（按角色范围过滤）
//   POST   /test-webhook  — 测试 webhook 连通性（任何已认证用户）
// ============================================================================

import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { AlertService } from '../../services/alertService.js';
import { PRESET_ALERT_RULES } from '../../services/alertService.js';
import { InstanceAdminService } from '../../services/instanceAdminService.js';
import type {
  AlertRuleType,
  AlertSettingsResponse,
  AlertRulesListResponse,
  AlertEventsListResponse,
  UpdateAlertSettingsRequest,
  UpdateAlertSettingsResponse,
  TestWebhookRequest,
  TestWebhookResponse,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

interface UserRow {
  email: string;
  email_verified: number;
}

interface OwnedServerRow {
  id: string;
}

/**
 * 创建告警系统路由
 *
 * @param db Knex 实例
 * @param alertService 告警服务实例
 * @param logger 日志器
 */
export function createAlertSettingsRouter(
  db: Knex,
  alertService: AlertService,
  logger: Logger,
): Router {
  const router = Router();
  const instanceAdminService = new InstanceAdminService(db);

  // ----------------------------------------------------------------
  // GET / — 查询当前用户告警配置（任何已认证用户）
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

      const settings = await alertService.getSettings(userId);

      // 查询用户邮箱及验证状态
      let email = '';
      let emailVerified = false;
      try {
        const userRow = await db<UserRow>('users')
          .where('id', userId)
          .select('email', 'email_verified')
          .first();
        if (userRow) {
          email = userRow.email;
          emailVerified = userRow.email_verified === 1;
        }
      } catch {
        // users 表查询失败时保持默认空值
      }

      const response: AlertSettingsResponse = {
        settings,
        email,
        email_verified: emailVerified,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT / — 更新当前用户告警配置（任何已认证用户）
  // ----------------------------------------------------------------
  router.put('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<UpdateAlertSettingsRequest>;

      // 校验 subscribed_rules 必须是合法 AlertRuleType
      if (body.subscribed_rules !== undefined) {
        if (!Array.isArray(body.subscribed_rules)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'subscribed_rules 必须为数组' },
          };
          res.status(400).json(errBody);
          return;
        }
        for (const rule of body.subscribed_rules) {
          if (!isValidRuleType(rule)) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `无效的告警规则类型: ${rule}` },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      // 校验 webhook_url 非空时必须是合法 URL（http/https）
      if (body.webhook_url !== undefined && body.webhook_url !== '') {
        if (!isValidWebhookUrl(body.webhook_url)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'webhook_url 必须是合法的 http/https URL' },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // 校验 email_enabled / webhook_enabled 必须是 boolean
      if (body.email_enabled !== undefined && typeof body.email_enabled !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'email_enabled 必须为 boolean' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.webhook_enabled !== undefined && typeof body.webhook_enabled !== 'boolean') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'webhook_enabled 必须为 boolean' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 后端二次校验：开启邮箱告警通道前，确保用户邮箱已验证
      // 防止前端绕过：未验证邮箱的用户不应能启用 email_enabled
      if (body.email_enabled === true) {
        try {
          const userRow = await db<UserRow>('users')
            .where('id', userId)
            .select('email_verified')
            .first();
          if (!userRow || userRow.email_verified !== 1) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'ALERT_EMAIL_NOT_VERIFIED' as PanelErrorResponse['error']['code'],
                message: '邮箱未验证',
              },
            };
            res.status(403).json(errBody);
            return;
          }
        } catch {
          // users 表查询失败时，安全降级：拒绝启用邮箱通道
          const errBody: PanelErrorResponse = {
            error: {
              code: 'ALERT_EMAIL_NOT_VERIFIED' as PanelErrorResponse['error']['code'],
              message: '邮箱验证状态校验失败',
            },
          };
          res.status(403).json(errBody);
          return;
        }
      }

      try {
        const settings = await alertService.updateSettings(userId, body);
        const response: UpdateAlertSettingsResponse = { settings };
        res.json(response);
      } catch (e) {
        if (e instanceof Error && e.message === 'ALERT_SETTINGS_UPDATE_FAILED') {
          const errBody: PanelErrorResponse = {
            error: { code: 'ALERT_SETTINGS_UPDATE_FAILED', message: '告警配置更新失败' },
          };
          res.status(500).json(errBody);
          return;
        }
        throw e;
      }
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /rules — 列出所有可用告警规则（任何已认证用户）
  // ----------------------------------------------------------------
  router.get('/rules', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }
      const response: AlertRulesListResponse = { rules: PRESET_ALERT_RULES };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // GET /events — 查询告警历史（按角色范围过滤）
  //   server_admin → 看全部
  //   instance_admin → listInstancesByAdmin 获取 serverIds 后过滤
  //   user → 看自己 owner 的实例的告警
  // ----------------------------------------------------------------
  router.get('/events', async (req, res) => {
    try {
      const userId = req.user?.userId;
      const userRole = req.user?.role;
      if (!userId || !userRole) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      const limit = Number.isFinite(limitParam) ? limitParam : undefined;

      // server_admin → 看全部
      if (userRole === 'server_admin') {
        const result = await alertService.listAlertEvents(limit);
        const response: AlertEventsListResponse = {
          events: result.events,
          total: result.total,
        };
        res.json(response);
        return;
      }

      // instance_admin → owner + instance_admins 共管的实例
      // user → 仅 owner 的实例
      let serverIds: string[] = [];
      if (userRole === 'instance_admin') {
        try {
          serverIds = await instanceAdminService.listInstancesByAdmin(userId);
        } catch {
          serverIds = [];
        }
      } else {
        // user：仅 owner
        try {
          const owned = await db<OwnedServerRow>('servers')
            .select('id')
            .where('owner_user_id', userId);
          serverIds = owned.map((r) => r.id);
        } catch {
          serverIds = [];
        }
      }

      // 查询近 7 天这些实例的告警
      const events = await alertService.listRecentAlertsForServers(24 * 7, serverIds);
      const response: AlertEventsListResponse = {
        events,
        total: events.length,
      };
      res.json(response);
    } catch (err) {
      handleError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /test-webhook — 测试 webhook 连通性（任何已认证用户）
  // ----------------------------------------------------------------
  router.post('/test-webhook', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(body);
        return;
      }

      const body = req.body as Partial<TestWebhookRequest>;
      const webhookUrl = body.webhook_url;
      if (!webhookUrl || typeof webhookUrl !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'webhook_url 不能为空' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!isValidWebhookUrl(webhookUrl)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'webhook_url 必须是合法的 http/https URL' },
        };
        res.status(400).json(errBody);
        return;
      }

      const result = await alertService.testWebhook(webhookUrl);
      const response: TestWebhookResponse = {
        success: result.success,
        message: result.message,
      };
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

const VALID_RULE_TYPES: AlertRuleType[] = [
  'instance_crash',
  'instance_abnormal_exit',
  'disk_high',
  'ssl_expiring',
  'backup_failing',
];

function isValidRuleType(value: unknown): value is AlertRuleType {
  return typeof value === 'string' && VALID_RULE_TYPES.includes(value as AlertRuleType);
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function handleError(res: Response, err: unknown, logger: Logger): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'alertSettings router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
