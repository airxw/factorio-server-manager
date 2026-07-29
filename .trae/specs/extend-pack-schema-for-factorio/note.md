# Note — extend-pack-schema-for-factorio

> ## 三段交接信息（rules-5 §二）
> - **工程过程**：
>   - Task 1/2/3/17 已闭合（schema 扩展 + Factorio Pack YAML + chat_logs 迁移 + Minecraft Pack 补字段）
>   - Task 3.5 已闭合（Daemon 扩展 execCommand/readFile/writeFile + Panel daemonClient 对接）
>   - Task 4-11 已闭合（6 个后端服务 + 4 个新路由 + index.ts 服务注册 + eventBus 集成）
>   - Task 12-16 已闭合（前端 ConfigFileEditor 组件 + 7 个 instance-detail 子页 + ServerDetail Tab 动态化 + admin/Packs 扩展 + API client 扩展）
>   - Task 18-19 已闭合（前后端 typecheck + build 通过）
>   - Task 20 已闭合（数据库迁移验证：chat_logs 表 + 索引 + 现有表未受影响）
>   - Task 21 已闭合（Pack 加载验证：Factorio + Minecraft 通过 schema 校验 + reload 通过；Minecraft Pack YAML ui.tabs 已对齐 ServerDetail TAB_LABELS 命名）
>   - **第三轮扩展（2026-07-15）已闭合**：5 游戏支持 + 端口贴近实际 + 商城自动初始化 + 绑定不要求运行
>     - Minecraft Pack 扩展：mods 字段 + 30 物品 + default_game_port:25565
>     - 新增 Palworld Pack：32 物品 + game_port=8211 + rcon=25575
>     - 新增 ARK Pack：35 物品 + game_port=7777 + rcon=27020
>     - 新增 Rust Pack：44 物品 + game_port=28015 + webrcon=28016
>     - pack-schema.ts：GameType 增加 'palworld'；PackItemSchema 正则允许点号（Rust 物品 shortname 用点）
>     - servers.ts：端口分配按 Pack.startup.default_game_port + Pack.protocol.default_port；实例创建后自动初始化 shop_items
>     - instanceBindingService.ts：bindInstance 加 server 存在性校验（不要求 running）
> - **交接状态**：已闭合（Task 22 端到端 smoke test 已通过：5 Pack 加载 + 3 新实例创建 + 商城物品初始化 + 停止状态实例绑定成功）
> - **最终结果**：
>   - 后端：新增 6 服务（worldGen/configFile/update/chatLog 等）+ 4 路由 + eventBus 集成 + index.ts 注册
>   - 前端：ServerDetail Tab 动态化（按 Pack.ui_tabs 渲染 9 类 tab）+ admin/Packs 完整列表页 + 7 个 instance-detail 子页
>   - 数据库：chat_logs 表已迁移（6 字段 + 复合索引）
>   - 编译验证：前后端 typecheck + build 全部通过
>   - **5 Pack 全部通过 schema 校验**：ark-vanilla(35 物品/7 tabs) + factorio-vanilla(32 物品/9 tabs) + minecraft-vanilla(30 物品/7 tabs) + palworld-vanilla(32 物品/7 tabs) + rust-vanilla(44 物品/7 tabs)
>   - **端口分配**：每个 Pack 按各自 default_game_port 贴近实际游戏端口（Palworld 8211段 / ARK 7777段 / Rust 28015段 / Factorio 34197段 / Minecraft 25565段）
>   - **商城物品初始化**：Demo-palworld=32 物品 / Demo-ark=35 物品 / Demo-rust=44 物品
>   - **停止状态实例绑定**：Palworld 实例 status=stopped 时 bindInstance 成功（满足"绑定不要求实例运行"需求）
>
> - **第四轮扩展（2026-07-15 端到端链路跑通）已闭合**：
>   - 缺失环节识别 + 修复：4 个关键 gap（bootstrap 缺失 / 模板变量不全 / processQueue 未调度 / item 正则不允许点号）
>   - 新增 daemon/src/instances/bootstrap.ts：Minecraft 下载 server.jar + eula.txt + server.properties；其他游戏 stub
>   - 修改 daemon/src/instances/manager.ts：startInstance 在 spawn 前调用 bootstrapInstance + 补全 9 个模板变量（game_port/rcon_port/rcon_password/save_path/config_dir/server_name/server_hostname/server_identity/max_players）
>   - 修改 panel/backend/src/services/commandDispatcher.ts：VARIABLE_PATTERNS.item 正则添加点号（Rust 物品 shortname 用点）
>   - 修改 panel/backend/src/services/scheduler.ts + index.ts：新增 COMMAND_QUEUE_PROCESS 任务类型（每 5s 调用 commandDispatcher.processQueue）
>   - 修改 public/interface_stub/shared-types.d.ts：SchedulerTaskType 联合类型新增 'COMMAND_QUEUE_PROCESS'（经用户授权的 MINOR 级契约扩展）
> - **交接状态**：已闭合（端到端链路验证通过）
> - **最终结果**：
>   - **Bootstrap 验证**：Minecraft 实例启动触发 bootstrap → 从 Mojang 下载 server.jar (60.8MB) → 写 eula.txt + server.properties（含正确的 server-port=26410 / rcon.port=26054 / rcon.password）
>   - **命令队列链路验证**：shopService.claimOrder → commandDispatcher.renderCommand + enqueue → command_queue 表 → scheduler (5s) → processQueue → daemonClient → daemon HTTP API
>   - **错误信息升级验证**：未启动实例 → "Instance not found"；已启动但 spawn 失败（java ENOENT）→ "Instance not running"（证明实例已注册到 managed map）
>   - **重试机制验证**：attempts 从 0 累加到 3 (MAX_ATTEMPTS) 后标记 failed
>   - **正则验证**：metal.fragments / sulfur.ore / iron-ingot / diamond 全部通过；bad@item / has space 被拒绝
>   - **未跑通部分**：实际 Minecraft 服务器未运行（本机未安装 Java，用户选择跳过 Java 安装）；如安装 JRE 21，server.jar 可正常启动，RCON 通道建立后命令可真正下发到游戏内
>   - 编译验证：daemon + panel/backend typecheck + build 全部通过

