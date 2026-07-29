# 实例详情 - 管理员视图（ServerDetailAdmin）

## 1. 页面定位
> 系统管理员（server_admin+）视角的实例详情页，复用 `ServerDetail` 组件，按角色自然展示全部 admin/ops Tab，承载实例控制台、配置、运维、业务运营、共管、角色管理等子模块。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/servers/:id`（支持 `?tab=console|mods|saves|config-files|...`）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/servers/:id`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/servers/:id`
- 进入方式：
  - 从 `/admin/servers` 列表点击实例（注意：列表实际跳转至 `/instances/:id`，非本页；本页需直接访问 URL）
  - 浏览器地址栏直接输入 `/admin/servers/:id`
  - 后向兼容重定向或程序内 `navigate('/admin/servers/:id')`
- 退出方式：顶部「← 返回列表」按钮跳转 `/instances`；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin`、`system_admin`、`admin`（由外层 `RequireRole allow={['server_admin','system_admin','admin']}` 守卫）
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)（双层，与 `/admin` 基座一致）
- 未登录行为：`<Navigate to="/login" replace />`
- 越权行为：`<Navigate to="/forbidden" replace />`
- 组件内角色差异化（`ServerDetail` 内部，[ServerDetail.tsx#L248-L271](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L248-L271)）：
  - `server_admin` / `system_admin` / `admin`（`isAdminRole`）：可见 `admins` Tab + `roles` Tab + `__business__` pseudo-tab（跳转业务运营二级页）
  - `instance_admin`（`isInstanceAdminOrAbove`）：可见 `roles` Tab，不见 `admins` Tab
  - `user`：`admins` / `roles` Tab 均不可见
- 后端鉴权：
  - `/api/servers/:id` 系列（GET/POST start/POST stop/DELETE）：仅 `authenticateToken`（无 requireAdmin，按实例 owner + 共管关系校验）
  - `/api/servers/:id/subdir/:subdir` DELETE：`authenticateToken` + 实例状态校验（running/starting 返回 409）
  - `/api/servers/:id/disk-usage` GET：`authenticateToken`
  - `/api/packs` GET：`authenticateToken`
  - WebSocket：JWT 透传（由 `RconConsole` 内部建立）

## 4. 核心功能点
- **可折叠信息卡**：默认折叠为一行摘要（状态/游戏/版本/端口/磁盘），点击展开 9 行完整信息；展开状态记忆到 `localStorage`（`gsp:server-detail:info-expanded`）
- **实例生命周期操作**：
  - 启动（仅 `stopped` 状态可启动，底部固定操作栏）
  - 停止（仅 `running` / `starting` 状态可停止）
  - 删除（仅 `stopped` 状态可删除，顶部按钮 + `ConfirmDialog` 要求输入实例名确认）
  - 刷新（重新拉取 `getServer`）
- **磁盘占用管理**：
  - 实时刷新按钮（调用 `getServerDiskUsage`，后端 `du -sb` 实时计算）
  - 子目录清理（`backups` / `saves` / `mods` / `logs` / `cache` 五个子目录，`ConfirmDialog` 危险确认 + 释放空间提示）
- **Tab 体系**（按分组渲染）：
  - `runtime` 组：`console`（RCON 控制台，单一 WS 连接）/ `log-files`（日志文件）/ `game-command-help`（命令帮助）
  - `config` 组：`config-files`（配置文件）/ `world-gen`（地图生成）
  - `ops` 组：`mods`（Mod 管理）/ `saves`（存档管理）/ `update`（服务端版本）/ `admins`（共管管理，admin+）/ `roles`（角色管理，instance_admin+）
  - `business` 组：`__business__` pseudo-tab（点击跳转 `/instances/:id/business`，仅 admin 可见）
  - Pack.ui_tabs 动态追加（按 `pack.business` 配置）
- **Tab 状态联动**：`require_state` 不匹配当前实例状态的 Tab 被过滤（如 `world-gen` 在 running 状态下不可见）
- **Tab 警告条**：`config-files` 在 running 状态显示「修改后需重启生效」；`world-gen` / `update` / `saves` / `mods` 在 running 状态显示红色危险警告
- **Tab keep-alive**：已访问过的 Tab 保持挂载（`display: none` 隐藏），保留分页/草稿等内部状态
- **URL ?tab= 同步**：切换 Tab 同步到 URL（`replace: true`）；浏览器前进/后退恢复 Tab
- **移动端左右滑动切换 Tab**：`useSwipe` hook，含越界 bounds check
- **RconConsole WebSocket**：单一 WS 连接，`onStateChange` 回传实时状态，`onConnectedChange` 回传连接态（重连成功时自动 `refresh()`）
- **底部固定操作栏**：启动/停止/刷新（删除保留在顶部 `page-actions`）

## 5. 交互流程
1. 路由匹配 → 双层 `RequireRole` 校验 → `ServerDetailAdmin` 挂载 → `Suspense` 包裹 lazy 加载 `ServerDetail`
2. `useParams` 取 `id` → `useEffect` 调用 `api.getServer(id)` → `setServer`
3. `cancelledRef` 守卫：组件卸载或切换实例时丢弃未完成请求的 `setState`（不使用 `AbortController`，避免 `ERR_ABORTED` 控制台噪音）
4. `server` 加载完成后，`useEffect` 调用 `api.listPacks()` 找到 `pack_id` 对应的 `ui_tabs` → `setUiTabs`
5. `allTabs` 合并 `BASE_USER_TAB_OBJECTS` + `uiTabs`（去重，按角色过滤 `admins` / `roles`）
6. `visibleTabs` 按 `require_state` 过滤 + business group 折叠为 `__business__` pseudo-tab
7. `groupedTabs` 按 `runtime → config → ops → business` 顺序聚合，组内按 `order` 升序
8. URL `?tab=` 与 `activeTab` 双向同步（切换 Tab 写入 URL，浏览器前进/后退恢复）
9. `activeTab` 变化时登记到 `activatedTabs`，使该 Tab 首次访问后保持挂载
10. 用户点击「启动」/「停止」/「删除」/「刷新磁盘」/「清理子目录」→ 对应 handler → toast 反馈
11. RconConsole 内部建立 WS，状态变化通过 `onStateChange` 回传 → `setLiveState` → 触发 `visibleTabs` 重新计算（状态联动）
12. WS 重连成功（`false → true`）自动 `refresh()` 拉取最新状态
13. 用户点击「← 返回列表」→ `navigate('/instances', { replace: true })`
14. 用户点击「业务运营」按钮（仅 admin 可见）→ `navigate('/instances/:id/business')`

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers/:id` | GET | `authenticateToken` | 实例详情（name/status/pack/port/rcon_port/owner_username/disk_usage_bytes 等） | 401 / 404 实例不存在 / 500 |
| `/api/servers/:id/start` | POST | `authenticateToken` | 启动实例 | 401 / 403 / `INVALID_SERVER_STATE` 409 / 500 |
| `/api/servers/:id/stop` | POST | `authenticateToken` | 停止实例 | 401 / 403 / `INVALID_SERVER_STATE` 409 / 500 |
| `/api/servers/:id` | DELETE | `authenticateToken` | 删除实例（仅 stopped 状态可删） | 401 / 403 / `INVALID_SERVER_STATE` 409 / 404 / 500 |
| `/api/servers/:id/disk-usage` | GET | `authenticateToken` | 实例磁盘占用明细（du -sb 实时统计） | 401 / 404 / 500 |
| `/api/servers/:id/subdir/:subdir` | DELETE | `authenticateToken` | 清理子目录（backups/saves/mods/logs/cache），返回 `freed_bytes` | 401 / 403 / 404 / 409 实例运行中 / 500 |
| `/api/packs` | GET | `authenticateToken` | Pack 列表（用于查找 `pack_id` 对应的 `ui_tabs`） | 401 / 500 |
| `[STATE]` WebSocket `rcon` 事件 | WS | `authenticateToken`（JWT 透传） | RCON 控制台实时输出 + 实例状态推送 | WS 断开时 RconConsole 显示「未连接」 |
| `/api/servers/:id/command` | POST | `authenticateToken` | RCON 命令发送（由 RconConsole 内部调用） | 401 / 403 / 500 |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` + `user`；`useConfirm()` 提供危险确认对话框；TanStack Query 未使用（手拉模式 + `cancelledRef` 守卫）
- Local state：
  - `server: ServerSummary | null` — 实例详情
  - `liveState: InstanceState | null` — WS 实时状态（覆盖 `server.status`）
  - `loading / error / actioning` 全局态
  - `showDeleteConfirm: boolean` — 删除二次确认弹窗
  - `refreshingDisk: boolean` — 磁盘刷新中
  - `cleaningSubdir: string | null` — 当前清理中的子目录名
  - `uiTabs: UITabObject[] | null` — Pack 提供的动态 Tab
  - `infoExpanded: boolean` — 信息卡折叠状态（localStorage 持久化）
  - `activeTab: string` — 当前激活 Tab（URL `?tab=` 派生）
  - `activatedTabs: Set<string>` — 已激活过的 Tab 集合（keep-alive）
  - `expandedGroups: Set<string>` — 展开的分组集合（默认 `runtime`）
- 副作用：
  - `useEffect` 挂载时 `refresh()`，卸载时 `cancelledRef.current = true`
  - `useEffect` 监听 `server` 变化 → `api.listPacks()` 加载 `uiTabs`
  - `useEffect` 监听 `activeTab` + `visibleTabs` → 自动展开 activeTab 所在分组
  - `useEffect` 监听 `tabs` + `activeTab` → activeTab 被移除时回落到 `console`
  - `useEffect` 监听 `searchParams` → 浏览器前进/后退恢复 Tab
  - `useEffect` 监听 `activeTab` → 登记到 `activatedTabs`
  - `useDocumentTitle(server?.name ? '实例 - ${name}' : '实例详情')`
  - `useSwipe` 监听移动端左右滑动 → 切换 Tab
  - RconConsole 内部 WS 订阅，`onStateChange` / `onConnectedChange` 回传
  - `prevConnectedRef` 监听 WS `false → true` 重连 → 自动 `refresh()`

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | 重定向 `/login` | `RequireRole` 守卫 |
| 角色不足 | 重定向 `/forbidden` | `RequireRole` 守卫 |
| `getServer` 失败 | `ErrorState` + 重试按钮 + 「返回列表」按钮 | `!server` 分支 |
| `getServer` 404 | `ErrorState`「服务器不存在或加载失败」 | 同上 |
| 组件卸载时请求未完成 | `cancelledRef.current = true` 丢弃 `setState` | 不使用 `AbortController`（避免 `ERR_ABORTED` 控制台噪音） |
| `listPacks` 失败 | 静默 `setUiTabs([])`，仅显示底座 Tab | `.catch(() => setUiTabs([]))` |
| 启动失败 | `setError` + `toast.error` | `INVALID_SERVER_STATE` 等 |
| 停止失败 | `setError` + `toast.error` | 同上 |
| 删除失败 + `INVALID_SERVER_STATE` | `setError`「仅 stopped 状态可删除」 + `toast.error` | 特定错误码映射 |
| 删除成功 | `toast.success`「实例已删除」 + `navigate('/instances', { replace: true })` | 离开详情页 |
| 磁盘刷新失败 | `toast.error` | 不影响主信息 |
| 子目录清理 + 实例运行中 | 前端预判 `toast.error`「实例运行中，无法清理子目录」 | 减少无效请求 |
| 子目录清理失败 | `toast.error` | 后端 409 也会被 catch |
| 子目录清理成功 | `toast.success`「X 清理完成，释放 Y」+ 自动刷新磁盘占用 | `handleRefreshDiskUsage` |
| 启动按钮 disabled | `!canStart`（`displayState !== 'stopped'`） | 防误操作 |
| 停止按钮 disabled | `!canStop`（非 `running` / `starting`） | 防误操作 |
| 删除按钮 disabled | `!canDelete`（`displayState !== 'stopped'`） | 防误操作 |
| WS 断开 | RconConsole 显示「未连接」badge，`liveState` 保持最后值 | 不覆盖 `server.status` |
| WS 重连成功 | 自动 `refresh()` 拉取最新状态 | `prevConnectedRef` 监听 `false → true` |
| activeTab 被移除（切换实例后 Pack 不支持） | 回落到 `console` | `useEffect` 监听 `tabs` |
| URL `?tab=` 无效 | 初始 `activeTab` 回落到 `console` | `TAB_LABELS[tabFromUrl]` 校验 |
| `config-files` Tab + running 状态 | 警告条「修改配置文件后需重启实例才能生效」 | `activeTabWarning` |
| `world-gen` / `update` / `saves` / `mods` + running 状态 | 红色危险警告「实例运行中，此 Tab 下的操作不可用。请先停止实例」 | `activeTabWarning.danger = true` |
| 磁盘占用 > 10GB | 加粗 + 黄色 `var(--color-warning)` | 视觉警示 |
| `localStorage` 不可用（隐私模式） | 静默降级，`infoExpanded` 默认 `false` | `try/catch` 兜底 |
| 移动端滑动越界 | `idx + 1 < tabs.length` / `idx - 1 >= 0` bounds check | 不触发切换 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用项目 CSS 类（`page` / `page-header` / `info-card` / `info-card-collapsible` / `tab-btn` / `bottom-action-bar` / `badge`），符合苹果清新风；信息卡折叠默认收起，移动端优先
- `[UX]` 移动端适配：`page-with-bottom-bar` 底部固定操作栏（避免移动端地址栏遮挡）；`useSwipe` 左右滑动切换 Tab；信息卡折叠默认收起，首屏直接看到 Tab
- `[UX]` 与其他页面一致性：状态 badge 与 `/admin/servers` 一致；`ConfirmDialog` 删除二次确认与列表页一致；`ErrorState` 与全局错误组件一致
- `[UX]` 键盘可达：信息卡折叠 `role="button"` + `aria-expanded` + `aria-controls` + Enter/Space 键盘事件；TabPanel `role="tabpanel"` + `aria-labelledby`；RconConsole WS 状态 `aria-label`
- `[UX]` 一致性问题：本页路由 `/admin/servers/:id`，但页面内「← 返回列表」按钮跳转 `/instances`（非 `/admin/servers`）；`ServerDetailAdmin` 是薄 wrapper 复用 `ServerDetail`，但 `ServerDetail` 也被 `/instances/:id` 使用，两套视图共享同一组件但路由不同，存在维护歧义

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L376](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L376) `<Route path="servers/:id" element={<ServerDetailAdmin />} />`（位于 [App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416) 的 admin 基座内）
- 页面 wrapper：[ServerDetailAdmin.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx) — `Suspense` + lazy 加载 `ServerDetail`
- 主体组件：[ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx)（1028 行）
- 守卫组件：[RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)
- 角色工具：[role.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts) — `isAdminRole` / `isInstanceAdminOrAbove`
- RCON 控制台：[RconConsole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RconConsole.tsx) — 单一 WS 连接 + `onStateChange` / `onConnectedChange` 回传
- 子页面（instance-detail/）：
  - [ConfigFiles.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/ConfigFiles.tsx)
  - [Mods.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/Mods.tsx)
  - [Saves.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/Saves.tsx)
  - [Players.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/Players.tsx)
  - [Admins.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/Admins.tsx)
  - [InstanceRoles.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/instance-detail/InstanceRoles.tsx)
