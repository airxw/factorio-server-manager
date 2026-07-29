// ============================================================================
// InstanceShopConfigService — 实例店铺外观配置服务（DB-backed）
// 契约：public/schema/panel-api-types.ts (InstanceShopConfig)
// 表：  instance_shop_configs（见 db/migrations/20260806000001_create_instance_shop_configs.ts）
//
// v4.13.0 阶段一：支持服主自定义店铺 Banner / 描述 / 主题色。
// 一实例一行，未配置时返回各字段为 null 的默认配置。
// ============================================================================

import type { Knex } from 'knex';

/** 店铺外观配置行（DB 行类型，与 InstanceShopConfig 一致） */
export interface InstanceShopConfigRow {
  server_id: string;
  banner_url: string | null;
  banner_link: string | null;
  shop_description: string | null;
  shop_theme_color: string | null;
  updated_at: string;
}

/** 主题色 HEX 校验正则（#RRGGBB 或 #RGB） */
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** URL 长度上限（防御性约束） */
const MAX_URL_LENGTH = 2048;
/** 描述长度上限 */
const MAX_DESCRIPTION_LENGTH = 500;
/** 主题色字段长度上限（DB 列约束为 16） */
const MAX_THEME_COLOR_LENGTH = 16;

export class ShopConfigError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ShopConfigError';
  }
}

export class InstanceShopConfigService {
  constructor(private db: Knex) {}

  /**
   * 读取实例店铺外观配置。
   * 未配置时返回全 null 字段的默认配置（不写入 DB，惰性创建）。
   */
  async getConfig(serverId: string): Promise<InstanceShopConfigRow> {
    const row = await this.db<InstanceShopConfigRow>('instance_shop_configs')
      .where({ server_id: serverId })
      .first();
    if (row) return row;
    // 返回默认配置（不写入 DB，upsert 时才创建）
    return {
      server_id: serverId,
      banner_url: null,
      banner_link: null,
      shop_description: null,
      shop_theme_color: null,
      updated_at: new Date(0).toISOString(),
    };
  }

  /**
   * 更新实例店铺外观配置（upsert 语义）。
   * 仅更新传入的字段，未传字段保留原值。
   * @throws ERR_INVALID_BANNER_URL, ERR_INVALID_BANNER_LINK, ERR_INVALID_SHOP_DESCRIPTION, ERR_INVALID_THEME_COLOR
   */
  async updateConfig(
    serverId: string,
    patch: {
      banner_url?: string | null;
      banner_link?: string | null;
      shop_description?: string | null;
      shop_theme_color?: string | null;
    },
  ): Promise<InstanceShopConfigRow> {
    // 校验
    this.validatePatch(patch);

    const ts = new Date().toISOString();
    const existing = await this.db<InstanceShopConfigRow>('instance_shop_configs')
      .where({ server_id: serverId })
      .first();

    if (!existing) {
      // 创建新行
      const newRow: InstanceShopConfigRow = {
        server_id: serverId,
        banner_url: patch.banner_url !== undefined ? patch.banner_url : null,
        banner_link: patch.banner_link !== undefined ? patch.banner_link : null,
        shop_description: patch.shop_description !== undefined ? patch.shop_description : null,
        shop_theme_color: patch.shop_theme_color !== undefined ? patch.shop_theme_color : null,
        updated_at: ts,
      };
      await this.db<InstanceShopConfigRow>('instance_shop_configs').insert(newRow);
      return newRow;
    }

    // 更新已有行
    const updateRow: Partial<InstanceShopConfigRow> = { updated_at: ts };
    if (patch.banner_url !== undefined) updateRow.banner_url = patch.banner_url;
    if (patch.banner_link !== undefined) updateRow.banner_link = patch.banner_link;
    if (patch.shop_description !== undefined) updateRow.shop_description = patch.shop_description;
    if (patch.shop_theme_color !== undefined) updateRow.shop_theme_color = patch.shop_theme_color;
    await this.db<InstanceShopConfigRow>('instance_shop_configs')
      .where({ server_id: serverId })
      .update(updateRow);
    return { ...existing, ...updateRow } as InstanceShopConfigRow;
  }

  /**
   * 校验 patch 字段。
   * @throws ShopConfigError 若字段值非法
   */
  private validatePatch(patch: {
    banner_url?: string | null;
    banner_link?: string | null;
    shop_description?: string | null;
    shop_theme_color?: string | null;
  }): void {
    if (patch.banner_url !== undefined && patch.banner_url !== null) {
      if (patch.banner_url.length > MAX_URL_LENGTH) {
        throw new ShopConfigError('ERR_INVALID_BANNER_URL', `banner_url 长度超过 ${MAX_URL_LENGTH}`);
      }
      if (!this.isValidUrl(patch.banner_url)) {
        throw new ShopConfigError('ERR_INVALID_BANNER_URL', 'banner_url 需为 http(s) URL');
      }
    }
    if (patch.banner_link !== undefined && patch.banner_link !== null) {
      if (patch.banner_link.length > MAX_URL_LENGTH) {
        throw new ShopConfigError('ERR_INVALID_BANNER_LINK', `banner_link 长度超过 ${MAX_URL_LENGTH}`);
      }
      if (!this.isValidUrl(patch.banner_link)) {
        throw new ShopConfigError('ERR_INVALID_BANNER_LINK', 'banner_link 需为 http(s) URL');
      }
    }
    if (patch.shop_description !== undefined && patch.shop_description !== null) {
      if (patch.shop_description.length > MAX_DESCRIPTION_LENGTH) {
        throw new ShopConfigError(
          'ERR_INVALID_SHOP_DESCRIPTION',
          `shop_description 长度超过 ${MAX_DESCRIPTION_LENGTH}`,
        );
      }
    }
    if (patch.shop_theme_color !== undefined && patch.shop_theme_color !== null) {
      if (
        patch.shop_theme_color.length > MAX_THEME_COLOR_LENGTH ||
        !HEX_COLOR_REGEX.test(patch.shop_theme_color)
      ) {
        throw new ShopConfigError(
          'ERR_INVALID_THEME_COLOR',
          'shop_theme_color 需为 HEX 格式（如 #f59e0b 或 #fb1）',
        );
      }
    }
  }

  private isValidUrl(s: string): boolean {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
