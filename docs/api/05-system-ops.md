---
type: api-doc
title: 系统运维 API 文档（文件/代理/世界生成/配置文件/游戏更新/磁盘清理/演示/维护/SSL/隧道/系统监控/诊断/自更新/改密）
date: 2026-07-25
status: final
related: panel/backend/src/api/routes, modules/模块0_系统自更新, modules/模块1_系统监控, modules/模块2_系统诊断, modules/模块3_用户安全
tags: [api, files, proxy, world-gen, config-files, updates, cleanup, demo, maintenance, ssl, tunnels, system-monitor, system-diagnostic, system-update, password]
---

# 系统运维 API 文档

> 本文档覆盖 GSP 项目 Panel 后端中文件管理、第三方代理、世界生成、配置文件、游戏更新、磁盘清理、演示模式、运维维护、SSL 证书、FRP 隧道、系统监控、系统诊断、系统自更新与用户改密相关的 54 个 API 接口。
> 源码目录：`panel/backend/src/api/routes/`、`modules/模块0_系统自更新/`、`modules/模块1_系统监控/`、`modules/模块2_系统诊断/`、`modules/模块3_用户安全/`

## 一、概述

### 1.1 API 域名

| 用途 | 地址 |
|------|------|
| 公网访问 | `https://gsp.ecsrz.com:3001` |
| 局域网访问 | `https://192.168.5.14:3001` |

所有接口前缀为 `/api`。本统一域名仅用于示例，实际调用以部署环境为准。**严禁使用 `localhost:3000` 或 `127.0.0.1:3000` 作为浏览器端服务器地址**（3000 端口由 nginx 接管做 HTTP→HTTPS 301 跳转）。

### 1.2 认证体系

| 认证方式 | 说明 |
|---------|------|
| JWT Bearer Token | 通过 `Authorization: Bearer <token>` 头携带，由 `POST /api/auth/login` 获取 |
| API Key 旁路 | 通过 `x-api-key` 头携带，等价于 JWT 鉴权 |

### 1.3 角色体系

| 角色 | 说明 |
|------|------|
| `user` | 普通玩家 |
| `instance_admin` | 实例管理员（服主），仅能操作自有实例 |
| `server_admin` | 服务器管理员，可访问任意实例（`requireAdmin` = `requireRole(Role.SERVER_ADMIN)`） |
| `system_admin` / `admin` | 兼容旧 JWT 的最高权限角色 |

### 1.4 鉴权中间件

| 中间件 | 说明 |
|--------|------|
| `authenticateToken(JWT_SECRET)` | 校验 JWT / x-api-key，所有需登录接口必经 |
| `requireAdmin` | 要求 `server_admin` 及以上角色（在 `routes-registry.ts` 挂载时统一套用） |
| `requireInstanceAccess()` | 要求对实例有访问权（owner / instance_admin / 拥有实例访问授权的 user） |
| `requireInstanceAdmin()` | 要求对实例有管理员权限（owner / instance_admin / server_admin） |

### 1.5 通用响应结构

**成功响应**：HTTP 2xx，返回 JSON 业务数据。