- 滑动 hook：[useSwipe.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useSwipe.ts)
- 确认对话框：[ConfirmDialog.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ConfirmDialog.tsx)
- API client（前端）：
  - `getServer`：[client.ts#L583-L585](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L583-L585) → `request<ServerDetailResponse>('/servers/:id')`
  - `startServer`：[client.ts#L597-L601](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L597-L601) → `POST /servers/:id/start`
  - `stopServer`：[client.ts#L602-L606](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L602-L606) → `POST /servers/:id/stop`
  - `deleteServer`：[client.ts#L592-L596](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L592-L596) → `DELETE /servers/:id`
  - `getServerDiskUsage`：[client.ts#L1602-L1606](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1602-L1606) → `GET /servers/:id/disk-usage`
  - `cleanupSubdir`：[client.ts#L1730-L1735](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1730-L1735) → `DELETE /servers/:id/subdir/:subdir`
  - `listPacks`：[client.ts#L570-L572](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L570-L572) → `GET /packs`
- 后端路由：[servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts)
  - `router.post('/:id/start')` [servers.ts#L516](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L516)
  - `router.post('/:id/stop')` [servers.ts#L624](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L624)
  - `router.get('/:id/disk-usage')` [servers.ts#L793](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L793)
  - `router.delete('/:id/subdir/:subdir')` [servers.ts#L910](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L910)
- 挂载点：[routes-registry.ts#L814](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L814) `app.use('/api/servers', authenticateToken, createServersRouter(...))`

## 11. 待办与风险
- `[TODO]` 「← 返回列表」按钮跳转 `/instances`（玩家视图），但本页路由是 `/admin/servers/:id`（管理员视图）；建议根据角色跳转 `/admin/servers` 或 `/instances`
- `[TODO]` `/admin/servers` 列表页点击实例跳转 `/instances/:id`（非本页），导致本页入口缺失；建议列表页「详情」按钮按角色跳转 `/admin/servers/:id` 或 `/instances/:id`
- `[TODO]` `ServerDetailAdmin` 与 `ServerDetail` 共享同一组件，但路由不同；建议明确两套视图的差异（如管理员视图应默认展示「系统监控」「部署命令」「审计日志」等管理员专属 Tab，当前仅靠角色过滤 Tab，与 `/instances/:id` 无实质差异）
- `[TODO]` `cancelledRef` 守卫模式虽避免 `ERR_ABORTED` 噪音，但请求仍会完成（浪费带宽）；可在后端补 cancel token 或前端 debounce
- `[TODO]` `infoExpanded` 状态记忆到 `localStorage`，但未按实例 ID 区分，切换实例后会沿用上一次的展开状态
- `[RISK]` `ServerDetail` 被三个路由复用（`/instances/:id`、`/admin/servers/:id`、可能还有其他），任何修改都会影响所有视图；建议拆分为独立组件或通过 props 显式传角色上下文
- `[RISK]` `BASE_USER_TAB_OBJECTS` 中 `admins` / `roles` 用 `as unknown as UITabObject['tab']` 绕过 `InstanceTabSchema` 枚举（public/schema 冻结），存在类型安全风险
- `[RISK]` `__business__` pseudo-tab 点击跳转 `/instances/:id/business`（非 `/admin/servers/:id/business`），跨基座跳转可能导致用户上下文丢失
- `[RISK]` `cleanupSubdir` 前端预判实例状态（`running` / `starting` 拒绝），但后端也会校验，前端预判失败时（如状态滞后）后端 409 会被 catch 显示通用错误
- `[RISK]` `RconConsole` 单一 WS 连接设计意味着 Tab 切换不会断开 WS，但若用户在多 Tab 浏览器同时打开同一实例详情，会建立多个 WS 连接（后端需限流）
- `[RISK]` `useSwipe` 在桌面端也会注册事件，可能在触摸板误触时切换 Tab；建议限制为移动端
- `[RISK]` `visibleTabs` 按 `require_state` 过滤，但 `displayState` 取自 `liveState ?? server?.status`，WS 断线时 `liveState` 保持最后值，可能导致 Tab 状态联动失效

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（App.tsx / ServerDetailAdmin.tsx / ServerDetail.tsx 头部 + 关键段 / api/client.ts / 后端 routes-registry.ts + servers.ts + RconConsole.tsx grep）
