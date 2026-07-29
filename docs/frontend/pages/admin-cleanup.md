# 实例清理

## 1. 页面定位
> 系统管理员批量清理"标记为待删除"的闲置实例：确认删除或忽略标记，附全量实例概览，避免误删与漏清。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/cleanup`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/cleanup`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/cleanup`
- 进入方式：`/admin` 基座侧边栏导航；直接访问 URL
- 退出方式：点击侧边栏切换到其他 `/admin/*` 页面；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 后端级：`/api/admin/*` 在 `routes-registry.ts` 中挂载 `requireAdmin`（等价 `requireRole(SERVER_ADMIN)`）中间件
- 未登录行为：`RequireRole` 上游重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`；后端 401/403

## 4. 核心功能点
- 「待清理实例」卡片：仅展示 `marked_for_deletion=true` 的实例，附数量 badge
- 表格列：实例名 / Pack / 游戏 / 当前版本 / 归属者 / 闲置天数 / 更新版本数 / 操作
- 「确认删除」按钮：仅在 `inst.status === 'stopped'` 时可点击，避免运行中实例被删
- 「忽略」按钮：取消该实例的待清理标记
- 「全部实例概览」卡片：展示所有实例的状态、闲置天数、更新版本数、标记
- 顶部刷新按钮

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `api.listCleanupInstances()` → 拆分两个卡片渲染
2. 点击「确认删除」→ `api.confirmCleanupDelete(id)` → toast.success → 自动 refresh
3. 点击「忽略」→ `api.ignoreCleanup(id)` → toast.success → 自动 refresh
4. 失败 → toast.error 展示错误信息

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/admin/cleanup-instances` | GET | JWT + `requireAdmin` | 列出全部实例（含 marked_for_deletion 标记、idle_days、newer_versions_count） | 401 未认证；403 越权 |
| `/api/admin/cleanup-instances/:id/confirm-delete` | POST | JWT + `requireAdmin` | 确认删除指定实例（调用 SafeRemoveService） | 404 SERVER_NOT_FOUND；409 SERVER_NOT_STOPPED |
| `/api/admin/cleanup-instances/:id/ignore` | POST | JWT + `requireAdmin` | 取消待清理标记 | 404 SERVER_NOT_FOUND |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供全局 toast
- Local state：
  - `[STATE]` `instances` / `loading` / `error` — 列表与加载态
  - `[STATE]` `actioning: string | null` — 当前正在操作的实例 ID（用于按钮 disabled）
- 副作用（订阅 / 定时器 / WS）：无；仅 `useEffect` 挂载时触发一次 `refresh`
- 派生：`markedForDeletion = instances.filter(i => i.marked_for_deletion)` — 前端筛选待清理

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 列表为空（待清理） | `<div className="empty-state">暂无待清理实例</div>` | 显示在第一个卡片内 |
| 全部实例为空 | `<div className="empty-state">暂无实例</div>` | 显示在第二个卡片内 |
| 列表加载中 | 两个卡片均显示"加载中…" | `loading=true` |
| 列表加载失败 | 顶部 alert-error 展示 error.message | 不阻塞卡片骨架 |
| 删除运行中实例 | 「确认删除」按钮 disabled | `inst.status !== 'stopped'` 时禁用 |
| 操作中重复点击 | 同一实例两个按钮均 disabled | `actioning === inst.id` |
| 删除/忽略失败 | toast.error 展示 error.message | 不刷新列表 |
| 越权访问 | 后端 403 → toast.error | 由 client 转 PanelApiError |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 `info-card` / `card-title` / `badge badge-error` / `data-table`，与其他 admin 页一致；badge 颜色使用 status 直接拼接（`badge-${inst.status}`），若 status 不在预定义类名内会渲染空样式
- `[UX]` 移动端适配：表格 `.table-wrap` 横向滚动；两卡片纵向堆叠 `marginBottom: 16`；未做窄屏专属优化
- `[UX]` 与其他页面一致性：使用 `useDocumentTitle('实例清理')`，与 maintenance/quotas 一致；但本页未使用 `useConfirm` 二次确认，删除是直接按钮（依赖按钮 disabled 状态）
- `[UX]` 顶部无 page-actions 之外的说明文案，新用户可能不清楚"待清理"是什么时候被标记的

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/cleanup` 在 L393）
- 页面组件：[CleanupPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CleanupPage.tsx)
- 关键 hook：`useAuth`（`../api/auth`）；`useToast`（`../components/ui`）；`useDocumentTitle`（`../hooks/useDocumentTitle`）
- API client：
  - `api.listCleanupInstances()` → [client.ts#L1694-L1698](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1694-L1698)
  - `api.confirmCleanupDelete(id)` → [client.ts#L1699-L1704](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1699-L1704)
  - `api.ignoreCleanup(id)` → [client.ts#L1705-L1710](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1705-L1710)
- 后端路由：[cleanup.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/cleanup.ts)（L50/144/200）
- 路由挂载：[routes-registry.ts#L910](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L910) `app.use('/api/admin', authenticateToken(JWT_SECRET), requireAdmin, createCleanupRouter(...))`

## 11. 待办与风险
- `[TODO]` 顶部补一段 alert-info 说明"待清理"实例的判定规则（闲置 N 天 + 落后 N 个版本），避免管理员不知道标记来源
- `[TODO]` 「确认删除」按钮可加上 `useConfirm` 二次确认弹窗，与 maintenance/quotas 的危险操作一致
- `[TODO]` 第二张表「全部实例概览」未分页，实例数 > 1000 时性能与可读性差
- `[RISK]` `badge-${inst.status}` 直接拼类名，若后端新增 status 值（如 `starting`）会得到无样式的 badge，视觉退化
- `[RISK]` 「确认删除」依赖前端 `inst.status === 'stopped'` 判断，但 status 是列表加载时的快照；若加载后实例被启动，按钮仍可点击（实际后端会 409 SERVER_NOT_STOPPED 拦截，但用户体验差）
- `[RISK]` `confirmCleanupDelete` 调用 `SafeRemoveService` 实际执行文件系统删除，UI 无 dry-run 预览；误删风险高

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
