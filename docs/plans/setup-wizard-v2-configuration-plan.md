---
type: plan
title: Setup Wizard v2 初始化向导全面重构方案
date: 2026-07-25
status: pending-approval
related:
  - docs/plans/setup-wizard-fix-plan.md
  - docs/plans/v4.19.1-deferred-implementation-plan.md
  - panel/backend/src/services/initPreflightService.ts
  - panel/backend/src/api/routes/settings.ts
  - panel/frontend/src/pages/SetupWizard.tsx
  - panel/backend/src/db/migrations/20260808000000_baseline_v4_post_demo.ts
  - panel/backend/.env.example
  - deploy.sh
tags: [setup-wizard, preflight, database-config, daemon-node, public-url, env-write, systemd-restart, v4.20.0]
---

# Setup Wizard v2 初始化向导全面重构方案

## 一、背景与问题诊断

### 1.1 当前 Setup Wizard 的设计自相矛盾

当前 `/setup` 向导顶部标语是"首次使用前请完成初始化配置"，但实际 5 步流程中真正可配置的只有 3 项（站点名称、管理员账号、启用 Pack）。而以下三项被放进了 Step 0 环境预检的"检查项"里以 warn/error 形式呈现，却不提供任何修改入口：

| 项 | 当前呈现 | 是否提供修改入口 | 实际修改方式 |
|----|----------|------------------|-------------|
| 数据库类型 | "SQLite at ./data/panel.db（生产环境建议 PostgreSQL）" 标 warn | 否（仅要求勾选"已知悉"） | SSH 改 .env 后重启 |
| Daemon 节点 | 查询 nodes 表，失败标 error / 空表标 warn | 否 | SSH 改 .env 后重启 |
| 公网入口 PUBLIC_BASE_URL | "未配置"标 warn | 否 | SSH 改 .env 后重启 |

这导致用户在 Web 向导里看到一堆"错误/警告"却无法在向导里修复，必须 SSH 进服务器改 .env 再回来刷新——与"完成初始化配置"的承诺自相矛盾。

### 1.2 Daemon 节点预检的真实 Bug

`initPreflightService.ts:177-180` 查询 nodes 表使用了 `orderBy('created_at', 'asc')`，但 nodes 表在 `20260808000000_baseline_v4_post_demo.ts:77-91` 中根本没有 `created_at` 列。表的实际字段为：

```
id, name, fqdn, daemon_token_hash, public_ip, status,
last_seen_at, node_type, comms_key, link_key_hash, linked_at, display_fqdn
```

因此一旦 `DAEMON_URL` 已配置且 `daemonClientService` 已注入，preflight 就必然抛 `SQLITE_ERROR: no such column: created_at`，被 `catch` 后标为 error。这是代码与 schema 不一致的真 bug，与"Daemon 节点未配置"无关。

### 1.3 数据库类型支持的代码已就位但未暴露

`initPreflightService.ts:282-303` 已能识别 `postgresql://` / `postgres://` / `mysql://` 三种 URL 协议并标 ok，说明后端完全支持外部数据库，但向导 UI 没有暴露这个能力，导致用户只能用 SQLite（被警告）或自行 SSH 改 .env。

### 1.4 当前 POST /api/init 接受的字段

`settings.ts:307-500` 当前只接受：`site_name / admin / enabled_packs / mode / database_ack`。完全没有 `database_url / daemon_nodes / public_base_url` 字段。

## 二、目标

1. **修复 Daemon preflight bug**：消除 `no such column: created_at` 错误。
2. **Setup Wizard 重构为真正的初始化向导**：把"数据库类型选择"、"Daemon 节点配置"、"公网入口配置"从预检项变成可填写步骤。
3. **数据库连接可在向导内选择并测试**：支持 SQLite / MySQL / PostgreSQL 三选一，填写连接串后可"测试连接"，通过后写入 .env。
4. **Daemon 节点可在向导内添加**：即使单机模式也明确告知，支持添加首节点（FQDN + Daemon Token + 公网 IP）。
5. **公网入口可在向导内填写**：填 PUBLIC_BASE_URL，校验 HTTPS，写入 .env。
6. **提交后自动重启 Panel 后端**：写入 .env 后触发 `systemctl restart gameserver-panel`，前端等待重连。
7. **保留向后兼容**：演示模式、已初始化部署、单机模式均不破坏。

