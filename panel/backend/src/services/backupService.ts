// ============================================================================
// backupService — 备份记录管理 + 真实备份能力（P4 + C1/C2 增强）
// 数据契约：public/schema/panel-api-types.ts（BackupRecordSummary 等）
// 表结构：
//   backup_records (id, server_id, file_path, size_bytes, created_at,
//                   created_by, status)
//                   status: in_progress / completed / failed / deleted
// 来源：P4 任务清单 §备份 / 诊断 C1 真实文件打包 / C2 定时备份+保留策略
//
// C1 增强：
//   - createBackup: 通过 daemonClient.execCommand 执行 tar 打包（world_dir → .tar.gz）
//   - restoreBackup: 恢复前自动预备份，再解压备份文件到 world_dir
//   - downloadBackup: 通过 daemonClient.readFile 读取备份文件内容
// C2 增强：
//   - cleanupOldBackups: 按保留策略（max_count / max_age_days）清理旧备份
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import { BackupNotFoundError, InstanceNotFoundError, PackNotFoundError } from './errors.js';
import type {
  BackupRecordSummary,
  BackupStatus,
  CreateBackupRequest,
  UpdateBackupRequest,
} from '@public/schema/panel-api-types';
import type { GameType } from '@public/schema/pack-schema';

// ----- 常量 -----

/** 备份默认大小（字节） */
const DEFAULT_BACKUP_SIZE = 0;
/** 备份默认状态 */
const DEFAULT_BACKUP_STATUS: BackupStatus = 'in_progress';
/** 备份文件存放目录（相对实例 workdir） */
const BACKUP_DIR = 'backups';
/** 备份命令超时（5 分钟） */
const BACKUP_TIMEOUT_MS = 300_000;

// ----- C1: 游戏特化备份协议 -----
// 不同游戏在备份前需要通过游戏控制台（RCON/stdin）发送命令来确保世界数据落盘。
// 这些命令不是 shell 命令，必须通过 daemonClient.sendCommand 发送到游戏服务器。
// 之前这些命令被错误地放在 pack.yaml 的 pre_backup_commands 中通过 execCommand（shell）执行，
// 导致 "command not found" 错误，备份功能对所有游戏均失效。

interface GameBackupProtocol {
  /** 备份前通过游戏控制台发送的命令（如 save-off / save-all / save） */
  preCommands: string[];
  /** 备份后通过游戏控制台发送的命令（如 save-on） */
  postCommands: string[];
  /** preCommands 执行完成后等待多少毫秒再开始 tar（确保数据落盘） */
  delayMs: number;
}

const GAME_BACKUP_PROTOCOLS: Partial<Record<GameType, GameBackupProtocol>> = {
  minecraft: {
    preCommands: ['save-off', 'save-all'],
    postCommands: ['save-on'],
    delayMs: 2000,
  },
  factorio: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 3000,
  },
  rust: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 2000,
  },
  ark: {
    preCommands: ['SaveWorld'],
    postCommands: [],
    delayMs: 5000,
  },
  palworld: {
    preCommands: ['/AdminCommand save'],
    postCommands: [],
    delayMs: 3000,
  },
  terraria: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 2000,
  },
  dyson: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 2000,
  },
  zomboid: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 3000,
  },
  valheim: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 2000,
  },
  enshrouded: {
    preCommands: ['save'],
    postCommands: [],
    delayMs: 2000,
  },
  dst: {
    preCommands: ['c_save()'],
    postCommands: [],
    delayMs: 3000,
  },
  // satisfactory: 自动存档，无需手动 save 命令
  // custom: 无通用协议
};

/** sleep 辅助函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----- DB 行类型 -----

interface BackupRecordRow {
  id: number;
  server_id: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  status: string;
}

/** servers 表行视图（备份需要 node_id + pack_id） */
interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 服务实现 -----

export class BackupServiceImpl {
  constructor(
    private readonly db: Knex,
    /** C1: 可选依赖——未注入时 createBackup/restoreBackup/downloadBackup 降级为仅 DB 记录 */
    private readonly daemonClient?: DaemonClient,
    /** C1: 可选依赖——读取 Pack.backup 配置（world_dir / pre_backup_commands / post_backup_commands） */
    private readonly registry?: PackRegistry,
  ) {}