**错误响应**：HTTP 4xx/5xx，统一结构：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误描述",
    "details": {}
  }
}
```

### 1.6 通用错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `PANEL_VALIDATION_ERROR` | 400 | 参数校验失败 |
| `PANEL_UNAUTHORIZED` | 401 | 未认证或认证失效 |
| `PANEL_FORBIDDEN` | 403 | 无权限 |
| `PANEL_NOT_FOUND` | 404 | 资源不存在（通用） |
| `PANEL_INTERNAL_ERROR` | 500 | 内部错误 |

### 1.7 路由挂载点（routes-registry.ts 摘录）

| 路由工厂 | 挂载前缀 | 挂载时附加中间件 |
|---------|---------|----------------|
| `createFilesRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createProxyRouter` | `/api/proxy` | `authenticateToken` |
| `createConfigFilesRouter` | `/api/servers` | `authenticateToken`（内部按端点套 `requireInstanceAccess` / `requireInstanceAdmin`） |
| `createWorldGenRouter` | `/api/servers` | `authenticateToken`（内部按端点套 `requireInstanceAccess` / `requireInstanceAdmin`） |
| `createUpdatesRouter` | `/api/servers` | `authenticateToken`（内部套 `requireInstanceAccess`） |
| `createCleanupRouter` | `/api/admin` | `authenticateToken` + `requireAdmin` |
| `createDemoRouter` | `/api/demo` | `authenticateToken`（`/reset` 内部再校验 `server_admin`） |
| `createMaintenanceRouter` | `/api/admin/maintenance` | `authenticateToken` + `requireAdmin` |
| `createSslRouter` | `/api/system/ssl` | `authenticateToken` + `requireAdmin` |
| `createTunnelsRouter` | `/api/system/tunnel` | `authenticateToken` + `requireAdmin` |
| `createSystemUpdateRouter` | `/api/system-update` | `authenticateToken` + `requireAdmin` |
| `createSystemMetricsRouter` | `/api/system` | `authenticateToken`（普通用户可访问） |
| `createSystemDiagnosticRouter` | `/api/system` | `authenticateToken`（内部按端点套 `requireAdmin`） |
| `createPasswordChangeRouter` | `/api/auth` | `authenticateToken`（用户改自己密码，不需 admin） |
| 内联 `systemMonitorService.getHistory` | `/api/system-monitor/history` | `authenticateToken` + `requireAdmin` |

---

## 二、文件管理（11 个接口）

> 路由源码：`panel/backend/src/api/routes/files.ts`
> 挂载点：`/api/servers`（套 `authenticateToken` + `requireAdmin`）
> 对应服务：`app.locals.fileService`（FileServiceImpl）、`app.locals.taskService`（TaskServiceImpl）

### 2.1 列出实例目录文件（List Files）

- **功能描述**：列出实例根目录下指定路径的文件与子目录；支持递归。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/files`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | path | string | 否 | 相对实例根目录的子路径，默认空串（根目录） |
    | recursive | string | 否 | 是否递归；`1` 或 `true` 表示递归 |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | path | string | 当前列出的相对路径 |
    | entries | FileEntry[] | 条目数组 |

    FileEntry 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | path | string | 相对实例根目录的路径 |
    | name | string | 名称（最后一段） |
    | type | 'file' \| 'directory' | 类型 |
    | size | number | 字节数（仅 file） |
    | modified_at | string | 最后修改时间 ISO |
    | extension | string | 文件扩展名（小写，不含点；目录为空字符串） |
    | is_binary | boolean | 是否二进制（按扩展名黑名单判定） |

    ```json
    {
      "path": "mods",
      "entries": [
        {
          "path": "mods/example-mod.jar",
          "name": "example-mod.jar",
          "type": "file",
          "size": 123456,
          "modified_at": "2026-07-20T10:00:00.000Z",
          "extension": "jar",
          "is_binary": true
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | FILE_PATH_INVALID | 400 | 路径非法 |
    | FILE_NOT_FOUND | 404 | 路径不存在 |
    | SERVER_NOT_FOUND | 404 | 实例不存在 |
    | PANEL_VALIDATION_ERROR | 400 | 参数校验失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files?path=mods&recursive=false' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 2.2 读取文件内容（Read File Content）

- **功能描述**：读取实例根目录下指定路径的文本文件内容（仅 UTF-8）。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/files/content`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | path | string | 是 | 相对实例根目录的文件路径 |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | path | string | 文件相对路径 |
    | content | string | 文件内容（UTF-8） |
    | size | number | 字节数 |
    | modified_at | string | 最后修改时间 ISO |
    | encoding | 'utf-8' | 编码 |

    ```json
    {
      "path": "server.properties",
      "content": "# Minecraft server properties\nserver-port=25565",
      "size": 56,
      "modified_at": "2026-07-20T10:00:00.000Z",
      "encoding": "utf-8"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | path 参数缺失 |
    | FILE_NOT_FOUND | 404 | 文件不存在 |
    | FILE_BINARY_NOT_EDITABLE | 400 | 二进制文件不可读 |
    | FILE_PATH_INVALID | 400 | 路径非法 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/content?path=server.properties' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 2.3 写入文件内容（Write File Content）

- **功能描述**：覆盖写入实例根目录下指定路径的文本文件内容。
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/files/content`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | path | string | 是 | 相对实例根目录的文件路径 |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | content | string | 是 | 文件内容（UTF-8） |

    ```json
    {
      "content": "# Minecraft server properties\nserver-port=25565\nmotd=Hello"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | path | string | 文件相对路径 |
    | size | number | 写入字节数 |
    | modified_at | string | 最后修改时间 ISO |

    ```json
    {
      "path": "server.properties",
      "size": 67,
      "modified_at": "2026-07-25T08:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | path 缺失或 content 非字符串 |
    | FILE_PATH_INVALID | 400 | 路径非法 |
    | FILE_NOT_FOUND | 404 | 父目录不存在 |
    | FILE_TOO_LARGE | 413 | 文件过大 |

- **调用示例**：

```bash
curl -X 'PUT' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/content?path=server.properties' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"content":"# Minecraft server properties\nserver-port=25565"}'
```

### 2.4 初始化分片上传（Init Upload）

- **功能描述**：初始化一次分片上传会话，返回 upload_id 与过期时间。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/upload/init`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | upload_id | string | 上传会话 ID（32 位 hex） |
    | expires_at | string | 过期时间 ISO |

    ```json
    {
      "upload_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "expires_at": "2026-07-25T09:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/upload/init' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 2.5 上传分片（Upload Chunk）

- **功能描述**：上传单个分片（base64 编码），按 index 顺序写入。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/upload/chunk`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | upload_id | string | 是 | 32 位 hex 上传会话 ID |
    | index | number | 是 | 分片序号，非负整数 |
    | content | string | 是 | base64 编码的分片内容 |

    ```json
    {
      "upload_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "index": 0,
      "content": "aGVsbG8gd29ybGQ="
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | upload_id | string | 上传会话 ID |
    | index | number | 分片序号 |
    | received | boolean | 是否成功接收 |

    ```json
    {
      "upload_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "index": 0,
      "received": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | upload_id / index / content 校验失败 |
    | FILE_UPLOAD_ID_INVALID | 404 | upload_id 不存在 |
    | FILE_UPLOAD_EXPIRED | 410 | 上传会话已过期 |
    | FILE_UPLOAD_CHUNK_INVALID | 400 | 分片校验失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/upload/chunk' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"upload_id":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4","index":0,"content":"aGVsbG8="}'
```

### 2.6 完成上传（Finish Upload）

- **功能描述**：合并所有分片并写入目标路径。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/upload/finish`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | upload_id | string | 是 | 32 位 hex 上传会话 ID |
    | target_path | string | 是 | 合并后写入的相对路径 |

    ```json
    {
      "upload_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "target_path": "plugins/my-plugin.jar"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | path | string | 写入的相对路径 |
    | size | number | 字节数 |

    ```json
    {
      "path": "plugins/my-plugin.jar",
      "size": 1048576
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 参数缺失 |
    | FILE_UPLOAD_ID_INVALID | 404 | upload_id 不存在 |
    | FILE_UPLOAD_EXPIRED | 410 | 上传会话已过期 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/upload/finish' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"upload_id":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4","target_path":"plugins/my-plugin.jar"}'
```

### 2.7 提交异步下载任务（Submit Download Task）

- **功能描述**：从远程 URL 异步下载文件到实例目录；可选 SHA256 校验。返回异步任务 ID。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/download`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | url | string | 是 | 远程下载 URL，必须 `http://` 或 `https://` 开头 |
    | target_path | string | 是 | 下载到实例根目录下的相对路径 |
    | sha256 | string | 否 | 可选 SHA256 校验值 |

    ```json
    {
      "url": "https://example.com/world.zip",
      "target_path": "worlds/imported.zip",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | task_id | string | 异步任务 ID |
    | status | 'running' | 任务初始状态 |

    ```json
    {
      "task_id": "task-uuid-1234",
      "status": "running"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | url / target_path 校验失败 |
    | TASK_CONCURRENT_LIMIT | 429 | 并发任务上限 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/download' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/world.zip","target_path":"worlds/imported.zip"}'
```

### 2.8 提交异步压缩任务（Submit Compress Task）

- **功能描述**：异步压缩实例目录下的源路径为 zip 或 tar.gz 包。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/compress`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | source_path | string | 是 | 要压缩的相对路径（文件或目录） |
    | target_path | string | 是 | 输出压缩包路径，必须 `.zip` 或 `.tar.gz` 结尾 |
    | format | 'zip' \| 'tar.gz' | 否 | 格式（默认从 target_path 推断） |

    ```json
    {
      "source_path": "worlds",
      "target_path": "backups/worlds-20260725.zip"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | task_id | string | 异步任务 ID |
    | status | 'running' | 任务初始状态 |

    ```json
    {
      "task_id": "task-uuid-5678",
      "status": "running"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | source_path / target_path / format 校验失败 |
    | TASK_CONCURRENT_LIMIT | 429 | 并发任务上限 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/compress' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"source_path":"worlds","target_path":"backups/worlds.zip"}'
```

### 2.9 提交异步解压任务（Submit Decompress Task）

- **功能描述**：异步解压实例目录下的压缩包到目标目录。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/files/decompress`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | source_path | string | 是 | 压缩包相对路径 |
    | target_path | string | 是 | 解压目标目录相对路径 |

    ```json
    {
      "source_path": "backups/worlds.zip",
      "target_path": "worlds-restored"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | task_id | string | 异步任务 ID |
    | status | 'running' | 任务初始状态 |

    ```json
    {
      "task_id": "task-uuid-9012",
      "status": "running"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | source_path / target_path 缺失 |
    | TASK_CONCURRENT_LIMIT | 429 | 并发任务上限 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/files/decompress' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"source_path":"backups/worlds.zip","target_path":"worlds-restored"}'
```

### 2.10 查询任务状态（Get Task Status）

- **功能描述**：查询任意异步任务（下载/压缩/解压）的当前状态。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/tasks/:taskId`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | taskId | string | 是 | 任务 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | task | object | 任务对象 |
    | task.id | string | 任务 ID |
    | task.type | string | 任务类型 |
    | task.status | 'running' \| 'completed' \| 'failed' \| 'canceled' | 状态 |
    | task.progress | { percent: number, message: string \| null } | 进度 |
    | task.result | Record\<string, unknown\> \| null | 完成时的结果数据 |
    | task.error_message | string \| null | 失败原因 |
    | task.created_at | string | 创建时间 ISO |
    | task.updated_at | string | 更新时间 ISO |
    | task.expires_at | string | 过期时间 ISO |

    ```json
    {
      "task": {
        "id": "task-uuid-1234",
        "type": "download",
        "status": "completed",
        "progress": { "percent": 100, "message": null },
        "result": { "path": "worlds/imported.zip", "size": 1048576 },
        "error_message": null,
        "created_at": "2026-07-25T08:00:00.000Z",
        "updated_at": "2026-07-25T08:01:00.000Z",
        "expires_at": "2026-07-25T09:00:00.000Z"
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TASK_NOT_FOUND | 404 | 任务不存在或已过期 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/tasks/task-uuid-1234' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 2.11 取消任务（Cancel Task）

- **功能描述**：请求取消指定任务（运行中或排队中）。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/tasks/:taskId/cancel`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | taskId | string | 是 | 任务 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | task_id | string | 任务 ID |
    | canceled | boolean | 是否成功取消 |

    ```json
    {
      "task_id": "task-uuid-1234",
      "canceled": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TASK_NOT_FOUND | 404 | 任务不存在 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/tasks/task-uuid-1234/cancel' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 三、第三方服务反向代理（2 个接口）

> 路由源码：`panel/backend/src/api/routes/proxy.ts`
> 挂载点：`/api/proxy`（套 `authenticateToken`）
> 设计要点：服务白名单（modrinth/curseforge/mojang/steam），仅允许 HTTPS 上游，防 SSRF；请求体上限 10MB，响应体上限 50MB，超时 30s。

### 3.1 列出可用的代理服务（List Proxy Services）

- **功能描述**：返回当前面板支持的第三方代理服务清单及其 API Key 配置状态。
- **请求方法**：GET
- **URL 路径**：`/api/proxy`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | services | ProxyServiceInfo[] | 代理服务元信息数组 |

    ProxyServiceInfo 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | 'modrinth' \| 'curseforge' \| 'mojang' \| 'steam' | 服务标识 |
    | display_name | string | 展示名称 |
    | base_url | string | 上游 base URL |
    | requires_api_key | boolean | 是否需要 API Key |
    | api_key_header | string \| null | 上游 API Key 头名称（'Authorization' / 'x-api-key' / 'key' / null） |
    | api_key_configured | boolean | 服务端是否已在 system_config 配置 API Key |
    | description | string | 服务描述 |

    ```json
    {
      "services": [
        {
          "name": "modrinth",
          "display_name": "Modrinth",
          "base_url": "https://api.modrinth.com",
          "requires_api_key": false,
          "api_key_header": "Authorization",
          "api_key_configured": false,
          "description": "Modrinth Mod 仓库 API（搜索/查询 Mod/项目/版本，部分端点需要用户 token）"
        },
        {
          "name": "curseforge",
          "display_name": "CurseForge",
          "base_url": "https://api.curseforge.com",
          "requires_api_key": true,
          "api_key_header": "x-api-key",
          "api_key_configured": true,
          "description": "CurseForge Mod 仓库 API（搜索/查询 Mod/项目/文件，需要 API Key）"
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/proxy' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 3.2 透传请求到第三方 API（Proxy Passthrough）

- **功能描述**：将请求透传到指定第三方服务（modrinth/curseforge/mojang/steam）；API Key 优先取请求头 `X-Service-Authorization`，其次取 `system_config.proxy.<service>.api_key`。
- **请求方法**：ALL（支持 GET/POST/PUT/PATCH/DELETE）
- **URL 路径**：`/api/proxy/:service/*`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | service | string | 是 | 服务名（modrinth/curseforge/mojang/steam） |
    | *（通配） | string | 是 | 透传到上游的路径段 |

  - 请求头（可选）：

    | 名称 | 说明 |
    |------|------|
    | X-Service-Authorization | 上游 API Key（优先级高于服务端配置） |

  - 请求体：透传给上游（受 10MB 上限约束）。

- **响应数据**：
  - 成功响应：透传上游响应的状态码、响应头与响应体（受 50MB 上限约束，超限截断）。响应体结构由第三方 API 决定，后端不解析、不约束。
  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PROXY_SERVICE_NOT_ALLOWED | 400 | 不支持的代理服务 |
    | PROXY_TARGET_INVALID | 400/405/413 | 不支持的 HTTP 方法 / URL 解析失败 / 非 HTTPS / host 不一致 / 请求体过大 |
    | PROXY_API_KEY_MISSING | 400 | 需要 API Key 但未提供 |
    | PROXY_TIMEOUT | 504 | 上游响应超时（30s） |
    | PROXY_UPSTREAM_ERROR | 502 | 上游请求失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
# 搜索 Modrinth 上的 mod
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/proxy/modrinth/v2/search?query=fabric-api&limit=5' \
  -H 'Authorization: Bearer <JWT_TOKEN>'

# 查询 CurseForge（需服务端配置或 X-Service-Authorization 头）
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/proxy/curseforge/v1/mods/search?gameId=432&searchFilter=jei' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'X-Service-Authorization: <YOUR_CURSEFORGE_API_KEY>'
```

---

## 四、配置文件管理（4 个接口）

> 路由源码：`panel/backend/src/api/routes/configFiles.ts`
> 挂载点：`/api/servers`（套 `authenticateToken`；路由内部按端点套 `requireInstanceAccess` / `requireInstanceAdmin`）
> 对应服务：`app.locals.configFileService`（ConfigFileServiceImpl）
> 安全要点：`sanitizeFilename` 拒绝 `..`、`/`、`\`、`\0`，并强制 `path.basename()` 二次防护。

### 4.1 列出配置文件元信息（List Config Files）

- **功能描述**：返回当前 Pack 声明的可管理配置文件清单。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/config-files`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | config_files | ConfigFileMeta[] | 配置文件元信息数组 |

    ConfigFileMeta 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 文件名 |
    | path | string | 相对实例根目录的路径 |
    | format | 'json' \| 'yaml' \| 'properties' \| 'ini' | 文件格式 |
    | read_only | boolean | 是否只读 |

    ```json
    {
      "config_files": [
        {
          "name": "server.properties",
          "path": "server.properties",
          "format": "properties",
          "read_only": false
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 config-files 能力 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/config-files' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 4.2 读取配置文件内容（Read Config File）

- **功能描述**：按文件名读取配置文件，自动按格式解析为对象返回。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/config-files/:name`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | name | string | 是 | 配置文件名（不含路径分隔符） |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 文件名 |
    | data | unknown | 解析后的对象（结构依文件内容而定） |

    ```json
    {
      "name": "server.properties",
      "data": {
        "server-port": 25565,
        "motd": "Hello"
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 文件名包含非法字符 |
    | CONFIG_FILE_NOT_FOUND | 404 | 配置文件不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 config-files 能力 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/config-files/server.properties' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 4.3 写入配置文件（Write Config File）

- **功能描述**：按文件名写入配置文件内容（只读文件拒绝写入）。
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/config-files/:name`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | name | string | 是 | 配置文件名（不含路径分隔符） |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | data | unknown | 是 | 待写入的对象（结构依文件格式而定） |

    ```json
    {
      "data": {
        "server-port": 25565,
        "motd": "Hello"
      }
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 文件名 |
    | written | boolean | 是否写入成功 |

    ```json
    {
      "name": "server.properties",
      "written": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 data 字段或文件名非法 |
    | CONFIG_FILE_NOT_FOUND | 404 | 配置文件不存在 |
    | CONFIG_FILE_READ_ONLY | 403 | 文件只读 |

- **调用示例**：

```bash
curl -X 'PUT' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/config-files/server.properties' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"data":{"server-port":25566,"motd":"Updated"}}'
```

### 4.4 获取配置文件 Schema（Get Config File Schema）

- **功能描述**：返回指定配置文件的 JSON Schema，用于前端表单渲染与校验。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/config-files/:name/schema`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | name | string | 是 | 配置文件名 |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 文件名 |
    | schema | Record\<string, unknown\> | JSON Schema 对象 |

    ```json
    {
      "name": "server.properties",
      "schema": {
        "type": "object",
        "properties": {
          "server-port": { "type": "integer", "minimum": 1, "maximum": 65535 }
        }
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 文件名非法 |
    | CONFIG_FILE_NOT_FOUND | 404 | 配置文件不存在 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/config-files/server.properties/schema' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 五、世界生成（3 个接口）

> 路由源码：`panel/backend/src/api/routes/worldGen.ts`
> 挂载点：`/api/servers`（套 `authenticateToken`；路由内部按端点套 `requireInstanceAccess` / `requireInstanceAdmin`）
> 对应服务：`app.locals.worldGenService`（WorldGenServiceImpl）

### 5.1 重新生成地图（Regenerate Map）

- **功能描述**：删除当前地图存档并以指定 save_name 重新生成。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/world/regenerate`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | save_name | string | 是 | 新存档名称 |

    ```json
    {
      "save_name": "world-20260725"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | server_id | string | 实例 ID |
    | regenerated | boolean | 是否已重新生成 |

    ```json
    {
      "server_id": "abc-123",
      "regenerated": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 save_name |
    | WORLD_GEN_FAILED | 500 | 生成失败 |
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_NOT_FOUND | 404 | Pack 不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 world-gen 能力 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/world/regenerate' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"save_name":"world-20260725"}'
```

### 5.2 获取地图设置 Schema 列表（Get Map Settings Schema）

- **功能描述**：返回当前 Pack 声明的所有地图设置文件清单（如 map-gen-settings.json、map-settings.json 等）。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/world/map-settings`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings_files | WorldGenSettingsFileMeta[] | 设置文件清单 |

    WorldGenSettingsFileMeta 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 文件名 |
    | path | string | 相对实例根目录的路径 |
    | format | string | 文件格式 |

    ```json
    {
      "settings_files": [
        {
          "name": "map-gen-settings",
          "path": "map-gen-settings.json",
          "format": "json"
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_NOT_FOUND | 404 | Pack 不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 world-gen 能力 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/world/map-settings' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 5.3 更新地图设置文件（Update Map Settings）

- **功能描述**：按 settingsName 写入对应的地图设置文件。
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/world/map-settings/:settingsName`
- **鉴权要求**：JWT + requireInstanceAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | settingsName | string | 是 | 设置文件名（不含扩展名） |

  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | data | unknown | 是 | 待写入的对象（结构依设置文件而定） |

    ```json
    {
      "data": {
        "terrain_segmentation": "normal",
        "water": "normal"
      }
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings_name | string | 设置文件名 |
    | written | boolean | 是否写入成功 |

    ```json
    {
      "settings_name": "map-gen-settings",
      "written": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 data 字段 |
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_NOT_FOUND | 404 | Pack 不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 world-gen 能力 |
    | WORLD_GEN_FAILED | 500 | 写入失败 |

- **调用示例**：

```bash
curl -X 'PUT' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/world/map-settings/map-gen-settings' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"data":{"terrain_segmentation":"normal"}}'
```

---

## 六、游戏更新（4 个接口）

> 路由源码：`panel/backend/src/api/routes/updates.ts`
> 挂载点：`/api/servers`（套 `authenticateToken`；路由内部套 `requireInstanceAccess`）
> 对应服务：`app.locals.updateService`（UpdateServiceImpl）

### 6.1 检查游戏更新（Check Update）

- **功能描述**：查询当前实例游戏的当前版本与最新版本，返回是否有可用更新。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/update/check`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | pack_id | string | Pack ID（P0 用 serverId 占位） |
    | current_version | string \| null | 当前版本 |
    | latest_version | string \| null | 最新版本 |
    | update_available | boolean | 是否有可用更新 |

    ```json
    {
      "pack_id": "abc-123",
      "current_version": "1.20.1",
      "latest_version": "1.20.2",
      "update_available": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | UPDATE_CHECK_FAILED | 502 | 检查失败 |
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 update 能力 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/update/check' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 6.2 应用游戏更新（Apply Update）

- **功能描述**：从版本池选择 version_id 或手动指定 download_path 应用游戏更新。v3.5.0 起推荐使用 version_id（从版本管理页面下载的版本）。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/update/apply`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

  - 请求体（二选一）：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | version_id | string | 否 | 版本池中的版本 ID（推荐路径） |
    | download_path | string | 否 | 手动填写的下载路径（旧路径，保留兼容） |

    ```json
    { "version_id": "ver-uuid-1234" }
    ```

    或

    ```json
    { "download_path": "/data/versions/minecraft-1.20.2.zip" }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | server_id | string | 实例 ID |
    | applied | boolean | 是否应用成功 |
    | installed_version | string \| null | 实际安装的版本（download_path 路径时为 null） |

    ```json
    {
      "server_id": "abc-123",
      "applied": true,
      "installed_version": "1.20.2"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 必须包含 version_id 或 download_path |
    | UPDATE_APPLY_FAILED | 500 | 应用失败 |
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 update 能力 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/update/apply' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"version_id":"ver-uuid-1234"}'
```

### 6.3 一键下载并安装（已下线，Deprecated）

- **功能描述**：v3.5.0 起已下线，返回 410 Gone，引导用户前往版本管理页面。
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/update/download`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：无
- **响应数据**：
  - 成功响应：无（已下线）。
  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | UPDATE_DOWNLOAD_REMOVED | 410 | 一键下载入口已下线，请前往「版本管理」页面下载版本后选择版本应用 |

    ```json
    {
      "error": {
        "code": "UPDATE_DOWNLOAD_REMOVED",
        "message": "一键下载并安装入口已下线（v3.5.0）。请前往「版本管理」页面下载版本，再在本页面选择版本应用。"
      }
    }
    ```

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/update/download' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 6.4 查询更新进度（Get Update Progress）

- **功能描述**：查询当前实例的更新任务进度。
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/update/progress`
- **鉴权要求**：JWT + requireInstanceAccess
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | server_id | string | 实例 ID |
    | phase | 'idle' \| 'checking' \| 'downloading' \| 'installing' \| 'completed' \| 'failed' | 当前阶段 |
    | progress_percent | number | 进度百分比 0-100 |
    | message | string | 进度消息 |
    | error | string（可选） | 错误信息 |
    | download_path | string（可选） | 下载路径 |
    | latest_version | string（可选） | 最新版本 |
    | started_at | string（可选） | 开始时间 ISO |
    | finished_at | string（可选） | 结束时间 ISO |

    ```json
    {
      "server_id": "abc-123",
      "phase": "completed",
      "progress_percent": 100,
      "message": "更新已完成",
      "latest_version": "1.20.2",
      "started_at": "2026-07-25T08:00:00.000Z",
      "finished_at": "2026-07-25T08:05:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | INSTANCE_NOT_FOUND | 404 | 实例不存在 |
    | PACK_CAPABILITY_NOT_DECLARED | 404 | Pack 未声明 update 能力 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/servers/abc-123/update/progress' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 七、实例清理（3 个接口）

> 路由源码：`panel/backend/src/api/routes/cleanup.ts`
> 挂载点：`/api/admin`（套 `authenticateToken` + `requireAdmin`）
> 业务说明：列出长时间闲置且 stopped 的实例，自动标记 + 服主确认删除；v3.6.0-B1 起删除时同步清磁盘 instance_root 目录与 chat_logs。

### 7.1 列出待清理实例（List Cleanup Instances）

- **功能描述**：返回所有实例的清理状态摘要，对满足自动标记条件（stopped + 闲置>90天 + 有>=2个更新版本）的实例自动打上 `marked_for_deletion` 标记。
- **请求方法**：GET
- **URL 路径**：`/api/admin/cleanup-instances`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | instances | CleanupInstanceSummary[] | 实例清理摘要数组 |

    CleanupInstanceSummary 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | string | 实例 ID |
    | name | string | 实例名 |
    | pack_id | string | Pack ID |
    | game_type | string | 游戏类型 |
    | current_version | string \| null | 当前版本 |
    | owner_username | string | 所有者用户名（无则"未知"） |
    | last_activity_at | string \| null | 上次活动时间 ISO |
    | idle_days | number | 闲置天数 |
    | newer_versions_count | number | 比当前版本新的版本数 |
    | marked_for_deletion | boolean | 是否标记待删除 |
    | status | string | 实例状态 |

    ```json
    {
      "instances": [
        {
          "id": "abc-123",
          "name": "My Old Server",
          "pack_id": "minecraft-vanilla",
          "game_type": "minecraft",
          "current_version": "1.19.0",
          "owner_username": "alice",
          "last_activity_at": "2026-01-01T00:00:00.000Z",
          "idle_days": 205,
          "newer_versions_count": 3,
          "marked_for_deletion": true,
          "status": "stopped"
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/admin/cleanup-instances' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 7.2 确认删除实例（Confirm Delete Instance）

- **功能描述**：确认删除已标记的实例。先调用 safeRemoveService 删除磁盘 instance_root 目录，再删除 chat_logs 与 servers 表记录。仅 stopped 状态可删除。
- **请求方法**：POST
- **URL 路径**：`/api/admin/cleanup-instances/:id/confirm-delete`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | string | 实例 ID |
    | deleted | boolean | 是否删除成功 |
    | freed_bytes | number \| null | 释放的字节数（du 失败时为 null） |

    ```json
    {
      "id": "abc-123",
      "deleted": true,
      "freed_bytes": 1073741824
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SERVER_NOT_FOUND | 404 | 实例不存在 |
    | INVALID_SERVER_STATE | 409 | 仅 stopped 状态可删除 |
    | PANEL_DISK_CLEANUP_FAILED | 500 | 磁盘清理失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/admin/cleanup-instances/abc-123/confirm-delete' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 7.3 忽略清理（Ignore Cleanup）

- **功能描述**：取消实例的 `marked_for_deletion` 标记。
- **请求方法**：POST
- **URL 路径**：`/api/admin/cleanup-instances/:id/ignore`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | id | string | 是 | 实例 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | string | 实例 ID |
    | ignored | boolean | 是否已忽略 |

    ```json
    {
      "id": "abc-123",
      "ignored": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/admin/cleanup-instances/abc-123/ignore' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 八、演示模式管理（2 个接口）

> 路由源码：`panel/backend/src/api/routes/demo.ts`
> 挂载点：`/api/demo`（套 `authenticateToken`；`/reset` 内部再校验 `server_admin`）
> 安全策略：POST `/reset` 双重闸门——`VITE_ENABLE_DEMO === 'true'` 且当前用户为 `server_admin`。流程：停服标记 → 删 demo 实例相关业务表 → 重新 seed 5 个实例。不清审计日志。

### 8.1 查询演示模式状态（Get Demo Status）

- **功能描述**：返回演示模式是否启用、内置账号清单、演示实例数与上次重置时间。任意已登录用户可查询（前端登录页用于决定是否展示"一键登录"按钮）。
- **请求方法**：GET
- **URL 路径**：`/api/demo/status`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | enabled | boolean | 是否启用演示模式（env.VITE_ENABLE_DEMO === 'true'） |
    | builtin_emails | string[] | 内置账号邮箱清单（未启用时为空数组） |
    | demo_instance_count | number | 演示实例数 |
    | demo_instance_ids | string[] | 演示实例 ID 清单（未启用时为空数组） |
    | last_reset_at | string \| null | 上次重置时间 ISO |

    ```json
    {
      "enabled": true,
      "builtin_emails": ["admin@local.dev", "manager@local.dev", "user@local.dev"],
      "demo_instance_count": 5,
      "demo_instance_ids": ["demo-1-uuid", "demo-2-uuid"],
      "last_reset_at": "2026-07-24T08:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/demo/status' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 8.2 重置演示数据（Reset Demo Data）

- **功能描述**：清空并重新 seed 5 个演示实例。需 `VITE_ENABLE_DEMO=true` 且 `server_admin` 角色。流程：标记停止 → 删除 demo 实例相关业务表（chat_logs/votes/shop_*/cdk_codes 等共 18 张表，保留 audit_logs）→ 删除主表 servers → 重 seed → 写入 system_config 的 demo.last_reset_at。
- **请求方法**：POST
- **URL 路径**：`/api/demo/reset`
- **鉴权要求**：JWT + requireServerAdmin（路由内部校验）
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | reset | boolean | 是否重置成功 |
    | deleted_instances | number | 删除的实例数 |
    | recreated_instances | number | 重新创建的实例数 |
    | reset_at | string | 重置完成时间 ISO |

    ```json
    {
      "reset": true,
      "deleted_instances": 5,
      "recreated_instances": 5,
      "reset_at": "2026-07-25T08:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | DEMO_MODE_DISABLED | 403 | 演示模式未启用 |
    | PANEL_FORBIDDEN | 403 | 非 server_admin |
    | INVALID_SERVER_STATE | 409 | 仍有 demo 实例运行中 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/demo/reset' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 九、运维清理维护（3 个接口）

> 路由源码：`panel/backend/src/api/routes/maintenance.ts`
> 挂载点：`/api/admin/maintenance`（套 `authenticateToken` + `requireAdmin`）
> 业务说明：聚合运维清理四张表（audit_logs / user_notifications / item_sync_log / chat_logs），支持概览查询、手动触发清理与修改 retention_days。

### 9.1 获取运维清理概览（Get Maintenance Overview）

- **功能描述**：返回四张表的行数、retention_days、上次清理时间，以及 scheduler 是否已注册每日清理任务。
- **请求方法**：GET
- **URL 路径**：`/api/admin/maintenance/overview`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | tables | MaintenanceTableSummary[] | 表清理摘要数组 |
    | scheduler_enabled | boolean | scheduler 是否已注册每日清理任务 |

    MaintenanceTableSummary 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | table_name | 'audit_logs' \| 'user_notifications' \| 'item_sync_log' \| 'chat_logs' | 表名 |
    | row_count | number | 当前行数 |
    | retention_days | number | retention 天数（chat_logs 取 Pack 配置，此处展示占位 7） |
    | last_cleanup_at | string \| null | 上次清理时间 ISO |

    ```json
    {
      "tables": [
        {
          "table_name": "audit_logs",
          "row_count": 12000,
          "retention_days": 90,
          "last_cleanup_at": "2026-07-24T03:00:00.000Z"
        },
        {
          "table_name": "chat_logs",
          "row_count": 50000,
          "retention_days": 7,
          "last_cleanup_at": null
        }
      ],
      "scheduler_enabled": true
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 获取概览失败 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/admin/maintenance/overview' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 9.2 手动触发清理（Trigger Cleanup）

- **功能描述**：手动触发清理单表或全部四张表，返回每张表删除的行数。
- **请求方法**：POST
- **URL 路径**：`/api/admin/maintenance/cleanup`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | table_name | 'audit_logs' \| 'user_notifications' \| 'item_sync_log' \| 'chat_logs' | 否 | 指定单表清理；未指定则清理全部 |

    ```json
    { "table_name": "audit_logs" }
    ```

    或全部清理：

    ```json
    {}
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | results | CleanupResultEntry[] | 单表结果数组 |

    CleanupResultEntry 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | table_name | string | 表名 |
    | deleted_rows | number | 删除的行数 |

    ```json
    {
      "results": [
        { "table_name": "audit_logs", "deleted_rows": 1234 },
        { "table_name": "user_notifications", "deleted_rows": 567 }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | MAINTENANCE_TABLE_NOT_FOUND | 400 | 未知表名 |
    | PANEL_INTERNAL_ERROR | 500 | 触发清理失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/admin/maintenance/cleanup' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"table_name":"audit_logs"}'
```

### 9.3 修改 retention_days（Update Retention）

- **功能描述**：修改指定表的 retention_days（仅 audit_logs / user_notifications / item_sync_log 可改，chat_logs 来自 Pack 配置）。
- **请求方法**：PUT
- **URL 路径**：`/api/admin/maintenance/retention`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | table_name | 'audit_logs' \| 'user_notifications' \| 'item_sync_log' \| 'chat_logs' | 是 | 表名 |
    | retention_days | number | 是 | retention 天数，1-365 整数 |

    ```json
    {
      "table_name": "audit_logs",
      "retention_days": 180
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | table_name | string | 表名 |
    | retention_days | number | 修改后的 retention 天数 |

    ```json
    {
      "table_name": "audit_logs",
      "retention_days": 180
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | MAINTENANCE_TABLE_NOT_FOUND | 400 | 表不支持修改 retention（如 chat_logs） |
    | MAINTENANCE_INVALID_RETENTION | 400 | retention_days 必须 1-365 整数 |
    | PANEL_INTERNAL_ERROR | 500 | 修改失败 |

- **调用示例**：

```bash
curl -X 'PUT' \
  'https://gsp.ecsrz.com:3001/api/admin/maintenance/retention' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"table_name":"audit_logs","retention_days":180}'
```

---

## 十、SSL 证书管理（5 个接口）

> 路由源码：`panel/backend/src/api/routes/ssl.ts`
> 挂载点：`/api/system/ssl`（套 `authenticateToken` + `requireAdmin`）
> 对应服务：`app.locals.sslService`（SslService）

### 10.1 获取当前证书信息（Get SSL Certificate Info）

- **功能描述**：读取当前 nginx 使用的 SSL 证书信息（CN、SAN、有效期、指纹、是否自签名等）。
- **请求方法**：GET
- **URL 路径**：`/api/system/ssl`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | certificate | CertificateInfo | 证书信息对象 |

    CertificateInfo 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | cert_path | string | 证书文件路径 |
    | key_path | string | 密钥文件路径 |
    | available | boolean | 是否存在且可读 |
    | subject_cn | string \| null | 主题 CN |
    | issuer_cn | string \| null | 签发者 CN |
    | san_domains | string[] | SAN 域名列表 |
    | valid_from | string \| null | 有效期起始 ISO |
    | valid_to | string \| null | 有效期截止 ISO |
    | days_remaining | number \| null | 距过期剩余天数（负数=已过期） |
    | fingerprint | string \| null | 证书指纹 SHA-256 |
    | self_signed | boolean | 是否自签名 |

    ```json
    {
      "certificate": {
        "cert_path": "/etc/nginx/ssl/cert.pem",
        "key_path": "/etc/nginx/ssl/key.pem",
        "available": true,
        "subject_cn": "gsp.ecsrz.com",
        "issuer_cn": "Let's Encrypt",
        "san_domains": ["gsp.ecsrz.com", "www.gsp.ecsrz.com"],
        "valid_from": "2026-06-01T00:00:00.000Z",
        "valid_to": "2026-09-01T00:00:00.000Z",
        "days_remaining": 38,
        "fingerprint": "ab:cd:ef:...",
        "self_signed": false
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SSL_CERT_READ_FAILED | 500 | 读取证书信息失败 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/ssl' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 10.2 触发 nginx 热重载（Reload Nginx）

- **功能描述**：触发 `nginx -s reload` 命令，热重载配置。
- **请求方法**：POST
- **URL 路径**：`/api/system/ssl/reload`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否重载成功 |
    | message | string | 描述信息 |

    ```json
    {
      "success": true,
      "message": "nginx reloaded"
    }
    ```

  - 失败响应（502）：

    ```json
    {
      "success": false,
      "message": "nginx reload failed: ..."
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SSL_NGINX_RELOAD_FAILED | 502 | nginx 热重载失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/ssl/reload' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 10.3 暂存上传证书（Stage Certificate）

- **功能描述**：将前端上传的 PEM 证书与 KEY 私钥暂存到服务器临时目录，等待 deploy 调用部署。基础格式校验：PEM 必须含 `BEGIN CERTIFICATE`，KEY 必须含 `PRIVATE KEY`。
- **请求方法**：POST
- **URL 路径**：`/api/system/ssl/stage`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | pem_content | string | 是 | PEM 格式证书内容（fullchain，含 BEGIN CERTIFICATE） |
    | key_content | string | 是 | KEY 格式私钥内容（含 PRIVATE KEY） |

    ```json
    {
      "pem_content": "-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----",
      "key_content": "-----BEGIN PRIVATE KEY-----\nMIIJ...\n-----END PRIVATE KEY-----"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | cert_path | string | 暂存的证书路径 |
    | key_path | string | 暂存的私钥路径 |
    | message | string | 提示信息 |

    ```json
    {
      "cert_path": "/tmp/ssl-staged-cert.pem",
      "key_path": "/tmp/ssl-staged-key.pem",
      "message": "证书已暂存，可调用 /deploy 部署到 nginx"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | pem_content / key_content 缺失或非字符串 |
    | SSL_CERT_FORMAT_INVALID | 400 | PEM 证书格式无效 |
    | SSL_KEY_FORMAT_INVALID | 400 | 私钥格式无效 |
    | SSL_STAGE_FAILED | 500 | 暂存失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/ssl/stage' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"pem_content":"-----BEGIN CERTIFICATE-----\n...","key_content":"-----BEGIN PRIVATE KEY-----\n..."}'
```

### 10.4 部署暂存证书（Deploy Staged Certificate）

- **功能描述**：将暂存证书部署到 nginx 配置目录并触发热重载。
- **请求方法**：POST
- **URL 路径**：`/api/system/ssl/deploy`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | cert_path | string | 是 | 暂存的证书路径（由 stage 返回） |
    | key_path | string | 是 | 暂存的私钥路径（由 stage 返回） |

    ```json
    {
      "cert_path": "/tmp/ssl-staged-cert.pem",
      "key_path": "/tmp/ssl-staged-key.pem"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否部署成功 |
    | message | string | 描述信息 |

    ```json
    {
      "success": true,
      "message": "证书已部署并 nginx 已重载"
    }
    ```

  - 失败响应（502）：

    ```json
    {
      "success": false,
      "message": "deploy failed: ..."
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | cert_path / key_path 缺失 |
    | SSL_DEPLOY_FAILED | 502 | 部署失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/ssl/deploy' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"cert_path":"/tmp/ssl-staged-cert.pem","key_path":"/tmp/ssl-staged-key.pem"}'
```

### 10.5 生成自签证书（Generate Self-Signed Certificate）

- **功能描述**：调用 openssl 生成自签证书（作为正式证书缺失时的 fallback）。
- **请求方法**：POST
- **URL 路径**：`/api/system/ssl/self-signed`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | common_name | string | 是 | 通用名 CN |
    | san_domains | string[] | 是 | SAN 域名列表（至少一个） |
    | days | number | 否 | 有效期天数 |
    | organization | string | 否 | 组织名 |

    ```json
    {
      "common_name": "gsp.ecsrz.com",
      "san_domains": ["gsp.ecsrz.com", "192.168.5.14"],
      "days": 365,
      "organization": "GSP"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | cert_path | string | 生成的证书路径 |
    | key_path | string | 生成的私钥路径 |
    | message | string | 提示信息 |

    ```json
    {
      "cert_path": "/tmp/ssl-self-signed-cert.pem",
      "key_path": "/tmp/ssl-self-signed-key.pem",
      "message": "自签证书已生成，可调用 /deploy 部署到 nginx"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | common_name / san_domains 缺失或类型错误 |
    | SSL_SELF_SIGNED_FAILED | 500 | 生成失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/ssl/self-signed' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"common_name":"gsp.ecsrz.com","san_domains":["gsp.ecsrz.com"]}'
```

---

## 十一、FRP 隧道管理（6 个接口）

> 路由源码：`panel/backend/src/api/routes/tunnels.ts`
> 挂载点：`/api/system/tunnel`（套 `authenticateToken` + `requireAdmin`）
> 对应服务：`app.locals.tunnelService`（TunnelService）
> 业务说明：管理 frpc 客户端，配置更新后需手动 start/stop 生效。

### 11.1 查询隧道运行状态（Get Tunnel Status）

- **功能描述**：返回 frpc 进程当前运行状态。
- **请求方法**：GET
- **URL 路径**：`/api/system/tunnel/status`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | status | TunnelStatus | 隧道运行状态对象 |

    TunnelStatus 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | running | boolean | frpc 进程是否在运行 |
    | pid | number \| null | 进程 PID（未运行时为 null） |
    | enabled | boolean | 当前配置是否启用 |
    | server_addr | string | frps 服务器地址 |
    | tunnel_count | number | 隧道数量 |
    | started_at | string \| null | 最近一次启动时间 ISO |
    | stopped_at | string \| null | 最近一次停止时间 ISO |

    ```json
    {
      "status": {
        "running": true,
        "pid": 12345,
        "enabled": true,
        "server_addr": "frps.example.com",
        "tunnel_count": 2,
        "started_at": "2026-07-25T08:00:00.000Z",
        "stopped_at": null
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TUNNEL_STATUS_FAILED | 500 | 查询失败 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/status' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 11.2 获取隧道配置（Get Tunnel Config）

- **功能描述**：返回当前 frpc 配置。
- **请求方法**：GET
- **URL 路径**：`/api/system/tunnel/config`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | config | TunnelConfig | 配置对象 |

    TunnelConfig 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | server_addr | string | frps 服务器地址 |
    | server_port | number | frps 服务器端口 |
    | token | string（可选） | frps 认证 token |
    | tunnels | TunnelMapping[] | 隧道映射列表 |
    | enabled | boolean | 是否启用 |

    TunnelMapping 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 隧道名称 |
    | type | 'tcp' \| 'udp' \| 'http' \| 'https' | 隧道类型 |
    | local_ip | string | 本地 IP（默认 127.0.0.1） |
    | local_port | number | 本地端口 |
    | remote_port | number（可选） | 远程端口（tcp/udp 必填） |

    ```json
    {
      "config": {
        "server_addr": "frps.example.com",
        "server_port": 7000,
        "token": "abc123",
        "enabled": true,
        "tunnels": [
          {
            "name": "mc-25565",
            "type": "tcp",
            "local_ip": "127.0.0.1",
            "local_port": 25565,
            "remote_port": 25565
          }
        ]
      }
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TUNNEL_CONFIG_FAILED | 500 | 获取配置失败 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/config' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 11.3 更新隧道配置（Update Tunnel Config）

- **功能描述**：更新 frpc 配置（不自动重启，需手动 start/stop 生效）。
- **请求方法**：PUT
- **URL 路径**：`/api/system/tunnel/config`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | config | TunnelConfig | 是 | 新的配置对象 |
    | config.server_addr | string | 是 | frps 服务器地址 |
    | config.server_port | number | 是 | frps 服务器端口，1-65535 |
    | config.tunnels | TunnelMapping[] | 是 | 隧道映射列表 |
    | config.enabled | boolean | 是 | 是否启用 |
    | config.token | string | 否 | frps 认证 token |

    ```json
    {
      "config": {
        "server_addr": "frps.example.com",
        "server_port": 7000,
        "enabled": true,
        "tunnels": [
          {
            "name": "mc-25565",
            "type": "tcp",
            "local_ip": "127.0.0.1",
            "local_port": 25565,
            "remote_port": 25565
          }
        ]
      }
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | message | string | 提示信息（需手动 restart 生效） |

    ```json
    {
      "message": "配置已更新（需手动 restart 生效）"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | config / server_addr / server_port / tunnels / enabled 校验失败 |
    | TUNNEL_CONFIG_FAILED | 500 | 更新失败 |

- **调用示例**：

```bash
curl -X 'PUT' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/config' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"config":{"server_addr":"frps.example.com","server_port":7000,"enabled":true,"tunnels":[{"name":"mc","type":"tcp","local_ip":"127.0.0.1","local_port":25565,"remote_port":25565}]}}'
```

### 11.4 启动 frpc 隧道（Start Tunnel）

- **功能描述**：启动 frpc 客户端进程。
- **请求方法**：POST
- **URL 路径**：`/api/system/tunnel/start`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）/ 失败响应（502）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否启动成功 |
    | message | string | 描述信息 |

    ```json
    {
      "success": true,
      "message": "frpc started"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TUNNEL_START_FAILED | 502 | 启动失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/start' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 11.5 停止 frpc 隧道（Stop Tunnel）

- **功能描述**：停止 frpc 客户端进程。
- **请求方法**：POST
- **URL 路径**：`/api/system/tunnel/stop`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）/ 失败响应（502）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否停止成功 |
    | message | string | 描述信息 |

    ```json
    {
      "success": true,
      "message": "frpc stopped"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TUNNEL_STOP_FAILED | 502 | 停止失败 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/stop' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 11.6 获取隧道日志（Get Tunnel Logs）

- **功能描述**：返回最近 N 条 frpc 日志（默认 100，最大 1000）。
- **请求方法**：GET
- **URL 路径**：`/api/system/tunnel/logs`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | number | 否 | 返回条数，1-1000，默认 100 |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | logs | TunnelLogEntry[] | 日志条目数组 |

    TunnelLogEntry 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | timestamp | string | ISO 时间戳 |
    | level | 'info' \| 'error' | 日志级别 |
    | message | string | 日志内容 |

    ```json
    {
      "logs": [
        {
          "timestamp": "2026-07-25T08:00:00.000Z",
          "level": "info",
          "message": "frpc started, connecting to frps.example.com:7000"
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | TUNNEL_LOGS_FAILED | 500 | 获取日志失败 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/tunnel/logs?limit=50' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 十二、系统监控历史（1 个接口，内联路由）

> 路由源码：`panel/backend/src/routes-registry.ts`（内联定义）
> 挂载点：`/api/system-monitor/history`（套 `authenticateToken` + `requireAdmin`）
> 对应服务：`app.locals.systemMonitorService`（SystemMonitorService）

### 12.1 查询系统监控历史（Get System Monitor History）

- **功能描述**：返回最近 N 条系统监控快照（CPU/内存/磁盘/负载）。
- **请求方法**：GET
- **URL 路径**：`/api/system-monitor/history`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | number | 否 | 返回条数，1-1800，默认 60 |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | history | object[] | 监控快照数组（结构由 systemMonitorService 决定） |

    ```json
    {
      "history": [
        {
          "timestamp": "2026-07-25T08:00:00.000Z",
          "cpuPercent": 23.5,
          "memUsedMb": 1024,
          "memTotalMb": 4096
        }
      ]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system-monitor/history?limit=120' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 十三、系统监控指标（2 个接口）

> 路由源码：`modules/模块1_系统监控/systemMetricsRoute.ts`
> 挂载点：`/api/system`（套 `authenticateToken`；普通用户可访问）
> 对应服务：`app.locals.systemMetricsService`（SystemMetricsServiceImpl）
> 采集策略：CPU 读取 `/proc/stat`、Memory 读取 `/proc/meminfo`、Disk 用 `statfs`、LoadAvg 读取 `/proc/loadavg`、Uptime 读取 `/proc/uptime`。

### 13.1 获取系统资源指标（Get System Metrics）

- **功能描述**：返回系统资源快照（CPU/内存/磁盘/负载/运行时间）。
- **请求方法**：GET
- **URL 路径**：`/api/system/metrics`
- **鉴权要求**：JWT（普通用户可访问）
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | cpuPercent | number | CPU 使用率（0-100） |
    | memUsedMb | number | 已用内存（MB） |
    | memTotalMb | number | 总内存（MB） |
    | diskUsedGb | number | 已用磁盘（GB） |
    | diskTotalGb | number | 总磁盘（GB） |
    | uptimeSeconds | number | 系统运行时长（秒） |
    | nodeVersion | string | Node.js 版本 |
    | loadAvg | [number, number, number] | 1/5/15 分钟负载 |

    ```json
    {
      "cpuPercent": 23.5,
      "memUsedMb": 1024,
      "memTotalMb": 4096,
      "diskUsedGb": 50,
      "diskTotalGb": 100,
      "uptimeSeconds": 86400,
      "nodeVersion": "v20.10.0",
      "loadAvg": [0.5, 0.4, 0.3]
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SYSTEM_METRICS_001 | 500 | 采集失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/metrics' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 13.2 获取服务健康状态（Get System Health）

- **功能描述**：聚合 backend / database / daemon 三项服务的健康状态。
- **请求方法**：GET
- **URL 路径**：`/api/system/health`
- **鉴权要求**：JWT（普通用户可访问）
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | status | 'healthy' \| 'degraded' \| 'unhealthy' | 聚合状态（所有 up=healthy；任一 degraded=degraded；任一 down=unhealthy） |
    | services | ServiceHealth[] | 各服务健康详情 |
    | timestamp | string | 检查时间 ISO |

    ServiceHealth 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | name | string | 服务名（backend / database / daemon） |
    | status | 'healthy' \| 'degraded' \| 'unhealthy' | 单服务状态 |
    | latencyMs | number | 检查耗时（毫秒） |
    | message | string | 描述信息 |

    ```json
    {
      "status": "healthy",
      "services": [
        {
          "name": "backend",
          "status": "healthy",
          "latencyMs": 1,
          "message": "ok"
        },
        {
          "name": "database",
          "status": "healthy",
          "latencyMs": 5,
          "message": "ok"
        },
        {
          "name": "daemon",
          "status": "healthy",
          "latencyMs": 12,
          "message": "ok"
        }
      ],
      "timestamp": "2026-07-25T08:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SYSTEM_METRICS_001 | 500 | 全部检查失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system/health' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 十四、系统诊断（2 个接口）

> 路由源码：`modules/模块2_系统诊断/systemDiagnosticRoute.ts`
> 挂载点：`/api/system`（套 `authenticateToken`；路由内部按端点套 `requireAdmin`，与 metrics/health 普通用户权限分流）
> 对应服务：`app.locals.systemDiagnosticService`（SystemDiagnosticServiceImpl）
> 安全要点：修复脚本白名单（`config/diagnostic-fixes.json`），用 `child_process.execFile` 避免 shell 注入，timeout 30s，路径校验防遍历。

### 14.1 运行一键诊断（Run Diagnostics）

- **功能描述**：执行所有诊断规则，返回问题清单与汇总摘要。
- **请求方法**：POST
- **URL 路径**：`/api/system/diagnostics`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | problems | DiagnosticProblem[] | 问题清单 |
    | summary | string | 汇总摘要 |
    | timestamp | string | 检查时间 ISO |
    | duration | number | 检查耗时（毫秒） |

    DiagnosticProblem 结构：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | string | 问题 ID |
    | severity | 'critical' \| 'warning' \| 'info' | 严重等级 |
    | message | string | 问题说明 |
    | fixId | string \| null | 可修复脚本的 fixId（null 表示不可自动修复） |

    ```json
    {
      "problems": [
        {
          "id": "disk-full",
          "severity": "critical",
          "message": "磁盘使用率 95%",
          "fixId": "fix-disk-full"
        }
      ],
      "summary": "1 个 critical 问题需立即处理",
      "timestamp": "2026-07-25T08:00:00.000Z",
      "duration": 350
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/diagnostics' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 14.2 应用修复脚本（Apply Fix）

- **功能描述**：按 fixId 执行白名单内的修复脚本，返回执行结果。
- **请求方法**：POST
- **URL 路径**：`/api/system/diagnostics/fix/:fixId`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | fixId | string | 是 | 修复脚本 ID（必须在白名单内） |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | fixId | string | 修复脚本 ID |
    | success | boolean | 是否执行成功 |
    | message | string | 描述信息（timeout 时为 'timeout'） |
    | appliedAt | string | 执行时间 ISO |

    ```json
    {
      "fixId": "fix-disk-full",
      "success": true,
      "message": "cleaned 5GB",
      "appliedAt": "2026-07-25T08:00:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 fixId |
    | SYSTEM_FIX_001 | 404 | fixId 不在白名单内 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system/diagnostics/fix/fix-disk-full' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 十五、系统自更新（5 个接口）

> 路由源码：`modules/模块0_系统自更新/systemUpdateRoute.ts`
> 挂载点：`/api/system-update`（套 `authenticateToken` + `requireAdmin`）
> 对应服务：`app.locals.systemUpdateService`（SystemUpdateServiceImpl）
> 业务说明：面板自身蓝绿部署更新（tar 包下载→SHA256校验→knex迁移→symlink切换→冒烟测试→失败回滚）。状态机：`pending→downloading→verifying→migrating→switching→smoke_testing→succeeded/failed/rolled_back`。

### 15.1 获取当前构建信息（Get Build Info）

- **功能描述**：返回当前运行的版本、commit、构建时间等信息。
- **请求方法**：GET
- **URL 路径**：`/api/system-update/build-info`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | version | string | 版本号 |
    | commit | string | commit hash |
    | buildTime | string | 构建时间 ISO |
    | gitBranch | string | git 分支 |
    | gitCommit | string | git commit hash |

    ```json
    {
      "version": "4.4.0",
      "commit": "abc1234",
      "buildTime": "2026-07-25T08:00:00.000Z",
      "gitBranch": "main",
      "gitCommit": "abc1234"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system-update/build-info' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 15.2 检查系统更新（Check System Update）

- **功能描述**：请求 manifest URL 检查是否有新版本。
- **请求方法**：GET
- **URL 路径**：`/api/system-update/check-update`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | currentVersion | string | 当前版本 |
    | latestVersion | string | 最新版本 |
    | hasUpdate | boolean | 是否有可用更新 |
    | releaseNotes | string | 版本说明 |
    | downloadUrl | string | 下载 URL |
    | sha256 | string | 期望的 SHA256 校验值 |

    ```json
    {
      "currentVersion": "4.4.0",
      "latestVersion": "4.5.0",
      "hasUpdate": true,
      "releaseNotes": "## v4.5.0\n- 新增 X 功能",
      "downloadUrl": "https://example.com/releases/4.5.0.tar.gz",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | SYSTEM_UPDATE_001 | 502 | 检查失败（网络/上游问题） |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system-update/check-update' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 15.3 触发系统更新（Perform Update）

- **功能描述**：异步启动系统更新任务（蓝绿部署），立即返回 jobId，不阻塞。后续可通过 `GET /update-status/:jobId` 轮询状态。
- **请求方法**：POST
- **URL 路径**：`/api/system-update/update`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | jobId | string | 任务 ID |
    | status | 'started' | 任务已启动 |

    ```json
    {
      "jobId": "job-uuid-1234",
      "status": "started"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_UNAUTHORIZED | 401 | 未认证（req.user.userId 缺失） |
    | SYSTEM_UPDATE_002 | 500 | 触发失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system-update/update' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 15.4 查询更新任务状态（Get Update Status）

- **功能描述**：按 jobId 查询系统更新任务状态，用于前端轮询。
- **请求方法**：GET
- **URL 路径**：`/api/system-update/update-status/:jobId`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | jobId | string | 是 | 任务 ID |

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | jobId | string | 任务 ID |
    | status | SystemUpdateJobStatus | 任务状态 |
    | progress | number | 进度 0-100 |
    | step | string | 当前步骤 |
    | errorMessage | string \| null | 错误信息 |
    | startedAt | string | 开始时间 ISO |
    | finishedAt | string \| null | 结束时间 ISO |

    SystemUpdateJobStatus 取值：`pending` / `downloading` / `verifying` / `migrating` / `switching` / `smoke_testing` / `succeeded` / `failed` / `rolled_back`。

    ```json
    {
      "jobId": "job-uuid-1234",
      "status": "succeeded",
      "progress": 100,
      "step": "smoke_testing",
      "errorMessage": null,
      "startedAt": "2026-07-25T08:00:00.000Z",
      "finishedAt": "2026-07-25T08:10:00.000Z"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 jobId |
    | SYSTEM_JOB_NOT_FOUND | 404 | 任务不存在 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'GET' \
  'https://gsp.ecsrz.com:3001/api/system-update/update-status/job-uuid-1234' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

### 15.5 回滚到上一版本（Rollback Update）

- **功能描述**：触发回滚任务，恢复到 previous 版本（蓝绿部署的回滚锚点）。
- **请求方法**：POST
- **URL 路径**：`/api/system-update/update/rollback`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | jobId | string | 回滚任务 ID |
    | status | 'rollback_started' | 任务已启动回滚 |

    ```json
    {
      "jobId": "job-uuid-5678",
      "status": "rollback_started"
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_UNAUTHORIZED | 401 | 未认证 |
    | SYSTEM_UPDATE_003 | 500 | 触发回滚失败 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/system-update/update/rollback' \
  -H 'Authorization: Bearer <JWT_TOKEN>'
```

---

## 十六、修改密码（1 个接口）

> 路由源码：`modules/模块3_用户安全/passwordChangeRoute.ts`
> 挂载点：`/api/auth`（套 `authenticateToken`；用户改自己密码，不需 admin）
> 对应服务：`app.locals.passwordService`（PasswordServiceImpl）
> 三层安全校验（顺序不可颠倒）：
> - Layer 0：bcrypt.compare 旧密码，不匹配抛 `INVALID_CREDENTIAL`（401）
> - Layer 1：zxcvbn 强度校验，score 不足抛 `AUTH_PWD_002`（400）
> - Layer 2：bcrypt 历史对比最近 5 条，任一 match 抛 `AUTH_PWD_003`（409）
> - Layer 3：`token_version +1`，使旧 JWT 在下次请求被 `authenticateToken` 拒绝
> 内置账号（is_built_in=1）抛 `BUILT_IN_ACCOUNT_PASSWORD_READONLY`（403）。

### 16.1 修改当前用户密码（Change Password）

- **功能描述**：用户修改自己的密码，成功后旧 JWT 立即失效。
- **请求方法**：POST
- **URL 路径**：`/api/auth/change-password`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | oldPassword | string | 是 | 旧密码（非空） |
    | newPassword | string | 是 | 新密码（非空） |

    ```json
    {
      "oldPassword": "OldP@ssw0rd",
      "newPassword": "NewP@ssw0rd123"
    }
    ```

- **响应数据**：
  - 成功响应（200）：

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | tokenVersion | number | 新的 token 版本号（旧 JWT 失效） |

    ```json
    {
      "tokenVersion": 2
    }
    ```

  - 错误响应：

    | 错误码 | HTTP | 说明 |
    |--------|------|------|
    | PANEL_VALIDATION_ERROR | 400 | 缺少 oldPassword / newPassword |
    | PANEL_UNAUTHORIZED | 401 | 未认证（req.user.userId 缺失） |
    | INVALID_CREDENTIAL | 401 | 旧密码错误 |
    | AUTH_PWD_002 | 400 | 新密码强度不足（zxcvbn score < 阈值） |
    | AUTH_PWD_003 | 409 | 新密码与历史密码重复 |
    | BUILT_IN_ACCOUNT_PASSWORD_READONLY | 403 | 内置账号不可改密 |
    | PANEL_INTERNAL_ERROR | 500 | 内部错误 |

- **调用示例**：

```bash
curl -X 'POST' \
  'https://gsp.ecsrz.com:3001/api/auth/change-password' \
  -H 'Authorization: Bearer <JWT_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"oldPassword":"OldP@ssw0rd","newPassword":"NewP@ssw0rd123"}'
```

---

## 附录 A：错误码索引

| 错误码 | HTTP | 业务域 | 说明 |
|--------|------|--------|------|
| PANEL_VALIDATION_ERROR | 400 | 通用 | 参数校验失败 |
| PANEL_UNAUTHORIZED | 401 | 通用 | 未认证 |
| PANEL_FORBIDDEN | 403 | 通用 | 无权限 |
| PANEL_NOT_FOUND | 404 | 通用 | 资源不存在 |
| PANEL_INTERNAL_ERROR | 500 | 通用 | 内部错误 |
| FILE_PATH_INVALID | 400 | 文件 | 路径非法 |
| FILE_NOT_FOUND | 404 | 文件 | 文件/路径不存在 |
| FILE_TOO_LARGE | 413 | 文件 | 文件过大 |
| FILE_BINARY_NOT_EDITABLE | 400 | 文件 | 二进制文件不可编辑 |
| FILE_UPLOAD_ID_INVALID | 404 | 文件 | upload_id 不存在 |
| FILE_UPLOAD_EXPIRED | 410 | 文件 | 上传会话已过期 |
| FILE_UPLOAD_CHUNK_INVALID | 400 | 文件 | 分片校验失败 |
| TASK_NOT_FOUND | 404 | 任务 | 任务不存在或已过期 |
| TASK_CONCURRENT_LIMIT | 429 | 任务 | 并发任务上限 |
| SERVER_NOT_FOUND | 404 | 实例 | 实例不存在 |
| INVALID_SERVER_STATE | 409 | 实例 | 实例状态不允许操作 |
| PANEL_DISK_CLEANUP_FAILED | 500 | 实例清理 | 磁盘清理失败 |
| PROXY_SERVICE_NOT_ALLOWED | 400 | 代理 | 不支持的代理服务 |
| PROXY_TARGET_INVALID | 400/405/413 | 代理 | URL/方法/请求体非法 |
| PROXY_API_KEY_MISSING | 400 | 代理 | 需要 API Key 但未提供 |
| PROXY_TIMEOUT | 504 | 代理 | 上游响应超时 |
| PROXY_UPSTREAM_ERROR | 502 | 代理 | 上游请求失败 |
| CONFIG_FILE_NOT_FOUND | 404 | 配置文件 | 配置文件不存在 |
| CONFIG_FILE_READ_ONLY | 403 | 配置文件 | 配置文件只读 |
| PACK_CAPABILITY_NOT_DECLARED | 404 | Pack | Pack 未声明对应能力 |
| PACK_NOT_FOUND | 404 | Pack | Pack 不存在 |
| INSTANCE_NOT_FOUND | 404 | 实例 | 实例不存在 |
| WORLD_GEN_FAILED | 500 | 世界生成 | 地图生成/写入失败 |
| UPDATE_CHECK_FAILED | 502 | 游戏更新 | 检查更新失败 |
| UPDATE_APPLY_FAILED | 500 | 游戏更新 | 应用更新失败 |
| UPDATE_DOWNLOAD_REMOVED | 410 | 游戏更新 | 一键下载入口已下线 |
| DEMO_MODE_DISABLED | 403 | 演示 | 演示模式未启用 |
| MAINTENANCE_TABLE_NOT_FOUND | 400 | 维护 | 未知表名 / 表不支持修改 retention |
| MAINTENANCE_INVALID_RETENTION | 400 | 维护 | retention_days 必须 1-365 整数 |
| SSL_CERT_READ_FAILED | 500 | SSL | 读取证书信息失败 |
| SSL_NGINX_RELOAD_FAILED | 502 | SSL | nginx 热重载失败 |
| SSL_CERT_FORMAT_INVALID | 400 | SSL | PEM 证书格式无效 |
| SSL_KEY_FORMAT_INVALID | 400 | SSL | 私钥格式无效 |
| SSL_STAGE_FAILED | 500 | SSL | 暂存证书失败 |
| SSL_DEPLOY_FAILED | 502 | SSL | 部署证书失败 |
| SSL_SELF_SIGNED_FAILED | 500 | SSL | 生成自签证书失败 |
| TUNNEL_STATUS_FAILED | 500 | 隧道 | 查询状态失败 |
| TUNNEL_CONFIG_FAILED | 500 | 隧道 | 获取/更新配置失败 |
| TUNNEL_START_FAILED | 502 | 隧道 | 启动失败 |
| TUNNEL_STOP_FAILED | 502 | 隧道 | 停止失败 |
| TUNNEL_LOGS_FAILED | 500 | 隧道 | 获取日志失败 |
| SYSTEM_METRICS_001 | 500 | 系统监控 | 采集失败 |
| SYSTEM_FIX_001 | 404 | 系统诊断 | fixId 不在白名单内 |
| SYSTEM_UPDATE_001 | 502 | 系统更新 | 检查更新失败 |
| SYSTEM_UPDATE_002 | 500 | 系统更新 | 触发更新失败 |
| SYSTEM_UPDATE_003 | 500 | 系统更新 | 触发回滚失败 |
| SYSTEM_JOB_NOT_FOUND | 404 | 系统更新 | 任务不存在 |
| INVALID_CREDENTIAL | 401 | 改密 | 旧密码错误 |
| AUTH_PWD_002 | 400 | 改密 | 新密码强度不足 |
| AUTH_PWD_003 | 409 | 改密 | 新密码与历史重复 |
| BUILT_IN_ACCOUNT_PASSWORD_READONLY | 403 | 改密 | 内置账号不可改密 |

## 附录 B：源码索引

| 章节 | 路由源码 | 类型定义 |
|------|---------|---------|
| 二、文件管理 | `panel/backend/src/api/routes/files.ts` | `public/schema/panel-api-types.ts`（F1-F5） |
| 三、第三方代理 | `panel/backend/src/api/routes/proxy.ts` | `public/schema/panel-api-types.ts`（I1） |
| 四、配置文件 | `panel/backend/src/api/routes/configFiles.ts` | `public/schema/panel-api-types.ts`（Task 11.1） |
| 五、世界生成 | `panel/backend/src/api/routes/worldGen.ts` | `public/schema/panel-api-types.ts`（Task 11.2） |
| 六、游戏更新 | `panel/backend/src/api/routes/updates.ts` | `public/schema/panel-api-types.ts`（Task 11.4） |
| 七、实例清理 | `panel/backend/src/api/routes/cleanup.ts` | `public/schema/panel-api-types.ts`（v3.4.0） |
| 八、演示模式 | `panel/backend/src/api/routes/demo.ts` | `panel/backend/src/api/routes/demo.ts`（内联接口） |
| 九、运维维护 | `panel/backend/src/api/routes/maintenance.ts` | `public/schema/panel-api-types.ts`（v3.6.2） |
| 十、SSL 证书 | `panel/backend/src/api/routes/ssl.ts` | `panel/backend/src/services/sslService.ts`（CertificateInfo） |
| 十一、FRP 隧道 | `panel/backend/src/api/routes/tunnels.ts` | `panel/backend/src/services/tunnelService.ts`（TunnelConfig/TunnelStatus/TunnelLogEntry） |
| 十二、系统监控历史 | `panel/backend/src/routes-registry.ts`（内联） | — |
| 十三、系统监控指标 | `modules/模块1_系统监控/systemMetricsRoute.ts` | `public/interface_stub/shared-types.d.ts`（SystemMetrics/SystemHealth/ServiceHealth） |
| 十四、系统诊断 | `modules/模块2_系统诊断/systemDiagnosticRoute.ts` | `public/interface_stub/shared-types.d.ts`（DiagnosticsResult/ApplyFixResponse/DiagnosticProblem） |
| 十五、系统自更新 | `modules/模块0_系统自更新/systemUpdateRoute.ts` | `public/interface_stub/shared-types.d.ts`（BuildInfo/SystemUpdateInfo/PerformUpdateResponse/UpdateStatus） |
| 十六、修改密码 | `modules/模块3_用户安全/passwordChangeRoute.ts` | `modules/模块3_用户安全/passwordService.ts`（返回 { tokenVersion: number }） |