## 三、现状分析

### 3.1 当前 Setup Wizard 5 步流程

来源：[panel/frontend/src/pages/SetupWizard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx)

| Step | 名称 | 可填字段 | 备注 |
|------|------|---------|------|
| 0 | 环境预检 | 无（只读 + db_config warn 时 ack） | 8 项检查 |
| 1 | 运行模式 | 无（只读） | 由 `VITE_ENABLE_DEMO` 决定 |
| 2 | 站点信息 | `site.name` | 单字段 |
| 3 | 管理员账号 | email / username / password | 含密码策略校验 |
| 4 | 启用游戏 Pack | `enabled_packs` 多选 | 默认全选 |
| 5 | 完成 | 无 | 跳转登录 |

### 3.2 preflight 8 项检查

来源：[initPreflightService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/initPreflightService.ts)

```
1. database       — SELECT 1 连通性
2. migrations     — knex_migrations 最新一条
3. daemon         — DAEMON_URL + nodes 表 + getHealth   ← bug 所在
4. packs          — registry.list() 数量
5. db_config      — DATABASE_URL 协议识别
6. mode           — VITE_ENABLE_DEMO
7. disk           — INSTANCES_DIR 剩余空间
8. public_url     — PUBLIC_BASE_URL + HTTPS 校验
```

### 3.3 .env 文件位置与字段

- 路径：`panel/backend/.env`（开发） / `/opt/gameserver-panel/panel/backend/.env`（生产）
- 关键字段（来自 .env.example）：
  ```
  DATABASE_URL=./data/panel.db
  DAEMON_URL=http://localhost:8080
  PUBLIC_BASE_URL=https://gsp.ecsrz.com:3001
  ```
- 当前生产 .env 缺 `PUBLIC_BASE_URL`（与预检 warn 一致）。

### 3.4 systemd 服务名

- `gameserver-panel`：Panel 后端
- `gameserver-daemon`：Daemon 进程
- 重启命令：`systemctl restart gameserver-panel`（需 root，deploy.sh 已用）

### 3.5 nodes 表 schema

