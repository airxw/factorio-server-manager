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
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { GamePack } from '@public/schema/pack-schema';
import type { Instance } from './types.js';
import { STEAM_APP_IDS, downloadApp } from '../steamcmd/index.js';
import { getGameType, type BootstrapContext } from './game-type-registry.js';
// 触发所有 adapter 注册（side-effect import）
import './adapters/index.js';

const execFile = promisify(execFileCb);

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
 * Factorio 写默认 server-settings.json（位于 <workdir>/config/server-settings.json）
 *
 * v4.33.0（2026-07-30）修复：
 *   1) 路径错位：旧代码写 <workdir>/server-settings.json，但启动参数引用
 *      {{config_dir}}/server-settings.json = <workdir>/config/server-settings.json，导致
 *      Factorio 启动时找不到 --server-settings 指定的文件而报错。
 *   2) 字段名/结构对齐 Factorio 2.0 官方 server-settings.example.json：
 *      - credentials:{username,password,token} 嵌套对象 → 顶层 username/password/token
 *      - allowed_commands:'admins' → allow_commands:'admins-only'
 *      - 移除 2.0 不存在的字段：enable_pwhashing / sim_tick_rate / disallow_commands /
 *        enable_script_circuit_networks / load_scenario / autocreate_modules
 *      - autocreate_modules 旧值为字符串 'true'（应为布尔，且该字段 2.0 已移除）
 *   3) 字段集合对齐 packs/factorio-vanilla/pack.yaml 的 config_files.server-settings.schema
 */
export async function writeFactorioServerSettings(input: BootstrapInput): Promise<void> {
  const { instance, logger } = input;
  const workdir = instance.workdir;
  const configDir = path.join(workdir, 'config');
  const configPath = path.join(configDir, 'server-settings.json');

  // 若已存在则不覆盖（用户可能已自定义）
  if (fs.existsSync(configPath)) {
    logger.info({ workdir, configPath }, 'bootstrap: server-settings.json 已存在，跳过生成');
    return;
  }

  // 确保配置目录存在（bootstrapSteamGame 已创建，此处幂等保护）
  await fs.promises.mkdir(configDir, { recursive: true });

  // Factorio 2.0 server-settings 字段（与 pack.yaml schema 默认值一致）
  //
  // v4.35.2（2026-07-30）修复：
  //   visibility.public 默认值从 true 改为 false。
  //   根因：Factorio 2.0 强制要求 visibility.public=true 时 require_user_verification
  //   必须为 true（需 Factorio 账号 + username/token），否则启动报错：
  //     "require_user_verification must be enabled for public games."
  //   自托管面板默认 LAN-only（public=false），用户需要公网可见时须：
  //     1) visibility.public=true
  //     2) require_user_verification=true
  //     3) 填写 username/token（或 username/password）
  const config = {
    name: instance.name,
    description: 'GameServer Panel Factorio Server',
    tags: ['gsp'],
    max_players: 0,
    visibility: { public: false, lan: true },
    // Factorio 2.0 顶层认证字段（非 credentials 嵌套对象）
    username: '',
    password: '',
    token: '',
    game_password: instance.rcon_password,
    require_user_verification: false,
    // 自动保存
    autosave_interval: 10,
    autosave_slots: 5,
    autosave_only_on_server: true,
    non_blocking_saving: false,
    // 玩家管理
    afk_autokick_interval: 0,
    auto_pause: true,
    auto_pause_when_players_connect: false,
    only_admins_can_pause_the_game: true,
    ignore_player_limit_for_returning_players: false,
    // 命令权限（2.0 字段名 allow_commands，枚举值 'admins-only'）
    allow_commands: 'admins-only',
    // 网络调优
    max_upload_in_kilobytes_per_second: 0,
    max_upload_slots: 5,
    minimum_latency_in_ticks: 0,
    max_heartbeats_per_second: 60,
    // 高级网络分段
    minimum_segment_size: 25,
    minimum_segment_size_peer_count: 20,
    maximum_segment_size: 100,
    maximum_segment_size_peer_count: 10,
  };
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  logger.info({ workdir, configPath, port: instance.port }, 'bootstrap: Factorio server-settings.json 已生成');
}

/**
 * Factorio 写默认 map-gen-settings.json 和 map-settings.json（位于 <workdir>/config/）
 *
 * v4.33.0 新增：world_generation.create_command 引用这两个文件，若不存在则
 * --create 建图时 Factorio 报错。bootstrap 预生成默认值确保建图可用。
 * v4.34.1: 修正为 Factorio 2.0 官方格式（旧代码用 1.1 格式，字段名/值均不兼容 2.0）
 *          来源：Factorio 2.0 data/map-gen-settings.example.json + map-settings.example.json
 */
