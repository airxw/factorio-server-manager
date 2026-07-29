# 玩家门户-绑定角色管理（GuildBind）

- [ROUTE] `/guild/bind`（入口：`https://gsp.ecsrz.com:3001/guild/bind`、`https://192.168.5.14:3001/guild/bind`）
- 状态：已完成（2026-07-26 重新梳理，覆盖 v4.17.0 双分支向导重做）
- BUILD：`20260726-XXX`

## 1. 页面定位

`/guild/bind` 是玩家门户（Player Portal）的「绑定角色」自助管理页，**v4.17.0 起重做为向导式双分支结构**，把"面板账号 ↔ 游戏身份"的关联拆成两支独立向导，由顶部 SegmentedControl 切换：

- **游戏角色绑定（player）**：把面板账号与某个游戏内角色名（如 Minecraft IGN）建立绑定。完整闭环：选游戏类型 + 输入角色名 → 生成 6 位验证码 → 用户在游戏内输入验证码 → 面板点"我已在游戏内输入"触发验证 → 状态变 `verified`。该绑定是后续「商城购物按角色身份发放奖励」「CDK 兑换角色名自动填充」的前置条件（项目规则要求"玩家门户商品兑换限定为用户自己绑定的角色"）。
- **账户级绑定（account）**：把面板账号与某个具体实例（server）建立"VIP 会员"绑定，解锁该实例的 VIP 等级 + 每日点券福利。一键绑定/解绑，无需验证码。

两支向导共享同一个页面、同一个 `refresh()`，但分别管理两套互不干扰的列表数据。

## 2. 入口与路由

- [ROUTE] 路由归属：`/guild` 基座下的子路由 `bind`
- [ROUTE] 完整路径：`/guild/bind`
- [ROUTE] URL query：`?type=account|player`（控制初始选中分支，默认 `player`）；切换分支时 `setSearchParams(..., { replace: true })` 同步 URL，便于分享/书签
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/bind`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/bind`
- 进入方式：
  - 玩家门户首页（`/guild`）的快捷入口
  - CDK 兑换页（`/guild/cdk`）在"未绑定角色"时的"去绑定"链接
  - 直接访问 URL
- 退出方式：浏览器返回 / 顶部导航回 `/guild` / 切换到其他底部 tab
- 该路径在 Layout 底部导航激活映射中归属 `/guild` 首页 tab（保持玩家门户底部导航一致性）

未登录访问：由全局路由守卫 `ProtectedRoute` 重定向至 `/login`，并携带 `state.from=/guild/bind`（用于登录页上下文展示）

## 3. 角色与权限

- 允许角色：所有已登录用户（user+）
- 守卫：`ProtectedRoute`（外层 `/guild` 基座已被 `<Route element={<ProtectedRoute />}>` 包裹，[App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)）
- 未登录行为：跳转 `/login`，携带 `state.from`
- 后端鉴权：
  - `/api/player-bindings*`、`/api/profile/bindings`、`/api/instances/:id/bindings` 均挂载在 `authenticateToken(JWT_SECRET)` 下
  - 普通用户视角会强制按 `req.user.userId` 过滤/校验 ownership（不泄露他人绑定）
  - v4.16.1 修复过"整组 requireAdmin 导致玩家门户 403"的历史问题，本页依赖的玩家自助端点应保持对登录用户可用

## 4. 核心功能点

### 共通

- 顶部 SegmentedControl 切换两支向导（`role="tablist"` + 两个 `role="tab"`，支持 `aria-selected`）
- 页头"刷新"按钮重新拉取三套数据（player + account + servers）
- 页面 title 通过 `useDocumentTitle('绑定角色')` 设置

### A. 游戏角色绑定分支（player）

- **第 1 步：填写角色信息**
  - 选择游戏类型（11 个选项：minecraft/terraria/factorio/palworld/rust/ark/valheim/dst/enshrouded/zomboid/satisfactory）
  - 输入游戏角色名（`maxLength={64}`，Enter 直接提交）
  - 点击"生成验证码"创建绑定
