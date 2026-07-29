// ============================================================================
// fixtures — 测试实例数据与 Pack 夹具
// 构造最小可用的 Instance / GamePack 对象，覆盖 manager 测试所需的游戏类型分支
// ============================================================================

import type { GamePack } from '@public/schema/pack-schema';
import type { Instance } from '../instances/types.js';

/**
 * Minecraft 实例：protocol=rcon，stop_command='stop'，走 RCON + 信号升级链
 * ready_pattern 命中 "Done (x.xxxs)! For help, type \"help\""
 */
export const minecraftInstance: Instance = {
  id: 'inst-mc-test',
  name: 'Test Minecraft',
  pack_id: 'minecraft-vanilla',
  status: 'stopped',
  port: 25565,
  rcon_port: 25575,
  rcon_password: 'test-rcon-pass',
  workdir: '/tmp/gsp-test/inst-mc-test',
  pid: null,
  started_at: null,
};

/**
 * Valheim 实例：protocol=stdin，stop_command=null，命中 SIGINT_STOP_GAMES 走 SIGINT
 */
export const valheimInstance: Instance = {
  id: 'inst-val-test',
  name: 'Test Valheim',
  pack_id: 'valheim-vanilla',
  status: 'stopped',
  port: 2456,
  rcon_port: 0,
  rcon_password: 'test-val-pass',
  workdir: '/tmp/gsp-test/inst-val-test',
  pid: null,
  started_at: null,
};

/**
 * 崩溃测试实例：复用 Minecraft 配置，独立 ID 便于在崩溃循环中追踪
 */
export const crashingInstance: Instance = {
  ...minecraftInstance,
  id: 'inst-crash-test',
  name: 'Test Crashing Server',
};

/** Minecraft Vanilla Pack：rcon 协议 + stop 命令 + Minecraft ready_pattern */
export const minecraftPack: GamePack = {
  pack: {
    id: 'minecraft-vanilla',
    game: 'minecraft',
    variant: 'vanilla',
    display_name: 'Minecraft Vanilla',
    version: '1.20.4',
  },
  startup: {
    binary: 'java',
    args: ['-jar', 'server.jar', 'nogui'],
    working_dir: '{{instance_root}}',
    ready_pattern: 'Done \\([\\d.]+s\\)! For help, type "help"',
    stop_command: 'stop',
    stop_timeout: 10,
    default_game_port: 25565,
  },
  protocol: {
    type: 'rcon',
    default_port: 25575,
    auth: 'password',
    encrypt: 'none',
  },
  commands: {},
  versions: {
    source: 'mock',
    type: 'server-jar',
    eula_required: true,
  },
  backup: {
    world_dir: 'world',
    pre_backup_commands: [],
    post_backup_commands: [],
  },
  ui: { tabs: [] },
  resources: {
    min_ram: '1G',
    recommended_ram: '2G',
    min_disk: '1G',
  },
};

/** Valheim Pack：stdin 协议 + stop_command=null + 命中 SIGINT_STOP_GAMES */
export const valheimPack: GamePack = {
  ...minecraftPack,
  pack: {
    id: 'valheim-vanilla',
    game: 'valheim',
    variant: 'vanilla',
    display_name: 'Valheim Dedicated',
    version: '1.0.0',
  },
  startup: {
    binary: 'valheim-server',
    args: ['-name', 'test'],
    working_dir: '{{instance_root}}',
    ready_pattern: 'Game server started',
    stop_command: null,
    stop_timeout: 10,
    default_game_port: 2456,
  },
  protocol: {
    type: 'stdin',
    default_port: 0,
    auth: 'none',
    encrypt: 'none',
  },
};

/** Minecraft ready_pattern 命中行（用于 emitStdout 触发就绪检测） */
export const MINECRAFT_READY_LINE = 'Done (1.234s)! For help, type "help"\n';
/** Valheim ready_pattern 命中行 */
export const VALHEIM_READY_LINE = 'Game server started\n';
