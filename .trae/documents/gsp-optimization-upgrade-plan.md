# GSP 优化升级方案 — 补齐短板

> 依据：[GSP vs MSLX 横向对比分析报告](gsp-vs-mslx-comparison-analysis.md) §九 GSP 潜在改进空间
> 当前版本：v4.8.0
> 方案范围：3 项紧急技术债 + 5 项重要功能增强 + 6 项长期架构演进 = 14 项
> 原则：不计人力工期与开发投入，仅输出执行步骤，不区分优先级，只包含开发事项与建议

---

## 〇、方案总览

| 编号 | 改进项 | 类型 | 依赖项 |
|------|--------|------|--------|
| T1 | 后端 Service 单元测试体系 | 测试基建 | — |
| T2 | Daemon 进程管理单元测试体系 | 测试基建 | — |
| T3 | index.ts 拆分（2404 行 → 模块化） | 代码重构 | — |
| I1 | 前端 SSL 证书管理 UI | 功能补齐 | 后端 `/api/system/ssl` 已就位 |
| I2 | 前端 Tunnel 管理 UI | 功能补齐 | 后端 `/api/system/tunnel` 已就位 |
| I3 | 前端 API Key 管理 UI | 功能补齐 | 后端 `/api/api-keys` 已就位 |
| I4 | 前端 Java 扫描展示 | 功能补齐 | 后端 `GET /api/nodes/:id/javas` 已就位 |
| I5 | WebSocket 通知推送（替代 30s 轮询） | 架构优化 | — |
| L1 | 游戏类型注册表化 | 架构演进 | — |
| L2 | Daemon 集群化管理（主从节点） | 架构演进 | L1 |
| L3 | SQLite → PostgreSQL 迁移预备 | 架构演进 | — |
| L4 | Mods 客户端识别（jar 内 mod 元数据扫描） | 功能增强 | — |
| L5 | 配置文件编辑器增强（语法高亮） | 体验增强 | — |
| L6 | DevOps CI/CD 管道补齐 | 工程基建 | T1/T2 |

---

## 一、测试体系建设（T1 + T2 + L6）

### T1. 后端 Service 单元测试体系

**现状**：`panel/backend/package.json` 无 `test` 脚本、无 `vitest` 依赖；44 个 Service 零测试。

**执行步骤**：

1. **添加测试依赖**
   - `panel/backend/package.json` devDependencies 新增：`vitest`、`@vitest/coverage-v8`、`@vitest/ui`
   - scripts 新增：`"test": "vitest run"`、`"test:watch": "vitest"`、`"test:coverage": "vitest run --coverage"`、`"test:ui": "vitest --ui"`

2. **创建 vitest 配置**
   - 新建 `panel/backend/vitest.config.ts`
   - environment: `node`（后端无 DOM）
   - alias: `@` → `./src`、`@public` → `../../public`
   - coverage.exclude: `src/db/migrations/**`、`src/**/*.d.ts`、`src/types/**`
   - coverage.thresholds: 初始设 lines/functions/branches/statements = 5（基线，随测试补充逐步提高）

3. **创建测试基础设施**
   - 新建 `panel/backend/src/test/` 目录
   - `setup.ts`：全局 setup（加载 .env.test、清理 mock）
   - `db-helper.ts`：SQLite 内存数据库工厂（`:memory:` + runMigrations + seed），每个测试独立 DB 实例
   - `mock-factory.ts`：通用 mock 工厂（mockLogger、mockDaemonClient、mockEventBus）
   - `fixtures.ts`：测试数据夹具（validUser、validServer、validPack 等）

