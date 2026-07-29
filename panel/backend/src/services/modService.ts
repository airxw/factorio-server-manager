// ============================================================================
// modService — Mod 记录管理（P4 + Factorio 集成扩展 Task 5）
// 数据契约：public/schema/panel-api-types.ts（ModRecordSummary 等）
// 表结构：
//   mod_records (id, server_id, mod_name, version, enabled, source_url,
//                installed_at, created_at, updated_at)
//                UNIQUE(server_id, mod_name, version)
// 来源：P4 任务清单 §Mods + extend-pack-schema-for-factorio spec Task 5
//
// 扩展（Task 5）：
//   - 构造函数新增 registry / daemonClient 可选依赖（向后兼容）
//   - readModListFile / writeModListFile — 读写 Pack mods.list_file 文件
//   - create / delete — Pack 声明 mods 时同步写文件 + DB
//   - toggleMod — 启停 mod（更新文件 + DB）
//   - checkDependencies — 依赖冲突检测（读取 mod info 文件解析依赖并检测）
//   - downloadMod — 触发 mod 下载（P0 仅返回 URL）
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import type { PackMods, GameType } from '@public/schema/pack-schema';
import type { FileReadResponse } from '@public/schema/daemon-api-types';
import {
  ModNotFoundError,
  ModAlreadyExistsError,
  PackCapabilityNotDeclaredError,
  ModDownloadError,
  InstanceNotFoundError,
} from './errors.js';
import type {
  ModRecordSummary,
  CreateModRequest,
  UpdateModRequest,
  ModFileInfo,
  ToggleModFileResponse,
  ListFilesResponse,
} from '@public/schema/panel-api-types';
import { parseModInfo } from './modDependencyParser.js';
import type { ModInfo, ModDependency, ModInfoFormat } from './modDependencyParser.js';
// L2：ModMetadata 已提升到 public/ 契约（从 daemon-api-types 导入）
import type { ModMetadata } from '@public/schema/daemon-api-types';
// 重新导出 ModMetadata 供路由层使用
export type { ModMetadata } from '@public/schema/daemon-api-types';

// ----- 常量 -----

/** Mod 默认启用状态 */
const DEFAULT_MOD_ENABLED = true;

// ----- DB 行类型 -----

