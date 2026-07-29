# 流程：玩家门户主流程（进入与导航）

## 目标

描述 `user` 角色用户从访问站点到进入 `/guild` 基座并在底部 5 tab 间导航的完整链路，覆盖登录、角色分流、基座门控、Layout 渲染、tab 切换五阶段。本流程串联 `/guild` 基座下 11 个独有页面与 3 个跨基座共享页面。

## 前置条件

- 站点已完成首启动初始化（`/api/init/status` 返回 `initialized: true`），否则访问根路径会被引导至 `/setup`。
- 用户已注册并登录，角色为 `user`（普通玩家）。`server_admin` / `instance_admin` 用户进入 `/guild` 仅通过显式切换活动角色（v4.17.0 多角色）。
- 浏览器入口仅允许 `https://gsp.ecsrz.com:3001`（公网）或 `https://192.168.5.14:3001`（局域网）。
- 用户已至少绑定一个游戏角色或账户级实例（部分页面空态由业务数据驱动，非渲染故障）。

## 主流程

```
[用户访问任意 /xxx]
        │
        ▼
[AuthProvider.initialize()]  ← 读取 localStorage panel_token + 调用 /api/auth/me
        │
   ┌────┴────┐
   │ 未登录  │ 已登录
   ▼         ▼
[/login]   [RootRedirect]
   │         │
   │         └─ user.role === 'user' ─→ Navigate to /guild
   │                                         │
   │                                         ▼
   │                                    [ProtectedRoute 通过]
   │                                         │
   │                                         ▼
   │                                    [<Route path="/guild" element={<GuildLayout />}>]
   │                                         │
   │                                         ▼
   │                                    [<Layout variant="player">]
   │                                    顶部导航 + 底部 5 tab + <Outlet />
   │                                         │
   │                                         ▼
   │                                    [默认 index → GuildDock 渲染]
   │                                    GET /api/my/overview（聚合概览）
   │                                    GET /api/profile/bindings（账户级）
   │                                    GET /api/player-bindings（游戏角色级）
   │                                    GET /api/servers（我绑定的实例）
   │                                         │
   │                                         ▼
   │                                    [useDocumentTitle('玩家门户')]
   │
   │ 提交 → POST /api/auth/login
   │ 成功：JWT 入 localStorage + setState user
   │ 失败：429/401 → Toast 错误提示
   ▼
[Navigate to state.from || /guild]
        │
        ▼
[/guild 渲染 GuildDock]
```

### 底部 5 tab 导航矩阵

| Tab | 路由 | 页面组件 | 页面文档 |
|-----|------|---------|---------|
| 首页 | `/guild` (index) | `GuildDock` | [guild-dock.md](../pages/guild-dock.md) |
| 商城 | `/guild/shop` | `GuildShop` | [guild-shop.md](../pages/guild-shop.md) |
| 我的服务器 | `/guild/servers` | `GuildServers` | [guild-servers.md](../pages/guild-servers.md) |
| 消息 | `/guild/notifications` | `GuildMessages` | [guild-messages.md](../pages/guild-messages.md) |
| 我的 | `/guild/me` | `MyAssets` | [guild-me.md](../pages/guild-me.md) |

### 二级页面入口

| 入口位置 | 目标路由 | 页面文档 |
|---------|---------|---------|
| GuildDock → "去发现更多" | `/guild/discover` | [guild-discover.md](../pages/guild-discover.md) |
| GuildDock → "CDK 兑换"卡片 | `/guild/cdk` | [guild-cdk.md](../pages/guild-cdk.md) |
| GuildDock → "我的订单"卡片 | `/guild/orders` | [guild-orders.md](../pages/guild-orders.md) |
| GuildDock → "绑定角色"卡片 | `/guild/bind` | [guild-bind.md](../pages/guild-bind.md) |
| GuildServers → 实例卡片 | `/guild/servers/:id` | [guild-server-detail.md](../pages/guild-server-detail.md) |
| GuildShop → 服务器卡片 | `/guild/servers/:id` | [guild-server-detail.md](../pages/guild-server-detail.md) |
| GuildMe → 头像下拉 | `/guild/profile` | [admin-profile.md](../pages/admin-profile.md)（跨基座共享） |
| GuildMe → "身份验证" | `/guild/profile/verify` | [admin-profile-verify.md](../pages/admin-profile-verify.md)（跨基座共享） |
| GuildMe → "告警配置" | `/guild/profile/alerts` | [admin-profile-alerts.md](../pages/admin-profile-alerts.md)（跨基座共享） |
| 直接访问 URL | `/guild/friends` | [guild-friends.md](../pages/guild-friends.md)（入口缺失 RISK） |

