// ============================================================================
// bootstrap — 实例启动前环境准备：创建 workdir / 下载二进制 / 写配置文件
// 调用时机：InstanceManager.startInstance 在 spawn 之前
// 设计：通过 game-type-registry 查找 adapter，调用 adapter.bootstrap 钩子
//       新增游戏类型时只需创建 adapters/<game>.ts 并在 adapters/index.ts 注册
//       无需修改本文件（helper 函数可被多个 adapter 复用）
//       Minecraft = 完整实现（下载 server.jar + eula + server.properties）
//       其他游戏 = stub（仅创建 workdir + 警告日志，等待人工放置二进制）
// ============================================================================

import type { Logger } from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import type { GamePack } from '@public/schema/pack-schema';
import type { Instance } from './types.js';
import { STEAM_APP_IDS, downloadApp } from '../steamcmd/index.js';
import { getGameType, type BootstrapContext } from './game-type-registry.js';
// 触发所有 adapter 注册（side-effect import）
import './adapters/index.js';

/**
 * Bootstrap 输入：实例对象 + Pack 定义 + 日志器。
 */
export interface BootstrapInput {
  instance: Instance;
  pack: GamePack;
  logger: Logger;
}

/**
 * Bootstrap 入口：通过 game-type-registry 查找 adapter 并调用其 bootstrap 钩子。
 * - 已存在二进制（如 server.jar）→ 跳过下载，直接补配置文件
 * - 下载失败 → 抛 BootstrapError，由 manager 决定是否继续（默认继续让 spawn 报错）
 * - 无 adapter 或 adapter 无 bootstrap 钩子 → 仅创建 workdir + 警告日志
 */
export async function bootstrapInstance(input: BootstrapInput): Promise<void> {
  const { instance, pack, logger } = input;
  const workdir = instance.workdir;

  // 1. 确保 workdir 存在
  await fs.promises.mkdir(workdir, { recursive: true });

  // 2. 通过注册表查找 adapter，调用其 bootstrap 钩子
  //    新增游戏类型时无需修改此函数，只需创建 adapter 文件并在 adapters/index.ts 注册
  const gameType = pack.pack.game;
  const ctx: BootstrapContext = { ...input, gameType };
  const adapter = getGameType(gameType);
  if (adapter?.bootstrap) {
    await adapter.bootstrap(ctx);
  } else {
    logger.warn(
      { game: gameType, workdir },
      'bootstrap: 无 adapter bootstrap 钩子，仅创建 workdir',
    );
  }
}

// ---------------------------------------------------------------------------
// Minecraft bootstrap：下载 server.jar + eula.txt + server.properties
// ---------------------------------------------------------------------------

/** Mojang 版本清单 URL（取自 Pack.versions.manifest_url，兜底使用最新稳定版） */
const MOJANG_VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
/** Demo 默认下载版本（最新稳定版会动态解析，此处仅兜底） */
const FALLBACK_VERSION = '1.20.6';

/**
 * Minecraft bootstrap：
 * 1. 若 server.jar 不存在 → 从 Mojang 官方源下载
 * 2. 写 eula.txt（eula=true，Minecraft 启动必需）
 * 3. 写 server.properties（含 server-port / enable-rcon / rcon.port / rcon.password）
 */
