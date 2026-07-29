# Valheim 游戏包 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：Valheim 游戏包（valheim-vanilla）
- **物理路径**：`packs/valheim-vanilla/`
- **职责**：完整 Pack YAML 定义（启动/命令/配置/版本/备份/EULA/物品池/业务能力）
- **依赖**：模块0（`public/schema/pack-schema.ts` 用于校验）

---

## 可修改文件范围

```
packs/valheim-vanilla/
└── pack.yaml                       # 完整 Pack 定义
```

## gsp 项目规范通用约束

- Pack YAML 必须通过 `public/schema/pack-schema.ts` 的 zod 校验
- 禁止在 Pack 中硬编码服务器地址、密码等环境相关信息
- 命令模板变量使用 `{{var}}` 语法
- `public/` 目录保护：不得删除/修改/覆盖 `public/` 下文件，契约变更走 s0601 流程

## 模块专属约束

1. **游戏类型**：`pack.game: valheim`，Steam App ID 896660（Valheim Dedicated Server）
2. **协议类型**：`protocol.type: stdin`，`default_port: 0`，`auth: none`，`encrypt: none`
   - Valheim 原版无 RCON 支持，仅 stdin 控制台
3. **启动命令**：`./valheim_server.x86_64` + 启动参数（无独立配置文件，通过 args 配置）
   - 必含参数：`-port {{game_port}} -nographics -batchmode -savedir {{instance_root}}/saves`
4. **就绪检测**：`ready_pattern: 'Game server connected'`（收窄单一锚点）
5. **停止方法**：`stop_method: sigint`，`stop_command: null`，`stop_timeout: 30`
   - Valheim 不支持 stdin 停止命令，通过 SIGINT 信号优雅停止并保存世界
6. **端口声明**：
   - `default_game_port: 2456`（UDP，游戏端口）
   - `required_ports`：2456/udp(game,primary) + 2457/udp(steam) + 2458/udp(query)
   - Valheim 需 2456-2458 三个连续 UDP 端口
7. **配置文件**：`config_files` 三个名单文件（adminlist.txt / bannedlist.txt / permittedlist.txt，纯文本一行一个 SteamID）
   - Valheim 无主配置文件，服务器设置全部通过启动参数
8. **命令映射**（Valheim 原版 stdin 命令）：
   - `broadcast: 'say {{message}}'`
   - `give_item: 'spawn {{item}} {{count}}'`（spawn 在玩家附近生成物品，非直接入背包，需玩家在线）
   - `kick_player: 'kick {{player}}'`
   - `ban_player: 'ban {{player}}'`
   - `unban_player: 'unban {{player}}'`
   - `list_players: 'info'`
   - `save_world: 'save'`
9. **版本源**：
   - `versions.source: 'steamcmd://896660'`
   - `versions.type: steamcmd`
   - `versions.provider: official-site`（配合 official_url + version_regex，失败走多源回退链）
   - `versions.official_url: 'https://valheim.com/'`
   - `versions.version_regex: '(\d+\.\d+\.\d+)'`
   - `versions.steam_login: anonymous`
   - `versions.eula_required: false`（Valheim 无 EULA）
10. **游戏更新**：Steam 游戏简化配置
    - `update.source_url: 'https://valheim.com/'`（URL 格式占位，实际走 provider 链）
    - `update.download_dir: '{{instance_root}}'`（Steam 直接安装到实例根）
    - `current_version_command` / `install_command` 省略（Steam 游戏读 appmanifest buildid，由 daemon steam-install 接管）
11. **资源要求**：`min_ram: 2G` / `recommended_ram: 4G` / `min_disk: 5G`
12. **物品池**：
    - Valheim 物品用 Prefab 名（大小写敏感），参考 Valheim Wiki
    - `qualities: []`，`quality_tiers: 0`（spawn 命令模板不含品质参数，shop 不暴露品质选择）
    - `static_list` 38 个物品（材料/金属锭/皮/食物/药剂/武器/工具），display_name 中文
    - 注：spawn 在玩家附近生成物品而非直接入背包，需玩家在线
13. **业务能力**：shop/cdk/chat_enhancement/players/lists enabled；verify disabled
    - `business.shop.give_command` 与 `commands.give_item` 一致：`'spawn {{item}} {{count}}'`
    - `business.shop.support_quality: false`，`quality_tiers: 0`
    - Valheim 无白名单命令（使用 permittedlist.txt 文件），`lists` 仅声明 `banlist_add`
14. **备份**：`world_dir: '{{instance_root}}/saves/worlds_local'`，存档扩展名 `.db`
15. **Mod 管理**：BepInEx mod，位于 `BepInEx/plugins/`，`dependency_check: false`

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack zod schema（校验 Pack 结构）

## 测试要求

- `pack.yaml` 通过 zod 校验（`GamePackSchema.safeParse`）
- 所有命令模板变量已声明
- `npm run typecheck`（panel/backend）不破坏编译

## 失败回退

- 回退点：`packs-archive/valheim-vanilla/pack.yaml`（迁移前校正版本）
- 策略：基于 minecraft-vanilla / ark-vanilla 结构 + Valheim 实际命令/端口/物品校正

## 闭合判据

- `packs/valheim-vanilla/pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- 版本源配置完整（source/provider/official_url/version_regex/steam_login/eula_required）
- 端口声明完整（required_ports 含 game + steam + query 三个 UDP 端口）
- 物品 static_list ≥25 且 Prefab 名真实（display_name 中文）
- stop_method: sigint + stop_command: null 配置正确
