# 流程：玩家门户商品购买（含绑定前置）

## 目标

描述 `user` 角色用户在 `/guild` 基座下完成商品购买的完整链路：从商城入口浏览服务器 → 进入沉浸式店铺 → 检查账号绑定 → 购买商品 → 物品发放到游戏角色 → 在订单中心查看。覆盖 v4.15.2 起的"强制直接发放到绑定角色"约束（移除选择/输入字段）。

## 前置条件

- 用户已登录且角色为 `user`。
- 用户已绑定游戏角色（`status=verified`）。未绑定用户购买按钮 disabled，显示橙色提示栏"先绑定"。
- 目标服务器已配置 shop-config（`/api/store/servers/:id/shop-config` 返回 Banner + 商品列表）。
- 商品有库存且价格 > 0（免费商品走 CDK 兑换流程，不走购买流程）。

## 主流程

```
[/guild/shop 或 /guild/servers]
        │
        │  GET /api/servers（user 角色按 bindings 过滤）
        │  显示服务器卡片（Banner + 名称 + 在线人数）
        ▼
[点击服务器卡片]
        │
        ▼
[/guild/servers/:id → ServerDetailGuild 渲染]
        │
        │  并行拉取：
        │  - GET /api/servers/:id（实例详情）
        │  - GET /api/store/servers/:id/shop-config（店铺配置）
        │  - GET /api/player-bindings?server_id=:id（我绑定的角色）
        │  - GET /api/servers/:id/shop-items（商品列表）
        │  - GET /api/servers/:id/shop-orders?status=pending（待领取订单）
        │
        ▼
[渲染沉浸式店铺]
   │
   ├─ 顶部 Banner（自定义图 + 服务器名 + 简介 + 在线人数）
   ├─ AccountBindingCard（账号绑定状态）
   │    │
   │    ├─ 未绑定 → 橙色提示 + "先绑定"按钮 → /guild/bind
   │    ├─ 已绑定 → 绿色提示 "✓ 已绑定角色：XXX，商品将直接发放到该角色"
   │    └─ 多角色 → 角色切换下拉
   │
   └─ 商品列表（ShopItemList）
        │
        │  每个商品卡片显示：图标 / 名称 / 描述 / 价格 / 库存 / 购买按钮
        ▼
[点击"购买"按钮]
        │
        │  前置检查：
        │  - 绑定状态 = verified？否 → 跳 /guild/bind
        │  - 库存 > 0？否 → toast "库存不足"
        │  - 钱包余额 ≥ 价格？否 → toast "余额不足"
        │
        ▼
[POST /api/servers/:id/shop-items/:itemId/purchase]
   Body: { binding_id: 当前选中角色ID, quantity: 1 }
        │
        │  后端处理：
        │  1. 校验 binding_id 属于当前用户且 status=verified
        │  2. 校验商品库存 + 价格
        │  3. 扣减钱包余额（事务）
        │  4. 创建 shop_order 记录（status=pending）
        │  5. 调用 daemon 发放物品到游戏角色背包（异步）
        │  6. daemon 返回成功 → 更新 order.status=claimed
        │     daemon 返回失败 → order.status=pending，等待玩家手动领取
        │
        ▼
[前端 toast.success("购买成功，物品已发放到游戏角色背包")]
        │
        │  本地状态更新：
        │  - 钱包余额 -= 价格
        │  - 商品库存 -= 1
        │  - 待领取订单列表 += 新订单
        │
        ▼
[刷新订单列表 GET /api/servers/:id/shop-orders?status=pending]
        │
        ▼
[渲染"待领取"高亮卡片 + 领取码复制按钮]
```

