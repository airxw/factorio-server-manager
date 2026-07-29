# 模块0_系统自更新 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

---

## 模块信息

- **模块名**：模块0_系统自更新
- **物理路径**：`modules/模块0_系统自更新/`
- **职责**：面板自身蓝绿部署更新（tar 包下载→SHA256校验→knex迁移→symlink切换→冒烟测试→失败回滚）
- **依赖**：public/（公共契约）、共享 db(knex)
- **Wave**：S4 Batch1（与模块1并行）

---

## 可修改文件范围

```
modules/模块0_系统自更新/
├── systemUpdateService.ts              # 服务实现（implements system-update-service.d.ts）
├── systemUpdateRoute.ts                # 路由工厂（createSystemUpdateRouter）
├── migration_20260717000001_create_system_update_jobs.ts
└── AGENTS.md                            # 本文件
```

**允许修改（装配时）**：`panel/backend/src/index.ts`（仅新增 import + app.use + app.locals.systemUpdateService）

**禁止修改**：`public/` 下任何文件、`panel/backend/src/services/` 既有文件、`panel/frontend/`

---

## gsp 项目规范通用约束（含禁止操作清单）

> 🚨 **public/ 目录保护**：`public/` 目录是契约的物理载体，不是代码库的可变部分。任何删除、修改、覆盖、移动 `public/` 下文件的操作必须先经人类显式授权。契约变更必须走 s0601 流程，不得直接编辑 public/ 文件。

```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容，所有契约以 public/ 下的 schema、interface_stub 为准
  - 禁止在模块间直接导入其他模块的内部实现代码（modules/模块X 不得 import modules/模块Y 内部代码，反之亦然）
  - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现（既有代码未模块化，新模块不得反向依赖）
  - 禁止写入不符合数据契约的数据
  - 禁止创建不符合命名规范的模块目录
  - 禁止使用相对路径跨目录引用（必须用 TS path alias @public/* 或 @modules/*）

binding_rules:
  - 模块间仅允许依赖 public/ 下的契约（schema/、interface_stub/）
  - 所有数据读写必须通过公共契约校验（zod schema）
  - 所有对外接口必须严格匹配契约定义的签名、参数、返回值、异常
  - 共享基础设施（db knex connection、daemonClient、app.locals 注入）通过构造函数注入，不视为模块内部依赖
```

---

## 模块专属约束

1. **支持两种更新类型**：`tar_blue_green`（默认，蓝绿部署）、`git_pull`（可选，git pull 更新）
2. **部署目录结构**：`${DEPLOY_ROOT}/{current,next,previous,shared}`
   - `current` → 当前运行版本 symlink
   - `next` → 新版本解压目录
   - `previous` → 上一版本（回滚用）
   - `shared` → 共享数据（数据库、上传文件等，不参与版本切换）
3. **进程管理器**：systemd（P0），通过 `systemctl restart gameserver-panel` 切换
4. **冒烟测试**：切换后访问 `http://localhost:${SMOKE_TEST_PORT}/health`，超时 `${SMOKE_TEST_TIMEOUT_MS}`，重试 `${SMOKE_TEST_MAX_RETRIES}` 次
5. **状态机**：`pending→downloading→verifying→migrating→switching→smoke_testing→succeeded/failed/rolled_back`（9 态）
6. **失败回滚**：任一步骤失败自动 rollback 到 previous，状态置 `rolled_back`
7. **SHA256 校验**：下载后必须校验 manifest 提供的 sha256，不匹配抛 `SystemUpdateVerifyFailedError`
8. **迁移前置**：`knex migrate:latest` 在 switching 前执行，失败抛 `SystemUpdateMigrationFailedError`
9. **命令注入防护**：所有路径参数经 `path.resolve` 校验在 `DEPLOY_ROOT` 内

---

## 依赖的契约入口

- `public/interface_stub/system-update-service.d.ts` → 接口签名（@version 1.0.0）
- `public/schema/system_update_jobs-schema.json` → 数据契约
- `public/interface_stub/shared-types.d.ts` → `SystemUpdateJobType`, `SystemUpdateJobStatus`, `SystemUpdateJob`, `BuildInfo`, `SystemUpdateInfo`, `PerformUpdateResponse`, `UpdateStatus`
- `public/schema/error-codes-schema.json` → `SYSTEM_UPDATE_001/002/003`, `SYSTEM_JOB_NOT_FOUND`
- `public/config_template/panel-config.schema.json` → `system_update` 配置段
- `public/config_template/panel.env.template` → `UPDATE_SOURCE_TYPE`, `UPDATE_MANIFEST_URL`, `UPDATE_BRANCH`, `DEPLOY_ROOT`, `PROCESS_MANAGER`, `SMOKE_TEST_PORT`, `SMOKE_TEST_TIMEOUT_MS`, `SMOKE_TEST_MAX_RETRIES`

---

## 测试要求

- migration up/down 通过：`knex migrate:up && knex migrate:down`
- `getBuildInfo()` 返回 `{buildTime, gitHash}`，从 `package.json` 或 `BUILD_INFO.json` 读取
- `checkSystemUpdate()` 返回 `{hasUpdate, latestVersion, changelog}`，请求 `UPDATE_MANIFEST_URL`
- `performUpdate()` 异步启动 job，返回 `{jobId}`，不阻塞
- `getUpdateStatus(jobId)` 返回 `{status, step, progress}`
- `rollbackUpdate()` 触发回滚 job，返回 `{jobId}`
- 错误码匹配 `error-codes-schema.json` 定义
- 所有端点经 `authenticateToken` + `requireAdmin` 中间件

---

## 失败回退

- **回退点 R1**：`knex migrate:rollback 20260717000001`
- **回退点 R3**：删除 `modules/模块0_系统自更新/` 目录，不注册路由
- **部署回退**：systemctl 仍指向 current，previous 保留

---

## 闭合判据

- [x] `tsc --noEmit` 通过（v4.19.3 npm run check 验证）
- [x] migration up/down 通过（基线 migration `20260808000000_baseline_v4_post_demo.ts` 已含 system_update_jobs 表）
- [x] 5 个端点均返回正确响应格式（路由已挂载于 routes-registry.ts L944 `/api/system-update`）
- [x] 蓝绿切换 symlink 原子操作验证通过（v4.15.0 部署验证）

> **闭合状态**：v4.19.3 已闭合。运行时接入证据：
> - 路由注册：`panel/backend/src/routes-registry.ts#L99-L947`（`createSystemUpdateRouter` 挂载于 `/api/system-update`）
> - 服务注入：`panel/backend/src/services-init.ts#L65-L242`（`createSystemUpdateService` → `app.locals.systemUpdateService`）
