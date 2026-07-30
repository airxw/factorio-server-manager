// ============================================================================
// configFileService — 配置文件管理服务（Task 7 新建）
//
// 职责：
//   - readConfigFile(serverId, configName) — 按 Pack config_files[].path 读取文件，按 format 解析
//   - writeConfigFile(serverId, configName, data) — 按 format 序列化，写入文件
//   - getConfigFileSchema(serverId, configName) — 返回 config_files[].schema 供前端渲染
//   - listConfigFiles(serverId) — 列出 Pack 声明的所有 config_files 元信息
//
// 依赖：
//   - PackRegistry（读 Pack.config_files 配置）
//   - DaemonClient（通过 readFile/writeFile 操作文件）
//
// 数据契约：public/schema/pack-schema.ts PackConfigFile
// ============================================================================

import type { Knex } from 'knex';
import type { DaemonClient } from '@public/interface_stub/daemon-client';
import type { PackRegistry } from '../core/packs/registry.js';
import type {
  GamePack,
  PackConfigFile,
  ConfigFormat,
} from '@public/schema/pack-schema';
import type { FileReadResponse } from '@public/schema/daemon-api-types';
import {
  InstanceNotFoundError,
  PackNotFoundError,
  ConfigFileNotFoundError,
  ConfigFileReadOnlyError,
  ValidationError,
} from './errors.js';

// ----- Server 行类型 -----

interface ServerRow {
  id: string;
  pack_id: string;
  node_id: string;
}

// ----- 配置文件元信息（前端用于渲染列表）-----

export interface ConfigFileMeta {
  name: string;
  path: string;
  format: ConfigFormat;
  read_only: boolean;
}

// ----- 服务实现 -----

