// ============================================================================
// 模块4_Daemon实例管理 — InstanceLogWriter
// 职责：将实例进程 stdout/stderr 持久化到文件，支持按大小轮转
// 日志路径：{workdir}/logs/server.log，轮转文件 server.log.1 / .2 / .3 / .4 / .5
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

/** B13: 日志文件信息（列表 API 返回值）。 */
export interface LogFileInfo {
  filename: string;
  size: number;
  mtime: string;
}

/**
 * 实例日志写入器：将 stdout/stderr 写入文件，支持大小轮转。
 *
 * 轮转策略（B11）：当当前日志文件大小达到 maxBytes（10MB）时，关闭写入流并执行滚动——
 * server.log.{n-1} → server.log.{n}（超出 maxBackups=5 的最旧备份被删除），
 * 随后将 server.log 重命名为 server.log.1 并打开新的写入流。
 * 启动时自动清理超出 maxBackups 的旧文件。
 */
export class InstanceLogWriter {
  private readonly logDir: string;
  private readonly logPath: string;
  private readonly maxBytes: number;
  private readonly maxBackups: number;
  private writeStream: fs.WriteStream | null = null;
  private currentSize = 0;

  constructor(workdir: string, options?: { maxBytes?: number; maxBackups?: number }) {
    this.logDir = path.join(workdir, 'logs');
    this.logPath = path.join(this.logDir, 'server.log');
    this.maxBytes = options?.maxBytes ?? 10 * 1024 * 1024; // 10MB
    // B11: 保留最近 5 个轮转文件
    this.maxBackups = options?.maxBackups ?? 5;
  }

  /** 初始化：创建目录，清理旧文件，打开写入流（追加模式）。 */
  async init(): Promise<void> {
    await fs.promises.mkdir(this.logDir, { recursive: true });
    // B11: 启动时清理超出 maxBackups 的旧轮转文件
    this.cleanOldLogFiles();
    this.openStream();
  }

  private openStream(): void {
    this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    this.currentSize = fs.existsSync(this.logPath) ? fs.statSync(this.logPath).size : 0;
  }

  /** 写入一行日志。stream 为 stderr 时加 [ERR] 前缀便于排查。 */
  write(line: string, stream: 'stdout' | 'stderr'): void {
    if (!this.writeStream) return;
    const prefix = stream === 'stderr' ? '[ERR] ' : '';
    const data = `${prefix}${line}\n`;
    this.writeStream.write(data);
    this.currentSize += Buffer.byteLength(data);
    if (this.currentSize >= this.maxBytes) {
      void this.rotate();
    }
  }

  /**
   * 轮转：关闭当前流，逐级重命名旧备份，打开新流。
   * 依靠 rename 在 Linux 上原子替换目标文件来淘汰最旧备份。
   */
  private async rotate(): Promise<void> {
    this.writeStream?.end();
    // server.log.2 → server.log.3, server.log.1 → server.log.2 ...
    // 超出 maxBackups 的最旧备份通过 rename 覆盖淘汰
    for (let i = this.maxBackups - 1; i >= 1; i--) {
      const from = `${this.logPath}.${i}`;
      const to = `${this.logPath}.${i + 1}`;
      if (fs.existsSync(from)) {
        if (i + 1 > this.maxBackups) {
          await fs.promises.unlink(from);
        } else {
          await fs.promises.rename(from, to);
        }
      }
    }
    if (fs.existsSync(this.logPath)) {
      await fs.promises.rename(this.logPath, `${this.logPath}.1`);
    }
    this.currentSize = 0;
    this.openStream();
  }

  /**
   * B11: 清理超出 maxBackups 的旧轮转文件。
   * 扫描日志目录，删除 server.log.N 中 N > maxBackups 的文件。
   */
  private cleanOldLogFiles(): void {
    try {
      const files = fs.readdirSync(this.logDir);
      for (const file of files) {
        const match = file.match(/^server\.log\.(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > this.maxBackups) {
            try {
              fs.unlinkSync(path.join(this.logDir, file));
            } catch {
              // 忽略删除错误
            }
          }
        }
      }
    } catch {
      // 忽略目录读取错误
    }
  }

  /** 关闭写入流（保留历史文件，实例重启时重新打开）。 */
  close(): void {
    this.writeStream?.end();
    this.writeStream = null;
  }

