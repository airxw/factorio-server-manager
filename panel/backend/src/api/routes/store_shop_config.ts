// ============================================================================
// v4.13.0: 实例店铺外观配置路由（/api/store/servers/:serverId/shop-config）
//
// 端点：
//   GET  /api/store/servers/:serverId/shop-config   — 读取店铺外观配置
//                                                      门控：requireInstanceAccess（user+ 拥有实例访问权即可读）
//   PUT  /api/store/servers/:serverId/shop-config   — 更新店铺外观配置
//                                                      门控：requireInstanceAdmin（instance_admin+ 服主才能改）
//
// 对应服务：InstanceShopConfigService（app.locals.instanceShopConfigService）
// 契约：public/schema/panel-api-types.ts (InstanceShopConfig)
// ============================================================================

import { Router, type Response } from 'express';
import type { Logger } from 'pino';
import type { InstanceShopConfigService, ShopConfigError } from '../../modules/asset_service/instance_shop_config_service.js';
import { requireInstanceAccess, requireInstanceAdmin } from '../../middleware/auth.js';
import type {
  PanelErrorResponse,
  UpdateInstanceShopConfigRequest,
} from '@public/schema/panel-api-types';

const ERROR_CODE_TO_STATUS: Record<string, number> = {
  ERR_INVALID_BANNER_URL: 400,
  ERR_INVALID_BANNER_LINK: 400,
  ERR_INVALID_SHOP_DESCRIPTION: 400,
  ERR_INVALID_THEME_COLOR: 400,
};

/**
 * 创建店铺外观配置路由
 * @param shopConfigService 店铺配置服务实例
 * @param logger 日志器
 */
export function createStoreShopConfigRouter(
  shopConfigService: InstanceShopConfigService,
  logger: Logger,
): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /store/servers/:serverId/shop-config — 读取店铺外观配置
  // ----------------------------------------------------------------
  router.get(
    '/store/servers/:serverId/shop-config',
    requireInstanceAccess('serverId'),
    async (req, res) => {
      try {
        const config = await shopConfigService.getConfig(req.params.serverId);
        res.json({ config });
      } catch (err) {
        handleShopConfigError(res, err, logger);
      }
    },
  );

  // ----------------------------------------------------------------
  // PUT /store/servers/:serverId/shop-config — 更新店铺外观配置
  // ----------------------------------------------------------------
  router.put(
    '/store/servers/:serverId/shop-config',
    requireInstanceAdmin('serverId'),
    async (req, res) => {
      try {
        const body = (req.body ?? {}) as UpdateInstanceShopConfigRequest;
        const patch: UpdateInstanceShopConfigRequest = {};
        if (body.banner_url !== undefined) patch.banner_url = body.banner_url;
        if (body.banner_link !== undefined) patch.banner_link = body.banner_link;
        if (body.shop_description !== undefined) patch.shop_description = body.shop_description;
        if (body.shop_theme_color !== undefined) patch.shop_theme_color = body.shop_theme_color;

        const config = await shopConfigService.updateConfig(req.params.serverId, patch);
        res.json({ config });
      } catch (err) {
        handleShopConfigError(res, err, logger);
      }
    },
  );

  return router;
}

function handleShopConfigError(res: Response, err: unknown, logger: Logger): void {
  if (err && typeof err === 'object' && err instanceof Error && err.name === 'ShopConfigError') {
    const e = err as ShopConfigError;
    const status = ERROR_CODE_TO_STATUS[e.code] ?? 400;
    const body: PanelErrorResponse = {
      error: {
        code: e.code as PanelErrorResponse['error']['code'],
        message: e.message,
      },
    };
    res.status(status).json(body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'store-shop-config router internal error');
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
