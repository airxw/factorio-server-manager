// ============================================================================
// game-landing-data.ts — 9 款游戏专属落地页数据（7 款老数据 + 新增 palworld/ark/rust）
// 数据源：packs/*.yaml 配置文件 + 游戏 Wiki 调研
// 落地页模板：GameLandingTemplate.tsx
// ============================================================================

import {
  Building2,
  Castle,
  Cpu,
  Crown,
  Hammer,
  Layers,
  Network,
  Puzzle,
  Shield,
  Ship,
  Skull,
  Sparkles,
  Swords,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react';

// ============================================================================
// 类型定义
// ============================================================================
export interface TerminalLine {
  text: string;
  type: 'cmd' | 'muted' | 'success' | 'warn' | 'info';
  delay: number;
}

export interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
  bullets: string[];
  color: string;
}

export interface Command {
  cmd: string;
  desc: string;
  panel: string;
}

export interface ModLoader {
  name: string;
  desc: string;
  status: '已支持' | '规划中' | '原生';
}

export interface GameLandingData {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  packId: string;
  steamAppId: string;
  port: number;
  rconPort: number | null;
  protocol: 'stdin' | 'rcon';
  heroTitle: string;
  heroTitleHighlight: string;
  heroDesc: string;
  trustItems: string[];
  terminalScript: TerminalLine[];
  features: Feature[];
  commands: Command[];
  modLoaders: ModLoader[];
  ctaTitle: string;
  ctaDesc: string;
  footerDesc: string;
}

