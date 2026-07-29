# gsp 实例 error 状态恢复路径方案

> 修复 `error` 状态下用户无法停止/删除/启动实例的死锁 bug，并新增"强制重置状态"运维入口。

## 一、问题背景

### 1.1 死锁场景

实例进入 `error` 状态后，前端三个操作按钮（启动/停止/删除）全部禁用，后端三个对应接口也全部返回 `409 INVALID_SERVER_STATE`，用户无任何操作路径自救。当前唯一恢复方式是直接 SQL 改库或后端运维介入。

### 1.2 触发条件

`error` 状态通常由以下原因触发：
- 实例进程异常退出（OOM、Segfault）
- 启动失败（端口冲突、配置错误、依赖缺失）
- Daemon 与 Panel 失联超时被标记

### 1.3 当前代码位置

| 位置 | 文件 | 行号 | 现有约束 |
|---|---|---|---|
| 前端 `canStart` | `panel/frontend/src/pages/ServerDetail.tsx` | L653 | `displayState === 'stopped'` |
| 前端 `canStop` | 同上 | L654 | `running \|\| starting` |
| 前端 `canDelete` | 同上 | L655 | `displayState === 'stopped'` |
| 后端 DELETE | `panel/backend/src/api/routes/servers.ts` | L494 | `row.status !== 'stopped'` |
| 后端 POST /start | 同上 | L542 | `row.status !== 'stopped'` |
| 后端 POST /stop | 同上 | L650 | `!== 'running' && !== 'starting'` |

## 二、方案定稿（用户已决策）

组合方案：**error 状态可停止 + 可删除 + 新增"强制重置状态"按钮**。

### 2.1 语义统一

- **error 状态可停止**：语义为"清理残留进程/状态，回退到 stopped"。error 通常意味着进程已异常退出，stop 操作在 daemon 侧为 best-effort 清理，DB 状态强制回退到 stopped。
- **error 状态可删除**：语义为"放弃已损坏实例"。删除前 daemon 尝试清理（若残留进程），失败仅记日志不阻断删除流程（实例已 error，DB 删除是核心动作）。
- **强制重置状态按钮**：仅 error 状态可见，调用专用 `POST /api/servers/:id/reset-state` 接口，DB 强制改为 stopped。与 stop 的区别：stop 走 daemon stopInstance 流程（有 WS 状态确认），reset-state 是 Panel 单方面的 DB 修正（不调用 daemon，适合 daemon 不可达场景）。

### 2.2 stop 与 reset-state 的差异

| 维度 | POST /stop | POST /reset-state |
|---|---|---|
| 接受状态 | running / starting / error | 仅 error |
| 调用 daemon | 是（stopInstance） | 否 |
| DB 状态流转 | → stopping → stopped（WS 确认） | → stopped（直接） |
| 适用场景 | 进程可能还活着，走正常停止流程 | 进程已死/daemon 不可达，仅修 DB |
| 权限 | owner / admin | admin（运维操作） |

## 三、执行步骤

### 步骤 1：契约层（public/schema/panel-api-types.ts）

> 🚨 public/ 受 rules-0 §四-10 + ec7_action_gate 保护。本方案对 `panel-api-types.ts` 的修改（注释更新 + 新增类型）已由用户通过 AskUserQuestion 显式授权（决策"新增强制重置状态按钮"对应需要新增 reset-state 契约类型），授权链条记录于本节。

**开发事项：**
1. 修改 `DeleteServerResponse` 注释：`stopped 或 error 状态可删除`
2. 修改 `ServerStopResponse` 注释：`running/starting/error 状态可停止`
3. 新增 `ServerResetStateRequest`（空 body，显式声明）和 `ServerResetStateResponse` 类型：

```typescript
// POST /api/servers/:id/reset-state — 强制将 error 状态重置为 stopped（仅 server_admin）
// 异常契约：
//   - 409 INVALID_SERVER_STATE：当前状态非 error
//   - 403 PANEL_FORBIDDEN：当前用户非 server_admin/system_admin
export interface ServerResetStateRequest {}

export interface ServerResetStateResponse {
  server_id: string;
  previous_status: InstanceState;
  current_status: 'stopped';
}
```

