# 发现页（GuildDiscover）

## 1. 页面定位
> 玩家门户内的"发现页"，用 C 端 App Store 风格展示公开服务器列表（推荐/热门/新开三 Tab + 搜索），让玩家快速找到并进入感兴趣的服务器实例。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/guild/discover`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/discover`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/discover`
- 进入方式：
  - 底部 5 tab 中的"发现"（`/guild/discover`，[Layout.tsx#L801](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L801)）
  - 侧边栏导航"发现"（`/guild/discover`，[Layout.tsx#L90](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L90)）
  - 顶部栏"发现"按钮跳 `/discover`，由 `DiscoverGate` 判断：已登录 → 重定向到 `/guild/discover`；未登录 → 渲染公开 `Discover` 页（[App.tsx#L181-L189](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L181-L189)）
- 退出方式：
  - 点击 Hero 或任一服务器卡片 → `navigate('/guild/servers/:id')` 进入玩家实例详情/店铺页
  - 点击右上角"刷新"图标按钮重新拉取（不离开页面）
  - 切换底部其他 tab 离开本页

## 3. 角色与权限
- 允许角色：所有已登录用户（user+）
- 守卫：`ProtectedRoute`（外层 `GuildLayout` 已包裹，[App.tsx#L451](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451)）
- 未登录行为：
  - 直接访问 `/guild/discover`：`ProtectedRoute` 重定向到 `/login`，携带 `state.from=/guild/discover`
  - 访问 `/discover` 网关：未登录用户渲染公开 `Discover` 页（不强制登录）
- 数据接口权限：`/api/discover/*` 为公开接口（无需 JWT），但玩家门户里通常仍会带上 JWT（后端可忽略）

## 4. 核心功能点
- 推荐 Tab：展示"编辑推荐"Hero（取列表第 1 项）+ 卡片列表（从第 2 项开始）
- 热门 Tab：展示公开服务器列表（后端排序降级为：推荐优先 + 新创建优先）
- 新开 Tab：展示公开服务器列表（按 `created_at` 倒序）
- 搜索过滤：按"服务器名 / 游戏名（pack 映射）/ 服主用户名"本地过滤（小写比较）
- 服务器卡片：图标 + 名称 + 在线状态点 + 游戏 badge + 在线人数 badge + 服主 + 开服时间
- 快捷进入：点击 Hero 或任一卡片跳转 `/guild/servers/:id`

## 5. 交互流程
1. 用户进入 `/guild/discover`，`useEffect` 触发 `refresh()` 并发拉取 3 份列表（`Promise.all`）
2. 加载中：展示 Hero Skeleton + 4 个 `ServerCardSkeleton`
3. 加载成功：默认 Tab = 推荐（recommended）
   - 若推荐列表非空：展示 Hero（第 1 个）+ 卡片列表（`filtered.slice(1)`）
4. 用户切换 Tab（推荐/热门/新开）：切换 `currentServers`，应用搜索过滤
5. 用户输入搜索：本地过滤当前 Tab 列表（不触发后端请求）
6. 用户点击刷新按钮：重新拉取 3 份列表并重置 `error`
7. 用户点击 Hero 或卡片：`navigate('/guild/servers/:id')`
8. 组件 unmount：`cancelledRef.current = true`，避免 setState on unmounted

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/discover/recommended?limit=8` | GET | 公开（JWT 可选） | 拉取推荐服务器列表 | 500（后端异常） |
| `/api/discover/hot?limit=10` | GET | 公开（JWT 可选） | 拉取热门服务器列表 | 500 |
| `/api/discover/new?limit=10` | GET | 公开（JWT 可选） | 拉取新开服务器列表 | 500 |

返回契约 `DiscoverListResponse`：`{ servers: DiscoverServer[] }`

`DiscoverServer` 主要字段：
- `id`：用于跳转 `/guild/servers/:id`
- `name`：卡片标题
- `pack_id`：映射为游戏标签（`PACK_GAME_MAP` 静态表）
- `status`：是否在线（`status === 'running'`）
- `online_players`：人数展示（后端表缺字段时固定为 0）
- `owner_username`：可选展示（用于"服主：xxx"）
- `created_at`：用于"今日新开/几天前开服/日期"文案

前端请求路径：`api.discoverRecommended(8)` / `api.discoverHot(10)` / `api.discoverNew(10)`（[client.ts#L2103-L2120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2103-L2120)）

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 仅取 `api`（不消费 `user`）
- Local state：
  - `data: { recommended, hot, newServers } | null`
  - `loading: boolean`
  - `error: string | null`
  - `tab: 'recommended' | 'hot' | 'new'`（默认 `'recommended'`）
  - `search: string`
  - `cancelledRef: useRef(false)`（unmount 安全保护）
- 副作用：
  - `useEffect` 依赖 `refresh`，mount 时触发首屏拉取；return 时设 `cancelledRef.current = true`
  - `useMemo` 根据 `tab` 选择 `currentServers`；再基于 `search` 计算 `filtered`
  - `useDocumentTitle('发现')` 设置浏览器标题

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 加载中 | Hero Skeleton + 4 个 ServerCardSkeleton | 骨架样式与真实卡片结构对齐 |
| 接口错误 | 错误卡片（红色文案）+ "重试"按钮 | 错误文案取 `err.message`，非 Error 回退"加载失败" |
| 推荐列表只有 1 项 | Hero 展示，列表区为空（`slice(1)` 后） | 列表区无空态提示，视觉上只有 Hero |
| 有搜索词且过滤为空 | `EmptyState` → "没有找到匹配的服务器" + "尝试调整搜索关键词" | — |
| 无搜索词且分类为空 | `EmptyState` → "暂无服务器" + "该分类下暂时没有公开服务器" | — |
| Hero 展示条件 | `!loading && !error && tab==='recommended' && filtered.length>0` | 仅推荐 Tab 显示 Hero |
| unmount 后 setState | `cancelledRef.current` 拦截 | 避免 React 警告 |
| pack_id 未在 `PACK_GAME_MAP` | 截断展示 `packId.slice(0,10)...` | 新 pack 接入时显示不友好 |
| `online_players` 后端固定 0 | UI 显示 "0 人在线" | 影响"热门"语义 |
| `owner_username` 为 null | 不展示"服主：xxx"行 | — |
| `created_at` 时间格式 | `formatTimeAgo`：今日/X天前/X周前/月日 | 7 天内用相对时间，超过用日期 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：Apple 浅色系（`gp-*` 类），主色 `--gp-blue` (#007AFF)，使用 `gp-card` / `gp-hero` / `gp-search-bar` / `gp-badge` / `gp-icon-btn` 等组件类，与 `/guild/notifications` 风格一致
- `[UX]` 移动端适配：移动端优先设计；分段 Tab 使用 `gp-segment-bg` 容器；卡片整卡可点（`cursor: pointer`），符合移动端操作习惯
- `[UX]` 一致性：
  - 服务器卡片信息密度合理：图标 + 名称 + 状态点 + 游戏 badge + 在线 badge + 服主/开服时间
  - 推荐 Hero 视觉强调：渐变背景 `--gp-grad-primary` + 阴影 + "编辑推荐" badge
  - 搜索框 placeholder "搜索服务器名称、游戏…" 与实际过滤维度（含服主用户名）一致
  - 刷新按钮使用 `gp-icon-btn` 图标按钮，与 `/guild/notifications` 一致

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L451-L474](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L474)（`/guild` 基座 + `path="discover"` 子路由在 L467）
- `/discover` 网关：[App.tsx#L181-L189](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L181-L189)（`DiscoverGate`，登录用户重定向到 `/guild/discover`）
- 页面组件：[GuildDiscover.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDiscover.tsx)（含 `ServerCard` / `ServerCardSkeleton` 子组件）
- Layout：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)（`variant="player"`）
- 底部 tab 配置：[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)（"发现" tab）
- 侧边栏导航：[Layout.tsx#L88-L96](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L88-L96)（PLAYER_LINKS）
- 路径激活映射：[Layout.tsx#L216-L220](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L216-L220)（`/guild/discover` 映射）
- API client：[client.ts#L2103-L2120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2103-L2120)（`discoverHot` / `discoverNew` / `discoverRecommended`）
- 数据契约：[panel-api-types.ts#L2807-L2824](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L2807-L2824)（`DiscoverServer` / `DiscoverListResponse`）
- 后端路由实现：[discover.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/discover.ts)
- 后端路由挂载：[routes-registry.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts)（`/api/discover` 挂载点）

## 11. 待办与风险
- `[TODO]` 浏览器实测：推荐 Hero 展示、卡片点击跳转 `/guild/servers/:id`、搜索过滤是否区分大小写（代码用 `toLowerCase` 应为不区分）
- `[TODO]` 核对后端 `GET /api/discover/hot` 的 limit 行为：前端传 `?limit=10`，后端目前固定 10（若未来支持可变 limit，需同步文档）
- `[TODO]` 推荐列表只有 1 项时，列表区为空但无空态提示，建议补充"暂无更多推荐"或调整 Hero 策略
- `[RISK]` `online_players` 在后端可能长期为 0（DB 无实时在线缓存字段）；前端 UI 会展示"0 人在线"，严重影响"热门"语义与用户决策
- `[RISK]` `PACK_GAME_MAP` 为前端静态映射表，新 pack 接入时显示为截断的 packId（如 `7daystodie` → "七日杀" 已覆盖，但未来新游戏需手动补映射或改为后端提供 `display_name`）
- `[RISK]` `/discover` 网关对未登录用户渲染公开 `Discover` 页（旧 Layout），与 `/guild/discover`（player 基座）是两套实现，存在功能/视觉双重分支，维护成本高
- `[RISK]` 推荐 Tab 列表 `slice(1)` 跳过第 1 项以避免与 Hero 重复，若用户切回其他 Tab 再切回推荐，Hero 仍是第 1 项但列表会重新 slice，行为一致但用户可能困惑"为什么推荐少一个"