## 失败与回退

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---------------|---------|------|
| 未登录访问 `/guild/shop` | `<ProtectedRoute>` 跳 `/login` 携带 `state.from=/guild/shop` | [App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154) |
| 服务器不存在或已下架 | `ServerDetailGuild` 显示"实例不存在"空态 + 返回按钮 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 服务器未配置 shop-config | 显示默认 Banner + 空商品列表 + "店铺尚未配置商品"提示 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 用户未绑定角色 | 商品购买按钮 disabled + 橙色提示栏"先绑定" + 跳转 `/guild/bind` | 见 [guild-server-detail.md §5](../pages/guild-server-detail.md) |
| 用户已绑定但 status≠verified | 商品购买按钮 disabled + 黄色提示栏"待验证" + 跳转 `/guild/profile/verify` | 见 [guild-server-detail.md §5](../pages/guild-server-detail.md) |
| 商品库存为 0 | 购买按钮 disabled + 显示"已售罄" | 见 [guild-server-detail.md §5](../pages/guild-server-detail.md) |
| 钱包余额不足 | `toast.error("余额不足，请充值")` + 购买按钮保持 enabled（允许重试） | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 购买接口 401 | axios 拦截器跳 `/login` | 见 [client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts) |
| 购买接口 403 | `toast.error("无权操作")` — 通常因 binding_id 不属于当前用户 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 购买接口 409 | `toast.error("库存不足或商品已下架")` + 刷新商品列表 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| 购买接口 500 | `toast.error("服务器错误，请稍后重试")` + 不扣减本地钱包 | 见 [guild-server-detail.md §8](../pages/guild-server-detail.md) |
| daemon 发放失败 | order.status 保持 pending，前端显示"待领取" + 领取码 | 玩家可在游戏内手动领取或联系服主 |
| `getShopConfig` 失败 | 静默降级为默认 Banner（吞错 RISK） | 见 [guild-server-detail.md §11](../pages/guild-server-detail.md) |
| 网络抖动 | axios 拦截器重试 1 次 + toast 提示 | 见 [client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts) |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT | 获取可购买商品的服务器列表（user 角色按 bindings 过滤） | 401 / 500 |
| `/api/servers/:id` | GET | JWT | 获取实例详情（Banner / 名称 / 简介 / 在线人数） | 401 / 404 / 500 |
| `/api/store/servers/:id/shop-config` | GET | JWT | 获取店铺配置（自定义 Banner + 商品列表布局） | 401 / 404 / 500 |
| `/api/player-bindings?server_id=:id` | GET | JWT | 获取当前用户在该服务器的绑定角色列表 | 401 / 500 |
| `/api/servers/:id/shop-items` | GET | JWT | 获取商品列表（图标 / 名称 / 描述 / 价格 / 库存） | 401 / 500 |
| `/api/servers/:id/shop-items/:itemId/purchase` | POST | JWT | 购买商品（扣钱包 + 创建订单 + 调 daemon 发放） | 401 / 403 / 409 / 500 |
| `/api/servers/:id/shop-orders` | GET | JWT | 获取订单列表（按 status 过滤） | 401 / 500 |
| `/api/servers/:id/shop-orders/:orderId/claim` | POST | JWT | 手动领取订单（daemon 异步发放失败时的兜底） | 401 / 404 / 409 / 500 |

## 页面引用

- 商城入口：[guild-shop.md](../pages/guild-shop.md) / [guild-servers.md](../pages/guild-servers.md)
- 沉浸式店铺：[guild-server-detail.md](../pages/guild-server-detail.md) / [guild-server-shop.md](../pages/guild-server-shop.md)（同一页面两份梳理）
- 绑定前置：[guild-bind.md](../pages/guild-bind.md)
- 订单查看：[guild-orders.md](../pages/guild-orders.md)
- 身份验证：[admin-profile-verify.md](../pages/admin-profile-verify.md)（跨基座共享）

## 关键实现定位（代码引用）

