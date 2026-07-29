---
type: plan
title: 用户批量管理与分析工具方案
date: 2026-07-26
status: pending
related:
  - panel/frontend/src/pages/admin/Users.tsx
  - panel/frontend/src/api/modules/admin.ts
  - panel/frontend/src/api/client.ts
  - panel/backend/src/api/routes/users.ts
  - panel/backend/src/services/userService.ts
  - panel/backend/src/routes-registry.ts
  - public/schema/panel-api-types.ts
  - public/interface_stub/user-service.d.ts
  - .trae/rules/0.md
  - .trae/rules/bb.md
  - .trae/rules/rules-0.md
tags: [user-management, batch-operation, analytics, admin, react, express, knex]
---

# 用户批量管理与分析工具方案

## 一、问题现状

生产入口 `https://gsp.ecsrz.com:3001/admin/users` 当前用户管理页：

- 前端：[panel/frontend/src/pages/admin/Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx)
- 后端：[panel/backend/src/api/routes/users.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts)
- 服务：[panel/backend/src/services/userService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/userService.ts)

**当前能力**：单条用户编辑（角色/状态/显示名）、单条新建、单条软删除、按 email/用户名搜索。

**用户痛点**：当注册用户数量较多时，逐条编辑效率低下；缺少批量启用/禁用、批量改角色、批量删除能力；缺少整体分析视图（用户总量、活跃/禁用/删除分布、角色分布、近期注册趋势），管理员无法快速洞察用户结构。

## 二、目标

1. **批量操作**：支持多选用户后一键执行 启用 / 禁用 / 删除（软删除）/ 改角色 四类操作。
2. **启用/禁用**：作为独立按钮显式暴露（用户原始诉求），同时纳入批量操作。
3. **分析视图**：在用户列表上方提供统计概览卡片（总数 / 活跃 / 禁用 / 删除 / 各角色数 / 最近 7/30 天注册与登录），帮助管理员快速判断用户结构健康度。
4. **结果反馈**：批量操作完成后展示成功/失败明细，支持逐条查看失败原因。
5. **安全约束**：
   - 仅 `server_admin` 可调用（沿用 `/api/users` 挂载点的 `requireAdmin` 中间件）。
   - 不可批量操作自己（防止自删/自禁）。
   - 不可批量删除最后一个 `server_admin`（沿用 `countActiveServerAdmins` 自检）。
   - 不可批量操作系统内置账号（`is_built_in=1`）的密码，但允许启用/禁用/删除（演示账号除外，须额外保护）。
   - 批量上限 100 个用户/次（防滥用 + 控制 SQL 事务时长）。
6. **审计**：每次批量操作记一条 `user.batch_*` audit log，包含 operatorId、action、target_ids、succeeded/failed 计数。
7. **契约更新**：在 `public/schema/panel-api-types.ts` 已新增 `BatchUserAction / BatchUserOperationRequest / BatchUserOperationResult / BatchUserOperationResponse`（上次会话已落地）；本方案再补充 `UserStatsResponse`。

## 三、技术方案

### 3.1 后端契约（panel-api-types.ts）

已存在（v4.22.9 已落地，无须再改）：

```typescript
export type BatchUserAction = 'enable' | 'disable' | 'delete' | 'set_role';
export interface BatchUserOperationRequest {
  user_ids: string[];
  action: BatchUserAction;
  role?: UserRole; // action='set_role' 时必填
}
export interface BatchUserOperationResult {
  user_id: string;
  ok: boolean;
  error?: string;
}
export interface BatchUserOperationResponse {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchUserOperationResult[];
}
```

新增（本方案）：

```typescript
// GET /api/users/stats（仅 server_admin，用户分析统计）
export interface UserStatsResponse {
  /** 总用户数（含 deleted 软删除） */
  total: number;
  /** 各状态计数 */
  by_status: { active: number; disabled: number; deleted: number };
  /** 各角色计数（基于 active_role，仅统计 status !== 'deleted' 的用户） */
  by_role: Record<UserRole, number>;
  /** 最近 7 天注册数 */
  registered_last_7d: number;
  /** 最近 30 天注册数 */
  registered_last_30d: number;
  /** 最近 7 天活跃登录数 */
  active_last_7d: number;
  /** 最近 30 天活跃登录数 */
  active_last_30d: number;
  /** 系统内置账号数 */
  built_in_count: number;
}
```

### 3.2 后端路由（users.ts）

新增两个端点，**必须挂在 `router.get('/:id')` 之前**（避免字面量 `stats` 被识别为 `:id`）：

1. **`GET /api/users/stats`** → 返回 `UserStatsResponse`
2. **`POST /api/users/batch`** → 接收 `BatchUserOperationRequest`，返回 `BatchUserOperationResponse`

