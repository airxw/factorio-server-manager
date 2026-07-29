---
type: api-doc
title: 商店/CDK/钱包/VIP/玩家 API 文档
date: 2026-07-25
status: final
related: panel/backend/src/api/routes
tags: [api, shop, cdk, wallet, vip, player, bindings, friends, store-gm, discover]
---

# 商店/CDK/钱包/VIP/玩家 API 文档

> 本文档覆盖 GSP 项目 Panel 后端中商店、CDK、钱包、VIP、玩家、绑定、好友、GM 工作台、Daemon 上报与服务器发现相关的 72 个 API 接口。
> 源码目录：`panel/backend/src/api/routes/`

## 一、概述

### 1.1 API 域名

| 用途 | 地址 |
|------|------|
| 公网访问 | `https://gsp.ecsrz.com:3001` |
| 局域网访问 | `https://192.168.5.14:3001` |

所有接口前缀为 `/api`。本统一域名仅用于示例，实际调用以部署环境为准。

### 1.2 认证体系

| 认证方式 | 说明 |
|---------|------|
| JWT Bearer Token | 通过 `Authorization: Bearer <token>` 头携带，由 `POST /api/auth/login` 获取 |
| Daemon 上报密钥 | 由 `x-report-key` 头携带，密钥来自环境变量 `DAEMON_REPORT_KEY` |
| 可选 JWT | 玩家档案接口支持匿名访问，登录后返回更多字段 |

### 1.3 角色体系

| 角色 | 说明 |
|------|------|
| `user` | 普通玩家 |
| `instance_admin` | 实例管理员（服主），仅能操作自有实例 |
| `server_admin` | 服务器管理员，可访问任意实例 |
| `system_admin` / `admin` | 系统管理员，最高权限 |

### 1.4 鉴权中间件

| 中间件 | 说明 |
|--------|------|
| `authenticateToken` | 校验 JWT，所有需要登录的接口必经 |
| `requireAdmin` | 要求 `server_admin` 及以上角色 |
| `requireRole(...)` | 要求指定角色之一 |
| `requireInstanceAccess()` | 要求对实例有访问权（owner 或 admin） |
| `requireInstanceAdmin('serverId')` | 要求实例管理员及以上（owner 或 server_admin） |

### 1.5 通用响应结构

**成功响应**：HTTP 2xx，返回 JSON 业务数据。

**错误响应**：HTTP 4xx/5xx，统一结构：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "人类可读的错误描述"
  }
}
```

### 1.6 通用错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `PANEL_VALIDATION_ERROR` | 400 | 参数校验失败 |
| `PANEL_UNAUTHORIZED` | 401 | 未认证或认证失效 |
| `PANEL_FORBIDDEN` | 403 | 无权限 |
| `PANEL_INTERNAL_ERROR` | 500 | 内部错误 |
| `PANEL_SERVICE_UNAVAILABLE` | 503 | 服务不可用（如表未创建） |

### 1.7 速率限制

| 端点 | 限制 |
|------|------|
| `POST /api/servers/:serverId/cdk/redeem` | 10 次/小时/用户 |
| `POST /api/cdk/redeem` | 10 次/小时/用户 |
| `GET /api/cdk/lookup` | 10 次/小时/用户 |

---

## 二、商店商品管理（Shop Items）

源码：`shop.ts`，挂载前缀 `/api/servers`（套 `authenticateToken`）

### 2.1 列出商店商品

- **功能描述**：列出指定实例的上架商品列表
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/shop-items`
- **鉴权要求**：JWT + `requireInstanceAccess`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | items | ShopItemSummary[] | 商品列表 |

    ```json
    {
      "items": [
        {
          "id": 1,
          "server_id": "srv-xxx",
          "item_name": "diamond",
          "quality": "epic",
          "vip_level_required": 1,
          "price": 100,
          "daily_limit": null,
          "enabled": true
        }
      ]
    }
    ```
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-items" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 2.2 上架/更新商品（Upsert）

