---
type: api-doc
title: 游戏运营 API 文档（聊天/投票/Mod/存档/备份/监控/名单/周期消息/聊天日志/Webhook/运营/配额/平台统计）
date: 2026-07-25
status: final
related: panel/backend/src/api/routes
tags: [api, chat, vote, mods, saves, backups, monitor, lists, periodic-message, chat-logs, webhooks, operations, quotas, platform-stats]
---

# 游戏运营 API 文档

> 本文档覆盖 GSP 项目 Panel 后端中聊天触发、投票、Mod 管理、存档、备份、监控、白/黑名单、周期消息、聊天日志、Webhook、运营仪表盘、资源配额与全平台统计相关的 58 个 API 接口。
> 源码目录：`panel/backend/src/api/routes/`

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
| `requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN)` | 要求实例管理员或服务器管理员 |
| `requireInstanceAccess()` | 要求对实例有访问权（owner / admin / 拥有实例访问授权） |

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
| `createChatRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createVoteRouter` | `/api/servers` | `authenticateToken`（settings 端点内部 inline admin 兜底） |
| `createModsRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createSavesRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createBackupsRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createMonitorRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createListsRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createPeriodicMessageRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createChatLogsRouter` | `/api/servers` | `authenticateToken`（内部 `requireInstanceAccess()`） |
| `createWebhooksRouter` | `/api/servers` | `authenticateToken` + `requireAdmin` |
| `createOperationsRouter` | `/api/operations` | `authenticateToken` + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` |
| `createQuotasRouter` | `/api/quotas` | `authenticateToken`（角色门控在端点内部 `requireRole`） |
| `createPlatformStatsRouter` | `/api/platform` | `authenticateToken` + `requireAdmin` |

---

## 二、聊天触发响应（Chat）

源码：`chat.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.chatService`（`ChatServiceImpl`）。

### 2.1 查询聊天设置

- **功能描述**：查询指定实例的聊天功能开关与设置
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/chat/settings`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings | ChatSettings | 聊天设置对象（含 enabled 布尔与自定义配置） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/settings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 2.2 更新聊天设置（Upsert）

- **功能描述**：新增或更新实例聊天功能设置
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/chat/settings`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | enabled | boolean | 是 | 聊天功能是否启用 |
    | settings | object | 否 | 自定义设置键值对，缺省为 `{}` |

    ```json
    {
      "enabled": true,
      "settings": { "welcome": "欢迎来到服务器" }
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings | ChatSettings | 更新后的聊天设置 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, 缺少 enabled 布尔字段) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/settings" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true, "settings": {}}'
  ```

### 2.3 列出触发响应

- **功能描述**：列出指定实例的所有聊天触发响应规则
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/chat/triggers`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | triggers | ChatTrigger[] | 触发响应规则数组（含 id / trigger / response / priority / enabled / mode / cooldown_seconds） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/triggers" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 2.4 创建触发响应

