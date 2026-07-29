---
type: api-doc
title: Daemon 守护端 API 文档（HTTP + WebSocket / 单端口双协议）
date: 2026-07-25
status: final
related: daemon/src/server.ts, daemon/src/auth.ts, daemon/src/index.ts, daemon/src/playerSessionReporter.ts, daemon/src/slaveMode.ts, public/schema/daemon-api-types.ts, public/schema/ws-events.ts
tags: [api, daemon, http, websocket, instances, files, mods, java, rcon, slave-mode, player-sessions]
---

# Daemon 守护端 API 文档

> 本文档覆盖 GSP 项目 Daemon 守护端的 20 个 HTTP 接口与 1 条 WebSocket 协议通道。
> 源码目录：`daemon/src/`（`server.ts` / `auth.ts` / `index.ts` / `playerSessionReporter.ts` / `slaveMode.ts`）
> 类型契约：`public/schema/daemon-api-types.ts`、`public/schema/ws-events.ts`

---

## 一、概述

### 1.1 Daemon 角色

Daemon 是 GSP 双层架构（Panel + Daemon）中的**受控服务端**，部署在游戏服务器节点本机，职责：

- 接收 Panel 下发的实例生命周期指令（start/stop/restart/command/exec）
- 通过 `child_process.spawn` 启动并托管游戏服务进程
- 将进程 stdout/stderr 与状态变更通过 WebSocket 实时回推 Panel
- 提供文件读写、mod 扫描、Java 环境探测等本地能力
- 可选：以 slave 模式向 master Panel 注册并定期上报心跳（commsKey 鉴权）
- 可选：以 fire-and-forget 方式向 Panel 上报玩家 join/leave 会话事件（`PlayerSessionReporter`）

### 1.2 单端口双协议

Daemon 在**同一端口**同时承载 HTTP 与 WebSocket 两种协议：

| 协议 | 路径 | 说明 |
|------|------|------|
| HTTP | `http://<host>:<port>/...` | REST 路由（Express） |
| WebSocket | `ws://<host>:<port>/ws` | 实例事件推送通道（`ws` 库的 `WebSocketServer`） |

- 默认端口 **8080**（可由环境变量 `PORT` 覆盖）
- HTTP 与 WS 共用同一个 `node:http` Server 实例（`httpServer` + `wss`）

### 1.3 鉴权机制

Daemon 支持双路径 token 鉴权（`auth.ts` 的 `isValidToken`）：

| 模式 | 接受的 token | 说明 |
|------|-------------|------|
| master（默认） | `DAEMON_TOKEN`（环境变量） | 单一共享密钥 |
| slave（`SLAVE_MODE=true`） | `DAEMON_TOKEN` **或** `commsKey` | commsKey 由 master Panel 在 `/api/nodes/link` 时颁发，持久化到 `data/slave-state.json`，缓存失效时自动重新 link |

#### HTTP 鉴权

请求头：`Authorization: Bearer <token>`

| 失败情形 | HTTP 状态 | 响应体 |
|----------|-----------|--------|
| 缺少 `Authorization` 头或不以 `Bearer ` 开头 | 401 | `{ "error": "missing_authorization" }` |
| token 不匹配 | 403 | `{ "error": "invalid_token" }` |

> ⚠️ 鉴权失败响应体**不使用** `DaemonErrorResponse`（`{ error: { code, message } }`）结构，而是直接返回 `{ error: "<reason>" }` 字符串。仅 `/health` 与通过鉴权后的业务错误才使用规范错误码。

#### WebSocket 鉴权

连接 URL：`ws://<host>:8080/ws?token=<token>`

| 失败情形 | 行为 |
|----------|------|
| query 无 `token` 参数 | 服务端调用 `ws.close(4001, "invalid_token")` |
| token 不匹配 | 同上 |

**关键时序**（PoC 验证）：`ws` 库的 `connection` 事件触发时连接已 `open`，服务端调用 `ws.close(4001)` 后，客户端会先收到 `open` 事件，再收到 `close` 事件。客户端测试鉴权拒绝**必须等 `close` 事件**确认，不能仅凭 `open` 判定成功。

关闭码 **4001** = invalid_token（自定义码，非标准 WS 关闭码）。

### 1.4 与 Panel 的关系

| 方向 | 通道 | 说明 |
|------|------|------|
| Panel → Daemon | HTTP REST | Panel 后端通过 `axios`/`fetch` 调用 Daemon 的 `/api/...` 路由 |
| Panel → Daemon | WS 客户端 | Panel 作为 WS 客户端连接 Daemon，发送 `subscribe`/`unsubscribe` 命令 |
| Daemon → Panel | WS 服务端推送 | Daemon 向已订阅的 Panel 连接广播 `console.output` 等事件 |
| Daemon → Panel | HTTP（反向调用） | `PlayerSessionReporter` 以 `x-report-key` 头 POST 到 Panel 的 `/api/daemon/player-sessions/*`；`SlaveModeClient` 调用 master Panel 的 `/api/nodes/link` 与 `/api/nodes/:id/heartbeat` |

### 1.5 网络部署约束

- **8080 端口仅本机/内网访问，对公网（外网）禁用**，不能从外部访问
- 调用示例统一使用 `http://127.0.0.1:8080`（本机）或 `http://192.168.5.14:8080`（内网）
- Daemon **不走公网域名，不走 HTTPS**（与 Panel 的 nginx + TLS 3001 体系无关）
- Panel 通过其 backend 配置的 daemon 地址（内网 IP:8080）访问各 Daemon 节点

### 1.6 实例状态机

```
stopped → starting → running → stopping → stopped
                                   ↓
                              (任意状态可转入)
                                   error
```

- `error` 为终态，需人工干预恢复
- 状态变更通过 WS `state.change` 事件推送

---

## 二、HTTP API

> 所有非 `/health` 接口均需 `Authorization: Bearer <token>` 鉴权。
> 业务错误统一使用 `DaemonErrorResponse` 结构：`{ "error": { "code": "<CODE>", "message": "<msg>" } }`。

### 2.1 GET /health — 健康检查

