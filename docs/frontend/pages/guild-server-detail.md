# 玩家实例详情（ServerDetailGuild）

- [ROUTE] `/guild/servers/:id`（公网入口示例：`https://gsp.ecsrz.com:3001/guild/servers/55555555-5555-4555-8555-555555555555`）
- 状态：已完成（2026-07-26）
- BUILD：`20260726-001`
- 关联文档：[guild-server-shop.md](./guild-server-shop.md)（同一页面的早期梳理版本，本文为按 11 字段强制模板重写的版本，建议后续合并）

## 1. 页面定位

> 玩家门户下的"玩家视角实例详情页"：以 C 端电商导向展示单个游戏实例的店铺首页，包括沉浸式 Banner、游戏账号绑定卡、商品列表与下单。**严格屏蔽所有运维信息**（无启动/停止/RCON 控制台/日志文件/命令帮助等 tab），与 `/admin/servers/:id`（系统管理员运维视图）、`/store/servers/:id`（服主运营视图）构成三视图拆分。

本页是 v4.13.0 三视图拆分后的玩家分支，v4.15.2 起移除了对 `ServerDetail` 组件的嵌入，确保普通用户不会看到 RCON 控制台等运维 tab。

## 2. 入口与路由

- `[ROUTE]` 路由路径：`/guild/servers/:id`（`:id` 为实例 UUID）
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/servers/:id`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/servers/:id`
- 路由注册位置：[App.tsx#L451-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L456)
  - 父路由：`<Route path="/guild" element={<GuildLayout />}>`（L451）
  - 当前路由：`<Route path="servers/:id" element={<ServerDetailGuild />} />`（L456）
- 旧路径兼容：
  - `/instances/:id` 在 [App.tsx#L264-L278](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L264-L278) 的 `InstanceDetailRoleRedirect` 中按角色分流：`user` → `/guild/servers/:id`，`instance_admin` → `/store/servers/:id`，`server_admin` → `/admin/servers/:id`
  - `/instances/:id/shop` 由 [App.tsx#L201-L204](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L201-L204) 的 `InstanceShopRedirect` 重定向到 `/guild/servers/:id`
- 进入方式：
  - 从 [/guild/servers](./guild-servers.md) "我的服务器"卡片或"推荐服务器"卡片点击进入
  - 从 [/guild](./guild.md) 首页"我的服务器"区块点击进入
  - 从 [/guild/shop](./guild-shop.md) 商城点击服务器"进入店铺"
  - 从 [/guild/discover](./guild-discover.md) 发现页点击服务器卡片
  - 浏览器直接输入 URL（需有访问权）
- 退出方式：
  - 顶部品牌"玩家门户"回到 `/guild`
  - 浏览器后退回到来源页
  - 底部 5 tab 跳转其他基座页面
- 布局承载：`GuildLayout` → `Layout variant="player"`（移动端优先，无侧边栏）

## 3. 角色与权限

- 允许角色：所有已登录用户（`user` 及以上）
- 守卫：`ProtectedRoute`（外层 `/guild` 基座包裹，见 [App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)）
- 未登录行为：重定向到 `/login`，携带 `state.from=/guild/servers/:id`
- 实例访问权：后端 `requireInstanceAccess` 校验，无访问权时返回 403 `PANEL_FORBIDDEN`
- 403 处理：本页对 403 采用"完全隐藏功能卡片"策略——不渲染 `AccountBindingCard` 与 `ShopItemList`，仅显示"您无权访问该实例"友好提示（[ServerDetailGuild.tsx#L88-L104](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L88-L104)）
- 玩家视角保证：v4.15.2 移除 `ServerDetail` 组件嵌入，普通用户不会看到 RCON 控制台/日志文件/命令帮助等运维 tab（[ServerDetailGuild.tsx#L8](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L8) 注释明确）

## 4. 核心功能点

### 4.1 沉浸式店铺头部（ShopHeader）

- 全屏宽度 Banner（高度 200px，`gp-shop-hero` 类）
- 背景层（按优先级）：
  1. `banner_url` 配置时：渲染 `<img>`，加载失败时隐藏 img 自动回落到主题色渐变
  2. 无 `banner_url`：`gp-shop-hero-fallback` 主题色渐变兜底
- 暗化遮罩层（`gp-shop-hero-shade`）确保文字可读
- 内容叠加层（`gp-shop-hero-body`）：
  - 顶部徽章组：游戏类型（紫色 `gp-badge-violet` + Gamepad2 图标） + 实例状态（在线/离线圆点 + 文案）
  - 主标题：实例名（`server.name`）或兜底"店铺首页"
  - 描述文案：`shop_description`（保留换行 `white-space: pre-wrap`，带文字阴影）
- 外链支持：配置 `banner_link` 时整个 Banner 包裹 `<a target="_blank" rel="noopener noreferrer">`，可点击跳转新窗口
- Loading 态：`gp-skeleton` 占位（高度 200px）
- Error 提示：Banner 下方琥珀色小字"店铺配置加载失败: {error}"

### 4.2 游戏账号绑定卡（AccountBindingCard）

- 位置：Banner 下方，左侧 3px 主题色边框（`--shop-theme-color`）
- 标题：Gamepad2 图标 + "游戏账号绑定" + 游戏类型徽章（如 Minecraft / Terraria 等）
- 三态分支：
  - **未绑定**（`UnboundForm`）：输入"游戏内玩家名" + "绑定账号"按钮（主题色 CTA）
  - **待验证**（`PendingBinding`）：展示验证步骤说明 + 验证码输入框 + "确认验证"/"取消绑定"按钮
  - **已验证**（`VerifiedBinding`）：绿色"已绑定"徽章 + 玩家名 + 绑定日期 + "解绑"按钮
  - **已拒绝**（`verify_status === 'revoked'`）：提示"绑定已被拒绝，可重新绑定" + 重新绑定表单
- 错误处理：403 显示"您无权访问该实例"，其他错误显示原始 message
- 数据流：`api.getServer(serverId)` 取 `game_type` + `api.listPlayerBindings()` 按 `scope_ref === game_type` 过滤最新绑定

### 4.3 商品列表（ShopItemList）

- 卡片容器（`gp-card`）+ 主题色 CTA
- 顶部信息条：
  - 左侧：ShoppingBag 图标 + "商品列表"
  - 右侧：商品计数 `{filtered}/{total} 件商品`
- 发放模式切换区（v4.15.5 修正）：
  - **取件码**（`claim_code`，默认）：无需绑定角色，生成取件码可在游戏内领取或转赠
  - **直接发放**（`direct`）：必须 verified 绑定，`player_name` 锁定为已绑定角色名，不可手动输入
  - 未绑定时点击"直接发放"会 toast 提示"请先绑定游戏角色才能使用「直接发放」"
  - 未绑定时 `deliveryMode` 强制回落到 `claim_code`（useEffect 监听 `isBound`）
- 商品筛选：
  - 搜索框（左侧 Search 图标，按 `item_name` 模糊匹配，大小写不敏感）
  - 品质 tabs：全部/普通/精良/稀有/史诗/传说（`gp-tabs` + `gp-tab-active`）
- 商品卡片（`ShopItemCard`，`gp-item-card` 品质发光描边）：
  - 顶部：商品名 + 品质徽章（颜色按品质映射：普通灰/精良绿/稀有蓝/史诗深蓝/传说橙）
  - 中部：VIP 限制徽章（`VIP N+`）+ 限购徽章（`限购 N/日`）
  - 底部：价格（主题色大字 + "点券"单位）+ 购买按钮
  - 购买流程：点击购买 → 展开数量输入（1-99）+ "确认" + "✕" 取消
  - 取件码结果：购买成功后展示虚线边框区域，含取件码（可全选复制）+ "进入游戏后输入此码领取物品，也可分享给好友"
- 商品排序：按品质降序（传说→普通）+ 价格升序
- Loading 态：6 个 `gp-skeleton` 网格占位（高度 128px）
- Error 态：玫瑰色错误文案 + "重试"按钮
- 空态：ShoppingBag 大图标 + "店铺暂无商品" / "没有匹配的商品"

### 4.4 主题色系统

- 默认主题色：`#0A84FF`（Apple 蓝，[ServerDetailGuild.tsx#L28](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L28)）
- 自定义主题色：`shopConfig.shop_theme_color`
- 注入方式：通过 CSS 变量 `--shop-theme-color` 注入到页面根容器，子组件（`AccountBindingCard` / `ShopItemList`）通过 `var(--shop-theme-color, var(--gp-violet))` 引用

### 4.5 实例状态映射

| 后端 status | UI 文案 |
|------|------|
| `running` | 在线（绿圆点） |
| `stopped` | 离线（灰圆点） |
| `starting` | 启动中 |
| `stopping` | 停止中 |
| `error` | 异常 |

## 5. 交互流程

### A. 页面初始化

1. 进入 `/guild/servers/:id`
2. `useParams<{ id: string }>()` 取实例 ID
3. `useEffect` 触发并行拉取：
   - `api.getInstanceShopConfig(id)` → 店铺外观配置（catch 处理 403 与其他错误）
   - `api.getServer(id)` → 实例摘要（catch 静默返回 null）
4. `Promise.all` 完成后：
   - `configRes` 非空 → `setShopConfig(configRes.config)`
   - `serverRes` 非空 → `setServer(serverRes.server)`
5. `setConfigLoading(false)`
6. 403 时 `setConfigError('您无权访问该实例')`，页面渲染友好提示，不渲染功能卡片
7. 取消令牌：`cancelled` flag 防止卸载后 setState（[ServerDetailGuild.tsx#L53](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L53)）

### B. 账号绑定流程

1. `AccountBindingCard` 挂载时并行拉取 `getServer(serverId)` + `listPlayerBindings()`
2. 按 `scope_ref === game_type` 过滤绑定，取 `updated_at` 最新的一条
3. 未绑定 → 输入玩家名 → 点击"绑定账号" → `createPlayerBinding({ game_player_name, game_type })` → 重新加载
4. 进入待验证状态 → 在游戏内执行验证命令 → 输入验证码 → `verifyPlayerBinding(bindingId, { verify_code })` → 重新加载
5. 验证通过 → `verify_status === 'verified'` → 可在商品列表切换"直接发放"模式
6. 解绑：点击"解绑" → `window.confirm` 二次确认 → `deletePlayerBinding(bindingId)` → 重新加载

### C. 商品购买流程

1. 默认发放模式为 `claim_code`（取件码）
2. 用户可切换到 `direct`（直接发放），未绑定时被拦截
3. 点击商品"购买取件码" / "直接购买" → 展开数量输入
4. 调整数量（1-99） → 点击"确认"
5. `createShopOrder(serverId, { items, delivery_mode, player_name? })`：
   - `delivery_mode === 'direct'` 时 `player_name` 锁定为 `currentBinding.player_name`
   - `delivery_mode === 'claim_code'` 时不传 `player_name`
6. 成功：
   - `claim_code` 模式：展示取件码区域 + toast"取件码：xxx"
   - `direct` 模式：toast"购买成功！xxx ×N 已发放到 {player_name}"
7. 失败：toast.error + 卡片内错误文案

### D. 403 权限错误处理

1. `getInstanceShopConfig` 返回 403 `PANEL_FORBIDDEN`
2. `setConfigError('您无权访问该实例')`
3. `isForbidden = configError === '您无权访问该实例'`
4. 渲染 Gamepad2 大图标 + "您无权访问该实例"文案
5. 不渲染 `AccountBindingCard` 与 `ShopItemList`（`isForbidden && !configLoading` 短路）

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/store/servers/:id/shop-config` | GET | JWT + `requireInstanceAccess` | 店铺外观配置（banner_url/banner_link/shop_theme_color/shop_description） | 401/403 `PANEL_FORBIDDEN`/500 |
| `/api/servers/:id` | GET | JWT | 实例详情（server.name/status/game_type） | 401/403/404/500 |
| `/api/player-bindings` | GET | JWT | 当前用户的绑定列表（前端按 game_type 匹配） | 401/500 |
| `/api/player-bindings` | POST | JWT | 创建绑定（`game_player_name`、`game_type`） | 401/400/409 |
| `/api/player-bindings/:bindingId/verify` | POST | JWT | 验证码确认（`verify_code`） | 401/400/404 |
| `/api/player-bindings/:bindingId` | DELETE | JWT | 取消/解绑 | 401/404 |
| `/api/servers/:id/shop-items` | GET | JWT + `requireInstanceAccess` | 商品列表 | 401/403/500 |
| `/api/servers/:id/shop-orders` | POST | JWT + `requireInstanceAccess` | 下单购买（`items`/`delivery_mode`/`player_name?`） | 401/403/400/402/409 |

### 接口实现定位

- `api.getInstanceShopConfig(serverId)` → [client.ts#L2241-L2245](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2241-L2245)
- `api.getServer(id)` → [client.ts#L635-L637](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L635-L637)
- `api.listPlayerBindings()` → [client.ts#L934-L936](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L936)
- `api.createPlayerBinding(req)` → [client.ts#L937-L942](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L937-L942)
- `api.verifyPlayerBinding(id, req)` → [client.ts#L943-L948](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L943-L948)
- `api.deletePlayerBinding(id)` → [client.ts#L955-L959](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L955-L959)
- `api.listShopItems(serverId)` → [client.ts#L765-L767](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L765-L767)
- `api.createShopOrder(serverId, req)` → [client.ts#L780-L785](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L780-L785)

### 数据契约（关键字段）

- `InstanceShopConfig`：`banner_url?` / `banner_link?` / `shop_theme_color?` / `shop_description?`
- `ServerSummary`：`id` / `name` / `game_type` / `status`
- `Binding`：`id` / `player_name` / `scope_ref`（= game_type）/ `verify_status`（`pending`/`verified`/`revoked`）/ `verified_at?`
- `ShopItemSummary`：`id` / `item_name` / `quality`（`normal`/`uncommon`/`rare`/`epic`/`legendary`）/ `price` / `vip_level_required` / `daily_limit?` / `enabled`
- `CreateShopOrderResponse`：`order.claim_code?`（取件码模式下返回）

## 7. 状态管理与副作用

### 页面级（ServerDetailGuild）

- `shopConfig: InstanceShopConfig | null` — 店铺外观配置
- `server: ServerSummary | null` — 实例摘要（用于 Banner 叠加）
- `currentBinding: Binding | null` — 当前游戏类型绑定（由 `AccountBindingCard` 上抛）
- `configLoading: boolean` — 配置加载中
- `configError: string | null` — 配置错误信息（含 403 标识）
- 副作用：`useEffect([api, id])` 挂载时并行拉取，`cancelled` flag 防止卸载后 setState
- 主题色注入：`themeColor = shopConfig?.shop_theme_color || DEFAULT_THEME_COLOR`，通过 CSS 变量 `--shop-theme-color` 注入根容器

### AccountBindingCard

- `gameType` / `binding` / `loading` / `error`
- `updateBinding(newBinding)` — 同步本地 state + 上抛 `onBindingChange`
- 副作用：`useEffect(loadData, [loadData])` 挂载时并行拉取 `getServer` + `listPlayerBindings`

### ShopItemList

- `items` / `loading` / `error` / `search` / `qualityFilter` / `deliveryMode` / `toast`
- `isBound = currentBinding?.verify_status === 'verified'` — 派生状态
- 副作用：
  - `useEffect([isBound, deliveryMode])` — 未绑定时强制 `deliveryMode` 回落到 `claim_code`
  - `useEffect(loadItems, [loadItems])` — 挂载时拉取商品列表
- `filteredItems` memo：品质过滤 + 搜索过滤 + 品质降序+价格升序排序
- 子组件 `ShopItemCard` 内部 state：`purchasing` / `count` / `showCount` / `err` / `claimCode`

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 | `ProtectedRoute` 重定向 `/login` | 携带 `state.from` |
| 实例无访问权（403） | 仅显示"您无权访问该实例"+ Gamepad2 图标，隐藏所有功能卡片 | v4.15.3 策略，避免"能看见但点不了" |
| `getInstanceShopConfig` 非 403 错误 | Banner 下方琥珀色小字"店铺配置加载失败: {error}" | 仍尝试渲染子组件（用默认主题色） |
| `getServer` 失败 | 静默降级为 null，Banner 标题兜底"店铺首页"，不显示状态徽章 | 不阻塞店铺配置渲染 |
| Banner 图片加载失败 | `onError` 隐藏 img，自动回落到主题色渐变 | [ServerDetailGuild.tsx#L167-L170](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L167-L170) |
| 未绑定时切换"直接发放" | toast.error"请先绑定游戏角色才能使用「直接发放」" + `deliveryMode` 强制回落 `claim_code` | |
| 未绑定时点击"直接购买" | 按钮文案变为"需绑定" + disabled + 点击提示"请先绑定游戏角色" | |
| 商品列表加载失败 | 玫瑰色错误文案 + "重试"按钮 | 调用 `loadItems()` 重新拉取 |
| 商品列表为空 | "店铺暂无商品"空态 | 区分"无商品"与"无匹配结果" |
| 下单失败 | toast.error + 卡片内错误文案 | 错误信息来自 `PanelApiError.message` |
| 组件卸载后 setState | `cancelled` flag 拦截 | 防止 React 警告 |
| `player_name` 为空时直接发放 | `handlePurchase` 内 `directDisabled` 校验拦截 | 防御性编程 |

## 9. 体验与一致性检查

- `[UX]` 设计语言：消费 `gp-*` 类（guild-portal.css），文件头注释自称"沉浸式 Banner + 主题色融合霓虹体系"——与项目规则 `1.md`"看齐苹果的清新设计语言"存在表述冲突（同 guild-servers.md RISK），需核实 `gp-shop-hero` 等类的实际视觉
- `[UX]` 移动端适配：
  - ShopItemList 用 `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` 自适应列数，符合移动端电商网格习惯
  - 卡片间距 `gap: 12px`，padding 适中
  - toast 位置 `bottom: 90px` 避开底部 5 tab 导航（`guild-bottom-nav`）
  - 取件码区域 `userSelect: 'all'` 便于长按复制
- `[UX]` 一致性：
  - 主题色 CSS 变量贯穿 Banner / 绑定卡 / 商品 CTA，保证店铺品牌统一
  - 默认主题色 `#0A84FF`（Apple 蓝）符合项目"苹果清新风"规范
  - 403 采用"完全隐藏功能卡片"策略，符合 C 端电商"不暴露不能用的功能"原则
  - `useDocumentTitle` 未在本页调用（依赖 Layout 面包屑"服务器详情"作为标题）——见 TODO
  - `window.confirm` 用于解绑二次确认（[AccountBindingCard.tsx#L345](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/AccountBindingCard.tsx#L345)），与 v4.26.0 B4 改造（统一 `useConfirm`）规范不一致——见 RISK
- `[UX]` 玩家视角保证：
  - v4.15.2 移除 `ServerDetail` 组件嵌入，无 RCON 控制台/日志文件/命令帮助 tab
  - 文件头注释明确"屏蔽所有运维信息"
  - 与 `/admin/servers/:id`（运维视图）、`/store/servers/:id`（服主视图）三视图分离

## 10. 关键实现定位（代码引用）

- 路由注册（/guild 子路由 servers/:id）：[App.tsx#L451-L456](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L456)
- 角色重定向（/instances/:id → /guild/servers/:id）：[App.tsx#L264-L278](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L264-L278)
- 旧路径兼容（/instances/:id/shop → /guild/servers/:id）：[App.tsx#L201-L204](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L201-L204)
- 页面组件：[ServerDetailGuild.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx)
- 布局承载：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx)
- 路由守卫 ProtectedRoute：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)
- 主组件 + 403 处理：[ServerDetailGuild.tsx#L38-L138](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L38-L138)
- ShopHeader 子组件：[ServerDetailGuild.tsx#L141-L223](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L141-L223)
- AccountBindingCard 子组件：[AccountBindingCard.tsx#L48-L153](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/AccountBindingCard.tsx#L48-L153)
- ShopItemList 子组件：[ShopItemList.tsx#L56-L304](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L56-L304)
- ShopItemCard 子组件：[ShopItemList.tsx#L321-L517](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L321-L517)
- API client（店铺配置）：[client.ts#L2241-L2245](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L2241-L2245)
- API client（实例详情）：[client.ts#L635-L637](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L635-L637)
- API client（玩家绑定）：[client.ts#L934-L959](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L934-L959)
- API client（商品与订单）：[client.ts#L765-L785](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L765-L785)
- useAuth hook：[auth.tsx#L230-L236](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L230-L236)
- PanelApiError（错误码识别）：[client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts)

## 11. 待办与风险

- `[RISK]` **与 [guild-server-shop.md](./guild-server-shop.md) 文档重复**：同一页面 `/guild/servers/:id` 存在两篇梳理文档（早期版本 + 本次 11 字段重写版本），建议主线程决定保留策略：合并为单一文档，或废弃早期版本。两篇内容互补但引用行号需同步对齐
- `[RISK]` **设计语言表述冲突**：[ServerDetailGuild.tsx#L9-L10](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx#L9-L10) 文件头注释自称"主题色融合霓虹体系"，与项目规则 `1.md`"看齐苹果的清新设计语言，严禁杀马特电竞风"存在表述冲突；默认主题色 `#0A84FF`（Apple 蓝）符合规范，但需核实服主自定义 `shop_theme_color` 是否会被滥用为深色霓虹风
- `[RISK]` **`AccountBindingCard` 解绑使用 `window.confirm` 而非 `useConfirm`**：[AccountBindingCard.tsx#L345](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/AccountBindingCard.tsx#L345) 与 v4.26.0 B4 改造规范不一致（其他页面已统一为 `useConfirm` + `ConfirmDialog`，移动端改为底部 Sheet）；移动端原生 confirm 体验差
- `[RISK]` **`player_name` 锁定逻辑依赖前端 `boundPlayerName!` 非空断言**：[ShopItemList.tsx#L354](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L354) 使用 `body.player_name = boundPlayerName!`，若 `currentBinding.player_name` 为空字符串但 `verify_status === 'verified'`（理论上不应发生），会下发空 player_name 导致后端异常；建议加 `if (!boundPlayerName) return` 防御
- `[RISK]` **`getServer` 失败时静默降级，但 Banner 仍尝试渲染**：`server` 为 null 时 Banner 标题兜底"店铺首页"，不显示状态徽章——但 `getInstanceShopConfig` 仍可能成功，导致"店铺可访问但实例已停服"的混乱展示；建议核实后端在实例停服时是否应阻止 shop-config 返回
- `[RISK]` **`createShopOrder` 402（余额不足）错误码未在本页核实**：表格中列出 402 但未在代码中看到专门处理；若后端返回 402，前端会走通用 `PanelApiError.message` 路径，可能展示不友好的错误文案
- `[RISK]` **`ShopItemList` toast 用 `setTimeout` 4 秒后清除**：[ShopItemList.tsx#L76-L77](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L76-L77) 若组件卸载后 setTimeout 仍触发，会调用已卸载组件的 setState（React 警告）；建议加 cleanup
- `[TODO]` 补充浏览器核对：本文档基于代码阅读产出，未实际访问 `https://gsp.ecsrz.com:3001/guild/servers/:id` 验证 UI 行为（Banner 渲染、绑定流程、购买流程、403 提示）
- `[TODO]` 本页未调用 `useDocumentTitle`，依赖 Layout 面包屑"服务器详情"作为浏览器标签标题；建议补充 `useDocumentTitle(server?.name ?? '店铺详情')` 与其他 guild 页面对齐
- `[TODO]` 补充"购买后结果呈现"路径梳理：取件码展示位置与"我的订单"(`/guild/orders`) 的联动关系
- `[TODO]` 补充"绑定验证命令"在不同游戏（pack）下的差异：当前 `PendingBinding` 仅提示"在游戏内聊天框输入验证命令（含验证码）"，未给出具体命令格式
- `[TODO]` 核实 `daily_limit` 字段为 null 时的展示（[ShopItemList.tsx#L404](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/components/ShopItemList.tsx#L404) 仅 `!== null` 时显示徽章，null 表示无限购还是不限购需确认）
- `[TODO]` 核实 `InstanceShopConfig.banner_link` 是否做 SSRF / 钓鱼 URL 校验（前端直接 `<a href={bannerLink} target="_blank">`，若服主配置 javascript: URL 会有 XSS 风险）