- **功能描述**：新增一条聊天触发响应规则
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/chat/triggers`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | trigger | string | 是 | 触发词（非空） |
    | response | string | 是 | 响应内容（非空） |
    | priority | integer | 否 | 优先级，非负整数 |
    | enabled | boolean | 否 | 是否启用 |
    | mode | string | 否 | 匹配模式，取值 `prefix` / `exact` / `contains` |
    | cooldown_seconds | integer | 否 | 冷却秒数，非负整数 |

    ```json
    {
      "trigger": "hello",
      "response": "你好，欢迎！",
      "priority": 10,
      "enabled": true,
      "mode": "prefix",
      "cooldown_seconds": 30
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | trigger | ChatTrigger | 创建后的触发响应对象 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `CHAT_TRIGGER_NOT_FOUND` (404) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/triggers" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"trigger":"hello","response":"你好！","mode":"prefix"}'
  ```

### 2.5 更新触发响应

- **功能描述**：部分更新一条聊天触发响应规则
- **请求方法**：PATCH
- **URL 路径**：`/api/servers/:serverId/chat/triggers/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 触发响应 ID（数字） |
  - 请求体：所有字段可选，仅传需更新的字段

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | trigger | string | 否 | 触发词 |
    | response | string | 否 | 响应内容 |
    | priority | integer | 否 | 优先级，非负整数 |
    | enabled | boolean | 否 | 是否启用 |
    | mode | string | 否 | 匹配模式 `prefix` / `exact` / `contains` |
    | cooldown_seconds | integer | 否 | 冷却秒数，非负整数 |

    ```json
    { "enabled": false, "cooldown_seconds": 60 }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | trigger | ChatTrigger | 更新后的触发响应对象 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `CHAT_TRIGGER_NOT_FOUND` (404) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/triggers/12" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
  ```

### 2.6 删除触发响应

- **功能描述**：删除一条聊天触发响应规则
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/chat/triggers/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 触发响应 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | integer | 被删除的触发响应 ID |
    | deleted | boolean | 是否删除成功（恒为 true） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `CHAT_TRIGGER_NOT_FOUND` (404) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat/triggers/12" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 三、投票（Vote）

源码：`vote.ts`，挂载前缀 `/api/servers`（套 `authenticateToken`）。settings 端点在路由内部追加 inline `isAdminRole` 校验兜底。对应服务：`app.locals.voteService`（`VoteServiceImpl`）。

### 3.1 查询投票设置

- **功能描述**：查询指定实例的投票功能设置
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/vote-settings`
- **鉴权要求**：JWT + 管理员（路由内部 inline `isAdminRole` 校验，要求 `server_admin` / `system_admin` / `admin`）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings | VoteSettings | 投票设置对象 |
  - 错误响应：`PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/vote-settings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.2 更新投票设置（Upsert）

- **功能描述**：新增或更新实例投票功能设置
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/vote-settings`
- **鉴权要求**：JWT + 管理员（路由内部 inline 校验）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：所有字段可选（部分更新）

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | enabled | boolean | 否 | 投票功能是否启用 |
    | threshold | integer | 否 | 通过阈值，正整数 |
    | duration_seconds | integer | 否 | 投票持续时间（秒），正整数 |
    | reason_prefix | string | 否 | 原因前缀 |
    | trigger_keywords | string[] | 否 | 触发关键词数组 |
    | cooldown_seconds | integer | 否 | 投票冷却秒数，非负整数 |
    | target_cooldown_seconds | integer | 否 | 目标冷却秒数，非负整数 |
    | admin_immune | boolean | 否 | 管理员是否免疫 |
    | vip_immune_min_level | integer | 否 | VIP 免疫最低等级，非负整数 |

    ```json
    {
      "enabled": true,
      "threshold": 3,
      "duration_seconds": 120,
      "reason_prefix": "[投票]",
      "trigger_keywords": ["kick", "ban"],
      "cooldown_seconds": 300,
      "target_cooldown_seconds": 600,
      "admin_immune": true,
      "vip_immune_min_level": 2
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings | VoteSettings | 更新后的投票设置 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/vote-settings" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true, "threshold": 3, "duration_seconds": 120}'
  ```

### 3.3 列出投票

- **功能描述**：列出指定实例的所有投票记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/votes`
- **鉴权要求**：JWT（任意登录用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | votes | Vote[] | 投票记录数组 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/votes" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.4 创建投票

- **功能描述**：发起新的投票
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/votes`
- **鉴权要求**：JWT（任意登录用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | initiator | string | 是 | 投票发起者（非空） |
    | target | string | 是 | 投票目标（非空） |
    | reason | string | 是 | 投票原因（非空） |

    ```json
    {
      "initiator": "player_a",
      "target": "player_b",
      "reason": "恶意破坏"
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | vote | Vote | 创建后的投票对象 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `VOTE_NOT_FOUND` (404) / `VOTE_ALREADY_CLOSED` (409) / `VOTE_ALREADY_CAST` (409) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/votes" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"initiator":"player_a","target":"player_b","reason":"恶意破坏"}'
  ```

### 3.5 投票详情

- **功能描述**：查询指定投票的详情及表态记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/votes/:id`
- **鉴权要求**：JWT（任意登录用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 投票 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | vote | Vote | 投票对象 |
    | records | VoteRecord[] | 表态记录数组 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `VOTE_NOT_FOUND` (404) / `VOTE_ALREADY_CLOSED` (409) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/votes/5" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.6 投票表态

- **功能描述**：对指定投票进行表态（赞成 / 反对）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/votes/:id/cast`
- **鉴权要求**：JWT（任意登录用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 投票 ID（数字） |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | voter | string | 是 | 表态玩家名（非空） |
    | vote_choice | string | 是 | 表态选择，取值 `yes` / `no` |

    ```json
    { "voter": "player_c", "vote_choice": "yes" }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | vote | Vote | 更新后的投票对象 |
    | record | VoteRecord | 本次表态记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, voter 缺失 / vote_choice 非法) / `VOTE_NOT_FOUND` (404) / `VOTE_ALREADY_CLOSED` (409) / `VOTE_ALREADY_CAST` (409) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/votes/5/cast" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"voter":"player_c","vote_choice":"yes"}'
  ```

### 3.7 取消投票

- **功能描述**：取消进行中的投票（关闭投票）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/votes/:id/cancel`
- **鉴权要求**：JWT（任意登录用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 投票 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | vote | Vote | 取消后的投票对象 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `VOTE_NOT_FOUND` (404) / `VOTE_ALREADY_CLOSED` (409) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/votes/5/cancel" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 四、Mod 管理（Mods）

源码：`mods.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.modService`（`ModServiceImpl`）。文件名参数均经 `sanitizeFilename` 路径穿越防护。

### 4.1 列出 Mod 记录

- **功能描述**：列出指定实例的 Mod 数据库记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/mods`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | mods | Mod[] | Mod 记录数组 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.2 创建 Mod 记录

- **功能描述**：新增一条 Mod 数据库记录
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/mods`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | mod_name | string | 是 | Mod 名称（非空，经路径穿越防护，禁止含 `..` / `/` / `\` / `\0`） |
    | version | string | 是 | Mod 版本（非空） |
    | enabled | boolean | 否 | 是否启用 |
    | source_url | string | 否 | Mod 来源 URL |

    ```json
    {
      "mod_name": "industrial-craft",
      "version": "2.8.1",
      "enabled": true,
      "source_url": "https://example.com/ic.jar"
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | mod | Mod | 创建后的 Mod 记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `MOD_NOT_FOUND` (404) / `MOD_ALREADY_EXISTS` (409) / `MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"mod_name":"industrial-craft","version":"2.8.1","enabled":true}'
  ```

### 4.3 更新 Mod

- **功能描述**：更新 Mod 记录（仅支持 `enabled` / `source_url` 字段）
- **请求方法**：PATCH
- **URL 路径**：`/api/servers/:serverId/mods/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | Mod 记录 ID（数字） |
  - 请求体：所有字段可选

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | enabled | boolean | 否 | 是否启用 |
    | source_url | string | 否 | Mod 来源 URL |

    ```json
    { "enabled": false }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | mod | Mod | 更新后的 Mod 记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `MOD_NOT_FOUND` (404) / `MOD_ALREADY_EXISTS` (409) / `MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods/3" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
  ```

### 4.4 列出 Mod 文件

- **功能描述**：扫描实例 mods/ 目录下的所有 mod 文件（v4.3.0-H1）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/mods/files`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | mods | ModFile[] | mod 文件数组（含文件名 / 启停状态等） |
  - 错误响应：`MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods/files" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.5 切换 Mod 文件启停

- **功能描述**：切换指定 mod 文件的启用 / 禁用状态（v4.3.0-H1，文件名经路径穿越防护）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/mods/files/:name/toggle`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | name | string | 是 | mod 文件名（必须为纯文件名，禁止含 `..` / `/` / `\` / `\0`） |
- **响应数据**：
  - 成功响应：HTTP 200，返回 `ToggleModFileResponse`（含切换后的状态信息）
  - 错误响应：`MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods/files/industrial-craft.jar/toggle" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.6 扫描 Mod 元数据

- **功能描述**：扫描 mods 目录下所有 jar 文件的元数据（name / version / loader / environment / isClientSide），透传到 Daemon `GET /api/instances/:id/mods/scan`（L4）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/mods/scan`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | mods | ModMetadata[] | jar 元数据数组（含 name / version / loader / environment / isClientSide） |
  - 错误响应：`MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods/scan" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.7 删除 Mod 记录

- **功能描述**：删除一条 Mod 数据库记录
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/mods/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | Mod 记录 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | integer | 被删除的 Mod 记录 ID |
    | deleted | boolean | 是否删除成功（恒为 true） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `MOD_NOT_FOUND` (404) / `MOD_ALREADY_EXISTS` (409) / `MOD_FILE_NOT_FOUND` (404) / `MOD_FILE_STATE_INVALID` (400) / `FILE_PATH_INVALID` (400) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/mods/3" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 五、存档（Saves）

源码：`saves.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.saveService`（`SaveServiceImpl`）。`save_name` 经 `sanitizeFilename` 防护，`file_path` 经 `sanitizeFilePath` 防护（拒绝 `..` 与 `\0`，允许 `/`）。

### 5.1 列出存档记录

- **功能描述**：列出指定实例的存档记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/saves`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | saves | Save[] | 存档记录数组 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/saves" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 5.2 创建存档记录

- **功能描述**：新增一条存档记录
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/saves`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | save_name | string | 是 | 存档名称（非空，经 `sanitizeFilename` 防护，禁止含 `..` / `/` / `\` / `\0`） |
    | file_path | string | 是 | 文件路径（非空，经 `sanitizeFilePath` 防护，禁止含 `..` / `\0`） |
    | size_bytes | integer | 是 | 文件大小（字节），非负整数 |
    | modified_at | string | 是 | 修改时间（非空字符串） |
    | is_active | boolean | 否 | 是否为当前激活存档 |

    ```json
    {
      "save_name": "world_2026_07_25",
      "file_path": "saves/world_2026_07_25.zip",
      "size_bytes": 1048576,
      "modified_at": "2026-07-25T10:00:00Z",
      "is_active": false
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | save | Save | 创建后的存档记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `SAVE_NOT_FOUND` (404) / `SAVE_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/saves" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"save_name":"world_2026_07_25","file_path":"saves/world.zip","size_bytes":1024,"modified_at":"2026-07-25T10:00:00Z"}'
  ```

### 5.3 激活存档

- **功能描述**：将指定存档设为当前激活存档
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/saves/:id/activate`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 存档记录 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | save | Save | 激活后的存档记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `SAVE_NOT_FOUND` (404) / `SAVE_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/saves/8/activate" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 5.4 删除存档记录

- **功能描述**：删除一条存档记录
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/saves/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 存档记录 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | integer | 被删除的存档 ID |
    | deleted | boolean | 是否删除成功（恒为 true） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `SAVE_NOT_FOUND` (404) / `SAVE_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/saves/8" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 六、备份（Backups）

源码：`backups.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.backupService`（`BackupServiceImpl`）。`file_path` 经 `sanitizeFilePath` 防护；`created_by` 取自 `req.user.userId`。

### 6.1 列出备份记录

- **功能描述**：列出指定实例的备份记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/backups`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | backups | Backup[] | 备份记录数组 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/backups" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 6.2 创建备份记录

- **功能描述**：新增一条备份记录（`created_by` 自动取自当前登录用户）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/backups`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | file_path | string | 是 | 备份文件路径（非空，经 `sanitizeFilePath` 防护，禁止含 `..` / `\0`） |
    | size_bytes | integer | 否 | 备份大小（字节），非负整数 |

    ```json
    { "file_path": "backups/2026-07-25.zip", "size_bytes": 5242880 }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | backup | Backup | 创建后的备份记录 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_VALIDATION_ERROR` (400) / `BACKUP_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/backups" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"file_path":"backups/2026-07-25.zip","size_bytes":5242880}'
  ```

### 6.3 更新备份状态

- **功能描述**：更新备份记录的状态与大小
- **请求方法**：PATCH
- **URL 路径**：`/api/servers/:serverId/backups/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 备份记录 ID（数字） |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | status | string | 是 | 备份状态，取值 `in_progress` / `completed` / `failed` / `deleted` |
    | size_bytes | integer | 否 | 备份大小（字节），非负整数 |

    ```json
    { "status": "completed", "size_bytes": 5242880 }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | backup | Backup | 更新后的备份记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `BACKUP_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/backups/15" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"status":"completed","size_bytes":5242880}'
  ```

### 6.4 删除备份记录

- **功能描述**：删除一条备份记录
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/backups/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 备份记录 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | integer | 被删除的备份 ID |
    | deleted | boolean | 是否删除成功（恒为 true） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `BACKUP_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/backups/15" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 七、监控快照（Monitor）

源码：`monitor.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.monitorService`（`MonitorServiceImpl`）。

### 7.1 列出监控快照

- **功能描述**：按时间范围查询实例的监控快照列表
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/monitor/snapshots`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | from | string | 否 | 起始时间（ISO 字符串） |
    | to | string | 否 | 结束时间（ISO 字符串） |
    | limit | number | 否 | 返回条数上限 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | snapshots | MonitorSnapshot[] | 监控快照数组 |
  - 错误响应：`MONITOR_SNAPSHOT_CREATE_FAILED` (500) / `SNAPSHOT_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/monitor/snapshots?limit=50" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.2 创建监控快照

- **功能描述**：上报一条监控快照数据
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/monitor/snapshots`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：所有字段可选

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | cpu_percent | number | 否 | CPU 占用百分比 |
    | memory_mb | number | 否 | 内存占用（MB） |
    | tick_rate | number | 否 | 服务器 TPS |
    | player_count | integer | 否 | 在线玩家数 |
    | json_extra | object | 否 | 扩展字段 |

    ```json
    {
      "cpu_percent": 45.2,
      "memory_mb": 2048,
      "tick_rate": 19.8,
      "player_count": 12
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | snapshot | MonitorSnapshot | 创建后的监控快照 |
  - 错误响应：`MONITOR_SNAPSHOT_CREATE_FAILED` (500) / `SNAPSHOT_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/monitor/snapshots" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"cpu_percent":45.2,"memory_mb":2048,"tick_rate":19.8,"player_count":12}'
  ```

### 7.3 获取最新快照

- **功能描述**：获取指定实例的最新一条监控快照
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/monitor/latest`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | snapshot | MonitorSnapshot | 最新监控快照 |
  - 错误响应：`SNAPSHOT_NOT_FOUND` (404) / `MONITOR_SNAPSHOT_CREATE_FAILED` (500) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/monitor/latest" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.4 查询历史监控快照（兼容端点）

- **功能描述**：从 `monitor_snapshots` 表读取历史快照（按 timestamp 倒序，默认 50 条），复用 `MonitorServiceImpl.list`，与 `/monitor/snapshots` 同源
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/monitoring`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | number | 否 | 返回条数上限（默认 50） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | snapshots | MonitorSnapshot[] | 监控快照数组 |
  - 错误响应：`MONITOR_SNAPSHOT_CREATE_FAILED` (500) / `SNAPSHOT_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/monitoring?limit=100" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 八、白名单 / 黑名单（Lists）

源码：`lists.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.listService`（`ListServiceImpl`）。`listType` 仅允许 `whitelist` / `banlist`；`added_by` 取自 `req.user.userId`。

### 8.1 列出名单条目

- **功能描述**：列出指定实例的白名单或黑名单条目
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/lists/:listType`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | listType | string | 是 | 名单类型，取值 `whitelist` / `banlist` |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | entries | ListEntry[] | 名单条目数组 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, listType 非法) / `LIST_ENTRY_NOT_FOUND` (404) / `LIST_ENTRY_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/lists/whitelist" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 8.2 添加名单条目

- **功能描述**：向白名单或黑名单新增一条玩家条目（`added_by` 自动取自当前登录用户）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/lists/:listType`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | listType | string | 是 | 名单类型，取值 `whitelist` / `banlist` |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | player_name | string | 是 | 玩家名（非空） |
    | reason | string | 否 | 添加原因 |

    ```json
    { "player_name": "steve", "reason": "管理员手动添加" }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | entry | ListEntry | 创建后的名单条目 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_VALIDATION_ERROR` (400) / `LIST_ENTRY_NOT_FOUND` (404) / `LIST_ENTRY_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/lists/banlist" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"griefer","reason":"恶意破坏"}'
  ```

### 8.3 删除名单条目

- **功能描述**：从白名单或黑名单中移除指定玩家（玩家名经 `decodeURIComponent` 解码）
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/lists/:listType/:playerName`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | listType | string | 是 | 名单类型，取值 `whitelist` / `banlist` |
    | playerName | string | 是 | 玩家名（URL 编码，需 `decodeURIComponent` 解码） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | player_name | string | 被删除的玩家名（已解码） |
    | deleted | boolean | 是否删除成功 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `LIST_ENTRY_NOT_FOUND` (404) / `LIST_ENTRY_ALREADY_EXISTS` (409) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/lists/banlist/griefer" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 九、周期消息（Periodic Message）

源码：`periodicMessage.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.periodicMessageService`（`PeriodicMessageServiceImpl`）。

### 9.1 列出周期消息

- **功能描述**：列出指定实例的所有周期（定时）消息
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/periodic-messages`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | messages | PeriodicMessage[] | 周期消息数组 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/periodic-messages" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 9.2 创建周期消息

- **功能描述**：新增一条周期消息（按固定间隔自动发送）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/periodic-messages`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | message | string | 是 | 消息内容（非空） |
    | interval_minutes | integer | 是 | 发送间隔（分钟），正整数 |
    | enabled | boolean | 否 | 是否启用 |

    ```json
    { "message": "欢迎加入服务器！", "interval_minutes": 30, "enabled": true }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | message | PeriodicMessage | 创建后的周期消息 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PERIODIC_MESSAGE_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/periodic-messages" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"message":"欢迎加入服务器！","interval_minutes":30,"enabled":true}'
  ```

### 9.3 更新周期消息

- **功能描述**：部分更新一条周期消息
- **请求方法**：PATCH
- **URL 路径**：`/api/servers/:serverId/periodic-messages/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 周期消息 ID（数字） |
  - 请求体：所有字段可选

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | message | string | 否 | 消息内容 |
    | interval_minutes | integer | 否 | 发送间隔（分钟），正整数 |
    | enabled | boolean | 否 | 是否启用 |

    ```json
    { "enabled": false }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | message | PeriodicMessage | 更新后的周期消息 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PERIODIC_MESSAGE_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/periodic-messages/7" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
  ```

### 9.4 删除周期消息

- **功能描述**：删除一条周期消息
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/periodic-messages/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | 周期消息 ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | id | integer | 被删除的周期消息 ID |
    | deleted | boolean | 是否删除成功（恒为 true） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PERIODIC_MESSAGE_NOT_FOUND` (404) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/periodic-messages/7" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十、聊天日志（Chat Logs）

源码：`chatLogs.ts`（Factorio 集成扩展 Task 11.3），挂载前缀 `/api/servers`（仅套 `authenticateToken`，端点内部追加 `requireInstanceAccess()`）。对应服务：`app.locals.chatLogService`（`ChatLogServiceImpl`）。

### 10.1 查询聊天日志

- **功能描述**：按玩家名 / 关键词 / 时间范围查询实例聊天日志（支持分页）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/chat-logs`
- **鉴权要求**：JWT + `requireInstanceAccess()`（要求对实例有访问权）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | player_name | string | 否 | 按玩家名过滤（非空才生效） |
    | message_contains | string | 否 | 按消息内容模糊匹配（非空才生效） |
    | start_time | string | 否 | 起始时间（ISO 字符串） |
    | end_time | string | 否 | 结束时间（ISO 字符串） |
    | limit | number | 否 | 返回条数上限（须 > 0） |
    | offset | number | 否 | 偏移量（须 >= 0，用于分页） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | logs | ChatLog[] | 聊天日志数组（含 id / server_id / player_name / message / sent_at） |
    | total | integer | 总条数（用于分页计算） |
  - 错误响应：`PACK_CAPABILITY_NOT_DECLARED` (404, Pack 未声明聊天日志能力) / `INSTANCE_NOT_FOUND` (404) / `CHAT_LOG_PARSE_FAILED` (500) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/chat-logs?player_name=steve&limit=50&offset=0" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十一、Webhook

源码：`webhooks.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）。对应服务：`app.locals.webhookService`（`WebhookServiceImpl`）。

### 11.1 列出 Webhook

- **功能描述**：列出指定实例的所有 Webhook 配置
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/webhooks`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | webhooks | Webhook[] | Webhook 配置数组 |
  - 错误响应：`WEBHOOK_NOT_FOUND` (404) / `WEBHOOK_DELIVERY_FAILED` (502) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/webhooks" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.2 创建 Webhook

- **功能描述**：新增一个 Webhook 配置
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/webhooks`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | url | string | 是 | Webhook 接收地址（非空） |
    | event_types | string[] | 否 | 订阅的事件类型列表 |
    | secret | string | 否 | 签名密钥 |
    | enabled | boolean | 否 | 是否启用 |

    ```json
    {
      "url": "https://example.com/webhook",
      "event_types": ["player.join", "player.leave"],
      "secret": "my_secret",
      "enabled": true
    }
    ```
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | webhook | Webhook | 创建后的 Webhook 配置 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, 缺少 url) / `WEBHOOK_NOT_FOUND` (404) / `WEBHOOK_DELIVERY_FAILED` (502) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/webhooks" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com/webhook","event_types":["player.join"],"enabled":true}'
  ```

### 11.3 更新 Webhook

- **功能描述**：部分更新 Webhook 配置
- **请求方法**：PATCH
- **URL 路径**：`/api/servers/:serverId/webhooks/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | Webhook ID（数字） |
  - 请求体：所有字段可选

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | url | string | 否 | Webhook 接收地址 |
    | event_types | string[] | 否 | 订阅的事件类型列表 |
    | secret | string | 否 | 签名密钥 |
    | enabled | boolean | 否 | 是否启用 |

    ```json
    { "enabled": false }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | webhook | Webhook | 更新后的 Webhook 配置 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `WEBHOOK_NOT_FOUND` (404) / `WEBHOOK_DELIVERY_FAILED` (502) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/webhooks/4" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}'
  ```

### 11.4 删除 Webhook

- **功能描述**：删除一个 Webhook 配置
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/webhooks/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | Webhook ID（数字） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | deleted | boolean | 是否删除成功 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `WEBHOOK_NOT_FOUND` (404) / `WEBHOOK_DELIVERY_FAILED` (502) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/webhooks/4" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.5 触发 Webhook 测试投递

- **功能描述**：触发 Webhook 即时测试投递（不持久化投递记录）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/webhooks/:id/test`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | integer | 是 | Webhook ID（数字） |
  - 请求体：

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | event_type | string | 是 | 模拟事件类型（非空） |
    | payload | object | 否 | 模拟事件 payload |

    ```json
    { "event_type": "player.join", "payload": { "player": "steve" } }
    ```
- **响应数据**：
  - 成功响应：HTTP 200，返回 `TriggerWebhookTestResponse`（含投递结果信息）
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, 缺少 event_type) / `WEBHOOK_NOT_FOUND` (404) / `WEBHOOK_DELIVERY_FAILED` (502) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/webhooks/4/test" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"event_type":"player.join","payload":{"player":"steve"}}'
  ```

---

## 十二、运营仪表盘（Operations）

源码：`operations.ts`（v4.6.0），挂载前缀 `/api/operations`（套 `authenticateToken` + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`）。对应服务：`OperationsService`（路由内部实例化）。所有端点按 `req.user.userId` 过滤数据（仅返回当前用户有权访问的实例数据）。

### 12.1 跨实例总览

- **功能描述**：返回当前用户可访问实例的运营总览数据
- **请求方法**：GET
- **URL 路径**：`/api/operations/instance-admin/overview`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`
- **请求参数**：无路径 / 查询 / 请求体参数
- **响应数据**：
  - 成功响应：HTTP 200，返回 `InstanceAdminOverviewResponse`（含跨实例总览数据）
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/operations/instance-admin/overview" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 12.2 收入曲线

- **功能描述**：返回当前用户可访问实例的收入曲线（按天聚合）
- **请求方法**：GET
- **URL 路径**：`/api/operations/instance-admin/revenue`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | days | integer | 否 | 天数，默认 30，范围 1-90 |
- **响应数据**：
  - 成功响应：HTTP 200，返回 `OperationsRevenueResponse`（含按天的收入数据点）
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/operations/instance-admin/revenue?days=30" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 12.3 玩家活跃度曲线

- **功能描述**：返回当前用户可访问实例的玩家活跃度曲线（按天聚合）
- **请求方法**：GET
- **URL 路径**：`/api/operations/instance-admin/players`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | days | integer | 否 | 天数，默认 30，范围 1-90 |
- **响应数据**：
  - 成功响应：HTTP 200，返回 `OperationsPlayersResponse`（含按天的玩家活跃度数据点）
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/operations/instance-admin/players?days=30" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 12.4 实例对比表

- **功能描述**：返回当前用户可访问实例的对比表数据
- **请求方法**：GET
- **URL 路径**：`/api/operations/instance-admin/instances-compare`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`
- **请求参数**：无路径 / 查询 / 请求体参数
- **响应数据**：
  - 成功响应：HTTP 200，返回 `OperationsInstancesCompareResponse`（含实例对比表数据）
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/operations/instance-admin/instances-compare" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十三、资源配额（Quotas）

源码：`quotas.ts`（v4.6.0），挂载前缀 `/api/quotas`（仅套 `authenticateToken`，角色门控在端点内部 `requireRole` 挂载）。对应服务：`QuotaService`（路由内部实例化）。

### 13.1 查询当前用户配额

- **功能描述**：查询当前登录用户的资源配额与用量，并计算是否可创建新实例
- **请求方法**：GET
- **URL 路径**：`/api/quotas`
- **鉴权要求**：JWT（任意已认证用户）
- **请求参数**：无路径 / 查询 / 请求体参数
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | quota | Quota \| null | 当前用户生效配额（含 max_instances / max_disk_mb / max_players_total） |
    | usage | QuotaUsage | 当前用量（含 disk_used_mb 等） |
    | can_create_instance | boolean | 是否可创建新实例 |
    | disk_available_mb | number \| null | 剩余可用磁盘（MB），若 max_disk_mb 为 null 则为 null |
  - 错误响应：`PANEL_UNAUTHORIZED` (401) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/quotas" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.2 查询角色配额

- **功能描述**：查询指定角色的资源配额
- **请求方法**：GET
- **URL 路径**：`/api/quotas/role/:role`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN)`（端点内部挂载）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | role | string | 是 | 角色名，取值 `server_admin` / `instance_admin` / `user`（兼容旧值经 `normalizeRole` 归一化） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | quota | Quota \| null | 角色配额 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400, 无效角色) / `PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/quotas/role/user" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.3 设置角色配额

- **功能描述**：设置指定角色的资源配额
- **请求方法**：PUT
- **URL 路径**：`/api/quotas/role/:role`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN)`（端点内部挂载）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | role | string | 是 | 角色名，取值 `server_admin` / `instance_admin` / `user` |
  - 请求体：所有字段可选，传 `null` 表示清除限制

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | max_instances | integer \| null | 否 | 最大实例数，非负整数或 null |
    | max_disk_mb | integer \| null | 否 | 最大磁盘（MB），非负整数或 null |
    | max_players_total | integer \| null | 否 | 最大玩家总数，非负整数或 null |

    ```json
    { "max_instances": 5, "max_disk_mb": 10240, "max_players_total": 100 }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | quota | Quota | 更新后的角色配额 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PANEL_FORBIDDEN` (403) / `QUOTA_UPDATE_FAILED` (500) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/quotas/role/user" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"max_instances": 5, "max_disk_mb": 10240}'
  ```

### 13.4 查询用户配额

- **功能描述**：查询指定用户的资源配额
- **请求方法**：GET
- **URL 路径**：`/api/quotas/user/:userId`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN)`（端点内部挂载）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 用户 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | quota | Quota \| null | 用户配额 |
  - 错误响应：`PANEL_FORBIDDEN` (403) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/quotas/user/usr-xxx" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.5 设置用户配额

- **功能描述**：设置指定用户的资源配额
- **请求方法**：PUT
- **URL 路径**：`/api/quotas/user/:userId`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN)`（端点内部挂载）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 用户 ID |
  - 请求体：所有字段可选，传 `null` 表示清除限制

    | 字段名 | 类型 | 必填 | 说明 |
    |--------|------|------|------|
    | max_instances | integer \| null | 否 | 最大实例数，非负整数或 null |
    | max_disk_mb | integer \| null | 否 | 最大磁盘（MB），非负整数或 null |
    | max_players_total | integer \| null | 否 | 最大玩家总数，非负整数或 null |

    ```json
    { "max_instances": 10, "max_disk_mb": null }
    ```
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | quota | Quota | 更新后的用户配额 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400) / `PANEL_FORBIDDEN` (403) / `QUOTA_UPDATE_FAILED` (500) / `PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/quotas/user/usr-xxx" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"max_instances": 10}'
  ```

