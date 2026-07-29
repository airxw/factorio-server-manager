---
type: api-doc
title: 服务器/实例/节点/版本/资产/批量操作域 API
date: 2026-07-25
status: active
related:
  - panel/backend/src/routes-registry.ts
  - panel/backend/src/api/routes/servers.ts
  - panel/backend/src/api/routes/packs.ts
  - panel/backend/src/api/routes/nodes.ts
  - panel/backend/src/api/routes/versions.ts
  - panel/backend/src/api/routes/assets.ts
  - panel/backend/src/api/routes/batch.ts
  - panel/backend/src/api/routes/instanceAdmins.ts
  - panel/backend/src/api/routes/instanceRoles.ts
  - public/schema/panel-api-types.ts
tags: [server, instance, node, pack, version, asset, batch, instance-admin, instance-role]
---

# 服务器/实例/节点/版本/资产/批量操作域 API

## 概述

本组接口覆盖 gsp 项目 Panel 后端的**节点（Nodes）、Pack、版本池（Versions）、实例 CRUD、实例启停/控制台、实例共管（InstanceAdmins）、实例角色（InstanceRoles）、资产（Assets）、批量操作（Batch）** 共 9 个业务子域，合计 55 个 REST 接口。

### 鉴权背景

| 项目 | 说明 |
|------|------|
| 全局中间件 | cors、json、helmet、请求日志、全局速率限制（每 IP 每秒 50 次）、维护模式、审计中间件 |
| 鉴权中间件 | `authenticateToken(JWT_SECRET)` —— 支持 **JWT Bearer Token** 与 **x-api-key 旁路认证** |
| 角色体系 | 3 级：`server_admin` > `instance_admin` > `user` |
| 管理员门控 | `requireAdmin = requireRole(Role.SERVER_ADMIN)` |
| 实例访问门控 | `requireInstanceAccess` / `requireInstanceAdmin` —— 实例级鉴权（owner / 共管 / 角色覆盖 / 绑定） |
| 节点通信鉴权 | slave → master 通过 `x-comms-key` 头自鉴权；slave 注册用 `link_key` |
| 鉴权头 | JWT：`Authorization: Bearer <token>`；节点通信：`x-comms-key: <commsKey>` |

### 路由挂载点

| 挂载点 | 中间件 | 路由工厂 |
|--------|--------|----------|
| `/api/packs` | `authenticateToken` | `createPacksRouter` + `createItemSyncRouter` + `createVersionsRouter` |
| `/api/nodes` | 无（公开路由） | `createNodesPublicRouter`（slave 注册/heartbeat/verify-token） |
| `/api/nodes` | `authenticateToken` | `createNodesRouter`（管理端点） |
| `/api/servers` | `authenticateToken` | `createServersRouter`（实例 CRUD + 启停 + 控制台） |
| `/api/servers` | `authenticateToken` | `createInstanceAdminsRouter`（实例共管） |
| `/api/servers` | `authenticateToken` | `createInstanceRolesRouter`（实例角色） |
| `/api/batch` | `authenticateToken + requireAdmin` | `createBatchRouter` |
| `/api` | `authenticateToken` | `createAssetsRouter`（资产 CRUD，前缀 `/admin/instances` 与 `/admin/assets`） |

### 统一响应约定

- **成功响应**：直接返回 JSON 数据，HTTP 200/201/202/204
- **失败响应**：
  ```json
  { "error": { "code": "<ERROR_CODE>", "message": "<人类可读消息>", "details"?: {...} } }
  ```
- **常见错误码**：

| HTTP | 错误码 | 含义 |
|------|--------|------|
| 400 | `PANEL_VALIDATION_ERROR` | 请求参数校验失败 |
| 400 | `INVALID_PACK_ID` / `EMPTY_CONTENT` / `INVALID_YAML` | Pack 参数/内容/YAML 校验失败 |
| 401 | `PANEL_UNAUTHORIZED` | 未认证或凭证无效 |
| 401 | `NODE_COMMS_KEY_INVALID` | 节点通信密钥缺失或无效 |
| 403 | `PANEL_FORBIDDEN` | 无权限访问该资源 |
| 403 | `QUOTA_EXCEEDED` | 实例配额已满 |
| 404 | `SERVER_NOT_FOUND` / `INSTANCE_NOT_FOUND` | 实例不存在 |
| 404 | `PACK_NOT_FOUND` | Pack 不存在 |
| 404 | `NODE_NOT_FOUND` | 节点不存在 |
| 404 | `USER_NOT_FOUND` | 用户不存在 |
| 404 | `PANEL_NOT_FOUND` / `INSTANCE_ADMIN_NOT_FOUND` / `INSTANCE_ROLE_NOT_FOUND` | 资源不存在 |
| 404 | `ERR_INSTANCE_NOT_FOUND` / `ERR_ASSET_NOT_FOUND` | 资产资源不存在 |
| 409 | `INVALID_SERVER_STATE` | 实例状态不允许当前操作（如非 stopped 启动） |
| 409 | `PACK_EXISTS` / `INSTANCE_ADMIN_ALREADY_EXISTS` | 资源已存在 |
| 409 | `PANEL_VALIDATION_ERROR`（版本被引用） | 版本仍被实例引用，无法删除 |
| 403 | `ERR_OVERRIDE_FORBIDDEN` / `PANEL_FORBIDDEN`（资产） | 资产覆盖被禁止 |
| 429 | `ERR_UGC_LIMIT_EXCEEDED` | UGC 资产数量超限 |
| 400 | `ERR_RCON_INJECTION` | 资产执行逻辑包含 RCON 注入风险 |
| 400 | `BATCH_LIMIT_EXCEEDED` | 批量操作超过 50 个实例上限 |
| 502 | `DAEMON_UNREACHABLE` / `NODE_DISK_USAGE_FAILED` / `NODE_JAVAS_SCAN_FAILED` | Daemon 节点错误 |
| 503 | `PANEL_SERVICE_UNAVAILABLE` / `DAEMON_UNREACHABLE` | 服务未初始化或不可达 |
| 500 | `PANEL_INTERNAL_ERROR` / `SUBDIR_CLEANUP_FAILED` / `PANEL_DISK_CLEANUP_FAILED` / `INSTANCE_ADMIN_ASSIGNMENT_FAILED` / `INSTANCE_ROLE_GRANT_FAILED` | 服务端内部错误 |

### 公网访问入口

调用示例统一使用公网 HTTPS 入口：`https://gsp.ecsrz.com:3001`（参见 `.trae/rules/0.md`，浏览器端禁止使用 `localhost:3000` / `127.0.0.1:3000`）。

---

## 一、节点（Nodes）

### 1.1 节点注册（Slave Link）