## 阅读记录

### 2026-07-15 阅读现有架构

- `panel/backend/src/index.ts` — 服务初始化模式（工厂函数 + app.locals 挂载）
- `panel/backend/src/core/packs/registry.ts` — PackRegistry 接口
- `panel/backend/src/services/errors.ts` — AppError 错误体系
- `panel/backend/src/services/modService.ts` — DB-only 实现（CRUD mod_records，不读写文件）
- `panel/backend/src/services/saveService.ts` — DB-only 实现（CRUD save_records，不调用 Pack 命令）
- `panel/backend/src/services/daemonClientService.ts` — 适配 DaemonHttpClient，仅 startInstance/stopInstance/sendCommand/getInstanceState
- `panel/backend/src/services/commandDispatcher.ts` — renderCommand 纯函数 + 队列
- `panel/backend/src/daemonClient/client.ts` — DaemonHttpClient：getHealth/listInstances/getInstanceState/startInstance/stopInstance/sendCommand
- `daemon/src/server.ts` — Daemon Express 服务端，路由仅 instances CRUD + command
- `daemon/src/instances/processDriver.ts` — child_process.spawn 启动游戏进程
- Glob `panel/backend/src/services/*.ts` 确认 **playerHistoryService 不存在**（playerService 是玩家列表管理，非历史）

## 诊断草稿

### 2026-07-15 架构分叉识别

**问题**：Task 4-10 的服务需要以下能力，但当前 Daemon 不支持：
1. `worldGenService.regenerateMap` — 执行 `factorio --create` 离线生成地图（二进制命令）
2. `modService.readModListFile/writeModListFile` — 读写 mod-list.json 文件
3. `saveService.createSaveViaPack` — 执行存档创建命令
4. `configFileService.readConfigFile/writeConfigFile` — 读写配置文件
5. `updateService.applyUpdate` — 下载 + 执行安装命令

**Spec 中的含糊点**：spec.md 写"通过 daemonClient 执行"，但 daemonClient 当前只有 sendCommand（RCON）。

**用户裁决（2026-07-15）**：选择"扩展 Daemon（推荐）"
- 在 Daemon 新增 POST /api/instances/:id/exec 端点（执行任意命令）
- 在 Daemon 新增 GET/PUT /api/instances/:id/files 端点（文件读写）
- Panel→Daemon 通过 daemonClient 调用

**理由**：架构完整，支持多节点部署，符合 spec 原意。

### 2026-07-15 影响范围分析