---

## 十四、全平台统计（Platform Stats）

源码：`platform-stats.ts`（v4.7.0 G1），挂载前缀 `/api/platform`（套 `authenticateToken` + `requireAdmin`）。对应服务：`PlatformStatsService`（路由内部实例化，无用户过滤，全平台聚合）。所有聚合查询用 try-catch 保护，表不存在时返回安全默认值（0 / 空数组）。

### 14.1 全平台总览

- **功能描述**：返回全平台总览数据（用户 / 实例 / 节点 / 磁盘 / 收入 / 告警 / 状态分布）
- **请求方法**：GET
- **URL 路径**：`/api/platform/overview`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：无路径 / 查询 / 请求体参数
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | total_users | integer | 总用户数（不含 deleted） |
    | active_users_24h | integer | 24 小时活跃用户 |
    | active_users_30d | integer | 30 天活跃用户 |
    | total_instances | integer | 总实例数 |
    | running_instances | integer | 运行中实例数 |
    | total_nodes | integer | 总节点数 |
    | healthy_nodes | integer | 在线节点数 |
    | total_disk_used_mb | integer | 平台磁盘总用量（MB） |
    | total_disk_capacity_mb | integer | 平台磁盘总容量（MB，DB 无缓存恒为 0） |
    | revenue_today | number | 当日收入（shop_orders, status=claimed） |
    | revenue_30d | number | 30 天收入 |
    | alerts_24h | integer | 24 小时告警数 |
    | top_disk_usage | PlatformDiskUsageItem[] | 磁盘占用 Top10 实例 |
    | instance_status_distribution | object | 实例状态分布（running / stopped / error） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/platform/overview" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 14.2 用户活跃度曲线

