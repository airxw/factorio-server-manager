---
type: api-index
title: gsp 项目 API 文档库总索引
date: 2026-07-25
status: active
related:
  - panel/backend/src/routes-registry.ts
  - panel/backend/src/app.ts
  - daemon/src/server.ts
  - public/schema/panel-api-types.ts
  - public/schema/daemon-api-types.ts
  - public/schema/ws-events.ts
tags: [api, index, panel, daemon, overview]
---

# gsp 项目 API 文档库总索引

> 本文档库系统梳理 gsp 游戏服务器面板项目（Panel 控制端 + Daemon 守护端）的全部对外接口，作为 demo 阶段结束后的开发前期准备，为后续功能开发提供标准化接口参考依据。

## 一、项目架构概览

gsp 项目采用 **Panel + Daemon 双进程集群架构**：

| 进程 | 角色 | 监听端口 | 对外暴露 | 说明 |
|------|------|----------|----------|------|
| **Panel 控制端** | Web 后端 + 静态资源服务 | `127.0.0.1:3002` | 通过 nginx 反代 | Express + Knex + SQLite，承载所有业务逻辑、鉴权、前端资源 |
| **Daemon 守护端** | 游戏实例托管进程 | `0.0.0.0:8080`（或 slave 模式） | **仅内网可达**（公网禁用） | Express + ws，承载游戏实例启停、文件操作、命令执行、状态推送 |
| **nginx** | 反向代理 + TLS 终结 | `0.0.0.0:3000`（HTTP）/ `0.0.0.0:3001`（HTTPS） | 公网入口 | 3000 → 301 跳转 3001；3001 → 反代 3002；`/ws` 透传 Upgrade/Connection |

### 浏览器端唯一合法入口

| 入口类型 | 地址 |
|----------|------|
| 公网 HTTPS 入口（推荐） | `https://gsp.ecsrz.com:3001` |
| 公网 HTTP 跳转入口 | `http://gsp.ecsrz.com:3000`（自动 301 跳转到 HTTPS） |
| 局域网 HTTPS 入口 | `https://192.168.5.14:3001` |
| 局域网 HTTP 跳转入口 | `http://192.168.5.14:3000`（自动 301 跳转到 HTTPS） |

> 严禁使用 `localhost:3000` / `127.0.0.1:3000` 作为浏览器端地址，详见 `.trae/rules/0.md`。

### 服务端本机/内网调用

| 调用方 | 被调方 | 地址 | 用途 |
|--------|--------|------|------|
| nginx | Panel 后端 | `http://127.0.0.1:3002` | 反向代理 |
| Panel 后端 | Daemon | `http://127.0.0.1:8080` 或 `http://192.168.5.14:8080` | 实例控制、文件操作、命令执行 |
| Panel 后端 | Panel 后端 | `http://localhost:3002/api/health` | 本机健康检查（仅本机） |
| Daemon | Panel 后端 | `https://gsp.ecsrz.com:3001/api/daemon/...` | 反向上报玩家会话（携带 `x-report-key`） |

## 二、API 文档分册导航

文档库按业务域划分为 6 个分册，合计覆盖 **312 个接口/事件**（Panel 后端 285 个 REST 接口 + Daemon 20 个 HTTP 接口 + 7 个 WS 命令/事件）。