- **第 2 步：在游戏内输入验证码并确认**
  - 列表按 `scope_ref`（即 game_type）分组展示卡片
  - 每个卡片展示：游戏图标 + 角色名 + 状态徽章（已验证/待验证/已拒绝）+ 绑定时间 + 解绑按钮
  - `pending` 状态额外展示验证码块（amber 背景）+ "复制" + "我已在游戏内输入"按钮
  - 空态：圆形渐变图标 + "还没有绑定游戏角色" 引导

### B. 账户级绑定分支（account）

- **第 1 步：已绑定实例列表**
  - 卡片展示：实例图标（金色 Crown）+ 实例名 + 游戏类型 + VIP 等级 + 绑定时间 + "进入"按钮 + 解绑按钮
  - "进入"跳转 `/guild/servers/${serverId}`
  - 空态：引导用户从下方"可绑定实例"列表选择
- **第 2 步：可绑定实例列表**
  - 已绑定实例从列表中过滤掉（`boundServerIds` Set 去重）
  - 卡片展示：实例图标 + 实例名 + 游戏类型 + "绑定"按钮（一键绑定）
  - 空态区分两种情况：`servers.length === 0`（平台无实例）vs `bindableServers.length === 0`（已绑定全部）
  - 空态提供"浏览全部服务器"跳转 `/guild/servers`

## 5. 交互流程

### 流程 A：游戏角色绑定（创建 + 验证 + 解绑）

1. 进入 `/guild/bind`（默认 player 分支）
2. 选游戏类型 → 输入角色名 → 点"生成验证码"
3. 成功后：
   - 新 binding 立即插入列表顶部（`setPlayerBindings((prev) => [res.binding, ...prev])`）
   - toast 成功"绑定已创建，请在游戏内输入验证码 …"
4. 在卡片中复制验证码（可选）→ 在游戏内输入验证码 → 回到面板点"我已在游戏内输入"
5. 根据 `verify_status` 返回值：
   - `verified`：toast 成功"验证成功，角色已绑定"
   - `pending`：toast 错误"尚未检测到验证码输入…稍后重试"
   - 其他（`rejected`/`revoked`）：toast 错误"验证未通过…"
6. 解绑：点垃圾桶按钮 → `window.confirm` 二次确认 → 成功后从列表移除

### 流程 B：账户级绑定（一键绑定/解绑）

1. 顶部切到"账户级绑定" tab（URL 同步 `?type=account`）
2. 在"可绑定实例"列表点击"绑定"
3. 成功后 toast "已绑定该实例" + 刷新 `listMyBindings()`
4. 若后端返回 `ALREADY_BOUND`（409）：toast info "已绑定该实例" + 仍然刷新列表
5. 解绑：点垃圾桶按钮 → `window.confirm` "确定解绑实例「xxx」吗？解绑后将失去 VIP 身份与每日点券福利" → 成功后本地移除

## 6. 接口与数据

