# 验收清单 — 扩展 Pack Schema 以支持 Factorio 集成

> ## 三段交接信息（rules-5 §二）
> - **工程过程**：spec 编写完成，已完成 GN-004 首次审查（阻断 7 项）并修正全部阻断项，待复审。
> - **交接状态**：未闭合（spec 阶段，尚未进入实现）
> - **最终结果**：无（spec 阶段无代码产出）。产出物：spec.md / tasks.md / checklist.md 三件套。

> 本文件为 spec 三件套的闭合判据清单（rubric）。每项必须由可独立验证的证据支撑，不凭执行者自述。
> 标注规则：✅ 已通过 / ⏳ 待验证 / ❌ 未通过 / ⚠️ 警示放行

---

## 一、Spec 自身完整性（Spec/Plan 闸门）

- [ ] 1.1 spec.md 包含三段交接信息（工程过程 / 交接状态 / 最终结果）— 修复 GN-004 B7
- [ ] 1.2 tasks.md 包含三段交接信息 — 修复 GN-004 B7
- [ ] 1.3 checklist.md 包含三段交接信息 — 修复 GN-004 B7
- [ ] 1.4 spec.md 包含 Why / What Changes / Impact / Requirements（ADDED/MODIFIED/REMOVED）/ Subagent 调度台账
- [ ] 1.5 tasks.md 包含任务依赖关系图 + 串并行说明
- [ ] 1.6 checklist.md 覆盖所有 task 的可验证判据
- [ ] 1.7 Subagent 调度台账字段完整：阶段标签 / [P]组 / subagent_type / 预期产物 / actual agent id / 第二落点 / 失败回退点 / 状态
- [ ] 1.8 所有 subagent_type 在 {parallel-sub-agent, general_purpose_task, GN-004} 或显式标注"主线程（非subagent）"
- [ ] 1.9 [P] 并行标记与依赖关系无矛盾（修复 GN-004 W2：Task 1 与 Task 2 标注不可并行）

---

## 二、现状基线对齐（修复 GN-004 B1/B2/B6）

- [ ] 2.1 spec.md 含"现状基线"表，明确列出已存在的表/服务/路由
- [ ] 2.2 mod_records 表标注"不新增，不修改表结构"（已存在）
- [ ] 2.3 save_records 表标注"不新增，不修改表结构"（已存在，注意表名是 save_records 非 save_files）
- [ ] 2.4 player_histories 表标注"不新增，不修改表结构"（已存在，保留会话模型）— 修复 B6
- [ ] 2.5 modService 标注"扩展现有 DB-only 实现"（非新建）
- [ ] 2.6 saveService 标注"扩展现有 DB-only 实现"（非新建）
- [ ] 2.7 routes/mods.ts、routes/saves.ts、routes/player.ts 标注"已存在，不新增"
- [ ] 2.8 所有新路由前缀统一为 `/api/servers/:serverId/` 或 `/api/packs/:packId/` — 修复 B2
- [ ] 2.9 数据库仅新增 chat_logs 1 张表（非 4 张）— 修复 B1

---

## 三、Pack Schema 扩展验证（Task 1）

- [ ] 3.1 `public/schema/pack-schema.ts` 扩展 `InstanceTabSchema` enum 新增 `mods`/`saves`/`config-files`/`world-gen`/`chat-logs`/`player-histories` — 修复 GN-004 B3
- [ ] 3.2 新增 `world_generation` 可选字段（`create_command` + `settings_files: [{ name, path, format, schema: z.record(z.unknown()) }]`）
- [ ] 3.3 新增 `mods` 可选字段（`list_file` / `list_format` 复用 `ConfigFormatSchema` / `dependency_check` / `download_enabled` / `download_source`）— 修复 W3（复用现有 enum，不新增 toml）
- [ ] 3.4 新增 `saves` 可选字段（`dir` / `extension` / `create_command` / `activate_command`）
- [ ] 3.5 新增 `config_files` 可选字段（`name` / `path` / `format` 复用 `ConfigFormatSchema` / `schema: z.record(z.unknown())` / `read_only`）— 修复 W4（明确 Zod 类型）
- [ ] 3.6 原 `config` 字段从 required 改为 `optional()`（deprecated，保留兼容，不删除）— 修复 B5
- [ ] 3.7 新增 `update` 可选字段（`source_url` / `current_version_command` / `download_dir` / `install_command`）
- [ ] 3.8 新增 `chat_log` 可选字段（`pattern` / `storage_enabled` / `retention_days` 默认 30）
- [ ] 3.9 `event_parsers` 结构不变（保留现有 `{ chat?, join?, leave? }` 固定字段）— 修复 B4
- [ ] 3.10 `cd panel/backend && npx tsc --noEmit` 0 错误
- [ ] 3.11 `cd panel/frontend && npx tsc --noEmit` 0 错误
- [ ] 3.12 ⚠️ public/ 修改已获人类显式授权（AskUserQuestion 记录）— 修复 W1

