# 扩展 Pack Schema 以支持 Factorio 集成 Spec

> ## 三段交接信息（rules-5 §二）
> - **工程过程**：spec 编写完成，已完成 GN-004 首次审查（阻断 7 项）并修正全部阻断项，待复审。
> - **交接状态**：未闭合（spec 阶段，尚未进入实现）
> - **最终结果**：无（spec 阶段无代码产出）。产出物：spec.md / tasks.md / checklist.md 三件套。

## Why

底座已具备完善的通用能力（命令模板/协议/物品/商城/CDK/聊天增强/备份/UI 标签），且 `mod_records`/`save_records`/`player_histories` 表与对应的 DB-only 服务（modService/saveService）和路由（routes/mods.ts、routes/saves.ts、routes/player.ts）已存在。但 Factorio 独有的 6 项能力（地图生成、Mod 文件读写、存档命令调用、多配置文件管理、游戏更新、聊天日志解析存储）尚未抽象到 Pack 配置中，现有 modService/saveService 仅做 DB 记录管理、不读写实际文件、不调用 Pack 命令。需要扩展 Pack schema 使其完全配置驱动，并扩展现有服务增加文件操作与命令调用能力，新增 Factorio Pack YAML 即可获得 `d:\代码\factorio` 等价功能。

## What Changes

### 现状基线（GN-004 审查要求对齐）

| 资源 | 现状 | 本 Spec 处理 |
|------|------|-------------|
| `mod_records` 表 | 已存在（id/server_id/mod_name/version/enabled/source_url/installed_at/created_at/updated_at） | 不新增，不修改表结构 |
| `save_records` 表 | 已存在（id/server_id/save_name/file_path/size_bytes/modified_at/is_active/created_at，UNIQUE(server_id, save_name)） | 不新增，不修改表结构 |
| `player_histories` 表 | 已存在（会话模型：game_player_name/joined_at/left_at/ip_address/session_duration/created_at） | 不新增，不修改表结构（保留会话模型） |
| `modService.ts` | 已存在，DB-only（CRUD mod_records，不读写 mod-list.json） | 扩展：增加 mod-list 文件读写 + 依赖检查 + 下载 |
| `saveService.ts` | 已存在，DB-only（CRUD save_records，不调用 Pack 命令） | 扩展：增加 Pack saves 命令调用 + 文件系统操作 |
| `routes/mods.ts` | 已存在（前缀 /api/servers/:serverId/mods） | 不新增路由，仅扩展服务层能力 |
| `routes/saves.ts` | 已存在（前缀 /api/servers/:serverId/saves） | 不新增路由，仅扩展服务层能力 |
| `routes/player.ts` | 已存在（GET /:serverId/player-histories） | 不新增路由 |
| 路由前缀 | 现有全部为 `/api/servers/:serverId/` | 新路由统一使用 `/api/servers/:serverId/` 前缀 |

### Pack Schema 扩展（新增 6 个可选字段，均为 optional 向后兼容）

- **`world_generation`**：地图生成命令 + 地图设置文件 schema
  - `create_command`: 生成地图的命令模板（如 `{{binary}} --create-map {{save_path}} --map-gen-settings {{config_dir}}/map-gen-settings.json --map-settings {{config_dir}}/map-settings.json`）
  - `settings_files`: [{ name, path, format, schema }] — map-gen-settings.json / map-settings.json 的结构定义
- **`mods`**：Mod 文件管理配置（声明 mod-list 文件位置与下载源，DB 记录由现有 mod_records 表承载）
  - `list_file`: mod-list 文件路径模板（如 `{{config_dir}}/mod-list.json`）
  - `list_format`: 复用现有 `ConfigFormatSchema` enum（`properties | json | ini | yaml`）
  - `dependency_check`: 是否启用依赖检查（boolean）
  - `download_enabled`: 是否支持 mod 下载（boolean）
  - `download_source`: mod 下载源 URL 模板（如 `https://mods.factorio.com/api/mods/{{mod_name}}`）
