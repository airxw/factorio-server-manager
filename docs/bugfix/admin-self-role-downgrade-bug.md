# Bug 修复方案：系统管理员可降级自己导致系统无管理员

> 类型：Bugfix 方案
> 触发来源：用户反馈（`/admin/users` 表格中系统管理员可把自己改为非系统管理员）
> 严重等级：高（运维事故级——可造成系统失去所有 server_admin，无法再管理面板）
> 版本基线：v4.29.9（2026-07-29）
> 文档日期：2026-07-29

---

## 一、问题复现与影响

### 1.1 现象

在 `https://gsp.ecsrz.com:3001/admin/users` 用户管理表格中：

- 系统管理员（如 `admin`、`airxw`）的「编辑」按钮可点击
- 编辑模式下，角色下拉可选「普通用户」/「实例管理员」
- 保存后该管理员立即被降级，且**无任何保护检查**
- 若该管理员是系统最后一个 server_admin，系统将彻底失去管理入口

### 1.2 用户原话

> 为什么系统管理员可以给自己修改成非系统管理员的权限？如果操作失误，岂不是没系统管理员了？

### 1.3 影响面

| 维度 | 影响 |
|------|------|
| 系统可用性 | 最后一个 server_admin 降级后，无人可管理用户/系统配置，需手动改数据库恢复 |
| 数据安全 | 不直接破坏数据，但管理通道丢失 |
| 触发难度 | 极低——一次误点击 + 一次保存即触发 |
| 现有保护 | 仅 `DELETE /api/users/:id` 有「不能删除自己 + 不能删除最后一个 server_admin」保护，**修改路径完全无保护** |

---

## 二、根因分析

### 2.1 后端：4 个修改端点全部缺失保护

文件：[panel/backend/src/api/routes/users.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts)

| 端点 | 行号 | 现状 | 风险 |
|------|------|------|------|
| `PATCH /api/users/:id` | 380-399 | 无任何自保护 / 最后管理员检查 | 可改自己角色 + 可降级最后 admin |
| `PATCH /api/users/:id/role` | 473-507 | 仅校验 role 合法性 | 同上 |
| `PUT /api/users/:id/roles` | 538-615 | 仅校验 roles 数组结构 | 同上 |
| `POST /api/users/batch` (`action=set_role`) | 225-360 | 已过滤 operatorId（不能批量改自己）+ `is_built_in` | **未防「最后一个 admin 被批量降级」**——可把所有 admin 一次性改成 user |
| `DELETE /api/users/:id` | 656-710 | ✅ 已有完整保护（不能删自己 + 不能删最后一个 server_admin） | 对照基线 |
| `batchSoftDelete`（service） | userService.ts:982 | ✅ 已有完整保护 | 对照基线 |
| `batchSetRole`（service） | userService.ts:1074 | ❌ 无任何保护 | 路由层过滤了 operatorId，但未防最后一个 admin |

### 2.2 后端：`countActiveServerAdmins` 实现有 SQL 错误