**功能描述**：Daemon 健康检查，无需鉴权，返回进程运行时长与版本号。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/health` |
| 鉴权 | 无 |

**响应字段**（`HealthResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | `'ok'` | 是 | 固定值 |
| uptime | `number` | 是 | 进程运行秒数（`process.uptime()`） |
| version | `string` | 是 | Daemon 版本号（来自 `daemon/package.json` 的 `version` 字段） |

**响应示例**：

```json
{
  "status": "ok",
  "uptime": 3617.42,
  "version": "5.2.0"
}
```

**curl 示例**：

```bash
curl http://127.0.0.1:8080/health
```

---

### 2.2 GET /api/instances — 实例摘要列表

**功能描述**：列出 Daemon 内存中所有已注册实例的摘要（含运行时长扩展字段）。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances` |
| 鉴权 | Bearer Token |

**响应字段**（`ListInstancesResponse`，实际返回 `InstanceSummary` + `uptime` 扩展）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instances | `Instance[]` | 是 | 实例摘要数组 |
| instances[].id | `string` | 是 | 实例 ID |
| instances[].name | `string` | 是 | 实例名称 |
| instances[].pack_id | `string` | 是 | 所属 Pack ID |
| instances[].status | `InstanceState` | 是 | 实例状态：`stopped`/`starting`/`running`/`stopping`/`error` |
| instances[].port | `number` | 是 | 游戏端口 |
| instances[].rcon_port | `number` | 是 | RCON 端口 |
| instances[].uptime | `number` | 是 | 运行时长（秒）；非运行态返回 0（实现扩展字段，非公共契约字段） |

**响应示例**：

```json
{
  "instances": [
    {
      "id": "mc-001",
      "name": "生存服",
      "pack_id": "minecraft-vanilla",
      "status": "running",
      "port": 25565,
      "rcon_port": 25575,
      "uptime": 7200
    }
  ]
}
```

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/instances \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.3 GET /api/instances/:id/state — 实例状态

**功能描述**：查询单个实例当前状态、启动时间与 PID。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/state` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**响应字段**（`InstanceStateResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| status | `InstanceState` | 是 | 实例状态 |
| started_at | `string \| null` | 是 | 启动时间 ISO 8601；未启动为 `null` |
| pid | `number \| null` | 是 | 进程 PID；未启动为 `null` |

**响应示例**：

```json
{
  "id": "mc-001",
  "status": "running",
  "started_at": "2026-07-25T08:00:00.000Z",
  "pid": 12345
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 404 | `INSTANCE_NOT_FOUND` | 实例 ID 未在 InstanceManager 注册 |

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/instances/mc-001/state \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.4 GET /api/instances/:id/logs — 历史日志

**功能描述**：读取实例进程历史 stdout/stderr 日志行（内存缓存），支持分页与子串过滤。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/logs` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**Query 参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| limit | `number` | 否 | 100 | 返回行数上限；非法值回退默认 |
| offset | `number` | 否 | 0 | 偏移行数；非法值回退默认 |
| filter | `string` | 否 | — | 不区分大小写的子串过滤；空字符串视为未设 |

**响应**：JSON 字符串数组（`string[]`），未启动过或无日志返回空数组。

**响应示例**：

```json
[
  "[08:00:01] [Server thread/INFO]: Starting minecraft server version 1.20.4",
  "[08:00:02] [Server thread/INFO]: Loading properties",
  "[08:00:03] [Server thread/INFO]: Done (2.345s)! For help, type \"help\""
]
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 500 | `DAEMON_INTERNAL_ERROR` | 读取日志失败（日志写入器异常） |

**curl 示例**：

```bash
curl "http://127.0.0.1:8080/api/instances/mc-001/logs?limit=50&offset=0&filter=ERROR" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.5 GET /api/instances/:id/log-files — 日志文件列表

**功能描述**：列出实例 workdir 下 `logs/` 目录中的所有日志文件（按修改时间倒序）。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/log-files` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**响应字段**（`{ files: LogFileInfo[] }`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| files | `LogFileInfo[]` | 是 | 日志文件信息数组 |
| files[].filename | `string` | 是 | 文件名（如 `server.log`、`server.log.1`） |
| files[].size | `number` | 是 | 字节数 |
| files[].mtime | `string` | 是 | 最后修改时间 ISO 8601 |

**响应示例**：

```json
{
  "files": [
    { "filename": "server.log", "size": 1048576, "mtime": "2026-07-25T10:00:00.000Z" },
    { "filename": "server.log.1", "size": 10485760, "mtime": "2026-07-25T06:00:00.000Z" }
  ]
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 500 | `DAEMON_INTERNAL_ERROR` | 列出日志文件失败 |

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/instances/mc-001/log-files \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.6 GET /api/instances/:id/log-files/:filename — 读取日志文件

**功能描述**：读取指定日志文件的最后 N 行（默认全部）。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/log-files/:filename` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| filename | `string` | 是 | 日志文件名（必须为 `server.log` 或 `server.log.N` 格式） |

**Query 参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| count | `number` | 否 | 全部 | 读取最后 N 行；必须 > 0，非法值视为未设 |

**响应字段**（`{ filename, lines }`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filename | `string` | 是 | 文件名（回显路径参数） |
| lines | `string[]` | 是 | 日志行数组 |

**响应示例**：

```json
{
  "filename": "server.log",
  "lines": [
    "[10:00:00] [Server thread/INFO]: Done!",
    "[10:01:23] [Server thread/INFO]: <player> joined the game"
  ]
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | 文件名不符合 `server.log(.N)` 规则 |
| 404 | `FILE_NOT_FOUND` | 文件不存在 |
| 500 | `DAEMON_INTERNAL_ERROR` | 读取日志文件失败 |

**curl 示例**：

```bash
curl "http://127.0.0.1:8080/api/instances/mc-001/log-files/server.log?count=200" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.7 DELETE /api/instances/:id/log-files/:filename — 删除日志文件

**功能描述**：删除指定的日志备份文件（仅允许删除 `server.log.N` 轮转备份，不能删除当前活跃的 `server.log`）。

| 项 | 值 |
|----|----|
| 方法 | `DELETE` |
| URL | `/api/instances/:id/log-files/:filename` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| filename | `string` | 是 | 日志文件名（必须为 `server.log.N` 格式） |

**响应**：HTTP 204 No Content（无响应体）。

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | 文件名不符合规则 |
| 404 | `FILE_NOT_FOUND` | 文件不存在 |
| 500 | `DAEMON_INTERNAL_ERROR` | 删除日志文件失败 |

**curl 示例**：

```bash
curl -X DELETE "http://127.0.0.1:8080/api/instances/mc-001/log-files/server.log.3" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.8 GET /api/instances/:id/players — 在线玩家列表

**功能描述**：获取实例的在线玩家列表（由 `PlayerTracker` 内存维护，join/leave 事件驱动）。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/players` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**响应字段**（`{ players: OnlinePlayer[] }`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| players | `OnlinePlayer[]` | 是 | 在线玩家数组 |
| players[].username | `string` | 是 | 玩家名 |
| players[].joinedAt | `number` | 是 | 加入时间（Unix 毫秒时间戳） |

**响应示例**：

```json
{
  "players": [
    { "username": "Steve", "joinedAt": 1784940000000 },
    { "username": "Alex", "joinedAt": 1784940600000 }
  ]
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 500 | `DAEMON_INTERNAL_ERROR` | 获取在线玩家失败 |

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/instances/mc-001/players \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.9 POST /api/instances/:id/start — 启动实例

**功能描述**：启动指定实例。请求体内联携带完整 Pack（zod 校验）与实例运行参数，由 InstanceManager 注册并 spawn 进程。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/start` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**（`StartRequestBody`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pack | `GamePack` | 是 | 完整 Pack 对象（需通过 `GamePackSchema` zod 校验） |
| instance | `object` | 是 | 实例运行参数 |
| instance.name | `string` | 是 | 实例名称 |
| instance.port | `number` | 是 | 游戏端口 |
| instance.rcon_port | `number` | 是 | RCON 端口 |
| instance.rcon_password | `string` | 是 | RCON 密码 |
| instance.workdir | `string` | 是 | 实例工作目录绝对路径 |

**响应字段**（`StartInstanceResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| status | `'starting'` | 是 | 固定值（异步启动，就绪后转为 `running`） |
| pid | `number` | 是 | 子进程 PID |

**请求示例**：

```json
{
  "pack": {
    "pack": { "id": "minecraft-vanilla", "version": "1.20.4", "title": "Minecraft Vanilla" },
    "startup": { "binary": "java", "args": ["-Xmx2G", "-jar", "server.jar", "nogui"] },
    "ready_pattern": "Done \\(.*\\)! For help"
  },
  "instance": {
    "name": "生存服",
    "port": 25565,
    "rcon_port": 25575,
    "rcon_password": "secret",
    "workdir": "/opt/gameserver-panel/instances/mc-001"
  }
}
```

**响应示例**：

```json
{
  "id": "mc-001",
  "status": "starting",
  "pid": 12345
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `pack`/`instance`；实例字段类型不符；Pack zod 校验失败 |
| 409 | `INSTANCE_ALREADY_RUNNING` | 实例已在运行 |
| 409 | `INVALID_STATE_TRANSITION` | 状态机非法转换 |
| 500 | `DAEMON_INTERNAL_ERROR` | 启动失败（spawn 异常等） |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/start \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @start-body.json
```

---

### 2.10 POST /api/instances/:id/stop — 停止实例

**功能描述**：停止指定实例（先发送停止信号，超时后强杀）。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/stop` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**：无（空 body 即可）。

**响应字段**（`StopInstanceResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| status | `'stopping'` | 是 | 固定值（异步停止，进程退出后转为 `stopped`） |

**响应示例**：

```json
{
  "id": "mc-001",
  "status": "stopping"
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 404 | `INSTANCE_NOT_FOUND` | 实例未注册 |
| 409 | `INSTANCE_NOT_RUNNING` | 实例未运行 |
| 409 | `INVALID_STATE_TRANSITION` | 状态机非法转换 |
| 500 | `DAEMON_INTERNAL_ERROR` | 停止失败 |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/stop \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.11 POST /api/instances/:id/restart-with-save — 带存档重启

**功能描述**：停止当前实例并以指定 `save_path` 重新启动，用于切换服务器使用的存档。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/restart-with-save` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**（`RestartWithSaveRequestBody`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| save_path | `string` | 是 | 新存档路径（非空字符串） |

**响应字段**（`StartInstanceResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| status | `'starting'` | 是 | 固定值 |
| pid | `number` | 是 | 新进程 PID |

**请求/响应示例**：

```json
// 请求
{ "save_path": "/data/saves/world_new" }

// 响应
{ "id": "mc-001", "status": "starting", "pid": 12350 }
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `save_path` 或为空字符串 |
| 404 | `INSTANCE_NOT_FOUND` | 实例未注册 |
| 409 | `INSTANCE_NOT_RUNNING` | 实例未运行 |
| 409 | `INSTANCE_ALREADY_RUNNING` | 内部 doStart 时实例已运行 |
| 409 | `INVALID_STATE_TRANSITION` | 状态机非法转换 |
| 500 | `DAEMON_INTERNAL_ERROR` | 重启失败 |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/restart-with-save \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"save_path": "/data/saves/world_new"}'
```

---

### 2.12 POST /api/instances/:id/command — 发送命令

**功能描述**：向运行中实例发送已渲染好的命令字符串（Panel 侧 `commandDispatcher` 已完成 `{{var}}` 替换）。若命令含 `{Var}` 单花括号占位符，则委托给 `ExecutionEngine` 沙箱校验后投递。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/command` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**（`CommandRequestBody`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | `string` | 是 | 命令字符串 |

**响应字段**（`CommandResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| output | `string \| null` | 是 | 命令响应；无响应协议时为 `null` |
| success | `boolean` | 是 | 是否成功（固定 `true`，失败走错误响应） |

**请求/响应示例**：

```json
// 请求
{ "command": "say Hello World" }

// 响应
{ "id": "mc-001", "output": null, "success": true }
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `command` 或非字符串 |
| 404 | `INSTANCE_NOT_FOUND` | 实例未注册 |
| 409 | `INSTANCE_NOT_RUNNING` | 实例未运行 |
| 500 | `COMMAND_FAILED` | 命令执行失败（含沙箱 RCON 注入拦截，错误消息含 `RCON injection` / `ERR_RCON_INJECTION`） |
| 500 | `DAEMON_INTERNAL_ERROR` | 发送命令失败 |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/command \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command": "say Hello"}'
```

---

### 2.13 POST /api/instances/:id/execute-logic — 卡密/商城发货沙箱入口

**功能描述**：v4.11.0 卡密/商城发货沙箱入口。接收原始 `logicString`（含 `{Var}` 单花括号占位符）与 `variables` 映射，由 Daemon 侧 `ExecutionEngine` 沙箱完成变量替换 + 正则白名单校验（防 RCON 注入）后投递。适用于 UGC 自定义资产发货场景——实例管理员配置的 `logicString` 不经过 Panel 侧渲染，直接交由 Daemon 沙箱校验，避免 Panel 侧被绕过。

与 `/command` 的区别：
- `/command` 接收 Panel 侧**已渲染好**的命令字符串
- `/execute-logic` 接收**原始模板 + 变量**，由 Daemon 沙箱完成替换与校验

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/execute-logic` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**（`ExecuteLogicRequestBody`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| logic_string | `string` | 是 | 含 `{Var}` 单花括号占位符的原始指令模板（非空） |
| variables | `Record<string, string>` | 是 | 变量名 → 变量值映射；所有值必须为 string，禁止数组/对象 |

**响应字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| success | `boolean` | 是 | 沙箱校验与投递是否成功 |

**请求/响应示例**：

```json
// 请求
{
  "logic_string": "give {Player} diamond {Count}",
  "variables": { "Player": "Steve", "Count": "64" }
}

// 响应
{ "id": "mc-001", "success": true }
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `logic_string`/`variables`；`variables` 值类型非 string；`variables` 为数组或 null |
| 400 | `COMMAND_FAILED` | 沙箱注入拦截（错误消息含 `RCON injection` / `ERR_RCON_INJECTION`，前缀 `RCON injection blocked: `） |
| 404 | `INSTANCE_NOT_FOUND` | 实例未注册 |
| 409 | `INSTANCE_NOT_RUNNING` | 实例未运行 |
| 500 | `COMMAND_FAILED` | 沙箱未初始化或投递失败 |
| 500 | `DAEMON_INTERNAL_ERROR` | 执行 logic 失败 |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/execute-logic \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"logic_string":"give {Player} diamond {Count}","variables":{"Player":"Steve","Count":"64"}}'
```

---

### 2.14 POST /api/instances/:id/exec — 执行任意二进制命令

**功能描述**：在实例 workdir 下执行任意二进制命令（如 `factorio --create map`、版本查询、安装命令等离线命令）。兼容未启动实例：通过 `resolveInstanceWorkdir` 兜底创建 workdir。

> ⚠️ 实现细节：契约类型 `ExecCommandRequest` 声明了可选 `cwd` 字段，但 `server.ts` 实现实际**不消费** `body.cwd`，始终以 `resolveInstanceWorkdir(manager, id)` 作为 cwd。如需指定子目录，请在 `args` 中由被调二进制自行处理。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/exec` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**请求体**（`ExecCommandRequest`）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| binary | `string` | 是 | — | 可执行二进制路径（绝对路径或相对 cwd 的路径） |
| args | `string[]` | 是 | — | 命令行参数数组（元素必须全为 string） |
| cwd | `string` | 否 | instance.workdir | 契约声明可选；**实现忽略此字段，固定使用 workdir** |
| env | `Record<string, string>` | 否 | — | 环境变量（合并到 `process.env`） |
| timeout | `number` | 否 | 60000 | 超时毫秒 |

**响应字段**（`ExecCommandResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| exit_code | `number \| null` | 是 | 进程退出码；被信号杀死为 `null` |
| stdout | `string` | 是 | 标准输出（UTF-8） |
| stderr | `string` | 是 | 标准错误（UTF-8） |
| duration_ms | `number` | 是 | 执行耗时毫秒 |
| timed_out | `boolean` | 是 | 是否超时被强杀 |

**请求/响应示例**：

```json
// 请求
{
  "binary": "java",
  "args": ["-version"],
  "timeout": 5000
}

// 响应
{
  "exit_code": 0,
  "stdout": "",
  "stderr": "openjdk version \"17.0.2\" 2022-01-18\nOpenJDK Runtime Environment...",
  "duration_ms": 312,
  "timed_out": false
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `binary`/`args`；`args` 元素非全 string |
| 400 | `FILE_PATH_INVALID` | `CwdInvalidError`（cwd 非法） |
| 504 | `EXEC_TIMEOUT` | 命令执行超时（`ExecTimeoutError`） |
| 500 | `EXEC_COMMAND_FAILED` | 命令执行失败（`ExecCommandFailedError`） |
| 500 | `DAEMON_INTERNAL_ERROR` | exec 命令失败（其他异常） |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8080/api/instances/mc-001/exec \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"binary":"java","args":["-version"],"timeout":5000}'
```

---

### 2.15 GET /api/instances/:id/files — 读取文件

**功能描述**：读取实例 workdir 下的文件内容（UTF-8 文本）。兼容未启动实例。

路径安全校验（`fileManager.ts` 的 `safeResolve`）：
1. 路径必须为相对路径，禁止绝对路径
2. 路径段不得包含 `..`（防穿越）
3. `resolve` 后必须仍在 workdir 内
4. 拒绝 symlink（防软链接逃逸）
5. 拒绝 null 字节（防截断攻击）
6. 文件大小限制 10MB（`READ_MAX_BYTES`）

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/files` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | `string` | 是 | 相对 workdir 的文件路径（非空） |

**响应字段**（`FileReadResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | `string` | 是 | 相对 workdir 的路径（回显） |
| content | `string` | 是 | 文件内容（UTF-8 文本） |
| size | `number` | 是 | 文件字节数 |
| modified_at | `string` | 是 | 最后修改时间 ISO 8601 |

**响应示例**：

```json
{
  "path": "server.properties",
  "content": "#Minecraft server properties\nmax-players=20\n",
  "size": 48,
  "modified_at": "2026-07-25T08:00:00.000Z"
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | 缺 `path` 参数；路径非法/逃逸/symlink/超大 |
| 404 | `FILE_NOT_FOUND` | 文件不存在 |
| 500 | `DAEMON_INTERNAL_ERROR` | 读取文件失败 |

**curl 示例**：

```bash
curl "http://127.0.0.1:8080/api/instances/mc-001/files?path=server.properties" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.16 PUT /api/instances/:id/files — 写入文件

**功能描述**：写入实例 workdir 下的文件（覆盖已存在文件）。兼容未启动实例。写入大小限制 10MB（`WRITE_MAX_BYTES`）。

| 项 | 值 |
|----|----|
| 方法 | `PUT` |
| URL | `/api/instances/:id/files` |
| 鉴权 | Bearer Token |
| Content-Type | `application/json` |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | `string` | 是 | 相对 workdir 的文件路径（非空） |

**请求体**（`FileWriteRequest`）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| content | `string` | 是 | — | 文件内容 |
| encoding | `'utf-8' \| 'base64'` | 否 | `utf-8` | 编码；`base64` 用于二进制文件（实现仅识别 `'base64'` 字面量，其他值视为 `utf-8`） |

**响应字段**（`FileWriteResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | `string` | 是 | 相对 workdir 的路径（回显） |
| size | `number` | 是 | 写入后文件字节数 |
| modified_at | `string` | 是 | 最后修改时间 ISO 8601 |

**请求/响应示例**：

```json
// 请求
{
  "content": "#Minecraft server properties\nmax-players=30\n",
  "encoding": "utf-8"
}

// 响应
{ "path": "server.properties", "size": 48, "modified_at": "2026-07-25T10:30:00.000Z" }
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | 缺 `path` 参数；路径非法/逃逸/symlink/超大 |
| 400 | `DAEMON_INTERNAL_ERROR` | 请求体缺 `content` 或非字符串 |
| 500 | `DAEMON_INTERNAL_ERROR` | 写入文件失败 |

**curl 示例**：

```bash
curl -X PUT "http://127.0.0.1:8080/api/instances/mc-001/files?path=server.properties" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"content":"#Minecraft server properties\nmax-players=30\n","encoding":"utf-8"}'
```

---

### 2.17 GET /api/instances/:id/files/list — 列目录

**功能描述**：列出实例 workdir 下指定目录的所有条目，支持递归。空字符串或 `.` 表示 workdir 本身。最大条目数 5000（防超大目录 OOM）。跳过 symlink。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/files/list` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**Query 参数**：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| path | `string` | 否 | `""`（workdir 本身） | 相对 workdir 的目录路径；空串或 `.` 表示 workdir |
| recursive | `'1' \| 'true'` | 否 | `false` | 是否递归列出；仅 `1` 或 `true` 视为 true，其他值视为 false |

**响应字段**（`ListDirResult`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | `string` | 是 | 查询的目录路径（空串回显为 `.`） |
| entries | `DirEntry[]` | 是 | 条目数组 |
| entries[].path | `string` | 是 | 相对 workdir 的路径 |
| entries[].name | `string` | 是 | 名称（最后一段） |
| entries[].type | `'file' \| 'directory'` | 是 | 条目类型 |
| entries[].size | `number` | 是 | 字节数（仅 file，目录为 0） |
| entries[].modified_at | `string` | 是 | 最后修改时间 ISO 8601 |
| entries[].extension | `string` | 是 | 文件扩展名（小写不含点；目录为空字符串） |

**响应示例**：

```json
{
  "path": ".",
  "entries": [
    { "path": "server.properties", "name": "server.properties", "type": "file", "size": 48, "modified_at": "2026-07-25T08:00:00.000Z", "extension": "properties" },
    { "path": "mods", "name": "mods", "type": "directory", "size": 0, "modified_at": "2026-07-25T08:00:00.000Z", "extension": "" }
  ]
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | 路径非法/逃逸/symlink |
| 404 | `FILE_NOT_FOUND` | 目录不存在 |
| 500 | `DAEMON_INTERNAL_ERROR` | 列目录失败 |

**curl 示例**：

```bash
curl "http://127.0.0.1:8080/api/instances/mc-001/files/list?path=mods&recursive=1" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.18 POST /api/instances/:id/mods/files/:name/toggle — 切换 mod 状态

**功能描述**：切换 mod 启用状态（`.jar` ↔ `.jar.disabled` 重命名）。`:name` 必须为纯文件名（不含路径分隔符或 `..`），路径解析在 `mods/` 子目录下。

| 项 | 值 |
|----|----|
| 方法 | `POST` |
| URL | `/api/instances/:id/mods/files/:name/toggle` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |
| name | `string` | 是 | mod 文件名（如 `example.jar` 或 `example.jar.disabled`） |

**请求体**：无。

**响应字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | `string` | 是 | 切换后的新文件名 |
| new_state | `'enabled' \| 'disabled'` | 是 | 新状态：`enabled`（.jar）/ `disabled`（.jar.disabled） |

**响应示例**：

```json
// 原 example.jar.disabled → 切换为 enabled
{ "name": "example.jar", "new_state": "enabled" }
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 400 | `FILE_PATH_INVALID` | `name` 含路径分隔符或 `..`；路径逃逸；symlink；非文件 |
| 400 | `MOD_FILE_STATE_INVALID` | 文件名不以 `.jar` 或 `.jar.disabled` 结尾（错误消息含 `mod 文件名必须`） |
| 404 | `FILE_NOT_FOUND` | mod 文件不存在 |
| 500 | `DAEMON_INTERNAL_ERROR` | 切换 mod 失败 |

**curl 示例**：

```bash
curl -X POST "http://127.0.0.1:8080/api/instances/mc-001/mods/files/example.jar/toggle" \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.19 GET /api/instances/:id/mods/scan — 扫描 mods 元数据

**功能描述**：扫描实例 `mods/` 目录下所有 jar 的元数据（mod 名、版本、加载器、运行环境），用于识别客户端 mod 避免误装到服务端导致启动失败。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/instances/:id/mods/scan` |
| 鉴权 | Bearer Token |

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | `string` | 是 | 实例 ID |

**响应字段**（`ScanModsResponse`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mods | `ModMetadata[]` | 是 | mod 元数据数组 |
| mods[].name | `string` | 是 | mod 显示名称 |
| mods[].version | `string` | 是 | mod 版本 |
| mods[].loader | `ModLoader` | 是 | 加载器：`fabric`/`forge`/`neoforge`/`unknown` |
| mods[].environment | `ModEnvironment` | 是 | 运行环境：`client`/`server`/`both` |
| mods[].isClientSide | `boolean` | 是 | 是否为客户端 mod（`environment === 'client'` 或命中黑名单） |
| mods[].sourceFile | `string` | 是 | jar 源文件名 |

**响应示例**：

```json
{
  "mods": [
    {
      "name": "Sodium",
      "version": "0.5.3",
      "loader": "fabric",
      "environment": "client",
      "isClientSide": true,
      "sourceFile": "sodium-fabric-0.5.3.jar"
    }
  ]
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 500 | `DAEMON_INTERNAL_ERROR` | 扫描 mods 失败 |

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/instances/mc-001/mods/scan \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

### 2.20 GET /api/env/javas — 扫描 Java 安装

**功能描述**：扫描系统中可用的 Java 安装（JRE / JDK）。扫描路径：`JAVA_HOME` / `PATH` / `/usr/lib/jvm` / `/usr/java` / `/opt/java` / `/usr/local/java`。通过执行 `java -version` 解析版本号与供应商，去重后按版本号降序返回。Panel 在创建 Minecraft 实例前调用此接口查询可用 Java 版本以匹配实例兼容性。

| 项 | 值 |
|----|----|
| 方法 | `GET` |
| URL | `/api/env/javas` |
| 鉴权 | Bearer Token |

**路径参数**：无。

**响应字段**（`ScanJavasResult`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| installations | `JavaInstallation[]` | 是 | Java 安装信息数组（按版本号降序） |
| installations[].path | `string` | 是 | java 可执行文件绝对路径 |
| installations[].java_home | `string \| null` | 是 | JAVA_HOME 路径（如可推断） |
| installations[].version | `number` | 是 | 主版本号（如 8 / 11 / 17 / 21） |
| installations[].version_string | `string` | 是 | 完整版本字符串（如 `17.0.2`） |
| installations[].vendor | `string` | 是 | 供应商（如 `Oracle Corporation` / `Eclipse Adoptium`） |
| installations[].is_jdk | `boolean` | 是 | 是否为 JDK（含 javac） |
| installations[].source | `string` | 是 | 探测来源（如 `JAVA_HOME` / `PATH` / `/usr/lib/jvm/java-17-openjdk-amd64`） |
| elapsed_ms | `number` | 是 | 扫描耗时毫秒 |
| scanned_paths | `number` | 是 | 扫描的路径数量 |
| failed_paths | `number` | 是 | 扫描失败次数（被忽略的路径） |

**响应示例**：

```json
{
  "installations": [
    {
      "path": "/usr/lib/jvm/java-17-openjdk-amd64/bin/java",
      "java_home": "/usr/lib/jvm/java-17-openjdk-amd64",
      "version": 17,
      "version_string": "17.0.2",
      "vendor": "Eclipse Adoptium",
      "is_jdk": true,
      "source": "/usr/lib/jvm/java-17-openjdk-amd64"
    }
  ],
  "elapsed_ms": 312,
  "scanned_paths": 5,
  "failed_paths": 0
}
```

**错误码**：

| HTTP | code | 触发条件 |
|------|------|----------|
| 500 | `DAEMON_INTERNAL_ERROR` | Java 扫描失败（错误消息含底层原因） |

**curl 示例**：

```bash
curl http://127.0.0.1:8080/api/env/javas \
  -H "Authorization: Bearer ${DAEMON_TOKEN}"
```

---

## 三、WebSocket 协议

### 3.1 连接与鉴权

**连接 URL**：`ws://<host>:8080/ws?token=<token>`

- token 通过 URL query 参数传递（非 header）
- token 校验逻辑与 HTTP Bearer 一致（`isValidToken`，支持 `DAEMON_TOKEN` 或 slave 模式的 `commsKey`）
- 鉴权通过后，服务端立即推送 `connected` 事件，随后接受 `subscribe`/`unsubscribe` 命令

**鉴权失败关闭码**：

| 关闭码 | reason | 含义 |
|--------|--------|------|
| 4001 | `invalid_token` | token 缺失或不匹配 |

**JavaScript 客户端示例**：

```javascript
const ws = new WebSocket('ws://192.168.5.14:8080/ws?token=' + DAEMON_TOKEN);
ws.onopen = () => console.log('WS opened');
ws.onmessage = (e) => console.log('event:', JSON.parse(e.data));
ws.onclose = (e) => {
  if (e.code === 4001) console.error('鉴权失败：invalid token');
  else console.log('WS closed:', e.code, e.reason);
};
```

### 3.2 客户端 → 服务端命令

#### 3.2.1 subscribe — 订阅实例事件

**功能**：注册当前 WS 连接对指定实例的事件订阅，订阅后该实例的 `console.output`/`state.change`/`instance.started`/`instance.stopped` 事件会推送给此连接。

**字段**（`SubscribeCommand`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'subscribe'` | 是 | 固定值 |
| timestamp | `string` | 否 | ISO 8601 时间戳（契约声明，服务端不强制要求） |
| instance_id | `string` | 是 | 要订阅的实例 ID |

**JSON 示例**：

```json
{
  "type": "subscribe",
  "instance_id": "mc-001"
}
```

#### 3.2.2 unsubscribe — 取消订阅（v4.4.0-N1）

**功能**：取消当前 WS 连接对指定实例的订阅（不关闭 WS 连接）。Panel 在前端最后一个订阅者退出时发送，释放 Daemon 端订阅资源。

**字段**（`UnsubscribeCommand`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'unsubscribe'` | 是 | 固定值 |
| timestamp | `string` | 否 | ISO 8601 时间戳 |
| instance_id | `string` | 是 | 要取消订阅的实例 ID |

**JSON 示例**：

```json
{
  "type": "unsubscribe",
  "instance_id": "mc-001"
}
```

> 未知 `type` 的消息会被服务端记录 warn 日志并忽略（不关闭连接）。WS 连接关闭时，服务端自动清理该连接的所有订阅。

### 3.3 服务端 → 客户端事件

所有事件均继承 `BaseWsEvent`（`type: string` + `timestamp: string`）。

#### 3.3.1 connected — 连接已建立

**触发时机**：WS 鉴权通过后立即推送（每个连接仅一次）。

**字段**（`ConnectedEvent`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'connected'` | 是 | 固定值 |
| timestamp | `string` | 是 | ISO 8601 时间戳 |
| daemon_id | `string` | 是 | Daemon 节点 ID（来自 `DAEMON_ID` 环境变量，默认 `daemon-local`） |
| daemon_version | `string` | 是 | Daemon 版本号（来自 `daemon/package.json`） |

**JSON 示例**：

```json
{
  "type": "connected",
  "timestamp": "2026-07-25T10:00:00.000Z",
  "daemon_id": "daemon-local",
  "daemon_version": "5.2.0"
}
```

#### 3.3.2 console.output — 控制台输出

**触发时机**：实例进程 stdout/stderr 每输出一行时推送。

**字段**（`ConsoleOutputEvent`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'console.output'` | 是 | 固定值 |
| timestamp | `string` | 是 | ISO 8601 时间戳 |
| instance_id | `string` | 是 | 实例 ID |
| line | `string` | 是 | 日志行内容 |
| stream | `'stdout' \| 'stderr'` | 是 | 输出流来源 |

**JSON 示例**：

```json
{
  "type": "console.output",
  "timestamp": "2026-07-25T10:01:23.000Z",
  "instance_id": "mc-001",
  "line": "[Server thread/INFO]: Done (2.345s)! For help, type \"help\"",
  "stream": "stdout"
}
```

#### 3.3.3 state.change — 状态变更

**触发时机**：实例状态机发生转换时推送。

**字段**（`StateChangeEvent`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'state.change'` | 是 | 固定值 |
| timestamp | `string` | 是 | ISO 8601 时间戳 |
| instance_id | `string` | 是 | 实例 ID |
| from | `InstanceState` | 是 | 转换前状态 |
| to | `InstanceState` | 是 | 转换后状态 |

**JSON 示例**：

```json
{
  "type": "state.change",
  "timestamp": "2026-07-25T10:00:00.000Z",
  "instance_id": "mc-001",
  "from": "starting",
  "to": "running"
}
```

#### 3.3.4 instance.started — 实例已启动

**触发时机**：实例就绪检测命中 `ready_pattern`（状态转入 `running`）时推送。

**字段**（`InstanceStartedEvent`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'instance.started'` | 是 | 固定值 |
| timestamp | `string` | 是 | ISO 8601 时间戳 |
| instance_id | `string` | 是 | 实例 ID |
| pid | `number` | 是 | 进程 PID |

**JSON 示例**：

```json
{
  "type": "instance.started",
  "timestamp": "2026-07-25T10:00:02.000Z",
  "instance_id": "mc-001",
  "pid": 12345
}
```

#### 3.3.5 instance.stopped — 实例已停止

**触发时机**：实例进程退出时推送。

**字段**（`InstanceStoppedEvent`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | `'instance.stopped'` | 是 | 固定值 |
| timestamp | `string` | 是 | ISO 8601 时间戳 |
| instance_id | `string` | 是 | 实例 ID |
| exit_code | `number \| null` | 是 | 进程退出码；被信号杀死为 `null` |

**JSON 示例**：

```json
{
  "type": "instance.stopped",
  "timestamp": "2026-07-25T12:00:00.000Z",
  "instance_id": "mc-001",
  "exit_code": 0
}
```

---

## 四、错误码附录

### 4.1 DaemonErrorCode 全量错误码

源自 `public/schema/daemon-api-types.ts` 的 `DaemonErrorCode` 常量。

| code | HTTP 状态 | 触发场景 | 触发接口 |
|------|-----------|----------|----------|
| `DAEMON_UNAUTHORIZED` | —（保留） | 契约保留码；**实际未使用**——HTTP 401 由 `auth.ts` 直接返回 `{ "error": "missing_authorization" }`，不使用此 code | — |
| `DAEMON_FORBIDDEN` | —（保留） | 契约保留码；**实际未使用**——HTTP 403 由 `auth.ts` 直接返回 `{ "error": "invalid_token" }`，不使用此 code | — |
| `INSTANCE_NOT_FOUND` | 404 | 实例 ID 未在 InstanceManager 注册 | `/state` `/stop` `/command` `/execute-logic` `/restart-with-save` |
| `INSTANCE_ALREADY_RUNNING` | 409 | 实例已在运行，无法重复 start | `/start` `/restart-with-save` |
| `INSTANCE_NOT_RUNNING` | 409 | 实例未运行，无法 stop/command/execute-logic | `/stop` `/command` `/execute-logic` `/restart-with-save` |
| `INVALID_STATE_TRANSITION` | 409 | 状态机非法转换 | `/start` `/stop` `/restart-with-save` |
| `COMMAND_FAILED` | 500 / 400 | 命令执行失败；`/execute-logic` 沙箱 RCON 注入拦截时为 400（错误消息含 `RCON injection` / `ERR_RCON_INJECTION`） | `/command` `/execute-logic` |
| `DAEMON_INTERNAL_ERROR` | 500 / 400 | 服务端内部错误；请求体校验失败时也用作 400 错误码 | 全部业务接口 |
| `FILE_NOT_FOUND` | 404 | 文件/目录/mod 文件不存在 | `/log-files/:filename`（GET/DELETE） `/files`（GET） `/files/list` `/mods/files/:name/toggle` |
| `FILE_PATH_INVALID` | 400 | 路径非法/逃逸/symlink/超大/含 null 字节；`CwdInvalidError`；`exec` 的 cwd 非法 | `/log-files/:filename`（GET/DELETE） `/files`（GET/PUT） `/files/list` `/mods/files/:name/toggle` `/exec` |
| `EXEC_COMMAND_FAILED` | 500 | 命令执行失败（`ExecCommandFailedError`） | `/exec` |
| `EXEC_TIMEOUT` | 504 | 命令执行超时（`ExecTimeoutError`） | `/exec` |
| `MOD_FILE_STATE_INVALID` | 400 | mod 文件名不以 `.jar` 或 `.jar.disabled` 结尾 | `/mods/files/:name/toggle` |

### 4.2 关于 `RCON_INJECTION_BLOCKED`

任务描述提及的 `RCON_INJECTION_BLOCKED` 错误码**在源码中不存在**。`DaemonErrorCode` 常量未定义此码。实际的 RCON 注入拦截行为：

- `/execute-logic` 沙箱拦截 RCON 注入时返回 **HTTP 400**，错误码为 **`COMMAND_FAILED`**（非 `RCON_INJECTION_BLOCKED`），错误消息前缀为 `RCON injection blocked: `
- `/command` 走 `sendCommand` 路径，若命令含 `{Var}` 占位符且沙箱拦截，错误码同样为 `COMMAND_FAILED`（HTTP 500）

### 4.3 鉴权失败响应（非 DaemonErrorResponse 结构）

`auth.ts` 的 401/403 响应**不使用** `DaemonErrorResponse` 结构，直接返回简化对象：

| HTTP | 响应体 | 触发条件 |
|------|--------|----------|
| 401 | `{ "error": "missing_authorization" }` | 缺 `Authorization` 头或不以 `Bearer ` 开头 |
| 403 | `{ "error": "invalid_token" }` | token 不匹配 |

WS 鉴权失败不返回 HTTP 响应，直接 `ws.close(4001, "invalid_token")`。

---

## 五、Daemon 反向调用 Panel 的接口（参考）

Daemon 在以下场景会**反向调用 Panel**（非本文件主要范围，仅列出供参考）：

### 5.1 PlayerSessionReporter — 玩家会话上报

触发条件：`PANEL_API_URL` 与 `DAEMON_REPORT_KEY` 环境变量均已配置；否则降级为 no-op。

| 方法 | URL | 鉴权 | 触发时机 |
|------|-----|------|----------|
| POST | `${PANEL_API_URL}/api/daemon/player-sessions/join` | `x-report-key: <DAEMON_REPORT_KEY>` | PlayerTracker 检测到玩家 join |
| POST | `${PANEL_API_URL}/api/daemon/player-sessions/leave` | `x-report-key: <DAEMON_REPORT_KEY>` | PlayerTracker 检测到玩家 leave |

**join 请求体**：`{ instance_id, game_player_name, join_at }`（join_at 为 ISO 8601）
**leave 请求体**：`{ instance_id, game_player_name, leave_at }`（leave_at 为 ISO 8601）

fire-and-forget：失败只记 warn 日志，不重试、不阻断主流程。

### 5.2 SlaveModeClient — slave 节点向 master 注册与心跳

触发条件：`SLAVE_MODE=true` 且 `MASTER_URL` 与 `LINK_KEY` 环境变量已配置。

| 方法 | URL | 鉴权 | 触发时机 |
|------|-----|------|----------|
| POST | `${MASTER_URL}/api/nodes/link` | 无（body 携带 `link_key`） | 首次注册或缓存 commsKey 失效时 |
| POST | `${MASTER_URL}/api/nodes/:id/heartbeat` | `x-comms-key: <commsKey>` | 每 `HEARTBEAT_INTERVAL_MS`（默认 10s） |

**link 请求体**：`{ slave_url, link_key }` → 响应 `{ node_id, comms_key }`
**heartbeat 请求体**：`{ cpu_percent?, memory_percent?, daemon_version }` → 响应 `{ received: true }`

状态持久化到 `data/slave-state.json`（`SLAVE_STATE_FILE` 可配置）。heartbeat 返回 401 时自动清缓存并重新 link。

---

## 六、环境变量参考

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DAEMON_TOKEN` | master 模式必填；slave 模式可选 | — | 共享密钥（HTTP Bearer / WS query token） |
| `PORT` | 否 | `8080` | HTTP + WS 监听端口 |
| `DAEMON_ID` | 否 | `daemon-local` | Daemon 节点 ID（用于 `connected` 事件） |
| `LOG_LEVEL` | 否 | `info` | pino 日志级别 |
| `INSTANCES_DIR` | 否 | `./instances` | 未注册实例 workdir 推断根目录（`resolveInstanceWorkdir` 兜底） |
| `MONITOR_INTERVAL_MS` | 否 | `10000` | 监控采样间隔 |
| `SLAVE_MODE` | 否 | `false` | 启用 slave 模式（`true` 启用） |
| `MASTER_URL` | slave 模式必填 | — | master Panel 访问地址 |
| `LINK_KEY` | slave 模式必填 | — | 邀请密钥（首次注册用） |
| `SLAVE_EXTERNAL_URL` | 否 | 自动推断 | slave 对外访问地址 |
| `SLAVE_STATE_FILE` | 否 | `data/slave-state.json` | slave 状态文件路径 |
| `HEARTBEAT_INTERVAL_MS` | 否 | `10000` | slave heartbeat 间隔 |
| `PANEL_API_URL` | 否 | — | 玩家会话上报目标（未配置则禁用上报） |
| `DAEMON_REPORT_KEY` | 否 | — | 玩家会话上报密钥（未配置则禁用上报） |

---

## 七、版本与变更对齐

- Daemon 版本号来源：`daemon/package.json` 的 `version` 字段（单一真相源，v4.15.0 起消除硬编码常量）
- `connected` 事件中的 `daemon_version` 与 `/health` 响应中的 `version` 均读自此字段
- 类型契约：`public/schema/daemon-api-types.ts`（HTTP 类型）、`public/schema/ws-events.ts`（WS 事件类型）
- 本文档基于 `daemon/src/server.ts`、`auth.ts`、`index.ts`、`playerSessionReporter.ts`、`slaveMode.ts` 源码提取，参数类型、字段名、必填性、错误码均与源码一致
