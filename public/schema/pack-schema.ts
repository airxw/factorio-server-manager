import { z } from 'zod';

// ============================================================================
// GamePack Zod Schema - 验证 Pack YAML 结构
// 此 schema 是 Pack 契约的运行时校验层，YAML 必须通过此 schema 才能加载
// 来源：从 poc/pack-yaml/schema.ts 迁移，保留 zod.discriminatedUnion 协议层设计
// ============================================================================
// @version 1.1.0  (MINOR, 2026-07-29)
//   - 新增可选字段 `startup_guide`：声明该游戏的启动前置引导项（地图/世界/配置等）
//   - 全部子 schema optional，向后兼容：现有 Pack 不写 startup_guide 仍可通过校验
//   - 变更类型：MINOR（新增可选字段），按 rules-3 §六 通知依赖模块，不阻断
//   - 来源方案：docs/plans/instance-startup-guide-and-action-bar-plan.md §3.4
// ============================================================================

export const GameTypeSchema = z.enum([
  'minecraft', 'factorio', 'rust', 'ark', 'palworld', 'custom',
  // v4.0.4: 扩展支持的 Steam/独立游戏类型
  'dst',          // Don't Starve Together
  'dyson',        // Dyson Sphere Program
  'enshrouded',   // Enshrouded
  'satisfactory', // Satisfactory
  'terraria',     // Terraria (TShock)
  'valheim',      // Valheim
  'zomboid',      // Project Zomboid
]);
export type GameType = z.infer<typeof GameTypeSchema>;

export const ProtocolTypeSchema = z.enum(['rcon', 'stdin', 'webrcon']);
export type ProtocolType = z.infer<typeof ProtocolTypeSchema>;

export const ConfigFormatSchema = z.enum(['properties', 'json', 'ini', 'yaml']);
export type ConfigFormat = z.infer<typeof ConfigFormatSchema>;

export const VersionSourceTypeSchema = z.enum(['server-jar', 'binary', 'steamcmd']);
export type VersionSourceType = z.infer<typeof VersionSourceTypeSchema>;

export const InstanceTabSchema = z.enum([
  'console', 'config', 'players', 'backups',
  'monitor', 'logs', 'shop-admin', 'cdk-admin',
  // 扩展值（Factorio 集成）：供 Pack ui.tabs 声明对应能力 tab
  'mods', 'saves', 'config-files', 'world-gen', 'chat-logs', 'player-histories',
  // 游戏更新 tab（checkUpdate / applyUpdate）
  'update',
  // v3.7.0: log-files 单独的日志文件管理 tab
  'log-files',
  // v3.7.0: 前端底座 tab（不在 pack.yaml 中声明，由 ServerDetail 始终渲染）
  // game-command-help: 命令帮助；chat-triggers/player-join-settings/vote-settings: 业务运营相关（B4 后移至 /business 页）
  'game-command-help', 'chat-triggers', 'player-join-settings', 'vote-settings',
  // v4.x.x: 实例共管 tab（前端底座渲染，不在 pack.yaml 中声明）
  // admins: 实例共管员管理；roles: 角色权限分配
  'admins', 'roles',
  // v4.38.0: 绑定申请管理 tab（服主审批私有实例的绑定申请 + 申请通道开关，仅 instance_admin+ 可见）
  'binding-requests',
]);
export type InstanceTab = z.infer<typeof InstanceTabSchema>;

/**
 * v3.7.0: Tab 分组枚举
 * - runtime: 运行时（console / log-files / players）
 * - config: 配置（config-files / world-gen）
 * - ops: 运维（saves / mods / update / backups / monitor）
 * - business: 业务运营（shop-admin / cdk-admin / chat-logs / chat-triggers / vote-settings / player-join-settings / periodic-messages / shop-orders）
 */
export const TabGroupSchema = z.enum(['runtime', 'config', 'ops', 'business']);
export type TabGroup = z.infer<typeof TabGroupSchema>;

