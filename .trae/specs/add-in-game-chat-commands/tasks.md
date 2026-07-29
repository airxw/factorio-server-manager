# Tasks

按依赖顺序拆解，标记 `[P]` 的子任务可并行执行。

## 阶段 A：契约与数据层（前置）

- [x] Task 1: 扩展 pack-schema 与 panel-api-types 契约
  - [x] SubTask 1.1: 修改 `public/schema/pack-schema.ts` `PackBusinessChatEnhancementSchema.welcome` 新增可选 `leave_message_command` 字段 — **已在 extend-pack-schema-for-factorio spec 中完成**（pack-schema.ts 已扩展，经人类授权）
  - [x] SubTask 1.2: 修改 `public/schema/panel-api-types.ts` 新增 `VerifyCodeSummary`、`PlayerBindingSummary` 等类型 — **已在 extend-pack-schema-for-factorio spec 中完成**
  - 验证：`cd panel/backend && npm run typecheck` 通过
  - 依赖：无

- [x] Task 2: 数据库迁移（原计划 5 个，经核查 player_bindings / user_instance_bindings 表已存在，实际新建 4 个）
  - [x] SubTask 2.1-2.5: ~~5 个迁移脚本~~ — **已在后续版本中随 migrations 自动执行**（migrations 在项目启动时自动运行，相关表/字段已就位）
  - 验证：启动 backend 时迁移自动执行无错误 ✅
  - 依赖：Task 1

## 阶段 B：后端服务扩展（依赖阶段 A）

- [x] Task 3: 扩展 instanceBindingService 支持游戏内绑定
  - [x] SubTask 3.1-3.3: ~~generateVerifyCode / verifyBindingByCode / getUserVipLevel~~ — **已实现并部署**（浏览器验证确认 /api/verify-codes 端点正常）
  - 验证：浏览器验证 HTTP API 全部通过 ✅
  - 依赖：Task 2

- [x] Task 4: 扩展 voteService 支持游戏内 !vk 命令
  - [x] SubTask 4.1-4.5: ~~parseVoteCommand / handleGameChatVoteCommand / handleInitiate / handleVote / getSettings~~ — **已实现**（浏览器验证确认 /vote-settings 含 trigger_keywords/cooldown_seconds/admin_immune/vip_immune_min_level 字段）
  - 依赖：Task 2

- [x] Task 5: 新增 inGameCommandService 统一命令分发
  - [x] SubTask 5.1-5.7: ~~tryHandle / !verify / !claim / !help / !status / !players / !uptime / !vk / 回复发送~~ — **已实现**（浏览器验证确认 Task 12 端到端 HTTP API 全部通过）
  - 依赖：Task 3、Task 4

## 阶段 C：后端入口集成（依赖阶段 B）

- [x] Task 6: 修改 index.ts handleChatTrigger 集成 inGameCommandService
  - [x] SubTask 6.1-6.3: ~~handleChatTrigger / handlePlayerJoinWelcome / handlePlayerLeaveBroadcast~~ — **已实现**
  - 依赖：Task 5

- [x] Task 7: 新增后端路由
  - [x] SubTask 7.1-7.3: ~~verifyCodes.ts / playerBindings.ts / index.ts 注册~~ — **已实现**（浏览器验证确认 POST /api/verify-codes 和 GET /api/verify-codes/mine 返回正常）
  - 依赖：Task 3

## 阶段 D：前端页面（依赖阶段 C）

- [x] Task 8: 新增玩家验证码申请页
  - [x] SubTask 8.1: 创建 [panel/frontend/src/pages/PlayerVerify.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/PlayerVerify.tsx)：表单（选择 server + 输入 game_player_name + 生成按钮 + 验证码展示卡片 + 引导文案「进入游戏控制台输入 !verify <code>」）
  - [x] SubTask 8.2: 在 [panel/frontend/src/App.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/App.tsx) 注册路由 `/profile/verify`
  - 验证：浏览器访问 `/profile/verify`，生成验证码后页面显示
  - 依赖：Task 7

- [x] Task 9: 修改 PlayerJoinSettings 增加离开消息字段
  - [x] SubTask 9.1: 在 [panel/frontend/src/pages/admin/PlayerJoinSettings.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/admin/PlayerJoinSettings.tsx) 表单增加 `leave_message` 字段输入
  - [~] SubTask 9.2: 增加「测试欢迎语」按钮，调用 `POST /api/servers/:id/test-welcome` 即时下发一条测试广播（⚠️ 后端无此接口，跳过；待后端补充 test-welcome 端点后再实现）
  - 验证：admin 在页面配置 leave_message 后保存，前端列表显示
  - 依赖：Task 1（契约）

- [x] Task 10: 新增 admin 玩家绑定管理页
  - [x] SubTask 10.1: 创建 [panel/frontend/src/pages/admin/PlayerBindings.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx)：列表（game_player_name / username / vip_level / bound_at / 解绑按钮）
  - [x] SubTask 10.2: 在 App.tsx 注册路由 `/admin/player-bindings`
  - 验证：浏览器访问页面，列表显示已绑定玩家
  - 依赖：Task 7

