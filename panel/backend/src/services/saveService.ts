// ============================================================================
// saveService — 存档记录管理（P4 + Factorio 集成扩展 Task 6）
// 数据契约：public/schema/panel-api-types.ts（SaveRecordSummary 等）
// 表结构：
//   save_records (id, server_id, save_name, file_path, size_bytes,
//                 modified_at, is_active, created_at)
//                 UNIQUE(server_id, save_name)
// 来源：P4 任务清单 §存档 + extend-pack-schema-for-factorio spec Task 6
//
// 扩展（Task 6）：
//   - 构造函数新增 registry / daemonClient 可选依赖（向后兼容）
//   - createSaveViaPack — 调用 Pack saves.create_command 生成存档文件 + 写 save_records 表
//   - activateSaveViaPack — 调用 Pack saves.activate_command + 更新 save_records.is_active
//   - deleteSaveFile — 删除存档文件 + 删 save_records 记录
//   - create / activate / delete — Pack 声明 saves 时走 Pack 命令，否则回退到 DB-only
//
// 说明：
//   - is_active 唯一约束：同一 server_id 仅允许一条 is_active=true
//   - create 时若 is_active=true，先置同 server_id 其他记录 is_active=false
//   - activate 使用事务保证原子性
//   - 依赖通过 req.app.locals.saveService 注入
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import type { PackSaves } from '@public/schema/pack-schema';
import type { ExecCommandResponse } from '@public/schema/daemon-api-types';
import {
  SaveNotFoundError,
  SaveAlreadyExistsError,
  PackCapabilityNotDeclaredError,
  InstanceNotFoundError,
} from './errors.js';
import type {
  SaveRecordSummary,
  CreateSaveRequest,
} from '@public/schema/panel-api-types';

// ----- 常量 -----

/** 存档默认非激活 */
const DEFAULT_SAVE_ACTIVE = false;

// ----- DB 行类型 -----

interface SaveRecordRow {
  id: number;
  server_id: string;
  save_name: string;
  file_path: string;
  size_bytes: number;
  modified_at: string;
  is_active: number; // SQLite boolean as 0/1
  created_at: string;
}

// ----- Server 行类型（用于解析 serverId → packId + node_id）-----

interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 服务实现 -----

