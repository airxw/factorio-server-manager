# Task 6 输出 — 前端 ServerDetailCore 接收账户级解绑入口

> Spec: force-player-binding-for-vip
> 阶段: S4 并行开发（串行支线，依赖 Task 5 完成）
> Subagent: general_purpose_task

## 一、工程过程

1. 读取 spec/tasks/ServerDetailCore.tsx/GuildBind.tsx/servers.ts/auth.ts/client.ts/Profile.tsx，确认数据源与复用组件
2. 确认 `api.unbindInstance(serverId)` 已存在（DELETE `/api/instances/:serverId/bindings`，client.ts#L1449）
3. 确认 `api.listMyBindings()` 返回 `MyBinding[]`（GET `/api/profile/bindings`，client.ts#L1433）
4. 确认 Task 5 已导出 `AccountBindingRow`（GuildBind.tsx#L217，签名含 binding/serverName/gameType/busy/onUnbind）
5. 在 ServerDetailCore.tsx 完成 5 处编辑（导入 / state / useEffect / handler / UI 区块）
6. 运行 `npx tsc --noEmit` → exit 0，无错误
7. 运行 `npx vite build` → exit 0，构建成功（8.26s），ServerDetailCore chunk 42.26 kB

## 二、修改清单

仅修改 1 个文件：

- `/home/airxw/gsp/panel/frontend/src/pages/instance-detail/ServerDetailCore.tsx`

### 改动点（5 处）

| # | 位置 | 内容 |
|---|------|------|
| 1 | 导入区（L36 后） | 新增 `import { AccountBindingRow } from '../guild/GuildBind'` + `import type { MyBinding } from '../../api/modules/auth'` |
| 2 | state 区（L308 后） | 新增 `myBinding: MyBinding \| null` + `unbinding: boolean` |
| 3 | useEffect 区（计费 useEffect 后，L435） | 新增 listMyBindings 数据获取：筛选 `serverId === server.id && unboundAt === null` |
| 4 | handler 区（handleRenew 后，L482） | 新增 `handleUnbind`：confirm 二次确认 → `api.unbindInstance(sid)` → 乐观更新 `setMyBinding(null)` |
| 5 | JSX 区（info-card-collapsible 后、tab 警告条前，L1461） | 条件渲染 `{myBinding && (...)}` 区块，复用 AccountBindingRow |

## 三、实现要点

### 数据获取
- server 加载完成后触发 `api.listMyBindings()`，筛选 `serverId === server.id && unboundAt === null`
- 失败静默降级为 `null`（不阻断详情页）
- 刷新实例时随 `server` 引用变更重新拉取（与计费 useEffect 同模式）

### 条件渲染
- 仅当 `myBinding` 非空（当前用户已绑定该实例且未解绑）时显示管理区块
- 区块位置：info-card-collapsible 之后、tab 警告条之前

### 解绑操作
- 复用 `useConfirm` 二次确认（danger 样式，confirmText='解绑'）
- 调用 `api.unbindInstance(sid)`（DELETE `/api/instances/:serverId/bindings`）
- 成功后乐观更新 `setMyBinding(null)` 隐藏区块 + toast.success
- 失败 toast.error，不改变状态
- `unbinding` 状态禁用解绑按钮（通过 AccountBindingRow 的 busy prop）

### 组件复用
- AccountBindingRow 展示：实例名 + 游戏类型 + VIP 等级 + 绑定时间 + 解绑按钮
- 未修改 GuildBind.tsx（Task 5 产出保持冻结）

## 四、闭合判据核对

- [x] tsc --noEmit 通过（exit 0，无错误）
- [x] vite build 通过（exit 0，8.26s）
- [x] 实例详情页新增账户级绑定管理区块
- [x] 仅当前用户已绑定时显示（`myBinding &&` 条件渲染 + `unboundAt === null` 筛选）
- [x] 展示 VIP 等级 + 绑定时间 + 解绑按钮（AccountBindingRow 内置）
- [x] 解绑 API 调用正确（`api.unbindInstance` → DELETE `/api/instances/:serverId/bindings`）
- [x] 复用 AccountBindingRow 组件（`import { AccountBindingRow } from '../guild/GuildBind'`）
- [ ] 内置浏览器核对解绑流程 — **待主线程执行**（subagent 上下文无法拉起内置浏览器，需运行时环境 + 已绑定账号）

## 五、交接状态

- **当前状态**: 已完成（代码 + tsc + build 通过）
- **未完成项**: 内置浏览器核对解绑流程（需主线程在运行环境中执行）
- **降级说明**: 本 subagent 上下文无法拉起独立审查（GN-004）与内置浏览器核对（s0402 三重闸门的浏览器环节）。请主线程在合流前对本产出执行独立审查，并在运行环境中完成内置浏览器解绑流程核对。

## 六、未修改文件确认

- GuildBind.tsx — 未修改（Task 5 冻结）
- GuildDock.tsx — 未修改（Task 4 冻结）
- 后端代码 — 未修改
- public/ — 未修改
