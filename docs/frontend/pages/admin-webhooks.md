# Webhook 管理（Webhooks）

## 1. 页面定位
> 系统管理员为单个 server 配置 Webhook（URL / 事件类型 / secret / 启用状态），并支持手动测试投递与删除。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/webhooks`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/webhooks`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/webhooks`
- 进入方式：`/admin` 基座侧边栏点击「Webhooks」菜单，或直接输入 URL
- 退出方式：侧边栏切换其他菜单 / 浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（`App.tsx` 第 371 行基座 + 第 378 行内层）
  - 内层：[Webhooks.tsx#L238-L240](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L238-L240) `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 重定向到 `/login`
- 越权行为：双层拦截，统一重定向 `/forbidden`
- 后端二次校验：`/api/servers/:serverId/webhooks` 在 [routes-registry.ts#L854](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L854) 通过 `authenticateToken + requireAdmin` 保护

## 4. 核心功能点
- 顶部服务器选择下拉框：默认选中第一个 server，切换后重新加载该 server 的 Webhook 列表
- 新建 Webhook 表单（顶部 `form-card`）：
  - URL（必填，建议 `https://` 开头）
  - 事件类型（逗号分隔，如 `player.join,player.leave`，留空表示订阅全部）
  - Secret（可选，留空则不发送 `X-Webhook-Secret` 头）
  - 启用 checkbox（默认勾选）
- Webhook 列表表格：ID / URL / 事件类型（badge 标签，空数组显示「全部」）/ 启用（checkbox + badge）/ 创建时间 / 更新时间 / 操作
- 启用状态切换：checkbox 点击 → 乐观更新 + PATCH → 失败回滚到原状态
- 测试投递（弹层 `form-card`）：
  - event_type（必填）
  - payload（JSON 对象 textarea，可选；前端 `JSON.parse` 校验，必须为对象非数组）
  - 提交后展示 `delivered` / `status_code` / `error` 三项结果
- 删除：`window.confirm` 二次确认 → DELETE → 从列表移除

## 5. 交互流程
1. 进入页面 → `useEffect` 加载服务器列表（GET /servers）→ 自动选中第一个 → 加载 Webhook 列表（GET /servers/:serverId/webhooks）
2. 用户切换下拉 → `serverId` 变化 → `useEffect` 重新加载 Webhook 列表
3. 填写新建表单 → 点击「创建」→ POST /servers/:serverId/webhooks → 新 Webhook 插入列表头部并按 created_at 倒序排序
4. 点击启用 checkbox → 乐观切换 `enabled` → PATCH /servers/:serverId/webhooks/:id → 失败回滚 + alert
5. 点击「测试」→ 展开测试表单 → 填写 event_type + payload → 点击「发送测试」→ POST /servers/:serverId/webhooks/:id/test → 显示 delivered/status_code/error
6. 点击「删除」→ `window.confirm` → DELETE → 从列表移除
7. 点击「刷新」→ 重新调用 `loadWebhooks(serverId)`

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT + requireAdmin（继承基座） | 加载服务器列表用于下拉 | 401 / 403 |
| `/api/servers/:serverId/webhooks` | GET | JWT + requireAdmin | 加载该 server 的所有 Webhook | 401 / 403 / 404 |
| `/api/servers/:serverId/webhooks` | POST | JWT + requireAdmin | 新建 Webhook | `PANEL_VALIDATION_ERROR` / 403 |
| `/api/servers/:serverId/webhooks/:id` | PATCH | JWT + requireAdmin | 更新启用状态（部分字段） | 404 / 403 |
| `/api/servers/:serverId/webhooks/:id` | DELETE | JWT + requireAdmin | 删除 Webhook | 404 / 403 |
| `/api/servers/:serverId/webhooks/:id/test` | POST | JWT + requireAdmin | 手动触发测试投递 | 404 / 500（投递失败） |

> API client 见 [client.ts#L1075-L1100](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1075-L1100)。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`
- Local state：
  - `servers` / `serverId` / `serversLoading` —— 服务器下拉
  - `webhooks: WebhookSummary[]` / `dataLoading` / `error` —— Webhook 列表
  - `form: FormState` / `saving` —— 新建表单
  - `togglingId: number | null` —— 启用状态切换中的 ID
  - `deletingId: number | null` —— 删除中的 ID
  - `testState: TestState | null` / `testing` / `testResult` —— 测试投递弹层
- 副作用：
  - `[STATE]` 加载态：`dataLoading=true` 显示「加载中…」
  - `[STATE]` 空态：`!serverId` 显示「请先选择服务器。」；`webhooks.length === 0` 显示「暂无 Webhook。」
  - `[STATE]` 错误态：顶部 alert 显示 `error`
  - `[STATE]` 乐观更新回滚：启用切换失败时 `setWebhooks` 回滚到 `w.enabled` 原值
  - 服务器列表 useEffect 内 `cancelled` 防止 unmount 后 setState
  - 无订阅、无定时器、无 WS

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | 双层门控 |
| 服务器列表加载失败 | 顶部 alert + 下拉显示「暂无服务器」 | `useEffect` catch |
| Webhook 列表加载失败 | 顶部 alert + `webhooks=[]` | `loadWebhooks` catch |
| 新建时 URL 为空 | alert「请填写 URL」 | 本地校验 |
| 新建失败 | alert 显示 err.message | `handleSubmit` catch |
| 启用切换失败 | 乐观回滚 + alert | `handleToggleEnabled` catch |
| 删除失败 | alert 显示 err.message | `handleDelete` catch |
| 测试时 event_type 为空 | alert「请填写 event_type」 | 本地校验 |
| 测试时 payload 非法 JSON | alert「payload 不是合法的 JSON」 | `JSON.parse` catch |
| 测试时 payload 非对象 | alert「payload 必须为 JSON 对象」 | `typeof !== 'object' \|\| Array.isArray` 校验 |
| 测试失败 | alert 显示 err.message | `handleTestSubmit` catch |
| 删除中重复点击 | 按钮 disabled | `deletingId === w.id` |
| 启用切换中重复点击 | checkbox disabled | `togglingId === w.id` |
| 测试弹层已展开时点击其他「测试」 | 其他按钮 disabled | `testState !== null` 条件 |
| 未选 server | 「创建」按钮 disabled | `disabled={saving \|\| !serverId}` |
| 组件卸载 | `cancelled=true` 阻止 setState | 防止内存泄漏警告 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：与全站一致，`page-header` / `form-card` / `data-table` / `badge` / `btn` 共用样式；事件类型用 badge 标签展示，启用状态用 `badge-running` / `badge-stopped` 区分
- `[UX]` 移动端适配：依赖全局 `data-table` 在移动端的表现，本页未做 `mobile-card-list` 双视图（与 PlayerBindings 一致，弱于 Users/AuditLogs）
- `[UX]` 与其他页面一致性：与 PlayerBindings 共享「顶部服务器下拉 + 表格 + form-card 新建」布局模式；与 Users 共用 `Modal` 风格的弹层（这里用 `form-card` 替代 Modal 做测试表单，略有差异）
- `[UX]` 反馈规范：启用切换走乐观更新 + 失败回滚，体验流畅；删除走 `window.confirm`，与 PlayerBindings/SystemConfig 一致
- `[UX]` 测试结果展示：用 `alert-info` 块展示 delivered/status_code/error，清晰直观
- `[UX]` 排序：新建后按 `created_at` 倒序排序（`sort((a, b) => b.created_at.localeCompare(a.created_at))`），最新 Webhook 在顶部

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`webhooks` 子路由在第 389 行）
- 页面组件：[Webhooks.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx)
- 表单状态定义：[Webhooks.tsx#L23-L35](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L23-L35) `FormState` / `EMPTY_FORM`
- 服务器列表加载（含 cancelled）：[Webhooks.tsx#L64-L87](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L64-L87)
- 启用切换乐观更新 + 回滚：[Webhooks.tsx#L152-L170](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L152-L170)
- 测试投递 + payload JSON 校验：[Webhooks.tsx#L199-L236](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L199-L236)
- API client：[client.ts#L1075-L1100](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1075-L1100)
- 后端路由：[webhooks.ts#L40-L140](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/webhooks.ts#L40-L140)（GET / POST / PATCH / DELETE / POST test）
- 后端挂载：[routes-registry.ts#L854](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L854)

## 11. 待办与风险
- `[RISK]` URL 字段未做格式校验（[Webhooks.tsx#L121-L125](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L121-L125) 仅检查非空），用户可填 `javascript:` / 内网地址等，存在 SSRF 风险（依赖后端兜底）
- `[RISK]` Secret 字段以明文 `<input type="text">` 展示（[Webhooks.tsx#L312](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx#L312)），肩窥风险；应改为 `type="password"` + 显示切换
- `[RISK]` Secret 在表格列表中未展示但创建后无法查看（前端无 GET 单条 Webhook 接口含 secret），用户忘记 secret 后只能删除重建
- `[RISK]` 启用切换走乐观更新，但若 PATCH 部分成功（如后端写入失败但已触发禁用事件总线订阅），用户看到的 enabled 状态可能与实际不符
- `[RISK]` 事件类型用逗号分隔的 `<input>` 输入，无下拉候选 / 自动补全，用户易拼错事件名（如 `player.join` vs `player.Join`）
- `[RISK]` 测试投递结果不展示响应体（仅 status_code + error），用户难以诊断目标服务器返回的具体错误
- `[RISK]` 服务器列表与 Webhook 列表无分页，server 多或 Webhook 多时下拉/表格渲染压力大
- `[TODO]` 缺少 Webhook 投递历史记录查看（最近 N 次投递结果），用户无法追溯投递失败
- `[TODO]` 表格未做移动端 `mobile-card-list` 双视图，移动端体验弱于 Users/AuditLogs
- `[TODO]` 顶部服务器下拉未显示节点 / 游戏类型等元信息，仅 `name (id)`，难以区分同名 server
- `[TODO]` 测试弹层用 `form-card` 而非 `Modal`，与其他页面（Users/SystemConfig/AuditLogs）的 Modal 风格不一致
- `[TODO]` 删除走 `window.confirm`，与 Users 的 Modal 风格不一致

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（Webhooks.tsx + client.ts + webhooks.ts + routes-registry.ts）
- 涉及版本标注：P5（Webhooks 模块）