- **`saves`**：存档文件管理配置（声明存档目录与命令，DB 记录由现有 save_records 表承载）
  - `dir`: 存档目录路径模板（如 `{{instance_dir}}/saves`）
  - `extension`: 存档文件扩展名（如 `.zip`）
  - `create_command`: 创建新存档的命令模板
  - `activate_command`: 激活存档的命令模板
- **`config_files`**：多配置文件列表（与现有 `config` 字段共存，`config` 标记 deprecated 但保留兼容）
  - `name`: 配置项标识（如 `server-settings`）
  - `path`: 文件路径模板（如 `{{config_dir}}/server-settings.json`）
  - `format`: 复用现有 `ConfigFormatSchema` enum（`properties | json | ini | yaml`）
  - `schema`: JSON Schema 描述字段结构，Zod 类型为 `z.record(z.unknown())`（供前端动态渲染表单）
  - `read_only`: 是否只读（boolean，部分游戏配置不可写）
- **`update`**：游戏二进制更新
  - `source_url`: 版本检查 URL（返回 JSON `{latest_version, download_url}`）
  - `current_version_command`: 获取当前版本的命令模板
  - `download_dir`: 下载目录
  - `install_command`: 安装命令模板（解压/替换二进制）
- **`chat_log`**：聊天日志解析与存储
  - `pattern`: 匹配聊天行的正则表达式（含命名捕获组 `timestamp/player_name/message`）
  - `storage_enabled`: 是否持久化到 `chat_logs` 表（boolean）
  - `retention_days`: 保留天数（默认 30）

### InstanceTabSchema enum 扩展（新增 tab 值）

现有 `InstanceTabSchema` enum: `['console', 'config', 'players', 'backups', 'monitor', 'logs', 'shop-admin', 'cdk-admin']`。新增值：
- `mods` — Mod 管理 tab
- `saves` — 存档管理 tab
- `config-files` — 多配置文件 tab
- `world-gen` — 地图生成 tab
- `chat-logs` — 聊天日志 tab
- `player-histories` — 玩家历史 tab（现有数据已存在，仅前端 tab 化）

### event_parsers 字段（保留现有结构，不新增 type）

现有 `PackEventParsersSchema` 是固定对象 `{ chat?, join?, leave? }`，每个字段有 `pattern` + `groups`/`player_group`。**本 Spec 不修改 event_parsers schema 结构**，Factorio Pack 直接填充现有 `join`/`leave` 字段即可（现有 Minecraft Pack 已使用此结构）。`player_histories` 表的会话模型由现有 `event_parsers.join`/`leave` 解析后更新 joined_at/left_at。

### config 与 config_files 的关系（定稿，消除矛盾）

- **`config` 字段**：现有 required 字段，结构 `{ format, main_file, schema: ConfigField[] }`。本 Spec 将其改为 **optional + deprecated**（Zod `.optional()`），建议新 Pack 使用更通用的 `config_files`。现有 Minecraft Pack 的 `config` 字段保留兼容，不强制迁移。
- **`config_files` 字段**：新增 optional 字段，支持多配置文件列表，每个文件独立声明 path/format/schema/read_only。
- **共存规则**：Pack 可同时声明 `config`（单主配置字段级 schema）和 `config_files`（多文件），也可只声明其一。Factorio Pack 仅用 `config_files`；Minecraft Pack 保留 `config`（兼容）+ 补充 `config_files`。
- **删除原 spec 中的"BREAKING 替代"和"3 版本后移除"表述**——不破坏向后兼容，不设强制移除时间表。

### 数据库变更（仅新增 1 张表）

- **`chat_logs`**（真正新增）：实例的聊天日志（id, server_id, player_name, message, sent_at, created_at，INDEX(server_id, sent_at)）
- **不新增**：mod_records（已存在）、save_records（已存在）、player_histories（已存在，保留会话模型）

### 后端服务变更

**新增服务（4 个）**：
- `worldGenService` — 调用 Pack 的 `world_generation.create_command` 生成地图
- `configFileService` — 通用配置文件读写（按 Pack `config_files` 声明）
- `updateService` — 游戏二进制更新（检查 + 下载 + 安装）
- `chatLogService` — 聊天日志解析与存储（与现有 chatService 边界：chatService 管理 chat_settings/chat_triggers 业务配置；chatLogService 解析 stdout 聊天行并持久化到 chat_logs 表）

