# Tasks

## 阶段一：检查项目并修复错误

### Task 1: 备份并重置初始化状态 — 不再需要
- [x] SubTask 1.1-1.3: ~~备份并移除 database.json / manager.db 以触发 Web 安装向导~~ → **不再需要**。此操作为 Windows→Linux 迁移时的临时步骤，项目已正常部署在 `/opt/gameserver-panel/`（v3.5.2），触发安装向导会破坏现有生产数据，不应再执行。

### Task 2: 修复安装向导前后端 API 字段不一致
- [x] SubTask 2.1: 后端 `POST /api/setup/database` 返回中补充 `migrationsRun` 字段（值为已创建的表数量）
- [x] SubTask 2.2: 前端 `client.ts` 中 `configureDatabase` 返回类型与后端实际返回对齐
- [x] SubTask 2.3: 前端 `Setup.tsx` 中成功提示适配实际返回字段

### Task 3: 新增未初始化时自动重定向到安装向导
- [x] SubTask 3.1: 前端 `Login.tsx` 加载时调用 `getSetupStatus()`，未初始化时重定向到 `/setup`
- [x] SubTask 3.2: 前端 `App.tsx` 根路由 `/` 在未认证且未初始化时重定向到 `/setup`（通过 Login.tsx 重定向实现）

### Task 4: 调整环境配置用于本地开发部署
- [x] SubTask 4.1: 将 `backend/.env` 中 `NODE_ENV` 改为 `development`

### Task 5: 验证项目可编译构建
- [x] SubTask 5.1: 后端 TypeScript 编译通过（`npm run build -w backend`）
- [x] SubTask 5.2: 前端 TypeScript + Vite 构建通过（`npm run build -w frontend`）
- [x] SubTask 5.3: 修复前端编译错误（ShopAdmin/UserAdmin/VipAdmin/Profile/Register/Shop/Orders 缺失 API 函数，AuthContext 缺少 refreshUser）

## 阶段二：本地部署前后端

### Task 6: 安装依赖并启动开发服务器
- [x] SubTask 6.1: 根目录执行 `npm install` 安装 workspaces 依赖（已安装 400 个包）
- [x] SubTask 6.2: 启动后端开发服务器（`npm run dev -w backend`，端口 3000）
- [x] SubTask 6.3: 启动前端开发服务器（`npm run dev -w frontend`，端口 5173）
- [x] SubTask 6.4: 验证后端健康检查 `GET /api/health` 返回 `{ status: "ok" }`
- [x] SubTask 6.5: 验证前端可访问安装向导页面 `http://localhost:5173/setup`（Vite 代理 /api 到后端）

# Task Dependencies
- Task 1（重置初始化状态）无依赖，优先执行
- Task 2、3、4 可并行（互不依赖）
- Task 5 依赖 Task 2、3、4 完成
- Task 6 依赖 Task 1、5 完成
