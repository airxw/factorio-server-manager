// ============================================================================
// instance-billing.ts — VPS 式预付费实例计费路由
//
// 路由前缀：/api/admin/instance-billing（在 routes-registry.ts 挂载）
// 鉴权：authenticateToken（挂载层统一注入）
//
// 端点清单：
//   GET    /types                      查询所有生效类型定价（任意已登录用户可读）
//   POST   /types                      创建/更新类型定价（仅 server_admin）
//   DELETE /types/:instance_type       归档类型定价（仅 server_admin）
//   GET    /settings/:instance_id      获取实例计费设置（腐竹可读自己的，admin 可读任意）
//   PUT    /settings/:instance_id      更新实例计费设置（腐竹可改自己的，admin 可改任意）
//   POST   /renew/:instance_id         手动续费实例（腐竹续费自己的，admin 可续任意）
//   GET    /preview                    金额预览（任意已登录用户）
//   GET    /:instance_id/renewals      查询实例续费记录（腐竹可查自己的，admin 可查任意）
//
// 依赖：instanceBillingService（从 services-init.ts 注入）
// ============================================================================

import { Router, type Request, type Response } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { Role, normalizeRole } from '../../core/auth/roles.js';
import type { InstanceBillingServiceImpl } from '../../services/instanceBillingService.js';
import type { InstanceType, BillingCycleMonths } from '@public/interface_stub/shared-types';
import { AppError } from '../../services/errors.js';

const VALID_INSTANCE_TYPES: ReadonlySet<string> = new Set([
  'micro',
  'small',
  'medium',
  'large',
  'xlarge',
]);
const VALID_CYCLE_MONTHS: ReadonlySet<number> = new Set([1, 3, 6, 12]);

interface InstanceBillingRouteDeps {
  instanceBillingService: InstanceBillingServiceImpl;
  db: Knex;
  logger: Logger;
}

/**
 * 判定当前用户是否为 server_admin（可操作任意实例）。
 * v4.17.0: 优先使用 req.activeRole（会话级活动角色），降级到 req.user.role。
 */
function isServerAdmin(req: Request): boolean {
  const role = normalizeRole(req.activeRole ?? req.user?.role ?? '');
  return role === Role.SERVER_ADMIN;
}

/**
 * 校验当前用户对实例的访问权（owner 或 server_admin）。
 * @returns true=有权限；false=无权限
 */
async function canAccessInstance(
  req: Request,
  db: Knex,
  instanceId: string,
): Promise<boolean> {
  if (isServerAdmin(req)) return true;
  const userId = req.user?.userId;
  if (!userId) return false;
  const row = await db<{ owner_user_id: string }>('servers')
    .select('owner_user_id')
    .where('id', instanceId)
    .first();
  if (!row) return false;
  return row.owner_user_id === userId;
}

/**
 * 统一错误响应：将 AppError 映射为 HTTP 状态码 + JSON 响应体。
 */
function sendError(res: Response, err: unknown, logger: Logger): void {
  if (err instanceof AppError) {
    const status = err.httpStatus ?? 500;
    res.status(status).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'instance-billing 路由未知错误');
  res.status(500).json({
    error: { code: 'PANEL_INTERNAL_ERROR', message: '内部错误' },
  });
}