---

## 四、Factorio Pack YAML 验证（Task 2）

- [ ] 4.1 `packs/factorio-vanilla/pack.yaml` 文件存在
- [ ] 4.2 `pack` 字段完整（id=factorio-vanilla / game=factorio / variant=vanilla / display_name / version）
- [ ] 4.3 `startup.binary: ./factorio`，args 包含 `--start-server` / `--server-settings` / `--rcon-port`
- [ ] 4.4 `protocol.type: rcon`，`default_port: 27015`
- [ ] 4.5 `commands` 包含 broadcast / give_item / kick / ban / say / whitelist_add / whitelist_remove
- [ ] 4.6 `world_generation.create_command` 调用 `--create-map`，`settings_files` 声明 map-gen-settings.json 和 map-settings.json
- [ ] 4.7 `mods.list_file` 指向 mod-list.json，`download_source` 指向 Factorio mod portal
- [ ] 4.8 `saves.dir` / `extension: .zip` / `create_command` / `activate_command` 配置
- [ ] 4.9 `config_files` 声明 server-settings.json，含完整字段 schema
- [ ] 4.10 `update.source_url` 指向 Factorio 官方版本 API
- [ ] 4.11 `chat_log.pattern` 匹配 Factorio `[CHAT]` 行，`storage_enabled: true`，`retention_days: 30`
- [ ] 4.12 `event_parsers` 填充现有 `chat`/`join`/`leave` 字段（不新增 type）
- [ ] 4.13 `business` 配置 shop / cdk / players / lists / chat_enhancement
- [ ] 4.14 `ui.tabs` 使用扩展后 enum 值（console/players/mods/saves/config-files/world-gen/chat-logs/monitor/shop-admin）
- [ ] 4.15 `backup` 配置 world_dir + pre/post_backup_commands
- [ ] 4.16 `versions` 配置 source / type=binary / eula_required=false
- [ ] 4.17 `items.static_list` 包含 Factorio 常见物品
- [ ] 4.18 **不配置** `config` 字段（config 已 optional）
- [ ] 4.19 Pack YAML 通过 Zod schema 校验（`PackLoader.loadPackFile` 无异常）

---

## 五、数据库迁移验证（Task 3，仅 1 张新表）

- [ ] 5.1 `panel/backend/src/db/migrations/20260715100000_create_chat_logs.ts` 存在
- [ ] 5.2 `chat_logs` 表字段：id / server_id / player_name / message / sent_at / created_at
- [ ] 5.3 `chat_logs` INDEX(server_id, sent_at)
- [ ] 5.4 迁移脚本幂等设计（`if (!(await knex.schema.hasTable('chat_logs')))` 守卫）
- [ ] 5.5 `knex migrate:latest` 成功执行，chat_logs 表实际创建
- [ ] 5.6 现有 mod_records / save_records / player_histories 表未受影响（无重复创建迁移脚本）

---

## 六、后端服务验证（Task 4-10）

### worldGenService（Task 4，新建）
- [ ] 6.1 `panel/backend/src/services/worldGenService.ts` 存在
- [ ] 6.2 `regenerateMap(serverId)` 读取 Pack `world_generation.create_command`，替换变量后通过 daemonClient 执行
- [ ] 6.3 `getMapSettingsSchema(serverId)` 返回 settings_files 的 JSON Schema
- [ ] 6.4 `updateMapSettings(serverId, settingsName, data)` 写入对应 settings 文件