- **功能描述**：新增或更新实例商品（按 `item_name` 唯一）
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/shop-items`
- **鉴权要求**：JWT + `requireInstanceAdmin('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | item_name | string | 是 | 物品标识，非空 |
    | quality | string | 否 | 品质：`normal`/`uncommon`/`rare`/`epic`/`legendary` |
    | vip_level_required | number | 否 | 所需 VIP 等级，非负整数 |
    | price | number | 否 | 价格，非负整数，默认 0 |
    | daily_limit | number\|null | 否 | 每日限购，非负整数或 null |
    | enabled | boolean | 否 | 是否启用 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | item | ShopItemSummary | 商品详情 |

    ```json
    {
      "item": {
        "id": 1,
        "server_id": "srv-xxx",
        "item_name": "diamond",
        "quality": "epic",
        "vip_level_required": 1,
        "price": 100,
        "daily_limit": null,
        "enabled": true
      }
    }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-items" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"item_name":"diamond","quality":"epic","price":100,"vip_level_required":1,"enabled":true}'
  ```

### 2.3 删除商品

- **功能描述**：删除指定商品（幂等）
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/shop-items/:id`
- **鉴权要求**：JWT + `requireInstanceAdmin('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | number | 是 | 商品 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "id": 1, "deleted": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`SHOP_ITEM_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-items/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 三、商店订单（Shop Orders）

源码：`shop.ts`，挂载前缀 `/api/servers`（套 `authenticateToken`）

### 3.1 创建订单

- **功能描述**：用户下单购买商品；支持 `delivery_mode=direct` 直发模式
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/shop-orders`
- **鉴权要求**：JWT + `requireInstanceAccess`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | items | Array | 是 | 订单项数组，非空 |
    | items[].item_name | string | 是 | 物品标识，非空 |
    | items[].count | number | 是 | 数量，1-999999 整数 |
    | items[].quality | string | 否 | 品质枚举 |
    | delivery_mode | string | 否 | `direct` 直发模式 |
    | player_name | string | 否 | 直发模式下必填，目标玩家名 |
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | order | ShopOrder | 订单信息 |
    | items | ShopOrderItem[] | 订单项 |

    ```json
    {
      "order": {
        "id": 100,
        "server_id": "srv-xxx",
        "user_id": "usr-xxx",
        "status": "pending",
        "total_price": 200,
        "items_count": 2,
        "claim_code": "ABCD1234",
        "created_at": "2026-07-25T10:00:00Z",
        "claimed_at": null
      },
      "items": [
        { "id": 1, "order_id": 100, "item_name": "diamond", "count": 2, "quality": "epic" }
      ]
    }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`SHOP_ITEM_NOT_FOUND` (404)、`SHOP_ORDER_NOT_FOUND` (404)、`SHOP_ORDER_ALREADY_CLAIMED` (409)、`SHOP_ORDER_EXPIRED` (410)、`VIP_LEVEL_INSUFFICIENT` (403)、`BINDING_REQUIRED` (403)、`INSUFFICIENT_BALANCE` (400)、`DAILY_REWARD_ALREADY_CLAIMED` (409)、`COMMAND_RENDER_FAILED` (400)、`COMMAND_QUEUE_FULL` (503)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-orders" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"items":[{"item_name":"diamond","count":2,"quality":"epic"}]}'
  ```

### 3.2 列出订单

- **功能描述**：列出订单；非管理员仅看自己的，管理员可通过 `?userId=` 看任意用户
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/shop-orders`
- **鉴权要求**：JWT + `requireInstanceAccess`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 否 | 管理员可指定查询任意用户 |
    | status | string | 否 | 订单状态过滤 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | orders | ShopOrder[] | 订单列表 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-orders?status=pending" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.3 查询订单详情

- **功能描述**：查询单个订单详情；非管理员仅能查自己的
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/shop-orders/:id`
- **鉴权要求**：JWT + `requireInstanceAccess`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | number | 是 | 订单 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | order | ShopOrder | 订单信息 |
    | items | ShopOrderItem[] | 订单项 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`SHOP_ORDER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-orders/100" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 3.4 领取订单

- **功能描述**：凭领取码领取订单物品，发放到游戏内玩家
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/shop-orders/claim`
- **鉴权要求**：JWT + `requireInstanceAccess`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | claim_code | string | 是 | 领取码，非空 |
    | player_name | string | 是 | 目标游戏玩家名，非空 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | order | ShopOrder | 订单信息 |
    | items | ShopOrderItem[] | 订单项 |
    | delivered | boolean | 是否已发放 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`SHOP_ORDER_NOT_FOUND` (404)、`SHOP_ORDER_ALREADY_CLAIMED` (409)、`SHOP_ORDER_EXPIRED` (410)、`COMMAND_RENDER_FAILED` (400)、`COMMAND_QUEUE_FULL` (503)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/shop-orders/claim" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"claim_code":"ABCD1234","player_name":"Steve"}'
  ```

---

## 四、CDK 兑换码管理（CDK Codes Management）

源码：`cdk.ts`，挂载前缀 `/api/servers`（套 `authenticateToken`，端点内套 `requireAdmin`）

### 4.1 批量创建 CDK 兑换码

- **功能描述**：管理员批量创建 CDK 兑换码
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/cdk-codes`
- **鉴权要求**：JWT + 管理员（`instance_admin` 及以上）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | codes | Array | 是 | CDK 数组，非空 |
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | codes | CdkCode[] | 创建的 CDK 列表 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/cdk-codes" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"codes":[{"gift_name":"新手礼包","item_name":"diamond","count":10}]}'
  ```

### 4.2 列出 CDK 兑换码

- **功能描述**：管理员列出实例下的 CDK 兑换码
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/cdk-codes`
- **鉴权要求**：JWT + 管理员
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | status | string | 否 | 状态过滤：`unused`/`claiming`/`claimed`/`expired` |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | codes | CdkCode[] | CDK 列表 |
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/cdk-codes?status=unused" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.3 查询单条 CDK

- **功能描述**：管理员查询单个 CDK 详情
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/cdk-codes/:id`
- **鉴权要求**：JWT + 管理员
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | number | 是 | CDK ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | code | CdkCode | CDK 详情 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`CDK_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/cdk-codes/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.4 删除 CDK

- **功能描述**：删除 CDK（仅 `unused` 状态可删）
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/cdk-codes/:id`
- **鉴权要求**：JWT + 管理员
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | number | 是 | CDK ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "id": 1, "deleted": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`CDK_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/cdk-codes/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 4.5 实例内兑换 CDK

- **功能描述**：在指定实例内兑换 CDK（无需管理员）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/cdk/redeem`
- **鉴权要求**：JWT + 速率限制（10 次/小时/用户）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | code | string | 是 | CDK 兑换码 |
    | player_name | string | 是 | 目标玩家名 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | code | CdkCode | CDK 详情 |
    | delivered | boolean | 是否已发放 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`CDK_NOT_FOUND` (404)、`CDK_ALREADY_CLAIMED` (409)、`CDK_EXPIRED` (410)、`PACK_NOT_FOUND` (404)、`COMMAND_RENDER_FAILED` (400)、`COMMAND_QUEUE_FULL` (503)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/cdk/redeem" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"code":"GIFT-2026-XXXX","player_name":"Steve"}'
  ```

---

## 五、CDK 全局兑换（Global CDK）

源码：`cdk.ts` 中 `createGlobalCdkRouter`，挂载前缀 `/api/cdk`（套 `authenticateToken`）

### 5.1 查询 CDK 预览

- **功能描述**：通过兑换码查询 CDK 奖励内容（不兑换）
- **请求方法**：GET
- **URL 路径**：`/api/cdk/lookup`
- **鉴权要求**：JWT + 速率限制（10 次/小时/用户）
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | code | string | 是 | CDK 兑换码 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | code.gift_name | string | 礼包名 |
    | code.gift_description | string | 礼包描述 |
    | code.item_name | string | 物品标识 |
    | code.count | number | 物品数量 |
    | code.quality | string | 品质 |
    | code.items | array | 多物品列表 |
    | code.expires_at | string | 过期时间 |
    | code.status | string | 状态 |
    | code.server_id | string | 所属实例 ID |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`CDK_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/cdk/lookup?code=GIFT-2026-XXXX" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 5.2 全局兑换 CDK

- **功能描述**：无需 `serverId`，通过 code 自动查找实例并兑换；兑换成功后自动关注实例
- **请求方法**：POST
- **URL 路径**：`/api/cdk/redeem`
- **鉴权要求**：JWT + 速率限制（10 次/小时/用户）
- **请求参数**：
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | code | string | 是 | CDK 兑换码 |
    | player_name | string | 否 | 目标玩家名（可省略，自动选取） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | code | CdkCode | CDK 详情 |
    | delivered | boolean | 是否已发放 |
    | followed | boolean | 是否自动关注实例 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`CDK_NOT_FOUND` (404)、`CDK_ALREADY_CLAIMED` (409)、`CDK_EXPIRED` (410)、`PACK_NOT_FOUND` (404)、`COMMAND_RENDER_FAILED` (400)、`COMMAND_QUEUE_FULL` (503)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/cdk/redeem" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"code":"GIFT-2026-XXXX","player_name":"Steve"}'
  ```

---

## 六、钱包（Wallet）

源码：`wallet.ts`，挂载前缀 `/api/servers`（套 `authenticateToken`）

### 6.1 查询钱包信息

- **功能描述**：查询当前用户在某实例的钱包余额；首次访问自动创建（余额 0）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/wallet`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | wallet.balance | number | 当前余额 |
    | wallet.total_earned | number | 累计获得 |
    | wallet.total_spent | number | 累计消费 |
    | wallet.can_claim_daily | boolean | 今日是否可领 |
    | wallet.daily_reward_amount | number | 每日奖励金额 |
    | wallet.last_daily_claim_at | string\|null | 上次领取时间 |
    | wallet.last_daily_claim_date | string\|null | 上次领取日期（YYYY-MM-DD） |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/wallet" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 6.2 领取每日点券

- **功能描述**：领取每日点券奖励；金额按 VIP 阶梯（VIP0=100，VIP1=200，…，VIP5=3200）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/wallet/claim-daily`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | wallet | Wallet | 钱包信息（同 6.1） |
    | claimed_amount | number | 本次领取金额 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`DAILY_REWARD_ALREADY_CLAIMED` (409)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/wallet/claim-daily" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 七、VIP 权限配置（VIP Permissions）

源码：`vipPermissions.ts`，挂载前缀 `/api/vip-permissions`（套 `authenticateToken`）

### 7.1 列出全部 VIP 权限

- **功能描述**：列出所有 VIP 等级的权限配置
- **请求方法**：GET
- **URL 路径**：`/api/vip-permissions`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN, INSTANCE_ADMIN)`
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | permissions | VipPermissionItem[] | VIP 权限列表 |

    ```json
    {
      "permissions": [
        {
          "id": 1,
          "vip_level": 0,
          "display_name": "普通玩家",
          "permissions": [],
          "max_quality": "normal",
          "daily_limit": null,
          "daily_reward_amount": 100
        }
      ]
    }
    ```
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/vip-permissions" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.2 查询单条 VIP 权限

- **功能描述**：按 VIP 等级查询权限配置
- **请求方法**：GET
- **URL 路径**：`/api/vip-permissions/:level`
- **鉴权要求**：JWT + `requireRole(SERVER_ADMIN, INSTANCE_ADMIN)`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | level | number | 是 | VIP 等级 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | permission | VipPermissionItem | VIP 权限详情 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`VIP_PERMISSION_NOT_FOUND` (404)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/vip-permissions/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 7.3 创建 VIP 权限

- **功能描述**：创建新的 VIP 等级权限（level 已存在返回 409）
- **请求方法**：POST
- **URL 路径**：`/api/vip-permissions`
- **鉴权要求**：JWT + `requireAdmin`（仅 server_admin）
- **请求参数**：
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | vip_level | number | 是 | VIP 等级 |
    | display_name | string | 是 | 显示名称 |
    | permissions | string[] | 否 | 权限列表 |
    | max_quality | string | 是 | 最高品质：`normal`/`uncommon`/`rare`/`epic`/`legendary` |
    | daily_limit | number\|null | 否 | 每日限购 |
    | daily_reward_amount | number | 否 | 每日奖励金额，默认 0 |
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | permission | VipPermissionItem | VIP 权限详情 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_VALIDATION_ERROR` (409，level 已存在)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/vip-permissions" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"vip_level":2,"display_name":"VIP2","max_quality":"rare","daily_reward_amount":400}'
  ```

### 7.4 更新 VIP 权限

- **功能描述**：更新 VIP 等级权限配置（找不到 404）
- **请求方法**：PATCH
- **URL 路径**：`/api/vip-permissions/:level`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | level | number | 是 | VIP 等级 |
  - 请求体：所有字段均可选

    | 字段 | 类型 | 说明 |
    |------|------|------|
    | display_name | string | 显示名称 |
    | permissions | string[] | 权限列表 |
    | max_quality | string | 最高品质枚举 |
    | daily_limit | number\|null | 每日限购 |
    | daily_reward_amount | number | 每日奖励金额 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | permission | VipPermissionItem | VIP 权限详情 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`VIP_PERMISSION_NOT_FOUND` (404)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/vip-permissions/1" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"daily_reward_amount":300}'
  ```

### 7.5 删除 VIP 权限

- **功能描述**：删除 VIP 等级权限（幂等）
- **请求方法**：DELETE
- **URL 路径**：`/api/vip-permissions/:level`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | level | number | 是 | VIP 等级 |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "vip_level": 2, "deleted": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/vip-permissions/2" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 八、玩家加入设置（Player Join Settings）

源码：`player.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）

### 8.1 查询玩家加入设置

- **功能描述**：查询实例的玩家加入欢迎设置
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/player-join/settings`
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
    | settings | PlayerJoinSettings | 加入设置（含 welcome_message / gift_enabled / gift_item / gift_count / gift_quality / leave_message） |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/player-join/settings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 8.2 更新玩家加入设置

- **功能描述**：upsert 实例的玩家加入设置
- **请求方法**：PUT
- **URL 路径**：`/api/servers/:serverId/player-join/settings`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：所有字段可选

    | 字段 | 类型 | 说明 |
    |------|------|------|
    | welcome_message | string | 欢迎消息 |
    | gift_enabled | boolean | 是否启用礼包 |
    | gift_item | string | 礼包物品 |
    | gift_count | number\|null | 礼包数量，非负整数或 null |
    | gift_quality | string\|null | 礼包品质枚举 |
    | leave_message | string | 离开消息 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | settings | PlayerJoinSettings | 更新后的设置 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/player-join/settings" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"welcome_message":"欢迎光临","gift_enabled":true,"gift_item":"diamond","gift_count":5,"gift_quality":"rare"}'
  ```

---

## 九、玩家历史与礼包（Player History & Gifts）

源码：`player.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）

### 9.1 列出玩家历史

- **功能描述**：列出实例的玩家加入历史
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/player-histories`
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
    | histories | PlayerHistory[] | 玩家历史列表 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/player-histories" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 9.2 列出礼包领取记录

- **功能描述**：列出实例的礼包领取记录
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/gift-claims`
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
    | claims | GiftClaim[] | 礼包领取记录 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/gift-claims" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十、玩家管理操作（Player Management Actions）

源码：`player.ts`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）

### 10.1 查询在线玩家

- **功能描述**：查询实例当前在线玩家列表
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/players/online`
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
    | players | OnlinePlayer[] | 在线玩家列表 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/online" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 10.2 踢出玩家

- **功能描述**：从实例踢出指定玩家（RCON kick）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/kick`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | player_name | string | 是 | 玩家名，1-32 字符，仅 `[A-Za-z0-9_-]` |
    | reason | string | 否 | 原因，最长 128 字符 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否成功 |
    | command | string | 执行的命令 |
    | error | string\|undefined | 错误信息 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/kick" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve","reason":"违规行为"}'
  ```

### 10.3 封禁玩家

- **功能描述**：封禁玩家（RCON ban）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/ban`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | player_name | string | 是 | 玩家名 |
    | reason | string | 否 | 原因 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否成功 |
    | command | string | 执行的命令 |
    | error | string\|undefined | 错误信息 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/ban" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve","reason":"使用外挂"}'
  ```

### 10.4 解除封禁

- **功能描述**：解除玩家封禁（RCON pardon）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/pardon`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | player_name | string | 是 | 玩家名 |
- **响应数据**：同 10.2
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/pardon" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve"}'
  ```

### 10.5 授予 OP

- **功能描述**：授予玩家 OP 权限（RCON op）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/op`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | player_name | string | 是 | 玩家名 |
- **响应数据**：同 10.2
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/op" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve"}'
  ```

### 10.6 撤销 OP

- **功能描述**：撤销玩家 OP 权限（RCON deop）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/deop`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：同 10.5
- **响应数据**：同 10.2
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/deop" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve"}'
  ```

### 10.7 添加白名单

- **功能描述**：添加玩家到白名单（RCON whitelist add）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/whitelist/add`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：同 10.5
- **响应数据**：同 10.2
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/whitelist/add" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve"}'
  ```

### 10.8 移除白名单

- **功能描述**：从白名单移除玩家（RCON whitelist remove）
- **请求方法**：POST
- **URL 路径**：`/api/servers/:serverId/players/whitelist/remove`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：同 10.5
- **响应数据**：同 10.2
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/players/whitelist/remove" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"player_name":"Steve"}'
  ```

---

## 十一、玩家游戏账号绑定（Player Game Bindings）

源码：`playerBindings.ts` 中 `createPlayerBindingsRouter`，挂载前缀 `/api/player-bindings`（套 `authenticateToken`）

> 玩家自助绑定是核心路径，路由按角色分流：管理动作（reject）保持 admin-only，自助动作（list/create/verify/delete）对登录用户开放并限定 ownership。

### 11.1 列出玩家绑定

- **功能描述**：`server_admin` 列出全部；普通玩家仅列出自己的
- **请求方法**：GET
- **URL 路径**：`/api/player-bindings`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | bindings | PlayerBindingSummary[] | 绑定列表 |
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/player-bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.2 创建玩家绑定

- **功能描述**：玩家自助提交游戏账号绑定申请（生成 verify_code 待验证）
- **请求方法**：POST
- **URL 路径**：`/api/player-bindings`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | game_player_name | string | 是 | 游戏内玩家名，非空 |
    | game_type | string | 是 | 游戏类型，非空 |
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | binding | PlayerBindingSummary | 绑定记录（含 verify_code） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PLAYER_BINDING_ALREADY_EXISTS` (409)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/player-bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"game_player_name":"Steve","game_type":"minecraft"}'
  ```

### 11.3 验证玩家绑定

- **功能描述**：凭 verify_code 验证绑定；非 admin 仅可验证自己的绑定
- **请求方法**：POST
- **URL 路径**：`/api/player-bindings/:id/verify`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | id | number | 是 | 绑定 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | verify_code | string | 是 | 验证码，非空 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | binding | PlayerBindingSummary | 绑定记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PLAYER_BINDING_NOT_FOUND` (404)、`PLAYER_BINDING_VERIFY_CODE_INVALID` (400)、`PLAYER_BINDING_NOT_PENDING` (400)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/player-bindings/1/verify" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"verify_code":"123456"}'
  ```

### 11.4 拒绝玩家绑定（管理）

- **功能描述**：管理员拒绝玩家的绑定申请
- **请求方法**：POST
- **URL 路径**：`/api/player-bindings/:id/reject`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | id | number | 是 | 绑定 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | binding | PlayerBindingSummary | 绑定记录 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`PLAYER_BINDING_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/player-bindings/1/reject" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 11.5 删除玩家绑定

- **功能描述**：删除绑定记录；非 admin 仅可删除自己的绑定
- **请求方法**：DELETE
- **URL 路径**：`/api/player-bindings/:id`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | id | number | 是 | 绑定 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "id": 1, "deleted": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PLAYER_BINDING_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/player-bindings/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十二、服主实例玩家绑定管理（Server Player Bindings Admin）

源码：`playerBindings.ts` 中 `createServerPlayerBindingsRouter`，挂载前缀 `/api/servers`（套 `authenticateToken` + `requireAdmin`）

### 12.1 列出实例玩家绑定

- **功能描述**：按实例 game_type 关联列出玩家绑定（含 username）
- **请求方法**：GET
- **URL 路径**：`/api/servers/:serverId/player-bindings`
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
    | bindings | Array | 绑定列表（含 username 字段） |
  - 错误响应：`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/player-bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 12.2 软删除实例玩家绑定

- **功能描述**：软删除（status='rejected'）+ 同步解绑 user_instance_bindings；事务保证原子性
- **请求方法**：DELETE
- **URL 路径**：`/api/servers/:serverId/player-bindings/:id`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | id | number | 是 | 绑定 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "id": 1, "deleted": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PLAYER_BINDING_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/servers/srv-xxx/player-bindings/1" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十三、实例绑定与 VIP（Instance Bindings & VIP）

源码：`bindings.ts`，挂载前缀 `/api`（套 `authenticateToken`）

### 13.1 查询自己的实例绑定

- **功能描述**：用户查看自己绑定的实例列表
- **请求方法**：GET
- **URL 路径**：`/api/profile/bindings`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | bindings | BindingRecord[] | 绑定列表（含 vip_level / vip_expires_at） |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/profile/bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.2 绑定实例

- **功能描述**：用户绑定实例（自动获得 VIP1）
- **请求方法**：POST
- **URL 路径**：`/api/instances/:serverId/bindings`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 201

    ```json
    { "user_id": "usr-xxx", "server_id": "srv-xxx", "bound": true }
    ```
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`BINDING_ALREADY_EXISTS` (409)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/instances/srv-xxx/bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.3 解绑实例

- **功能描述**：用户解绑实例
- **请求方法**：DELETE
- **URL 路径**：`/api/instances/:serverId/bindings`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "user_id": "usr-xxx", "server_id": "srv-xxx", "bound": false }
    ```
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/instances/srv-xxx/bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.4 查询实例绑定列表（管理）

- **功能描述**：`instance_admin` 查看实例下所有用户绑定（含 username）
- **请求方法**：GET
- **URL 路径**：`/api/instances/:serverId/bindings`
- **鉴权要求**：JWT + `requireInstanceAdmin('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | bindings | InstanceBindingWithUsername[] | 绑定列表 |
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/instances/srv-xxx/bindings" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 13.5 调整用户 VIP 等级

- **功能描述**：`instance_admin` 调整某用户在该实例的 VIP 等级与过期时间
- **请求方法**：PATCH
- **URL 路径**：`/api/instances/:serverId/bindings/:userId`
- **鉴权要求**：JWT + `requireInstanceAdmin('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
    | userId | string | 是 | 目标用户 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | vip_level | number | 是 | VIP 等级，0-5 整数 |
    | vip_expires_at | string\|null | 否 | ISO 日期或 null（永久）；未提供时按 `vip.default_expiry_days` 自动计算 |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "user_id": "usr-xxx", "server_id": "srv-xxx", "vip_level": 2, "updated": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`BINDING_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PATCH "https://gsp.ecsrz.com:3001/api/instances/srv-xxx/bindings/usr-xxx" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"vip_level":3,"vip_expires_at":"2026-12-31T23:59:59Z"}'
  ```

---

## 十四、验证码（Verify Codes）

源码：`verifyCodes.ts`，挂载前缀 `/api/verify-codes`（套 `authenticateToken`）

### 14.1 生成验证码

- **功能描述**：生成游戏内 `!verify` 命令使用的验证码（用于玩家游戏账号绑定）
- **请求方法**：POST
- **URL 路径**：`/api/verify-codes`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | server_id | string | 是 | 实例 ID，非空 |
    | game_player_name | string | 是 | 游戏内玩家名，非空 |
- **响应数据**：
  - 成功响应：HTTP 201

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | code | VerifyCodeSummary | 验证码信息（含 code / expires_at） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/verify-codes" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"server_id":"srv-xxx","game_player_name":"Steve"}'
  ```

### 14.2 查询我的验证码

- **功能描述**：查询当前用户未使用且未过期的验证码
- **请求方法**：GET
- **URL 路径**：`/api/verify-codes/mine`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | codes | VerifyCodeSummary[] | 验证码列表 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/verify-codes/mine" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十五、玩家档案（Player Profile）

源码：`playerProfile.ts`，挂载前缀 `/api/players`（可选 JWT，路由内手动解析）

### 15.1 查询玩家公开档案

- **功能描述**：查询玩家公开档案；登录后返回共同实例与好友关系状态
- **请求方法**：GET
- **URL 路径**：`/api/players/:userId/profile`
- **鉴权要求**：可选 JWT（匿名访问仅返回公开信息）
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 目标用户 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | user | PlayerProfileUser | 用户信息（id/username/vip_level/created_at/avatar） |
    | bound_instances | PlayerProfileInstance[] | 关联的公开实例 |
    | recent_activity | array | 最近动态（当前返回空数组） |
    | mutual_instances | PlayerProfileInstance[] | 共同实例（仅登录后返回） |
    | friend_status | string | 好友关系状态（仅登录后返回）：`none`/`pending`/`accepted`/`rejected` |
  - 错误响应：`USER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/players/usr-xxx/profile" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十六、好友系统（Friends）

源码：`friends.ts`，挂载前缀 `/api/friends`（套 `authenticateToken`）

### 16.1 发送好友请求

- **功能描述**：向目标用户发送好友请求
- **请求方法**：POST
- **URL 路径**：`/api/friends/request`
- **鉴权要求**：JWT
- **请求参数**：
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | friend_user_id | string | 是 | 目标用户 ID，非空 |
- **响应数据**：
  - 成功响应：HTTP 201

    ```json
    { "success": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`FRIEND_REQUEST_SELF` (400，不能加自己)、`FRIEND_USER_NOT_FOUND` (404)、`FRIEND_REQUEST_ALREADY_EXISTS` (409)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/friends/request" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"friend_user_id":"usr-yyy"}'
  ```

### 16.2 接受好友请求

- **功能描述**：接受来自目标用户的好友请求
- **请求方法**：POST
- **URL 路径**：`/api/friends/:friendUserId/accept`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | friendUserId | string | 是 | 目标用户 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "success": true }
    ```
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`FRIEND_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/friends/usr-yyy/accept" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.3 拒绝好友请求

- **功能描述**：拒绝来自目标用户的好友请求
- **请求方法**：POST
- **URL 路径**：`/api/friends/:friendUserId/reject`
- **鉴权要求**：JWT
- **请求参数**：同 16.2
- **响应数据**：同 16.2
- **错误响应**：`PANEL_UNAUTHORIZED` (401)、`FRIEND_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/friends/usr-yyy/reject" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.4 好友列表

- **功能描述**：列出当前用户的好友列表
- **请求方法**：GET
- **URL 路径**：`/api/friends`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | friends | Friend[] | 好友列表 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/friends" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.5 待处理请求列表

- **功能描述**：列出当前用户的待处理好友请求
- **请求方法**：GET
- **URL 路径**：`/api/friends/pending`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | requests | FriendRequest[] | 待处理请求列表 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/friends/pending" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.6 在线好友列表

- **功能描述**：列出当前用户的在线好友
- **请求方法**：GET
- **URL 路径**：`/api/friends/online`
- **鉴权要求**：JWT
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | friends | Friend[] | 在线好友列表 |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/friends/online" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.7 删除好友

- **功能描述**：删除与目标用户的好友关系
- **请求方法**：DELETE
- **URL 路径**：`/api/friends/:friendUserId`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | friendUserId | string | 是 | 目标用户 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "success": true }
    ```
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`FRIEND_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X DELETE "https://gsp.ecsrz.com:3001/api/friends/usr-yyy" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 16.8 查询好友关系状态

- **功能描述**：查询当前用户与目标用户的好友关系状态
- **请求方法**：GET
- **URL 路径**：`/api/friends/:friendUserId/status`
- **鉴权要求**：JWT
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | friendUserId | string | 是 | 目标用户 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | status | string | 关系状态：`none`/`pending`/`accepted`/`rejected` |
  - 错误响应：`PANEL_UNAUTHORIZED` (401)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/friends/usr-yyy/status" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十七、店铺外观配置（Store Shop Config）

源码：`store_shop_config.ts`，挂载前缀 `/api`（套 `authenticateToken`）

### 17.1 读取店铺外观配置

- **功能描述**：读取实例店铺外观配置（banner / 描述 / 主题色）
- **请求方法**：GET
- **URL 路径**：`/api/store/servers/:serverId/shop-config`
- **鉴权要求**：JWT + `requireInstanceAccess('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | config | InstanceShopConfig | 店铺配置（banner_url / banner_link / shop_description / shop_theme_color） |
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/store/servers/srv-xxx/shop-config" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 17.2 更新店铺外观配置

- **功能描述**：更新实例店铺外观配置
- **请求方法**：PUT
- **URL 路径**：`/api/store/servers/:serverId/shop-config`
- **鉴权要求**：JWT + `requireInstanceAdmin('serverId')`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：所有字段可选

    | 字段 | 类型 | 说明 |
    |------|------|------|
    | banner_url | string | banner 图片 URL |
    | banner_link | string | banner 跳转链接 |
    | shop_description | string | 店铺描述 |
    | shop_theme_color | string | 主题色 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | config | InstanceShopConfig | 更新后的配置 |
  - 错误响应：`ERR_INVALID_BANNER_URL` (400)、`ERR_INVALID_BANNER_LINK` (400)、`ERR_INVALID_SHOP_DESCRIPTION` (400)、`ERR_INVALID_THEME_COLOR` (400)、`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/store/servers/srv-xxx/shop-config" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"shop_description":"欢迎来到我的店铺","shop_theme_color":"#007AFF"}'
  ```

---

## 十八、GM 工作台数据（GM Workbench Data）

源码：`store-gm.ts`，挂载前缀 `/api`（套 `authenticateToken` + 路由内 `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`）

### 18.1 玩家列表（CRM）

- **功能描述**：聚合 `player_bindings` + `users` + `shop_orders` + `player_sessions`，返回玩家 CRM 数据
- **请求方法**：GET
- **URL 路径**：`/api/store/players`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | page | number | 否 | 页码，默认 1 |
    | limit | number | 否 | 每页数量，默认 20，上限 100 |
    | search | string | 否 | 搜索关键词（玩家名 / 用户名 / 邮箱） |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | players | Array | 玩家列表（含 user_id / username / email / game_player_name / vip_level / total_spent / total_playtime_seconds 等） |
    | pagination.page | number | 当前页码 |
    | pagination.limit | number | 每页数量 |
    | pagination.total | number | 总数 |
    | pagination.total_pages | number | 总页数 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/store/players?instance_id=srv-xxx&page=1&limit=20" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 18.2 流水报表

- **功能描述**：按日聚合 `shop_orders` + `cdk_codes`，返回流水报表
- **请求方法**：GET
- **URL 路径**：`/api/store/reports/revenue`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | days | number | 否 | 统计天数，默认 30，上限 90 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | daily | Array | 按日数据（date / order_count / revenue / cdk_redeemed） |
    | summary.total_revenue | number | 总收入 |
    | summary.total_orders | number | 总订单数 |
    | summary.total_cdk_redeemed | number | 总 CDK 兑换数 |
    | summary.days | number | 统计天数 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/store/reports/revenue?instance_id=srv-xxx&days=30" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 18.3 时长统计

- **功能描述**：按日聚合 `player_sessions`，返回玩家时长统计
- **请求方法**：GET
- **URL 路径**：`/api/store/reports/playtime`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | days | number | 否 | 统计天数，默认 30，上限 90 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | daily | Array | 按日数据（date / session_count / total_seconds / active_players / avg_seconds） |
    | summary.total_playtime_seconds | number | 总时长（秒） |
    | summary.total_sessions | number | 总会话数 |
    | summary.active_players | number | 活跃玩家峰值 |
    | summary.days | number | 统计天数 |
    | note | string | 提示信息（表不存在时返回） |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/store/reports/playtime?instance_id=srv-xxx&days=30" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

### 18.4 服主实例列表

- **功能描述**：列出当前服主的实例（含在线玩家数、今日收入）；`server_admin` 可通过 `?all=true` 看所有实例
- **请求方法**：GET
- **URL 路径**：`/api/store/servers`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | all | string | 否 | `server_admin` 专用，`true` 查看所有实例 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | servers | Array | 实例列表（含 id / name / pack_id / game_type / status / port / online_players / today_revenue / today_orders 等） |
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/store/servers" \
    -H "Authorization: Bearer <JWT_TOKEN>"
  ```

---

## 十九、GM 玩家操作（GM Player Actions）

源码：`store-player-actions.ts`，挂载前缀 `/api`（套 `authenticateToken` + 路由内 `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)`）

### 19.1 发放补偿

- **功能描述**：服主对绑定玩家发放物品补偿（RCON give 命令）
- **请求方法**：POST
- **URL 路径**：`/api/store/players/:userId/compensate`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 目标用户 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | item | string | 是 | 物品标识 |
    | count | number | 是 | 数量，1-999999 整数 |
    | reason | string | 否 | 补偿原因 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否成功 |
    | command | string | 执行的命令 |
    | error | string\|undefined | 错误信息 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/store/players/usr-xxx/compensate" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"instance_id":"srv-xxx","item":"diamond","count":100,"reason":"服务器故障补偿"}'
  ```

### 19.2 封禁玩家

- **功能描述**：服主对绑定玩家执行封禁（RCON ban）
- **请求方法**：POST
- **URL 路径**：`/api/store/players/:userId/ban`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 目标用户 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | reason | string | 否 | 封禁原因 |
- **响应数据**：同 19.1
- **错误响应**：`PANEL_VALIDATION_ERROR` (400)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/store/players/usr-xxx/ban" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"instance_id":"srv-xxx","reason":"使用外挂"}'
  ```

### 19.3 调整 VIP 时长

- **功能描述**：调整绑定玩家的 VIP 到期时间（正数延长，负数缩短；永久 VIP 不可缩短）
- **请求方法**：POST
- **URL 路径**：`/api/store/players/:userId/adjust-playtime`
- **鉴权要求**：JWT + `requireRole(INSTANCE_ADMIN, SERVER_ADMIN)` + 实例级权限校验
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | userId | string | 是 | 目标用户 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | delta_seconds | number | 是 | VIP 时长增量（秒）；正数延长，负数缩短；单次不超过 365 天 |
    | reason | string | 否 | 调整原因 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | success | boolean | 是否成功 |
    | previous_expires_at | string\|null | 调整前到期时间 |
    | current_expires_at | string\|null | 调整后到期时间 |
    | delta_seconds | number | 实际增量 |
  - 错误响应：`PANEL_VALIDATION_ERROR` (400，含永久 VIP 不可缩短)、`PANEL_UNAUTHORIZED` (401)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/store/players/usr-xxx/adjust-playtime" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"instance_id":"srv-xxx","delta_seconds":2592000,"reason":"活动奖励"}'
  ```

---

## 二十、Daemon 玩家会话上报（Daemon Player Sessions Report）

源码：`daemon-report.ts`，挂载前缀 `/api`（不套 `authenticateToken`，使用 `x-report-key` 密钥鉴权）

> 数据流：daemon `PlayerSessionReporter` → POST `/api/daemon/player-sessions/{join,leave}` → `player_sessions` 表

### 20.1 玩家加入实例上报

- **功能描述**：Daemon 上报玩家加入实例事件；未绑定 Panel 账号的玩家跳过记录
- **请求方法**：POST
- **URL 路径**：`/api/daemon/player-sessions/join`
- **鉴权要求**：`x-report-key` 头校验（环境变量 `DAEMON_REPORT_KEY`）
- **请求参数**：
  - 请求头：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | x-report-key | string | 是 | 上报密钥 |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | game_player_name | string | 是 | 游戏玩家名 |
    | join_at | string | 否 | 加入时间（ISO），默认当前时间 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | recorded | boolean | 是否记录 |
    | reason | string | 跳过原因（如 `no_binding`） |
    | session_id | string\|null | 会话 ID |
  - 错误响应：`PANEL_FORBIDDEN` (403，未配置密钥)、`PANEL_UNAUTHORIZED` (401，密钥无效)、`PANEL_VALIDATION_ERROR` (400)、`PANEL_SERVICE_UNAVAILABLE` (503，表不存在)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/daemon/player-sessions/join" \
    -H "x-report-key: <DAEMON_REPORT_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"instance_id":"srv-xxx","game_player_name":"Steve"}'
  ```

### 20.2 玩家离开实例上报

- **功能描述**：Daemon 上报玩家离开实例事件；更新最近的未关闭会话并计算 duration
- **请求方法**：POST
- **URL 路径**：`/api/daemon/player-sessions/leave`
- **鉴权要求**：`x-report-key` 头校验
- **请求参数**：
  - 请求头：同 20.1
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | instance_id | string | 是 | 实例 ID |
    | game_player_name | string | 是 | 游戏玩家名 |
    | leave_at | string | 否 | 离开时间（ISO），默认当前时间 |
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | recorded | boolean | 是否记录 |
    | reason | string | 跳过原因（如 `no_open_session`） |
    | session_id | string\|undefined | 会话 ID |
    | duration_seconds | number\|undefined | 会话时长（秒） |
  - 错误响应：`PANEL_FORBIDDEN` (403)、`PANEL_UNAUTHORIZED` (401)、`PANEL_VALIDATION_ERROR` (400)、`PANEL_SERVICE_UNAVAILABLE` (503)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X POST "https://gsp.ecsrz.com:3001/api/daemon/player-sessions/leave" \
    -H "x-report-key: <DAEMON_REPORT_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"instance_id":"srv-xxx","game_player_name":"Steve"}'
  ```

