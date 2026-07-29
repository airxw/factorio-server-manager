# MSLX 方案吸收 — 版本升级规划

> 依据：`mslx-deep-analysis.md` §4.1 高优先级 11 项 + §4.2 中优先级 12 项
> 当前版本：v4.1.1
> 规划版本：v4.2.0 → v4.3.0 → v4.4.0

---

## v4.2.0 — 核心运行时改造（进程管理 + 实时通信 + 备份 + 玩家管理）

### A. Daemon 进程管理改造

**A1 三段式进程退出判定**
- 修改 `daemon/src/instances/processDriver.ts`：ProcessContext 新增 `isStdoutClosed` / `isStderrClosed` / `hasTriggeredExit` 三个标志
- 修改 stdout/stderr close 事件回调：设置对应标志位
- 新增 `checkAndHandleTrueExit()` 方法：三者全 true 才触发退出处理
- 修改 `onExit` 回调：设置 `isProcessExited` 后调用 `checkAndHandleTrueExit` 而非直接处理退出

**A2 崩溃熔断保护**
- 修改 `daemon/src/instances/manager.ts`：新增 `crashHistory: Map<string, number[]>`（实例 ID → 崩溃时间戳数组）
- 窗口参数：5 分钟 / 5 次
- `handleServerExit` 中判断：非主动停止 + 崩溃 → 记录时间戳 → 窗口内超阈值 → 不重启 + 日志告警
- 每次成功运行 60 秒后清空该实例的崩溃历史

**A3 穿透子进程监控**
- 修改 `daemon/src/instances/processDriver.ts`：新增 `getChildProcess(pid)` 方法
- Linux 实现：`pgrep -P {pid}` 递归 8 层，匹配 `java|bedrock|server` 进程名
- 修改 CPU 采集逻辑：优先监控子进程的 CPU，fallback 到父进程
- CPU 公式：`(childCpuTime - prevCpuTime) / timePassed / cpuCount * 100`

### B. 前端 WebSocket Store 改造

**B1 引用计数 + Promise 串行化**
- 新建 `panel/frontend/src/stores/useInstanceHubStore.ts`（Zustand store，替代 useWebSocket hook）
- 状态：`connection` / `refCount` / `currentServerId` / `isConnected`
- `connect(serverId)`：`connectionPromise = connectionPromise.then(...)` 串行化
- `disconnect()`：refCount--，归零才断开
- `onLog(handler)` / `onStatus(handler)` / `onCommandResult(handler)`：返回 unsubscribe 函数

**B2 多订阅者 Set 模式**
- 每个事件类型一个 `Set<handler>`
- WS onmessage 分发到对应 Set
- 组件 unmount 时调用返回的 unsubscribe

**B3 自动重连 + 重新订阅**
- 重连策略：`[0, 2000, 5000, 10000]` 指数退避
- `onreconnected`：重新发送 `subscribe(instanceId)`

### C. 游戏特化备份

**C1 Minecraft 语义备份**
- 修改 `panel/backend/src/services/backupService.ts`：新增 `backupWithSaveProtocol(serverId)` 方法
- 流程：`save-off` → 延时 1s → `save-all` → `tellraw @a` 通知 → 延时 N 秒 → tar world* 目录（排除 session.lock）→ `save-on`
- pack.yaml 新增 `backup.save_command` / `backup.save_delay` 字段（可选，默认 save-off/save-all）
- 非 Minecraft 游戏 fallback 到直接 tar

### D. 玩家管理系统

**D1 后端玩家管理 API**
- 新建 `panel/backend/src/api/routes/players.ts`
- 端点：`GET /api/servers/:id/players/online` / `GET /api/servers/:id/players/history`
- 端点：`GET/POST/DELETE /api/servers/:id/players/whitelist`
- 端点：`GET/POST/DELETE /api/servers/:id/players/ops`
- 端点：`GET/POST/DELETE /api/servers/:id/players/banned-players`
- 端点：`GET/POST/DELETE /api/servers/:id/players/banned-ips`
- 通过 daemon exec 读写实例目录下的 JSON 文件
- UUID 解析：从 `usercache.json` 查找

