# 我的服务器（GuildServers）

- [ROUTE] `/guild/servers`（公网入口：`https://gsp.ecsrz.com:3001/guild/servers`）
- 状态：已完成（2026-07-26）
- BUILD：`20260726-001`

## 1. 页面定位

> 玩家门户（Player Portal / `/guild` 基座）下的"我的服务器"列表页：聚合展示当前玩家已绑定角色所在的游戏实例，并提供"推荐服务器"横向滚动入口，作为玩家进入具体店铺详情的索引页。

该页是 C 端电商体验的"我的资产 → 服务器"入口，与底部 5 tab 中的"首页"(`\/guild`) 同属消费侧导航，但本身不直接出现在底部 tab 中——通过首页"我的服务器"卡片或个人中心进入。

## 2. 入口与路由

- `[ROUTE]` 路由路径：`/guild/servers`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/servers`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/servers`
- 路由注册位置：[App.tsx#L451-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L456)
  - 父路由：`<Route path="/guild" element={<GuildLayout />}>`（L451）
  - 当前路由：`<Route path="servers" element={<GuildServers />} />`（L454）
- 进入方式：
  - 顶部"玩家门户"品牌按钮回到 `/guild` 首页，再从首页"我的服务器"卡片进入
  - 用户菜单 → 个人设置 → 绑定角色管理（`/guild/bind`）后回流
  - 浏览器直接输入 URL
- 退出方式：
  - 点击顶部品牌"玩家门户"回到 `/guild`
  - 点击底部 5 tab 跳转其他基座页面
  - 浏览器后退
- 布局承载：`GuildLayout` → `Layout variant="player"`（移动端优先，无侧边栏，顶部导航 + 常驻底部 5 tab）

## 3. 角色与权限

- 允许角色：所有已登录用户（`user` / `instance_admin` / `server_admin` / `system_admin` / `admin`）
- 守卫：`ProtectedRoute`（外层 `<Route element={<ProtectedRoute />}>` 包裹 `/guild` 基座，见 [App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)）
- 未登录行为：`ProtectedRoute` 重定向到 `/login`，携带 `state.from=/guild/servers`（见 [App.tsx#L149-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L149-L151)）
- 后端二次校验：`/api/servers` 在 `user` 角色下按 `bindings: account/instance/verified` 过滤，仅返回当前用户有权访问的实例
- 实例访问权：列表卡片点击进入 `/guild/servers/:id` 时，详情页会再次校验实例访问权（403 → 友好提示）

## 4. 核心功能点

### 4.1 页头区（gp-hero）

- 标题"我的服务器" + 副标题"你绑定角色所在的游戏实例，一键进入店铺"
- 右侧"刷新"按钮（ghost 样式，loading 时 disabled）

### 4.2 我的服务器（绑定实例列表）

- 区块标题"绑定实例" + 紫色徽章显示数量（`gp-badge-violet`）
- `MyServerCard` 卡片：
  - 左侧圆角图标（渐变背景 + Gamepad2 图标）
  - 中间：服务器名（ellipsis 截断） + 在线状态圆点（绿/灰） + 副标题（game_type · 服主用户名）
  - 右侧：在线/离线徽章 + ChevronRight 箭头
  - 整卡可点击 → 跳转 `/guild/servers/:id`
- 空态（`gp-empty`）：
  - 渐变圆形图标 + UserPlus 图标
  - "还没有绑定任何服务器角色" + "绑定游戏角色后，对应服务器会出现在这里"
  - "立即绑定"主按钮 → 跳转 `/guild/bind`
- Loading 态：2 个 `gp-skeleton`（高度 76px）占位

### 4.3 推荐服务器（横向滚动）

- 区块标题"推荐服务器" + 右侧"更多"链接（带 ChevronRight）→ 跳转 `/guild/discover`
- `RecommendCard` 卡片（`gp-hscroll` 横向滚动容器）：
  - 顶部：渐变小图标 + 在线/离线徽章
  - 中间：服务器名 + pack_id · 服主用户名
  - 底部：Users 图标 + 在线人数（`gp-mono-num`）
  - 整卡可点击 → 跳转 `/guild/servers/:id`
- Loading 态：3 个 `gp-skeleton`（高度 140px，minWidth 200px）横向占位
- 空态："暂无推荐服务器"

## 5. 交互流程

### A. 页面初始化

1. 进入 `/guild/servers`
2. `useDocumentTitle('我的服务器')` 设置浏览器标签标题
3. `useEffect` 触发 `refresh()`：
   - `setLoading(true)`
   - `Promise.all` 并行拉取：
     - `api.listServers()` → 我的绑定实例（catch 兜底返回空数组）
     - `api.discoverRecommended(8)` → 8 条推荐服务器（catch 兜底返回空数组）
   - 任一接口失败但另一个成功时，仍渲染成功部分；只有外层 catch 触发时才 toast 报错
   - `setLoading(false)`

### B. 卡片点击

1. 点击 `MyServerCard` 或 `RecommendCard`
2. `navigate('/guild/servers/:id')` 进入店铺详情页

### C. 空态引导

1. 无绑定实例时展示"立即绑定"按钮
2. 点击 → `navigate('/guild/bind')` 跳转绑定管理页

### D. 刷新

1. 点击页头"刷新"按钮
2. 重新执行 `refresh()`，loading 期间按钮 disabled

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT | 拉取当前用户可见的服务器列表（user 角色后端按 bindings 过滤） | 401/403/500 |
| `/api/discover/recommended?limit=8` | GET | JWT | 拉取推荐服务器（公开数据，前端传 limit=8） | 401/500 |

### 接口实现定位

- `api.listServers()` → [client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)
  - 走 `validateResponse(listServersResponseSchema, raw, 'GET /servers')` 双轨校验
- `api.discoverRecommended(limit)` → [client.ts#L2115-L2120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2115-L2120)

### 数据契约（关键字段）

- `ServerSummary`（`@public/schema/panel-api-types`）：
  - `id` / `name` / `game_type` / `status`（`'running'` 表示在线）/ `owner_username`
- `DiscoverServer`：
  - `id` / `name` / `pack_id` / `status` / `owner_username` / `online_players`

## 7. 状态管理与副作用

- 页面级 state（`useState`）：
  - `myServers: ServerSummary[]` — 我的绑定实例
  - `recommended: DiscoverServer[]` — 推荐服务器
  - `loading: boolean` — 刷新中标志
- 副作用：
  - `useEffect(refresh, [refresh])` — 挂载时触发首次加载
  - `useCallback(refresh, [api, toast])` — memoized 刷新函数，依赖 `api`（来自 `useAuth`）和 `toast`（来自 `useToast`）
- 容错策略：`Promise.all` 内部对每个 API 单独 `.catch(() => ({ servers: [] }))` 兜底，避免单点失败导致整体降级；只有外层 catch 触发时才 toast
- 无 WS / 定时器 / 订阅，纯按需拉取模式
- 无 URL 状态化（不把筛选/分页写到 query string）

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | `ProtectedRoute` 重定向 `/login` | 携带 `state.from` 用于登录后回跳 |
| `listServers` 失败 | 静默降级为空数组，"绑定实例"区块显示空态 | 不阻塞推荐服务器渲染 |
| `discoverRecommended` 失败 | 静默降级为空数组，"推荐服务器"区块显示"暂无推荐服务器" | 不阻塞我的服务器渲染 |
| `Promise.all` 外层异常 | `toast.error(err.message)` | 仅在两个接口都异常时触发 |
| Loading + 空数据 | 显示 `gp-skeleton` 占位 | 避免闪烁 |
| 卡片标题过长 | `text-overflow: ellipsis` + `white-space: nowrap` | 单行截断 |
| 推荐服务器横向滚动 | `gp-hscroll` 容器 | 移动端触摸滑动，桌面端隐藏滚动条 |

## 9. 体验与一致性检查

- `[UX]` 设计语言：消费 `gp-*` 类（guild-portal.css），文件头注释自称"深色电竞风"——与项目规则 `1.md`"看齐苹果的清新设计语言，严禁使用杀马特电竞风和配色"存在表述冲突，需核实实际 CSS 实现（见 RISK）
- `[UX]` 移动端适配：
  - 整体使用 `flexDirection: 'column'` + `gap` 垂直流式布局，自适应宽度
  - 推荐服务器用 `gp-hscroll` 横向滚动，符合移动端电商"横滑卡片"习惯
  - 卡片内 ellipsis 截断避免长名撑破布局
- `[UX]` 一致性：
  - `useDocumentTitle` 已调用，与其他 guild 页面一致
  - 使用 `useToast` 而非 `window.alert`，符合规范
  - 空态有引导按钮（"立即绑定"），符合 C 端引导式空态
  - 推荐区"更多"链接跳转 `/guild/discover`，与底部 tab"发现"指向同一页面
- `[UX]` 激活态：`/guild/servers` 在 `PATH_ACTIVE_MAP` 中映射到 `/guild`（首页 tab 高亮），见 [Layout.tsx#L224](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L224)

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 子路由 servers）：[App.tsx#L451-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L456)
- 页面组件：[GuildServers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx)
- 布局承载：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)
- Layout variant="player"（顶部导航 + 底部 5 tab）：[Layout.tsx#L818-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L818-L995)
- 路由守卫 ProtectedRoute：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- `MyServerCard` 子组件：[GuildServers.tsx#L19-L61](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx#L19-L61)
- `RecommendCard` 子组件：[GuildServers.tsx#L64-L108](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx#L64-L108)
- 主组件 + 数据加载：[GuildServers.tsx#L110-L138](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx#L110-L138)
- API client `listServers`：[client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)
- API client `discoverRecommended`：[client.ts#L2115-L2120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2115-L2120)
- useAuth hook：[auth.tsx#L230-L236](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L230-L236)
- useDocumentTitle hook：[useDocumentTitle.ts#L11](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useDocumentTitle.ts#L11)
- useToast hook：[ToastContext.tsx#L178](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx#L178)
- 激活态映射 `/guild/servers → /guild`：[Layout.tsx#L224](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L224)

## 11. 待办与风险

- `[RISK]` **设计语言表述冲突**：[GuildServers.tsx#L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx#L7) 文件头注释自称"深色电竞风"，但项目规则 `1.md` 明确"看齐苹果的清新设计语言，严禁使用杀马特电竞风和配色"。需核实 `guild-portal.css` 的 `gp-*` 类实际视觉是否违规（若为深色霓虹风需重构为苹果浅色风）
- `[RISK]` **`Promise.all` 单点失败已部分容错但未对齐 v4.26.0 规范**：本页对每个 API 单独 `.catch(() => ({ servers: [] }))` 兜底，是 v4.26.0 B8 改造（`Promise.allSettled`）的等价写法，但风格不统一；建议后续重构为 `Promise.allSettled` 与其他页面（TunnelManagement / PlatformDashboard）对齐
- `[RISK]` **推荐服务器点击直跳详情页，无中间确认**：`RecommendCard` 直接 `navigate('/guild/servers/:id')`，若该实例对当前用户无访问权，会落到详情页 403 友好提示；体验上多一次跳转，可考虑在卡片上预判权限或加锁图标
- `[RISK]` **`/api/discover/recommended` 鉴权要求未在代码注释中明确**：[client.ts#L2115](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2115) 仅注释"公开数据"，但实际后端是否要求 JWT 未在本页核实；若公开可访问则未登录用户也能调用，需确认是否预期
- `[TODO]` 补充浏览器核对：本文档基于代码阅读产出，未实际访问 `https://gsp.ecsrz.com:3001/guild/servers` 验证 UI 行为（loading 动画、空态、卡片点击跳转）
- `[TODO]` 补充"我的服务器"与"首页 `/guild` 我的服务器卡片"的关系梳理：是否为同一数据源的两次渲染，还是首页卡片是入口、本页是完整列表
- `[TODO]` 核实 `gp-hscroll` 在桌面端的滚动条样式（是否隐藏、是否提供左右箭头）
- `[TODO]` 核实 `ServerSummary.owner_username` 在后端为空时的兜底文案"未知"是否符合预期（[GuildServers.tsx#L52](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx#L52)）
