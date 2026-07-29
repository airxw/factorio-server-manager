---
type: guide
title: Pack 编写规范
date: 2026-07-24
status: active
related: public/schema/pack-schema.ts, packs/
tags: [pack, guide, authoring]
---

# Pack 编写规范

本规范供后续新增/校正 Pack 时参考，覆盖字段含义、数据来源、验证清单与常见陷阱。所有 Pack 必须通过 `public/schema/pack-schema.ts` 的 zod 校验（`npm run packs:validate`）。

## 1. 目录结构

```
packs/<pack-id>/
├── pack.yaml        # 完整 Pack 定义（必须）
└── AGENTS.md        # 模块级规则（必须，由 s0301 生成）
```

- `pack-id` 命名：`<game>-<variant>`，如 `minecraft-vanilla` / `terraria-tshock` / `rust-vanilla`。
- 同一游戏可有多 variant（如 terraria-vanilla 走 SteamCDM，terraria-tshock 走 GitHub Release）。
- 已废弃的 Pack 不放回 `packs-archive/`，直接删除并记录原因到本文件 §10。

## 2. 字段速查（顶层结构）

| 字段 | 必填 | 说明 |
|------|------|------|
| `pack` | ✅ | 元信息：`id` / `game` / `variant` / `display_name` / `version` |
| `startup` | ✅ | 启动配置：`binary` / `args` / `working_dir` / `ready_pattern` / `stop_command` / `stop_method` / `default_game_port` / `required_ports` |
| `protocol` | ✅ | 协议层（stdin / rcon / webrcon），用 discriminated union |
| `commands` | ✅ | 通用运维命令模板（broadcast / give_item / kick_player / ban_player / list_players / save_world） |
| `versions` | ✅ | 版本源配置（provider / official_url / version_regex / steam_login / eula_required） |
| `update` | ✅ | 更新流程（source_url / download_dir） |
| `backup` | ✅ | 备份配置（world_dir / pre_backup_commands / post_backup_commands） |
| `ui` | ✅ | 前端 Tab 声明（tabs 数组，每项含 tab / group / order / require_state） |
| `resources` | ✅ | 资源要求（min_ram / recommended_ram / min_disk） |
| `items` | ⚪ | 物品池配置（含 special_attributes 自适应声明） |
| `event_parsers` | ⚪ | stdout 事件解析（chat / join / leave） |
| `business` | ⚪ | 业务能力声明（shop / cdk / chat_enhancement / players / lists / verify） |
| `config_files` | ⚪ | 多配置文件列表（每项含 name / path / format / group / schema / read_only） |
| `saves` | ⚪ | 存档管理（dir / extension / create_command / activate_command） |
| `chat_log` | ⚪ | 聊天日志解析（pattern / storage_enabled / retention_days） |
| `mods` | ⚪ | Mod 管理（list_file / list_format / dependency_check / download_enabled / download_source） |
| `world_generation` | ⚪ | 地图生成（Factorio 等游戏用，create_command + settings_files） |

## 3. 版本源（versions 字段）

### 3.1 Provider 类型选择

| provider | 适用场景 | 数据来源 |
|----------|---------|---------|
| `mojang` | Minecraft | Mojang version_manifest API |
| `official-site` | Steam 游戏（主用） | 官网/官方公告 HTML 解析（配 official_url + version_regex） |
| `github-release` | TShock / 有官方 GitHub 的游戏 | GitHub Releases API |
| `factorio-official` | Factorio | `https://factorio.com/api/latest-releases` |
| `steamcmd-buildid` | Steam 游戏（兜底） | daemon 侧 SteamCMD `app_info_print` |
| `static` | 离线降级 | `staticVersions.ts` 兜底条目 |

### 3.2 Steam 游戏多源回退链

Steam 游戏版本源优先级：`official-site → github-release → steamcmd-buildid → static`。
pack.yaml 声明 `provider: official-site` 时，Panel 先试官网，失败自动回退 steamcmd-buildid。