- **功能描述**：slave 节点首次接入 master 时注册，使用一次性 `link_key` 换取长期 `comms_key`。v4.25.0 起新增 linkKey 过期校验：linkKey 超过 `expires_at` 后无法注册，需调用 1.7 重新生成
- **请求方法**：POST
- **URL 路径**：`/api/nodes/link`
- **鉴权要求**：无需鉴权（用 body 中的 `link_key` 自鉴权）
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| slave_url | string | 是 | slave 节点可达的 HTTP(S) base URL |
| link_key | string | 是 | master 创建邀请时下发的一次性 link_key（v4.25.0 起带过期时间） |
| display_fqdn | string | 否 | slave 对外展示的 FQDN（默认取 slave_url） |

```json
{
  "slave_url": "https://node-1.example.com:8081",
  "link_key": "gsp_link_<32hex>",
  "display_fqdn": "node-1.example.com"
}
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| node_id | string | 注册成功的节点 ID |
| comms_key | string | 长期通信密钥，后续 slave 调用需放入 `x-comms-key` 头 |

```json
{
  "node_id": "node-abc123",
  "comms_key": "gsp_comms_<32hex>"
}
```

  - 错误响应：
    - `PANEL_VALIDATION_ERROR`(400, slave_url/link_key 缺失)
    - `NODE_LINK_KEY_INVALID`(401, linkKey 格式错误或已使用)
    - `NODE_LINK_KEY_EXPIRED`(401, v4.25.0 新增。linkKey 已过期，需调用 1.7 重新生成)
    - `NODE_ALREADY_LINKED`(409, 节点已注册)
    - `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/nodes/link \
    -H "Content-Type: application/json" \
    -d '{"slave_url":"https://node-1.example.com:8081","link_key":"gsp_link_abc..."}'
  ```

### 1.2 节点令牌验证（Verify Token）

- **功能描述**：slave 节点收到用户 token 后向 master 验证其有效性（避免 slave 持有 JWT_SECRET）
- **请求方法**：POST
- **URL 路径**：`/api/nodes/verify-token`
- **鉴权要求**：`x-comms-key` 头校验（commsKey 鉴权）
- **请求参数**：
  - 请求头：`x-comms-key: <commsKey>`
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| token | string | 是 | 待验证的 JWT |

```json
{ "token": "eyJhbGciOi..." }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| valid | boolean | token 是否有效 |
| user_id | string | 仅 valid=true 时返回，用户 ID |
| role | string | 仅 valid=true 时返回，用户角色 |
| reason | string | 仅 valid=false 时返回，失败原因 |

```json
{ "valid": true, "user_id": "u-xxx", "role": "server_admin" }
```

  - 错误响应：`PANEL_VALIDATION_ERROR`(400) / `NODE_COMMS_KEY_INVALID`(401)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/nodes/verify-token \
    -H "Content-Type: application/json" \
    -H "x-comms-key: gsp_comms_xxx" \
    -d '{"token":"eyJhbGciOi..."}'
  ```

### 1.3 节点心跳上报（Heartbeat）

- **功能描述**：slave 周期性向 master 上报心跳与负载信息，刷新 `last_seen_at`
- **请求方法**：POST
- **URL 路径**：`/api/nodes/:id/heartbeat`
- **鉴权要求**：`x-comms-key` 头校验，且 path 中的 `id` 必须与 commsKey 对应节点匹配
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

  - 请求头：`x-comms-key: <commsKey>`
  - 请求体：`NodeHeartbeatRequest`（结构由 slave 端定义，通常含负载/版本/在线实例数等）

```json
{ "load": 0.42, "instances": 7, "version": "4.13.0" }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| received | boolean | 心跳是否已接收，固定 `true` |

```json
{ "received": true }
```

  - 错误响应：`NODE_COMMS_KEY_INVALID`(401/403) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/nodes/node-abc/heartbeat \
    -H "Content-Type: application/json" \
    -H "x-comms-key: gsp_comms_xxx" \
    -d '{"load":0.42,"instances":7}'
  ```

### 1.4 节点列表（List Nodes）

- **功能描述**：返回所有已注册节点的集群信息（L2 集群化扩展，从 DB 读取）
- **请求方法**：GET
- **URL 路径**：`/api/nodes`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| nodes | NodeClusterInfo[] | 节点列表 |

  - `NodeClusterInfo` 字段：`id` / `name` / `fqdn` / `public_ip` / `status`(`online`/`offline`/`pending`) / `last_seen_at` 等（详见 `panel-api-types.ts`）

```json
{
  "nodes": [
    { "id": "node-local", "name": "master", "fqdn": "gsp.ecsrz.com", "status": "online", "last_seen_at": "2026-07-25T10:00:00Z" }
  ]
}
```

  - 错误响应：`PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes
  ```

### 1.5 节点详情（Node Detail）

- **功能描述**：查询单个节点的详情
- **请求方法**：GET
- **URL 路径**：`/api/nodes/:id`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| node | NodeDetail | 节点详情对象 |

  - 错误响应：`PANEL_INTERNAL_ERROR`(500) / AppError 映射的状态码（含节点不存在）

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc
  ```

### 1.6 创建节点邀请（Create Invite）

- **功能描述**：master 创建一个 pending 节点邀请，返回 `link_key` 与 slave 启动命令；slave 凭 link_key 完成注册。v4.25.0 起响应新增 `expires_at`（邀请密钥过期时间，默认 24h，由 `SLAVE_LINK_KEY_TTL_HOURS` 环境变量配置）
- **请求方法**：POST
- **URL 路径**：`/api/nodes`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 节点显示名称 |
| display_fqdn | string | 否 | 节点对外 FQDN（默认空） |

```json
{ "name": "node-1", "display_fqdn": "node-1.example.com" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| node_id | string | 新建的节点 ID（pending 状态） |
| link_key | string | 一次性 link_key，下发给 slave |
| slave_command | string | slave 启动命令（v4.25.0 起采用 `.env` 写入方式，避免 linkKey 进入 shell history） |
| expires_at | string | v4.25.0 新增。linkKey 过期时间（ISO 8601），超时后 slave 无法用此 linkKey 注册，需调用 1.7 重新生成 |

```json
{
  "node_id": "node-abc",
  "link_key": "gsp_link_xxx",
  "slave_command": "# 在项目 daemon 目录下创建 .env 后执行 npm start\ncat >> daemon/.env << 'EOF'\nSLAVE_MODE=true\nMASTER_URL=https://gsp.ecsrz.com:3001\nLINK_KEY=gsp_link_xxx\nEOF\nnpm start",
  "expires_at": "2026-07-27T10:00:00.000Z"
}
```

  - 错误响应：`PANEL_VALIDATION_ERROR`(400) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/nodes \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"name":"node-1"}'
  ```

### 1.7 重新生成邀请密钥（Regenerate Invite）

