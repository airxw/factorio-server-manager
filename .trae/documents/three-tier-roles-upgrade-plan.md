# 三级角色视角升级方案

> 依据：[three-tier-roles-analysis.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/documents/three-tier-roles-analysis.md)
> 当前版本：v4.4.0
> 规划版本：v4.5.0 → v4.6.0 → v4.7.0 → v4.8.0
> 范围：覆盖报告中 P0-P3 全部改进项，按版本分批交付

***

## 一、当前项目关键现状

### 1.1 已具备的能力（无需改造）

| 能力                                 | 实现位置                                                                                                        | 说明                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 三级角色定义                             | [roles.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/core/auth/roles.ts)          | server\_admin(3) / instance\_admin(2) / user(1)       |
| 实例 owner 字段                        | instances 表 `owner_user_id`                                                                                 | 实例已有归属字段                                              |
| `requireInstanceAccess` 按 owner 过滤 | [auth.ts L282](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/auth.ts#L282) | instance\_admin 只能访问 owner\_user\_id === 自己userId 的实例 |
| 用户-实例绑定                            | `user_instance_bindings` 表                                                                                  | user 通过绑定访问实例                                         |
| 钱包系统                               | `user_balance` + `transactions` 表                                                                           | 余额 + 流水已存在                                            |
| 商店订单                               | `shop_orders` 表                                                                                             | 订单状态完备                                                |
| CDK 兑换                             | `cdk_code_items` 表                                                                                          | 兑换记录已存在                                               |
| VIP 等级                             | `user_vip_level` 字段                                                                                         | VIP 等级已存储                                             |
| 系统监控                               | v4.4.0 K1/K2                                                                                                | CPU/内存/磁盘实时监控                                         |
| SSL/隧道/API Key                     | v4.4.0 L1/O1/J1                                                                                             | 安全管理已完备                                               |

### 1.2 核心缺口（本方案要解决的）

| 缺口                        | 现状                         | 目标                      |
| ------------------------- | -------------------------- | ----------------------- |
| 实例列表 API 未按 owner 过滤      | instance\_admin 可能看到所有实例列表 | 严格按 owner 过滤            |
| 缺乏多管理员共管机制                | 一个实例只能有一个 owner            | 支持 instance\_admins 关联表 |
| user 缺乏"我的资产"聚合页          | 需逐个实例页面查看                  | 一站式聚合                   |
| instance\_admin 缺乏跨实例运营视图 | 仅单实例详情                     | 跨实例仪表盘                  |
| 无资源配额系统                   | 无限制                        | 按角色/用户分配配额              |
| 无告警主动通知                   | 仅日志+站内信                    | 邮件+Webhook+站内信          |
| 无全平台总览增强                  | Dashboard 仅实例统计            | 多维度总览                   |
| 无按实例范围授权                  | 角色全局                       | user 在不同实例可有不同角色        |
| 无批量操作                     | 仅单实例操作                     | 批量启停/备份/更新              |
| 移动端体验一般                   | 响应式但 Tab 拥挤                | 移动端优化                   |
| 无服务器推荐                    | 无                          | 热门/新开服推荐                |
| 无玩家社交                     | 无                          | 好友+档案                   |

***

## 二、版本规划总览

```
v4.5.0（P0 租户边界 + 用户聚合）— 2026 年核心改造
  ├── A. instance_admin 租户边界（实例列表过滤 + 共管机制）
  ├── B. user "我的资产"聚合页
  └── C. 契约扩展 + 数据库迁移

v4.6.0（P1 运营仪表盘 + 配额 + 告警）
  ├── D. instance_admin 跨实例运营仪表盘
  ├── E. 资源配额系统
  └── F. 告警主动通知（邮件 + Webhook + 站内信）

v4.7.0（P2 总览增强 + 范围授权 + 批量操作）
  ├── G. server_admin 全平台总览仪表盘增强
  ├── H. 按实例范围授权（RBAC1 资源范围）
  └── I. 批量操作（启停/备份/更新）

v4.8.0（P3 移动端 + 推荐 + 社交）
  ├── J. 移动端体验优化
  ├── K. 服务器推荐位
  └── L. 玩家社交（好友 + 档案）
```

***

## 三、v4.5.0 — 租户边界 + 用户聚合（P0）

### A. instance\_admin 租户边界

#### A1 实例列表 API 按 owner 严格过滤

**问题**：当前 `GET /api/servers` 可能返回所有实例给 instance\_admin，虽然单实例访问被 `requireInstanceAccess` 拦截，但列表泄漏。

**改造**：

* 修改 `panel/backend/src/api/routes/servers.ts` 的 `listServers` 端点

* 在查询逻辑中增加角色判断：

  * `server_admin` → 返回所有实例

  * `instance_admin` → `WHERE owner_user_id = req.user.userId`

  * `user` → 返回其有 active 绑定的实例列表（JOIN `user_instance_bindings`）

* 响应中保留 `owner_username` 字段（已有），便于前端展示归属

**验证点**：

* instance\_admin 调用 `GET /api/servers` 只返回自己的实例

* user 调用只返回绑定实例

* server\_admin 返回全部

#### A2 instance\_admins 共管关联表

**问题**：当前一个实例只能有一个 owner（`owner_user_id`），无法支持"多个 instance\_admin 共同管理一个实例"的场景。

**改造**：

* 新建 migration `panel/backend/src/db/migrations/20260722000001_create_instance_admins.ts`

* 表结构 `instance_admins`：

  ```sql
  CREATE TABLE instance_admins (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    assigned_by TEXT NOT NULL,        -- 分配者 user_id
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(instance_id, user_id),
    FOREIGN KEY (instance_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_instance_admins_instance ON instance_admins(instance_id);
  CREATE INDEX idx_instance_admins_user ON instance_admins(user_id);
  ```

* 新建 `panel/backend/src/services/instanceAdminService.ts`：

  * `assignAdmin(instanceId, userId, assignedBy)` — 分配管理员

  * `removeAdmin(instanceId, userId)` — 移除管理员

  * `listAdmins(instanceId)` — 列出实例的所有管理员

  * `listInstancesByAdmin(userId)` — 列出用户管理的所有实例（owner + admin 关联）

* 修改 `requireInstanceAccess` 中间件：

  * instance\_admin 通过条件：`owner_user_id === userId` **OR** `instance_admins` 表存在记录

* 修改 `requireInstanceAdmin` 中间件：

  * instance\_admin 通过条件：同上

* 新建 API 端点 `panel/backend/src/api/routes/instanceAdmins.ts`：

  * `GET /api/servers/:serverId/admins` — 列出实例管理员（server\_admin / owner）

  * `POST /api/servers/:serverId/admins` — 分配管理员（server\_admin / owner）

  * `DELETE /api/servers/:serverId/admins/:userId` — 移除管理员（server\_admin / owner）

#### A3 实例列表查询服务层改造

* 修改 `panel/backend/src/services/serverService.ts`（或等效文件）：

  * 新增 `listServersForInstanceAdmin(userId)` — 查询 `owner_user_id = userId OR id IN (SELECT instance_id FROM instance_admins WHERE user_id = userId)`

  * 新增 `listServersForUser(userId)` — JOIN `user_instance_bindings` 查绑定实例

  * `listServers` 根据调用者角色路由到不同查询

#### A4 前端实例列表页改造

* 修改 `panel/frontend/src/pages/Servers.tsx`：

  * instance\_admin 视图：显示"我的实例"标题 + 实例卡片（含 owner 标识）

  * user 视图：显示"我绑定的实例"标题 + 实例卡片

  * server\_admin 视图：保持"所有实例" + 增加"按 owner 筛选"下拉框

* 修改 `panel/frontend/src/pages/Dashboard.tsx`：

  * 统计卡片按角色差异化展示

  * instance\_admin 显示"我管辖的实例"统计

  * user 显示"我绑定的实例"统计

#### A5 实例详情页管理员管理 Tab

* 新建 `panel/frontend/src/pages/instance-detail/Admins.tsx`：

  * 仅 instance\_admin+ 可见

  * 列表展示当前实例的所有管理员

  * owner / server\_admin 可分配/移除管理员

  * 分配时支持用户名搜索

### B. user "我的资产"聚合页

#### B1 后端聚合 API

* 新建 `panel/backend/src/api/routes/me.ts`：

  * `GET /api/me/assets` — 聚合返回用户的全部资产信息

    * 响应结构：

      ```typescript
      interface MyAssetsResponse {
        user: UserInfo;
        wallet: { balance: number; last_daily_claim: string | null };
        vip: { level: number; exp: number; privileges: PrivilegeSummary[] };
        instances: { id: string; name: string; status: InstanceState; online_players: number }[];
        recent_orders: ShopOrderSummary[];      // 最近 10 笔订单
        recent_cdk_redeems: CdkRedeemSummary[]; // 最近 10 笔兑换
        claimable_gifts: GiftSummary[];         // 可领取的礼包
        votable_instances: { instance_id: string; voted_today: boolean }[];
        unread_notifications: number;
      }
      ```

  * `GET /api/me/orders?page=1&size=20` — 分页查询所有实例的订单

  * `GET /api/me/cdk-redeems?page=1&size=20` — 分页查询所有 CDK 兑换记录

  * `GET /api/me/consumption-summary` — 消费汇总（按实例分组、按月分组）

  * `GET /api/me/vip-privileges` — VIP 等级对应的特权详情列表

#### B2 前端聚合页

* 新建 `panel/frontend/src/pages/MyAssets.tsx`（路由 `/me`）：

  * **我的服务器卡片**：绑定的实例列表 + 状态 + 在线人数 + 一键进入

  * **我的 VIP 卡片**：等级徽章 + 经验进度条 + 到期时间 + 特权列表（可展开）

  * **我的钱包卡片**：余额（大字号）+ 每日领取按钮 + 最近 5 笔消费

  * **我的订单卡片**：最近 5 笔订单 + "查看全部"链接

  * **我的 CDK 卡片**：最近 5 笔兑换 + "兑换 CDK"入口

  * **我的礼包卡片**：可领取的礼包列表 + 一键领取

  * **今日投票卡片**：可投票的实例列表 + 投票按钮

* 修改 `panel/frontend/src/components/Layout.tsx`：

  * 主导航增加"我的资产"入口（所有用户可见，放在"控制台"之后）

* 修改 `panel/frontend/src/App.tsx`：

  * 新增路由 `/me` → `MyAssets`

#### B3 个人中心整合

* 修改 `panel/frontend/src/pages/Profile.tsx`：

  * 顶部增加"我的资产"快捷入口卡片

  * 保持账号设置 / 改密 / 邮箱验证 / 玩家验证等功能

### C. 契约扩展 + 数据库迁移

#### C1 数据契约

* 修改 `public/schema/panel-api-types.ts`：

  * 新增 `MyAssetsResponse` / `ShopOrderSummary` / `CdkRedeemSummary` / `GiftSummary` / `PrivilegeSummary` 类型

  * 新增 `InstanceAdmin` 类型（id / instance\_id / user\_id / username / assigned\_by / assigned\_at）

  * 新增错误码：`INSTANCE_ADMIN_ALREADY_EXISTS` / `INSTANCE_ADMIN_NOT_FOUND` / `INSTANCE_ADMIN_ASSIGNMENT_FAILED`

#### C2 接口契约

* 修改 `public/interface_stub/daemon-client.d.ts`：无变更

* 新建 `public/interface_stub/panel-rest.d.ts`（若不存在）或扩展已有：

  * 新增 `/api/me/*` 端点签名

  * 新增 `/api/servers/:serverId/admins` 端点签名

#### C3 数据库迁移

* 新建 `20260722000001_create_instance_admins.ts`（见 A2）

* 迁移前置处理：建表前检查 `if (!hasTable('instance_admins'))`，避免重复建表

* 不涉及现有表字段变更，零破坏性

***

## 四、v4.6.0 — 运营仪表盘 + 配额 + 告警（P1）

### D. instance\_admin 跨实例运营仪表盘

#### D1 后端统计 API

* 新建 `panel/backend/src/api/routes/operations.ts`：

  * `GET /api/operations/instance-admin/overview` — instance\_admin 跨实例总览

    * 响应：

      ```typescript
      interface InstanceAdminOverview {
        total_instances: number;
        running_instances: number;
        total_players_online: number;
        total_players_24h: number;          // 24h 独立玩家数
        revenue_today: number;              // 今日收入（点券）
        revenue_30d: number;                // 30 天收入
        orders_today: number;
        cdk_redeems_today: number;
        backup_health: { instance_id: string; last_backup_at: string | null; status: 'healthy' | 'stale' | 'never' }[];
        alerts: AlertItem[];                // 近 24h 告警
      }
      ```

  * `GET /api/operations/instance-admin/revenue?days=30` — 收入曲线（按天聚合）

  * `GET /api/operations/instance-admin/players?days=30` — 玩家活跃度曲线

  * `GET /api/operations/instance-admin/instances-compare` — 实例对比表（CPU/内存/玩家/收入）

#### D2 前端运营仪表盘

* 新建 `panel/frontend/src/pages/admin/OperationsDashboard.tsx`（路由 `/admin/operations`）：

  * 仅 instance\_admin+ 可见

  * 顶部统计卡片：实例数 / 在线玩家 / 今日收入 / 今日订单

  * 收入曲线图（30 天，可切换 7 天/30 天/90 天）

  * 玩家活跃度曲线（24h 在线人数叠加图）

  * 备份健康度表格：每个实例的最近备份时间 + 状态徽章

  * 告警时间线：近 24h 异常事件列表

  * 实例对比表：按收入/玩家数排序

* 修改 `panel/frontend/src/components/Layout.tsx`：

  * instance\_admin+ 增加"运营仪表盘"导航项

### E. 资源配额系统

#### E1 配额数据模型

* 新建 migration `20260723000001_create_resource_quotas.ts`：

  ```sql
  CREATE TABLE resource_quotas (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,           -- 'role' | 'user'
    scope_id TEXT NOT NULL,             -- role 名或 user_id
    max_instances INTEGER,              -- 最大实例数（NULL=不限）
    max_disk_mb BIGINT,                 -- 最大磁盘用量 MB（NULL=不限）
    max_players_total INTEGER,          -- 最大在线玩家总数（NULL=不限）
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(scope_type, scope_id)
  );
  ```

* 新建 `panel/backend/src/services/quotaService.ts`：

  * `getQuota(scopeType, scopeId)` — 查询配额

  * `setQuota(scopeType, scopeId, limits)` — 设置配额

  * `checkInstanceQuota(userId)` — 检查用户是否可创建新实例

  * `checkDiskQuota(userId, additionalMb)` — 检查磁盘配额

  * `getUsage(userId)` — 查询当前用量

#### E2 配额强制执行

* 修改 `panel/backend/src/api/routes/servers.ts` 的创建实例端点：

  * 创建前调用 `quotaService.checkInstanceQuota(userId)`，超额返回 403 + `QUOTA_EXCEEDED`

* 修改文件上传端点（`panel/backend/src/api/routes/files.ts`）：

  * 上传前检查磁盘配额

* 新建 `panel/backend/src/api/routes/quotas.ts`：

  * `GET /api/quotas` — 查询当前用户配额 + 用量

  * `GET /api/quotas/role/:role` — 查询角色配额（server\_admin）

  * `PUT /api/quotas/role/:role` — 设置角色配额（server\_admin）

  * `GET /api/quotas/user/:userId` — 查询用户配额（server\_admin）

  * `PUT /api/quotas/user/:userId` — 设置用户配额（server\_admin）

#### E3 前端配额展示

* 修改 `panel/frontend/src/pages/Servers.tsx`：

  * 顶部显示"实例配额：N / M"进度条

  * 超额时禁用"创建实例"按钮 + 提示

* 修改 `panel/frontend/src/pages/CreateServer.tsx`：

  * 创建前检查配额，超额提示

* 新建 `panel/frontend/src/pages/admin/Quotas.tsx`（路由 `/admin/quotas`）：

  * server\_admin 专用

  * 按角色配置默认配额

  * 按用户配置个性化配额（覆盖角色默认）

### F. 告警主动通知

#### F1 告警规则引擎

* 新建 `panel/backend/src/services/alertService.ts`：

  * `AlertRule` 接口：`{ id, name, condition, severity, channels }`

  * 预置规则：

    * 实例崩溃（崩溃熔断触发时）

    * 实例异常退出（非主动停止）

    * 磁盘使用率 > 90%

    * SSL 证书 30 天内到期

    * 备份连续 3 天失败

    * 玩家举报（若有）

  * `evaluateAlert(rule, context)` — 评估规则触发

  * `dispatchAlert(alert, channels)` — 分发到各通道

#### F2 通知通道

* 修改 `panel/backend/src/services/notificationService.ts`：

  * 新增 `notifyViaEmail(userIds, subject, body)` — 调用 mailService

  * 新增 `notifyViaWebhook(url, payload)` — HTTP POST 到用户配置的 Webhook

  * 现有站内信保留

* 修改 `panel/backend/src/services/mailService.ts`：

  * 新增告警邮件模板

* 新建 `panel/backend/src/api/routes/alertSettings.ts`：

  * `GET /api/alert-settings` — 查询当前用户的告警通道配置

  * `PUT /api/alert-settings` — 更新配置（email\_enabled / webhook\_url / subscribed\_rules）

  * `GET /api/alert-rules` — 列出所有可用告警规则

#### F3 告警触发点接线

* 修改 `daemon/src/instances/manager.ts`（v4.2.0 A2 崩溃熔断）：

  * 触发熔断时调用 Panel API 上报告警

* 修改 `panel/backend/src/services/diskMonitorService.ts`：

  * 磁盘 > 90% 时触发告警

* 修改 `panel/backend/src/services/sslService.ts`：

  * 证书 30 天内到期时触发告警（定时任务检查）

* 新建定时任务 `panel/backend/src/services/scheduler.ts`：

  * `ALERT_SSL_EXPIRY_CHECK` — 每日检查 SSL 证书到期

  * `ALERT_BACKUP_HEALTH_CHECK` — 每日检查备份健康度

#### F4 前端告警配置

* 新建 `panel/frontend/src/pages/AlertSettings.tsx`（路由 `/profile/alerts`）：

  * 所有用户可配置自己的告警通道

  * 邮箱开关（依赖已验证邮箱）

  * Webhook URL 输入 + 测试按钮

  * 订阅的告警规则复选框列表

***

## 五、v4.7.0 — 总览增强 + 范围授权 + 批量操作（P2）

### G. server\_admin 全平台总览仪表盘增强

#### G1 后端全平台统计 API

* 新建 `panel/backend/src/api/routes/platform-stats.ts`：

  * `GET /api/platform/overview` — 全平台总览

    * 响应：

      ```typescript
      interface PlatformOverview {
        total_users: number;
        active_users_24h: number;
        active_users_30d: number;
        total_instances: number;
        running_instances: number;
        total_nodes: number;
        healthy_nodes: number;
        total_disk_used_mb: number;
        total_disk_capacity_mb: number;
        revenue_today: number;
        revenue_30d: number;
        alerts_24h: number;
        top_disk_usage: { instance_id: string; name: string; used_mb: number; owner: string }[];
        instance_status_distribution: { running: number; stopped: number; error: number };
      }
      ```

  * `GET /api/platform/users?range=24h|30d` — 用户活跃度曲线

  * `GET /api/platform/revenue?days=30` — 全平台收入曲线

  * `GET /api/platform/disk-usage-top?limit=10` — 磁盘用量 TopN

#### G2 前端全平台总览

* 新建 `panel/frontend/src/pages/admin/PlatformDashboard.tsx`（路由 `/admin/platform`）：

  * server\_admin 专用

  * 顶部 KPI 卡片：用户数 / 实例数 / 节点数 / 收入

  * 实例状态分布饼图

  * 用户活跃度曲线（DAU/MAU）

  * 收入曲线

  * 磁盘用量 TopN 表格

  * 节点健康度列表

  * 告警时间线

### H. 按实例范围授权（RBAC1 资源范围）

#### H1 实例级角色覆盖

**问题**：当前角色是全局的，user 在所有实例都是 user，无法"在实例 A 是 user、在实例 B 是 instance\_admin"。

**改造**：

* 新建 migration `20260724000001_create_instance_roles.ts`：

  ```sql
  CREATE TABLE instance_roles (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,                 -- 'instance_admin' | 'user'
    granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,                    -- NULL=永久
    UNIQUE(instance_id, user_id),
    FOREIGN KEY (instance_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  ```

* 新建 `panel/backend/src/services/instanceRoleService.ts`：

  * `getEffectiveRole(userId, instanceId)` — 返回用户在某实例的有效角色

    * 优先级：`instance_roles.role` > 全局 `users.role`

    * server\_admin 全局角色不可被实例级覆盖

  * `grantInstanceRole(instanceId, userId, role, grantedBy)` — 授予实例级角色

  * `revokeInstanceRole(instanceId, userId)` — 撤销

* 修改 `requireInstanceAccess` / `requireInstanceAdmin`：

  * 优先查询 `instance_roles` 表获取实例级角色

* 新建 API `panel/backend/src/api/routes/instanceRoles.ts`：

  * `GET /api/servers/:serverId/roles` — 列出实例的角色分配

  * `POST /api/servers/:serverId/roles` — 授予角色

  * `DELETE /api/servers/:serverId/roles/:userId` — 撤销角色

#### H2 前端实例角色管理

* 新建 `panel/frontend/src/pages/instance-detail/InstanceRoles.tsx`：

  * 仅 instance\_admin+ 可见

  * 列表展示实例的角色分配

  * 支持授予/撤销实例级角色

  * 支持设置过期时间

### I. 批量操作

#### I1 后端批量操作 API

* 新建 `panel/backend/src/api/routes/batch.ts`：

  * `POST /api/batch/start` — 批量启动（body: `{ instance_ids: string[] }`）

  * `POST /api/batch/stop` — 批量停止

  * `POST /api/batch/restart` — 批量重启

  * `POST /api/batch/backup` — 批量备份

  * `POST /api/batch/update` — 批量更新版本

  * 响应：`{ results: { instance_id: string; success: boolean; message?: string }[] }`

  * 权限：对每个实例单独校验 `requireInstanceAdmin`，无权限的跳过并标记

#### I2 前端批量操作 UI

* 修改 `panel/frontend/src/pages/Servers.tsx`：

  * 实例列表增加多选复选框

  * 顶部工具栏：全选 / 批量启动 / 批量停止 / 批量重启 / 批量备份

  * 操作前确认弹窗 + 进度展示

* 修改 `panel/frontend/src/pages/admin/OperationsDashboard.tsx`：

  * 运营仪表盘的实例对比表支持批量操作

***

## 六、v4.8.0 — 移动端 + 推荐 + 社交（P3）

### J. 移动端体验优化

#### J1 实例详情页移动端改造

* 修改 `panel/frontend/src/pages/ServerDetail.tsx`：

  * 移动端（<768px）Tab 改为横向滚动 + 下拉菜单组合

  * 控制台日志区域全屏化

  * 命令输入栏固定底部

* 修改 `panel/frontend/src/pages/MyAssets.tsx`：

  * 移动端卡片改为单列堆叠

  * 钱包余额大字号展示

  * 快捷操作底部固定栏

#### J2 移动端导航优化

* 修改 `panel/frontend/src/components/Layout.tsx`：

  * 移动端底部导航增加"我的"入口

  * 侧边栏抽屉增加分组折叠

  * 面包屑在移动端简化为当前页标题

### K. 服务器推荐位

#### K1 后端推荐 API

* 新建 `panel/backend/src/api/routes/discover.ts`：

  * `GET /api/discover/hot?limit=10` — 热门服务器（按 24h 在线人数排序）

  * `GET /api/discover/new?limit=10` — 新开服（按创建时间排序）

  * `GET /api/discover/recommended?limit=10` — 推荐服（运营手动置顶）

  * 仅返回公开服务器（`is_public = true` 的实例）

* 修改 instances 表新增 `is_public` 字段（migration `20260725000001_add_is_public_to_servers.ts`）

* 修改 instances 表新增 `is_recommended` 字段（server\_admin 可置顶）

#### K2 前端发现页

* 新建 `panel/frontend/src/pages/Discover.tsx`（路由 `/discover`）：

  * 所有用户可见（含未登录）

  * 顶部 Banner 轮播推荐服

  * 热门服务器卡片网格

  * 新开服卡片网格

  * 每个卡片：名称 / 简介 / 在线人数 / 版本 / "加入"按钮

* 修改 `panel/frontend/src/components/Layout.tsx`：

  * 主导航增加"发现"入口

### L. 玩家社交

#### L1 好友系统

* 新建 migration `20260726000001_create_friendships.ts`：

  ```sql
  CREATE TABLE friendships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    friend_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'blocked'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT,
    UNIQUE(user_id, friend_user_id)
  );
  ```

* 新建 `panel/backend/src/services/friendService.ts`：

  * `sendRequest(userId, friendUserId)` — 发送好友请求

  * `acceptRequest(userId, friendUserId)` — 接受

  * `rejectRequest(userId, friendUserId)` — 拒绝

  * `listFriends(userId)` — 好友列表

  * `removeFriend(userId, friendUserId)` — 删除好友

* 新建 `panel/backend/src/api/routes/friends.ts`：

  * `POST /api/friends/request` — 发送请求

  * `POST /api/friends/:requestId/accept` — 接受

  * `POST /api/friends/:requestId/reject` — 拒绝

  * `GET /api/friends` — 好友列表

  * `DELETE /api/friends/:friendUserId` — 删除好友

  * `GET /api/friends/online` — 在线好友

#### L2 玩家档案页

* 新建 `panel/frontend/src/pages/PlayerProfile.tsx`（路由 `/players/:userId`）：

  * 展示玩家信息：用户名 / VIP 等级 / 注册时间 / 绑定的游戏角色

  * 共同实例展示（"我和 TA 都在玩 XXX 服"）

  * 好友状态 + 添加好友按钮

  * 最近活动（公开的）

* 新建 `panel/backend/src/api/routes/playerProfile.ts`：

  * `GET /api/players/:userId/profile` — 公开档案

#### L3 前端社交入口

* 新建 `panel/frontend/src/pages/Friends.tsx`（路由 `/friends`）：

  * 好友列表 + 在线状态

  * 好友请求通知

  * 推荐好友（同实例玩家）

* 修改 `panel/frontend/src/components/Layout.tsx`：

  * 主导航增加"好友"入口

***

## 七、执行顺序与依赖

### 7.1 版本内依赖

```
v4.5.0：
  A1（列表过滤）→ A4（前端列表）→ A5（管理员 Tab）
  A2（instance_admins 表）→ A3（服务层）→ A1
  B1（聚合 API）→ B2（聚合页）
  C1/C2/C3（契约+迁移）→ A/B 并行

v4.6.0：
  D1（统计 API）→ D2（仪表盘）
  E1（配额模型）→ E2（强制执行）→ E3（前端配额）
  F1（规则引擎）→ F2（通道）→ F3（接线）→ F4（前端配置）

v4.7.0：
  G1（全平台 API）→ G2（总览页）
  H1（实例角色）→ H2（前端管理）
  I1（批量 API）→ I2（批量 UI）

v4.8.0：
  J1/J2（移动端）独立
  K1（推荐 API）→ K2（发现页）
  L1（好友）→ L2（档案）→ L3（社交入口）
```

### 7.2 跨版本依赖

* v4.6.0 D（运营仪表盘）依赖 v4.5.0 A（租户边界，确保 instance\_admin 只看自己的实例）

* v4.7.0 H（实例范围授权）依赖 v4.5.0 A2（instance\_admins 表基础设施）

* v4.8.0 L3（社交入口）依赖 v4.8.0 L1（好友系统）

***

## 八、契约变更清单

### 8.1 数据契约（public/schema/）

| 文件                   | 变更                                                                                                                                                                           | 版本      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `panel-api-types.ts` | 新增 `MyAssetsResponse` / `InstanceAdmin` / `InstanceRole` / `ResourceQuota` / `AlertRule` / `AlertSettings` / `Friendship` / `PlatformOverview` / `InstanceAdminOverview` 等类型 | v4.5.0+ |
| `panel-api-types.ts` | 新增错误码：`QUOTA_EXCEEDED` / `INSTANCE_ADMIN_ALREADY_EXISTS` / `INSTANCE_ROLE_ALREADY_EXISTS` / `FRIEND_REQUEST_ALREADY_EXISTS` 等                                                | v4.5.0+ |
| `ws-events.ts`       | 新增 `AlertEvent`（告警推送到前端）                                                                                                                                                     | v4.6.0  |

### 8.2 接口契约（public/interface\_stub/）

| 文件                       | 变更                                                                                                                                                                                                                       | 版本      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `panel-rest.d.ts`（新建或扩展） | 新增 `/api/me/*` / `/api/servers/:id/admins` / `/api/operations/*` / `/api/quotas/*` / `/api/alert-settings` / `/api/platform/*` / `/api/batch/*` / `/api/discover/*` / `/api/friends/*` / `/api/players/:id/profile` 端点签名 | v4.5.0+ |

### 8.3 数据库迁移

| 迁移文件                                         | 内容                                         | 版本     |
| -------------------------------------------- | ------------------------------------------ | ------ |
| `20260722000001_create_instance_admins.ts`   | instance\_admins 共管关联表                     | v4.5.0 |
| `20260723000001_create_resource_quotas.ts`   | 资源配额表                                      | v4.6.0 |
| `20260724000001_create_instance_roles.ts`    | 实例级角色覆盖表                                   | v4.7.0 |
| `20260725000001_add_is_public_to_servers.ts` | instances 表新增 is\_public / is\_recommended | v4.8.0 |
| `20260726000001_create_friendships.ts`       | 好友关系表                                      | v4.8.0 |

***

## 九、验证清单

### 9.1 每版本通用验证

* [ ] daemon `tsc --noEmit` 0 errors

* [ ] panel/backend `tsc --noEmit` 0 errors

* [ ] panel/frontend `tsc --noEmit` 0 errors

* [ ] 版本号同步：version.md / version.json / 4 个 package.json / README.md / deploy.sh

* [ ] 数据库迁移可重复执行（IF NOT EXISTS / IF NOT EXISTS 保护）

* [ ] 现有功能无回归（手动验证关键路径）

### 9.2 v4.5.0 专项验证

* [ ] instance\_admin 调用 `GET /api/servers` 只返回 owner + instance\_admins 关联的实例

* [ ] user 调用 `GET /api/servers` 只返回绑定实例

* [ ] server\_admin 调用返回全部实例

* [ ] `POST /api/servers/:id/admins` 成功分配管理员后，该管理员可访问该实例

* [ ] `GET /api/me/assets` 返回完整资产聚合数据

* [ ] `/me` 页面展示所有资产卡片

### 9.3 v4.6.0 专项验证

* [ ] `GET /api/operations/instance-admin/overview` 返回正确的跨实例统计

* [ ] 配额超限时创建实例返回 403 + `QUOTA_EXCEEDED`

* [ ] 告警触发后邮件 / Webhook / 站内信三通道均收到通知

### 9.4 v4.7.0 专项验证

* [ ] `GET /api/platform/overview` 返回全平台统计

* [ ] 授予实例级角色后，用户在该实例的权限立即生效

* [ ] 批量操作完成后返回每个实例的成功/失败状态

### 9.5 v4.8.0 专项验证

* [ ] 移动端实例详情页 Tab 可用

* [ ] `/discover` 页面展示热门/新开/推荐服务器

* [ ] 好友请求发送/接受/拒绝流程完整

* [ ] 玩家档案页展示公开信息

***

## 十、风险与回退

### 10.1 风险点

| 风险                                                     | 影响 | 缓解措施                                                           |
| ------------------------------------------------------ | -- | -------------------------------------------------------------- |
| instance\_admins 表引入后，现有 instance\_admin 可能失去对非自有实例的访问 | 高  | 迁移脚本提供"将现有 instance\_admin 的所有实例自动建立 instance\_admins 记录"的兼容选项 |
| 配额系统上线后，现有用户可能因配额未设置而无法创建实例                            | 中  | 配额默认值：角色配额 NULL=不限；用户配额未设置时 fallback 到角色配额                     |
| 实例级角色覆盖可能导致权限混乱                                        | 中  | server\_admin 全局角色不可被覆盖；实例级角色仅支持 instance\_admin/user 两级       |
| 批量操作可能造成系统负载突增                                         | 中  | 批量操作串行执行 + 限流（每次最多 10 个实例）                                     |

### 10.2 回退策略

* 每个版本独立交付，若某版本出问题可回退到上一版本

* 数据库迁移均为"建新表"或"加新字段"，不修改/删除现有结构，回退安全

* 前端路由新增独立页面，不影响现有页面

***

## 附录：文件清单

### v4.5.0 新建文件

```
panel/backend/src/db/migrations/20260722000001_create_instance_admins.ts
panel/backend/src/services/instanceAdminService.ts
panel/backend/src/services/myAssetsService.ts
panel/backend/src/api/routes/instanceAdmins.ts
panel/backend/src/api/routes/me.ts
panel/frontend/src/pages/MyAssets.tsx
panel/frontend/src/pages/instance-detail/Admins.tsx
```

### v4.6.0 新建文件

```
panel/backend/src/db/migrations/20260723000001_create_resource_quotas.ts
panel/backend/src/services/quotaService.ts
panel/backend/src/services/alertService.ts
panel/backend/src/api/routes/operations.ts
panel/backend/src/api/routes/quotas.ts
panel/backend/src/api/routes/alertSettings.ts
panel/frontend/src/pages/admin/OperationsDashboard.tsx
panel/frontend/src/pages/admin/Quotas.tsx
panel/frontend/src/pages/AlertSettings.tsx
```

### v4.7.0 新建文件

```
panel/backend/src/db/migrations/20260724000001_create_instance_roles.ts
panel/backend/src/services/instanceRoleService.ts
panel/backend/src/api/routes/platform-stats.ts
panel/backend/src/api/routes/instanceRoles.ts
panel/backend/src/api/routes/batch.ts
panel/frontend/src/pages/admin/PlatformDashboard.tsx
panel/frontend/src/pages/instance-detail/InstanceRoles.tsx
```

### v4.8.0 新建文件

```
panel/backend/src/db/migrations/20260725000001_add_is_public_to_servers.ts
panel/backend/src/db/migrations/20260726000001_create_friendships.ts
panel/backend/src/services/friendService.ts
panel/backend/src/api/routes/discover.ts
panel/backend/src/api/routes/friends.ts
panel/backend/src/api/routes/playerProfile.ts
panel/frontend/src/pages/Discover.tsx
panel/frontend/src/pages/Friends.tsx
panel/frontend/src/pages/PlayerProfile.tsx
```

