# 管理员实例管理入口完善方案（v2 — 审查修订版）

> 背景：server_admin 角色缺少直观的实例管理入口，节点与实例之间关联不可见，无法直接修改实例有效期。本方案补齐以上缺口。
>
> 审查修订：v1 经独立审查发现 4 项阻断 + 6 项警示，本版已全部修复。

---

## 〇、契约变更前置审批

本方案涉及修改 `public/schema/panel-api-types.ts` 中的 `ServerSummary` 类型（新增 `node_name` 字段）。根据 rules-0 §四-10 和 rules-4 §4.3，`public/` 目录受保护，此修改须：

1. **走 s0601 契约变更流程**，不得直接编辑
2. **经人类显式授权**后方可执行
3. **契约版本记录**：属于 MINOR 变更（新增可选字段），须在 `panel-api-types.ts` 头部 `@version` 注释中追加版本记录，并按 rules-3 §六 通知依赖模块（不阻断）

**执行前置条件**：本方案获批后，方可执行 `public/schema/panel-api-types.ts` 的修改。

---

## 一、侧边栏结构调整

### 1.1 现状

当前侧边栏结构存在两个问题：

- `ADMIN_GROUPS`（仅 server_admin 可见）的「系统监控」分组包含 `/admin/nodes`
- `INSTANCE_ADMIN_LINKS`（instance_admin 可见）也包含 `/admin/nodes`（v4.28.0 开放）
- `/admin/servers` 路由已注册但侧边栏无入口

### 1.2 调整后

**ADMIN_GROUPS**（server_admin 专属）——将 `/admin/nodes` 从「系统监控」迁出，新建「部署节点」分组：

```diff
  {
    title: '系统监控',
    links: [
      { to: '/admin/system-health', label: '系统监控', icon: Activity },
-     { to: '/admin/nodes', label: '部署节点', icon: Server },
    ],
  },
+ {
+   title: '部署节点',
+   links: [
+     { to: '/admin/nodes', label: '节点管理', icon: Server },
+     { to: '/admin/servers', label: '实例管理', icon: Box },
+   ],
+ },
```

**INSTANCE_ADMIN_LINKS**——同步追加「实例管理」入口，确保 instance_admin 在 `/admin/nodes` 独立路由中也能看到实例管理入口：

```diff
  const INSTANCE_ADMIN_LINKS: SidebarLink[] = [
    { to: '/store/servers', label: '我的实例', icon: Server },
    { to: '/store/commercial', label: '商城管理', icon: ShoppingBag },
    { to: '/store/instance-vip', label: 'VIP管理', icon: Crown },
    { to: '/store/operations', label: '运营仪表盘', icon: BarChart3 },
    { to: '/admin/nodes', label: '部署节点', icon: Network },
+   { to: '/admin/servers', label: '实例管理', icon: Box },
  ];
```

**路由门控确认**：`/admin/servers` 当前在 `/admin` 基座下（server_admin+ 门控）。instance_admin 访问时走 `AdminLayout` 但只渲染 `INSTANCE_ADMIN_LINKS`（已有逻辑，Layout.tsx:1219-1227）。需确认 `/admin/servers` 路由对 instance_admin 开放——当前 App.tsx 中 `/admin/servers` 在 `RequireRole allow={['server_admin', 'system_admin', 'admin']}` 下，**需调整为包含 instance_admin**，或将其迁出 `/admin` 基座（参照 `/admin/nodes` v4.28.0 迁出模式）。

**涉及修改**：`Layout.tsx`（ADMIN_GROUPS、INSTANCE_ADMIN_LINKS、PATH_ACTIVE_MAP、getBreadcrumbs）、`App.tsx`（路由门控调整）。

---

## 二、后端改动

### 2.1 `GET /api/servers` 返回增加 `node_name`

**契约变更**（须先完成 §〇 审批）：

`public/schema/panel-api-types.ts` — `ServerSummary` 增加：

```typescript
/** 部署节点名称（JOIN nodes 表，孤儿节点为 null） */
node_name: string | null;
```

**后端同步修改**（3 处）：