文件：[panel/backend/src/services/userService.ts:441-449](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/userService.ts#L441-L449)

```typescript
async countActiveServerAdmins(excludeUserId?: string): Promise<number> {
  let qb = this.db<UserRow>('users')
    .where({ role: Role.SERVER_ADMIN, status: 'active' });  // ❌ role 列已 DROP
  // ...
}
```

- v4.19.0 基线 migration `20260808000000_baseline_v4_post_demo.ts:53-73` 已**移除 `users.role` 列**，仅保留 `roles` JSON + `active_role`
- 此查询在 SQLite 中会抛 `SQLITE_ERROR: no such column: role`
- 现网未爆出的原因：DELETE 单条路径极少真正触发该检查（要删的必须是 server_admin 且是最后一个），但实际上**这层保护是失效的**
- `batchSoftDelete` 用了正确的 `active_role` 字段（userService.ts:1011-1018），未踩坑

### 2.3 前端：编辑入口无任何客户端校验

文件：[panel/frontend/src/pages/admin/Users.tsx:157-188](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx#L157-L188)

- `startEdit(u)`：对所有用户开放编辑入口，不区分是否为自己
- 编辑模式下角色下拉（673-685 行）对当前用户没有禁用
- `handleSave`：直接调用 `api.updateUser(id, draft)`，无客户端兜底校验

### 2.4 同类风险（同源根因，本次方案一并修复）

- 管理员可把自己 `status` 改为 `disabled`，导致自己无法登录（同样的"自锁"问题）
- `PATCH /api/users/:id` 的 `status` 字段也无保护

---

## 三、修复方案（定稿）

### 3.1 核心保护规则

与 `DELETE /api/users/:id` 已有保护对齐，**两条硬规则**：

1. **不能降级最后一个 active server_admin**：当目标用户当前是 active server_admin，且修改后该用户不再是 server_admin，则必须保证除该用户外仍有 ≥1 个 active server_admin，否则拒绝
2. **不能把自己 status 改为 disabled/deleted**：避免管理员自锁

**不引入**「不能改自己角色」规则——管理员可以把自己从 server_admin 改为 user（比如需要切换身份调试），只要系统还有其他 server_admin 即可。这与 DELETE 路径语义对齐（DELETE 也允许删除自己，只要不是最后一个）。

### 3.2 后端修复

#### 3.2.1 修复 `countActiveServerAdmins` SQL 错误

文件：`panel/backend/src/services/userService.ts:441-449`

改为基于 `active_role` 字段查询（与 `batchSoftDelete` 实现一致）：

```typescript
async countActiveServerAdmins(excludeUserId?: string): Promise<number> {
  let qb = this.db<UserRow>('users')
    .where({ active_role: Role.SERVER_ADMIN, status: 'active' });
  if (excludeUserId) {
    qb = qb.whereNot('id', excludeUserId);
  }
  const row = await qb.count<{ count: number }[]>({ count: '*' }).first();
  return Number(row?.count ?? 0);
}
```

> 说明：`active_role` 列在 v4.19.0 基线已建索引 `idx_users_active_role`，查询性能无忧。

#### 3.2.2 抽取共享保护辅助函数

文件：`panel/backend/src/api/routes/users.ts`

在 `createUsersRouter` 内或模块顶部新增辅助函数：

```typescript
/**
 * 检查目标用户是否为 active server_admin。
 * 用于修改角色/状态前判定是否需要触发「最后一个 server_admin」保护。
 */
async function isActiveServerAdmin(db: Knex, userId: string): Promise<boolean> {
  const row = await db<UserRow>('users')
    .where({ id: userId })
    .select('active_role', 'status')
    .first();
  if (!row) return false;
  if (row.status !== 'active') return false;
  return normalizeRole(row.active_role ?? Role.USER) === Role.SERVER_ADMIN;
}

/**
 * 判断更新后的角色是否仍为 server_admin。
 * - 单角色更新（role 字段）：直接判断
 * - 多角色更新（roles + active_role）：判断 active_role 是否为 server_admin
 */
function isNewActiveRoleServerAdmin(
  singleRoleUpdate: UserRole | undefined,
  rolesUpdate: UserRole[] | undefined,
  activeRoleUpdate: UserRole | undefined,
  currentActiveRole: string | null | undefined,
): boolean {
  if (singleRoleUpdate !== undefined) {
    return normalizeRole(singleRoleUpdate) === Role.SERVER_ADMIN;
  }
  if (rolesUpdate !== undefined) {
    const ar = activeRoleUpdate !== undefined
      ? normalizeRole(activeRoleUpdate)
      : normalizeRoles(rolesUpdate)[0];
    return ar === Role.SERVER_ADMIN;
  }
  // 未改角色，沿用现状
  return normalizeRole(currentActiveRole ?? Role.USER) === Role.SERVER_ADMIN;
}
```

#### 3.2.3 4 个端点注入保护

**A. `PATCH /api/users/:id`**（行 380-399）

在 `userService.updateUser` 调用前插入：

```typescript
const operatorId = (req as unknown as { user?: { userId?: string } }).user?.userId;

// 自保护：不能把自己 status 改为 disabled/deleted
if (req.params.id === operatorId && updates.status !== undefined
    && updates.status !== 'active') {
  res.status(400).json({
    error: { code: 'PANEL_VALIDATION_ERROR', message: '不能将自己的状态改为非 active' },
  });
  return;
}

// 最后一个 server_admin 保护
if (updates.role !== undefined || updates.roles !== undefined) {
  const db = req.app.locals.db as Knex;
  const targetRow = await db<UserRow>('users').where({ id: req.params.id }).first();
  if (targetRow && await isActiveServerAdmin(db, req.params.id)) {
    const stillAdmin = isNewActiveRoleServerAdmin(
      updates.role as UserRole | undefined,
      updates.roles as UserRole[] | undefined,
      updates.active_role as UserRole | undefined,
      targetRow.active_role,
    );
    if (!stillAdmin) {
      const remaining = await userService.countActiveServerAdmins(req.params.id);
      if (remaining === 0) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '不能降级最后一个 server_admin' },
        });
        return;
      }
    }
  }
}
```

**B. `PATCH /api/users/:id/role`**（行 473-507）

在 `userService.updateUser` 调用前插入相同保护（用 `body.role` 作为 `singleRoleUpdate`）。

**C. `PUT /api/users/:id/roles`**（行 538-615）

在 `userService.updateUserRoles` 调用前插入相同保护（用 `body.roles` + `body.active_role`）。

**D. `POST /api/users/batch` (action=set_role)`**（行 225-360）

路由层 pre-filter 已过滤 `operatorId` 和 `is_built_in`。在 `batchSetRole` 调用前补一层批量预检：

```typescript
if (action === 'set_role') {
  const db = req.app.locals.db as Knex;
  // 查出待操作的 active server_admin
  const targetActiveAdmins = await db<UserRow>('users')
    .whereIn('id', preFilteredIds)
    .where({ active_role: Role.SERVER_ADMIN, status: 'active' })
    .select('id');
  const targetAdminIds = new Set(targetActiveAdmins.map(r => r.id));
  // 这些 admin 中，目标 role 不是 server_admin 的，会触发降级
  const willBeDowngraded = targetActiveAdmins.filter(r =>
    normalizeRole(body.role!) !== Role.SERVER_ADMIN
  );
  if (willBeDowngraded.length > 0) {
    // 统计全库 active server_admin 总数（含本次未涉及的）
    const totalAdmins = await userService.countActiveServerAdmins();
    // 剩余 = 全库总数 - 本次被降级数
    if (totalAdmins - willBeDowngraded.length <= 0) {
      res.status(400).json({
        error: {
          code: 'PANEL_VALIDATION_ERROR',
          message: '不能降级最后一个 server_admin（批量操作将导致系统无管理员）',
        },
      });
      return;
    }
  }
}
```

> 注：`batchSetRole` service 层也建议补一层单条降级检查（与 `batchSoftDelete` 第 1041-1048 行同模式），避免路由层与 service 层并发场景下的窗口问题。但因当前 `batchSetRole` 仅在路由层事务内调用，路由层保护已足够；service 层加固作为可选项。

#### 3.2.4 错误码与消息

全部使用 `PANEL_VALIDATION_ERROR`（与 DELETE 路径第 663/682 行一致），HTTP 400。

### 3.3 前端修复

文件：[panel/frontend/src/pages/admin/Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx)

#### 3.3.1 编辑入口提示

- 当前用户为自己时，编辑按钮 title 加「（你本人）」提示（不禁用，因为允许改自己——只要不降级到最后一个）
- 编辑模式下，如果 `u.id === user?.id` 且当前 `u.role === 'server_admin'`，角色下拉的「普通用户」「实例管理员」选项加 `disabled` 或在选项文本加「（将降级）」
  - 实际方案：**不禁用选项**（因为可能存在其他 admin 允许降级），但在保存前由后端校验。前端仅在 `handleSave` 捕获 400 错误时友好展示后端消息

#### 3.3.2 错误消息友好化

`handleSave`（行 171-188）补 400 错误分支：

```typescript
} catch (err) {
  if (err instanceof PanelApiError) {
    if (err.code === 'PANEL_FORBIDDEN') {
      setError('无权限执行该操作');
    } else if (err.code === 'PANEL_VALIDATION_ERROR') {
      // 直接展示后端业务消息（如「不能降级最后一个 server_admin」）
      setError(err.message || '校验失败');
    } else {
      setError(err.message || '保存失败');
    }
  } else {
    setError(err instanceof Error ? err.message : '保存失败');
  }
}
```

#### 3.3.3 批量改角色同样捕获后端消息

`submitBatchAction` 同步处理 400 错误透传。

### 3.4 不修改的部分

- 不改 `public/` 下任何契约（接口签名不变，仅后端业务校验加严）
- 不改 `interface_stub/user-service.d.ts`（`countActiveServerAdmins` 签名不变）
- 不引入前端硬阻断（保留后端为唯一权威校验源，避免前后端规则漂移）

---

## 四、执行步骤

### 步骤 1：后端 service 层修复 `countActiveServerAdmins`

- 文件：`panel/backend/src/services/userService.ts:441-449`
- 改 `where({ role: Role.SERVER_ADMIN, ... })` → `where({ active_role: Role.SERVER_ADMIN, ... })`
- 验证：`tsc --noEmit` 通过

### 步骤 2：后端路由层新增共享保护辅助函数

- 文件：`panel/backend/src/api/routes/users.ts`
- 新增 `isActiveServerAdmin` + `isNewActiveRoleServerAdmin`（模块顶部或 router 内闭包）
- 验证：`tsc --noEmit` 通过

### 步骤 3：后端 4 个端点注入保护

- `PATCH /api/users/:id`（行 380-399）
- `PATCH /api/users/:id/role`（行 473-507）
- `PUT /api/users/:id/roles`（行 538-615）
- `POST /api/users/batch` action=set_role 分支（行 225-360）
- 验证：`tsc --noEmit` 通过 + 路由级单元测试（如存在）

### 步骤 4：前端错误处理友好化

- 文件：`panel/frontend/src/pages/admin/Users.tsx`
- `handleSave` 增 `PANEL_VALIDATION_ERROR` 分支透传后端消息
- `submitBatchAction` 同步增 400 透传
- 验证：`tsc --noEmit` 通过 + 现有单测不破

### 步骤 5：单测补强（建议）

- 文件：`panel/backend/src/api/routes/users.test.ts`（若存在）或 `userService.test.ts`
- 新增用例：
  - 最后一个 server_admin 降级 → 400
  - 非最后一个 server_admin 降级 → 200
  - 把自己 status 改为 disabled → 400
  - 批量把所有 admin 改为 user → 400

### 步骤 6：版本号与文档

- `version.md`：新增 v4.29.10 条目（bug 修复 → 小版本号 +1）
- 后端 `package.json`：4.29.9 → 4.29.10
- 前端 `package.json`：4.29.9 → 4.29.10（与后端对齐）
- `current-note.md`：追加本次修复记录

### 步骤 7：部署验证

- rsync 到 `/opt/gameserver-panel`
- `systemctl restart gameserver-panel`
- 浏览器实测：
  - 编辑最后一个 admin 改成 user → 应弹「不能降级最后一个 server_admin」
  - 编辑非最后 admin 改成 user → 应成功
  - 批量改角色把所有 admin 改成 user → 应弹错误

---

## 五、开发事项清单

| # | 文件 | 修改类型 | 描述 |
|---|------|---------|------|
| 1 | `panel/backend/src/services/userService.ts` | 修复 | `countActiveServerAdmins` 改用 `active_role` 字段 |
| 2 | `panel/backend/src/api/routes/users.ts` | 新增辅助函数 | `isActiveServerAdmin` + `isNewActiveRoleServerAdmin` |
| 3 | `panel/backend/src/api/routes/users.ts` | 加保护 | `PATCH /:id` 注入自保护 + 最后 admin 保护 |
| 4 | `panel/backend/src/api/routes/users.ts` | 加保护 | `PATCH /:id/role` 注入最后 admin 保护 |
| 5 | `panel/backend/src/api/routes/users.ts` | 加保护 | `PUT /:id/roles` 注入最后 admin 保护 |
| 6 | `panel/backend/src/api/routes/users.ts` | 加保护 | `POST /batch` set_role 分支注入最后 admin 保护 |
| 7 | `panel/frontend/src/pages/admin/Users.tsx` | 改错误处理 | `handleSave` 增加 `PANEL_VALIDATION_ERROR` 透传 |
| 8 | `panel/frontend/src/pages/admin/Users.tsx` | 改错误处理 | `submitBatchAction` 同步透传 |
| 9 | `version.md` + 前后端 `package.json` | 升版本 | 4.29.9 → 4.29.10 |
| 10 | `current-note.md` | 追加记录 | 本次修复留痕 |

---

## 六、建议（非本次必做）

1. **status 字段同源风险**：管理员把自己 `status` 改为 `disabled` 也会自锁。本次方案在 `PATCH /:id` 已加保护（步骤 3），但 `PATCH /:id/role` 和 `PUT /:id/roles` 不涉及 status 字段，无需处理。批量 `disable` 操作目前未加自保护，建议后续在 `POST /batch` action=disable 分支补「不能 disable 自己」检查（已有 operatorId 过滤，但语义应更显式）。
2. **审计日志补强**：当前审计日志仅在成功路径写入。建议失败路径（被保护拦截的尝试）也写一条审计日志，标记 `action: 'user.update_role.blocked'`，便于追溯异常操作。
3. **前端可视化提示**：可在角色下拉旁加一个内联提示「⚠️ 你正在修改自己的角色」，提升用户感知。但避免硬阻断——后端是唯一权威。
4. **`countActiveServerAdmins` 改名**：当前方法名描述意图清晰但实现已与 `role` 字段脱钩。可在后续小版本中改名为 `countActiveServerAdminsByActiveRole`，但会破坏 `interface_stub/user-service.d.ts` 契约——需走 s0601 契约变更流程。本次方案保持方法名不变，仅修实现。
5. **批量操作并发安全**：`batchSetRole` 路由层预检 + service 层逐条更新之间存在理论竞态（两个并发批量请求同时降级所有 admin）。生产环境单管理员操作概率极低，本次不引入事务级锁；若未来需要，可在 users 表加 `role_version` 字段做乐观锁。

---

## 七、闭合判据

- [ ] `tsc --noEmit` 后端通过
- [ ] `tsc --noEmit` 前端通过
- [ ] 前端 `vite build` 通过
- [ ] 浏览器实测：最后一个 admin 降级被拒
- [ ] 浏览器实测：非最后 admin 降级成功
- [ ] 浏览器实测：批量改角色把所有 admin 改 user 被拒
- [ ] 浏览器实测：错误消息友好展示
- [ ] `version.md` + `package.json` 升级到 4.29.10
- [ ] `current-note.md` 追加记录
- [ ] 部署后生产回归通过

---

## 八、风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 保护逻辑误伤合法操作 | 低 | 中 | 仅在「server_admin → 非 server_admin」+「剩余=0」时触发，与 DELETE 已验证逻辑一致 |
| 前端错误消息不友好 | 低 | 低 | 直接透传后端消息，消息文本已中文化 |
| 部署后回归 | 低 | 低 | 修改集中在 4 个端点的入口校验，不影响正常 CRUD 路径 |
| `countActiveServerAdmins` 修复影响 DELETE 路径 | 低 | 低 | DELETE 路径本就在调用此方法，修复后从「SQL 报错 500」变为「正常返回 0/1」，是正向修复 |

---

## 九、参考

- DELETE 路径保护实现：[users.ts:656-710](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts#L656-L710)
- `batchSoftDelete` service 层保护：[userService.ts:982-1066](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/userService.ts#L982-L1066)
- v4.19.0 基线 migration（users.role 列 DROP）：[20260808000000_baseline_v4_post_demo.ts:53-73](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260808000000_baseline_v4_post_demo.ts#L53-L73)
- 用户原话与表格截图：本文件 §一