export class ConfigFileServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly daemonClient: DaemonClient,
  ) {}

  /**
   * 列出配置文件元信息（Pack 声明 + 用户自定义）。
   *
   * v4.33.0：path 返回渲染后的相对路径（如 `config/server-settings.json`），
   *          而非原始模板 `{{config_dir}}/server-settings.json`，让前端能展示真实文件位置。
   */
  async listConfigFiles(serverId: string): Promise<ConfigFileMeta[]> {
    const pack = await this.resolveServerPack(serverId);
    const result: ConfigFileMeta[] = [];
    const packNames = new Set<string>();

    // Pack 声明的配置文件
    if (pack.config_files && pack.config_files.length > 0) {
      const { instanceRoot, vars } = this.buildPathVars(serverId, pack);
      for (const f of pack.config_files) {
        packNames.add(f.name);
        result.push({
          name: f.name,
          path: toRelPath(renderTemplate(f.path, vars), instanceRoot),
          format: f.format,
          read_only: f.read_only,
        });
      }
    }

    // 用户自定义配置文件（config/ 目录下的文件，排除 Pack 声明的）
    try {
      const { nodeId } = await this.resolveServerPackWithNode(serverId);
      const listing = await this.daemonClient.listFiles(nodeId, serverId, 'config');
      for (const entry of listing.entries) {
        if (entry.type !== 'file') continue;
        const fmt = formatFromPath(entry.name);
        if (!fmt) continue;
        const name = dropExtension(entry.name);
        if (packNames.has(name)) continue; // 排除 Pack 已声明的
        result.push({
          name,
          path: `config/${entry.name}`,
          format: fmt,
          read_only: false,
        });
      }
    } catch {
      // config 目录不存在或 daemon 不可达时忽略（不影响 Pack 文件列表）
    }

    return result;
  }

  /**
   * 读取配置文件内容（按 format 解析为对象）。
   *
   * 文件不存在时返回空对象 `{}`，让用户能在 ConfigFileEditor 中看到/编辑空配置。
   * 保存时通过 writeConfigFile 自动创建文件。
   *
   * @throws {ConfigFileNotFoundError} configName 不在 Pack config_files 声明中
   * @throws {PackCapabilityNotDeclaredError} Pack 未声明 config_files
   */
  async readConfigFile(serverId: string, configName: string): Promise<unknown> {
    const { pack, nodeId } = await this.resolveServerPackWithNode(serverId);
    const { relPath, format } = await this.resolveConfigFileInfo(pack, nodeId, serverId, configName);
    let content: string;
    try {
      const resp: FileReadResponse = await this.daemonClient.readFile(nodeId, serverId, relPath);
      content = resp.content;
    } catch (err) {
      // 实例从未启动时配置文件不存在（daemon 抛 FileNotFoundError，message 为中文 "文件不存在: xxx"，
      // 通过 sendError 返回 code='FILE_NOT_FOUND'；被 wrapDaemonError 包装后 message 含
      // "Daemon error: 文件不存在: xxx"）。匹配任一形态都返回空对象让用户可编辑后保存。
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('FILE_NOT_FOUND') ||
        msg.includes('file not found') ||
        msg.includes('no such file') ||
        msg.includes('文件不存在') ||
        msg.includes('ENOENT')
      ) {
        return {};
      }
      throw err;
    }
    return parseByFormat(content, format);
  }

  /**
   * 写入配置文件（按 format 序列化）。
   *
   * v1.1.0: 端口锁定为实例不可变属性。配置文件中的端口字段由 Pack schema 声明 readOnly，
   * 启动时通过 startup_config 的 config_writes 从 servers 表注入配置文件（server→config）。
   * 因此本方法不再反向同步 config→server 端口（已移除 syncPortFieldsIfNeeded），
   * 避免用户绕过前端只读限制后篡改不可变端口。
   *
   * @throws {ConfigFileReadOnlyError} 配置声明 read_only=true
   * @throws {ConfigFileNotFoundError} configName 不在 Pack config_files 声明中
   */
  async writeConfigFile(
    serverId: string,
    configName: string,
    data: unknown,
  ): Promise<void> {
    const { pack, nodeId } = await this.resolveServerPackWithNode(serverId);
    const { relPath, format, readOnly } = await this.resolveConfigFileInfo(pack, nodeId, serverId, configName);

    if (readOnly) {
      throw new ConfigFileReadOnlyError(
        `配置文件 ${configName} 只读，禁止写入`,
      );
    }

    const content = serializeByFormat(data, format);
    await this.daemonClient.writeFile(nodeId, serverId, relPath, { content });
  }

  /**
   * 创建新的配置文件（用户自定义，非 Pack 声明）。
   *
   * 文件写入 `{instanceRoot}/config/{name}.{ext}`，ext 由 format 推导：
   *   json→.json, yaml→.yaml, properties→.properties, ini→.ini
   *
   * @throws {ValidationError} 配置文件名称与 Pack 声明的 config_files 重名
   */
  async createConfigFile(
    serverId: string,
    name: string,
    format: ConfigFormat,
    content?: string,
  ): Promise<ConfigFileMeta> {
    const { pack, nodeId } = await this.resolveServerPackWithNode(serverId);

    // 检查是否与 Pack 声明的配置重名
    if (pack.config_files?.some((f) => f.name === name)) {
      throw new ValidationError(
        `配置文件名称 "${name}" 与 Pack 声明的配置重名，请使用其他名称`,
      );
    }

    const ext = FORMAT_EXT[format];
    const relPath = `config/${name}${ext}`;

    const initialData = content
      ? formatContentByFormat(content, format)
      : defaultContentForFormat(format);
    await this.daemonClient.writeFile(nodeId, serverId, relPath, {
      content: initialData,
    });

    return { name, path: relPath, format, read_only: false };
  }

  /**
   * 获取配置文件的 schema（供前端渲染表单）。
   * 用户自定义文件（非 Pack 声明）无 schema，返回空对象。
   */
  async getConfigFileSchema(
    serverId: string,
    configName: string,
  ): Promise<Record<string, unknown>> {
    const pack = await this.resolveServerPack(serverId);
    const packFile = pack.config_files?.find((f) => f.name === configName);
    if (!packFile) {
      // 用户自定义文件无 schema
      return {};
    }
    return packFile.schema;
  }

  // -------------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------------

  /** 解析 serverId → pack */
  private async resolveServerPack(serverId: string): Promise<GamePack> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    const pack = this.registry.load(row.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${row.pack_id}`);
    }
    return pack;
  }

  /** 解析 serverId → { pack, nodeId } */
  private async resolveServerPackWithNode(
    serverId: string,
  ): Promise<{ pack: GamePack; nodeId: string }> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row) {
      throw new InstanceNotFoundError(`实例不存在: ${serverId}`);
    }
    const pack = this.registry.load(row.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack 不存在: ${row.pack_id}`);
    }
    return { pack, nodeId: row.node_id };
  }

  /**
   * 解析配置文件信息（Pack 声明 或 用户自定义）。
   * @returns { relPath, format, readOnly }
   * @throws {ConfigFileNotFoundError} 两者都找不到
   */
  private async resolveConfigFileInfo(
    pack: GamePack,
    nodeId: string,
    serverId: string,
    configName: string,
  ): Promise<{ relPath: string; format: ConfigFormat; readOnly: boolean }> {
    // 先查 Pack 声明
    const packFile = pack.config_files?.find((f) => f.name === configName);
    if (packFile) {
      const relPath = await this.resolveConfigRelPath(serverId, pack, packFile);
      return { relPath, format: packFile.format, readOnly: packFile.read_only };
    }

    // 再查用户自定义（config/ 目录）
    try {
      const listing = await this.daemonClient.listFiles(nodeId, serverId, 'config');
      for (const entry of listing.entries) {
        if (entry.type !== 'file') continue;
        const fmt = formatFromPath(entry.name);
        if (!fmt) continue;
        const name = dropExtension(entry.name);
        if (name === configName) {
          return { relPath: `config/${entry.name}`, format: fmt, readOnly: false };
        }
      }
    } catch {
      // config 目录不存在，继续抛错
    }

    throw new ConfigFileNotFoundError(`配置文件不存在: ${configName}`);
  }

  /** 构建路径渲染变量（listConfigFiles 与 resolveConfigRelPath 共用） */
  private buildPathVars(
    serverId: string,
    pack: GamePack,
  ): { instanceRoot: string; vars: Readonly<Record<string, string>> } {
    const instancesDir = process.env.INSTANCES_DIR ?? './instances';
    const instanceRoot = `${instancesDir}/${serverId}`;
    const configDir = `${instanceRoot}/config`;
    const vars: Readonly<Record<string, string>> = {
      config_dir: configDir,
      instance_root: instanceRoot,
      binary: pack.startup.binary,
    };
    return { instanceRoot, vars };
  }

  /** 渲染 config_files[].path 模板，转换为相对 instanceRoot 的路径 */
  private async resolveConfigRelPath(
    serverId: string,
    pack: GamePack,
    configFile: PackConfigFile,
  ): Promise<string> {
    const { instanceRoot, vars } = this.buildPathVars(serverId, pack);
    const absPath = renderTemplate(configFile.path, vars);
    return toRelPath(absPath, instanceRoot);
  }
}