### 3.3 关键约束

- Steam Web API 的 `GetAppBuilds` / `GetAppDepotVersions` 需要发行商 API 密钥，**不可用**。
- Steam 游戏官网版本号（如 "1.0"）与 depot buildid（数字）是两套体系，无法自动映射。
- Steam 游戏的"版本管理"实际是"更新管理"：版本展示用官网可读版本号，更新判断由 SteamCMD `app_update --validate` 自身决定。
- Steam 游戏 `update.install_command` 与 `current_version_command` 可省略（由 daemon steam-install 端点接管）。

### 3.4 字段示例

```yaml
versions:
  source: 'steamcmd://376030'        # steamcmd://<appid>
  type: steamcmd                      # server-jar / binary / steamcmd
  provider: official-site             # 见 §3.1
  official_url: 'https://ark.wiki.gg/wiki/Dedicated_Server_Setup'
  version_regex: '(\d+\.\d+)'         # 从 official_url 页面提取版本号
  steam_login: anonymous              # anonymous / user
  eula_required: true                 # Steam 游戏通常 true
```

## 4. 启动与停止（startup 字段）

### 4.1 端口声明

`required_ports` 必须声明该游戏占用的所有端口及协议：

```yaml
required_ports:
  - { port: 2456, protocol: udp, name: game,   primary: true }
  - { port: 2457, protocol: udp, name: steam,  primary: false }
  - { port: 2458, protocol: udp, name: query,  primary: false }
```

- 多端口游戏（Valheim 三端口 / ARK 多端口）必须完整声明。
- `primary: true` 标记主游戏端口，前端展示用。

### 4.2 就绪日志（ready_pattern）

- 必须用真实实例 stdout 样本验证。
- 收窄过宽的正则（如 Valheim `game server` 过宽，会匹配任意含该词的日志，应收窄为 `'Game server connected'`）。
- 单一锚点优于多锚点（避免误匹配）。

### 4.3 停止方法（stop_method）

| stop_method | 适用场景 | stop_command |
|-------------|---------|--------------|
| `rcon` | RCON 游戏（Minecraft/ARK/Rust/Zomboid） | RCON 命令（如 `stop` / `quit` / `SaveWorld` 后 `quit`） |
| `stdin` | stdin 游戏（DST/Valheim/Enshrouded/Satisfactory） | stdin 写入命令（如 `c_shutdown()`） |
| `sigint` | 信号停止游戏（Valheim 实际用） | `stop_command: null`，daemon 发 SIGINT |
| `sigterm` | 备用 | — |
| `kill` | 兜底强制 | — |

## 5. 命令模板（commands / business）

### 5.1 变量语法

- 用 `{{var}}` 占位符，渲染时由 commandDispatcher 替换。
- 支持的变量：`player` / `item` / `count` / `message` / `quality` / `reason` / `json`。
- 变量值经 `sanitizeTemplateVar` 清洗（移除 shell 元字符 `$ \` | & ;`）。

### 5.2 变量白名单 pattern

| 变量 | pattern | 说明 |
|------|---------|------|
| player | `^[A-Za-z0-9_-]{1,32}$` | 玩家名 |
| item | `^[A-Za-z0-9_. -]{1,64}$` | 物品名（允许点+空格，TShock/Rust 用） |
| count | `^[1-9][0-9]{0,5}$` | 1-999999 |
| message | `^[^\n\r]{1,256}$` | 单行 ≤256 |
| quality | `^(normal\|uncommon\|rare\|epic\|legendary)$` | 5 档品质 |

### 5.3 残留占位符检测

commandDispatcher 渲染后会用 `RESIDUAL_PLACEHOLDER_RE` 检测残留 `{{xxx}}`，发现则报错（避免下发空命令）。被 `special_attributes` 隐藏的属性占位符由 `stripHiddenPlaceholders` 在渲染前移除。

### 5.4 命令模板规则

