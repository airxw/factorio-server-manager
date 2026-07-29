import { z } from 'zod';
// ============================================================================
// GamePack Zod Schema - 验证 Pack YAML 结构
// 此 schema 是 Pack 契约的运行时校验层，YAML 必须通过此 schema 才能加载
// 来源：从 poc/pack-yaml/schema.ts 迁移，保留 zod.discriminatedUnion 协议层设计
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
export const ProtocolTypeSchema = z.enum(['rcon', 'stdin', 'webrcon']);
export const ConfigFormatSchema = z.enum(['properties', 'json', 'ini', 'yaml']);
export const VersionSourceTypeSchema = z.enum(['server-jar', 'binary', 'steamcmd']);
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
    'game-command-help', 'chat-triggers', 'player-join-settings', 'vote-settings',
    // v4.x.x: 实例共管 tab（前端底座渲染）
    'admins', 'roles',
]);
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
// 协议层使用 discriminated union - stdin 无端口，rcon/webrcon 必须有端口
export const StdinProtocolSchema = z.object({
    type: z.literal('stdin'),
    default_port: z.literal(0),
    auth: z.literal('none'),
    encrypt: z.literal('none'),
});
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
export const ProtocolSchema = z.discriminatedUnion('type', [
    StdinProtocolSchema,
    RconProtocolSchema,
]);
// ============================================================================
// Pack 扩展字段 Schema（来源：public/schema/pack-schema-extension.json）
// 全部 optional，向后兼容现有 Pack（不写即视为禁用对应业务）
// ============================================================================
export const ItemQualitySchema = z.enum([
    'normal', 'uncommon', 'rare', 'epic', 'legendary',
]);
export const PackItemSourceSchema = z.object({
    type: z.enum(['github_sync', 'static', 'local_file']),
    url: z.string().url().optional(),
    sync_interval_hours: z.number().int().min(1).max(720).default(24),
});
export const PackItemSchema = z.object({
    // 允许点号：Rust 等游戏的真实物品 shortname 使用点（如 metal.fragments / sulfur.ore）
    name: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/, '物品名必须为字母数字下划线短横线或点，1-64 字符'),
    display_name: z.string().optional(),
    category: z.string().optional(),
});
export const PackItemsSchema = z.object({
    source: PackItemSourceSchema,
    qualities: z.array(ItemQualitySchema).default([]),
    quality_tiers: z.number().int().min(0).max(5).default(0),
    categories: z.array(z.string()).default([]),
    static_list: z.array(PackItemSchema).optional(),
});
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
export const PackBusinessShopSchema = z.object({
    enabled: z.boolean().default(false),
    give_command: z.string().optional(),
    quality_tiers: z.number().int().min(0).max(5).default(0),
    support_quality: z.boolean().default(false),
});
export const PackBusinessCdkSchema = z.object({
    enabled: z.boolean().default(false),
    redeem_command: z.string().optional(),
});
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
export const PackBusinessPlayersSchema = z.object({
    kick_command: z.string().optional(),
    ban_command: z.string().optional(),
});
export const PackBusinessListsSchema = z.object({
    whitelist_add: z.string().optional(),
    banlist_add: z.string().optional(),
});
export const PackBusinessVerifySchema = z.object({
    enabled: z.boolean().default(false),
});
export const PackBusinessSchema = z.object({
    shop: PackBusinessShopSchema.optional(),
    cdk: PackBusinessCdkSchema.optional(),
    chat_enhancement: PackBusinessChatEnhancementSchema.optional(),
    players: PackBusinessPlayersSchema.optional(),
    lists: PackBusinessListsSchema.optional(),
    verify: PackBusinessVerifySchema.optional(),
});
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
export const PackWorldGenerationSchema = z.object({
    create_command: z.string().min(1),
    settings_files: z.array(WorldGenSettingsFileSchema),
});
// 1.2 mods — Mod 文件管理配置（DB 记录由现有 mod_records 表承载）
export const PackModsSchema = z.object({
    list_file: z.string().min(1),
    list_format: ConfigFormatSchema,
    dependency_check: z.boolean().default(false),
    download_enabled: z.boolean().default(false),
    download_source: z.string().optional(),
});
// 1.3 saves — 存档文件管理配置（DB 记录由现有 save_records 表承载）
export const PackSavesSchema = z.object({
    dir: z.string().min(1),
    extension: z.string().min(1),
    create_command: z.string().min(1),
    activate_command: z.string().min(1),
});
// 1.4 config_files — 多配置文件列表（与 config 字段共存，config 标记 deprecated）
export const PackConfigFileSchema = z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    format: ConfigFormatSchema,
    schema: z.record(z.unknown()),
    read_only: z.boolean().default(false),
});
export const PackConfigFilesSchema = z.array(PackConfigFileSchema);
// 1.5 update — 游戏二进制更新
export const PackUpdateSchema = z.object({
    source_url: z.string().url(),
    current_version_command: z.string().min(1),
    download_dir: z.string().min(1),
    install_command: z.string().min(1),
});
// 1.6 chat_log — 聊天日志解析与存储
export const PackChatLogSchema = z.object({
    pattern: z.string().min(1),
    storage_enabled: z.boolean().default(false),
    retention_days: z.number().int().min(1).default(30),
});
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
    }),
    backup: z.object({
        world_dir: z.string(),
        pre_backup_commands: z.array(z.string()),
        post_backup_commands: z.array(z.string()),
    }),
    ui: z.object({
        tabs: z.array(InstanceTabSchema),
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
});