**建议：**
- 此为 MINOR 版本契约变更（新增接口方法），按 rules-3 §六 触发通知依赖模块，不阻断。
- 在文件头部 `@version` 注释追加变更记录。

### 步骤 2：后端路由（panel/backend/src/api/routes/servers.ts）

**开发事项：**

2.1 放开 DELETE `/api/servers/:id` 状态约束：
```typescript
if (row.status !== 'stopped' && row.status !== 'error') {
  // 409 INVALID_SERVER_STATE
}
```
- 当 `status === 'error'` 时，在 `db.delete()` **之前** best-effort 调用 `daemonClient.stopInstance(row.id)`（清理可能的残留进程）；调用包裹在独立 try/catch 中，失败仅 `logger.warn({ err, serverId }, 'delete: best-effort stopInstance failed, continue deleting')`，**不阻断删除流程**（继续执行 `db.delete()`）。
- 注：现有 DELETE 路由不调用 `safeRemoveService`（该服务仅用于子目录清理 L910-981），本方案也不引入 `safeRemoveService` 调用，仅做 best-effort stopInstance。

2.2 放开 POST `/api/servers/:id/stop` 状态约束：
```typescript
if (row.status !== 'running' && row.status !== 'starting' && row.status !== 'error') {
  // 409 INVALID_SERVER_STATE
}
```
- error 状态下走相同的 stop 流程：DB 改 stopping → 调 daemon stopInstance → WS 确认 stopped。
- **error 状态下的 daemon 失败 DB 回滚**：现有 stop 路由（L664-676）daemon 调用失败走 `handleDaemonOrInternal` 返回 503/502 但 DB 停留在 stopping。为避免 error 状态下卡死，在 error 分支增加 try/catch：
  ```typescript
  await updateStatus(db, row.id, 'stopping');
  try {
    await daemonClient.stopInstance(row.id);
  } catch (err) {
    // error 状态下 stop 失败：回滚 DB 到 error，让用户改用 reset-state
    if (row.status === 'error') {
      await updateStatus(db, row.id, 'error');
    }
    throw err; // 仍走 handleDaemonOrInternal 返回 503/502
  }
  ```
- running/starting 状态下保持现有行为不变（不回滚，依赖 WS 状态超时扫描 scheduler-init.ts L158 处理卡死）。

2.3 新增 POST `/api/servers/:id/reset-state`：
- **权限**：仅 `server_admin` / `system_admin` 可用，**不做 owner 校验**（运维操作，admin 可处理任何 error 实例）。后端判定：
  ```typescript
  const role = normalizeRole((req as any).activeRole ?? req.user?.role);
  if (role !== Role.SERVER_ADMIN && role !== Role.SYSTEM_ADMIN) {
    // 403 PANEL_FORBIDDEN
  }
  ```
  （注：`isAdminRole` 是前端函数，后端用 `normalizeRole + Role` 枚举，与 L1180-1195 `checkOwnership` 一致。）
- 状态校验：`if (row.status !== 'error')` → 409 INVALID_SERVER_STATE。
- 行为：`updateStatus(db, row.id, 'stopped')`，返回 `ServerResetStateResponse`。
- 不调用 daemon，纯 DB 操作。
- 日志：`logger.info({ serverId, prevStatus: row.status }, 'reset-state: error → stopped')`。

**建议：**
- reset-state 接口不主动触发 daemon 进程清理（避免 daemon 不可达时 500）。若用户怀疑有残留进程，应先尝试 stop（daemon 路径），失败再 reset-state。
- 不修改 `routes-registry.ts`（路由已在 `createServersRouter` 内挂载，自动生效为 `POST /api/servers/:id/reset-state`）。

### 步骤 3：前端 API client（panel/frontend/src/api/client.ts + modules/servers.ts）