- `business.shop.give_command` 必须与 `commands.give_item` 一致，或显式声明差异。
- 不支持某能力的 Pack，对应 `business` 字段设 `enabled: false`，前端隐藏对应 Tab。
- **严禁编造命令**：Palworld 原版 RCON 不支持 `/AdminCommand give_item`，必须如实设 `enabled: false`。
- Valheim `spawn` 命令在玩家附近生成物品而非入背包，需在前端如实标注限制。

## 6. 物品池（items 字段）

### 6.1 source.type 选择

| type | 说明 |
|------|------|
| `static` | 直接内联在 `static_list`（物品少时用） |
| `dynamic` | Panel 启动时通过 daemon 解析游戏数据文件生成 |
| `github_sync` | 从 GitHub 仓库同步物品清单 |
| `local_file` | 从游戏数据文件本地生成 |
| `remote` | 从可信远程源拉取（如 minecraft-data.com） |

### 6.2 物品 ID 命名规则

按游戏内部真实命名，**严禁编造**：

| 游戏 | 命名规则 | 示例 |
|------|---------|------|
| Minecraft | 蛇形小写 | `diamond_pickaxe` |
| Terraria（原版） | 数字 ID | `1`（铜阔剑） |
| Terraria（TShock） | 英文物品名（含空格） | `Copper Broadsword` |
| Factorio | 蛇形小写 | `iron-plate` |
| ARK | Blueprint 路径简化 | `PrimalItem_WeaponBow` |
| Rust | shortname（含点） | `rifle.ak` / `ammo.rifle` |
| DST | prefab 名（小写） | `flint` / `log` |
| Valheim | Prefab 名（大小写敏感） | `Wood` / `IronSword` |
| Zomboid | module.item | `Base.Axe` |

### 6.3 PackItemSchema 约束

- name 正则：`^[a-zA-Z0-9_. -]{1,64}$`（允许字母数字下划线短横线点空格，1-64 字符）。
- 安全性：命令通过 RCON/stdin 下发，不经 shell 解释；`sanitizeTemplateVar` 仍移除 shell 元字符。

## 7. 物品特殊属性自适应（items.special_attributes）

### 7.1 适用场景

游戏物品可能具有的特殊属性（品质/附魔/皮肤/前缀等）随版本变化，需自适应处理：

- Factorio 2.0+ 支持 5 档品质，1.1.x 不支持
- Minecraft 1.20.5+ 用物品组件，旧版用 NBT
- Rust 皮肤全版本适用
- ARK 品质系数全版本适用

### 7.2 声明格式

```yaml
items:
  special_attributes:
    - name: quality                          # 属性名
      display_name: 品质                       # 前端展示名
      applicable_versions: '>=2.0.0'          # 适用版本范围（语义版本约束）
      default_value: normal                   # 默认值（版本不匹配时回退）
      fallback_behavior: hide                 # hide / default / disable
      values: [normal, uncommon, rare, epic, legendary]
      description: 'Factorio 2.0+ 支持 5 档品质，1.1.x 不支持'
      command_template_key: '{{quality}}'     # 命令模板占位符
```

### 7.3 fallback_behavior 含义

| 值 | 行为 |
|----|------|
| `hide` | 隐藏该属性（前端不展示，命令模板移除占位符） |
| `default` | 用 `default_value` 替换占位符 |
| `disable` | 禁用该物品（前端置灰，dispatchable=false） |

### 7.4 版本约束语法

- `>=2.0.0` / `>1.1` / `<2.0.0` / `=1.4.4`
- 通配符：`2.0.x`（等价 `>=2.0.0 <2.1.0`）/ `1.x`（等价 `>=1.0.0 <2.0.0`）
- 未配置 `applicable_versions` 视为全版本适用。

### 7.5 项目接受 Pack 时的自适应

`itemAttributeResolver.resolveGiveCommandVars(pack, version, vars)` 按 `applicable_versions` 比对：
- 版本匹配 → 暴露该属性，渲染占位符
- 版本不匹配 → 按 `fallback_behavior` 处理（hide/default/disable）

