# 好友页（Friends）

- [ROUTE] `/guild/friends`（公网入口：`https://gsp.ecsrz.com:3001/guild/friends`）
- 状态：已完成（2026-07-26）
- BUILD：`20260726-001`

## 1. 页面定位

> 玩家门户下的"好友页"：已登录用户的社交中心，提供好友列表（含在线状态筛选）、待处理好友请求（接受/拒绝）、添加好友（按用户 ID 发送请求）、删除好友等完整社交闭环。同时保留"推荐好友"占位区（同实例玩家推荐功能未实现）。

本页是 v4.8.0-L3 引入的社交入口，原路由为 `/friends`，v4.14.0 随基座统一迁入 `/guild/friends`，旧路径 [App.tsx#L481](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L481) 重定向到新路径。

## 2. 入口与路由

- `[ROUTE]` 路由路径：`/guild/friends`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/friends`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/friends`
- 路由注册位置：[App.tsx#L451-L465](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L465)
  - 父路由：`<Route path="/guild" element={<GuildLayout />}>`（L451）
  - 当前路由：`<Route path="friends" element={<Friends />} />`（L465）
- 旧路径兼容：`/friends` → `<Navigate to="/guild/friends" replace />`（[App.tsx#L481](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L481)）
- 进入方式：
  - 底部 5 tab 无"好友"入口，需通过以下方式进入：
    - 顶部用户菜单无直接入口（需核实）
    - 侧边栏 `PLAYER_LINKS` 中有"好友"项（[Layout.tsx#L93](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L93)），但 `variant="player"` 隐藏侧边栏，实际不可见——见 RISK
    - 浏览器直接输入 URL
    - 从其他页面（如 `/guild/discover`）跳转（需核实）
- 退出方式：
  - 顶部品牌"玩家门户"回到 `/guild`
  - 底部 5 tab 跳转其他基座页面
  - 浏览器后退
- 布局承载：`GuildLayout` → `Layout variant="player"`（移动端优先，无侧边栏，顶部导航 + 常驻底部 5 tab）

## 3. 角色与权限

- 允许角色：所有已登录用户（`user` / `instance_admin` / `server_admin` / `system_admin` / `admin`）
- 守卫：`ProtectedRoute`（外层 `/guild` 基座包裹，见 [App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)）
- 未登录行为：重定向到 `/login`，携带 `state.from=/guild/friends`
- 后端鉴权：`/api/friends/*` 系列端点挂载在 `authenticateToken` 下，按当前用户 ID 过滤，不泄露他人好友关系
- 数据所有权：`Friendship` 是双向记录（`user_id` + `friend_user_id`），前端 `resolveFriend` 按 `myId` 识别"对方"

## 4. 核心功能点

### 4.1 页头区（page-header）

- 标题"好友"
- 右侧"刷新"按钮（ghost 样式，loading 时 disabled）

### 4.2 添加好友入口（info-card）

- 标题"添加好友" + UserPlus 图标
- 表单：用户 ID 输入框（`form-control`，placeholder "输入用户 ID 发送好友请求"，`autoComplete="off"`） + "发送请求"按钮（primary）
- 输入为空时点击发送 → toast.warning"请输入用户 ID"
- 发送中按钮文案"发送中…" + disabled
- 发送成功 → toast.success"已发送好友请求" + 清空输入 + 自动 refresh

### 4.3 待处理请求（info-card）

- 标题"待处理请求（N）"
- 表格（`data-table`）：
  - 列：发送者 / 请求时间 / 操作
  - 发送者列：btn-link 按钮点击跳转 `/players/:from_user_id`（玩家档案页）
  - 请求时间列：`formatTime(req.created_at)`（zh-CN 本地化）
  - 操作列："接受"（success）+ "拒绝"（danger）按钮，操作中 disabled
- 空态：`EmptyState title="暂无待处理请求"`

### 4.4 好友列表（info-card）

- 标题"好友列表（N）" + Users 图标，N 为 `visibleFriends.length`
- 筛选切换（`btn-group`）：
  - "全部" — 显示所有好友
  - "在线（N）" — 仅显示 `onlineIds` 中的好友，N 为 `onlineIds.size`
- 表格（`data-table`）：
  - 列：用户名 / 状态 / 成为好友时间 / 操作
  - 用户名列：btn-link 按钮点击跳转 `/players/:other.id`
  - 状态列：`badge-running`（在线，绿）/ `badge-stopped`（离线，灰）
  - 成为好友时间列：`formatTime(f.accepted_at ?? f.created_at)`（优先显示 accepted_at，回退 created_at）
  - 操作列："删除"按钮（danger sm），操作中 disabled
- 删除二次确认：`useConfirm` 弹窗"删除好友" + "确定删除好友「xxx」？此操作不可撤销。" + danger 样式 + "删除"按钮
- 空态：`EmptyState`
  - 全部模式："暂无好友" + "通过上方「添加好友」入口添加好友。"
  - 在线模式："暂无在线好友" + "当前没有好友在线。"

### 4.5 推荐好友区（info-card，占位）

- 标题"推荐好友"
- `EmptyState title="推荐功能暂未开放" description="同实例玩家推荐功能尚在开发中，可先通过用户 ID 添加好友。"`
- 无后端支持，纯占位

## 5. 交互流程

### A. 页面初始化

1. 进入 `/guild/friends`
2. `useDocumentTitle('好友')` 设置浏览器标签标题
3. `useEffect` 触发 `refresh()`：
   - `setLoading(true)` + `setError(null)`
   - `Promise.all` 并行拉取：
     - `api.listFriends()` → 好友列表
     - `api.listPendingFriendRequests()` → 待处理请求
     - `api.listOnlineFriends()` → 在线好友列表（按 `friend_user_id` 收集到 `onlineIds` Set）
   - 任一失败 → `setError(err.message)`
   - `setLoading(false)`

### B. 添加好友

1. 输入用户 ID（`addUserId`） → 点击"发送请求"
2. 空输入 → toast.warning"请输入用户 ID"
3. `setSending(true)` + `api.sendFriendRequest(id)`
4. 成功 → toast.success"已发送好友请求" + 清空输入 + refresh
5. 失败 → toast.error"发送好友请求失败" + 错误 message
6. `setSending(false)`

### C. 接受/拒绝待处理请求

1. 点击"接受"/"拒绝"按钮
2. `setActioningId(req.id)` 禁用对应行按钮
3. `api.acceptFriendRequest(req.from_user_id)` / `api.rejectFriendRequest(req.from_user_id)`
4. 成功 → toast.success"已接受/已拒绝「xxx」的好友请求" + refresh
5. 失败 → toast.error"接受/拒绝好友请求失败" + 错误 message
6. `setActioningId(null)`

### D. 删除好友

1. 点击"删除"按钮
2. `useConfirm` 弹窗："删除好友「xxx」？此操作不可撤销。" + danger + "删除"按钮
3. 用户取消 → 直接返回，不发请求
4. 用户确认 → `setActioningId(f.id)` + `api.removeFriend(other.id)`
5. 成功 → toast.success"已删除好友「xxx」" + refresh
6. 失败 → toast.error"删除好友失败" + 错误 message
7. `setActioningId(null)`

### E. 筛选在线好友

1. 点击"在线（N）"按钮
2. `setViewMode('online')`
3. `visibleFriends` memo 重新计算：`friends.filter(f => onlineIds.has(resolveFriend(f).id))`
4. 切回"全部" → `setViewMode('all')` → 显示所有好友

### F. 跳转玩家档案

1. 点击好友用户名或待处理请求发送者用户名
2. `navigate('/players/${userId}')` 跳转玩家档案页
3. 注意：`/players/:userId` 不在 `/guild` 基座下，会跳出玩家门户布局——见 RISK

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/friends` | GET | JWT | 好友列表（Friendship 双向记录） | 401/500 |
| `/api/friends/pending` | GET | JWT | 待处理好友请求列表 | 401/500 |
| `/api/friends/online` | GET | JWT | 在线好友列表（用于派生在线状态） | 401/500 |
| `/api/friends/request` | POST | JWT | 发送好友请求（`friend_user_id`） | 401/400/409 |
| `/api/friends/:friendUserId/accept` | POST | JWT | 接受好友请求 | 401/400/404 |
| `/api/friends/:friendUserId/reject` | POST | JWT | 拒绝好友请求 | 401/400/404 |
| `/api/friends/:friendUserId` | DELETE | JWT | 删除好友 | 401/404 |

### 接口实现定位

- `api.listFriends()` → [client.ts#L2163-L2165](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2163-L2165)
- `api.listPendingFriendRequests()` → [client.ts#L2166-L2170](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2166-L2170)
- `api.listOnlineFriends()` → [client.ts#L2171-L2175](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2171-L2175)
- `api.sendFriendRequest(friendUserId)` → [client.ts#L2142-L2150](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2142-L2150)
- `api.acceptFriendRequest(friendUserId)` → [client.ts#L2151-L2156](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2151-L2156)
- `api.rejectFriendRequest(friendUserId)` → [client.ts#L2157-L2162](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2157-L2162)
- `api.removeFriend(friendUserId)` → [client.ts#L2176-L2181](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2176-L2181)

### 数据契约（关键字段）

- `Friendship`（双向记录）：
  - `id` / `user_id`（一方）/ `username` / `friend_user_id`（另一方）/ `friend_username` / `created_at` / `accepted_at?`
  - 注释明确：契约不含 `vip`/`online` 字段，在线状态由 `/friends/online` 列表派生
- `PendingFriendRequest`：
  - `id` / `from_user_id` / `from_username` / `created_at`
- `FriendListResponse`：`friends: Friendship[]`
- `PendingFriendRequestsResponse`：`requests: PendingFriendRequest[]`
- `FriendActionResponse`：操作结果

## 7. 状态管理与副作用

- 页面级 state（`useState`）：
  - `friends: Friendship[]` — 全部好友
  - `pending: PendingFriendRequest[]` — 待处理请求
  - `onlineIds: Set<string>` — 在线好友的 `friend_user_id` 集合
  - `loading: boolean` — 刷新中标志
  - `error: string | null` — 错误信息
  - `viewMode: 'all' | 'online'` — 筛选模式
  - `addUserId: string` — 添加好友输入
  - `sending: boolean` — 发送请求中
  - `actioningId: string | null` — 操作中的好友/请求 ID（禁用对应按钮）
- 派生状态（`useMemo`）：
  - `visibleFriends` — 按 `viewMode` 过滤后的好友列表
- memoized 函数（`useCallback`）：
  - `refresh` — 依赖 `[api]`
  - `resolveFriend` — 依赖 `[myId]`，识别 Friendship 中的"对方"
- 副作用：
  - `useEffect(refresh, [refresh])` — 挂载时触发首次加载
- 容错策略：`Promise.all` 任一接口失败即整体 `setError`，不部分降级——见 RISK
- 无 WS / 定时器 / 订阅，纯按需拉取模式
- 在线状态不实时：依赖 `refresh` 重新拉取 `listOnlineFriends`，无 WS 推送

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | `ProtectedRoute` 重定向 `/login` | 携带 `state.from` |
| 任一接口失败 | `ErrorState` 显示错误 + "重试"按钮 | `Promise.all` 单点失败致整体降级 |
| 添加好友空输入 | toast.warning"请输入用户 ID" | 不发请求 |
| 添加好友失败 | toast.error"发送好友请求失败" + 错误 message | 不清空输入，便于用户修正 |
| 接受/拒绝失败 | toast.error + 错误 message | 不刷新列表 |
| 删除好友取消 | `useConfirm` 返回 false，直接返回 | 不发请求 |
| 删除好友失败 | toast.error"删除好友失败" + 错误 message | 不刷新列表 |
| Loading + 空数据 | `Skeleton lines={5}` 占位 | 避免闪烁 |
| 在线筛选无结果 | `EmptyState title="暂无在线好友"` | 区分"全部"与"在线"空态文案 |
| 操作中按钮禁用 | `actioningId === f.id` 时 disabled | 防止重复提交 |
| 用户名点击跳转 | `navigate('/players/:userId')` | 跳出 `/guild` 基座，见 RISK |
| `formatTime` 异常 | try-catch 返回原始 iso 字符串 | 防止 toLocaleString 异常 |

## 9. 体验与一致性检查

- `[UX]` 设计语言：**与 `/guild` 基座其他页面不一致**——本页使用 `page` / `page-header` / `info-card` / `data-table` / `btn` 等通用类（旧版 admin 风格），而其他 guild 页面（GuildServers / ServerDetailGuild）使用 `gp-*` 类（guild-portal.css 玩家门户专属样式）。视觉风格割裂——见 RISK
- `[UX]` 移动端适配：
  - 表格 `data-table` 在窄屏下可能溢出，依赖全局 CSS 的 `table-wrap` 横向滚动——体验差
  - 添加好友表单 `flexWrap: 'wrap'` 自适应，输入框 `minWidth: 200`
  - 无移动端卡片视图（与 v4.26.0 B5 改造的 `mobile-card-list` 双视图规范不一致）
- `[UX]` 一致性：
  - `useDocumentTitle('好友')` 已调用，与其他 guild 页面一致
  - 使用 `useToast` 而非 `window.alert`，符合规范
  - 使用 `useConfirm`（非 `window.confirm`）做删除二次确认，符合 v4.26.0 B4 改造规范——比 ServerDetailGuild 的 `window.confirm` 更规范
  - 使用 `EmptyState` / `ErrorState` / `Skeleton` 通用组件，符合规范
  - 文件位置 `src/pages/Friends.tsx`（不在 `src/pages/guild/` 目录下）——与路由 `/guild/friends` 不一致，见 RISK
- `[UX]` 入口缺失：底部 5 tab 无"好友"入口，`variant="player"` 隐藏侧边栏导致 `PLAYER_LINKS` 中的"好友"项不可见；用户只能通过 URL 直接访问或从其他页面跳转——见 RISK
- `[UX]` 激活态：`/guild/friends` 在 `PATH_ACTIVE_MAP` 中映射到 `/guild/friends`（[Layout.tsx#L218](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L218)），但底部 5 tab 无"好友"项，无激活态反馈

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 子路由 friends）：[App.tsx#L451-L465](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L465)
- 旧路径兼容（/friends → /guild/friends）：[App.tsx#L481](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L481)
- 页面组件：[Friends.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx)
- 布局承载：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)
- 路由守卫 ProtectedRoute：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- 主组件 + 数据加载：[Friends.tsx#L31-L74](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L31-L74)
- `resolveFriend` 双向记录识别：[Friends.tsx#L80-L90](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L80-L90)
- `visibleFriends` memo：[Friends.tsx#L92-L100](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L92-L100)
- 添加好友 `handleSendRequest`：[Friends.tsx#L102-L119](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L102-L119)
- 接受/拒绝 `handleAccept` / `handleReject`：[Friends.tsx#L121-L145](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L121-L145)
- 删除好友 `handleRemove`（含 `useConfirm`）：[Friends.tsx#L147-L166](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L147-L166)
- `formatTime` 工具函数：[Friends.tsx#L20-L27](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L20-L27)
- API client（好友系列）：[client.ts#L2142-L2181](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2142-L2181)
- useAuth hook：[auth.tsx#L230-L236](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L230-L236)
- useDocumentTitle hook：[useDocumentTitle.ts#L11](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useDocumentTitle.ts#L11)
- useToast hook：[ToastContext.tsx#L178](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx#L178)
- useConfirm hook：[ConfirmContext.tsx#L98](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ConfirmContext.tsx#L98)
- UI 组件 EmptyState / ErrorState / Skeleton：[components/ui/index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts)
- 激活态映射 `/guild/friends`：[Layout.tsx#L218](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L218)
- 侧边栏 PLAYER_LINKS"好友"项（player variant 下不可见）：[Layout.tsx#L93](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L93)

## 11. 待办与风险

- `[RISK]` **入口缺失**：底部 5 tab（首页/商城/我的/发现/消息）无"好友"入口，`variant="player"` 隐藏侧边栏导致 `PLAYER_LINKS` 中的"好友"项（[Layout.tsx#L93](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L93)）不可见；用户只能通过 URL 直接访问或从其他页面跳转。建议在"我的"(`/guild/me`) 或顶部用户菜单增加"好友"入口
- `[RISK]` **视觉风格割裂**：本页使用 `page` / `info-card` / `data-table` / `btn` 通用类（旧版 admin 风格），而其他 guild 页面（GuildServers / ServerDetailGuild）使用 `gp-*` 类（guild-portal.css 玩家门户专属样式）。同一 `/guild` 基座下两套样式系统，违反设计语言一致性；建议重构为 `gp-*` 类
- `[RISK]` **文件位置与路由不匹配**：[Friends.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx) 位于 `src/pages/`，而路由 `/guild/friends` 期望位于 `src/pages/guild/`；其他 guild 页面（GuildServers / ServerDetailGuild / GuildBind 等）均在 `src/pages/guild/` 下。建议迁移文件位置以保持目录结构一致
- `[RISK]` **`Promise.all` 单点失败致整体降级**：[Friends.tsx#L55-L59](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L55-L59) 三个接口任一失败即整体 `setError`，不部分降级；与 v4.26.0 B8 改造规范（`Promise.allSettled`）不一致；建议改为 `Promise.allSettled`，任一成功仍渲染对应区块
- `[RISK]` **跳转 `/players/:userId` 跳出 `/guild` 基座**：[Friends.tsx#L238](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L238) 和 [Friends.tsx#L328](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Friends.tsx#L328) 点击用户名跳转 `/players/:userId`，该路由不在 `/guild` 基座下，会跳出玩家门户布局（无底部 5 tab、无顶部导航）；建议改为 `/guild/players/:userId` 或在 `/guild` 下增加玩家档案子路由
- `[RISK]` **在线状态不实时**：`onlineIds` 仅在 `refresh` 时刷新，无 WS 推送；好友上线/下线后用户无法及时感知，需手动点击"刷新"；建议接入 `notificationStore` 或好友状态 WS 推送
- `[RISK]` **`/api/friends/request` 缺少幂等性保护**：用户连续点击"发送请求"可能发送多个请求（虽有 `sending` 禁用按钮，但刷新后可再次发送）；建议后端做幂等校验（已存在的 pending 请求返回 409 而非新建）
- `[RISK]` **`acceptFriendRequest` / `rejectFriendRequest` 参数语义模糊**：[client.ts#L2151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2151) 参数名为 `friendUserId`，但实际传的是 `req.from_user_id`（请求发送者 ID）；参数命名与语义不一致，易误解
- `[TODO]` 补充浏览器核对：本文档基于代码阅读产出，未实际访问 `https://gsp.ecsrz.com:3001/guild/friends` 验证 UI 行为（表格在窄屏下的滚动、空态、删除确认弹窗）
- `[TODO]` 补充"推荐好友"功能规划：当前为占位 EmptyState，需梳理"同实例玩家推荐"的数据源与算法
- `[TODO]` 补充"好友请求"通知机制：当前用户需主动进入本页才能看到 pending 请求，建议接入站内消息（`/guild/notifications`）推送好友请求提醒
- `[TODO]` 核实 `/players/:userId` 路由是否存在（[App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx) 中需确认），若不存在则点击用户名会 404
- `[TODO]` 移动端表格改为卡片视图：参考 v4.26.0 B5 改造的 `mobile-card-list` 双视图规范，窄屏下展示卡片而非表格
- `[TODO]` 核实 `Friendship.accepted_at` 为 null 时的展示：当前回退到 `created_at`，但语义不同（创建时间 ≠ 成为好友时间），需确认后端是否会延迟设置 `accepted_at`