**扩展现有服务（2 个）**：
- `modService`（扩展现有 DB-only 实现）— 增加 `readModListFile`/`writeModListFile`（读写 Pack mods.list_file）、`checkDependencies`（若 Pack mods.dependency_check=true）、`downloadMod`（若 Pack mods.download_enabled=true，从 download_source 下载）。DB 记录仍走 mod_records 表。
- `saveService`（扩展现有 DB-only 实现）— 增加 `createSaveViaPack`（调用 Pack saves.create_command 生成存档文件 + 写 save_records）、`activateSaveViaPack`（调用 Pack saves.activate_command + 更新 is_active）、`deleteSaveFile`（删除存档文件 + 删 save_records）。

**playerHistoryService**：若已存在则扩展（确保 event_parsers.join/leave 解析后更新 player_histories 的 joined_at/left_at）；若不存在则新建。实施时通过 Glob 确认 services 目录下是否已有该服务。

### Daemon 扩展（新增端点，支持文件操作和命令执行）

用户裁决（2026-07-15 AskUserQuestion）：选择"扩展 Daemon（推荐）"路径，由 Daemon 承载文件读写和二进制命令执行能力，Panel 通过 daemonClient 调用，支持多节点部署。

**Daemon 新增端点**（`daemon/src/server.ts`）：
- `POST /api/instances/:id/exec` — 在实例 workdir 下执行任意二进制命令（用于 `factorio --create` 离线生成地图、版本查询命令、安装命令等）
  - 请求体：`{ binary: string, args: string[], cwd?: string, env?: Record<string,string>, timeout?: number }`
  - 响应：`{ exit_code: number, stdout: string, stderr: string, duration_ms: number }`
  - 安全：binary 必须在 Pack 声明范围内（startup.binary 或 Pack 命令模板渲染后的 binary），cwd 必须在 instance.workdir 内
- `GET /api/instances/:id/files?path=<relative-path>` — 读取实例 workdir 下的文件
  - 响应：`{ path: string, content: string, size: number, modified_at: string }`
  - 安全：path 必须在 instance.workdir 内（防路径穿越 `..`）
- `PUT /api/instances/:id/files?path=<relative-path>` — 写入实例 workdir 下的文件
  - 请求体：`{ content: string, encoding?: 'utf-8' | 'base64' }`
  - 响应：`{ path: string, size: number, modified_at: string }`
  - 安全：同 GET，path 必须在 instance.workdir 内

**Panel 侧扩展**：
- `panel/backend/src/daemonClient/client.ts` — DaemonHttpClient 新增 `execCommand(id, body)` / `readFile(id, path)` / `writeFile(id, path, body)` 方法
- `panel/backend/src/services/daemonClientService.ts` — DaemonClient 接口新增 `execCommand(nodeId, serverId, body)` / `readFile(nodeId, serverId, path)` / `writeFile(nodeId, serverId, path, body)` 方法

**public/ 契约扩展**（⚠️ public/ 修改须人类显式授权）：
- `public/schema/daemon-api-types.ts` — 新增 `ExecCommandRequest` / `ExecCommandResponse` / `FileReadResponse` / `FileWriteRequest` / `FileWriteResponse` 类型
- `public/interface_stub/daemon-rest.ts` — IDaemonRestApi 接口扩展 `execCommand` / `readFile` / `writeFile` 方法签名

**实施任务**：Task 3.5（新增），依赖 Task 1（Pack schema 扩展完成），是 Task 4-10 的前置依赖。

### 后端新增路由（统一前缀 /api/servers/:serverId/ 或 /api/packs/:packId/）

- `GET/PUT /api/servers/:serverId/config-files/:name` — 读写配置文件（PUT 受 read_only 限制返回 403）
- `GET /api/servers/:serverId/config-files/:name/schema` — 返回配置文件 schema 供前端渲染
- `POST /api/servers/:serverId/world/regenerate` — 重新生成地图
- `GET/PUT /api/servers/:serverId/world/map-settings/:settingsName` — 读写地图设置文件
- `GET /api/servers/:serverId/chat-logs` — 聊天日志查询
- `GET /api/packs/:packId/update/check` — 检查游戏更新
- `POST /api/packs/:packId/update/apply` — 应用游戏更新
- **不新增**：mods/saves/player-histories 路由（已存在）