| 编号 | 分册 | 接口数 | 业务覆盖 | 路径 |
|------|------|--------|----------|------|
| 01 | [认证与用户域 API](./01-auth-user.md) | 46 | 认证、用户管理、个人信息、通知、审计、设置、系统配置、密码重置、邮箱验证、API Key、告警设置 | `docs/api/01-auth-user.md` |
| 02 | [服务器与实例域 API](./02-server-instance.md) | 55 | 节点、Pack、版本池、实例 CRUD、实例启停与控制台、实例共管、实例角色、资产、批量操作 | `docs/api/02-server-instance.md` |
| 03 | [商店与玩家域 API](./03-shop-player.md) | 72 | 商店、CDK、钱包、VIP、玩家管理、玩家绑定、绑定关系、验证码、玩家档案、好友、店铺配置、GM 工作台、Daemon 上报、发现页 | `docs/api/03-shop-player.md` |
| 04 | [游戏运维域 API](./04-game-ops.md) | 58 | 聊天触发、投票、Mod、存档、备份、监控、白黑名单、周期消息、聊天日志、Webhook、运营仪表盘、配额、平台统计 | `docs/api/04-game-ops.md` |
| 05 | [系统运维域 API](./05-system-ops.md) | 54 | 文件管理、代理、配置文件、世界生成、游戏更新、磁盘清理、演示模式、维护模式、SSL 证书、FRP 隧道、系统监控、系统诊断、系统自更新、修改密码 | `docs/api/05-system-ops.md` |
| 06 | [Daemon 守护端 API](./06-daemon.md) | 27 | HTTP 接口（实例启停、文件、命令、Mod、Java 扫描）+ WebSocket 协议（订阅、事件推送） | `docs/api/06-daemon.md` |
| **合计** | — | **312** | — | — |

## 三、统一约定

### 3.1 通用响应结构

#### 成功响应

直接返回 JSON 数据，HTTP 状态码 200（查询/更新）/ 201（创建）/ 204（删除，无响应体）。

```json
{
  "field1": "value1",
  "field2": ["a", "b"]
}
```

#### 失败响应

所有失败响应统一为如下结构：

```json
{
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<人类可读的中文消息>",
    "details": { "...": "..." }
  }
}
```

> Daemon 端的 401/403 鉴权失败响应为例外，使用 `{ "error": "missing_authorization" }` / `{ "error": "invalid_token" }` 简化形式（详见 [06-daemon.md §错误码附录](./06-daemon.md)）。

### 3.2 通用错误码

| HTTP 状态 | 错误码 | 含义 |
|-----------|--------|------|
| 400 | `PANEL_VALIDATION_ERROR` | 参数校验失败（路径穿越、命令注入等） |
| 400 | `WEAK_PASSWORD` | 密码强度不足 |
| 401 | `PANEL_UNAUTHORIZED` | 未认证 / JWT 无效或已过期 / API Key 无效 |
| 403 | `PANEL_FORBIDDEN` | 权限不足 |
| 403 | `PANEL_REGISTRATION_DISABLED` | 管理员已关闭注册 |
| 403 | `EMAIL_NOT_VERIFIED` | 邮箱未验证 |
| 404 | `PANEL_NOT_FOUND` | 路径不存在 |
| 409 | `USER_ALREADY_EXISTS` | 邮箱已被注册 |
| 429 | `PANEL_RATE_LIMITED` | 触发速率限制 |
| 500 | `PANEL_INTERNAL_ERROR` | 服务器内部错误 |
| 503 | `PANEL_MAINTENANCE` | 维护模式（非管理员请求被拒绝） |

> 各业务域专属错误码（如 `SHOP_ITEM_NOT_FOUND`、`INSTANCE_NOT_FOUND` 等）详见各分册附录。

### 3.3 鉴权体系

#### Panel 后端鉴权（双路径）

| 路径 | Header | 凭证形式 | 适用场景 |
|------|--------|----------|----------|
| JWT | `Authorization: Bearer <token>` | `ey...` JWT 字符串 | 浏览器登录用户 |
| API Key | `x-api-key: gsp_<32hex>` | `gsp_` + 32 位十六进制 | 自动化脚本、外部系统集成 |

- 优先级：`x-api-key` > `Authorization`
- JWT 支持改密失效（`token_version` 校验）
- API Key 角色在创建时冻结，与 user.role 解耦
- 失败统一返回 401 `PANEL_UNAUTHORIZED`

#### 角色体系（3 级）