- **功能描述**：返回按天聚合的用户活跃度曲线（基于 `users.last_login_at`）
- **请求方法**：GET
- **URL 路径**：`/api/platform/users`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | range | string | 否 | 时间范围，取值 `24h`（默认） / `30d`，其他值视为 `24h` |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | range | string | 实际查询范围（`24h` / `30d`） |
    | points | PlatformUsersTrendPoint[] | 数据点数组（含 date / active_users） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/platform/users?range=30d" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 14.3 收入曲线

- **功能描述**：返回按天聚合的收入曲线（基于 `shop_orders`, status='claimed'）
- **请求方法**：GET
- **URL 路径**：`/api/platform/revenue`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | days | integer | 否 | 天数，默认 30，范围 1-90 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | days | integer | 实际查询天数（1-90） |
    | points | PlatformRevenueTrendPoint[] | 数据点数组（含 date / revenue / orders） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/platform/revenue?days=30" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 14.4 磁盘占用 TopN 实例

- **功能描述**：返回磁盘占用最高的 N 个实例
- **请求方法**：GET
- **URL 路径**：`/api/platform/disk-usage-top`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | integer | 否 | 返回条数，默认 10，范围 1-100 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | items | PlatformDiskUsageItem[] | 实例数组（含 instance_id / name / used_mb / owner） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/platform/disk-usage-top?limit=10" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 附录 A：业务域错误码汇总

