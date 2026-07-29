// ============================================================================
// itemSyncService — Pack 物品同步服务
// 接口契约：@public/interface_stub/item-sync-service.d.ts
// 数据契约：public/schema/item-sync-log-schema.json
// 来源：scheme-final-merged.md §3.3 items 字段 / §7.1 P1 / §8.1 R3
//
// 职责：按 Pack.items.source 定时从 GitHub 拉取物品 JSON，写入 item_sync_log
// 表并缓存到内存。失败重试 3 次（指数退避 1s/2s/4s）后标记 failed。
// ============================================================================

import type { Knex } from 'knex';
import type { ItemSyncService } from '@public/interface_stub/item-sync-service';
import type {
  PackItem,
  ItemSyncLog,
  ItemSyncStatus,
} from '@public/interface_stub/shared-types';
import { PackNotFoundError, ItemSyncFailedError } from './errors.js';
import type { PackRegistry } from '../core/packs/registry.js';
import { eventBus } from './eventBus.js';

// ----- DB 行类型 -----

/** item_sync_log 表行（与 ItemSyncLog 结构一致） */
interface ItemSyncLogRow {
  id: number;
  pack_id: string;
  source_url: string;
  status: string;
  items_count: number | null;
  synced_at: string;
  error_message: string | null;
  created_at: string;
  retention_days: number;
}

// ----- 重试配置 -----

/** 指数退避间隔（ms）：1s / 2s / 4s，对应 3 次重试前的等待 */
const RETRY_BACKOFF_MS = [1000, 2000, 4000];
/** 最大尝试次数 = 初始 1 次 + 3 次重试 */
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 物品同步服务实现
 *
 * 设计要点：
 * - syncFromGithub 从 pack.items.source.url 拉取 JSON，3 次重试（指数退避 1s/2s/4s）
 * - 成功：解析为 PackItem[]，写入 item_sync_log (status=success)，缓存到内存 Map
 * - 失败（3 次重试均失败）：写入 item_sync_log (status=failed)，抛 ItemSyncFailedError
 * - getCachedItems：static 模式返回 static_list；github_sync 模式返回内存缓存
 * - getSyncLog：按 created_at 倒序查询 item_sync_log
 */
