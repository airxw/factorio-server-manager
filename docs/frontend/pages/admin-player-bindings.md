# 玩家绑定管理（PlayerBindings）

## 1. 页面定位
> 系统管理员在 server 级聚合视图下查看所有玩家绑定记录、并对单条记录执行解绑（软删除）的管理页。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/player-bindings`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/player-bindings`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/player-bindings`
- 进入方式：`/admin` 基座侧边栏点击「玩家绑定」菜单，或直接输入 URL
- 退出方式：侧边栏切换其他菜单 / 浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（`App.tsx` 第 371 行基座 + 第 378 行内层）
  - 内层：[PlayerBindings.tsx#L122-L124](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx#L122-L124) `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 重定向到 `/login`
- 越权行为：双层拦截，统一重定向 `/forbidden`
- 后端二次校验：`/api/servers/:serverId/player-bindings` 在 [routes-registry.ts#L850](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L850) 通过 `authenticateToken + requireAdmin` 保护（与其他 server 级路由共用 `/api/servers` 前缀的 requireAdmin 中间件）

## 4. 核心功能点
- 顶部服务器选择下拉框：默认选中第一个 server，切换后重新加载该 server 的绑定列表
- 表格展示字段：ID / 游戏玩家名 / 用户名 / 游戏类型 / 状态 / 绑定时间 / 操作
- 状态展示（`statusClass` + `STATUS_LABEL`）：
  - `pending` → 待审核（`badge-starting`）
  - `verified` → 已验证（`badge-running`）
  - `expired` → 已过期（默认 `badge`）
  - `revoked` → 已拒绝（`badge-error`）
- 解绑按钮：`window.confirm` 二次确认 → DELETE → 乐观从列表移除
- 空态引导：未选 server / 该 server 无绑定 均有差异化提示文案，引导用户去实例详情页「玩家」Tab

## 5. 交互流程
1. 进入页面 → `useEffect` 加载服务器列表（GET /servers）
2. 列表返回 → 自动选中第一个 server → 触发 `loadBindings(serverId)`（GET /servers/:serverId/player-bindings）
3. 用户切换下拉 → `serverId` 变化 → `useEffect` 重新加载绑定列表
4. 点击「解绑」→ `window.confirm` 确认 → DELETE /servers/:serverId/player-bindings/:id → 乐观从 `bindings` 移除
5. 点击「刷新」→ 重新调用 `loadBindings(serverId)`

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT + requireAdmin（继承基座） | 加载服务器列表用于下拉 | 401 / 403 |
| `/api/servers/:serverId/player-bindings` | GET | JWT + requireAdmin | 加载该 server 的所有玩家绑定 | 401 / 403 / 404 server 不存在 |
| `/api/servers/:serverId/player-bindings/:id` | DELETE | JWT + requireAdmin | 软删除单条绑定 + 同步游戏内解绑 | 404 / 403 / 500（解绑失败） |

> API client 见 [client.ts#L1202-L1210](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1202-L1210)（`listServerPlayerBindings` / `deleteServerPlayerBinding`）。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`
- Local state：
  - `servers` / `serverId` / `serversLoading` —— 服务器下拉
  - `bindings: ServerBindingItem[]` / `dataLoading` / `error` —— 绑定列表
  - `unbindingId: number | null` —— 当前正在解绑的记录 ID（用于按钮 disabled）
- 副作用：
  - `[STATE]` 加载态：`dataLoading=true` 显示「加载中…」
  - `[STATE]` 空态：`!serverId` 显示选择提示；`bindings.length === 0` 显示「该服务器暂无玩家绑定记录。」
  - `[STATE]` 错误态：顶部 alert 显示 `error`
  - `[STATE]` 服务器列表加载取消：`useEffect` 内 `cancelled` 标志位防止 unmount 后 setState
  - 无订阅、无定时器、无 WS

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | 双层门控 |
| 服务器列表加载失败 | 顶部 alert + 下拉显示「暂无服务器」 | `useEffect` catch |
| 绑定列表加载失败 | 顶部 alert + `bindings=[]` | `loadBindings` catch |
| 解绑失败 | 顶部 alert 显示 err.message | `handleUnbind` catch |
| 解绑中重复点击 | 按钮显示「解绑中…」+ disabled | `unbindingId === b.id` |
| 未选 server | 表格区域显示空态提示 | `!serverId` 分支 |
| 服务器无绑定 | 显示「该服务器暂无玩家绑定记录。」+ 引导去实例详情页 | `bindings.length === 0` |
| 用户取消 confirm | 不发起 DELETE | `window.confirm` 返回 false |
| 组件卸载 | `cancelled=true` 阻止 setState | 防止内存泄漏警告 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：与全站一致，使用 `page-header` / `form-row` / `data-table` / `badge` / `btn` 共用样式；状态色与其他页面（如服务器列表 `badge-running`/`badge-error`）一致
- `[UX]` 移动端适配：依赖全局 `data-table` 在移动端的表现，本页未做 `mobile-card-list` 双视图（与 Users/AuditLogs 不同）
- `[UX]` 与其他页面一致性：与 Webhooks 页面共享「顶部服务器下拉 + 表格」布局模式；与实例详情页「玩家」Tab 共享 `BindingVerifyStatus` 类型与状态标签
- `[UX]` 反馈规范：解绑走 `window.confirm`，与 Webhooks/SystemConfig 一致（但与 Users 的 Modal 风格不一致）
- `[UX]` 引导文案：空态明确引导「请先在上方下拉框选择实例」+「也可在实例详情页的「玩家」Tab 中查看」，降低用户困惑

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`player-bindings` 子路由在第 387 行）
- 页面组件：[PlayerBindings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx)
- 状态映射：[PlayerBindings.tsx#L21-L40](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx#L21-L40) `statusClass` / `STATUS_LABEL`
- 服务器列表加载（含 cancelled）：[PlayerBindings.tsx#L55-L78](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx#L55-L78)
- 解绑逻辑：[PlayerBindings.tsx#L105-L120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx#L105-L120)
- API client：[client.ts#L1202-L1210](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1202-L1210)
- 后端路由：[playerBindings.ts#L359-L435](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/playerBindings.ts#L359-L435)（GET / DELETE /:serverId/player-bindings[/:id]）
- 后端挂载：[routes-registry.ts#L850](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L850) `createServerPlayerBindingsRouter`

## 11. 待办与风险
- `[RISK]` 本页只支持 server 级「解绑」操作，无法在此页查看绑定详情（如 verify_token、玩家 ID），需跳转实例详情页；功能定位偏窄
- `[RISK]` 解绑走 `window.confirm`（[PlayerBindings.tsx#L107](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx#L107)），与 Users 的 Modal 风格不一致，移动端原生 confirm 体验较差
- `[RISK]` 解绑成功后乐观从列表移除（`setBindings(prev => prev.filter(...))`），但若后端「同步解绑游戏内状态」失败已返回 200（部分成功），用户无法察觉游戏内未解绑
- `[RISK]` 服务器列表与绑定列表无分页，server 多或绑定多时下拉/表格渲染压力大
- `[RISK]` 与 `/api/player-bindings`（个人级，[routes-registry.ts#L905](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L905)）易混淆——本页用的是 `/api/servers/:serverId/player-bindings`（server 级），路径不一致
- `[TODO]` 缺少按 `verify_status` / `player_name` / `username` 过滤的搜索框，大量绑定时定位困难
- `[TODO]` 表格未做移动端 `mobile-card-list` 双视图，移动端体验弱于 Users/AuditLogs
- `[TODO]` 顶部服务器下拉未显示节点 / 游戏类型等元信息，仅 `name (id)`，难以区分同名 server

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（PlayerBindings.tsx + client.ts + playerBindings.ts + routes-registry.ts）
- 涉及版本标注：模块10（server 级玩家绑定管理 admin 入口）
