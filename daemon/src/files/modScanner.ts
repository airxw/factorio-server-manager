// ============================================================================
// modScanner — Jar 文件 Mod 元数据扫描器（L4）
//
// 职责：
//   - 扫描 .jar 文件内部的 mod 元数据，识别 mod 名称/版本/加载器/运行环境
//   - 支持三种主流 Minecraft mod 加载器的元数据格式：
//       1. fabric.mod.json        → Fabric
//       2. META-INF/mods.toml     → Forge
//       3. META-INF/neoforge.mods.toml → NeoForge
//       4. mcmod.info             → 旧版 Forge
//   - 识别客户端 mod（environment === 'client' 或命中黑名单）
//
// 设计要点：
//   - 使用 yauzl（纯 JS zip 解析，无原生编译依赖）流式读取 jar
//   - 仅读取元数据文件，不解析整个 jar
//   - 解析失败返回 null（不抛出，单文件失败不影响整体扫描）
//   - TOML 解析采用轻量手写解析（仅提取 mods[] 表的 modId/version）
//
// 来源：gsp-optimization-upgrade-plan.md §五.L4
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import type { Entry } from 'yauzl';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** Mod 加载器/平台类型（v4.33.0 扩展多游戏支持，与 daemon-api-types 对齐） */
export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'factorio' | 'umod' | 'bepinex' | 'tmodloader' | 'steam-workshop' | 'unknown';

/** Mod 运行环境 */
export type ModEnvironment = 'client' | 'server' | 'both';

/** 扫描得到的 Mod 元数据 */
export interface ModMetadata {
  /** Mod 显示名称 */
  name: string;
  /** Mod 版本 */
  version: string;
  /** 加载器：fabric / forge / neoforge / unknown */
  loader: ModLoader;
  /** 运行环境：client（仅客户端）/ server（仅服务端）/ both（双端） */
  environment: ModEnvironment;
  /** 是否为客户端 mod（environment === 'client' 或命中黑名单） */
  isClientSide: boolean;
  /** jar 源文件名 */
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 元数据文件在 jar 内的路径 */
const FABRIC_MOD_JSON = 'fabric.mod.json';
const FORGE_MODS_TOML = 'META-INF/mods.toml';
const NEOFORGE_MODS_TOML = 'META-INF/neoforge.mods.toml';
const LEGACY_MCMOD_INFO = 'mcmod.info';

/**
 * 客户端 mod 黑名单（无 environment 字段时按名称兜底识别）。
 * 这些 mod 在服务端安装会导致启动失败或无意义。
 */
const CLIENT_MOD_BLACKLIST = [
  'optifine',
  'optiforge',
  'optifabric',
  'shadermod',
  'shader mod',
  'oculus',
  'iris',
  'irisshaders',
  'rubidium',
  'sodium', // Sodium 为客户端渲染优化，服务端无需
  'lithium', // 注：lithium 实为双端，此处保守排除——实际按 environment 优先
  'entityculling',
  'immediatelyfast',
];

// ---------------------------------------------------------------------------
// yauzl Promise 封装
// ---------------------------------------------------------------------------

/** promisified yauzl.open */
function openZip(jarPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(jarPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }
      if (!zipfile) {
        reject(new Error('yauzl returned null zipfile'));
        return;
      }
      resolve(zipfile);
    });
  });
}

/** 读取指定 entry 的全部内容为字符串 */
function readEntryContent(zipfile: yauzl.ZipFile, entry: Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(err);
        return;
      }
      if (!readStream) {
        reject(new Error('readStream is null'));
        return;
      }
      const chunks: Buffer[] = [];
      readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      readStream.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
      readStream.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------------------
// 元数据文件解析器
// ---------------------------------------------------------------------------

/** fabric.mod.json 解析后的结构（仅取关心的字段） */
interface FabricModJson {
  schemaVersion?: number;
  id?: string;
  name?: string;
  version?: string;
  /** 环境：'client' | 'server' | '*'（双端）；缺省视为双端 */
  environment?: string;
}

/**
 * 解析 fabric.mod.json。
 * environment 取值：'client'（仅客户端）/ 'server'（仅服务端）/ '*' 或缺省（双端）
 */
function parseFabricModJson(content: string, sourceFile: string): ModMetadata | null {
  let data: FabricModJson;
  try {
    data = JSON.parse(content) as FabricModJson;
  } catch {
    return null;
  }
  const name = (data.name ?? data.id ?? sourceFile).trim();
  const version = (data.version ?? 'unknown').trim();
  const environment = normalizeFabricEnvironment(data.environment);
  return {
    name,
    version,
    loader: 'fabric',
    environment,
    isClientSide: isClientMod(environment, name),
    sourceFile,
  };
}

/** 将 fabric environment 字段归一化为 ModEnvironment */
function normalizeFabricEnvironment(env?: string): ModEnvironment {
  if (!env || env === '*' || env === '') return 'both';
  const lower = env.toLowerCase();
  if (lower === 'client') return 'client';
  if (lower === 'server') return 'server';
  return 'both';
}