export function createInstanceBillingRouter(deps: InstanceBillingRouteDeps): Router {
  const router = Router();
  const { instanceBillingService, db, logger } = deps;

  // ===== 类型定价 CRUD =====

  // GET /types — 查询所有生效类型定价（任意已登录用户可读，前端创建实例时需展示价格）
  router.get('/types', async (_req, res) => {
    try {
      const types = await instanceBillingService.listActiveTypePricings();
      res.json({ types });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // POST /types — 创建或更新类型定价（仅 server_admin）
  router.post('/types', async (req, res) => {
    try {
      if (!isServerAdmin(req)) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '仅系统管理员可配置类型定价' },
        });
        return;
      }
      const body = req.body as Partial<{
        instance_type: string;
        display_name: string;
        monthly_price: number;
        quarterly_discount?: number;
        semiannual_discount?: number;
        annual_discount?: number;
        recommended_slots?: number | null;
        cpu_limit?: string | null;
        memory_limit_mb?: number | null;
        disk_limit_gb?: number | null;
        description?: string | null;
      }>;

      if (!body.instance_type || !VALID_INSTANCE_TYPES.has(body.instance_type)) {
        res.status(400).json({
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `instance_type 必须为 micro/small/medium/large/xlarge 之一`,
          },
        });
        return;
      }
      if (!body.display_name || typeof body.monthly_price !== 'number') {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 display_name 或 monthly_price' },
        });
        return;
      }

      const operatorUserId = req.user?.userId!;
      const result = await instanceBillingService.upsertTypePricing(
        body.instance_type as InstanceType,
        {
          display_name: body.display_name,
          monthly_price: body.monthly_price,
          quarterly_discount: body.quarterly_discount,
          semiannual_discount: body.semiannual_discount,
          annual_discount: body.annual_discount,
          recommended_slots: body.recommended_slots ?? null,
          cpu_limit: body.cpu_limit ?? null,
          memory_limit_mb: body.memory_limit_mb ?? null,
          disk_limit_gb: body.disk_limit_gb ?? null,
          description: body.description ?? null,
        },
        operatorUserId,
      );
      res.status(201).json({ pricing: result });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // DELETE /types/:instance_type — 归档类型定价（仅 server_admin）
  router.delete('/types/:instance_type', async (req, res) => {
    try {
      if (!isServerAdmin(req)) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '仅系统管理员可归档类型定价' },
        });
        return;
      }
      const instanceType = req.params.instance_type as InstanceType;
      if (!VALID_INSTANCE_TYPES.has(instanceType)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法实例类型: ${instanceType}` },
        });
        return;
      }
      const operatorUserId = req.user?.userId!;
      await instanceBillingService.archiveTypePricing(instanceType, operatorUserId);
      res.status(204).send();
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // ===== 金额预览 =====

  // GET /preview?instance_type=small&billing_cycle_months=1&custom_monthly_price=3000
  // 任意已登录用户可调用（前端创建实例/续费时实时预览价格）
  router.get('/preview', async (req, res) => {
    try {
      const instanceType = String(req.query.instance_type ?? 'small') as InstanceType;
      const cycleMonths = Number(req.query.billing_cycle_months ?? 1);
      const customPriceRaw = req.query.custom_monthly_price;
      const customMonthlyPrice =
        customPriceRaw !== undefined && customPriceRaw !== null
          ? Number(customPriceRaw)
          : null;

      if (!VALID_INSTANCE_TYPES.has(instanceType)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法实例类型: ${instanceType}` },
        });
        return;
      }
      if (!VALID_CYCLE_MONTHS.has(cycleMonths)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `billing_cycle_months 必须为 1/3/6/12` },
        });
        return;
      }

      const typePricing = await instanceBillingService.getTypePricing(instanceType);
      const amountResult = await instanceBillingService.calculateAmount(
        typePricing,
        cycleMonths as BillingCycleMonths,
        customMonthlyPrice,
      );
      res.json({ preview: amountResult });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // ===== 实例计费设置 =====

  // GET /settings/:instance_id — 获取实例计费设置
  router.get('/settings/:instance_id', async (req, res) => {
    try {
      const instanceId = req.params.instance_id;
      const hasAccess = await canAccessInstance(req, db, instanceId);
      if (!hasAccess) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '无权访问此实例' },
        });
        return;
      }
      const settings = await instanceBillingService.getOrCreateBillingSettings(instanceId);
      res.json({ settings });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // PUT /settings/:instance_id — 更新实例计费设置
  router.put('/settings/:instance_id', async (req, res) => {
    try {
      const instanceId = req.params.instance_id;
      const hasAccess = await canAccessInstance(req, db, instanceId);
      if (!hasAccess) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '无权修改此实例计费设置' },
        });
        return;
      }

      const body = req.body as Partial<{
        instance_type: InstanceType;
        custom_monthly_price: number | null;
        billing_exempt: boolean;
        exempt_reason: string | null;
        auto_renew_enabled: boolean;
      }>;

      // 仅 server_admin 可设置 billing_exempt（腐竹不能给自己免除计费）
      if (body.billing_exempt === true && !isServerAdmin(req)) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '仅系统管理员可设置计费豁免' },
        });
        return;
      }

      const operatorUserId = req.user?.userId!;
      const settings = await instanceBillingService.updateBillingSettings(
        instanceId,
        {
          instance_type: body.instance_type,
          custom_monthly_price: body.custom_monthly_price,
          billing_exempt: body.billing_exempt,
          exempt_reason: body.exempt_reason as
            | 'manual'
            | 'self_hosted_node'
            | 'owner_self'
            | null
            | undefined,
          auto_renew_enabled: body.auto_renew_enabled,
        },
        operatorUserId,
      );
      res.json({ settings });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // ===== 续费 =====

  // POST /renew/:instance_id — 手动续费
  router.post('/renew/:instance_id', async (req, res) => {
    try {
      const instanceId = req.params.instance_id;
      const hasAccess = await canAccessInstance(req, db, instanceId);
      if (!hasAccess) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '无权续费此实例' },
        });
        return;
      }

      const body = req.body as Partial<{ billing_cycle_months: number }>;
      const cycleMonths = Number(body.billing_cycle_months ?? 1);
      if (!VALID_CYCLE_MONTHS.has(cycleMonths)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'billing_cycle_months 必须为 1/3/6/12' },
        });
        return;
      }

      const operatorUserId = req.user?.userId!;
      const result = await instanceBillingService.chargeInstanceRenewal(
        instanceId,
        operatorUserId,
        cycleMonths as BillingCycleMonths,
      );
      res.json({ renewal: result });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  // ===== 续费记录查询 =====

  // GET /:instance_id/renewals — 查询实例续费记录（按 renewed_at 降序）
  router.get('/:instance_id/renewals', async (req, res) => {
    try {
      const instanceId = req.params.instance_id;
      const hasAccess = await canAccessInstance(req, db, instanceId);
      if (!hasAccess) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '无权查看此实例计费记录' },
        });
        return;
      }

      const limitRaw = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

      const renewals = await db('instance_renewals')
        .where({ instance_id: instanceId })
        .orderBy('renewed_at', 'desc')
        .limit(limit);

      res.json({ renewals });
    } catch (err) {
      sendError(res, err, logger);
    }
  });

  return router;
}
