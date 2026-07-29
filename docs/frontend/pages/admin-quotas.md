# 配额管理

## 1. 页面定位
> 系统管理员管理角色默认配额与用户个性化配额（最大实例数 / 最大磁盘 MB / 最大玩家总数），留空表示不限。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/quotas`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/quotas`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/quotas`
- 进入方式：`/admin` 基座侧边栏导航；直接访问 URL
- 退出方式：点击侧边栏切换到其他 `/admin/*` 页面；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 后端级：`/api/quotas/role/:role` 与 `/api/quotas/user/:userId` 在 `quotas.ts` 内挂载 `requireRole(Role.SERVER_ADMIN)`
- 未登录行为：`RequireRole` 上游重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`；后端 401/403

## 4. 核心功能点
- 角色配额区域：3 张卡片（server_admin / instance_admin / user），每张展示实例/磁盘/玩家总数配额
- 用户配额区域：搜索框（按用户名 / ID / 邮箱）+ 用户列表（分页 20/页）
- 编辑 Modal：3 个数字输入框（max_instances / max_disk_mb / max_players_total），留空 = 不限（NULL），输入 0 = 禁止
- 角色配额编辑：直接打开 Modal，预填当前值
- 用户配额编辑：打开 Modal 后异步加载该用户配额（加载期间 Modal 已打开）
- 刷新按钮：同时刷新角色配额与用户列表

## 5. 交互流程
1. 进入页面 → `useEffect` 并发触发 `refreshRoles()` + `refreshUsers()`
2. 角色配额卡片「编辑」→ `openEditRole()` → 填表 → 「保存」→ `api.updateRoleQuota(role, req)` → toast.success → 关闭 Modal + refreshRoles
3. 用户配额行「编辑配额」→ `openEditUser()` → Modal 打开 + 异步 `api.getUserQuota(userId)` 加载 → 填表 → 「保存」→ `api.updateUserQuota(userId, req)` → toast.success → 关闭 Modal + refreshRoles
4. 搜索框输入 → `useMemo` 前端过滤；分页切换 → 切片展示
5. 失败 → toast.error 展示错误信息

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/quotas/role/:role` | GET | JWT + `requireRole(SERVER_ADMIN)` | 获取指定角色的配额（可能为 null） | 401 未认证；403 越权 |
| `/api/quotas/role/:role` | PUT | JWT + `requireRole(SERVER_ADMIN)` | 更新指定角色配额 | 400 PANEL_VALIDATION_ERROR |
| `/api/quotas/user/:userId` | GET | JWT + `requireRole(SERVER_ADMIN)` | 获取指定用户的个性化配额 | 404 USER_NOT_FOUND |
| `/api/quotas/user/:userId` | PUT | JWT + `requireRole(SERVER_ADMIN)` | 更新指定用户配额 | 400 PANEL_VALIDATION_ERROR；404 USER_NOT_FOUND |
| `/api/users` | GET | JWT + `requireAdmin` | 列出全部用户（用于配额编辑入口） | 401 未认证；403 越权 |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供 toast
- Local state：
  - `[STATE]` `roleQuotas: Record<string, ResourceQuota | null>` / `loadingRoles` / `errorRoles`
  - `[STATE]` `users: AdminUserSummary[]` / `loadingUsers` / `errorUsers` / `userSearch` / `userPage`
  - `[STATE]` `editing` / `editMaxInstances` / `editMaxDiskMb` / `editMaxPlayersTotal` / `saving` — Modal 编辑态
- 副作用（订阅 / 定时器 / WS）：无；仅 `useEffect` 挂载时触发一次 `refreshRoles` + `refreshUsers`
- 派生：`filteredUsers`（搜索过滤）、`pagedUsers`（分页切片）、`userTotalPages`

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 角色配额加载失败 | error-banner + 重试按钮 | 仅该区域显示，不影响用户配额区域 |
| 用户列表加载失败 | error-banner + 重试按钮 | 仅该区域显示，不影响角色配额区域 |
| 角色配额加载中 | `<ListSkeleton rows={1} columns={3} />` | 三列骨架 |
| 用户列表加载中 | `<ListSkeleton rows={6} columns={4} />` | 六行四列骨架 |
| 用户搜索无匹配 | `<EmptyState title="没有匹配的用户" />` | 区分"暂无用户"与"无匹配" |
| 用户列表为空 | `<EmptyState title="暂无用户" />` | 提示新建用户 |
| 配额输入非法 | toast.error「请输入有效的非负整数，或留空表示不限」 | 前端校验 parseInt + 非负 |
| 用户配额异步加载失败 | Modal 仍打开，3 个输入框留空 | `.catch(() => {})` 静默失败 |
| Modal 保存中 | 取消/保存按钮均 disabled | `disableClose={saving}` |
| 分页越界 | `safeUserPage = Math.min(userPage, userTotalPages)` | 自动夹紧 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：lucide-react 图标（RefreshCw / AlertCircle / Edit3 / Search），与 maintenance/nodes 一致；info-card / error-banner / toolbar 类名规范
- `[UX]` 移动端适配：角色配额卡片使用 `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` 自适应；用户表格 `.table-wrap` 横向滚动；Modal 由 `../../components/ui` 统一封装
- `[UX]` 与其他页面一致性：使用 `useDocumentTitle('配额管理')`、`useToast`、`Modal`、`Pagination`、`ListSkeleton`、`EmptyState`，与 maintenance/nodes 一致
- `[UX]` 配额展示统一通过 `formatQuotaValue(value, suffix)`：null → "不限"，否则 `value+suffix`，三字段语义一致

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/quotas` 在 L397）
- 页面组件：[Quotas.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Quotas.tsx)
- 关键 hook：`useAuth`（`../../api/auth`）；`useToast`（`../../context/ToastContext`）；`useDocumentTitle`（`../../hooks/useDocumentTitle`）
- 子组件：`Modal` / `Pagination` / `EmptyState` / `ListSkeleton`（`../../components/ui`）
- API client：
  - `api.getRoleQuota(role)` → [client.ts#L1344-L1348](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1344-L1348)
  - `api.updateRoleQuota(role, req)` → [client.ts#L1349-L1354](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1349-L1354)
  - `api.getUserQuota(userId)` → [client.ts#L1355-L1359](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1355-L1359)
  - `api.updateUserQuota(userId, req)` → [client.ts#L1360-L1365](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1360-L1365)
- 后端路由：[quotas.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/quotas.ts)（L47/83/106/150/164）
- 路由挂载：[routes-registry.ts#L884](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L884) `/api/users` + quotas.ts 内部 requireRole

## 11. 待办与风险
- `[TODO]` 用户配额编辑保存后只 `refreshRoles()`，未刷新用户列表，无法看到用户当前是否已有个性化配额（建议在用户行展示"已自定义"标记）
- `[TODO]` 用户列表无分页大小切换（固定 20/页），用户量大时翻页繁琐
- `[TODO]` 配额输入框可加上"清空"快捷按钮，避免用户手动清空 3 个输入框
- `[RISK]` `openEditUser` 中 `api.getUserQuota` 失败时 `.catch(() => {})` 静默吞错，用户看到 3 个空输入框可能误以为是"不限" → 保存会把已有个性化配额覆盖为 null
- `[RISK]` `parseNum` 把空字符串当作 null（不限），但用户可能误清空一个字段导致配额被改为不限；建议加"未修改"对比
- `[RISK]` 用户配额保存后只刷新角色配额，不刷新当前用户配额；若管理员连续编辑多个用户，UI 状态可能与后端不一致
- `[RISK]` max_disk_mb 单位是 MB，但 UI 未明确标注单位（仅 placeholder "留空 = 不限"），管理员可能误填 GB 数值

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
