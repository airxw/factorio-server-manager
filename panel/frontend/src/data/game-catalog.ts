// ============================================================================
// game-catalog.ts — 游戏目录单一来源（single source of truth）
// 12 款游戏的全部展示字段 + landingData 引用
// 替换 Home.tsx 内部硬编码的 PACKS 数组与 4 处数据多源
// ============================================================================

import type { GameLandingData } from './game-landing-data';
import {
  TERRARIA_DATA,
  VALHEIM_DATA,
  ZOMBOID_DATA,
  PALWORLD_DATA,
  ARK_DATA,
  RUST_DATA,
} from './game-landing-data';
import { GAME_THEMES } from '../context/GameThemeContext';

export type GameThemeId =
  | 'default'
  | 'minecraft'
  | 'factorio'
  | 'palworld'
  | 'ark'
  | 'rust'
  | 'terraria'
  | 'valheim'
  | 'zomboid';

export type GameCategory =
  | '沙盒建造'
  | '策略模拟'
  | '生存冒险'
  | '生存竞技'
  | '沙盒冒险';

export interface GameCatalogEntry {
  /** 与 GameThemeId 对齐（除 'default' 外） */
  id: GameThemeId;
  name: string;
  tagline: string;
  icon: string;
  /** 主题色（与 GameThemeContext.primary 同步，Home 卡片渲染用） */
  color: string;
  category: GameCategory;
  visualStyle: string;
  /** 简短描述（Home 卡卡片使用） */
  desc: string;
  /** 端口（无 RCON 时为 null） */
  port: number | null;
  /** RCON 端口（无 RCON 时为 null） */
  rconPort: number | null;
  /** 端口展示文本 */
  portDisplay: string;
  /** 控制协议展示文本（"stdin" / 真实端口） */
  rconDisplay: string;
  /** RCON 协议标签 */
  protocol: 'stdin' | 'rcon';
  /** UI Tab 数量描述，如 "8 UI Tabs" */
  features: string;
  /** 卡片详情 4-5 条 */
  details: string[];
  /** 落地页数据（无则不显示落地页） */
  landingData: GameLandingData | null;
  /** 3D 圆环环绕用 sprite 路径列表（public/ 下），不足 8 张时自动循环复用 */
  sprites: string[];
}

const STDIN = 'stdin';

/** 构建 sprite 路径（public/game-sprites/ 下） */
function spritesOf(folder: string, names: string[]): string[] {
  return names.map((n) => `/game-sprites/${folder}/${n}`);
}

