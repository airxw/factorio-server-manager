---
type: api-doc
title: 认证与用户域 API
date: 2026-07-25
status: active
related:
  - panel/backend/src/routes-registry.ts
  - panel/backend/src/api/routes/users.ts
  - panel/backend/src/api/routes/me.ts
  - panel/backend/src/api/routes/my.ts
  - panel/backend/src/api/routes/notifications.ts
  - panel/backend/src/api/routes/auditLogs.ts
  - panel/backend/src/api/routes/settings.ts
  - panel/backend/src/api/routes/systemConfig.ts
  - panel/backend/src/api/routes/passwordReset.ts
  - panel/backend/src/api/routes/emailVerify.ts
  - panel/backend/src/api/routes/apiKeys.ts
  - panel/backend/src/api/routes/alertSettings.ts
  - public/schema/panel-api-types.ts
tags: [auth, user, notification, audit, settings, system-config, password-reset, email-verify, api-keys, alert]
---

# 认证与用户域 API

## 概述

本组接口覆盖 gsp 项目 Panel 后端的**认证、用户管理、个人信息、通知、审计日志、设置面板、系统配置、密码重置、邮箱验证、API Key 管理、告警设置**共 11 个业务子域，合计 46 个 REST 接口。

### 鉴权背景

| 项目 | 说明 |
|------|------|
| 全局中间件 | cors、json、helmet、请求日志、全局速率限制（每 IP 每秒 50 次）、维护模式、审计中间件 |
| 鉴权中间件 | `authenticateToken(JWT_SECRET)` —— 支持 **JWT Bearer Token** 与 **x-api-key 旁路认证** |
| 角色体系 | 3 级：`server_admin` > `instance_admin` > `user` |
| 管理员门控 | `requireAdmin = requireRole(Role.SERVER_ADMIN)` |
| 鉴权头 | JWT：`Authorization: Bearer <token>`；API Key：`x-api-key: gsp_<32hex>` |

### 统一响应约定

- **成功响应**：直接返回 JSON 数据，HTTP 200/201
- **失败响应**：
  ```json
  { "error": { "code": "<ERROR_CODE>", "message": "<人类可读消息>", "details"?: {...} } }
  ```
- **常见错误码**：

| HTTP | 错误码 | 含义 |
|------|--------|------|
| 400 | `PANEL_VALIDATION_ERROR` | 请求参数校验失败 |
| 400 | `WEAK_PASSWORD` | 密码强度不足（含 `details.failures/suggestions/score`） |
| 401 | `PANEL_UNAUTHORIZED` | 未认证或凭证无效 |
| 403 | `PANEL_FORBIDDEN` | 账号已禁用/无权限 |
| 403 | `PANEL_REGISTRATION_DISABLED` | 管理员已关闭注册 |
| 403 | `EMAIL_NOT_VERIFIED` | 邮箱未通过验证（开启验证门控时拦截登录） |
| 404 | `PANEL_NOT_FOUND` / `USER_NOT_FOUND` / `API_KEY_NOT_FOUND` | 资源不存在 |
| 409 | `USER_ALREADY_EXISTS` / `API_KEY_REVOKED` | 资源冲突 |
| 500 | `PANEL_INTERNAL_ERROR` | 服务端内部错误 |

### 公网访问入口

调用示例统一使用公网 HTTPS 入口：`https://gsp.ecsrz.com:3001`（参见 `.trae/rules/0.md`，浏览器端禁止使用 `localhost:3000` / `127.0.0.1:3000`）。

---

## 一、认证（Auth）

### 1.1 健康检查（Health Check）

- **功能描述**：轻量级连通性探针，仅返回 `ok` 状态，不做任何业务计算
- **请求方法**：GET
- **URL 路径**：`/api/health`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| status | string | 固定值 `"ok"` |

  ```json
  { "status": "ok" }
  ```
- **错误响应**：无（路径必然命中，失败由全局错误处理）
- **调用示例**：
  ```bash
  curl -i https://gsp.ecsrz.com:3001/api/health
  ```

### 1.2 后端版本号（Backend Version）

- **功能描述**：返回 Panel 后端 `package.json` 中的版本号
- **请求方法**：GET
- **URL 路径**：`/api/version`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| version | string | 语义化版本号，如 `"4.15.0"` |

  ```json
  { "version": "4.15.0" }
  ```
- **错误响应**：无
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/version
  ```

### 1.3 版本更新日志（Version Changelog）

- **功能描述**：解析项目根目录的 `version.md` 文件，返回结构化更新日志
- **请求方法**：GET
- **URL 路径**：`/api/version/changelog`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：返回 `parseChangelog()` 解析后的结构化对象（数组形式，按版本号倒序）
  - 错误响应（500）—— ⚠️ 非标准错误结构：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| error | string | 固定字符串 `"解析版本日志失败"` |

    ```json
    { "error": "解析版本日志失败" }
    ```
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/version/changelog
  ```

### 1.4 用户登录（Login）

- **功能描述**：校验邮箱密码并签发 JWT，支持邮箱验证门控与密码过期提示
- **请求方法**：POST
- **URL 路径**：`/api/auth/login`
- **鉴权要求**：无需鉴权（独立登录速率限制：每 IP 每 15 分钟最多 10 次）
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| email | string | 是 | 注册邮箱 |
| password | string | 是 | 明文密码 |

  ```json
  { "email": "admin@local.dev", "password": "admin123" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| token | string | JWT 访问令牌 |
| user | UserInfo | 用户基本信息（见下表） |
| password_expired? | boolean | 仅在管理员密码过期时附加 `true` |

  **UserInfo 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 用户 ID |
| email | string | 邮箱 |
| username | string | 用户名 |
| role | UserRole | 角色：`server_admin` / `instance_admin` / `user` |
| status | string | 状态：`active` / `disabled` / `deleted` |
| created_at | string | 创建时间（ISO 8601） |
| is_built_in? | number | 内置账号标记（1=演示账号） |

  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "u-xxx",
      "email": "admin@local.dev",
      "username": "admin",
      "role": "server_admin",
      "status": "active",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少 email 或 password |
| 401 | `PANEL_UNAUTHORIZED` | 邮箱或密码错误（用户不存在或哈希不匹配） |
| 403 | `PANEL_FORBIDDEN` | 账号已禁用（`disabled`）或已删除（`deleted`） |
| 403 | `EMAIL_NOT_VERIFIED` | 启用邮箱验证门控且非管理员未验证 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@local.dev","password":"admin123"}'
  ```