| 角色 | 中文 | 权限范围 |
|------|------|----------|
| `server_admin` | 服务器管理员 | 全平台所有实例与所有功能 |
| `instance_admin` | 实例管理员 | 自己拥有/被共管的实例的管理权限 |
| `user` | 普通用户 | 玩家门户功能、自己绑定的实例的访问权限 |

#### 实例级鉴权中间件

| 中间件 | 通过条件 |
|--------|----------|
| `requireAdmin` | `server_admin` 全通过 |
| `requireRole(...)` | 指定角色之一通过 |
| `requireInstanceAccess(serverIdParam)` | `server_admin` / 实例有未过期角色 / `instance_admin` + owner / 共管记录 / active 绑定记录 |
| `requireInstanceAdmin(serverIdParam)` | `server_admin` / 实例有未过期 `instance_admin` 角色 / `instance_admin` + owner / 共管记录 |

#### Daemon 鉴权

| 协议 | 凭证 | 失败行为 |
|------|------|----------|
| HTTP | `Authorization: Bearer <DAEMON_TOKEN>` | 401 missing_authorization / 403 invalid_token |
| WebSocket | `ws://host:8080/ws?token=<DAEMON_TOKEN>` | 关闭码 4001 |

### 3.4 全局中间件链

Panel 后端中间件链（按挂载顺序）：

```
cors → express.json → helmet（CSP/HSTS 关闭）→ 请求日志
  → 全局速率限制（/api，每 IP 每秒 50 次）
  → 维护模式（/api，白名单放行 login/register 等）
  → 审计中间件（/api，记录 mutating 请求到 audit_logs）
  → 路由级鉴权（authenticateToken + requireAdmin/requireRole/requireInstanceAccess）
  → 路由处理器
  → /api 404 回退（PANEL_NOT_FOUND）
  → 全局错误处理（PANEL_INTERNAL_ERROR）
```

### 3.5 WebSocket 通道

项目有两条 WS 通道：

| 通道 | 路径 | 鉴权 | 用途 |
|------|------|------|------|
| Panel → Frontend | `wss://gsp.ecsrz.com:3001/ws?token=<JWT>` | JWT query token | 前端订阅实例状态、控制台输出、监控指标等 |
| Panel → Daemon | `ws://127.0.0.1:8080/ws?token=<DAEMON_TOKEN>` | DAEMON_TOKEN query token | Panel 订阅 Daemon 推送的实例事件 |

WS 事件类型契约见 `public/schema/ws-events.ts`。

## 四、接口分类索引

### 按业务域快速查找

#### 认证与账户
- 登录：`POST /api/auth/login` → [01 §一](./01-auth-user.md)
- 注册：`POST /api/auth/register` → [01 §一](./01-auth-user.md)
- 当前用户：`GET /api/auth/me` → [01 §一](./01-auth-user.md)
- 修改密码：`POST /api/auth/change-password` → [05 §十六](./05-system-ops.md)
- 密码重置：`POST /api/auth/password-reset/request` / `POST /api/auth/password-reset/confirm` → [01 §八](./01-auth-user.md)
- 邮箱验证：`GET /api/auth/email-verify/status` / `POST /api/auth/email-verify/request` / `POST /api/auth/email-verify/confirm` → [01 §九](./01-auth-user.md)

#### 用户与权限
- 用户管理：`/api/users` → [01 §二](./01-auth-user.md)
- 个人信息：`/api/me` → [01 §三](./01-auth-user.md)
- 玩家门户聚合：`/api/my` → [01 §三](./01-auth-user.md)
- API Key：`/api/api-keys` → [01 §十](./01-auth-user.md)
- VIP 权限：`/api/vip-permissions` → [03 §六](./03-shop-player.md)