## 8. 配置文件（config_files 字段）

### 8.1 字段结构

```yaml
config_files:
  - name: server-properties               # 唯一标识
    path: '{{instance_root}}/server.properties'  # 文件路径（可用变量）
    format: properties                     # properties / ini / json / yaml
    group: server                          # 功能分组（server/ops/combat/economy/world/network）
    schema:                                # 字段 schema
      server-port:
        type: integer                      # string / int / float / bool / enum
        description: 服务器端口
        default: 25565
        min: 1
        max: 65535
        requires_restart: true             # 修改后需重启生效
      rcon.password:
        type: string
        description: RCON 密码
        sensitive: true                    # 敏感字段，前端脱敏
    read_only: false                       # 是否只读
```

### 8.2 group 字段必填

`group` 必填，前端按组折叠展示：
- `server` — 服务器核心配置（端口/名称/密码/最大玩家）
- `ops` — 运维管理（管理员列表/封禁列表/白名单）
- `combat` — 战斗相关（PVP/伤害）
- `economy` — 经济相关（商店/CDK）
- `world` — 世界生成（地图种子/难度）
- `network` — 网络相关（端口/转发）

### 8.3 schema 字段级元数据

每个字段可声明以下可选键：
- `requires_restart: boolean` — 修改后需重启实例生效
- `sensitive: boolean` — 敏感字段（密码），前端脱敏显示
- `description: string` — 字段说明
- `default: any` — 默认值
- `min` / `max` / `enum_values` — 取值约束

## 9. 验证清单（新增 Pack 必须逐条核对）

- [ ] `pack.yaml` 通过 `npm run packs:validate`（zod 校验）
- [ ] `pack.id` / `pack.game` / `pack.variant` 命名规范
- [ ] `startup.binary` 路径真实（Steam 游戏验证 SteamCMD 下载后的二进制路径）
- [ ] `startup.args` 对照官方文档逐条核实
- [ ] `startup.ready_pattern` 用真实 stdout 样本验证（收窄过宽正则）
- [ ] `startup.stop_command` / `stop_method` 验证（RCON/stdin/sigint）
- [ ] `startup.default_game_port` 与 `required_ports` 一致
- [ ] `startup.required_ports` 完整声明所有占用端口
- [ ] `protocol.type` 与游戏实际协议一致（stdin/rcon/webrcon）
- [ ] `commands` 所有命令模板用真实实例验证（不编造）
- [ ] `business.shop.give_command` 与 `commands.give_item` 一致
- [ ] 不支持的能力 `business.*.enabled: false`
- [ ] `versions.source` / `versions.provider` / `versions.official_url` / `versions.version_regex` 配置完整
- [ ] `items.static_list` 物品 ID 对照官方 Wiki/数据文件核实
- [ ] `items.special_attributes` 声明特殊属性（如适用）
- [ ] `config_files` 字段补全，`group` 必填
- [ ] `config_files.schema` 字段含 `type` / `description` / `default` / `sensitive`（如适用）
- [ ] `pack.yaml` 头部注释标注 `# verified: <date> <source>`
- [ ] 配套 `AGENTS.md`（参照 minecraft-vanilla/AGENTS.md 模板）
- [ ] 端口冲突检查（与现有 Pack 对比，如 Minecraft 25575 与 Palworld 25585 不冲突）

## 10. 不支持的游戏（参考案例）

### 10.1 Dyson Sphere Program（戴森球计划）

- **状态**：彻底移除，不放入 `packs-archive/`。
- **原因**：DSP 官方未提供 Linux 独立专用服务端二进制，无法做真实支持。
- **教训**：不假支持、不逆向、不非官方方案。如未来官方发布 dedicated server，再新增 Pack。

### 10.2 决策原则