export class ItemSyncServiceImpl implements ItemSyncService {
  /** packId -> 已缓存的物品列表（最近一次成功同步结果） */
  private readonly cache: Map<string, PackItem[]> = new Map();

  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
  ) {}

  async syncFromGithub(
    packId: string,
  ): Promise<{ success: boolean; itemsCount: number; error?: string }> {
    const pack = this.registry.get(packId);
    if (!pack) {
      throw new PackNotFoundError(`Pack not found: ${packId}`);
    }

    const items = pack.items;
    if (!items || items.source.type !== 'github_sync') {
      throw new ItemSyncFailedError(
        `Pack ${packId} items.source.type is not 'github_sync'`,
      );
    }
    const sourceUrl = items.source.url;
    if (!sourceUrl) {
      throw new ItemSyncFailedError(
        `Pack ${packId} github_sync source missing url`,
      );
    }

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(sourceUrl);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const json: unknown = await res.json();
        const parsed = parsePackItems(json);

        // 成功：写日志 + 缓存
        await this.writeLog({
          pack_id: packId,
          source_url: sourceUrl,
          status: 'success',
          items_count: parsed.length,
          error_message: null,
        });
        this.cache.set(packId, parsed);
        // C10: 同步成功后发射 'items.synced' 事件，通知商城刷新缓存
        try {
          eventBus.emit('items.synced', {
            pack_id: packId,
            items_count: parsed.length,
            synced_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error(
            `[itemSyncService] emit items.synced 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return { success: true, itemsCount: parsed.length };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // 非最后一次失败 → 等待退避后重试
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BACKOFF_MS[attempt - 1]);
        }
      }
    }

    // 全部重试均失败：写 failed 日志并抛错（接口契约 @throws ItemSyncFailedError）
    await this.writeLog({
      pack_id: packId,
      source_url: sourceUrl,
      status: 'failed',
      items_count: null,
      error_message: lastError,
    });
    throw new ItemSyncFailedError(
      `Sync failed for pack ${packId} after ${MAX_ATTEMPTS} attempts: ${lastError}`,
    );
  }

  async getCachedItems(packId: string): Promise<PackItem[]> {
    const pack = this.registry.get(packId);
    if (!pack) {
      throw new PackNotFoundError(`Pack not found: ${packId}`);
    }

    const items = pack.items;
    // static 模式：直接返回 static_list
    if (items && items.source.type === 'static') {
      return items.static_list ?? [];
    }

    // github_sync 模式：返回内存缓存（未同步过则返回空数组并 warn）
    if (items && items.source.type === 'github_sync') {
      const cached = this.cache.get(packId);
      if (!cached) {
        console.warn(
          `[itemSyncService] pack ${packId} has no cached items yet; call syncFromGithub first`,
        );
        return [];
      }
      return cached;
    }

    // local_file 或未配置 items → 返回空
    return [];
  }

  async getSyncLog(packId: string, limit = 50): Promise<ItemSyncLog[]> {
    const rows = await this.db<ItemSyncLogRow>('item_sync_log')
      .where({ pack_id: packId })
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.map(toItemSyncLog);
  }

  /**
   * v3.6.2-A3: 清理超过 retention_days 的物品同步日志（全表统一 retention）
   * 返回删除的行数
   */
  async cleanupOldLogs(): Promise<number> {
    const sample = await this.db<ItemSyncLogRow>('item_sync_log').select('retention_days').first();
    const retentionDays = sample?.retention_days ?? 30;
    if (retentionDays <= 0) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffIso = cutoff.toISOString();

    const deleted = await this.db<ItemSyncLogRow>('item_sync_log')
      .where('created_at', '<', cutoffIso)
      .delete();

    return deleted;
  }

  /**
   * v3.6.2-A6: 更新 item_sync_log 表的 retention_days（全表统一）
   */
  async updateRetentionDays(retentionDays: number): Promise<void> {
    await this.db<ItemSyncLogRow>('item_sync_log').update({ retention_days: retentionDays });
  }

  /**
   * v3.6.2-A4: 获取 item_sync_log 表的 retention_days 与行数
   */
  async getRetentionStats(): Promise<{ retention_days: number; row_count: number }> {
    const sample = await this.db<ItemSyncLogRow>('item_sync_log').select('retention_days').first();
    const countResult = await this.db<ItemSyncLogRow>('item_sync_log').count<{ cnt: number | string }>('* as cnt').first();
    return {
      retention_days: sample?.retention_days ?? 30,
      row_count: Number(countResult?.cnt ?? 0),
    };
  }

  /**
   * C10: 手动触发物品同步。
   *
   * - 指定 packId：同步单个 Pack
   * - 未指定 packId：同步所有 source.type='github_sync' 的 Pack
   *
   * 同步成功后通过 eventBus 发射 'items.synced' 事件（在 syncFromGithub 内部），
   * 通知商城刷新缓存。单个 Pack 同步失败不阻断其他 Pack。
   *
   * @param packId 可选，指定 Pack ID；未指定则同步全部 github_sync Pack
   * @returns 同步结果摘要（total / succeeded / failed / details）
   */
  async triggerSync(packId?: string): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    details: Array<{
      pack_id: string;
      success: boolean;
      items_count?: number;
      error?: string;
    }>;
  }> {
    // 确定要同步的 Pack 列表
    let targetPacks: Array<{ packId: string; isGithubSync: boolean }>;

    if (packId) {
      const pack = this.registry.get(packId);
      if (!pack) {
        throw new PackNotFoundError(`Pack not found: ${packId}`);
      }
      const isGithubSync =
        !!pack.items && pack.items.source.type === 'github_sync';
      targetPacks = [{ packId, isGithubSync }];
    } else {
      // 同步所有 github_sync 类型的 Pack
      targetPacks = this.registry
        .list()
        .filter((p) => p.items && p.items.source.type === 'github_sync')
        .map((p) => ({ packId: p.pack.id, isGithubSync: true }));
    }

    const details: Array<{
      pack_id: string;
      success: boolean;
      items_count?: number;
      error?: string;
    }> = [];

    for (const target of targetPacks) {
      if (!target.isGithubSync) {
        // 非 github_sync 类型 Pack，跳过（static / local_file 无需同步）
        details.push({
          pack_id: target.packId,
          success: false,
          error: 'Pack items.source.type 非 github_sync，无需同步',
        });
        continue;
      }
      try {
        const result = await this.syncFromGithub(target.packId);
        details.push({
          pack_id: target.packId,
          success: result.success,
          items_count: result.itemsCount,
        });
      } catch (err) {
        details.push({
          pack_id: target.packId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = details.filter((d) => d.success).length;
    const failed = details.length - succeeded;

    return {
      total: details.length,
      succeeded,
      failed,
      details,
    };
  }

  /**
   * 写入一条同步日志记录（id 自增，由 DB 生成）
   */
  private async writeLog(entry: {
    pack_id: string;
    source_url: string;
    status: 'success' | 'failed';
    items_count: number | null;
    error_message: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db('item_sync_log').insert({
      pack_id: entry.pack_id,
      source_url: entry.source_url,
      status: entry.status,
      items_count: entry.items_count,
      synced_at: now,
      error_message: entry.error_message,
      created_at: now,
    });
  }
}

// ----- 纯函数 / 转换函数 -----

/**
 * 校验并解析拉取到的 JSON 为 PackItem[]。
 * 期望 JSON 为数组，每个元素含非空字符串 name（与 PackItem 契约对齐）。
 */
function parsePackItems(json: unknown): PackItem[] {
  if (!Array.isArray(json)) {
    throw new Error(`Expected items JSON array, got ${typeof json}`);
  }
  return json.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Item at index ${i} is not an object`);
    }
    const item = raw as Record<string, unknown>;
    const name = item.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Item at index ${i} missing non-empty 'name'`);
    }
    const parsed: PackItem = { name };
    if (typeof item.display_name === 'string') {
      parsed.display_name = item.display_name;
    }
    if (typeof item.category === 'string') {
      parsed.category = item.category;
    }
    return parsed;
  });
}

/** DB 行 → ItemSyncLog（status 字符串收窄为 ItemSyncStatus 联合类型） */
function toItemSyncLog(row: ItemSyncLogRow): ItemSyncLog {
  return {
    id: row.id,
    pack_id: row.pack_id,
    source_url: row.source_url,
    status: row.status as ItemSyncStatus,
    items_count: row.items_count,
    synced_at: row.synced_at,
    error_message: row.error_message,
    created_at: row.created_at,
  };
}

/**
 * 创建 itemSyncService 的工厂函数
 *
 * v3.6.2: 返回类型改为具体实现类 ItemSyncServiceImpl，与 auditLogService/notificationService
 * 保持一致，使调用方能够访问 cleanupOldLogs/updateRetentionDays/getRetentionStats 等
 * retention 治理方法（ItemSyncService 接口仅声明业务方法）。
 */
export function createItemSyncService(
  db: Knex,
  registry: PackRegistry,
): ItemSyncServiceImpl {
  return new ItemSyncServiceImpl(db, registry);
}
