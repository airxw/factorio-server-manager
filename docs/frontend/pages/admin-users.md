# 用户管理（Users）

## 1. 页面定位
> 系统管理员对全平台用户进行查看、编辑、创建、软删除与批量治理的后台页（v4.24.0 起含分析卡片与批量操作）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/users`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/users`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/users`
- 进入方式：
  - 在 `/admin` 基座下（`AdminLayout`）侧边栏点击「权限管理」或「用户管理」菜单
  - 浏览器直接输入上述 URL
- 退出方式：
  - 点击侧边栏其他菜单切换路由
  - 点击页面顶部「返回控制台」回到 `/`
  - 浏览器后退 / 关闭页签

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（在 `App.tsx` 第 371 行 `/admin` 基座上提门控，第 378 行内层重复声明同集合）
  - 内层：组件内 `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`（[Users.tsx#L322-L324](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx#L322-L324)）
- 未登录行为：`RequireRole` 内 `useAuth` 无 user → `<Navigate to="/login" replace />`
- 越权行为：登录但角色不在 allow 集合 → `RequireRole` 与组件内 `isAdminRole` 双重拦截，统一 `<Navigate to="/forbidden" replace />`
- 后端二次校验：`/api/users` 路由在 `routes-registry.ts#L884` 通过 `authenticateToken(JWT_SECRET) + requireAdmin` 中间件保护；写入类操作（POST/PATCH/DELETE/batch）后端会再次校验 `server_admin`，非 `server_admin` 调用返回 `PANEL_FORBIDDEN`

## 4. 核心功能点
- 三级权限说明卡片（`server_admin` / `instance_admin` / `user` 权责对齐表）——只读展示
- v4.24.0 用户分析卡片：总用户/活跃/禁用/已删除、按角色分布、近 7/30 天注册与活跃、系统内置账号数
- 用户列表表格（桌面端）+ 卡片列表（移动端 `mobile-only`）：
  - 字段：email、username、role、status、display_name、created_at、操作
  - 系统内置账号显示 🔒 标识
  - 顶部搜索框：按 email / 用户名模糊过滤（本地 `useMemo` 计算）
- 行内编辑：role（3 级下拉）、status（active/disabled，不可直切 deleted）、display_name
- 新建用户 modal：email / username / password / role 必填，display_name 可选；本地校验后 POST
- 软删除：单条确认 modal → `DELETE /users/:id` → 乐观更新 `status='deleted'`
- v4.24.0 批量操作（限 `server_admin`）：
  - 多选 checkbox + 全选 + 取消选择
  - 单次上限 `BATCH_LIMIT = 100`，超出则工具栏所有按钮 disabled
  - 操作类型：批量启用 / 批量禁用 / 批量改角色 / 批量删除
  - 批量删除与改角色走二次确认 modal
  - 批量改角色是「覆盖式」语义（原角色集合被替换为目标角色）
  - 结果 modal：总数 / 成功 / 失败计数 + 失败明细列表
- 可选行规则：已删除 / 系统内置 / 当前登录用户 三者不可选（见 `isSelectable`）

## 5. 交互流程
1. 进入页面 → `useEffect` 并行触发 `refresh()`（GET /users）与 `refreshStats()`（GET /users/stats）
2. 列表加载完成 → `ListSkeleton` 隐藏 → 表格渲染；搜索框输入触发本地过滤
3. 点击「编辑」→ 行内 select/input 切换 → 「保存」→ PATCH /users/:id → 成功后用响应数据替换该行；失败按 `PANEL_FORBIDDEN` 等错误码映射文案
4. `server_admin` 点击「新建用户」→ modal 校验通过 → POST /users → 新用户插入列表头部
5. `server_admin` 点击「删除」→ 二次确认 modal → DELETE /users/:id → 乐观置位 `status='deleted'`；`USER_NOT_FOUND` 时从列表移除
6. 多选 ≥1 项 → 显示批量工具栏 → 选择批量操作 → 部分操作走二次确认 → POST /users/batch → 结果 modal 展示成功/失败明细 → 自动 `refresh + refreshStats`

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/users` | GET | JWT + requireAdmin | 加载全平台用户列表 | 401 未登录 / 403 越权 |
| `/api/users/stats` | GET | JWT + requireAdmin | 用户分析统计卡片数据（v4.24.0） | 401 / 403（前端静默失败） |
| `/api/users/:id` | PATCH | JWT + requireAdmin | 行内编辑角色/状态/显示名 | `PANEL_FORBIDDEN` / `USER_NOT_FOUND` |
| `/api/users` | POST | JWT + requireAdmin（server_admin） | 新建用户 | `USER_ALREADY_EXISTS` / `PANEL_VALIDATION_ERROR` / `PANEL_FORBIDDEN` |
| `/api/users/:id` | DELETE | JWT + requireAdmin（server_admin） | 软删除用户 | `PANEL_VALIDATION_ERROR` / `PANEL_FORBIDDEN` / `USER_NOT_FOUND` |
| `/api/users/batch` | POST | JWT + requireAdmin（server_admin） | 批量启用/禁用/删除/改角色 | `PANEL_VALIDATION_ERROR` / `PANEL_FORBIDDEN` |

> API client 调用见 [client.ts#L613-L650](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L613-L650)（listUsers/getUserStats/batchOperateUsers 等）。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`（PanelApiClient）与 `user`（当前登录用户）
- Local state（关键）：
  - `users` / `loading` / `error` / `keyword` —— 列表与本地过滤
  - `editingId` / `draft` / `saving` —— 行内编辑
  - `createOpen` / `createForm` / `creating` / `createError` —— 新建 modal
  - `deletingId` / `deleteBusy` —— 软删除确认
  - `stats` / `statsLoading` —— v4.24.0 分析卡片（失败静默）
  - `selectedIds: Set<string>` / `batchBusy` / `batchResult` / `batchDeleteConfirm` / `batchRoleConfirm` / `batchRoleValue` —— v4.24.0 批量操作
