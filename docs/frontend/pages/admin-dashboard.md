# 平台大盘（AdminDashboard）

## 1. 页面定位
> 系统管理员（server_admin+）登录 `/admin` 基座后的默认首页，集中展示平台 KPI、实例状态分布、磁盘用量与系统管理快捷入口。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin`（在 `AdminLayout` 内为 `index`）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin`
- 进入方式：
  - 已登录 `server_admin` / `system_admin` / `admin` 用户在登录后由 `RootRedirect` 分流至 `/admin`
  - 通过侧边栏「平台大盘」入口或直接访问 URL
- 退出方式：点击侧边栏其他模块跳转，或顶部用户菜单登出（由 `AdminLayout` 承载）

## 3. 角色与权限
- 允许角色：`server_admin`、`system_admin`、`admin`（由外层 `RequireRole allow={['server_admin','system_admin','admin']}` 守卫）
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx) — 未登录跳 `/login`，已登录但角色不匹配跳 `/forbidden`
- 未登录行为：`<Navigate to="/login" replace />`
- 越权行为：`<Navigate to="/forbidden" replace />`
- 后端二次鉴权：`/api/platform/overview`、`/api/admin/assets` 均挂在 `authenticateToken + requireAdmin`（`requireAdmin = requireRole(Role.SERVER_ADMIN)`）之后，instance_admin/user 即便绕过前端也会被 401/403 拒绝

## 4. 核心功能点
- KPI 卡片网格（8 张）：总用户数、实例总数、节点数、资产模板数、今日收入、30 天收入、24h 告警数、磁盘使用率
- 实例状态分布横条图（running / stopped / starting / stopping / error）
- 资源用量区块：磁盘用量进度条 + 节点健康度（healthy / total）
- 系统管理快捷入口（10 个）：权限管理、部署节点、配额管理、资产模板、审计日志、全平台总览、SSL 证书、隧道管理、API Keys、Pack 管理
- 顶部刷新按钮：手动触发数据重新加载

## 5. 交互流程
1. 路由匹配 → `RequireRole` 校验角色通过 → `AdminLayout` 渲染 → `AdminDashboard` 挂载
2. `useEffect` 触发 `refresh()`，并行调用 `getPlatformOverview()` 与 `listGlobalAssets()`（后者 `.catch` 容错，失败不阻断渲染）
3. 数据返回前显示 `ListSkeleton`（4 行骨架屏）
4. 数据返回后渲染 KPI / 状态条 / 磁盘 / 节点健康度 / 快捷入口
5. 用户点击 KPI 卡片（如「总用户数」）→ `useNavigate` 跳转对应管理页（如 `/admin/users`）
6. 用户点击「刷新」按钮 → 重新执行步骤 2，按钮上 `RefreshCw` 图标自旋（`animate-spin`）
7. 任一接口失败：`toast.error(msg)` + 错误态卡片提供「重试」按钮

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/platform/overview` | GET | `authenticateToken + requireAdmin`（server_admin+） | 拉取 KPI（用户/实例/节点/收入/告警/磁盘） | 401 未登录 / 403 非管理员 / `PANEL_INTERNAL_ERROR` 500 |
| `/api/admin/assets` | GET | `authenticateToken + requireAdmin` | 拉取全局资产模板列表，前端取 `assets.length` 作为资产模板数 KPI | 401 / 403 / `PANEL_INTERNAL_ERROR` 500 |

> 说明：`listGlobalAssets()` 失败时前端捕获并设 `assetCount = null`，KPI 卡片显示「—」，不阻断主大盘渲染。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` 客户端；`useToast()` 提供 `toast.error`
- Local state：
  - `overview: PlatformOverview | null` — 平台总览数据
  - `assetCount: number | null` — 资产模板数（null 表示加载失败或未返回）
  - `loading: boolean` — 加载态
  - `error: string | null` — 错误信息
- 副作用：`useEffect(() => void refresh(), [refresh])` 仅挂载时触发一次；`useDocumentTitle('平台大盘')` 设置页面标题；无定时器、无 WebSocket 订阅

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 `/admin` | 重定向 `/login` | `RequireRole` 守卫 |
| 角色不足（instance_admin/user） | 重定向 `/forbidden` | `RequireRole` 守卫 |
| `getPlatformOverview` 失败 | 全屏 `EmptyState` + 「重试」按钮 + `toast.error` | `error && !overview` 分支 |
| `listGlobalAssets` 失败 | 静默 `console.warn`，资产模板 KPI 显示「—」 | 非阻断降级 |
| `total_disk_capacity_mb === 0` | 取 `Math.max(total, 1)` 防除零 | `DiskUsageBar` 内已兜底 |
| 实例总数为 0 | `StatusBar` 渲染 `<EmptyState title="暂无实例" />` | `total === 0` 分支 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：苹果清新风，`bg-white` + `rounded-xl` + `shadow-sm` + slate 中性色 + 蓝/绿/琥珀/玫红/紫/青 6 色点缀；符合项目「严禁杀马特电竞风」约束
- `[UX]` 移动端适配：KPI 网格使用 `sm:grid-cols-2 lg:grid-cols-4`，状态/磁盘区使用 `lg:grid-cols-2`，快捷入口 `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`，移动端单列展示
- `[UX]` 与其他页面一致性：与 `PlatformDashboard` 共享 `PlatformOverview` 数据契约，KPI 卡片样式与 `/admin/platform` 一致；点击 KPI 跳转目标与侧边栏路由对齐
- `[UX]` 键盘可达：可点击 KPI 卡片设置 `role="button"` + `tabIndex={0}` + Enter/Space 键盘事件，符合无障碍要求（v4.25.1 改进）

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416) — `/admin` 基座门控 + `AdminLayout` + `AdminDashboard` index 路由
- 页面组件：[AdminDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AdminDashboard.tsx)
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- API client（前端）：
  - `getPlatformOverview`：[client.ts#L1391-L1394](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1391-L1394) → `request<PlatformOverview>('/platform/overview')`
  - `listGlobalAssets`：[client.ts#L2134-L2136](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2134-L2136) → `request<ListGlobalAssetsResponse>('/admin/assets')`
- 后端路由：
  - `/api/platform/overview`：[platform-stats.ts#L380](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/platform-stats.ts#L380) `router.get('/overview', ...)`
  - 挂载点：[routes-registry.ts#L942-L947](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L942-L947) `app.use('/api/platform', authenticateToken, requireAdmin, ...)`
  - `/api/admin/assets`：[assets.ts#L134](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/assets.ts#L134) `router.get('/admin/assets', requireAdmin, ...)`
- 鉴权中间件：[auth.ts#L682](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/auth.ts#L682) `requireAdmin = requireRole(Role.SERVER_ADMIN)`

## 11. 待办与风险
- `[TODO]` 接入实时刷新（如 30s 轮询或 WebSocket 推送），目前需用户手动点击「刷新」
- `[TODO]` KPI 卡片「今日收入 / 30 天收入」未提供跳转目标，可考虑跳转 `/store/reports/revenue`
- `[RISK]` `getPlatformOverview` 内部聚合多源统计（用户/实例/节点/收入/告警/磁盘），任一子查询失败将导致整接口 500，前端只能显示整页错误，建议后端按字段降级返回
- `[RISK]` `listGlobalAssets` 仅 server_admin 可调用，instance_admin 用户即便能进入页面（前端守卫已放行 server_admin+），后端会 403 但前端静默降级为「—」，未提示用户权限不足原因

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（App.tsx / AdminDashboard.tsx / api/client.ts / 后端 routes-registry.ts + platform-stats.ts + assets.ts + auth.ts）