| [API] 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/player-bindings` | GET | JWT | 游戏角色级绑定列表 | 401 |
| `/api/player-bindings` | POST | JWT | 创建游戏角色级绑定（生成验证码） | 401/400/409 (`PLAYER_BINDING_ALREADY_EXISTS`) |
| `/api/player-bindings/:id/verify` | POST | JWT | 验证绑定（消费验证码） | 401/400 (`PLAYER_BINDING_VERIFY_CODE_INVALID` / `PLAYER_BINDING_NOT_PENDING`)/404 |
| `/api/player-bindings/:id` | DELETE | JWT | 解绑游戏角色 | 401/404 |
| `/api/profile/bindings` | GET | JWT | 账户级绑定列表（user↔instance，已转 camelCase） | 401 |
| `/api/instances/:serverId/bindings` | POST | JWT | 账户级一键绑定实例（自动 VIP1） | 401/409 (`ALREADY_BOUND`，前端转 `PanelApiError('ALREADY_BOUND')`) |
| `/api/instances/:serverId/bindings` | DELETE | JWT | 账户级解绑实例 | 401/404 |
| `/api/servers` | GET | JWT | 实例列表（用于账户级"可绑定实例"） | 401 |

数据契约（前端直接依赖公共类型）：

- `Binding`（统一绑定记录，v4.17.0 起替代旧 `PlayerBindingSummary`）：包含 `binding_type: 'account' | 'player'`、`scope_type: 'instance' | 'game_type' | 'global'`、`scope_ref`、`player_name`、`vip_level`、`verify_status: 'pending' | 'verified' | 'expired' | 'revoked'`、`verify_code`、`verify_expires_at`、`verified_at`、`metadata`、`created_at`、`updated_at`
- `MyBinding`（来自 `api/modules/auth.ts`，账户级绑定 camelCase 视图）：`id`、`userId`、`serverId`、`vipLevel`、`status`、`boundAt`、`unboundAt`
- `ServerSummary`：实例摘要（`id`、`name`、`game_type`、`status` 等）
- `ListPlayerBindingsResponse.bindings: Binding[]`
- `CreatePlayerBindingRequest`：`{ game_player_name, game_type }`（请求字段未变，响应已是 `Binding`）
- `VerifyPlayerBindingRequest`：`{ verify_code }`

## 7. 状态管理与副作用

- [STATE] `bindType: 'player' | 'account'`：向导分支，初始值由 URL query `?type=` 决定，默认 `player`
- [STATE] `playerBindings: Binding[]`：游戏角色级绑定列表，按 `scope_ref` 分组渲染
- [STATE] `accountBindings: MyBinding[]`：账户级绑定列表
- [STATE] `servers: ServerSummary[]`：全量实例列表（用于账户级"可绑定实例"过滤）
- [STATE] `loading: boolean`：首次加载/刷新中
  - `loading && xxxBindings.length === 0`：展示对应 skeleton（每个分支 2 个骨架卡）
- [STATE] `busy: boolean`：验证/解绑/账户绑定/账户解绑期间禁用所有卡片动作按钮，避免重复提交
- [STATE] `creating: boolean`：创建游戏角色绑定时禁用按钮 + 文案"创建中…"
- [STATE] `gameType: string`：表单游戏类型（默认 `minecraft`）
- [STATE] `playerName: string`：表单角色名

派生状态（`useMemo`）：

- `grouped`：按 `scope_ref` 分组 + 字母序排序的游戏角色绑定
- `serverMap`：`Map<serverId, ServerSummary>`，账户级卡片展示实例名/游戏类型
- `boundServerIds`：`Set<serverId>`，已绑定的实例 ID 集合
- `bindableServers`：`servers` 过滤掉 `boundServerIds` 后的可绑定列表

副作用：

- mount 时触发 `refresh()`：`Promise.all` 并行拉取三套数据，每个 API 单独 `.catch(() => 兜底)` 兜底（任一失败不阻塞其他）
- 切换分支：`setSearchParams(..., { replace: true })` 同步 URL query
- 创建成功：本地插入新 binding 到列表顶部（不强制二次刷新）
- 验证成功：本地用返回的 binding 覆盖对应条目
- 删除成功：本地移除对应条目
- 账户绑定成功：重新 `listMyBindings()` 全量刷新账户级列表
- 账户解绑成功：本地移除对应条目

## 8. 错误与边界

| [EDGE] 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 `/guild/bind` | `ProtectedRoute` 重定向 `/login` 携带 `state.from` | 浏览器已核对 |
| 角色名为空 | toast 错误"请输入游戏角色名"，不发请求 | 前端校验 |
| 角色名超长 | `maxLength={64}` 限制输入 | HTML 原生 |
| 创建绑定 409 (`PLAYER_BINDING_ALREADY_EXISTS`) | toast 错误（展示 `PanelApiError.message`） | 后端错误码映射 |
| 验证返回 `pending` | toast 错误"尚未检测到验证码输入…稍后重试" | 非失败，是"暂未检测到" |
| 验证返回非 `verified`/`pending` | toast 错误"验证未通过…" | `rejected`/`revoked` |
| 复制验证码失败 | toast 错误"复制失败" | `navigator.clipboard` 权限/非安全上下文 |
| 账户级绑定 409 (`ALREADY_BOUND`) | toast info "已绑定该实例" + 刷新列表 | `PanelApiError.code === 'ALREADY_BOUND'` 专用分支 |
| 解绑二次确认 | `window.confirm` 阻塞式原生弹窗 | 与 v4.26.0 B4 统一 `useConfirm` 规范不一致（见 RISK） |
| 三套 API 任一失败 | `Promise.all` 单独 catch 兜底空数组，不阻塞其他列表 | 容错策略已对齐 `Promise.allSettled` |
| 空态区分 | player: "还没有绑定游戏角色"；account bound: "尚未绑定任何实例"；account bindable: 区分"平台无实例" vs "已绑定全部" | 文案精准 |
| `loading && bindings.length === 0` | 骨架屏（每个分支 2 个骨架卡） | 避免抖动 |

## 9. 体验与一致性检查

- [UX] 设计语言：苹果清新风。组件使用 `gp-*` 体系（`gp-hero/gp-card/gp-card-strong/gp-btn/gp-badge/gp-section-title/gp-empty/gp-skeleton/gp-mono-num`），通过 `var(--gp-grad-primary)`、`var(--gp-amber)`、`var(--gp-rose)`、`var(--gp-blue)` 等 CSS 变量统一管控，符合玩家门户视觉规范
- [UX] 移动端适配：使用 `minHeight: '100dvh'`（动态视口高度，遵守移动端视口滚动守卫 rules-0 §3.1.6）；表单 `gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'` 自适应
- [UX] 一致性：与 GuildCdk / GuildOrders / GuildServers 共享 `gp-*` 体系；底部 tab 激活态在 `Layout.tsx` `NAV_ACTIVE_TAB` 映射中归 `/guild`，跨页一致
- [UX] 重要信息强化：
  - 待验证状态用 amber 背景块强调验证码
  - 验证码使用等宽数字样式（`gp-mono-num` + `letterSpacing: 0.08em`）提升可读性
  - 已验证游戏角色图标用 `var(--gp-grad-primary)` 渐变填充
  - 账户级绑定卡片用金色 Crown 图标强化 VIP 身份感
