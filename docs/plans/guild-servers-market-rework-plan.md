---
type: plan
title: /guild/servers 全平台市场重做 + 公开/私有混合绑定流程
date: 2026-07-30
status: 草案待用户确认（精简规划模式，跳过独立审查，依靠用户手动验收）
related: [绑定体系, 玩家门户, discover 市场, 服主权限下放]
tags: [plan, guild, market, binding-requests, visibility-delegation]
approved_at: 待批准
---

# /guild/servers 全平台市场重做 + 公开/私有混合绑定流程

## 0. 决策上下文

### 0.1 用户反馈与原痛点

用户原话："`https://gsp.ecsrz.com:3001/guild/servers` 这里为什么只能绑定自己的？这里应该是游戏市场一样的，只要是在平台的实例，都应该能进行申请绑定才对。"

根因诊断：
- `/guild/bind`（绑定管理页 → 账户级绑定 → "可绑定实例"列表）数据源是 `GET /api/servers`
- 后端 [servers.ts#L179-L195](file:///home/airxw/gsp/panel/backend/src/api/routes/servers.ts#L179-L195) 对 `user` 角色只返回 `owner_user_id=userId` 或已 bindings 绑定的实例
- 结果："可绑定实例"列表只能看到自己创建的实例，看不到平台其他实例

### 0.2 用户已确认的决策点

经 AskUserQuestion 人类裁决 + 规划文档审阅反馈：

1. **实例范围**：`is_public=1` 的所有实例 + `owner_user_id=userId` 的实例（合并去重）
2. **绑定流程**：公开实例直接绑 + 私有实例走审批（混合策略）
3. **改造范围**：重做 `/guild/servers` 为「全平台市场」
4. **公开层级**：用平台层 `servers.is_public`（与游戏层 pack.yaml 的 `visibility`/`-public` 无关）
5. **设置权限**：下放给服主（owner/instance_admin），不再仅限 server_admin
6. **审批通过 vip_level=1** —— 与直接绑定（公开实例）行为一致，直接复用 `instanceBindingService.bindInstance()`，无需新增参数
7. **申请机制可开关** —— 服主可开启/关闭自己实例的"申请绑定"功能（默认开启，关闭后私有实例不接受新申请；公开实例不受此开关影响，因公开实例直接绑不走申请）

### 0.3 执行方式

用户选定：**精简规划 + 直接编码**（跳过独立审查闸门，依靠用户手动验收）。

按 `bb.md` 规则，本次属于"全新功能增加"（新增申请-审批流程 + 重做页面 + 新增端点 + 新增表），中版本号 +1。

---

## 1. 方案概要

**一句话定位**：把 `/guild/servers` 从"我的服务器列表"重做为"全平台实例市场"；公开实例直接绑定，私有实例走"申请-审批"流程；服主可自主上架/下架自己的实例。

**关键改动**：
- 后端：新增 `binding_requests` 表；新增 6 个绑定申请端点；新增 1 个可绑定实例列表端点；下放 visibility 设置权限
- 前端：重做 `GuildServers.tsx` 为市场列表；新增"申请绑定"流程；新增服主审批页；修复 `GuildBind.tsx` 可绑定列表数据源
- 契约：在 `public/schema/panel-api-types.ts` 新增 `BindingRequest` 类型 + 相关请求/响应类型
- 迁移：新增 migration 建 `binding_requests` 表

---

## 2. 数据模型

### 2.1 新增表：`binding_requests`（绑定申请审批）

> 设计哲学：复用 `bindings` 表的 verify_status 语义（pending/verified/rejected），但用独立表隔离"申请-审批"流程，避免污染 bindings 表的"验证码自动验证"语义。审批通过后自动创建 `bindings` 记录（binding_type='account', scope_type='instance', verify_status='verified'）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT (UUID) | PK | 主键（UUID v4） |
| `server_id` | TEXT (UUID) | NOT NULL, FK → servers.id ON DELETE CASCADE | 目标实例 |
| `requester_user_id` | TEXT (UUID) | NOT NULL, FK → users.id ON DELETE CASCADE | 申请人 |
| `status` | TEXT | NOT NULL DEFAULT 'pending', CHECK IN ('pending','approved','rejected','cancelled') | 审批状态 |
| `message` | TEXT | NULLABLE | 申请留言（用户填） |
| `reviewer_user_id` | TEXT (UUID) | NULLABLE, FK → users.id ON DELETE SET NULL | 审批人 |
| `review_note` | TEXT | NULLABLE | 审批备注（服主填） |
| `reviewed_at` | TEXT (ISO8601) | NULLABLE | 审批时间 |
| `created_at` | TEXT (ISO8601) | NOT NULL | 创建时间 |
| `updated_at` | TEXT (ISO8601) | NOT NULL | 更新时间 |

**索引**：
- `idx_binding_requests_server` ON `(server_id)`
- `idx_binding_requests_requester` ON `(requester_user_id)`
- `idx_binding_requests_status` ON `(status)`
- `idx_binding_requests_pending_unique` UNIQUE ON `(server_id, requester_user_id)` WHERE `status='pending'`（同一用户对同一实例只能有一个 pending 申请）

### 2.2 修改表：`servers` 新增 `binding_requests_enabled` 字段

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `binding_requests_enabled` | INTEGER | NOT NULL DEFAULT 1 | 是否接受绑定申请（1=开启 / 0=关闭）；只对私有实例（is_public=0）有意义；公开实例直接绑不走申请，此字段不影响 |

迁移：`ALTER TABLE servers ADD COLUMN binding_requests_enabled INTEGER NOT NULL DEFAULT 1`

**语义矩阵**：
| is_public | binding_requests_enabled | 用户可执行操作 |
|-----------|--------------------------|----------------|
| 1（公开） | 1（开） | 直接绑定（申请开关无意义） |
| 1（公开） | 0（关） | 直接绑定（申请开关无意义） |
| 0（私有） | 1（开） | 申请绑定（走审批流程） |
| 0（私有） | 0（关） | 无法绑定（除非服主私下邀请或加 instance_admin） |

### 2.3 现有表其他不动

- `servers.is_public`（INTEGER 0/1，默认 0）—— 直接复用，不下放时已有字段
- `bindings` 表 —— 审批通过后写入 `binding_type='account', scope_type='instance', verify_status='verified', vip_level=1` 记录（与直接绑定一致）
- `instance_admins` 表 —— 复用作为"服主"权限判定（owner 或 instance_admin）

---

## 3. 后端接口设计

### 3.1 新增端点：`GET /api/servers/bindable` — 可绑定实例市场列表

- **鉴权**：JWT（任意登录用户）
- **查询参数**：`?limit=50&offset=0&game_type=xxx&keyword=xxx`（可选）
- **返回**：`{ servers: BindableServer[] }`
- **数据范围**：`is_public=1` 的所有实例 + `owner_user_id=userId` 的实例（合并去重），排除 `status IN ('deleted','removing')`
- **每个实例附带**：
  - `is_owner: boolean`（当前用户是否 owner）
  - `is_bound: boolean`（当前用户是否已 bindings 绑定）
  - `has_pending_request: boolean`（当前用户是否已提交 pending 申请）
  - `can_direct_bind: boolean`（is_public=1 或 is_owner 时为 true → 卡片显示"立即绑定"）
  - `can_request_bind: boolean`（is_public=0 且非 owner 且 binding_requests_enabled=1 且未已绑定 → 卡片显示"申请绑定"）
  - `binding_requests_enabled: boolean`（实例是否开启申请通道，供服主管理端展示）

```typescript
interface BindableServer {
  id: string;
  name: string;
  game_type: string;
  pack_id: string;
  status: string;
  is_public: boolean;
  owner_username: string | null;
  is_owner: boolean;
  is_bound: boolean;
  has_pending_request: boolean;
  can_direct_bind: boolean;     // true → "立即绑定"
  can_request_bind: boolean;    // true → "申请绑定"
  binding_requests_enabled: boolean;
  created_at: string;
}
```

### 3.2 修改端点：`PUT /api/admin/servers/:serverId/visibility` — 下放权限

- **现状**：挂载在 `/api/admin/servers`，需 `requireAdmin`（仅 server_admin）
- **目标**：放宽为"server_admin OR owner OR instance_admin"
- **实现**：保留原端点路径不变，改中间件——新增 `requireInstanceOwnerOrAdminOrServerAdmin` 中间件，替代 `requireAdmin`
- **向后兼容**：原 server_admin 调用仍然通过

### 3.3 新增端点：`PUT /api/servers/:serverId/binding-requests-settings` — 申请开关

- **鉴权**：JWT + owner/instance_admin（复用 §3.2 的中间件）
- **请求体**：`{ binding_requests_enabled: boolean }`
- **返回**：`{ server_id: string, binding_requests_enabled: boolean }`
- **语义**：只对私有实例（is_public=0）有意义；公开实例调用此端点返回 200 但实际无效果（后端可忽略设置或返回提示）

### 3.4 新增端点：绑定申请 CRUD

| 端点 | 方法 | 鉴权 | 用途 |
|------|------|------|------|
| `/api/servers/:serverId/binding-requests` | POST | JWT | 用户申请绑定私有实例（body: `{message?: string}`） |
| `/api/servers/:serverId/binding-requests` | GET | JWT + owner/instance_admin | 服主查看该实例的申请列表 |
| `/api/binding-requests/:id/approve` | POST | JWT + owner/instance_admin | 服主审批通过（body: `{review_note?: string}`） |
| `/api/binding-requests/:id/reject` | POST | JWT + owner/instance_admin | 服主审批拒绝（body: `{review_note?: string}`） |
| `/api/binding-requests/:id` | DELETE | JWT + 申请人本人 | 用户撤销自己的 pending 申请 |
| `/api/my/binding-requests` | GET | JWT | 用户查看自己提交的全部申请 |

**关键约束**：
- POST 申请时校验：实例存在 + 非 owner + `is_public=0` + `binding_requests_enabled=1` + 未已绑定 + 无 pending 申请
- POST approve 时事务：更新 `binding_requests.status='approved'` + 直接调用 `instanceBindingService.bindInstance()` 创建 `bindings` 记录（vip_level=1，与直接绑定一致，复用已有"已 revoked 复活"逻辑）
- POST reject 时只更新 `binding_requests.status='rejected'`（不创建 binding）

**错误码**：
- `BINDING_REQUEST_ALREADY_PENDING`（409）—— 已有 pending 申请
- `BINDING_REQUEST_NOT_FOUND`（404）
- `BINDING_REQUEST_NOT_PENDING`（400）—— 审批非 pending 状态的申请
- `BINDING_REQUEST_ALREADY_BOUND`（409）—— 已绑定无需再申请
- `BINDING_REQUEST_PUBLIC_INSTANCE`（400）—— 公开实例应直接绑定，不走申请
- `BINDING_REQUEST_DISABLED`（403）—— 服主已关闭申请通道

### 3.5 路由文件组织

新增 `panel/backend/src/api/routes/bindingRequests.ts`，导出 `createBindingRequestsRouter(db, logger)`。
在 `routes-registry.ts` 挂载到 `/api`（与 `/api/instances` 同级，套 `authenticateToken(JWT_SECRET)`）。

§3.2 / §3.3 的 visibility / binding-requests-settings 端点保留在 `discover.ts` 的 admin router 内（或迁移到 `servers.ts`），统一挂载到 `/api/admin/servers` 或 `/api/servers`，权限走新中间件。

---

## 4. 前端页面改造

### 4.1 重做 `GuildServers.tsx`（核心）

**新定位**：全平台实例市场 + 我的绑定筛选 tab。

**页面结构**：
```
┌─ Hero 页头：标题"游戏市场" + 副标题 + 搜索框 + 刷新
├─ Tab 切换：「全部市场」/「我的绑定」/「我创建的」
├─ 筛选条：游戏类型下拉 + 在线状态 + 排序（最新/热门）
├─ 实例卡片网格（grid 自适应）
│   └─ 每卡片：图标 + 名称 + 游戏类型 + 在线状态 + 服主 + 操作按钮
└─ 推荐服务器横滑区块（保留原 RecommendCard）
```

**卡片操作按钮逻辑**（基于 `BindableServer` 字段）：
| 状态 | 按钮文案 | 点击行为 |
|------|---------|---------|
| `is_owner=true` | "进入" | navigate(`/guild/servers/${id}`) |
| `is_bound=true` | "进入" + "解绑" | 进入 / 调用 unbindInstance |
| `can_direct_bind=true` 且未绑定 | "立即绑定" | 调用 bindInstance（直接绑，vip_level 沿用现状=1） |
| `can_request_bind=true` 且 `has_pending_request=false` | "申请绑定" | 弹出留言框 → POST binding-request |
| `can_request_bind=true` 且 `has_pending_request=true` | "审核中"（disabled） | — |
| `can_direct_bind=false` 且 `can_request_bind=false` 且未绑定 | "未开放申请"（disabled） | 私有 + 服主已关闭申请通道 |

**数据源**：`api.listBindableServers(params)`（新封装）

### 4.2 修改 `GuildBind.tsx`（修复可绑定列表数据源）

**改动**：账户级绑定分支的"可绑定实例"列表数据源，从 `api.listServers()` 改为 `api.listBindableServers()`。
**BindableServerRow** 复用，但按钮逻辑同 4.1。

### 4.3 修改 `ServerDetailGuild.tsx`（私有实例详情页支持申请绑定）

**现状**：用户通过 URL 访问无权访问的私有实例 → 显示"您无权访问该实例"。
**改造**：
- 调用 `api.getServer(id)` 时，后端对私有 + 非绑定 + 非 owner 的访问仍返回 403，但响应里附带 `can_request_binding: true`
- 前端在 403 + can_request_binding 时，显示"申请绑定"按钮（替代原"无权访问"提示）
- 申请提交后显示"已提交申请，等待服主审批"

**实现细节**：后端 `GET /api/servers/:id` 在 403 响应体里加 `can_request_binding` 字段；前端 `api.getServer` 捕获 403 时不报错，返回带 `forbidden` 标记的对象。

### 4.4 新增 `GuildMyBindingRequests.tsx`（用户查看自己的申请）

- 路由：`/guild/my-binding-requests`
- 入口：`/guild/servers` 顶部 Tab 或用户菜单
- 列表展示：申请人自己提交的所有 binding_requests（pending/approved/rejected/cancelled）
- pending 状态可撤销；approved 显示"进入实例"按钮

### 4.5 修改 `ServerDetail.tsx`（管理端 Tab 加"绑定申请管理" + "申请开关"）

**仅对 owner / instance_admin 可见**的新 Tab："绑定申请"
- 顶部"申请通道"开关：调用 `PUT /api/servers/:id/binding-requests-settings` 切换 `binding_requests_enabled`
  - 私有实例：开关可切换（默认开）
  - 公开实例：开关灰显（标注"公开实例直接绑定，无需申请通道"）
- 列表展示该实例的 pending 申请
- 每条申请：申请人 + 留言 + 申请时间 + "通过"/"拒绝"按钮
- 通过/拒绝时填 review_note（可选）

### 4.6 路由更新（`App.tsx`）

新增路由：
```tsx
<Route path="my-binding-requests" element={<GuildMyBindingRequests />} />
```

### 4.7 API client 封装（`client.ts`）

新增方法：
```typescript
listBindableServers(params?: { limit?: number; offset?: number; game_type?: string; keyword?: string }): Promise<{ servers: BindableServer[] }>;
createBindingRequest(serverId: string, message?: string): Promise<{ request: BindingRequest }>;
listBindingRequestsForServer(serverId: string): Promise<{ requests: BindingRequest[] }>;
listMyBindingRequests(): Promise<{ requests: BindingRequest[] }>;
approveBindingRequest(requestId: string, reviewNote?: string): Promise<{ request: BindingRequest }>;
rejectBindingRequest(requestId: string, reviewNote?: string): Promise<{ request: BindingRequest }>;
cancelBindingRequest(requestId: string): Promise<void>;
setServerVisibility(serverId: string, isPublic: boolean): Promise<{ server_id: string; is_public: boolean }>;
setBindingRequestsSettings(serverId: string, enabled: boolean): Promise<{ server_id: string; binding_requests_enabled: boolean }>;
```

---

## 5. 契约变更（public/schema/panel-api-types.ts）

按 rules-3 §六 契约版本化规则，本次属于 MINOR 变更（新增可选字段、新增接口方法），不阻断现有依赖。

新增类型：
- `BindingRequest`（绑定申请记录）
- `BindingRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'`
- `BindableServer`（市场列表项，含 is_owner/is_bound/has_pending_request/can_direct_bind/can_request_bind/binding_requests_enabled）
- `CreateBindingRequestRequest` / `CreateBindingRequestResponse`
- `ListBindingRequestsResponse`
- `ApproveBindingRequestRequest` / `RejectBindingRequestRequest`
- `ListBindableServersResponse`
- `BindingRequestReviewResponse`
- `SetBindingRequestsSettingsRequest` / `SetBindingRequestsSettingsResponse`

`SetServerVisibilityRequest` / `SetServerVisibilityResponse` 已存在，无需新增。

---

## 6. 迁移脚本

新增 migration：`panel/backend/src/db/migrations/20260901000001_add_binding_requests.ts`

```typescript
// up:
//   1) CREATE TABLE binding_requests + 4 个索引（含 pending 唯一约束）
//   2) ALTER TABLE servers ADD COLUMN binding_requests_enabled INTEGER NOT NULL DEFAULT 1
// down:
//   1) ALTER TABLE servers DROP COLUMN binding_requests_enabled（SQLite 较旧版本不支持 DROP COLUMN，需重建表）
//   2) DROP TABLE binding_requests
```

按 rules `1.md`："版本更新时要注意数据库字段，字段的变更，需要做迁移脚本的前置处理，方便热更新。"

**注**：SQLite 3.35+ 支持 `ALTER TABLE ... DROP COLUMN`，本项目 SQLite 版本需确认（若 < 3.35 则 down 函数需用"建新表 + 拷贝 + 删旧表 + 重命名"模式重建 servers 表）。

---

## 7. 版本号规划

当前版本：`4.37.1`（CDK 改造 v4.37.0 + 后续小修复已发布）
目标版本：`4.38.0`（中版本号 +1，因属"全新功能增加"）

按 `bb.md` + project_memory 规则，需同步更新 12 个版本源：
- 4 个 `version.json`（根 / panel/frontend / panel/backend / daemon）
- 4 个 `package.json`（同上）
- `deploy.sh`
- `version.md`
- `README.md`
- daemon `DAEMON_VERSION`

BUILD_ID 格式：`20260730-XXX`（按部署批次递增）

**注**：v4.37.0 已被 CDK 改造占用（migration `20260901000000_add_cdk_reusable.ts`），本次 migration 用 `20260901000001_add_binding_requests.ts` 避开时间戳冲突。

---

## 8. 验收点

### 8.1 后端验收

- [ ] `tsc --noEmit` 退出码 0
- [ ] `npm run test`（vitest）全通过，新增 bindingRequests 路由的单测覆盖：
  - 申请创建（公开实例拒绝 / 已绑定拒绝 / 重复 pending 拒绝 / 正常创建成功）
  - 审批通过（事务：binding_requests 更新 + bindings 创建 + 已 revoked 复活）
  - 审批拒绝（只更新 status）
  - 撤销申请（仅本人 + 仅 pending）
  - 权限校验（owner/instance_admin 可审批，其他人 403）
- [ ] `GET /api/servers/bindable` 返回 is_public=1 + owner=userId 的实例，附带 4 个 boolean 字段
- [ ] `PUT /api/admin/servers/:id/visibility` 用 owner/instance_admin 身份调用成功（200），用其他 user 调用 403

### 8.2 前端验收

- [ ] `tsc --noEmit` 退出码 0
- [ ] `vite build` 成功，`dist/` 无 `localhost:3000` / `127.0.0.1:3000`（按 0.md 最高规则）
- [ ] 浏览器核对（内置浏览器工具，非 Playwright）：
  - `/guild/servers` 显示市场列表，含公开实例 + 自己创建的实例
  - 公开实例卡片显示"立即绑定"，点击后秒级绑定成功
  - 私有实例（通过 URL 访问详情页）显示"申请绑定"按钮，提交后显示"审核中"
  - Tab 切换"我的绑定" → 只显示已绑定实例
  - 服主在 ServerDetail 看到"绑定申请"Tab，可审批通过/拒绝
  - `/guild/my-binding-requests` 显示用户自己的申请列表，pending 可撤销
- [ ] Mock 模式回归（s0402 第三闸门）：`gp-*` 样式无破坏，移动端底部 5 tab 不溢出

### 8.3 契约校验

- [ ] `public/schema/panel-api-types.ts` 新增类型通过 zod schema 校验
- [ ] 后端响应严格匹配契约签名
- [ ] 前端 `validateResponse` 双轨校验通过

### 8.4 部署前检查（按 0.md §五）

- [ ] `grep -r "localhost:3000" panel/frontend/dist/` 无匹配
- [ ] `grep -r "127.0.0.1:3000" panel/frontend/dist/` 无匹配
- [ ] `.env.production` 无 localhost
- [ ] `check:version` 12 个版本源全部 `4.38.0`
- [ ] systemd 服务 `Restart=always` + `WorkingDirectory=/opt/gameserver-panel/`（按 rules-0 §3.1.2）

---

## 9. 实施顺序与依赖

按 rules-0 §四-4 串并行策略，本任务因属单链路改造，主线程内联执行（不调度 subagent）。

| 步骤 | 内容 | 依赖 | 备注 |
|------|------|------|------|
| 1 | 契约变更：`panel-api-types.ts` 新增类型 | 无 | 前后端共用基础 |
| 2 | 迁移脚本：建 `binding_requests` 表 + `servers` 加 `binding_requests_enabled` 字段 | 无 | 热更新前置 |
| 3 | 后端：新增 `bindingRequests.ts` 路由 + service | 1, 2 | 6 个端点，approve 用 vip_level=0 |
| 4 | 后端：新增 `GET /api/servers/bindable` 端点 | 1 | 在 servers.ts 加 |
| 5 | 后端：下放 visibility 权限（新增 `requireInstanceOwnerOrAdminOrServerAdmin` 中间件） | 无 | 改 discover.ts 挂载 |
| 6 | 后端：新增 `PUT /api/servers/:id/binding-requests-settings` 端点 | 2, 5 | 申请开关 |
| 7 | 后端：`GET /api/servers/:id` 403 响应加 `can_request_binding` + `binding_requests_enabled` | 1 | 改 servers.ts |
| 8 | 后端：`routes-registry.ts` 挂载新路由 | 3, 6 | |
| 9 | 后端单测 + tsc | 3-8 | |
| 10 | 前端：`client.ts` 新增 API 封装（含 setBindingRequestsSettings） | 1 | |
| 11 | 前端：重做 `GuildServers.tsx` | 10 | 核心页面，含 6 种卡片状态 |
| 12 | 前端：修 `GuildBind.tsx` 可绑定列表数据源 | 10 | 修原 bug |
| 13 | 前端：改 `ServerDetailGuild.tsx` 403 流程 | 10 | |
| 14 | 前端：新增 `GuildMyBindingRequests.tsx` | 10 | |
| 15 | 前端：改 `ServerDetail.tsx` 管理端加"绑定申请"Tab + 申请开关 | 10 | |
| 16 | 前端：`App.tsx` 注册新路由 | 14 | |
| 17 | 前端：tsc + vite build + 浏览器核对 + Mock 回归 | 11-16 | s0402 三重闸门 |
| 17 | 版本号同步：12 源 + version.md + README.md | 全部 | v4.38.0 |
| 18 | 部署 + 运行时验证 | 17 | |

---

## 10. 风险与回退

### 10.1 风险点

- **R1 审批通过事务一致性**：approve 操作需同时更新 binding_requests + 创建 bindings，必须用 Knex 事务包裹，失败回滚。复用 `instanceBindingService.bindInstance()` 的复活逻辑时注意事务嵌套。
- **R2 pending 唯一约束竞态**：高并发下用户可能重复提交申请。靠数据库唯一索引 `idx_binding_requests_pending_unique` 兜底，service 层 try-catch 唯一约束冲突错误转 `BINDING_REQUEST_ALREADY_PENDING`。
- **R3 visibility 权限下放安全性**：owner/instance_admin 能上架/下架自己的实例，但不能影响他人实例。中间件需先查 server.owner_user_id 或 instance_admins 关联，校验通过才放行。
- **R4 /guild/servers 重做对老用户的认知冲击**：原页面叫"我的服务器"，重做后变成"游戏市场"。需保留"我的绑定"Tab 让老用户能快速找到自己的实例。
- **R5 私有实例通过 URL 访问的申请路径**：用户如何拿到私有实例的 URL？现实路径是服主私下分享链接。产品上不主动暴露私有实例列表，但支持 URL 直达申请。

### 10.2 回退锚点

- 数据库 migration `20260901000000_add_binding_requests.ts` 提供 down 函数（DROP TABLE）
- 后端路由挂载可独立回滚（注释掉 `routes-registry.ts` 中的挂载行）
- 前端页面改造保留 git 历史，可 revert

---

## 11. 待用户确认项

### 已确认（用户审阅反馈）

1. ✅ **审批通过后自动创建 binding（vip_level=0）**，无需用户再次点击确认
2. ✅ **申请机制可开关** —— 服主可开启/关闭自己实例的"申请绑定"功能（默认开启，关闭后私有实例不接受新申请）
3. ✅ 申请留言 `message` 选填
4. ✅ 同一用户对同一实例审批被拒后，可以再次申请（仅 pending 状态阻止重复）
5. ✅ 审批通过的申请不允许服主撤销（如需撤销走 bindings 解绑流程）
6. ✅ `/guild/my-binding-requests` 入口放在用户菜单（个人设置 → 我的绑定申请）

### 仍需确认（编码前最后一轮）

7. ✅ **直接绑定与审批通过的 vip_level 统一为 1** —— 用户确认选项 A：审批通过直接复用 `instanceBindingService.bindInstance()`，vip_level=1，无需新增参数覆盖。所有决策点已收敛，可开始编码。

---

## 12. 文档同步要求

按 rules-0 §一-1 锚点文件双向同步：

- 编码完成后更新 `current-note.md` 七字段交接状态
- 版本发布后更新 `version.md`（v4.37.0 条目）+ `README.md`（重大功能新增）
- 前端页面梳理文档 `docs/frontend/pages/guild-servers.md` 同步更新为新市场结构
- 新增 `docs/frontend/pages/guild-my-binding-requests.md`
- `docs/frontend/pages/guild-bind.md` 更新"可绑定实例"数据源说明