4. **优先覆盖 Service（按业务影响排序）**
   - `backupService.test.ts`：备份协议执行（save-off → save-all → tar → save-on）、11 款游戏协议覆盖、finally 块 save-on 恢复、daemonClient.sendCommand 调用验证
   - `shopService.test.ts`：createOrder（VIP 折扣计算、库存校验、取件码生成、直接发放模式）、claimOrder（取件码校验、重复领取拦截、CDK 兑换）
   - `playerManagementService.test.ts`：kick/ban/pardon/op/deop/whitelistAdd/whitelistRemove 命令模板渲染、三级回退（pack.commands → pack.business → DEFAULT_TEMPLATES）、防注入校验
   - `apiKeyService.test.ts`：generateApiKey（前缀+熵）、hashApiKey（SHA-256）、verifyApiKey（过期/撤销/用户禁用）、角色冻结（创建后用户角色变化不影响 key）
   - `auth.test.ts`（中间件）：JWT 路径、API Key 路径、角色守卫、token 过期、token 篡改
   - `passwordPolicy.test.ts`：zxcvbn 强度档位（0/1/2）、最小长度、密码历史校验
   - `scheduler.test.ts`：cron 表达式解析、interval/next_run_at/cron_expr 三种时序、cronIterator 递归
   - `sslService.test.ts`：证书信息解析（X509Certificate）、PEM 格式校验、extractCN 辅助函数、nginx reload 互斥锁
   - `tunnelService.test.ts`：TOML 配置生成、环形缓冲日志、进程 exit/error 事件处理
   - `safeRemoveService.test.ts`：路径穿越防护、白名单校验、namespace 隔离

5. **契约测试（interface_stub 对齐）**
   - 新建 `panel/backend/src/test/contract/` 目录
   - 每个 Service 测试文件末尾追加"签名匹配"断言：验证实现类的方法签名与 `public/interface_stub/*.d.ts` 声明一致
   - 使用 `typescript-eslint` 或自定义脚本在 CI 中强制校验

6. **集成到 CI**
   - `.github/workflows/ci.yml` 新增 `backend-quality` job
   - steps: checkout → setup-node → npm ci → typecheck → test → test:coverage → build
   - 与 `frontend-quality` 并行运行

---

### T2. Daemon 进程管理单元测试体系

**现状**：`daemon/package.json` 无 `test` 脚本、无 `vitest` 依赖；manager.ts（1097 行）零测试。

**执行步骤**：

1. **添加测试依赖**
   - `daemon/package.json` devDependencies 新增：`vitest`、`@vitest/coverage-v8`
   - scripts 新增：`"test": "vitest run"`、`"test:watch": "vitest"`、`"test:coverage": "vitest run --coverage"`

2. **创建 vitest 配置**
   - 新建 `daemon/vitest.config.ts`
   - environment: `node`
   - coverage.exclude: `src/**/*.d.ts`、`src/steamcmd/**`（外部命令包装，集成测试覆盖）
   - coverage.thresholds: 初始 5%

3. **创建 mock 基础设施**
   - 新建 `daemon/src/test/` 目录
   - `mock-child-process.ts`：mock `child_process.spawn`，模拟 stdout/stderr/close/exit 事件序列
   - `mock-pgrep.ts`：mock `pgrep -P` 返回预设进程树
   - `mock-ps.ts`：mock `ps -p` 返回预设 CPU/内存数据
   - `fixtures.ts`：测试实例数据（minecraftInstance、valheimInstance、 crashingInstance）

4. **优先覆盖模块（按风险排序）**
   - `manager.test.ts`（核心）：
     - **三段式退出判定**：模拟 exit 先于 stdout close 的时序 → 验证 `finalizeExit` 不提前触发；三者全 true 后才触发
     - **崩溃熔断**：5 分钟窗口内 5 次崩溃 → 验证放弃重启 + error_detail 字段；窗口外崩溃 → 历史清理；人工 startInstance → 熔断状态清零
     - **稳定窗口**：running 后 30s 内再次崩溃 → 验证不立即清零 restartAttempts
     - **生命周期互斥锁**：并发 start/stop 调用 → 验证串行化 + 第二个调用报错
     - **SIGINT_STOP_GAMES**：valheim/enshrouded/dyson 跳过 stdin stopCommand → 验证直接走 SIGINT
   - `processDriver.test.ts`：
     - **信号升级链**：stdin stopCommand 超时 → SIGTERM → SIGKILL → 强制退出
     - **进程组 kill**：`process.kill(-pid, signal)` 验证负 pid 传参
     - **getChildProcessPids**：mock pgrep 返回多层子进程 → 验证递归穿透 + java 进程名匹配
   - `collector.test.ts`：
     - **CPU 聚合**：父进程 0% + 子进程 50% → 验证聚合为 50%（穿透子进程修复）
     - **内存聚合**：父 100MB + 子 500MB → 验证聚合 600MB
   - `server.test.ts`（WS 订阅）：
     - **subscribe/unsubscribe**：双向索引维护、连接关闭全量清理
     - **消息分发**：subscribe 命令 → 验证 subscribersByInstance 更新