### 1.5 用户注册（Register）

- **功能描述**：自助注册新用户账号，注册成功后异步发送邮箱验证邮件并写入审计日志
- **请求方法**：POST
- **URL 路径**：`/api/auth/register`
- **鉴权要求**：无需鉴权（受 `registration.enabled` 设置项门控）
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| email | string | 是 | 邮箱（需匹配 `^[^\s@]+@[^\s@]+\.[^\s@]+$`，≤128 字符） |
| username | string | 是 | 用户名（2-32 字符） |
| password | string | 是 | 密码（需通过 `checkPasswordStrength` 校验） |

  ```json
  { "email": "player@example.com", "username": "player01", "password": "S3cure@Pass!" }
  ```
- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| userId | string | 新建用户 ID |
| verifyCode | string | 验证码（由 `userService.register` 返回） |
| token | string | 自动登录签发的 JWT |
| user | UserInfo | 用户基本信息 |

  ```json
  {
    "userId": "u-yyy",
    "verifyCode": "abc123",
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "u-yyy", "email": "player@example.com", "username": "player01", "role": "user", "status": "active", "created_at": "2026-07-25T..." }
  }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少字段 / 邮箱格式不合法 / 用户名长度不合规 |
| 400 | `WEAK_PASSWORD` | 密码强度不足（含 `details.failures/suggestions/score`） |
| 403 | `PANEL_REGISTRATION_DISABLED` | `registration.enabled=false` |
| 409 | `USER_ALREADY_EXISTS` | 邮箱已被注册 |
| 500 | `PANEL_INTERNAL_ERROR` | 注册失败（其他未分类异常） |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"player@example.com","username":"player01","password":"S3cure@Pass!"}'
  ```

### 1.6 当前登录用户信息（Current User）

- **功能描述**：根据 JWT 中的 `userId` 查询当前登录用户的最新资料
- **请求方法**：GET
- **URL 路径**：`/api/auth/me`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | UserInfo | 当前登录用户信息 |

  ```json
  { "user": { "id": "u-xxx", "email": "admin@local.dev", "username": "admin", "role": "server_admin", "status": "active", "created_at": "2026-01-01T00:00:00.000Z" } }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 / JWT 中无 userId |
| 403 | `PANEL_FORBIDDEN` | 账号已删除（`status=deleted`） |
| 404 | `PANEL_UNAUTHORIZED` | 用户不存在（错误码复用 UNAUTHORIZED，message="用户不存在"） |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/auth/me \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 二、用户管理（User Management）

> 本组接口全部挂在 `/api/users` 下，挂载时统一套 `authenticateToken(JWT_SECRET) + requireAdmin`，**仅 `server_admin` 可访问**。

### 2.1 列出全部用户（List Users）

- **功能描述**：返回系统中所有用户（含已禁用/已删除），按 `created_at` 升序
- **请求方法**：GET
- **URL 路径**：`/api/users`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| users | AdminUserSummary[] | 用户摘要列表 |
| total | number | 总数（=users.length） |

  **AdminUserSummary 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 用户 ID |
| email | string | 邮箱 |
| username | string | 用户名 |
| role | UserRole | 角色 |
| status | string | 状态：`active` / `disabled` / `deleted` |
| display_name | string \| null | 显示名称 |
| is_verified | boolean | 是否已验证 |
| is_built_in? | number | 内置账号标记（v4.0.2） |
| last_login_at | string \| null | 最近登录时间 |
| last_login_ip | string \| null | 最近登录 IP |
| created_at | string | 创建时间 |
| updated_at | string | 更新时间 |

  ```json
  { "users": [ { "id": "u-xxx", "email": "admin@local.dev", "username": "admin", "role": "server_admin", "status": "active", "display_name": null, "is_verified": true, "last_login_at": null, "last_login_ip": null, "created_at": "...", "updated_at": "..." } ], "total": 1 }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 数据库查询失败 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/users \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 2.2 查询用户详情（Get User）

- **功能描述**：按 ID 查询单个用户详情
- **请求方法**：GET
- **URL 路径**：`/api/users/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 用户 ID |
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | AdminUserSummary | 用户摘要（结构同 2.1） |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 404 | `USER_NOT_FOUND` | 用户不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/users/u-xxx \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 2.3 创建用户（Create User）

- **功能描述**：管理员直接创建用户，可选指定角色与显示名称；写入审计日志 `user.create`
- **请求方法**：POST
- **URL 路径**：`/api/users`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| email | string | 是 | 邮箱 |
| username | string | 是 | 用户名（2-32 字符） |
| password | string | 是 | 密码（≥6 位） |
| role | UserRole | 是 | 角色：`server_admin` / `instance_admin` / `user` |
| display_name | string | 否 | 显示名称 |

  ```json
  { "email": "mod@example.com", "username": "mod01", "password": "S3cure@Pass!", "role": "instance_admin" }
  ```
- **响应数据**：
  - 成功响应（201）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | AdminUserSummary | 新建用户摘要 |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少字段 / 非法 role / 密码<6 位 / 用户名长度不合规 |
| 409 | `USER_ALREADY_EXISTS` | 邮箱已存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/users \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"email":"mod@example.com","username":"mod01","password":"S3cure@Pass!","role":"instance_admin"}'
  ```

### 2.4 更新用户（Update User）

