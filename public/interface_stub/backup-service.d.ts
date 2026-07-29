/**
 * backup-service.d.ts — backupService 接口存根
 *
 * 职责：备份任务管理（创建/恢复/删除）
 * 数据契约：public/schema/backup-records-schema.json
 * 来源：scheme-final-merged.md §4.3.6 P4 / §7.1 P4
 */

import type { BackupRecord } from './shared-types';
import { BackupNotFoundError, BackupFailedError } from './shared-types';

export interface BackupService {
  /**
   * 列出服务器备份记录（按时间倒序）。
   */
  listBackups(serverId: string): Promise<BackupRecord[]>;

  /**
   * 创建备份。通过 Daemon 打包服务器存档目录，写入 backup_records (status=in_progress)。
   * 备份完成后 UPDATE status=completed；失败 UPDATE status=failed。
   * @param createdBy 备份发起者用户 ID（自动备份时为系统用户 ID）
   * @returns 创建的备份记录（含 ID）
   * @throws {BackupFailedError} 备份过程失败
   */
  createBackup(serverId: string, createdBy: string): Promise<BackupRecord>;

  /**
   * 恢复备份。通过 Daemon 解压备份文件覆盖存档目录。
   * @returns {success} success=true 表示恢复成功
   * @throws {BackupNotFoundError} backupId 不存在
   * @throws {BackupFailedError} 恢复过程失败
   */
  restoreBackup(serverId: string, backupId: number): Promise<{ success: boolean }>;

  /**
   * 删除备份。通过 Daemon 删除备份文件，UPDATE backup_records SET status='deleted'。
   * @throws {BackupNotFoundError} backupId 不存在
   */
  deleteBackup(serverId: string, backupId: number): Promise<void>;
}

export { BackupNotFoundError, BackupFailedError } from './shared-types';