5. **集成到 CI**
   - `.github/workflows/ci.yml` 新增 `daemon-quality` job
   - 与 `frontend-quality` / `backend-quality` 并行

---

### L6. DevOps CI/CD 管道补齐

**现状**：`.github/workflows/ci.yml` 仅覆盖前端（typecheck + lint + unit + coverage + build + e2e）。

**执行步骤**：

1. **CI 覆盖三项目**
   - 新增 `backend-quality` job（依赖 T1 完成）：typecheck + test + test:coverage + build
   - 新增 `daemon-quality` job（依赖 T2 完成）：typecheck + test + test:coverage + build
   - 三个 job 并行运行，互不阻塞

2. **CD 自动部署管道（可选，需 Gitea Actions runner）**
   - 新增 `deploy.yml` workflow，触发条件：push tag `v*.*.*`
   - steps：
     - 三项目并行 build（frontend build → backend build → daemon build）
     - SSH 到部署服务器执行 `deploy.sh update`
     - 健康检查（curl `/api/health`）
     - 失败自动 `deploy.sh --rollback`
   - secrets：`DEPLOY_SSH_KEY`、`DEPLOY_HOST`、`DEPLOY_USER`

3. **PR 模板与分支保护**
   - 新增 `.github/pull_request_template.md`：变更类型 checkbox + 测试覆盖声明 + 迁移脚本声明
   - 分支保护规则：main 分支 require PR + require status checks（三 quality job 全绿）+ require code owner review

4. **版本号自动化校验**
   - 新增脚本 `scripts/check-version-sync.ts`：校验 version.json / 4 个 package.json / README.md / deploy.sh 版本号一致
   - CI 中所有 quality job 后追加 version-sync check step

---

## 二、代码重构（T3）

### T3. index.ts 拆分（2404 行 → 模块化）

**现状**：`panel/backend/src/index.ts` 2404 行，包含 import（120+ 行）+ 配置加载 + DB 初始化 + 中间件注册 + 59 个路由注册 + WebSocket 服务器 + daemonEventStream + scheduler + 启动逻辑。

**执行步骤**：

1. **创建 app 工厂**
   - 新建 `panel/backend/src/app.ts`：`createApp(config): Express` 纯函数
   - 职责：创建 Express 实例 → 注册中间件（cors/helmet/json/logger/rateLimiter/maintenance/audit）→ 返回 app
   - 不包含路由注册、不包含 server.listen

2. **创建路由注册表**
   - 新建 `panel/backend/src/routes-registry.ts`：`registerRoutes(app, deps): void`
   - 接收依赖对象：`{ db, registry, daemonClientService, wsServer, scheduler, ... }`
   - 将 59 个 `app.use(...)` 调用迁移到此文件，按业务域分组注释（packs/nodes/servers/system/auth/admin/...）

3. **创建服务初始化模块**
   - 新建 `panel/backend/src/services-init.ts`：`initServices(db, config): ServiceContainer`
   - 职责：实例化所有 44 个 Service + 4 个模块服务，返回 `ServiceContainer` 对象
   - 消除 index.ts 中散落的服务实例化代码

4. **创建 WebSocket 初始化模块**
   - 新建 `panel/backend/src/websocket-init.ts`：`initWebSocket(server, config, deps): { wsServer, daemonEventStream }`
   - 职责：创建 PanelWsServer + DaemonEventStream + 接线引用计数回调

5. **创建 scheduler 初始化模块**
   - 新建 `panel/backend/src/scheduler-init.ts`：`initScheduler(deps): void`
   - 职责：注册所有 scheduler executor + 注册定时任务

6. **瘦身 index.ts 为纯启动入口**
   - `index.ts` 仅保留：
     - 加载 .env
     - initDatabase → runMigrations → seedAdmin → seedLocalNode → seedDemoInstances
     - initServices → createApp → registerRoutes → initWebSocket → initScheduler
     - server.listen(PORT)
     - graceful shutdown（SIGTERM/SIGINT → closeDatabase → wsServer.close → daemonEventStream.close）
   - 目标行数：< 200 行

