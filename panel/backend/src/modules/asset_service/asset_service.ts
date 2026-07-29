// ============================================================================
// AssetService — 商业化资产服务（DB-backed）
// 契约：public/interface_stub/asset_interfaces.d.ts (IAssetService)
// 表：  global_assets / instance_assets（见 db/migrations/20260805000001_create_asset_tables.ts）
//
// v4.11.0 接入运行时：由内存 Map 实现重构为 Knex DB-backed，保持 IAssetService
//      三个核心方法签名不变，追加全局资产 CRUD 供系统管理员路由调用。
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { IAssetService, MergedAsset } from '@public/interface_stub/asset_interfaces';

export class AssetError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'AssetError';
  }
}

export interface GlobalAsset {
  id: string;
  type: "COMMODITY" | "TEMPLATE" | "RULE";
  name: string;
  default_price?: number;
  execution_logic?: string;
  is_active: boolean;
  game_pack_id?: string;
  created_at: string;
  updated_at: string;
}

export interface InstanceAsset {
  id: string;
  instance_id: string;
  global_asset_id: string | null;
  is_ugc: boolean;
  override_price: number | null;
  override_name: string | null;
  override_is_active: boolean | null;
  custom_execution_logic: string | null;
  created_at: string;
  updated_at: string;
}

// ----- DB 行类型（SQLite boolean 以 0/1 存储） -----

interface GlobalAssetRow {
  id: string;
  type: string;
  name: string;
  default_price: number | null;
  execution_logic: string | null;
  is_active: number;
  game_pack_id: string | null;
  created_at: string;
  updated_at: string;
}

interface InstanceAssetRow {
  id: string;
  instance_id: string;
  global_asset_id: string | null;
  is_ugc: number;
  override_price: number | null;
  override_name: string | null;
  override_is_active: number | null;
  custom_execution_logic: string | null;
  created_at: string;
  updated_at: string;
}

// ----- RCON 注入危险模式（与原实现一致） -----

const DANGEROUS_PATTERNS = ['rm -rf', 'drop table', 'shutdown', 'reboot'];

function nowIso(): string {
  return new Date().toISOString();
}

function toBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v !== 0;
}

export class AssetService implements IAssetService {
  /** UGC 单实例上限（可由外部覆盖，默认 10） */
  public UGC_LIMIT = 10;

  constructor(private db: Knex) {}

  // ===========================================================================
  // IAssetService 核心方法（签名不变）
  // ===========================================================================

  /**
   * 实例管理员获取商城列表（自动合并 Global 和 Instance 的数据）
   * @throws ERR_INSTANCE_NOT_FOUND
   */
  async getMergedAssets(instanceId: string): Promise<MergedAsset[]> {
    await this.assertInstanceExists(instanceId);

    const result: MergedAsset[] = [];

    // 1. 全局资产 + 对应 override（非 UGC）
    const globalRows = await this.db<GlobalAssetRow>('global_assets').select('*');
    const overrideRows = await this.db<InstanceAssetRow>('instance_assets')
      .where({ instance_id: instanceId, is_ugc: 0 })
      .select('*');
    const overrideByGlobalId = new Map<string, InstanceAssetRow>();
    for (const r of overrideRows) {
      if (r.global_asset_id) {
        overrideByGlobalId.set(r.global_asset_id, r);
      }
    }

    for (const g of globalRows) {
      const ov = overrideByGlobalId.get(g.id);
      result.push({
        id: g.id, // 展示 ID 为 global_asset_id
        name: ov?.override_name ?? g.name,
        price: ov?.override_price ?? g.default_price ?? 0,
        is_active: ov?.override_is_active !== null && ov?.override_is_active !== undefined
          ? toBool(ov.override_is_active)!
          : toBool(g.is_active)!,
        is_ugc: false,
        execution_logic: g.execution_logic ?? '',
      });
    }

    // 2. UGC 资产
    const ugcRows = await this.db<InstanceAssetRow>('instance_assets')
      .where({ instance_id: instanceId, is_ugc: 1 })
      .select('*');
    for (const u of ugcRows) {
      result.push({
        id: u.id, // 展示 ID 为 instance_asset_id
        name: u.override_name ?? 'Unnamed UGC',
        price: u.override_price ?? 0,
        is_active: toBool(u.override_is_active) ?? true,
        is_ugc: true,
        execution_logic: u.custom_execution_logic ?? '',
      });
    }

    return result;
  }