export class SaveServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry?: PackRegistry,
    private readonly daemonClient?: DaemonClient,
  ) {}

  async list(serverId: string): Promise<SaveRecordSummary[]> {
    const rows = await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId })
      .orderBy('modified_at', 'desc');
    return rows.map(toSaveRecordSummary);
  }

  /**
   * 创建存档记录（Task 6.4 扩展）：
   *   - 若 Pack 声明 saves 字段，调用 createSaveViaPack 生成文件 + 写 DB
   *   - 否则回退到 DB-only 行为（仅写 save_records 表，file_path 由调用方提供）
   */
  async create(
    serverId: string,
    req: CreateSaveRequest,
  ): Promise<SaveRecordSummary> {
    // 若 Pack 声明 saves，走 Pack 命令流程
    const packSaves = await this.tryGetPackSaves(serverId);
    if (packSaves !== null) {
      return this.createSaveViaPack(serverId, req.save_name, req.is_active ?? DEFAULT_SAVE_ACTIVE);
    }

    // 否则回退到 DB-only 行为
    const isActive = req.is_active ?? DEFAULT_SAVE_ACTIVE;
    try {
      const result = await this.db.transaction(async (trx) => {
        if (isActive) {
          await trx<SaveRecordRow>('save_records')
            .where({ server_id: serverId })
            .update({ is_active: 0 });
        }
        const inserted = await trx<SaveRecordRow>('save_records')
          .insert({
            server_id: serverId,
            save_name: req.save_name,
            file_path: req.file_path,
            size_bytes: req.size_bytes,
            modified_at: req.modified_at,
            is_active: isActive ? 1 : 0,
            created_at: new Date().toISOString(),
          })
          .returning('*');
        const row = Array.isArray(inserted) ? inserted[0] : inserted;
        return row;
      });
      return toSaveRecordSummary(result);
    } catch (err) {
      if (isSqliteUniqueViolation(err)) {
        throw new SaveAlreadyExistsError(
          `存档已存在: server=${serverId}, save_name=${req.save_name}`,
        );
      }
      throw err;
    }
  }

  /**
   * 激活存档（Task 6.4 扩展）：
   *   - 更新 DB is_active 标记（事务保证原子性）
   *   - 调用 Daemon restart-with-save 实际切换服务器使用的存档（带存档重启）
   *   - Daemon 调用失败时降级为仅更新 DB（不阻断，记录警告日志）
   */
  async activate(serverId: string, id: number): Promise<SaveRecordSummary> {
    const existing = await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new SaveNotFoundError(
        `存档记录不存在: server=${serverId}, id=${id}`,
      );
    }

    // 事务：先清空同 server_id 所有 is_active，再置指定 id 为 active
    const result = await this.db.transaction(async (trx) => {
      await trx<SaveRecordRow>('save_records')
        .where({ server_id: serverId })
        .update({ is_active: 0 });
      const updated = await trx<SaveRecordRow>('save_records')
        .where({ server_id: serverId, id })
        .update({ is_active: 1 })
        .returning('*');
      const row = Array.isArray(updated) ? updated[0] : updated;
      return row;
    });

    // 带存档重启：调用 Daemon restart-with-save 实际切换服务器使用的存档
    // Daemon 调用失败时降级为仅更新 DB（不阻断，记录警告日志）
    await this.tryRestartWithSave(serverId, existing.file_path);

    return toSaveRecordSummary(result);
  }

  /**
   * 删除存档（Task 6.4 扩展）：
   *   - 若 Pack 声明 saves，调用 deleteSaveFile（删除文件 + 删 DB 记录）
   *   - 否则回退到 DB-only 行为
   */
  async delete(serverId: string, id: number): Promise<void> {
    const existing = await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new SaveNotFoundError(
        `存档记录不存在: server=${serverId}, id=${id}`,
      );
    }

    // 若 Pack 声明 saves，尝试删除文件（best-effort）
    const packSaves = await this.tryGetPackSaves(serverId);
    if (packSaves !== null) {
      try {
        await this.deleteSaveFileEntry(serverId, existing.save_name, packSaves);
      } catch (err) {
        console.warn(`[saveService] deleteSaveFile 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, id })
      .delete();
  }

  // -------------------------------------------------------------------------
  // Task 6 新增方法
  // -------------------------------------------------------------------------

  /**
   * 调用 Pack saves.create_command 生成存档文件 + 写 save_records 表（Task 6.1）。
   *
   * @param serverId 实例 ID
   * @param saveName 存档名（不含扩展名，如 "test" → "test.zip"）
   * @param isActive 是否设为激活存档
   * @returns 新建的 save_records 记录
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 saves
   * @throws {InstanceNotFoundError} 实例不存在
   */
  async createSaveViaPack(
    serverId: string,
    saveName: string,
    isActive: boolean = false,
  ): Promise<SaveRecordSummary> {
    if (!saveName || typeof saveName !== 'string') {
      throw new Error('saveName 不能为空');
    }
    const { packSaves, packId, nodeId } = await this.resolvePackSaves(serverId);
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法执行 create_command');
    }
    const pack = this.requirePack(packId);

    // 渲染变量
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const savePath = `${packSaves.dir.endsWith('/') ? packSaves.dir : packSaves.dir + '/'}${saveName}${packSaves.extension}`;
    const vars: Readonly<Record<string, string>> = {
      binary: pack.startup.binary,
      save_path: savePath,
      save_name: saveName,
      config_dir: `${instanceRoot}/config`,
      instance_root: instanceRoot,
      rcon_port: '',
    };
    const renderedCmd = renderTemplate(packSaves.create_command, vars);
    const tokens = tokenize(renderedCmd);
    if (tokens.length === 0) {
      throw new Error('saves.create_command 渲染后为空');
    }
    const [binary, ...args] = tokens;

    // 执行 create_command
    let result: ExecCommandResponse;
    try {
      result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary,
        args,
        timeout: 120_000,
      });
    } catch (err) {
      throw new Error(`存档生成命令执行失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result.timed_out) {
      throw new Error('存档生成超时（120s）');
    }
    if (result.exit_code !== 0) {
      throw new Error(`存档生成失败 exit=${result.exit_code}: ${result.stderr.slice(0, 500)}`);
    }

    // 写 save_records 表
    const nowIso = new Date().toISOString();
    try {
      const inserted = await this.db.transaction(async (trx) => {
        if (isActive) {
          await trx<SaveRecordRow>('save_records')
            .where({ server_id: serverId })
            .update({ is_active: 0 });
        }
        const inserted = await trx<SaveRecordRow>('save_records')
          .insert({
            server_id: serverId,
            save_name: saveName,
            file_path: savePath,
            size_bytes: 0, // P0 不查询实际文件大小
            modified_at: nowIso,
            is_active: isActive ? 1 : 0,
            created_at: nowIso,
          })
          .returning('*');
        const row = Array.isArray(inserted) ? inserted[0] : inserted;
        return row;
      });
      return toSaveRecordSummary(inserted);
    } catch (err) {
      if (isSqliteUniqueViolation(err)) {
        throw new SaveAlreadyExistsError(
          `存档已存在: server=${serverId}, save_name=${saveName}`,
        );
      }
      throw err;
    }
  }

  /**
   * 调用 Pack saves.activate_command + 更新 save_records.is_active（Task 6.2）。
   *
   * P0 简化：仅更新 DB is_active 标记，不实际执行 activate_command
   * （实际切换存档需重启服务器，留给后续 task）
   *
   * @param serverId 实例 ID
   * @param saveId save_records.id
   */
  async activateSaveViaPack(
    serverId: string,
    saveId: number,
  ): Promise<SaveRecordSummary> {
    return this.activate(serverId, saveId);
  }

  /**
   * 删除存档文件 + 删 save_records 记录（Task 6.3）。
   *
   * P0 简化：Daemon 暂未提供 deleteFile 端点，仅删 save_records 记录。
   * 文件删除留给后续扩展（或通过 execCommand 调用 `rm` 命令）。
   *
   * @param serverId 实例 ID
   * @param saveId save_records.id
   */
  async deleteSaveFile(serverId: string, saveId: number): Promise<void> {
    const existing = await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, id: saveId })
      .first();
    if (!existing) {
      throw new SaveNotFoundError(
        `存档记录不存在: server=${serverId}, id=${saveId}`,
      );
    }

    const packSaves = await this.tryGetPackSaves(serverId);
    if (packSaves !== null) {
      try {
        await this.deleteSaveFileEntry(serverId, existing.save_name, packSaves);
      } catch (err) {
        console.warn(`[saveService] deleteSaveFileEntry 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, id: saveId })
      .delete();
  }

  // -------------------------------------------------------------------------
  // C3/C4 新增方法
  // -------------------------------------------------------------------------

  /**
   * C3: 存档上传基本校验——扩展名 + 文件大小限制。
   *
   * 校验规则：
   *   1. 文件名非空且长度 ≤ 255
   *   2. 扩展名匹配 Pack.saves.extension（若 Pack 声明 saves）
   *   3. 文件大小 ≤ maxFileSizeBytes（默认 100MB）
   *
   * @param serverId 实例 ID
   * @param fileName 上传文件名（如 "world1.zip"）
   * @param fileSize 文件大小（字节）
   * @param maxFileSizeBytes 最大允许大小（默认 100MB）
   * @throws {Error} 校验失败
   */
  async validateUploadSave(
    serverId: string,
    fileName: string,
    fileSize: number,
    maxFileSizeBytes: number = 100 * 1024 * 1024,
  ): Promise<void> {
    // 1. 文件名基本校验
    if (!fileName || typeof fileName !== 'string' || fileName.length === 0) {
      throw new Error('文件名不能为空');
    }
    if (fileName.length > 255) {
      throw new Error('文件名过长（>255 字符）');
    }
    // 防路径穿越：文件名不得包含 .. 或路径分隔符
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('文件名包含非法字符（禁止路径穿越）');
    }

    // 2. 文件大小校验
    if (fileSize <= 0) {
      throw new Error('文件大小必须大于 0');
    }
    if (fileSize > maxFileSizeBytes) {
      const maxMB = Math.floor(maxFileSizeBytes / 1024 / 1024);
      throw new Error(`文件大小超过限制（最大 ${maxMB}MB）`);
    }

    // 3. 扩展名校验（若 Pack 声明 saves）
    const packSaves = await this.tryGetPackSaves(serverId);
    if (packSaves !== null) {
      const expectedExt = packSaves.extension;
      if (!fileName.endsWith(expectedExt)) {
        throw new Error(
          `文件扩展名不匹配：期望 ${expectedExt}，实际文件名 ${fileName}`,
        );
      }
    }
  }

  /**
   * C4: 存档自动发现——通过 daemonClient 扫描 saves 目录找最新存档文件。
   *
   * 流程：
   *   1. 解析 Pack.saves 配置获取 saves 目录和扩展名
   *   2. 通过 daemonClient.execCommand 执行 `ls -t <saves_dir>/*<ext> | head -1`
   *   3. 若找到最新存档文件，检查是否已在 save_records 表中记录，未记录则自动写入
   *   4. 返回最新存档的 SaveRecordSummary（无存档返回 null）
   *
   * @param serverId 实例 ID
   * @returns 最新存档记录，无存档或无 Pack.saves 配置时返回 null
   */
  async discoverLatestSave(serverId: string): Promise<SaveRecordSummary | null> {
    if (!this.daemonClient || !this.registry) {
      return null;
    }

    let packSaves: PackSaves;
    let nodeId: string;
    try {
      const resolved = await this.resolvePackSaves(serverId);
      packSaves = resolved.packSaves;
      nodeId = resolved.nodeId;
    } catch {
      // Pack 未声明 saves 或实例不存在 → 无法发现
      return null;
    }

    // 执行 ls -t 找最新存档文件
    const savesDir = packSaves.dir.endsWith('/')
      ? packSaves.dir
      : packSaves.dir + '/';
    const pattern = `${savesDir}*${packSaves.extension}`;
    const lsCmd = `ls -t ${pattern} 2>/dev/null | head -1`;
    let latestFilePath: string;
    try {
      const result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'sh',
        args: ['-c', lsCmd],
        timeout: 10_000,
      });
      if (result.exit_code !== 0) {
        return null;
      }
      latestFilePath = result.stdout.trim();
      if (!latestFilePath) {
        return null; // 无存档文件
      }
    } catch {
      return null;
    }

    // 从路径提取 save_name（去掉目录和扩展名）
    const fileName = latestFilePath.split('/').pop() ?? latestFilePath;
    const saveName = fileName.endsWith(packSaves.extension)
      ? fileName.slice(0, -packSaves.extension.length)
      : fileName;

    // 检查是否已有记录
    const existing = await this.db<SaveRecordRow>('save_records')
      .where({ server_id: serverId, save_name: saveName })
      .first();
    if (existing) {
      return toSaveRecordSummary(existing);
    }

    // 自动写入 save_records 记录
    // 获取文件大小
    let sizeBytes = 0;
    try {
      const statResult = await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'stat',
        args: ['-c', '%s', latestFilePath],
        timeout: 5_000,
      });
      sizeBytes = parseInt(statResult.stdout.trim(), 10) || 0;
    } catch {
      // 获取大小失败不阻断
    }

    const nowIso = new Date().toISOString();
    try {
      const inserted = await this.db<SaveRecordRow>('save_records')
        .insert({
          server_id: serverId,
          save_name: saveName,
          file_path: latestFilePath,
          size_bytes: sizeBytes,
          modified_at: nowIso,
          is_active: 0,
          created_at: nowIso,
        })
        .returning('*');
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      return toSaveRecordSummary(row);
    } catch (err) {
      if (isSqliteUniqueViolation(err)) {
        // 并发写入导致唯一约束冲突，重新查询
        const reloaded = await this.db<SaveRecordRow>('save_records')
          .where({ server_id: serverId, save_name: saveName })
          .first();
        return reloaded ? toSaveRecordSummary(reloaded) : null;
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------------

  /** 解析 serverId → { packId, nodeId } */
  private async resolveServerPack(
    serverId: string,
  ): Promise<{ packId: string; nodeId: string }> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    return { packId: row.pack_id, nodeId: row.node_id };
  }

  /**
   * 尝试调用 Daemon 带存档重启（best-effort，失败仅记录警告）。
   *
   * 降级场景（均不阻断，仅 console.warn）：
   *   - daemonClient 未注入
   *   - savePath 为空
   *   - 解析服务器节点失败（实例不存在于 servers 表）
   *   - Daemon 不可达 / 实例未注册 / 重启失败
   *
   * 注意：DaemonClient 接口（public/interface_stub/daemon-client.d.ts）未声明
   * restartWithSave（P0 未纳入 public 契约），此处通过类型断言访问
   * DaemonClientImpl 扩展的方法。
   */
  private async tryRestartWithSave(serverId: string, savePath: string): Promise<void> {
    if (!this.daemonClient) {
      return;
    }
    if (!savePath) {
      return;
    }

    let nodeId: string;
    try {
      const resolved = await this.resolveServerPack(serverId);
      nodeId = resolved.nodeId;
    } catch (err) {
      console.warn(
        `[saveService] 带存档重启跳过：解析服务器节点失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    try {
      // 类型断言：访问 DaemonClientImpl 扩展的 restartWithSave 方法
      const client = this.daemonClient as DaemonClient & {
        restartWithSave?: (
          nodeId: string,
          serverId: string,
          savePath: string,
        ) => Promise<{ pid: number }>;
      };
      if (typeof client.restartWithSave === 'function') {
        await client.restartWithSave(nodeId, serverId, savePath);
      }
    } catch (err) {
      console.warn(
        `[saveService] 带存档重启失败（已降级为仅更新 DB 标记）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 获取 Pack，不存在抛错 */
  private requirePack(packId: string) {
    if (!this.registry) {
      throw new Error('registry 未注入');
    }
    const pack = this.registry.load(packId);
    if (!pack) {
      throw new PackCapabilityNotDeclaredError(`Pack 不存在: ${packId}`);
    }
    return pack;
  }

  /**
   * 尝试获取 Pack.saves 配置；若 Pack 未声明 saves 或未注入 registry，返回 null。
   */
  private async tryGetPackSaves(serverId: string): Promise<PackSaves | null> {
    if (!this.registry) return null;
    try {
      const { packId } = await this.resolveServerPack(serverId);
      const pack = this.registry.load(packId);
      if (!pack || !pack.saves) return null;
      return pack.saves;
    } catch {
      return null;
    }
  }

  /** 解析 serverId → { packSaves, packId, nodeId }（要求 Pack 声明 saves，否则抛错） */
  private async resolvePackSaves(
    serverId: string,
  ): Promise<{ packSaves: PackSaves; packId: string; nodeId: string }> {
    if (!this.registry) {
      throw new Error('registry 未注入，无法解析 Pack.saves');
    }
    const { packId, nodeId } = await this.resolveServerPack(serverId);
    const pack = this.registry.load(packId);
    if (!pack) {
      throw new PackCapabilityNotDeclaredError(`Pack 不存在: ${packId}`);
    }
    if (!pack.saves) {
      throw new PackCapabilityNotDeclaredError(`Pack ${packId} 未声明 saves`);
    }
    return { packSaves: pack.saves, packId, nodeId };
  }

  /** 删除存档文件（通过 execCommand 调用 rm，P0 简化） */
  private async deleteSaveFileEntry(
    serverId: string,
    saveName: string,
    packSaves: PackSaves,
  ): Promise<void> {
    if (!this.daemonClient) return;
    const { packId, nodeId } = await this.resolveServerPack(serverId);
    const pack = this.requirePack(packId);
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const savePath = `${packSaves.dir.endsWith('/') ? packSaves.dir : packSaves.dir + '/'}${saveName}${packSaves.extension}`;
    const vars: Readonly<Record<string, string>> = {
      binary: pack.startup.binary,
      save_path: savePath,
      save_name: saveName,
      instance_root: instanceRoot,
    };
    // P0 简化：通过 execCommand 调用 rm 命令
    // 注意：binary 是 'rm'，cwd 默认为 instance workdir
    const renderedPath = renderTemplate(savePath, vars);
    try {
      await this.daemonClient.execCommand(nodeId, serverId, {
        binary: 'rm',
        args: ['-f', renderedPath],
        timeout: 30_000,
      });
    } catch (err) {
      // 文件不存在等情况忽略
      console.warn(`[saveService] rm 命令失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ----- 纯函数 / 转换函数 -----

function toSaveRecordSummary(row: SaveRecordRow): SaveRecordSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    save_name: row.save_name,
    file_path: row.file_path,
    size_bytes: row.size_bytes,
    modified_at: row.modified_at,
    is_active: row.is_active === 1,
    created_at: row.created_at,
  };
}

// ----- 辅助函数 -----

/** 检测唯一约束冲突错误（SQLite SQLITE_CONSTRAINT / PostgreSQL 23505） */
function isSqliteUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(err.message)) return true;
  // PostgreSQL unique_violation
  if (code === '23505') return true;
  return false;
}

/** 简单模板渲染：{{var}} → vars[var]，未声明的变量保持原样 */
function renderTemplate(str: string, vars: Readonly<Record<string, string>>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/** 简单分词：按空白分，支持双引号包裹 */
function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (c === ' ' || c === '\t' || c === '\n')) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += c;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

// ----- 工厂 -----

export function createSaveService(
  db: Knex,
  registry?: PackRegistry,
  daemonClient?: DaemonClient,
): SaveServiceImpl {
  return new SaveServiceImpl(db, registry, daemonClient);
}
