# 玩家门户基座（/guild）

- [ROUTE] `/guild`（入口：`https://gsp.ecsrz.com:3001/guild`）
- 状态：已完成（2026-07-25）
- BUILD：`20260725-010`

## 1. 页面定位

`/guild` 是 Player Portal（玩家门户）基座的首页入口（index），目标是以“玩家视角”聚合消费与社交能力，隐藏运维信息。

当前 `/guild` 的 index 页面为 `GuildDock`：展示用户概览、我的服务器、快捷入口、每日福利与通知公告。

## 2. 入口与路由

- [ROUTE] `/guild` 作为基座路由，内部承载多个子页面：
  - index：`/guild` → `GuildDock`
  - `/guild/servers`、`/guild/servers/:id`
  - `/guild/shop`、`/guild/orders`、`/guild/cdk`、`/guild/bind`
  - `/guild/discover`、`/guild/notifications`
  - `/guild/me`、`/guild/friends`、`/guild/profile/*`
- 页面 chrome（顶部栏/底部主导航）由 `GuildLayout → Layout(variant="player")` 提供

## 3. 角色与权限

- 权限：受保护路由（需要登录）
- 未登录访问 `/guild`：会被 `ProtectedRoute` 重定向至 `/login`，并携带 `state.from=/guild` 用于登录页上下文展示（标题会变为“登录玩家门户”）
- 登录后到达 `/` 根路由会按角色分流；普通用户落点是 `/guild`

## 4. 核心功能点

以 `/guild`（GuildDock）为准：

- 用户概览（昵称/引导文案）
- 我的服务器列表（卡片列表，点击进入 `/guild/servers/:id`）
- 指标摘要（绑定角色/钱包余额/进行中订单/未读消息）
- 快捷入口（绑定角色/游戏商城/CDK兑换/我的订单）
- 每日福利（按实例展示“可领点券”，支持真实领取）
- 通知公告（最近通知列表，支持“全部”入口）
- 右上角用户菜单（个人设置、退出登录）

## 5. 交互流程

**未登录访问**

1. 访问 `/guild`
2. 路由守卫判定未登录 → 跳转 `/login`（标题上下文为“登录玩家门户”）

**登录后访问首页**

1. 访问 `/guild`（index）
2. 页面加载聚合数据（概览、我的服务器、通知、各实例钱包）
3. 用户通过底部导航/快捷入口进入子页面（商城/我的/发现/消息等）

**退出登录**

1. 打开用户菜单
2. 点击“退出登录”
3. 清理会话并跳转回 `/login`

## 6. 接口与数据

`/guild`（GuildDock）聚合调用（以源码注释与实际调用为准）：

- [API] `GET /api/my/overview`：首页聚合概览计数（绑定/通知/订单/钱包/可领福利）
- [API] `GET /api/servers`：我的服务器列表（用于“我的服务器”卡片带）
- [API] `GET /api/servers/:id/wallet`：实例钱包与每日福利状态
- [API] `POST /api/servers/:id/wallet/claim-daily`：领取每日福利
- 通知数据源：`notificationStore.getRecentNotifications()`（WS+REST 兜底的单一数据源）

## 7. 状态管理与副作用

- 关键状态（GuildDock 内部）
  - `overview`、`servers`、`wallets`、`notifications`
  - `loading`、`claimingId`、`justClaimed`
- 副作用
  - 页面 mount 时调用 `refresh()` 并发拉取 overview + servers，并对每个 server 逐个拉 wallet（逐实例容错）
  - 订阅 `notificationStore.onNotificationNew()`，收到新通知时刷新首页通知列表

## 8. 错误与边界

- [EDGE] 未登录访问会跳转 `/login`，且登录页标题会根据 `from=/guild` 变为“登录玩家门户”
- [EDGE] 首页数据请求采用“逐项容错”策略：overview/servers 任一失败不会阻塞另一项；wallet 按实例单独 catch
- [EDGE] 领取每日福利失败：toast 提示（以 `PanelApiError` 或通用 Error 消息为准）
- [EDGE] 通知依赖 WS；断线时 Layout 会降级轮询（由 notificationStore 的 connection 回调驱动）

## 9. 体验与一致性检查

- [UX] 页面底部规范化 footer span 展示 BUILD ID，便于部署核对（格式：`© YYYY GSP · Game Server Panel · BUILD YYYYMMDD-XXX`，类名 `app-footer-build`）
- [UX] 移动端优先：底部主导航包含“首页/商城/我的/发现/消息”
- [UX] 入口聚合：四个快捷入口卡片（绑定角色/游戏商城/CDK兑换/我的订单）降低路径成本
- [UX] 数据聚合与动效约束：避免无限动画，pop-in 为一次性动效

## 10. 关键实现定位（代码引用）

- 路由注册 `/guild` 与 index 页： [App.tsx:L432-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L432-L456)
- 登录守卫（未登录重定向到 `/login` 并携带 `from`）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L127-L145)
- `/guild` 基座布局（Layout variant="player" + Outlet）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx#L1-L22)
- `/guild` 首页实现（数据聚合、快捷入口、每日福利、通知）：[GuildDock.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L1-L260)
- 玩家门户聚合 API（/api/my/*）：[client.ts:L805-L812](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L805-L812)
- 钱包与每日福利 API： [client.ts:L647-L656](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L647-L656)
- 通知 store（WS 单例 + 断线兜底）：[notificationStore.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/notificationStore.ts#L80-L200)
- BUILD 常量来源：[buildInfo.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/buildInfo.ts#L1)

## 11. 待办与风险

- [TODO] 将 `/guild` 的子页面按优先级拆分逐一梳理（建议顺序：`/guild/shop` → `/guild/servers/:id` → `/guild/me` → `/guild/discover` → `/guild/notifications`）
- [RISK] 通知事件类型未写入受保护的 `public/schema/ws-events.ts`（当前由 notificationStore 内联解析），需关注长期契约一致性策略
