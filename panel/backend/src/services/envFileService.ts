// ============================================================================
// envFileService — v4.20.0 .env 文件读写服务
//
// 设计目标：
//   Setup Wizard v2 提交时，将用户在向导内填写的数据库连接串、公网入口 URL、
//   Daemon URL 等配置写入 panel/backend/.env 文件，并保留原文件的注释与空行结构。
//
// 核心能力：
//   - readEnvFile(): 读取 .env 为 KV 对象
//   - writeEnvFile(updates): 原子写入 .env（备份 + 仅更新指定字段 + 追加新字段）
//   - validateEnvPath(): 校验 .env 路径存在且可写
//
// 来源：docs/plans/setup-wizard-v2-configuration-plan.md §4.5
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

/**
 * .env 文件路径解析策略：
 *   - 优先用注入的 envPath（便于测试）
 *   - 否则用 process.cwd()/.env（Panel 后端 cwd = panel/backend/，生产为 /opt/gameserver-panel/panel/backend/）
 */
export interface EnvFileServiceDeps {
  /** .env 文件绝对路径（测试时注入临时路径；生产留空用 process.cwd()/.env） */
  envPath?: string;
}

export class EnvFileService {
  private readonly envPath: string;

  constructor(deps: EnvFileServiceDeps = {}) {
    this.envPath = deps.envPath ?? path.resolve(process.cwd(), '.env');
  }

  /** 获取 .env 文件绝对路径（供外部读取/调试） */
  getEnvPath(): string {
    return this.envPath;
  }

  /**
   * 校验 .env 文件存在且可写。
   * 不存在时抛错——Setup Wizard 不应自动创建 .env（应由部署脚本预置）。
   */
  validateEnvPath(): void {
    if (!fs.existsSync(this.envPath)) {
      throw new Error(`.env 文件不存在：${this.envPath}`);
    }
    // 校验可写
    try {
      fs.accessSync(this.envPath, fs.constants.W_OK);
    } catch {
      throw new Error(`.env 文件不可写：${this.envPath}（请检查文件权限）`);
    }
  }

  /**
   * 读取 .env 文件为 KV 对象。
   * - 忽略注释行（# 开头）和空行
   * - 解析 KEY=VALUE 格式（VALUE 不去引号，保留原样）
   * - 重复 KEY 时后出现的覆盖先出现的
   */
  async readEnvFile(): Promise<Record<string, string>> {
    this.validateEnvPath();
    const content = await fs.promises.readFile(this.envPath, 'utf8');
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1);
      if (!key) continue;
      result[key] = value;
    }
    return result;
  }

  /**
   * 原子写入 .env 文件——仅更新 updates 中提供的字段，其他字段保持不变。
   *
   * 流程：
   *   1. 校验 .env 路径可写
   *   2. 备份原文件到 .env.bak.<YYYYMMDDHHmmss>
   *   3. 读取原文件所有行（保留注释和空行结构）
   *   4. 对每行：如果是 KEY=VALUE 形式且 KEY 在 updates 中，替换为 `KEY=新值`
   *   5. updates 中剩余未匹配的 KEY，追加到文件末尾（前加注释标记）
   *   6. 原子写入：先写 .env.tmp，再 rename 为 .env
   *
   * @param updates 需要更新的字段 KV（值为新值；不会删除原有未列出的字段）
   * @returns 备份文件路径
   */
  async writeEnvFile(updates: Record<string, string>): Promise<{ backupPath: string; updatedKeys: string[]; appendedKeys: string[] }> {
    this.validateEnvPath();

    if (Object.keys(updates).length === 0) {
      return { backupPath: '', updatedKeys: [], appendedKeys: [] };
    }

    // 1. 备份
    const backupPath = await this.backupEnvFile();

    // 2. 读取原文件
    const originalContent = await fs.promises.readFile(this.envPath, 'utf8');
    const originalLines = originalContent.split(/\r?\n/);
    // 保留末尾换行情况（如果原文件以 \n 结尾，split 会产生一个空字符串末尾元素）
    const hadTrailingNewline = originalContent.endsWith('\n');

    // 3. 逐行更新
    // 注意：用 seenKeys（Set）追踪已匹配过的 KEY，而不是 delete remainingUpdates[key]——
    // 这样原文件中重复出现的 KEY 会被全部替换为新值，避免旧行残留导致程序读到旧值。
    // （.env 重复 KEY 本身是用户错误，但向导作为自动化工具应保证配置生效。）
    const remainingUpdates = { ...updates };
    const seenKeys = new Set<string>();
    const updatedKeys: string[] = [];
    const updatedLines = originalLines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return line;
      const key = trimmed.slice(0, eqIdx).trim();
      if (key in remainingUpdates) {
        const newValue = remainingUpdates[key];
        seenKeys.add(key);
        updatedKeys.push(key);
        return `${key}=${newValue}`;
      }
      return line;
    });

    // 从 remainingUpdates 移除已匹配过的 KEY，剩下的就是需要追加的新字段
    for (const key of seenKeys) {
      delete remainingUpdates[key];
    }

    // 4. 追加未匹配的新字段
    const appendedKeys: string[] = [];
    if (Object.keys(remainingUpdates).length > 0) {
      // 在文件末尾追加（如果原文件末尾有换行，updatedLines 末尾会有一个空字符串元素）
      // 移除末尾空字符串元素（如果有），统一处理
      if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === '') {
        updatedLines.pop();
      }
      // 追加分隔注释
      updatedLines.push('');
      updatedLines.push('# v4.20.0 Setup Wizard v2 追加字段');
      for (const [key, value] of Object.entries(remainingUpdates)) {
        updatedLines.push(`${key}=${value}`);
        appendedKeys.push(key);
      }
    }

    // 5. 重建内容（保留原文件末尾换行习惯）
    let newContent = updatedLines.join('\n');
    if (hadTrailingNewline) {
      newContent += '\n';
    }

    // 6. 原子写入（.env.tmp → rename .env）
    const tmpPath = `${this.envPath}.tmp.${process.pid}`;
    await fs.promises.writeFile(tmpPath, newContent, 'utf8');
    await fs.promises.rename(tmpPath, this.envPath);

    return { backupPath, updatedKeys, appendedKeys };
  }

  /**
   * 备份 .env 文件到 .env.bak.<YYYYMMDDHHmmss>。
   * 同一秒内多次调用会覆盖之前的备份（罕见场景，可接受）。
   */
  private async backupEnvFile(): Promise<string> {
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const backupPath = `${this.envPath}.bak.${ts}`;
    await fs.promises.copyFile(this.envPath, backupPath);
    return backupPath;
  }
}

/**
 * 工厂函数——供 routes-registry / app.ts 注入时调用
 */
export function createEnvFileService(deps: EnvFileServiceDeps = {}): EnvFileService {
  return new EnvFileService(deps);
}
