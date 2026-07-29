# 玩家门户：我的订单（GuildOrders）

- [ROUTE] `/guild/orders`（入口：`https://gsp.ecsrz.com:3001/guild/orders`、`https://192.168.5.14:3001/guild/orders`）
- 状态：已完成（2026-07-26 复核，确认与 v4.15.0 实现一致；仅修正 API 行号）
- BUILD：`20260726-XXX`

## 1. 页面定位

玩家门户的“我的订单”页面，用于展示当前登录用户的跨实例购买记录，并在待领取/领取中状态下展示“领取码”供用户复制到游戏内兑换。

该页不绑定某个具体实例（不像 `/guild/servers/:id`），而是聚合所有实例订单，便于玩家统一查看消费记录与履约状态。

## 2. 入口与路由

- [ROUTE] `/guild/orders` 为 `/guild` 基座下子路由（实际路由写法为 `<Route path="/guild">` 下的 `path="orders"`）
- 页面在 `ProtectedRoute` 保护下：未登录访问会被重定向到 `/login`，并携带 `from=/guild/orders`
- 该路径在 Layout 的底部导航激活映射中归属 `/guild` 首页 tab（保持玩家门户底部导航一致性）

浏览器侧核对（无登录态）：
- 直接访问 `https://gsp.ecsrz.com:3001/guild/orders` 会看到“登录玩家门户”页面（说明该路由受登录保护）

## 3. 角色与权限

- 访问权限：任意已登录用户（player portal）
- 鉴权方式：
  - 前端路由：`ProtectedRoute` 基于 `useAuth()` 是否有 `user` 决定跳转
  - 后端接口：`/api/my/*` 在挂载时统一套 `authenticateToken(JWT_SECRET)`，并在 handler 内再次校验 `req.user?.userId`，只返回本人数据

## 4. 核心功能点

- 订单状态筛选 Tab：全部 / 待领取 / 已领取 / 已过期
- 订单卡片展示：
  - 实例名（instance_name）
  - 订单状态 badge（pending/claiming/claimed/expired）
  - 下单时间（created_at）
  - 金额（total_price）
  - 物品明细（items：item_name / count / quality / price）
- 待领取/领取中订单：
  - 展示领取码（claim_code）
  - “复制”按钮一键复制到剪贴板
  - 在 “全部” tab 下会置顶并高亮
- 刷新按钮：按当前 tab 重新拉取订单
- 空态：无订单时引导去 `/guild/shop` 继续浏览商品

## 5. 交互流程

1. 用户进入 `/guild/orders`
2. 页面 mount 后自动请求订单列表（默认 tab=all）
3. 用户可切换 tab：
   - 切到 `pending/claimed/expired` 会触发重新请求对应筛选结果
4. 用户可点击“刷新”重新拉取当前 tab 的订单列表
5. 若订单状态为 `pending/claiming`：
   - 可点击“复制”把 `claim_code` 写入剪贴板（成功/失败 toast 提示）
6. 若当前筛选结果为空：
   - 展示空态 + “去逛逛”按钮跳转 `/guild/shop`

## 6. 接口与数据

- [API] `GET /api/my/orders`
  - Query：
    - `status` 可选：`pending | claimed | expired`
    - 说明：当 `status=pending` 时，后端同时返回 `pending + claiming`（领取中并入待领取）
  - 响应：`ListMyOrdersResponse`
    - `orders: MyOrderSummary[]`
  - 后端聚合逻辑要点：
    - `shop_orders` 联 `servers` 取 `instance_name`
    - `shop_order_items` 批量 IN 查询取物品明细（避免 N+1）
    - 按 `created_at desc`，上限 100 条
    - `status` 非法值会被忽略（回退为不加筛选）

## 7. 状态管理与副作用

- 状态
  - `tab: 'all' | 'pending' | 'claimed' | 'expired'`
  - `orders: MyOrderSummary[]`
  - `loading: boolean`
- 副作用
  - `useEffect([tab])`：tab 变化自动 `refresh(tab)`
  - `useMemo(sorted)`：在 “全部” tab 下把 `pending/claiming` 置顶（并通过 `highlight` 控制卡片样式）
  - `navigator.clipboard.writeText()`：复制领取码，失败时 toast “复制失败”