interface ModRecordRow {
  id: number;
  server_id: string;
  mod_name: string;
  version: string;
  enabled: number; // SQLite boolean as 0/1
  source_url: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ----- DB 行类型（mod_dependencies 表）-----

interface ModDependencyRow {
  id: number;
  mod_id: number; // 引用 mod_records.id
  depends_on: string;
  version_required: string | null;
  satisfied: number; // SQLite boolean as 0/1
  checked_at: string;
}

// ----- Mod-list.json 文件结构（通用 JSON 格式，Factorio 标准）-----

interface ModListEntry {
  name: string;
  enabled: boolean;
  version?: string;
}

interface ModListFile {
  mods: ModListEntry[];
}

// ----- Server 行类型（用于解析 serverId → packId + node_id）-----

interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 服务实现 -----

export class ModServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry?: PackRegistry,
    private readonly daemonClient?: DaemonClient,
  ) {}

  async list(serverId: string): Promise<ModRecordSummary[]> {
    const rows = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId })
      .orderBy('created_at', 'desc');
    return rows.map(toModRecordSummary);
  }

  /**
   * 创建 Mod 记录（Task 5.3 扩展）：
   *   - 若 Pack 声明 mods 字段，先同步写 mod-list.json 文件，再写 mod_records 表
   *   - 否则回退到 DB-only 行为（向后兼容）
   */
  async create(
    serverId: string,
    req: CreateModRequest,
  ): Promise<ModRecordSummary> {
    const nowIso = new Date().toISOString();
    const enabled = req.enabled ?? DEFAULT_MOD_ENABLED;
    const sourceUrl = req.source_url ?? null;

    // 若 Pack 声明 mods，先同步写文件（best-effort，失败不阻断 DB 写入）
    const packMods = await this.tryGetPackMods(serverId);
    if (packMods !== null) {
      try {
        await this.addModToFile(serverId, packMods, {
          name: req.mod_name,
          enabled,
          version: req.version,
        });
      } catch (err) {
        // 文件写入失败仅记录日志，不阻断 DB 写入（保持 mod_records 可用）
        // 实际生产环境可能需要更严格的策略，P0 先宽松
        console.warn(`[modService] addModToFile 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const inserted = await this.db<ModRecordRow>('mod_records')
        .insert({
          server_id: serverId,
          mod_name: req.mod_name,
          version: req.version,
          enabled: enabled ? 1 : 0,
          source_url: sourceUrl,
          installed_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .returning('*');

      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      const summary = toModRecordSummary(row);
      // best-effort：创建后异步触发依赖检测并写入 mod_dependencies 表（失败不影响主流程）
      this.invokeDependencyCheck(serverId);
      return summary;
    } catch (err) {
      if (isSqliteUniqueViolation(err)) {
        throw new ModAlreadyExistsError(
          `Mod 已存在: server=${serverId}, mod_name=${req.mod_name}, version=${req.version}`,
        );
      }
      throw err;
    }
  }

  async update(
    serverId: string,
    id: number,
    patch: UpdateModRequest,
  ): Promise<ModRecordSummary> {
    const existing = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new ModNotFoundError(
        `Mod 记录不存在: server=${serverId}, id=${id}`,
      );
    }

    // 仅允许更新 enabled / source_url（mod_name / version 不可改）
    const updates: Partial<ModRecordRow> = { updated_at: new Date().toISOString() };
    if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
    if (patch.source_url !== undefined) updates.source_url = patch.source_url;

    // 若 Pack 声明 mods 且 patch.enabled 变化，同步更新文件中对应条目
    if (patch.enabled !== undefined) {
      const packMods = await this.tryGetPackMods(serverId);
      if (packMods !== null) {
        try {
          await this.updateModInFile(serverId, packMods, existing.mod_name, patch.enabled);
        } catch (err) {
          console.warn(`[modService] updateModInFile 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const updated = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, id })
      .update(updates)
      .returning('*');

    const row = Array.isArray(updated) ? updated[0] : updated;
    const summary = toModRecordSummary(row);
    // best-effort：更新后异步触发依赖检测并写入 mod_dependencies 表（失败不影响主流程）
    this.invokeDependencyCheck(serverId);
    return summary;
  }

  /**
   * 删除 Mod 记录（Task 5.4 扩展）：
   *   - 若 Pack 声明 mods，先删文件中对应条目，再删 mod_records
   *   - 否则回退到 DB-only 行为
   */
  async delete(serverId: string, id: number): Promise<void> {
    const existing = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, id })
      .first();
    if (!existing) {
      throw new ModNotFoundError(
        `Mod 记录不存在: server=${serverId}, id=${id}`,
      );
    }

    // 若 Pack 声明 mods，同步删文件中对应条目
    const packMods = await this.tryGetPackMods(serverId);
    if (packMods !== null) {
      try {
        await this.removeModFromFile(serverId, packMods, existing.mod_name);
      } catch (err) {
        console.warn(`[modService] removeModFromFile 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, id })
      .delete();
  }

  // -------------------------------------------------------------------------
  // Task 5 新增方法
  // -------------------------------------------------------------------------

  /**
   * 读取 Pack mods.list_file 文件（Task 5.1）。
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 mods
   * @throws {InstanceNotFoundError} 实例不存在
   */
  async readModListFile(serverId: string): Promise<ModListFile> {
    const { packMods, nodeId } = await this.resolvePackMods(serverId);
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法读取 mod-list 文件');
    }
    const relPath = await this.resolveModListRelPath(serverId, packMods);
    const resp: FileReadResponse = await this.daemonClient.readFile(nodeId, serverId, relPath);
    return parseModListFile(resp.content, packMods.list_format);
  }

  /**
   * 写入 Pack mods.list_file 文件（Task 5.2）。
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 mods
   */
  async writeModListFile(serverId: string, mods: ModListFile): Promise<void> {
    const { packMods, nodeId } = await this.resolvePackMods(serverId);
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法写入 mod-list 文件');
    }
    const relPath = await this.resolveModListRelPath(serverId, packMods);
    const content = serializeModListFile(mods, packMods.list_format);
    await this.daemonClient.writeFile(nodeId, serverId, relPath, { content });
  }

  /**
   * 切换 mod 启停状态（Task 5.5 + C5 依赖完整性检查）。
   * 同步更新 mod-list.json 文件 + mod_records 表中所有匹配 mod_name 的记录。
   *
   * C5 增强：
   *   - 启用前：检查该 mod 的所有非可选依赖是否已安装且已启用
   *   - 禁用前：检查是否有其他已启用的 mod 依赖该 mod
   *   - 依赖数据源为 mod_dependencies 表（由 checkDependencies 持久化）
   *   - 表不存在或无记录时降级跳过检查（不阻断正常使用）
   *
   * @throws {Error} 依赖完整性检查失败（含冲突详情）
   */
  async toggleMod(serverId: string, modName: string, enabled: boolean): Promise<void> {
    // C5: 依赖完整性检查
    const conflicts = await this.checkToggleDependencies(serverId, modName, enabled);
    if (conflicts.length > 0) {
      const action = enabled ? '启用' : '禁用';
      throw new Error(
        `无法${action} mod ${modName}，存在依赖冲突:\n${conflicts.map((c) => `  - ${c}`).join('\n')}`,
      );
    }

    const packMods = await this.tryGetPackMods(serverId);
    if (packMods !== null) {
      try {
        await this.updateModInFile(serverId, packMods, modName, enabled);
      } catch (err) {
        console.warn(`[modService] toggleMod updateModInFile 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // 更新 DB 中所有匹配 mod_name 的记录
    await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, mod_name: modName })
      .update({
        enabled: enabled ? 1 : 0,
        updated_at: new Date().toISOString(),
      });
  }

  /**
   * 检查 mod 依赖冲突（Task 5.6）。
   * 读取每个已启用 mod 的 info 文件，解析依赖列表，检测缺失依赖。
   * 检测结果持久化到 mod_dependencies 表。
   *
   * 检测格式按 Pack 所属游戏选择：
   *   - factorio → info.json
   *   - minecraft → fabric.mod.json（Forge 的 mods.toml 暂不支持）
   *   - 其他游戏暂不支持依赖解析（返回空）
   *
   * @returns 已启用 mod 列表 + satisfied + missing + conflicts
   */
  async checkDependencies(
    serverId: string,
  ): Promise<{
    enabled_mods: string[];
    satisfied: boolean;
    missing: string[];
    conflicts: Array<{ mod: string; reason: string }>;
  }> {
    const empty = { enabled_mods: [], satisfied: true, missing: [], conflicts: [] };
    const packMods = await this.tryGetPackMods(serverId);
    if (packMods === null || !packMods.dependency_check) {
      return empty;
    }
    if (!this.daemonClient || !this.registry) {
      return empty;
    }

    try {
      // 1. 读取 mod-list.json 获取已安装/已启用 mod 列表
      const modList = await this.readModListFile(serverId);
      const enabledMods = modList.mods.filter((m) => m.enabled).map((m) => m.name);
      const installedModNames = new Set(modList.mods.map((m) => m.name));

      // 2. 解析游戏类型 → 解析格式
      const gameType = await this.resolveGameType(serverId);
      if (gameType === null) {
        return { enabled_mods: enabledMods, satisfied: true, missing: [], conflicts: [] };
      }
      const format = this.gameTypeToModInfoFormat(gameType);
      if (format === null) {
        // 其他游戏暂不支持依赖解析
        return { enabled_mods: enabledMods, satisfied: true, missing: [], conflicts: [] };
      }

      // 3. 解析 mods 目录相对路径（取 list_file 的 dirname）
      const { nodeId } = await this.resolveServerPack(serverId);
      const modsDir = await this.resolveModsDirRelPath(serverId, packMods);

      // 4. 逐个读取已启用 mod 的 info 文件并解析依赖
      const missing: string[] = [];
      const conflicts: Array<{ mod: string; reason: string }> = [];
      const modDepMap = new Map<string, ModDependency[]>(); // modName → 依赖列表

      for (const entry of modList.mods.filter((m) => m.enabled)) {
        const info = await this.readModInfo(
          nodeId,
          serverId,
          modsDir,
          entry.name,
          entry.version,
          format,
        );
        if (info === null) {
          // 无法读取 info 文件（zip 包内 / 未解压），跳过该 mod 的依赖检测
          continue;
        }
        modDepMap.set(entry.name, info.dependencies);
        for (const dep of info.dependencies) {
          // 可选依赖缺失不视为冲突
          if (dep.optional) continue;
          if (!installedModNames.has(dep.name)) {
            missing.push(dep.name);
            conflicts.push({
              mod: entry.name,
              reason: `缺少依赖: ${dep.name}${dep.version ? ` (需要 ${dep.version})` : ''}`,
            });
          }
        }
      }

      const result = {
        enabled_mods: enabledMods,
        satisfied: missing.length === 0,
        missing,
        conflicts,
      };

      // 5. 持久化到 mod_dependencies 表（best-effort，失败不影响检测结果）
      try {
        await this.persistDependencies(serverId, modList.mods, modDepMap, installedModNames);
      } catch (err) {
        console.warn(`[modService] persistDependencies 失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      return result;
    } catch (err) {
      // 文件不存在 / daemon 不可达等情况返回空
      console.warn(`[modService] checkDependencies 执行失败: ${err instanceof Error ? err.message : String(err)}`);
      return empty;
    }
  }

  /**
   * 触发 mod 下载（Task 5.7）。
   * P0 简化版：仅根据 Pack mods.download_source（含 {{mod_name}} 变量）构造下载 URL 返回。
   * 实际下载由前端或后续 task 实现（涉及大文件传输 + 解压）。
   *
   * @returns 下载 URL
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 mods 或 download_enabled=false
   * @throws {ModDownloadError} download_source 未配置
   */
  async downloadMod(serverId: string, modName: string): Promise<{ download_url: string }> {
    const { packMods } = await this.resolvePackMods(serverId);
    if (!packMods.download_enabled) {
      throw new PackCapabilityNotDeclaredError(
        `Pack 未启用 mods.download_enabled`,
      );
    }
    if (!packMods.download_source) {
      throw new ModDownloadError('Pack mods.download_source 未配置');
    }
    const downloadUrl = packMods.download_source.replace('{{mod_name}}', modName);
    return { download_url: downloadUrl };
  }

  // -------------------------------------------------------------------------
  // v4.3.0-H1: 文件系统级 Mod 列表与启停
  // -------------------------------------------------------------------------

  /**
   * 列出实例 mods/ 目录下的所有 mod 文件。
   *
   * 与 list() 不同，本方法直接读取文件系统而非 mod_records 表：
   *   - 扫描 mods/ 目录下的 .jar / .jar.disabled 文件
   *   - 返回文件名 + 启用状态 + 大小 + 修改时间
   *   - 不依赖 Pack 声明 mods（任何实例都可列出 mods/ 目录）
   *
   * @param serverId 实例 ID
   * @returns mod 文件信息数组（按文件名排序）
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {Error} daemonClient 未注入或 daemon 不可达
   */
  async listModFiles(serverId: string): Promise<ModFileInfo[]> {
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法列出 mod 文件');
    }
    const { nodeId } = await this.resolveServerPack(serverId);
    const resp: ListFilesResponse = await this.daemonClient.listFiles(
      nodeId,
      serverId,
      'mods',
      false,
    );
    // 过滤出 mod 文件（.jar / .jar.disabled），并解析启用状态
    return resp.entries
      .filter((e) => e.type === 'file' && isModFileName(e.name))
      .map((e) => ({
        name: e.name,
        state: (e.name.endsWith('.disabled') ? 'disabled' : 'enabled') as 'enabled' | 'disabled',
        size: e.size,
        modified_at: e.modified_at,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 切换 mod 文件的启用状态（.jar ↔ .jar.disabled）。
   *
   * 直接操作文件系统重命名，与 toggleMod（操作 mod-list.json + DB）互补：
   *   - 本方法适用于 Minecraft Forge/Fabric 等"文件即 mod"的场景
   *   - toggleMod 适用于 Factorio 等"mod-list.json 控制启停"的场景
   *
   * @param serverId 实例 ID
   * @param modName 纯文件名（无路径，必须以 .jar 或 .jar.disabled 结尾）
   * @returns 切换后的新状态
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {Error} daemonClient 未注入 / 文件不存在 / 文件名不合法
   */
  async toggleModFile(serverId: string, modName: string): Promise<ToggleModFileResponse> {
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法切换 mod 文件状态');
    }
    // 校验文件名合法性（防路径穿越 + 格式校验）
    if (!isModFileName(modName)) {
      throw new Error(
        `mod 文件名必须以 .jar 或 .jar.disabled 结尾: ${modName}`,
      );
    }
    const { nodeId } = await this.resolveServerPack(serverId);
    return await this.daemonClient.toggleModFile(nodeId, serverId, modName);
  }

  // -------------------------------------------------------------------------
  // L4: jar 元数据扫描（识别客户端 mod）
  // -------------------------------------------------------------------------

  /**
   * 扫描实例 mods 目录下所有 jar 文件的元数据。
   *
   * 转发到 Daemon 的 GET /api/instances/:id/mods/scan 端点，扫描在 Daemon 端完成。
   * 返回每个 jar 的 name/version/loader/environment/isClientSide，用于前端展示
   * 「加载器 / 环境」列并标记客户端 mod 警告。
   *
   * @param serverId 实例 ID
   * @returns ModMetadata 数组（按源文件名排序）
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {Error} daemonClient 未注入或 daemon 不可达
   */
  async scanMods(serverId: string): Promise<ModMetadata[]> {
    if (!this.daemonClient) {
      throw new Error('daemonClient 未注入，无法扫描 mod 元数据');
    }
    const { nodeId } = await this.resolveServerPack(serverId);
    // L2: scanMods 已加入 public DaemonClient 契约，无需本地扩展接口
    return await this.daemonClient.scanMods(nodeId, serverId);
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
   * 尝试获取 Pack.mods 配置；若 Pack 未声明 mods 或未注入 registry，返回 null。
   * 调用方据此判断是否走文件同步逻辑。
   */
  private async tryGetPackMods(serverId: string): Promise<PackMods | null> {
    if (!this.registry) return null;
    try {
      const { packId } = await this.resolveServerPack(serverId);
      const pack = this.registry.load(packId);
      if (!pack || !pack.mods) return null;
      return pack.mods;
    } catch {
      return null;
    }
  }

  /** 解析 serverId → { packMods, nodeId }（要求 Pack 声明 mods，否则抛错） */
  private async resolvePackMods(
    serverId: string,
  ): Promise<{ packMods: PackMods; nodeId: string }> {
    if (!this.registry) {
      throw new Error('registry 未注入，无法解析 Pack.mods');
    }
    const { packId, nodeId } = await this.resolveServerPack(serverId);
    const pack = this.registry.load(packId);
    if (!pack) {
      throw new PackCapabilityNotDeclaredError(`Pack 不存在: ${packId}`);
    }
    if (!pack.mods) {
      throw new PackCapabilityNotDeclaredError(`Pack ${packId} 未声明 mods`);
    }
    return { packMods: pack.mods, nodeId };
  }

  /** 渲染 mod-list 文件路径模板，转换为相对 instanceRoot 的路径 */
  private async resolveModListRelPath(
    serverId: string,
    packMods: PackMods,
  ): Promise<string> {
    const { packId } = await this.resolveServerPack(serverId);
    const pack = this.registry!.load(packId)!;
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const configDir = `${instanceRoot}/config`;
    const vars: Readonly<Record<string, string>> = {
      config_dir: configDir,
      instance_root: instanceRoot,
      binary: pack.startup.binary,
    };
    const absPath = renderTemplate(packMods.list_file, vars);
    return toRelPath(absPath, instanceRoot);
  }

  /** 解析 mods 目录相对路径（取 list_file rel path 的 dirname） */
  private async resolveModsDirRelPath(
    serverId: string,
    packMods: PackMods,
  ): Promise<string> {
    const listRelPath = await this.resolveModListRelPath(serverId, packMods);
    const idx = listRelPath.lastIndexOf('/');
    return idx >= 0 ? listRelPath.slice(0, idx) : '.';
  }

  /** 解析 serverId → 游戏类型（pack.game）；失败返回 null */
  private async resolveGameType(serverId: string): Promise<GameType | null> {
    if (!this.registry) return null;
    try {
      const { packId } = await this.resolveServerPack(serverId);
      const pack = this.registry.load(packId);
      return pack?.pack.game ?? null;
    } catch {
      return null;
    }
  }

  /** 游戏类型 → mod info 解析格式；不支持的游戏返回 null */
  private gameTypeToModInfoFormat(game: GameType): ModInfoFormat | null {
    switch (game) {
      case 'factorio':
        return 'factorio';
      case 'minecraft':
        // Minecraft 默认尝试 fabric（Forge 的 mods.toml 暂不支持解析）
        return 'fabric';
      default:
        // 其他游戏暂不支持依赖解析
        return null;
    }
  }

  /** 构造 mod info 文件的候选相对路径（按游戏格式，best-effort 逐个尝试） */
  private modInfoCandidatePaths(
    modsDir: string,
    modName: string,
    modVersion: string | undefined,
    format: ModInfoFormat,
  ): string[] {
    const candidates: string[] = [];
    switch (format) {
      case 'factorio':
        // Factorio 解压后目录名通常为 <name>_<version>，部分场景为 <name>
        if (modVersion) candidates.push(`${modsDir}/${modName}_${modVersion}/info.json`);
        candidates.push(`${modsDir}/${modName}/info.json`);
        break;
      case 'fabric':
        candidates.push(`${modsDir}/${modName}/fabric.mod.json`);
        break;
      case 'tmodloader':
        candidates.push(`${modsDir}/${modName}/modinfo.json`);
        break;
      default:
        break;
    }
    return candidates;
  }

  /** 读取并解析单个 mod 的 info 文件；所有候选路径均失败返回 null */
  private async readModInfo(
    nodeId: string,
    serverId: string,
    modsDir: string,
    modName: string,
    modVersion: string | undefined,
    format: ModInfoFormat,
  ): Promise<ModInfo | null> {
    if (!this.daemonClient) return null;
    const candidates = this.modInfoCandidatePaths(modsDir, modName, modVersion, format);
    for (const relPath of candidates) {
      try {
        const resp: FileReadResponse = await this.daemonClient.readFile(nodeId, serverId, relPath);
        const info = parseModInfo(resp.content, format);
        if (info) return info;
      } catch {
        // 文件不存在或读取失败，尝试下一个候选路径
      }
    }
    return null;
  }

  /**
   * 将依赖检测结果持久化到 mod_dependencies 表。
   * 策略：先清除该 server 下所有 mod 的旧依赖记录，再批量插入新记录。
   * 表不存在时静默跳过（兼容未迁移的数据库）。
   */
  private async persistDependencies(
    serverId: string,
    modListEntries: ModListEntry[],
    modDepMap: Map<string, ModDependency[]>,
    installedModNames: Set<string>,
  ): Promise<void> {
    const hasTable = await this.db.schema.hasTable('mod_dependencies');
    if (!hasTable) return;

    // 查询当前 server 的所有 mod_records，建立 mod_name → id 映射
    const rows = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId })
      .select('id', 'mod_name');
    const nameToId = new Map(rows.map((r) => [r.mod_name, r.id]));
    const modIds = Array.from(nameToId.values());

    // 删除旧的依赖记录
    if (modIds.length > 0) {
      await this.db<ModDependencyRow>('mod_dependencies')
        .whereIn('mod_id', modIds)
        .delete();
    }

    // 构建并插入新记录
    const checkedAt = new Date().toISOString();
    const newRows: Array<Partial<ModDependencyRow>> = [];
    for (const entry of modListEntries) {
      const modId = nameToId.get(entry.name);
      if (modId === undefined) continue;
      const deps = modDepMap.get(entry.name);
      if (!deps || deps.length === 0) continue;
      for (const dep of deps) {
        newRows.push({
          mod_id: modId,
          depends_on: dep.name,
          version_required: dep.version ?? null,
          satisfied: (installedModNames.has(dep.name) || !!dep.optional) ? 1 : 0,
          checked_at: checkedAt,
        });
      }
    }

    if (newRows.length > 0) {
      await this.db<ModDependencyRow>('mod_dependencies').insert(newRows);
    }
  }

  /** 异步触发依赖检测（fire-and-forget，失败仅记录日志，不阻塞主流程） */
  private invokeDependencyCheck(serverId: string): void {
    this.checkDependencies(serverId).catch((err) => {
      console.warn(`[modService] 依赖检测异步执行失败: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * C5: 检查 toggleMod 的依赖完整性。
   *
   * 检查规则：
   *   - 启用前（enabled=true）：该 mod 的所有非可选依赖必须已安装且已启用
   *   - 禁用前（enabled=false）：不得有其他已启用的 mod 依赖该 mod
   *
   * 数据源：mod_dependencies 表（由 checkDependencies 持久化）
   * 降级策略：表不存在或该 mod 无依赖记录时返回空数组（不阻断）
   *
   * @param serverId 实例 ID
   * @param modName 目标 mod 名称
   * @param enabled 目标启停状态
   * @returns 冲突详情数组，空数组表示检查通过
   */
  private async checkToggleDependencies(
    serverId: string,
    modName: string,
    enabled: boolean,
  ): Promise<string[]> {
    const hasTable = await this.db.schema.hasTable('mod_dependencies');
    if (!hasTable) return [];

    // 查询目标 mod 的 mod_records.id（取第一条匹配记录）
    const modRow = await this.db<ModRecordRow>('mod_records')
      .where({ server_id: serverId, mod_name: modName })
      .first();
    if (!modRow) {
      // mod 不在 DB 中，无法检查依赖，降级放行
      return [];
    }

    if (enabled) {
      // 启用前：检查该 mod 的依赖是否已安装且已启用
      const deps = await this.db<ModDependencyRow>('mod_dependencies')
        .where({ mod_id: modRow.id });

      const conflicts: string[] = [];
      for (const dep of deps) {
        // 查询依赖的 mod 是否已安装且已启用
        const depMod = await this.db<ModRecordRow>('mod_records')
          .where({ server_id: serverId, mod_name: dep.depends_on })
          .first();
        if (!depMod || depMod.enabled !== 1) {
          conflicts.push(
            `依赖 ${dep.depends_on}${dep.version_required ? ` (需要 ${dep.version_required})` : ''} 未安装或未启用`,
          );
        }
      }
      return conflicts;
    } else {
      // 禁用前：检查是否有其他已启用的 mod 依赖该 mod
      const dependents = await this.db<ModDependencyRow>('mod_dependencies')
        .where({ depends_on: modName });

      const conflicts: string[] = [];
      for (const dep of dependents) {
        // 跳过自引用（mod 依赖自己）
        if (dep.mod_id === modRow.id) continue;
        // 查询依赖方 mod 是否已启用
        const dependentMod = await this.db<ModRecordRow>('mod_records')
          .where({ server_id: serverId, id: dep.mod_id })
          .first();
        if (dependentMod && dependentMod.enabled === 1) {
          conflicts.push(
            `已启用的 mod ${dependentMod.mod_name} 依赖 ${modName}，禁用会导致依赖断裂`,
          );
        }
      }
      return conflicts;
    }
  }

  /** 添加 mod 到 mod-list.json 文件（若已存在则更新 enabled 状态） */
  private async addModToFile(
    serverId: string,
    packMods: PackMods,
    entry: ModListEntry,
  ): Promise<void> {
    const modList = await this.safeReadModListFile(serverId, packMods);
    const existing = modList.mods.find((m) => m.name === entry.name);
    if (existing) {
      existing.enabled = entry.enabled;
      if (entry.version) existing.version = entry.version;
    } else {
      modList.mods.push(entry);
    }
    await this.writeModListFile(serverId, modList);
  }

  /** 从 mod-list.json 文件移除指定 mod */
  private async removeModFromFile(
    serverId: string,
    packMods: PackMods,
    modName: string,
  ): Promise<void> {
    const modList = await this.safeReadModListFile(serverId, packMods);
    modList.mods = modList.mods.filter((m) => m.name !== modName);
    await this.writeModListFile(serverId, modList);
  }

  /** 更新 mod-list.json 中指定 mod 的 enabled 状态 */
  private async updateModInFile(
    serverId: string,
    packMods: PackMods,
    modName: string,
    enabled: boolean,
  ): Promise<void> {
    const modList = await this.safeReadModListFile(serverId, packMods);
    const existing = modList.mods.find((m) => m.name === modName);
    if (existing) {
      existing.enabled = enabled;
      await this.writeModListFile(serverId, modList);
    }
    // 不存在则不操作（避免误创建）
  }

  /** 安全读取 mod-list.json：文件不存在返回空列表 */
  private async safeReadModListFile(
    serverId: string,
    _packMods: PackMods,
  ): Promise<ModListFile> {
    try {
      return await this.readModListFile(serverId);
    } catch {
      // 文件不存在或解析失败，返回空列表
      return { mods: [] };
    }
  }
}

// ----- 纯函数 / 转换函数 -----

function toModRecordSummary(row: ModRecordRow): ModRecordSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    mod_name: row.mod_name,
    version: row.version,
    enabled: row.enabled === 1,
    source_url: row.source_url,
    installed_at: row.installed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

/**
 * v4.3.0-H1: 判断文件名是否为合法 mod 文件。
 * 合法格式：以 .jar 或 .jar.disabled 结尾，且不含路径分隔符。
 */
function isModFileName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || name.includes('..')) {
    return false;
  }
  return name.endsWith('.jar') || name.endsWith('.jar.disabled');
}

/** 简单模板渲染：{{var}} → vars[var]，未声明的变量保持原样 */
function renderTemplate(str: string, vars: Readonly<Record<string, string>>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/** 将绝对路径转换为相对 instanceRoot 的路径 */
function toRelPath(absPath: string, instanceRoot: string): string {
  const prefix = instanceRoot.endsWith('/') ? instanceRoot : instanceRoot + '/';
  if (absPath.startsWith(prefix)) {
    return absPath.slice(prefix.length);
  }
  if (!absPath.startsWith('/')) {
    return absPath;
  }
  return absPath;
}

/** 按 format 解析 mod-list 文件内容 */
function parseModListFile(content: string, format: string): ModListFile {
  if (format === 'json') {
    const parsed = JSON.parse(content) as Partial<ModListFile>;
    return { mods: parsed.mods ?? [] };
  }
  // P0 仅支持 json 格式（Factorio mod-list.json 标准）
  // yaml/properties/ini 后续扩展
  throw new Error(`不支持的 mod-list format: ${format}`);
}

/** 按 format 序列化 mod-list 文件内容 */
function serializeModListFile(data: ModListFile, format: string): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  throw new Error(`不支持的 mod-list format: ${format}`);
}

// ----- 工厂 -----

export function createModService(
  db: Knex,
  registry?: PackRegistry,
  daemonClient?: DaemonClient,
): ModServiceImpl {
  return new ModServiceImpl(db, registry, daemonClient);
}