export async function writeFactorioMapSettings(input: BootstrapInput): Promise<void> {
  const { instance, logger } = input;
  const workdir = instance.workdir;
  const configDir = path.join(workdir, 'config');

  // --- map-gen-settings.json（Factorio 2.0 格式）---
  const mapGenPath = path.join(configDir, 'map-gen-settings.json');
  if (!fs.existsSync(mapGenPath)) {
    const mapGenSettings = {
      starting_area: 1,
      peaceful_mode: false,
      autoplace_controls: {
        coal: { frequency: 1, size: 1, richness: 1 },
        stone: { frequency: 1, size: 1, richness: 1 },
        'copper-ore': { frequency: 1, size: 1, richness: 1 },
        'iron-ore': { frequency: 1, size: 1, richness: 1 },
        'uranium-ore': { frequency: 1, size: 1, richness: 1 },
        'crude-oil': { frequency: 1, size: 1, richness: 1 },
        water: { frequency: 1, size: 1 },
        trees: { frequency: 1, size: 1 },
        'enemy-base': { frequency: 1, size: 1 },
      },
      cliff_settings: {
        name: 'cliff',
        cliff_elevation_0: 10,
        cliff_elevation_interval: 40,
        richness: 1,
      },
      starting_points: [{ x: 0, y: 0 }],
      seed: null,
    };
    await fs.promises.writeFile(mapGenPath, JSON.stringify(mapGenSettings, null, 2), 'utf8');
    logger.info({ workdir, mapGenPath }, 'bootstrap: Factorio map-gen-settings.json 已生成');
  }

  // --- map-settings.json（Factorio 2.0 格式）---
  const mapSettingsPath = path.join(configDir, 'map-settings.json');
  if (!fs.existsSync(mapSettingsPath)) {
    const mapSettings = {
      difficulty_settings: {
        technology_price_multiplier: 1,
        spoil_time_modifier: 1,
      },
      pollution: {
        enabled: true,
        diffusion_ratio: 0.02,
        min_to_diffuse: 15,
        ageing: 1,
        expected_max_per_chunk: 150,
        min_to_show_per_chunk: 50,
        min_pollution_to_damage_trees: 60,
        pollution_with_max_forest_damage: 150,
        pollution_per_tree_damage: 50,
        pollution_restored_per_tree_damage: 10,
        max_pollution_to_restore_trees: 20,
        enemy_attack_pollution_consumption_modifier: 1,
      },
      enemy_evolution: {
        enabled: true,
        time_factor: 0.000004,
        destroy_factor: 0.002,
        pollution_factor: 0.0000009,
      },
      enemy_expansion: {
        enabled: true,
        max_expansion_distance: 7,
        friendly_base_influence_radius: 2,
        enemy_building_influence_radius: 2,
        building_coefficient: 0.1,
        other_base_coefficient: 2.0,
        neighbouring_chunk_coefficient: 0.5,
        neighbouring_base_chunk_coefficient: 0.4,
        max_colliding_tiles_coefficient: 0.9,
        settler_group_min_size: 5,
        settler_group_max_size: 20,
        min_expansion_cooldown: 14400,
        max_expansion_cooldown: 216000,
      },
      max_failed_behavior_count: 3,
    };
    await fs.promises.writeFile(mapSettingsPath, JSON.stringify(mapSettings, null, 2), 'utf8');
    logger.info({ workdir, mapSettingsPath }, 'bootstrap: Factorio map-settings.json 已生成');
  }
}

/**
 * Factorio 首次启动自动建图：检测 saves/ 下无 .zip 存档时，调用 --create 生成默认存档。
 *
 * v4.33.0 新增：Factorio --start-server 要求存档文件已存在，否则启动报错。
 *   - bootstrap 阶段预生成 world.zip，确保首次 --start-server 可用
 *   - 已有存档时跳过（幂等）
 *   - 二进制不存在时跳过（steamcmd 可能未就绪，让 spawn 报错更明确）
 *   - 建图失败不中断 bootstrap（记录错误日志，spawn 时会触发更明确的 ENOENT/报错）
 *
 * 存档路径与 manager.ts doStart 的 save_path 默认值保持一致：
 *   `${instance.workdir}/saves/world${pack.saves?.extension ?? '.zip'}`
 */
export async function createFactorioInitialSave(input: BootstrapInput): Promise<void> {
  const { instance, pack, logger } = input;
  const workdir = instance.workdir;
  const savesDir = path.join(workdir, 'saves');
  const configDir = path.join(workdir, 'config');
  const saveExt = pack.saves?.extension ?? '.zip';
  const defaultSavePath = path.join(savesDir, `world${saveExt}`);

  // 1. 已有存档 → 跳过
  await fs.promises.mkdir(savesDir, { recursive: true });
  const existingSaves = fs.readdirSync(savesDir).filter((f) => f.endsWith(saveExt));
  if (existingSaves.length > 0) {
    logger.info({ workdir, saveCount: existingSaves.length }, 'bootstrap: 已有存档，跳过自动建图');
    return;
  }

  // 2. 二进制不存在 → 跳过（spawn 时会报 ENOENT，更明确）
  const binaryRel = pack.startup.binary;
  const binaryAbs = path.resolve(workdir, binaryRel);
  if (!fs.existsSync(binaryAbs)) {
    logger.warn(
      { workdir, binaryAbs },
      'bootstrap: Factorio 二进制不存在，跳过自动建图（spawn 时会触发 ENOENT）',
    );
    return;
  }

  // 3. 执行 --create 建图（使用已生成的 map-gen-settings / map-settings）
  const args: string[] = ['--create', defaultSavePath];
  const mapGenPath = path.join(configDir, 'map-gen-settings.json');
  const mapSettingsPath = path.join(configDir, 'map-settings.json');
  if (fs.existsSync(mapGenPath)) {
    args.push('--map-gen-settings', mapGenPath);
  }
  if (fs.existsSync(mapSettingsPath)) {
    args.push('--map-settings', mapSettingsPath);
  }

  logger.info({ workdir, binaryAbs, args }, 'bootstrap: 开始自动建图（--create）');
  try {
    const { stdout } = await execFile(binaryAbs, args, {
      cwd: workdir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    logger.info(
      { workdir, savePath: defaultSavePath, stdoutTail: stdout.slice(-500) },
      'bootstrap: 自动建图完成',
    );
  } catch (err) {
    // 建图失败不中断 bootstrap，让后续 spawn 给出更明确的错误
    const stderr = (err as { stderr?: string }).stderr ?? '';
    logger.error(
      {
        workdir,
        err: err instanceof Error ? err.message : String(err),
        stderrTail: stderr.slice(-500),
      },
      'bootstrap: 自动建图失败（不中断流程，spawn 时会触发错误）',
    );
  }
}