### Factorio Pack YAML

新建 `packs/factorio-vanilla/pack.yaml`，配置：
- `pack`: id=factorio-vanilla / game=factorio / variant=vanilla / display_name / version
- `startup.binary: ./factorio`、`args: [--start-server, {{save_path}}, --server-settings, {{config_dir}}/server-settings.json, --rcon-port, {{rcon_port}}]`
- `protocol.type: rcon`、`default_port: 27015`
- `commands`: broadcast/give_item/kick/ban/say/whitelist_add/whitelist_remove 等（Factorio RCON 命令格式）
- `world_generation`: `--create-map` 命令 + map-gen-settings.json/map-settings.json schema
- `mods`: mod-list.json + 依赖检查 + Factorio mod portal 下载源
- `saves`: `.zip` 扩展名 + 存档目录 + create_command + activate_command
- `config_files`: server-settings.json（含 name/description/max_players/visibility/public/rcon_port/rcon_password 字段的 JSON Schema）
- `update`: Factorio 官方下载源
- `chat_log`: Factorio 控制台聊天行正则
- `event_parsers`: 填充现有 `join`/`leave` 字段（不新增 type）
- `business`: shop/CDK/players/lists/chat_enhancement（Factorio 命令格式）
- `ui.tabs`: console/players/mods/saves/config-files/world-gen/chat-logs/monitor/shop-admin（使用扩展后的 InstanceTabSchema enum 值）
- `config` 字段：Factorio Pack 不填（config 已改 optional）

### Minecraft Pack 验证

现有 `packs/minecraft-vanilla/pack.yaml` 在扩展后的 schema 下保持兼容（新字段全部可选）。补充 `config_files`（server.properties）、`saves`（level.dat + region）、`chat_log`（Minecraft 控制台正则）、`event_parsers`（填充现有 join/leave 字段）。保留原 `config` 字段（deprecated，兼容期）。

### 前端新增/扩展页面

- `InstanceDetail` 子页新增：Mod 管理、存档管理、配置文件编辑器、地图生成、聊天日志、玩家历史 tab
- 通用 JSON/YAML/Properties 编辑器组件（按 Pack `config_files[].format` 动态渲染）
- Pack 更新检查与应用 UI（在 `/admin/packs` 页面）
- Tab 动态化：读取 Pack `ui.tabs` 配置动态渲染，未声明能力的 Pack 不显示对应 tab

## Impact

- **Affected specs**: `redesign-roles-vip-navigation`（实例路由已就绪，新子页挂在 `/instances/:id/*` 前端路由下；后端 API 统一 `/api/servers/:serverId/` 前缀）
- **Affected code**:
  - `public/schema/pack-schema.ts`（Zod schema 扩展：新增 6 个 optional 字段 + 扩展 InstanceTabSchema enum + config 改 optional）— **⚠️ public/ 目录修改，实施前须由主 agent 拉起 AskUserQuestion 显式授权（rules-0 §四-10）**
  - `panel/backend/src/core/packs/`（loader + registry 适配新字段）
  - `panel/backend/src/services/`（4 个新服务 + 2 个扩展现有服务）
  - `panel/backend/src/api/routes/`（新增 configFiles/worldGen/updates/chatLogs 路由）
  - `panel/backend/src/db/migrations/`（新增 1 张 chat_logs 表迁移脚本）
  - `panel/frontend/src/pages/instance-detail/`（新子页）
  - `panel/frontend/src/components/`（通用配置编辑器）
  - `packs/factorio-vanilla/pack.yaml`（新建）
  - `packs/minecraft-vanilla/pack.yaml`（补字段）

## ADDED Requirements

### Requirement: Pack Schema 扩展 — world_generation

系统 SHALL 在 Pack schema 中支持可选字段 `world_generation`，包含 `create_command`（命令模板）和 `settings_files`（配置文件列表）。当 Pack 声明了此字段时，底座提供 `POST /api/servers/:serverId/world/regenerate` 端点调用该命令重新生成地图；未声明时该端点返回 404。

