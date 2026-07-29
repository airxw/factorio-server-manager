/**
 * @version 1.0.0
 * @description 商业化核心接口契约 (TS 替代 .pyi 以适配 Node.js 栈)
 */

export interface MergedAsset {
  id: string; // 最终展示的商品ID（通常为 instance_asset_id 或 global_asset_id）
  name: string;
  price: number;
  is_active: boolean;
  is_ugc: boolean;
  execution_logic: string; // 只有系统管理员或发货进程可读取
}

export interface IAssetService {
  /**
   * @description 实例管理员获取商城列表（自动合并 Global 和 Instance 的数据）
   * @throws ERR_INSTANCE_NOT_FOUND
   */
  getMergedAssets(instanceId: string): Promise<MergedAsset[]>;

  /**
   * @description 实例管理员覆盖全局资产属性
   * @throws ERR_OVERRIDE_FORBIDDEN, ERR_ASSET_NOT_FOUND
   */
  overrideAsset(instanceId: string, globalAssetId: string, overrides: Partial<MergedAsset>): Promise<void>;

  /**
   * @description 实例管理员创建 UGC 资产
   * @throws ERR_UGC_LIMIT_EXCEEDED, ERR_RCON_INJECTION
   */
  createUgcAsset(instanceId: string, assetData: Omit<MergedAsset, 'id' | 'is_ugc'>): Promise<string>;
}

export interface IExecutionEngine {
  /**
   * @description 玩家购买后触发发货逻辑，沙箱内执行
   * @throws ERR_RCON_INJECTION, ERR_EXECUTION_FAILED
   */
  executeLogic(instanceId: string, logicString: string, variables: Record<string, string>): Promise<boolean>;
}
