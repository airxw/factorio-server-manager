# 我的资产（MyAssets）

## 1. 页面定位
> 玩家门户（Player Portal）下的"我的资产"聚合页，面向已登录用户展示账户概览、我管理的实例、最近订单、最近 CDK 兑换四个维度的个人数据概览。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/guild/me`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/me`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/me`
- 进入方式：
  - 底部 5 tab 中的"我的"（`/guild/me`，[Layout.tsx#L800](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L800)）
  - 侧边栏导航"我的资产"（`/guild/me`，[Layout.tsx#L92](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L92)）
  - 旧路径 `/me` 自动重定向到 `/guild/me`（[App.tsx#L478](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L478)）
- 退出方式：
  - 顶部/底部"刷新"按钮重新拉取数据（不离开页面）
  - 点击实例行"查看详情" → `navigate('/instances/:id')` 跳出 `/guild` 基座进入旧 Layout
  - 移动端底部"我的实例"按钮 → `navigate('/instances')` 跳出 `/guild` 基座
  - 切换底部其他 tab（首页/商城/发现/消息）离开本页

## 3. 角色与权限
- 允许角色：所有已登录用户（user+），含 `user` / `operator` / `viewer` / `instance_admin` / `admin` / `server_admin` / `system_admin`
- 守卫：`ProtectedRoute`（外层 `/guild` 基座由 `GuildLayout` 承载，已包裹在 `ProtectedRoute` 内，[App.tsx#L451](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451)）
- 未登录行为：`ProtectedRoute` 重定向到 `/login`，并携带 `state.from=/guild/me`（[App.tsx#L149-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L149-L151)）
- 数据边界：后端按 `req.user.userId` 聚合"本人数据"，不支持查询他人

## 4. 核心功能点
- 账户概览卡片：用户名、邮箱、角色 badge、VIP 等级、钱包余额、未读通知数
- 我管理的实例表格：实例名 / 状态 badge / 在线人数 / 查看详情按钮
- 最近订单表格：实例 / 物品 / 价格 / 状态 / 时间（取前 10 条）
- 最近 CDK 兑换表格：实例 / CDK 码 / 奖励 / 时间（取前 10 条）
- 顶部刷新按钮 + 移动端底部快捷操作栏（刷新 / 我的实例）

## 5. 交互流程
1. 用户登录后通过底部 tab"我的"或侧边栏"我的资产"进入 `/guild/me`
2. `useEffect` 触发 `refresh()` → 调用 `api.getMyAssets()` → `GET /api/me/assets`
3. 首次加载且 `data` 为空：展示 Skeleton 占位（6 行）
4. 加载成功：渲染 4 个 `info-card`（账户概览 / 我管理的实例 / 最近订单 / 最近 CDK 兑换）
5. 加载失败且无数据：展示 `ErrorState` + 顶部"刷新"按钮
6. 加载失败但已有数据：顶部叠加 `ErrorState`，原有数据继续可见
7. 用户点击"刷新"：`loading=true` 期间按钮 disabled，重新拉取数据
8. 用户点击实例行"查看详情"：`navigate('/instances/:id')` 跳出 `/guild` 基座
9. 移动端用户点击底部"我的实例"：`navigate('/instances')`

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/me/assets` | GET | JWT（Bearer Token） | 拉取当前用户资产聚合数据 | 401（未登录）/ 500（聚合服务异常）/ 503（维护模式硬跳转 `/maintenance`） |

返回契约 `MyAssetsResponse` 主要字段：
- `user: { id, email, username, role, status, created_at }`
- `wallet: { balance, last_daily_claim }`
- `vip: { level, exp }`
- `instances: Array<{ id, name, status, online_players }>`
- `recent_orders: Array<{ id, instance_id, instance_name, item_name, price, status, created_at }>`
- `recent_cdk_redeems: Array<{ id, instance_id, instance_name, cdk_code, reward, redeemed_at }>`
- `unread_notifications: number`