/**
 * v3.7.0: Tab 对象格式——支持 group / order / require_state 字段
 * - group: 分组（runtime/config/ops/business）
 * - order: 组内排序（数字越小越靠前，默认 100）
 * - require_state: 仅在指定实例状态下显示（如 ['stopped'] 表示仅 stopped 时可见）
 */
export const UITabObjectSchema = z.object({
  tab: InstanceTabSchema,
  group: TabGroupSchema.optional(),
  order: z.number().int().optional(),
  require_state: z.array(z.enum(['stopped', 'starting', 'running', 'stopping', 'error'])).optional(),
});
export type UITabObject = z.infer<typeof UITabObjectSchema>;

/**
 * v3.7.0: ui.tabs 支持 string 数组（向后兼容）或 object 数组（新格式）
 * loader 会将 string 形式规范化为 { tab: <string>, group: 'runtime' } 对象
 */
export const UITabEntrySchema = z.union([InstanceTabSchema, UITabObjectSchema]);
export type UITabEntry = z.infer<typeof UITabEntrySchema>;

export const ConfigFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'int', 'float', 'bool', 'enum']),
  label: z.string(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  enum_values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: z.string().optional(),
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

// 协议层使用 discriminated union - stdin 无端口，rcon/webrcon 必须有端口
export const StdinProtocolSchema = z.object({
  type: z.literal('stdin'),
  default_port: z.literal(0),
  auth: z.literal('none'),
  encrypt: z.literal('none'),
});
export type StdinProtocol = z.infer<typeof StdinProtocolSchema>;

export const RconProtocolSchema = z.object({
  type: z.enum(['rcon', 'webrcon']),
  default_port: z.number().int().min(1).max(65535),
  auth: z.enum(['password', 'none']),
  encrypt: z.enum(['none', 'tls']),
  config_key: z.object({
    file: z.string(),
    enable_key: z.string().optional(),
    port_key: z.string().optional(),
    password_key: z.string().optional(),
  }).optional(),
});
export type RconProtocol = z.infer<typeof RconProtocolSchema>;

export const ProtocolSchema = z.discriminatedUnion('type', [
  StdinProtocolSchema,
  RconProtocolSchema,
]);
export type Protocol = z.infer<typeof ProtocolSchema>;

// ============================================================================
// Pack 扩展字段 Schema（来源：public/schema/pack-schema-extension.json）
// 全部 optional，向后兼容现有 Pack（不写即视为禁用对应业务）
// ============================================================================

export const ItemQualitySchema = z.enum([
  'normal', 'uncommon', 'rare', 'epic', 'legendary',
]);
export type ItemQuality = z.infer<typeof ItemQualitySchema>;

export const PackItemSourceSchema = z.object({
  // v4.12.0 步骤5: 扩展枚举,新增 dynamic / remote
  //   - static    — 直接内联在 Pack YAML 的 static_list
  //   - github_sync — 从 GitHub 仓库同步物品清单
  //   - local_file — 从游戏数据文件本地生成
  //   - dynamic   — Panel 启动时通过 daemon 执行游戏命令或解析数据文件动态生成
  //   - remote    — 从可信远程源拉取(如 minecraft-data.com / uMod items 列表)
  type: z.enum(['github_sync', 'static', 'local_file', 'dynamic', 'remote']),
  url: z.string().url().optional(),
  sync_interval_hours: z.number().int().min(1).max(720).default(24),
});
export type PackItemSource = z.infer<typeof PackItemSourceSchema>;

/**
 * v4.12.0 步骤5: 物品特殊属性自适应声明。
 *
 * 用于声明游戏物品可能具有的特殊属性(品质/附魔/皮肤等)及其版本适用范围。
 * 项目接受 Pack 时按 applicable_versions 与当前实例版本比对,自适应决定:
 *   - 版本匹配 → 暴露该属性给前端商店配置页
 *   - 版本不匹配 → 按 fallback_behavior 处理(hide/default/disable)
 *
 * 适用于:Factorio 品质(2.0+)、Minecraft 附魔/物品组件、Rust 皮肤、ARK 品质系数、Terraria 前缀等。
 */
export const PackItemSpecialAttributeSchema = z.object({
  /** 属性名(如 quality / enchantment / skin / prefix) */
  name: z.string().min(1),
  /** 前端展示名 */
  display_name: z.string().min(1),
  /** 适用版本范围(语义版本约束,如 '>=2.0.0');未配置视为全版本适用 */
  applicable_versions: z.string().optional(),
  /** 默认值(版本不匹配时回退使用) */
  default_value: z.string().optional(),
  /**
   * 降级行为(版本不匹配时):
   *   - hide     — 隐藏该属性(前端不展示)
   *   - default  — 用 default_value 替换
   *   - disable  — 禁用该物品(前端置灰)
   */
  fallback_behavior: z.enum(['hide', 'default', 'disable']).default('hide'),
  /** 可选值枚举 */
  values: z.array(z.string()).optional(),
  /** 属性说明 */
  description: z.string().optional(),
  /** 命令模板中对应的占位符(如 '{{quality}}') */
  command_template_key: z.string().optional(),
});
export type PackItemSpecialAttribute = z.infer<typeof PackItemSpecialAttributeSchema>;

export const PackItemSchema = z.object({
  // 允许点号：Rust 等游戏的真实物品 shortname 使用点（如 metal.fragments / sulfur.ore）
  // v4.12.0 步骤4.2: 允许空格——TShock give 命令支持英文物品名拼写(如 "Copper Broadsword")
  // 安全性:命令通过 RCON/stdin 下发,不经 shell 解释;commandDispatcher 的 item 变量
  //   pattern 同步允许空格,且 sanitizeTemplateVar 仍会移除 shell 元字符($ ` | & ; 等)
  name: z.string().regex(/^[a-zA-Z0-9_. -]{1,64}$/, '物品名必须为字母数字下划线短横线点或空格，1-64 字符'),
  display_name: z.string().optional(),
  category: z.string().optional(),
});
export type PackItem = z.infer<typeof PackItemSchema>;

export const PackItemsSchema = z.object({
  source: PackItemSourceSchema,
  qualities: z.array(ItemQualitySchema).default([]),
  quality_tiers: z.number().int().min(0).max(5).default(0),
  categories: z.array(z.string()).default([]),
  static_list: z.array(PackItemSchema).optional(),
  /**
   * v4.12.0 步骤5: 物品特殊属性自适应声明数组。
   * 声明该 Pack 物品可能具有的特殊属性(品质/附魔/皮肤等)及其规则。
   * 项目接受 Pack 时按 applicable_versions 自适应决定是否暴露该属性。
   */
  special_attributes: z.array(PackItemSpecialAttributeSchema).optional(),
});
export type PackItems = z.infer<typeof PackItemsSchema>;

export const PackEventParsersSchema = z.object({
  chat: z.object({
    pattern: z.string().min(1),
    groups: z.array(z.enum(['timestamp', 'level', 'player', 'message'])),
  }).optional(),
  join: z.object({
    pattern: z.string().min(1),
    player_group: z.number().int().min(1),
  }).optional(),
  leave: z.object({
    pattern: z.string().min(1),
    player_group: z.number().int().min(1),
  }).optional(),
});
export type PackEventParsers = z.infer<typeof PackEventParsersSchema>;

export const PackBusinessShopSchema = z.object({
  enabled: z.boolean().default(false),
  give_command: z.string().optional(),
  quality_tiers: z.number().int().min(0).max(5).default(0),
  support_quality: z.boolean().default(false),
});
export type PackBusinessShop = z.infer<typeof PackBusinessShopSchema>;

export const PackBusinessCdkSchema = z.object({
  enabled: z.boolean().default(false),
  redeem_command: z.string().optional(),
});
export type PackBusinessCdk = z.infer<typeof PackBusinessCdkSchema>;

export const PackBusinessChatEnhancementSchema = z.object({
  welcome: z.object({
    enabled: z.boolean().default(false),
    first_gift_command: z.string().optional(),
  }).optional(),
  // 玩家离开服务器时下发的离开消息命令模板，如 `say {{player}} 离开了服务器`
  // 未设置时降级到固定文案
  leave_message_command: z.string().optional(),
  periodic_messages: z.object({
    enabled: z.boolean().default(false),
    broadcast_command: z.string().optional(),
  }).optional(),
  response_rules: z.object({
    enabled: z.boolean().default(false),
  }).optional(),
  vote_kick: z.object({
    enabled: z.boolean().default(false),
    kick_command: z.string().optional(),
  }).optional(),
});
export type PackBusinessChatEnhancement = z.infer<typeof PackBusinessChatEnhancementSchema>;

export const PackBusinessPlayersSchema = z.object({
  kick_command: z.string().optional(),
  ban_command: z.string().optional(),
});
export type PackBusinessPlayers = z.infer<typeof PackBusinessPlayersSchema>;

export const PackBusinessListsSchema = z.object({
  whitelist_add: z.string().optional(),
  banlist_add: z.string().optional(),
});
export type PackBusinessLists = z.infer<typeof PackBusinessListsSchema>;

export const PackBusinessVerifySchema = z.object({
  enabled: z.boolean().default(false),
});
export type PackBusinessVerify = z.infer<typeof PackBusinessVerifySchema>;

export const PackBusinessSchema = z.object({
  shop: PackBusinessShopSchema.optional(),
  cdk: PackBusinessCdkSchema.optional(),
  chat_enhancement: PackBusinessChatEnhancementSchema.optional(),
  players: PackBusinessPlayersSchema.optional(),
  lists: PackBusinessListsSchema.optional(),
  verify: PackBusinessVerifySchema.optional(),
});
export type PackBusiness = z.infer<typeof PackBusinessSchema>;

/** 通用运维命令模板（无业务语义），与 business 下命令模板分工 */
export type PackCommands = Record<string, string>;

// ============================================================================
// Pack 扩展字段 Schema — Factorio 集成（新增 6 个可选字段）
// 全部 optional，向后兼容现有 Pack（不写即视为禁用对应业务）
// 来源：extend-pack-schema-for-factorio spec
// ============================================================================

// 1.1 world_generation — 地图生成命令 + 地图设置文件 schema
export const WorldGenSettingsFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  format: ConfigFormatSchema,
  schema: z.record(z.unknown()),
});
export type WorldGenSettingsFile = z.infer<typeof WorldGenSettingsFileSchema>;