### modService（Task 5，扩展现有）
- [ ] 6.5 现有 `modService.ts` 增加 `readModListFile(serverId)` 读取 Pack mods.list_file
- [ ] 6.6 增加 `writeModListFile(serverId, mods)` 写入文件
- [ ] 6.7 `create` 方法同步写文件 + 写 mod_records 表（现有 DB 记录保留）
- [ ] 6.8 `delete` 方法同步删文件 + 删 mod_records
- [ ] 6.9 增加 `toggleMod(serverId, modName, enabled)` 启停 mod
- [ ] 6.10 增加 `checkDependencies(serverId)` 在 dependency_check=true 时返回冲突列表
- [ ] 6.11 增加 `downloadMod(serverId, modName)` 在 download_enabled=true 时从 download_source 下载

### saveService（Task 6，扩展现有）
- [ ] 6.12 现有 `saveService.ts` 增加 `createSaveViaPack(serverId)` 调用 Pack saves.create_command + 写 save_records
- [ ] 6.13 增加 `activateSaveViaPack(serverId, saveId)` 调用 activate_command + 更新 is_active
- [ ] 6.14 增加 `deleteSaveFile(serverId, saveId)` 删文件 + 删记录
- [ ] 6.15 现有方法在 Pack 声明 saves 字段时调用 Pack 命令，否则回退 DB-only 行为

### configFileService（Task 7，新建）
- [ ] 6.16 `panel/backend/src/services/configFileService.ts` 存在
- [ ] 6.17 `readConfigFile(serverId, configName)` 按 path 读取 + 按 format 解析
- [ ] 6.18 `writeConfigFile(serverId, configName, data)` 校验 schema + 按 format 序列化写入
- [ ] 6.19 `getConfigFileSchema(serverId, configName)` 返回 schema 供前端渲染
- [ ] 6.20 `read_only=true` 时 `writeConfigFile` 抛 403

### updateService（Task 8，新建）
- [ ] 6.21 `panel/backend/src/services/updateService.ts` 存在
- [ ] 6.22 `checkUpdate(packId)` 请求 source_url 比对版本
- [ ] 6.23 `applyUpdate(packId)` 下载 + 执行 install_command

### chatLogService（Task 9，新建）
- [ ] 6.24 `panel/backend/src/services/chatLogService.ts` 存在
- [ ] 6.25 `parseAndStore(serverId, line)` 按 chat_log.pattern 匹配后写 chat_logs
- [ ] 6.26 `listLogs(serverId, filters)` 分页查询
- [ ] 6.27 定时清理超过 retention_days 的记录
- [ ] 6.28 与现有 chatService 边界明确：chatService 管理 chat_settings/chat_triggers；chatLogService 解析 stdout 并持久化 — 修复 W5

### playerHistoryService（Task 10，扩展或新建）
- [ ] 6.29 通过 Glob 确认 services 目录下是否已有 playerHistoryService
- [ ] 6.30 若已存在则扩展：event_parsers.join/leave 解析后更新 player_histories（会话模型）
- [ ] 6.31 若不存在则新建，实现 `recordJoin`/`recordLeave`/`listHistories`
- [ ] 6.32 eventBus 订阅 player_join/leave 事件自动调用 recordJoin/recordLeave

---

## 七、后端路由验证（Task 11，前缀统一 /api/servers/）

- [ ] 7.1 `panel/backend/src/api/routes/configFiles.ts` 实现 GET/PUT /api/servers/:serverId/config-files/:name + GET /schema
- [ ] 7.2 `panel/backend/src/api/routes/worldGen.ts` 实现 POST /api/servers/:serverId/world/regenerate + GET/PUT /api/servers/:serverId/world/map-settings/:settingsName
- [ ] 7.3 `panel/backend/src/api/routes/chatLogs.ts` 实现 GET /api/servers/:serverId/chat-logs
- [ ] 7.4 `panel/backend/src/api/routes/updates.ts` 实现 GET /api/packs/:packId/update/check + POST /apply
- [ ] 7.5 `panel/backend/src/index.ts` 注册所有新路由（app.use，前缀 /api/servers/ 与现有一致）
- [ ] 7.6 **不新增** mods/saves/player-histories 路由（已存在）
- [ ] 7.7 路由鉴权：instance_admin 以上权限写操作，user 可读
- [ ] 7.8 路由错误处理统一走 PanelApiError 格式

