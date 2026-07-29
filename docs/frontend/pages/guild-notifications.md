# 玩家门户：通知（/guild/notifications）

> 📌 本文件为历史版本（按路由名 `notifications` 命名），保留作历史记录。
> 权威文档已迁移到 [guild-messages.md](guild-messages.md)（按组件名 `GuildMessages` 命名，2026-07-26 重写）。
> 后续维护请优先更新 `guild-messages.md`，本文件不再同步更新。

- [ROUTE] `/guild/notifications`（入口：`https://gsp.ecsrz.com:3001/guild/notifications`）
- 状态：已完成（2026-07-25，初版）/ 已被 [guild-messages.md](guild-messages.md) 接替（2026-07-26）
- BUILD：`20260725-011`

## 1. 页面定位

玩家门户的“通知/消息中心”页面，用于聚合展示当前登录用户的站内通知（订单到账/过期、CDK礼包、VIP变更、系统公告等），并提供：

- 列表浏览（最近消息在前）
- 搜索（按标题/内容包含匹配）
- 类型筛选（Chips）
- 已读管理（点击标记已读 / 一键全部已读）
- 关联实体跳转（关联服务器/订单时提供快捷入口）

该页面偏“消费与社交层（Player Portal）”的用户通知中心，与后台管理端 `/admin/notifications`、服主工作台 `/store/notifications` 共用同一套通知 API 与未读数机制。

## 2. 入口与路由

- [ROUTE] `/guild/notifications` 为 `/guild` 基座下子路由（写法为 `<Route path="/guild">` 下的 `path="notifications"`）
- 受登录保护：整个 `/guild/*` 基座位于 `ProtectedRoute` 之下，未登录访问会重定向到 `/login`，并携带 `from=/guild/notifications`
- 兼容重定向：旧路径 `/notifications` 统一重定向到 `/guild/notifications`
- 导航入口：玩家门户侧边栏/移动端底部导航均包含“消息”入口，路径固定为 `/guild/notifications`

浏览器侧核对（已登录态）：

- 页面标题为“消息”，顶部有“刷新”icon button
- “全部已读”按钮在 `暂无未读消息` 时置灰不可点击
- 顶部存在搜索框“搜索消息…”
- 类型 Chips：全部 / 订单已到账 / 订单已过期 / CDK礼包 / VIP变更 / 系统通知
- 当前数据为空时展示空态“暂无未读消息”

## 3. 角色与权限

- 访问权限：任意已登录用户（player portal）
- 鉴权方式：
  - 前端路由：`ProtectedRoute` 基于 `useAuth()` 的 `user` 状态决定是否跳转 `/login`
  - 后端接口：`/api/notifications/*` 挂载时统一套 `authenticateToken(JWT_SECRET)`，并在 handler 内检查 `req.user?.userId`

## 4. 核心功能点

- 消息概览：
  - 页面标题“消息”
  - 未读提示：`N 条未读消息` / `暂无未读消息`
- 刷新：
  - 右上角“刷新”图标按钮，重新拉取通知列表
- 全部已读：
  - “全部已读”按钮；当 `unreadCount===0` 时置灰不可点击
- 搜索：
  - 搜索框按标题/内容包含匹配（小写比较）
- 类型筛选：
  - “全部” + 固定类型列表（订单到账/过期、CDK礼包、VIP变更、系统通知）
- 列表展示：
  - 未读：卡片左侧蓝色强调边框 + 小圆点提示
  - 已读：透明度降低（`opacity: 0.7`），不可点击提示（cursor default）
  - 时间格式：刚刚 / X分钟前 / X小时前 / X天前 / 7天以上显示“月/日”
- 关联跳转：
  - `related_server_id` 存在时展示“前往服务器”
  - 若同时存在 `related_order_id` 则展示“查看订单”（`/guild/servers/:id/orders`）

## 5. 交互流程

1. 用户进入 `/guild/notifications`
2. 页面 mount 后自动调用 `api.listNotifications()` 拉取通知列表
3. 用户可进行：
   - 点击“刷新”按钮手动重新拉取
   - 在搜索框输入关键字过滤列表（本地过滤，不触发后端请求）
   - 点击类型 Chips 过滤列表（本地过滤）
4. 已读操作：
   - 点击未读卡片任意非链接区域：触发 `markNotificationRead(id)`，并把该条 `is_read` 置为 true
   - 点击“全部已读”：触发 `markAllNotificationsRead()`，并把列表中全部条目置为已读
5. 关联跳转：
   - 点击“前往服务器/查看订单”会跳转到关联页；该点击会 `stopPropagation()`，因此不会触发“点击卡片标记已读”的逻辑（详见边界说明）

## 6. 接口与数据

- [API] `GET /api/notifications`
  - 响应：
    - `notifications: NotificationSummary[]`
    - `unread_count: number`（未读总数，后端额外 count）
