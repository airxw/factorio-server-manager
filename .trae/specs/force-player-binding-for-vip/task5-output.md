# Task 5: 前端 — GuildBind 去掉 SegmentedControl，简化为单向导 — 执行结果

## 工程过程

1. 读取 spec.md 决策 3.2 + tasks.md Task 5 + rules-0 §3.1.1（React Router v6 路由守卫）
2. 读取 GuildBind.tsx 全文，定位 SegmentedControl（L545-L616）与 bindType state（L347-L348）
3. 更新文件头注释：移除 v4.17.0 SegmentedControl 描述，记录 v4.x.0 简化为单向导的变更
4. 清理 imports：删除 `UsersRound`（仅账户级向导分支使用）
5. 删除 `type BindType = 'player' | 'account'` 类型定义
6. 导出 `AccountBindingRow` 组件（添加 `export` 关键字）供 Task 6 ServerDetailCore 复用
7. 删除 `BindableServerRow` 组件（仅账户级向导分支使用，已随分支删除）
8. 重构主组件 GuildBind：
   - 删除 `navigate`（仅账户级向导分支使用）
   - 删除 `bindType` state + `initialType` 派生
   - 删除 `accountBindings` state
   - 新增 URL 重定向 useEffect：`?type=account` → `?type=player`（replace: true，兼容老链接）
   - 简化 `refresh`：移除 `api.listMyBindings()` 调用（不再需要账户级绑定列表）
   - 删除 `switchType` callback
   - 删除 `bindableServers` useMemo
   - 删除 `handleBindInstance` / `handleUnbindInstance` 账户级操作
   - 更新 `serverMap` 注释（移除"账户级卡片"语义）
9. 删除 SegmentedControl JSX（player / account 切换器）
10. 删除账户级向导分支 JSX（已绑定实例 + 可绑定实例列表）
11. 移除 `{bindType === 'player' && (<>...</>)}` 条件包裹，玩家向导两 section 直接作为父 div 子元素
12. 更新 hero 副标题："选择绑定类型，按向导完成关联即可解锁对应权益" → "按向导完成游戏角色绑定，验证后即可解锁 VIP 权益"
13. 修正玩家向导两 section 的缩进（原包裹在 fragment 下，现直接为父 div 子元素）
14. 运行验证：tsc --noEmit + vite build + localhost 违规检查

## 交接状态

**状态**：已完成

## 最终结果

### 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `panel/frontend/src/pages/guild/GuildBind.tsx` | 修改 | 删除 SegmentedControl + 账户级向导分支，简化为单向导；导出 AccountBindingRow |

仅修改 GuildBind.tsx 一个文件（符合任务约束）。未修改 GuildDock.tsx / ServerDetailCore.tsx / 后端代码 / public/ 契约。

### 闭合判据核对

- [x] tsc --noEmit：GuildBind.tsx 无错误（exit code 2 来自 client.ts/handlers.ts 的 ServerSummary 预存错误，与本任务无关，详见下方"预存错误说明"）
- [x] vite build 通过（exit code 0，`✓ built in 8.99s`）
- [x] SegmentedControl 已删除
- [x] bindType state + switchType + URL query 处理已删除
- [x] 默认渲染游戏角色绑定向导（步骤1选实例+填角色名 → 步骤2展示验证码+已绑定列表）
- [x] URL `?type=account` 自动重定向到 `?type=player`（useEffect + setSearchParams replace: true）
- [x] AccountBindingRow 组件保留并导出（供 Task 6 ServerDetailCore 复用）
- [x] 已绑定角色列表展示在向导下方（步骤2 section 内 grouped 列表）
- [x] 无 localhost:3000 / 127.0.0.1:3000 违规（dist/ grep 通过）
- [x] 遵循 rules-0 §3.1.1 React Router v6 路由守卫（未触碰 `<Routes>`/`<Route>` 结构，仅组件内 query 处理）

### 预存错误说明（非本任务引入）

tsc --noEmit 报告 2 个错误，均不在 GuildBind.tsx，与本任务无关：

1. `src/api/client.ts(678,11)`：ServerSummary 缺少 `is_public` / `binding_requests_enabled` 字段——来自其他任务（binding-applications 特性）的 schema 变更未同步到 client.ts
2. `src/mocks/handlers.ts(83,5)`：同上 ServerSummary 字段缺失

这两个文件本任务未修改（git status 确认 client.ts/handlers.ts 由其他任务修改）。vite build 成功证明这些类型不匹配不影响构建产物。

### 关键实现细节

**URL 重定向**（兼容老链接 `?type=account`）：
```tsx
useEffect(() => {
  if (searchParams.get('type') === 'account') {
    const params = new URLSearchParams(searchParams);
    params.set('type', 'player');
    setSearchParams(params, { replace: true });
  }
}, [searchParams, setSearchParams]);
```
采用 useEffect + setSearchParams（replace: true）而非 `<Navigate>`，避免组件树重挂载，且保留其他 query 参数。

**AccountBindingRow 导出**：保留在 GuildBind.tsx 内并添加 `export` 关键字，Task 6 可通过 `import { AccountBindingRow } from '../guild/GuildBind'` 复用。未提取到独立文件（任务允许"保留在 GuildBind.tsx 导出"）。

### 运行时接入说明

GuildBind 是页面组件，通过 React Router `<Route>` 注册（未修改路由结构）。`useSearchParams` 来自 react-router-dom，URL 重定向在客户端完成，无后端依赖变更。删除的账户级 API 调用（`api.listMyBindings` / `api.bindInstance` / `api.unbindInstance`）在 GuildBind 中不再使用，但 API 客户端方法保留（ServerDetailCore Task 6 将复用 `api.unbindInstance`）。

### 下游依赖

- **Task 6**（ServerDetailCore 接收账户级解绑入口）：可从 `panel/frontend/src/pages/guild/GuildBind.tsx` 导入 `AccountBindingRow` 组件，复用 `api.unbindInstance(serverId)` 实现 DELETE `/api/instances/:serverId/bindings` 解绑。