- **功能描述**：当 slave 注册失败或原 link_key 过期时，重新生成 link_key（仅对 pending 节点有效）。原 linkKey 立即失效，已下载的部署脚本也无法再下载
- **请求方法**：POST
- **URL 路径**：`/api/nodes/:id/regenerate-invite`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：同 1.6 的 `CreateNodeInviteResponse`（含新的 `link_key` / `slave_command` / `expires_at`）
  - 错误响应：`PANEL_INTERNAL_ERROR`(500) / `NODE_NOT_FOUND`(404) / `NODE_ALREADY_LINKED`(409, 已注册节点不能重新生成) / `PANEL_VALIDATION_ERROR`(400, master 节点不支持)

- **调用示例**：
  ```bash
  curl -X POST -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc/regenerate-invite
  ```

### 1.7.1 下载部署脚本（Download Bootstrap Script）

- **功能描述**：v4.25.0 新增。通过 linkKey 下载 `slave-bootstrap.sh` 一键部署脚本（由后端生成，替代原前端字符串拼接）。脚本包含 Node.js 安装、git clone、依赖安装 + 构建、`.env` 生成、systemd 服务创建等完整流程
- **请求方法**：GET
- **URL 路径**：`/api/nodes/invite/:linkKey/bootstrap-script`
- **鉴权要求**：无需 JWT（slave 机器此时尚未注册，通过 linkKey 自鉴权）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| linkKey | string | 是 | 邀请密钥明文（格式 `gsp_link_<32hex>`） |

- **响应数据**：
  - 成功响应（200）：
    - Content-Type: `text/x-shellscript; charset=utf-8`
    - Content-Disposition: `attachment; filename="slave-bootstrap.sh"`
    - Body: 完整的 bash 脚本文本（约 4KB），包含 `MASTER_URL` / `LINK_KEY` / `INSTALL_DIR` / `REPO_URL` / `SLAVE_PORT` 已注入的变量

  - 错误响应：
    - `NODE_LINK_KEY_INVALID`(401, linkKey 格式错误或已使用)
    - `NODE_ALREADY_LINKED`(409, 节点已注册，不能再下载脚本)
    - `NODE_LINK_KEY_EXPIRED`(401, linkKey 已过期，需调用 1.7 重新生成)

- **环境变量配置**（后端读取，用于脚本生成）：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `SLAVE_REPO_URL` | `https://github.com/airxw/GSP-Panel.git` | 项目仓库地址 |
| `SLAVE_INSTALL_DIR` | `/opt/gsp-slave` | slave 安装目录 |
| `SLAVE_PORT` | `8080` | slave daemon 监听端口 |
| `PUBLIC_BASE_URL` | `https://gsp.ecsrz.com:3001` | master Panel 对外公开地址 |
| `SLAVE_LINK_KEY_TTL_HOURS` | `24` | linkKey 过期时间（小时） |

- **调用示例**：
  ```bash
  # 下载脚本
  curl -o slave-bootstrap.sh https://gsp.ecsrz.com:3001/api/nodes/invite/gsp_link_xxx/bootstrap-script

  # 在 slave 机器执行
  chmod +x slave-bootstrap.sh
  sudo bash slave-bootstrap.sh
  ```

- **安全说明**：
  - linkKey 通过 `export` 注入 shell 环境变量 + heredoc 引用，避免进入 shell history
  - 注册成功后 `link_key_hash` 与 `link_key_expires_at` 同时清空，原 linkKey 无法再下载脚本
  - 脚本使用 `npm install` + `npm run build` + `npm prune --production` 三步法（修复 Bug #3：原 `npm install --production` 致 `npm run build` 缺 tsc）

### 1.8 删除节点（Delete Node）

- **功能描述**：删除一个节点（仅当节点无关联实例时方可删除）
- **请求方法**：DELETE
- **URL 路径**：`/api/nodes/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 被删除的节点 ID |
| deleted | boolean | 固定 `true` |

```json
{ "id": "node-abc", "deleted": true }
```

  - 错误响应：`PANEL_INTERNAL_ERROR`(500) / AppError 映射状态码

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc
  ```

### 1.9 节点测速（Ping）

- **功能描述**：master 主动 ping slave 节点，测量 HTTP 往返延迟
- **请求方法**：GET
- **URL 路径**：`/api/nodes/:id/ping`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| latency_ms | number | 健康检查往返延迟（毫秒） |

```json
{ "latency_ms": 42 }
```

  - 错误响应：`PANEL_SERVICE_UNAVAILABLE`(503) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc/ping
  ```

### 1.10 节点磁盘占用（Node Disk Usage）

- **功能描述**：通过节点 daemon 执行 `df -B1 /` 解析根分区磁盘占用
- **请求方法**：GET
- **URL 路径**：`/api/nodes/:id/disk-usage`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| usage | NodeDiskUsage | 节点磁盘占用对象 |

  - `NodeDiskUsage` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| node_id | string | 节点 ID |
| filesystem | string | 文件系统设备名 |
| total_bytes | number | 总字节数 |
| used_bytes | number | 已用字节数 |
| available_bytes | number | 可用字节数 |
| used_percent | number | 使用率百分比 |
| mount | string | 挂载点 |

```json
{
  "usage": {
    "node_id": "node-abc",
    "filesystem": "/dev/sda1",
    "total_bytes": 107374182400,
    "used_bytes": 53687091200,
    "available_bytes": 53687091200,
    "used_percent": 50,
    "mount": "/"
  }
}
```

  - 错误响应：`PANEL_SERVICE_UNAVAILABLE`(503) / `NODE_DISK_USAGE_FAILED`(502) / `NODE_DISK_USAGE_PARSE_FAILED`(502)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc/disk-usage
  ```

### 1.11 节点 Java 扫描（Scan Javas）

- **功能描述**：扫描节点上已安装的 Java 运行时列表（用于启动时选择合适 Java 版本）
- **请求方法**：GET
- **URL 路径**：`/api/nodes/:id/javas`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 节点 ID |