/**
 * 解析 mods.toml（Forge / NeoForge）。
 * 仅提取第一个 [[mods]] 块的 modId 与 version 字段。
 *
 * 示例片段：
 *   modLoader="javafml"
 *   [[mods]]
 *   modId="examplemod"
 *   version="1.0.0"
 *   displayName="Example Mod"
 */
function parseModsToml(
  content: string,
  sourceFile: string,
  loader: 'forge' | 'neoforge',
): ModMetadata | null {
  const modId = extractTomlValue(content, 'modId');
  const version = extractTomlValue(content, 'version');
  const displayName = extractTomlValue(content, 'displayName');
  if (!modId && !version) {
    return null;
  }
  const name = (displayName || modId || sourceFile).trim();
  // Forge/NeoForge 的 mods.toml 无显式 environment 字段，默认双端
  return {
    name,
    version: (version || 'unknown').trim(),
    loader,
    environment: 'both',
    isClientSide: isClientMod('both', name),
    sourceFile,
  };
}

/**
 * 从 TOML 内容中提取 [[mods]] 块下指定键的值（轻量解析，避免引入 toml 依赖）。
 * 仅匹配 `key="value"` 或 `key='value'` 形式，取第一个匹配。
 */
function extractTomlValue(content: string, key: string): string | null {
  // 匹配 key = "value" 或 key = 'value'
  const regex = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'im');
  const match = content.match(regex);
  return match ? match[1] : null;
}

/** mcmod.info（旧版 Forge）解析后的条目结构 */
interface McmodInfoEntry {
  modid?: string;
  name?: string;
  version?: string;
  description?: string;
}

/**
 * 解析 mcmod.info（旧版 Forge）。
 * 格式为 JSON：{ modList: [...] } 或直接为数组 [...]。
 */
function parseMcmodInfo(content: string, sourceFile: string): ModMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  let entries: McmodInfoEntry[] = [];
  if (Array.isArray(parsed)) {
    entries = parsed as McmodInfoEntry[];
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { modList?: unknown }).modList)
  ) {
    entries = (parsed as { modList: McmodInfoEntry[] }).modList;
  }
  if (entries.length === 0) return null;
  const first = entries[0];
  const name = (first.name || first.modid || sourceFile).trim();
  const version = (first.version || 'unknown').trim();
  return {
    name,
    version,
    loader: 'forge',
    environment: 'both',
    isClientSide: isClientMod('both', name),
    sourceFile,
  };
}

// ---------------------------------------------------------------------------
// 客户端 mod 识别
// ---------------------------------------------------------------------------

/**
 * 判断是否为客户端 mod。
 * 规则：
 *   1. environment === 'client' → 客户端 mod
 *   2. environment 非 client 但 name 命中黑名单 → 客户端 mod
 *   3. 其他 → 非客户端 mod
 */
function isClientMod(environment: ModEnvironment, name: string): boolean {
  if (environment === 'client') return true;
  const lower = name.toLowerCase();
  return CLIENT_MOD_BLACKLIST.some((keyword) => lower.includes(keyword));
}

// ---------------------------------------------------------------------------
// v4.33.0: 多游戏 mod 元数据支持
// ---------------------------------------------------------------------------

/** 游戏类型 → 默认 loader/平台 映射（MC 由元数据决定具体 loader，其余按游戏推断） */
function gameTypeToLoader(gameType?: string): ModLoader {
  switch (gameType) {
    case 'factorio': return 'factorio';
    case 'rust': return 'umod';
    case 'valheim': return 'bepinex';
    case 'terraria':
    case 'terraria-tshock': return 'tmodloader';
    case 'ark':
    case 'zomboid': return 'steam-workshop';
    default: return 'unknown';
  }
}

/** Factorio mod info.json 结构（仅取关心的字段） */
interface FactorioInfoJson {
  name?: string;
  version?: string;
  factorio_version?: string;
  title?: string;
}

/**
 * v4.33.0: 从 Factorio mod zip 中读取 info.json 元数据。
 * zip 内顶层目录为 <modname>_<version>/，info.json 位于其下。
 */