- 路由入口：
  - `/guild/shop`：[App.tsx#L453](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L453)
  - `/guild/servers/:id`：[App.tsx#L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L456)
  - `/guild/bind`：[App.tsx#L459](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L459)
  - `/guild/orders`：[App.tsx#L460](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L460)
- 页面组件：
  - [GuildShop.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx)
  - [GuildServers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildServers.tsx)
  - [ServerDetailGuild.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx)
  - [GuildBind.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildBind.tsx)
  - [GuildOrders.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildOrders.tsx)
- 子组件：
  - [AccountBindingCard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/AccountBindingCard.tsx) — 绑定状态卡片
  - [ShopItemList.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx) — 商品列表
- API client（[client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts)）：
  - `listServers` L631-L634
  - `getServer` L635-L637
  - `getInstanceShopConfig` L2241-L2245
  - `listPlayerBindings` L934-L936（含 `?server_id=` 过滤）
  - `listShopItems` L765-L770
  - `purchaseShopItem` L771-L778
  - `listShopOrders` L779-L785
- 后端路由挂载：
  - `/api/servers`：[routes-registry.ts#L825](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L825)
  - `/api/store`：[routes-registry.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts) — 含 `/servers/:id/shop-config`
  - `/api/player-bindings`：[routes-registry.ts#L905](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L905)
  - `/api`（含 `/servers/:id/shop-items` + `/shop-orders`）：[routes-registry.ts#L906](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L906)
- daemon 发放物品：daemon 端 RCON 命令调用（具体命令模板由 pack.yaml 的 `give_command` 定义）

## 风险与待办

- `[RISK]` **`getShopConfig` 静默吞错**：失败时降级为默认 Banner，用户无法感知"店铺配置加载失败"。建议改用 `Promise.allSettled` 区分"空配置"与"加载失败"。详见 [guild-server-detail.md §11](../pages/guild-server-detail.md)。
- `[RISK]` **`online_players` 后端固定为 0**：店铺顶部"在线人数"长期显示 0，影响购买决策。建议后端补实时在线缓存字段。详见 [guild-server-detail.md §11](../pages/guild-server-detail.md) / [guild-discover.md §11](../pages/guild-discover.md)。
- `[RISK]` **购买接口 500 后钱包不回滚**：后端事务失败时钱包已扣减但订单未创建，用户钱没了也没收到物品。建议后端确保事务原子性 + 前端失败时刷新钱包余额。详见 [guild-server-detail.md §11](../pages/guild-server-detail.md)。
- `[RISK]` **daemon 异步发放超时无 UI 反馈**：购买成功 toast 已弹，但 daemon 发放可能耗时 5-30s，期间用户以为已到账。建议加"发放中"中间态 + 轮询订单状态。详见 [guild-server-detail.md §11](../pages/guild-server-detail.md)。
- `[RISK]` **多角色账号购买时 binding_id 切换不持久**：刷新页面后默认选中第一个绑定角色，用户可能误购到错误角色。建议将上次选中的 binding_id 持久化到 localStorage。详见 [guild-server-detail.md §11](../pages/guild-server-detail.md)。
- `[RISK]` **`/guild/servers/:id/orders` 路由未注册**：GuildMessages 的"查看订单"链接跳转该路由会 404，影响购买后查看订单流程。详见 [guild-messages.md §11](../pages/guild-messages.md)。
- `[TODO]` 商品列表加服务端分页（当前全量加载，100+ 商品时性能风险）。
- `[TODO]` 购买按钮加防抖（避免快速双击重复购买）。
- `[TODO]` 钱包余额不足时引导用户到充值页面（当前仅 toast 提示）。
- `[TODO]` 购买成功后自动跳转 `/guild/orders?status=pending`（当前停留在商品列表页）。

## 梳理元数据

- 梳理日期：2026-07-26
- 梳理方式：基于 `/guild` 基座 5 篇核心购买链路页面文档串联（代码阅读产出，未做浏览器核对）
- 覆盖页面：guild-shop / guild-servers / guild-server-detail / guild-bind / guild-orders
- 版本基线：v4.15.2+（强制直接发放到绑定角色，移除选择/输入字段）
