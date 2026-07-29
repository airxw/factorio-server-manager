// ============================================================================
// worldGenService — 地图生成服务（Task 4 新建）
//
// 职责：
//   - regenerateMap(serverId, saveName) — 调用 Pack world_generation.create_command 生成新地图
//   - getMapSettingsSchema(serverId) — 返回 settings_files 的 schema 供前端渲染表单
//   - updateMapSettings(serverId, settingsName, data) — 写入对应 settings 文件
//
// 依赖：
//   - PackRegistry（读 Pack.world_generation 配置）
//   - DaemonClient（通过 execCommand 执行命令、readFile/writeFile 操作文件）
//
// 数据契约：public/schema/pack-schema.ts PackWorldGeneration
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import type {
  GamePack,
  PackWorldGeneration,
  WorldGenSettingsFile,
} from '@public/schema/pack-schema';
import type { ExecCommandResponse } from '@public/schema/daemon-api-types';
import {
  InstanceNotFoundError,
  PackNotFoundError,
  PackCapabilityNotDeclaredError,
  WorldGenError,
} from './errors.js';

// ----- DB 行类型 -----
interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 服务实现 -----

export class WorldGenServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly daemonClient: DaemonClient,
  ) {}

  /**
   * 重新生成地图（调用 Pack world_generation.create_command）。
   *
   * @param serverId 实例 ID
   * @param saveName 新存档名（不含扩展名，如 "test" → "test.zip"）
   * @returns Daemon 命令执行结果
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {PackNotFoundError} Pack 不存在
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 world_generation
   * @throws {WorldGenError} 命令执行失败或超时
   */
  async regenerateMap(serverId: string, saveName: string): Promise<ExecCommandResponse> {
    if (!saveName || typeof saveName !== 'string') {
      throw new WorldGenError('saveName 不能为空');
    }

    const { packId, nodeId } = await this.resolveServerPack(serverId);
    const pack = this.requirePack(packId);
    const worldGen = this.requireWorldGen(pack, packId);

    // 渲染变量（与 daemonClientService.startInstance 的 workdir 推导一致）
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const saveExt = pack.saves?.extension ?? '.zip';
    const savePath = `${instanceRoot}/saves/${saveName}${saveExt}`;
    const configDir = `${instanceRoot}/config`;

    const vars: Readonly<Record<string, string>> = {
      binary: pack.startup.binary,
      save_path: savePath,
      config_dir: configDir,
      instance_root: instanceRoot,
      rcon_port: '', // worldGen 不需要 rcon_port，保留占位避免渲染异常
    };

    const renderedCmd = renderTemplate(worldGen.create_command, vars);
    const tokens = tokenize(renderedCmd);
    if (tokens.length === 0) {
      throw new WorldGenError('create_command 渲染后为空');
    }
    const [binary, ...args] = tokens;

    let result: ExecCommandResponse;
    try {
      result = await this.daemonClient.execCommand(nodeId, serverId, {
        binary,
        args,
        timeout: 120_000, // 地图生成可能较慢，2 分钟
      });
    } catch (err) {
      throw new WorldGenError(
        `地图生成命令执行失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (result.timed_out) {
      throw new WorldGenError(`地图生成超时（120s）`);
    }
    if (result.exit_code !== 0) {
      throw new WorldGenError(
        `地图生成失败 exit=${result.exit_code}: ${result.stderr.slice(0, 500)}`,
      );
    }
    return result;
  }

  /**
   * 获取地图设置文件的 schema 列表（供前端渲染表单）。
   * 异步：内部解析 serverId → packId 后查询 Pack 配置。
   */
  async getMapSettingsSchema(serverId: string): Promise<WorldGenSettingsFile[]> {
    const { packId } = await this.resolveServerPack(serverId);
    return this.getMapSettingsSchemaByPackId(packId);
  }

  /**
   * 按 packId 获取地图设置文件的 schema 列表（供前端渲染表单）。
   */
  getMapSettingsSchemaByPackId(packId: string): WorldGenSettingsFile[] {
    const pack = this.requirePack(packId);
    const worldGen = this.requireWorldGen(pack, packId);
    return worldGen.settings_files;
  }

  /**
   * 更新地图设置文件。
   *
   * @param serverId 实例 ID
   * @param settingsName settings_files[].name（如 "map-gen-settings"）
   * @param data 待写入的数据（按 format 序列化）
   */
  async updateMapSettings(
    serverId: string,
    settingsName: string,
    data: unknown,
  ): Promise<void> {
    const { packId, nodeId } = await this.resolveServerPack(serverId);
    const pack = this.requirePack(packId);
    const worldGen = this.requireWorldGen(pack, packId);
    const settingsFile = worldGen.settings_files.find((f) => f.name === settingsName);
    if (!settingsFile) {
      throw new WorldGenError(`settings_file 不存在: ${settingsName}`);
    }

    // 渲染 path 模板
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const configDir = `${instanceRoot}/config`;
    const vars: Readonly<Record<string, string>> = {
      config_dir: configDir,
      instance_root: instanceRoot,
    };
    const absPath = renderTemplate(settingsFile.path, vars);

    // 转换为相对 instance.workdir 的路径（Daemon 的 path 参数要求相对路径）
    // instance.workdir = instanceRoot，path 必须相对
    const relPath = toRelPath(absPath, instanceRoot);

    // 按 format 序列化
    const content = serializeByFormat(data, settingsFile.format);

    try {
      await this.daemonClient.writeFile(nodeId, serverId, relPath, { content });
    } catch (err) {
      throw new WorldGenError(
        `写入地图设置文件失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ----- 内部辅助 -----

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

  /** 获取 Pack，不存在抛错 */
  private requirePack(packId: string): GamePack {
    const pack = this.registry.load(packId);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${packId}`);
    }
    return pack;
  }

  /** 获取 Pack.world_generation，不存在抛错 */
  private requireWorldGen(pack: GamePack, packId: string): PackWorldGeneration {
    if (!pack.world_generation) {
      throw new PackCapabilityNotDeclaredError(
        `Pack ${packId} 未声明 world_generation`,
      );
    }
    return pack.world_generation;
  }
}

// ----- 纯函数 -----

/**
 * 简单模板渲染：{{var}} → vars[var]，未声明的变量保持原样。
 * 与 daemon/src/instances/manager.ts 的 renderTemplate 对齐。
 */
function renderTemplate(str: string, vars: Readonly<Record<string, string>>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * 简单分词：按空白分，支持双引号包裹（不支持转义，Factorio 命令通常无引号需求）。
 */
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

/**
 * 按 format 序列化数据为字符串。
 */
function serializeByFormat(data: unknown, format: string): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      // P0 简化：YAML 序列化使用 JSON 兼容格式（YAML 是 JSON 超集）
      return JSON.stringify(data, null, 2);
    case 'properties':
      return serializeProperties(data);
    case 'ini':
      return serializeIni(data);
    default:
      throw new WorldGenError(`不支持的 format: ${format}`);
  }
}

/** 简单 properties 序列化（key=value，扁平结构） */
function serializeProperties(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new WorldGenError('properties 格式要求 object 数据');
  }
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}

/** 简单 ini 序列化（仅一级 section + key=value） */
function serializeIni(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new WorldGenError('ini 格式要求 object 数据');
  }
  const lines: string[] = [];
  for (const [section, val] of Object.entries(data as Record<string, unknown>)) {
    lines.push(`[${section}]`);
    if (typeof val === 'object' && val !== null) {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        lines.push(`${k}=${String(v)}`);
      }
    } else {
      lines.push(`${section}=${String(val)}`);
    }
  }
  return lines.join('\n');
}

/**
 * 将绝对路径转换为相对 instanceRoot 的路径（Daemon 的 path 参数要求相对路径）。
 * 若 absPath 已在 instanceRoot 下，返回相对路径；否则原样返回（让 Daemon 校验）。
 */
function toRelPath(absPath: string, instanceRoot: string): string {
  // 简化：去掉前缀 instanceRoot + 分隔符
  const prefix = instanceRoot.endsWith('/') ? instanceRoot : instanceRoot + '/';
  if (absPath.startsWith(prefix)) {
    return absPath.slice(prefix.length);
  }
  // 如果 absPath 已是相对路径，原样返回
  if (!absPath.startsWith('/')) {
    return absPath;
  }
  return absPath;
}

// ----- 工厂 -----

export function createWorldGenService(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonClient,
): WorldGenServiceImpl {
  return new WorldGenServiceImpl(db, registry, daemonClient);
}
