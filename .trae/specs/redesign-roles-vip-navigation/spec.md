# 角色层级/VIP-实例绑定/左侧导航重构 Spec

## Why

当前页面逻辑与架构目标不符：
1. `Layout.tsx` 仍是顶部导航栏+管理下拉，未实现左侧边栏（`restore-vip-shop` spec 声称完成但实际代码未落地）
2. 角色为 4 级（system_admin/admin/operator/viewer），与目标 3 级（服务器管理员/实例管理员/用户）不匹配
3. `users.vip_level` 是全局 VIP，不与实例绑定 —— 用户期望「绑定实例 → 自动获得该实例的 VIP1 → 解锁该实例商城」
4. 导航散乱：管理页扁平在 `/admin/*`，实例作用域页散落在 `/servers/:serverId/*`，VIP 与商城分属不同入口
5. 缺少底座 vs 实例的边界定义、实例创建流程、底座/游戏更新机制的明确文档

本 spec 重构角色体系、VIP 绑定模型、左侧导航，并明确底座/实例边界与更新流程，使整体逻辑自洽。

## What Changes

### 角色体系重构（**BREAKING**）
- **替换 4 级角色为 3 级**：`server_admin`（管底座+全部实例+Pack）/ `instance_admin`（管自有实例）/ `user`（消费+个人设置）
- 迁移映射：`system_admin→server_admin`、`admin→instance_admin`、`operator→user`、`viewer→user`
- `core/auth/roles.ts` 重写为 3 级；`permissions.ts` 权限矩阵按新角色重排
- 前端 `Layout.tsx` 按 `server_admin` 控制系统管理组可见性

### VIP-实例绑定模型（**BREAKING**）
- **新增表 `user_instance_bindings`**：`(user_id, server_id, vip_level DEFAULT 1, bound_at, status)`
  - `status` 枚举：`active` / `unbound`
  - UNIQUE(`user_id`, `server_id`) 防重复绑定
- **VIP 改为按实例作用域**：用户在某实例的 VIP 等级由 `user_instance_bindings.vip_level` 决定，不再读 `users.vip_level`
- **自动赋予 VIP1**：`user` 在个人设置绑定某实例后，自动写入 `vip_level=1` 的绑定记录
- **解绑**：设 `status=unbound`，立即失去该实例的 VIP 与商城入口
- `instance_admin` 对自有实例默认 VIP5（在 `servers.owner_user_id` 关系上判定，无需绑定记录）
- `vip_permissions` 表保持全局定义（0-5 级权限模板），但查询 VIP 时按实例的 `vip_level` 比对
- **迁移脚本前置**：现有 `users.vip_level>0` 的用户，迁移时为其 `owner_user_id` 对应的每个实例创建 `vip_level=原值` 的绑定记录；无自有实例的用户创建到 `default` 实例

### 左侧导航重构（实例中心化）
- `Layout.tsx` 重写为左侧可折叠边栏（替换顶部 navbar+下拉菜单）
- 分组结构：
  ```
  ├─ 控制台 (/)                        ← 全部实例总览卡片
  ├─ 实例 (/instances)                 ← 实例列表+创建
  │   └─ /instances/:id/*              ← 详情子页（概览/配置/存档/Mod/玩家/名单/监控/日志/备份/商城管理）
  ├─ 商城 VIP (/shop)                  ← 跨实例：我的订单+我的VIP+CDK兑换+投票
  ├─ 个人设置 (/profile)               ← 绑定/解绑实例
  └─ 系统管理 (/admin/*)              ← 仅 server_admin 可见
      ├─ 用户管理 (/admin/users)
      ├─ 底座配置 (/admin/system-config)
      ├─ Pack 管理 (/admin/packs)       ← 查看已加载 Pack + 重载
      ├─ 审计日志 (/admin/audit-logs)
      └─ Webhooks (/admin/webhooks)
  ```
- **移出侧边栏的项**（变为实例详情子页，已由 v2.0.0 spec 完成）：玩家/名单/监控/配置/存档/Mod/日志/备份/商城管理
- **VIP 权限配置**移入实例详情子页（`/instances/:id/vip-admin`），按实例配置
- 旧路由 `/admin/vip-permissions`、`/admin/shop-items` 等重定向到实例作用域

### 底座 vs 实例边界定义（文档化）
| 维度 | 底座（server_admin） | 实例（instance_admin/user） |
|------|---------------------|---------------------------|
| 用户 | users 表、角色分配 | user_instance_bindings |
| Pack | packs 表、Pack 加载/重载 | 引用 pack_id |
| 节点 | nodes 表 | — |
| 系统配置 | system_config 表 | — |
| 审计 | audit_logs 表 | — |
| Webhooks | webhooks 表（全局） | — |
| 商城 | — | shop_items/shop_orders（server_id 作用域） |
| VIP | vip_permissions 模板 | user_instance_bindings（按实例） |
| 玩家/名单/存档/Mod/备份/监控/聊天/投票/CDK/定时消息 | — | 全部按 server_id 作用域 |