来源：[20260808000000_baseline_v4_post_demo.ts:77-91](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260808000000_baseline_v4_post_demo.ts#L77-L91)

```sql
CREATE TABLE IF NOT EXISTS `nodes` (
  `id` varchar(255) PRIMARY KEY,
  `name` varchar(255) NOT NULL,
  `fqdn` varchar(255) NOT NULL,
  `daemon_token_hash` varchar(255) NOT NULL,
  `public_ip` varchar(255) NULL,
  `status` varchar(255) NOT NULL DEFAULT 'offline',
  `last_seen_at` text NULL,
  `node_type` varchar(255) NOT NULL DEFAULT 'master',
  `comms_key` varchar(255) NULL DEFAULT NULL,
  `link_key_hash` varchar(255) NULL DEFAULT NULL,
  `linked_at` text NULL,
  `display_fqdn` varchar(255) NULL
)
```

## 四、改造设计

### 4.1 重构后的 8 步流程

| Step | 名称 | 可填字段 | 备注 |
|------|------|---------|------|
| 0 | 环境预检 | 无（只读） | warn 项不再强制 ack，提示"可在后续步骤配置" |
| 1 | 运行模式 | 无（只读） | 不变 |
| 2 | **数据库连接**（新） | 类型 / 连接串 / 测试连接 | 写入 .env `DATABASE_URL` |
| 3 | **Daemon 节点**（新） | 节点列表 + 添加节点表单 | 写入 nodes 表 + 可选写入 .env `DAEMON_URL` |
| 4 | 站点信息 + **公网入口**（合并） | `site.name` + `PUBLIC_BASE_URL` | 写入 system_config + .env |
| 5 | 管理员账号 | email / username / password | 不变 |
| 6 | 启用游戏 Pack | `enabled_packs` 多选 | 不变 |
| 7 | 完成 + 重启提示 | 触发重启 | 前端等待重连 |

### 4.2 数据库连接配置策略（用户已选定）

**向导内填写 + 测试连接 + 写入 .env + 自动重启**

- 用户在 Step 2 选择数据库类型（SQLite / MySQL / PostgreSQL）
- 根据类型展示对应的连接串模板：
  - SQLite：文件路径输入框（默认 `./data/panel.db`）
  - MySQL：`mysql://user:password@host:port/database`
  - PostgreSQL：`postgresql://user:password@host:port/database`
- "测试连接"按钮 → 后端临时建连验证（不写入 .env）
- 测试通过后才允许"下一步"
- 提交时后端写入 .env `DATABASE_URL` 字段（备份原 .env 到 `.env.bak.<timestamp>`）
- **关键决策：数据库变更需要重启 Panel 后端才能生效**，因此采用"两阶段提交"：
  - **阶段一（Step 2~6 收集）**：用户依次填写数据库、Daemon、站点、管理员、Pack 等所有配置，前端缓存在内存
  - **阶段二（Step 7 一次性提交）**：`POST /api/init` 一次性接收所有字段，后端原子写入 .env + nodes 表 + system_config，然后触发 `systemctl restart gameserver-panel`
  - 重启后前端轮询 `/api/health`，待 200 后跳转登录页

### 4.3 Daemon 节点配置策略

- Step 3 显示当前 nodes 表中的节点列表（默认空）
- 提供"添加节点"表单：
  - `name`：节点显示名（如 "主节点"）
  - `fqdn`：节点 FQDN 或 IP（如 `gsp.ecsrz.com`）
  - `public_ip`：公网 IP（可选）
  - `daemon_token`：Daemon 通信 token（明文输入，后端 hash 后存 `daemon_token_hash`）
  - `node_type`：`master` / `worker`（默认 master）
- 提交时后端：
  - 生成 UUID 作为 `id`
  - bcrypt hash `daemon_token` 存 `daemon_token_hash`
  - 写入 nodes 表
  - 若是首个节点，同步写入 .env `DAEMON_URL=http://<fqdn>:8080`
- 单机模式按钮："暂不配置 Daemon（单机模式）" → 跳过本步，DAEMON_URL 留空

### 4.4 公网入口配置策略

- 与 Step 4 站点信息合并
- `PUBLIC_BASE_URL` 输入框（默认空，placeholder `https://gsp.ecsrz.com:3001`）
- 实时校验：
  - 必须以 `http://` 或 `https://` 开头
  - 若为 `http://` 标 warn（建议 HTTPS）
  - 若为 `https://` 标 ok
- 提交时写入 .env `PUBLIC_BASE_URL`

### 4.5 .env 写入服务设计

新增后端服务 `EnvFileService`：

- `readEnvFile(): Promise<Record<string, string>>` — 读取 .env 为 KV
- `writeEnvFile(updates: Record<string, string>): Promise<void>` — 原子写入
  - 备份原文件到 `.env.bak.<YYYYMMDDHHmmss>`
  - 保留原文件注释与空行结构
  - 仅更新 `updates` 中提供的字段，其他字段保持不变
- `validateEnvPath(): Promise<void>` — 校验 .env 路径可写
- 路径解析：`path.resolve(process.cwd(), '.env')`（Panel 后端 cwd = `panel/backend/`，生产为 `/opt/gameserver-panel/panel/backend/`）

### 4.6 自动重启机制

- 后端新增 `POST /api/init/restart` 接口：
  - 仅在 `POST /api/init` 成功后可调用（用一次性 token）
  - 调用 `systemctl restart gameserver-panel`
  - 由于重启会杀死自身进程，接口需先返回 200 再触发重启（用 `setImmediate` + `process.exit` 或 `child_process.exec` 异步触发）
- 前端轮询 `/api/health`（间隔 2s，超时 60s），成功后跳转 `/login`

### 4.7 preflight 检查项调整

- `daemon` 检查的 `orderBy('created_at', 'asc')` → `orderBy('id', 'asc')`（修 bug）
- `db_config` warn 措辞改为 info：`SQLite at ./data/panel.db（可在下一步切换为 MySQL/PostgreSQL）`
- `public_url` warn 措辞改为 info：`PUBLIC_BASE_URL 未配置（可在站点信息步骤填写）`
- Step 0 不再要求 `dbConfigAck`，warn 项不阻塞下一步

### 4.8 契约扩展

扩展 `public/schema/panel-api-types.ts`：

```ts
// 新增：数据库类型枚举
export type DatabaseType = 'sqlite' | 'mysql' | 'postgresql';

// 新增：数据库连接配置
export interface DatabaseConfig {
  type: DatabaseType;
  url: string; // 完整连接串
}

// 新增：Daemon 节点配置（向导提交用）
export interface DaemonNodeInput {
  name: string;
  fqdn: string;
  public_ip?: string;
  daemon_token: string; // 明文，后端 hash
  node_type?: 'master' | 'worker';
}

// 扩展：InitRequest 新增字段
export interface InitRequest {
  site_name: string;
  admin: { ... };           // 保留
  enabled_packs: string[];  // 保留
  mode?: 'demo' | 'production';
  database_ack?: boolean;   // 保留（向后兼容）
  // ↓ 新增
  database?: DatabaseConfig;
  daemon_nodes?: DaemonNodeInput[];
  public_base_url?: string;
  skip_daemon?: boolean; // 单机模式
}

// 新增：测试连接请求/响应
export interface TestDatabaseConnectionRequest {
  type: DatabaseType;
  url: string;
}
export interface TestDatabaseConnectionResponse {
  ok: boolean;
  latency_ms?: number;
  error?: string;
  server_version?: string;
}

// 新增：重启触发响应
export interface RestartTriggerResponse {
  triggered: boolean;
  restart_token: string; // 一次性 token，用于前端轮询
}
```

## 五、执行步骤

> 按 user_rules：本节仅列执行步骤与开发事项，不区分优先级、不计人力工期。

### 5.1 阶段一：Bug 修复与契约扩展（前置）

1. 修复 `initPreflightService.ts:179` 的 `orderBy('created_at', 'asc')` → `orderBy('id', 'asc')`
2. 调整 preflight 措辞：
   - `db_config` SQLite warn → info（提示可在下一步配置）
   - `public_url` 未配置 warn → info（提示可在站点信息步骤配置）
3. 扩展 `public/schema/panel-api-types.ts`：
   - 新增 `DatabaseType` / `DatabaseConfig` / `DaemonNodeInput` 类型
   - 扩展 `InitRequest` 增加 `database / daemon_nodes / public_base_url / skip_daemon` 字段
   - 新增 `TestDatabaseConnectionRequest/Response` / `RestartTriggerResponse`
4. 更新 `public/pre_generated_mock/` 中相关 Mock

### 5.2 阶段二：后端服务实现

5. 新增 `panel/backend/src/services/envFileService.ts`：
   - `readEnvFile()` / `writeEnvFile(updates)` / `validateEnvPath()`
   - 原子写入 + 自动备份
   - 单测：`envFileService.test.ts`（覆盖读/写/备份/字段保留/异常路径）
6. 新增 `panel/backend/src/services/databaseTestService.ts`：
   - `testConnection(type, url): Promise<{ ok, latency_ms, server_version, error }>`
   - SQLite：建临时连接 `SELECT 1`
   - MySQL/PG：用 `mysql2` / `pg` 临时建连 `SELECT 1`，超时 5s
   - 单测：`databaseTestService.test.ts`
7. 扩展 `panel/backend/src/api/routes/settings.ts`：
   - 新增 `POST /api/init/test-database`：测试数据库连接（不写 .env）
   - 扩展 `POST /api/init`：接受 `database / daemon_nodes / public_base_url / skip_daemon` 字段
   - 新增 `POST /api/init/restart`：触发 systemctl 重启（需一次性 restart_token）
   - 提交逻辑顺序：
     1. 写入 .env（database.url / public_base_url / daemon_url）
     2. 写入 nodes 表（daemon_nodes）
     3. 写入 system_config（site.name / system.mode / system.preflight_passed）
     4. 更新 admin 密码/邮箱/用户名
     5. 写入 games.enabled_packs
     6. 返回 restart_token
8. 新增 `panel/backend/src/services/restartService.ts`：
   - `triggerPanelRestart(restart_token)`: 异步执行 `systemctl restart gameserver-panel`
   - 通过 `child_process.spawn` + `detached: true` + `stdio: 'ignore'` + `unref()`，确保父进程退出后命令仍执行
   - 单测：mock `child_process`，验证命令参数

### 5.3 阶段三：前端向导重构

9. 重构 `panel/frontend/src/pages/SetupWizard.tsx`：
   - 步骤流改为 8 步（0~7）
   - `SetupStepIndicator` 适配新步骤
   - 状态管理扩展：增加 `databaseConfig / daemonNodes / publicBaseUrl / skipDaemon` state
10. 新增 `panel/frontend/src/pages/setup/DatabaseConfigStep.tsx`：
    - 数据库类型单选（SQLite / MySQL / PostgreSQL）
    - 连接串输入框（按类型切换 placeholder）
    - "测试连接"按钮 → 调 `POST /api/init/test-database`，展示结果
    - 测试通过才允许下一步
11. 新增 `panel/frontend/src/pages/setup/DaemonNodeStep.tsx`：
    - 节点列表（默认空）
    - "添加节点"按钮 → 弹出表单（name / fqdn / public_ip / daemon_token / node_type）
    - "暂不配置（单机模式）"按钮 → 跳过
    - 至少添加 1 个节点或选择单机模式才允许下一步
12. 重构 `panel/frontend/src/pages/setup/SiteInfoStep.tsx`（原 Step 2 扩展）：
    - 站点名称输入框（保留）
    - 新增 PUBLIC_BASE_URL 输入框
    - 实时 HTTPS 校验
13. 新增 `panel/frontend/src/pages/setup/RestartStep.tsx`（新 Step 7）：
    - 显示"正在应用配置并重启服务…"
    - 调 `POST /api/init/restart`，然后轮询 `/api/health`
    - 成功后跳转 `/login`，失败显示日志

### 5.4 阶段四：测试

14. 后端单测：
    - `envFileService.test.ts`：读/写/备份/字段保留
    - `databaseTestService.test.ts`：三种类型 + 失败场景
    - `restartService.test.ts`：mock child_process
    - `settings.test.ts` 扩展：新字段校验 + 路由覆盖
15. 前端组件测试：
    - `SetupWizard.test.tsx` 扩展：8 步流程 + 数据库测试连接 + Daemon 节点添加 + 重启轮询
    - `DatabaseConfigStep.test.tsx`：类型切换 + 测试连接 mock
    - `DaemonNodeStep.test.tsx`：添加/删除节点 + 单机模式
16. E2E：
    - `setup-wizard.spec.ts` 扩展：完整 8 步流程 + 数据库切换为 MySQL（用 docker-compose 起 mysql）+ 重启后跳转登录
17. 浏览器回归：
    - 访问 `https://gsp.ecsrz.com:3001/setup` 完整跑通
    - 验证 SQLite 默认路径 + 切换为 MySQL/PG + 测试连接
    - 验证 Daemon 节点添加 + 健康检查
    - 验证 PUBLIC_BASE_URL 填写 + HTTPS 校验
    - 验证重启后跳转登录

### 5.5 阶段五：部署与文档

18. 更新 `deploy.sh`：
    - 确认 systemd 服务文件 `gameserver-panel.service` 的 User 有 `systemctl restart gameserver-panel` 的 sudo 权限（通过 sudoers 配置）
    - 或改用 `pkexec` / `polkit` 替代方案
19. 更新 `panel/backend/.env.example`：增加注释说明可在向导内配置
20. 更新 `version.md`：v4.20.0 变更说明（setup wizard v2 重构）
21. 更新 `README.md`：首启动流程说明
22. 部署到生产，浏览器实测全流程

## 六、开发事项清单

### 6.1 后端

- [ ] `initPreflightService.ts:179` 修 `orderBy('created_at', 'asc')` → `orderBy('id', 'asc')`
- [ ] `initPreflightService.ts` `checkDatabaseConfig` warn 措辞改 info（提示可在向导内配置）
- [ ] `initPreflightService.ts` `checkPublicBaseURL` warn 措辞改 info
- [ ] `public/schema/panel-api-types.ts` 新增 `DatabaseType / DatabaseConfig / DaemonNodeInput` 类型
- [ ] `public/schema/panel-api-types.ts` 扩展 `InitRequest` 增加 `database / daemon_nodes / public_base_url / skip_daemon`
- [ ] `public/schema/panel-api-types.ts` 新增 `TestDatabaseConnectionRequest/Response` / `RestartTriggerResponse`
- [ ] 新增 `panel/backend/src/services/envFileService.ts` + 单测
- [ ] 新增 `panel/backend/src/services/databaseTestService.ts` + 单测
- [ ] 新增 `panel/backend/src/services/restartService.ts` + 单测
- [ ] `panel/backend/src/api/routes/settings.ts` 新增 `POST /api/init/test-database`
- [ ] `panel/backend/src/api/routes/settings.ts` 扩展 `POST /api/init` 接受新字段
- [ ] `panel/backend/src/api/routes/settings.ts` 新增 `POST /api/init/restart`
- [ ] `panel/backend/src/routes-registry.ts` 注册新路由
- [ ] `panel/backend/src/app.ts`（或入口）注入 `envFileService` / `databaseTestService` / `restartService` 到 `app.locals`
- [ ] 安装依赖：`mysql2` / `pg`（若未安装）

### 6.2 前端

- [ ] 重构 `panel/frontend/src/pages/SetupWizard.tsx` 为 8 步流程
- [ ] 新增 `panel/frontend/src/pages/setup/DatabaseConfigStep.tsx`
- [ ] 新增 `panel/frontend/src/pages/setup/DaemonNodeStep.tsx`
- [ ] 重构 Step 2 站点信息为 `SiteInfoStep.tsx`（含 PUBLIC_BASE_URL）
- [ ] 新增 `panel/frontend/src/pages/setup/RestartStep.tsx`
- [ ] `panel/frontend/src/api/client.ts` 新增 `testDatabaseConnection / submitInitWithConfig / triggerRestart` 方法
- [ ] 移除 Step 0 `dbConfigAck` 强制勾选逻辑
- [ ] `SetupWizard.test.tsx` 扩展覆盖 8 步流程
- [ ] 新增 `DatabaseConfigStep.test.tsx`
- [ ] 新增 `DaemonNodeStep.test.tsx`

### 6.3 测试

- [ ] 后端单测全绿
- [ ] 前端组件测试全绿
- [ ] E2E `setup-wizard.spec.ts` 扩展覆盖完整流程
- [ ] 浏览器手动验证（HTTPS 公网入口 + 局域网各一次）

### 6.4 部署与文档

- [ ] `deploy.sh` 增加 sudoers 配置（允许 gameserver 用户 `systemctl restart gameserver-panel`）
- [ ] `panel/backend/.env.example` 增加向导配置说明注释
- [ ] `version.md` 增加 v4.20.0 条目
- [ ] `README.md` 更新首启动流程
- [ ] 部署到生产 + 浏览器实测

## 七、风险与建议

### 7.1 风险

1. **数据库切换需重启 Panel 后端**：用户在 Step 2 测试连接通过后，配置并不会立即生效，必须等 Step 7 提交后重启才生效。若用户中途放弃，已填的配置丢失。建议：前端在 Step 2~6 之间用 sessionStorage 持久化草稿，刷新不丢。

2. **systemctl 重启权限**：Panel 后端以 `gameserver` 用户运行，默认无 `systemctl restart` 权限。需在 `/etc/sudoers.d/gameserver-panel` 添加：`gameserver ALL=(root) NOPASSWD: /bin/systemctl restart gameserver-panel`。deploy.sh 需同步配置。

3. **重启过程中的请求失败**：`POST /api/init/restart` 返回 200 后，前端轮询 `/api/health` 期间后端进程已被杀，可能出现 ECONNREFUSED。前端需容忍 5xx / 网络错误，持续轮询直到 200。

4. **.env 写入并发安全**：若用户在向导提交期间通过其他途径修改 .env，可能丢失配置。建议写入前重新读取 .env，merge 后写入（不直接覆盖）。

5. **Daemon 节点 token 明文传输**：前端表单提交 daemon_token 明文，后端 hash 存储。需确保全程 HTTPS（已由 nginx 3001 端口保证）。向导在未配置 PUBLIC_BASE_URL 时仍走 HTTPS（nginx 默认证书）。

6. **MySQL/PG 依赖体积**：新增 `mysql2` / `pg` 依赖会增加 node_modules 体积。建议改为动态 import（`await import('mysql2')`），仅在用户选择对应类型时加载。

7. **演示模式兼容**：`VITE_ENABLE_DEMO=true` 时仍走原"短路"逻辑，不真正写入 .env / nodes 表，仅模拟流程。需在 SetupWizard v2 中保留 demo 模式跳过逻辑。

### 7.2 建议

1. **分阶段合流**：阶段一第 1 项（Daemon bug 修复 + 测试 schema 对齐）已合流为 v4.19.4 hotfix；阶段一第 2~4 项（措辞调整 + 契约扩展 + Mock 更新）+ 阶段二~五作为 v4.20.0 主版本发布。
2. **保留 .env.bak 备份**：写入 .env 前必须备份，便于回滚。
3. **提供"恢复默认"按钮**：Step 2 数据库配置提供"恢复为 SQLite 默认"快捷按钮。
4. **Step 7 重启失败兜底**：若 60s 内 `/api/health` 不通，显示"请手动 SSH 检查：journalctl -u gameserver-panel -n 50"。
5. **首次预检仍保留**：Step 0 仍展示 8 项检查，但 warn 项不阻塞，仅作为"现状展示"，让用户知道"哪些已就绪、哪些需要在后续步骤配置"。
6. **公网入口校验放宽**：允许 `http://` 但标 warn（开发/局域网场景），不强制 HTTPS。
7. **Daemon 节点表单安全**：daemon_token 字段用 `type="password"`，并在提交后立刻清空前端 state。

## 八、验证清单

### 8.1 Bug 修复验证

- [ ] `DAEMON_URL` 已配置 + nodes 表非空时，preflight 不再报 `no such column: created_at`
- [ ] `orderBy` 改为 `id` 后，能正确取到第一个节点并执行健康检查

### 8.2 向导流程验证

- [ ] 全新部署访问 `/setup` 进入 Step 0，8 项预检显示
- [ ] Step 2 可选 SQLite / MySQL / PostgreSQL 三种类型
- [ ] Step 2 "测试连接"按钮：SQLite 默认路径 → ok；MySQL 错误密码 → 显示错误
- [ ] Step 3 可添加 Daemon 节点，提交后 nodes 表有记录
- [ ] Step 3 "单机模式"按钮可跳过
- [ ] Step 4 PUBLIC_BASE_URL 输入 `https://gsp.ecsrz.com:3001` → 校验通过
- [ ] Step 5 管理员密码策略实时校验
- [ ] Step 6 Pack 多选
- [ ] Step 7 提交后：.env 已更新（含 DATABASE_URL / DAEMON_URL / PUBLIC_BASE_URL）、nodes 表有记录、system_config 有 site.name、admin 密码已改、Pack 已启用
- [ ] Step 7 触发 `systemctl restart gameserver-panel`，前端轮询 `/api/health` 200 后跳转 `/login`
- [ ] 用新密码登录成功

### 8.3 向后兼容验证

- [ ] 已初始化部署访问 `/setup` → 跳转 `/login`（不进入向导）
- [ ] `VITE_ENABLE_DEMO=true` 时向导走短路逻辑（不真正写入）
- [ ] 旧字段 `admin_password / database_ack` 仍被接受（向后兼容）

### 8.4 部署验证

- [ ] `npm run check` 全绿
- [ ] `npm run verify` 全绿（前后端 type-check + 单测）
- [ ] 生产部署后浏览器实测 `https://gsp.ecsrz.com:3001/setup` 全流程
- [ ] `systemctl status gameserver-panel` 在重启后为 active
- [ ] `.env.bak.<timestamp>` 备份文件存在
- [ ] footer BUILD 编号正确显示

## 九、参考

- [Setup Wizard v1 修复方案](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/setup-wizard-fix-plan.md)
- [v4.19.1 推迟实施计划](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/v4.19.1-deferred-implementation-plan.md)
- [initPreflightService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/initPreflightService.ts)
- [settings.ts POST /api/init](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts)
- [SetupWizard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx)
- [nodes 表 schema](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260808000000_baseline_v4_post_demo.ts#L77-L91)
- [deploy.sh systemd 配置](file:///home/airxw/Documents/gsp/gameserver-panel/deploy.sh#L484-L503)
- [rules-0 §四-7.2 ec7_action_gate](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md)（public/ 操作门控）
- [rules-0 §四-10 public/ 保护](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md)
- [bb.md 版本号规则](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/bb.md)
