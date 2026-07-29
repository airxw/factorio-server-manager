/**
 * list-service.d.ts — listService 接口存根
 *
 * 职责：白名单/黑名单统一管理
 * 数据契约：public/schema/list-entries-schema.json
 * 来源：scheme-final-merged.md §4.3.6 P4 / §3.5 lists / §7.1 P4
 */

import type { ListEntry, ListType } from './shared-types';
import { EntryNotFoundError, EntryAlreadyExistsError } from './shared-types';

export interface ListService {
  /**
   * 添加名单条目。UNIQUE(server_id, list_type, player_name) 防重复。
   * 添加后按 Pack.business.lists.whitelist_add / banlist_add 渲染命令下发到 Daemon。
   * @param listType 'whitelist' 或 'banlist'
   * @param player 游戏内玩家名
   * @param addedBy 添加者用户 ID
   * @param reason 添加原因（可空）
   * @returns 创建的名单条目
   * @throws {EntryAlreadyExistsError} 条目已存在
   */
  addEntry(
    serverId: string,
    listType: ListType,
    player: string,
    addedBy: string,
    reason?: string,
  ): Promise<ListEntry>;

  /**
   * 移除名单条目。
   * @throws {EntryNotFoundError} 条目不存在
   */
  removeEntry(
    serverId: string,
    listType: ListType,
    player: string,
  ): Promise<void>;

  /**
   * 列出名单条目。
   */
  listEntries(serverId: string, listType: ListType): Promise<ListEntry[]>;
}

export { EntryNotFoundError, EntryAlreadyExistsError } from './shared-types';