export const PackWorldGenerationSchema = z.object({
  create_command: z.string().min(1),
  settings_files: z.array(WorldGenSettingsFileSchema),
});
export type PackWorldGeneration = z.infer<typeof PackWorldGenerationSchema>;

// 1.2 mods — Mod 文件管理配置（DB 记录由现有 mod_records 表承载）
// v4.33.0: 新增 mechanism/file_extensions/mods_dir 字段支持多游戏 mod 机制自适应，全部 optional 向后兼容
export const PackModsSchema = z.object({
  list_file: z.string().min(1),
  list_format: ConfigFormatSchema,
  dependency_check: z.boolean().default(false),
  download_enabled: z.boolean().default(false),
  download_source: z.string().optional(),
  /**
   * v4.33.0: Mod 启停机制。决定 listModFiles/toggleModFile 如何操作 mod。
   * - jar-rename: .jar ↔ .jar.disabled 重命名（Minecraft Forge/Fabric/NeoForge）
   * - list-file: 通过 list_file 中 enabled 字段控制（Factorio mod-list.json / Terraria enabled.json）
   * - file-presence: 文件存在即启用，移除即禁用（Rust .cs / Valheim .dll / Palworld .pak）
   * - workshop-id: 通过配置文件中 Workshop ID 列表控制（ARK / Zomboid）
   * 缺省时按 game type 推断（minecraft→jar-rename / factorio→list-file / rust→file-presence 等）。
   */
  mechanism: z.enum(['jar-rename', 'list-file', 'file-presence', 'workshop-id']).optional(),
  /**
   * v4.33.0: Mod 文件后缀列表（含点号，如 ['.jar'] / ['.zip'] / ['.cs'] / ['.dll'] / ['.tmod']）。
   * 用于 listModFiles 过滤与 isModFileName 校验。缺省时按 mechanism 或 game type 推断。
   */
  file_extensions: z.array(z.string().min(1)).optional(),
  /**
   * v4.33.0: Mod 文件所在目录（相对 instance_root，如 'mods' / 'oxide/plugins' / 'BepInEx/plugins'）。
   * 缺省时从 list_file 的 dirname 推断。
   */
  mods_dir: z.string().optional(),
});
export type PackMods = z.infer<typeof PackModsSchema>;

