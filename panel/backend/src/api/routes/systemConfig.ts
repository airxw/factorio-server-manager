// ============================================================================
// 模块7_Panel业务API — 系统配置路由（P1 管理员功能）
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken + requireAdmin）
// 对应服务：app.locals.systemConfigService（SystemConfigServiceImpl）
// ============================================================================

import { Router, type Response } from 'express';
import type { SystemConfigService } from '@public/interface_stub/system-config-service';
import type { SystemConfig } from '@public/interface_stub/shared-types';
import type {
  DeleteSystemConfigResponse,
  GetSystemConfigResponse,
  ListSystemConfigsResponse,
  PanelErrorResponse,
  SetSystemConfigRequest,
  SetSystemConfigResponse,
  SystemConfigItem,
} from '@public/schema/panel-api-types';

/**
 * 受保护配置项清单——被业务代码引用的 key 禁止删除。
 * 删除后业务读取会拿到 null，虽然有默认值兜底但管理员自定义值会丢失且无回收站。
 * 列表来源：withdrawService.ts / pricingService.ts / userCenter.ts 中实际 get 的 key。
 */
const PROTECTED_KEYS: ReadonlySet<string> = new Set([
  'withdraw.ratio',        // withdrawService.getWithdrawRatio
  'consumption.daily_max', // pricingService.getPlatformDailyMax
  'recharge.max',          // userCenter.getRechargeMax
]);

function isProtectedKey(key: string): boolean {
  return PROTECTED_KEYS.has(key);
}

function toSystemConfigItem(config: SystemConfig): SystemConfigItem {
  return {
    key: config.key,
    value: config.value,
    description: config.description,
    updated_at: config.updated_at,
  };
}

/**
 * 创建 SystemConfig 路由
 * 依赖通过 req.app.locals 注入：systemConfigService
 */
export function createSystemConfigRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/system-config — 列出全部配置
  // ----------------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const systemConfigService = req.app.locals.systemConfigService as SystemConfigService;
      const configs = await systemConfigService.list();
      const response: ListSystemConfigsResponse = {
        configs: configs.map(toSystemConfigItem),
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/system-config/:key — 查询单条配置（不存在时 config: null）
  // ----------------------------------------------------------------
  router.get('/:key', async (req, res) => {
    try {
      const systemConfigService = req.app.locals.systemConfigService as SystemConfigService;
      const value = await systemConfigService.get(req.params.key);
      if (value === null) {
        const response: GetSystemConfigResponse = { config: null };
        res.json(response);
        return;
      }
      // get 返回值不含 description/updated_at，需要从 list 中查找或直接查询
      // 这里用 getWithDefault 不合适，直接再查一次 list 过滤（数据量小，P1 可接受）
      const all = await systemConfigService.list();
      const found = all.find((c) => c.key === req.params.key) ?? null;
      const response: GetSystemConfigResponse = {
        config: found ? toSystemConfigItem(found) : null,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/system-config/:key — 设置配置（upsert）
  // ----------------------------------------------------------------
  router.put('/:key', async (req, res) => {
    try {
      const systemConfigService = req.app.locals.systemConfigService as SystemConfigService;
      const body = req.body as Partial<SetSystemConfigRequest>;
      if (typeof body.value !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 value 字段' },
        };
        res.status(400).json(errBody);
        return;
      }

      await systemConfigService.set(req.params.key, body.value, body.description);

      // 读取写入后的完整记录返回
      const all = await systemConfigService.list();
      const found = all.find((c) => c.key === req.params.key);
      if (!found) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_INTERNAL_ERROR', message: '写入后查询配置失败' },
        };
        res.status(500).json(errBody);
        return;
      }
      const response: SetSystemConfigResponse = { config: toSystemConfigItem(found) };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /api/system-config/:key — 删除配置（幂等）
  // v4.x.x: 受保护 key（被业务代码引用）禁止删除，返回 409 Conflict
  // ----------------------------------------------------------------
  router.delete('/:key', async (req, res) => {
    try {
      const key = req.params.key;
      if (isProtectedKey(key)) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `配置项 "${key}" 被业务代码引用，禁止删除。可改为编辑值或重置为默认值。`,
          },
        };
        res.status(409).json(errBody);
        return;
      }
      const systemConfigService = req.app.locals.systemConfigService as SystemConfigService;
      await systemConfigService.delete(key);
      const response: DeleteSystemConfigResponse = {
        key,
        deleted: true,
      };
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