- [API] `PATCH /api/notifications/:id/read`
  - 说明：将指定通知标记为已读（后端按 `user_id + id` 限定，越权无法更新他人通知）
- [API] `PATCH /api/notifications/read-all`
  - 说明：将当前用户所有未读通知标记为已读

数据字段（前端页面实际用到）：

- `id/type/title/content/is_read/created_at`
- 关联字段：`related_server_id`、`related_order_id`

## 7. 状态管理与副作用

- 状态
  - `notifs: NotificationSummary[]`
  - `loading: boolean`
  - `search: string`
  - `activeType: string`
- 副作用
  - `useEffect([])`：首次进入自动 `refresh()` 拉取列表
  - 本地派生：
    - `filtered = notifs` + search/type 本地过滤
    - `unreadCount = notifs.filter(!is_read).length`
- 与全局未读数关系
  - Layout 的侧边栏未读数由 `notificationStore`（WebSocket 推送 + 断线轮询兜底）驱动
  - 本页的未读数显示来自当前列表的本地计算，不直接使用 `unread_count` 字段

## 8. 错误与边界

- [EDGE] 未登录访问
  - 前端：`ProtectedRoute` 跳 `/login`（携带来源路径 `from`）
  - 后端：无 `req.user?.userId` 返回 401（`PANEL_UNAUTHORIZED`）
- [EDGE] 列表刷新失败静默
  - `refresh()` catch 时忽略错误（无 toast），用户只能看到列表停留在旧值或空态
- [EDGE] “点击链接不标记已读”
  - 关联跳转链接使用 `stopPropagation()`，导致点击“前往服务器/查看订单”不触发卡片点击逻辑；消息可能仍保持未读
- [EDGE] 未读数可能与后端 `unread_count` 不一致
  - 本页未读数来自 `notifs` 的本地计算；若后端存在更多未读但未出现在 `listForUser(limit=50)` 返回里，本页会低估未读数
- [EDGE] 新通知类型的降级展示
  - `TYPE_LABEL` 未覆盖的 type：展示为原始字符串（badge），图标使用默认 Bell；需要 UI/文案补齐才会更友好

## 9. 体验与一致性检查

- [UX] Apple 浅色系变量（`--gp-*`）为主；未读强调采用蓝色边框 + 小圆点，符合“轻提示”风格
- [UX] 搜索 + Chips 组合属于移动端常用过滤模式；过滤在本地完成，响应快
- [UX] loading 骨架屏使用 4 行固定占位，避免首屏跳动
- [RISK] 刷新失败无提示：用户可能误以为“没有消息”；若该页是关键通知入口，建议至少 toast 一次失败提示或展示轻量错误条

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 基座子路由 notifications）：[App.tsx:L434-L458](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L434-L458)
- 旧路由重定向（/notifications → /guild/notifications）：[App.tsx:L460-L470](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L460-L470)
- 受保护路由实现（未登录跳 /login 并携带 from）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L128-L146)
- 页面实现（刷新/搜索/筛选/已读逻辑/关联跳转）：[GuildMessages.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildMessages.tsx#L1-L329)
- 导航入口（玩家门户“消息”）：[Layout.tsx:L89-L97](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L89-L97)
- 全局未读数（WS 推送 + 断线轮询降级）：[Layout.tsx:L546-L616](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L546-L616)
- API 客户端（listNotifications/markRead/markAllRead）：[client.ts:L1391-L1411](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1391-L1411)
- REST/WS 基址拼接（同源 / VITE_API_BASE 推导）：[env.ts:L7-L42](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/config/env.ts#L7-L42)
- 后端路由挂载（/api/notifications + JWT 鉴权）：[routes-registry.ts:L665-L670](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L665-L670)
- 后端路由实现（GET 列表 + PATCH 已读/全部已读）：[notifications.ts:L18-L73](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/notifications.ts#L18-L73)
- WS 推送策略（创建/已读后推送 unread_count）：[notificationService.ts:L56-L149](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/notificationService.ts#L56-L149)
- WS user 维度广播（broadcastToUser）：[server.ts:L277-L294](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/websocket/server.ts#L277-L294)

## 11. 待办与风险

- [TODO] 线上可用性核对：确认 502 的原因（上游 3002/面板后端不可达、证书/反代配置、或服务未启动），恢复后补齐“已登录态”下的真实 UI 行为核对
- [TODO] 一致性优化：在 `refresh()` 失败时给出一次轻量提示（toast 或 EmptyState 错误文案），避免静默失败误导用户
- [TODO] 已读体验：点击“前往服务器/查看订单”是否也应标记已读；若需要，考虑去掉 `stopPropagation()` 或在 Link click 时手动 `markRead`
- [RISK] 列表 limit=50 + 未读数来自列表：当未读数较多时，页面显示的“未读条数”可能与侧边栏未读数/后端未读总数不一致，引发用户困惑
