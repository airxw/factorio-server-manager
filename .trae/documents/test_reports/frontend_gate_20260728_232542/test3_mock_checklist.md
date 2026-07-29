# Test3 Mock Regression Checklist

- [x] 影响接口已核对：`ServerDetail.tsx` 使用 `api.getServer()`、`api.listPacks()`、`api.cleanupSubdir()`、`api.deleteServer()`。
- [x] 单元测试已覆盖本次改动的主要交互面：`src/pages/__tests__/ServerDetail.test.tsx` 通过直接 mock `useAuth().api` 覆盖 store 模式文案、导航回退、商城管理跳转、移动端单一 `tablist`。
- [x] 现有 MSW 处理器仍与接口契约一致：`src/mocks/handlers.ts` 已存在 `/api/servers/:id`、`/api/servers/:id/delete`、`/api/servers/:id/start`、`/api/servers/:id/stop`、`/api/packs`、`/api/store/servers` 等相关路径；本次结构优化未引入新的 API 路径。
- [x] 本次改动未修改后端返回结构，仅调整前端渲染与导航语义，因此无需新增或改写 MSW fixture。
- [x] Mock 回归结论：通过。当前 mock 层无漂移，Test2 失败来源于生产环境尚未部署新页面结构，而非 mock 契约失配。

## 备注

- 证据链路径：`.trae/documents/test_reports/frontend_gate_20260728_232542/`
- 本轮未新增 mock 文件。
- 若获准部署并完成线上更新，只需重跑 Test2 Playwright，无需补改 Test3。
