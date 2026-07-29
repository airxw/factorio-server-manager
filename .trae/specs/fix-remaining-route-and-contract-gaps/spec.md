# 修复剩余路由注册与前后端契约缺口 Spec

## Why
项目经过数据丢失后已完成 VIP/Shop/版本/侧边栏恢复（前一个 spec），但综合审计发现仍有 8 类严重缺口导致大量页面无法正常工作：
- 后端 `bindings`、`users` 路由已实现但未在 `index.ts` 注册 → 所有玩家绑定、用户管理接口返回 404
- `/auth/register`、`/auth/profile`、`/settings/registration`、`/bindings/unbind`、`DELETE /users/:id` 端点缺失 → 注册、个人资料、注册开关、解绑、删除用户功能完全不可用
- `/auth/me` 仅返回 JWT 载荷（`{ id, username, role }`），缺 VIP/绑定/验证字段 → Profile 页面、侧边栏 VIP 显示全部空值
- 绑定接口数据形状与前端契约不一致 → Profile 玩家绑定页永远显示"加载中"
- 商店订单列表不返回 `items` 明细 → Orders/ShopAdmin 列表显示"0 件物品"
- `SyncResult`/`SyncLogEntry` 字段名前后端不匹配 → ShopAdmin 同步面板空白
- ShopAdmin 创建/更新/发放接口响应未做字段转换
- `Register.tsx`、`UserAdmin.tsx` 页面未在路由表与侧边栏注册 → 入口缺失

## What Changes
- **后端路由注册**：在 `backend/src/index.ts` 中 import 并注册 `bindingsRouter`（`/api/bindings`）、`usersRouter`（`/api/users`）
- **后端端点补齐**：
  - `POST /api/auth/register`：公开注册（受注册开关控制）
  - `PUT /api/auth/profile`：当前用户更新 display_name/email
  - `GET /api/settings/registration`、`POST /api/settings/registration`：注册开关读写（admin）
  - `POST /api/bindings/unbind`：当前用户解绑
  - `DELETE /api/users/:id`：管理员删除用户
- **`/auth/me` 返回完整用户数据**：调用 `userService.getUserById` + `vipService.getVipInfo`，返回 `id`、`username`、`role`、`display_name`、`email`、`vip_level`、`vip_expires_at`、`is_vip_expired`、`is_verified`、`factorio_player_name`、`effective_vip_level`
- **`/auth/login` 响应**：登录返回完整用户对象（与 `/auth/me` 一致）
- **`userService.User` 接口扩展**：新增 `vip_level`、`vip_expires_at`、`is_verified`、`factorio_player_name` 字段（数据库已有这些列）
- **`listUsers` 返回 VIP 字段**：管理员列表展示 VIP 等级、绑定状态
- **绑定接口契约统一**：
  - `GET /api/bindings` 返回 `{ is_verified, factorio_player_name, pending_binding: { verify_code, factorio_player_name, created_at } | null }`
  - `POST /api/bindings` 返回 `{ verify_code, expires_at }`（不再返回 binding 全量对象）
- **订单列表附带明细**：`getOrders`/`getAllOrders` 联查 `shop_order_items` 并返回 `items` 数组
- **同步结果字段统一**：
  - `SyncResult` 字段改为 `added`/`updated`/`total`（保留 `success`/`message`/`source`）
  - `SyncLogEntry` 新增 `started_at`/`completed_at`（与 `created_at` 同值以保留向后兼容）
  - 同步日志 `status` 在前端读 `'completed'` 时兼容 `'success'`（前端不再过滤）
- **ShopAdmin 返回值字段转换**：`createShopItem`/`updateShopItem`/`deliverItem`/`listAllShopItems` 在 `client.ts` 应用 `camelToSnake`
- **前端路由与侧边栏补齐**：注册 `/register`、`/user-admin` 路由，在侧边栏"管理后台"组添加"用户管理"入口
- **次要修复**：
  - `Profile.tsx` 移除硬编码"VIP 0 级（永久有效）"，改用真实 VIP 数据
  - `auth.ts` 登录后返回完整 user（与 me 接口一致）

## Impact
- **Affected specs**：
  - `restore-vip-shop-and-redesign-sidebar`（本次修复其遗留的契约缺口）
  - `verify-deploy-and-fix-web-init`（登录响应形状变更）
  - `build-factorio-server-manager`（用户管理路由补齐）
