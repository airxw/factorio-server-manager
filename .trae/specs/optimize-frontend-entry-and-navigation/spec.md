# 前端入口补齐与导航优化 Spec

## Why

模块10「游戏内聊天命令交互能力补齐」已完成 12 个 Task，但用户反馈：
1. **新增功能在前端没有看到入口** —— PlayerVerify / PlayerBindings / ChatTriggers / PlayerJoinSettings 4 个页面已注册路由，但 Layout 侧边栏导航完全没有这些链接，用户只能手动输入 URL 才能访问
2. **操作逻辑不清晰** —— ChatTriggers 和 PlayerJoinSettings 本质是实例作用域的设置（页面顶部用下拉选择服务器），却放在 `/admin/*` 路径下，违背了 v2.0.0 spec 确立的「实例中心化」设计原则；用户在 admin 入口下找不到也想不到这些功能在 admin 路径下
3. **页面不够好看** —— PlayerVerify.tsx 有大量内联样式（fontSize/fontWeight/letterSpacing/padding/background 等），违反了已完成的 `frontend-comprehensive-ui-polish` spec 的 AC-10「静态内联样式数量从 40+ 减少到 5 处以内（仅限动态值）」的清除要求；Profile.tsx 第 368 行也有 1 处 `marginBottom` 内联样式
4. **isAdminRole 角色 bug 未修复** —— 20 个 admin 页面（含模块10 新增的 3 个）的 `isAdminRole` 函数只识别 `admin`/`system_admin`，不识别当前 3 级角色体系下的 `server_admin`，导致当前种子管理员（role=server_admin）访问 admin 页面会显示"无权限"

本 spec 不引入新功能，仅做**入口补齐 + 操作逻辑修正 + 样式合规 + 角色识别修复**，让用户能在前端真正用到模块10 已完成的能力。

## What Changes

### 1. 修复 isAdminRole 角色识别（20 个页面统一）
- 所有 admin 页面的 `isAdminRole` 函数统一识别 `server_admin`/`system_admin`/`admin`（与 Layout.tsx 第 107 行的 `isServerAdmin` 保持一致）
- 影响文件：20 个含 `isAdminRole` 函数的 tsx 文件（详见 Impact 段）
- 修复方式：将 `role === 'admin' || role === 'system_admin'` 改为 `role === 'server_admin' || role === 'system_admin' || role === 'admin'`

### 2. 侧边栏导航补全（Layout.tsx ADMIN_LINKS）
- 在 `ADMIN_LINKS` 数组中新增「玩家绑定」入口，指向 `/admin/player-bindings`
- 不在侧边栏添加 ChatTriggers / PlayerJoinSettings 入口（理由：这两个页面将移入实例详情 tab，见第 3 点）
- 不在主侧边栏添加 PlayerVerify 入口（理由：PlayerVerify 是 user 角色申请验证码的页面，正确入口是 Profile 页内的「游戏内绑定」链接，见第 4 点）

### 3. ChatTriggers / PlayerJoinSettings 集成进实例详情 tab（**BREAKING 路由变更**）
- 将 `ChatTriggers` 和 `PlayerJoinSettings` 从 `/admin/*` 路径下移除，改为 ServerDetail.tsx 的子 tab
- 在 ServerDetail.tsx 的 `BASE_TABS` 中新增 `'chat-triggers'` 和 `'player-join-settings'` 两个底座 tab
- 在 `TAB_LABELS` 中补充：`'chat-triggers': '聊天触发'`、`'player-join-settings': '加入设置'`
- 在 ServerDetail.tsx 的 tab 内容渲染区新增两个分支：
  - `activeTab === 'chat-triggers'` → 渲染 `<ChatTriggers serverId={server.id} />`（传入 serverId 跳过内部下拉）
  - `activeTab === 'player-join-settings'` → 渲染 `<PlayerJoinSettings serverId={server.id} />`（同上）
- 改造 ChatTriggers / PlayerJoinSettings 组件：移除顶部「服务器选择下拉」，改为接收 `serverId` props（受控组件）
- 旧路由 `/admin/chat-triggers` 和 `/admin/player-join-settings` 重定向到 `/instances`（提示先选实例）