async function scanFactorioInfo(zipPath: string, sourceFile: string): Promise<ModMetadata | null> {
  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await openZip(zipPath);
  } catch {
    return null;
  }
  try {
    const infoContent = await new Promise<string | null>((resolve, reject) => {
      let found: string | null = null;
      zipfile.on('entry', (entry: Entry) => {
        if (entry.fileName.endsWith('/info.json') && !found) {
          readEntryContent(zipfile, entry)
            .then((content) => { found = content; zipfile.readEntry(); })
            .catch(() => { zipfile.readEntry(); });
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(found));
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
    if (!infoContent) return null;
    let data: FactorioInfoJson;
    try {
      data = JSON.parse(infoContent) as FactorioInfoJson;
    } catch {
      return null;
    }
    const name = (data.title ?? data.name ?? sourceFile).trim();
    const version = (data.version ?? 'unknown').trim();
    return {
      name,
      version,
      loader: 'factorio',
      environment: 'both',
      isClientSide: false,
      sourceFile,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 核心扫描函数
// ---------------------------------------------------------------------------

/**
 * 扫描 Minecraft .jar 文件的 mod 元数据（原 scanModMetadata 的 MC 逻辑）。
 *
 * 依次尝试读取：fabric.mod.json → META-INF/neoforge.mods.toml → META-INF/mods.toml → mcmod.info
 * 命中第一个有效元数据即返回。
 */
async function scanJarMetadata(jarPath: string, sourceFile: string): Promise<ModMetadata | null> {
  let zipfile: yauzl.ZipFile;
  try {
    zipfile = await openZip(jarPath);
  } catch {
    return null;
  }

  const targets = new Set<string>([
    FABRIC_MOD_JSON,
    FORGE_MODS_TOML,
    NEOFORGE_MODS_TOML,
    LEGACY_MCMOD_INFO,
  ]);
  const contents = new Map<string, string>();

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: Entry) => {
        if (targets.has(entry.fileName)) {
          readEntryContent(zipfile, entry)
            .then((content) => {
              contents.set(entry.fileName, content);
              zipfile.readEntry();
            })
            .catch((err) => {
              void err;
              zipfile.readEntry();
            });
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } catch {
    // 读取过程中出错，使用已收集的内容继续尝试解析
  }

  const fabricContent = contents.get(FABRIC_MOD_JSON);
  if (fabricContent) {
    const meta = parseFabricModJson(fabricContent, sourceFile);
    if (meta) return meta;
  }
  const neoforgeContent = contents.get(NEOFORGE_MODS_TOML);
  if (neoforgeContent) {
    const meta = parseModsToml(neoforgeContent, sourceFile, 'neoforge');
    if (meta) return meta;
  }
  const forgeContent = contents.get(FORGE_MODS_TOML);
  if (forgeContent) {
    const meta = parseModsToml(forgeContent, sourceFile, 'forge');
    if (meta) return meta;
  }
  const mcmodContent = contents.get(LEGACY_MCMOD_INFO);
  if (mcmodContent) {
    const meta = parseMcmodInfo(mcmodContent, sourceFile);
    if (meta) return meta;
  }

  return {
    name: sourceFile,
    version: 'unknown',
    loader: 'unknown',
    environment: 'both',
    isClientSide: false,
    sourceFile,
  };
}

/**
 * 扫描单个 mod 文件的元数据（v4.33.0 多游戏支持）。
 *
 * 按文件后缀和游戏类型分发：
 *   - .jar（Minecraft）：scanJarMetadata 解析 fabric.mod.json / mods.toml 等
 *   - .zip（Factorio）：读取 zip 内 info.json
 *   - .cs/.dll/.pak/.tmod 等：无标准元数据，返回基础信息（loader 按游戏类型推断）
 *
 * @param filePath mod 文件绝对路径
 * @param opts.gameType 游戏类型（可选，用于推断 loader 和选择解析策略）
 * @returns ModMetadata；文件不存在时返回 null
 */
export async function scanModMetadata(
  filePath: string,
  opts?: { gameType?: string },
): Promise<ModMetadata | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const sourceFile = path.basename(filePath);
  const ext = path.extname(sourceFile).toLowerCase();
  const gameType = opts?.gameType;

  // Minecraft .jar → MC 元数据解析
  if (ext === '.jar' && (!gameType || gameType === 'minecraft')) {
    const meta = await scanJarMetadata(filePath, sourceFile);
    if (meta) return meta;
  }

  // Factorio .zip → info.json 解析
  if (ext === '.zip' && (!gameType || gameType === 'factorio')) {
    const meta = await scanFactorioInfo(filePath, sourceFile);
    if (meta) return meta;
  }

  // 其他格式 → 基础信息（loader 按游戏类型推断）
  const baseName = sourceFile.replace(/\.[^.]+$/, '');
  return {
    name: baseName,
    version: 'unknown',
    loader: gameTypeToLoader(gameType),
    environment: 'both',
    isClientSide: false,
    sourceFile,
  };
}

/**
 * 扫描 mods 目录下所有 mod 文件的元数据（v4.33.0 多游戏支持）。
 *
 * @param modsDir mods 目录绝对路径
 * @param opts.fileExtensions 文件后缀过滤（如 ['.jar'] / ['.zip'] / ['.cs']），默认 ['.jar']
 * @param opts.gameType 游戏类型，用于选择元数据解析策略
 * @returns ModMetadata 数组；目录不存在时返回空数组
 */
export async function scanModsDir(
  modsDir: string,
  opts?: { fileExtensions?: string[]; gameType?: string },
): Promise<ModMetadata[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(modsDir);
  } catch {
    return [];
  }

  const extensions = opts?.fileExtensions ?? ['.jar'];
  const gameType = opts?.gameType;

  const modFiles = names.filter((n) => {
    const lower = n.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
  });
  const results: ModMetadata[] = [];

  for (const name of modFiles) {
    const fullPath = path.join(modsDir, name);
    const meta = await scanModMetadata(fullPath, { gameType });
    if (meta) {
      results.push(meta);
    }
  }

  results.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));
  return results;
}