7. **验证**
   - `npx tsc --noEmit` 0 errors
   - 启动后端 → `/api/health` 200
   - 所有 59 个路由可达（可用现有 E2E 测试验证）

---

## 三、前端 UI 补齐（I1 + I2 + I3 + I4）

### I1. 前端 SSL 证书管理 UI

**后端已就位**：`/api/system/ssl` 5 个端点（GET 证书信息 / POST reload / POST stage / POST deploy / POST self-signed）。

**执行步骤**：

1. **新建 SSL 管理页面**
   - 新建 `panel/frontend/src/pages/admin/SslManagement.tsx`
   - 三个区块：
     - **当前证书信息卡**：CN / 签发者 / SAN / 有效期 / 指纹 + 剩余天数徽章（<30 天黄色 / <7 天红色）
     - **证书操作区**：
       - 「热重载 nginx」按钮（POST /reload，确认对话框）
       - 「上传新证书」表单（PEM 文本框 + KEY 文本框 → POST /stage → POST /deploy）
       - 「生成自签证书」表单（CN + SAN 多选 → POST /self-signed）
     - **暂存证书区**：展示 `data/ssl/` 中的暂存证书列表 + 部署按钮

2. **API 层**
   - `panel/frontend/src/api/modules/system.ts` 新增：`getSslCertInfo()` / `reloadNginx()` / `stageCertificate(pem, key)` / `deployStagedCert(stagedPath, keyPath)` / `generateSelfSigned(params)`
   - `panel/frontend/src/api/client.ts` 实现上述 5 个方法

3. **路由与侧边栏**
   - `App.tsx` 新增 lazy route：`/admin/ssl`（仅 server_admin）
   - `Layout.tsx` ADMIN_GROUPS「配置管理」分组新增：`{ to: '/admin/ssl', label: 'SSL 证书', icon: ShieldCheck }`
   - PATH_ACTIVE_MAP 新增 `'/admin/ssl': '/admin/ssl'`

4. **契约对齐**
   - `public/schema/panel-api-types.ts` 确认 SSL 相关响应类型已定义（后端已扩展）
   - 前端类型从 `panel-api-types.ts` 导入

---

### I2. 前端 Tunnel 管理 UI

**后端已就位**：`/api/system/tunnel` 6 个端点（status / config / PUT config / start / stop / logs）。

**执行步骤**：

1. **新建 Tunnel 管理页面**
   - 新建 `panel/frontend/src/pages/admin/TunnelManagement.tsx`
   - 三个区块：
     - **状态卡**：frpc 进程状态（运行中/已停止）+ PID + 运行时长 + 启动/停止按钮
     - **配置编辑区**：JSON 表单编辑（server_addr / server_port / auth_token / enabled / tunnels 数组）
       - 每个 tunnel：name / type(tcp/udp/http/https) / local_ip / local_port / custom_domains / remote_port
       - 保存按钮（PUT /config，不自动重启，提示用户手动启动）
     - **日志查看区**：最近 200 条日志（level + message + timestamp），自动刷新开关

2. **API 层**
   - `panel/frontend/src/api/modules/system.ts` 新增：`getTunnelStatus()` / `getTunnelConfig()` / `updateTunnelConfig(config)` / `startTunnel()` / `stopTunnel()` / `getTunnelLogs(limit)`
   - `client.ts` 实现

3. **路由与侧边栏**
   - `App.tsx` 新增 lazy route：`/admin/tunnel`（仅 server_admin）
   - `Layout.tsx` ADMIN_GROUPS「配置管理」分组新增：`{ to: '/admin/tunnel', label: '隧道管理', icon: Network }`

---

### I3. 前端 API Key 管理 UI

**后端已就位**：`/api/api-keys` 4 个端点（GET 列表 / POST 创建 / GET 详情 / DELETE 撤销）。

**执行步骤**：

1. **新建 API Key 管理页面**
   - 新建 `panel/frontend/src/pages/admin/ApiKeys.tsx`
   - 两个区块：
     - **API Key 列表表**：name / key_prefix（gsp_xxxxxxxx...）/ 关联用户 / 角色 / 创建时间 / 最后使用时间 / 状态（活跃/已撤销）/ 操作（撤销按钮）
     - **创建 API Key 表单**：
       - name 输入框
       - user 选择器（server_admin 可选所有用户）
       - role 选择器（不允许选 server_admin，防提权）
       - expires_at 可选日期选择器
       - 创建成功后**一次性**显示完整 API Key（明文仅此一次）+ 复制按钮 + "请妥善保管"警告