#### Scenario: Factorio 实例重新生成地图
- **WHEN** 管理员对 Factorio 实例调用 `POST /api/servers/:serverId/world/regenerate`
- **THEN** 系统读取 Pack 的 `world_generation.create_command`，替换变量后通过 Daemon 执行，返回新存档路径

#### Scenario: Minecraft Pack 无 world_generation
- **WHEN** 管理员对 Minecraft 实例调用 `POST /api/servers/:serverId/world/regenerate`
- **THEN** 系统返回 404（Pack 未声明 world_generation）

### Requirement: Pack Schema 扩展 — mods

系统 SHALL 在 Pack schema 中支持可选字段 `mods`，包含 `list_file`（文件路径模板）、`list_format`（复用 ConfigFormatSchema）、`dependency_check`、`download_enabled`、`download_source`。声明后 modService 扩展为：读写 mod-list 文件 + DB 记录同步 + 依赖检查 + 下载能力。

#### Scenario: 添加 Factorio mod
- **WHEN** 管理员通过 `POST /api/servers/:serverId/mods` 添加 mod
- **THEN** 系统更新 mod-list 文件（若 Pack 声明 mods.list_file），同步 mod_records 表记录，若 `dependency_check=true` 则验证依赖，若 `download_enabled=true` 则从 `download_source` 下载 mod 文件

### Requirement: Pack Schema 扩展 — saves

系统 SHALL 在 Pack schema 中支持可选字段 `saves`，包含 `dir`、`extension`、`create_command`、`activate_command`。声明后 saveService 扩展为：调用 Pack 命令 + 文件系统操作 + DB 记录同步。

#### Scenario: 创建新 Factorio 存档
- **WHEN** 管理员通过 `POST /api/servers/:serverId/saves` 创建新存档
- **THEN** 系统调用 `saves.create_command` 生成新存档文件，记录到 `save_records` 表

### Requirement: Pack Schema 扩展 — config_files

系统 SHALL 在 Pack schema 中支持可选字段 `config_files`，与现有 `config` 字段共存（config 改 optional + deprecated）。每个配置文件声明 `name/path/format/schema/read_only`。

#### Scenario: 编辑 Factorio server-settings.json
- **WHEN** 管理员通过 `PUT /api/servers/:serverId/config-files/server-settings` 更新配置
- **THEN** 系统按 `format=json` 解析请求体，校验符合 `schema`，写入 `path` 指定的文件

#### Scenario: Minecraft server.properties 只读
- **WHEN** Pack 声明 server.properties 的 `read_only=true`
- **THEN** `PUT` 端点返回 403，`GET` 端点正常返回文件内容

### Requirement: Pack Schema 扩展 — update

系统 SHALL 在 Pack schema 中支持可选字段 `update`，包含 `source_url`、`current_version_command`、`download_dir`、`install_command`。

#### Scenario: 检查 Factorio 版本更新
- **WHEN** 管理员通过 `GET /api/packs/:packId/update/check` 检查更新
- **THEN** 系统请求 `source_url`，比对返回的 `latest_version` 与 `current_version_command` 输出，返回 `{current, latest, update_available}`

### Requirement: Pack Schema 扩展 — chat_log

系统 SHALL 在 Pack schema 中支持可选字段 `chat_log`，包含 `pattern`（正则）、`storage_enabled`、`retention_days`。chatLogService 与现有 chatService 职责分工：chatService 管理 chat_settings/chat_triggers 业务配置；chatLogService 解析 stdout 聊天行并持久化。

#### Scenario: Factorio 聊天日志解析存储
- **WHEN** Daemon 转发实例 stdout 到 Panel
- **THEN** Panel 按 `chat_log.pattern` 匹配聊天行，若 `storage_enabled=true` 则写入 `chat_logs` 表，超过 `retention_days` 的记录自动清理

### Requirement: InstanceTabSchema enum 扩展

系统 SHALL 在 `InstanceTabSchema` enum 中新增值：`mods`、`saves`、`config-files`、`world-gen`、`chat-logs`、`player-histories`。Factorio Pack 的 `ui.tabs` 可使用这些值，前端动态渲染对应 tab。

