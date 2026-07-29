import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { AssetService, AssetError, GlobalAsset } from './asset_service';
import { createTestDb, createAssetTables, destroyTestDb } from '../../test/db-helper';

// 测试所需的最小 servers 行字段
interface ServerRow {
  id: string;
  name: string;
  pack_id: string;
  game_type: string;
  node_id: string;
  owner_user_id: string;
  status: string;
  port: number;
  rcon_port: number;
  created_at: string;
  updated_at: string;
}

async function insertServer(db: Knex, id: string): Promise<void> {
  const ts = new Date().toISOString();
  await db<ServerRow>('servers').insert({
    id,
    name: `server-${id}`,
    pack_id: 'test-pack',
    game_type: 'minecraft',
    node_id: 'node-1',
    owner_user_id: 'user-1',
    status: 'stopped',
    port: 25565,
    rcon_port: 25575,
    created_at: ts,
    updated_at: ts,
  });
}

async function insertGlobalAsset(
  db: Knex,
  data: { id: string; type: GlobalAsset['type']; name: string; default_price?: number; is_active?: boolean; execution_logic?: string },
): Promise<void> {
  const ts = new Date().toISOString();
  await db('global_assets').insert({
    id: data.id,
    type: data.type,
    name: data.name,
    default_price: data.default_price ?? null,
    execution_logic: data.execution_logic ?? null,
    is_active: data.is_active === false ? 0 : 1,
    game_pack_id: null,
    created_at: ts,
    updated_at: ts,
  });
}