### 4. Profile 页面加入 PlayerVerify 入口
- 在 Profile.tsx 的「我的实例绑定」卡片下方新增「游戏内绑定验证码」入口卡片
- 卡片显示简短说明 + 「去申请验证码」按钮，点击跳转 `/profile/verify`
- 让用户从 Profile → PlayerVerify 的导航路径明确

### 5. PlayerVerify 页面美化（移除内联样式）
- 移除 PlayerVerify.tsx 中所有内联样式（fontSize/fontWeight/letterSpacing/padding/background/borderRadius/margin/fontFamily 等）
- 验证码展示卡片改用 `.verify-code-display` CSS 类（新增到 styles.css）
- 使用方法引导框改用 `.verify-code-usage` CSS 类（新增到 styles.css）
- 内联的 `borderColor` 改为 `.card-highlight` 类
- 表格中的 `fontFamily: 'monospace'` 改用已有的 `.mono` 类
- `marginTop: 12` 内联样式改用本 spec 新增的 `.mt-3` 工具类（非"已有"，由本 spec Task 8 显式新增）
- `fontWeight: 'bold'` 内联样式改用本 spec 新增的 `.font-bold` 工具类

### 6. Profile 页面移除 1 处内联样式
- 将 Profile.tsx 第 368 行的 `style={{ marginBottom: 12 }}` 改为 `.mb-3` 工具类（非"已有"，由本 spec Task 8 显式新增）

### 7. 变更追踪文档创建（rules-6 强制前置）
- 在 `.trae/documents/` 目录下创建 `20260716_模块11_前端入口优化.md`（遵循 rules-6 §二 命名规范）
- 文档包含 YAML frontmatter 元数据 + 四章节（问题分析 / 修复方案 / 实现步骤 / 预期效果）
- 此文档为本 spec 所有代码修改的前置依赖，rules-6 §三「修复前必写」强制要求

## Impact

- **Affected specs**:
  - `frontend-comprehensive-ui-polish`（已完成的 AC-10「静态内联样式总数 0 处」被模块10 新增页面破坏，本 spec 修复回归）
  - `add-in-game-chat-commands`（模块10 产出，本 spec 优化其前端入口和样式）
  - `v2.0.0-instance-centric-spec`（实例中心化设计，本 spec 把 ChatTriggers/PlayerJoinSettings 移入实例详情，强化该原则）
  - `redesign-roles-vip-navigation`（3 级角色体系，本 spec 修复 20 个页面的 isAdminRole 识别）
- **Affected code**:
  - `panel/frontend/src/components/Layout.tsx` — ADMIN_LINKS 新增玩家绑定链接
  - `panel/frontend/src/pages/ServerDetail.tsx` — BASE_TABS 新增 chat-triggers / player-join-settings tab，内容区新增两个渲染分支
  - `panel/frontend/src/pages/admin/ChatTriggers.tsx` — 移除顶部服务器下拉，改为接收 serverId props
  - `panel/frontend/src/pages/admin/PlayerJoinSettings.tsx` — 同上
  - `panel/frontend/src/pages/PlayerVerify.tsx` — 移除内联样式，使用 CSS 类
  - `panel/frontend/src/pages/Profile.tsx` — 新增 PlayerVerify 入口卡片 + 移除 1 处内联样式
  - `panel/frontend/src/App.tsx` — 路由调整（移除 /admin/chat-triggers 和 /admin/player-join-settings 直访路由，改为重定向到 /instances）
  - `panel/frontend/src/styles.css` — 新增 `.verify-code-display` / `.verify-code-usage` / `.card-highlight` / `.mt-3` / `.mb-3` / `.font-bold` 类
  - `panel/frontend/src/utils/role.ts` — **新增**公共工具函数文件，导出 `isAdminRole` 函数供 20 个 admin 页面统一引用
  - `.trae/documents/20260716_模块11_前端入口优化.md` — **新增**变更追踪文档（rules-6 强制前置）
  - **20 个 admin 页面的 isAdminRole 函数统一**：
    - `panel/frontend/src/pages/admin/PlayerBindings.tsx`
    - `panel/frontend/src/pages/admin/ChatTriggers.tsx`
    - `panel/frontend/src/pages/admin/PlayerJoinSettings.tsx`
    - `panel/frontend/src/pages/admin/ShopItems.tsx`
    - `panel/frontend/src/pages/admin/Packs.tsx`
    - `panel/frontend/src/pages/admin/AuditLogs.tsx`
    - `panel/frontend/src/pages/admin/Webhooks.tsx`
    - `panel/frontend/src/pages/admin/Lists.tsx`
    - `panel/frontend/src/pages/admin/Monitor.tsx`
    - `panel/frontend/src/pages/admin/Backups.tsx`
    - `panel/frontend/src/pages/admin/Saves.tsx`
    - `panel/frontend/src/pages/admin/Mods.tsx`
    - `panel/frontend/src/pages/admin/ChatSettings.tsx`
    - `panel/frontend/src/pages/admin/PeriodicMessages.tsx`
    - `panel/frontend/src/pages/admin/VoteSettings.tsx`
    - `panel/frontend/src/pages/admin/CdkCodes.tsx`
    - `panel/frontend/src/pages/admin/ItemSync.tsx`
    - `panel/frontend/src/pages/admin/VipPermissions.tsx`
    - `panel/frontend/src/pages/admin/SystemConfig.tsx`
    - `panel/frontend/src/pages/admin/Users.tsx`
