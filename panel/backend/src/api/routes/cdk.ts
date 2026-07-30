// ============================================================================
// 模块7_Panel业务API — CDK 兑换码管理路由（P2）
// 挂载在 /api/servers 下（在 index.ts 套 authenticateToken）
// - cdk-codes 端点（CRUD）：内部套 requireAdmin
// - cdk/redeem 端点（兑换）：任意已登录用户，无需 admin
// 对应服务：app.locals.cdkService（CdkServiceImpl）
// ============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  CdkServiceImpl,
  CreateCdkCodesRequestExt,
  GenerateUserCdkRequest,
} from '../../services/cdkService.js';
import { AppError } from '../../services/errors.js';
import { normalizeRole, hasRoleLevel, Role } from '../../core/auth/roles.js';
// v3.9.0-S2: CDK 兑换速率限制（10 次/小时/用户）
// v5 经济系统: 全局兑换端点升级 createCdkRedeemRateLimiter（20 次/小时，userId+IP）
import { createCdkRedeemLimiter, createCdkRedeemRateLimiter } from '../../middleware/rateLimiter.js';
import type {
  CreateCdkCodesResponse,
  DeleteCdkCodeResponse,
  GetCdkCodeResponse,
  ListCdkCodesResponse,
  PanelErrorResponse,
  RedeemCdkRequest,
  RedeemCdkResponse,
} from '@public/schema/panel-api-types';

/**
 * 管理员鉴权中间件：仅 instance_admin 及以上（含 server_admin）角色可访问，否则 403
 * 用 normalizeRole 兼容旧角色值（system_admin/admin/operator/viewer），
 * hasRoleLevel 判定等级 >= INSTANCE_ADMIN 即放行。
 * （与 index.ts 中 requireAdmin 逻辑一致，此处因 redeem 端点无需 admin 而在路由内部分离）
 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const rawRole = req.user?.role;
  if (!rawRole || !hasRoleLevel(normalizeRole(rawRole), Role.INSTANCE_ADMIN)) {
    const body: PanelErrorResponse = {
      error: { code: 'PANEL_FORBIDDEN', message: '需要管理员权限' },
    };
    res.status(403).json(body);
    return;
  }
  next();
}

/**
 * 创建 CDK 路由
 * 依赖通过 req.app.locals 注入：cdkService
 */
