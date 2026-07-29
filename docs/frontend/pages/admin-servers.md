# 服务器列表（Servers）

## 1. 页面定位
> 系统管理员（server_admin+）视角的实例列表页，提供搜索/筛选/排序/分页/批量操作/CSV 导出，支持三角色差异化视图。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/servers`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/servers`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/servers`
- 进入方式：
  - `/admin` 基座侧边栏「服务器列表」入口
  - `/admin` 平台大盘 KPI「实例总数」卡片跳转至 `/instances`（注意：非本页）
  - 直接访问 URL
- 退出方式：点击侧边栏其他模块；浏览器后退回 `/admin`

## 3. 角色与权限
- 允许角色：`server_admin`、`system_admin`、`admin`（由外层 `RequireRole allow={['server_admin','system_admin','admin']}` 守卫）
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- 未登录行为：`<Navigate to="/login" replace />`
- 越权行为：`<Navigate to="/forbidden" replace />`
- 页面内角色差异化（[Servers.tsx#L67-L70](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx#L67-L70)）：
  - `server_admin` / `system_admin` / `admin`（`isServerAdmin`）：显示归属者列 + 复选框 + 批量操作；不加载配额
  - `instance_admin`（`isInstanceAdminOrHigher`）：显示归属者 + 复选框 + 批量操作；加载配额
  - `user`（`isUser`）：隐藏归属者列 + 复选框 + 批量操作栏；加载配额
- 后端鉴权：
  - `/api/servers` 仅 `authenticateToken`（普通用户也可访问，但前端门控仅 admin 可见本页）
  - `/api/batch/*` 挂载 `authenticateToken + requireAdmin`（仅 server_admin+）
  - `/api/quotas` 挂载 `authenticateToken`（任意已登录用户）

## 4. 核心功能点
- 搜索：按名称或 ID 模糊匹配（客户端过滤）
- 状态筛选：全部 / 运行中 / 已停止 / 错误
- 排序：名称 / 状态 / 创建时间，支持升降序切换
- 客户端分页：每页 20 条
- URL 状态化：`q` / `status` / `sort` / `order` / `page` 同步到 URL query（`replace: true` 不入历史栈）
- `/` 快捷键：聚焦搜索框（监听 `focus-search` 自定义事件）
- 单实例操作：详情 / 启动 / 停止 / 删除（行悬停显示，移动端常驻）
- 删除二次确认：需输入实例名称确认（`ConfirmDialog` + `requireInput`）
- 删除撤销 Toast：删除成功后显示「撤销」按钮，best-effort 恢复
- 批量操作（user 角色隐藏）：批量启动 / 停止 / 重启 / 备份（走 batch API）/ 删除（并发 `deleteMutation`）
- 配额展示（仅 instance_admin / user）：实例配额 + 磁盘配额进度条 + 配额已满 badge
- CSV 导出：当前筛选后列表（含 BOM 保证 Excel UTF-8 识别）
- 桌面端表格 + 移动端卡片列表双布局（`desktop-only` / `mobile-only`）
- 磁盘占用列：>10GB 加粗黄色警示

## 5. 交互流程
1. 路由匹配 → `RequireRole` 校验 → `Servers` 挂载
2. `useDocumentTitle('实例列表')` 设置标题
3. `useServers()` TanStack Query 拉取实例列表（`staleTime: 30s`）
4. 非 server_admin 用户：`useEffect` 调用 `api.getMyQuota()` 加载配额（失败静默）
5. 用户在工具栏输入搜索 / 选择状态 / 点击列头排序 / 翻页 → `updateParams` 更新 URL query（`replace: true`）→ `useMemo` 重新过滤/排序/分页
6. 用户点击「启动」/「停止」→ 对应 mutation（乐观更新 status → starting / stopping）→ 成功后 invalidate 列表+详情缓存
7. 用户点击「删除」→ 弹出 `ConfirmDialog` 要求输入实例名称 → 确认后 `deleteMutation.mutateAsync` → 成功显示「撤销」Toast
8. 用户选中 1+ 实例 → 批量操作栏出现 → 点击「批量启动/停止/重启/备份」走 `runBatchAction`（`window.confirm` 二次确认）→ 显示成功/失败汇总
9. 用户点击「批量删除」→ `useConfirm` 危险确认 → 并发 `Promise.allSettled` 调用 `deleteMutation` → 显示成功/失败汇总
10. 用户点击「导出 CSV」→ 生成 Blob（含 BOM）→ 触发下载
11. 用户按 `/` 键 → 全局 `focus-search` 事件 → 搜索框聚焦

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | `authenticateToken` | 实例列表（含 owner_username / disk_usage_bytes / disk_usage_updated_at） | 401 / `PANEL_INTERNAL_ERROR` 500 |
| `/api/servers/:id/start` | POST | `authenticateToken` | 启动实例（乐观更新 status → starting） | 401 / 403 / `INVALID_SERVER_STATE` 409 / 500 |
| `/api/servers/:id/stop` | POST | `authenticateToken` | 停止实例（乐观更新 status → stopping） | 401 / 403 / `INVALID_SERVER_STATE` 409 / 500 |
| `/api/servers/:id` | DELETE | `authenticateToken` | 删除实例（仅 stopped 状态可删） | 401 / 403 / `INVALID_SERVER_STATE` 409 / 404 / 500 |
| `/api/batch/start` | POST | `authenticateToken + requireAdmin` | 批量启动（body: `{instance_ids: string[]}`） | 401 / 403 / `PANEL_INTERNAL_ERROR` 500 |
| `/api/batch/stop` | POST | `authenticateToken + requireAdmin` | 批量停止 | 401 / 403 / 500 |
| `/api/batch/restart` | POST | `authenticateToken + requireAdmin` | 批量重启 | 401 / 403 / 500 |
| `/api/batch/backup` | POST | `authenticateToken + requireAdmin` | 批量备份 | 401 / 403 / 500 |
| `/api/quotas` | GET | `authenticateToken` | 当前用户配额（仅 instance_admin / user 调用） | 401 / 500 |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` + `user`；TanStack Query `useQueryClient` 管理实例缓存
- TanStack Query：
  - `useServers` — `queryKey: queryKeys.servers.list()`，`staleTime: 30s`
  - `useStartServer` / `useStopServer` / `useDeleteServer` — `useMutation`，`onMutate` 乐观更新 cache，`onSettled` invalidate 列表+详情
- Local state：
  - URL query 派生：`q` / `statusFilter` / `sortField` / `sortOrder` / `page`
  - `actioningId: string | null` — 单实例操作中标记
  - `selectedIds: Set<string>` — 批量选择（不持久化到 URL）
  - `batchActioning: boolean`
  - `confirmDeleteId` / `confirmDeleteName` — 删除二次确认
  - `localError: string | null` — 操作错误（与查询错误合并为 `displayError`）
  - `quota: MyQuotaResponse | null`
- 副作用：
  - `useEffect` 监听 `focus-search` 全局事件，挂载/卸载 add/removeEventListener
  - `useEffect` 加载配额（非 server_admin 时），带 `cancelled` 防抖
  - `useDocumentTitle('实例列表')`
  - URL 状态化通过 `setSearchParams(next, { replace: true })`
  - 无定时器、无 WS 订阅

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | 重定向 `/login` | `RequireRole` 守卫 |
| 角色不足 | 重定向 `/forbidden` | `RequireRole` 守卫 |
| `useServers` 查询失败 | `displayError` 顶部 alert（合并 `localError`） | `(error as Error).message` |
| 列表为空 | `EmptyState`「还没有服务器」+「点击创建服务器开始」 | `servers.length === 0` 分支 |
| 筛选后为空 | `EmptyState`「没有匹配的结果」+「没有匹配筛选条件的服务器」 | `sortedServers.length === 0` 分支 |
| 启动失败 | `localError` 顶部 alert | `INVALID_SERVER_STATE` 等错误码 |
| 停止失败 | `localError` 顶部 alert | 同上 |
| 删除失败 + `INVALID_SERVER_STATE` | `localError` 显示「仅 stopped 状态可删除」 | 特定错误码映射 |
| 批量操作部分失败 | `toast.error` 显示「成功 X 个，失败 Y 个」+ 失败详情（换行展开） | `BatchActionResponse.results` 遍历 |
| 批量删除部分失败 | `toast.warning` 显示「成功 X 个，失败 Y 个」 | `Promise.allSettled` 汇总 |
| `getMyQuota` 失败 | 静默（`.catch(() => {})`） | 不阻断主列表 |
| `page` URL 参数非数字 / <1 | 回退到 1 | `Number.isNaN` 校验 |
| `page` 超出总页数 | `safePage = Math.min(page, totalPages)` | 已兜底 |
| 启动按钮 disabled | `s.status !== 'stopped'` 时禁用 | 防止误操作 |
| 停止按钮 disabled | `s.status !== 'running' && s.status !== 'starting'` 时禁用 | 防止误操作 |
| 删除按钮 disabled | `s.status !== 'stopped'` 时禁用 | 后端会再次校验 |
| 磁盘占用 > 10GB | 加粗 + 黄色 `var(--color-warning)` | 视觉警示 |
| 配额已满 | `badge badge-error`「配额已满」+ 进度条变红 | `can_create_instance === false` |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用项目 CSS 类（`page` / `page-header` / `toolbar` / `data-table` / `badge` / `btn`），符合苹果清新风；状态 badge 5 色（stopped/starting/running/stopping/error）与全局一致
- `[UX]` 移动端适配：`desktop-only` 表格 + `mobile-only` 卡片双布局；移动端操作按钮常驻可见（不靠悬停）；配额进度条 `flexWrap: wrap`
- `[UX]` 与其他页面一致性：`useDocumentTitle('实例列表')` 与其他 admin 页面一致；状态 badge 与 `/admin` 大盘、`/admin/platform` 一致
- `[UX]` 键盘可达：搜索框 `aria-label`、列头排序按钮 `aria-label`、复选框 `aria-label`、`/` 快捷键聚焦搜索框
- `[UX]` 一致性问题：本页 URL 路径为 `/admin/servers`，但页面内点击实例名称/「详情」按钮跳转至 `/instances/:id`（玩家/普通用户视图），而非 `/admin/servers/:id`（系统管理员视图）；标题用「服务器列表」但 `useDocumentTitle` 写「实例列表」，存在术语不一致

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L375](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L375) `<Route path="servers" element={<Servers />} />`（位于 [App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416) 的 admin 基座内）
- 页面组件：[Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx)
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- TanStack Query hooks：[queries/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/queries/servers.ts) — `useServers` / `useStartServer` / `useStopServer` / `useDeleteServer`
- 撤销 Toast hook：[useUndoToast.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useUndoToast.ts)
- 确认对话框：[ConfirmDialog.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ConfirmDialog.tsx)
- API client（前端）：
  - `listServers`：[client.ts#L579-L582](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L579-L582) → `request<ListServersResponse>('/servers')`
  - `batchStart/Stop/Restart/Backup`：[client.ts#L1432-L1445](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1432-L1445) → `request<BatchActionResponse>('/batch/{action}')`
  - `getMyQuota`：[client.ts#L1341-L1343](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1341-L1343) → `request<MyQuotaResponse>('/quotas')`
- 后端路由挂载点：
  - 实例：[routes-registry.ts#L814](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L814) `app.use('/api/servers', authenticateToken, createServersRouter(...))`
  - 批量：[routes-registry.ts#L950-L953](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L950-L953) `app.use('/api/batch', authenticateToken, requireAdmin, ...)`
  - 配额：[routes-registry.ts#L931](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L931) `app.use('/api/quotas', authenticateToken, createQuotasRouter(...))`

## 11. 待办与风险
- `[TODO]` 本页 URL 路径 `/admin/servers` 与页面内跳转目标 `/instances/:id` 不一致，应明确本页是「管理员实例治理」入口还是「所有用户实例列表」入口；若为前者，跳转应改为 `/admin/servers/:id`
- `[TODO]` 页面标题用「服务器列表」，`useDocumentTitle` 写「实例列表」，术语不统一，建议全局统一为「实例」（项目其他位置已大量使用「实例」）
- `[TODO]` 批量删除使用 `Promise.allSettled` 并发调用单删除接口，N 个实例会产生 N 个请求；可考虑后端补 `/api/batch/delete` 批量接口
- `[TODO]` CSV 导出仅导出当前筛选后的列表，无「导出全部」选项；文件名包含日期但无时间，同一天多次导出会覆盖
- `[TODO]` 搜索仅支持名称 + ID，不支持按游戏类型/归属者搜索
- `[RISK]` 本页挂在 `/admin/servers`（server_admin+ 守卫），但页面内角色差异化逻辑支持 `instance_admin` / `user`（`isUser` 分支）；若直接访问 `/admin/servers` 会被守卫拦截，但本组件被复用的场景（如 `/instances`）需注意角色兼容
- `[RISK]` 批量操作 `window.confirm` 与 `useConfirm`（ConfirmDialog）两种确认模式混用：批量启动/停止/重启/备份用 `window.confirm`，批量删除用 `useConfirm`，体验不一致
- `[RISK]` 删除撤销 Toast 的「撤销」按钮实际仅 `refetch` 列表检查实例是否仍存在，并非真正撤销；后端若已物理删除则无法恢复，但 UI 文案「已删除实例「X」」+「撤销」按钮可能误导用户
- `[RISK]` URL 状态化用 `replace: true` 不入历史栈，浏览器后退无法回到上一个筛选状态
- `[RISK]` `useServers` 的 `staleTime: 30s` 内批量操作完成后通过 `invalidateQueries` 强制刷新，但若 invalidate 失败（如网络瞬断）会导致列表与实际状态不一致
- `[RISK]` 配额进度条 `quota.quota.max_instances` 为 `null` 时不渲染该进度条，但 `quota.usage.instances_used` 仍可能存在，UI 信息不完整

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（App.tsx / Servers.tsx / api/queries/servers.ts / api/client.ts / 后端 routes-registry.ts）