// 1.3 saves — 存档文件管理配置（DB 记录由现有 save_records 表承载）
export const PackSavesSchema = z.object({
  dir: z.string().min(1),
  extension: z.string().min(1),
  create_command: z.string().min(1),
  activate_command: z.string().min(1),
});
export type PackSaves = z.infer<typeof PackSavesSchema>;

// 1.4 config_files — 多配置文件列表（与 config 字段共存，config 标记 deprecated）
export const PackConfigFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  format: ConfigFormatSchema,
  schema: z.record(z.unknown()),
  read_only: z.boolean().default(false),
  /**
   * v4.12.0 步骤7: 该配置文件的功能分组(如 server/combat/economy/world)。
   * 前端按组折叠展示,降低单页配置项过多导致的认知负担。
   */
  group: z.string().optional(),
  /**
   * v4.12.0 步骤7: schema 内字段级元数据扩展。
   * 每个字段可声明 requires_restart / sensitive / description 等。
   * 注:schema 是 record(z.unknown()),字段级元数据写在每个字段对象内,
   * configService 读取时识别以下可选键:
   *   - requires_restart: boolean — 修改后需重启实例生效
   *   - sensitive: boolean       — 敏感字段(密码),前端脱敏显示
   *   - description: string      — 字段说明
   *   - default: any             — 默认值
   *   - min/max/enum_values      — 取值范围约束
   */
});
export type PackConfigFile = z.infer<typeof PackConfigFileSchema>;

