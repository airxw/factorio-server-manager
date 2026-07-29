# 玩家门户：店铺页（/guild/servers/:id）

- [ROUTE] `/guild/servers/:id`（示例：`https://gsp.ecsrz.com:3001/guild/servers/55555555-5555-4555-8555-555555555555`）
- 状态：已完成（2026-07-25）
- BUILD：`20260725-010`

## 1. 页面定位

玩家门户的“沉浸式店铺页”（实例维度），提供：

- 店铺 Banner（服主可配置 banner/主题色/文案）
- 该实例的游戏账号绑定（用于“直接发放”类购买）
- 商品列表（品质筛选、搜索、下单）

## 2. 入口与路由

- [ROUTE] 路由：`/guild/servers/:id`（挂载在 `/guild` 基座下）
- 典型进入方式：
  - 从 [/guild/shop](./guild-shop.md) 点击服务器卡片“进入店铺”
  - 从 [/guild](./guild.md) 的“我的服务器”卡片进入
- 页面布局：由 `GuildLayout → Layout(variant="player")` 提供 chrome

## 3. 角色与权限

- 权限：受保护路由（需要登录）
- 实例访问权：后端可返回 403（`PANEL_FORBIDDEN`），前端会显示“您无权访问该实例”并隐藏所有功能卡片

## 4. 核心功能点

- 店铺头部（ShopHeader）
  - Banner 图片（可选）+ 主题色渐变兜底 + 实例名/状态叠加层
  - 可选外链：配置 banner_link 时整个 Banner 可点击跳转新窗口
- 游戏账号绑定（AccountBindingCard）
  - 未绑定：输入“游戏内玩家名”发起绑定
  - 待验证：展示验证步骤（游戏内聊天命令）+ 输入验证码确认/取消绑定
  - 已验证：展示已绑定玩家名 + 支持解绑
- 商品列表（ShopItemList）
  - 商品搜索 + 品质筛选（普通/精良/稀有/史诗/传说）
  - 下单购买（支持两种发放模式：取件码 / 直接发放）

## 5. 交互流程

**页面初始化**

1. 进入 `/guild/servers/:id`
2. 并行拉取：
   - 店铺外观配置（shop config）
   - 实例详情（用于 banner 叠加显示实例名/状态）
3. 渲染 Banner、账号绑定卡、商品列表

**账号绑定（概览）**

1. 未绑定状态输入玩家名 → 点击“绑定账号”
2. 进入待验证状态：按提示在游戏内执行验证命令后，将验证码填入页面确认
3. 验证通过后绑定状态变为 verified，商品页可开启“直接发放”模式

**商品购买（概览）**

- 默认发放模式为“取件码”（无需绑定角色）
- 切换到“直接发放”时若未绑定，会提示“请先绑定游戏角色才能使用「直接发放」”

## 6. 接口与数据

- [API] `GET /api/store/servers/:id/shop-config`：店铺外观配置（banner_url/banner_link/theme_color/description 等）
- [API] `GET /api/servers/:id`：实例详情（server.name/status/game_type 等）
- [API] `GET /api/player-bindings`：拉取当前用户的绑定列表（前端按 game_type 匹配）
- [API] `POST /api/player-bindings`：创建绑定（提交 `game_player_name`、`game_type`）
- [API] `POST /api/player-bindings/:bindingId/verify`：验证码确认
- [API] `DELETE /api/player-bindings/:bindingId`：取消/解绑
- [API] `GET /api/servers/:id/shop-items`：商品列表
- [API] `POST /api/servers/:id/shop-orders`：下单购买

## 7. 状态管理与副作用

- 页面级（ServerDetailGuild）
  - `shopConfig`、`server`、`currentBinding`
  - `configLoading`、`configError`
  - 主题色通过 CSS 变量 `--shop-theme-color` 注入，供子组件统一引用
- 绑定卡（AccountBindingCard）
  - 并行拉取 `getServer(serverId)` 与 `listPlayerBindings()`，按 game_type 选择最近的绑定
- 商品列表（ShopItemList）
  - `items`、`search`、`qualityFilter`
  - `deliveryMode`（`claim_code`/`direct`），未绑定时会强制回落到 `claim_code`

## 8. 错误与边界

- [EDGE] 实例无访问权：403 `PANEL_FORBIDDEN` → 页面仅显示“您无权访问该实例”，不渲染绑定与商品卡片
- [EDGE] Banner 图片加载失败：前端隐藏 img，使用主题色渐变兜底
- [EDGE] 未绑定时购买按钮呈“先绑定”禁用态（页面可见行为），用于引导先完成绑定流程
- [EDGE] “直接发放”模式严格依赖 verified 绑定，未绑定时不可切换

## 9. 体验与一致性检查

- [UX] 沉浸式 Banner + 主题色统一（通过 CSS 变量贯穿绑定卡与商品 CTA）
- [UX] 对 403 权限错误采用“完全隐藏功能卡片”的策略，避免“能看见但点不了”的挫败感
- [UX] 商品区提供品质 tabs + 搜索，符合移动端电商浏览习惯

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 子路由 servers/:id）：[App.tsx:L432-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L432-L456)
- 页面容器（ShopHeader + AccountBindingCard + ShopItemList）：[ServerDetailGuild.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L38-L223)
- 账号绑定卡（绑定/验证/解绑）：[AccountBindingCard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/AccountBindingCard.tsx#L48-L220)
- 商品列表（筛选/下单/发放模式）：[ShopItemList.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L56-L200)
- 店铺配置 API： [client.ts:getInstanceShopConfig](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1953-L1967)
- 商品与订单 API： [client.ts:L610-L630](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L610-L630)
- 账号绑定 API： [client.ts:L779-L800](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L779-L800)
- BUILD 常量来源：[buildInfo.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/buildInfo.ts#L1)
## 11. 待办与风险


- [TODO] 补充“购买后结果呈现”路径梳理：下单成功后的 toast/取件码展示位置与“我的订单”联动
- [TODO] 补充“绑定验证命令”在不同游戏（pack）下的差异（当前页面仅提示“游戏内聊天命令”）
- [RISK] 当前文档仅核对到“未绑定时禁用购买”的可见行为，未实际发起绑定/下单（避免产生不可逆数据），需后续人工复核真实链路
