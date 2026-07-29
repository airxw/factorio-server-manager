// ============================================================================
// 模块1_资产管理后端 — 资产路由（v4.11.0 接入运行时）
// 路由本身不套鉴权中间件（在 routes-registry.ts 挂载时统一套 authenticateToken）
// 对应服务：AssetService（app.locals.assetService）
//
// 挂载前缀：/api（在 routes-registry 挂载 authenticateToken 后调用本工厂）
//
// 实例级端点（instance_admin 门控，param=instanceId）：
//   GET    /admin/instances/:instanceId/assets                            → getMergedAssets
//   POST   /admin/instances/:instanceId/assets/:globalAssetId/override    → overrideAsset
//   POST   /admin/instances/:instanceId/assets/ugc                        → createUgcAsset
//
// 全局资产 CRUD（requireAdmin 系统管理员）：
//   GET    /admin/assets        → list
//   POST   /admin/assets        → create
//   PUT    /admin/assets/:id    → update
//   DELETE /admin/assets/:id    → delete
// ============================================================================

import { Router, type Response } from 'express';
import type { Logger } from 'pino';
import type { AssetService, GlobalAsset } from '../../modules/asset_service/asset_service.js';
import { AssetError } from '../../modules/asset_service/asset_service.js';
import { requireAdmin, requireInstanceAdmin } from '../../middleware/auth.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';
import type { MergedAsset } from '@public/interface_stub/asset_interfaces';

const VALID_TYPES: readonly GlobalAsset['type'][] = ['COMMODITY', 'TEMPLATE', 'RULE'];

function isValidType(v: unknown): v is GlobalAsset['type'] {
  return typeof v === 'string' && (VALID_TYPES as readonly string[]).includes(v);
}

/**
 * AssetService 错误码 → HTTP 状态码映射
 * 对齐 public/schema/error-codes-schema.json 的语义：
 *   404 资源不存在 / 403 禁止 / 429 超限 / 400 客户端参数错误（含注入）
 */
const ERROR_CODE_TO_STATUS: Record<string, number> = {
  ERR_INSTANCE_NOT_FOUND: 404,
  ERR_ASSET_NOT_FOUND: 404,
  ERR_OVERRIDE_FORBIDDEN: 403,
  ERR_UGC_LIMIT_EXCEEDED: 429,
  ERR_RCON_INJECTION: 400,
};

/**
 * 创建资产路由
 * @param assetService 资产服务实例
 * @param logger 日志器
 */