// ============================================================================
// 5. Terraria (泰拉瑞亚)
// ============================================================================
export const TERRARIA_DATA: GameLandingData = {
  id: 'terraria',
  name: 'Terraria',
  tagline: '泰拉瑞亚 · 2D 沙盒冒险',
  emoji: '⛏️',
  packId: 'terraria-vanilla',
  steamAppId: '105600',
  port: 7777,
  rconPort: null,
  protocol: 'stdin',
  heroTitle: '经典 2D 像素沙盒，',
  heroTitleHighlight: '33 Boss 战冒险',
  heroDesc:
    '33+ Boss 战 + 上千配方 + Hardmode 世界腐化/神圣化 + TShock 权限 + tModLoader 官方 Mod 框架——2D 沙盒冒险经典。',
  trustItems: ['33+ Boss 战', 'Hardmode 腐化', 'TShock 权限'],
  terminalScript: [
    { text: '$ gsp start terraria', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading terraria-vanilla (App 105600)...', type: 'muted', delay: 320 },
    { text: '→ TerrariaServer.bin.x86_64 -world MyWorld -port 7777', type: 'muted', delay: 280 },
    { text: '→ Loading world size=large, difficulty=expert', type: 'muted', delay: 280 },
    { text: '→ TShock v5.2 attached, permissions loaded', type: 'muted', delay: 320 },
    { text: '✓ World opened, listening :7777', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Steve dirt 999', type: 'cmd', delay: 500 },
    { text: '→ stdin: i "dirt" 999 to Steve', type: 'muted', delay: 300 },
    { text: '✓ Item sent via TShock routing', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Swords,
      title: '33+ Boss 战系统',
      desc: 'Eye of Cthulhu / Skeletron / Wall of Flesh / Moon Lord 阶段性 Boss 难度升级。',
      bullets: [
        '前期 Boss（克苏鲁之眼/骷髅王）',
        '中期 Boss（肉山/双子）',
        '后期 Boss（月亮领主）',
        '专家/大师模式差异化',
      ],
      color: '#059669',
    },
    {
      icon: Layers,
      title: 'Hardmode 腐化/神圣化',
      desc: '击败肉山后世界进入 Hardmode，分裂为腐化（Crimson）/神圣（Crimson）双生态。',
      bullets: [
        'Hardmode 难度升级',
        'Corruption 腐化',
        'Crimson 猩红',
        'Hallow 神圣',
      ],
      color: '#10b981',
    },
    {
      icon: Shield,
      title: 'TShock 权限系统',
      desc: 'TShock 服务端权限 + 区域保护（SSProtect）+ 区域管理工具——无需外部 Mod 即可精细控制。',
      bullets: [
        'TShock 5.2 权限分级',
        '区域保护 SSProtect',
        'SSC 角色系统',
        'REST API 远程管理',
      ],
      color: '#34d399',
    },
    {
      icon: Hammer,
      title: 'tModLoader 官方 Mod 框架',
      desc: '官方 Mod 加载器 tModLoader，Mod 社区生态丰富（Calamity / Thorium / Tremor 等）。',
      bullets: [
        'tModLoader 官方框架',
        'Calamity Mod 大型扩展',
        'Thorium Mod 职业扩展',
        'Tremor Mod 综合',
      ],
      color: '#047857',
    },
  ],
  commands: [
    { cmd: 'say <message>', desc: '服务器公告', panel: '公告系统 → 发送' },
    { cmd: 'i <item> <count>', desc: '给予物品', panel: '物品库 → 发放' },
    { cmd: 'kick <player>', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'ban <player>', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'tp <player> <x> <y>', desc: '传送玩家', panel: '玩家管理 → 传送' },
    { cmd: 'spawn <npc>', desc: '召唤 NPC', panel: 'NPC 管理 → 召唤' },
    { cmd: 'save', desc: '保存世界', panel: '存档管理 → 保存' },
    { cmd: 'settle', desc: '液体重力', panel: '世界控制 → 沉降' },
  ],
  modLoaders: [
    { name: 'TShock', desc: '服务端管理框架（v5.2）', status: '已支持' },
    { name: 'tModLoader', desc: '官方 Mod 加载器', status: '已支持' },
    { name: 'Calamity Mod', desc: '大型 Boss + 内容扩展', status: '已支持' },
    { name: 'Thorium Mod', desc: '职业 + 内容扩展', status: '已支持' },
  ],
  ctaTitle: '准备好在 2D 世界冒险',
  ctaDesc: '33 Boss 战 + Hardmode 腐化 + TShock 权限——tModLoader Mod 生态，开箱即运营。',
  footerDesc: 'Terraria 2D 沙盒方案 · Boss / Hardmode / TShock / tModLoader',
};

// ============================================================================
// 6. Valheim (英灵神殿)
// ============================================================================
export const VALHEIM_DATA: GameLandingData = {
  id: 'valheim',
  name: 'Valheim',
  tagline: '英灵神殿 · 北欧生存',
  emoji: '⚔️',
  packId: 'valheim-vanilla',
  steamAppId: '896660',
  port: 2456,
  rconPort: 2458,
  protocol: 'stdin',
  heroTitle: '低多边形北欧神话，',
  heroTitleHighlight: '维京部落集结远征',
  heroDesc:
    '5 个 Boss + 船只航海 + 结构稳定性系统 + Thunderstore Mod 生态——10 人部落协作，原版跨平台联机。',
  trustItems: ['5 Boss 远征', '航海与造船', '结构稳定性'],
  terminalScript: [
    { text: '$ gsp start valheim', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading valheim-vanilla (App 896660)...', type: 'muted', delay: 320 },
    { text: '→ valheim_server.x86_64 -port 2456 -crossplay', type: 'muted', delay: 280 },
    { text: '→ Loading world worlds_local/MyWorld.db', type: 'muted', delay: 280 },
    { text: '→ Game server connected to Steam backend', type: 'muted', delay: 320 },
    { text: '✓ World saved in 4.1s', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Player Wood 100', type: 'cmd', delay: 500 },
    { text: '→ stdin: spawn Wood 100', type: 'muted', delay: 300 },
    { text: '✓ Item spawned via devcommands', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Crown,
      title: '5 个 Boss 远征',
      desc: 'Eikthyrnir / The Elder / Bonemass / Moder / Yagluth 五个 Boss，每个对应一个生物群系。',
      bullets: [
        'Eikthyrnir 雷霆雄鹿（Meadows）',
        'The Elder 暗影长者（Black Forest）',
        'Bonemass 沼泽巨怪（Swamp）',
        'Moder 寒霜之龙（Mountains）',
      ],
      color: '#64748b',
    },
    {
      icon: Ship,
      title: '航海与造船系统',
      desc: 'Raft / Karve / Longship 三级船只，航海探索新岛屿，遭遇海怪 Serpent 袭击。',
      bullets: [
        'Raft 木筏（基础）',
        'Karve 卡尔维船（中型）',
        'Longship 长船（大型）',
        'Serpent 海怪战斗',
      ],
      color: '#94a3b8',
    },
    {
      icon: Building2,
      title: '结构稳定性系统',
      desc: '建筑结构有垂直与水平支撑要求，需要合理设计承重结构，避免建筑坍塌。',
      bullets: [
        '垂直支撑（Vertical Stability）',
        '水平支撑（Horizontal Stability）',
        '木材/石材/铁材承重差异',
        '结构颜色反馈（绿/黄/红）',
      ],
      color: '#475569',
    },
    {
      icon: Castle,
      title: '维京部落 RP',
      desc: 'adminlist.txt 管理员系统 + F5 控制台 + devcommands 创造模式，部落仪式与领地系统。',
      bullets: [
        'adminlist.txt 管理员白名单',
        'F5 控制台 + devcommands',
        'Ward 领地保护系统',
        'Wishbone 探宝与符文',
      ],
      color: '#334155',
    },
  ],
  commands: [
    { cmd: 'say message', desc: '服务器公告', panel: '公告系统 → 发送' },
    { cmd: 'kick player', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'ban player', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'unban player', desc: '解封玩家', panel: '封禁系统 → 解封' },
    { cmd: 'info', desc: '服务器信息', panel: '实例详情 → 状态' },
    { cmd: 'save', desc: '保存世界', panel: '存档管理 → 手动保存' },
    { cmd: 'spawn item count', desc: '召唤物品', panel: '物品库 → 发放' },
  ],
  modLoaders: [
    { name: 'Vanilla Dedicated Server', desc: '官方专用服务端（App 896660）', status: '已支持' },
    { name: '-crossplay', desc: '跨平台联机（Steam/Xbox）', status: '已支持' },
    { name: 'adminlist.txt', desc: '管理员白名单文件', status: '原生' },
    { name: 'F5 Console', desc: '游戏内开发者控制台', status: '原生' },
    { name: 'Thunderstore', desc: 'BepInEx Mod 平台', status: '规划中' },
    { name: 'ValheimPlus', desc: 'QoL 综合 Mod', status: '规划中' },
  ],
  ctaTitle: '准备好远征北欧神话的',
  ctaDesc: '5 个 Boss + 航海造船 + 结构稳定性——adminlist.txt + F5 控制台，开箱即运营。',
  footerDesc: 'Valheim 北欧生存方案 · 5 Boss / 航海 / 结构稳定性 / 跨平台',
};

// ============================================================================
// 7. Project Zomboid (僵尸毁灭工程)
// ============================================================================
export const ZOMBOID_DATA: GameLandingData = {
  id: 'zomboid',
  name: 'Project Zomboid',
  tagline: '僵尸毁灭工程 · 末日生存',
  emoji: '🧟',
  packId: 'zomboid-vanilla',
  steamAppId: '108600',
  port: 16261,
  rconPort: 16262,
  protocol: 'rcon',
  heroTitle: '等距视角硬核生存，',
  heroTitleHighlight: '丧尸末世降临',
  heroDesc:
    'Sandbox 自定义 + 木工/电工/烹饪/农艺技能树 + RCON 原生支持 + Build 42 动画重做——2D 等距视角末日硬核。',
  trustItems: ['Sandbox 自定义', '技能树系统', 'RCON 原生支持'],
  terminalScript: [
    { text: '$ gsp start zomboid', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading zomboid-vanilla (App 108600)...', type: 'muted', delay: 320 },
    { text: '→ ProjectZomboidServer -port 16261 -rconport 16262', type: 'muted', delay: 280 },
    { text: '→ Loading world "Knox Country" seed=42', type: 'muted', delay: 280 },
    { text: '→ Sandbox preset: Apocalypse, population=High', type: 'muted', delay: 320 },
    { text: '✓ Server ready, RCON listening :16262', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Survivor water 50', type: 'cmd', delay: 500 },
    { text: '→ RCON: additem "Survivor" "Base.WaterBottleFull" 50', type: 'muted', delay: 300 },
    { text: '✓ Items delivered to inventory', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Skull,
      title: '硬核生存机制',
      desc: '饥饿/口渴/疲劳/感染/情绪/疼痛六维状态管理，每一项都能致死。',
      bullets: [
        'Hunger 饥饿',
        'Thirst 口渴',
        'Fatigue 疲劳',
        'Infection 感染',
      ],
      color: '#65a30d',
    },
    {
      icon: Puzzle,
      title: 'Sandbox 自定义',
      desc: 'Sandbox 沙盒设置：丧尸数量/速度/感知/迁徙，难度细节完全可调。',
      bullets: [
        'Zombie Population 数量',
        'Zombie Speed 速度',
        'Zombie Senses 感知',
        'Zombie Migration 迁徙',
      ],
      color: '#84cc16',
    },
    {
      icon: Hammer,
      title: '技能树系统',
      desc: '木工/电工/烹饪/农艺/医疗/钓鱼/维修多职业技能树，长期养成玩法。',
      bullets: [
        'Carpentry 木工',
        'Electrician 电工',
        'Cooking 烹饪',
        'Farming 农艺',
        'First Aid 医疗',
        'Fishing 钓鱼',
        'Maintenance 维修',
      ],
      color: '#a3e635',
    },
    {
      icon: Terminal,
      title: 'RCON 原生支持',
      desc: '原生 RCON 远程管理协议，面板可直接连接控制无需第三方插件。',
      bullets: [
        'RCON :16262 远程管理',
        'additem / addvehicle 命令',
        'chopper / teleport 工具',
        'admin teleport 系统',
      ],
      color: '#4d7c0f',
    },
  ],
  commands: [
    { cmd: 'servermsg "message"', desc: '服务器公告', panel: '公告系统 → 发送' },
    { cmd: 'additem "player" "item" count', desc: '给予物品', panel: '物品库 → 发放' },
    { cmd: 'addvehicle "model" x y z', desc: '生成载具', panel: '载具管理 → 召唤' },
    { cmd: 'teleport "player" x y z', desc: '传送玩家', panel: '玩家管理 → 传送' },
    { cmd: 'kick "player"', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'ban "player"', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'unban "player"', desc: '解封玩家', panel: '封禁系统 → 解封' },
    { cmd: 'save', desc: '保存世界', panel: '存档管理 → 保存' },
  ],
  modLoaders: [
    { name: 'Official Dedicated Server', desc: '官方专用服务端（App 108600）', status: '已支持' },
    { name: 'Workshop Mods', desc: 'Steam Workshop Mod 平台', status: '已支持' },
    { name: 'B42 Animation Overhaul', desc: 'Build 42 动画重做', status: '已支持' },
    { name: 'Hydrocraft', desc: '大型内容扩展 Mod', status: '已支持' },
  ],
  ctaTitle: '准备好在末日生存',
  ctaDesc: '六维硬核生存 + Sandbox 自定义 + RCON 原生——Build 42 动画重做，开箱即运营。',
  footerDesc: 'Zomboid 末日生存方案 · 硬核生存 / Sandbox / 技能树 / RCON',
};

// ============================================================================
// 8. Palworld (幻兽帕鲁) — 新增（补齐 Home 主题空操作）
// ============================================================================
export const PALWORLD_DATA: GameLandingData = {
  id: 'palworld',
  name: 'Palworld',
  tagline: '幻兽帕鲁 · 生物养成',
  emoji: '🐉',
  packId: 'palworld-vanilla',
  steamAppId: '1623730',
  port: 8211,
  rconPort: 25575,
  protocol: 'rcon',
  heroTitle: 'Pokemon with guns，',
  heroTitleHighlight: '200+ 帕鲁任你驯',
  heroDesc:
    '200+ 帕鲁捕捉 + 伙伴技能系统 + 基地自动化 + PvP/PvE 模式切换 + 32 人跨平台联机——3D 卡通开放世界生存冒险。',
  trustItems: ['200+ 帕鲁', '基地自动化', '跨平台联机'],
  terminalScript: [
    { text: '$ gsp start palworld', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading palworld-vanilla (App 1623730)...', type: 'muted', delay: 320 },
    { text: '→ PalServer -port 8211 -rconport 25575 -players 32', type: 'muted', delay: 280 },
    { text: '→ Loading world "Palpagos Islands" seed=0xCAFE', type: 'muted', delay: 280 },
    { text: '→ RCON attached, admin token verified', type: 'muted', delay: 320 },
    { text: '✓ Multiplayer session started, 32 slots open', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Player gold 10000', type: 'cmd', delay: 500 },
    { text: '→ RCON: GiveItem "Player" gold 10000', type: 'muted', delay: 300 },
    { text: '✓ Items delivered to inventory', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Sparkles,
      title: '200+ 帕鲁捕捉',
      desc: '200+ 种帕鲁，每种有独特技能与工作适应性；战斗 + 工作 + 骑乘三栖。',
      bullets: [
        'Lamball 棉悠悠（基础）',
        'Cattiva 卡特邦加（采集）',
        'Lifmunk 皮皮鸡（伐木）',
        'Jormuntide 浪蛟龙（BOSS）',
      ],
      color: '#0891b2',
    },
    {
      icon: Building2,
      title: '基地自动化',
      desc: 'Palbox 帕鲁箱分配 + 基地工作优先级 + 流水线自动化生产。',
      bullets: [
        'Palbox 帕鲁分配',
        '工作适应性优先级',
        '流水线自动生产',
        '传送带 + 加工台',
      ],
      color: '#06b6d4',
    },
    {
      icon: Skull,
      title: 'Raid 防御与 PvP',
      desc: 'PvP / PvE 模式切换 + Raid 波次防御（袭击油井/基地）。',
      bullets: [
        'PvP / PvE 模式',
        'Raid 袭击波次',
        '帮派基地战',
        '跨服 BOSS 战',
      ],
      color: '#22d3ee',
    },
    {
      icon: Users,
      title: '32 人跨平台联机',
      desc: '32 人同时在线，Steam + Xbox 跨平台；公会（Guild）系统协作。',
      bullets: [
        '32 人协作上限',
        'Steam + Xbox 跨平台',
        '公会系统 Guild',
        '好友传送',
      ],
      color: '#67e8f9',
    },
  ],
  commands: [
    { cmd: 'Broadcast "message"', desc: '全服公告', panel: '公告系统 → 发送' },
    { cmd: 'GiveItem "player" item count', desc: '给予物品', panel: '物品库 → 发放' },
    { cmd: 'KickPlayer "player"', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'BanPlayer "player"', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'TeleportToPlayer "src" "dst"', desc: '传送玩家', panel: '玩家管理 → 传送' },
    { cmd: 'SaveWorld', desc: '保存世界', panel: '存档管理 → 保存' },
    { cmd: 'Shutdown', desc: '关服', panel: '实例管理 → 停止' },
    { cmd: 'Info', desc: '服务器信息', panel: '实例详情 → 状态' },
  ],
  modLoaders: [
    { name: 'Official Dedicated Server', desc: '官方专用服务端（App 1623730）', status: '已支持' },
    { name: 'PalServer Mods', desc: '社区 Mod 平台', status: '已支持' },
    { name: 'UE4SS', desc: 'Unreal Engine 4 Scripting', status: '已支持' },
    { name: 'Palworld Modding Tool', desc: 'Mod 制作工具', status: '规划中' },
  ],
  ctaTitle: '准备好成为帕鲁大师',
  ctaDesc: '200+ 帕鲁 + 基地自动化 + 32 人跨平台——Raid 防御与 PvP 模式，开箱即运营。',
  footerDesc: 'Palworld 幻兽方案 · 帕鲁捕捉 / 基地 / Raid / 跨平台',
};

// ============================================================================
// 9. ARK (方舟) — 新增（补齐 Home 主题空操作）
// ============================================================================
export const ARK_DATA: GameLandingData = {
  id: 'ark',
  name: 'ARK',
  tagline: '方舟 · 恐龙世界',
  emoji: '🦖',
  packId: 'ark-vanilla',
  steamAppId: '376030',
  port: 7777,
  rconPort: 27020,
  protocol: 'rcon',
  heroTitle: '驯龙者集结，',
  heroTitleHighlight: '100+ 史前生物',
  heroDesc:
    '100+ 史前生物可驯服骑乘 + 部落战争 + Cluster 集群 + Steam Workshop MOD + Engram 图鉴进化——恐龙生存巨作。',
  trustItems: ['100+ 生物', 'Cluster 集群', 'Steam Workshop'],
  terminalScript: [
    { text: '$ gsp start ark', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading ark-vanilla (App 376030)...', type: 'muted', delay: 320 },
    { text: '→ ShooterGameServer.exe TheIsland?Port=7777?RCONPort=27020', type: 'muted', delay: 280 },
    { text: '→ Loading map "The Island" session="MyCluster"', type: 'muted', delay: 280 },
    { text: '→ Steam Workshop mods synced (12 active)', type: 'muted', delay: 320 },
    { text: '✓ Server online, 70 slots open', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Player stone 5000', type: 'cmd', delay: 500 },
    { text: '→ RCON: GiveItem "Player" stone 5000 1 0', type: 'muted', delay: 300 },
    { text: '✓ Items delivered to inventory', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Crown,
      title: '100+ 恐龙驯养',
      desc: 'Dilo / Raptor / Rex / Giga 多梯度恐龙驯服 + 繁殖 + 突变（mutation）系统。',
      bullets: [
        'Dilo 双齿翼龙（基础）',
        'Raptor 迅猛龙（中期）',
        'Rex 霸王龙（后期）',
        'Giga 巨齿龙（终极）',
      ],
      color: '#9333ea',
    },
    {
      icon: Network,
      title: 'Cluster 集群架构',
      desc: 'Cluster 跨服迁移，玩家可携恐龙在 The Island / Scorched Earth / Aberration 等地图间穿行。',
      bullets: [
        'The Island 原版',
        'Scorched Earth 焦土',
        'Aberration 畸变',
        'Genesis Part 1/2',
      ],
      color: '#a855f7',
    },
    {
      icon: Shield,
      title: '部落治理系统',
      desc: 'Tribe 部落 + 联盟 + 管理员分级 + 部落战争。',
      bullets: [
        'Tribe 部落系统',
        'Alliance 联盟',
        '管理员分级',
        'Tribe War 部落战',
      ],
      color: '#c084fc',
    },
    {
      icon: Hammer,
      title: 'Engram 图鉴进化',
      desc: 'Engram 物品图鉴 + 泰克科技（Tek） + Boss 战解锁。',
      bullets: [
        'Engram 物品解锁',
        'Tek Tier 泰克科技',
        'Boss 战解锁',
        'Boss 召唤道具',
      ],
      color: '#7e22ce',
    },
  ],
  commands: [
    { cmd: 'ServerChat "message"', desc: '服务器公告', panel: '公告系统 → 发送' },
    { cmd: 'GiveItem "player" item count qty', desc: '给予物品', panel: '物品库 → 发放' },
    { cmd: 'KickPlayer "player"', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'BanPlayer "player"', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'TeleportToPlayer "src" "dst"', desc: '传送玩家', panel: '玩家管理 → 传送' },
    { cmd: 'Summon "entity"', desc: '召唤生物', panel: '生物图鉴 → 召唤' },
    { cmd: 'SaveWorld', desc: '保存世界', panel: '存档管理 → 保存' },
    { cmd: 'DestroyAll', desc: '清除野生', panel: '世界控制 → 清除' },
  ],
  modLoaders: [
    { name: 'Steam Workshop', desc: '官方 Mod 平台', status: '已支持' },
    { name: 'Mod ID Sync', desc: 'Mod ID 同步', status: '已支持' },
    { name: 'Total Conversion', desc: '整图转换 Mod', status: '已支持' },
    { name: 'Primal Fear', desc: 'Boss 扩展 Mod', status: '已支持' },
  ],
  ctaTitle: '准备好驯服史前巨兽',
  ctaDesc: '100+ 恐龙 + Cluster 集群 + 部落战争——Steam Workshop Mod 生态，开箱即运营。',
  footerDesc: 'ARK 方舟方案 · 恐龙驯服 / 集群 / 部落战 / Mod',
};

// ============================================================================
// 10. RUST (腐蚀) — 新增（补齐 Home 主题空操作）
// ============================================================================
export const RUST_DATA: GameLandingData = {
  id: 'rust',
  name: 'RUST',
  tagline: '腐蚀 · 生存竞技',
  emoji: '🔫',
  packId: 'rust-vanilla',
  steamAppId: '258550',
  port: 28015,
  rconPort: 28016,
  protocol: 'rcon',
  heroTitle: '硬核生存 PvP，',
  heroTitleHighlight: 'Force Wipe 节奏',
  heroDesc:
    '蓝图 3.0 + 电力系统 + 自动化防御 + Oxide/uMod/Carbon 插件框架 + Web RCON——硬核生存竞技，每月 Force Wipe 重启赛季。',
  trustItems: ['蓝图 3.0', 'Oxide 插件', 'Web RCON'],
  terminalScript: [
    { text: '$ gsp start rust', type: 'cmd', delay: 400 },
    { text: '→ SteamCMD downloading rust-vanilla (App 258550)...', type: 'muted', delay: 320 },
    { text: '→ RustDedicated.exe -port 28015 -rcon.port 28016', type: 'muted', delay: 280 },
    { text: '→ Loading procedural map size=4500 seed=0x1337', type: 'muted', delay: 280 },
    { text: '→ Oxide/uMod framework attached, plugins=8', type: 'muted', delay: 320 },
    { text: '✓ Server online, 200 slots, wipe schedule set', type: 'success', delay: 380 },
    { text: '', type: 'muted', delay: 150 },
    { text: '$ gsp give Player wood 10000', type: 'cmd', delay: 500 },
    { text: '→ RCON: inventory.giveto "Player" wood 10000', type: 'muted', delay: 300 },
    { text: '✓ Items delivered to inventory', type: 'success', delay: 800 },
  ],
  features: [
    {
      icon: Layers,
      title: '蓝图 3.0 系统',
      desc: 'Wipe 后用碎片学习蓝图，三级工作台（Tier 1/2/3）解锁不同物品。',
      bullets: [
        'Blueprint Fragment 蓝图碎片',
        'Tier 1 工作台',
        'Tier 2 工作台',
        'Tier 3 工作台',
      ],
      color: '#dc2626',
    },
    {
      icon: Cpu,
      title: '电力与自动化',
      desc: '发电机 + 电流路径 + 自动门 + 防御塔——电路系统可编程。',
      bullets: [
        'Generator 发电机',
        'Current 电流路径',
        'Auto Turret 自动炮塔',
        'Smart Switch 智能开关',
      ],
      color: '#ef4444',
    },
    {
      icon: Puzzle,
      title: 'Oxide/uMod/Carbon 插件',
      desc: 'Oxide/uMod/Carbon 三选一插件框架，扩展管理 / 商店 / 排位功能。',
      bullets: [
        'Oxide/uMod 经典框架',
        'Carbon 替代方案',
        'Plugin Manager 插件管理',
        'Permissions 权限',
      ],
      color: '#f87171',
    },
    {
      icon: Hammer,
      title: 'Force Wipe 节奏',
      desc: '每月第一个周四 Force Wipe 强制清档，重置世界保持竞技性。',
      bullets: [
        'Force Wipe 清档',
        'BP Wipe 蓝图清档',
        'Map Wipe 仅地图清',
        'VIP Queue VIP 队列',
      ],
      color: '#b91c1c',
    },
  ],
  commands: [
    { cmd: 'say "message"', desc: '服务器公告', panel: '公告系统 → 发送' },
    { cmd: 'inventory.giveto "player" item count', desc: '给予物品', panel: '物品库 → 发放' },
    { cmd: 'kick "player"', desc: '踢出玩家', panel: '玩家管理 → 踢出' },
    { cmd: 'ban "player" "reason"', desc: '封禁玩家', panel: '封禁系统 → 添加' },
    { cmd: 'teleport "player.target" "pos"', desc: '传送玩家', panel: '玩家管理 → 传送' },
    { cmd: 'save', desc: '保存世界', panel: '存档管理 → 保存' },
    { cmd: 'server.wipe', desc: '强制清档', panel: '实例管理 → 强制 Wipe' },
    { cmd: 'oxide.grant group default vip', desc: '授予 VIP', panel: 'VIP 管理 → 授予' },
  ],
  modLoaders: [
    { name: 'Oxide / uMod', desc: '经典 C# 插件框架', status: '已支持' },
    { name: 'Carbon', desc: '现代 Rust 插件框架', status: '已支持' },
    { name: 'Web RCON', desc: 'Web RCON 管理面板', status: '已支持' },
    { name: 'Plugin Hub', desc: '官方插件市场', status: '已支持' },
  ],
  ctaTitle: '准备好在废土上称王',
  ctaDesc: '蓝图 3.0 + Oxide 插件 + Force Wipe——硬核生存竞技，开箱即运营。',
  footerDesc: 'RUST 硬核方案 · 蓝图 / Oxide / 电力 / 排位',
};

// ============================================================================
// 数据汇总表
// ============================================================================
export const GAME_LANDING_DATA: Record<string, GameLandingData> = {
  terraria: TERRARIA_DATA,
  valheim: VALHEIM_DATA,
  zomboid: ZOMBOID_DATA,
  palworld: PALWORLD_DATA,
  ark: ARK_DATA,
  rust: RUST_DATA,
};