// ----- 纯函数 -----

/** 简单模板渲染：{{var}} → vars[var] */
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

/** 按 format 解析字符串为对象 */
function parseByFormat(content: string, format: ConfigFormat): unknown {
  switch (format) {
    case 'json':
      return JSON.parse(content);
    case 'yaml':
      // P0 简化：YAML 解析使用 JSON 兼容格式（YAML 是 JSON 超集）
      // 实际 YAML 含注释、多行字符串等特性，后续可引入 js-yaml 库
      return JSON.parse(content);
    case 'properties':
      return parseProperties(content);
    case 'ini':
      return parseIni(content);
    default:
      throw new Error(`不支持的 format: ${format}`);
  }
}

/** 按 format 序列化对象为字符串 */
function serializeByFormat(data: unknown, format: ConfigFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      // P0 简化：YAML 序列化使用 JSON 兼容格式
      return JSON.stringify(data, null, 2);
    case 'properties':
      return serializeProperties(data);
    case 'ini':
      return serializeIni(data);
    default:
      throw new Error(`不支持的 format: ${format}`);
  }
}

/** 简单 properties 解析（key=value，# 注释） */
function parseProperties(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

/** 简单 properties 序列化（key=value，扁平结构） */
function serializeProperties(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new Error('properties 格式要求 object 数据');
  }
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}

/** 简单 ini 解析（[section] + key=value） */
function parseIni(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = '__default__';
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][key] = value;
  }
  return result;
}

/** 简单 ini 序列化（[section] + key=value） */
function serializeIni(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    throw new Error('ini 格式要求 object 数据');
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

// ----- 工厂 -----

// ----- createConfigFile 辅助 -----

/** format → 文件扩展名（含点） */
const FORMAT_EXT: Record<ConfigFormat, string> = {
  json: '.json',
  yaml: '.yaml',
  properties: '.properties',
  ini: '.ini',
};

/** 从文件名推导 format，不匹配时返回 null */
function formatFromPath(filename: string): ConfigFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.properties')) return 'properties';
  if (lower.endsWith('.ini')) return 'ini';
  return null;
}

/** 去掉文件扩展名 */
function dropExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

/** 各 format 默认初始内容 */
function defaultContentForFormat(format: ConfigFormat): string {
  switch (format) {
    case 'json':
    case 'yaml':
      return '{}';
    case 'properties':
      return '# 新建配置文件\n';
    case 'ini':
      return '[default]\n';
  }
}

/**
 * 格式化用户提供的初始内容：JSON/YAML 尝试 parse 后重新序列化以确保格式正确，
 * 失败则保持原始内容写入
 */
function formatContentByFormat(content: string, format: ConfigFormat): string {
  if (format === 'json' || format === 'yaml') {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // parse 失败则保持原始内容
    }
  }
  return content;
}

export function createConfigFileService(
  db: Knex,
  registry: PackRegistry,
  daemonClient: DaemonClient,
): ConfigFileServiceImpl {
  return new ConfigFileServiceImpl(db, registry, daemonClient);
}
