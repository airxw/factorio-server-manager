# 恢复 VIP/Shop 模块 + 侧边栏重构 + 版本检测 API Spec

## Why
VIP 会员功能模块和商场购物功能模块因后端路由未注册、前端页面未路由、前后端字段命名不一致等原因完全无法使用。同时，当前前端使用顶部横向导航栏，11 个链接在窄屏溢出且无折叠功能，7 个已开发页面（Shop/Orders/VipAdmin 等）无法访问。需要系统性修复 VIP/Shop 模块使其端到端可用，并将导航重构为可折叠左侧边栏，同时新增服务端版本检测 API。

## What Changes

### VIP/Shop 模块恢复
- **注册后端路由**：在 `backend/src/index.ts` 中注册 `vip`、`shop`、`shopAdmin` 三个路由
- **修复字段命名不一致**：在前端 `client.ts` 中添加 `camelToSnake` / `snakeToCamel` 通用转换工具，在 VIP/Shop API 函数中自动转换请求体和响应字段
- **补充后端缺失端点**：VIP 权限 DELETE 端点、Shop daily-usage 端点
- **修复 API 契约不匹配**：`checkoutShop` 发送 `itemId`（数字）而非 `item_name`（字符串）；`updateShopItem` 使用数字 ID 而非字符串名；`ShopItem` 类型添加 `id` 字段
- **注册前端路由**：在 `App.tsx` 中为 Shop、Orders、ShopAdmin、VipAdmin、Profile 页面添加路由

### 侧边栏重构
- **顶部导航栏改为左侧边栏**：将所有功能页面调整至左侧区域
- **可折叠隐藏**：折叠状态下仅显示图标，展开状态下显示完整功能名称；折叠状态持久化到 localStorage
- **添加图标**：安装 `lucide-react` 图标库，为每个导航项添加图标
- **分组导航**：按功能分组（控制台、服务器管理、用户功能、商店、系统管理）

### 版本检测 API
- **后端端点**：`GET /api/version` 返回版本号、发布日期、主要更新内容
- **前端展示**：在侧边栏底部显示当前系统版本信息