- 无官方 dedicated server 的游戏，不新增 Pack。
- 不做 uMod variant（除非有原厂支持，避免假数据）。
- 原版不支持的能力（如 Palworld RCON 不支持发放物品），如实 `enabled: false` 并前端隐藏，不留虚假命令。

## 11. 常见陷阱

### 11.1 版本号格式

- Steam 游戏版本号格式多样（`1.0` / `v0.3.3.54124` / `26.3-snapshot-4`），`parseVersionFlex` 统一处理：
  - 去 `v` 前缀
  - 提取主版本段 `x.y.z`
  - 提取 build 号（如 `0.3.3.54124` → segments `[0,3,3]` + buildId `54124`）
- 严禁用 `staticVersions.ts` 的人工表作为主数据源（已 `@deprecated`，仅离线降级兜底）。

### 11.2 SteamCMD 集成

- Steam 游戏 `install_command` 省略，由 daemon steam-install 端点接管。
- `current_version_command` 省略，改为读 `appmanifest_<appid>.acf` 的 `buildid` 字段。
- anonymous 登录对部分游戏无效，`versions.steam_login: user` 时需在 daemon 配置 steam 账号。
- SteamCMD 首次运行会自更新，daemon 端点 timeout 设 900s。

### 11.3 物品名含空格/点

- TShock 物品名含空格（`Copper Broadsword`），Rust shortname 含点（`metal.fragments`）。
- `PackItemSchema.name` 正则允许空格和点。
- `commandDispatcher.VARIABLE_PATTERNS.item` 同步允许空格和点。
- 安全性保证：命令通过 RCON/stdin 下发，不经 shell 解释；`sanitizeTemplateVar` 仍移除 shell 元字符。

### 11.4 残留占位符

- commandDispatcher 渲染后检测残留 `{{xxx}}`，发现则报错。
- `special_attributes` 隐藏的属性占位符由 `stripHiddenPlaceholders` 在渲染前移除（保留词间空格）。
- `PLACEHOLDER_RE` 用全局标志会状态污染，残留检测用 `RESIDUAL_PLACEHOLDER_RE`（无全局标志）。

### 11.5 端口冲突

- Minecraft RCON 默认 25575，Palworld 改为 25585 避免冲突。
- 多 Pack 实例端口分配由 `portAllocator` 按 `required_ports` 批量分配。
- 实例删除时释放 `allocated_ports` 中所有端口。

## 12. 参考案例

| Pack | 特色 | 参考点 |
|------|------|--------|
| minecraft-vanilla | 标准范本 | Mojang provider / RCON / properties 配置 |
| factorio-vanilla | special_attributes 自适应 | FactorioVersionProvider / quality 属性 / 版本约束 |
| terraria-tshock | GitHub Release + 物品名含空格 | GitHubReleaseVersionProvider / PackItemSchema 空格 |
| palworld-vanilla | 如实告知不支持 | shop.enabled=false / 移除编造命令 |
| valheim-vanilla | stdin + 信号停止 | spawn 命令限制标注 / stop_method=sigint |
| dst-vanilla | stdin Lua 命令 | c_give prefab 名 / 多配置文件 |
| ark-vanilla | 多端口 + Blueprint 物品 | required_ports 三端口 / special_attributes.quality |

## 13. 相关文档

- 契约：`public/schema/pack-schema.ts`（zod schema，运行时校验）
- 方案：`docs/plans/pack-system-overhaul-plan.md`（Pack 系统真实化重构方案）
- 校验脚本：`scripts/validate-packs.ts`（`npm run packs:validate`）
- 综合自检：`scripts/check-all.ts`（`npm run check`，含 Pack YAML 校验）
- VersionProvider：`panel/backend/src/core/packs/versionProviders/`
- 物品属性自适应：`panel/backend/src/core/packs/itemAttributeResolver.ts`
- 命令分发：`panel/backend/src/services/commandDispatcher.ts`
- 版本比对：`panel/backend/src/core/packs/versionCompare.ts`
