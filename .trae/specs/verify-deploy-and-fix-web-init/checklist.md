# 验收清单

## 错误修复
- [x] `backend/config/database.json` 已备份为 `.bak` 并移除，项目处于未初始化状态
- [x] `backend/data/manager.db` 已备份为 `.bak`
- [x] 后端 `POST /api/setup/database` 返回包含 `migrationsRun` 字段
- [x] 前端 `configureDatabase` 返回类型与后端实际返回一致
- [x] 前端 `Setup.tsx` 数据库配置成功提示正确显示迁移数量（非 undefined）
- [x] 未初始化时访问 `/login` 自动重定向到 `/setup`
- [x] 未初始化时访问 `/` 自动重定向到 `/setup`（通过 Login.tsx 重定向链实现）
- [x] `backend/.env` 中 `NODE_ENV=development`

## 编译验证
- [x] 后端 TypeScript 编译通过（`npm run build -w backend` 无错误）
- [x] 前端 Vite 构建通过（`npm run build -w frontend` 无错误）

## 本地部署
- [x] `npm install` 依赖安装成功（400 个包）
- [x] 后端开发服务器在 `http://localhost:3000` 启动
- [x] 前端开发服务器在 `http://localhost:5173` 启动
- [x] `GET /api/health` 返回 `{ status: "ok" }`
- [x] `GET /api/setup/status` 返回 `initialized: false`（未初始化状态）
- [x] 前端 `http://localhost:5173/setup` 可访问安装向导页面
- [x] 安装向导页面显示"数据库配置"步骤

## 未初始化状态验证
- [x] 后端控制台输出 `[database] Not configured. Setup wizard required.`
- [x] 后端不会因缺少数据库配置而崩溃
- [x] `/api/setup/*` 路由可正常访问
