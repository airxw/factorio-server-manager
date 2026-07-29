# 玩家门户首页（GuildDock）

- [ROUTE] `/guild`（公网入口：`https://gsp.ecsrz.com:3001/guild`）
- 状态：已完成（2026-07-26）
- BUILD：`20260726-001`

## 1. 页面定位

> `/guild` 基座的 index 页面（Player Portal 玩家门户首页），以"玩家视角"聚合账户级绑定、游戏角色绑定、我的服务器、资产概览、快捷入口、每日福利与通知公告，是登录后普通用户的默认落点（`RootRedirect` 按 `user.role` 分流，`user` → `/guild`）。

v4.17.0 信息架构重做：删除重复的"绑定角色"快捷入口，按 `binding_type` 分区展示账户级绑定（user↔instance，含 VIP）与游戏角色级绑定（user↔game_player，含 pending 验证码），多角色账号显示"切换角色"入口。

## 2. 入口与路由

- `[ROUTE]` 路由路径：`/guild`（基座 index）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild`
- 路由注册位置：[App.tsx#L451-L452](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L452)
  - 父路由：`<Route path="/guild" element={<GuildLayout />}>`（L451）
  - 当前路由：`<Route index element={<GuildDock />} />`（L452）
- 进入方式：
  - 登录后 `RootRedirect` 按 `user.role` 分流，`user` 角色自动落到 `/guild`（[App.tsx#L170-L176](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L170-L176)）
  - 顶部"玩家门户"品牌按钮（[Layout.tsx#L830-L836](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L830-L836)）
  - 底部 5 tab 中"首页"高亮入口（[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)）
  - 浏览器直接输入 URL
- 退出方式：
  - 底部 tab 跳到其他 `/guild/*` 子页
  - 顶部用户菜单 → "退出登录"（[Layout.tsx#L921-L931](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L921-L931)）
  - 多角色账号可通过 `RoleSwitcherModal` 切换到 `/store` 或 `/admin` 基座

## 3. 角色与权限

- 允许角色：所有已登录用户（`user` / `instance_admin` / `server_admin` / `system_admin` / `admin`），信息架构按"玩家视角"组织
- 守卫：外层 `<ProtectedRoute />` 包裹 `/guild` 基座（[App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)），未登录重定向 `/login` 携带 `state.from`
- 守卫实现：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)（`ProtectedRoute` 函数）
- 未登录行为：跳转 `/login`，并携带 `state.from = /guild...` 用于登录页上下文展示（标题"登录玩家门户"）
- 越权行为：本页无角色门控（`user+` 均可访问）；服主/管理员以"玩家身份"使用本页，可通过用户菜单跳回 `/store` / `/admin`

## 4. 核心功能点

- **欢迎头区 + 角色徽章**：按时段动态问候（夜深/早上/中午/下午/晚上）+ 用户名 + 已验证角色数引导文案 + 当前活动角色徽章（多角色账号显示切换图标，点击打开 `RoleSwitcherModal`；单角色账号跳 `/guild/profile`）
- **账户级绑定区**（v4.17.0 新增分区）：展示 `binding_type='account'` 的 user↔instance 绑定（含 VIP 等级），最多展示 5 条；空态引导"浏览服务器"跳 `/guild/servers`；卡片点击跳 `/guild/servers/:id`
- **游戏角色级绑定区**（v4.17.0 新增分区）：展示 `binding_type='player'` 的 user↔game_player 绑定（含 `verify_status` 与 `verify_code`）；空态引导"立即绑定"跳 `/guild/bind`；卡片内联展示 pending 态验证码 + 复制按钮（不再跳 Profile 页）
- **我的服务器**：横滑卡片带（`ServerChip`），展示用户可访问的服务器（在线/离线状态点），点击跳 `/guild/servers/:id`
- **资产概览数字带**：4 个统计卡片（账户绑定数 / 钱包余额 / 进行中订单 / 未读消息），点击跳对应详情页
- **快捷功能入口**（v4.17.0 删除"绑定角色"重复项）：4 个 CTA — 游戏商城 / CDK 兑换 / 我的订单 / 我的资产
- **每日福利**：按实例展示"可领点券数 + 领取按钮"，调用真实 wallet API；领取成功 pop-in 一次性动效 + 同步 overview 计数
- **通知公告**：最近 5 条通知（从 `notificationStore` 单一数据源读取），按级别染色（info/warning/error/success），"全部"跳 `/guild/notifications`
- **角色切换弹窗**（v4.17.0 新增）：多角色账号点击徽章打开 `RoleSwitcherModal`，二次密码校验 + 切换 `active_role`

## 5. 交互流程

**未登录访问**

1. 访问 `/guild`
2. `ProtectedRoute` 判定 `user === null` → 跳转 `/login` 携带 `state.from=/guild`
3. 登录页标题根据 `from` 变为"登录玩家门户"

**登录后访问首页**

1. 访问 `/guild`（index）
2. `useEffect` 触发 `refresh()`：`Promise.all` 并发拉取 overview / servers / accountBindings / playerBindings，每个调用独立 `.catch()` 兜底
3. servers 拉取完成后，逐实例 `Promise.all` 拉取 wallet（每实例独立 try/catch，单实例失败不影响其他）
4. 从 `notificationStore.getRecentNotifications()` 同步读取最近 5 条通知（不再发请求）
5. 渲染：欢迎头区 → 账户级绑定区 → 游戏角色绑定区 → 我的服务器 → 资产概览 → 快捷入口 → 每日福利 + 通知公告
6. 订阅 `notificationStore.onNotificationNew`：新通知到达时实时刷新首页通知列表（无需手动 refresh）

**多角色切换**

1. 用户头像徽章显示当前活动角色（玩家/服主/管理员首字 + 中文标签）
2. 多角色账号（`user.roles.length > 1`）点击徽章 → 打开 `RoleSwitcherModal`
3. 选择目标角色 + 输入当前账号密码 → `useAuth.selectRole(email, password, activeRole)` 调 `POST /api/auth/select-role`
4. 成功：替换 token + 递增 `sessionKey`（触发下游 useEffect 重置业务状态）+ 跳转目标基座（玩家→`/guild`，服主→`/store`，管理员→`/admin`）
5. 失败：弹窗内展示后端错误码（401 密码错误 / 400 角色非法 / 403 跨用户）

**领取每日福利**

1. 用户在"每日福利"卡片点击"领取"按钮（仅 `wallet.can_claim_daily === true` 时可点）
2. `setClaimingId(serverId)` 禁用按钮 + 文案改为"领取中…"
3. 调 `POST /api/servers/:id/wallet/claim-daily`
4. 成功：更新 `wallets[serverId]` + `justClaimed` 触发 400ms pop-in 动效 + toast.success(`领取成功 +N 点券`) + 同步 overview 的 `daily_claimable` 与 `wallet_balance`
5. 失败：toast.error 展示 `PanelApiError.message` 或"领取失败"
6. `finally` 清空 `claimingId`

**pending 验证码倒计时**

1. `useEffect` 检测 `playerBindings.some(b => b.verify_status === 'pending')`
2. 启动 30s `setInterval` 刷新 `nowTick` 驱动倒计时重渲染
3. 无 pending 绑定时清理定时器

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/my/overview` | GET | JWT | 首页聚合概览计数（绑定/通知/订单/钱包/可领福利） | 401/500 |
| `/api/servers` | GET | JWT | 我的服务器列表（user 角色返回 account 绑定 + owner 的实例） | 401/500 |
| `/api/profile/bindings` | GET | JWT | 账户级绑定列表（user↔instance，含 VIP 等级，camelCase 化） | 401/500 |
| `/api/player-bindings` | GET | JWT | 游戏角色级绑定列表（含 verify_status / verify_code / scope_ref） | 401/500 |
| `/api/servers/:id/wallet` | GET | JWT | 单实例钱包信息（余额 / can_claim_daily / daily_reward_amount） | 401/403/404/500 |
| `/api/servers/:id/wallet/claim-daily` | POST | JWT | 领取每日点券福利（返回新 wallet + claimed_amount） | 401/403/409/500 |
| `/api/auth/select-role` | POST | JWT | 多角色切换（二次密码校验 + 签发新 JWT） | 400/401/403/500 |

> 通知数据源：`notificationStore.getRecentNotifications()`（WS + REST 兜底的单一数据源，不发新请求）；WS 事件类型 `notification.new` / `notification.unread_count` 由后端扩展，未写入受保护的 `public/schema/ws-events.ts`。

API client 调用位置：
- `getMyOverview`：[client.ts#L965-L967](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L965-L967)
- `listServers`：[client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)（含 `validateResponse(listServersResponseSchema, ...)`）
- `listMyBindings`：[client.ts#L1302-L1305](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1302-L1305)（`/profile/bindings` + `snakeToCamel`）
- `listPlayerBindings`：[client.ts#L934-L936](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L936)
- `getWallet` / `claimDailyReward`：[client.ts#L803-L811](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L803-L811)

## 7. 状态管理与副作用

- **Context / Store**：
  - `useAuth()`（[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx)）— 提供 `api`（PanelApiClient）、`user`（含 `roles` / `active_role` v4.17.0）
  - `useToast()`（[ToastContext.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx)）— success/error/info/warning
  - `notificationStore`（[notificationStore.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/notificationStore.ts)）— 单例 WS store，由 `AuthProvider` 管理 init/destroy 生命周期
- **Local state**（[GuildDock.tsx#L362-L374](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L362-L374)）：
  - `overview` / `servers` / `accountBindings` / `playerBindings` / `notifications` / `wallets`（按 serverId 索引）
  - `loading`（首次加载骨架屏）/ `claimingId`（按实例禁用领取按钮）/ `justClaimed`（400ms pop-in 动效标记）
  - `roleSwitcherOpen`（v4.17.0 角色切换弹窗）
  - `nowTick`（v4.17.0 pending 验证码倒计时驱动 tick）
- **副作用**：
  - mount 时 `refresh()` 并发拉取 overview + servers + accountBindings + playerBindings；servers 就绪后逐实例拉 wallet
  - `useEffect` 订阅 `notificationStore.onNotificationNew` — 新通知到达时刷新首页通知列表（return unsub 实现退订）
  - `useEffect` 30s 定时器（仅当存在 pending 绑定时启动）— 驱动验证码倒计时重渲染
  - `useMemo` 计算 `greeting`（按时段）/ `serverMap`（实例 ID → 元信息映射）/ `userRoles` / `isMultiRole` / `claimableServers` / `stats`
- **`[STATE]` 关键派生**：
  - `isMultiRole = userRoles.length > 1`（决定徽章点击行为：弹窗 vs 跳个人设置）
  - `claimableServers = servers.filter(s => wallets[s.id]?.can_claim_daily)`（每日福利可领数角标）

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 `/guild` | 重定向 `/login?from=/guild`，登录页标题变"登录玩家门户" | `ProtectedRoute` 守卫，所有 `/guild/*` 共享 |
| `getMyOverview` 失败 | `.catch(() => null)` 静默降级，overview 区域显示 `—` 占位 | 不阻塞其他模块加载 |
| `listServers` 失败 | `.catch(() => ({ servers: [] }))` 静默降级为空列表 | "我的服务器"区不渲染，每日福利区显示"绑定实例后每日登录可领取点券奖励" |
| `listMyBindings` 失败 | `.catch(() => [])` 静默降级 | 账户级绑定区显示空态"还没有绑定任何实例" |
| `listPlayerBindings` 失败 | `.catch(() => ({ bindings: [] }))` 静默降级 | 游戏角色绑定区显示空态"还没有绑定游戏角色" |
| 单实例 `getWallet` 失败 | 单实例 try/catch 兜底为 `undefined`，该实例不进入 `wallets` map | 不影响其他实例钱包展示，对应 `DailyRewardCard` 显示"今日已领取"（保守降级） |
| `claimDailyReward` 失败 | toast.error 展示 `PanelApiError.message` 或"领取失败" | `claimingId` 在 `finally` 中清空，按钮恢复可点 |
| `selectRole` 失败 | `RoleSwitcherModal` 内展示后端错误码（401 密码错 / 400 角色非法 / 403 跨用户） | 不关闭弹窗，保留用户输入 |
| 通知 WS 断线 | `notificationStore` 自动重连（指数退避，最多 10 次）+ Layout 降级 30s 轮询 | 首页通知列表使用最近一次成功拉取的数据 |
| pending 验证码过期 | 后端轮询时 verify_status 由 `pending` 变 `failed`，下次 refresh 后卡片显示"已失效"徽章 | 30s 定时器仅刷新 `nowTick`，不重新拉数据 |
| overview 未就绪 | 数字带显示 `—`，`绑定已验证 X 个角色` 文案变"绑定游戏角色即可畅享商城、礼包、社区互动" | `loading && !overview` 判定 |
| 多角色账号 `user.roles` 缺失 | 降级为 `[user.role]`，`isMultiRole=false`，徽章点击跳 `/guild/profile` | 兼容旧 JWT（v4.17.0 之前的 token 无 `roles` 字段） |

## 9. 体验与一致性检查

- `[UX]` 设计语言：Apple 浅色清新风（gp-theme CSS 变量），主色 `--gp-blue` + `--gp-grad-primary`，徽章配色（emerald 已验证 / amber 待验证 / rose 已失效 / blue 数量 / orange 可领 / red 未读）；卡片用 `gp-card gp-card-hover` 类，圆角 12-14px，无深色电竞配色
- `[UX]` 移动端适配：根容器 `minHeight: '100dvh'`（v3.6 移动端视口守卫，避免 100vh 强制导致底部溢出）；底部 5 tab 常驻（首页/商城/我的/发现/消息）；"我的服务器"用 `gp-hscroll` 横滑卡片；快捷入口用 `repeat(4, 1fr)` 4 列网格
- `[UX]` 视觉层级：欢迎头区 → 账户级绑定 → 游戏角色绑定 → 我的服务器 → 资产概览 → 快捷入口 → 每日福利+通知；按"身份 → 资产 → 行动"递进
- `[UX]` 一致性：与 `/guild/servers` / `/guild/servers/:id` 共享 `gp-*` 类（guild-portal.css），不混用 admin 风格；`useDocumentTitle('玩家门户')` 设置标签页标题，离开时恢复默认
- `[UX]` 动效约束：仅 `gp-pop-in` 一次性动效（领取福利后 400ms），无无限动画/Canvas（避免 IdentitySelector 黑屏教训）
- `[UX]` 可访问性：徽章按钮带 `aria-label`（多角色"切换角色" / 单角色"查看个人设置"）；复制验证码按钮带 `aria-label="复制验证码"`
- `[UX]` 文案：问候语按时段动态切换（夜深/早上/中午/下午/晚上）；引导文案随 overview 状态变化（已验证角色数 vs 绑定引导）
- `[UX]` 待改进：v4.17.0 删除"绑定角色"重复入口后，QUICK_ACTIONS 仅 4 项；空态卡片"浏览服务器 / 立即绑定"与快捷入口分工明确，但"我的资产"快捷入口与底部 tab"我的"语义重叠

## 10. 关键实现定位（代码引用）

- 路由入口：[App.tsx#L451-L452](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L452)（`/guild` 基座 index → GuildDock）
- 登录守卫：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)（`ProtectedRoute` 函数）
- 角色分流（user → /guild）：[App.tsx#L170-L176](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L170-L176)（`RootRedirect`）
- 页面组件：[GuildDock.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx)
- 子组件（同文件内）：`ServerChip` / `AccountBindingCard` / `PlayerBindingCard` / `DailyRewardCard` / `NotificationItem`
- 角色切换弹窗：[RoleSwitcherModal.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RoleSwitcherModal.tsx)
- Layout（player variant）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) + [Layout.tsx#L795-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L995)
- 底部 5 tab 配置：[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)
- API client 入口：[client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts)
  - `getMyOverview`：[L965-L967](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L965-L967)
  - `listServers`：[L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)
  - `listMyBindings`：[L1302-L1305](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1302-L1305)
  - `listPlayerBindings`：[L934-L936](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L936)
  - `getWallet` / `claimDailyReward`：[L803-L811](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L803-L811)
- 鉴权 Context：[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx)（`useAuth` / `selectRole` v4.17.0）
- 通知 Store：[notificationStore.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/notificationStore.ts)
- Toast：[ToastContext.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx)
- 文档标题 hook：[useDocumentTitle.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useDocumentTitle.ts)
- 后端 `GET /api/servers`（user 角色按 bindings 过滤）：[servers.ts#L117-L160](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L117-L160)
- BUILD 常量来源：[buildInfo.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/buildInfo.ts)

## 11. 待办与风险

- `[RISK]` **`nowTick` 状态未实际驱动倒计时渲染**：[GuildDock.tsx#L429-L434](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L429-L434) 设置了 30s 定时器刷新 `nowTick`，但 `void nowTick;`（[L492](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L492)）显式弃用，没有 `formatTimeAgo` 或剩余时间计算依赖 `nowTick`，定时器实际无效果 — 要么删除定时器，要么让 `NotificationItem.formatTimeAgo` 依赖 `nowTick` 重渲染
- `[RISK]` **`Promise.all` 单点失败风险**：[GuildDock.tsx#L379-L384](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L379-L384) 用 `Promise.all` 但每个调用已自带 `.catch()` 兜底，等价于 `Promise.allSettled`，符合 v4.26.0 B8 规范；但 `wallets` 的二轮 `Promise.all`（[L394-L403](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L394-L403)）每实例独立 try/catch，单实例失败时该 wallet 为 `undefined`，`DailyRewardCard` 会显示"今日已领取"（保守降级，可能误导用户）
- `[RISK]` **N+1 wallet 查询**：每个实例发一次 `GET /api/servers/:id/wallet`；当用户绑定 10+ 实例时首页加载会变慢（无并发上限）。建议后端补 `GET /api/my/wallets` 批量接口
- `[RISK]` **通知 WS 事件类型契约漂移**：`notification.new` / `notification.unread_count` 未写入受保护的 `public/schema/ws-events.ts`，由 `notificationStore.ts` 内联解析；后端 schema 变更不会触发前端类型检查失败
- `[RISK]` **多角色切换 UI 入口隐藏**：`isMultiRole` 用户才能看到"切换角色"图标，单角色用户点击徽章直接跳 `/guild/profile`，缺少视觉提示告知"可切换角色"；多角色账号的 `RoleSwitcherModal` 需输入密码，但无"忘记密码"入口
- `[RISK]` **`listServers` 对 user 角色返回的实例范围**：后端 [servers.ts#L150-L160](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L150-L160) 通过 `bindings` 表过滤，但首页"我的服务器"卡片可能展示 owner 是他人的实例（用户对该实例有 account 绑定）— 需确认是否符合 C 端"我的服务器"语义
- `[RISK]` **`void nowTick` 反模式**：[GuildDock.tsx#L492](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L492) 用 `void nowTick;` 规避 TS 未使用警告，掩盖了"定时器无实际效果"的设计缺陷
- `[RISK]` **`RoleSwitcherModal` 不在 `Suspense` 内**：弹窗为同步 import（[GuildDock.tsx#L46](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L46)），增加首页 bundle 体积；可考虑 `lazy()` 拆分
- `[TODO]` 删除 `nowTick` 定时器或让其驱动 `formatTimeAgo` 重渲染（如把 `nowTick` 作为 `NotificationItem` 的 prop）
- `[TODO]` 后端补 `GET /api/my/wallets` 批量接口，避免首页 N+1 查询
- `[TODO]` 通知 WS 事件类型走 s0601 契约变更流程，纳入 `public/schema/ws-events.ts`
- `[TODO]` `RoleSwitcherModal` 改 `lazy()` 拆分 bundle
- `[TODO]` `DailyRewardCard` wallet 为 `undefined` 时应显示"加载中"或"-"而非"今日已领取"
- `[TODO]` 浏览器核对：登录 `https://gsp.ecsrz.com:3001/guild` 验证 pending 验证码复制、每日福利领取、多角色切换的实际 UI 行为
- `[TODO]` 与 [guild.md](guild.md) 内容重叠 — 本文件为页面级梳理，`guild.md` 为基座概览；建议在 README 索引中明确两者关系，避免后续维护混乱

---

## 梳理元数据

- 梳理日期：2026-07-26
- 梳理方式：代码阅读（未做浏览器核对）
- 代码版本：v4.26.0（首页 GuildDock 自 v4.17.0 起未做大改）
- 浏览器版本/截图：见 [logs/2026-07-26.md](../logs/2026-07-26.md)