2. **API 层**
   - `panel/frontend/src/api/modules/admin.ts` 新增：`listApiKeys()` / `createApiKey(params)` / `getApiKey(id)` / `revokeApiKey(id)`
   - `client.ts` 实现

3. **路由与侧边栏**
   - `App.tsx` 新增 lazy route：`/admin/api-keys`（仅 server_admin）
   - `Layout.tsx` ADMIN_GROUPS「用户与权限」分组新增：`{ to: '/admin/api-keys', label: 'API Keys', icon: KeyRound }`

4. **个人设置页入口**（用户自管理自己的 Key）
   - `panel/frontend/src/pages/Profile.tsx` 新增 "API Keys" Tab
   - 用户只能看到/管理自己的 Key（后端已做权限隔离）

---

### I4. 前端 Java 扫描展示

**后端已就位**：`GET /api/nodes/:id/javas` 返回 `ScanJavasResult`（JavaInstallation 数组）。

**执行步骤**：

1. **节点详情页扩展**
   - 修改 `panel/frontend/src/pages/admin/Nodes.tsx`（或节点详情页）
   - 节点列表每行新增「Java 环境」按钮 → 展开 Java 安装列表
   - 或在节点详情页新增「Java 环境」Tab

2. **Java 安装列表组件**
   - 新建 `panel/frontend/src/components/JavaInstallationsPanel.tsx`
   - 表格列：path / version / vendor / isJDK / isDefault
   - 「重新扫描」按钮（重新调用 GET /api/nodes/:id/javas）
   - 空状态提示：「未检测到 Java 运行时，请先安装 JDK」

3. **API 层**
   - `panel/frontend/src/api/modules/nodes.ts`（或现有模块）新增：`scanNodeJavas(nodeId)`
   - `client.ts` 实现

4. **实例创建页联动**（可选增强）
   - 创建实例时选择节点后 → 自动拉取该节点 Java 列表 → 版本下拉框只显示兼容的 Java 版本

---

## 四、架构优化（I5）

### I5. WebSocket 通知推送（替代 30s 轮询）

**现状**：`panel/frontend/src/components/Layout.tsx` 通知靠 30s setTimeout 链式轮询 `/api/notifications`，失败指数退避最大 60s。

**执行步骤**：

1. **后端：通知事件纳入 WebSocket 通道**
   - `public/schema/ws-events.ts` 新增事件类型：
     - `PanelToFrontendEventType` 新增 `'notification.new'`
     - 新增 `PanelNotificationEvent` 接口：`{ type: 'notification.new', notification: NotificationSummary }`
   - `panel/backend/src/services/notificationService.ts`：创建通知时同时通过 `wsServer.broadcastToUser(userId, event)` 推送
   - `panel/backend/src/websocket/server.ts` 新增 `broadcastToUser(userId, event)` 方法：遍历所有连接，筛选 `conn.userId === userId` 的连接发送事件

2. **后端：未读数变更事件**
   - 新增 `'notification.unread_count'` 事件类型
   - 通知已读 / 全部已读 / 新通知创建时推送未读数变更

3. **前端：WebSocket 通知 Store**
   - 新建 `panel/frontend/src/stores/notificationStore.ts`
   - 复用 `instanceHubStore` 的 WebSocket 连接（或独立连接到 `/ws` 并携带 JWT）
   - 状态：`unreadCount` / `recentNotifications: NotificationSummary[]`（最近 10 条，环形缓冲）
   - `onNotificationNew(handler)` / `onUnreadCountChange(handler)` 返回 unsubscribe

4. **前端：Layout.tsx 改造**
   - 移除 30s setTimeout 链式轮询
   - 铃铛图标未读数改由 `notificationStore.unreadCount` 驱动
   - 铃铛点击展开下拉显示 `recentNotifications`（最近 5 条）+ "查看全部"链接
   - 页面首次加载时调用一次 `GET /api/notifications?unread=true` 初始化未读数（后续由 WS 增量推送）