- [UX] 低成本路径：表单允许 Enter 直接提交创建
- [UX] 状态徽章三色：emerald（已验证）/ amber（待验证）/ rose（已拒绝）

## 10. 关键实现定位（代码引用）

- 路由注册（`/guild/bind` → `GuildBind`）：[App.tsx#L451-L460](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L460)
- 受保护路由实现（未登录跳 `/login` + 携带 `state.from`）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- 基座 Layout（`variant="player"`，底部 5 tab）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) + [Layout.tsx#L818-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L818-L995)
- 底部 tab 激活映射（`/guild/bind` → `/guild`）：[Layout.tsx#L226](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L226)
- 页面实现（双分支向导 + 创建/验证/解绑 + 一键绑定/解绑）：[GuildBind.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L1-L802)
  - 状态徽章 `StatusBadge`：[GuildBind.tsx#L85-L105](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L85-L105)
  - 游戏角色卡片 `PlayerBindingRow`：[GuildBind.tsx#L111-L215](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L111-L215)
  - 账户级卡片 `AccountBindingRow`：[GuildBind.tsx#L221-L281](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L221-L281)
  - 可绑定实例卡片 `BindableServerRow`：[GuildBind.tsx#L287-L333](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L287-L333)
  - 主组件 `GuildBind`（状态/副作用/分支切换）：[GuildBind.tsx#L339-L802](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx#L339-L802)
- API client 端点封装：
  - `listPlayerBindings` / `createPlayerBinding` / `verifyPlayerBinding` / `deletePlayerBinding`：[client.ts#L934-L959](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L959)
  - `listMyBindings`（账户级，含 snakeToCamel）：[client.ts#L1302-L1305](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1302-L1305)
  - `bindInstance`（含 `ALREADY_BOUND` 错误转换）：[client.ts#L1306-L1317](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1306-L1317)
  - `unbindInstance`：[client.ts#L1318-L1322](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1318-L1322)
  - `listServers`：[client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)
- 账户级绑定 camelCase 类型 `MyBinding`：[auth.ts#L20-L29](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/auth.ts#L20-L29)
- 公共类型契约（`Binding` 统一类型 / `BindingType` / `BindingVerifyStatus`）：[panel-api-types.ts#L3110-L3141](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L3110-L3141)
- 公共类型契约（`ListPlayerBindingsResponse` 等）：[panel-api-types.ts#L1404-L1423](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L1404-L1423)
- 后端路由挂载：
  - `/api/player-bindings`：[routes-registry.ts#L905](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L905)
  - `/api`（含 `/profile/bindings` + `/instances/:serverId/bindings`）：[routes-registry.ts#L906](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L906)
  - `/api/cdk`：[routes-registry.ts#L825](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L825)
- 后端实现（账户级 user↔instance 绑定 5 个端点）：[bindings.ts#L62-L210](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/bindings.ts#L62-L210)
- 后端实现（player-bindings CRUD + verify）：[playerBindings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/playerBindings.ts)

## 11. 待办与风险

- [TODO] 浏览器登录态核对（建议用普通用户账号）：双分支切换是否正常；URL `?type=account|player` 切换是否同步；账户级"一键绑定"是否真的秒级返回 VIP1
- [TODO] 验证链路核对：游戏内输入验证码的具体入口/指令文案（本页仅提示"进入游戏输入验证码"，未展示更具体操作，例：`!verify 123456`）
- [TODO] 多分支共享 `busy` 状态：当前所有动作共用一个 `busy`，意味着用户在一个卡片点验证时，所有卡片的解绑/绑定按钮都被禁用；可考虑改为按 `binding.id` 粒度的 `busyId`
- [RISK] `window.confirm` 阻塞式原生弹窗与项目 v4.26.0 B4 规范不一致（规范要求全部改用 `useConfirm` + `<ConfirmDialog>`），同基座下 Friends 已迁移，本页 + GuildCdk 未迁移；移动端原生 confirm 体验差
- [RISK] `bindInstance` 在 client.ts 中把后端 409 错误转换成 `PanelApiError('ALREADY_BOUND', '已绑定该实例', 409)`，但其他错误码（如实例不存在 404、用户被禁 403）会以原始 `PanelApiError` 抛出，UI 仅统一 toast 展示 `message`；建议后端在端点文档中明确所有可能的错误码
- [RISK] 账户级"一键绑定"无任何前置确认（不需要验证码、不需要二次确认），用户误触会立即获得 VIP1 + 触发后端钱包初始化；解绑时有 `window.confirm` 但绑定没有，存在不对称风险
- [RISK] 三套 API 用 `Promise.all` + 单独 catch 兜底，等价 `Promise.allSettled`，但若 `api.listPlayerBindings()` 与 `api.listMyBindings()` 同时 401（token 失效），会同时静默回退空数组，用户看到的是"无绑定"而非"未登录"——应依赖全局 `request()` 401 拦截器统一处理
- [RISK] 旧 `PlayerBindingSummary` 在公共契约中标记为 `@deprecated`（v4.18.0 删除），本页已迁移到统一 `Binding` 体系；但 `CreatePlayerBindingRequest` 仍保留 `game_player_name`/`game_type` 字段名（向后兼容），与 `Binding.player_name`/`Binding.scope_ref` 存在命名漂移，可能引发后续维护误读
- [RISK] `bindableServers` 仅按 `servers` 列表过滤已绑定 ID，未做"实例是否对当前用户可见/可绑"的权限校验；若后端 `/api/servers` 返回了不应绑定的实例，用户点击绑定会触发后端 403/404，UI 仅统一 toast 错误