export const PackConfigFilesSchema = z.array(PackConfigFileSchema);
export type PackConfigFiles = z.infer<typeof PackConfigFilesSchema>;

// 1.5 update — 游戏二进制更新
export const PackUpdateSchema = z.object({
  source_url: z.string().url(),
  /**
   * v4.12.0 步骤3: current_version_command 改为可选。
   * Steam 游戏(type=steamcmd)不再执行二进制命令,
   * 改为读取 appmanifest_<appid>.acf 的 buildid 字段(见 updateService.readSteamBuildid)。
   */
  current_version_command: z.string().min(1).optional(),
  download_dir: z.string().min(1),
  /**
   * v4.12.0 步骤3: install_command 改为可选。
   * Steam 游戏(steamcmd:// 协议)由 daemon steam-install 流程接管,
   * SteamCMD 自身完成下载+安装+校验,不需要 install_command。
   */
  install_command: z.string().min(1).optional(),
  /**
   * v4.3.0-G1: 多镜像源回退配置。
   *
   * 数组元素是 download_pattern 的镜像变体（按版本号渲染前的模板）。
   * 主源（download_pattern）下载失败或文件不完整时，按数组顺序逐个尝试。
   *
   * 典型用法：
   *   mirror_sources:
   *     - https://mirror.example.com/{{pack_id}}/{{version}}.tar.gz
   *     - https://fallback.example.com/{{pack_id}}/{{version}}.tar.gz
   *
   * 约定：
   *   - 数组元素结构与 versions.download_pattern 一致（含 {{version}} 等模板变量）
   *   - 渲染、token 校验、错误处理与主源一致
   *   - 空数组或不配置时只使用主源（向后兼容）
   */
  mirror_sources: z.array(z.string().min(1)).optional(),
});
export type PackUpdate = z.infer<typeof PackUpdateSchema>;