---

## 二十一、服务器发现（Server Discover）

源码：`discover.ts`，公开路由挂载前缀 `/api/discover`（无需鉴权）；管理路由挂载前缀 `/api/admin/servers`（套 `authenticateToken` + `requireAdmin`）

### 21.1 热门服务器

- **功能描述**：获取热门公开服务器列表（`is_public=1`，固定 10 条）
- **请求方法**：GET
- **URL 路径**：`/api/discover/hot`
- **鉴权要求**：无（公开）
- **请求参数**：无
- **响应数据**：
  - 成功响应：HTTP 200

    | 字段名 | 类型 | 说明 |
    |--------|------|------|
    | servers | DiscoverServer[] | 服务器列表（含 id / name / pack_id / status / online_players / is_public / is_recommended / created_at / owner_username） |

    ```json
    {
      "servers": [
        {
          "id": "srv-xxx",
          "name": "示例服务器",
          "pack_id": "minecraft",
          "status": "running",
          "online_players": 0,
          "is_public": true,
          "is_recommended": true,
          "created_at": "2026-07-01T00:00:00Z",
          "owner_username": "owner"
        }
      ]
    }
    ```
  - 错误响应：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/discover/hot"
  ```

### 21.2 新开服

- **功能描述**：获取最新公开服务器列表（`is_public=1`，按 `created_at DESC`）
- **请求方法**：GET
- **URL 路径**：`/api/discover/new`
- **鉴权要求**：无（公开）
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | number | 否 | 返回数量，默认 10，范围 1-50 |
- **响应数据**：同 21.1
- **错误响应**：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/discover/new?limit=20"
  ```