**新增任务 Task 3.5（Daemon 扩展）**：
- `daemon/src/server.ts` — 新增 /exec 和 /files 路由
- `daemon/src/files/fileManager.ts`（新文件）— 文件读写实现，限制在 instance.workdir 内
- `daemon/src/instances/commandRunner.ts`（新文件）— 命令执行实现，限制 binary 在 Pack 声明范围内
- `panel/backend/src/daemonClient/client.ts` — 新增 execCommand / readFile / writeFile 方法
- `panel/backend/src/services/daemonClientService.ts` — 新增接口方法
- `public/schema/daemon-api-types.ts` — 新增 ExecCommandRequest/Response、FileReadResponse、FileWriteRequest 类型
- `public/interface_stub/daemon-rest.ts` — 扩展 IDaemonRestApi 接口签名

**安全考虑**：
- /exec 端点必须限制可执行的 binary 范围（Pack.startup.binary 或 Pack 中显式声明的命令）
- /files 端点必须限制 path 在 instance.workdir 内（防路径穿越）
- 鉴权：复用现有 Bearer Token 中间件
- 实例必须存在（但 /exec 不要求实例 running，因为 --create 是离线命令）

### 2026-07-14（续）Task 12-21 实施记录

**Task 12-13**：通过 2 个 frontend-architect subagent 并行创建 ConfigFileEditor 组件 + 7 个 instance-detail 子页（ConfigFiles/WorldGen/Mods/Saves/PlayerHistories/ChatLogs + UpdateCheck）
- P0 简化：ConfigFileEditor 用 textarea 渲染 JSON 文本，未实现复杂表单生成
- 契约差异发现：SaveRecordSummary 实际用 size_bytes/modified_at（非 file_size/updated_at），subagent 用占位默认值处理

**Task 14**：ServerDetail.tsx Tab 动态化改造
- 添加 uiTabs state + listPacks 匹配 server.pack_id 获取 ui_tabs
- BASE_TABS = ['console', 'shop-admin'] 始终展示
- tabs 数组 = BASE_TABS + Pack.ui_tabs 去重
- TAB_LABELS 定义 8 类 tab：console/shop-admin/mods/saves/config-files/world-gen/chat-logs/players/update
- activeTab 失效时回落到 console

**Task 15**：admin/Packs.tsx 扩展为完整列表页（显示 Pack 信息 + 重载按钮 + UI Tabs 展示）+ UpdateCheck.tsx 子页实现版本检查与应用
- P0 设计决策：updateService.checkUpdate/applyUpdate 签名为 serverId 级别（需具体实例定位 node_id 执行 current_version_command），故版本检查功能由实例详情页 update tab 承载，admin/Packs.tsx 仅展示 Pack 自身的 version 字段

**Task 18-19**：前后端 typecheck + build 全部通过（前端 vite build 360.19 kB JS / 12.91 kB CSS）

**Task 20**：数据库迁移验证
- knex CLI 在 tsx 项目下不兼容（ts-node/register 加载失败），改用 db.migrate.latest() programmatic API 通过 tsx 运行验证脚本通过
- chat_logs 表结构验证：6 字段（id/server_id/player_name/message/sent_at/created_at）+ idx_chat_logs_server_sent_at 复合索引
- 现有 mod_records/save_records/player_histories 表字段未受影响

**Task 21**：Pack 加载验证
- Factorio Pack YAML v1.0 通过 schema 校验，ui.tabs 9 个全部匹配 TAB_LABELS
- Minecraft Pack YAML v1.0 通过 schema 校验，原 ui.tabs 用 'config'/'backups'/'logs' 命名与 ServerDetail TAB_LABELS 不匹配
- 用户裁决（2026-07-14）：修改 Minecraft Pack YAML 对齐命名（config→config-files、backups→saves、logs→chat-logs，移除未实现的 monitor tab）
- 修改后重新验证通过

## 审查记录

（待 GN-004 交付前审查）

## 终态处理

- Task 1-21 已全部闭合，可执行文件均已落地
- Task 22 端到端验证由用户手动测试，待用户启动 demo 后逐项勾选
- public/schema/panel-api-types.ts 已扩展（PackSummary.ui_tabs + Task 11 API 类型），所有修改已经用户授权

## 未闭合项

- Task 22 端到端功能验证（11 项子任务）：待用户启动 demo 后手动验收
  - 需要：Panel 后端 + Panel 前端 + Daemon + 真实游戏二进制（Factorio/Minecraft）
  - LLM 无法自主执行（无游戏二进制 + 无运行时环境）
- GN-004 交付前审查（待主线程拉起）

## 接续入口

1. 用户启动 demo：先关闭现有部署（rules 1.md），启动 Panel + Daemon，按 Task 22 验收清单逐项测试
2. 验收通过后拉起 GN-004 交付前审查（subagent_type='GN-004'），审查 spec 三件套 + note + .trae/documents/ 完整性
3. 审查通过后宣告 spec 闭合
