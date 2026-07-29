// ============================================================================
// dbBackupService — 数据库自动备份服务 (v3.9.0-D1)
//
// 职责：
//   - 周期性复制 SQLite DB 文件到 backup.path/.db-backup/ 目录
//   - 按 backup.db_retention_days 自动清理过期备份
//   - 备份文件名格式：panel-YYYYMMDD-HHmmss.db
//   - 通过 SQLite VACUUM INTO 或文件复制实现（生产用复制 + WAL checkpoint）
//
// 设计要点：
//   - 使用 SQLite 的 PRAGMA wal_checkpoint(FULL) 确保所有 WAL 内容写回主 DB
//   - 直接 fs.copyFile 复制 .db 文件，无需停服
//   - 失败时仅记录日志不抛出（避免影响 scheduler 其他任务）
//   - 备份目录不存在时自动创建
//   - 清理过期文件按 mtime 判定，避免时区问题
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { SettingSchemaService } from './settingSchemaService.js';

/** 备份目录名（相对 backup.path 的子目录，与实例备份隔离） */
const DB_BACKUP_SUBDIR = '.db-backup';

/** 备份文件名前缀 */
const DB_BACKUP_PREFIX = 'panel-';

/** 时间戳格式：YYYYMMDD-HHmmss */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export interface DbBackupResult {
  backed_up: boolean;
  file_path: string | null;
  cleaned_count: number;
  error?: string;
}

export interface DbBackupService {
  /** 执行一次备份 + 清理过期文件 */
  runBackup(): Promise<DbBackupResult>;
  /** 仅清理过期文件（手动触发） */
  cleanupExpired(): Promise<number>;
  /** 列出已有备份文件 */
  listBackups(): Promise<Array<{ name: string; size_bytes: number; mtime: string }>>;
}

export function createDbBackupService(
  db: Knex,
  settingSchemaService: SettingSchemaService,
  logger: Logger,
): DbBackupService {
  /** 解析备份目录绝对路径 */
  async function resolveBackupDir(): Promise<string> {
    const basePath = await settingSchemaService.getString('backup.path');
    const dir = path.resolve(basePath, DB_BACKUP_SUBDIR);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /** 获取 SQLite DB 文件路径 */
  function getDbFilePath(): string {
    // Knex 配置 connection.filename 在 init 时设置，此处从 client 配置读取
    const cfg = db.client.config;
    const filename = (cfg.connection as { filename?: string } | undefined)?.filename;
    if (!filename) {
      throw new Error('无法从 Knex 配置读取 DB filename');
    }
    return filename;
  }

  /** 执行 WAL checkpoint，确保所有改动写回主 DB 文件 */
  async function checkpointWal(): Promise<void> {
    // PRAGMA wal_checkpoint 是 SQLite 专属语法，PostgreSQL 不支持
    if (db.client.dialect !== 'sqlite') {
      return;
    }
    try {
      await db.raw('PRAGMA wal_checkpoint(FULL)');
    } catch (err) {
      // WAL 模式未启用时 raw 会失败，记录但不阻断（fs.copyFile 仍可复制当前主 DB）
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        '[dbBackupService] wal_checkpoint 失败（可能未启用 WAL，继续）',
      );
    }
  }

  /** 清理过期备份文件 */
  async function cleanupExpired(): Promise<number> {
    const retentionDays = await settingSchemaService.getNumber('backup.db_retention_days');
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return 0;
    }
    const dir = await resolveBackupDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return 0;
    }

    let cleaned = 0;
    for (const name of entries) {
      if (!name.startsWith(DB_BACKUP_PREFIX) || !name.endsWith('.db')) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(full);
          cleaned++;
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), file: name },
          '[dbBackupService] 清理过期备份失败',
        );
      }
    }
    return cleaned;
  }

  /** 列出已有备份 */
  async function listBackups(): Promise<Array<{ name: string; size_bytes: number; mtime: string }>> {
    const dir = await resolveBackupDir();
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return [];
    }
    const result: Array<{ name: string; size_bytes: number; mtime: string }> = [];
    for (const name of entries) {
      if (!name.startsWith(DB_BACKUP_PREFIX) || !name.endsWith('.db')) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(full);
        result.push({
          name,
          size_bytes: stat.size,
          mtime: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        // 文件可能已被删除，跳过
      }
    }
    // 按 mtime 倒序（最新在前）
    result.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return result;
  }

  return {
    async runBackup(): Promise<DbBackupResult> {
      try {
        const enabled = await settingSchemaService.getBoolean('backup.db_enabled');
        if (!enabled) {
          return { backed_up: false, file_path: null, cleaned_count: 0 };
        }

        // 非 SQLite 数据库不适用文件复制备份（PostgreSQL 应使用 pg_dump 等策略）
        if (db.client.dialect !== 'sqlite') {
          logger.info(
            '[dbBackupService] 非 SQLite 数据库，跳过文件备份（PostgreSQL 请用 pg_dump）',
          );
          return { backed_up: false, file_path: null, cleaned_count: 0 };
        }

        // 1. WAL checkpoint 确保数据落盘
        await checkpointWal();

        // 2. 复制 DB 文件
        const srcPath = getDbFilePath();
        if (!fs.existsSync(srcPath)) {
          throw new Error(`DB 文件不存在: ${srcPath}`);
        }
        const dir = await resolveBackupDir();
        const fileName = `${DB_BACKUP_PREFIX}${formatTimestamp(new Date())}.db`;
        const destPath = path.join(dir, fileName);
        await fs.promises.copyFile(srcPath, destPath, fs.constants.COPYFILE_FICLONE);

        // 3. 清理过期备份
        const cleaned = await cleanupExpired();

        logger.info(
          { dest: destPath, size: fs.statSync(destPath).size, cleaned },
          '[dbBackupService] DB 备份完成',
        );
        return { backed_up: true, file_path: destPath, cleaned_count: cleaned };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, '[dbBackupService] DB 备份失败');
        return { backed_up: false, file_path: null, cleaned_count: 0, error: message };
      }
    },
    cleanupExpired,
    listBackups,
  };
}
