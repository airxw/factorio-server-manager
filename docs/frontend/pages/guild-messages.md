# 消息页（GuildMessages）

> 📌 本文件为 `/guild/notifications` 路由的规范文档（按组件名 `GuildMessages` 命名）。
> 历史文件 [guild-notifications.md](guild-notifications.md) 仍保留（按 Skill 规则不删除存量），但本文件为权威来源。

## 1. 页面定位
> 玩家门户的"消息中心"页面，聚合展示当前登录用户的站内通知（订单到账/过期、CDK 礼包、VIP 变更、系统公告），提供搜索、类型筛选、标记已读/全部已读、关联实体跳转能力。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/guild/notifications`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/notifications`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/notifications`
- 进入方式：
  - 底部 5 tab 中的"消息"（`/guild/notifications`，[Layout.tsx#L802](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L802)）
  - 侧边栏导航"消息"（`/guild/notifications`，[Layout.tsx#L91](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L91)）
  - 旧路径 `/notifications` 自动重定向到 `/guild/notifications`（[App.tsx#L483](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L483)）
  - 侧边栏未读数气泡点击也会跳转（[Layout.tsx#L852](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L852) `navigate('/guild/notifications')`）
- 退出方式：
  - 点击消息卡片内"前往服务器"/"查看订单"链接跳到关联实体页（`stopPropagation`，不触发标记已读）
  - 点击右上角"刷新"按钮重新拉取（不离开页面）
  - 切换底部其他 tab 离开本页

## 3. 角色与权限
- 允许角色：所有已登录用户（user+）
- 守卫：`ProtectedRoute`（外层 `GuildLayout` 已包裹，[App.tsx#L451](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451)）
- 未登录行为：`ProtectedRoute` 重定向到 `/login`，携带 `state.from=/guild/notifications`（[App.tsx#L149-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L149-L151)）
- 后端鉴权：`/api/notifications/*` 挂载时统一套 `authenticateToken(JWT_SECRET)`，handler 内检查 `req.user?.userId`，越权访问返回 401

## 4. 核心功能点
- 消息概览：标题"消息" + 未读提示（`N 条未读消息` / `暂无未读消息`）
- 刷新：右上角"刷新"图标按钮（`gp-icon-btn`），重新拉取通知列表
- 全部已读：右上角"全部已读"按钮（`gp-btn-ghost`），`unreadCount===0` 时置灰 disabled
- 搜索：搜索框（`gp-search-bar`）按标题/内容包含匹配（小写比较），本地过滤
- 类型筛选：Chips（`gp-chips`），"全部" + 5 种类型（订单到账/过期、CDK 礼包、VIP 变更、系统通知）
- 列表展示：
  - 未读：左侧蓝色 3px 强调边框 + 蓝色小圆点 + 不透明
  - 已读：`opacity: 0.7`，无强调边框，`cursor: default`
  - 类型图标 + 颜色（Package/Gift/Zap/Shield/Bell）
  - 时间格式：刚刚 / X分钟前 / X小时前 / X天前 / 月日
- 关联跳转：
  - `related_server_id` 存在：展示"前往服务器"链接 → `/guild/servers/:id`
  - 同时存在 `related_order_id`：展示"查看订单"链接 → `/guild/servers/:id/orders`
  - 链接点击 `stopPropagation()`，不触发卡片点击逻辑
- 点击未读卡片任意非链接区域：触发 `markNotificationRead(id)` 乐观更新

## 5. 交互流程
1. 用户通过底部 tab"消息"进入 `/guild/notifications`
2. `useEffect` 触发 `refresh()` → 调用 `api.listNotifications()` → `GET /api/notifications`
3. 加载中：展示 4 行 Skeleton 占位
4. 加载成功：渲染消息列表（按 `created_at` 倒序）
5. 用户可执行：
   - 点击"刷新"图标：重新拉取列表（失败时静默，无提示）
   - 输入搜索关键字：本地过滤（标题 + 内容，小写比较）
   - 点击类型 Chip：本地过滤（按 `type` 精确匹配）
6. 已读操作：
   - 点击未读卡片非链接区域：触发 `markNotificationRead(id)` → `PATCH /api/notifications/:id/read`，乐观更新 `is_read=true`；失败时 toast 提示
   - 点击"全部已读"：触发 `markAllNotificationsRead()` → `PATCH /api/notifications/read-all`，乐观更新全部 `is_read=true`；成功 toast "已全部标记为已读"，失败 toast 错误
7. 关联跳转：
   - 点击"前往服务器"：`<Link to="/guild/servers/:related_server_id">`，`stopPropagation` 避免触发卡片点击
   - 点击"查看订单"：`<Link to="/guild/servers/:related_server_id/orders">`，同样 `stopPropagation`
8. 组件 unmount：`cancelledRef.current = true`，避免 setState on unmounted

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/notifications` | GET | JWT | 拉取当前用户通知列表（默认 limit=50） | 401（未登录）/ 500 |
| `/api/notifications/:id/read` | PATCH | JWT | 标记指定通知为已读（按 `user_id + id` 限定） | 401 / 404（不存在）/ 500 |
| `/api/notifications/read-all` | PATCH | JWT | 将当前用户所有未读通知标记为已读 | 401 / 500 |

返回结构：
- `GET /api/notifications` → `{ notifications: NotificationSummary[], unread_count: number }`
- PATCH 接口 → `void`

`NotificationSummary` 字段（[notificationStore.ts#L28-L37](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/notificationStore.ts#L28-L37)）：
- `id: number`
- `type: string`（`order_delivered` / `order_expired` / `cdk_gift` / `vip_changed` / `system_announcement`）
- `title: string`
- `content: string`
- `related_server_id: string | null`
- `related_order_id: number | null`
- `is_read: boolean`
- `created_at: string`（ISO）

前端请求路径（[client.ts#L1526-L1546](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1526-L1546)）：
- `api.listNotifications(signal?)` → `request('/notifications', { signal })`
- `api.markNotificationRead(id)` → `request('/notifications/:id/read', { method: 'PATCH' })`
- `api.markAllNotificationsRead()` → `request('/notifications/read-all', { method: 'PATCH' })`

## 7. 状态管理与副作用
- Context / Store：
  - `useAuth()` 提供 `api`
  - `useToast()` 提供 `toast.success` / `toast.error`（标记已读失败时提示）
  - 注意：本页**不直接消费** `notificationStore`（全局未读数由 Layout 侧边栏消费 WS 推送 + 断线轮询）；本页未读数来自本地 `notifs` 计算
- Local state：
  - `notifs: NotificationSummary[]`
  - `loading: boolean`
  - `search: string`
  - `activeType: string`（默认 `''` = 全部）
  - `cancelledRef: useRef(false)`
- 副作用：
  - `useEffect` 依赖 `refresh`，mount 时触发首屏拉取；return 时设 `cancelledRef.current = true`
  - `useMemo` 计算 `filtered`（基于 `search` + `activeType` 本地过滤）
  - `useMemo` 计算 `unreadCount`（`notifs.filter(!is_read).length`）
  - `useDocumentTitle('消息')` 设置浏览器标题
- 乐观更新策略：
  - `markRead(id)`：先发请求，成功后 `setNotifs(prev => prev.map(...))` 局部更新；失败 toast，不回滚（UI 仍为未读）
  - `markAll()`：先发请求，成功后全部置 `is_read=true` + toast 成功；失败 toast 错误

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 加载中 | 4 行 Skeleton 占位（图标 + 标题 + 内容） | 固定 4 行避免首屏跳动 |
| 列表刷新失败（`refresh` catch） | **静默忽略**（`/* ignore */`），无 toast 无错误条 | 用户可能误以为"没有消息" |
| `markRead(id)` 失败 | `toast.error(err.message)` | UI 不回滚，仍为未读 |
| `markAll()` 失败 | `toast.error(err.message)` | UI 不回滚 |
| `markAll()` 时 `unreadCount===0` | 提前 return，不发请求 | 按钮 disabled 拦截 |
| 列表为空（`notifs.length===0`） | `gp-empty-icon-wrap` + Bell 图标 | 区分"无消息"与"搜索无匹配" |
| 搜索/筛选无匹配 | `EmptyState` → "没有匹配的消息" + "尝试调整搜索或筛选条件" | — |
| 新通知类型未在 `TYPE_LABEL` 覆盖 | badge 显示原始 `type` 字符串，图标用默认 Bell | 文案不友好 |
| 点击关联链接不标记已读 | 链接 `stopPropagation()`，不触发卡片点击 | 消息可能仍保持未读 |
| 未读数与后端 `unread_count` 不一致 | 本地计算可能低估 | 后端 `listForUser(limit=50)` 只返回前 50 条 |
| `content` 为空字符串 | 不渲染 `<p>` 内容区 | — |
| `related_server_id` 为 null | 不渲染关联链接 + 不渲染右侧箭头 | — |
| unmount 后 setState | `cancelledRef.current` 拦截 | 避免 React 警告 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：Apple 浅色系（`gp-*` 类），主色 `--gp-blue` (#007AFF)，使用 `gp-card` / `gp-search-bar` / `gp-chips` / `gp-badge` / `gp-icon-btn` / `gp-btn-ghost` / `gp-link` / `gp-empty-icon-wrap` 等组件类，与 `/guild/discover` 风格一致
- `[UX]` 移动端适配：移动端优先设计；Chips 横向排列；卡片整卡可点（未读时 `cursor: pointer`），符合移动端操作习惯
- `[UX]` 一致性：
  - 类型图标 + 颜色映射清晰（Package=绿/Gift=橙/Zap=紫/Shield=蓝/Bell=灰）
  - 时间相对格式与 `/guild/discover` 的 `formatTimeAgo` 略有差异（本页多了"刚刚"和"X 小时前"档位）
  - 未读强调采用蓝色左边框 + 小圆点，符合"轻提示"风格
  - 刷新失败无提示，与 `/guild/discover`（有错误卡片 + 重试）不一致，体验割裂

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L451-L474](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L474)（`/guild` 基座 + `path="notifications"` 子路由在 L468）
- 旧路径重定向：[App.tsx#L483](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L483)（`/notifications` → `/guild/notifications`）
- 受保护路由实现：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)（`ProtectedRoute`，未登录跳 `/login` 并携带 `from`）
- 页面组件：[GuildMessages.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildMessages.tsx)（含 `typeIcon` / `formatTime` / `renderLink` 内部函数）
- Layout：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)（`variant="player"`）
- 底部 tab 配置：[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)（"消息" tab）
- 侧边栏导航：[Layout.tsx#L88-L96](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L88-L96)（PLAYER_LINKS）
- 侧边栏未读数气泡点击：[Layout.tsx#L852](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L852)
- 全局未读数（WS 推送 + 断线轮询降级）：[Layout.tsx#L546-L616](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L546-L616)
- 通知类型 store：[notificationStore.ts#L27-L37](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/notificationStore.ts#L27-L37)（`NotificationSummary` 接口）
- API client：[client.ts#L1526-L1546](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1526-L1546)（`listNotifications` / `markNotificationRead` / `markAllNotificationsRead`）
- 后端路由挂载（`/api/notifications` + JWT）：[routes-registry.ts#L665-L670](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L665-L670)
- 后端路由实现：[notifications.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/notifications.ts)
- WS 推送策略（创建/已读后推送 `unread_count`）：[notificationService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/notificationService.ts)
- WS user 维度广播：[server.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/websocket/server.ts)

## 11. 待办与风险
- `[TODO]` 浏览器实测：未登录访问 `/guild/notifications` 的实际跳转链路（是否携带 `from` 并回跳）
- `[TODO]` 一致性优化：在 `refresh()` 失败时给出轻量提示（toast 或 EmptyState 错误文案），避免静默失败误导用户
- `[TODO]` 已读体验：点击"前往服务器/查看订单"是否也应标记已读；若需要，考虑去掉 `stopPropagation()` 或在 Link click 时手动 `markRead`
- `[TODO]` 类型映射补齐：`TYPE_LABEL` 仅覆盖 5 种类型，新增类型时需同步前端映射表（或改为后端返回 `type_label`）
- `[TODO]` 时间格式与 `/guild/discover` 的 `formatTimeAgo` 统一（本页多了"刚刚"和"X 小时前"档位）
- `[RISK]` 刷新失败静默：`refresh()` catch 时 `/* ignore */`，用户可能误以为"没有消息"；若该页是关键通知入口，建议至少 toast 一次失败提示或展示轻量错误条
- `[RISK]` 未读数与后端 `unread_count` 不一致：本页未读数来自 `notifs` 的本地计算，若后端存在更多未读但未出现在 `listForUser(limit=50)` 返回里，本页会低估未读数，与侧边栏未读数（来自 WS 推送）显示不一致，引发用户困惑
- `[RISK]` 点击关联链接不标记已读：`stopPropagation()` 导致点击"前往服务器/查看订单"不触发卡片点击逻辑，消息可能仍保持未读，用户需二次操作
- `[RISK]` 新通知类型降级展示：`TYPE_LABEL` 未覆盖的 `type` 直接展示原始字符串（如 `order_refunded`），图标用默认 Bell，文案不友好
- `[RISK]` `markRead` 乐观更新失败不回滚：网络失败时 UI 仍显示已读（因 `setNotifs` 在 catch 之前未执行，实际仍为未读，但用户看不到错误提示之外的反馈），需确认 `toast.error` 后用户能否理解"操作未生效"
- `[RISK]` `related_order_id` 跳转路径 `/guild/servers/:id/orders` 是否真实存在路由注册（[App.tsx#L451-L474](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L474) 仅见 `servers/:id`，未见 `servers/:id/orders` 子路由），可能命中 404