  /**
   * 实例管理员覆盖全局资产属性
   * @throws ERR_INSTANCE_NOT_FOUND, ERR_ASSET_NOT_FOUND, ERR_OVERRIDE_FORBIDDEN
   */
  async overrideAsset(
    instanceId: string,
    globalAssetId: string,
    overrides: Partial<MergedAsset>,
  ): Promise<void> {
    await this.assertInstanceExists(instanceId);

    const globalRow = await this.db<GlobalAssetRow>('global_assets')
      .where({ id: globalAssetId })
      .first();
    if (!globalRow) {
      throw new AssetError('ERR_ASSET_NOT_FOUND', `Global asset ${globalAssetId} not found`);
    }

    // RULE 类型禁止覆盖
    if (globalRow.type === 'RULE') {
      throw new AssetError('ERR_OVERRIDE_FORBIDDEN', `Cannot override RULE asset ${globalAssetId}`);
    }

    // 查找既有 override
    const existing = await this.db<InstanceAssetRow>('instance_assets')
      .where({ instance_id: instanceId, global_asset_id: globalAssetId, is_ugc: 0 })
      .first();

    const ts = nowIso();
    if (!existing) {
      const newId = `inst_asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await this.db<InstanceAssetRow>('instance_assets').insert({
        id: newId,
        instance_id: instanceId,
        global_asset_id: globalAssetId,
        is_ugc: 0,
        override_price: overrides.price !== undefined ? overrides.price : null,
        override_name: overrides.name !== undefined ? overrides.name : null,
        override_is_active: overrides.is_active !== undefined ? (overrides.is_active ? 1 : 0) : null,
        custom_execution_logic: null,
        created_at: ts,
        updated_at: ts,
      });
    } else {
      const patch: Partial<InstanceAssetRow> = { updated_at: ts };
      if (overrides.name !== undefined) patch.override_name = overrides.name;
      if (overrides.price !== undefined) patch.override_price = overrides.price;
      if (overrides.is_active !== undefined) patch.override_is_active = overrides.is_active ? 1 : 0;
      await this.db<InstanceAssetRow>('instance_assets')
        .where({ id: existing.id })
        .update(patch);
    }
  }

  /**
   * 实例管理员创建 UGC 资产
   * @throws ERR_INSTANCE_NOT_FOUND, ERR_UGC_LIMIT_EXCEEDED, ERR_RCON_INJECTION
   */
  async createUgcAsset(
    instanceId: string,
    assetData: Omit<MergedAsset, 'id' | 'is_ugc'>,
  ): Promise<string> {
    await this.assertInstanceExists(instanceId);

    // UGC 数量限制
    const ugcCountResult = await this.db('instance_assets')
      .where({ instance_id: instanceId, is_ugc: 1 })
      .count('* as cnt')
      .first();
    const currentUgcCount = Number((ugcCountResult as { cnt?: number | string } | undefined)?.cnt ?? 0);
    if (currentUgcCount >= this.UGC_LIMIT) {
      throw new AssetError(
        'ERR_UGC_LIMIT_EXCEEDED',
        `UGC limit of ${this.UGC_LIMIT} exceeded for instance ${instanceId}`,
      );
    }

    // RCON 注入检查
    if (assetData.execution_logic) {
      const lowerLogic = assetData.execution_logic.toLowerCase();
      if (DANGEROUS_PATTERNS.some((p) => lowerLogic.includes(p))) {
        throw new AssetError('ERR_RCON_INJECTION', 'Malicious execution logic detected');
      }
    }

    const newId = `ugc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ts = nowIso();
    await this.db<InstanceAssetRow>('instance_assets').insert({
      id: newId,
      instance_id: instanceId,
      global_asset_id: null,
      is_ugc: 1,
      override_price: assetData.price ?? 0,
      override_name: assetData.name ?? 'New UGC',
      override_is_active: assetData.is_active !== undefined ? (assetData.is_active ? 1 : 0) : 1,
      custom_execution_logic: assetData.execution_logic ?? '',
      created_at: ts,
      updated_at: ts,
    });
    return newId;
  }

  // ===========================================================================
  // 全局资产 CRUD（供系统管理员路由调用，不属于 IAssetService 契约）
  // ===========================================================================

  async listGlobalAssets(): Promise<GlobalAsset[]> {
    const rows = await this.db<GlobalAssetRow>('global_assets').select('*');
    return rows.map((r) => this.rowToGlobalAsset(r));
  }

  async getGlobalAsset(id: string): Promise<GlobalAsset | null> {
    const row = await this.db<GlobalAssetRow>('global_assets').where({ id }).first();
    return row ? this.rowToGlobalAsset(row) : null;
  }

  async createGlobalAsset(data: {
    type: GlobalAsset['type'];
    name: string;
    default_price?: number;
    execution_logic?: string;
    is_active?: boolean;
    game_pack_id?: string;
  }): Promise<GlobalAsset> {
    const id = randomUUID();
    const ts = nowIso();
    const row: GlobalAssetRow = {
      id,
      type: data.type,
      name: data.name,
      default_price: data.default_price ?? null,
      execution_logic: data.execution_logic ?? null,
      is_active: data.is_active === false ? 0 : 1,
      game_pack_id: data.game_pack_id ?? null,
      created_at: ts,
      updated_at: ts,
    };
    await this.db<GlobalAssetRow>('global_assets').insert(row);
    return this.rowToGlobalAsset(row);
  }

  async updateGlobalAsset(
    id: string,
    patch: Partial<{
      type: GlobalAsset['type'];
      name: string;
      default_price: number;
      execution_logic: string;
      is_active: boolean;
      game_pack_id: string;
    }>,
  ): Promise<GlobalAsset | null> {
    const existing = await this.db<GlobalAssetRow>('global_assets').where({ id }).first();
    if (!existing) {
      throw new AssetError('ERR_ASSET_NOT_FOUND', `Global asset ${id} not found`);
    }
    const updateRow: Partial<GlobalAssetRow> = { updated_at: nowIso() };
    if (patch.type !== undefined) updateRow.type = patch.type;
    if (patch.name !== undefined) updateRow.name = patch.name;
    if (patch.default_price !== undefined) updateRow.default_price = patch.default_price;
    if (patch.execution_logic !== undefined) updateRow.execution_logic = patch.execution_logic;
    if (patch.is_active !== undefined) updateRow.is_active = patch.is_active ? 1 : 0;
    if (patch.game_pack_id !== undefined) updateRow.game_pack_id = patch.game_pack_id;
    await this.db<GlobalAssetRow>('global_assets').where({ id }).update(updateRow);
    const updated = await this.db<GlobalAssetRow>('global_assets').where({ id }).first();
    return updated ? this.rowToGlobalAsset(updated) : null;
  }

  async deleteGlobalAsset(id: string): Promise<boolean> {
    // 同步清理引用该全局资产的 instance_assets（override 记录）
    await this.db<InstanceAssetRow>('instance_assets')
      .where({ global_asset_id: id })
      .del();
    const affected = await this.db<GlobalAssetRow>('global_assets').where({ id }).del();
    return affected > 0;
  }

  // ===========================================================================
  // 辅助方法
  // ===========================================================================

  /**
   * 校验实例存在（查询 servers 表）
   * @throws ERR_INSTANCE_NOT_FOUND
   */
  private async assertInstanceExists(instanceId: string): Promise<void> {
    const server = await this.db<{ id: string }>('servers')
      .select('id')
      .where({ id: instanceId })
      .first();
    if (!server) {
      throw new AssetError('ERR_INSTANCE_NOT_FOUND', `Instance ${instanceId} not found`);
    }
  }

  private rowToGlobalAsset(r: GlobalAssetRow): GlobalAsset {
    return {
      id: r.id,
      type: r.type as GlobalAsset['type'],
      name: r.name,
      default_price: r.default_price ?? undefined,
      execution_logic: r.execution_logic ?? undefined,
      is_active: toBool(r.is_active)!,
      game_pack_id: r.game_pack_id ?? undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }
}
