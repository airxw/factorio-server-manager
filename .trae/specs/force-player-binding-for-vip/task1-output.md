# Task 1 执行输出 — bindInstance 改造（vip_level=0）

> 来源：[tasks.md](./tasks.md) Task 1
> 阶段：S4 并行开发
> subagent_type：general_purpose_task
> 执行时间：2026-07-30

## 工程过程

1. 读取 spec.md（理解决策 1：bindInstance 保留但 vip_level=0）+ tasks.md（Task 1 步骤）+ instanceBindingService.ts 全文
2. 核对 instanceBindingService.ts 中 `DEFAULT_BOUND_VIP_LEVEL` 的当前用法：
   - `bindInstance` INSERT 路径（L161）+ 复活路径（L199）→ 需改为 `BIND_INSTANCE_VIP_LEVEL=0`
   - `verifyBindingByCode` INSERT 路径（L580）+ 复活路径（L608）→ 保留 `DEFAULT_BOUND_VIP_LEVEL=1`（Task 3 范围，本任务不动）
3. 检查测试基础设施：db-helper.ts 已建 bindings 表，但 schema 与生产不一致（id 为 string PK 无自增 vs 生产 integer AUTOINCREMENT；缺 partial UNIQUE INDEX）
4. 修改 instanceBindingService.ts：
   - 新增常量 `BIND_INSTANCE_VIP_LEVEL = 0`，保留 `DEFAULT_BOUND_VIP_LEVEL = 1`（含注释说明各自归属）
   - bindInstance INSERT + 复活路径改用 `BIND_INSTANCE_VIP_LEVEL`
   - 更新 bindInstance 函数注释（明确"创建无 VIP 的账户级绑定，VIP 由 verifyBindingByCode 赋予"）
5. 新建 instanceBindingService.test.ts：
   - 用 `vi.hoisted` + `vi.mock('../db/connection.js')` 隔离 getDatabase 单例
   - beforeEach 中 drop + 重建 bindings 表为生产 schema（id integer AUTOINCREMENT + partial UNIQUE INDEX），不修改 db-helper.ts
   - 4 个测试用例（含 Task 1 步骤 4、5 的两个核心用例 + 2 个边界用例）
6. 运行 `npx tsc --noEmit` → 退出码 0，通过
7. 运行 `npx vitest run src/services/instanceBindingService.test.ts` → 4 passed，通过

## 交接状态

- 状态：**已完成**
- 闭合判据核对：
  - [x] `tsc --noEmit` 通过
  - [x] 单测 PASS（4/4）
  - [x] 注释明确说明新语义（bindInstance 函数头注释 + 常量注释）
  - [x] `DEFAULT_BOUND_VIP_LEVEL` 常量保留（verifyBindingByCode 仍用，行 594、622）
  - [x] `bindInstance` INSERT 时 `vip_level === 0`（用 BIND_INSTANCE_VIP_LEVEL）
  - [x] `bindInstance` 复活已 revoked 记录时 `vip_level === 0`（用 BIND_INSTANCE_VIP_LEVEL）
- 约束遵守：
  - [x] 仅修改 instanceBindingService.ts + 新建 instanceBindingService.test.ts
  - [x] 未修改 public/ 下任何文件
  - [x] 未修改 verifyBindingByCode 函数逻辑
  - [x] 未修改 db-helper.ts（bindings 表 schema 差异在测试文件内本地重建解决）

## 最终结果

### 修改的文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `panel/backend/src/services/instanceBindingService.ts` | 修改 | 新增 `BIND_INSTANCE_VIP_LEVEL=0` 常量；bindInstance INSERT/复活路径改用该常量；更新函数注释 |
| `panel/backend/src/services/instanceBindingService.test.ts` | 新建 | bindInstance VIP 语义单测（4 用例） |

### tsc 输出

```
$ npx tsc --noEmit
（退出码 0，无输出）
```

### vitest 输出

```
$ npx vitest run src/services/instanceBindingService.test.ts

 RUN  v2.1.9 /home/airxw/gsp/panel/backend

 ✓ src/services/instanceBindingService.test.ts (4 tests) 105ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  13:34:29
   Duration  681ms (transform 123ms, setup 96ms, collect 106ms, tests 105ms, environment 0ms, prepare 72ms)
```

### 测试用例明细

| 用例 | 覆盖判据 | 结果 |
|------|----------|------|
| 无记录 → INSERT 创建账户级绑定，vip_level === 0 | Task 1 步骤 4 | PASS |
| 已有 revoked 记录 → 复活为 verified，vip_level === 0（旧记录曾持有 vip_level=1） | Task 1 步骤 5 | PASS |
| 已有 verified 记录 → 抛 BindingAlreadyExistsError，不重复写入 | 边界（防回归） | PASS |
| 实例不存在 → 抛 BindingNotFoundError | 边界（防回归） | PASS |

### 关键改动点（instanceBindingService.ts）

- 行 73-85：常量区
  - `DEFAULT_BOUND_VIP_LEVEL = 1`（保留，注释说明归 verifyBindingByCode 使用）
  - `BIND_INSTANCE_VIP_LEVEL = 0`（新增，注释说明归 bindInstance 使用）
- 行 127-146：bindInstance 函数头注释（明确 v4.38.0 改造语义）
- 行 175：bindInstance INSERT 路径 `vip_level: BIND_INSTANCE_VIP_LEVEL`
- 行 213：bindInstance 复活路径 `vip_level: BIND_INSTANCE_VIP_LEVEL`
- 行 594、622：verifyBindingByCode 路径 `vip_level: DEFAULT_BOUND_VIP_LEVEL`（未动）

### 测试基础设施说明（供后续 Task 参考）

instanceBindingService 直接调用 `getDatabase()` 单例（非工厂注入），与 vipService/cdkService 等 DI 服务不同。本测试建立的可复用模式：

1. **getDatabase 隔离**：`vi.hoisted` 创建 dbHolder + `vi.mock('../db/connection.js')` 使 getDatabase 返回测试 DB
2. **bindings 表 schema 修复**：createTestDb 的 bindings 表 id 为 string PK 无自增，与生产不一致。测试文件内 `rebuildBindingsTableForProduction()` drop+重建为生产 schema（integer AUTOINCREMENT + partial UNIQUE INDEX），不修改 db-helper.ts
3. **后续 Task 3（verifyBindingByCode 测试）可直接复用此模式**

### 运行时接入校验（rules-0 §四-13）

本任务仅修改 bindInstance 内部 VIP 常量，未新增模块/路由/事件。bindInstance 的运行时接入点（路由 `POST /api/instances/:serverId/bindings` 调用、下游 getUserVipLevel 消费）未变，无孤岛风险。
