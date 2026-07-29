# 站内消息

## 1. 页面定位
> 当前登录用户查看站内通知列表，支持搜索/筛选/标记已读/全部已读，关联实例与订单可一键跳转。挂载在 `/admin` 基座下（亦被其他基座复用）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/notifications`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/notifications`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/notifications`
- 进入方式：`/admin` 基座侧边栏导航；其他基座（`/store`、`/guild`）也复用本组件；直接访问 URL
- 退出方式：点击「← 返回」回到基座首页（`useGoBack` + `useBaseFallback`）；点击侧边栏切换；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（受 `/admin` 基座门控）
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 组件级：本页**无**组件级守卫（页面逻辑是"当前用户的通知"，不限定角色）
  - 后端级：`/api/notifications/*` 在 `routes-registry.ts` 中仅挂载 `authenticateToken(JWT_SECRET)`，不要求 admin
- 未登录行为：`RequireRole` 上游重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`
- 复用说明：本组件被 `/admin`、`/store`、`/guild` 三个基座复用，`useBaseFallback()` 根据当前 pathname 决定返回路径

## 4. 核心功能点
- 列表展示：通知类型徽章 / 标题 / 内容 / 创建时间 / 关联实体跳转链接
- 已读/未读视觉区分：未读 `borderLeft: 3px solid var(--primary)` + 不透明；已读 opacity 0.6
- 点击未读卡片 → 自动标记已读
- 顶部「全部已读」按钮：批量标记
- 顶部「刷新」按钮：重新拉取
- 搜索框：按标题搜索（客户端过滤）
- 类型筛选下拉：5 种类型（order_delivered / order_expired / cdk_gift / vip_changed / system_announcement）
- URL 状态化：搜索词 `q` 与类型 `type` 同步到 URL query（replace 模式，不污染历史栈）
- `/` 快捷键：监听 `focus-search` 自定义事件聚焦搜索框
- 关联实体跳转：`related_server_id` → `/instances/:id`；`related_order_id` → `/instances/:id/shop-orders`

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `api.listNotifications()` → 渲染列表
2. 输入搜索词 → `updateParams({ q })` → URL 更新 + `useMemo` 客户端过滤
3. 选择类型 → `updateParams({ type })` → URL 更新 + `useMemo` 客户端过滤
4. 点击未读卡片 → `api.markNotificationRead(id)` → 本地 state 标记已读
5. 点击「全部已读」→ `api.markAllNotificationsRead()` → 本地 state 全部标记已读 + toast.success
6. 点击「查看实例」/「查看订单」→ `<Link>` 跳转（`stopPropagation` 避免触发卡片 onClick）
7. 按 `/` 键 → 派发 `focus-search` 事件 → 搜索框聚焦
8. 失败 → toast.error

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/notifications` | GET | JWT（`authenticateToken`） | 列出当前用户通知 + 未读数 | 401 未认证 |
| `/api/notifications/:id/read` | PATCH | JWT | 标记单条通知已读 | 400 PANEL_VALIDATION_ERROR（id 非数字）；404 NOTIFICATION_NOT_FOUND |
| `/api/notifications/read-all` | PATCH | JWT | 当前用户全部标记已读 | 401 未认证 |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供 toast
- Local state：
  - `[STATE]` `notifs` / `loading` — 列表与加载态
  - `[STATE]` `searchParams` / `q` / `typeFilter` — URL 同步的搜索与筛选
  - `[STATE]` `searchInputRef` — 搜索框 ref（用于 `/` 快捷键聚焦）
  - `[STATE]` `cancelledRef` — 卸载标志（防止卸载后 setState）
- 副作用（订阅 / 定时器 / WS）：
  - `useEffect` 监听 `focus-search` 自定义事件，组件卸载时 `removeEventListener`
  - 无 WS 订阅，无定时器（通知列表不会自动刷新）
- 派生：`filteredNotifs`（按 q + type 客户端过滤）

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 列表为空 | `<EmptyState title="暂无消息" description="新的通知会显示在这里" />` | 区分"无消息"与"无匹配" |
| 筛选无匹配 | `<EmptyState title="没有匹配筛选条件的消息" />` | 引导调整筛选 |
| 列表加载中 | `<Skeleton lines={4} lineHeight={20} />` | info-card 内骨架 |
| `listNotifications` 失败 | 静默 `catch { /* ignore */ }` | 不弹 toast，列表保持空 |
| `markNotificationRead` 失败 | toast.error | 卡片不标记已读 |
| `markAllNotificationsRead` 失败 | toast.error | 列表不变 |
| 组件卸载后 setState | `cancelledRef.current = true` 防止 | 不使用 AbortController（避免浏览器 ERR_ABORTED 日志） |
| 已读卡片点击 | 不触发 `markRead`（`!n.is_read && void markRead(n.id)`） | 已读卡片 cursor 默认 |
| 跳转链接点击 | `e.stopPropagation()` 避免触发卡片 onClick | 防止误标记 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 `info-card` / `toolbar` / `toolbar-search` / `form-hint` / `back-btn`，与其他页一致；`borderLeft` 区分未读，视觉简洁
- `[UX]` 移动端适配：列表使用 `display: flex; flexDirection: column; gap: 8`，卡片自适应宽度；toolbar 未做窄屏专属优化
- `[UX]` 与其他页面一致性：使用 `useDocumentTitle('站内消息')`、`useToast`、`EmptyState`、`Skeleton`、`useGoBack`，与 maintenance/quotas 一致；本页无分页（全量加载 + 客户端过滤），与 cleanup/quotas 不一致
- `[UX]` URL 状态化优秀：搜索/筛选状态同步到 URL，刷新页面或分享链接可还原视图
- `[UX]` `/` 快捷键需上层组件派发 `focus-search` 事件，本页只监听不主动派发，依赖外部 keymap 实现

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/notifications` 在 L391）
- 页面组件：[NotificationsPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/NotificationsPage.tsx)
- 关键 hook：`useAuth`（`../api/auth`）；`useToast`（`../components/ui`）；`useDocumentTitle`（`../hooks/useDocumentTitle`）；`useGoBack`（`../hooks/useGoBack`）；`useSearchParams`（react-router-dom）
- 子组件：`EmptyState` / `Skeleton`（`../components/ui`）
- API client：
  - `api.listNotifications(signal?)` → [client.ts#L1469-L1483](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1469-L1483)
  - `api.markNotificationRead(id)` → [client.ts#L1484-L1486](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1484-L1486)
  - `api.markAllNotificationsRead()` → [client.ts#L1487-L1489](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1487-L1489)
- 后端路由：[notifications.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/notifications.ts)（L21/38/58）
- 路由挂载：[routes-registry.ts#L927](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L927) `app.use('/api/notifications', authenticateToken(JWT_SECRET), createNotificationsRouter())`

## 11. 待办与风险
- `[TODO]` 通知列表无分页，通知数 > 1000 时一次性加载性能差；建议加分页或虚拟滚动
- `[TODO]` `listNotifications` 失败静默 `catch { /* ignore */ }`，用户看到空列表无法区分"无通知"与"加载失败"；建议加 error state + 重试
- `[TODO]` 通知类型 `TYPE_LABEL` 仅 5 种，后端新增类型会展示原始 type 字符串（`TYPE_LABEL[n.type] ?? n.type`），建议加"未知类型"占位
- `[TODO]` `unread_count` 字段后端有返回但本页未展示；可在顶部加"X 条未读"提示
- `[RISK]` `listNotifications` 不传 signal（`signal ? { signal } : {}`），组件卸载时不会 abort 请求；虽用 `cancelledRef` 防 setState，但请求仍会完成（浪费带宽）
- `[RISK]` 通知列表不会自动刷新（无 WS / 无轮询），用户需手动点「刷新」；新通知到达时无感知
- `[RISK]` `useBaseFallback()` 根据 pathname 前缀决定返回路径，若用户直接访问 `/admin/notifications`，`goBack` 可能回到 `/admin` 而非来源页（依赖 `useGoBack` 实现）
- `[RISK]` 已读标记是乐观更新（先 setState 再发请求），若请求失败 UI 已标记已读但后端未更新，下次刷新会回滚到未读

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
