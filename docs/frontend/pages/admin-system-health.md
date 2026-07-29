# 系统监控（SystemHealth）

## 1. 页面定位
> 系统管理员（server_admin+）的运维监控中枢，4-Tab 聚合实时指标 / 实时曲线（WS）/ 一键诊断 / 节点磁盘概览，并对接口缺失做优雅降级。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/system-health`（支持 `?tab=metrics|realtime|diagnostics|disk`，默认 `metrics`）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/system-health`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/system-health`
- 进入方式：
  - 侧边栏「系统监控」入口
  - `/admin/diagnostics` 重定向至 `/admin/system-health?tab=diagnostics`（向后兼容）
  - 直接访问 URL
- 退出方式：点击侧边栏其他模块跳转；浏览器后退回 `/admin`

## 3. 角色与权限
- 允许角色：`server_admin`、`system_admin`、`admin`
- 守卫组件：
  - 外层 `RequireRole allow={['server_admin','system_admin','admin']}`（`/admin` 基座）
  - 内层第二层 `RequireRole allow={['server_admin','system_admin','admin']}`（`/admin/system-health` 所在分支，[App.tsx#L378](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L378)）
  - 组件内 `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`（[SystemHealth.tsx#L254-L256](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemHealth.tsx#L254-L256)）— 第三道防线
- 未登录行为：`<Navigate to="/login" replace />`
- 越权行为：`<Navigate to="/forbidden" replace />`
- 后端鉴权：
  - `/api/system/metrics`、`/api/system/health` 仅 `authenticateToken`（普通用户也可访问，但前端门控仅 admin 可见）
  - `/api/nodes`、`/api/nodes/:id/disk-usage`、`/api/servers` 仅 `authenticateToken`（无 requireAdmin，但节点创建/删除子端点带 requireAdmin）

## 4. 核心功能点
- **Tab 1 实时指标**：
  - 系统资源卡片（CPU / 内存 / 磁盘 使用率 + 颜色进度条 green/yellow/red）
  - 服务状态表格（服务名 / 状态 badge / 延迟 / 备注）
  - 实例概览（在线实例数 / 总实例数 / 系统运行时长）
- **Tab 2 实时监控曲线**：
  - WebSocket 实时 CPU / 内存 / 磁盘曲线（Sparkline SVG，采样间隔 2s，保留 1 小时 / 1800 条）
  - Panel 进程指标（RSS / 进程 CPU / WS 连接数 / 最后更新时间）
  - 连接状态提示（已连接 / 断开 badge）
- **Tab 3 一键诊断**：内嵌 `Diagnostics` 组件（`<Diagnostics embedded />`）
- **Tab 4 磁盘概览**：节点磁盘总览卡片网格（节点 ID / 使用率进度条 / 已用-总量 / 挂载点·文件系统，>80% 显示红色警告）
- URL Query 同步：切换 Tab 时 `setSearchParams({ tab }, { replace: true })`；浏览器前进/后退同步 Tab 状态
- 顶部刷新按钮（仅 metrics Tab 显示）

## 5. 交互流程
1. 路由匹配 → 双层 `RequireRole` 校验 → `SystemHealth` 挂载 → `isAdminRole` 三次校验
2. `useEffect` 触发 `refresh()`：并行 4 路 `Promise.allSettled`（互不阻断）
   - `getSystemMetrics()` → `setMetrics` / `setMetricsUnavailable`
   - `getSystemHealth()` → `setHealth` / `setHealthUnavailable`
   - `listServers()` → `setServers`（失败仅清空 + 非静默错误进 `error`）
   - `listNodes()` → 并行 `getNodeDiskUsage(n.id)` → `setNodeDiskUsages`
3. URL `?tab=` 与 `activeTab` state 双向同步（`useSearchParams` + `useEffect` 监听）
4. 用户点击 Tab → `switchTab` 更新 state + URL（`replace: true` 不入历史栈）
5. metrics Tab 全部接口 404/网络错误 → 显示「系统监控接口暂未开放」占位
6. realtime Tab 挂载 `RealtimeMonitorPanel`：订阅 `systemMonitorStore` + 拉取历史 1800 条
7. realtime Tab 卸载时 `unsubscribe()` 退订 WS，避免内存泄漏
8. 用户点击「刷新」按钮（仅 metrics Tab）→ 重新执行步骤 2

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/system/metrics` | GET | `authenticateToken`（普通用户可访问） | CPU/内存/磁盘/负载/运行时间快照 | `SYSTEM_METRICS_001` 500 / 401 |
| `/api/system/health` | GET | `authenticateToken` | backend/database/daemon 服务健康聚合 | `SYSTEM_METRICS_001` 500 / 401 |
| `/api/servers` | GET | `authenticateToken` | 实例列表（用于在线实例数统计） | 401 / `PANEL_INTERNAL_ERROR` 500 |
| `/api/nodes` | GET | `authenticateToken` | 节点列表（用于后续拉取每个节点的磁盘占用） | 401 / 500 |
| `/api/nodes/:id/disk-usage` | GET | `authenticateToken` | 单节点磁盘占用（df -B1 解析） | 401 / 404 节点不存在 / 500 |
| `[STATE]` WebSocket `system_monitor` 事件 | WS | `authenticateToken`（JWT 透传） | 实时 CPU/内存/磁盘/进程指标推送（2s 采样） | WS 断开时显示「断开」badge |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` + `user`；`systemMonitorStore`（前端独立 store，订阅 WS 事件）
- Local state：
  - `activeTab: 'metrics' \| 'realtime' \| 'diagnostics' \| 'disk'`
  - `metrics / health / servers / nodeDiskUsages` 四组业务数据
  - `metricsUnavailable / healthUnavailable / nodeDiskUnavailable: boolean` — 接口降级标记
  - `loading / error` 全局态
  - `events: PanelSystemMonitorEvent[]`（RealtimeMonitorPanel 内部，1800 条上限）
  - `connected: boolean`（RealtimeMonitorPanel 内部，WS 连接态）
- 副作用：
  - `useEffect(() => void refresh(), [refresh])` — 挂载时拉取数据
  - `useEffect` 监听 `searchParams` 同步 `activeTab`（浏览器前进/后退）
  - RealtimeMonitorPanel `useEffect` 订阅 `systemMonitorStore.subscribe` + `subscribeConnection`，卸载时 `unsubscribe()`
  - `useDocumentTitle` 未调用（本页未设置标题）
  - 无定时器轮询（realtime 靠 WS 推送）

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | 重定向 `/login` | `RequireRole` 守卫 |
| 角色不足（instance_admin/user） | 三道防线均跳 `/forbidden` | 外层 + 内层 + 组件内 `isAdminRole` |
| `/system/metrics` 404/网络错误 | `metricsUnavailable=true`，MetricCard 显示「接口暂未开放」 | `isEndpointUnavailable` 判定 |
| `/system/health` 404/网络错误 | `healthUnavailable=true`，显示「健康检查接口暂未开放」 | 独立降级 |
| `/nodes` 或 `/nodes/:id/disk-usage` 失败 | `nodeDiskUnavailable=true`，磁盘概览 Tab 显示「节点磁盘接口暂未开放」 | 独立降级 |
| `/servers` 失败 | `servers=[]`，在线实例数显示 0；非 404 错误进 `error` 顶部 alert | 不阻断 metrics 其他区块 |
| metrics + health 同时不可用 | 显示「系统监控接口暂未开放」整页占位 | `allUnavailable` 分支 |
| WS 断开 | RealtimeMonitorPanel 显示「断开」红色 badge，曲线停滞在最后一条数据 | `connected=false` |
| WS 历史数据 < 2 条 | Sparkline 显示「暂无足够数据点（至少需要 2 次采样）」 | `points.length < 2` 分支 |
| `events` 超 1800 条 | `next.slice(-1800)` 截断，避免内存无界增长 | 已限流 |
| 磁盘使用率 > 80% | 节点卡片显示红色警告 + 红色加粗百分比 | `isOver80` 分支 |
| CPU/内存/磁盘使用率分级 | green(<70) / yellow(<90) / red(>=90) / unknown(无数据) | `usageLevel` 函数 |
| `memTotalMb` 或 `diskTotalGb` 缺失 | `percentOf` 返回 `undefined`，进度条显示「暂无数据」 | 已兜底 |
| `total <= 0` | `percentOf` 返回 `undefined` 防除零 | 已兜底 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用项目 CSS 类（`info-card` / `card-title` / `form-hint` / `badge-running` / `badge-error` / `tab-btn`），符合苹果清新风；进度条颜色用 `#16a34a`/`#d97706`/`#dc2626` 三色分级
- `[UX]` 移动端适配：MetricCard 网格 `minmax(240px, 1fr)`、节点磁盘网格 `minmax(280px, 1fr)`、Sparkline 网格 `minmax(360px, 1fr)`，移动端单列；Sparkline 使用 `viewBox` 自适应宽度
- `[UX]` 与其他页面一致性：与 `/admin/diagnostics`（已合并为本页 Tab）使用 `<Diagnostics embedded />` 复用；服务状态 badge 样式与实例状态 badge 一致
- `[UX]` 键盘可达：Tab 按钮使用 `role="tab"` + `aria-selected`，符合 ARIA Tab 模式
- `[UX]` 一致性问题：本页未调用 `useDocumentTitle`，与 `/admin` / `/admin/platform` 不一致（其他页都设置了标题）；URL Query Tab 同步使用 `replace: true` 不入历史栈，浏览器后退无法回到上一个 Tab

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L383](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L383) `<Route path="system-health" element={<SystemHealth />} />`（位于 [App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416) 的 admin 基座内层 `RequireRole` 分支）
- 旧路由重定向：[App.tsx#L385](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L385) `<Route path="diagnostics" element={<Navigate to="/admin/system-health?tab=diagnostics" replace />} />`
- 页面组件：[SystemHealth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemHealth.tsx)
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- 角色工具：[role.ts#L5-L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L5-L7) `isAdminRole`
- WS Store：[systemMonitorStore.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/systemMonitorStore.ts)（订阅 `system_monitor` 事件）
- 嵌入组件：[Diagnostics.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Diagnostics.tsx)
- API client（前端）：
  - `getSystemMetrics`：[client.ts#L1764-L1774](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1764-L1774) → `request<...>('/system/metrics')`
  - `getSystemHealth`：[client.ts#L1776](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1776) → `request<...>('/system/health')`
  - `listServers`：[client.ts#L579-L582](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L579-L582) → `request<ListServersResponse>('/servers')`
  - `listNodes`：[client.ts#L573-L575](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L573-L575) → `request<ListNodesResponse>('/nodes')`
  - `getNodeDiskUsage`：[client.ts#L1596-L1599](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1596-L1599) → `request<...>('/nodes/:id/disk-usage')`
- 后端路由：
  - 系统指标 + 健康：[systemMetricsRoute.ts#L32-L53](file:///home/airxw/Documents/gsp/gameserver-panel/modules/模块1_系统监控/systemMetricsRoute.ts#L32-L53) `router.get('/metrics')` + `router.get('/health')`
  - 挂载点：[routes-registry.ts#L978-L979](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L978-L979) `app.use('/api/system', authenticateToken, createSystemMetricsRouter())`
  - 节点磁盘：[nodes.ts#L334](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts#L334) `GET /api/nodes/:id/disk-usage`
  - 节点挂载点：[routes-registry.ts#L813](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L813) `app.use('/api/nodes', authenticateToken, createNodesRouter(...))`
  - 实例挂载点：[routes-registry.ts#L814](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L814) `app.use('/api/servers', authenticateToken, createServersRouter(...))`

## 11. 待办与风险
- `[TODO]` 本页未调用 `useDocumentTitle`，与其他 admin 页面不一致，建议补充 `useDocumentTitle('系统监控')`
- `[TODO]` Tab 切换使用 `replace: true` 不入历史栈，浏览器后退无法回到上一个 Tab，可考虑改为 `push` 模式或提供返回按钮
- `[TODO]` `listNodes` + 并行 `getNodeDiskUsage` 在节点数多时会产生 N+1 请求，可考虑后端聚合接口 `/api/nodes/disk-usage`（批量返回）
- `[TODO]` RealtimeMonitorPanel 的 `events` state 在组件外层 store 已保留，组件内又复制一份（1800 条），存在内存冗余
- `[RISK]` `/api/system/metrics` 与 `/api/system/health` 后端仅 `authenticateToken`（普通用户可访问），但页面通过三层门控仅 admin 可见；若后端接口被普通用户直接调用会泄露系统资源信息，建议后端追加 `requireAdmin`
- `[RISK]` `nodeDiskUsages` 中若多个节点返回同一 `node_id` 会触发 React `key` 冲突（虽然实际不会，但代码未防御）
- `[RISK]` RealtimeMonitorPanel 在 `events.length > 1800` 时使用 `next.slice(-1800)` 创建新数组，每次推送都会触发 1800 元素的拷贝，高频推送下性能开销大
- `[RISK]` Sparkline 使用 `preserveAspectRatio="none"` 会拉伸 SVG，曲线在窄屏下会变形

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（App.tsx / SystemHealth.tsx / utils/role.ts / api/client.ts / 后端 systemMetricsRoute.ts + nodes.ts + routes-registry.ts）