**开发事项：**
1. `ServersApi` 接口新增方法签名：
```typescript
resetServerState(id: string): Promise<ServerResetStateResponse>;
```
2. `client.ts` 实现新增：
```typescript
resetServerState(id) {
  return request<ServerResetStateResponse>(
    `/servers/${encodeURIComponent(id)}/reset-state`,
    { method: 'POST' },
  );
},
```
3. import 类型：从 `@public/schema/panel-api-types` 追加 `ServerResetStateResponse`。

### 步骤 4：前端 UI（panel/frontend/src/pages/ServerDetail.tsx）

**开发事项：**

4.1 调整状态判定：
```typescript
const canStop = displayState === 'running' || displayState === 'starting' || displayState === 'error';
const canDelete = displayState === 'stopped' || displayState === 'error';
```

4.2 新增 `handleResetState` 处理函数（参考 `handleCleanupSubdir` 的 `confirm` 模式，L559-591）：
- 二次确认（`useConfirm`）：标题"强制重置状态"，提示"将实例从 error 强制回退到 stopped。此操作不调用 daemon，若有残留进程请先尝试停止。"，`danger: true`，`confirmText: '重置'`。
- 调用 `api.resetServerState(server.id)`
- 成功：`setLiveState('stopped')` + `toast.success('已重置为 stopped')`
- 失败：toast.error

4.3 UI 渲染：
- 在底部 `bottom-action-bar` 内，启动/停止/刷新之后，**仅当 `displayState === 'error' && isAdminRole(effectiveRole)` 时**追加"重置状态"按钮（`btn btn-warning`，与停止按钮同色系以表示警示）。
- 按钮文案：`重置状态`；disabled 条件：`actioning`。
- 顶部 page-actions 的"删除"按钮 disabled 条件不变（`actioning || !canDelete`，canDelete 已含 error）。
- 非 admin 用户在 error 状态下：可见停止/删除按钮（owner 可用），但**不见**重置按钮。

**建议：**
- 重置状态按钮放在底部操作栏，与启动/停止同组，避免顶部 page-actions 拥挤。
- error 状态下停止按钮与重置按钮并存——停止走 daemon（owner 可用），重置仅修 DB（仅 admin），用户按需选择。

### 步骤 5：后端测试（panel/backend/src/services/serverService.test.ts）

**开发事项：**
- 新增测试用例 `error 状态下可停止`：插一条 `status='error'` 的实例，POST /stop 返回 200，DB 状态变为 stopping。
- 新增测试用例 `error 状态下 stop daemon 失败时 DB 回滚到 error`：mock `daemonClient.stopInstance` reject，POST /stop 返回 503，DB 状态仍为 error（验证不卡 stopping）。
- 新增测试用例 `error 状态下可删除`：插一条 `status='error'` 的实例，DELETE 返回 200，daemon.stopInstance 被调用（best-effort），DB 行已删除。
- 新增测试用例 `error 状态下删除时 best-effort stopInstance 失败仍继续删除`：mock `daemonClient.stopInstance` reject，DELETE 仍返回 200，DB 行已删除。
- 新增测试用例 `error 状态下可重置状态`：POST /reset-state 返回 200，DB 状态变为 stopped，daemon.stopInstance **未被调用**。
- 新增测试用例 `非 error 状态调用 reset-state 返回 409`：插一条 `status='running'` 的实例，POST /reset-state 返回 409。
- 新增测试用例 `非 admin 用户调用 reset-state 返回 403`：mock `req.user.role = 'operator'`，POST /reset-state 返回 403 PANEL_FORBIDDEN。
- 新增测试用例 `running/starting 状态下 stop daemon 失败不回滚`（回归保护）：mock daemon 失败，DB 状态停留在 stopping（验证 error 分支的回滚不影响原行为）。

### 步骤 6：前端测试（panel/frontend/src/pages/__tests__/ServerDetail.test.tsx）

**开发事项：**
- 新增测试用例 `error 状态下显示重置按钮 + 启用停止/删除`（admin 用户）。
- 新增测试用例 `非 error 状态下不显示重置按钮`。
- 新增测试用例 `error 状态下非 admin 用户不显示重置按钮`（仍可见停止/删除）。
- 新增测试用例 `点击重置按钮触发 confirm → 调用 resetServerState → 状态变 stopped + toast`。
- 复用现有 mock 模式（参考已有测试结构）。

