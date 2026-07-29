/**
 * mod-service.d.ts — modService 接口存根
 *
 * 职责：Mod 管理记录（安装/启用/卸载）
 * 数据契约：public/schema/mod-records-schema.json
 * 来源：scheme-final-merged.md §4.3.6 P4 / §7.1 P4
 *
 * 说明：factorio 原用文件系统管理，本表为 gameserver-panel 统一管理设计；
 * Panel 决策 + DB 记录，Daemon 执行文件操作
 */

import type { ModRecord } from './shared-types';
import { ModNotFoundError, ModInstallFailedError } from './shared-types';

export interface ModService {
  /**
   * 列出服务器已安装的 Mod。
   */
  listMods(serverId: string): Promise<ModRecord[]>;

  /**
   * 安装 Mod。从 sourceUrl 下载，通过 Daemon 写入服务器 Mod 目录，写入 mod_records 记录。
   * @param modName Mod 名称
   * @param sourceUrl Mod 下载源 URL
   * @returns 创建的 Mod 记录
   * @throws {ModInstallFailedError} 下载失败 / Daemon 写入失败 / 版本冲突
   */
  installMod(serverId: string, modName: string, sourceUrl: string): Promise<ModRecord>;

  /**
   * 启用/禁用 Mod。UPDATE mod_records SET enabled=?。
   * @throws {ModNotFoundError} serverId + modName 不存在
   */
  toggleMod(serverId: string, modName: string, enabled: boolean): Promise<void>;

  /**
   * 卸载 Mod。通过 Daemon 删除 Mod 文件，删除 mod_records 记录。
   * @throws {ModNotFoundError} serverId + modName 不存在
   */
  uninstallMod(serverId: string, modName: string): Promise<void>;
}

export { ModNotFoundError, ModInstallFailedError } from './shared-types';