#### 实例与节点
- 节点管理：`/api/nodes` → [02 §一](./02-server-instance.md)
- Pack 管理：`/api/packs` → [02 §二](./02-server-instance.md)
- 版本池：`/api/packs/.../versions` → [02 §三](./02-server-instance.md)
- 实例 CRUD：`/api/servers` → [02 §四](./02-server-instance.md)
- 实例启停与控制台：`/api/servers/:id/{start,stop,restart,console,...}` → [02 §五](./02-server-instance.md)
- 实例共管：`/api/servers/:id/admins` → [02 §六](./02-server-instance.md)
- 实例角色：`/api/servers/:id/roles` → [02 §七](./02-server-instance.md)
- 批量操作：`/api/batch` → [02 §九](./02-server-instance.md)

#### 商店与经济
- 实例商店：`/api/servers/:id/shop/{items,orders}` → [03 §一、二](./03-shop-player.md)
- 全局 CDK：`/api/cdk` → [03 §四](./03-shop-player.md)
- 实例 CDK：`/api/servers/:id/cdk` → [03 §三](./03-shop-player.md)
- 钱包：`/api/servers/:id/wallet` → [03 §五](./03-shop-player.md)
- 店铺外观配置：`/api/store/servers/:id/shop-config` → [03 §十六](./03-shop-player.md)

#### 玩家与社交
- 玩家管理：`/api/servers/:id/players` → [03 §七、八、九](./03-shop-player.md)
- 玩家游戏绑定：`/api/player-bindings` → [03 §十](./03-shop-player.md)
- 实例绑定：`/api/bindings` → [03 §十二](./03-shop-player.md)
- 验证码：`/api/verify-codes` → [03 §十三](./03-shop-player.md)
- 玩家档案（公开）：`/api/players` → [03 §十四](./03-shop-player.md)
- 好友：`/api/friends` → [03 §十五](./03-shop-player.md)
- 服务器发现（公开）：`/api/discover` → [03 §二十一](./03-shop-player.md)

#### GM 工作台
- GM 数据：`/api/store/gm/...` → [03 §十七](./03-shop-player.md)
- GM 玩家操作：`/api/store/gm/players/.../actions` → [03 §十八](./03-shop-player.md)

#### 游戏运维
- 聊天触发响应：`/api/servers/:id/chat-triggers` → [04 §一](./04-game-ops.md)
- 投票：`/api/servers/:id/votes` → [04 §二](./04-game-ops.md)
- Mod 管理：`/api/servers/:id/mods` → [04 §三](./04-game-ops.md)
- 存档：`/api/servers/:id/saves` → [04 §四](./04-game-ops.md)
- 备份：`/api/servers/:id/backups` → [04 §五](./04-game-ops.md)
- 监控快照：`/api/servers/:id/monitoring/snapshots` → [04 §六](./04-game-ops.md)
- 白黑名单：`/api/servers/:id/lists` → [04 §七](./04-game-ops.md)
- 周期消息：`/api/servers/:id/periodic-messages` → [04 §八](./04-game-ops.md)
- 聊天日志：`/api/servers/:id/chat-logs` → [04 §九](./04-game-ops.md)
- Webhook：`/api/servers/:id/webhooks` → [04 §十](./04-game-ops.md)

#### 运营管理
- 运营仪表盘：`/api/operations` → [04 §十一](./04-game-ops.md)
- 资源配额：`/api/quotas` → [04 §十二](./04-game-ops.md)
- 平台统计：`/api/platform/stats` → [04 §十三](./04-game-ops.md)
- 通知：`/api/notifications` → [01 §四](./01-auth-user.md)
- 审计日志：`/api/audit-logs` → [01 §五](./01-auth-user.md)
- 设置：`/api/settings` → [01 §六](./01-auth-user.md)
- 系统配置：`/api/system-config` → [01 §七](./01-auth-user.md)
- 告警设置：`/api/alert-settings` → [01 §十一](./01-auth-user.md)

