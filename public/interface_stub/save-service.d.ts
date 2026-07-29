/**
 * save-service.d.ts — saveService 接口存根
 *
 * 职责：存档记录管理（列表/创建/删除/设置活动存档）
 * 数据契约：public/schema/save-records-schema.json
 * 来源：scheme-final-merged.md §4.3.6 P4 / §7.1 P4
 */

import type { SaveRecord } from './shared-types';
import { SaveNotFoundError } from './shared-types';

export interface SaveService {
  /**
   * 列出服务器所有存档记录。
   */
  listSaves(serverId: string): Promise<SaveRecord[]>;

  /**
   * 创建存档记录。通过 Daemon 执行 save_world 命令后写入 save_records。
   * @param saveName 存档名（UNIQUE(server_id, save_name)）
   * @throws {SaveNotFoundError} 应仅在内部异常时抛出（如 Daemon 不可达）
   */
  createSave(serverId: string, saveName: string): Promise<SaveRecord>;

  /**
   * 删除存档记录及对应文件（通过 Daemon）。
   * @throws {SaveNotFoundError} saveName 不存在
   */
  deleteSave(serverId: string, saveName: string): Promise<void>;

  /**
   * 设置活动存档。每服务器仅一条 is_active=true，先清除其他再置当前。
   * @throws {SaveNotFoundError} saveName 不存在
   */
  setActiveSave(serverId: string, saveName: string): Promise<void>;
}

export { SaveNotFoundError } from './shared-types';
