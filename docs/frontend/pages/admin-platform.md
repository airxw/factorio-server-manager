# 全平台总览（PlatformDashboard）

## 1. 页面定位
> 系统管理员（server_admin+）专属的平台级运维仪表盘，提供用户/实例/节点/收入/磁盘/告警的全维度统计与趋势可视化。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/platform`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/platform`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/platform`
- 进入方式：
  - `/admin` 平台大盘 KPI 卡片点击「查看详情」或告警/磁盘卡片跳转
  - 侧边栏「全平台总览」入口
  - 直接访问 URL
- 退出方式：点击侧边栏其他模块跳转；浏览器后退回 `/admin`

## 3. 角色与权限
- 允许角色：`server_admin`、`system_admin`、`admin`
- 守卫组件：外层 `RequireRole allow={['server_admin','system_admin','admin']}`（`/admin` 基座）+ 内层第二层 `RequireRole allow={['server_admin','system_admin','admin']}`（`/admin/platform` 所在分支）
- 未登录行为：`<Navigate to="/login" replace />`
- 越权行为：`<Navigate to="/forbidden" replace />`
- 后端二次鉴权：`/api/platform/*` 在 [routes-registry.ts#L944-L947](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L944-L947) 统一挂在 `authenticateToken(JWT_SECRET) + requireAdmin` 之后，仅 `server_admin` 可访问

## 4. 核心功能点
- KPI 卡片网格（6 张）：总用户数、24h 活跃用户、实例数（运行/总）、节点数（健康/总）、今日收入、30 天收入
- 告警条：近 24h 告警数 > 0 时显示橙色告警 banner
- 实例状态分布横条图（running / stopped / error 三段）
- 用户活跃度曲线（24h / 30d 可切换）+ SVG 折线图（含面积渐变）
- 收入趋势曲线（30 天）+ SVG 折线图
- 磁盘用量 Top 10 表格（实例 ID / 名称 / 归属者 / 用量 MB）
- 顶部刷新按钮 + 各子区块的错误重试按钮

## 5. 交互流程
1. 路由匹配 → 双层 `RequireRole` 校验通过 → `AdminLayout` 渲染 → `PlatformDashboard` 挂载
2. `useEffect` 触发 `refresh()`，并行调用 4 个接口：`getPlatformOverview` + `getPlatformUsersTrend('30d')` + `getPlatformRevenueTrend(30)` + `getDiskUsageTop(10)`
3. 数据返回前显示 `ListSkeleton` 骨架屏
4. 数据返回后渲染 KPI / 告警条 / 状态分布 / 用户曲线 / 收入曲线 / 磁盘 Top10 表
5. 用户在「用户活跃度」区块点击 24h / 30d 切换按钮 → `setUserRange` 触发 `refresh` 依赖变更 → `useEffect` 重新调用 `getPlatformUsersTrend(newRange)`
6. 用户点击 KPI 卡片（如「总用户数」）→ `useNavigate` 跳转 `/admin/users` / `/instances` / `/admin/nodes`
7. 任一接口失败：`error-banner` 显示错误信息 + 重试按钮（不区分哪个接口失败，整体降级）

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/platform/overview` | GET | `authenticateToken + requireAdmin` | 平台总览 KPI（用户/实例/节点/收入/告警/磁盘） | 401 / 403 / `PANEL_INTERNAL_ERROR` 500 |
| `/api/platform/users?range=24h\|30d` | GET | `authenticateToken + requireAdmin` | 用户活跃度曲线 points[{date, active_users}] | 400 非法 range / 401 / 403 / 500 |
| `/api/platform/revenue?days=30` | GET | `authenticateToken + requireAdmin` | 收入趋势曲线 points[{date, revenue}] | 400 非法 days / 401 / 403 / 500 |
| `/api/platform/disk-usage-top?limit=10` | GET | `authenticateToken + requireAdmin` | 磁盘占用 TopN 实例 items[{instance_id, name, owner, used_mb}] | 400 非法 limit / 401 / 403 / 500 |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` 客户端
- Local state：
  - `overview: PlatformOverview | null`
  - `usersTrend: PlatformUsersTrendResponse | null`
  - `revenue: PlatformRevenueTrendResponse | null`
  - `diskTop: DiskUsageTopResponse | null`
  - `loading: boolean`
  - `error: string | null`
  - `userRange: '24h' \| '30d'`（默认 `'30d'`）
- 副作用：`useEffect(() => void refresh(), [refresh])`，`refresh` 依赖 `userRange`，切换 range 触发重新加载；`useDocumentTitle('全平台总览')`；无定时器、无 WS 订阅

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | 重定向 `/login` | `RequireRole` 守卫 |
| 角色不足 | 重定向 `/forbidden` | `RequireRole` 守卫 |
| 4 接口任一失败 | 整页 `error-banner` + 重试按钮；如已有 overview 则保留旧数据 + 顶部显示错误条 | `Promise.all` 任一 reject 即触发 catch |
| `userRange` 切换时 `loading=true` | 切换按钮 disabled + 显示「加载中…」 | 防止重复点击 |
| `instance_status_distribution` 总数为 0 | `StatusBar` 显示 `<EmptyState title="暂无实例" />` | `total === 0` 分支 |
| `diskTop.items` 为空 | 显示 `<EmptyState title="暂无磁盘用量数据" />` | 已处理空态 |
| `usersTrend.points` 或 `revenue.points` 为空 | `LineChart` 显示 `<EmptyState title="暂无X数据" />` | `data.length === 0` 分支 |
| `LineChart` 数据点 > 30 | 不渲染圆点与日期标签，避免重叠 | `showLabels = data.length <= 30` |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用项目 CSS 变量（`var(--color-success)` / `var(--color-primary)` / `var(--color-text-secondary)` 等），符合苹果清新风；与 `/admin` 大盘共用 KPI 卡片视觉
- `[UX]` 移动端适配：KPI 网格 `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`，告警+状态条 `minmax(320px, 1fr)`，移动端自动单列；`LineChart` 使用 `viewBox` + `preserveAspectRatio="none"` 自适应宽度
- `[UX]` 与其他页面一致性：与 `AdminDashboard` 共享 `PlatformOverview` 契约；KPI 卡片点击跳转目标一致（`/admin/users` / `/instances` / `/admin/nodes`）
- `[UX]` 键盘可达：KPI 卡片 `role="button"` + `tabIndex={0}` + Enter/Space 键盘事件
- `[UX]` 一致性问题：本页 KPI 卡片使用 `info-card` + CSS 变量风格，与 `/admin` 大盘的 `bg-white rounded-xl shadow-sm` Tailwind 风格不统一（两套样式系统并存）

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L399](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L399) `<Route path="platform" element={<PlatformDashboard />} />`（位于 [App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416) 的 admin 基座内）
- 页面组件：[PlatformDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlatformDashboard.tsx)
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- API client（前端）：
  - `getPlatformOverview`：[client.ts#L1391-L1394](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1391-L1394)
  - `getPlatformUsersTrend`：[client.ts#L1396-L1400](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1396-L1400)
  - `getPlatformRevenueTrend`：[client.ts#L1401-L1405](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1401-L1405)
  - `getDiskUsageTop`：[client.ts#L1406-L1409](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1406-L1409)
- 后端路由：[platform-stats.ts#L378-L425](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/platform-stats.ts#L378-L425) — `/overview` / `/users` / `/revenue` / `/disk-usage-top`
- 挂载点：[routes-registry.ts#L942-L947](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L942-L947) `app.use('/api/platform', authenticateToken, requireAdmin, ...)`
- 鉴权中间件：[auth.ts#L682](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/auth.ts#L682)

## 11. 待办与风险
- `[TODO]` `LineChart` 为自研 SVG 简易图，缺少 tooltip 交互、缺少 X 轴等距日期刻度，可考虑接入 ECharts/Recharts
- `[TODO]` 收入趋势曲线无时间范围切换（固定 30 天），与用户曲线可切换 24h/30d 不一致
- `[TODO]` 磁盘 TopN 表格无分页/排序，仅显示前 10 条
- `[RISK]` `Promise.all` 任一接口失败导致整体降级（无部分成功保留），与 `/admin` 大盘的「listGlobalAssets 容错降级」模式不一致；建议改用 `Promise.allSettled` 按字段降级
- `[RISK]` `LineChart` 使用 `preserveAspectRatio="none"` 会拉伸 SVG，数据点圆点会变形为椭圆，且文本标签也会被横向拉伸失真
- `[RISK]` KPI 卡片样式与 `/admin` 大盘不统一（`info-card` vs Tailwind `bg-white rounded-xl`），存在两套样式系统并存的风险

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（App.tsx / PlatformDashboard.tsx / api/client.ts / 后端 platform-stats.ts + routes-registry.ts + auth.ts）