---

## 八、前端页面验证（Task 12-16）

### ConfigFileEditor 组件（Task 12）
- [ ] 8.1 `panel/frontend/src/components/ConfigFileEditor.tsx` 存在
- [ ] 8.2 按 format（json/properties/yaml/ini）渲染对应编辑器
- [ ] 8.3 按 schema 动态渲染表单（string/number/boolean/array/object）
- [ ] 8.4 read_only=true 时仅显示不可编辑

### 实例详情子页（Task 13）
- [ ] 8.5 `Mods.tsx` 实现列表 + 添加/删除/启停 + 下载
- [ ] 8.6 `Saves.tsx` 实现列表 + 创建/激活/删除
- [ ] 8.7 `ConfigFiles.tsx` 实现文件列表 + 编辑器
- [ ] 8.8 `WorldGen.tsx` 实现地图设置编辑 + 重新生成按钮
- [ ] 8.9 `PlayerHistories.tsx` 实现时间线
- [ ] 8.10 `ChatLogs.tsx` 实现日志查看 + 搜索

### Tab 动态化（Task 14）
- [ ] 8.11 InstanceDetail 读取 Pack ui.tabs 动态渲染
- [ ] 8.12 Factorio Pack 显示对应 tab
- [ ] 8.13 Minecraft Pack 显示对应 tab
- [ ] 8.14 未声明能力的 Pack 不显示对应 tab

### Pack 管理扩展（Task 15）
- [ ] 8.15 `Packs.tsx` 显示版本信息 + 检查更新按钮
- [ ] 8.16 应用更新流程含确认对话框 + 进度提示

### API client 扩展（Task 16）
- [ ] 8.17 `client.ts` 新增 configFiles/worldGen/updates/chatLogs 方法（saves/mods/playerHistories 已存在）
- [ ] 8.18 snakeToCamel 覆盖新增 API 响应

---

## 九、Minecraft Pack 补字段验证（Task 17）

- [ ] 9.1 新增 `config_files`（server.properties，format=properties，read_only=false）
- [ ] 9.2 新增 `saves`（dir=world，extension=.dat）
- [ ] 9.3 新增 `chat_log`（pattern 匹配 Minecraft `[Server thread/INFO]` 行）
- [ ] 9.4 填充 `event_parsers`（现有 chat/join/leave 字段，不新增 type）
- [ ] 9.5 原 `config` 字段保留（deprecated，兼容期，不删除）
- [ ] 9.6 Minecraft Pack YAML 通过扩展后 schema 校验

---

## 十、编译与运行时验证（Task 18-22）

### 编译验证（Task 18-19）
- [ ] 10.1 `cd panel/backend && npm run typecheck` 通过
- [ ] 10.2 `cd panel/backend && npm run build` 通过
- [ ] 10.3 `cd panel/frontend && npm run typecheck` 通过
- [ ] 10.4 `cd panel/frontend && npm run build` 通过

### 数据库迁移验证（Task 20）
- [ ] 10.5 `knex migrate:latest` 成功
- [ ] 10.6 chat_logs 表结构正确（字段 + 索引）
- [ ] 10.7 现有 mod_records/save_records/player_histories 表未受影响

### Pack 加载验证（Task 21）
- [ ] 10.8 Factorio Pack YAML 通过 schema 校验（PackLoader 无异常）
- [ ] 10.9 Minecraft Pack YAML（扩展后）通过 schema 校验
- [ ] 10.10 `GET /api/packs` 返回两个 Pack
- [ ] 10.11 `POST /api/packs/reload` 成功重新加载

### 端到端功能验证（Task 22）
- [ ] 10.12 创建 Factorio 实例，详情页显示对应 tab
- [ ] 10.13 Mod 子页可添加/删除/启停 mod（更新 mod-list.json + mod_records 表）
- [ ] 10.14 存档子页可创建/激活/删除存档（调用 Pack 命令 + save_records 表）
- [ ] 10.15 配置文件子页可编辑 server-settings.json
- [ ] 10.16 世界生成子页可触发重新生成地图
- [ ] 10.17 聊天日志子页显示实时聊天记录
- [ ] 10.18 玩家历史子页显示上下线记录
- [ ] 10.19 Pack 管理页可检查 Factorio 版本更新
- [ ] 10.20 创建 Minecraft 实例，详情页按 Pack 显示对应 tab
- [ ] 10.21 Minecraft 实例 config_files 编辑器可读写 server.properties