**路由顺序（关键）**：

```typescript
router.get('/', ...);           // 列表
router.get('/stats', ...);      // ← 新增：必须在 /:id 之前
router.post('/batch', ...);     // ← 新增：批量操作（POST 不与 /:id/role 冲突）
router.get('/:id', ...);        // 用户详情
router.patch('/:id', ...);      // 更新
router.post('/', ...);          // 创建
router.patch('/:id/role', ...); // 改角色
router.get('/:id/roles', ...);  // 查角色集合
router.put('/:id/roles', ...);  // 改角色集合
router.post('/:id/revoke-tokens', ...); // 强制下线
router.delete('/:id', ...);     // 软删除
```

### 3.3 后端服务（userService.ts）

新增 4 个方法，**接受外部事务**以便路由层包裹原子事务：

```typescript
// user-service.d.ts 新增（v1.5.0）
export interface UserService {
  // ... 原有方法

  /** 批量更新用户状态（启用/禁用），不抛 NotFound，单条失败记入 results */
  batchUpdateStatus(
    trx: Knex.Transaction,
    userIds: string[],
    status: 'active' | 'disabled',
  ): Promise<BatchUserOperationResult[]>;

  /** 批量软删除，单条失败记入 results；保护最后一个 server_admin */
  batchSoftDelete(
    trx: Knex.Transaction,
    userIds: string[],
    operatorId: string,
  ): Promise<BatchUserOperationResult[]>;

  /** 批量设置角色（仅 set active_role + roles=[role]），单条失败记入 results */
  batchSetRole(
    trx: Knex.Transaction,
    userIds: string[],
    role: UserRole,
  ): Promise<BatchUserOperationResult[]>;

  /** 用户分析统计（只读） */
  getUserStats(): Promise<UserStatsResponse>;
}
```

**事务策略**：
- 路由层 `await db.transaction(async (trx) => { ... })` 包裹整个批量操作
- 单条失败不回滚整批（业务诉求：尽量完成有效操作），但事务仍保证 SQL 层面原子性（例如批量 UPDATE 一次执行）
- `results` 数组详细记录每条 ok / error

**保护逻辑**：
- `operatorId` 在 `user_ids` 中 → 该条返回 `{ ok: false, error: '不能操作自己' }`
- `is_built_in=1` → 该条返回 `{ ok: false, error: '系统内置账号不可批量操作' }`
- `action='delete'` 且目标含 `server_admin` → 调用 `countActiveServerAdmins` 排除后剩余 0 时，对该条返回 `{ ok: false, error: '不能删除最后一个 server_admin' }`

### 3.4 前端 API（admin.ts + client.ts）

```typescript
// admin.ts 新增
export interface AdminApi {
  // ... 原有
  /** v4.24.0: 批量操作用户 */
  batchOperateUsers(req: BatchUserOperationRequest): Promise<BatchUserOperationResponse>;
  /** v4.24.0: 用户分析统计 */
  getUserStats(): Promise<UserStatsResponse>;
}
```

```typescript
// client.ts 新增
batchOperateUsers(req) {
  return request<BatchUserOperationResponse>('/users/batch', {
    method: 'POST',
    body: JSON.stringify(req),
  });
},
getUserStats() {
  return request<UserStatsResponse>('/users/stats');
},
```

### 3.5 前端 UI（Users.tsx）

**新增 UI 区域**（从上到下）：

1. **分析概览卡片**（`info-card` 样式）：
   - 4 个统计 chip：总用户 / 活跃 / 禁用 / 已删除
   - 3 个角色 chip：系统管理员 / 实例管理员 / 普通用户
   - 4 个趋势 chip：近 7 天注册 / 近 30 天注册 / 近 7 天活跃 / 近 30 天活跃
   - 内置账号 chip
   - 卡片挂载时调用 `api.getUserStats()`，与 `refresh()` 并行
2. **批量操作工具栏**（仅当 `selectedIds.size > 0` 时显示，固定在表格上方 sticky）：
   - 显示「已选 N 项」
   - 按钮：启用 / 禁用 / 改角色（下拉选择）/ 删除 / 取消选择
   - 改角色下拉包含 3 个角色选项
3. **表格头新增全选复选框**（`<th><input type="checkbox" /></th>`）
4. **表格行新增单选复选框**（`<td><input type="checkbox" /></td>`）：
   - 已删除行不可选（避免重复删除）
   - 系统内置行不可选（避免误操作）
   - 当前行是当前登录用户时，复选框禁用（避免自操作）