#### Scenario: Factorio Pack ui.tabs 校验通过
- **WHEN** Factorio Pack YAML 声明 `ui.tabs: [console, players, mods, saves, config-files, world-gen, chat-logs, monitor]`
- **THEN** Zod schema 校验通过，前端动态渲染 8 个 tab

## MODIFIED Requirements

### Requirement: Pack Schema（原有）

原有 Pack schema 的 `commands/protocol/startup/items/business/backup/ui/versions/event_parsers` 字段保持不变。新增 6 个可选字段不破坏向后兼容。`config` 字段从 required 改为 optional + deprecated（Zod `.optional()`），建议新 Pack 使用 `config_files`，现有 Pack 保留 `config` 兼容。`InstanceTabSchema` enum 新增 6 个值。`event_parsers` 结构不变（保留 chat/join/leave 固定字段）。

### Requirement: modService（扩展现有）

现有 modService 为 DB-only（CRUD mod_records）。扩展增加：读写 Pack mods.list_file 文件、依赖检查、mod 下载。DB 记录仍走 mod_records 表。

### Requirement: saveService（扩展现有）

现有 saveService 为 DB-only（CRUD save_records）。扩展增加：调用 Pack saves.create_command/activate_command、文件系统操作。DB 记录仍走 save_records 表。

### Requirement: Minecraft Pack

`packs/minecraft-vanilla/pack.yaml` 补充 `config_files`（server.properties）、`saves`、`chat_log`、`event_parsers`（填充现有 join/leave 字段），保留原 `config` 字段（deprecated 兼容）。

## REMOVED Requirements

无。本 Spec 不删除任何现有字段或能力，全部为新增 optional 字段 + 扩展现有服务。原 spec 草案中的"旧 config 字段移除"已取消（改为 deprecated 兼容）。

# Subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|---------------|---------|-----------------|---------|-----------|------|
| P1-Spec | — | 主线程（非subagent） | spec.md/tasks.md/checklist.md | — | .trae/specs/extend-pack-schema-for-factorio/ | — | 已完成 |
| P2-PackSchema | — | general_purpose_task | pack-schema.ts 扩展（6 字段+enum+config optional） | 待回填 | public/schema/pack-schema.ts | P1 | 待启动 |
| P2-FactorioPack | [P] | parallel-sub-agent | factorio-vanilla/pack.yaml | 待回填 | packs/factorio-vanilla/pack.yaml | P2-PackSchema（Task 2 依赖 Task 1 schema 校验，串行执行） | 待启动 |
| P3-DBMigration | — | general_purpose_task | chat_logs 表迁移脚本 | 待回填 | panel/backend/src/db/migrations/ | P2-PackSchema | 待启动 |
| P4-Services | [P] | parallel-sub-agent | 4 新服务 + 2 扩展服务 | 待回填 | panel/backend/src/services/ | P3 | 待启动 |
| P4-Routes | — | general_purpose_task | 4 新路由文件 | 待回填 | panel/backend/src/api/routes/ | P4-Services（路由依赖服务，串行执行） | 待启动 |
| P5-Frontend | — | general_purpose_task | 子页+编辑器组件 | 待回填 | panel/frontend/src/pages/instance-detail/ | P4-Routes | 待启动 |
| P6-MinecraftPack | [P] | parallel-sub-agent | minecraft pack 补字段 | 待回填 | packs/minecraft-vanilla/pack.yaml | P2-PackSchema（依赖 schema 扩展，串行执行） | 待启动 |
| P7-Verify | — | 主线程（非subagent） | 编译+运行时验证 | — | tasks.md 勾选 | P5 | 待启动 |
| P7-GN004 | — | GN-004 | 交付前审查 | 待回填 | .trae/documents/ | P7-Verify | 待启动 |

> **并行说明**：P2-FactorioPack、P6-MinecraftPack 标 [P] 表示可与 P2-PackSchema 之后的某些任务并行，但它们本身依赖 schema 扩展完成，实际执行为串行（schema 先行，pack YAML 后写）。[P] 标记保留用于 subagent 调度隔离上下文，不代表无依赖并行。P4-Services 内部多个服务可并行，P4-Routes 依赖服务完成故串行。