| 错误码 | HTTP | 业务域 | 说明 |
|--------|------|--------|------|
| `CHAT_TRIGGER_NOT_FOUND` | 404 | 聊天触发 | 触发响应不存在 |
| `VOTE_NOT_FOUND` | 404 | 投票 | 投票不存在 |
| `VOTE_ALREADY_CLOSED` | 409 | 投票 | 投票已关闭 |
| `VOTE_ALREADY_CAST` | 409 | 投票 | 已对该投票表态 |
| `MOD_NOT_FOUND` | 404 | Mod | Mod 记录不存在 |
| `MOD_ALREADY_EXISTS` | 409 | Mod | Mod 记录已存在 |
| `MOD_FILE_NOT_FOUND` | 404 | Mod | mod 文件不存在 |
| `MOD_FILE_STATE_INVALID` | 400 | Mod | mod 文件状态非法 |
| `FILE_PATH_INVALID` | 400 | Mod/存档 | 文件路径非法（路径穿越防护） |
| `SAVE_NOT_FOUND` | 404 | 存档 | 存档记录不存在 |
| `SAVE_ALREADY_EXISTS` | 409 | 存档 | 存档记录已存在 |
| `BACKUP_NOT_FOUND` | 404 | 备份 | 备份记录不存在 |
| `MONITOR_SNAPSHOT_CREATE_FAILED` | 500 | 监控 | 监控快照创建失败 |
| `SNAPSHOT_NOT_FOUND` | 404 | 监控 | 快照不存在 |
| `LIST_ENTRY_NOT_FOUND` | 404 | 名单 | 名单条目不存在 |
| `LIST_ENTRY_ALREADY_EXISTS` | 409 | 名单 | 名单条目已存在 |
| `PERIODIC_MESSAGE_NOT_FOUND` | 404 | 周期消息 | 周期消息不存在 |
| `PACK_CAPABILITY_NOT_DECLARED` | 404 | 聊天日志 | Pack 未声明聊天日志能力 |
| `INSTANCE_NOT_FOUND` | 404 | 聊天日志 | 实例不存在 |
| `CHAT_LOG_PARSE_FAILED` | 500 | 聊天日志 | 聊天日志解析失败 |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook | Webhook 不存在 |
| `WEBHOOK_DELIVERY_FAILED` | 502 | Webhook | Webhook 投递失败 |
| `QUOTA_UPDATE_FAILED` | 500 | 配额 | 配额更新失败 |

## 附录 B：接口数量统计

| 业务域 | 路由文件 | 接口数 |
|--------|---------|--------|
| 聊天触发响应 | chat.ts | 6 |
| 投票 | vote.ts | 7 |
| Mod 管理 | mods.ts | 7 |
| 存档 | saves.ts | 4 |
| 备份 | backups.ts | 4 |
| 监控快照 | monitor.ts | 4 |
| 白 / 黑名单 | lists.ts | 3 |
| 周期消息 | periodicMessage.ts | 4 |
| 聊天日志 | chatLogs.ts | 1 |
| Webhook | webhooks.ts | 5 |
| 运营仪表盘 | operations.ts | 4 |
| 资源配额 | quotas.ts | 5 |
| 全平台统计 | platform-stats.ts | 4 |
| **合计** | **13 个文件** | **58 个接口** |