5. **移动端卡片**也新增复选框（在 `mc-item-header` 左侧）
6. **批量结果 modal**：
   - 显示「成功 X 条 / 失败 Y 条」
   - 失败明细列表（user_id + error）
   - 关闭按钮 → 自动 refresh 列表 + stats

**状态新增**：

```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [batchBusy, setBatchBusy] = useState(false);
const [batchResult, setBatchResult] = useState<BatchUserOperationResponse | null>(null);
const [batchRoleOpen, setBatchRoleOpen] = useState(false);
const [batchRoleValue, setBatchRoleValue] = useState<UserRole>('user');
const [stats, setStats] = useState<UserStatsResponse | null>(null);
const [statsLoading, setStatsLoading] = useState(true);
```

**批量操作执行流程**：

```
用户点「批量启用」→ setBatchBusy(true) → api.batchOperateUsers({ user_ids, action: 'enable' })
  → 拿到 response → setBatchResult(response) → 清空 selectedIds
  → refresh() + refreshStats() → setBatchBusy(false)
```

删除操作额外加确认 modal（沿用现有 deletingId 模式扩展为 `batchDeleteConfirm`）。

### 3.6 样式（styles.css）

复用现有 `.info-card / .badge / .btn / .modal` 体系，仅新增：
- `.batch-toolbar`：sticky 顶部条，flex 布局，浅蓝背景
- `.stats-grid`：grid 布局展示 chip
- `.batch-result-list`：失败明细滚动列表（max-height 320px）

颜色严格遵循 Apple 浅色系（`#007AFF / #F5F5F7 / #FBFBFD`），禁用杀马特电竞色。

### 3.7 审计日志

每次批量操作写一条 audit log：

```typescript
auditLogService.create({
  user_id: operatorId,
  action: `user.batch_${action}`, // user.batch_enable / user.batch_disable / user.batch_delete / user.batch_set_role
  target_type: 'user',
  target_id: 'batch',
  details: {
    target_count: user_ids.length,
    succeeded,
    failed,
    role: action === 'set_role' ? role : undefined,
    failed_reasons: results.filter(r => !r.ok).map(r => ({ user_id: r.user_id, error: r.error })),
  },
  ip_address: req.ip ?? null,
});
```

## 四、执行步骤

1. **方案文档落地**（本文档）。
2. **后端契约补全**：在 `public/schema/panel-api-types.ts` 新增 `UserStatsResponse`（BatchUser* 已存在）。
3. **后端服务层**：在 `userService.ts` 实现 `batchUpdateStatus / batchSoftDelete / batchSetRole / getUserStats`，并在 `user-service.d.ts` 补充签名（v1.5.0）。
4. **后端路由层**：在 `users.ts` 新增 `GET /stats` + `POST /batch`，注意在 `/:id` 之前注册。
5. **前端 API 层**：在 `admin.ts` 接口 + `client.ts` 实现新增两个方法。
6. **前端 UI**：在 `Users.tsx` 添加分析卡片、批量工具栏、复选框、结果 modal、样式。
7. **构建验证**：
   - 后端 `npm run verify`（tsc + 现有测试）
   - 前端 `npm run build` + `npm run verify`
   - grep 检查 `localhost:3000 / 127.0.0.1:3000` 不出现在 dist/
8. **部署**：按 `.trae/rules/deploy.md` 流程，关闭现有部署 → rsync 同步 → 启动 → 验证 BUILD 与 systemctl status。
9. **版本号更新**：`version.json` 主版本 4.23.7 → 4.24.0；`panel_backend` 4.22.8 → 4.24.0；`panel_frontend` 4.23.4 → 4.24.0；同步更新 `version.md` 顶部条目与 `panel/frontend/package.json` / `panel/backend/package.json`。
10. **运行时接入校验**：grep `router.use.*users` 确认路由已挂载；前端 `api.getUserStats` / `api.batchOperateUsers` 被 `Users.tsx` 引用。

## 五、开发事项

### 5.1 后端开发

- `panel/backend/src/services/userService.ts`：新增 4 个方法；`batchSoftDelete` 内部循环调用既有 `softDeleteUser` 等价逻辑（事务感知版本：直接用 `trx` 而非 `this.db`）；`getUserStats` 用单条 SQL 聚合（`SELECT status, COUNT(*) ... GROUP BY status`）+ 单独查询角色分布。
- `panel/backend/src/api/routes/users.ts`：新增 2 个路由；`POST /batch` 内部包 `db.transaction`；保护逻辑：operatorId 命中、is_built_in=1 命中、最后一个 server_admin 命中。
- `public/interface_stub/user-service.d.ts`：版本升 1.5.0，追加 4 个方法签名。

