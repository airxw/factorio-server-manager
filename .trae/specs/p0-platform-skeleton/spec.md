# P0 Spec — GameServer Panel 3.0.0 内核骨架

> 锚点文档：遵循 rules-5 三段交接结构
> 关联方案：[platform-extension-feasibility.md](../plan-platform-extension/platform-extension-feasibility.md)
> 关联 PoC：[poc-verification-report.md](../plan-platform-extension/poc-verification-report.md)
> 阶段：S2 契约冻结
> 状态：待 GN-004 审查 + 人类裁决

---

## 一、工程过程

- v2.0 方案于 2026-07-02 完成，4/5 关键决策已裁决（13.4 商业模式暂缓）
- 技术 PoC 于 2026-07-02 完成，3 个验证点全部通过（详见 PoC 报告）
- PoC 发现 4 项设计修正已纳入本 spec：
  1. Pack schema 协议层用 `zod.discriminatedUnion` 区分 stdin/rcon
  2. RCON 库选定 `rcon-client@^4.2.4`（非 rcon-node）
  3. Panel↔Daemon 通信：REST+Bearer Token / WS+query token
  4. Factorio stdin 单向通信需在 CommandProtocol 接口独立建模

---

## 二、交接状态

- **当前状态**：✅ 已完成（三件套编写 + 降级独立审查 + 6 项问题修正 + 4 项 [V] 人类裁决）
- **未闭合项**：无
- **阻塞项**：无
- **下一步**：S3 模块拆分 → S4 并行开发

---

## 三、最终结果（P0 范围定义）

### 3.1 P0 目标

**一句话**：Panel + Daemon 双层架构跑通，用户可在 Panel 创建一个 Minecraft Vanilla 实例，通过 Daemon 启动进程、发送 RCON 命令、查看实时日志、停止实例。

**成功判据**：端到端测试 `create → start → command "list" → stop` 全流程通过，无需人工干预。

### 3.2 P0 范围（IN）

| 模块 | 范围 | 产出 |
|------|------|------|
| Panel 项目骨架 | Express + Knex + JWT 认证 | 可运行的 Panel 后端 |
| Daemon 项目骨架 | Express + ws + Token 鉴权 | 可运行的 Daemon |
| Pack Registry | YAML 加载 + zod 校验 | `packs/minecraft-vanilla/pack.yaml` 可加载 |
| Minecraft Vanilla Pack | 完整 Pack 定义 | 启动/命令/配置/备份全套 |
| ProcessDriver | spawn java server.jar | 进程生命周期管理 |
| RconClient | 基于 rcon-client | 命令执行 + 响应接收 |
| Server CRUD | 创建/查询/删除实例 | REST API + 数据库表 |
| 生命周期状态机 | stopped→starting→running→stopping | 状态流转闭环 |
| 就绪检测 | 按 Pack ready_pattern 正则匹配日志 | 启动完成自动转 running |
| Panel↔Daemon 通信 | REST + WebSocket 双通道 | 接口契约 + Mock |
| 前端骨架 | React + 路由 + 服务器列表/创建/详情 | 端到端可用 UI |
| Console Tab | RCON 命令输入 + 响应回显 | 实时控制台（不含 Config Tab，Config Tab 推迟 P1） |

### 3.3 P0 范围外（OUT）

| 排除项 | 延后阶段 | 理由 |
|--------|---------|------|
| Docker 驱动 | P2.8 | P0 用进程模式，PoC 已验证通信架构 |
| Factorio Pack | P2.1 | PoC 已验证 stdin 协议层，完整 Pack 推迟 |
| Rust/ARK Pack | P2.3/P2.4 | 多游戏 Pack 是 P2 目标 |
| 商业化层（商店/订单/履约） | P1 | P0 只做运维骨架 |
| 多节点管理 | P4 | P0 单机模式，Panel+Daemon 同机 |
| 用户注册/找回密码 | P0 之外 | P0 用预设 admin 账号，注册流程后续补 |
| 团队协作/多租户 ACL | P4 | P0 单用户 owner 模式 |
| 配置文件动态表单 UI | P1/P2 | P0 仅在 Pack 中定义 config schema 字段，不实现配置编辑 UI；前端 Config Tab 推迟到 P1 |
| 文件管理（SFTP/HTTP） | P1 | P0 通过 Panel API 上传 server.jar |

### 3.4 模块边界与依赖

