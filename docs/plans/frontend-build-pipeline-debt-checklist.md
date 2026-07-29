# 前端构建链路化债清单

更新时间：2026-07-29

## 已完成

- [x] 将 `panel/frontend` 的日常 `build` 从 `tsc && vite build && verify` 拆成纯 `vite build`
- [x] 新增 `build:release`，保留 `typecheck + build + verify` 的发布门禁链路
- [x] 将部署脚本的前端构建入口切到 `npm run build:release`
- [x] 将 `visualizer()` 改为仅在 `ANALYZE=1` 时注入
- [x] 将前端 `tsconfig` 的检查范围从 `../../public/**/*.ts` 收窄到 `../../public/schema/**/*.ts`
- [x] 为前端类型检查启用 incremental cache

## 下一批优先项

- [ ] 继续拆分 `src/api/client.ts`
- [ ] 评估 `@public/schema/panel-api-types.ts` 的裁剪或分文件生成策略
- [ ] 识别并拆分超大页面组件，优先处理 setup / guild / server detail 链路
- [ ] 评估 `verify` 是否需要增量化或只扫描构建入口产物
- [ ] 跟进 Vite 的 circular dependency warning（`useDestructiveAction` 相关）

## 验证入口

- 本地快速构建：`npm --prefix panel/frontend run build`
- 本地类型检查：`npm --prefix panel/frontend run typecheck`
- 发布链路：`npm --prefix panel/frontend run build:release`
- Bundle 分析：`npm --prefix panel/frontend run build:analyze`

