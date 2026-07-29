---
type: plan
title: 部署节点开放给实例管理员方案（落地 v4.28.0 自带节点字段 + 未开源提示 + 弹窗拉宽）
date: 2026-07-29
status: draft
related:
  - panel/frontend/src/pages/admin/Nodes.tsx
  - panel/frontend/src/components/Layout.tsx
  - panel/frontend/src/components/RequireRole.tsx
  - panel/frontend/src/components/ui/Modal.tsx
  - panel/frontend/src/utils/role.ts
  - panel/frontend/src/App.tsx
  - panel/frontend/src/api/client.ts
  - panel/backend/src/api/routes/nodes.ts
  - panel/backend/src/services/nodeService.ts
  - panel/backend/src/middleware/auth.ts
  - public/schema/nodes-schema.json
  - public/schema/panel-api-types.ts
  - public/schema/CHANGELOG.md
  - docs/plans/remote-node-deploy-plan-E.md
  - docs/plans/nodes-add-node-fix-plan.md
  - docs/plans/role-permission-economy-system-plan.md
  - docs/plans/instance-billing-rules-plan.md
  - .trae/rules/0.md
  - .trae/rules/1.md
  - .trae/rules/bb.md
tags: [nodes, instance-admin, self-hosted, v4.28.0, migration, ui, plan]
---

# 部署节点开放给实例管理员方案

> 本方案 = **落地 v4.28.0 已规划的自带节点契约字段** + **在 Nodes.tsx 给 instance_admin 开放入口** + **未开源提示** + **弹窗拉宽**。
>
> v4.28.0 的 `role-permission-economy-system-plan.md` 已在契约层（`public/schema/nodes-schema.json`）规划 `node_source` / `self_hosted_owner_id` / `approval_status` / `approved_by` / `approved_at` 5 个字段，但 **DB 迁移未落地、前端入口未开放**。本方案负责把契约落地为可执行功能。
>
> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 决策收口（已确认）

| 决策点 | 选择 | 说明 |
|---|---|---|
| 字段命名 | **复用 v4.28.0 契约字段**：`node_source` + `self_hosted_owner_id` + `approval_status` | 不新增 `owner_user_id`，避免与既有契约 `nodes-schema.json` 字段冲突 |
| server_admin 视角 | **看所有节点**（platform_managed + 所有 self_hosted） | server_admin 是平台管理员，可全局运维排查 |
| instance_admin 视角 | **看 `self_hosted_owner_id = 自己` 或 `node_source='platform_managed'`** | 含平台节点（platform_managed），但不能看其他 instance_admin 的 self_hosted 节点 |
| 部署入口按钮状态 | **禁用按钮 + 提示** | 「复制命令」「下载脚本」Tab 内按钮 disabled，hover 显示「节点部署暂未启用」；「手动步骤」Tab 仍可查看 |
| 弹窗拉宽尺寸 | **720px** | 桌面端阅读体验最佳，移动端仍自适应全屏 |
| 存量节点归属 | **node_source='platform_managed'，self_hosted_owner_id=NULL** | 与 v4.28.0 契约默认值一致（保守原则，避免漏计费） |
| 审核流程 | **未开源期间 approval_status='pending'，slave 永远不会注册成功**（部署按钮禁用）；开源后由 server_admin 审核接入 | 与 v4.28.0 §3.1.2 设计一致 |
| 版本号 | 建议升中版本号（人类最终决定） | 新功能 = 落地 v4.28.0 自带节点字段 + 开放 instance_admin 入口，按 bb.md 规则升中版本 |

---

## 1. 问题与需求

### 1.1 用户原始诉求

> 「部署节点」应该是实例管理员也可以的，部署的节点就是这个实例管理员的。点击部署的时候，有手动模式，由于代码比较长，应该拉宽一点。功能先设定在这里。这里做个提示，当前项目还未开源，部署脚本在私密仓库，节点部署暂不启用。但是依旧可以进入下一步看这些内容和实现机制。

### 1.2 当前现状盘点