**D2 前端玩家管理 UI**
- 新建 `panel/frontend/src/pages/instance-detail/Players.tsx`
- 5 个子 Tab：在线玩家 / 历史玩家 / 白名单 / 管理员 / 封禁列表
- 每个 Tab 一个表格 + 添加/删除按钮
- 添加玩家时支持自动查 UUID

**D3 契约变更**
- `public/schema/panel-api-types.ts`：新增 `PlayerInfo` / `WhitelistItem` / `OpItem` / `BannedPlayerItem` / `BannedIpItem` 类型
- `public/interface_stub/panel-rest.ts`：新增玩家管理 API 签名

### D4. CRON 调度器增强

- 修改 `panel/backend/src/services/scheduler.ts`：引入 cron 表达式解析（`cron-parser` 库）
- 调度器从"被动触发"改为"主动拉取"：1 秒周期扫描 `schedule_tasks` 表
- 任务类型扩展：`command` / `start` / `stop` / `restart` / `backup`

---

## v4.3.0 — 文件管理子系统 + 下载改造

### E. 异步任务框架

**E1 TaskService 抽象**
- 新建 `panel/backend/src/services/taskService.ts`
- `submitTask(type, payload)` → 返回 taskId（32 位 hex）
- `getTaskStatus(taskId)` → 返回 `{ status, progress, message, result }`
- 任务状态存储：内存 Map + 30 分钟 TTL（非持久化，短生命周期）
- 任务类型：`download` / `compress` / `decompress` / `deploy`

### F. 文件管理 API

**F1 文件列表**
- 新建 `panel/backend/src/api/routes/files.ts`
- `GET /api/servers/:id/files?path=xxx` → 目录树
- 权限校验：路径必须在实例根目录下（防穿越）

**F2 文件内容读写**
- `GET /api/servers/:id/files/content?path=xxx` → 文件内容（带编码识别）
- `PUT /api/servers/:id/files/content?path=xxx` → 写入文件内容
- 二进制后缀黑名单：jar/zip/gz/tar/rar/7z/exe/dll/so/png/jpg/jpeg/gif/ico/webp/bmp/db/dat/level/mp3/wav/ogg/mp4/pdf
- 大小限制：2MB

**F3 分片上传**
- `POST /api/servers/:id/files/upload/init` → 发放 1h 凭证（uploadId = 32 位 hex）
- `POST /api/servers/:id/files/upload/chunk?uploadId=xxx&index=N` → 暂存分片
- `POST /api/servers/:id/files/upload/finish?uploadId=xxx` → 合并 + 清理分片
- uploadId 正则校验：`^[a-fA-F0-9]{32}$`

**F4 离线下载**
- `POST /api/servers/:id/files/download` → 异步任务，返回 taskId
- `GET /api/servers/:id/files/download/task/:taskId` → 查询进度

**F5 压缩/解压**
- `POST /api/servers/:id/files/compress` → 异步任务
- `POST /api/servers/:id/files/decompress` → 异步任务
- 格式支持：zip / tar.gz

### G. 版本下载多镜像源回退

**G1 多镜像源配置**
- 修改 `panel/backend/src/services/updateService.ts`：新增 `mirrorSources` 配置
- 每个 pack 可配置多个下载源（数组）
- 下载流程：主源下载 → 检查文件完整性 → 缺失文件切换镜像源补漏 → 再切换兜底校验

**G2 ParallelDownloader 分块并行**
- 新建 `panel/backend/src/utils/parallelDownloader.ts`
- 8 分块并行 + 3 文件并发 + 进度节流（1s 一次）+ 失败重试 5 次
- 基于 HTTP Range 头实现

### H. Mods/Plugins 管理

**H1 Mods 列表与启停**
- 新建 `panel/backend/src/api/routes/mods.ts`
- `GET /api/servers/:id/mods` → 扫描 mods 目录，返回 jar 列表
- `POST /api/servers/:id/mods/:name/toggle` → 启用/禁用（.jar ↔ .jar.disabled）
- 客户端 mod 识别：扫描 jar 内 `fabric.mod.json` / `META-INF/mods.toml`