1. **`ServerRowWithOwner` 接口**（servers.ts:87-93）— 追加 `node_name: string | null`
2. **`toSummary` 函数**（servers.ts:1482-1508）— 返回 `node_name: row.node_name ?? null`
3. **3 处查询**均须 LEFT JOIN nodes 并 select `nodes.name as node_name`：
   - `GET /`（servers.ts:160-163）— 列表查询
   - `POST /`（servers.ts:432-436）— 创建后返回
   - `GET /:id`（servers.ts:466-470）— 详情查询

```sql
SELECT servers.*, users.username AS owner_username, nodes.name AS node_name
FROM servers
LEFT JOIN users ON servers.owner_user_id = users.id
LEFT JOIN nodes ON servers.node_id = nodes.id
```

### 2.2 `PATCH /api/servers/:id` — 管理员修改实例有效期

新增端点，仅 `server_admin` 可调用。

**关键设计：委托 `instanceExpiryService`，不直接改 DB**

现有 `instanceExpiryService.setInstanceExpiry(serverId, durationDays)` 已封装了完整的状态机转换（permanent/active/grace/expired/cleaned），直接改 DB 会绕过状态机约束，与 cron 调度任务（INSTANCE_EXPIRY_SCAN 等）产生竞态。

| 请求参数 | 类型 | 说明 |
|---------|------|------|
| `duration_days` | `number \| null` | 天数（7/30/90/365/36500）。null=永久（expires_at=NULL, expiry_status='permanent'）；36500 视为永久 |

**实现流程**：

1. 鉴权：`requireAdmin`（仅 server_admin）
2. 校验实例存在
3. 调用 `instanceExpiryService.setInstanceExpiry(id, durationDays)` — 委托状态机
4. 写审计日志：`audit_logs`（action=`server.update_expiry`, target_type=`server`, target_id=id, details={old_expires_at, new_expires_at, old_status, new_status, operator_user_id}）
5. 返回更新后的 `ServerSummary`

**实现位置**：[servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts) — 新增 `router.patch('/:id', requireAdmin, ...)`

**Mock 同步**：复用 `setInstanceExpiry`，`public/pre_generated_mock/instance-expiry-mock.ts` 无需变更。

### 2.3 `GET /api/nodes/:id/instances` — 节点实例列表

返回某节点上的实例列表。

**权限设计**（统一术语）：

- **server_admin**：返回该节点全部实例，含 `owner_username`
- **instance_admin**：仅返回当前用户拥有的实例（`owner_user_id === self`）+ 被授予共管权限的实例（`instance_admins` 表关联），含 `owner_username`

响应类型（新增到 `panel-api-types.ts`，同样须走 §〇 契约变更流程）：

```typescript
interface NodeInstancesResponse {
  node_name: string;
  instances: ServerSummary[];
}
```

**实现位置**：[nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts) — 新增 `router.get('/:id/instances', authenticateToken, ...)`，复用 servers.ts 中的查询逻辑和 `toSummary` 函数。

---

## 三、前端改动

### 3.1 `Servers.tsx` — 实例列表增加「节点」列

- 表头新增「部署节点」列（显示 `server.node_name`）
- 工具栏新增节点筛选下拉框（从 `api.listNodes()` 获取节点列表）
- 已存在的「删除」按钮和「有效期」列保持不变
- **CSV 导出同步**：`handleExportCsv` 的表头数组新增「部署节点」列，数据行同步追加 `s.node_name ?? ''`
- **移动端卡片同步**：`mobile-only server-card-list` 的卡片字段新增节点名展示

设计原则：仅新增展示列，不改变现有交互逻辑。

### 3.2 `Nodes.tsx` — 节点卡片增加实例入口

每行节点增加「查看实例 (N)」按钮，点击后展开该节点下的实例列表（迷你表格/卡片）：

- 实例名 + 状态 + 游戏类型 + 归属者 + 有效期
- **权限区分**：server_admin 看到全部实例；instance_admin 仅看到自己拥有或共管的实例（后端已过滤）
- 数据来源：调用 `GET /api/nodes/:id/instances`