```
┌─────────────────────────────────────────────────────────────┐
│                    Panel Frontend (React)                    │
│   ServerList / CreateServer / ServerDetail(Console)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                    Panel Backend (Express)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ auth/    │ │ servers/ │ │ packs/   │ │ daemonClient/  │ │
│  │ jwt+roles│ │ CRUD     │ │ registry │ │ HTTP+WS client │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              db/ (Knex + SQLite)                       │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + Bearer Token
                           │ WebSocket (events)
┌──────────────────────────▼──────────────────────────────────┐
│                    Daemon (Express + ws)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ auth/    │ │instances/│ │protocol/ │ │ events/        │ │
│  │ token    │ │ manager  │ │ rconClient│ │ upstream (WS) │ │
│  │          │ │ process  │ │ stdinClient│ │                │ │
│  │          │ │ driver   │ │ factory   │ │                │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn + stdin/RCON
                           ▼
                    ┌──────────────┐
                    │ Minecraft    │
                    │ server.jar   │
                    └──────────────┘
```

### 3.5 关键技术决策（PoC 已验证）

| 决策点 | 选型 | PoC 证据 |
|--------|------|---------|
| Pack schema 协议层 | `zod.discriminatedUnion('type', [stdin, rcon|webrcon])` | PoC 1 通过 |
| RCON 库 | `rcon-client@^4.2.4` | PoC 2 通过，8 命令全成功 |
| Panel→Daemon REST | `fetch` + `Authorization: Bearer <token>` | PoC 3 22/22 |
| Daemon→Panel 事件 | `ws://host/ws?token=<token>` | PoC 3 22/22 |
| 鉴权失败码 | REST 401/403，WS close 4001 | PoC 3 验证 |
| 进程模式 | `child_process.spawn`，无 Docker | P0 决策 13.2 |

### 3.6 数据模型（P0 最小集）

```sql
-- 用户（P0 预设 admin，无注册流程）
users (id, email, username, password_hash, role, status, created_at)

-- Daemon 节点（P0 单节点，Panel+Daemon 同机）
nodes (id, name, fqdn, daemon_token_hash, public_ip, status, last_seen_at)

-- 服务器（实例）
servers (
  id, name, pack_id, game_type, node_id, owner_user_id,
  status,                -- stopped/starting/running/stopping/error
  port, rcon_port, rcon_password_enc,
  resource_limits_json,
  created_at, updated_at
)

-- Pack 元信息（运行时从 YAML 加载，元信息入库）
packs (id, game, variant, display_name, version, enabled, loaded_at)
```

### 3.7 接口契约

#### 3.7.1 Panel ↔ Daemon（Bearer Token 鉴权）

**REST API**：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查（无需 token） |
| GET | `/api/instances` | 列出所有实例 |
| GET | `/api/instances/:id/state` | 查询实例状态 |
| POST | `/api/instances/:id/start` | 启动实例 |
| POST | `/api/instances/:id/stop` | 停止实例 |
| POST | `/api/instances/:id/command` | 发送命令 |

**WebSocket**（query token 鉴权）：

| 事件类型 | 方向 | 说明 |
|---------|------|------|
| `connected` | Daemon→Panel | 连接建立 |
| `instance.started` | Daemon→Panel | 实例启动完成 |
| `instance.stopped` | Daemon→Panel | 实例停止 |
| `console.output` | Daemon→Panel | 控制台日志行 |
| `state.change` | Daemon→Panel | 状态变更 |
| `subscribe` | Panel→Daemon | 订阅特定实例事件 |

#### 3.7.2 Panel ↔ Frontend（JWT 鉴权）

