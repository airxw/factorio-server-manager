# Project Zomboid 游戏包 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容。

---

## 模块信息

- **模块名**：Project Zomboid 游戏包（zomboid-vanilla）
- **物理路径**：`packs/zomboid-vanilla/`
- **职责**：完整 Pack YAML 定义（启动/命令/配置/版本/备份/EULA/物品池/业务能力）
- **依赖**：模块0（`public/schema/pack-schema.ts` 用于校验）

---

## 可修改文件范围

```
packs/zomboid-vanilla/
└── pack.yaml                       # 完整 Pack 定义
```

## gsp 项目规范通用约束

- Pack YAML 必须通过 `public/schema/pack-schema.ts` 的 zod 校验
- 禁止在 Pack 中硬编码服务器地址、密码等环境相关信息
- 命令模板变量使用 `{{var}}` 语法
- `public/` 目录保护：不得删除/修改/覆盖 `public/` 下文件，契约变更走 s0601 流程

## 模块专属约束

1. **游戏类型**：`pack.game: zomboid`，Steam App ID 380870（Project Zomboid Dedicated Server）
2. **协议类型**：`protocol.type: rcon`，`default_port: 27015`，`auth: password`，`encrypt: none`
   - 需在 `Zomboid/Server/<ServerName>.ini` 中启用 RCON（RCONEnabled=true，RCONPort，RCONPassword）
3. **启动命令**：`./start-server.sh` + 启动参数（-servername / -adminpassword / -port / -udpport）
4. **就绪检测**：`ready_pattern: 'Server is listening on port|Server started'`
5. **停止方法**：`stop_method: rcon`，`stop_command: 'quit'`，`stop_timeout: 60`
   - Zomboid 停止耗时较长，超时 60s
6. **端口声明**：
   - `default_game_port: 16261`（UDP，游戏端口）
   - `required_ports`：16261/udp(game,primary) + 16262/udp(steam) + 27015/tcp(rcon)
7. **配置文件**：`config_files` 单个 INI 文件 `Zomboid/Server/<ServerName>.ini`
   - 字段：MaxPlayers / Password / Open / Public / PublicName / PublicDescription / ServerWelcomeMessage / RCONPort / RCONPassword / RCONEnabled / PauseEmpty / PVP / ShowCoordinates / ShowFirstAndLastName
   - 路径：`{{instance_root}}/Zomboid/Server/{{server_name}}.ini`
8. **命令映射**（PZ RCON 命令）：
   - `broadcast: 'servermsg {{message}}'`（servermsg 是 PZ 服务器公告命令）
   - `give_item: 'additem "{{player}}" {{item}} {{count}}'`（物品用 module.item 格式，如 Base.Axe）
   - `kick_player: 'kickuser "{{player}}"'`
   - `ban_player: 'banuser "{{player}}"'`
   - `unban_player: 'unbanuser "{{player}}"'`
   - `list_players: 'players'`
   - `save_world: 'save'`
9. **版本源**：
   - `versions.source: 'steamcmd://380870'`
   - `versions.type: steamcmd`
   - `versions.provider: official-site`（配合 official_url + version_regex，失败走多源回退链）
   - `versions.official_url: 'https://projectzomboid.com/blog/'`
   - `versions.version_regex: '(\d+\.\d+(?:\.\d+)?)'`
   - `versions.steam_login: anonymous`
   - `versions.eula_required: false`
10. **游戏更新**：Steam 游戏简化配置
    - `update.source_url: 'https://projectzomboid.com/blog/'`（URL 格式占位，实际走 provider 链）
    - `update.download_dir: '{{instance_root}}'`
    - `current_version_command` / `install_command` 省略（Steam 游戏读 appmanifest buildid，由 daemon steam-install 接管）
11. **资源要求**：`min_ram: 4G` / `recommended_ram: 8G` / `min_disk: 5G`
12. **物品池**：
    - Zomboid 物品用 `module.item` 格式（module 通常为 Base），参考 PZ Wiki
    - `qualities: []`，`quality_tiers: 0`（additem 无品质参数，shop 不暴露品质选择）
    - `static_list` 39 个物品（材料/武器/弹药/工具/食物/医疗/服装），display_name 中文
    - 物品名允许点号（schema 已支持）
13. **业务能力**：shop/cdk/chat_enhancement/players/lists enabled；verify disabled
    - `business.shop.enabled: true`，`business.shop.give_command` 与 `commands.give_item` 一致：`'additem "{{player}}" {{item}} {{count}}'`
    - `business.shop.support_quality: false`，`quality_tiers: 0`
    - `lists.whitelist_add: 'addusertowhitelist "{{player}}"'`
14. **备份**：`world_dir: '{{instance_root}}/Zomboid/Saves/Multiplayer/{{server_name}}'`，存档扩展名 `.bin`
15. **Mod 管理**：Zomboid Mod 放在 `Zomboid/mods/`，通过 `ServerName.ini` 的 `WorkshopItems=` 启用，`dependency_check: false`

## 依赖的契约入口

- `public/schema/pack-schema.ts` → Pack zod schema（校验 Pack 结构）

## 测试要求

- `pack.yaml` 通过 zod 校验（`GamePackSchema.safeParse`）
- 所有命令模板变量已声明
- `npm run typecheck`（panel/backend）不破坏编译

## 失败回退

- 回退点：`packs-archive/zomboid-vanilla/pack.yaml`（迁移前校正版本）
- 策略：基于 minecraft-vanilla / dst-vanilla 结构 + Zomboid 实际命令/端口/物品校正

## 闭合判据

- `packs/zomboid-vanilla/pack.yaml` 通过 zod 校验
- 所有命令模板变量已声明
- 版本源配置完整（source/provider/official_url/version_regex/steam_login/eula_required）
- 端口声明完整（required_ports 含 game + steam + rcon 三个端口）
- 物品 static_list ≥20 且 module.item 格式真实（display_name 中文）
- stop_method: rcon + stop_command: 'quit' + stop_timeout: 60 配置正确
- config_files 含 ServerName.ini 基础字段（MaxPlayers/Password/Open/Public/PVP/RCON 等）
- business.shop.give_command 与 commands.give_item 一致