### 3.3 `ServerDetail.tsx` — 管理员有效期编辑

在详情页「有效期」信息行右侧增加编辑按钮（仅 `server_admin` 可见，通过 `isServerAdmin` 判断）：

- 点击后弹出轻量弹窗，提供：
  - 设为永久（`duration_days = null`）
  - 自定义到期日期（日期选择器 → 计算 `duration_days`）
  - 延长 N 天（快捷预设：7/30/90/365 天）
- 调用 `PATCH /api/servers/:id` 提交（参数为 `duration_days`）
- 提交后刷新详情

### 3.4 API Client 层

在 [servers.ts (API modules)](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/servers.ts) 中新增：

```typescript
/** 节点实例列表 */
listNodeInstances(nodeId: string): Promise<NodeInstancesResponse>;

/** 管理员修改实例有效期 */
updateServerExpiry(id: string, durationDays: number | null): Promise<ServerDetailResponse>;
```

### 3.5 React Query hooks

在 [queries/servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/queries/servers.ts) 中新增：

```typescript
useNodeInstances(nodeId: string)
useUpdateServerExpiry()
```

---

## 四、执行顺序

1. **契约审批**：人类授权 `public/schema/panel-api-types.ts` 修改（§〇）
2. **后端契约**：`ServerSummary` 加 `node_name` + 新增 `NodeInstancesResponse` 类型 + 版本注释
3. **后端**：`ServerRowWithOwner` + `toSummary` + 3 处查询 JOIN nodes
4. **后端**：`PATCH /api/servers/:id`（委托 instanceExpiryService + 审计日志）
5. **后端**：`GET /api/nodes/:id/instances`
6. **前端 API 层**：新增接口方法与 query hooks
7. **前端 Layout.tsx + App.tsx**：侧边栏结构调整 + 路由门控调整
8. **前端 Servers.tsx**：增加节点列 + 节点筛选 + CSV 同步 + 移动端卡片同步
9. **前端 Nodes.tsx**：节点下实例展开列表
10. **前端 ServerDetail.tsx**：管理员有效期编辑弹窗

---

## 五、测试要求

### 5.1 后端单元测试

- `PATCH /api/servers/:id` 鉴权测试：server_admin 通过，instance_admin/user 403
- `PATCH /api/servers/:id` 委托测试：验证调用 `instanceExpiryService.setInstanceExpiry`，不直接改 DB
- `PATCH /api/servers/:id` 审计日志测试：验证 `audit_logs` 表有对应记录
- `GET /api/nodes/:id/instances` 权限测试：server_admin 返回全部，instance_admin 仅返回拥有/共管的
- `GET /api/servers` 返回 `node_name` 字段验证

### 5.2 前端单元测试

- `Servers.test.tsx` 新增：节点列渲染、节点筛选下拉、CSV 导出含节点列
- `ServerDetail.test.tsx` 新增：管理员有效期编辑弹窗（仅 server_admin 可见）
- 移动端卡片渲染节点名

### 5.3 E2E / 集成测试

- 管理员修改有效期全流程：打开详情 → 编辑 → 提交 → 详情刷新显示新有效期
- 节点实例列表展开：点击节点 → 展开实例列表 → 验证实例归属区分

### 5.4 Mock 回归

- 验证 `instance-expiry-mock.ts` 的 `setInstanceExpiry` 在 `durationDays=null` 和具体天数两种路径下行为正确（现有 Mock 已覆盖，仅需回归验证）

---

## 六、建议

- 节点实例列表数据量可控（单节点通常不超过几十个实例），不需要额外分页
- `PATCH /api/servers/:id` 首次仅开放 `expires_at`（通过 `duration_days` 参数），后续可按需扩展（如迁移实例到其他节点）
- 有效期修改委托 `instanceExpiryService.setInstanceExpiry`，确保与 cron 调度任务状态机一致
- `INSTANCE_ADMIN_LINKS` 追加 `/admin/servers` 后，需确认 instance_admin 在实例列表页的操作权限范围（仅能操作自己拥有/共管的实例，不能操作他人的实例）