- **响应数据**：
  - 成功响应（200）：返回 `ScanJavasResult`（daemon-api-types）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| javas | array | Java 安装列表（含 path / version 等字段，详见 daemon-api-types） |

  - 错误响应：`PANEL_SERVICE_UNAVAILABLE`(503) / `NODE_JAVAS_SCAN_FAILED`(502)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/nodes/node-abc/javas
  ```

---

## 二、Pack 管理

### 2.1 列出所有 Pack（List Packs）

- **功能描述**：返回所有已加载 Pack 的摘要信息
- **请求方法**：GET
- **URL 路径**：`/api/packs`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| packs | PackSummary[] | Pack 摘要列表 |

  - `PackSummary` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | Pack ID |
| game | string | 游戏类型（如 `minecraft`） |
| variant | string | Pack 变体 |
| display_name | string | 展示名称 |
| version | string | Pack 版本号 |
| ui_tabs | object \| undefined | UI tab 配置 |

```json
{
  "packs": [
    { "id": "minecraft-vanilla", "game": "minecraft", "variant": "vanilla", "display_name": "Minecraft 原版", "version": "1.0.0" }
  ]
}
```

  - 错误响应：`PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs
  ```

### 2.2 查询 Pack YAML（Get Pack）

- **功能描述**：读取指定 Pack 的完整 `pack.yaml` 文本内容
- **请求方法**：GET
- **URL 路径**：`/api/packs/:id`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Pack ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | Pack ID |
| yaml_path | string | pack.yaml 绝对路径 |
| content | string | pack.yaml 完整文本内容 |

```json
{ "id": "minecraft-vanilla", "yaml_path": "/opt/packs/minecraft-vanilla/pack.yaml", "content": "pack:\n  id: ..." }
```

  - 错误响应：`PACK_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla
  ```

### 2.3 查询 Pack 物品池配置（Items Config）

- **功能描述**：返回 Pack 物品池元信息（品质、品类、是否支持品质等），供前端商城配置 UI 使用
- **请求方法**：GET
- **URL 路径**：`/api/packs/:id/items-config`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Pack ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| pack_id | string | Pack ID |
| qualities | string[] | 品质列表 |
| quality_tiers | number | 品质档位数 |
| categories | string[] | 品类列表 |
| support_quality | boolean | 商城是否支持品质列 |
| quality_tiers_shop | number | 商城品质档位数 |

```json
{
  "pack_id": "minecraft-vanilla",
  "qualities": ["normal", "rare", "epic"],
  "quality_tiers": 3,
  "categories": ["block", "tool"],
  "support_quality": true,
  "quality_tiers_shop": 3
}
```

  - 错误响应：`PACK_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/items-config
  ```

### 2.4 创建 Pack（Create Pack）

- **功能描述**：在 `packs/` 目录下创建新 Pack 的 `pack.yaml` 文件
- **请求方法**：POST
- **URL 路径**：`/api/packs`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| pack_id | string | 是 | Pack ID，仅允许字母/数字/连字符/下划线，长度 1-64 |
| content | string | 是 | pack.yaml 完整文本内容，不能为空 |

```json
{ "pack_id": "minecraft-vanilla", "content": "pack:\n  id: minecraft-vanilla\n  ..." }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 固定 `true` |
| pack_id | string | Pack ID |
| yaml_path | string | 写入的 yaml 文件绝对路径 |

```json
{ "success": true, "pack_id": "minecraft-vanilla", "yaml_path": "/opt/packs/minecraft-vanilla/pack.yaml" }
```

  - 错误响应：`INVALID_PACK_ID`(400) / `EMPTY_CONTENT`(400) / `PACK_EXISTS`(409) / `INVALID_YAML`(422) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/packs \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"pack_id":"minecraft-vanilla","content":"pack:\n  id: minecraft-vanilla"}'
  ```

### 2.5 更新 Pack（Update Pack）

- **功能描述**：覆盖写入指定 Pack 的 `pack.yaml`
- **请求方法**：PUT
- **URL 路径**：`/api/packs/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Pack ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| content | string | 是 | 新的 pack.yaml 完整文本 |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 固定 `true` |
| pack_id | string | Pack ID |
| yaml_path | string | yaml 文件路径 |

  - 错误响应：`INVALID_PACK_ID`(400) / `EMPTY_CONTENT`(400) / `PACK_NOT_FOUND`(404) / `INVALID_YAML`(422) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X PUT https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"content":"pack:\n  id: minecraft-vanilla\n  ..."}'
  ```

### 2.6 删除 Pack（Delete Pack）

- **功能描述**：递归删除指定 Pack 的整个目录
- **请求方法**：DELETE
- **URL 路径**：`/api/packs/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Pack ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 固定 `true` |
| pack_id | string | 被删除的 Pack ID |

  - 错误响应：`INVALID_PACK_ID`(400) / `PACK_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla
  ```

### 2.7 重载 Pack 注册表（Reload Packs）

- **功能描述**：重新扫描 `packs/` 目录并加载所有 pack.yaml，返回加载结果
- **请求方法**：POST
- **URL 路径**：`/api/packs/reload`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| loaded | string[] | 成功加载的 Pack ID 列表 |
| failed | object[] | 加载失败的 Pack 列表，每项含 `pack`(文件路径) 与 `error`(错误信息) |
| total | number | 成功加载总数 |

```json
{
  "loaded": ["minecraft-vanilla", "terraria-vanilla"],
  "failed": [{ "pack": "/opt/packs/broken/pack.yaml", "error": "缺 pack.id" }],
  "total": 2
}
```

  - 错误响应：`PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/reload
  ```

---

## 三、版本池（Versions）

### 3.1 查询可用版本（Available Versions）

- **功能描述**：从远程版本源（VersionProvider / HTTP manifest / static 内置源）拉取可用版本列表，并标记本地已下载状态
- **请求方法**：GET
- **URL 路径**：`/api/packs/:packId/versions/available`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| packId | string | 是 | Pack ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| latest | string | 最新版本号 |
| versions | AvailableVersionEntry[] | 版本列表，按版本号降序排序 |

  - `AvailableVersionEntry` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| version | string | 版本号 |
| type | string \| undefined | 版本类型（如 release/snapshot） |
| downloaded | boolean | 本地是否已下载 |

```json
{
  "latest": "1.20.4",
  "versions": [
    { "version": "1.20.4", "type": "release", "downloaded": true },
    { "version": "1.20.3", "type": "release", "downloaded": false }
  ]
}
```

  - 错误响应：`PACK_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/versions/available
  ```

### 3.2 列出已下载版本（List Downloaded Versions）

- **功能描述**：返回该 Pack 已下载到本地版本池的所有版本，含引用计数与下载者用户名
- **请求方法**：GET
- **URL 路径**：`/api/packs/:packId/versions`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| packId | string | 是 | Pack ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| versions | GameVersionSummary[] | 已下载版本列表，按 major/minor/patch 降序 |

  - `GameVersionSummary` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 版本记录 ID |
| pack_id | string | Pack ID |
| version | string | 版本号字符串 |
| node_id | string | 下载所在节点 ID |
| download_path | string | 版本文件绝对路径 |
| file_size_bytes | number \| null | 文件大小（字节） |
| downloaded_by | string | 下载者用户 ID |
| downloaded_by_username | string | 下载者用户名 |
| downloaded_at | string | 下载时间（ISO 8601） |
| created_at | string | 创建时间 |
| reference_count | number | 引用该版本的实例数 |

  - 错误响应：`PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/versions
  ```

### 3.3 触发版本下载（Download Version）

- **功能描述**：异步触发版本下载任务（支持指定版本号，缺省下载最新版本），返回 `task_id` 用于查询进度
- **请求方法**：POST
- **URL 路径**：`/api/packs/:packId/versions/download`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| packId | string | 是 | Pack ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| version | string | 否 | 指定版本号；缺省时下载最新版本 |