describe('AssetService', () => {
  let db: Knex;
  let service: AssetService;

  beforeEach(async () => {
    db = await createTestDb();
    await createAssetTables(db);
    await insertServer(db, 'instance-1');
    await insertServer(db, 'instance-2');
    service = new AssetService(db);
  });

  afterEach(async () => {
    await destroyTestDb(db);
  });

  describe('getMergedAssets', () => {
    it('should throw ERR_INSTANCE_NOT_FOUND if instance does not exist', async () => {
      await expect(service.getMergedAssets('unknown')).rejects.toThrowError(AssetError);
      await expect(service.getMergedAssets('unknown')).rejects.toThrowError(/ERR_INSTANCE_NOT_FOUND/);
    });

    it('should return global assets when no overrides exist', async () => {
      await insertGlobalAsset(db, {
        id: 'g1',
        type: 'COMMODITY',
        name: 'Global Item 1',
        default_price: 100,
        is_active: true,
        execution_logic: 'give item 1',
      });

      const merged = await service.getMergedAssets('instance-1');
      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        id: 'g1',
        name: 'Global Item 1',
        price: 100,
        is_active: true,
        is_ugc: false,
        execution_logic: 'give item 1',
      });
    });

    it('should apply overrides from instance assets', async () => {
      await insertGlobalAsset(db, {
        id: 'g1',
        type: 'COMMODITY',
        name: 'Global Item 1',
        default_price: 100,
        is_active: true,
      });
      const ts = new Date().toISOString();
      await db('instance_assets').insert({
        id: 'i1',
        instance_id: 'instance-1',
        global_asset_id: 'g1',
        is_ugc: 0,
        override_name: 'Overridden Item 1',
        override_price: 150,
        override_is_active: 0,
        custom_execution_logic: null,
        created_at: ts,
        updated_at: ts,
      });

      const merged1 = await service.getMergedAssets('instance-1');
      expect(merged1).toHaveLength(1);
      expect(merged1[0]).toMatchObject({
        name: 'Overridden Item 1',
        price: 150,
        is_active: false,
        is_ugc: false,
      });

      // 其他实例仍看到全局默认值
      const merged2 = await service.getMergedAssets('instance-2');
      expect(merged2[0]).toMatchObject({
        name: 'Global Item 1',
        price: 100,
        is_active: true,
      });
    });

    it('should include UGC assets', async () => {
      const ts = new Date().toISOString();
      await db('instance_assets').insert({
        id: 'u1',
        instance_id: 'instance-1',
        global_asset_id: null,
        is_ugc: 1,
        override_name: 'My UGC',
        override_price: 500,
        override_is_active: 1,
        custom_execution_logic: 'give custom',
        created_at: ts,
        updated_at: ts,
      });

      const merged = await service.getMergedAssets('instance-1');
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({
        id: 'u1',
        name: 'My UGC',
        price: 500,
        is_active: true,
        is_ugc: true,
        execution_logic: 'give custom',
      });
    });
  });

  describe('overrideAsset', () => {
    beforeEach(async () => {
      await insertGlobalAsset(db, {
        id: 'g1',
        type: 'COMMODITY',
        name: 'Global Item 1',
        default_price: 100,
        is_active: true,
      });
      await insertGlobalAsset(db, {
        id: 'r1',
        type: 'RULE',
        name: 'Global Rule',
        is_active: true,
      });
    });

    it('should throw ERR_OVERRIDE_FORBIDDEN for RULE assets', async () => {
      await expect(service.overrideAsset('instance-1', 'r1', { price: 200 })).rejects.toThrowError(/ERR_OVERRIDE_FORBIDDEN/);
    });

    it('should throw ERR_ASSET_NOT_FOUND for unknown global asset', async () => {
      await expect(service.overrideAsset('instance-1', 'nope', { price: 200 })).rejects.toThrowError(/ERR_ASSET_NOT_FOUND/);
    });

    it('should create new override if none exists', async () => {
      await service.overrideAsset('instance-1', 'g1', { name: 'New Name', price: 99 });
      const overrides = await db('instance_assets').where({ instance_id: 'instance-1', is_ugc: 0 });
      expect(overrides).toHaveLength(1);
      expect(overrides[0]).toMatchObject({
        instance_id: 'instance-1',
        global_asset_id: 'g1',
        override_name: 'New Name',
        override_price: 99,
      });
    });

    it('should update existing override', async () => {
      const ts = new Date().toISOString();
      await db('instance_assets').insert({
        id: 'existing',
        instance_id: 'instance-1',
        global_asset_id: 'g1',
        is_ugc: 0,
        override_name: 'Old Name',
        override_price: 10,
        override_is_active: null,
        custom_execution_logic: null,
        created_at: ts,
        updated_at: ts,
      });

      await service.overrideAsset('instance-1', 'g1', { is_active: false });
      const override = await db('instance_assets').where({ id: 'existing' }).first();
      expect(override.override_name).toBe('Old Name');
      expect(override.override_price).toBe(10);
      expect(override.override_is_active).toBe(0);
    });
  });

  describe('createUgcAsset', () => {
    it('should create a valid UGC asset', async () => {
      const id = await service.createUgcAsset('instance-1', {
        name: 'Super Sword',
        price: 999,
        is_active: true,
        execution_logic: 'give sword',
      });

      expect(id).toMatch(/^ugc_/);
      const ugc = await db('instance_assets').where({ id }).first();
      expect(ugc).toMatchObject({
        instance_id: 'instance-1',
        is_ugc: 1,
        override_name: 'Super Sword',
        override_price: 999,
        custom_execution_logic: 'give sword',
      });
    });

    it('should throw ERR_UGC_LIMIT_EXCEEDED when limit reached', async () => {
      service.UGC_LIMIT = 2;
      await service.createUgcAsset('instance-1', { name: 'U1', price: 1, is_active: true, execution_logic: 'l' });
      await service.createUgcAsset('instance-1', { name: 'U2', price: 1, is_active: true, execution_logic: 'l' });

      await expect(service.createUgcAsset('instance-1', { name: 'U3', price: 1, is_active: true, execution_logic: 'l' }))
        .rejects.toThrowError(/ERR_UGC_LIMIT_EXCEEDED/);
    });

    it('should throw ERR_RCON_INJECTION for malicious logic', async () => {
      await expect(service.createUgcAsset('instance-1', {
        name: 'Bad',
        price: 1,
        is_active: true,
        execution_logic: 'give item; rm -rf /',
      })).rejects.toThrowError(/ERR_RCON_INJECTION/);
    });
  });

  describe('Global asset CRUD', () => {
    it('should create and list global assets', async () => {
      const created = await service.createGlobalAsset({
        type: 'COMMODITY',
        name: 'Sword',
        default_price: 50,
        is_active: true,
      });
      expect(created.id).toBeTruthy();
      expect(created.is_active).toBe(true);

      const list = await service.listGlobalAssets();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Sword');
    });

    it('should update global asset', async () => {
      const created = await service.createGlobalAsset({ type: 'COMMODITY', name: 'Old', is_active: true });
      const updated = await service.updateGlobalAsset(created.id, { name: 'New', is_active: false });
      expect(updated?.name).toBe('New');
      expect(updated?.is_active).toBe(false);
    });

    it('should delete global asset and cascade-clean instance overrides', async () => {
      const created = await service.createGlobalAsset({ type: 'COMMODITY', name: 'ToDelete', is_active: true });
      await service.overrideAsset('instance-1', created.id, { price: 10 });

      const ok = await service.deleteGlobalAsset(created.id);
      expect(ok).toBe(true);
      // override 记录应被级联清理
      const orphans = await db('instance_assets').where({ global_asset_id: created.id });
      expect(orphans).toHaveLength(0);
    });

    it('updateGlobalAsset should throw ERR_ASSET_NOT_FOUND for missing id', async () => {
      await expect(service.updateGlobalAsset('missing', { name: 'x' })).rejects.toThrowError(/ERR_ASSET_NOT_FOUND/);
    });
  });
});
