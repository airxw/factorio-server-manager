# 项目验证、修复与本地部署（支持 Web 初始化）Spec

## Why
项目从 Windows 环境迁移到 Linux（WSL）后存在路径错误等问题，需要检查整个项目能否正常工作并修复。同时用户希望在本地部署前后端进行测试，且要通过 Web 界面完成首次初始化（安装向导），因此需要将项目重置为未初始化状态并确保安装向导流程可用。

## What Changes
- **修复** `config/database.json` 中的 Windows 路径问题（`D:\\trae\\...` 在 Linux 无效）
- **重置初始化状态**：备份并移除已存在的 `config/database.json` 与 `data/manager.db`，使项目回到未初始化状态，让用户通过 Web 安装向导完成初始化
- **修复** 安装向导前后端 API 字段不一致：前端 `Setup.tsx` 读取 `result.migrationsRun`，但后端 `/api/setup/database` 未返回该字段
- **新增** 未初始化时从 `/login` 自动重定向到 `/setup` 的前端逻辑，引导用户进入安装向导
- **调整** `.env` 中 `NODE_ENV` 为 `development`，适配本地开发部署
- **验证** 后端 TypeScript 编译通过、前端 Vite 构建通过
- **部署** 本地启动前后端开发服务器（后端 3000 端口，前端 5173 端口）

## Impact
- Affected specs: `build-factorio-server-manager`（原项目构建 spec，本次为验证与修复，不改变其设计）
- Affected code:
  - [backend/config/database.json](file:///home/air/Desktop/factorio/backend/config/database.json) — Windows 路径，需备份后移除
  - [backend/data/manager.db](file:///home/air/Desktop/factorio/backend/data/manager.db) — 已初始化数据库，需备份后移除
  - [backend/src/routes/setup.ts](file:///home/air/Desktop/factorio/backend/src/routes/setup.ts) — 补充返回 `migrationsRun` 字段
  - [frontend/src/pages/Setup.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Setup.tsx) — 适配后端返回字段
  - [frontend/src/api/client.ts](file:///home/air/Desktop/factorio/frontend/src/api/client.ts) — 修正 `configureDatabase` 返回类型
  - [frontend/src/pages/Login.tsx](file:///home/air/Desktop/factorio/frontend/src/pages/Login.tsx) — 新增未初始化时重定向到 `/setup`
  - [frontend/src/App.tsx](file:///home/air/Desktop/factorio/frontend/src/App.tsx) — 根路由根据初始化状态重定向
  - [backend/.env](file:///home/air/Desktop/factorio/backend/.env) — 调整 `NODE_ENV`

---

## ADDED Requirements

### Requirement: 未初始化时自动引导至安装向导
The system SHALL 在系统未初始化时，将访问 `/login` 或 `/` 的用户自动重定向到 `/setup` 安装向导页面。

#### Scenario: 未初始化访问登录页
- **GIVEN** 系统未完成初始化（`config/database.json` 不存在或无管理员账号）
- **WHEN** 用户访问 `/login` 或根路径 `/`
- **THEN** 前端检测到未初始化状态后自动重定向到 `/setup`
- **AND** 安装向导页面显示数据库配置步骤

#### Scenario: 已初始化访问安装页
- **GIVEN** 系统已完成初始化
- **WHEN** 用户访问 `/setup`
- **THEN** 安装向导显示"安装完成"状态，引导用户前往登录

#### Scenario: 后端不可达
- **GIVEN** 后端服务未启动
- **WHEN** 前端尝试检查初始化状态失败
- **THEN** 显示"无法连接服务器"提示，不进行重定向

### Requirement: 本地开发部署
The system SHALL 支持在本地 Linux 环境通过开发模式启动前后端服务，用于测试。

#### Scenario: 启动开发服务器
- **GIVEN** 项目依赖已安装（`npm install`）
- **WHEN** 执行 `npm run dev`（根目录）
- **THEN** 后端在 `http://localhost:3000` 启动（tsx watch 热重载）
- **AND** 前端在 `http://localhost:5173` 启动（Vite 热重载）
- **AND** 前端通过 Vite 代理将 `/api` 和 `/ws` 请求转发到后端

#### Scenario: 未初始化时后端启动
- **GIVEN** `config/database.json` 不存在
- **WHEN** 后端启动
- **THEN** 控制台输出 `[database] Not configured. Setup wizard required.`
- **AND** 后端正常监听端口，不因缺少数据库配置而崩溃
- **AND** `/api/setup/*` 路由可访问

## MODIFIED Requirements

### Requirement: 安装向导数据库配置接口
后端 `POST /api/setup/database` 接口 SHALL 返回 `migrationsRun` 字段，表示已执行的表创建数量，与前端期望一致。

#### Scenario: 配置数据库成功
- **GIVEN** 用户在安装向导提交有效的数据库配置
- **WHEN** 后端测试连接、保存配置、初始化并建表成功
- **THEN** 返回 `{ configured: true, type: <dbType>, migrationsRun: <表数量> }`
- **AND** 前端正确显示"数据库配置成功，执行了 N 个迁移"

## REMOVED Requirements
无。