```json
{ "version": "1.20.4" }
```

- **响应数据**：
  - 成功响应（202）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| task_id | string | 下载任务 ID，用于轮询进度 |
| message | string | 任务启动消息 |

```json
{ "task_id": "task-uuid", "message": "正在下载 1.20.4..." }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PACK_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/versions/download \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"version":"1.20.4"}'
  ```

### 3.4 查询下载进度（Download Progress）

- **功能描述**：根据 `task_id` 查询版本下载任务的当前状态与百分比
- **请求方法**：GET
- **URL 路径**：`/api/packs/:packId/versions/download/progress`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| packId | string | 是 | Pack ID |

  - 查询参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| task_id | string | 是 | 下载任务 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| task_id | string | 任务 ID |
| phase | string | 任务阶段：`queued`/`checking`/`downloading`/`completed`/`failed` |
| progress_percent | number | 进度百分比 0-100 |
| message | string | 当前阶段消息 |
| error | string \| undefined | 仅 phase=failed 时返回的错误信息 |

```json
{ "task_id": "task-uuid", "phase": "downloading", "progress_percent": 30, "message": "正在下载 1.20.4..." }
```

  - 错误响应：`PANEL_VALIDATION_ERROR`(400，缺 task_id) / `PANEL_INTERNAL_ERROR`(404，任务不存在)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" \
    "https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/versions/download/progress?task_id=task-uuid"
  ```

### 3.5 删除版本（Delete Version）

- **功能描述**：删除版本池中的指定版本（先清理磁盘文件，再删 DB 记录），仅 server_admin 可调用，且该版本未被实例引用
- **请求方法**：DELETE
- **URL 路径**：`/api/packs/:packId/versions/:versionId`
- **鉴权要求**：JWT + requireRole(SERVER_ADMIN)（路由内部判定）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| packId | string | 是 | Pack ID |
| versionId | string | 是 | 版本记录 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 被删除的版本记录 ID |
| deleted | boolean | 是否已删除 |
| freed_bytes | number \| undefined | 释放的磁盘字节数 |

```json
{ "id": "v-xxx", "deleted": true, "freed_bytes": 12345678 }
```

  - 错误响应：`PANEL_FORBIDDEN`(403) / `PANEL_NOT_FOUND`(404) / `PANEL_VALIDATION_ERROR`(409，版本被引用) / `PANEL_DISK_CLEANUP_FAILED`(500) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/packs/minecraft-vanilla/versions/v-xxx
  ```

---

## 四、实例 CRUD

### 4.1 列出实例（List Servers）

- **功能描述**：按角色返回可见实例列表（server_admin 全部；instance_admin owner+共管；user owner+绑定）
- **请求方法**：GET
- **URL 路径**：`/api/servers`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| servers | ServerSummary[] | 实例摘要列表，按 created_at 升序 |

  - `ServerSummary` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 实例 ID |
| name | string | 实例名称 |
| pack_id | string | Pack ID |
| game_type | string | 游戏类型 |
| node_id | string | 节点 ID |
| owner_user_id | string | 所有者用户 ID |
| owner_username | string | 所有者用户名 |
| status | string | 实例状态：`stopped`/`starting`/`running`/`stopping` |
| port | number | 游戏端口 |
| rcon_port | number | RCON 端口 |
| current_version | string \| null | 当前版本号 |
| last_activity_at | string \| null | 最后活跃时间 |
| disk_usage_bytes | number \| null | 磁盘占用缓存（字节） |
| disk_usage_updated_at | string \| null | 磁盘占用缓存更新时间 |
| created_at | string | 创建时间 |
| updated_at | string | 更新时间 |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers
  ```

### 4.2 创建实例（Create Server）

- **功能描述**：基于指定 Pack 创建新实例，自动分配端口、生成 RCON 密码、初始化商城物品
- **请求方法**：POST
- **URL 路径**：`/api/servers`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 实例名称 |
| pack_id | string | 是 | Pack ID |
| node_id | string | 否 | 节点 ID，缺省 `node-local` |
| port | number | 否 | 游戏端口，缺省自动分配 |
| rcon_port | number | 否 | RCON 端口，缺省自动分配 |
| version_id | string | 否 | 指定版本记录 ID，缺省取 Pack 最新版本 |
| resource_limits | object | 否 | 资源限制 JSON |

```json
{ "name": "我的服务器", "pack_id": "minecraft-vanilla", "version_id": "v-xxx" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server | ServerSummary | 新建的实例摘要 |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `PACK_NOT_FOUND`(400) / `NODE_NOT_FOUND`(400) / `PANEL_FORBIDDEN`(403，pack 未启用 / 实例数上限 / 配额已满 `QUOTA_EXCEEDED`) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/servers \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"name":"我的服务器","pack_id":"minecraft-vanilla"}'
  ```

### 4.3 实例详情（Server Detail）

- **功能描述**：返回指定实例的详情；除 owner/admin 外，持有 active 绑定的玩家也可只读访问
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id`
- **鉴权要求**：JWT（owner / server_admin / instance_admin / 持有 active 绑定的 user）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server | ServerSummary | 实例摘要（字段同 4.1） |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx
  ```

### 4.4 删除实例（Delete Server）

- **功能描述**：删除指定实例（仅 stopped 状态可删除），需 owner 或 server_admin 权限
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:id`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 被删除的实例 ID |
| deleted | boolean | 固定 `true` |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INVALID_SERVER_STATE`(409，非 stopped) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx
  ```

---

## 五、实例启停与控制台

### 5.1 启动实例（Start Server）

- **功能描述**：将 stopped 状态的实例启动，状态置为 starting 并由 WS 事件确认 running
- **请求方法**：POST
- **URL 路径**：`/api/servers/:id/start`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server_id | string | 实例 ID |
| status | string | 固定 `"starting"` |
| pid | number \| undefined | Daemon 返回的进程 PID |

```json
{ "server_id": "s-xxx", "status": "starting", "pid": 12345 }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INVALID_SERVER_STATE`(409) / `PACK_NOT_FOUND`(400) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/start
  ```

### 5.2 停止实例（Stop Server）

- **功能描述**：停止 running/starting 状态的实例，状态置为 stopping，实际 stopped 由 WS 事件确认
- **请求方法**：POST
- **URL 路径**：`/api/servers/:id/stop`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server_id | string | 实例 ID |
| status | string | 固定 `"stopping"` |

```json
{ "server_id": "s-xxx", "status": "stopping" }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INVALID_SERVER_STATE`(409) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/stop
  ```

### 5.3 发送命令（Send Command）

- **功能描述**：向 running 状态实例的 RCON/控制台发送命令，返回命令输出
- **请求方法**：POST
- **URL 路径**：`/api/servers/:id/command`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| command | string | 是 | 命令内容，不能为空 |