## Impact
- Affected specs: `build-factorio-server-manager`、`verify-deploy-and-fix-web-init`
- Affected code:
  - [backend/src/index.ts](file:///home/air/Desktop/factorio/backend/src/index.ts) — 注册 vip/shop/shopAdmin 路由 + version 路由
  - [backend/src/routes/vip.ts](file:///home/air/Desktop/factorio/backend/src/routes/vip.ts) — 添加 DELETE 端点
  - [backend/src/routes/shop.ts](file:///home/air/Desktop/factorio/backend/src/routes/shop.ts) — 添加 daily-usage 端点
  - [backend/src/routes/version.ts](file:///home/air/Desktop/factorio/backend/src/routes/version.ts) — **新增** 版本检测路由
  - [backend/src/services/shopService.ts](file:///home/air/Desktop/factorio/backend/src/services/shopService.ts) — 添加 getDailyUsage 方法
  - [backend/src/services/vipService.ts](file:///home/air/Desktop/factorio/backend/src/services/vipService.ts) — 添加 deleteVipPermissions 方法
  - [frontend/src/api/client.ts](file:///home/air/Desktop/factorio/frontend/src/api/client.ts) — 添加字段转换工具 + 修复 API 函数契约 + 版本 API
  - [frontend/src/App.tsx](file:///home/air/Desktop/factorio/frontend/src/App.tsx) — 侧边栏重构 + 注册新路由
  - [frontend/src/index.css](file:///home/air/Desktop/factorio/frontend/src/index.css) — 侧边栏样式
  - [frontend/package.json](file:///home/air/Desktop/factorio/frontend/package.json) — 添加 lucide-react 依赖

---

## ADDED Requirements

### Requirement: VIP/Shop 后端路由注册
The system SHALL 在后端入口注册 VIP、Shop、ShopAdmin 路由，使 `/api/vip/*`、`/api/shop/*`、`/api/shop-admin/*` 请求可正常到达对应处理器。

#### Scenario: 访问 VIP 权限列表
- **GIVEN** 已认证的管理员用户
- **WHEN** 发送 `GET /api/vip/permissions`
- **THEN** 返回所有 VIP 权限配置列表

#### Scenario: 访问商品列表
- **GIVEN** 已认证用户
- **WHEN** 发送 `GET /api/shop/items`
- **THEN** 返回所有已启用的商品列表

### Requirement: 前后端字段命名自动转换
The system SHALL 在前端 API 客户端层自动转换 camelCase/snake_case 字段命名，使前端页面使用 snake_case 字段而后端服务使用 camelCase 字段时无需手动映射。

#### Scenario: 获取商品列表字段转换
- **GIVEN** 后端返回 `{ id: 1, itemName: "iron", displayName: "铁矿石", vipLevelRequired: 0 }`
- **WHEN** 前端 client 函数处理响应
- **THEN** 前端收到 `{ id: 1, item_name: "iron", display_name: "铁矿石", vip_level_required: 0 }`

#### Scenario: 创建商品请求字段转换
- **GIVEN** 前端发送 `{ item_name: "iron", display_name: "铁矿石" }`
- **WHEN** 前端 client 函数处理请求
- **THEN** 后端收到 `{ itemName: "iron", displayName: "铁矿石" }`

### Requirement: Shop 每日用量查询
The system SHALL 提供 `GET /api/shop/daily-usage` 端点，返回当前用户当日各商品的剩余购买次数。

#### Scenario: 查询每日用量
- **GIVEN** 已认证用户
- **WHEN** 发送 `GET /api/shop/daily-usage`
- **THEN** 返回 `[{ item_name, remaining }]` 列表

### Requirement: VIP 权限删除
The system SHALL 提供 `DELETE /api/vip/permissions/:level` 端点，允许管理员删除指定等级的 VIP 权限配置。

#### Scenario: 删除 VIP 权限
- **GIVEN** 管理员用户
- **WHEN** 发送 `DELETE /api/vip/permissions/3`
- **THEN** 删除 vip_level=3 的权限记录并返回成功

### Requirement: 可折叠左侧边栏导航
The system SHALL 将导航从顶部横向栏改为左侧可折叠边栏，折叠时仅显示图标，展开时显示图标+功能名称。

#### Scenario: 折叠侧边栏
- **GIVEN** 用户已登录，侧边栏处于展开状态
- **WHEN** 用户点击折叠按钮
- **THEN** 侧边栏宽度收窄至仅图标宽度
- **AND** 功能名称文字隐藏
- **AND** 折叠状态保存到 localStorage

#### Scenario: 展开侧边栏
- **GIVEN** 侧边栏处于折叠状态
- **WHEN** 用户点击展开按钮
- **THEN** 侧边栏展开显示完整功能名称
- **AND** 展开状态保存到 localStorage

#### Scenario: 页面刷新后保持折叠状态
- **GIVEN** 用户将侧边栏折叠后刷新页面
- **WHEN** 页面重新加载
- **THEN** 侧边栏保持折叠状态

### Requirement: 服务端版本检测 API
The system SHALL 提供 `GET /api/version` 端点，返回当前系统版本信息。

#### Scenario: 查询版本信息
- **WHEN** 发送 `GET /api/version`
- **THEN** 返回 `{ version: "1.0.0", releaseDate: "2026-06-26", changelog: "..." }`
- **AND** 前端在侧边栏底部显示版本号

## MODIFIED Requirements

### Requirement: Shop 结算流程
前端 `checkoutShop` 函数 SHALL 发送 `itemId`（数字 ID）而非 `item_name`（字符串名），与后端 `POST /api/shop/orders` 期望的请求格式一致。

#### Scenario: 结算购物车
- **GIVEN** 用户购物车中有商品
- **WHEN** 用户点击结算
- **THEN** 前端发送 `{ items: [{ itemId: <数字ID>, quantity: <数量> }] }`
- **AND** 后端创建订单并返回 `{ claim_code, order: { id, status, items } }`（snake_case 转换后）

### Requirement: ShopAdmin 商品更新
前端 `updateShopItem` 函数 SHALL 使用数字 ID 作为 URL 参数，与后端 `PUT /api/shop-admin/items/:id` 期望的参数类型一致。

### Requirement: ShopItem 类型
`ShopItem` 类型 SHALL 包含 `id` 字段（数字类型），用于结算和管理操作。

## REMOVED Requirements
无。