### 5.2 前端开发

- `panel/frontend/src/api/modules/admin.ts`：AdminApi 接口加 2 个方法。
- `panel/frontend/src/api/client.ts`：实现 2 个方法。
- `panel/frontend/src/pages/admin/Users.tsx`：核心 UI 改造（最大工作量）。
- `panel/frontend/src/styles.css`：新增 `.batch-toolbar / .stats-grid / .batch-result-list`。

### 5.3 数据库

- **无须迁移**：本次不新增表、不新增字段，仅读 / 写既有 `users` 表。`is_built_in` / `active_role` / `roles` / `status` / `last_login_at` / `created_at` 字段均已存在。
- 批量操作通过 knex 事务保证原子性。

### 5.4 测试建议

- 后端单测：在 `users.roles.test.ts` 旁新增 `users.batch.test.ts`，覆盖：
  - 批量启用 3 个 disabled 用户 → 全部成功
  - 批量删除包含自己 → 自己那条失败，其他成功
  - 批量删除最后一个 server_admin → 该条失败
  - 批量改角色非法 role → 400
  - 超过 100 个 user_ids → 400
  - GET /stats 返回字段完整
- 前端：手动验证（生产 / 演示账号），重点检查复选框状态、批量工具栏显隐、结果 modal 展示。

## 六、建议

1. **批量上限**：建议硬限制 100 个用户/次，前端 UI 在选中超过 100 时给出提示并禁用操作按钮。
2. **改角色下拉**：建议用 `<select>` 而非弹窗，减少交互层级；选中目标角色后直接触发批量操作（带二次确认）。
3. **删除二次确认**：批量删除是高风险操作，必须弹 modal 显示「将软删除 N 个用户，不可恢复」+ 列出前 5 个用户名预览。
4. **结果 modal 关闭策略**：关闭后自动 refresh 列表与 stats，避免数据不一致。
5. **分析卡片刷新**：每次 `refresh()` 同时刷新 stats；批量操作完成关闭结果 modal 时也刷新。
6. **空态处理**：当 `users.length === 0` 时，分析卡片显示 0 而非隐藏，让管理员看到结构。
7. **移动端适配**：批量工具栏在移动端转为底部固定 bar（`position: fixed; bottom: 0`），复选框改为圆形 checkbox。
8. **审计可追溯**：批量操作 audit log 的 `target_id` 用 `'batch'` 字面量，`details.failed_reasons` 完整记录失败明细，便于事后排查。
9. **权限收敛**：`instance_admin` 当前不能访问 `/api/users/*`（已由 `requireAdmin=Role.SERVER_ADMIN` 拦截），本次新增端点沿用同一中间件，无须额外配置。
10. **版本号策略**：本方案属于「全新功能增加」，按 `.trae/rules/bb.md` 规则中版本号+1，小版本归零；同步更新 `version.md` 顶部条目，避免与 `version.json` 长期不同步。

## 七、回退方案

- 后端路由新增不影响既有端点，可直接删除 `GET /stats` + `POST /batch` 两段代码回退。
- 前端 UI 改造若引入问题，可临时隐藏「批量工具栏」与「分析卡片」两个区域，恢复单条编辑流程。
- 数据库无须回退（无 schema 变更）。
- 版本号若部署后发现严重 bug，可发布 4.24.1 修复版本（按规则：bug 修复+小版本号）。

## 八、验收标准

1. `/admin/users` 页面顶部展示分析卡片，7 个 chip 数据正确（与 DB 实际值一致）。
2. 表格头与每行带复选框，可多选；点击全选可一键选中所有可选行。
3. 选中 ≥1 项时，批量工具栏出现，显示「已选 N 项」+ 4 个操作按钮。
4. 点击「启用」→ 选中行 status 全部变为 `active`，结果 modal 显示成功数。
5. 点击「禁用」→ 选中行 status 全部变为 `disabled`。
6. 点击「改角色」→ 下拉选择目标角色后确认，选中行 active_role 改变。
7. 点击「删除」→ 弹确认 modal，确认后选中行 status 变为 `deleted`。
8. 选中自己时复选框禁用；选中系统内置账号时复选框禁用。
9. 选中超过 100 项时，操作按钮禁用并提示「单次最多 100 项」。
10. 操作完成后结果 modal 显示成功/失败明细；关闭后列表与 stats 自动刷新。
11. `curl https://gsp.ecsrz.com:3001/api/users/stats`（带 admin token）返回完整 stats JSON。
12. `curl -X POST https://gsp.ecsrz.com:3001/api/users/batch` 返回 `BatchUserOperationResponse`。
13. 页面底部 BUILD 编号更新为新版本号对应日期。