前端请求路径：`api.getMyAssets()` 内部 `request('/me/assets')`，生产同源拼接为 `/api/me/assets`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`（PanelApiClient）与 `user`（当前登录用户，作为 `data.user` 缺失时的降级数据源）
- Local state：
  - `data: MyAssetsResponse | null`
  - `loading: boolean`
  - `error: string | null`
- 副作用：
  - `useEffect` 依赖 `refresh`，mount 时触发首屏拉取
  - `useDocumentTitle('我的资产')` 设置浏览器标题
  - `refresh` 通过 `useCallback` 依赖 `api` 稳定引用
- 错误分层：fetch 失败/超时在 api client 层转换为 `PanelApiError('NETWORK_ERROR'|'TIMEOUT'|...)`；503 维护模式硬跳转 `/maintenance`

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 首次加载中（`loading && !data`） | Skeleton 6 行占位 | 避免空白闪烁 |
| 首次加载失败（`error && !data`） | `ErrorState` + 顶部"刷新"按钮 | `retrying` 状态绑定 `loading` |
| 局部错误（已有 `data` 时再失败） | 顶部叠加 `ErrorState`，原数据继续渲染 | 不中断已展示内容 |
| 实例列表空 | `EmptyState title="暂无管理的实例"` | — |
| 订单列表空 | `EmptyState title="暂无订单记录"` | — |
| CDK 列表空 | `EmptyState title="暂无 CDK 兑换记录"` | — |
| 实例状态未知 | `instanceStatusLabel` 回退原字符串 | 状态 map 仅覆盖 6 种 |
| 时间格式异常 | `formatTime` try/catch 回退原 ISO 字符串 | 依赖浏览器 `toLocaleString('zh-CN')` |
| 后端聚合降级 | 表不存在时 try/catch 返回默认值 | 订单/CDK/通知数可能为空或 0 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用项目通用 `info-card` / `data-table` / `badge` 类，未切换到 `gp-*` Apple 浅色系；与同基座下 `/guild/discover`、`/guild/notifications` 的 `gp-card` 风格不一致（视觉割裂风险）
- `[UX]` 移动端适配：`page-with-mobile-bar` 容器 + `mobile-quick-actions` 底部快捷栏，避免内容被底部 tab 遮挡；表格使用 `table-wrap` 横向滚动
- `[UX]` 一致性：
  - 角色 badge / VIP badge / 实例状态 badge 颜色映射一致（`badge-running` / `badge-starting` / `badge-stopped`）
  - 订单状态直接展示后端原值，未做中文映射（与 `instanceStatusLabel` 风格不一致）
  - 钱包余额使用 `mono` 等宽字体，但未做货币格式化（无千分位/单位）

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L451-L474](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L474)（`/guild` 基座 + `path="me"` 子路由）
- 旧路径重定向：[App.tsx#L478](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L478)（`/me` → `/guild/me`）
- 页面组件：[MyAssets.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/MyAssets.tsx)（注意：位于 `pages/` 而非 `pages/guild/`，历史命名遗留）
- Layout：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)（`variant="player"` 复用共享 Layout chrome）
- 底部 tab 配置：[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)（"我的" tab）
- 侧边栏导航：[Layout.tsx#L88-L96](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L88-L96)（PLAYER_LINKS）
- 路径激活映射：[Layout.tsx#L216-L234](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L216-L234)（`/guild/me` 与 `/me` 均映射）
- API client：[client.ts#L1371-L1373](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1371-L1373)（`getMyAssets()`）
- 数据契约类型：[panel-api-types.ts#L2421-L2429](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L2421-L2429)（`MyAssetsResponse`）
- 后端路由：[me.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/me.ts) + [routes-registry.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts)（`/api/me` 挂载）
- 后端聚合服务：[myAssetsService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/myAssetsService.ts)（含表缺失降级策略）

## 11. 待办与风险
- `[TODO]` 浏览器实测：未登录/过期 token 访问 `/guild/me` 的实际跳转链路（是否携带 `from` 并回跳）
- `[TODO]` 订单状态文案：`recent_orders[].status` 应前端映射为中文 badge（当前直接展示后端原值如 `pending` / `paid`）
- `[TODO]` 钱包余额格式化：补充货币单位、千分位、精度控制
- `[TODO]` 视觉一致性：将 `info-card` / `data-table` 替换为 `gp-card` 系列，与 `/guild/discover`、`/guild/notifications` 风格对齐
- `[RISK]` 实例"查看详情"跳转到 `/instances/:id`（旧 Layout 基座），从 `/guild` 基座跳出到 `/instances` 基座，用户感知割裂；底部 tab 也会从 player 5-tab 切换为 instance_admin+ 视图
- `[RISK]` "我管理的实例"`online_players` 后端聚合固定为 `0`（DB 无实时在线缓存字段），UI 长期展示 "0" 影响信息价值
- `[RISK]` `MyAssets.tsx` 文件路径不在 `pages/guild/` 子目录下，与同基座其他页面（`pages/guild/GuildDiscover.tsx` 等）命名组织不一致，未来迁移易遗漏