---

## 十一、契约可验证性要求（rules-3 §五）

- [ ] 11.1 Pack schema 扩展附带 Zod 自检测试（pack-schema.test.ts）
- [ ] 11.2 测试套件覆盖：6 个新字段校验用例 + InstanceTabSchema 新 enum 值用例
- [ ] 11.3 测试套件覆盖：config_files read_only 抛错用例
- [ ] 11.4 测试套件覆盖：config 改 optional 后 Minecraft Pack 仍通过校验（向后兼容）
- [ ] 11.5 LLM 在 schema 产出后自主运行测试套件，结果记录于 note
- [ ] 11.6 rubric 全部通过方视为契约有效（本清单全部 ✅）

---

## 十二、合规与规则对齐

- [ ] 12.1 public/ 修改（pack-schema.ts）已获人类显式授权（rules-0 §四-10）— 修复 W1
- [ ] 12.2 pack-schema.ts 为扩展性修改（新增 optional 字段 + 扩展 enum + config 改 optional），不删除现有字段
- [ ] 12.3 模块间不直接导入内部实现，仅依赖 public/ 契约
- [ ] 12.4 数据库迁移幂等，支持热更新前置处理（rules 1.md）
- [ ] 12.5 前后端分离，前端通过 /api/* 调用后端（rules 1.md）
- [ ] 12.6 所有数据读写通过 Zod 校验（rules-3 §一）
- [ ] 12.7 接口签名匹配 TypeScript 契约（等价 .pyi 约束）
- [ ] 12.8 配置契约含默认值，加载时自动补充（rules-3 §三，如 retention_days 默认 30）
- [ ] 12.9 Subagent 调度台账 actual agent id 在 subagent 拉起后回填真实 ID
- [ ] 12.10 config 字段必填性反转（required→optional）触发 rules-3 §六 MAJOR 版本变更：更新 pack-schema.ts @version 注释或新建 public/schema/CHANGELOG.md，记录版本号/变更内容/变更原因/影响范围

---

## 闭合判据

- 全部 ✅ → 契约有效，可交付
- 任一 ❌ → 阻断，不得交付
- ⚠️ 警示放行项 → 须由人类显式确认后标注，并记录于 note

## 验收流程

1. 每个 task 完成后，执行者勾选对应 checklist 项并附证据（文件路径 / 测试输出 / 截图）
2. 阶段收束时 GN-004 独立审查勾选项，验证证据真实性
3. 交付前 GN-004 逐项复核，全部 ✅ 方可宣告完成

## GN-004 首次审查阻断项修正对照

| 阻断项 | 修正措施 | 验证位置 |
|--------|---------|---------|
| B1 spec 与现状脱节 | spec 新增"现状基线"表，区分新增 vs 扩展 | §二 |
| B2 路由前缀不一致 | 统一 /api/servers/:serverId/ 前缀 | §二、§七 |
| B3 InstanceTabSchema 遗漏 | Task 1.0 扩展 enum | §三 3.1 |
| B4 event_parsers 结构歧义 | 保留现有 {chat,join,leave} 结构 | §三 3.9 |
| B5 config vs config_files 矛盾 | config 改 optional，不删除，不设移除时间 | §三 3.6 |
| B6 player_histories 迁移策略 | 保留现有表结构，不新增/修改 | §二 2.4、§五 5.6 |
| B7 缺三段交接信息 | 三件套首部追加 | §一 1.1-1.3 |
| W1 public/ 未授权 | Task 1.9 + checklist 12.1 | §三 3.12、§十二 12.1 |
| W2 [P] 与依赖矛盾 | 串并行说明明确标注 | §一 1.9、tasks.md 末尾 |
| W3 format enum 不一致 | 复用现有 ConfigFormatSchema | §三 3.3 |
| W4 schema 字段类型模糊 | 明确 z.record(z.unknown()) | §三 3.5 |
| W5 chatLogService 边界 | 明确与 chatService 分工 | §六 6.28 |