### 步骤 7：文档更新

**开发事项：**
- `version.md` 顶部追加 `## v4.29.7 (2026-07-28) — 修复 error 状态死锁 + 新增强制重置状态` 条目，包含问题、修复点、影响范围。
- `current-note.md` 七字段更新交接状态（任务名/进度/产出物/未闭合项/下一步/风险/签名）。
- 不更新 `README.md`（非重大功能/文件结构调整）。

## 四、影响范围与风险

### 4.1 影响范围

| 层 | 文件 | 变更类型 |
|---|---|---|
| 契约 | `public/schema/panel-api-types.ts` | 注释更新 + 新增类型 |
| 后端 | `panel/backend/src/api/routes/servers.ts` | 放开约束 + 新增路由 |
| 前端 API | `panel/frontend/src/api/client.ts` | 新增方法 |
| 前端 API | `panel/frontend/src/api/modules/servers.ts` | 接口签名新增 |
| 前端 UI | `panel/frontend/src/pages/ServerDetail.tsx` | 状态判定 + 新按钮 |
| 后端测试 | `panel/backend/src/services/serverService.test.ts` | 新增用例 |
| 前端测试 | `panel/frontend/src/pages/__tests__/ServerDetail.test.tsx` | 新增用例 |
| 文档 | `version.md` / `current-note.md` | 追加记录 |

### 4.2 风险与缓解

| 风险 | 缓解 |
|---|---|
| error 状态下删除可能残留进程文件 | error 删除前 best-effort 调 `daemonClient.stopInstance`（独立 try/catch，失败仅 logger.warn 不阻断），DB 行直接 `db.delete()`。现有 DELETE 不调用 `safeRemoveService`（该服务仅用于子目录清理），本方案也不引入。 |
| reset-state 滥用导致状态不一致 | 仅 server_admin/system_admin 可用；仅 error 状态可调；不主动调 daemon；前端按钮仅 `displayState === 'error' && isAdminRole(effectiveRole)` 时显示 |
| stop 在 error 下走 stopping → 卡住 | error 分支增加 try/catch：daemon stopInstance 失败时回滚 DB 到 error（不卡 stopping），响应仍走 `handleDaemonOrInternal` 返回 503/502，前端 toast 提示用户改用 reset-state。running/starting 状态下保持原行为（不回滚，依赖 scheduler-init.ts L158 状态超时扫描） |
| 前端 canStop 含 error 后语义混淆 | error 状态下同时显示"停止"（owner 可用，走 daemon）和"重置状态"（仅 admin，仅修 DB）按钮，按钮文案与 tooltip 明确区分 |

## 五、验证清单

- [ ] 后端 `npm test` 全绿（含新增 error 状态用例）
- [ ] 前端 `npm run test` 全绿（含新增按钮可见性用例）
- [ ] 前端 `npm run build` 通过
- [ ] 手动验证：error 状态下可点停止 → 状态变 stopping → stopped
- [ ] 手动验证：error 状态下可点删除 → 实例消失
- [ ] 手动验证：error 状态下显示"重置状态"按钮 → 点击后状态变 stopped
- [ ] 手动验证：非 error 状态下不显示"重置状态"按钮
- [ ] 手动验证：非 admin 用户调用 reset-state 返回 403

## 六、版本号

按 `rules/bb.md` 规则：
- bug 修复（error 死锁）→ 小版本号 +1
- 新增 reset-state 接口属"补强已有功能模块的运维入口"（非独立新功能模块，与 error 死锁修复同源）→ 不触发中版本号

**目标版本：v4.29.8**（v4.29.7 已被先前 bug 修复占用，递增到 v4.29.8）

**论证**：reset-state 不是面向终端用户的新业务能力，而是 error 死锁修复的配套运维兜底（与 stop/delete 同属实例生命周期管理）。若将其视为"全新功能"触发中版本号，会与 bug 修复的同源属性割裂。
