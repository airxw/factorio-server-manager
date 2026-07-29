// ============================================================================
// AssetService 集成测试 — 全链路（:memory: SQLite 真实建表）
// 顺序：seed 全局资产 → getMergedAssets（默认）→ overrideAsset → getMergedAssets（合并）
//       → createUgcAsset → getMergedAssets（含 UGC）→ 跨实例隔离校验
// 与 asset_service.test.ts（单方法行为）的区别：本测试串联 IAssetService 三个核心方法，
// 验证真实 DB 表上的端到端数据流，而非单点错误分支。
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex, { type Knex } from 'knex';
import { AssetService } from './asset_service';
import { createAssetTables } from '../../test/db-helper';

describe('AssetService 集成测试（全链路 :memory: SQLite）', () => {
  let db: Knex;
  let service: AssetService;

  beforeAll(async () => {
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // 建表：servers（实例存在性校验依赖）+ 资产表
    await db.schema.createTable('servers', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('pack_id').notNullable();
      table.string('game_type').notNullable();
      table.string('node_id').notNullable();
      table.string('owner_user_id').notNullable();
      table.string('status').notNullable().defaultTo('stopped');
      table.integer('port').notNullable();
      table.integer('rcon_port').notNullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
    await createAssetTables(db);

    const ts = new Date().toISOString();
    await db('servers').insert([
      { id: 'inst-A', name: 'A', pack_id: 'p', game_type: 'mc', node_id: 'n', owner_user_id: 'u', status: 'running', port: 1, rcon_port: 2, created_at: ts, updated_at: ts },
      { id: 'inst-B', name: 'B', pack_id: 'p', game_type: 'mc', node_id: 'n', owner_user_id: 'u', status: 'running', port: 3, rcon_port: 4, created_at: ts, updated_at: ts },
    ]);

    service = new AssetService(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('全链路：seed → merge → override → merge → UGC → merge → 跨实例隔离', async () => {
    // 1. seed 两个全局资产
    await service.createGlobalAsset({ type: 'COMMODITY', name: 'Diamond', default_price: 100, is_active: true, execution_logic: 'give diamond' });
    await service.createGlobalAsset({ type: 'RULE', name: 'NoGriefRule', is_active: true });
    const globals = await service.listGlobalAssets();
    expect(globals).toHaveLength(2);
    const diamond = globals.find((g) => g.name === 'Diamond')!;
    const rule = globals.find((g) => g.type === 'RULE')!;

    // 2. getMergedAssets — inst-A 看到全局默认
    let mergedA = await service.getMergedAssets('inst-A');
    expect(mergedA).toHaveLength(2);
    const diamondMerged = mergedA.find((m) => m.id === diamond.id)!;
    expect(diamondMerged).toMatchObject({ name: 'Diamond', price: 100, is_active: true, is_ugc: false, execution_logic: 'give diamond' });

    // 3. overrideAsset — inst-A 覆盖 Diamond 价格与名称
    await service.overrideAsset('inst-A', diamond.id, { name: 'Cheap Diamond', price: 10, is_active: false });

    // 4. getMergedAssets — inst-A 合并后看到 override
    mergedA = await service.getMergedAssets('inst-A');
    const diamondOverridden = mergedA.find((m) => m.id === diamond.id)!;
    expect(diamondOverridden).toMatchObject({ name: 'Cheap Diamond', price: 10, is_active: false, is_ugc: false });

    // 5. RULE 资产不可覆盖
    await expect(service.overrideAsset('inst-A', rule.id, { price: 1 })).rejects.toThrowError(/ERR_OVERRIDE_FORBIDDEN/);

    // 6. createUgcAsset — inst-A 创建 UGC
    const ugcId = await service.createUgcAsset('inst-A', {
      name: 'Custom Kit',
      price: 250,
      is_active: true,
      execution_logic: 'give custom_kit',
    });
    expect(ugcId).toMatch(/^ugc_/);

    // 7. getMergedAssets — inst-A 含 UGC（2 全局 + 1 UGC = 3）
    mergedA = await service.getMergedAssets('inst-A');
    expect(mergedA).toHaveLength(3);
    const ugc = mergedA.find((m) => m.is_ugc)!;
    expect(ugc).toMatchObject({ id: ugcId, name: 'Custom Kit', price: 250, is_active: true, execution_logic: 'give custom_kit' });

    // 8. 跨实例隔离 — inst-B 不应看到 inst-A 的 override 与 UGC
    const mergedB = await service.getMergedAssets('inst-B');
    expect(mergedB).toHaveLength(2); // 仅 2 个全局资产
    const diamondB = mergedB.find((m) => m.id === diamond.id)!;
    expect(diamondB).toMatchObject({ name: 'Diamond', price: 100, is_active: true });
    expect(mergedB.find((m) => m.is_ugc)).toBeUndefined();
  });

  it('实例不存在时全链路阻断', async () => {
    await expect(service.getMergedAssets('no-such-instance')).rejects.toThrowError(/ERR_INSTANCE_NOT_FOUND/);
    await expect(service.overrideAsset('no-such-instance', 'any', { price: 1 })).rejects.toThrowError(/ERR_INSTANCE_NOT_FOUND/);
    await expect(service.createUgcAsset('no-such-instance', { name: 'x', price: 1, is_active: true, execution_logic: '' })).rejects.toThrowError(/ERR_INSTANCE_NOT_FOUND/);
  });
});
