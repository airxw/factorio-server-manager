# Test3 Mock Checklist

- 时间：2026-07-26 03:08:00
- Skill：`s0402-frontend-triple-gate`
- 验证对象：DaemonNodeStep.tsx v4.22.0 重构（三模式 local/multi/skip + 导入链接解析）
- 状态：`PASS`（含已知缺口登记，未阻断本次前端改动闭合）

## 1. 契约变更核查

- [x] `public/schema/panel-api-types.ts` 新增 3 个类型：`DaemonNodeImportPayload` / `TestDaemonConnectionRequest` / `TestDaemonConnectionResponse`（位于 line 3482–3517），字段描述无歧义、含注释、与后端 `panel/backend/src/api/routes/settings.ts` POST `/api/init/test-daemon` 实现对齐
- [x] 新增类型仅为 MINOR 扩展（新增可选接口与字段），未删除/重命名既有字段，未触发 MAJOR 版本变更，不阻断下游模块
- [x] 后端路由 POST `/api/init/test-daemon` 在 `panel/backend/src/api/routes/settings.ts` 已挂载于 `createPublicInitRouter()`，公开接口（无需鉴权），与前端 `anonymousApi.testDaemonConnection()` 调用路径一致
- [x] `panel/frontend/src/api/client.ts:1922` 与 `panel/frontend/src/api/modules/settings.ts:119` 的 `testDaemonConnection()` 签名严格匹配 `TestDaemonConnectionRequest` 契约

## 2. MSW handlers 适配核查

- [x] `panel/frontend/src/mocks/handlers.ts` 未为本批次改动新增 MSW handler —— 本次评估为可接受，原因如下：
  - DaemonNodeStep.test.tsx 使用 `vi.fn()` 注入回调（onTestLocal / onTestAndImport），不触发真实 fetch，无需 MSW handler
  - SetupWizard.test.tsx 现有用例未覆盖 v4.22.0 Step 3 三模式流程，未触发 `/api/init/test-daemon`
- [ ] **已知缺口（登记不阻断）**：`/api/init/test-daemon` 未在默认 `handlers.ts` 中提供 mock fixture。若后续 SetupWizard.test.tsx 扩展覆盖 Step 3 完整流程（含实际 API 调用），需补 `http.post('/api/init/test-daemon', ...)` handler，否则 `onUnhandledRequest: 'error'` 会触发测试失败
- [x] 既有 handlers 未发生语义漂移：`/api/init/status`、`/api/init/preflight`、`/api/init/test-database`、`/api/init/restart` 保持原有 mock 契约，未被本次改动触碰

## 3. pre_generated_mock / global_mock 核查

- [x] `public/pre_generated_mock/` 未涉及 Daemon 节点导入相关 mock（该目录按模块组织，DaemonNodeStep 通过 props 注入回调，无独立 mock 资产需求）
- [x] `public/global_mock/` 未涉及本次改动，无覆盖需求

## 4. 单测对 Mock 的隔离使用核查

- [x] `DaemonNodeStep.test.tsx` 通过 `renderWithProviders` + `vi.fn()` 隔离测试组件，不依赖任何 MSW/HTTP 层，避免把后端契约验证混入纯 UI 组件测试
- [x] `parseDaemonImportLink` 纯函数单测直接调用导出函数，无 Mock 依赖，覆盖 7 种边界（空串、缺前缀、合法、含可选字段、port 非数字、缺 token、base64 损坏）

## 5. 结论

本次 v4.22.0 Daemon 节点配置重构：

1. 契约层（`public/schema/panel-api-types.ts`）新增类型合规，与后端实现一致
2. MSW handlers 层未引入破坏性变更；`/api/init/test-daemon` 缺省 handler 为已知缺口，需在后续扩展 SetupWizard 端到端单测时补齐
3. 单测层（DaemonNodeStep.test.tsx）通过 `vi.fn()` 隔离，未发现 Mock 漂移风险

从 Mock 回归角度看，本次改动可宣告 `PASS`，已知缺口已登记为后续测试资产扩展的待办项，不构成前端闭合阻断。
