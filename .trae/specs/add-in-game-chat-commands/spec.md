# 游戏内聊天命令交互能力补齐 Spec

## Why

用户当前对比 `d:\代码\factorio` 参考项目后发现 gameserver-panel 缺失大量"玩家在游戏内通过聊天命令完成"的能力：

- 玩家绑定只能在 web 完成，**无法在游戏控制台 `!verify <验证码>` 完成绑定**
- CDK 兑换只能在 web 完成，**无法在游戏内 `!claim <code>` 兑换**
- 投票踢人只能由 web API 触发，**玩家无法在游戏内 `!vk <玩家名>` / `!vk yes` / `!vk no` 发起或参与投票**
- 缺失 `!help` / `!status` / `!players` / `!uptime` 等游戏内查询命令
- 欢迎词配置入口 `PlayerJoinSettings.tsx` 已存在但**未真正生效**（web 配置表 `player_join_settings` 与 `index.ts handlePlayerJoinWelcome` 脱节，后者读 pack.yaml 而非 DB 配置表）

参考项目 factorio 的实现位于 [d:\代码\factorio\backend\src\services\chatMonitor.ts](file:///d:/代码/factorio/backend/src/services/chatMonitor.ts) 的 `handleAutoReply` 与 [d:\代码\factorio\backend\src\services\voteService.ts](file:///d:/代码/factorio/backend/src/services/voteService.ts) 的 `handleChatMessage`，已在单 pack 场景下验证可用。

## What Changes

### 后端：游戏内聊天命令解析器（新增）

- **新增** [panel/backend/src/services/inGameCommandService.ts](file:///d:/代码/gameserver-panel/panel/backend/src/services/inGameCommandService.ts)：单点统一解析游戏内聊天命令，订阅 `eventBus.CHAT_EVENT`，按命令优先级分发：
  - `!verify <code>` → 调用 `instanceBindingService.verifyBindingByCode(player, code, server_id)` → 回复玩家验证结果
  - `!claim <code>` → 调用 `cdkService.redeem(server_id, { code, player_name: player })` → 回复玩家兑换结果
  - `!help` → 回复可用命令清单
  - `!status` → 调用 `daemonClientService.getStatus(server_id)` → 回复服务器状态
  - `!players` → 调用 `daemonClientService.listPlayers(server_id)` → 回复在线玩家
  - `!uptime` → 计算 `daemonClientService.getServerStatus(server_id).started_at` 至今时间 → 回复
  - 上述内置命令优先级 > 自定义规则匹配，且不走冷却（除 `!help` 走短冷却防刷屏）
- **修改** [panel/backend/src/index.ts](file:///d:/代码/gameserver-panel/panel/backend/src/index.ts)：
  - `handleChatTrigger` 在执行自定义关键词匹配前先调用 `inGameCommandService.tryHandle(server_id, player, message)`，命中内置命令直接 return，不再走 `chat_trigger_responses` 表
  - `handlePlayerJoinWelcome` 改为优先读 `player_join_settings` 表（admin 在 web 配置），仅当 DB 无配置时降级到 `pack.business.chat_enhancement.welcome.first_gift_command`
  - 订阅 `PLAYER_LEAVE` 事件的 `handlePlayerLeaveBroadcast` 也同步改为读 `player_join_settings.leave_message`（新字段）+ pack.commands.broadcast 模板

### 后端：投票踢人游戏内命令触发（扩展）

- **扩展** [panel/backend/src/services/voteService.ts](file:///d:/代码/gameserver-panel/panel/backend/src/services/voteService.ts)：
  - 新增 `handleGameChatVoteCommand(server_id, player, message)` 函数（参考 factorio voteService.parseVoteCommand）
  - 命令格式：`trigger_keywords` 配置（默认 `["!vk"]`），支持 `<kw> <玩家名>` 发起、`<kw> yes` / `<kw> no` 投票
  - 在 `vote_settings` 表新增字段 `trigger_keywords TEXT DEFAULT '["!vk"]'`、`cooldown_seconds INTEGER DEFAULT 60`、`target_cooldown_seconds INTEGER DEFAULT 300`、`admin_immune INTEGER DEFAULT 1`、`vip_immune_min_level INTEGER DEFAULT 0`（DB 迁移）
  - 内置命令解析由 `inGameCommandService` 委托调用，避免重复订阅 eventBus
  - 阈值达成自动 kick 已实现（`VOTE_THRESHOLD_MET` 事件），游戏内命令路径复用现有逻辑

### 后端：游戏内绑定验证码生成（新增）

- **扩展** [panel/backend/src/services/instanceBindingService.ts](file:///d://gameserver-panel/panel/backend/src/services/instanceBindingService.ts)：
  - 新增 `generateVerifyCode(userId, serverId, gamePlayerName)` 函数：生成 6 位验证码，写入 `player_verify_codes` 表（新增），TTL 5 分钟
  - 新增 `verifyBindingByCode(gamePlayerName, code, serverId)` 函数：校验验证码 → 匹配 user → 创建 `player_bindings` 记录（新表：`game_player_name` + `user_id` + `server_id` + `status='verified'` + `vip_level=1`）
  - `getUserVipLevel` 增加路径：通过 `player_bindings.game_player_name` 查找 user_id，再走现有 VIP 逻辑
  - 新增 DB 迁移：`player_verify_codes` 表 + `player_bindings` 表

### 前端：玩家绑定引导页（新增）

- **新增** [panel/frontend/src/pages/PlayerVerify.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/PlayerVerify.tsx)：玩家登录后在 web 查看自己专属的验证码（6 位，5 分钟有效，可刷新），引导玩家进入游戏控制台输入 `!verify <code>`
- **新增** [panel/frontend/src/pages/admin/PlayerBindings.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx)：admin 查看某实例所有已绑定玩家（game_player_name → user → vip_level），可调整 VIP

### 前端：欢迎词配置真正生效（修改）

- **修改** [panel/frontend/src/pages/admin/PlayerJoinSettings.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/admin/PlayerJoinSettings.tsx)：
  - 表单新增 `leave_message` 字段（玩家离开广播消息）
  - 新增「测试欢迎语」按钮，向当前选中 server 下发一条测试欢迎语命令（admin 即时验证配置生效）

### 契约与 Schema

- **修改（不破坏兼容）** [public/schema/pack-schema.ts](file:///d:/代码/gameserver-panel/public/schema/pack-schema.ts)：`PackBusinessChatEnhancementSchema.welcome` 新增可选字段 `leave_message_command`（离开消息命令模板，缺省时降级到 `commands.broadcast`）。**此修改受 public/ 保护，需人类显式授权**
- **修改** [public/schema/panel-api-types.ts](file:///d:/代码/gameserver-panel/public/schema/panel-api-types.ts)：新增 `VerifyCodeSummary` / `PlayerBindingSummary` 类型；扩展 `PlayerJoinSettingsSummary` 增加 `leave_message` 字段

### 数据库迁移

- 新增迁移：`player_verify_codes` 表（id, user_id, server_id, game_player_name, code, expires_at, used_at, created_at）
- 新增迁移：`player_bindings` 表（id, user_id, server_id, game_player_name UNIQUE, vip_level, status, bound_at, unbound_at）
- 新增迁移：扩展 `vote_settings` 表增加 trigger_keywords / cooldown_seconds / target_cooldown_seconds / admin_immune / vip_immune_min_level 字段
- 新增迁移：扩展 `player_join_settings` 表增加 leave_message 字段
- 新增迁移：扩展 `chat_trigger_responses` 表增加 mode（prefix/exact/contains）和 cooldown_seconds 字段（参考 factorio AutoReplyRule）

## Impact

- **受影响 spec**：
  - `extend-pack-schema-for-factorio`（pack-schema 新增 leave_message_command）
  - `p0-platform-skeleton`（chatService / voteService / instanceBindingService 扩展）
- **受影响代码**：
  - `panel/backend/src/services/inGameCommandService.ts`（新增）
  - `panel/backend/src/services/instanceBindingService.ts`（扩展 verifyBindingByCode + generateVerifyCode）
  - `panel/backend/src/services/voteService.ts`（扩展 handleGameChatVoteCommand）
  - `panel/backend/src/services/cdkService.ts`（无需修改，已有 redeem 复用）
  - `panel/backend/src/services/chatService.ts`（listTriggers 返回值增加 mode/cooldown 字段）
  - `panel/backend/src/index.ts`（handleChatTrigger 调用 inGameCommandService、handlePlayerJoinWelcome 读 DB）
  - `panel/backend/src/db/migrations/`（5 个新迁移）
  - `panel/frontend/src/pages/PlayerVerify.tsx`（新增）
  - `panel/frontend/src/pages/admin/PlayerJoinSettings.tsx`（增加 leave_message）
  - `panel/frontend/src/pages/admin/PlayerBindings.tsx`（新增）
  - `panel/frontend/src/App.tsx`（新增路由 `/profile/verify`、`/admin/player-bindings`）
  - `public/schema/pack-schema.ts`（受保护，需人类授权）
  - `public/schema/panel-api-types.ts`（新增类型）
  - `panel/backend/src/api/routes/`（新增 `verifyCodes.ts`、`playerBindings.ts` 路由）

## ADDED Requirements

### Requirement: 游戏内 !verify 绑定命令

系统 SHALL 提供玩家在游戏控制台输入 `!verify <验证码>` 完成账号绑定的能力。

#### Scenario: 玩家在游戏内输入 !verify 成功绑定
- **WHEN** 玩家 `airxw` 在游戏控制台输入 `!verify ABC123`
- **AND** 验证码 `ABC123` 由 user_id=42 在 web 端为 server_id=`srv-1` 申请且未过期
- **THEN** 系统创建 `player_bindings` 记录（game_player_name='airxw', user_id=42, server_id='srv-1', vip_level=1, status='verified'）
- **AND** 标记验证码 used_at
- **AND** 通过 `commands.broadcast` 命令模板向游戏下发 `欢迎玩家 airxw 绑定成功，当前 VIP1`

#### Scenario: 验证码不存在或已过期
- **WHEN** 玩家输入 `!verify XYZ999`
- **AND** 验证码不存在或已过期
- **THEN** 系统回复 `验证码无效或已过期，请前往面板重新获取`
- **AND** 不创建绑定记录

#### Scenario: 重复绑定
- **WHEN** 玩家 `airxw` 已绑定到 user_id=42，再次输入有效验证码（来自 user_id=43）
- **THEN** 系统回复 `您已绑定到其他账号，请先在面板解绑`
- **AND** 不修改现有绑定

### Requirement: 游戏内 !claim 兑换命令

系统 SHALL 提供玩家在游戏控制台输入 `!claim <code>` 兑换 CDK 的能力。

#### Scenario: 玩家在游戏内输入 !claim 成功兑换
- **WHEN** 玩家 `airxw` 在游戏控制台输入 `!claim CDK-ABC123`
- **AND** 该 CDK 码属于当前 server 且状态为 unused
- **THEN** 系统调用 `cdkService.redeem(server_id, { code: 'CDK-ABC123', player_name: 'airxw' })`
- **AND** 通过 `pack.business.cdk.redeem_command` 模板下发奖励命令
- **AND** 回复玩家 `兑换成功：物品 X N 个已发放`

#### Scenario: CDK 不存在
- **WHEN** 玩家输入 `!claim NOT-EXIST`
- **THEN** 系统回复 `兑换码无效`

#### Scenario: CDK 已被使用
- **WHEN** 玩家输入已被使用的 CDK
- **THEN** 系统回复 `兑换码已被使用`

### Requirement: 游戏内 !vk 投票踢人命令

系统 SHALL 提供玩家在游戏控制台通过 `!vk` 系列命令发起和参与投票踢人的能力。

#### Scenario: 发起投票
- **WHEN** 玩家 `airxw` 在游戏控制台输入 `!vk badplayer`
- **AND** vote_settings.enabled=true 且 trigger_keywords 包含 `!vk`
- **AND** 目标 `badplayer` 在线、不在冷却期、不免疫
- **THEN** 系统创建 votes 记录（status=active, initiator=airxw, target=badplayer, yes_count=1）
- **AND** 通过 `commands.broadcast` 向游戏广播 `[投票] airxw 发起踢出 badplayer，需 N 票，输入 !vk yes 投赞成`

#### Scenario: 投赞成票
- **WHEN** 玩家 `bob` 输入 `!vk yes`
- **AND** 当前实例有 active 投票
- **THEN** 系统记录 vote_records（voter=bob, choice=yes），更新 votes.yes_count
- **AND** 当 yes_count >= threshold 时自动 kick 目标，广播结果

#### Scenario: 投反对票
- **WHEN** 玩家 `charlie` 输入 `!vk no`
- **THEN** 系统记录 no 票，更新 votes.no_count

#### Scenario: 管理员免疫
- **WHEN** 投票目标 `admin1` 是 admin 角色
- **AND** vote_settings.admin_immune=true
- **THEN** 系统广播 `[投票] admin1 受管理员免疫保护，无法投票踢出`
- **AND** 不创建投票

### Requirement: 游戏内 !help / !status / !players / !uptime 内置查询命令

系统 SHALL 提供玩家在游戏控制台查询服务器信息的内置命令。

#### Scenario: !help 列出所有可用命令
- **WHEN** 玩家输入 `!help`
- **THEN** 系统回复 `可用命令: !help !status !players !uptime !verify <code> !claim <code> !vk <玩家名> !vk yes !vk no`

#### Scenario: !status 查询服务器状态
- **WHEN** 玩家输入 `!status`
- **THEN** 系统回复 `服务器: <name>, 状态: running, 在线: N 人, 运行时间: X 分钟`

#### Scenario: !players 查询在线玩家
- **WHEN** 玩家输入 `!players`
- **THEN** 系统回复 `在线玩家 (N): player1, player2, ...`

#### Scenario: !uptime 查询运行时间
- **WHEN** 玩家输入 `!uptime`
- **THEN** 系统回复 `服务器已运行 X 小时 Y 分钟`

### Requirement: 玩家验证码 web 申请入口

系统 SHALL 提供玩家在 web 端获取游戏绑定验证码的入口。

#### Scenario: 玩家在 web 申请验证码
- **WHEN** 已登录 user 在 `/profile/verify` 页面选择 server 并点击「生成验证码」
- **AND** user 填写 game_player_name（如 `airxw`）
- **THEN** 系统生成 6 位验证码，写入 `player_verify_codes` 表（TTL 5 分钟）
- **AND** 页面显示验证码 + 引导文案「进入游戏控制台输入 `!verify <code>` 完成绑定」

#### Scenario: 验证码过期
- **WHEN** 玩家在 5 分钟后输入 `!verify <过期码>`
- **THEN** 系统回复验证码已过期

### Requirement: 欢迎词配置真正生效

系统 SHALL 让 admin 在 web 端 PlayerJoinSettings 页面配置的欢迎词和离开消息真正生效。

#### Scenario: admin 配置欢迎词后下次玩家加入生效
- **WHEN** admin 在 `/admin/player-join-settings` 配置 `welcome_message=欢迎 {player} 来到服务器` 并保存
- **AND** 玩家 `airxw` 加入游戏
- **THEN** `handlePlayerJoinWelcome` 优先读 `player_join_settings` 表，渲染 `欢迎 airxw 来到服务器` 并通过 `commands.broadcast` 下发
- **AND** 若 DB 无配置则降级到 pack.yaml `business.chat_enhancement.welcome.first_gift_command`

#### Scenario: admin 配置离开消息
- **WHEN** admin 在 PlayerJoinSettings 配置 `leave_message=玩家 {player} 已离开`
- **AND** 玩家离开
- **THEN** `handlePlayerLeaveBroadcast` 读取该字段并渲染下发

### Requirement: 自定义聊天规则支持三种匹配模式

系统 SHALL 支持自定义聊天规则按 prefix/exact/contains 三种模式匹配，并支持冷却时间。

#### Scenario: prefix 模式
- **WHEN** 玩家输入 `!help please`
- **AND** 配置 trigger=`!help`, mode=prefix
- **THEN** 命中规则

#### Scenario: exact 模式
- **WHEN** 玩家输入 `服务器IP`
- **AND** 配置 trigger=`服务器IP`, mode=exact
- **THEN** 命中规则

#### Scenario: contains 模式
- **WHEN** 玩家输入 `请问服务器IP是什么`
- **AND** 配置 trigger=`服务器IP`, mode=contains
- **THEN** 命中规则

#### Scenario: 冷却期内不响应
- **WHEN** 玩家 5 秒内两次输入同一触发词
- **AND** 规则 cooldown_seconds=10
- **THEN** 第二次不响应

## MODIFIED Requirements

### Requirement: 玩家加入欢迎语广播（模块9 已实现，本次修正）

`handlePlayerJoinWelcome` 优先读 `player_join_settings` 表（admin 在 web 配置），仅当 DB 无配置时降级到 `pack.business.chat_enhancement.welcome.first_gift_command`。

### Requirement: 玩家离开消息广播（模块9 已实现，本次修正）

`handlePlayerLeaveBroadcast` 优先读 `player_join_settings.leave_message` 字段，仅当 DB 无配置时降级到当前实现（直接渲染固定文案）。

### Requirement: chatService.listTriggers 返回值扩展

`ChatTriggerResponseSummary` 新增 `mode` 和 `cooldown_seconds` 字段，与 factorio AutoReplyRule 对齐。

## REMOVED Requirements

无（所有变更为新增或扩展，不删除现有能力）。