**H2 前端 Mods 管理 UI**
- 新建 `panel/frontend/src/pages/instance-detail/Mods.tsx`
- 表格展示 mod 名称 / 版本 / 类型（客户端/服务端）/ 状态（启用/禁用）
- 启停按钮 + 删除按钮

---

## v4.4.0 — 第三方集成 + 安全增强 + 系统监控

### I. 第三方服务反向代理

**I1 反向代理框架**
- 新建 `panel/backend/src/api/routes/proxy.ts`
- `GET /api/proxy/:service/:path` → 转发到第三方 API
- `POST /api/proxy/:service/:path` → 转发 POST 请求
- header 转换：前端 `X-Service-Authorization` → 第三方 `Authorization`
- 白名单：`modrinth` / `curseforge` / `mojang` / `steam`

### J. Auth 中间件增强

**J1 API Key 旁路认证**
- 修改 `panel/backend/src/middleware/auth.ts`：新增 `x-api-key` header 旁路
- API Key 存储在 `system_config` 表，server_admin 可生成/撤销
- API Key 关联用户角色，权限与 JWT 一致

### K. 系统监控增强

**K1 后台监控任务**
- 新建 `panel/backend/src/services/systemMonitorService.ts`
- 2 秒周期采集 CPU / 内存 / 磁盘
- WebSocket 推送到前端（复用现有 WS 连接）

**K2 前端系统监控仪表盘**
- 修改 `panel/frontend/src/pages/admin/SystemHealth.tsx`
- 实时 CPU / 内存曲线图（2 秒刷新）
- 历史数据保留 1 小时

### L. SSL 证书管理（可选）

**L1 证书热重载**
- 新建 `panel/backend/src/services/sslService.ts`
- PEM + KEY 文件加载 → PKCS12 转换
- 加锁保护热重载
- 自签证书 fallback（CN + SAN）

### M. Java/Python 环境扫描

**M1 Java 扫描器**
- 新建 `daemon/src/env/javaScanner.ts`
- 扫描路径：JAVA_HOME / PATH / /usr/lib/jvm / /usr/java / /opt/java
- 验证：`java -version` 解析版本 + 供应商
- 缓存到 `system_config` 表

### N. Hubs 分组订阅改造

**N1 WebSocket → 分组订阅模式**
- 修改 `panel/backend/src/services/daemonEventStream.ts`：支持按 instanceId 分组
- 多实例同时订阅：`subscribe(id1)` + `subscribe(id2)` 各自独立
- 前端 store 自动管理订阅生命周期

### O. FRP 集成（中期参考）

**O1 TunnelService 抽象**
- 新建 `panel/backend/src/services/tunnelService.ts`
- 接口定义：`start` / `stop` / `isRunning` / `getLogs` / `getConfig`
- frpc 实现：下载 + 配置生成 + 进程管理

---

## 执行顺序

```
v4.2.0（核心运行时）
  ├── A1-A3 进程管理改造（daemon）
  ├── B1-B3 WebSocket Store 改造（前端）
  ├── C1 游戏特化备份（后端）
  ├── D1-D3 玩家管理系统（全栈）
  └── D4 CRON 调度器增强（后端）

v4.3.0（文件管理 + 下载）
  ├── E1 异步任务框架（后端）
  ├── F1-F5 文件管理 API（后端 + 前端）
  ├── G1-G2 多镜像源 + 并行下载（后端）
  └── H1-H2 Mods 管理（全栈）

v4.4.0（集成 + 安全 + 监控）
  ├── I1 第三方反向代理（后端）
  ├── J1 API Key 认证（后端）
  ├── K1-K2 系统监控（全栈）
  ├── L1 SSL 证书管理（后端，可选）
  ├── M1 Java 扫描器（daemon）
  ├── N1 分组订阅改造（全栈）
  └── O1 FRP 集成（后端，可选）
```