- **功能描述**：按 ID 更新用户的可变字段（用户名/角色/状态/显示名/验证标记），仅传递已提供字段
- **请求方法**：PATCH
- **URL 路径**：`/api/users/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 用户 ID |

  - 请求体（全部可选）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| username | string | 否 | 用户名 |
| role | UserRole | 否 | 角色 |
| status | string | 否 | `active` / `disabled` |
| display_name | string \| null | 否 | 显示名称 |
| is_verified | boolean | 否 | 是否已验证 |

  ```json
  { "display_name": "管理员小李", "status": "active" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | AdminUserSummary | 更新后的用户摘要 |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 404 | `USER_NOT_FOUND` | 用户不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PATCH https://gsp.ecsrz.com:3001/api/users/u-xxx \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"管理员小李"}'
  ```

### 2.5 调整用户角色（Update User Role）

- **功能描述**：单独调整用户角色，写入审计日志 `user.update_role`
- **请求方法**：PATCH
- **URL 路径**：`/api/users/:id/role`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 用户 ID |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| role | UserRole | 是 | 新角色（3 级之一） |

  ```json
  { "role": "instance_admin" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | AdminUserSummary | 更新后的用户摘要 |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 非法 role（不在 3 级体系中） |
| 404 | `USER_NOT_FOUND` | 用户不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PATCH https://gsp.ecsrz.com:3001/api/users/u-xxx/role \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"role":"instance_admin"}'
  ```

### 2.6 软删除用户（Soft Delete User）

- **功能描述**：将用户标记为 `deleted`（保留审计追溯），写入审计日志 `user.soft_delete`
- **请求方法**：DELETE
- **URL 路径**：`/api/users/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 待删除用户 ID |
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 已删除用户 ID |
| deleted | boolean | 固定 `true` |

  ```json
  { "id": "u-xxx", "deleted": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 不能删除自己 / 不能删除最后一个 `server_admin` |
| 404 | `USER_NOT_FOUND` | 目标用户不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X DELETE https://gsp.ecsrz.com:3001/api/users/u-xxx \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 三、个人信息（Personal Info）

### 3.1 我的资产聚合（My Assets）

- **功能描述**：一次返回当前登录用户的全维度资产数据：用户信息 + 钱包余额 + VIP + 实例列表 + 最近订单 + 最近 CDK 兑换 + 未读通知数
- **请求方法**：GET
- **URL 路径**：`/api/me/assets`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **MyAssetsResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user | UserInfo | 用户基本信息 |
| wallet | object | 钱包：`{ balance: number, last_daily_claim: string \| null }` |
| vip | object | VIP：`{ level: number, exp: number }` |
| instances | MyAssetsInstance[] | 实例列表：`{ id, name, status, online_players }` |
| recent_orders | MyAssetsOrderSummary[] | 最近订单：`{ id, instance_id, instance_name, item_name, price, status, created_at }` |
| recent_cdk_redeems | CdkRedeemSummary[] | 最近 CDK 兑换：`{ id, instance_id, instance_name, cdk_code, reward, redeemed_at }` |
| unread_notifications | number | 未读通知数 |

  ```json
  {
    "user": { "id": "u-xxx", "email": "player@example.com", "username": "player01", "role": "user", "status": "active", "created_at": "..." },
    "wallet": { "balance": 1000, "last_daily_claim": "2026-07-25" },
    "vip": { "level": 1, "exp": 0 },
    "instances": [ { "id": "s-1", "name": "我的服务器", "status": "running", "online_players": 3 } ],
    "recent_orders": [],
    "recent_cdk_redeems": [],
    "unread_notifications": 0
  }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 聚合查询失败 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/me/assets \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.2 我的订单列表（My Orders）

- **功能描述**：跨实例聚合当前用户的最近 100 条订单，含物品明细与领取码；按 `created_at` 倒序
- **请求方法**：GET
- **URL 路径**：`/api/my/orders`
- **鉴权要求**：JWT
- **请求参数**：
  - 查询参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | `pending` / `claiming` / `claimed` / `expired`；传 `pending` 时同时包含 `claiming` |

- **响应数据**：
  - 成功响应（200）—— **ListMyOrdersResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| orders | MyOrderSummary[] | 订单列表 |

  **MyOrderSummary 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 订单 ID |
| instance_id | string | 实例 ID |
| instance_name | string | 实例名称（无则空串） |
| items | MyOrderItem[] | 物品明细 |
| total_price | number | 订单总价（点券） |
| status | string | `pending` / `claiming` / `claimed` / `expired` |
| claim_code | string | 领取码 |
| claimed_at | string \| null | 领取时间 |
| expires_at | string | 过期时间 |
| created_at | string | 创建时间 |

  **MyOrderItem 字段**：`{ item_name: string, count: number, price: number, quality: string }`

  ```json
  { "orders": [ { "id": "1001", "instance_id": "s-1", "instance_name": "我的服务器", "items": [ { "item_name": "钻石", "count": 64, "price": 100, "quality": "rare" } ], "total_price": 100, "status": "pending", "claim_code": "XXXX-YYYY", "claimed_at": null, "expires_at": "2026-08-01T00:00:00.000Z", "created_at": "2026-07-25T..." } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl "https://gsp.ecsrz.com:3001/api/my/orders?status=pending" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.3 玩家门户首页概览（My Overview）

- **功能描述**：返回玩家门户首页所需的全部计数：绑定数、未读通知、进行中订单、钱包余额合计、今日可领福利数；表不存在时静默返回 0
- **请求方法**：GET
- **URL 路径**：`/api/my/overview`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **GetMyOverviewResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| overview | MyOverview | 概览对象 |

  **MyOverview 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| bindings_total | number | 游戏角色绑定总数 |
| bindings_verified | number | 已验证绑定数 |
| unread_notifications | number | 未读通知数 |
| pending_orders | number | 进行中订单数（`pending` + `claiming`） |
| wallet_balance | number | 钱包余额合计（点券） |
| daily_claimable | number | 今日可领每日福利的钱包数 |

  ```json
  { "overview": { "bindings_total": 2, "bindings_verified": 1, "unread_notifications": 3, "pending_orders": 1, "wallet_balance": 1500, "daily_claimable": 1 } }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/my/overview \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 四、通知（Notifications）

> 本组接口挂在 `/api/notifications` 下，挂载时统一套 `authenticateToken(JWT_SECRET)`；所有端点仅返回当前登录用户本人的通知。

### 4.1 列出我的通知（List Notifications）

- **功能描述**：返回当前用户全部通知及未读数
- **请求方法**：GET
- **URL 路径**：`/api/notifications`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| notifications | NotificationSummary[] | 通知列表 |
| unread_count | number | 未读数 |

  **NotificationSummary 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | number | 通知 ID |
| type | string | 通知类型 |
| title | string | 标题 |
| content | string | 内容 |
| related_server_id | string \| null | 关联实例 ID |
| related_order_id | number \| null | 关联订单 ID |
| is_read | boolean | 是否已读 |
| created_at | string | 创建时间 |

  ```json
  { "notifications": [ { "id": 1, "type": "order.claimed", "title": "订单已领取", "content": "...", "related_server_id": "s-1", "related_order_id": 1001, "is_read": false, "created_at": "..." } ], "unread_count": 1 }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/notifications \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.2 标记单条通知已读（Mark Notification Read）

- **功能描述**：将指定 ID 的通知标记为已读
- **请求方法**：PATCH
- **URL 路径**：`/api/notifications/:id/read`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 通知 ID（必须为数字） |
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | number | 通知 ID |
| read | boolean | 固定 `true` |

  ```json
  { "id": 1, "read": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | `id` 不是数字 |
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PATCH https://gsp.ecsrz.com:3001/api/notifications/1/read \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.3 全部标记已读（Mark All Read）

- **功能描述**：将当前用户所有未读通知标记为已读
- **请求方法**：PATCH
- **URL 路径**：`/api/notifications/read-all`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| read_all | boolean | 固定 `true` |

  ```json
  { "read_all": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PATCH https://gsp.ecsrz.com:3001/api/notifications/read-all \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 五、审计日志（Audit Logs）

### 5.1 列出审计日志（List Audit Logs）

- **功能描述**：按多维度过滤查询审计日志，仅 `server_admin` 可访问
- **请求方法**：GET
- **URL 路径**：`/api/audit-logs`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 查询参数（全部可选）：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| server_id | string | 否 | 按实例 ID 过滤 |
| user_id | string | 否 | 按操作者 ID 过滤 |
| action | string | 否 | 按动作类型过滤（如 `auth.register` / `user.create`） |
| target_type | string | 否 | 按目标类型过滤（如 `user`） |
| from | string | 否 | 起始时间（ISO 8601） |
| to | string | 否 | 截止时间（ISO 8601） |
| limit | number | 否 | 返回条数上限 |

- **响应数据**：
  - 成功响应（200）—— **ListAuditLogsResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| logs | AuditLogSummary[] | 审计日志列表 |

  **AuditLogSummary 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | number | 日志 ID |
| server_id | string \| null | 关联实例 ID |
| user_id | string \| null | 操作者 ID |
| action | string | 动作 |
| target_type | string \| null | 目标类型 |
| target_id | string \| null | 目标 ID |
| details | object \| null | 详情 |
| ip_address | string \| null | 操作 IP |
| created_at | string | 创建时间 |

  ```json
  { "logs": [ { "id": 1, "server_id": null, "user_id": "u-xxx", "action": "auth.register", "target_type": "user", "target_id": "u-xxx", "details": { "email": "..." }, "ip_address": "127.0.0.1", "created_at": "..." } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | AppError.code | 业务校验失败（具体码由服务层抛出） |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl "https://gsp.ecsrz.com:3001/api/audit-logs?action=user.create&limit=50" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 六、设置（Settings）

> 管理类端点（`/api/settings/*` 与 `/api/system-config/*`）挂载时套 `authenticateToken + requireAdmin`；`/api/settings/site-info`、`/api/legal/*`、`/api/init/*` 为**公开端点**，挂载时不套鉴权中间件。

### 6.1 列出全部设置项 Schema（List Setting Schema）

- **功能描述**：返回全部结构化设置项的 schema 定义 + 当前值（敏感字段 `currentValue` 返回 null）
- **请求方法**：GET
- **URL 路径**：`/api/settings/schema`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| settings | SettingSchemaItem[] | 设置项 schema 列表 |

  **SettingSchemaItem 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| key | string | 配置键（如 `registration.enabled`） |
| label | string | 中文显示名 |
| type | string | 值类型（string/number/boolean/enum） |
| group | string | 分组（site/registration/games/vip/admin/backup/mail/maintenance/disk/legal） |
| defaultValue | string | 默认值（字符串形式） |
| description | string | 描述 |
| enumValues? | string[] | 枚举可选值（type=enum 时） |
| min? | number | 数字最小值 |
| max? | number | 数字最大值 |
| order | number | 同组内排序权重 |
| sensitive? | boolean | 是否敏感 |
| currentValue | string \| null | 当前值（敏感字段返回 null） |

  ```json
  { "settings": [ { "key": "site.name", "label": "站点名称", "type": "string", "group": "site", "defaultValue": "GameServer Panel", "description": "...", "order": 1, "currentValue": "我的面板" } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/settings/schema \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 6.2 查询单个设置项 Schema（Get Setting Schema）

- **功能描述**：按 key 查询单个设置项的 schema + 当前值
- **请求方法**：GET
- **URL 路径**：`/api/settings/schema/:key`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 设置项 key（如 `site.name`） |
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| setting | SettingSchemaItem | 设置项 schema（结构同 6.1） |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 404 | `PANEL_VALIDATION_ERROR` | 设置项不存在（message=`设置项 ${key} 不存在`） |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/settings/schema/site.name \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 6.3 设置配置值（Set Setting Value）

- **功能描述**：按 key 设置值，服务层根据 schema 做类型与取值范围校验
- **请求方法**：PUT
- **URL 路径**：`/api/settings/:key`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 设置项 key |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| value | string | 是 | 配置值（字符串形式） |

  ```json
  { "value": "我的新面板名称" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| setting | SettingSchemaItem | 更新后的设置项 schema |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少 value / schema 校验失败（消息含"必须为"/"不能小于"/"不能大于"/"未知的设置项"） |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PUT https://gsp.ecsrz.com:3001/api/settings/site.name \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"value":"我的新面板名称"}'
  ```

### 6.4 重置设置为默认值（Reset Setting Value）

- **功能描述**：将指定设置项重置回 schema 中的 `defaultValue`
- **请求方法**：POST
- **URL 路径**：`/api/settings/:key/reset`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 设置项 key |
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| setting | SettingSchemaItem | 重置后的设置项 schema |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误（含未知设置项） |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/settings/site.name/reset \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 6.5 公开站点信息（Public Site Info）

- **功能描述**：返回站点名称、公告、Logo URL，供登录页使用（无需鉴权）
- **请求方法**：GET
- **URL 路径**：`/api/settings/site-info`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| name | string | 站点名称 |
| announcement | string | 站点公告 |
| logoUrl | string | Logo URL |

  ```json
  { "name": "GameServer Panel", "announcement": "欢迎", "logoUrl": "" }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/settings/site-info
  ```

### 6.6 用户协议（Legal Terms）

- **功能描述**：返回管理员在设置面板配置的用户协议文本（未配置时返回空字符串）
- **请求方法**：GET
- **URL 路径**：`/api/legal/terms`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| content | string | 协议文本 |

  ```json
  { "content": "用户协议正文..." }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/legal/terms
  ```

### 6.7 隐私政策（Legal Privacy）

- **功能描述**：返回管理员在设置面板配置的隐私政策文本（未配置时返回空字符串）
- **请求方法**：GET
- **URL 路径**：`/api/legal/privacy`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| content | string | 政策文本 |

  ```json
  { "content": "隐私政策正文..." }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/legal/privacy
  ```

### 6.8 首启动状态查询（Init Status）

- **功能描述**：检测系统是否需要执行首启动向导；满足以下任一条件即 `needs_init=true`：默认 admin (`admin@local.dev`) 仍存在且未改密 / `site.name` 仍为默认值 `GameServer Panel`。演示模式（`VITE_ENABLE_DEMO=true`）下永远返回 `false`
- **请求方法**：GET
- **URL 路径**：`/api/init/status`
- **鉴权要求**：无需鉴权
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| needs_init | boolean | 是否需要初始化 |

  ```json
  { "needs_init": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/init/status
  ```

### 6.9 提交首启动向导（Submit Init Wizard）

- **功能描述**：一次性提交首启动向导数据：设置 `site.name`、更新默认 admin 密码、设置 `games.enabled_packs`；已完成初始化时返回 409 拒绝
- **请求方法**：POST
- **URL 路径**：`/api/init`
- **鉴权要求**：无需鉴权（内部 `needs_init=true` 门控）
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| site_name | string | 是 | 站点名称（≤64 字符） |
| admin_password | string | 是 | 管理员新密码（需通过 `checkPasswordStrength`） |
| enabled_packs | string[] | 否 | 启用的 Pack ID 列表（空数组=全部启用） |

  ```json
  { "site_name": "我的面板", "admin_password": "S3cure@Pass!", "enabled_packs": ["minecraft-vanilla"] }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| initialized | boolean | 固定 `true` |
| site_name | string | 已设置的站点名称 |
| admin_password_updated | boolean | 是否更新了默认 admin 密码（默认 admin 已被删除时为 false） |
| enabled_packs | string[] | 已启用的 Pack ID 列表 |
| demo_mode? | boolean | 仅在演示模式下附加 `true` |

  ```json
  { "initialized": true, "site_name": "我的面板", "admin_password_updated": true, "enabled_packs": ["minecraft-vanilla"] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 站点名称为空 / >64 字符 / `enabled_packs` 非字符串数组 / schema 校验失败 |
| 400 | `WEAK_PASSWORD` | 管理员密码强度不足（含 `details`） |
| 409 | `PANEL_VALIDATION_ERROR` | 系统已完成初始化（message=`系统已完成初始化，无法重复执行`） |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/init \
    -H "Content-Type: application/json" \
    -d '{"site_name":"我的面板","admin_password":"S3cure@Pass!","enabled_packs":["minecraft-vanilla"]}'
  ```

---

## 七、系统配置（System Config）

> 本组接口挂在 `/api/system-config` 下，挂载时统一套 `authenticateToken + requireAdmin`；与 `/api/settings` 不同，本组为纯 KV 配置项（无 schema 校验）。

### 7.1 列出全部系统配置（List System Configs）

- **功能描述**：返回 `system_configs` 表中全部 KV 配置
- **请求方法**：GET
- **URL 路径**：`/api/system-config`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **ListSystemConfigsResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| configs | SystemConfigItem[] | 配置列表 |

  **SystemConfigItem 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| key | string | 配置键 |
| value | string | 配置值 |
| description | string \| null | 描述 |
| updated_at | string | 更新时间 |

  ```json
  { "configs": [ { "key": "foo", "value": "bar", "description": null, "updated_at": "..." } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/system-config \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.2 查询单条系统配置（Get System Config）

- **功能描述**：按 key 查询单条配置，不存在时返回 `{ config: null }`（HTTP 200）
- **请求方法**：GET
- **URL 路径**：`/api/system-config/:key`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 配置键 |
- **响应数据**：
  - 成功响应（200）—— **GetSystemConfigResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| config | SystemConfigItem \| null | 配置项；不存在时为 null |

  ```json
  { "config": { "key": "foo", "value": "bar", "description": null, "updated_at": "..." } }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/system-config/foo \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.3 设置系统配置（Set System Config）

- **功能描述**：按 key upsert 一条配置（含可选描述）
- **请求方法**：PUT
- **URL 路径**：`/api/system-config/:key`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 配置键 |

  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| value | string | 是 | 配置值 |
| description | string | 否 | 描述 |

  ```json
  { "value": "bar", "description": "示例配置" }
  ```
- **响应数据**：
  - 成功响应（200）—— **SetSystemConfigResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| config | SystemConfigItem | 写入后的配置项 |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少 value 字段 |
| 500 | `PANEL_INTERNAL_ERROR` | 写入后查询失败 / 内部错误 |
- **调用示例**：
  ```bash
  curl -X PUT https://gsp.ecsrz.com:3001/api/system-config/foo \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"value":"bar","description":"示例配置"}'
  ```

### 7.4 删除系统配置（Delete System Config）

- **功能描述**：按 key 删除配置（幂等，key 不存在也返回 `deleted: true`）
- **请求方法**：DELETE
- **URL 路径**：`/api/system-config/:key`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 配置键 |
- **响应数据**：
  - 成功响应（200）—— **DeleteSystemConfigResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| key | string | 已删除的配置键 |
| deleted | boolean | 固定 `true` |

  ```json
  { "key": "foo", "deleted": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X DELETE https://gsp.ecsrz.com:3001/api/system-config/foo \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 八、密码重置（Password Reset）

> 本组接口挂在 `/api/auth/password-reset` 下，**全部为公开端点**（不套 `authenticateToken`）；`/request` 端点单独套 `createPasswordResetLimiter`（每 IP 限流 5 次/小时）。

### 8.1 请求密码重置邮件（Request Password Reset）

- **功能描述**：输入邮箱生成重置 token（仅存 sha256 hash），写 DB 后发送含 reset_url 的邮件。**防账号枚举**：无论邮箱是否存在均返回 200，邮件发送失败也返回 200
- **请求方法**：POST
- **URL 路径**：`/api/auth/password-reset/request`
- **鉴权要求**：无需鉴权（限流：每 IP 5 次/小时）
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| email | string | 是 | 注册邮箱（需匹配标准邮箱正则） |

  ```json
  { "email": "player@example.com" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| requested | boolean | 固定 `true`（无论邮箱是否存在） |

  ```json
  { "requested": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 邮箱格式不合法 |

  > ⚠️ 即使内部抛错也返回 200 `{ requested: true }`，避免泄露 SMTP 状态或用户存在性
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/password-reset/request \
    -H "Content-Type: application/json" \
    -d '{"email":"player@example.com"}'
  ```

### 8.2 确认密码重置（Confirm Password Reset）

- **功能描述**：通过 token + 新密码完成重置；事务内更新密码哈希、`token_version+1`（使旧 JWT 失效）、`password_changed_at`，并标记 token 已使用
- **请求方法**：POST
- **URL 路径**：`/api/auth/password-reset/confirm`
- **鉴权要求**：无需鉴权
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| token | string | 是 | 邮件中的重置 token（明文，64 hex） |
| new_password | string | 是 | 新密码（需通过 `checkPasswordStrength`） |

  ```json
  { "token": "abc123...64hex", "new_password": "N3wS3cure@Pass!" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| confirmed | boolean | 固定 `true` |

  ```json
  { "confirmed": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少 token 或 new_password |
| 400 | `WEAK_PASSWORD` | 密码强度不足（含 `details`） |
| 400 | `PASSWORD_RESET_TOKEN_INVALID` | token 无效 / 已使用 / 账号已不存在 |
| 400 | `PASSWORD_RESET_TOKEN_EXPIRED` | token 已过期（1 小时 TTL） |
| 500 | `PANEL_INTERNAL_ERROR` | 重置失败 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/password-reset/confirm \
    -H "Content-Type: application/json" \
    -d '{"token":"abc123...","new_password":"N3wS3cure@Pass!"}'
  ```

---

## 九、邮箱验证（Email Verify）

> 本组接口分两段挂载：
> - **鉴权段** `/api/auth/email-verify/status` 与 `/api/auth/email-verify/request` 挂载时套 `authenticateToken(JWT_SECRET)`，`/request` 端点单独套 `createEmailVerifyLimiter`（每用户限流 3 次/小时）
> - **公开段** `/api/auth/email-verify/confirm` 不套鉴权

### 9.1 查询邮箱验证状态（Email Verify Status）

- **功能描述**：返回当前登录用户的 `email_verified` 状态
- **请求方法**：GET
- **URL 路径**：`/api/auth/email-verify/status`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| email_verified | boolean | 是否已验证（DB 中 `email_verified=1` 时为 true） |

  ```json
  { "email_verified": false }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未登录 |
| 404 | `USER_NOT_FOUND` | 用户不存在 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/auth/email-verify/status \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 9.2 重发邮箱验证邮件（Request Email Verify）

- **功能描述**：登录用户主动重发验证邮件；已验证时返回 `{ sent: false, reason: 'already_verified' }`；邮件发送失败时返回 500
- **请求方法**：POST
- **URL 路径**：`/api/auth/email-verify/request`
- **鉴权要求**：JWT（限流：每用户 3 次/小时）
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| sent | boolean | 是否发送成功 |
| reason | string | 仅在 `sent=false` 时附加 `already_verified` |

  ```json
  { "sent": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未登录 |
| 404 | `USER_NOT_FOUND` | 用户不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 邮件发送失败（message=`邮件发送失败，请检查 SMTP 配置或稍后重试`） |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/email-verify/request \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 9.3 确认邮箱验证（Confirm Email Verify）

- **功能描述**：通过邮件中的 token 完成邮箱验证；事务内更新 `users.email_verified=1` 并标记 token 已使用
- **请求方法**：POST
- **URL 路径**：`/api/auth/email-verify/confirm`
- **鉴权要求**：无需鉴权
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| token | string | 是 | 邮件中的验证 token（明文，64 hex） |

  ```json
  { "token": "abc123...64hex" }
  ```
- **响应数据**：
  - 成功响应（200）：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| verified | boolean | 固定 `true` |

  ```json
  { "verified": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | 缺少 token |
| 400 | `EMAIL_VERIFY_TOKEN_INVALID` | token 无效 / 已使用 |
| 400 | `EMAIL_VERIFY_TOKEN_EXPIRED` | token 已过期（24 小时 TTL） |
| 500 | `PANEL_INTERNAL_ERROR` | 验证失败 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/auth/email-verify/confirm \
    -H "Content-Type: application/json" \
    -d '{"token":"abc123..."}'
  ```

---

## 十、API Keys

> 本组接口挂在 `/api/api-keys` 下，挂载时统一套 `authenticateToken + requireAdmin`，仅 `server_admin` 可访问；用于管理面板自身的 x-api-key 旁路认证凭据。

### 10.1 列出全部 API Key（List API Keys）

- **功能描述**：返回所有 API Key 的元信息（不含明文与 hash）
- **请求方法**：GET
- **URL 路径**：`/api/api-keys`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **ListApiKeysResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| api_keys | ApiKeyInfo[] | API Key 元信息列表 |

  **ApiKeyInfo 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | Key ID |
| name | string | 人类可读名称 |
| key_prefix | string | key 前缀（前 12 字符，用于识别） |
| user_id | string | 关联用户 ID |
| role | UserRole | 关联角色（创建时冻结） |
| created_at | string | 创建时间（ISO 8601） |
| expires_at | string \| null | 过期时间，null=永不过期 |
| last_used_at | string \| null | 最后使用时间 |
| last_used_ip | string \| null | 最后使用 IP |
| revoked_at | string \| null | 撤销时间 |

  ```json
  { "api_keys": [ { "id": "k-1", "name": "CI/CD", "key_prefix": "gsp_abcdef12", "user_id": "u-xxx", "role": "instance_admin", "created_at": "...", "expires_at": null, "last_used_at": null, "last_used_ip": null, "revoked_at": null } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 500 | `PANEL_INTERNAL_ERROR` | 数据库未初始化 / 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/api-keys \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 10.2 创建 API Key（Create API Key）

- **功能描述**：创建 API Key，**明文仅此一次返回**；不允许创建 `server_admin` 级 Key；非 `server_admin` 强制使用当前用户 ID
- **请求方法**：POST
- **URL 路径**：`/api/api-keys`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| name | string | 是 | 名称（≤100 字符，非空） |
| role | UserRole | 否 | 角色，默认 `user`；不可为 `server_admin` |
| user_id | string | 否 | 关联用户 ID，默认当前用户；仅 `server_admin` 可指定其他 active 用户 |
| expires_at | string \| null | 否 | 过期时间（ISO 8601，必须为未来时间）；不传=永不过期 |

  ```json
  { "name": "CI/CD Pipeline", "role": "instance_admin", "expires_at": "2027-01-01T00:00:00.000Z" }
  ```
- **响应数据**：
  - 成功响应（201）—— **CreateApiKeyResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| api_key | string | 明文 API Key（`gsp_<32hex>`），客户端必须保存 |
| info | ApiKeyInfo | Key 元信息（结构同 10.1） |

  ```json
  { "api_key": "gsp_abcdef1234567890abcdef1234567890", "info": { "id": "k-1", "name": "CI/CD Pipeline", "key_prefix": "gsp_abcdef12", "user_id": "u-xxx", "role": "instance_admin", "created_at": "...", "expires_at": "2027-01-01T00:00:00.000Z", "last_used_at": null, "last_used_ip": null, "revoked_at": null } }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | name 缺失 / >100 / role 为 `server_admin` / 非 `server_admin` 指定其他用户 / `expires_at` 非法或非未来时间 |
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/api-keys \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"name":"CI/CD Pipeline","role":"instance_admin"}'
  ```

### 10.3 查询 API Key 详情（Get API Key）

- **功能描述**：按 ID 查询单个 API Key 元信息
- **请求方法**：GET
- **URL 路径**：`/api/api-keys/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Key ID |
- **响应数据**：
  - 成功响应（200）—— **GetApiKeyResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| api_key | ApiKeyInfo | Key 元信息（结构同 10.1） |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 404 | `API_KEY_NOT_FOUND` | Key 不存在 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/api-keys/k-1 \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 10.4 撤销 API Key（Revoke API Key）

- **功能描述**：按 ID 软撤销 API Key（设置 `revoked_at`）
- **请求方法**：DELETE
- **URL 路径**：`/api/api-keys/:id`
- **鉴权要求**：JWT + requireAdmin
- **请求参数**：
  - 路径参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | Key ID |
- **响应数据**：
  - 成功响应（200）—— **RevokeApiKeyResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | Key ID |
| revoked | boolean | 是否已撤销 |
| revoked_at | string | 撤销时间（ISO 8601，DB 中为 null 时用当前时间） |

  ```json
  { "id": "k-1", "revoked": true, "revoked_at": "2026-07-25T..." }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 404 | `API_KEY_NOT_FOUND` | Key 不存在 |
| 409 | `API_KEY_REVOKED` | Key 已撤销 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X DELETE https://gsp.ecsrz.com:3001/api/api-keys/k-1 \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十一、告警设置（Alert Settings）

> 本组接口挂在 `/api/alert-settings` 下，挂载时统一套 `authenticateToken(JWT_SECRET)`，**任何已认证用户均可访问自己的告警配置**；`/events` 端点按角色范围过滤数据。

### 11.1 查询告警配置（Get Alert Settings）

- **功能描述**：返回当前用户的告警通道配置 + 邮箱与验证状态（用于前端提示是否可启用 email 通道）
- **请求方法**：GET
- **URL 路径**：`/api/alert-settings`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **AlertSettingsResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| settings | AlertSettings | 告警配置（见下表） |
| email | string | 当前用户邮箱 |
| email_verified | boolean | 邮箱是否已验证 |

  **AlertSettings 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| user_id | string | 用户 ID |
| email_enabled | boolean | 邮箱通道是否启用 |
| webhook_url | string | Webhook URL（空串=未配置） |
| webhook_enabled | boolean | Webhook 是否启用 |
| subscribed_rules | AlertRuleType[] | 订阅的告警规则类型列表 |
| updated_at | string | 更新时间 |

  **AlertRuleType 枚举**：`instance_crash` / `instance_abnormal_exit` / `disk_high` / `ssl_expiring` / `backup_failing`

  ```json
  { "settings": { "user_id": "u-xxx", "email_enabled": true, "webhook_url": "", "webhook_enabled": false, "subscribed_rules": ["instance_crash", "disk_high"], "updated_at": "..." }, "email": "player@example.com", "email_verified": true }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/alert-settings \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.2 更新告警配置（Update Alert Settings）

- **功能描述**：更新当前用户的告警通道配置，仅传递已提供字段
- **请求方法**：PUT
- **URL 路径**：`/api/alert-settings`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体（全部可选）：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| email_enabled | boolean | 否 | 邮箱通道开关 |
| webhook_url | string | 否 | Webhook URL（必须为 http/https） |
| webhook_enabled | boolean | 否 | Webhook 开关 |
| subscribed_rules | AlertRuleType[] | 否 | 订阅规则列表（每项必须在 5 种枚举内） |

  ```json
  { "email_enabled": true, "subscribed_rules": ["instance_crash", "disk_high", "ssl_expiring"] }
  ```
- **响应数据**：
  - 成功响应（200）—— **UpdateAlertSettingsResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| settings | AlertSettings | 更新后的告警配置 |

  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | `subscribed_rules` 非数组 / 含非法规则 / `webhook_url` 非 http/https / `email_enabled`/`webhook_enabled` 非 boolean |
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `ALERT_SETTINGS_UPDATE_FAILED` | 服务层更新失败（message=`告警配置更新失败`） |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X PUT https://gsp.ecsrz.com:3001/api/alert-settings \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"email_enabled":true,"subscribed_rules":["instance_crash","disk_high"]}'
  ```

### 11.3 列出可用告警规则（List Alert Rules）

- **功能描述**：返回系统预置的告警规则清单（来自 `PRESET_ALERT_RULES` 常量）
- **请求方法**：GET
- **URL 路径**：`/api/alert-settings/rules`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应（200）—— **AlertRulesListResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| rules | AlertRule[] | 预置规则列表 |

  **AlertRule 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| type | AlertRuleType | 规则类型 |
| name | string | 规则名称 |
| description | string | 描述 |
| severity | AlertSeverity | 严重级别：`info` / `warning` / `critical` |
| default_channels | AlertChannel[] | 默认启用通道：`in_app` / `email` / `webhook` |

  ```json
  { "rules": [ { "type": "instance_crash", "name": "实例崩溃", "description": "...", "severity": "critical", "default_channels": ["in_app", "email"] } ] }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl https://gsp.ecsrz.com:3001/api/alert-settings/rules \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.4 查询告警历史（List Alert Events）

- **功能描述**：按角色范围查询告警历史；`server_admin` 看全部、`instance_admin` 看 owner + 共管实例、`user` 仅看 owner 实例（近 7 天）
- **请求方法**：GET
- **URL 路径**：`/api/alert-settings/events`
- **鉴权要求**：JWT
- **请求参数**：
  - 查询参数：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | number | 否 | 返回条数上限（仅 `server_admin` 生效） |

- **响应数据**：
  - 成功响应（200）—— **AlertEventsListResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| events | AlertEvent[] | 告警事件列表 |
| total | number | 总数 |

  **AlertEvent 字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | string | 事件 ID |
| rule_type | AlertRuleType | 规则类型 |
| severity | AlertSeverity | 严重级别 |
| title | string | 标题 |
| content | string | 内容 |
| related_server_id | string \| null | 关联实例 ID |
| triggered_at | string | 触发时间（ISO 8601） |
| dispatched_channels | AlertChannel[] | 已分发通道 |

  ```json
  { "events": [ { "id": "e-1", "rule_type": "instance_crash", "severity": "critical", "title": "实例崩溃", "content": "...", "related_server_id": "s-1", "triggered_at": "2026-07-25T...", "dispatched_channels": ["in_app", "email"] } ], "total": 1 }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl "https://gsp.ecsrz.com:3001/api/alert-settings/events?limit=50" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.5 测试 Webhook 连通性（Test Webhook）

- **功能描述**：向指定 Webhook URL 发送测试请求，返回连通性结果
- **请求方法**：POST
- **URL 路径**：`/api/alert-settings/test-webhook`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| webhook_url | string | 是 | Webhook URL（必须为 http/https） |

  ```json
  { "webhook_url": "https://hooks.example.com/test" }
  ```
- **响应数据**：
  - 成功响应（200）—— **TestWebhookResponse**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 是否发送成功 |
| message | string | 结果消息 |

  ```json
  { "success": true, "message": "测试推送成功" }
  ```
  - 错误响应：

| HTTP | 错误码 | 触发条件 |
|------|--------|----------|
| 400 | `PANEL_VALIDATION_ERROR` | `webhook_url` 为空 / 非 http/https URL |
| 401 | `PANEL_UNAUTHORIZED` | 未认证 |
| 500 | `PANEL_INTERNAL_ERROR` | 内部错误 |
- **调用示例**：
  ```bash
  curl -X POST https://gsp.ecsrz.com:3001/api/alert-settings/test-webhook \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"webhook_url":"https://hooks.example.com/test"}'
  ```

---

## 附录：路由挂载与鉴权矩阵

> 完整挂载点来自 `panel/backend/src/routes-registry.ts`

| 路由前缀 | 鉴权中间件 | 来源文件 |
|----------|-----------|----------|
| `/api/health`、`/api/auth/login`、`/api/auth/register`、`/api/version`、`/api/version/changelog` | 无（inline） | `routes-registry.ts` |
| `/api/auth/me` | `authenticateToken` | `routes-registry.ts` |
| `/api/users` | `authenticateToken + requireAdmin` | `users.ts` |
| `/api/me` | `authenticateToken` | `me.ts` |
| `/api/my` | `authenticateToken` | `my.ts` |
| `/api/notifications` | `authenticateToken` | `notifications.ts` |
| `/api/audit-logs` | `authenticateToken + requireAdmin` | `auditLogs.ts` |
| `/api/settings`（管理端） | `authenticateToken + requireAdmin` | `settings.ts` |
| `/api/settings/site-info`、`/api/init/*`、`/api/legal/*` | 无（公开） | `settings.ts` |
| `/api/system-config` | `authenticateToken + requireAdmin` | `systemConfig.ts` |
| `/api/auth/password-reset` | 无（公开，`/request` 单独限流） | `passwordReset.ts` |
| `/api/auth/email-verify/status`、`/api/auth/email-verify/request` | `authenticateToken`（`/request` 单独限流） | `emailVerify.ts` |
| `/api/auth/email-verify/confirm` | 无（公开） | `emailVerify.ts` |
| `/api/api-keys` | `authenticateToken + requireAdmin` | `apiKeys.ts` |
| `/api/alert-settings` | `authenticateToken` | `alertSettings.ts` |