export function createCdkRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/cdk-codes — 批量创建 CDK 兑换码（管理员）
  // ----------------------------------------------------------------
  router.post('/:serverId/cdk-codes', requireAdmin, async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const serverId = req.params.serverId;
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const body = req.body as Partial<CreateCdkCodesRequestExt>;
      if (!body || !Array.isArray(body.codes) || body.codes.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'codes 不能为空' },
        };
        res.status(400).json(errBody);
        return;
      }
      // v5 经济系统：条目级运行时校验（type/amount/vip_duration，服务层另有完整校验）
      const VALID_ENTRY_TYPES = ['item', 'balance', 'points', 'vip'] as const;
      for (const entry of body.codes) {
        const entryType = entry?.type ?? 'item';
        if (!VALID_ENTRY_TYPES.includes(entryType)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `无效 CDK 类型: ${String(entry?.type)}` },
          };
          res.status(400).json(errBody);
          return;
        }
        if (entryType !== 'item' && entryType !== 'vip') {
          if (typeof entry?.amount !== 'number' || !Number.isInteger(entry.amount) || entry.amount <= 0) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `${entryType} 类型必须提供正整数 amount` },
            };
            res.status(400).json(errBody);
            return;
          }
        }
        if (entryType === 'vip' && entry?.vip_duration !== 'monthly' && entry?.vip_duration !== 'lifetime') {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'vip 类型必须提供 vip_duration（monthly/lifetime）' },
          };
          res.status(400).json(errBody);
          return;
        }
        // v4.37.0: max_uses 校验（仅 item 类型生效；非负整数；缺省 1）
        if (entry?.max_uses !== undefined) {
          const mu = entry.max_uses;
          if (typeof mu !== 'number' || !Number.isInteger(mu) || mu < 0) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `max_uses 必须为非负整数: ${String(mu)}` },
            };
            res.status(400).json(errBody);
            return;
          }
          if (entryType !== 'item' && mu !== 1) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `${entryType} 类型 CDK 仅支持一次性（max_uses=1）` },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }
      const codes = await cdkService.createCodes(userId, serverId, body as CreateCdkCodesRequestExt);
      // v5 经济系统：管理员生成经济类型 CDK 写审计日志（运营工具，不扣余额；不阻塞主流程）
      const hasEconomicEntry = body.codes.some((c) => (c?.type ?? 'item') !== 'item');
      if (hasEconomicEntry) {
        const auditLogService = req.app.locals.auditLogService;
        if (auditLogService) {
          void auditLogService.create({
            server_id: serverId,
            user_id: userId,
            action: 'cdk.generate_economic',
            target_type: 'cdk_code',
            target_id: codes.map((c) => c.id).join(','),
            details: {
              types: body.codes.map((c) => c?.type ?? 'item'),
              count: codes.length,
            },
            ip_address: req.ip ?? null,
          }).catch(() => { /* 审计日志失败不影响主流程 */ });
        }
      }
      const response: CreateCdkCodesResponse = { codes };
      res.status(201).json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/cdk-codes — 列出 CDK 兑换码（管理员）
  // ----------------------------------------------------------------
  router.get('/:serverId/cdk-codes', requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const filter = status ? { status: status as 'unused' | 'claiming' | 'claimed' | 'expired' } : undefined;
      const codes = await cdkService.listCodes(serverId, filter);
      const response: ListCdkCodesResponse = { codes };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/servers/:serverId/cdk-codes/:id — 查询单条 CDK（管理员）
  // ----------------------------------------------------------------
  router.get('/:serverId/cdk-codes/:id', requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const code = await cdkService.getCode(serverId, id);
      const response: GetCdkCodeResponse = { code };
      res.json(response);
    } catch (err) {
      handleAppError(res, err, 'CDK_NOT_FOUND', 404);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/servers/:serverId/cdk-codes/:id — 删除 CDK（仅 unused，管理员）
  // ----------------------------------------------------------------
  router.delete('/:serverId/cdk-codes/:id', requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `id 必须为数字: ${req.params.id}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      await cdkService.deleteCode(serverId, id);
      const response: DeleteCdkCodeResponse = { id, deleted: true };
      res.json(response);
    } catch (err) {
      if (err instanceof AppError && err.code === 'CDK_NOT_FOUND') {
        handleAppError(res, err, 'CDK_NOT_FOUND', 404);
        return;
      }
      // 非 unused 状态删除 → 视为校验错误
      if (err instanceof Error && /unused/.test(err.message)) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: err.message },
        };
        res.status(400).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/servers/:serverId/cdk/redeem — 兑换 CDK（任意用户，无需 admin）
  // v3.9.0-S2: 套 createCdkRedeemLimiter——10 次/小时/用户，防暴力枚举
  // ----------------------------------------------------------------
  router.post('/:serverId/cdk/redeem', createCdkRedeemLimiter(), async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const body = req.body as Partial<RedeemCdkRequest>;
      if (!body || typeof body.code !== 'string' || typeof body.player_name !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 code 或 player_name' },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await cdkService.redeem(serverId, body as RedeemCdkRequest);
      // S7-2: 审计日志注入（不阻塞主流程）
      const auditLogService = req.app.locals.auditLogService;
      if (auditLogService) {
        void auditLogService.create({
          server_id: serverId,
          user_id: req.user?.userId ?? null,
          action: 'cdk.redeem',
          target_type: 'cdk_code',
          target_id: String(result.code.id),
          details: { code: result.code.code, item_name: result.code.item_name, player_name: body.player_name },
          ip_address: req.ip ?? null,
        }).catch(() => { /* 审计日志失败不影响主流程 */ });
      }
      const response: RedeemCdkResponse = {
        code: result.code,
        delivered: result.delivered,
        remaining_uses: result.remaining_uses,
      };
      res.json(response);
    } catch (err) {
      if (err instanceof AppError) {
        const status =
          err.code === 'CDK_NOT_FOUND' ? 404 :
          err.code === 'CDK_ALREADY_CLAIMED' ? 409 :
          err.code === 'CDK_EXPIRED' ? 410 :
          err.code === 'PACK_NOT_FOUND' ? 404 :
          err.code === 'COMMAND_RENDER_FAILED' ? 400 :
          err.code === 'COMMAND_QUEUE_FULL' ? 503 :
          500;
        const body: PanelErrorResponse = {
          error: { code: err.code as PanelErrorResponse['error']['code'], message: err.message },
        };
        res.status(status).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  return router;
}

/**
 * 创建全局 CDK 路由（挂载在 /api/cdk 下）
 *
 * 端点：
 *   POST /api/cdk/redeem — 全局兑换（无需 serverId，通过 code 自动查找实例，兑换成功后自动关注）
 *   GET /api/cdk/lookup?code=xxx — 查询 CDK 信息（预览奖励内容）
 */
export function createGlobalCdkRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/cdk/lookup — 通过 code 查询 CDK 信息（预览奖励，无需兑换）
  // ----------------------------------------------------------------
  router.get('/lookup', createCdkRedeemLimiter(), async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      if (!code) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 code 参数' },
        };
        res.status(400).json(body);
        return;
      }
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const cdkCode = await cdkService.findCodeByCode(code);
      if (!cdkCode) {
        const body: PanelErrorResponse = {
          error: { code: 'CDK_NOT_FOUND', message: '兑换码不存在或已失效' },
        };
        res.status(404).json(body);
        return;
      }
      // 只返回安全的预览信息，不泄露敏感字段
      // v4.37.0: 附加 max_uses/use_count，供前端预览展示「可兑换 N 次 / 剩余 M 次」
      res.json({
        code: {
          gift_name: cdkCode.gift_name,
          gift_description: cdkCode.gift_description,
          item_name: cdkCode.item_name,
          count: cdkCode.count,
          quality: cdkCode.quality,
          items: cdkCode.items,
          expires_at: cdkCode.expires_at,
          status: cdkCode.status,
          server_id: cdkCode.server_id,
          max_uses: cdkCode.max_uses,
          use_count: cdkCode.use_count,
        },
      });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/cdk/generate — 用户自生成 points/vip CDK（冻结余额，7 天有效）
  // v5 经济系统：type=points 按兑换比折算冻结，type=vip 按实例定价冻结
  // ----------------------------------------------------------------
  router.post('/generate', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const body = req.body as Partial<GenerateUserCdkRequest>;
      if (!body || !body.type || !body.server_id) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 type 或 server_id' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.type !== 'points' && body.type !== 'vip') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `用户自生成 CDK 仅支持 points/vip 类型: ${String(body.type)}` },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await cdkService.generateUserCdk(userId, body as GenerateUserCdkRequest);

      // 审计日志（不阻塞主流程）
      const auditLogService = req.app.locals.auditLogService;
      if (auditLogService) {
        void auditLogService.create({
          server_id: body.server_id,
          user_id: userId,
          action: 'cdk.generate_user',
          target_type: 'cdk_code',
          target_id: result.code,
          details: {
            type: body.type,
            amount: body.amount ?? null,
            vip_duration: body.vip_duration ?? null,
            frozen_amount: result.frozen_amount,
            expires_at: result.expires_at,
          },
          ip_address: req.ip ?? null,
        }).catch(() => { /* 审计日志失败不影响主流程 */ });
      }

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        const status =
          err.code === 'VIP_PRICING_NOT_CONFIGURED' ? 400 :
          err.code === 'INSUFFICIENT_BALANCE' ? 400 :
          err.code === 'DAILY_LIMIT_EXCEEDED' ? 429 :
          err.code === 'PANEL_VALIDATION_ERROR' ? 400 :
          500;
        const body: PanelErrorResponse = {
          error: { code: err.code as PanelErrorResponse['error']['code'], message: err.message },
        };
        res.status(status).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/cdk/redeem — 全局兑换（无需 serverId，兑换成功后自动关注实例）
  // v5 经济系统：升级 createCdkRedeemRateLimiter——20 次/小时，userId+IP 复合键
  // ----------------------------------------------------------------
  router.post('/redeem', createCdkRedeemRateLimiter(), async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        };
        res.status(401).json(errBody);
        return;
      }
      const cdkService = req.app.locals.cdkService as CdkServiceImpl;
      const body = req.body as Partial<{ code: string; player_name: string }>;
      if (!body || typeof body.code !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 code' },
        };
        res.status(400).json(errBody);
        return;
      }
      const result = await cdkService.redeemGlobal(userId, {
        code: body.code,
        player_name: body.player_name,
      });

      // 审计日志（不阻塞主流程）
      const auditLogService = req.app.locals.auditLogService;
      if (auditLogService) {
        void auditLogService.create({
          server_id: result.code.server_id,
          user_id: userId,
          action: 'cdk.redeem_global',
          target_type: 'cdk_code',
          target_id: String(result.code.id),
          details: {
            code: result.code.code,
            item_name: result.code.item_name,
            player_name: body.player_name ?? '(auto)',
            followed: result.followed,
          },
          ip_address: req.ip ?? null,
        }).catch(() => { /* 审计日志失败不影响主流程 */ });
      }

      res.json({
        code: result.code,
        delivered: result.delivered,
        followed: result.followed,
        remaining_uses: result.remaining_uses,
      });
    } catch (err) {
      if (err instanceof AppError) {
        const status =
          err.code === 'CDK_NOT_FOUND' ? 404 :
          err.code === 'CDK_ALREADY_CLAIMED' ? 409 :
          err.code === 'CDK_EXPIRED' ? 410 :
          err.code === 'PACK_NOT_FOUND' ? 404 :
          err.code === 'COMMAND_RENDER_FAILED' ? 400 :
          err.code === 'COMMAND_QUEUE_FULL' ? 503 :
          500;
        const body: PanelErrorResponse = {
          error: { code: err.code as PanelErrorResponse['error']['code'], message: err.message },
        };
        res.status(status).json(body);
        return;
      }
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleAppError(
  res: Response,
  err: unknown,
  expectedCode: string,
  status: number,
): void {
  if (err instanceof AppError && err.code === expectedCode) {
    const body: PanelErrorResponse = {
      error: { code: expectedCode as PanelErrorResponse['error']['code'], message: err.message },
    };
    res.status(status).json(body);
    return;
  }
  handleInternal(res, err);
}

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