- 副作用：
  - `[STATE]` 加载态：`loading=true` 显示 `<ListSkeleton rows={6} columns={6} />`
  - `[STATE]` 空态：`filtered.length === 0` 显示「没有匹配的用户。」
  - `[STATE]` 错误态：顶部 `<div className="alert alert-error">{error}</div>`
  - 无订阅、无定时器、无 WS——所有数据均按需拉取（刷新按钮 + 操作后回写）

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | `RequireRole` + `isAdminRole` 双层 |
| 列表加载失败 | 顶部 alert 显示 `err.message` | `refresh()` 内 try/catch |
| 统计加载失败 | 卡片显示「统计加载失败」 | `refreshStats()` 静默失败，不影响主表 |
| 行内保存 `PANEL_FORBIDDEN` | alert「无权限执行该操作」 | 错误码显式映射 |
| 新建时邮箱已注册 | modal 内 alert「邮箱已被注册」 | `USER_ALREADY_EXISTS` |
| 新建时 `PANEL_VALIDATION_ERROR` | modal 内 alert 显示后端 message | 用户名 2-32、密码 ≥6 等本地校验前置 |
| 删除 `USER_NOT_FOUND` | alert「用户不存在或已删除」+ 同步从列表移除 | 防止幽灵行 |
| 批量选择超 100 | 工具栏按钮全部 disabled + 显示警告文案 | 与后端硬约束 `BATCH_LIMIT=100` 对齐 |
| 不能删除自己 | 删除按钮 `disabled` + tooltip「不能删除自己」 | `u.id === user?.id` |
| 不能选自己 / 内置 / 已删除 | checkbox `disabled` + tooltip 说明 | `isSelectable` |
| 移动端 | 切换为 `mobile-card-list` 卡片视图 | 桌面表格在 `mobile-only` 隐藏 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：清新表格 + 信息卡片，主色按钮 `btn-primary` / 危险 `btn-danger` / 幽灵 `btn-ghost`，与全站一致；统计卡片用 `stats-chip` 系列色块（total/active/disabled/deleted/role-x/trend/built-in）区分语义
- `[UX]` 移动端适配：`desktop-only` 表格 + `mobile-only` 卡片双视图；移动端卡片含 checkbox + 完整字段 + 操作按钮
- `[UX]` 与其他页面一致性：与 `SystemConfig` / `Settings` 等 admin 页面共用 `page-header` / `info-card` / `data-table` / `modal` / `btn` 等 class，符合苹果清新设计语言，无电竞风
- `[UX]` 弹窗规范：删除/批量删除/批量改角色/批量结果 均走统一 `modal-mask` + `modal` 结构，关闭按钮 × 与遮罩点击关闭一致
- `[UX]` 反馈即时性：批量操作完成后自动 `refresh + refreshStats`，无需用户手动刷新

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin` 基座 + 内层 `RequireRole` + `users` 子路由在第 379 行）
- 页面组件：[Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx)
- 关键 hook：`useAuth`（[auth.tsx#L230](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L230)）、`useMemo` 本地过滤（[Users.tsx#L120-L126](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx#L120-L126)）
- 角色判定：[utils/role.ts#L5-L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L5-L7) `isAdminRole`
- API client：[client.ts#L613-L650](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L613-L650)（`listUsers` / `getUserStats` / `createUser` / `updateUser` / `deleteUser` / `batchOperateUsers`）
- API 类型契约：`@public/schema/panel-api-types` 中 `AdminUserSummary` / `BatchUserOperationRequest` / `UserStatsResponse` 等
- 后端路由：[users.ts#L143-L178](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts#L143-L178)（list / stats / batch）与 [users.ts#L358-L609](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts#L358-L609)（create / patch / delete）
- 后端挂载：[routes-registry.ts#L884](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L884) `app.use('/api/users', authenticateToken(JWT_SECRET), requireAdmin, createUsersRouter())`

## 11. 待办与风险
- `[RISK]` `listUsers` 一次性拉全表（无分页），用户量上万时前端渲染与网络成本陡增，且 `filtered` 在前端做 keyword 过滤——大表场景需考虑分页/服务端过滤
- `[RISK]` 批量改角色为「覆盖式」语义，UI 文案已明确说明，但用户误操作仍可能把多个 `server_admin` 一次性降级为 `user`，建议在生产环境增加二次输入确认（如输入 `CONFIRM`）
- `[RISK]` 软删除后仅本地乐观置位 `status='deleted'`，未从列表移除，依赖刷新按钮清掉；若用户期望「删除即消失」可能产生困惑
- `[TODO]` 统计卡片失败仅显示「统计加载失败」无重试按钮，建议补充 retry 入口
- `[TODO]` 移动端卡片视图无分页/虚拟化，与桌面表格一样会一次性渲染所有 `filtered`，超长列表性能待优化
- `[TODO]` 新建用户 modal 缺少邮箱格式服务端校验回显兜底（前端只做必填与长度校验）

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（Users.tsx + client.ts + users.ts + routes-registry.ts）
- 涉及版本标注：v3.1.0（UserRole 3 级）、v4.0.2（系统内置标识）、v4.12.0（/admin 基座门控上提）、v4.24.0（分析卡片 + 批量操作）