5. **降级策略**
   - WebSocket 连接断开时降级为 30s 轮询（保留现有轮询代码作为 fallback）
   - WebSocket 重连后立即拉取一次未读数（补齐断线期间漏掉的通知）

6. **验证**
   - 创建通知（订单领取 / VIP 调整 / CDK 兑换）→ 前端铃铛 1s 内更新未读数
   - 断开网络 → 恢复 → 未读数自动同步

---

## 五、长期架构演进（L1 + L2 + L3 + L4 + L5）

### L1. 游戏类型注册表化

**现状**：`public/schema/pack-schema.ts` `GameTypeSchema` 是 `z.enum([...13 个硬编码值...])`；`daemon/src/instances/bootstrap.ts` 是 `switch(gameType)` 大分支。

**执行步骤**：

1. **定义 GameTypeAdapter 接口**
   - 新建 `panel/backend/src/core/packs/game-type-registry.ts`
   - 接口定义：
     ```typescript
     interface GameTypeAdapter {
       gameType: string;
       displayName: string;
       coreExtensions: string[];          // ['.jar'] / ['.exe']
       signalStop?: 'stdin' | 'sigint';   // 停止策略
       backupProtocol?: GameBackupProtocol;
       bootstrap?: (ctx: BootstrapContext) => Promise<void>;
       // 扩展点：未来可加 playerFiles / configFiles / envVars 等
     }
     ```

2. **注册表实现**
   - `GAME_TYPE_REGISTRY: Map<string, GameTypeAdapter>`
   - `registerGameType(adapter)` / `getGameType(gameType)` / `listGameTypes()`
   - 13 个游戏类型各创建一个 adapter 文件：`panel/backend/src/core/packs/adapters/minecraft.ts` 等

3. **bootstrap.ts 改造**
   - 将 `switch(gameType)` 改为 `const adapter = getGameType(gameType); await adapter.bootstrap(ctx)`
   - 每个 case 的逻辑迁移到对应 adapter 的 `bootstrap` 方法

4. **pack-schema.ts 改造**
   - `GameTypeSchema` 改为 `z.string().refine(v => GAME_TYPE_REGISTRY.has(v))`
   - 或保持 enum 但新增 `registerGameType` 时动态扩展 enum（Zod 不支持动态 enum，需用 refine）

5. **manager.ts SIGINT_STOP_GAMES 改造**
   - 移除硬编码 `Set(['valheim', 'enshrouded', 'dyson'])`
   - 改为 `const adapter = getGameType(gameType); if (adapter.signalStop === 'sigint') { ... }`

6. **新增游戏类型的流程**
   - 创建 `adapters/<new-game>.ts` → 注册到 REGISTRY → 创建 `packs/<new-game>/pack.yaml`
   - 无需修改 bootstrap.ts / manager.ts / pack-schema.ts

---

### L2. Daemon 集群化管理（主从节点）

**现状**：单 daemon 节点（API 已预留 `node_id` 字段）。参考 MSLX LinkKey + CommsKey + 影子用户架构。

**执行步骤**：

1. **节点注册协议**
   - Panel 后端新增 `/api/nodes/link` 端点：Slave daemon 提交 `{slaveUrl, linkKey}` → Panel 返回 `{nodeId, commsKey}`
   - `nodes` 表新增字段：`node_type`（master/slave）、`comms_key`（hash 存储）、`linked_at`、`last_seen_at`
   - Slave daemon 启动时携带 linkKey 向 master 注册，获取 commsKey 后持久化

2. **Token 转发验证**
   - Slave daemon 收到请求时，Header `x-api-key` = commsKey → 转发到 master `/api/nodes/verify-token` → master 返回 `{role, resources}` → Slave 写入请求上下文
   - Token 验证结果缓存 5 分钟（避免每次请求都问 master）

3. **远程命令执行**
   - Panel 通过 `x-node-id` Header 路由请求到指定 Slave
   - Slave 收到命令 → 本地执行 → 返回结果
   - 玩家管理 / 文件管理 / 实例操作均支持远程节点

4. **状态上报**
   - Slave daemon 每 10 秒向 master 上报：系统指标 / 实例状态 / 磁盘占用
   - master 聚合所有 Slave 状态 → WebSocket 广播到前端
   - 10 秒未上报的 Slave 标记为 `offline`