  /**
   * 读取历史日志（用于 API）。
   * @param limit 返回的最大行数（从末尾截取）
   * @param offset 从末尾跳过的行数（分页偏移）
   * @returns 日志行数组；文件不存在时返回空数组
   */
  async readHistory(limit: number = 100, offset: number = 0): Promise<string[]> {
    try {
      const content = await fs.promises.readFile(this.logPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-limit - offset, offset === 0 ? undefined : -offset);
    } catch {
      return [];
    }
  }

  /**
   * B12: 跨文件聚合日志读取。
   * 按时间倒序（当前文件 → server.log.1 → server.log.2 → ...）聚合多个文件，
   * 返回最近 count 行。
   * @param count 返回的最大行数
   * @returns 聚合后的日志行数组（旧→新顺序）
   */
  readRecentLogsFromFiles(count: number): string[] {
    const result: string[] = [];
    try {
      // 收集当前文件 + 所有轮转文件，按编号排序（0=当前，1=最新备份，...）
      const files: { path: string; order: number }[] = [];
      if (fs.existsSync(this.logPath)) {
        files.push({ path: this.logPath, order: 0 });
      }
      for (let i = 1; i <= this.maxBackups; i++) {
        const backupPath = `${this.logPath}.${i}`;
        if (fs.existsSync(backupPath)) {
          files.push({ path: backupPath, order: i });
        }
      }
      // 按 order 升序（当前 → 最新备份 → 最旧备份）
      files.sort((a, b) => a.order - b.order);

      // 从最新文件往前补充，直到凑够 count 行
      for (let i = files.length - 1; i >= 0 && result.length < count; i--) {
        try {
          const content = fs.readFileSync(files[i].path, 'utf8');
          const lines = content.split('\n').filter((l) => l.length > 0);
          result.unshift(...lines);
          if (result.length > count) {
            result.splice(0, result.length - count);
          }
        } catch {
          // 忽略读取错误
        }
      }
    } catch {
      // 忽略目录读取错误
    }
    return result;
  }

  /**
   * B13: 列出所有可用的日志文件，按修改时间倒序。
   * @returns 日志文件信息数组
   */
  listLogFiles(): LogFileInfo[] {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter((f) => f === 'server.log' || /^server\.log\.\d+$/.test(f))
        .map((f) => {
          const fp = path.join(this.logDir, f);
          const stat = fs.statSync(fp);
          return {
            filename: f,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
      return files;
    } catch {
      return [];
    }
  }

  /**
   * B13: 读取指定日志文件的内容（返回最后 count 行）。
   * @param filename 日志文件名（仅文件名，不含路径）
   * @param count 返回最后 N 行，默认全部
   * @returns 日志行数组
   * @throws Error 文件名无效或文件不存在
   */
  readLogFile(filename: string, count?: number): string[] {
    // B13: 路径穿越防护 — 仅允许 server.log 或 server.log.N 格式的文件名
    const safeName = path.basename(filename);
    if (safeName !== 'server.log' && !/^server\.log\.\d+$/.test(safeName)) {
      throw new Error(`Invalid log file name: ${filename}`);
    }
    const filePath = path.join(this.logDir, safeName);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      let lines = content.split('\n').filter((l) => l.length > 0);
      if (count && count > 0 && lines.length > count) {
        lines = lines.slice(-count);
      }
      return lines;
    } catch {
      throw new Error(`Log file not found: ${safeName}`);
    }
  }

  /**
   * B13: 删除指定日志文件。
   * @param filename 日志文件名（仅文件名，不含路径）
   * @throws Error 文件名无效或文件不存在
   */
  deleteLogFile(filename: string): void {
    // B13: 路径穿越防护 — 仅允许 server.log.N 格式的备份文件名（不允许删除当前正在写入的 server.log）
    const safeName = path.basename(filename);
    if (!/^server\.log\.\d+$/.test(safeName)) {
      throw new Error(`Invalid log file name: ${filename} (only backup files server.log.N can be deleted)`);
    }
    const filePath = path.join(this.logDir, safeName);
    try {
      fs.unlinkSync(filePath);
    } catch {
      throw new Error(`Log file not found: ${safeName}`);
    }
  }
}