### 实例创建流程（文档化）
1. `server_admin` 或 `instance_admin` 进入 `/instances/new`
2. 选择已加载的 Pack（来自 `packs` 表）
3. 填写：实例名、节点（来自 `nodes` 表）、端口、RCON 端口/密码
4. 创建 `servers` 记录，`owner_user_id` = 当前用户
5. 进入详情页 → 启动

### 更新流程（文档化）
- **底座更新**：停止 Panel+Daemon → `git pull` → `npm install`（3 个目录）→ `npx knex migrate:latest` → `npm run build` → 启动
- **游戏（Pack）更新**：在 `packs/` 下新增/替换 Pack YAML → 调用 `POST /api/packs/reload`（server_admin）或重启 Panel → 新实例可选用新 Pack

## Impact

- **Affected specs**:
  - `restore-vip-shop-and-redesign-sidebar`（侧边栏部分实际未落地，本 spec 接管并重做）
  - `v2.0.0-instance-centric-spec`（实例作用域已落地，本 spec 在其上增加绑定层）
  - `build-factorio-server-manager`（角色枚举变更影响）
- **Affected code**:
  - [panel/backend/src/core/auth/roles.ts](file:///d:/代码/gameserver-panel/panel/backend/src/core/auth/roles.ts) — 重写 3 级角色
  - [panel/backend/src/core/auth/permissions.ts](file:///d:/代码/gameserver-panel/panel/backend/src/core/auth/permissions.ts) — 权限矩阵重排
  - [panel/backend/src/middleware/auth.ts](file:///d:/代码/gameserver-panel/panel/backend/src/middleware/auth.ts) — requireRole 适配
  - [panel/backend/src/db/migrations/](file:///d:/代码/gameserver-panel/panel/backend/src/db/migrations/) — 新增角色迁移+绑定表迁移
  - [panel/backend/src/services/userService.ts](file:///d:/代码/gameserver-panel/panel/backend/src/services/userService.ts) — 角色枚举适配
  - [panel/backend/src/services/vipService.ts](file:///d:/代码/gameserver-panel/panel/backend/src/services/vipService.ts) — VIP 按实例查询
  - [panel/backend/src/services/shopService.ts](file:///d:/代码/gameserver-panel/panel/backend/src/services/shopService.ts) — 商城入口校验绑定+VIP
  - [panel/backend/src/routes/](file:///d:/代码/gameserver-panel/panel/backend/src/api/routes/) — 新增 bindings 路由、调整 packs 路由
  - [panel/frontend/src/components/Layout.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/components/Layout.tsx) — 重写为左侧边栏
  - [panel/frontend/src/App.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/App.tsx) — 路由重构
  - [panel/frontend/src/pages/Profile.tsx](file:///d:/代码/gameserver-panel/panel/frontend/src/pages/Profile.tsx) — 新增/重写：实例绑定管理
  - [panel/frontend/src/api/client.ts](file:///d:/代码/gameserver-panel/panel/frontend/src/api/client.ts) — 新增 bindings API
- **数据库迁移**（前置处理，支持热更新）：
  - 角色枚举值迁移（UPDATE users SET role=...）
  - 新增 `user_instance_bindings` 表
  - 现有 `users.vip_level` 数据迁移到绑定记录

---

## ADDED Requirements

### Requirement: 3 级角色体系
系统 SHALL 采用 3 级角色：`server_admin` / `instance_admin` / `user`，废除 `system_admin/admin/operator/viewer`。

#### Scenario: 角色迁移
- **GIVEN** 现有用户 `role=admin`
- **WHEN** 运行迁移脚本
- **THEN** 该用户 `role` 更新为 `instance_admin`
- **AND** `system_admin→server_admin`、`operator/viewer→user` 同步迁移

#### Scenario: server_admin 权限
- **GIVEN** `role=server_admin` 的用户
- **WHEN** 访问 `/admin/users`
- **THEN** 返回 200
- **AND** 可见「系统管理」导航组

#### Scenario: instance_admin 权限边界
- **GIVEN** `role=instance_admin` 的用户 A，拥有实例 X（`servers.owner_user_id=A`）
- **WHEN** A 访问 `/instances/X/config`
- **THEN** 返回 200
- **WHEN** A 访问 `/instances/Y/config`（Y 不属于 A）
- **THEN** 返回 403

#### Scenario: user 权限边界
- **GIVEN** `role=user` 的用户 B，未绑定任何实例
- **WHEN** B 访问 `/shop`
- **THEN** 商城为空，提示「请先在个人设置绑定实例」

### Requirement: user_instance_bindings 表
系统 SHALL 新增 `user_instance_bindings` 表，记录用户与实例的绑定关系及按实例的 VIP 等级。

#### Scenario: 绑定实例自动赋予 VIP1
- **GIVEN** `role=user` 的用户 B 已认证
- **WHEN** B 在个人设置点击「绑定实例 X」
- **THEN** 创建 `user_instance_bindings` 记录 `(user_id=B, server_id=X, vip_level=1, status=active)`
- **AND** B 立即获得实例 X 的 VIP1 权限
- **AND** B 可访问实例 X 的商城

#### Scenario: 解绑失去权限
- **GIVEN** B 已绑定实例 X
- **WHEN** B 点击「解绑」
- **THEN** 绑定记录 `status=unbound`
- **AND** B 无法再访问实例 X 的商城
- **AND** B 在实例 X 的 VIP 权限立即失效

#### Scenario: 防重复绑定
- **GIVEN** B 已绑定实例 X（status=active）
- **WHEN** B 再次绑定实例 X
- **THEN** 返回 409 Conflict
- **AND** 不创建重复记录

### Requirement: VIP 按实例作用域查询
系统 SHALL 在查询用户 VIP 等级时按实例维度查询 `user_instance_bindings.vip_level`，不再读 `users.vip_level`。

#### Scenario: 商城商品 VIP 校验
- **GIVEN** 商品 `vip_level_required=2`，用户 B 绑定实例 X 的 `vip_level=1`
- **WHEN** B 在实例 X 商城购买该商品
- **THEN** 返回 403「VIP 等级不足」
- **WHEN** instance_admin 将 B 在实例 X 的 `vip_level` 提升为 2
- **AND** B 再次购买
- **THEN** 购买成功

#### Scenario: instance_admin 对自有实例默认 VIP5
- **GIVEN** 用户 A 是实例 X 的 `owner_user_id`，`role=instance_admin`
- **WHEN** 查询 A 在实例 X 的 VIP 等级
- **THEN** 返回 5（无需绑定记录）

### Requirement: 左侧可折叠边栏导航
系统 SHALL 将导航从顶部 navbar+下拉改为左侧可折叠边栏，按实例中心化分组。

#### Scenario: 侧边栏分组
- **GIVEN** 任意已登录用户
- **WHEN** 访问任意页面
- **THEN** 左侧显示分组：控制台 / 实例 / 商城VIP / 个人设置 /（仅 server_admin）系统管理

#### Scenario: 折叠持久化
- **GIVEN** 用户点击折叠按钮
- **WHEN** 刷新页面
- **THEN** 侧边栏保持折叠状态（localStorage）

#### Scenario: 角色控制可见性
- **GIVEN** `role=user` 的用户
- **WHEN** 查看侧边栏
- **THEN** 不显示「系统管理」组
- **WHEN** 直接访问 `/admin/users`
- **THEN** 返回 403

### Requirement: 实例绑定管理页
系统 SHALL 在 `/profile` 提供实例绑定管理界面，`user` 角色可在此绑定/解绑实例。

#### Scenario: 查看可绑定实例
- **GIVEN** `role=user` 的用户 B
- **WHEN** 访问 `/profile`
- **THEN** 显示所有 `status=running` 的实例列表
- **AND** 标注已绑定/未绑定状态

#### Scenario: 绑定后解锁商城
- **GIVEN** B 在 `/profile` 绑定实例 X
- **WHEN** B 访问 `/instances/X/shop`
- **THEN** 商城可用
- **AND** B 的 VIP1 生效

### Requirement: Pack 重载 API
系统 SHALL 提供 `POST /api/packs/reload` 端点（server_admin），用于新增/更新 Pack 后热重载。

#### Scenario: 重载 Pack
- **GIVEN** server_admin 在 `packs/` 下新增了 `factorio-vanilla` Pack
- **WHEN** 调用 `POST /api/packs/reload`
- **THEN** 返回 200 + 加载结果
- **AND** 新 Pack 出现在创建实例的 Pack 选择列表中

## MODIFIED Requirements

### Requirement: 商城入口校验
商城访问 SHALL 校验当前用户是否已绑定该实例（`user_instance_bindings.status=active`）或为该实例的 instance_admin/server_admin，未绑定则禁止访问。

#### Scenario: 未绑定用户访问商城
- **GIVEN** `role=user` 的 B 未绑定实例 X
- **WHEN** B 访问 `/instances/X/shop`
- **THEN** 返回 403「未绑定该实例」
- **AND** 前端提示「请先在个人设置绑定实例」

### Requirement: vip_permissions 查询作用域
`GET /api/instances/:id/vip-admin` SHALL 返回该实例下所有绑定用户的 VIP 等级，供 instance_admin 管理。

#### Scenario: 查看实例 VIP 列表
- **GIVEN** instance_admin A 拥有实例 X
- **WHEN** 访问 `/instances/X/vip-admin`
- **THEN** 返回所有绑定 X 的用户及其 `vip_level`

## REMOVED Requirements

### Requirement: 全局 users.vip_level
**Reason**: VIP 改为按实例作用域，`users.vip_level` 字段语义失效。
**Migration**: 迁移脚本将现有 `users.vip_level>0` 的数据迁移到 `user_instance_bindings`（绑定到其自有实例或 default 实例），迁移完成后 `users.vip_level` 字段保留但不再被业务代码读取（标记为 deprecated，下个大版本删除）。

### Requirement: 顶部 navbar + 管理下拉菜单
**Reason**: 替换为左侧可折叠边栏。
**Migration**: 直接重写 `Layout.tsx`，无数据迁移。