```json
{ "command": "say hello" }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server_id | string | 实例 ID |
| output | string | 命令输出文本 |
| success | boolean | 命令是否成功 |

```json
{ "server_id": "s-xxx", "output": "[Server] hello", "success": true }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INVALID_SERVER_STATE`(409) / `PANEL_VALIDATION_ERROR`(400) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/servers/s-xxx/command \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"command":"say hello"}'
  ```

### 5.4 控制台历史日志（Server Logs）

- **功能描述**：从 Daemon 内存环形缓冲拉取实例最近 N 行控制台日志，供前端重新挂载时恢复上下文
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id/logs`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

  - 查询参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | number | 否 | 返回行数，缺省 500，必须 >0 |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| lines | string[] | 历史日志行数组 |

```json
{ "lines": ["[12:00:01] [Server thread/INFO]: Starting minecraft", "..."] }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" "https://gsp.ecsrz.com:3001/api/servers/s-xxx/logs?limit=200"
  ```

### 5.5 实例磁盘占用（Server Disk Usage）

- **功能描述**：实时统计实例根目录及子目录（backups/saves/mods/logs）磁盘占用，并刷新 DB 缓存
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id/disk-usage`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| usage | ServerDiskUsage | 实例磁盘占用对象 |

  - `ServerDiskUsage` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server_id | string | 实例 ID |
| total_bytes | number | 实例根目录总占用 |
| subdirs | object[] | 子目录占用列表，每项含 `name` 与 `bytes` |
| updated_at | string | 统计时间（ISO 8601） |

```json
{
  "usage": {
    "server_id": "s-xxx",
    "total_bytes": 1073741824,
    "subdirs": [
      { "name": "backups", "bytes": 524288000 },
      { "name": "saves", "bytes": 104857600 },
      { "name": "mods", "bytes": 262144000 },
      { "name": "logs", "bytes": 10485760 }
    ],
    "updated_at": "2026-07-25T10:00:00Z"
  }
}
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `PANEL_SERVICE_UNAVAILABLE`(503，daemonClientService 缺失) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/disk-usage
  ```

### 5.6 子目录清理（Cleanup Subdir）

- **功能描述**：清理实例指定子目录（backups/saves/mods/logs/cache），running/starting 状态下禁止清理
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:id/subdir/:subdir`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |
| subdir | string | 是 | 子目录名（如 `backups`/`saves`/`mods`/`logs`/`cache`） |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| server_id | string | 实例 ID |
| subdir | string | 被清理的子目录名 |
| freed_bytes | number | 释放的字节数 |

```json
{ "server_id": "s-xxx", "subdir": "backups", "freed_bytes": 524288000 }
```

  - 错误响应：`PANEL_SERVICE_UNAVAILABLE`(503，safeRemoveService 未启用) / `PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INVALID_SERVER_STATE`(409，running/starting) / `SUBDIR_CLEANUP_FAILED`(500) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/servers/s-xxx/subdir/backups
  ```

### 5.7 列出实例日志文件（List Log Files）

- **功能描述**：列出实例所有日志文件（转发 Daemon）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id/log-files`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：返回 Daemon `listLogFiles` 结果（结构由 daemon-api-types 定义，通常含文件名/大小/修改时间数组）
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/log-files
  ```

### 5.8 读取实例日志文件（Read Log File）

- **功能描述**：读取指定日志文件的尾部内容（转发 Daemon）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id/log-files/:filename`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |
| filename | string | 是 | 日志文件名 |

  - 查询参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| count | number | 否 | 返回尾部行数，必须 >0，缺省由 Daemon 决定 |

- **响应数据**：
  - 成功响应（200）：返回 Daemon `readLogFile` 结果（结构由 daemon-api-types 定义）
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" \
    "https://gsp.ecsrz.com:3001/api/servers/s-xxx/log-files/latest.log?count=200"
  ```

### 5.9 删除实例日志文件（Delete Log File）

- **功能描述**：删除实例指定日志备份文件（转发 Daemon），Daemon 返回 204 时 Panel 同样以 204 响应
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:id/log-files/:filename`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |
| filename | string | 是 | 日志文件名 |

- **响应数据**：
  - 成功响应（204）：无响应体
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/servers/s-xxx/log-files/old-2025-01-01.log
  ```

### 5.10 在线玩家列表（Online Players）

- **功能描述**：获取实例当前在线玩家列表（转发 Daemon）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:id/players`
- **鉴权要求**：JWT（owner / server_admin）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：返回 Daemon `getOnlinePlayers` 结果（结构由 daemon-api-types 定义，通常含 name/uuid/ping 等数组）
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/players
  ```

---

## 六、实例共管（Instance Admins）

### 6.1 列出实例管理员（List Instance Admins）

- **功能描述**：返回实例的 owner 信息及共管管理员列表
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/admins`
- **鉴权要求**：JWT（server_admin 全通过；instance_admin 仅 owner 通过；user 拒绝）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| admins | InstanceAdmin[] | 共管管理员列表 |
| owner | object | 实例 owner 信息 |

  - `InstanceAdmin` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 共管记录 ID |
| instance_id | string | 实例 ID |
| user_id | string | 被授权用户 ID |
| username | string | 被授权用户名 |
| assigned_by | string | 授权者用户 ID |
| assigned_at | string | 授权时间（ISO 8601） |

  - `owner` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user_id | string | owner 用户 ID |
| username | string | owner 用户名 |

```json
{
  "admins": [
    { "id": "ia-xxx", "instance_id": "s-xxx", "user_id": "u-aaa", "username": "alice", "assigned_by": "u-bbb", "assigned_at": "2026-07-25T10:00:00Z" }
  ],
  "owner": { "user_id": "u-bbb", "username": "bob" }
}
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/admins
  ```

### 6.2 分配实例管理员（Assign Instance Admin）

- **功能描述**：将指定用户授权为实例的共管管理员
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/admins`
- **鉴权要求**：JWT（server_admin / instance_admin owner）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| user_id | string | 是 | 待授权用户 ID（不能为 owner 自身） |

```json
{ "user_id": "u-aaa" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| admin | InstanceAdmin | 新建的共管记录 |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `PANEL_VALIDATION_ERROR`(400) / `USER_NOT_FOUND`(404) / `INSTANCE_ADMIN_ALREADY_EXISTS`(409) / `INSTANCE_ADMIN_ASSIGNMENT_FAILED`(500) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/servers/s-xxx/admins \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"user_id":"u-aaa"}'
  ```

### 6.3 移除实例管理员（Remove Instance Admin）