// 1.6 chat_log — 聊天日志解析与存储
export const PackChatLogSchema = z.object({
  pattern: z.string().min(1),
  storage_enabled: z.boolean().default(false),
  retention_days: z.number().int().min(1).default(30),
});
export type PackChatLog = z.infer<typeof PackChatLogSchema>;

// ============================================================================
// startup_guide — 启动前置引导声明（v1.1.0 新增，全部 optional）
// 来源：docs/plans/instance-startup-guide-and-action-bar-plan.md §3.4
//
// 用途：声明该游戏启动前必须/建议用户填写的基础设定（地图/世界名/种子/必填配置等）。
//   - Pack 不写 startup_guide → 后端跳过启动前置校验（向后兼容）
//   - Pack 写 startup_guide → 实例首次启动前弹出分步向导，未完成 required 项则禁用启动
//
// 字段值流转：
//   1. 用户在启动向导填写 → 存入 servers.startup_config_json
//   2. 启动时按 args_mapping 渲染 startup.args 模板变量
//   3. 按 config_writes 把字段值写入对应 config_files
// ============================================================================

/** 启动前置引导字段类型 */
export const StartupGuideFieldTypeSchema = z.enum([
  'map',          // 地图选择（单选，配合 options）
  'world_name',   // 世界/存档名
  'seed',         // 世界种子
  'difficulty',   // 难度
  'max_players',  // 最大玩家数
  'server_name',  // 服务器显示名
  'password',     // 服务器密码
  'config_ref',   // 引用 config_files.schema 中的字段
  'custom',       // 自定义字段（Pack 自行声明 schema）
]);
export type StartupGuideFieldType = z.infer<typeof StartupGuideFieldTypeSchema>;

/** 地图选项（type='map' 时使用） */
export const StartupMapOptionSchema = z.object({
  value: z.string().min(1),           // 地图标识（如 'TheIsland'）
  display_name: z.string().min(1),    // 显示名（如 '孤岛'）
  description: z.string().optional(),
  icon: z.string().optional(),        // 图标资源路径（可选，前端展示用）
});
export type StartupMapOption = z.infer<typeof StartupMapOptionSchema>;

/** config_ref 引用定位（type='config_ref' 时使用） */
export const StartupConfigRefSchema = z.object({
  file: z.string().min(1),            // config_files[].name
  key: z.string().min(1),             // 该文件 schema 中的字段 key
});
export type StartupConfigRef = z.infer<typeof StartupConfigRefSchema>;

/** 启动前置引导字段声明 */
export const StartupGuideFieldSchema = z.object({
  key: z.string().min(1),             // 字段标识（存入 startup_config_json 的 key）
  type: StartupGuideFieldTypeSchema,
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // type='map' 时：可选地图清单
  options: z.array(StartupMapOptionSchema).optional(),
  // type='config_ref' 时：引用 config_files 中某文件的某字段
  config_ref: StartupConfigRefSchema.optional(),
  // type='custom' 时：内联 schema（复用 ConfigFieldSchema 结构）
  schema: ConfigFieldSchema.optional(),
  // 取值范围（通用，用于数字/枚举约束）
  min: z.number().optional(),
  max: z.number().optional(),
  enum_values: z.array(z.string()).optional(),
});
export type StartupGuideField = z.infer<typeof StartupGuideFieldSchema>;

/** 启动前置引导步骤 */
export const StartupGuideStepSchema = z.object({
  key: z.string().min(1),             // 步骤标识
  title: z.string().min(1),           // 步骤标题（如"地图选择"）
  description: z.string().optional(),
  fields: z.array(StartupGuideFieldSchema).min(1),
  optional: z.boolean().default(false), // 整步可跳过
});
export type StartupGuideStep = z.infer<typeof StartupGuideStepSchema>;

/** 配置文件写入映射项：把引导字段值写入指定 config_files */
export const StartupConfigWriteSchema = z.object({
  field_key: z.string().min(1),       // StartupGuideField.key
  file: z.string().min(1),            // config_files[].name
  config_key: z.string().min(1),      // 该文件 schema 中的字段 key
});
export type StartupConfigWrite = z.infer<typeof StartupConfigWriteSchema>;