/** 从 GameThemeContext 拿主题色，注入到 catalog 中 */
function colorOf(id: GameThemeId): string {
  return GAME_THEMES[id]?.primary ?? '#06b6d4';
}

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: 'minecraft',
    name: 'Minecraft',
    tagline: '我的世界 · 沙盒建造',
    icon: '🟩',
    color: colorOf('minecraft'),
    category: '沙盒建造',
    visualStyle: '像素方块 · 草绿主题',
    desc: '像素方块沙盒巨作，支持原版/Forge/Fabric/Paper 等多种服务端，红石机械、命令方块、数据包全覆盖。',
    port: 25565,
    rconPort: 25575,
    portDisplay: '25565',
    rconDisplay: '25575',
    protocol: 'rcon',
    features: '8 UI Tabs',
    details: [
      '红石机械 + 命令方块 + 数据包自动化',
      '四级 OP 权限 + LuckPerms 权限体系',
      'RCON 远程控制 + 白名单管理',
      'Multiverse 多世界 + 跨维度传送',
      'Hypixel 小游戏 / RPG / 生存服全覆盖',
    ],
    landingData: null, // 走 MinecraftLanding 专属组件
    sprites: spritesOf('minecraft', ['grass.png', 'crafting.png', 'diamond.png', 'sword.png']),
  },
  {
    id: 'factorio',
    name: 'Factorio',
    tagline: '异星工厂 · 工业自动化',
    icon: '⚙️',
    color: colorOf('factorio'),
    category: '策略模拟',
    visualStyle: '工业机械 · 橙色齿轮',
    desc: '工业自动化建造类游戏开创者，传送带 + 机械臂 + 组装机三件套，电路网络图灵完备。',
    port: 34197,
    rconPort: 27015,
    portDisplay: '34197',
    rconDisplay: '27015',
    protocol: 'stdin',
    features: '8 UI Tabs',
    details: [
      '电路网络系统（Combinator 编程）',
      '蓝图字符串分享 + 蓝图库管理',
      'Lua 脚本注入 + 控制台命令系统',
      'MOD 服务器 + 客户端自动同步',
      '多人协作大型工厂 + City Block 设计',
    ],
    landingData: null, // 走 FactorioLanding 专属组件
    sprites: spritesOf('factorio', ['Iron_gear_wheel.png', 'Inserter.png', 'Assembling_machine_3.png', 'Transport_belt.png', 'Electronic_circuit.png', 'Steel_axe.png']),
  },
  {
    id: 'palworld',
    name: 'Palworld',
    tagline: '幻兽帕鲁 · 生物养成',
    icon: '🐉',
    color: colorOf('palworld'),
    category: '生存冒险',
    visualStyle: '明亮可爱 · 青色战斗',
    desc: '"Pokemon with guns" 标签的 3D 卡通冒险游戏，200+ 帕鲁捕捉、基地自动化、Raid 防御。',
    port: 8211,
    rconPort: 25575,
    portDisplay: '8211',
    rconDisplay: '25575',
    protocol: 'rcon',
    features: '6 UI Tabs',
    details: [
      '200+ 帕鲁捕捉 + 伙伴技能系统',
      '基地自动化 + 工作适应性机制',
      'RCON 远程控制 + 公会管理',
      'PvP/PvE 模式切换 + Raid 波次',
      '32 人跨平台联机（Steam/Xbox）',
    ],
    sprites: spritesOf('palworld', ['header.jpg']),
    landingData: PALWORLD_DATA,
  },
  {
    id: 'ark',
    name: 'ARK',
    tagline: '方舟 · 恐龙世界',
    icon: '🦖',
    color: colorOf('ark'),
    category: '生存冒险',
    visualStyle: '恐龙丛林 · 紫色神秘',
    desc: '恐龙驯养 + 生存建造巨作，100+ 史前生物可驯服骑乘，部落战争 + 集群跨服。',
    port: 7777,
    rconPort: 27020,
    portDisplay: '7777',
    rconDisplay: '27020',
    protocol: 'rcon',
    features: '6 UI Tabs',
    details: [
      '100+ 恐龙驯养 + 繁殖系统',
      '部落治理 + 多管理员权限体系',
      'Cluster 集群 + Cross-ARK 跨服迁移',
      'Steam Workshop MOD 自动同步',
      'Engram 图鉴 + 泰克科技进化',
    ],
    sprites: spritesOf('ark', ['Rex.png', 'Raptor.png', 'Dodo.png', 'Trike.png', 'Pteranodon.png', 'header.jpg']),
    landingData: ARK_DATA,
  },
  {
    id: 'rust',
    name: 'RUST',
    tagline: '腐蚀 · 生存竞技',
    icon: '🔫',
    color: colorOf('rust'),
    category: '生存竞技',
    visualStyle: '荒野废土 · 红色铁锈',
    desc: '硬核生存 PvP 竞技，基地建设 + 电力系统 + 武器工坊，每月 Force Wipe 节奏。',
    port: 28015,
    rconPort: 28016,
    portDisplay: '28015',
    rconDisplay: '28016',
    protocol: 'rcon',
    features: '6 UI Tabs',
    details: [
      '蓝图 3.0 系统 + 三级工作台',
      '电力系统 + 自动化防御塔',
      'Oxide/uMod/Carbon 插件框架',
      'Web RCON + 实时监控',
      'Force Wipe 清档管理 + VIP 队列',
    ],
    sprites: spritesOf('rust', ['header.jpg']),
    landingData: RUST_DATA,
  },
  {
    id: 'terraria',
    name: 'Terraria',
    tagline: '泰拉瑞亚 · 2D 沙盒冒险',
    icon: '⛏️',
    color: colorOf('terraria'),
    category: '沙盒冒险',
    visualStyle: '多彩像素 · 2D 矿石',
    desc: '经典 2D 像素沙盒冒险，33+ Boss 战 + 上千配方 + Hardmode 世界腐化，TShock 增强。',
    port: TERRARIA_DATA.port,
    rconPort: TERRARIA_DATA.rconPort,
    portDisplay: String(TERRARIA_DATA.port),
    rconDisplay: STDIN,
    protocol: 'stdin',
    features: '8 UI Tabs',
    details: [
      '33+ Boss 战 + 阶段性难度',
      'Hardmode 世界腐化/神圣化',
      'TShock 权限 + 区域保护',
      'tModLoader 官方 Mod 框架',
      '专家/大师模式 + 掉落差异化',
    ],
    sprites: spritesOf('terraria', ['Wooden_Sword.png', 'Iron_Pickaxe.png', 'Slime_Crown.png', 'Gold_Coin.png', 'Mining_Potion.png', 'Bomb.png', 'Musket.png', 'Shuriken.png']),
    landingData: TERRARIA_DATA,
  },
  {
    id: 'valheim',
    name: 'Valheim',
    tagline: '英灵神殿 · 北欧生存',
    icon: '⚔️',
    color: colorOf('valheim'),
    category: '生存冒险',
    visualStyle: '北欧薄暮 · 青灰冷淡',
    desc: '低多边形北欧神话生存，5 个 Boss + 船只航海 + 结构稳定性，维京部落 RP。',
    port: VALHEIM_DATA.port,
    rconPort: VALHEIM_DATA.rconPort,
    portDisplay: String(VALHEIM_DATA.port),
    rconDisplay: String(VALHEIM_DATA.rconPort ?? ''),
    protocol: 'stdin',
    features: '8 UI Tabs',
    details: [
      '5 个 Boss + Forsaken Power',
      '船只航海 + 海怪 Serpent',
      '结构稳定性（垂直/水平支撑）',
      'adminlist.txt + F5 控制台',
      'Thunderstore Mod + ValheimPlus',
    ],
    sprites: spritesOf('valheim', ['header.jpg']),
    landingData: VALHEIM_DATA,
  },
  {
    id: 'zomboid',
    name: 'Project Zomboid',
    tagline: '僵尸毁灭工程 · 末日生存',
    icon: '🧟',
    color: colorOf('zomboid'),
    category: '生存冒险',
    visualStyle: '末日灰暗 · 灰绿感染',
    desc: '等距视角硬核丧尸生存，Sandbox 自定义 + 技能树 + 建造生产，RCON 原生支持。',
    port: ZOMBOID_DATA.port,
    rconPort: ZOMBOID_DATA.rconPort,
    portDisplay: String(ZOMBOID_DATA.port),
    rconDisplay: String(ZOMBOID_DATA.rconPort ?? ''),
    protocol: 'rcon',
    features: '8 UI Tabs',
    details: [
      '硬核生存（饥饿/口渴/疲劳/感染）',
      'Sandbox 自定义丧尸数量/速度/感知',
      '木工/电工/烹饪/农艺技能树',
      '四级管理员 + RCON 原生支持',
      'Build 42 动画重做 + 动物系统',
    ],
    sprites: spritesOf('zomboid', ['header.jpg']),
    landingData: ZOMBOID_DATA,
  },
];

/** 全部游戏 id（不含 default），用于 GameThemeContext 同步 */
export const ALL_GAME_IDS: GameThemeId[] = [
  'default',
  ...GAME_CATALOG.map((c) => c.id),
];

/** 根据 id 查 catalog 记录 */
export function findCatalogEntry(id: GameThemeId): GameCatalogEntry | null {
  if (id === 'default') return null;
  return GAME_CATALOG.find((c) => c.id === id) ?? null;
}