- **功能描述**：撤销某用户的实例共管权限
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/admins/:userId`
- **鉴权要求**：JWT（server_admin / instance_admin owner）
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |
| userId | string | 是 | 待移除用户 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| deleted | boolean | 固定 `true` |
| user_id | string | 被移除的用户 ID |

```json
{ "deleted": true, "user_id": "u-aaa" }
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `SERVER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403) / `INSTANCE_ADMIN_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/servers/s-xxx/admins/u-aaa
  ```

---

## 七、实例角色（Instance Roles）

### 7.1 列出实例角色分配（List Instance Roles）

- **功能描述**：返回实例的所有未过期角色覆盖记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/roles`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| roles | InstanceRole[] | 实例级角色记录列表 |

  - `InstanceRole` 字段（详见 `panel-api-types.ts`）：含 `instance_id` / `user_id` / `role`(`instance_admin`/`user`) / `granted_by` / `granted_at` / `expires_at` 等

```json
{
  "roles": [
    { "id": "ir-xxx", "instance_id": "s-xxx", "user_id": "u-aaa", "role": "instance_admin", "granted_by": "u-bbb", "granted_at": "2026-07-25T10:00:00Z", "expires_at": null }
  ]
}
```

  - 错误响应：`PANEL_FORBIDDEN`(403) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/servers/s-xxx/roles
  ```

### 7.2 授予实例角色（Grant Instance Role）

- **功能描述**：授予或更新某用户在该实例上的角色覆盖（`instance_admin` / `user`），支持过期时间
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/roles`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| user_id | string | 是 | 被授权用户 ID |
| role | string | 是 | 角色，必须为 `instance_admin` 或 `user` |
| expires_at | string \| null | 否 | ISO 8601 过期时间；null 或不传表示永久 |

```json
{ "user_id": "u-aaa", "role": "instance_admin", "expires_at": "2026-12-31T23:59:59Z" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| role | InstanceRole | 新建的角色记录 |

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `USER_NOT_FOUND`(404) / `PANEL_FORBIDDEN`(403，不可对 server_admin 授予) / `INSTANCE_ROLE_GRANT_FAILED`(500) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/servers/s-xxx/roles \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"user_id":"u-aaa","role":"instance_admin"}'
  ```

### 7.3 撤销实例角色（Revoke Instance Role）

- **功能描述**：撤销某用户在该实例上的角色覆盖记录
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/roles/:userId`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| serverId | string | 是 | 实例 ID |
| userId | string | 是 | 被撤销用户 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| deleted | boolean | 固定 `true` |
| user_id | string | 被撤销的用户 ID |

```json
{ "deleted": true, "user_id": "u-aaa" }
```

  - 错误响应：`PANEL_FORBIDDEN`(403) / `INSTANCE_ROLE_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/servers/s-xxx/roles/u-aaa
  ```

---

## 八、资产管理（Assets）

### 8.1 实例合并资产列表（Merged Assets）

- **功能描述**：返回指定实例的合并资产（全局资产 + 实例 override + UGC 资产）
- **请求方法**：GET
- **URL 路径**：`/api/admin/instances/:instanceId/assets`
- **鉴权要求**：JWT + requireInstanceAdmin('instanceId')
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instanceId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| assets | MergedAsset[] | 合并后的资产列表 |

  - `MergedAsset` 字段（详见 `public/interface_stub/asset_interfaces`）：含 id / name / price / is_active / execution_logic / source(`global`/`override`/`ugc`) 等

```json
{
  "assets": [
    { "id": "a-xxx", "name": "钻石礼包", "price": 100, "is_active": true, "source": "global" }
  ]
}
```

  - 错误响应：`PANEL_FORBIDDEN`(403) / `ERR_INSTANCE_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/admin/instances/s-xxx/assets
  ```

### 8.2 覆盖全局资产（Override Asset）

- **功能描述**：在实例级别覆盖某全局资产的字段（name/price/is_active/execution_logic）
- **请求方法**：POST
- **URL 路径**：`/api/admin/instances/:instanceId/assets/:globalAssetId/override`
- **鉴权要求**：JWT + requireInstanceAdmin('instanceId')
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instanceId | string | 是 | 实例 ID |
| globalAssetId | string | 是 | 全局资产 ID |

  - 请求体（字段均可选，仅传需要覆盖的字段）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 否 | 覆盖名称 |
| price | number | 否 | 覆盖价格 |
| is_active | boolean | 否 | 覆盖启用状态 |
| execution_logic | string | 否 | 覆盖执行逻辑 |

```json
{ "price": 80, "is_active": false }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| overridden | boolean | 固定 `true` |

  - 错误响应：`PANEL_FORBIDDEN`(403) / `ERR_INSTANCE_NOT_FOUND`(404) / `ERR_ASSET_NOT_FOUND`(404) / `ERR_OVERRIDE_FORBIDDEN`(403) / `ERR_RCON_INJECTION`(400) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/admin/instances/s-xxx/assets/a-xxx/override \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"price":80,"is_active":false}'
  ```

### 8.3 创建 UGC 资产（Create UGC Asset）

- **功能描述**：在实例上创建一个用户生成内容（UGC）资产，受 UGC 数量上限约束
- **请求方法**：POST
- **URL 路径**：`/api/admin/instances/:instanceId/assets/ugc`
- **鉴权要求**：JWT + requireInstanceAdmin('instanceId')
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| instanceId | string | 是 | 实例 ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 资产名称，不能为空 |
| price | number | 否 | 价格，需为非负数，缺省 0 |
| is_active | boolean | 否 | 启用状态，缺省 true |
| execution_logic | string | 否 | 执行逻辑，缺省空字符串 |

```json
{ "name": "自定义礼包", "price": 50, "is_active": true, "execution_logic": "give @s diamond 1" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 新建的 UGC 资产 ID |

```json
{ "id": "ugc-xxx" }
```

  - 错误响应：`PANEL_VALIDATION_ERROR`(400) / `PANEL_FORBIDDEN`(403) / `ERR_INSTANCE_NOT_FOUND`(404) / `ERR_UGC_LIMIT_EXCEEDED`(429) / `ERR_RCON_INJECTION`(400) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/admin/instances/s-xxx/assets/ugc \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"name":"自定义礼包","price":50}'
  ```

### 8.4 全局资产列表（List Global Assets）

- **功能描述**：返回所有全局资产
- **请求方法**：GET
- **URL 路径**：`/api/admin/assets`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| assets | GlobalAsset[] | 全局资产列表 |

  - `GlobalAsset` 字段：含 id / type(`COMMODITY`/`TEMPLATE`/`RULE`) / name / default_price / execution_logic / is_active / game_pack_id 等

  - 错误响应：`PANEL_FORBIDDEN`(403) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -H "Authorization: Bearer <token>" https://gsp.ecsrz.com:3001/api/admin/assets
  ```

### 8.5 创建全局资产（Create Global Asset）

