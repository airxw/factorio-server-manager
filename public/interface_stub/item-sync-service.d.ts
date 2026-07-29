/**
 * item-sync-service.d.ts — itemSyncService 接口存根
 *
 * 职责：按 Pack.items.source 定时从 GitHub 拉取物品 JSON，写入 item_sync_log 表并缓存
 * 数据契约：public/schema/item-sync-log-schema.json
 * 来源：scheme-final-merged.md §3.3 items 字段 / §7.1 P1 / §8.1 R3
 */

import type { PackItem, ItemSyncLog } from './shared-types';
import { ItemSyncFailedError } from './shared-types';

export interface ItemSyncService {
  /**
   * 从 GitHub 拉取物品 JSON 并缓存。失败重试 3 次后标记 failed 并写入 item_sync_log。
   * @param packId 目标 Pack ID（必须 source.type=github_sync）
   * @returns {success, itemsCount, error?} itemsCount 为本次拉取的物品数量
   * @throws {ItemSyncFailedError} 3 次重试均失败
   */
  syncFromGithub(
    packId: string,
  ): Promise<{ success: boolean; itemsCount: number; error?: string }>;

  /**
   * 获取已缓存的物品列表（static 模式直接返回 Pack.items.static_list；
   * github_sync 模式返回最近一次成功同步的物品）。
   * @throws {PackNotFoundError} packId 不存在
   */
  getCachedItems(packId: string): Promise<PackItem[]>;

  /**
   * 获取同步日志（按时间倒序）。
   * @param limit 默认 50
   */
  getSyncLog(packId: string, limit?: number): Promise<ItemSyncLog[]>;
}

export { ItemSyncFailedError } from './shared-types';
