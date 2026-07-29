# ARK 游戏包 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：ARK 游戏包（ark-vanilla）
- **物理路径**：`packs/ark-vanilla/`
- **职责**：完整 Pack YAML 定义（启动/命令/配置/版本/备份/EULA/物品池/业务能力）
- **依赖**：模块0（`public/schema/pack-schema.ts` 用于校验）

---

## 可修改文件范围

```
packs/ark-vanilla/
└── pack.yaml                       # 完整 Pack 定义
```

## gsp 项目规范通用约束

- Pack YAML 必须通过 `public/schema/pack-schema.ts` 的 zod 校验
- 禁止在 Pack 中硬编码服务器地址、密码等环境相关信息
- 命令模板变量使用 `{{var}}` 语法
- `public/` 目录保护：不得删除/修改/覆盖 `public/` 下文件，契约变更走 s0601 流程

## 模块专属约束

1. **游戏类型**：`pack.game: ark`，Steam App ID 376030
2. **协议类型**：`protocol.type: rcon`，`default_port: 27020`，`auth: password`
3. **启动命令**：`./ShooterGame/Binaries/Linux/ShooterGameServer TheIsland ?SessionName=... ?Port=... ?listen`
4. **就绪检测**：`ready_pattern: 'Primal Game Data loaded|Setting breakpad minidump AppType=Server'`
5. **停止方法**：`stop_method: rcon`，`stop_command: 'quit'`，`stop_timeout: 60`
   - schema 单命令限制：最终 `quit` 停止；存档保存由 backupService 在备份前发送 `SaveWorld`
6. **端口声明**：
   - `default_game_port: 7777`（UDP，游戏端口）
   - `required_ports`：7777/udp(game,primary) + 27015/udp(query) + 27020/tcp(rcon)
7. **配置文件**：`config_files` 单文件 `ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini`（INI 格式）
8. **命令映射**（ARK 原版命令）：
   - `broadcast: 'broadcast {{message}}'`
   - `give_item: 'GiveItem "{{item}}" {{count}} {{quality}} 0'`（给当前管理员自己，无 player 参数；物品用 Blueprint 路径，带引号）
   - `kick_player: 'KickPlayer {{player}}'`
   - `ban_player: 'BanPlayer {{player}}'`
   - `list_players: 'ListPlayers'`
   - `save_world: 'SaveWorld'`
9. **版本源**：
   - `versions.source: 'steamcmd://376030'`
   - `versions.type: steamcmd`
   - `versions.provider: official-site`（配合 official_url + version_regex，失败走多源回退链）
   - `versions.official_url: 'https://ark.wiki.gg/wiki/Dedicated_Server_Setup'`
   - `versions.version_regex: '(\d+\.\d+)'`
   - `versions.steam_login: anonymous`
   - `versions.eula_required: true`
10. **游戏更新**：Steam 游戏简化配置
    - `update.source_url: 'https://ark.wiki.gg/wiki/Dedicated_Server_Setup'`（URL 格式占位，实际走 provider 链）
    - `update.download_dir: '{{instance_root}}'`（Steam 直接安装到实例根）
    - `current_version_command` / `install_command` 省略（Steam 游戏读 appmanifest buildid，由 daemon steam-install 接管）
11. **资源要求**：`min_ram: 6G` / `recommended_ram: 12G` / `min_disk: 20G`
12. **物品池**：
    - ARK 物品用 Blueprint 路径（过长），`static_list` 使用简化形式（Panel 展示用）
    - `qualities: []`，`quality_tiers: 5`（ARK 有品质概念，0-5 对应 Primitive → Ascendant）
    - `special_attributes` 声明 `quality` 属性（全版本适用，values: ['0'-'5']，command_template_key: '{{quality}}'）
    - `static_list` 30+ 物品（资源/工具/武器/弹药/防具/食物/鞍具），display_name 中文，category 分组
13. **业务能力**：shop/cdk/chat_enhancement/players/lists/verify 全部 enabled
    - `business.shop.give_command` 与 `commands.give_item` 一致
    - `business.shop.support_quality: true`，`quality_tiers: 5`
14. **备份**：`world_dir: ShooterGame/Saved/SavedArks`，存档扩展名 `.ark`
15. **Mod 管理**：Steam Workshop mod，位于 `ShooterGame/Content/Mods/`，`dependency_check: true`

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack zod schema（校验 Pack 结构）

## 测试要求

- `pack.yaml` 通过 zod 校验（`GamePackSchema.safeParse`）
- 所有命令模板变量已声明
- `npm run typecheck`（panel/backend）不破坏编译

## 失败回退

- 回退点：`packs-archive/ark-vanilla/pack.yaml`（迁移前校正版本）
- 策略：基于 minecraft-vanilla 结构 + ARK 实际命令/端口/物品简化形式校正

## 闭合判据

- `packs/ark-vanilla/pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- 版本源配置完整（source/provider/official_url/version_regex/steam_login/eula_required）
- 端口声明完整（required_ports 含 game + query + rcon 三个端口）
- 物品 static_list 30+ 且 `special_attributes.quality` 声明完整（values 0-5）