## 失败与回退

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---------------|---------|------|
| Token 过期 | 401 → axios 拦截器清 localStorage → 跳 `/login` 携带 `state.from` | 见 [client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts) |
| 未登录访问 `/guild/*` | `<ProtectedRoute>` 跳 `/login` 携带 `state.from` | [App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154) |
| 已登录但角色为 server_admin / instance_admin | `RootRedirect` 自动跳 `/admin` / `/store`，不会进入 `/guild` | [App.tsx#L170-L176](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L170-L176) |
| `/api/my/overview` 失败 | GuildDock 全屏 `EmptyState` + 重试按钮 + `toast.error` | 见 [guild-dock.md §8](../pages/guild-dock.md) |
| `listServers` 失败 | GuildShop / GuildServers 静默降级为空态（吞错 RISK） | 见 [guild-shop.md §11](../pages/guild-shop.md) / [guild-servers.md §11](../pages/guild-servers.md) |
| 实例详情 404 | `ServerDetailGuild` 显示"实例不存在"空态 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 底部 tab 激活态错位 | `Layout.tsx#L226-L228` 通过 pathname 前缀匹配激活 | 见 [Layout.tsx#L226-L228](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L226-L228) |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 出现页面 |
|------|------|------|------|---------|
| `/api/auth/me` | GET | JWT | 启动时恢复用户身份 | 全基座 |
| `/api/auth/login` | POST | 公开 | 登录获取 JWT | /login |
| `/api/auth/select-role` | POST | JWT | v4.17.0 多角色切换 | GuildDock |
| `/api/my/overview` | GET | JWT | 玩家门户首页聚合概览 | GuildDock |
| `/api/profile/bindings` | GET | JWT | 账户级绑定列表 | GuildDock / GuildBind |
| `/api/player-bindings` | GET | JWT | 游戏角色级绑定列表 | GuildDock / GuildBind |
| `/api/servers` | GET | JWT | 我绑定的实例列表（user 角色按 bindings 过滤） | GuildDock / GuildShop / GuildServers |
| `/api/my/wallet` | GET | JWT | 钱包余额 + 每日福利 | GuildDock |

## 页面引用

- 入口与基座：[guild.md](../pages/guild.md) / [guild-dock.md](../pages/guild-dock.md)
- 5 tab 主页面：[guild-shop.md](../pages/guild-shop.md) / [guild-servers.md](../pages/guild-servers.md) / [guild-messages.md](../pages/guild-messages.md) / [guild-me.md](../pages/guild-me.md)
- 二级页面：[guild-discover.md](../pages/guild-discover.md) / [guild-cdk.md](../pages/guild-cdk.md) / [guild-orders.md](../pages/guild-orders.md) / [guild-bind.md](../pages/guild-bind.md) / [guild-server-detail.md](../pages/guild-server-detail.md) / [guild-friends.md](../pages/guild-friends.md)
- 跨基座共享：[admin-profile.md](../pages/admin-profile.md) / [admin-profile-verify.md](../pages/admin-profile-verify.md) / [admin-profile-alerts.md](../pages/admin-profile-alerts.md)

## 关键实现定位（代码引用）

- 路由总入口：[App.tsx#L291-L296](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L291-L296) — AuthProvider + AppVersionProvider + GameThemeProvider 包裹
- ProtectedRoute 守卫：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- RootRedirect 角色分流：[App.tsx#L156-L179](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L156-L179)
- `/guild` 基座路由块：[App.tsx#L451-L474](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L474)
- GuildLayout：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) — `<Layout variant="player"><Outlet /></Layout>`
- Layout player variant：[Layout.tsx#L795-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L995) — 顶部导航 + 底部 5 tab 配置
- 底部 5 tab 激活映射：[Layout.tsx#L226-L228](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L226-L228)
- AuthProvider initialize：[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx)

## 风险与待办

- `[RISK]` **Friends 入口缺失**：底部 5 tab 无"好友"入口，`variant="player"` 隐藏侧边栏导致 `PLAYER_LINKS` 中的"好友"项不可见，用户只能通过 URL 直接访问 `/guild/friends`。详见 [guild-friends.md §11](../pages/guild-friends.md)。
- `[RISK]` **跨基座跳转断裂**：Friends 点击用户名跳转 `/players/:userId`（不在 `/guild` 基座下），会跳出玩家门户布局；GuildMe 实例"查看详情"跳 `/instances/:id`（旧 Layout 基座）也会跳出 5 tab。详见 [guild-friends.md §11](../pages/guild-friends.md) / [guild-me.md §11](../pages/guild-me.md)。
- `[RISK]` **`/guild/servers/:id/orders` 路由未注册**：GuildMessages 的"查看订单"链接跳转该路由，但 `App.tsx` 未注册，会命中 404。详见 [guild-messages.md §11](../pages/guild-messages.md)。
- `[RISK]` **GuildDock `nowTick` 定时器无效**：30s 定时器刷新 `nowTick` 但 `formatTimeAgo` 不依赖它，pending 验证码倒计时不会实时更新。详见 [guild-dock.md §11](../pages/guild-dock.md)。
- `[RISK]` **设计语言割裂**：GuildDock / GuildShop / GuildServers / GuildDiscover / GuildMessages / GuildCdk / GuildOrders / GuildBind 使用 `gp-*` 类（Apple 浅色清新风），GuildMe / Friends 仍用 `info-card` / `data-table` 通用类（旧版 admin 风格）。同基座下两套样式系统。
- `[RISK]` **`/api/servers` 双层 catch 吞错**：GuildShop / GuildServers 在 API 层已 `.catch(() => ({ servers: [] }))`，用户看到"空态"而非"加载失败"。详见 [guild-shop.md §11](../pages/guild-shop.md)。
- `[TODO]` 补齐 GuildDock → GuildFriends 入口（建议在 GuildDock 顶部用户区或底部 5 tab 增加"好友"入口）。
- `[TODO]` 修复 GuildMessages "查看订单"链接为已注册路由（`/guild/orders` 或 `/guild/orders?server=:id`）。
- `[TODO]` 统一 `/guild` 基座下样式系统为 `gp-*`（迁移 GuildMe / Friends）。
- `[TODO]` 修复 GuildDock `nowTick` 定时器（删除或让 `formatTimeAgo` 依赖 `nowTick`）。

## 梳理元数据

- 梳理日期：2026-07-26
- 梳理方式：基于 `/guild` 基座 14 篇页面文档串联（代码阅读产出，未做浏览器核对）
- 覆盖页面：11 个独有页面 + 3 个跨基座共享页面