#### 系统运维
- 文件管理：`/api/servers/:id/files` → [05 §二](./05-system-ops.md)
- 第三方代理：`/api/proxy` → [05 §三](./05-system-ops.md)
- 配置文件：`/api/servers/:id/config-files` → [05 §四](./05-system-ops.md)
- 世界生成：`/api/servers/:id/world-gen` → [05 §五](./05-system-ops.md)
- 游戏更新：`/api/servers/:id/updates` → [05 §六](./05-system-ops.md)
- 实例清理：`/api/admin/cleanup` → [05 §七](./05-system-ops.md)
- 演示模式：`/api/demo` → [05 §八](./05-system-ops.md)
- 维护模式：`/api/admin/maintenance` → [05 §九](./05-system-ops.md)
- SSL 证书：`/api/system/ssl` → [05 §十](./05-system-ops.md)
- FRP 隧道：`/api/system/tunnel` → [05 §十一](./05-system-ops.md)
- 系统监控历史：`/api/system-monitor/history` → [05 §十二](./05-system-ops.md)
- 系统监控指标：`/api/system/metrics` → [05 §十三](./05-system-ops.md)
- 系统诊断：`/api/system/diagnostics` → [05 §十四](./05-system-ops.md)
- 系统自更新：`/api/system-update` → [05 §十五](./05-system-ops.md)

#### Daemon 上报
- 玩家会话上报：`POST /api/daemon/player-sessions/{join,leave}` → [03 §十九](./03-shop-player.md)

#### Daemon 端（仅 Panel 内网调用）
- 健康检查：`GET /health` → [06 §二](./06-daemon.md)
- 实例管理：`/api/instances/:id/{state,logs,players,start,stop,restart-with-save,command,execute-logic,exec}` → [06 §二](./06-daemon.md)
- 文件操作：`/api/instances/:id/files` → [06 §二](./06-daemon.md)
- Mod 扫描：`/api/instances/:id/mods/{scan,files/:name/toggle}` → [06 §二](./06-daemon.md)
- Java 扫描：`/api/env/javas` → [06 §二](./06-daemon.md)
- WebSocket：`ws://host:8080/ws?token=<DAEMON_TOKEN>` → [06 §三](./06-daemon.md)

## 五、公共契约入口

API 类型契约定义在 `public/schema/` 下，所有接口的字段类型必须与契约对齐：

| 契约文件 | 用途 |
|----------|------|
| `public/schema/panel-api-types.ts` | Panel 后端 API 请求/响应类型 |
| `public/schema/daemon-api-types.ts` | Daemon 端 API 请求/响应类型 |
| `public/schema/ws-events.ts` | WebSocket 事件类型 |
| `public/schema/pack-schema.ts` | Game Pack 定义 |
| `public/interface_stub/shared-types.d.ts` | 共享类型与错误码声明 |
| `public/schema/error-codes-schema.json` | 错误码元数据 |

## 六、文档维护规则

1. **版本对齐**：API 变更必须同步更新对应分册 + 总索引；契约变更必须同步 `public/schema/` 与 `public/interface_stub/`。
2. **错误码新增**：在 `error-codes-schema.json` + `services/errors.ts` + 对应分册附录同步登记。
3. **接口废弃**：在分册顶部"接口废弃说明"段落标记，30 天后从文档库移除。
4. **新增分册**：业务域扩展时新增编号分册（如 `07-xxx.md`），同步更新本索引。
5. **域名规则**：所有调用示例统一使用 `https://gsp.ecsrz.com:3001`（Panel 公网入口）或 `http://127.0.0.1:8080`（Daemon 内网入口），严禁 `localhost:3000` / `127.0.0.1:3000`。

## 七、统计概览

| 维度 | 数量 |
|------|------|
| 分册总数 | 6 |
| Panel REST 接口 | 285 |
| Daemon HTTP 接口 | 20 |
| WebSocket 命令 | 2 |
| WebSocket 事件 | 5 |
| 公共契约文件 | 6 |
| 错误码（含业务专属） | 90+ |
| **接口/事件合计** | **312** |
