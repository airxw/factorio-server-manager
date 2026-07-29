import { IAssetService, MergedAsset } from '../interface_stub/asset_interfaces';

/**
 * @description 预生成的默认稳定 Mock，用于支持下游并行开发。
 * 提供预设数据和固定行为，保证多次调用返回一致。
 */
export class MockAssetService implements IAssetService {
  // 模拟内存数据库，存储各实例的覆盖数据和 UGC 数据
  private instanceData: Record<string, MergedAsset[]> = {};

  // 全局基础数据（系统管理员配置的标品）
  private globalAssets: MergedAsset[] = [
    {
      id: 'global_vip_30d',
      name: '青铜 VIP (30天)',
      price: 30,
      is_active: true,
      is_ugc: false,
      execution_logic: 'add_vip {player_id} 30d'
    },
    {
      id: 'global_starter_pack',
      name: '新手开荒礼包',
      price: 5,
      is_active: true,
      is_ugc: false,
      execution_logic: 'give_item {player_id} starter_kit'
    }
  ];

  async getMergedAssets(instanceId: string): Promise<MergedAsset[]> {
    if (!instanceId) {
      throw new Error('ERR_INSTANCE_NOT_FOUND');
    }

    const customAssets = this.instanceData[instanceId] || [];
    
    // 合并逻辑：如果实例覆盖了全局资产（以 globalAssetId 为准），使用实例数据；否则使用全局数据。
    // 对于 Mock 而言，我们简单地将 global 和 ugc 拼在一起，处理覆盖。
    const merged: MergedAsset[] = this.globalAssets.map(global => {
      const override = customAssets.find(ca => ca.id === global.id && !ca.is_ugc);
      if (override) {
        return { ...global, ...override };
      }
      return global;
    });

    const ugcAssets = customAssets.filter(ca => ca.is_ugc);
    return [...merged, ...ugcAssets];
  }

  async overrideAsset(instanceId: string, globalAssetId: string, overrides: Partial<MergedAsset>): Promise<void> {
    if (!instanceId) throw new Error('ERR_INSTANCE_NOT_FOUND');
    
    // 模拟安全性校验
    if (overrides.execution_logic) {
      throw new Error('ERR_OVERRIDE_FORBIDDEN');
    }

    const globalExists = this.globalAssets.find(ga => ga.id === globalAssetId);
    if (!globalExists) {
      throw new Error('ERR_ASSET_NOT_FOUND');
    }

    if (!this.instanceData[instanceId]) {
      this.instanceData[instanceId] = [];
    }

    const existingOverrideIndex = this.instanceData[instanceId].findIndex(ca => ca.id === globalAssetId && !ca.is_ugc);
    if (existingOverrideIndex >= 0) {
      this.instanceData[instanceId][existingOverrideIndex] = {
        ...this.instanceData[instanceId][existingOverrideIndex],
        ...overrides
      };
    } else {
      this.instanceData[instanceId].push({
        ...globalExists,
        ...overrides,
        id: globalAssetId,
        is_ugc: false
      });
    }
  }

  async createUgcAsset(instanceId: string, assetData: Omit<MergedAsset, 'id' | 'is_ugc'>): Promise<string> {
    if (!instanceId) throw new Error('ERR_INSTANCE_NOT_FOUND');

    // 模拟沙箱校验与配额校验
    if (!assetData.execution_logic.match(/^[a-zA-Z0-9_\{\} ]+$/)) {
      throw new Error('ERR_RCON_INJECTION');
    }

    if (!this.instanceData[instanceId]) {
      this.instanceData[instanceId] = [];
    }

    const currentUgcCount = this.instanceData[instanceId].filter(a => a.is_ugc).length;
    if (currentUgcCount >= 50) {
      throw new Error('ERR_UGC_LIMIT_EXCEEDED');
    }

    const newId = `ugc_${Math.random().toString(36).substr(2, 9)}`;
    this.instanceData[instanceId].push({
      ...assetData,
      id: newId,
      is_ugc: true
    });

    return newId;
  }
}