/** 启动前置引导声明 */
export const StartupGuideSchema = z.object({
  enabled: z.boolean().default(true),
  steps: z.array(StartupGuideStepSchema).min(1),
  /**
   * 启动参数模板变量映射：把引导字段值注入 startup.args 的 {{var}}。
   * 例 ARK: { map: '{{map}}', server_name: '{{server_name}}' }
   * key = StartupGuideField.key，value = startup.args 中对应的模板占位符
   */
  args_mapping: z.record(z.string(), z.string()).optional(),
  /**
   * 配置文件写入映射：把引导字段值写入指定 config_files。
   * 引导完成时由后端 configService 统一写入实例工作目录的配置文件。
   */
  config_writes: z.array(StartupConfigWriteSchema).optional(),
});
export type StartupGuide = z.infer<typeof StartupGuideSchema>;

// ============================================================================
// GamePack Schema — 完整 Pack 结构（含扩展字段）
// ============================================================================

export const GamePackSchema = z.object({
  pack: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'pack.id 必须为 kebab-case'),
    game: GameTypeSchema,
    variant: z.string().min(1),
    display_name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'pack.version 必须为语义版本号'),
  }),

  startup: z.object({
    binary: z.string().min(1),
    args: z.array(z.string()),
    working_dir: z.string(),
    ready_pattern: z.string().min(1),
    stop_command: z.string().nullable(),
    stop_timeout: z.number().int().positive().max(300),
    // 新增：游戏端口默认值（每个游戏贴近实际端口，如 Factorio 34197 / Minecraft 25565 / Palworld 8211 / ARK 7777 / Rust 28015）
    // 未声明时由 servers.ts 回落到 25565（Minecraft 默认，向后兼容）
    default_game_port: z.number().int().min(1).max(65535).optional(),
    /**
     * v4.12.0 步骤8: 该游戏占用的所有端口及协议声明。
     * servers 创建逻辑按 required_ports 批量分配,检测连续端口占用(如 Valheim 需 2456-2458 连续)。
     */
    required_ports: z.array(z.object({
      port: z.number().int().min(1).max(65535),
      protocol: z.enum(['tcp', 'udp']),
      name: z.string().min(1),
      primary: z.boolean().default(false),
    })).optional(),
    /**
     * v4.12.0 步骤9: 停止方法枚举。
     *   - rcon    — 通过 RCON 发送 stop_command(默认)
     *   - stdin   — 通过 stdin 写入 stop_command
     *   - sigint  — 发送 SIGINT 信号(如 Valheim)
     *   - sigterm — 发送 SIGTERM 信号
     *   - kill    — 强制 kill(最后手段)
     * 未声明时:protocol.type=rcon/webrcon → rcon;protocol.type=stdin → stdin。
     */
    stop_method: z.enum(['rcon', 'stdin', 'sigint', 'sigterm', 'kill']).optional(),
    /**
     * v4.12.0 步骤9: 失败日志正则(可选),匹配到即标记实例 error 状态。
     * 如 'FATAL|Segmentation fault|Failed to start'。
     */
    failure_pattern: z.string().min(1).optional(),
  }),

  protocol: ProtocolSchema,

  // @deprecated 建议新 Pack 使用更通用的 config_files 字段。
  // 现有 Pack 的 config 字段保留兼容，不强制迁移，不设移除时间。
  // Factorio Pack 仅用 config_files；Minecraft Pack 保留 config + 补充 config_files。
  config: z.object({
    format: ConfigFormatSchema,
    main_file: z.string().min(1),
    schema: z.array(ConfigFieldSchema),
  }).optional(),

  commands: z.record(z.string(), z.string()),

  versions: z.object({
    source: z.string(),
    manifest_url: z.string().url().optional(),
    type: VersionSourceTypeSchema,
    download_pattern: z.string().optional(),
    eula_required: z.boolean(),
    eula_file: z.string().optional(),
    /**
     * v4.12.0(Pack 系统重构):VersionProvider 类型声明。
     *
     * 枚举值:
     *   - mojang              — Minecraft 官方 version_manifest
     *   - official-site       — 通用官网解析(Steam 游戏主用,配合 official_url + version_regex)
     *   - github-release      — GitHub Releases API(如 TShock、DST)
     *   - factorio-official   — Factorio 官方 latest-releases API
     *   - steamcmd-buildid    — daemon 侧 SteamCMD app_info_print(兜底,仅 Steam 游戏)
     *   - static              — 内置静态版本源(离线降级兜底)
     *
     * 未声明时:回退到 legacy source_url HTTP fetch(向后兼容旧 Pack)。
     * Steam 游戏(type=steamcmd)声明非 static/mojang/factorio 的 provider 时,
     * 自动构建多源回退链:official-site → github-release → steamcmd-buildid → static。
     */
    provider: z.enum([
      'mojang', 'official-site', 'github-release',
      'factorio-official', 'steamcmd-buildid', 'static',
    ]).optional(),
    /**
     * official-site provider 用的官网/官方公告 URL。
     * 配合 version_regex 提取版本号;未配置 regex 时尝试 JSON 解析或文本兜底。
     */
    official_url: z.string().url().optional(),
    /**
     * official-site provider 的版本号提取正则(第一个捕获组 = 版本号)。
     * 官网改版可能导致正则失效,配合 fallback_buildid 兜底。
     */
    version_regex: z.string().min(1).optional(),
    /**
     * Steam depot buildid 兜底值(官网不可达或正则失效时使用)。
     * 上次已知最新 buildid,人工维护。
     */
    fallback_buildid: z.string().optional(),
    /**
     * SteamCMD 登录模式:
     *   - anonymous(默认)— 大多数游戏服务端可用
     *   - user            — 部分受密码保护 depot 需要,需在 daemon 配置 steam 账号
     */
    steam_login: z.enum(['anonymous', 'user']).optional(),
  }),

  backup: z.object({
    world_dir: z.string(),
    pre_backup_commands: z.array(z.string()),
    post_backup_commands: z.array(z.string()),
  }),

  ui: z.object({
    // v3.7.0: tabs 支持 string 数组（向后兼容）或 object 数组（新格式带 group/order/require_state）
    tabs: z.array(UITabEntrySchema),
  }),

  resources: z.object({
    min_ram: z.string(),
    recommended_ram: z.string(),
    min_disk: z.string(),
  }).optional(),

  // 扩展字段（pack-schema-extension.json），全部 optional，向后兼容
  items: PackItemsSchema.optional(),
  event_parsers: PackEventParsersSchema.optional(),
  business: PackBusinessSchema.optional(),

  // Factorio 集成扩展字段（全部 optional，向后兼容）
  world_generation: PackWorldGenerationSchema.optional(),
  mods: PackModsSchema.optional(),
  saves: PackSavesSchema.optional(),
  config_files: PackConfigFilesSchema.optional(),
  update: PackUpdateSchema.optional(),
  chat_log: PackChatLogSchema.optional(),

  // v1.1.0: 启动前置引导声明（全部 optional，向后兼容）
  // 不写则后端跳过启动前置校验；写则实例首次启动前需完成 required 项
  startup_guide: StartupGuideSchema.optional(),
});

/**
 * v3.7.0: GamePack 类型
 *
 * 注意：ui.tabs 在 schema 层声明为 UITabEntry[]（支持 string | object 两种格式），
 * 但 loader.ts 的 normalizeUITabs 在加载后会统一转换为 UITabObject[] 对象格式。
 * 因此对外暴露的 GamePack 类型中 ui.tabs 应当是 UITabObject[]，
 * 下游（前端 / API / packs.ts 路由）无需处理 string 形式。
 */
export type GamePackRaw = z.infer<typeof GamePackSchema>;
export interface GamePack extends Omit<GamePackRaw, 'ui'> {
  ui: { tabs: UITabObject[] };
}