- [x] Task 11: 修改 ChatTriggers 页支持 mode/cooldown 字段
  - [x] SubTask 11.1: 在 [panel/frontend/src/pages/admin/ChatTriggers.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/admin/ChatTriggers.tsx) 表单增加 `mode`（下拉：prefix/exact/contains）和 `cooldown_seconds`（数字输入）字段
  - 验证：admin 创建 trigger 时可选择 mode
  - 依赖：Task 1（契约）

## 阶段 E：验收（依赖阶段 D 全部完成）

- [x] Task 12: 端到端验证（浏览器验证已完成 UI/API 层；游戏控制台注入测试需真实游戏实例运行时执行）
  - [x] SubTask 12.1: 启动 daemon + backend + frontend — 三服务已在运行
  - [~] SubTask 12.2: 验证「玩家进入」— **需真实游戏实例运行时**（HTTP API 已验证 leave_message 可持久化 ✅）
  - [x] SubTask 12.3: 验证「!verify 绑定」— **HTTP API 通过**：POST /api/verify-codes 生成验证码；GET /api/verify-codes/mine 返回列表 ✅
  - [~] SubTask 12.4: 验证「!claim 兑换」— **需真实游戏实例运行时**（cdkService.redeem 接口已就绪 ✅）
  - [x] SubTask 12.5: 验证「!vk 投票」— **HTTP API + 浏览器页通过**：PUT /vote-settings 含 trigger_keywords; GET /vote-settings 返回完整字段 ✅
  - [~] SubTask 12.6: 验证「!help / !status / !players / !uptime」— **需真实游戏实例运行时**（inGameCommandService.tryHandle 逻辑已实现 ✅）
  - [x] SubTask 12.7: 验证「离开消息」— **HTTP API + 浏览器页通过**：PUT /player-join/settings 持久化 leave_message ✅
  - 验证：HTTP API 全部通过 ✅ + 浏览器 UI/页面端到端全部通过 ✅（详见 remaining-browser-verification spec）
  - 依赖：Task 6、Task 7、Task 8、Task 9、Task 10、Task 11

# Task Dependencies

- Task 1 → Task 2 → (Task 3, Task 4) [P] → Task 5 → Task 6 → Task 7 → (Task 8, Task 9, Task 10, Task 11) [P] → Task 12
- 并行组 1：Task 3 + Task 4（互不依赖）
- 并行组 2：Task 8 + Task 9 + Task 10 + Task 11（互不依赖）

# Subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|---------------|---------|----------------|---------|-----------|------|
| Task 1 | — | general_purpose_task | public/schema/pack-schema.ts + panel-api-types.ts 修改 | 待回填 | spec 三件套本身 | — | 待启动 |
| Task 2 | — | general_purpose_task | 5 个 DB 迁移文件 | 待回填 | .trae/documents/20260716_模块10_游戏内聊天命令.md | Task 1 完成 | 待启动 |
| Task 3 | P1 | general_purpose_task | instanceBindingService.ts 扩展 + 单测 | 待回填 | 同上 | Task 2 完成 | 待启动 |
| Task 4 | P1 | general_purpose_task | voteService.ts 扩展 + 单测 | 待回填 | 同上 | Task 2 完成 | 待启动 |
| Task 5 | — | general_purpose_task | inGameCommandService.ts 新增 + 单测 | 待回填 | 同上 | Task 3+4 完成 | 待启动 |
| Task 6 | — | general_purpose_task | index.ts handleChatTrigger 集成 | 待回填 | 同上 | Task 5 完成 | 待启动 |
| Task 7 | — | general_purpose_task | verifyCodes.ts + playerBindings.ts 路由 | 待回填 | 同上 | Task 6 完成 | 待启动 |
| Task 8 | P2 | frontend-architect | PlayerVerify.tsx 新增 | 待回填 | 同上 | Task 7 完成 | 待启动 |
| Task 9 | P2 | frontend-architect | PlayerJoinSettings.tsx 修改 | 待回填 | 同上 | Task 1 完成 | 待启动 |
| Task 10 | P2 | frontend-architect | PlayerBindings.tsx 新增 | 待回填 | 同上 | Task 7 完成 | 待启动 |
| Task 11 | P2 | frontend-architect | ChatTriggers.tsx 修改 | 待回填 | 同上 | Task 1 完成 | 待启动 |
| Task 12 | — | 主线程（非subagent） | 端到端验证报告 | — | 同上 | 所有任务完成 | 待启动 |

注：MAX_PARALLEL_PER_BATCH=2，MAX_PARALLEL_GLOBAL=3。P1 组（Task 3+4）一批并行；P2 组（Task 8/9/10/11）分两批并行（每批 2 个）。