**REST API**（前端调用 Panel 后端）：

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/api/health` | 无 | Panel 健康检查 |
| POST | `/api/auth/login` | 无 | 登录，返回 JWT |
| GET | `/api/auth/me` | JWT | 当前用户信息 |
| GET | `/api/packs` | JWT | 列出可用 Pack |
| GET | `/api/servers` | JWT | 列出当前用户实例 |
| POST | `/api/servers` | JWT | 创建实例（选 pack_id） |
| GET | `/api/servers/:id` | JWT | 实例详情 |
| DELETE | `/api/servers/:id` | JWT | 删除实例（仅 stopped） |
| POST | `/api/servers/:id/start` | JWT | 启动 → 转发 Daemon |
| POST | `/api/servers/:id/stop` | JWT | 停止 → 转发 Daemon |
| POST | `/api/servers/:id/command` | JWT | 发命令 → 转发 Daemon |

**WebSocket**（Panel→Frontend，JWT query 鉴权）：

| 事件类型 | 方向 | 说明 |
|---------|------|------|
| `console.output` | Panel→Frontend | 转发 Daemon 控制台日志 |
| `instance.state` | Panel→Frontend | 转发实例状态变更 |

> Panel 后端作为事件中继：接收 Daemon WS 事件 → 转发到订阅了对应 server_id 的前端 WS 客户端。

### 3.8 验收标准（P0 闭合判据）

1. **Panel 可启动**：`npm run dev` 启动 Panel 后端 + 前端，无错误
2. **Daemon 可启动**：`npm run daemon` 启动 Daemon，`/health` 返回 200
3. **Pack 可加载**：`packs/minecraft-vanilla/pack.yaml` 通过 zod 校验，注册到 PackRegistry
4. **端到端流程**：
   - 在 Panel 前端创建 Minecraft 实例（选 pack_id=minecraft-vanilla）
   - 点击"启动"，Daemon spawn java 进程
   - 日志通过 WS 实时推送到前端 Console Tab
   - 在 Console 输入 `list`，收到 RCON 响应 `There are X of a max of 20 players online`
   - 点击"停止"，Daemon 发送 `stop` 命令，进程退出，状态变回 stopped
   - **前置条件**：需 Java 17+ 环境 + Minecraft server.jar（由 Panel 提供下载引导，首次启动写入 `eula.txt` 同意 EULA）。若环境无 Java，E2E 测试降级为 mock Minecraft（用 PoC 的 mock-rcon-server 模拟 RCON 响应），但需在测试报告中标注 mock 与真实 server.jar 的差异
5. **鉴权有效**：无 token / 错误 token 的请求被正确拒绝（401/403/4001）
6. **状态机正确**：stopped→starting→running→stopping→stopped 闭环，无死锁状态

### 3.9 非功能性要求

- **日志**：pino 结构化日志，Panel 和 Daemon 各自输出
- **配置**：环境变量 + `.env` 文件，无硬编码
- **错误处理**：Daemon 不可达时 Panel 返回 503，实例异常时状态变 error
- **测试**：核心逻辑（Pack 加载、状态机、RCON 客户端）有单元测试
- **类型安全**：TypeScript strict 模式，无 any
- **数据库**：P0 使用 SQLite（零配置，便于开发调试），生产环境 P4 切 PostgreSQL（Knex 三库支持，迁移成本低）。此为已决策项，非 [V] 节点

---

## 四、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Minecraft server.jar 下载需 EULA | 中 | 启动前检测 eula.txt，引导用户同意 |
| RCON 端口冲突 | 低 | Panel 分配端口时检测占用 |
| 进程僵尸（kill 后子进程未退出） | 中 | 使用 process.kill + 超时强杀 |
| WS 重连断线 | 中 | Panel 实现 exponential backoff 重连 |
| 单机部署 Panel+Daemon 端口冲突 | 低 | Panel 用 3000，Daemon 用 8080，前端用 5173 |

---

## 五、待裁决项（[V] 价值判断节点）— 已裁决

> 裁决时间：2026-07-02，用户批准 spec 三件套即接受以下推荐默认值。

| # | 决策项 | 裁决 | 理由 |
|---|--------|------|------|
| V1 | 新仓库名称 | `gameserver-panel` | 语义清晰，符合通用平台定位 |
| V2 | Panel 框架 | Express | 与现有 Factorio 项目一致，团队熟悉，迁移成本低 |
| V3 | UI 库 | shadcn/ui | 现代、可定制、Tailwind 原生支持，社区活跃 |
| V4 | P0 是否引入 Factorio Pack | 否，推迟 P2.1 | PoC 已验证 stdin 协议层，P0 聚焦 Minecraft 单游戏验证，减少范围 |

---

## 六、与 PoC 代码的关系

PoC 代码位于 `poc/`，P0 开发时以下文件可直接迁移到新仓库：

| PoC 文件 | P0 迁移目标 | 处理 |
|---------|------------|------|
| `poc/pack-yaml/schema.ts` | `panel/backend/src/core/packs/schema.ts` | 直接迁移，作为 Pack 契约 |
| `poc/pack-yaml/packs/minecraft-vanilla.yaml` | `packs/minecraft-vanilla/pack.yaml` | 直接迁移 |
| `poc/rcon-client/mock-server.ts` | `daemon/tests/mock/rcon-server.ts` | 迁移为测试用 mock |
| `poc/panel-daemon/daemon.ts` | `daemon/src/server.ts` | 作为骨架参考，重写为生产代码 |
| `poc/panel-daemon/panel.ts` | `panel/backend/src/daemonClient/client.ts` | 作为客户端参考 |
