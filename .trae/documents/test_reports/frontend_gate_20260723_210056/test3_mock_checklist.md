# Test3 Mock Checklist

- 时间: 2026-07-23 21:01:00
- 结果: PASS

## 核查范围

- `panel/frontend/src/mocks/handlers.ts`
- `panel/frontend/src/pages/Landing.test.tsx`
- `panel/frontend/src/admin/commercial/index.tsx`
- `public/pre_generated_mock/`

## 检查项

- [x] 本次首页改版未修改 MSW handler、mock token、mock API 契约
- [x] Landing 单测继续使用 `useAuth` mock，不依赖真实后端即可验证页面结构
- [x] 项目现有 mock 资源目录仍存在，未被破坏
- [x] 生产构建产物通过违规地址校验
- [x] 线上验证使用正式入口完成，不依赖 mock 才能展示 Landing

## 备注

本次改动主要是首页文案、结构和支持游戏展示，未触碰 mock 数据定义本身。
因此 Test3 采用 Mock 依赖稳定性检查而非新增 mock 回归脚本，当前未发现首页改版引入 mock 路径漂移。