- **数据库迁移**：无（不涉及后端 / DB 变更）
- **后端**：无（不涉及后端代码变更，仅前端）
- **public/ 契约**：无变更（不修改 public/ 下任何文件）

---

## ADDED Requirements

### Requirement: 侧边栏「玩家绑定」入口

系统 SHALL 在左侧边栏的「系统管理」分组中新增「玩家绑定」导航项，仅 server_admin 可见，点击跳转到 `/admin/player-bindings`。

#### Scenario: server_admin 在侧边栏看到玩家绑定入口
- **GIVEN** role=server_admin 的用户已登录
- **WHEN** 用户查看左侧边栏「系统管理」分组
- **THEN** 看到「玩家绑定」导航项
- **AND** 点击后跳转到 `/admin/player-bindings`
- **AND** 页面正常加载（不显示「无权限」）

#### Scenario: 普通用户不可见玩家绑定入口
- **GIVEN** role=user 的用户已登录
- **WHEN** 查看左侧边栏
- **THEN** 不显示「系统管理」分组
- **AND** 不显示「玩家绑定」入口

### Requirement: 实例详情集成聊天触发与加入设置 tab

系统 SHALL 在实例详情页的 tab 系统中提供「聊天触发」和「加入设置」两个底座 tab，所有实例默认显示，不依赖 Pack 配置。

#### Scenario: 用户在实例详情配置聊天触发
- **GIVEN** server_admin 已进入某实例详情页
- **WHEN** 用户点击「聊天触发」tab
- **THEN** 显示该实例的聊天触发响应配置
- **AND** 无需再在下拉中选择服务器（已绑定当前实例）

#### Scenario: 用户在实例详情配置玩家加入设置
- **GIVEN** server_admin 已进入某实例详情页
- **WHEN** 用户点击「加入设置」tab
- **THEN** 显示该实例的玩家加入消息 / 礼包 / 离开消息配置
- **AND** 保存后配置立即生效

#### Scenario: 旧路由重定向
- **GIVEN** 用户访问 `/admin/chat-triggers` 或 `/admin/player-join-settings`
- **WHEN** 路由匹配
- **THEN** 重定向到 `/instances`（提示用户先选择实例）

### Requirement: Profile 页面提供 PlayerVerify 入口

系统 SHALL 在 Profile 页面「我的实例绑定」卡片下方新增「游戏内绑定验证码」入口卡片，引导用户跳转到 `/profile/verify`。

#### Scenario: 用户从 Profile 跳转到 PlayerVerify
- **GIVEN** 已登录用户在 `/profile`
- **WHEN** 点击「去申请验证码」按钮
- **THEN** 跳转到 `/profile/verify`
- **AND** PlayerVerify 页面正常加载

### Requirement: isAdminRole 统一识别 server_admin

系统 SHALL 在所有 admin 页面的 `isAdminRole` 函数中统一识别 3 级角色：`server_admin` / `system_admin` / `admin`，确保当前种子管理员（role=server_admin）能访问所有 admin 页面。

#### Scenario: server_admin 访问任意 admin 页面
- **GIVEN** role=server_admin 的用户已登录
- **WHEN** 访问任意 `/admin/*` 路径（含 `/admin/player-bindings` / `/admin/users` 等）
- **THEN** 页面正常加载，不显示「无权限访问该页面」

