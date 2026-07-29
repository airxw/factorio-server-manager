# 审计日志（AuditLogs）

## 1. 页面定位
> 系统管理员查询、过滤、导出与详情查看平台审计日志（千行级虚拟化表格 + CSV 导出 + before/after 对比）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/audit-logs`（实际路由为 `/admin/audit-logs`）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/audit-logs`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/audit-logs`
- 进入方式：`/admin` 基座侧边栏点击「审计日志」菜单，或直接输入 URL
- 退出方式：侧边栏切换其他菜单 / 浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（`App.tsx` 第 371 行基座 + 第 378 行内层）
  - 内层：[AuditLogs.tsx#L261-L263](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L261-L263) `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 重定向到 `/login`
- 越权行为：双层拦截，统一重定向 `/forbidden`
- 后端二次校验：`/api/audit-logs` 在 [routes-registry.ts#L881](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L881) 通过 `authenticateToken + requireAdmin` 保护

## 4. 核心功能点
- 过滤表单（顶部 `form-card`）：
  - 服务器下拉（GET /servers 加载选项）
  - 用户 ID 输入（精确匹配）
  - 动作输入（如 `server.start`）
  - 目标类型输入（如 `server` / `user`）
  - 起始/结束时间（`datetime-local`，提交时转 ISO 8601）
  - 条数（1-1000，默认 100）
  - 关键词搜索（11.3，本地过滤 details JSON）
- URL 同步（11.3）：过滤条件通过 `useSearchParams` 写入 URL，支持分享/书签；首次进入从 URL 反序列化初始值
- 桌面端虚拟化表格（`VirtualTable` 组件，三.2）：
  - 9 列：ID / 时间 / 服务器 / 用户 / 动作 / 目标类型 / 目标 ID / IP / 详情
  - 千行级数据滚动保持 60fps
  - 「详情」按钮打开 Modal，「展开/收起」切换行内 JSON
- 移动端卡片列表（`mobile-card-list mobile-only`）：每条日志渲染为卡片，含详情按钮
- CSV 导出（11.3，`exportAuditLogsCsv`）：
  - 含 BOM 头确保 Excel UTF-8 识别
  - 字段含逗号/引号/换行时双引号包裹并转义
  - 文件名 `audit-logs-YYYY-MM-DD.csv`
  - 仅导出当前过滤后的结果（`filteredLogs`）
- 详情弹窗（11.3，`Modal`）：
  - 完整字段展示（时间/动作/服务器/用户/目标/IP）
  - before/after 对比（自动从 details 中提取 `before/old/previous` 与 `after/new/current` 字段对）
  - 完整 details JSON 美化展示

## 5. 交互流程
1. 进入页面 → 从 URL 反序列化过滤条件 → `useEffect` 加载服务器列表 + `loadLogs({})`（GET /audit-logs 无参数拉默认 100 条）
2. 用户填写过滤表单 → 点击「查询」→ `syncUrl()` 写入 URL → `loadLogs(buildQuery())`（GET /audit-logs?...）
3. 关键词输入 → `useMemo` 本地过滤 `filteredLogs`（不动 URL query 的 q 字段在 syncUrl 时同步）
4. 点击「导出 CSV」→ 调用 `exportAuditLogsCsv(filteredLogs)` → 浏览器下载文件
5. 点击行内「详情」→ `setDetailLog(log)` 打开 Modal → 展示完整字段 + before/after + 完整 JSON
6. 点击行内「展开」→ 行内 `<pre>` 展示 details JSON
7. 点击「刷新」→ 用当前过滤条件重新 `loadLogs(buildQuery())`

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT + requireAdmin（继承基座） | 加载服务器列表用于过滤下拉 | 401 / 403 |
| `/api/audit-logs` | GET | JWT + requireAdmin | 拉取审计日志（支持 server_id / user_id / action / target_type / from / to / limit query） | 401 / 403 / 400 参数错误 |

> API client 见 [client.ts#L1104-L1118](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1104-L1118)（`listAuditLogs` 用 `URLSearchParams` 拼 query）。
> 后端路由见 [auditLogs.ts#L30](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/auditLogs.ts#L30) `router.get('/')`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供 toast；`useSearchParams()` 提供 URL 同步
- Local state：
  - `servers` / `serversLoading` —— 过滤下拉数据源
  - `logs: AuditLogSummary[]` / `loading` / `error` —— 主表数据
  - `serverId` / `userId` / `action` / `targetType` / `from` / `to` / `limit` / `keyword` —— 7 个过滤条件（前 7 个走 API，keyword 走本地）
  - `detailLog: AuditLogSummary | null` —— 详情弹窗
  - `expandedIds: Set<number>` —— 行内展开状态
- 副作用：
  - `[STATE]` 加载态：`loading=true` 显示「加载中…」
  - `[STATE]` 空态：`filteredLogs.length === 0` 显示「没有匹配关键词的日志。」或「暂无审计日志。」
  - `[STATE]` 错误态：顶部 alert 显示 `error`
  - `[STATE]` URL 同步：`syncUrl` 用 `setSearchParams(params, { replace: true })` 静默更新
  - 服务器列表 useEffect 内 `cancelled` 防止 unmount 后 setState
  - 无订阅、无定时器、无 WS

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | 双层门控 |
| 服务器列表加载失败 | 顶部 alert | `useEffect` catch |
| 日志加载失败 | 顶部 alert + `logs=[]` | `loadLogs` catch |
| 导出 CSV 时无数据 | Toast.info「暂无可导出的日志」 | `handleExportCsv` 前置检查 |
| 导出 CSV 失败 | Toast.error 显示 err.message | `exportAuditLogsCsv` catch |
| limit 输入非法 | `buildQuery` 中 `Number.isFinite` 校验，跳过该参数 | 不阻断查询 |
| from/to 转换 | `new Date(from).toISOString()` | 浏览器原生支持 `datetime-local` |
| details JSON.stringify 失败 | `formatDetails` catch 返回 `'—'` | 防止崩溃 |
| 组件卸载 | `cancelled=true` 阻止 setState | 防止内存泄漏警告 |
| 千行数据渲染 | `VirtualTable` 虚拟化 + `estimateRowHeight=44` + `maxHeight=640` | 保持 60fps |
| URL 参数丢失 | 首次加载从 `searchParams.get(...)` 初始化 | 支持分享/书签 |
| 详情弹窗无 before/after | 不渲染对比区域 | `extractBeforeAfter` 返回 null |

## 9. 体验与一致性检查
- `[UX]` 设计语言：与全站一致，`page-header` / `form-card` / `data-table` / `badge` / `btn` 共用样式；过滤表单使用 `form-row` 多列布局；详情弹窗 before 用浅红 `#fef2f2`、after 用浅绿 `#f0fdf4`，符合常规变更对比色彩语义
- `[UX]` 移动端适配：`desktop-only` 虚拟化表格 + `mobile-only` 卡片列表双视图，与 Users 页面一致；移动端卡片含详情按钮
- `[UX]` 与其他页面一致性：`VirtualTable` 与监控/聊天日志等大表场景共用；CSV 导出的 BOM 头处理与 Excel 兼容性是项目通用模式
- `[UX]` 反馈规范：导出成功 Toast.success 显示条数，失败 Toast.error；查询中按钮显示「查询中…」
- `[UX]` 详情弹窗：before/after 自动提取多种字段名（before/old/previous/old_value 与 after/new/current/new_value），兼容后端不同模块的写入习惯

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`audit-logs` 子路由在第 388 行）
- 页面组件：[AuditLogs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx)
- CSV 导出实现：[AuditLogs.tsx#L36-L82](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L36-L82) `exportAuditLogsCsv`
- before/after 提取：[AuditLogs.tsx#L84-L104](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L84-L104) `extractBeforeAfter`
- URL 同步：[AuditLogs.tsx#L194-L210](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L194-L210) `syncUrl` + `handleQuery`
- 虚拟化表格列定义：[AuditLogs.tsx#L392-L475](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L392-L475)
- VirtualTable 组件：`../../components/VirtualTable`（`VirtualColumn` 类型）
- API client：[client.ts#L1104-L1118](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1104-L1118)
- 后端路由：[auditLogs.ts#L30](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/auditLogs.ts#L30) `router.get('/')`
- 后端挂载：[routes-registry.ts#L881](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L881)

## 11. 待办与风险
- `[RISK]` 关键词搜索是本地过滤（`filteredLogs` 仅在已加载的 `logs` 数组中匹配 details JSON），若 API 已分页/截断（limit=100），可能漏匹配后续页的日志；用户误以为关键词覆盖全量
- `[RISK]` limit 最大 1000（[AuditLogs.tsx#L356](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx#L356) `max={1000}`），但前端 `<input type="number">` 无强制上限，浏览器仍允许输入超过 1000 的值，由后端兜底校验
- `[RISK]` CSV 导出依赖 `URL.createObjectURL` + `link.click()`，部分浏览器（如 Safari 隐私模式）可能阻止下载，未做兜底
- `[RISK]` 详情弹窗的 before/after 提取依赖字段名硬编码（before/old/previous/old_value），后端模块若用其他字段名（如 `before_update`）会漏识别
- `[RISK]` URL 同步用 `setSearchParams(params, { replace: true })`，但 `limit` 默认 100 不写入 URL（`limit && limit !== '100'` 才写），用户分享 URL 时若 limit=100 不会保留，可能造成结果不一致
- `[RISK]` `datetime-local` 在不同浏览器表现不一致（Safari 不支持秒级），可能造成时间精度丢失
- `[TODO]` 缺少分页 UI（仅有 limit），用户无法翻页查看更早的日志，只能改 limit 或加 from/to 过滤
- `[TODO]` 过滤表单未做「重置」按钮，用户需手动清空 7 个字段
- `[TODO]` 详情弹窗未展示 `user_id` 关联的用户名/邮箱，需用户另开 Users 页面查询
- `[TODO]` 无实时刷新（如 WS 推送新日志），需手动点「刷新」

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（AuditLogs.tsx + VirtualTable + client.ts + auditLogs.ts + routes-registry.ts）
- 涉及版本标注：三.2（虚拟化表格）、11.3（CSV 导出 + 详情弹窗 + 关键词搜索 + URL 同步）