  async list(serverId: string): Promise<BackupRecordSummary[]> {
    const rows = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId })
      .orderBy('created_at', 'desc');
    return rows.map(toBackupRecordSummary);
  }

  async create(
    serverId: string,
    userId: string,
    req: CreateBackupRequest,
  ): Promise<BackupRecordSummary> {
    const inserted = await this.db<BackupRecordRow>('backup_records')
      .insert({
        server_id: serverId,
        file_path: req.file_path,
        size_bytes: req.size_bytes ?? DEFAULT_BACKUP_SIZE,
        created_at: new Date().toISOString(),
        created_by: userId,
        status: DEFAULT_BACKUP_STATUS,
      })
      .returning('*');

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return toBackupRecordSummary(row);
  }

  async update(
    serverId: string,
    id: number,
    patch: UpdateBackupRequest,
  ): Promise<BackupRecordSummary> {
    const existing = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new BackupNotFoundError(
        `备份记录不存在: server=${serverId}, id=${id}`,
      );
    }

    const updates: Partial<BackupRecordRow> = { status: patch.status };
    if (patch.size_bytes !== undefined) updates.size_bytes = patch.size_bytes;

    const updated = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id })
      .update(updates)
      .returning('*');

    const row = Array.isArray(updated) ? updated[0] : updated;
    return toBackupRecordSummary(row);
  }

  async delete(serverId: string, id: number): Promise<void> {
    const existing = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new BackupNotFoundError(
        `备份记录不存在: server=${serverId}, id=${id}`,
      );
    }
    await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id })
      .delete();
  }

  // ---- C1: 真实备份能力 ----

  /**
   * C1: 创建真实备份——游戏特化备份协议 + tar 打包。
   *
   * 流程：
   *   1. 查询 server 获取 node_id + pack_id
   *   2. 查询 Pack.backup 获取 world_dir / pre_backup_commands / post_backup_commands
   *   3. 在 backup_records 插入 in_progress 记录
   *   4. 执行 pre_backup_commands（shell 命令，如 sync）
   *   4.5 游戏特化协议：通过 sendCommand 发送 save-off/save-all 等，延时等待落盘
   *   5. 执行 tar czf 打包 world_dir → backups/<timestamp>.tar.gz
   *   5.5 游戏协议收尾：sendCommand 发送 save-on（finally 块，始终尝试恢复）
   *   6. 执行 post_backup_commands（shell 命令）
   *   7. 更新记录状态为 completed（含文件大小）
   *
   * 降级策略：daemonClient/registry 未注入时，仅创建 DB 记录（file_path 为占位值）
   * 实例未运行时：跳过游戏协议（4.5/5.5），直接 tar 打包
   *
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {PackNotFoundError} Pack 不存在
   * @throws {Error} 打包命令执行失败
   */
  async createBackup(
    serverId: string,
    userId: string,
  ): Promise<BackupRecordSummary> {
    // 降级模式：无 daemonClient 时仅创建 DB 记录
    if (!this.daemonClient || !this.registry) {
      const now = new Date().toISOString();
      const fileName = `backup-${serverId}-${now.replace(/[:.]/g, '-')}.tar.gz`;
      return this.create(serverId, userId, {
        file_path: `${BACKUP_DIR}/${fileName}`,
        size_bytes: 0,
      });
    }

    // 1. 查询 server 获取 node_id + pack_id
    const server = await this.db<ServerRow>('servers')
      .select('id', 'pack_id', 'node_id')
      .where({ id: serverId })
      .first();
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }

    // 2. 查询 Pack.backup 配置
    const pack = this.registry.load(server.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${server.pack_id}`);
    }
    const backupConfig = pack.backup;
    const worldDir = backupConfig.world_dir;

    // 3. 生成备份文件名并创建 in_progress 记录
    const now = new Date();
    const nowIso = now.toISOString();
    const fileName = `backup-${serverId}-${nowIso.replace(/[:.]/g, '-')}.tar.gz`;
    const backupPath = `${BACKUP_DIR}/${fileName}`;

    const inserted = await this.db<BackupRecordRow>('backup_records')
      .insert({
        server_id: serverId,
        file_path: backupPath,
        size_bytes: 0,
        created_at: nowIso,
        created_by: userId,
        status: 'in_progress',
      })
      .returning('*');
    const record = Array.isArray(inserted) ? inserted[0] : inserted;
    const recordId = record.id;

    try {
      // 4. 执行 pre_backup_commands（shell 命令，如 sync / fsfreeze）
      for (const cmd of backupConfig.pre_backup_commands) {
        await this.execBackupCommand(server.node_id, serverId, cmd);
      }

      // 4.5 C1: 游戏特化备份协议（如 Minecraft: save-off → save-all → 延时 → tar → save-on）
      // 这些是游戏控制台命令，通过 sendCommand（RCON/stdin）发送，不是 shell 命令。
      // 实例未运行时跳过游戏协议，直接 tar（世界未被写入，状态一致）。
      const protocol = GAME_BACKUP_PROTOCOLS[pack.pack.game];
      let gameProtocolActive = false;
      if (protocol && protocol.preCommands.length > 0) {
        try {
          // 第一条命令（如 save-off）成功即标记 active——后续命令失败也需在 finally 中恢复
          await this.sendGameCommand(server.node_id, serverId, protocol.preCommands[0]);
          gameProtocolActive = true;
          for (let i = 1; i < protocol.preCommands.length; i++) {
            await this.sendGameCommand(server.node_id, serverId, protocol.preCommands[i]);
          }
          // 等待数据落盘
          await sleep(protocol.delayMs);
        } catch {
          // 实例未运行或命令发送失败——跳过游戏协议，直接 tar
          gameProtocolActive = false;
        }
      }

      try {
        // 5. 执行 tar 打包（确保 backups 目录存在）
        await this.execBackupCommand(
          server.node_id,
          serverId,
          `mkdir -p ${BACKUP_DIR}`,
        );
        const tarCmd = `tar czf ${backupPath} -C . ${worldDir}`;
        const tarResult = await this.daemonClient.execCommand(
          server.node_id,
          serverId,
          { binary: 'sh', args: ['-c', tarCmd], timeout: BACKUP_TIMEOUT_MS },
        );
        if (tarResult.exit_code !== 0) {
          throw new Error(`tar 打包失败 exit=${tarResult.exit_code}: ${tarResult.stderr.slice(0, 500)}`);
        }
      } finally {
        // 5.5 C1: 游戏协议收尾（如 Minecraft save-on）——始终尝试恢复自动保存
        if (gameProtocolActive && protocol) {
          for (const cmd of protocol.postCommands) {
            try {
              await this.sendGameCommand(server.node_id, serverId, cmd);
            } catch {
              // 尽力恢复，失败不阻断备份流程
            }
          }
        }
      }

      // 6. 执行 post_backup_commands（shell 命令）
      for (const cmd of backupConfig.post_backup_commands) {
        await this.execBackupCommand(server.node_id, serverId, cmd);
      }

      // 7. 获取文件大小并更新记录为 completed
      const sizeResult = await this.daemonClient.execCommand(
        server.node_id,
        serverId,
        { binary: 'stat', args: ['-c', '%s', backupPath], timeout: 10_000 },
      );
      const sizeBytes = parseInt(sizeResult.stdout.trim(), 10) || 0;

      const updated = await this.db<BackupRecordRow>('backup_records')
        .where({ id: recordId })
        .update({ status: 'completed', size_bytes: sizeBytes })
        .returning('*');
      const row = Array.isArray(updated) ? updated[0] : updated;
      return toBackupRecordSummary(row);
    } catch (err) {
      // 备份失败：更新记录状态为 failed
      await this.db<BackupRecordRow>('backup_records')
        .where({ id: recordId })
        .update({ status: 'failed' });
      throw new Error(
        `备份失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * C1: 恢复备份——先自动预备份，再解压备份文件到 world_dir。
   *
   * @throws {BackupNotFoundError} 备份记录不存在
   * @throws {Error} 恢复命令执行失败
   */
  async restoreBackup(
    serverId: string,
    backupId: number,
    userId: string,
  ): Promise<{ restored: boolean; pre_backup_id?: number }> {
    if (!this.daemonClient || !this.registry) {
      throw new Error('backupService 未注入 daemonClient/registry，无法恢复备份');
    }

    // 0. 查询备份记录
    const backup = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id: backupId })
      .first();
    if (!backup) {
      throw new BackupNotFoundError(`备份记录不存在: server=${serverId}, id=${backupId}`);
    }
    if (backup.status !== 'completed') {
      throw new Error(`备份未完成，无法恢复: status=${backup.status}`);
    }

    // 1. 恢复前自动预备份（保护当前数据）
    let preBackupId: number | undefined;
    try {
      const preBackup = await this.createBackup(serverId, userId);
      preBackupId = preBackup.id;
    } catch (err) {
      // 预备份失败不阻断恢复，仅记录警告
      console.warn(`[backupService] 恢复前预备份失败，继续恢复: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. 查询 server + pack 获取路径信息
    const server = await this.db<ServerRow>('servers')
      .select('id', 'pack_id', 'node_id')
      .where({ id: serverId })
      .first();
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    const pack = this.registry.load(server.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${server.pack_id}`);
    }

    // 3. 解压备份文件（覆盖 world_dir）
    const restoreCmd = `tar xzf ${backup.file_path} -C .`;
    const result = await this.daemonClient.execCommand(
      server.node_id,
      serverId,
      { binary: 'sh', args: ['-c', restoreCmd], timeout: BACKUP_TIMEOUT_MS },
    );
    if (result.exit_code !== 0) {
      throw new Error(
        `恢复失败 exit=${result.exit_code}: ${result.stderr.slice(0, 500)}`,
      );
    }

    return { restored: true, pre_backup_id: preBackupId };
  }

  /**
   * C1: 下载备份文件——通过 daemonClient.readFile 读取备份文件内容。
   *
   * @returns { content, encoding } base64 编码的文件内容
   * @throws {BackupNotFoundError} 备份记录不存在
   * @throws {Error} 读取失败
   */
  async downloadBackup(
    serverId: string,
    backupId: number,
  ): Promise<{ content: string; encoding: 'base64'; file_path: string }> {
    if (!this.daemonClient) {
      throw new Error('backupService 未注入 daemonClient，无法下载备份');
    }

    const backup = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, id: backupId })
      .first();
    if (!backup) {
      throw new BackupNotFoundError(`备份记录不存在: server=${serverId}, id=${backupId}`);
    }

    const server = await this.db<ServerRow>('servers')
      .select('id', 'node_id')
      .where({ id: serverId })
      .first();
    if (!server) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }

    const fileResp = await this.daemonClient.readFile(
      server.node_id,
      serverId,
      backup.file_path,
    );
    return {
      content: fileResp.content,
      encoding: 'base64',
      file_path: backup.file_path,
    };
  }

  // ---- C2: 定时备份 + 保留策略 ----

  /**
   * C2: 清理旧备份——按保留策略删除超出限额的旧备份。
   *
   * @param serverId 实例 ID
   * @param maxCount 保留最近 N 个备份（按 created_at 降序）
   * @param maxAgeDays 保留最近 N 天的备份（可选，与 maxCount 取交集）
   * @returns 删除的备份数量
   */
  async cleanupOldBackups(
    serverId: string,
    maxCount: number,
    maxAgeDays?: number,
  ): Promise<number> {
    // 查询该实例所有 completed 备份（按 created_at 降序）
    const rows = await this.db<BackupRecordRow>('backup_records')
      .where({ server_id: serverId, status: 'completed' })
      .orderBy('created_at', 'desc');

    const toDelete: number[] = [];
    const now = Date.now();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let shouldDelete = false;

      // 超出数量限额
      if (i >= maxCount) {
        shouldDelete = true;
      }

      // 超出天数限额
      if (maxAgeDays !== undefined) {
        const createdAt = new Date(row.created_at).getTime();
        const ageMs = now - createdAt;
        if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        toDelete.push(row.id);
      }
    }

    if (toDelete.length > 0) {
      // 软删除：标记为 deleted 状态（保留记录，便于审计）
      await this.db<BackupRecordRow>('backup_records')
        .whereIn('id', toDelete)
        .update({ status: 'deleted' });
    }

    return toDelete.length;
  }

  // ---- 内部辅助 ----

  /** 执行备份相关 shell 命令（pre/post backup commands），失败时抛出错误 */
  private async execBackupCommand(
    nodeId: string,
    serverId: string,
    command: string,
  ): Promise<void> {
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入');
    }
    const result = await this.daemonClient.execCommand(
      nodeId,
      serverId,
      { binary: 'sh', args: ['-c', command], timeout: BACKUP_TIMEOUT_MS },
    );
    if (result.exit_code !== 0) {
      throw new Error(
        `命令执行失败 [${command}] exit=${result.exit_code}: ${result.stderr.slice(0, 300)}`,
      );
    }
  }

  /**
   * C1: 通过游戏控制台（RCON/stdin）发送命令——用于 save-off/save-all/save-on 等。
   * 与 execBackupCommand（shell）区分：此方法走 daemonClient.sendCommand 通道。
   * @throws {Error} 命令发送失败（实例未运行 / RCON 不可达等）
   */
  private async sendGameCommand(
    nodeId: string,
    serverId: string,
    command: string,
  ): Promise<void> {
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入');
    }
    const requestId = `${serverId}-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.daemonClient.sendCommand(
      nodeId,
      serverId,
      command,
      requestId,
    );
    if (!result.success) {
      throw new Error(
        `游戏命令发送失败 [${command}]: ${result.error ?? 'unknown error'}`,
      );
    }
  }
}

// ----- 纯函数 / 转换函数 -----

function toBackupRecordSummary(row: BackupRecordRow): BackupRecordSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    file_path: row.file_path,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    created_by: row.created_by,
    status: row.status as BackupStatus,
  };
}

// ----- 工厂 -----

export function createBackupService(
  db: Knex,
  daemonClient?: DaemonClient,
  registry?: PackRegistry,
): BackupServiceImpl {
  return new BackupServiceImpl(db, daemonClient, registry);
}