#### Scenario: 普通用户被拒绝
- **GIVEN** role=user 的用户
- **WHEN** 访问 `/admin/player-bindings`
- **THEN** 显示「无权限访问该页面」

### Requirement: PlayerVerify 页面移除内联样式

系统 SHALL 将 PlayerVerify.tsx 中所有静态内联样式替换为 CSS 类，符合 `frontend-comprehensive-ui-polish` spec 的 AC-10。

#### Scenario: 内联样式清零
- **GIVEN** PlayerVerify.tsx 源代码
- **WHEN** grep 检索 `style={{`
- **THEN** 静态内联样式数量为 0
- **AND** 验证码展示区使用 `.verify-code-display` 类
- **AND** 使用方法引导框使用 `.verify-code-usage` 类
- **AND** `marginTop: 12` 替换为 `.mt-3` 工具类（本 spec 新增）
- **AND** `fontWeight: 'bold'` 替换为 `.font-bold` 工具类（本 spec 新增）

### Requirement: styles.css 新增工具类

系统 SHALL 在 styles.css 中新增 `.mt-3` / `.mb-3` / `.font-bold` 三个工具类，供 PlayerVerify.tsx 和 Profile.tsx 替换内联样式使用。这些工具类并非"已有"，而是由本 spec 显式新增。

#### Scenario: 工具类已定义
- **GIVEN** styles.css 文件
- **WHEN** grep 检索 `.mt-3` / `.mb-3` / `.font-bold`
- **THEN** 三者均存在
- **AND** `.mt-3` 定义为 `margin-top: 12px`
- **AND** `.mb-3` 定义为 `margin-bottom: 12px`
- **AND** `.font-bold` 定义为 `font-weight: bold`

### Requirement: 变更追踪文档创建（rules-6 强制前置）

系统 SHALL 在本 spec 所有代码修改之前，于 `.trae/documents/` 目录下创建 `20260716_模块11_前端入口优化.md` 文档，遵循 rules-6 §三「修复前必写」强制要求。

#### Scenario: 文档已创建
- **GIVEN** 本 spec 准备开始代码修改
- **WHEN** 检查 `.trae/documents/` 目录
- **THEN** 存在 `20260716_模块11_前端入口优化.md` 文件
- **AND** 文件命名符合 `YYYYMMDD_模块N_变更简述.md` 规范
- **AND** frontmatter 含 timestamp / issue_id / status / related_files / affected_modules 字段
- **AND** 正文含四章节（问题分析 / 修复方案 / 实现步骤 / 预期效果）

## MODIFIED Requirements

### Requirement: ChatTriggers / PlayerJoinSettings 组件改造

ChatTriggers 和 PlayerJoinSettings 组件 SHALL 移除内部「服务器选择下拉」，改为接收 `serverId` props 作为受控组件，由 ServerDetail.tsx 在 tab 渲染时传入当前实例的 server.id。

#### Scenario: ChatTriggers 受控渲染
- **GIVEN** ServerDetail.tsx 中 `activeTab === 'chat-triggers'`
- **WHEN** 渲染 ChatTriggers 组件
- **THEN** 传入 `serverId={server.id}` props
- **AND** ChatTriggers 内部不显示服务器选择下拉
- **AND** 直接使用传入的 serverId 加载该实例的触发响应列表

#### Scenario: PlayerJoinSettings 受控渲染
- **GIVEN** ServerDetail.tsx 中 `activeTab === 'player-join-settings'`
- **WHEN** 渲染 PlayerJoinSettings 组件
- **THEN** 传入 `serverId={server.id}` props
- **AND** PlayerJoinSettings 内部不显示服务器选择下拉
- **AND** 直接使用传入的 serverId 加载该实例的玩家加入设置

## REMOVED Requirements

### Requirement: /admin/chat-triggers 直访路由
**Reason**: ChatTriggers 已移入实例详情 tab，不再作为独立 admin 路由
**Migration**: `/admin/chat-triggers` 重定向到 `/instances`，提示用户先选择实例

### Requirement: /admin/player-join-settings 直访路由
**Reason**: PlayerJoinSettings 已移入实例详情 tab，不再作为独立 admin 路由
**Migration**: `/admin/player-join-settings` 重定向到 `/instances`，提示用户先选择实例