5. **前端节点管理 UI**
   - 节点列表页展示 master + 所有 slave 节点状态
   - 「添加节点」按钮 → 生成 linkKey → 展示 slave daemon 启动命令
   - 节点详情页 → 远程实例列表 / 远程文件管理 / 远程终端

---

### L3. SQLite → PostgreSQL 迁移预备

**现状**：Knex 抽象层已就位，但部分 SQL 使用 SQLite 特有语法。

**执行步骤**：

1. **审计 SQLite 特有语法**
   - 全局搜索 `sqlite` / `SQLite` / `PRAGMA` / `AUTOINCREMENT` / `datetime('now')` / `strftime`
   - 记录所有 SQLite 特有用法的位置

2. **替换 SQLite 特有函数**
   - `datetime('now')` → Knex `knex.fn.now()`
   - `strftime('%s', ...)` → 标准时间戳计算
   - `PRAGMA wal_checkpoint` → 条件判断（`if (knex.client.dialect === 'sqlite') { ... }`）

3. **创建 PostgreSQL knexfile**
   - `panel/backend/src/db/knexfile.pg.ts`：PostgreSQL 连接配置
   - `DATABASE_URL` 环境变量支持 `postgres://` 前缀自动切换

4. **迁移脚本验证**
   - 在 PostgreSQL 实例上运行所有 45 个 migration → 验证 up/down 双向
   - 修复不兼容的迁移脚本（如 SQLite 的 `INTEGER PRIMARY KEY AUTOINCREMENT` → PostgreSQL 的 `SERIAL`）

5. **双数据库 CI 测试**
   - CI 新增 `database-compat` job：分别在 SQLite :memory: 和 PostgreSQL container 上运行 migration + seed + 基础查询
   - 确保两种数据库行为一致

6. **迁移文档**
   - `docs/migration-sqlite-to-postgresql.md`：步骤、注意事项、回滚方案

---

### L4. Mods 客户端识别

**现状**：`modService.ts` 仅支持 `.jar ↔ .jar.disabled` 启停，不识别客户端 mod。参考 MSLX 扫描 jar 内 `fabric.mod.json` / `META-INF/mods.toml`。

**执行步骤**：

1. **daemon 端 jar 元数据扫描**
   - `daemon/src/files/modScanner.ts` 新建：
     - `scanModMetadata(jarPath): ModMetadata | null`
     - 用 `node:stream` + `unzipper`（或 `yauzl`）流式读取 jar 内：
       - `fabric.mod.json`（Fabric mod）：name / version / environment（client/server/both）
       - `META-INF/mods.toml`（Forge/NeoForge mod）：mods[].modId / mods[].version
       - `mcmod.info`（旧 Forge）：modList[].modid / modList[].name
     - 返回 `ModMetadata { name, version, loader, environment, isClientSide }`

2. **客户端 mod 识别规则**
   - `environment === 'client'` → 客户端 mod（如 OptiFine、shader mod）
   - 无 environment 字段但 name 匹配客户端 mod 黑名单（OptiForge / ShaderMod 等）→ 客户端 mod
   - 其他 → 服务端 mod

3. **daemon API 扩展**
   - `GET /api/instances/:id/mods/scan`：扫描 mods 目录所有 jar，返回 `ModMetadata[]`
   - Panel 端透传：`daemonClient.scanMods(serverId)` → `GET /api/servers/:id/mods/scan`

4. **前端 Mods 页增强**
   - `panel/frontend/src/pages/instance-detail/Mods.tsx` 表格新增列：
     - 「加载器」：Fabric / Forge / NeoForge / 未知
     - 「环境」：客户端 / 服务端 / 双端
     - 客户端 mod 行标记黄色背景 + 警告图标「客户端 mod，安装到服务端可能导致启动失败」
   - 「扫描元数据」按钮触发 `scanMods` → 更新表格

5. **依赖**
   - daemon `package.json` 新增 `yauzl`（纯 JS zip 解析，无原生编译依赖）

---

### L5. 配置文件编辑器增强

**现状**：文件内容编辑通过 `GET /api/servers/:id/files/content` → 文本框展示 → `PUT` 写入，无语法高亮。