- **Affected code**：
  - 后端：`backend/src/index.ts`、`backend/src/routes/auth.ts`、`backend/src/routes/settings.ts`、`backend/src/routes/bindings.ts`、`backend/src/routes/users.ts`、`backend/src/services/userService.ts`、`backend/src/services/bindingService.ts`、`backend/src/services/shopService.ts`、`backend/src/services/itemSyncService.ts`
  - 前端：`frontend/src/api/client.ts`、`frontend/src/App.tsx`、`frontend/src/pages/Profile.tsx`
- **Breaking changes**：无（前端已按修复后的契约编写，后端调整响应形状使其与前端预期一致）

## ADDED Requirements

### Requirement: 公开注册端点
系统 SHALL 提供 `POST /api/auth/register` 接口，受 `system_config.registration_open` 开关控制（默认关闭）。当关闭时返回 403 `REGISTRATION_DISABLED`。注册成功后返回 `{ token, user }`，user 形状与 `/auth/me` 一致。

#### Scenario: 注册开关关闭
- **WHEN** 管理员未开启注册开关，用户提交注册
- **THEN** 返回 403，错误码 `REGISTRATION_DISABLED`

#### Scenario: 注册成功
- **WHEN** 注册开关开启，用户提交合法用户名（3-50 位字母数字下划线连字符）和密码（≥6 位）
- **THEN** 创建用户（role=viewer，status=active），返回 200 与 JWT token

### Requirement: 注册开关管理
系统 SHALL 提供 `GET /api/settings/registration` 返回当前注册开关布尔值，`POST /api/settings/registration` 由管理员更新开关。开关值持久化到 `system_config` 表 key=`registration_open`。默认值 `false`。

### Requirement: 个人资料更新
系统 SHALL 提供 `PUT /api/auth/profile` 允许当前登录用户更新 `display_name` 和 `email`。

### Requirement: 玩家解绑
系统 SHALL 提供 `POST /api/bindings/unbind` 允许当前用户解除自己的玩家绑定。解绑后同步清除 `users.factorio_player_name`、`is_verified` 字段。

### Requirement: 管理员删除用户
系统 SHALL 提供 `DELETE /api/users/:id` 由管理员删除用户。禁止删除自己。

### Requirement: 完整当前用户信息
系统 SHALL 在 `GET /api/auth/me` 与 `POST /api/auth/login` 响应中返回完整用户信息：`id`、`username`、`role`、`display_name`、`email`、`vip_level`、`vip_expires_at`、`is_vip_expired`、`is_verified`、`factorio_player_name`、`effective_vip_level`。

## MODIFIED Requirements

### Requirement: 玩家绑定接口契约
- `GET /api/bindings` SHALL 返回 `{ is_verified: boolean, factorio_player_name: string | null, pending_binding: { verify_code, factorio_player_name, created_at } | null }`
  - `is_verified`：从 `users.is_verified` 读取
  - `factorio_player_name`：从 `users.factorio_player_name` 读取
  - `pending_binding`：当前用户最新 pending 状态的绑定记录（无则 null）
- `POST /api/bindings` SHALL 接收 `{ factorioPlayerName }`，返回 `{ verify_code, expires_at }`（不返回 binding 全量对象）

### Requirement: 订单列表附带明细
`GET /api/shop/orders` 与 `GET /api/shop-admin/orders` SHALL 在每个订单对象中返回 `items` 数组（含 `id`、`item_name`、`quantity`、`quality`、`created_at`），不再仅返回 `items_count` 计数。

### Requirement: 物品同步结果字段
- `SyncResult` SHALL 包含字段：`success`、`source`、`total`、`added`、`updated`、`message`
- `SyncLogEntry` SHALL 包含字段：`id`、`source`、`status`（`'success'`|`'failed'`）、`items_count`、`error_message`、`started_at`、`completed_at`、`created_at`
  - `started_at` 与 `completed_at` 暂与 `created_at` 同值（现有 schema 单时间戳，向前兼容）

### Requirement: 管理员用户列表显示 VIP 字段
`userService.User` 接口 SHALL 扩展包含 `vip_level`、`vip_expires_at`、`is_verified`、`factorio_player_name` 字段（数据库已有这些列）。`listUsers`/`getUserById` 返回这些字段。

## REMOVED Requirements
（无）