### 21.3 推荐服

- **功能描述**：获取推荐服务器列表（`is_recommended=1`，按 `recommended_at DESC`）
- **请求方法**：GET
- **URL 路径**：`/api/discover/recommended`
- **鉴权要求**：无（公开）
- **请求参数**：
  - 查询参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | limit | number | 否 | 返回数量，默认 10，范围 1-50 |
- **响应数据**：同 21.1
- **错误响应**：`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X GET "https://gsp.ecsrz.com:3001/api/discover/recommended?limit=10"
  ```

### 21.4 设置服务器公开/私有

- **功能描述**：管理员设置服务器的公开/私有状态
- **请求方法**：PUT
- **URL 路径**：`/api/admin/servers/:serverId/visibility`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | is_public | boolean | 是 | 是否公开 |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "server_id": "srv-xxx", "is_public": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/admin/servers/srv-xxx/visibility" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"is_public":true}'
  ```

### 21.5 设置/取消推荐

- **功能描述**：管理员设置或取消服务器推荐状态
- **请求方法**：PUT
- **URL 路径**：`/api/admin/servers/:serverId/recommend`
- **鉴权要求**：JWT + `requireAdmin`
- **请求参数**：
  - 路径参数：

    | 名称 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | serverId | string | 是 | 实例 ID |
  - 请求体：

    | 字段 | 类型 | 必填 | 说明 |
    |------|------|------|------|
    | is_recommended | boolean | 是 | 是否推荐 |
- **响应数据**：
  - 成功响应：HTTP 200

    ```json
    { "server_id": "srv-xxx", "is_recommended": true }
    ```
  - 错误响应：`PANEL_VALIDATION_ERROR` (400)、`PANEL_FORBIDDEN` (403)、`SERVER_NOT_FOUND` (404)、`PANEL_INTERNAL_ERROR` (500)
- **调用示例**：

  ```bash
  curl -X PUT "https://gsp.ecsrz.com:3001/api/admin/servers/srv-xxx/recommend" \
    -H "Authorization: Bearer <JWT_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '{"is_recommended":true}'
  ```

---

## 附录：错误码索引

| 错误码 | HTTP | 来源模块 | 说明 |
|--------|------|---------|------|
| `PANEL_VALIDATION_ERROR` | 400 | 通用 | 参数校验失败 |
| `PANEL_UNAUTHORIZED` | 401 | 通用 | 未认证 |
| `PANEL_FORBIDDEN` | 403 | 通用 | 无权限 |
| `PANEL_INTERNAL_ERROR` | 500 | 通用 | 内部错误 |
| `PANEL_SERVICE_UNAVAILABLE` | 503 | daemon-report | 服务不可用 |
| `SHOP_ITEM_NOT_FOUND` | 404 | shop | 商品不存在 |
| `SHOP_ORDER_NOT_FOUND` | 404 | shop | 订单不存在 |
| `SHOP_ORDER_ALREADY_CLAIMED` | 409 | shop | 订单已领取 |
| `SHOP_ORDER_EXPIRED` | 410 | shop | 订单已过期 |
| `COMMAND_RENDER_FAILED` | 400 | shop/cdk | 命令渲染失败 |
| `COMMAND_QUEUE_FULL` | 503 | shop/cdk | 命令队列已满 |
| `VIP_LEVEL_INSUFFICIENT` | 403 | shop | VIP 等级不足 |
| `BINDING_REQUIRED` | 403 | shop | 需要先绑定 |
| `INSUFFICIENT_BALANCE` | 400 | shop | 余额不足 |
| `DAILY_REWARD_ALREADY_CLAIMED` | 409 | shop/wallet | 今日已领取 |
| `CDK_NOT_FOUND` | 404 | cdk | CDK 不存在 |
| `CDK_ALREADY_CLAIMED` | 409 | cdk | CDK 已兑换 |
| `CDK_EXPIRED` | 410 | cdk | CDK 已过期 |
| `PACK_NOT_FOUND` | 404 | cdk | 游戏包不存在 |
| `VIP_PERMISSION_NOT_FOUND` | 404 | vipPermissions | VIP 权限不存在 |
| `PLAYER_BINDING_NOT_FOUND` | 404 | playerBindings | 玩家绑定不存在 |
| `PLAYER_BINDING_ALREADY_EXISTS` | 409 | playerBindings | 绑定已存在 |
| `PLAYER_BINDING_VERIFY_CODE_INVALID` | 400 | playerBindings | 验证码无效 |
| `PLAYER_BINDING_NOT_PENDING` | 400 | playerBindings | 绑定非待审状态 |
| `SERVER_NOT_FOUND` | 404 | 通用 | 实例不存在 |
| `USER_NOT_FOUND` | 404 | playerProfile | 用户不存在 |
| `FRIEND_REQUEST_SELF` | 400 | friends | 不能加自己为好友 |
| `FRIEND_USER_NOT_FOUND` | 404 | friends | 目标用户不存在 |
| `FRIEND_REQUEST_ALREADY_EXISTS` | 409 | friends | 请求已存在或已是好友 |
| `FRIEND_NOT_FOUND` | 404 | friends | 好友关系不存在 |
| `BINDING_ALREADY_EXISTS` | 409 | bindings | 实例绑定已存在 |
| `BINDING_NOT_FOUND` | 404 | bindings | 实例绑定不存在 |
| `ERR_INVALID_BANNER_URL` | 400 | store_shop_config | banner URL 无效 |
| `ERR_INVALID_BANNER_LINK` | 400 | store_shop_config | banner 链接无效 |
| `ERR_INVALID_SHOP_DESCRIPTION` | 400 | store_shop_config | 店铺描述无效 |
| `ERR_INVALID_THEME_COLOR` | 400 | store_shop_config | 主题色无效 |

---

## 附录：路由源码索引

| 章节 | 源码文件 | 挂载前缀 |
|------|---------|---------|
| 二、商店商品管理 | `panel/backend/src/api/routes/shop.ts` | `/api/servers` |
| 三、商店订单 | `panel/backend/src/api/routes/shop.ts` | `/api/servers` |
| 四、CDK 兑换码管理 | `panel/backend/src/api/routes/cdk.ts` | `/api/servers` |
| 五、CDK 全局兑换 | `panel/backend/src/api/routes/cdk.ts` | `/api/cdk` |
| 六、钱包 | `panel/backend/src/api/routes/wallet.ts` | `/api/servers` |
| 七、VIP 权限配置 | `panel/backend/src/api/routes/vipPermissions.ts` | `/api/vip-permissions` |
| 八、玩家加入设置 | `panel/backend/src/api/routes/player.ts` | `/api/servers` |
| 九、玩家历史与礼包 | `panel/backend/src/api/routes/player.ts` | `/api/servers` |
| 十、玩家管理操作 | `panel/backend/src/api/routes/player.ts` | `/api/servers` |
| 十一、玩家游戏账号绑定 | `panel/backend/src/api/routes/playerBindings.ts` | `/api/player-bindings` |
| 十二、服主实例玩家绑定管理 | `panel/backend/src/api/routes/playerBindings.ts` | `/api/servers` |
| 十三、实例绑定与 VIP | `panel/backend/src/api/routes/bindings.ts` | `/api` |
| 十四、验证码 | `panel/backend/src/api/routes/verifyCodes.ts` | `/api/verify-codes` |
| 十五、玩家档案 | `panel/backend/src/api/routes/playerProfile.ts` | `/api/players` |
| 十六、好友系统 | `panel/backend/src/api/routes/friends.ts` | `/api/friends` |
| 十七、店铺外观配置 | `panel/backend/src/api/routes/store_shop_config.ts` | `/api` |
| 十八、GM 工作台数据 | `panel/backend/src/api/routes/store-gm.ts` | `/api` |
| 十九、GM 玩家操作 | `panel/backend/src/api/routes/store-player-actions.ts` | `/api` |
| 二十、Daemon 玩家会话上报 | `panel/backend/src/api/routes/daemon-report.ts` | `/api` |
| 二十一、服务器发现 | `panel/backend/src/api/routes/discover.ts` | `/api/discover` + `/api/admin/servers` |

---

**文档统计**：共 72 个 API 接口，覆盖 20 个业务功能章节，源自 15 个路由文件。
