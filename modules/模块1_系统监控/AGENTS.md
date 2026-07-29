# 模块1_系统监控 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

---

## 模块信息

- **模块名**：模块1_系统监控
- **物理路径**：`modules/模块1_系统监控/`
- **职责**：系统资源指标采集（CPU/内存/磁盘）+ 服务健康检查（backend/db/daemon）
- **依赖**：public/（公共契约）、共享 db(knex)、共享 daemonClient
- **Wave**：S4 Batch1（与模块0并行）

---

## 可修改文件范围

```
modules/模块1_系统监控/
├── systemMetricsService.ts
├── systemMetricsRoute.ts
└── AGENTS.md
```

**允许修改（装配时）**：`panel/backend/src/index.ts`（仅新增 import + app.use + app.locals.systemMetricsService）

**禁止修改**：`public/` 下任何文件、`panel/backend/src/services/` 既有文件、`panel/frontend/`

---

## gsp 项目规范通用约束（含禁止操作清单）

> 🚨 **public/ 目录保护**：`public/` 目录是契约的物理载体，不是代码库的可变部分。任何删除、修改、覆盖、移动 `public/` 下文件的操作必须先经人类显式授权。契约变更必须走 s0601 流程，不得直接编辑 public/ 文件。

```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容
  - 禁止在模块间直接导入其他模块的内部实现代码
  - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现
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

1. **CPU 采集**：读取 `/proc/stat` 计算 jiffies 差值（采样间隔 100ms）
2. **Memory 采集**：读取 `/proc/meminfo` 解析 `MemTotal`/`MemAvailable`
3. **Disk 采集**：`statfs` syscall 获取 `${DEPLOY_ROOT}` 所在分区使用率
4. **Load average**：读取 `/proc/loadavg`（1/5/15 分钟）
5. **Uptime**：读取 `/proc/uptime`
6. **Backend health**：自检（`process.memoryUsage` + `process.uptime()`）
7. **DB health**：`knex.raw('SELECT 1')`，超时 1000ms
8. **Daemon health**：HTTP GET `${DAEMON_URL}/health`，超时 2000ms
9. **健康状态映射**：所有 up → `healthy`；任一 degraded → `degraded`；任一 down → `unhealthy`
10. **采集失败抛 `SystemMetricsCollectionFailedError`**（不部分返回）
11. **不得阻塞事件循环**：所有 `/proc` 读取用 `fs.promises.readFile`

---

## 依赖的契约入口

- `public/interface_stub/system-metrics-service.d.ts` → 接口签名（@version 1.0.0）
- `public/interface_stub/shared-types.d.ts` → `SystemMetrics`, `ServiceHealth`, `SystemHealth`
- `public/schema/error-codes-schema.json` → `SYSTEM_METRICS_001`
- `public/config_template/panel.env.template` → `DAEMON_URL`（既有）

---

## 测试要求

- `getSystemMetrics()` 返回 `cpuUsage`/`memoryUsage`/`diskUsage`/`cpuCount`/`memoryTotal`/`diskTotal`/`loadAverage`/`uptime`
- `getSystemHealth()` 返回 `status` + `services[{name, status, latency, message}]`
- 所有数值范围合理（0-100 for usage, 正整数 for counts）
- 端点经 `authenticateToken`（不限 admin，普通用户可查看健康状态）

---

## 失败回退

- **回退点 R3**：删除 `modules/模块1_系统监控/` 目录，不注册路由
- 无 migration，无 DB 副作用

---

## 闭合判据

- [x] `tsc --noEmit` 通过（v4.19.3 npm run check 验证）
- [x] 2 个端点返回正确响应格式（路由已挂载于 routes-registry.ts L100 `createSystemMetricsRouter`）
- [x] `/proc` 解析在 Linux 环境验证通过（v4.15.0 生产部署验证）

> **闭合状态**：v4.19.3 已闭合。运行时接入证据：
> - 路由注册：`panel/backend/src/routes-registry.ts#L100`（`createSystemMetricsRouter`）
> - 服务注入：`panel/backend/src/routes-registry.ts#L832-L845`（`createSystemMonitorService` → `app.locals.systemMonitorService`，`start()` 已在启动时调用）