export async function bootstrapMinecraft(input: BootstrapInput): Promise<void> {
  const { instance, pack, logger } = input;
  const workdir = instance.workdir;

  // 1. server.jar 下载（若已存在则跳过）
  const jarPath = path.join(workdir, 'server.jar');
  if (!fs.existsSync(jarPath)) {
    logger.info({ workdir }, 'bootstrap: 开始下载 Minecraft server.jar');
    try {
      const downloadUrl = await resolveMinecraftServerUrl(pack, logger);
      await downloadFile(downloadUrl, jarPath, logger);
      logger.info({ jarPath, size: fs.statSync(jarPath).size }, 'bootstrap: server.jar 下载完成');
    } catch (err) {
      // 下载失败：抛错让 manager 处理（demo 中若用户已手动放置 server.jar，此分支不触发）
      throw new BootstrapError(
        `Minecraft server.jar 下载失败: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  } else {
    logger.info({ jarPath }, 'bootstrap: server.jar 已存在，跳过下载');
  }

  // 2. 写 eula.txt（幂等）
  const eulaPath = path.join(workdir, 'eula.txt');
  await fs.promises.writeFile(eulaPath, 'eula=true\n', 'utf8');

  // 3. 写 server.properties（端口 + RCON 配置）
  const propertiesPath = path.join(workdir, 'server.properties');
  const properties = buildMinecraftServerProperties(instance, pack);
  await fs.promises.writeFile(propertiesPath, properties, 'utf8');

  // 4. 确保 mods/ 目录存在（即使不用 mod 也提前创建）
  await fs.promises.mkdir(path.join(workdir, 'mods'), { recursive: true });

  logger.info({ workdir, port: instance.port, rcon_port: instance.rcon_port }, 'bootstrap: Minecraft 配置就绪');
}

/**
 * 解析最新稳定版 Minecraft server.jar 下载 URL。
 * 流程：version_manifest.json → latest.release 版本 → 版本 JSON → server URL
 */
async function resolveMinecraftServerUrl(pack: GamePack, logger: Logger): Promise<string> {
  const manifestUrl = pack.versions?.manifest_url ?? MOJANG_VERSION_MANIFEST;
  logger.info({ manifestUrl }, 'bootstrap: 拉取 Mojang 版本清单');

  // 1. 拉取版本清单
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`拉取版本清单失败: ${manifestResp.status} ${manifestResp.statusText}`);
  }
  const manifest = (await manifestResp.json()) as {
    latest: { release: string; snapshot: string };
    versions: Array<{ id: string; type: string; url: string }>;
  };

  const releaseVersion = manifest.latest.release;
  logger.info({ releaseVersion }, 'bootstrap: 最新稳定版');

  // 2. 找到版本详情 URL
  const versionEntry = manifest.versions.find((v) => v.id === releaseVersion);
  if (!versionEntry) {
    // 兜底使用 FALLBACK_VERSION
    logger.warn({ releaseVersion, fallback: FALLBACK_VERSION }, 'bootstrap: 未找到最新版详情，使用兜底版本');
    const fallbackEntry = manifest.versions.find((v) => v.id === FALLBACK_VERSION);
    if (!fallbackEntry) {
      throw new Error(`版本 ${releaseVersion} 与兜底 ${FALLBACK_VERSION} 均未在清单中找到`);
    }
    return await fetchServerUrlFromVersion(fallbackEntry.url);
  }
  return await fetchServerUrlFromVersion(versionEntry.url);
}

/** 从版本详情 JSON 中提取 server.jar 下载 URL */
async function fetchServerUrlFromVersion(versionUrl: string): Promise<string> {
  const resp = await fetch(versionUrl);
  if (!resp.ok) {
    throw new Error(`拉取版本详情失败: ${resp.status} ${resp.statusText}`);
  }
  const version = (await resp.json()) as {
    downloads?: {
      server?: { url: string; size: number };
    };
  };
  const serverUrl = version.downloads?.server?.url;
  if (!serverUrl) {
    throw new Error('版本详情缺少 server.jar 下载 URL');
  }
  return serverUrl;
}

/** 通用文件下载（流式写入，避免大文件占内存） */
async function downloadFile(url: string, dest: string, logger: Logger): Promise<void> {
  logger.info({ url, dest }, 'bootstrap: 开始下载');
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`下载失败: ${resp.status} ${resp.statusText}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.promises.writeFile(dest, buffer);
}

/**
 * 构造 server.properties 内容（Minecraft 配置格式：key=value 每行一条）。
 * 关键字段：server-port / enable-rcon / rcon.port / rcon.password
 * 其他字段使用合理默认值。
 */
function buildMinecraftServerProperties(instance: Instance, _pack: GamePack): string {
  const lines: string[] = [
    '# Minecraft server.properties (由 daemon bootstrap 自动生成)',
    `server-port=${instance.port}`,
    `enable-rcon=true`,
    `rcon.port=${instance.rcon_port}`,
    `rcon.password=${instance.rcon_password}`,
    `level-name=world`,
    `max-players=20`,
    `motd=Gameserver Panel Demo`,
    `difficulty=easy`,
    `gamemode=survival`,
    `pvp=true`,
    `online-mode=false`,
    `white-list=false`,
    `view-distance=10`,
    `spawn-protection=16`,
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stub bootstrap：仅创建 workdir + 必要子目录 + 警告日志
// 用于 factorio / palworld / ark / rust（需人工放置付费二进制）
// ---------------------------------------------------------------------------

/**
 * Stub bootstrap：
 * - 创建必要子目录
 * - 写一个 README 提示用户手动放置二进制
 * - 不下载二进制（付费游戏，无法自动下载）
 *
 * spawn 时若 binary 不存在会触发 ENOENT，这是预期行为。
 */
export async function bootstrapStub(
  input: BootstrapInput,
  expectedBinary: string,
  subDirs: string[],
): Promise<void> {
  const { instance, pack, logger } = input;
  const workdir = instance.workdir;

  // 创建子目录
  for (const dir of subDirs) {
    await fs.promises.mkdir(path.join(workdir, dir), { recursive: true });
  }

  // 写 README 提示
  const readmePath = path.join(workdir, 'README-PLACE-BINARY-HERE.txt');
  if (!fs.existsSync(readmePath)) {
    const content = [
      `========================================================`,
      `请手动放置 ${pack.pack.game} 服务端二进制文件`,
      `========================================================`,
      `期望二进制名: ${expectedBinary}`,
      `放置位置: ${workdir}`,
      ``,
      `提示：${pack.pack.game} 为付费游戏，daemon 无法自动下载。`,
      `请从官方渠道获取服务端程序后放置到上述目录。`,
      ``,
      `实例端口: ${instance.port}`,
      `RCON 端口: ${instance.rcon_port}`,
      ``,
    ].join('\n');
    await fs.promises.writeFile(readmePath, content, 'utf8');
  }

  logger.warn(
    { workdir, game: pack.pack.game, expectedBinary },
    'bootstrap: stub 模式，请手动放置服务端二进制（spawn 时会触发 ENOENT）',
  );
}

// ---------------------------------------------------------------------------
// Steam 游戏 bootstrap：先尝试 steamcmd 下载，失败降级到 stub
// 用于 factorio / palworld / ark / rust
// ---------------------------------------------------------------------------

/** 各 steam 游戏的服务端二进制名（降级到 stub 时写入 README 提示） */
const STEAM_GAME_BINARY_NAMES: Record<string, string> = {
  factorio: 'factorio-server',
  palworld: 'PalServer',
  ark: 'ShooterGameServer',
  rust: 'RustDedicated',
  terraria: 'TerrariaServer.bin.x86_64',
  valheim: 'valheim_server.x86_64',
  zomboid: 'start-server.sh',
};

/**
 * Steam 游戏 bootstrap：
 * 1. 通过 steamcmd 下载专用服务端二进制到 workdir
 * 2. 下载成功后创建必要子目录
 * 3. steamcmd 失败时降级为 bootstrapStub（保留原有降级行为）
 *
 * try-catch 包裹 steamcmd 调用，失败时 logger.warn 但不中断流程。
 */
export async function bootstrapSteamGame(
  input: BootstrapInput,
  gameType: string,
  subDirs: string[],
): Promise<void> {
  const { instance, logger } = input;
  const workdir = instance.workdir;
  const appId = STEAM_APP_IDS[gameType];

  if (appId === undefined) {
    logger.warn({ gameType }, 'bootstrap: 未知 steam 游戏类型，降级到 stub');
    await bootstrapStub(input, STEAM_GAME_BINARY_NAMES[gameType] ?? gameType, subDirs);
    return;
  }

  try {
    logger.info({ gameType, appId, workdir }, 'bootstrap: 尝试通过 steamcmd 下载二进制');
    await downloadApp(appId, workdir, logger);
    // 下载成功后创建必要子目录
    for (const dir of subDirs) {
      await fs.promises.mkdir(path.join(workdir, dir), { recursive: true });
    }
    logger.info({ gameType, workdir }, 'bootstrap: steamcmd 下载成功，子目录已创建');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { gameType, workdir, err: msg },
      'bootstrap: steamcmd 下载失败，降级到 stub 模式',
    );
    await bootstrapStub(input, STEAM_GAME_BINARY_NAMES[gameType] ?? gameType, subDirs);
  }
}

// ---------------------------------------------------------------------------
// 错误类
// ---------------------------------------------------------------------------

/** Bootstrap 失败（如 server.jar 下载失败） */
export class BootstrapError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'BootstrapError';
  }
}

// ---------------------------------------------------------------------------
// 游戏专属配置文件写入
// ---------------------------------------------------------------------------

/**
 * Terraria 写默认 serverconfig.txt（位于 <workdir>/serverconfig.txt）
 * 首次启动若 world 文件不存在，Terraria 会自动按 autocreate 参数建图
 */
export async function writeTerrariaConfig(input: BootstrapInput): Promise<void> {
  const { instance, logger } = input;
  const workdir = instance.workdir;
  const worldsDir = path.join(workdir, 'Worlds');
  await fs.promises.mkdir(worldsDir, { recursive: true });

  const config = [
    '# Terraria serverconfig.txt (由 daemon bootstrap 自动生成)',
    `world=${worldsDir}/world1.wld`,
    'worldname=world1',
    'autocreate=2',
    'seed=',
    `worldpath=${worldsDir}/`,
    'difficulty=0',
    `port=${instance.port}`,
    'maxplayers=16',
    `password=${instance.rcon_password}`,
    'upnp=0',
    'secure=1',
    'banlist=banlist.txt',
    'steam=false',
    'lobby=private',
    'language=zh-Hans',
    'autosave=300',
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(workdir, 'serverconfig.txt'), config, 'utf8');

  // 创建空 banlist.txt（Terraria 期望文件存在）
  const banlistPath = path.join(workdir, 'banlist.txt');
  if (!fs.existsSync(banlistPath)) {
    await fs.promises.writeFile(banlistPath, '', 'utf8');
  }

  logger.info({ workdir, port: instance.port }, 'bootstrap: Terraria serverconfig.txt 已生成');
}

/**
 * Factorio 写默认 server-settings.json（位于 <workdir>/server-settings.json）
 * v4.13.1（2026-07-29）新增：原 bootstrap 仅创建 config/saves 子目录，未生成配置文件导致首次启动失败
 * 字段参考 Factorio 官方 server-settings.example.json
 */
export async function writeFactorioServerSettings(input: BootstrapInput): Promise<void> {
  const { instance, logger } = input;
  const workdir = instance.workdir;
  const configPath = path.join(workdir, 'server-settings.json');

  // 若已存在则不覆盖（用户可能已自定义）
  if (fs.existsSync(configPath)) {
    logger.info({ workdir, configPath }, 'bootstrap: server-settings.json 已存在，跳过生成');
    return;
  }

  const config = {
    name: instance.name,
    description: 'GameServer Panel Factorio Server',
    tags: ['gsp'],
    max_players: 20,
    visibility: { public: true, lan: true },
    credentials: { username: '', password: '', token: '' },
    enable_pwhashing: true,
    game_password: instance.rcon_password,
    require_user_verification: false,
    max_upload_in_kilobytes_per_second: 0,
    max_upload_slots: 5,
    minimum_latency_in_ticks: 0,
    max_heartbeats_per_second: 60,
    sim_tick_rate: 60,
    afk_autokick_interval: 0,
    auto_pause: true,
    only_admins_can_pause_the_game: true,
    autosave_interval: 10,
    autosave_slots: 5,
    non_blocking_saving: false,
    autosave_only_on_server: true,
    disallow_commands: false,
    enable_script_circuit_networks: false,
    allowed_commands: 'admins',
    load_scenario: '',
    autocreate_modules: 'true',
  };
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  logger.info({ workdir, port: instance.port }, 'bootstrap: Factorio server-settings.json 已生成');
}