export function createAssetsRouter(assetService: AssetService, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /admin/instances/:instanceId/assets — 实例合并资产列表
  // ----------------------------------------------------------------
  router.get(
    '/admin/instances/:instanceId/assets',
    requireInstanceAdmin('instanceId'),
    async (req, res) => {
      try {
        const merged = await assetService.getMergedAssets(req.params.instanceId);
        res.json({ assets: merged });
      } catch (err) {
        handleAssetError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /admin/instances/:instanceId/assets/:globalAssetId/override — 覆盖全局资产
  // 注意：此路由需在 /ugc 之前注册不会被吃掉——/override 与 /ugc 路径不同，无冲突。
  // ----------------------------------------------------------------
  router.post(
    '/admin/instances/:instanceId/assets/:globalAssetId/override',
    requireInstanceAdmin('instanceId'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const overrides: Partial<MergedAsset> = {};
        if (body.name !== undefined) overrides.name = body.name;
        if (body.price !== undefined) overrides.price = body.price;
        if (body.is_active !== undefined) overrides.is_active = body.is_active;
        if (body.execution_logic !== undefined) overrides.execution_logic = body.execution_logic;

        await assetService.overrideAsset(req.params.instanceId, req.params.globalAssetId, overrides);
        res.json({ overridden: true });
      } catch (err) {
        handleAssetError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // POST /admin/instances/:instanceId/assets/ugc — 创建 UGC 资产
  // ----------------------------------------------------------------
  router.post(
    '/admin/instances/:instanceId/assets/ugc',
    requireInstanceAdmin('instanceId'),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        if (typeof body.name !== 'string' || body.name.length === 0) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 name' },
          };
          res.status(400).json(errBody);
          return;
        }
        if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'price 需为非负数' },
          };
          res.status(400).json(errBody);
          return;
        }
        const id = await assetService.createUgcAsset(req.params.instanceId, {
          name: body.name,
          price: body.price ?? 0,
          is_active: body.is_active !== undefined ? !!body.is_active : true,
          execution_logic: typeof body.execution_logic === 'string' ? body.execution_logic : '',
        });
        res.status(201).json({ id });
      } catch (err) {
        handleAssetError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // GET /admin/assets — 全局资产列表（系统管理员）
  // ----------------------------------------------------------------
  router.get('/admin/assets', requireAdmin, async (_req, res) => {
    try {
      const list = await assetService.listGlobalAssets();
      res.json({ assets: list });
    } catch (err) {
      handleAssetError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // POST /admin/assets — 创建全局资产（系统管理员）
  // ----------------------------------------------------------------
  router.post('/admin/assets', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.name !== 'string' || body.name.length === 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 name' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!isValidType(body.type)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `type 无效，需为 ${VALID_TYPES.join('/')}` },
        };
        res.status(400).json(errBody);
        return;
      }
      if (body.default_price !== undefined && (typeof body.default_price !== 'number' || body.default_price < 0)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'default_price 需为非负数' },
        };
        res.status(400).json(errBody);
        return;
      }
      const created = await assetService.createGlobalAsset({
        type: body.type,
        name: body.name,
        default_price: body.default_price,
        execution_logic: typeof body.execution_logic === 'string' ? body.execution_logic : undefined,
        is_active: body.is_active !== undefined ? !!body.is_active : true,
        game_pack_id: typeof body.game_pack_id === 'string' ? body.game_pack_id : undefined,
      });
      res.status(201).json({ asset: created });
    } catch (err) {
      handleAssetError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // PUT /admin/assets/:id — 更新全局资产（系统管理员）
  // ----------------------------------------------------------------
  router.put('/admin/assets/:id', requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const patch: Parameters<AssetService['updateGlobalAsset']>[1] = {};
      if (body.type !== undefined) {
        if (!isValidType(body.type)) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `type 无效，需为 ${VALID_TYPES.join('/')}` },
          };
          res.status(400).json(errBody);
          return;
        }
        patch.type = body.type;
      }
      if (body.name !== undefined) patch.name = body.name;
      if (body.default_price !== undefined) patch.default_price = body.default_price;
      if (body.execution_logic !== undefined) patch.execution_logic = body.execution_logic;
      if (body.is_active !== undefined) patch.is_active = !!body.is_active;
      if (body.game_pack_id !== undefined) patch.game_pack_id = body.game_pack_id;

      const updated = await assetService.updateGlobalAsset(req.params.id, patch);
      res.json({ asset: updated });
    } catch (err) {
      handleAssetError(res, err, logger);
    }
  });

  // ----------------------------------------------------------------
  // DELETE /admin/assets/:id — 删除全局资产（系统管理员，级联清理 override）
  // ----------------------------------------------------------------
  router.delete('/admin/assets/:id', requireAdmin, async (req, res) => {
    try {
      const ok = await assetService.deleteGlobalAsset(req.params.id);
      if (!ok) {
        const errBody: PanelErrorResponse = {
          error: { code: 'ERR_ASSET_NOT_FOUND' as PanelErrorResponse['error']['code'], message: `全局资产不存在: ${req.params.id}` },
        };
        res.status(404).json(errBody);
        return;
      }
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      handleAssetError(res, err, logger);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleAssetError(res: Response, err: unknown, logger: Logger): void {
  if (err instanceof AssetError) {
    const status = ERROR_CODE_TO_STATUS[err.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: err.code as PanelErrorResponse['error']['code'],
        message: err.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'assets router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