- **功能描述**：创建一个新的全局资产
- **请求方法**：POST
- **URL 路径**：`/api/admin/assets`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 资产名称，不能为空 |
| type | string | 是 | 类型：`COMMODITY` / `TEMPLATE` / `RULE` |
| default_price | number | 否 | 默认价格，需为非负数 |
| execution_logic | string | 否 | 执行逻辑 |
| is_active | boolean | 否 | 启用状态，缺省 true |
| game_pack_id | string | 否 | 关联的 Pack ID |

```json
{ "name": "钻石礼包", "type": "COMMODITY", "default_price": 100, "execution_logic": "give @s diamond 1" }
```

- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| asset | GlobalAsset | 新建的资产对象 |

  - 错误响应：`PANEL_VALIDATION_ERROR`(400) / `PANEL_FORBIDDEN`(403) / `ERR_RCON_INJECTION`(400) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/admin/assets \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"name":"钻石礼包","type":"COMMODITY","default_price":100}'
  ```

### 8.6 更新全局资产（Update Global Asset）

- **功能描述**：更新指定全局资产的可变字段（ PATCH 语义，仅传需要更新的字段）
- **请求方法**：PUT
- **URL 路径**：`/api/admin/assets/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 全局资产 ID |

  - 请求体（字段均可选）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| type | string | 否 | 新类型：`COMMODITY` / `TEMPLATE` / `RULE` |
| name | string | 否 | 新名称 |
| default_price | number | 否 | 新默认价格 |
| execution_logic | string | 否 | 新执行逻辑 |
| is_active | boolean | 否 | 新启用状态 |
| game_pack_id | string | 否 | 新关联 Pack ID |

```json
{ "default_price": 120, "is_active": false }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| asset | GlobalAsset | 更新后的资产对象 |

  - 错误响应：`PANEL_VALIDATION_ERROR`(400) / `PANEL_FORBIDDEN`(403) / `ERR_ASSET_NOT_FOUND`(404) / `ERR_RCON_INJECTION`(400) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X PUT https://gsp.ecsrz.com:3001/api/admin/assets/a-xxx \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"default_price":120,"is_active":false}'
  ```

### 8.7 删除全局资产（Delete Global Asset）

- **功能描述**：删除指定全局资产，级联清理所有实例 override
- **请求方法**：DELETE
- **URL 路径**：`/api/admin/assets/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 全局资产 ID |

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| deleted | boolean | 固定 `true` |
| id | string | 被删除的资产 ID |

```json
{ "deleted": true, "id": "a-xxx" }
```

  - 错误响应：`PANEL_FORBIDDEN`(403) / `ERR_ASSET_NOT_FOUND`(404) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X DELETE -H "Authorization: Bearer <token>" \
    https://gsp.ecsrz.com:3001/api/admin/assets/a-xxx
  ```

---

## 九、批量操作（Batch）

> 全部批量端点挂在 `/api/batch`，挂载时已统一套 `authenticateToken + requireAdmin`，**仅 server_admin 可访问**。单次批量上限 50 个实例，超限返回 `BATCH_LIMIT_EXCEEDED`(400)。每个实例独立 try-catch，返回 `BatchActionResult[]` 聚合结果。

### 9.1 批量启动实例（Batch Start）

- **功能描述**：批量启动多个 stopped 状态的实例
- **请求方法**：POST
- **URL 路径**：`/api/batch/start`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| instance_ids | string[] | 是 | 待启动实例 ID 数组，非空，去重后上限 50 |

```json
{ "instance_ids": ["s-aaa", "s-bbb", "s-ccc"] }
```

- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| results | BatchActionResult[] | 每个实例的执行结果 |

  - `BatchActionResult` 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| instance_id | string | 实例 ID |
| success | boolean | 是否成功 |
| message | string \| undefined | 失败原因（成功时无） |

```json
{
  "results": [
    { "instance_id": "s-aaa", "success": true },
    { "instance_id": "s-bbb", "success": false, "message": "仅 stopped 状态可启动，当前状态: running" }
  ]
}
```

  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `BATCH_LIMIT_EXCEEDED`(400) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/batch/start \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"instance_ids":["s-aaa","s-bbb"]}'
  ```

### 9.2 批量停止实例（Batch Stop）

- **功能描述**：批量停止多个 running/starting 状态的实例
- **请求方法**：POST
- **URL 路径**：`/api/batch/stop`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| instance_ids | string[] | 是 | 待停止实例 ID 数组，非空，上限 50 |

- **响应数据**：
  - 成功响应（200）：同 9.1 的 `BatchActionResponse`
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `BATCH_LIMIT_EXCEEDED`(400) / `DAEMON_UNREACHABLE`(502/503) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/batch/stop \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"instance_ids":["s-aaa","s-bbb"]}'
  ```

### 9.3 批量重启实例（Batch Restart）

- **功能描述**：批量重启多个 running/starting 状态的实例，内部以 stop + start 序列实现
- **请求方法**：POST
- **URL 路径**：`/api/batch/restart`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：同 9.1 的 `BatchActionRequest`
- **响应数据**：
  - 成功响应（200）：同 9.1 的 `BatchActionResponse`，失败 `message` 可能含 `stop 阶段失败:` 或 `start 阶段失败:` 前缀
  - 错误响应：同 9.2

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/batch/restart \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"instance_ids":["s-aaa","s-bbb"]}'
  ```

### 9.4 批量备份实例（Batch Backup）

- **功能描述**：批量触发多个实例的备份
- **请求方法**：POST
- **URL 路径**：`/api/batch/backup`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：同 9.1 的 `BatchActionRequest`
- **响应数据**：
  - 成功响应（200）：同 9.1 的 `BatchActionResponse`
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `BATCH_LIMIT_EXCEEDED`(400) / `PANEL_SERVICE_UNAVAILABLE`(503，backupService 未初始化) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/batch/backup \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"instance_ids":["s-aaa","s-bbb"]}'
  ```

### 9.5 批量更新实例（Batch Update）

- **功能描述**：批量将多个实例切换到指定版本（来自版本池）
- **请求方法**：POST
- **URL 路径**：`/api/batch/update`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| instance_ids | string[] | 是 | 待更新实例 ID 数组，非空，上限 50 |
| version_id | string | 是 | 目标版本记录 ID（来自版本池） |

```json
{ "instance_ids": ["s-aaa", "s-bbb"], "version_id": "v-xxx" }
```

- **响应数据**：
  - 成功响应（200）：同 9.1 的 `BatchActionResponse`
  - 错误响应：`PANEL_UNAUTHORIZED`(401) / `PANEL_VALIDATION_ERROR`(400) / `BATCH_LIMIT_EXCEEDED`(400) / `PANEL_SERVICE_UNAVAILABLE`(503，updateService 未初始化) / `PANEL_INTERNAL_ERROR`(500)

- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/batch/update \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"instance_ids":["s-aaa","s-bbb"],"version_id":"v-xxx"}'
  ```