**执行步骤**：

1. **引入 Monaco Editor**
   - `panel/frontend/package.json` 新增 `@monaco-editor/react`
   - 或轻量替代：CodeMirror 6（`@codemirror/state` + `@codemirror/view` + 语言包）

2. **语法检测**
   - 根据文件扩展名自动选择语言模式：
     - `.json` → JSON / `.yaml/.yml` → YAML / `.properties` → Properties
     - `.ini` → INI / `.toml` → TOML / `.conf` → INI
     - `.txt/.md` → Markdown / `.sh` → Shell / `.xml` → XML
   - 二进制后缀黑名单（已有）拦截，不打开编辑器

3. **编辑器组件**
   - 新建 `panel/frontend/src/components/CodeEditor.tsx`
   - Props：`value` / `language` / `onChange` / `readOnly` / `fontSize`
   - 内置：保存快捷键（Ctrl+S）+ 未保存指示器 + 行号 + 折叠

4. **集成到文件管理页**
   - `Files.tsx` 的文件内容编辑区替换 `<textarea>` 为 `<CodeEditor>`
   - 大文件（>2MB）不打开编辑器，显示「文件过大，请下载查看」

5. **服务端配置校验**（可选增强）
   - 编辑 `server.properties` 保存前 → Zod 校验字段合法性
   - 编辑 `pack.yaml` 保存前 → `GamePackSchema` 校验

---

## 六、版本号与文档同步

**执行步骤**：

1. **版本号规则**
   - T1/T2（测试体系）→ 中版本号 +1（全新功能增加）：v4.8.0 → v4.9.0
   - T3/L1-L6（重构/架构演进）→ 中版本号 +1（重大架构调整）：v4.9.0 → v5.0.0
   - I1-I5（功能补齐）→ 小版本号 +1（功能修改/微量增加）：v5.0.0 → v5.0.1 / v5.0.2 / ...
   - 每次版本号增加时，小一级版本号重置为 0

2. **version.md 更新**
   - 每个改进项完成后追加 changelog 条目
   - 包含：改进项编号 + 描述 + 涉及文件 + 验证结果

3. **README.md 更新**
   - 重大架构调整（T3/L1/L2/L3）时更新 README 的架构说明章节
   - 新增管理页面（I1-I4）时更新功能列表

4. **版本号同步**
   - `version.json` / `version.md` / 4 个 `package.json` / `README.md` / `deploy.sh` 全部同步

---

## 七、依赖关系图

```
T1 ─┬─ L6 (CI 后端 job 依赖测试存在)
    │
T2 ─┘

T3 ─── 独立（拆分 index.ts，不影响功能）

I1 ─── 独立（后端已就位）
I2 ─── 独立（后端已就位）
I3 ─── 独立（后端已就位）
I4 ─── 独立（后端已就位）

I5 ─── 独立（WebSocket 通知推送）

L1 ─── 独立（游戏类型注册表化）
       │
       └── L2 (集群化依赖注册表化的 gameType 抽象)

L3 ─── 独立（PostgreSQL 迁移预备）
L4 ─── 独立（Mods 客户端识别）
L5 ─── 独立（配置文件编辑器）
```

**可并行推进**：T1/T2/T3/I1/I2/I3/I4/I5/L1/L3/L4/L5 相互独立，可并行开发。
**串行依赖**：L6 依赖 T1+T2 完成；L2 依赖 L1 完成。

---

## 八、验证标准

每个改进项完成后需通过以下验证：

| 验证项 | 标准 |
|--------|------|
| TypeScript 编译 | `npx tsc --noEmit` 0 errors（daemon + panel/backend + panel/frontend） |
| 单元测试 | 新增测试全部 PASS |
| 前端构建 | `npm run build` + `verify` 脚本通过（无 localhost:3000 违规） |
| 功能回归 | 现有 E2E 测试 PASS |
| 版本号同步 | version.json / 4 个 package.json / README.md / deploy.sh 一致 |
| 文档更新 | version.md changelog + 相关 docs 更新 |
| 契约对齐 | public/schema/ 与 public/interface_stub/ 与实现一致 |

---

*本方案基于 GSP v4.8.0 现状制定，数据来源为 GSP vs MSLX 横向对比分析报告（2026-07-22）。*
