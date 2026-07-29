# 运维清理

## 1. 页面定位
> 系统管理员统一管理四张日志表（audit_logs / user_notifications / item_sync_log / chat_logs）的 retention 与手动清理，附 scheduler 状态展示。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/maintenance`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/maintenance`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/maintenance`
- 进入方式：`/admin` 基座侧边栏导航；直接访问 URL
- 退出方式：点击侧边栏切换到其他 `/admin/*` 页面；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 后端级：`/api/admin/maintenance/*` 在 `routes-registry.ts` 中挂载 `requireAdmin`
- 未登录行为：`RequireRole` 上游重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`；后端 401/403

## 4. 核心功能点
- 顶部状态徽章：scheduler 启用状态（每 24h 自动执行）
- 一键清理全部按钮：触发四张表批量清理（二次确认）
- 四张表概览：表名（中英对照） / 行数 / retention（天） / 上次清理时间 / 操作
- 单表清理按钮：立即触发指定表清理（二次确认）
- retention 在线编辑：前 3 张表可编辑（1-365 整数），chat_logs 来自 Pack 配置不可编辑
- 上次清理结果详情：展示最近一次清理的表名 + 删除行数
- 底部说明区：解释 retention_days / chat_logs 来源 / 定时清理 / 手动清理

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `api.getMaintenanceOverview()` → 渲染表格
2. 点击「清理」（单表）→ `useConfirm` 二次确认 → `api.triggerCleanup({ table_name })` → toast.success → 自动 refresh
3. 点击「一键清理全部」→ `useConfirm` 二次确认 → `api.triggerCleanup({})` → toast.success → 自动 refresh
4. 点击「编辑 retention」→ 行内 input + 保存/取消 → `api.updateRetention({ table_name, retention_days })` → toast.success → 自动 refresh
5. 失败 → toast.error 展示错误信息

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/admin/maintenance/overview` | GET | JWT + `requireAdmin` | 获取四张表行数 / retention / 上次清理时间 / scheduler 状态 | 500 PANEL_INTERNAL_ERROR |
| `/api/admin/maintenance/cleanup` | POST | JWT + `requireAdmin` | 触发清理（body 含 table_name 走单表，空 body 走全部） | 400 MAINTENANCE_TABLE_NOT_FOUND；500 PANEL_INTERNAL_ERROR |
| `/api/admin/maintenance/retention` | PUT | JWT + `requireAdmin` | 修改指定表 retention_days（1-365） | 400 PANEL_VALIDATION_ERROR；404 TABLE_NOT_EDITABLE |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useConfirm()` 提供二次确认；`useToast()` 提供 toast
- Local state：
  - `[STATE]` `overview` / `loading` / `error` — 概览与加载态
  - `[STATE]` `cleaningTable: MaintenanceTableName | 'all' | null` — 当前清理中的表
  - `[STATE]` `cleaningAll` — 是否一键清理中
  - `[STATE]` `editingTable` / `editingValue` / `savingRetention` — retention 编辑态
  - `[STATE]` `lastCleanupResult` — 上次清理结果
- 副作用（订阅 / 定时器 / WS）：无；仅 `useEffect` 挂载时触发一次 `refresh`
- 常量映射：`TABLE_LABELS`（中英文对照）、`RETENTION_EDITABLE`（哪些表可编辑）

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 概览加载中 | `<ListSkeleton />` 全屏占位 | 早 return，不渲染主体 |
| 概览加载失败 | error-banner + 重试按钮 | 早 return，不渲染主体 |
| retention 输入非法 | toast.error「必须为 1-365 之间的整数」 | 前端校验，不发请求 |
| 清理时其他按钮 disabled | `cleaningAll || cleaningTable !== null` 控制 | 防止并发清理 |
| retention 保存失败 | toast.error | 不退出编辑模式 |
| 一键清理二次确认取消 | 直接返回，不发请求 | `useConfirm` 返回 false |
| 行数 > 10000 加粗显示 | `fontWeight: bold` | 视觉提醒容量大表 |
| chat_logs 不可编辑 | 显示"（来自 Pack 配置）" + 无编辑按钮 | `RETENTION_EDITABLE[chat_logs] = false` |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 lucide-react 图标（Trash2 / RefreshCw / Edit3 / AlertCircle / CheckCircle2），与 quotas/nodes 一致；info-block / scheduler-status / data-table 类名规范
- `[UX]` 移动端适配：表格 `.table-wrap` 横向滚动；retention 编辑行内布局依赖 `display: flex`，窄屏可能挤压
- `[UX]` 与其他页面一致性：使用 `useDocumentTitle('运维清理')`、`useConfirm`、`useToast`，与 quotas 一致；page-container / page-header / page-subtitle 三件套与 quotas/nodes 对齐
- `[UX]` 顶部说明区在底部 info-block，新手可能先看到表格不知道字段含义；可考虑在顶部加 alert-info

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/maintenance` 在 L395）
- 页面组件：[Maintenance.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Maintenance.tsx)
- 关键 hook：`useAuth`（`../../api/auth`）；`useConfirm`（`../../context/ConfirmContext`）；`useToast`（`../../context/ToastContext`）；`useDocumentTitle`（`../../hooks/useDocumentTitle`）
- API client：
  - `api.getMaintenanceOverview()` → [client.ts#L1713-L1717](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1713-L1717)
  - `api.triggerCleanup(req)` → [client.ts#L1718-L1723](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1718-L1723)
  - `api.updateRetention(req)` → [client.ts#L1724-L1729](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1724-L1729)
- 后端路由：[maintenance.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/maintenance.ts)（L70/125/190）
- 路由挂载：[routes-registry.ts#L912-L924](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L912-L924) `app.use('/api/admin/maintenance', authenticateToken, requireAdmin, createMaintenanceRouter(...))`

## 11. 待办与风险
- `[TODO]` chat_logs 的 retention 后端返回固定 7，前端说明区已解释但表格仍展示"7"，建议加 tooltip 或灰显
- `[TODO]` 上次清理结果详情只在当次操作后展示，刷新页面后丢失；可考虑持久化到 localStorage 或后端返回 last_cleanup_result
- `[TODO]` 顶部状态徽章"定时清理已启用"是硬编码 `overview.scheduler_enabled`，后端始终返回 true，无法反映真实 scheduler 状态
- `[RISK]` retention 编辑输入框无 max/min 实时校验，仅在保存时 toast.error；用户可输入 0 或 9999 后才知道范围
- `[RISK]` 一键清理全部表是高破坏性操作，虽有 `useConfirm` 二次确认但无 dry-run 预览（不展示将删除多少行）；建议清理前先调 overview 拿到行数预览
- `[RISK]` retention_days 范围 1-365 是前端硬编码，与后端校验不一致时会导致 PUT 失败但前端无法定位原因

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
