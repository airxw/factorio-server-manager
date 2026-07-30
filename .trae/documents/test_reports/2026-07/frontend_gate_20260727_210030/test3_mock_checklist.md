# Test3 Mock 回归检查

- 检查对象：`/store` 工作台本轮修复
- 变更范围：
  - `panel/frontend/src/components/Layout.tsx`
  - `panel/frontend/src/pages/store/StoreHome.tsx`
  - `panel/frontend/src/admin/commercial/index.tsx`
  - `panel/frontend/src/pages/admin/InstanceVipUsers.tsx`
  - `panel/frontend/src/App.tsx`

## 结论

- 本轮未修改 `panel/frontend/src/mocks/handlers.ts`、`public/pre_generated_mock/**`、`public/schema/**` 或任何 Mock 契约文件。
- 修复集中在：
  - 路由激活态判定
  - 页面标题
  - 首页区块级错误态
  - 交互反馈与 `/store` 基座内跳转
- 因此 Mock 数据结构与接口桩未发生漂移，静态核对结果为通过。

## 核对项

- [x] 未改动 MSW handlers
- [x] 未改动 public 契约
- [x] 未改动预生成 mock
- [x] 新增 `/store/servers/new` 路由仅复用既有 `CreateServer` 页面，不引入新 mock 依赖
- [x] `StoreHome` 的错误态拆分不依赖新的响应字段

## 备注

- 本次 Test3 采用静态 Mock 回归核对，而非运行式 mock 场景回放；原因是变更未触及 mock 数据源或 mock 路径本身。