| 维度 | 当前状态 | 文件定位 |
|---|---|---|
| 路由级守卫 | `<RequireRole allow={['server_admin', 'system_admin', 'admin']} />` 拦截 instance_admin | [App.tsx#L382-L417](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L382-L417) |
| 组件级守卫 | `isAdminRole(getEffectiveRole(user))` 不通过则 `<Navigate to="/forbidden" />` | [Nodes.tsx#L364-L366](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L364-L366) |
| 后端鉴权 | `requireAdmin = requireRole(Role.SERVER_ADMIN)`，instance_admin 调用 → 403 | [auth.ts#L684-L685](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/auth.ts#L684-L685) |
| **契约层（已规划）** | `nodes-schema.json` 已定义 `node_source` / `self_hosted_owner_id` / `approval_status` / `approved_by` / `approved_at` 5 字段 | [nodes-schema.json#L86-L115](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/nodes-schema.json#L86-L115) |
| **DB 迁移（未落地）** | baseline migration 中 nodes 表无上述 5 字段；migrations 目录无对应迁移脚本 | [20260808000000_baseline_v4_post_demo.ts#L77-L91](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260808000000_baseline_v4_post_demo.ts#L77-L91) |
| **CHANGELOG（已记录）** | `MINOR nodes-schema.json` 已记录字段规划 | [CHANGELOG.md#L22](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/CHANGELOG.md#L22) |
| 节点列表查询 | `listNodes()` 返回所有节点，未按角色/归属筛选 | [nodeService.ts#L480](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/nodeService.ts#L480) |
| 侧边栏导航 | 「部署节点」在 `ADMIN_GROUPS` 的「系统监控」分组，仅 admin variant 可见 | [Layout.tsx#L133-L140](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L133-L140) |
| Modal 宽度 | 全局 `.modal-card { max-width: 520px }`，手动步骤代码被压缩 | [styles.css#L1290-L1300](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/styles.css#L1290-L1300) |
| 部署引导 Tab | 已有「复制命令 / 下载脚本 / 手动步骤」三 Tab | [Nodes.tsx#L556-L575](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx#L556-L575) |
| 前端 API client | `api.listNodes()` 无参调用，未传 viewer 角色 | [client.ts#L573-L575](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L573-L575) |

### 1.3 与既有方案的关系

| 既有方案 | 关系 | 边界 |
|---|---|---|
| [role-permission-economy-system-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/role-permission-economy-system-plan.md) | **契约源头（v4.28.0）** | 该方案 §3.1 规划了 `node_source` / `self_hosted_owner_id` / `approval_status` 字段（决策 D4 自带节点完全免费 + 完全自主），并在 `nodes-schema.json` 落地契约，但 **DB 迁移与前端入口未落地**。本方案负责落地这部分 |
| [instance-billing-rules-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/instance-billing-rules-plan.md) | **计费侧引用方** | 该方案 §0.2「实例管理员自有实例与自带节点实例**免计费**」依赖 `node_source='self_hosted'` 字段判定。本方案落地该字段后，计费侧即可使用 |
| [remote-node-deploy-plan-E.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/remote-node-deploy-plan-E.md) | **基础底座** | 方案 E 是整体架构（master 零接触 SSH、邀请制 slave 自注册），已落地。本方案在 E 基础上扩展角色范围 |
| [nodes-add-node-fix-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/nodes-add-node-fix-plan.md) | **正交不冲突** | 该方案针对「添加节点」流程的 8 处 bug（脚本拼接、硬编码仓库、过期机制等），与本方案的「角色开放 + 字段落地」无重叠 |

---

## 2. 方案总览

### 2.1 核心改动

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. DB 迁移：nodes 表落地 v4.28.0 已规划的 5 字段                            │
│    (node_source / self_hosted_owner_id / approval_status /                │
│     approved_by / approved_at)                                            │
│ 2. 后端：createNodeInvite 写入 node_source='self_hosted' +                 │
│    self_hosted_owner_id + approval_status='pending'                       │
│ 3. 后端：listNodes 按角色筛选（server_admin 全量 /                         │
│    instance_admin 按 self_hosted_owner_id 或 node_source 筛选）            │
│ 4. 后端：requireAdmin → requireAnyRole(SERVER_ADMIN, INSTANCE_ADMIN)       │
│    + 节点归属校验中间件                                                    │
│ 5. 契约：panel-api-types.ts 同步 NodeInfo 增 5 字段（nodes-schema.json     │
│    已存在，仅同步 TS 类型）                                                │
│ 6. 前端路由守卫：allow 加入 instance_admin                                 │
│ 7. 前端组件守卫：isAdminRole → isInstanceAdminOrAbove                     │
│ 8. 前端 API client：listNodes 调用方无需改（viewer 信息由后端从 JWT 推导）  │
│ 9. 前端侧边栏：store variant 增加「部署节点」入口                          │
│ 10. 前端 Modal：新增 size prop（lg=720px）                                  │
│ 11. 前端未开源提示：顶部 banner + 部署按钮 disabled                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 角色权限矩阵

| 操作 | server_admin | instance_admin（自有 self_hosted 节点） | instance_admin（他人 self_hosted 节点） | instance_admin（platform_managed 节点） | user |
|---|---|---|---|---|---|
| 查看节点列表 | ✅ 全部 | ✅ 自有 + platform_managed | ❌ | ✅ 只读 | ❌ |
| 添加节点 | ✅（platform_managed） | ✅（self_hosted，归属自己） | — | — | ❌ |
| 重新生成邀请 | ✅ 任意 | ✅ 仅自有 | ❌ 403 | ❌ 403 | ❌ |
| 删除节点 | ✅ 任意 slave | ✅ 仅自有 slave | ❌ 403 | ❌ 403 | ❌ |
| Java 扫描 | ✅ 任意 | ✅ 仅自有 | ❌ 403 | ❌ 403 | ❌ |
| 下载部署脚本 | ⏸ 暂禁用 | ⏸ 暂禁用 | — | — | ❌ |
| 查看手动步骤 | ✅ | ✅ | — | — | ❌ |
| 审核节点接入 | ✅ | ❌ | — | — | ❌ |

> ⏸ = 按钮禁用但内容可见（未开源期间）
>
> 注：未开源期间 `approval_status='pending'` 的节点不会注册成功（部署按钮禁用），实际不会产生 self_hosted 节点。开源后 server_admin 审核流程由 v4.28.0 §3.1.2 设计承接。

---

## 3. 执行步骤

### 步骤 1：数据库迁移（前置）

**文件**：`panel/backend/src/db/migrations/20260729000000_add_self_hosted_fields_to_nodes.ts`（新建）

**改动**：落地 v4.28.0 已规划的 5 个字段：

```sql
ALTER TABLE nodes ADD COLUMN node_source VARCHAR(255) NOT NULL DEFAULT 'platform_managed';
ALTER TABLE nodes ADD COLUMN self_hosted_owner_id VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE nodes ADD COLUMN approval_status VARCHAR(255) NOT NULL DEFAULT 'approved';
ALTER TABLE nodes ADD COLUMN approved_by VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE nodes ADD COLUMN approved_at TEXT NULL DEFAULT NULL;
CREATE INDEX idx_nodes_self_hosted_owner_id ON nodes(self_hosted_owner_id);
CREATE INDEX idx_nodes_node_source ON nodes(node_source);
-- 外键约束（SQLite 延迟添加外键需重建表，本方案保守不加 FK，由应用层校验）
```

**存量节点处理**：
- `node_source` 默认 `'platform_managed'`（与 v4.28.0 §0.4「保守原则，避免漏计费」一致）
- `self_hosted_owner_id` 默认 `NULL`
- `approval_status` 默认 `'approved'`（platform_managed 节点无需审核）

**down 脚本**：删除索引与 5 个字段（SQLite 需重建表，参考既有迁移 `20260823000000_add_link_key_expires_at_to_nodes.ts` 的重建表模式）

**验证**：
- `sqlite3 data/panel.db ".schema nodes"` 确认 5 字段存在
- 现有 master 节点 `node_source='platform_managed'` / `self_hosted_owner_id=NULL` / `approval_status='approved'`
- 既有 `listNodes()` 在新字段下仍可运行（默认值兼容）

**回退锚点**：迁移失败 → 不进入步骤 2，回滚迁移脚本，保持 v4.x 现状

---

### 步骤 2：契约层同步（public/schema，无 schema 变更）

**文件**：`public/schema/panel-api-types.ts`

**改动**：
- `NodeClusterInfo` / `NodeInfo` TS 类型同步 5 字段（`nodes-schema.json` 已定义，仅同步到 TS 类型）：
  ```typescript
  node_source?: 'platform_managed' | 'self_hosted';
  self_hosted_owner_id?: string | null;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  ```
- `CreateNodeInviteRequest` 不变（owner 从 JWT 推导，node_source 由后端固定为 `self_hosted`）
- `CreateNodeInviteResponse` 不变（前端不需要回显 owner）

**契约版本**：
- `nodes-schema.json` **无变更**（v4.28.0 已规划，本方案仅落地）
- `panel-api-types.ts` 同步 TS 类型 = PATCH 级别（字段描述修正/补齐）
- 在 `public/schema/CHANGELOG.md` 追加：`PATCH panel-api-types.ts: NodeInfo 同步 nodes-schema.json 的 5 个 v-economy 字段到 TS 类型`

**⚠️ 注意**：`public/` 目录受 rules-0 §四-10 保护。本次改动属于「TS 类型同步既有 JSON Schema」性质，非新增/删除字段，但**实际编辑前需人类显式授权**或走 s0601 适配流程。

**验证**：
- `npm run contract:test` 通过
- zod schema 解析旧响应（无新字段）不报错（字段均为可选）

---

### 步骤 3：后端 service 层

**文件**：`panel/backend/src/services/nodeService.ts`

**改动点**：

#### 3.1 `createNodeInvite` 签名扩展

```typescript
// 现状：createNodeInvite(name, displayFqdn?)
// 改为：createNodeInvite(name, ownerUserId, ownerRole, displayFqdn?)
async createNodeInvite(
  name: string,
  ownerUserId: string,
  ownerRole: Role,
  displayFqdn?: string,
): Promise<CreateNodeInviteResponse> {
  // 根据角色设置 node_source：
  // - server_admin 创建 → node_source='platform_managed'（平台节点）
  // - instance_admin 创建 → node_source='self_hosted'（自带节点）
  const nodeSource = ownerRole === Role.SERVER_ADMIN ? 'platform_managed' : 'self_hosted';
  const selfHostedOwnerId = nodeSource === 'self_hosted' ? ownerUserId : null;
  const approvalStatus = nodeSource === 'self_hosted' ? 'pending' : 'approved';
  
  await this.db('nodes').insert({
    // ...既有字段
    node_source: nodeSource,
    self_hosted_owner_id: selfHostedOwnerId,
    approval_status: approvalStatus,
  });
}
```

#### 3.2 `listNodes` 按角色筛选

```typescript
// 新签名：listNodes(viewerRole, viewerUserId)
async listNodes(
  viewerRole: Role,
  viewerUserId: string,
): Promise<NodeInfo[]> {
  const query = this.db('nodes').select('*');
  
  if (viewerRole === Role.SERVER_ADMIN) {
    // server_admin 看全部
  } else {
    // instance_admin：自有 self_hosted + 所有 platform_managed
    query.where(function () {
      this.where('self_hosted_owner_id', viewerUserId)
          .orWhere('node_source', 'platform_managed');
    });
  }
  return await query.orderBy('linked_at', 'desc');
}
```

#### 3.3 `assertNodeOwnedByUser` 新增辅助方法

```typescript
/**
 * 校验节点归属：server_admin 全通过，instance_admin 需 self_hosted_owner_id 匹配
 * platform_managed 节点（平台节点）仅 server_admin 可操作
 */
async assertNodeOwnedByUser(
  nodeId: string,
  viewerRole: Role,
  viewerUserId: string,
): Promise<void> {
  if (viewerRole === Role.SERVER_ADMIN) return;
  const node = await this.db('nodes')
    .select('node_source', 'self_hosted_owner_id')
    .where({ id: nodeId })
    .first();
  if (!node) throw new AppError('NODE_NOT_FOUND', '节点不存在', 404);
  // platform_managed 节点不允许 instance_admin 操作
  if (node.node_source === 'platform_managed') {
    throw new AppError('NODE_NOT_OWNED', '平台节点仅系统管理员可操作', 403);
  }
  // self_hosted 节点：必须 owner 匹配
  if (node.self_hosted_owner_id !== viewerUserId) {
    throw new AppError('NODE_NOT_OWNED', '无权操作他人节点', 403);
  }
}
```

**验证**：
- `nodeService.test.ts` 新增用例：
  - createNodeInvite(server_admin) → node_source='platform_managed', self_hosted_owner_id=NULL, approval_status='approved'
  - createNodeInvite(instance_admin) → node_source='self_hosted', self_hosted_owner_id=user, approval_status='pending'
  - listNodes(server_admin) 返回全部
  - listNodes(instance_admin) 仅返回自有 self_hosted + 所有 platform_managed
  - assertNodeOwnedByUser 五分支（server_admin 通过 / 自有 self_hosted 通过 / 他人 self_hosted 403 / platform_managed 403 / 不存在 404）

---

### 步骤 4：后端路由层

**文件**：`panel/backend/src/api/routes/nodes.ts`

**改动点**：

#### 4.1 私有路由鉴权降级

```typescript
// 现状：所有私有路由都挂在 requireAdmin 之后
// 改为：requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN)
import { requireAnyRole } from '../../middleware/auth.js';
import { Role } from '../../core/auth/roles.js';

router.post('/', 
  requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
  handler.createInvite,
);
router.delete('/:id',
  requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
  assertNodeOwnership,  // 新增中间件
  handler.delete,
);
router.post('/:id/regenerate-invite',
  requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
  assertNodeOwnership,
  handler.regenerateInvite,
);
router.get('/:id/javas',
  requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
  assertNodeOwnership,
  handler.scanJavas,
);
router.get('/:id',
  requireAnyRole(Role.SERVER_ADMIN, Role.INSTANCE_ADMIN),
  assertNodeOwnership,  // 单个节点详情也需校验
  handler.getDetail,
);
```

#### 4.2 listNodes 路由传入 viewer 信息

```typescript
// GET / 现状：直接调 nodeService.listNodes()
// 改为：
router.get('/', async (req, res) => {
  const role = normalizeRole(req.activeRole ?? req.user?.role);
  const userId = req.user!.userId;
  const nodes = await nodeService.listNodes(role, userId);
  res.json({ nodes });
});
```

#### 4.3 ownership 中间件

```typescript
async function assertNodeOwnership(req: Request, res: Response, next: NextFunction) {
  const nodeId = req.params.id;
  const role = normalizeRole(req.activeRole ?? req.user?.role);
  const userId = req.user!.userId;
  try {
    await nodeService.assertNodeOwnedByUser(nodeId, role, userId);
    next();
  } catch (err) {
    next(err);
  }
}
```

**验证**：
- 路由层测试（若存在）新增用例：
  - instance_admin 创建节点成功
  - instance_admin 删除他人 self_hosted 节点 → 403 NODE_NOT_OWNED
  - instance_admin 删除 platform_managed 节点 → 403 NODE_NOT_OWNED
  - server_admin 删除任意节点成功
  - instance_admin GET /:id 他人节点 → 403

---

### 步骤 5：前端路由守卫

**文件**：`panel/frontend/src/App.tsx`

**改动**：

```tsx
// 现状（L382-L389）：
<Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin']} />}>
  <Route path="/admin" element={<AdminLayout />}>
    ...
    <Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin']} />}>
      ...
      <Route path="nodes" element={<Nodes />} />
    </Route>
  </Route>
</Route>

// 改为：将 nodes 单独拎出，放宽到 instance_admin
<Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin', 'instance_admin']} />}>
  <Route path="/admin" element={<AdminLayout />}>
    ...
    <Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin']} />}>
      {/* 其他 admin 子路由保持不变 */}
    </Route>
    {/* nodes 单独放行 instance_admin */}
    <Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin', 'instance_admin']} />}>
      <Route path="nodes" element={<Nodes />} />
    </Route>
  </Route>
</Route>
```

**注意**：`/admin` 基座守卫同步加入 `instance_admin`（选项 A）。其他 admin 子路由（users/system-config 等）仍保持 server_admin+ 守卫，instance_admin 访问其他会被 /forbidden 拦截。Layout 侧边栏按角色隐藏其他 admin 入口（既有逻辑）。

---

### 步骤 6：前端组件守卫与侧边栏

**文件**：
- `panel/frontend/src/pages/admin/Nodes.tsx`
- `panel/frontend/src/components/Layout.tsx`

#### 6.1 Nodes.tsx 组件守卫降级

```tsx
// 现状（L364-L366）：
if (!isAdminRole(getEffectiveRole(user))) {
  return <Navigate to="/forbidden" replace />;
}

// 改为：
if (!isInstanceAdminOrAbove(getEffectiveRole(user))) {
  return <Navigate to="/forbidden" replace />;
}
```

import 同步从 `'../../utils/role'` 加入 `isInstanceAdminOrAbove`。

#### 6.2 Layout.tsx 侧边栏入口

```tsx
// 现状：「部署节点」在 ADMIN_GROUPS 的「系统监控」分组，仅 admin variant 可见
// 改为：在 INSTANCE_ADMIN_LINKS 加入部署节点入口（store variant 可见）

const INSTANCE_ADMIN_LINKS: SidebarLink[] = [
  { to: '/store/servers', label: '我的实例', icon: Server },
  { to: '/store/commercial', label: '商城管理', icon: ShoppingBag },
  { to: '/store/instance-vip', label: 'VIP管理', icon: Crown },
  { to: '/store/operations', label: '运营仪表盘', icon: BarChart3 },
  // 新增
  { to: '/admin/nodes', label: '部署节点', icon: Server },
];
```

**注意**：`/admin/nodes` 跨基座（store variant 下访问 /admin 路径）。store variant 下点击「部署节点」会切到 admin Layout。**短期接受**，若用户反馈差再做 `/store/nodes` 双挂载。

#### 6.3 前端 API client

**文件**：`panel/frontend/src/api/client.ts`

**改动**：`listNodes()` 调用方**无需改动**——viewer 信息由后端从 JWT 推导，前端不传参。

```typescript
// 现状（L573-L575）：
async listNodes(): Promise<ListNodesResponse> {
  return this.get('/api/nodes');
}
// 保持不变
```

---

### 步骤 7：前端 Modal 拉宽

**文件**：
- `panel/frontend/src/components/ui/Modal.tsx`
- `panel/frontend/src/styles.css`

#### 7.1 Modal 新增 size prop

```tsx
interface ModalProps {
  // ...既有字段
  size?: 'sm' | 'md' | 'lg';  // 新增
}

export default function Modal({
  // ...
  size = 'md',
}: ModalProps) {
  // ...
  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        className={`modal-card modal-${size}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
      >
        {/* ... */}
      </div>
    </div>
  );
}
```

#### 7.2 CSS 样式

```css
/* styles.css 现有 .modal-card 保留 max-width: 520px 作为默认 */
.modal-card.modal-sm { max-width: 400px; }
.modal-card.modal-md { max-width: 520px; }  /* 默认 */
.modal-card.modal-lg { max-width: 720px; }  /* 新增 */

/* 移动端仍自适应全屏（既有规则覆盖） */
@media (max-width: 767px) {
  .modal-card.modal-sm,
  .modal-card.modal-md,
  .modal-card.modal-lg {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
```

#### 7.3 Nodes.tsx 使用 lg 尺寸

```tsx
<Modal
  open={addState.open}
  title={...}
  onClose={closeAddDialog}
  size="lg"  // 新增
  footer={...}
>
```

**验证**：
- 桌面端弹窗宽度 720px，手动步骤 `<pre>` 内 80 字符 shell 命令不换行
- 移动端仍全屏，无横向滚动

---

### 步骤 8：未开源提示横幅

**文件**：`panel/frontend/src/pages/admin/Nodes.tsx`

**改动点**：

#### 8.1 页面顶部 banner

```tsx
// 在 page-header 下方、table-wrap 之前插入
<div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
  <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
  <div>
    <strong>当前项目尚未开源</strong>
    <div style={{ marginTop: 4, fontSize: 12 }}>
      部署脚本托管在私密仓库，节点部署功能暂不启用。
      你仍可查看「手动步骤」了解部署机制，待项目开源后即可启用一键部署。
    </div>
  </div>
</div>
```

#### 8.2 部署按钮禁用

```tsx
// Tab 1「复制命令」与 Tab 2「下载脚本」内的按钮全部 disabled
<button
  className="btn btn-ghost btn-sm"
  disabled  // 新增
  title="节点部署暂未启用（项目未开源）"
>
  复制
</button>

<button
  className="btn btn-primary"
  disabled  // 新增
  title="节点部署暂未启用（项目未开源）"
>
  <Download size={14} />
  下载 slave-bootstrap.sh
</button>
```

#### 8.3 Tab 内容区顶部提示

```tsx
// 在「复制命令」「下载脚本」Tab 内容区顶部加一行小字提示
{addState.activeTab === 'command' && (
  <>
    <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 8 }}>
      ⚠ 此功能暂未启用（项目未开源）
    </div>
    {/* ...既有内容 */}
  </>
)}
```

#### 8.4 「添加节点」按钮保留可用

「添加节点」按钮（页面顶部）**保留可用**，允许生成邀请密钥（用户可看到完整的引导流程），但实际部署按钮禁用。让用户能完整体验流程，理解机制。

---

### 步骤 9：版本号登记

**文件**：
- `version.md`
- `public/schema/CHANGELOG.md`（追加 PATCH 记录）

**改动**：
- 按 bb.md 规则：新功能 → 升中版本号
- 假设当前版本 4.x.y，升为 4.(x+1).0
- `version.md` 追加版本说明：
  - 新增：部署节点开放给实例管理员（落地 v4.28.0 自带节点字段）
  - 新增：节点字段 node_source / self_hosted_owner_id / approval_status / approved_by / approved_at
  - 改进：添加节点弹窗拉宽到 720px
  - 提示：未开源期间部署按钮禁用
- `public/schema/CHANGELOG.md` 追加：`PATCH panel-api-types.ts: NodeInfo 同步 nodes-schema.json 的 5 个 v-economy 字段到 TS 类型`
- **README.md 不更新**（本方案未涉及文件结构调整）

---

## 4. 开发事项清单

| # | 事项 | 文件 | 性质 |
|---|---|---|---|
| 1 | DB 迁移脚本：nodes 表落地 v4.28.0 5 字段 | `panel/backend/src/db/migrations/20260729000000_add_self_hosted_fields_to_nodes.ts` | 新建 |
| 2 | 契约同步：panel-api-types.ts NodeInfo 增 5 字段 | `public/schema/panel-api-types.ts` | 编辑（受保护） |
| 3 | 契约 CHANGELOG 追加 PATCH 记录 | `public/schema/CHANGELOG.md` | 编辑（受保护） |
| 4 | nodeService：createNodeInvite 写入 node_source + self_hosted_owner_id + approval_status | `panel/backend/src/services/nodeService.ts` | 编辑 |
| 5 | nodeService：listNodes 按角色筛选 | `panel/backend/src/services/nodeService.ts` | 编辑 |
| 6 | nodeService：assertNodeOwnedByUser 新方法 | `panel/backend/src/services/nodeService.ts` | 编辑 |
| 7 | nodeService.test.ts：新增用例 | `panel/backend/src/services/nodeService.test.ts` | 编辑 |
| 8 | nodes 路由：requireAdmin → requireAnyRole | `panel/backend/src/api/routes/nodes.ts` | 编辑 |
| 9 | nodes 路由：ownership 中间件挂载（含 GET /:id） | `panel/backend/src/api/routes/nodes.ts` | 编辑 |
| 10 | 前端路由守卫：/admin 基座 + nodes 子路由放行 instance_admin | `panel/frontend/src/App.tsx` | 编辑 |
| 11 | Nodes.tsx 组件守卫：isAdminRole → isInstanceAdminOrAbove | `panel/frontend/src/pages/admin/Nodes.tsx` | 编辑 |
| 12 | Layout.tsx 侧边栏：store variant 加部署节点入口 | `panel/frontend/src/components/Layout.tsx` | 编辑 |
| 13 | Modal 组件：新增 size prop | `panel/frontend/src/components/ui/Modal.tsx` | 编辑 |
| 14 | styles.css：新增 modal-sm/md/lg 样式 | `panel/frontend/src/styles.css` | 编辑 |
| 15 | Nodes.tsx：Modal 使用 size="lg" | `panel/frontend/src/pages/admin/Nodes.tsx` | 编辑 |
| 16 | Nodes.tsx：未开源提示 banner | `panel/frontend/src/pages/admin/Nodes.tsx` | 编辑 |
| 17 | Nodes.tsx：部署按钮 disabled | `panel/frontend/src/pages/admin/Nodes.tsx` | 编辑 |
| 18 | version.md：版本号登记 | `version.md` | 编辑 |

---

## 5. 验证清单

### 5.1 单元测试

- [ ] `nodeService.test.ts`：createNodeInvite(server_admin) → platform_managed
- [ ] `nodeService.test.ts`：createNodeInvite(instance_admin) → self_hosted + owner + pending
- [ ] `nodeService.test.ts`：listNodes(server_admin) 返回全部
- [ ] `nodeService.test.ts`：listNodes(instance_admin) 仅返回自有 self_hosted + 所有 platform_managed
- [ ] `nodeService.test.ts`：assertNodeOwnedByUser 五分支（server_admin / 自有 / 他人 / platform_managed / 不存在）
- [ ] 路由层测试：instance_admin 创建/删除/重新邀请/Java 扫描权限

### 5.2 端到端测试

- [ ] instance_admin 登录 → 访问 `/admin/nodes` → 200 OK（不再跳 /forbidden）
- [ ] instance_admin 创建节点 → 节点列表显示 → node_source='self_hosted' / self_hosted_owner_id=当前用户 / approval_status='pending'
- [ ] instance_admin 删除他人 self_hosted 节点 → 403 NODE_NOT_OWNED
- [ ] instance_admin 删除 platform_managed 节点 → 403 NODE_NOT_OWNED
- [ ] instance_admin GET /api/nodes/:id 他人节点 → 403
- [ ] server_admin 访问 → 看到所有节点（含 platform_managed + 所有 self_hosted）
- [ ] user 角色访问 → 跳 /forbidden
- [ ] 弹窗桌面端宽度 720px
- [ ] 弹窗移动端全屏自适应
- [ ] 未开源 banner 显示
- [ ] 「复制命令」「下载脚本」按钮 disabled
- [ ] 「手动步骤」Tab 内容完整可查看

### 5.3 契约测试

- [ ] `npm run contract:test` 通过
- [ ] zod schema 解析旧响应（无新字段）不报错（字段均为可选）
- [ ] `public/schema/CHANGELOG.md` 有 PATCH 记录

### 5.4 运行时接入校验（rules-0 §四-13 孤岛判定）

- [ ] **路由注册**：`grep -rn "router.use\|app.use" panel/backend/src/routes-registry.ts` 确认 nodes 路由仍挂载
- [ ] **前端组件引用**：`grep -rn "from.*pages/admin/Nodes"` 确认 Nodes 组件被路由引用
- [ ] **API 调用链路**：`grep -rn "api.listNodes\|api.createNodeInvite\|api.deleteNode\|api.regenerateInvite\|api.scanNodeJavas"` 确认前端调用方仍存在
- [ ] **后端中间件引用**：`grep -rn "requireAnyRole.*SERVER_ADMIN.*INSTANCE_ADMIN"` 确认新鉴权中间件已挂载

### 5.5 构建产物检查（rules-0 §五）

- [ ] `grep -r "localhost:3000" panel/frontend/dist/` 无匹配
- [ ] `grep -r "127.0.0.1:3000" panel/frontend/dist/` 无匹配

---

## 6. 风险与建议

### 6.1 风险

| 风险 | 性质 | 缓解 |
|---|---|---|
| `/admin` 基座守卫放宽后，instance_admin 可见其他 admin 入口（点击后被 /forbidden 拦截） | 体验问题 | 在侧边栏按角色隐藏其他 admin 入口（Layout 已有角色判断逻辑） |
| 跨基座跳转（store → /admin/nodes）导致侧边栏切换 | 体验问题 | 短期接受；若用户反馈差，再做 `/store/nodes` 双挂载 |
| 存量 master 节点 node_source='platform_managed'，instance_admin 可见但不可操作 | 符合设计 | platform_managed 节点对所有 instance_admin 只读，仅 server_admin 可操作 |
| `public/schema/` 编辑受 rules-0 §四-10 保护 | 合规风险 | 实际编辑前需人类显式授权或走 s0601 流程 |
| 节点归属与既有 `instance_admins` 共管表（servers 表）概念易混淆 | 概念混淆 | 文档明确：节点归属用 `nodes.self_hosted_owner_id`；实例共管用 `instance_admins` 表，两者独立 |
| DB 迁移外键约束：SQLite 不支持 ALTER TABLE ADD FOREIGN KEY | 技术限制 | 本方案保守不加 FK，由应用层 `assertNodeOwnedByUser` 校验；如需 FK 约束需重建表 |
| 与 v4.28.0 字段命名冲突 | 已解决 | 本方案**复用** v4.28.0 已规划字段（`node_source` + `self_hosted_owner_id` + `approval_status`），不新增 `owner_user_id` |
| 向后兼容：旧前端访问新 API（含新字段） | 低风险 | 新字段均为可选，旧前端忽略即可；zod schema 兼容 |
| 审核流程未实现 | 已规划 | 本方案只落地字段（approval_status='pending' 默认值），审核 UI 由 v4.28.0 §3.1.2 后续承接 |

### 6.2 建议

1. **迁移脚本前置**：DB 字段变更必须先跑迁移脚本，再做代码改动。部署时关闭现有服务（rules-1）再跑迁移，避免热更新冲突。
2. **契约变更走 s0601**：`public/schema/panel-api-types.ts` 的修改虽属于 PATCH 级（TS 类型同步），但建议走 s0601 适配流程，由人类显式授权后再编辑。
3. **Modal size prop 通用化**：本次新增 `size` prop 后，其他弹窗（如 Settings、UserCenter）可按需复用，避免后续重复改造。
4. **未开源提示可配置**：建议把「未开源」提示做成配置项（`system_config` 表或环境变量），未来开源后一键关闭，避免硬编码到代码里需要改代码才能移除。
5. **版本号由人类决定**：本方案建议升中版本号，但具体版本号（如 4.x.0 → 4.(x+1).0）由人类决定，不在方案中固化。
6. **审核流程后续承接**：本方案仅落地字段与 instance_admin 入口，server_admin 审核节点接入的 UI（批准/拒绝）由 v4.28.0 §3.1.2 后续方案承接，不在本方案范围内。

---

## 7. 闭合判据

本方案视为闭合需满足：

- [ ] DB 迁移脚本已跑通，nodes 表存在 5 个 v-economy 字段
- [ ] 后端 nodeService 与路由层改造完成，单测全绿
- [ ] 前端路由守卫与组件守卫放宽到 instance_admin
- [ ] Modal size prop 实现并应用到 Nodes.tsx
- [ ] 未开源 banner 与按钮禁用生效
- [ ] instance_admin 端到端可访问、可创建、可删除自有节点
- [ ] server_admin 视角不受影响
- [ ] **运行时接入校验通过**（rules-0 §四-13）：路由注册 grep 通过、前端组件引用 grep 通过、API 调用链路 grep 通过
- [ ] `version.md` 已更新；`public/schema/CHANGELOG.md` 已追加 PATCH 记录
- [ ] 独立审查通过（GN-004）

---

## 8. 待人类裁决的开放问题

以下问题在方案中已给出推荐选项，但需人类最终确认：

1. **`/admin` 基座守卫是否同步放宽到 instance_admin？**
   - 推荐：是（选项 A），但其他 admin 子路由守卫保持 server_admin+
   - 影响：instance_admin 进入 `/admin` 后只能访问 `/admin/nodes`，其他被 /forbidden 拦截

2. **「部署节点」侧边栏入口是否在 store variant 下双挂载？**
   - 推荐：否，先用跨基座跳转（实现简单）
   - 影响：从 store variant 点击「部署节点」会切到 admin 侧边栏

3. **`public/schema/panel-api-types.ts` 的契约同步是否授权直接编辑？**
   - 推荐：人类显式授权后编辑，或走 s0601 适配流程
   - 影响：rules-0 §四-10 与 rules-4 §4.3 的 public/ 保护规则

4. **未开源提示是否做成可配置项？**
   - 推荐：是（写入 system_config 表），未来开源后一键关闭
   - 影响：增加少量开发工作量，但避免未来改代码才能移除提示

5. **版本号具体升到多少？**
   - 推荐：升中版本号，具体数值由人类决定

6. **是否在本方案中实现 server_admin 审核节点接入的 UI？**
   - 推荐：否，由 v4.28.0 §3.1.2 后续方案承接
   - 影响：本方案仅落地字段（approval_status='pending' 默认值），审核 UI 暂不实现
