# Test3 Mock Checklist

- 时间: 2026-07-25 01:56:30
- 结果: PASS

## 核查范围

- `panel/frontend/src/mocks/handlers.ts`
- `panel/frontend/src/pages/DemoExperience.tsx`
- `panel/frontend/src/pages/IdentitySelector.tsx`
- `panel/frontend/src/components/DemoShowcase.tsx`
- `public/pre_generated_mock/`

## 检查项

- [x] 本次 v4.16.0 改动（/demo 页、IdentitySelector demo 分支、BUILD ID、版本同步）未修改 MSW handler、mock token、mock API 契约
- [x] handlers.ts 现存差异为 v4.15.x 会话遗留（/api/my/* 聚合 API），已被 Test1 vitest 170/170 全量覆盖验证通过
- [x] /demo 页为纯前端演示（静态场景数据 + setInterval 轮换），不依赖任何 API/mock 即可渲染
- [x] IdentitySelector demo 分支改为直接导航 /demo，移除 DEMO_CREDENTIALS 登录调用，无新增 API 依赖
- [x] 项目现有 mock 资源目录仍存在，未被破坏
- [x] 生产构建产物通过违规地址校验（npm run verify：无 localhost:3000 / 127.0.0.1:3000）

## 备注

本次改动为纯前端展示层新增（/demo 公开动态演示页）与入口导航修正，未触碰 mock 数据定义本身。
Test3 采用 Mock 依赖稳定性检查：MSW 驱动的 vitest 全套 170/170 通过（Test1 日志同目录
test1_streamlit.log），未发现本次改版引入 mock 路径漂移。