## 8. 错误与边界

- [EDGE] 未登录访问
  - 前端：`ProtectedRoute` 跳 `/login`（携带来源路径）
  - 后端：`authenticateToken` 或 handler 内 `!req.user?.userId` 返回 401（`PANEL_UNAUTHORIZED`）
- [EDGE] 接口失败
  - 前端：`refresh()` catch 后 toast “加载订单失败”（优先展示 `Error.message`）
  - 全局：API 客户端对 503 `MAINTENANCE_MODE` 会硬跳转 `/maintenance`
- [EDGE] 空态区分
  - `loading && orders.length === 0`：展示骨架屏
  - `sorted.length === 0`：展示空态（tab=all 显示“暂无订单”，其他 tab 显示“暂无xx订单”）
- [EDGE] 剪贴板权限
  - HTTPS 场景通常可用；若浏览器策略限制剪贴板写入，UI 会提示“复制失败”
- [EDGE] 后端表不存在/查询异常
  - 后端在查询处 `.catch(() => [])` 回退空列表，避免因表缺失导致 500（因此“空态”也可能意味着后端尚未具备对应数据表）

## 9. 体验与一致性检查

- [UX] 页面提供“待领取数量”提示：在 `pending` tab 的标签上追加 `(N)`
- [UX] 空态提供直达 `/guild/shop` 的 CTA，降低无订单场景的迷路成本
- [UX] `OrderCard` 为复制按钮提供 `aria-label`，便于无障碍识别
- [RISK] `GuildOrders.tsx` 文件头注释标注"深色电竞风（gp-* 类）"，但项目规则 `1.md` 明确"严禁使用杀马特电竞风和配色，主体颜色不建议使用深色配色"——实际代码使用 `gp-*` 体系（Apple 浅色风格 CSS 变量），文件头注释具有误导性，建议清除"深色电竞风"字样以避免后续维护者误读

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 基座子路由 orders）：[App.tsx#L451-L460](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L460)
- 受保护路由实现（未登录跳 /login 并携带 from）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- 基座 Layout（`variant="player"`，底部 5 tab）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) + [Layout.tsx#L818-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L818-L995)
- 底部 tab 激活映射（`/guild/orders` → `/guild`）：[Layout.tsx#L228](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L228)
- 页面实现（tab/刷新/置顶/复制领取码）：[GuildOrders.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildOrders.tsx#L1-L268)
  - 订单卡片 `OrderCard`（含状态徽章/物品明细/领取码复制）：[GuildOrders.tsx#L51-L138](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildOrders.tsx#L51-L138)
  - 主组件（tab 切换/sorted 置顶/pendingCount）：[GuildOrders.tsx#L140-L268](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildOrders.tsx#L140-L268)
- API 客户端（拼接 /api/my/orders + status query）：[client.ts#L961-L964](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L961-L964)
- API 前缀约定（REST_BASE = VITE_API_BASE + /api）：[env.ts#L13-L23](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/config/env.ts#L13-L23)
- 后端路由挂载（/api/my 套 JWT 鉴权）：[routes-registry.ts#L930](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L930)
- 后端聚合实现（GET /api/my/orders）：[my.ts#L62-L151](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/my.ts#L62-L151)
- 玩家门户首页入口（"我的订单" quick action）：[GuildDock.tsx#L65-L70](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L65-L70)
- 公共类型契约（`MyOrderSummary` / `ListMyOrdersResponse`）：[panel-api-types.ts#L3061-L3079](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts#L3061-L3079)

## 11. 待办与风险

- [TODO] 登录态下的实际数据回归：验证 orders 卡片字段（instance_name/items/claim_code/金额）是否与真实数据库字段一致
- [TODO] 大量订单场景：当前后端 limit=100，无分页；若玩家订单量增长，需补分页/时间筛选
- [RISK] 后端查询对“表不存在”回退空列表：会把“无订单”和“数据表缺失/迁移未完成”混淆；排查时需要结合后端日志或 DB 迁移状态确认
- [RISK] 剪贴板复制依赖浏览器权限策略：部分 WebView/隐私模式可能失败，需要 UI 兜底（例如显示可选中复制的文本框）后再统一体验
