# GameServer Panel 3.0.0 — 通用游戏服务器管理平台架构方案

> **版本**：v2.0（推翻 v1.0"包装现有代码"路线，转向平台优先重写）
> **日期**：2026-07-02
> **目标版本**：3.0.0
> **定位**：参考 Pterodactyl（架构）+ Tebex（商业化）的轻量级自部署多游戏服务器管理平台
> **支持游戏**：Factorio / Minecraft / Rust / ARK / 7 Days to Die / Valheim / Palworld（首期 4 款，后续扩展）
> **与现有项目关系**：现有 Factorio 项目（v2.16.0）作为"参考实现"与"数据迁移源"，代码可重写，业务概念（用户/实例/商城/CDK）保留演进

---

## 一、为什么推倒重做（路线否定说明）

### 1.1 v1.0 方案的问题

v1.0 方案以"不破坏现有 Factorio 代码"为硬约束，采用适配器包装路线。经评估存在根本性缺陷：

| 问题 | 后果 |
|------|------|
| 以 Factorio 为内核向外适配 | 平台永远背负 Factorio 历史包袱（双轨 instanceManager、stdin 通信、Lua 命令硬编码） |
| 适配器包装现有代码 | 抽象层妥协于既有实现，无法设计真正干净的平台内核 |
| 复用率 65-70% 看似高 | 实际是把"将来还要再改一次"的技术债延后爆发 |
| 受众面狭窄 | 深度绑定 Factorio 单一游戏，无法服务 Minecraft/Rust/ARK 等更大市场 |
| 商业化能力缺失 | 现有项目仅有基础商城，无订阅/捐赠/礼包/webhook/履约队列等 Tebex 核心能力 |

### 1.2 3.0.0 路线决策

**决策**：以"通用游戏服务器管理平台"为一等公民重新设计，Factorio/Minecraft/Rust/ARK 均为平等的游戏适配器。允许重写现有代码，业务数据通过迁移脚本保留。

**判定依据**：
1. 现有项目硬编码点共 8 处（见 v1.0 方案 §2.3），包装代价 ≈ 重写代价的 70%，但技术债永久留存
2. 多游戏市场（Minecraft/Rust/ARK）用户基数远超 Factorio，平台价值放大 10x+
3. 参考 Pterodactyl（30k+ 商用部署）与 Tebex（30k+ 付费服务器）已验证通用平台模式可行
4. 现有项目积累的领域知识（实例管理、商城、CDK、聊天增强、VIP）可平移到新架构，重写非"从零开始"

---

## 二、行业参考与定位

### 2.1 标杆项目对比

| 维度 | Pterodactyl | Tebex | Crafty Control | **本方案 3.0.0** |
|------|-------------|-------|----------------|------------------|
| 定位 | 游戏服务器运维面板 | 游戏服务器商业化平台 | 单机 Minecraft 面板 | **运维 + 商业化一体化自部署平台** |
| 架构 | Panel + Wings（Go daemon）+ Docker | SaaS（无自部署） | Python 单体 | Panel + Daemon + 可选 Docker |
| 多游戏 | Nest/Egg 模板系统，支持 100+ 游戏 | 12 游戏 | 仅 Minecraft | Game Pack 系统，首期 4 款 |
| 多节点 | ✅ Wings 跨主机 | N/A | ❌ 单机 | ✅ Daemon 跨主机 |
| 容器隔离 | ✅ 每实例一 Docker 容器 | N/A | ❌ 裸进程 | ✅ Docker 优先，进程模式降级 |
| 商业化 | ❌ 仅运维 | ✅ 商城/订阅/CDK/webhook/履约 | ❌ | ✅ 全套 Tebex 式商业化 |
| 多租户 | ✅ 用户→服务器 ACL | ✅ 团队账号 | ✅ 简单 RBAC | ✅ 用户→服务器→角色 |
| 自部署 | ✅ | ❌ SaaS only | ✅ | ✅ |
| 技术栈 | PHP/React/Go/Docker | 闭源 SaaS | Python/Tornado | **TypeScript/React/Node/Docker** |

### 2.2 差异化定位

**不与 Pterodactyl 正面竞争**（它是运维面板标杆），而是补足其缺失的商业化层：

> **一句话定位**：Pterodactyl 解决"怎么把游戏服务器跑起来"，Tebex 解决"怎么靠游戏服务器赚钱"，**3.0.0 把两者合并为一个自部署平台**，让小型游戏社区运营者一站式完成"开服 → 管理 → 变现"。

**目标用户**：
- 中小型游戏社区运营者（10-500 玩家）
- 自建服务器的个人或小团队
- 不满足于 Pterodactyl 仅做运维、又用不起 Tebex SaaS 抽成的用户

**非目标用户**：
- 大型商用游戏托管商（用 Pterodactyl + 自研计费更合适）
- 单机玩家（用Crafty 即可）

---

## 三、3.0.0 总体架构

### 3.1 双层架构：Panel + Daemon

参考 Pterodactyl 的 Panel/Wings 分层，但用同一技术栈（TypeScript）实现，降低维护成本。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Panel（中心控制台）                          │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────────┐  │
│  │ Web UI       │ │ Admin API    │ │ Storefront API (Headless)  │  │
│  │ React 19     │ │ REST + WS    │ │ 公开商品浏览/下单          │  │
│  └──────────────┘ └──────────────┘ └────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              平台内核 (Platform Core)                         │  │
│  │  认证 / 多租户 / Game Pack 注册表 / 订单 / 履约队列 / Webhook │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              数据层 (Knex + MySQL/PostgreSQL/SQLite)          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTPS（Daemon Token 鉴权）
                            │ WebSocket（事件流 + 命令流）
┌───────────────────────────┴─────────────────────────────────────────┐
│                    Daemon（节点代理，每主机一个）                    │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────────┐  │
│  │ 实例生命周期 │ │ RCON/Stdin   │ │ 文件管理（SFTP/HTTP）      │  │
│  │ Docker/进程  │ │ 命令客户端   │ │ 备份/恢复                  │  │
│  └──────────────┘ └──────────────┘ └────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              本地资源监控（CPU/MEM/DISK/网络）                │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ 实例容器1 │  │ 实例容器2 │  │ 实例容器N │
        │ Minecraft│  │ Factorio │  │  Rust    │
        └──────────┘  └──────────┘  └──────────┘
```

### 3.2 核心设计原则

1. **Panel 是大脑，Daemon 是手脚**：所有配置/订单/用户数据在 Panel；Daemon 仅执行实例生命周期与命令
2. **Game Pack 即模板**：每款游戏一个 Pack（YAML/JSON 描述），定义启动脚本、配置 schema、命令映射、版本源。新增游戏 = 新增 Pack 文件，零代码
3. **Docker 优先，进程降级**：默认每实例一容器（隔离 + 资源限制）；不支持 Docker 的环境降级为进程模式
4. **RCON 为一等公民**：Minecraft/Rust/ARK/CS2 等均走标准 RCON；Factorio stdin 作为特殊协议适配
5. **履约队列解耦**：商品下单 → 履约队列 → Daemon 执行命令 → 结果回写，避免支付与游戏服务器强耦合
6. **多租户从零设计**：用户→服务器归属→权限三位一体，不再事后补丁

---

## 四、Game Pack 系统（核心抽象）

### 4.1 Pack 结构

参考 Pterodactyl 的 Egg，但用 TypeScript 友好的 YAML/JSON 描述。

```yaml
# packs/minecraft/vanilla/pack.yaml
pack:
  id: minecraft-vanilla
  game: minecraft
  variant: vanilla            # vanilla / paper / spigot / forge
  display_name: Minecraft Java (Vanilla)
  version: 1.0

# ── 启动配置 ──────────────────────────────────
startup:
  binary: java
  args:
    - "-Xmx{{jvm_xmx}}"
    - "-Xms{{jvm_xms}}"
    - "-jar"
    - "server.jar"
    - "nogui"
  working_dir: "{{instance_root}}"
  ready_pattern: 'Done \([\d.]+s\)! For help, type "help"'
  stop_command: "stop"        # 通过 RCON 发送
  stop_timeout: 30

# ── 通信协议 ──────────────────────────────────
protocol:
  type: rcon
  default_port: 25575
  auth: password
  encrypt: none               # 明文，需 SSH 隧道
  config_key:                 # RCON 配置在哪个配置文件
    file: server.properties
    enable_key: enable-rcon
    port_key: rcon.port
    password_key: rcon.password

# ── 配置文件 ──────────────────────────────────
config:
  format: properties          # properties / json / ini / yaml
  main_file: server.properties
  schema:                     # 字段定义，前端动态表单
    - key: server-port
      type: number
      default: 25565
      label: 服务器端口
    - key: max-players
      type: number
      default: 20
      label: 最大玩家数
    - key: motd
      type: string
      default: "A Minecraft Server"
      label: 服务器描述
    - key: difficulty
      type: enum
      values: [peaceful, easy, normal, hard]
      default: easy
      label: 难度
    - key: enable-rcon
      type: boolean
      default: true
      hidden: true            # 平台强制开启
    # ... 完整 server.properties 字段

# ── 命令映射 ──────────────────────────────────
commands:
  broadcast: 'say {{message}}'
  give_item: 'give {{player}} {{item}} {{count}}'
  kick_player: 'kick {{player}} {{reason}}'
  ban_player: 'ban {{player}} {{reason}}'
  list_players: 'list'
  save_world: 'save-all'
  op_player: 'op {{player}}'
  deop_player: 'deop {{player}}'
  whitelist_add: 'whitelist add {{player}}'
  whitelist_remove: 'whitelist remove {{player}}'
  set_time: 'time set {{time}}'
  set_weather: 'weather {{weather}}'

# ── 版本源 ────────────────────────────────────
versions:
  source: mojang
  manifest_url: https://piston-meta.mojang.com/mc/game/version_manifest.json
  type: server-jar
  download_pattern: "{{server_url}}"
  eula_required: true
  eula_file: eula.txt

# ── 备份 ──────────────────────────────────────
backup:
  world_dir: world
  pre_backup_commands:
    - "save-off"
    - "save-all"
  post_backup_commands:
    - "save-on"

# ── 前端 Tab ──────────────────────────────────
ui:
  tabs:
    - console
    - config
    - players
    - backups
    - monitor
    - logs
    - shop-admin           # 商城管理（共用平台组件）
    - cdk-admin             # CDK 管理（共用平台组件）

# ── 资源建议 ──────────────────────────────────
resources:
  min_ram: 1G
  recommended_ram: 2G
  min_disk: 500M
```

### 4.2 Pack 注册与发现

```typescript
// platform/packs/registry.ts
export class PackRegistry {
  private packs = new Map<string, GamePack>();

  async loadFromDir(dir: string): Promise<void> {
    // 扫描 packs/*/*.yaml，解析并注册
  }

  get(packId: string): GamePack { /* ... */ }
  listByGame(game: string): GamePack[] { /* ... */ }
  listAll(): GamePack[] { /* ... */ }
}
```

### 4.3 首期支持的 Pack

| Pack ID | 游戏 | 通信协议 | 难度 | 备注 |
|---------|------|---------|------|------|
| `factorio-vanilla` | Factorio | stdin (Lua) | 中 | 迁移现有项目逻辑 |
| `minecraft-vanilla` | Minecraft | RCON | 低 | Mojang 官方 |
| `minecraft-paper` | Minecraft | RCON | 低 | Paper 服务端 |
| `rust-vanilla` | Rust | WebRCON | 低 | `rcon.web true` |
| `ark-vanilla` | ARK: SE | RCON | 中 | `GameUserSettings.ini` |
| `valheim-vanilla` | Valheim | RCON | 中 | 需要 BepInEx 插件 |
| `palworld-vanilla` | Palworld | RCON | 低 | 新增游戏 |
| `7d2d-vanilla` | 7 Days to Die | RCON | 中 | — |

---

## 五、平台内核模块划分

### 5.1 Panel 后端模块

```
panel/backend/src/
├── core/                           # 平台内核（游戏无关）
│   ├── auth/
│   │   ├── jwt.ts                  # JWT 签发/验证
│   │   ├── roles.ts                # 4 级角色：system_admin/admin/operator/viewer
│   │   ├── permissions.ts          # 细粒度权限矩阵
│   │   └── middleware.ts           # authenticateToken / requirePermission
│   ├── tenancy/
│   │   ├── user.ts                 # 用户管理
│   │   ├── serverOwnership.ts      # 服务器归属（user_id ↔ server_id）
│   │   ├── team.ts                 # 团队（多用户共管一服务器）
│   │   └── acl.ts                  # 实例级权限校验
│   ├── servers/
│   │   ├── server.ts               # 服务器 CRUD（含 game_type/pack_id）
│   │   ├── allocation.ts           # 端口/IP 分配
│   │   └── lifecycle.ts            # 生命周期状态机
│   ├── nodes/
│   │   ├── node.ts                 # Daemon 节点注册
│   │   ├── nodeToken.ts            # Daemon 鉴权 token
│   │   └── healthCheck.ts          # 节点健康检查
│   ├── packs/
│   │   ├── registry.ts             # Pack 注册表
│   │   ├── loader.ts               # YAML 解析器
│   │   └── schema.ts               # Pack schema 类型定义
│   └── events/
│       ├── bus.ts                  # 事件总线（内部）
│       └── dispatcher.ts           # 事件分发到 webhook/ws
│
├── commerce/                       # 商业化层（参考 Tebex）
│   ├── store/
│   │   ├── store.ts                # 多 storefront 支持
│   │   ├── category.ts             # 商品分类
│   │   ├── product.ts              # 商品（一次性/订阅/礼包）
│   │   └── pricing.ts              # 定价（多货币/区域）
│   ├── checkout/
│   │   ├── cart.ts                 # 购物车
│   │   ├── order.ts                # 订单
│   │   └── paymentGateway.ts       # 支付网关抽象（PayPal/Stripe/支付宝/微信）
│   ├── fulfillment/
│   │   ├── queue.ts                # 履约队列（核心）
│   │   ├── commandBuilder.ts       # 按 Pack commands 模板生成命令
│   │   ├── dispatcher.ts           # 派发到 Daemon 执行
│   │   └── retry.ts                # 失败重试（服务器离线时排队）
│   ├── subscription/
│   │   ├── plan.ts                 # 订阅计划
│   │   ├── renewal.ts              # 续费/到期
│   │   └── tier.ts                 # 等级（VIP1/VIP2/...）
│   ├── cdk/
│   │   ├── code.ts                 # 兑换码生成/兑换
│   │   └── batch.ts                # 批量生成
│   ├── webhook/
│   │   ├── endpoint.ts             # webhook 端点注册
│   │   ├── signer.ts               # HMAC 签名
│   │   └── delivery.ts             # 投递（指数退避重试）
│   └── analytics/
│       ├── revenue.ts              # 营收统计
│       └── playerLtv.ts            # 玩家生命周期价值
│
├── games/                          # 游戏专属业务（可选挂载）
│   ├── shared/
│   │   ├── chatEnhancement.ts      # 聊天增强（关键词触发/欢迎语/定时消息）
│   │   ├── playerTracker.ts        # 玩家追踪
│   │   └── voteSystem.ts           # 投票踢人
│   └── factorio/                   # Factorio 专属（迁移自现有项目）
│       ├── modDependency.ts
│       ├── itemSyncService.ts
│       └── mapGenerator.ts
│
├── api/                            # API 层
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── servers.ts              # /api/servers
│   │   ├── nodes.ts                # /api/nodes
│   │   ├── packs.ts                # /api/packs
│   │   ├── store.ts                # /api/store（公开）
│   │   ├── checkout.ts             # /api/checkout
│   │   ├── fulfillment.ts          # /api/fulfillment
│   │   ├── subscriptions.ts
│   │   ├── cdk.ts
│   │   ├── webhooks.ts
│   │   └── admin/                  # 管理后台
│   │       ├── users.ts
│   │       ├── nodes.ts
│   │       └── analytics.ts
│   └── websocket/
│       ├── server.ts               # WS 服务（控制台/日志/聊天）
│       └── channels.ts             # 按 server_id 隔离
│
├── daemonClient/                   # Panel 调用 Daemon 的客户端
│   ├── client.ts                   # HTTP/WS 客户端
│   ├── commandStream.ts            # 命令流（异步派发）
│   └── eventStream.ts              # 接收 Daemon 上报事件
│
└── db/
    ├── schema.ts                   # 全部表结构（幂等迁移）
    ├── migrations/                 # 历史迁移
    └── connection.ts               # Knex 连接
```

### 5.2 Daemon 后端模块

```
daemon/src/
├── server.ts                       # HTTP + WS 服务端
├── auth.ts                         # Daemon Token 鉴权
├── instances/
│   ├── manager.ts                  # 实例生命周期管理
│   ├── dockerDriver.ts             # Docker 容器驱动（优先）
│   ├── processDriver.ts            # 进程驱动（降级）
│   └── readiness.ts                # 就绪检测（按 Pack ready_pattern）
├── protocol/
│   ├── rconClient.ts               # 标准 RCON 客户端（基于 rcon-node）
│   ├── stdinClient.ts              # stdin 客户端（Factorio）
│   ├── webRconClient.ts            # Web RCON 客户端（Rust）
│   └── factory.ts                  # 按 Pack protocol.type 创建
├── files/
│   ├── sftpServer.ts               # SFTP 服务
│   ├── httpFileServer.ts           # HTTP 文件管理
│   └── backup.ts                   # 备份/恢复（按 Pack backup 配置）
├── monitor/
│   ├── resource.ts                 # CPU/MEM/DISK 采集
│   └── reporter.ts                 # 上报到 Panel
└── events/
    └── upstream.ts                 # 事件上报到 Panel（日志/聊天/状态变更）
```

### 5.3 前端模块

```
panel/frontend/src/
├── app/
│   ├── routes.tsx                  # 路由表
│   └── App.tsx
├── pages/
│   ├── public/                     # 公开页面
│   │   ├── Home.tsx
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   └── Store/                  # 公开商店（Headless API）
│   │       ├── Browse.tsx          # 商品浏览
│   │       ├── ProductDetail.tsx
│   │       ├── Cart.tsx
│   │       └── Checkout.tsx
│   ├── dashboard/                  # 用户仪表盘
│   │   ├── Overview.tsx
│   │   ├── Servers.tsx             # 服务器列表
│   │   ├── CreateServer.tsx        # 创建（选 Pack）
│   │   └── ServerDetail/           # 服务器详情（按 Pack tabs 动态渲染）
│   │       ├── Console.tsx         # RCON 控制台
│   │       ├── Config.tsx          # 动态表单（按 Pack config schema）
│   │       ├── Players.tsx
│   │       ├── Backups.tsx
│   │       ├── Monitor.tsx
│   │       ├── Logs.tsx
│   │       ├── ShopAdmin.tsx       # 商城管理
│   │       └── CdkAdmin.tsx
│   ├── account/
│   │   ├── Profile.tsx
│   │   ├── Orders.tsx
│   │   ├── Subscriptions.tsx
│   │   └── CDK.tsx
│   └── admin/                      # 管理员后台
│       ├── Nodes.tsx               # Daemon 节点管理
│       ├── Packs.tsx               # Pack 管理
│       ├── Users.tsx
│       ├── Analytics.tsx
│       └── Webhooks.tsx
├── components/
│   ├── pack/
│   │   └── DynamicConfigForm.tsx   # 按 Pack schema 渲染表单
│   ├── console/
│   │   └── RconConsole.tsx         # 通用 RCON 控制台
│   └── store/
│       ├── ProductCard.tsx
│       └── CartDrawer.tsx
└── api/
    ├── client.ts                   # axios 封装
    ├── store.ts                    # 公开商店 API
    ├── dashboard.ts                # 仪表盘 API
    └── admin.ts                    # 管理 API
```

---

## 六、数据模型设计

### 6.1 核心表（Platform Core）

```sql
-- 用户与租户
users (id, email, username, password_hash, role, status, created_at, ...)
teams (id, name, owner_user_id, created_at)
team_members (team_id, user_id, role, joined_at)

-- 服务器
servers (
  id, name, pack_id, game_type, node_id, owner_user_id, team_id,
  status,                  -- stopped/starting/running/stopping/error
  port, rcon_port, rcon_password_enc,
  docker_container_id,
  resource_limits_json,    -- {cpu, memory, disk}
  created_at, updated_at
)
server_allocations (id, server_id, node_id, port, type)  -- primary/rcon/query

-- Daemon 节点
nodes (
  id, name, fqdn, daemon_token_hash, public_ip, internal_ip,
  max_memory, max_disk, location, status, last_seen_at
)

-- Game Packs（运行时从 YAML 加载，但元信息入库便于管理）
packs (id, game, variant, display_name, version, enabled, loaded_at)
```

### 6.2 商业化表（Commerce，参考 Tebex）

```sql
-- 商店
stores (id, name, owner_team_id, theme, domain, created_at)
categories (id, store_id, name, sort_order, parent_id)

-- 商品
products (
  id, store_id, category_id, name, description, price_cents, currency,
  type,                   -- one_time / subscription / gift_bag / bundle
  image_url,
  fulfillment_commands_json,  -- [{command: "give {{player}} {{item}}", ...}]
  subscription_plan_id,       -- 若 type=subscription
  sort_order, status
)

-- 订单与支付
carts (id, user_id, store_id, items_json, created_at)
orders (
  id, order_no, user_id, store_id, total_cents, currency,
  status,                -- pending/paid/fulfilled/failed/refunded
  payment_method,        -- paypal/stripe/alipay/wechat
  payment_id, paid_at, created_at
)
order_items (id, order_id, product_id, price_cents, qty, metadata_json)

-- 履约
fulfillment_tasks (
  id, order_id, order_item_id, server_id, user_id,
  commands_json,         -- 待执行命令列表
  status,                -- queued/running/succeeded/failed/retrying
  attempts, max_attempts,
  last_error, executed_at, created_at
)

-- 订阅
subscription_plans (id, name, duration_days, price_cents, features_json)
user_subscriptions (
  id, user_id, plan_id, product_id, server_id,
  status,                -- active/expired/cancelled
  started_at, expires_at, auto_renew
)

-- CDK
cdk_batches (id, name, product_id, count, created_at, created_by)
cdk_codes (
  id, batch_id, code, status,  -- unused/used/expired
  used_by, used_at, expires_at
)

-- Webhook
webhook_endpoints (id, store_id, url, secret, events_json, enabled)
webhook_deliveries (id, endpoint_id, event_type, payload_json, status, attempts, response_code, delivered_at)
```

### 6.3 游戏通用业务表（Games Shared）

```sql
-- 玩家绑定（跨游戏）
player_bindings (
  id, user_id, server_id, game_type,
  in_game_name, in_game_id,    -- SteamID/XUID/playername
  bound_at, last_seen_at
)

-- 聊天增强（通用）
chat_settings (id, server_id, key, value)
chat_trigger_responses (id, server_id, trigger, response, match_type)
player_join_settings (id, server_id, welcome_message, first_time_message)
periodic_messages (id, server_id, message, interval_seconds, enabled)

-- 投票
vote_settings (id, server_id, threshold, duration, enabled)
votes (id, server_id, initiator, target, reason, created_at, expires_at)
vote_records (id, vote_id, voter, choice, voted_at)
```

### 6.4 与现有项目的数据迁移

现有 Factorio 项目数据库结构 → 3.0.0 的映射：

| 现有表 | 3.0.0 目标表 | 迁移策略 |
|--------|-------------|---------|
| `users` | `users` | 字段映射，`factorio_player_name` → `player_bindings` |
| `instances` | `servers` (game_type='factorio') | 字段重命名 + pack_id 填充 |
| `shop_items` | `products` (type='one_time') | fulfillment_commands 从 Lua 转换 |
| `shop_orders` | `orders` | 字段映射 |
| `shop_order_items` | `order_items` + `fulfillment_tasks` | 拆分：订单项 vs 履约任务 |
| `cdk_codes` | `cdk_codes` | 直接迁移 |
| `vip_permissions` | `subscription_plans` + `user_subscriptions` | 概念升级 |
| `chat_settings` 等 | 同名表 | 直接迁移（server_id 替换） |

迁移脚本原则：
- **离线迁移**：3.0.0 部署时一次性执行
- **数据备份**：迁移前自动 `manager.db → manager.db.bak.2.x`
- **可回滚**：保留 2.x 版本部署包，迁移失败可回退
- **字段映射文档**：迁移脚本头部完整记录字段对应关系

---

## 七、商业化层设计（参考 Tebex）

### 7.1 履约队列（核心）

Tebex 的核心价值是**支付与游戏服务器解耦**——玩家下单后，即使游戏服务器离线，履约任务也会排队等待服务器上线后执行。

```typescript
// commerce/fulfillment/queue.ts
export class FulfillmentQueue {
  // 玩家下单 → 创建 fulfillment_task → 入队
  async enqueue(orderItemId: string, serverId: string, commands: string[]) { /* ... */ }

  // Daemon 上线后拉取待执行任务
  async pollPending(serverId: string): Promise<FulfillmentTask[]> { /* ... */ }

  // 执行结果回写
  async markSucceeded(taskId: string, response: string) { /* ... */ }
  async markFailed(taskId: string, error: string) { /* ... */ }

  // 失败重试策略：指数退避，最大 5 次
  async scheduleRetry(taskId: string) { /* ... */ }
}
```

**履约流程**：
```
玩家下单 → 支付完成 → 创建 order + fulfillment_tasks
                              ↓
                      任务入队（status=queued）
                              ↓
              Daemon 检查服务器在线？─── 否 → 等待，定期重试
                              │ 是
                              ▼
              Daemon 通过 RCON/stdin 执行命令
                              ↓
                    成功 → status=succeeded
                    失败 → 重试（最多 5 次）→ 最终失败标记，通知管理员
```

### 7.2 命令模板引擎

商品定义时使用模板，履约时按 Pack 的 `commands` 映射渲染：

```typescript
// 商品定义
{
  "name": "钻石礼包",
  "fulfillment_commands": [
    { "action": "give_item", "params": { "item": "minecraft:diamond", "count": 64 } },
    { "action": "broadcast", "params": { "message": "{{player}} 购买了钻石礼包！" } }
  ]
}

// 履约时：按 Pack commands 模板渲染
// Minecraft Pack:  give_item → 'give {{player}} {{item}} {{count}}'
//                  broadcast → 'say {{message}}'
// Factorio Pack:   give_item → '/silent-command game.players["{{player}}"].insert{name="{{item}}",count={{count}}}'
//                  broadcast → '/silent-command game.print("{{message}}")'
```

这样**同一商品可跨游戏销售**——只要 Pack 定义了对应的 command action。

### 7.3 Webhook 系统

```typescript
// 支持的事件类型
type WebhookEvent =
  | 'order.created'
  | 'order.paid'
  | 'order.fulfilled'
  | 'order.refunded'
  | 'subscription.renewed'
  | 'subscription.expired'
  | 'cdk.redeemed'
  | 'player.joined'
  | 'player.left';

// 投递：HMAC-SHA256 签名，指数退避重试（最多 24 小时，10 次）
// 接收方校验：X-Webhook-Signature 头与 HMAC(secret, payload) 比对
```

### 7.4 支付网关抽象

```typescript
export interface PaymentGateway {
  readonly id: string;            // paypal/stripe/alipay/wechat
  createPayment(order: Order): Promise<PaymentSession>;
  verifyWebhook(req: Request): Promise<WebhookPayload>;
  refund(paymentId: string, amount?: number): Promise<RefundResult>;
}

// 首期支持：
// - PayPal（海外）
// - Stripe（海外，信用卡）
// - 支付宝（国内）
// - 微信支付（国内）
// - 手动激活（管理员手动确认，零成本启动）
```

---

## 八、Daemon 设计

### 8.1 Panel ↔ Daemon 通信

```
Panel ──HTTPS──> Daemon
  ├─ POST /instances/:id/start     启动实例
  ├─ POST /instances/:id/stop      停止实例
  ├─ POST /instances/:id/command   发送命令
  ├─ GET  /instances/:id/status    状态查询
  ├─ GET  /instances/:id/files     文件列表
  ├─ POST /instances/:id/backup    触发备份
  └─ GET  /nodes/health            节点健康

Panel <──WebSocket── Daemon
  ├─ log                            日志流
  ├─ chat                           聊天流
  ├─ state_change                   状态变更
  ├─ player_event                   玩家加入/离开
  └─ metrics                        资源指标上报
```

### 8.2 Daemon Token 鉴权

每个节点注册时生成唯一 token，Panel 调用 Daemon 时在 Header 携带：
```
Authorization: Bearer <daemon_token>
```

Daemon 验证 token 后执行命令。token 可由管理员在 Panel 后台轮换。

### 8.3 Docker 驱动 vs 进程驱动

```typescript
// 优先 Docker，降级进程
export interface InstanceDriver {
  start(server: Server, pack: GamePack): Promise<void>;
  stop(server: Server, pack: GamePack): Promise<void>;
  getStatus(server: Server): Promise<InstanceStatus>;
  exec(server: Server, command: string): Promise<string>;
  getLogs(server: Server, since: Date): Promise<string[]>;
}

// DockerDriver: 每实例一容器，资源限制，独立网络命名空间
// ProcessDriver: 直接 spawn，降级方案（单机部署无 Docker 时）
```

### 8.4 命令协议适配

```typescript
// 按 Pack protocol.type 创建客户端
export class ProtocolFactory {
  static create(pack: GamePack, instance: Server): CommandProtocol {
    switch (pack.protocol.type) {
      case 'rcon':    return new RconClient(instance.host, pack.protocol.default_port, instance.rconPassword);
      case 'stdin':   return new StdinClient(instance.processHandle);  // Factorio
      case 'webrcon': return new WebRconClient(instance.host, pack.protocol.default_port, instance.rconPassword);  // Rust
      default: throw new Error(`Unknown protocol: ${pack.protocol.type}`);
    }
  }
}
```

---

## 九、前端关键设计

### 9.1 公开商店（Headless API）

参考 Tebex Headless API，公开页面不需要登录即可浏览/下单：

- `/store/:storeId` — 商店首页
- `/store/:storeId/category/:categoryId` — 分类页
- `/store/:storeId/product/:productId` — 商品详情
- `/store/:storeId/cart` — 购物车
- `/store/:storeId/checkout` — 结算（需登录）

### 9.2 服务器详情动态 Tab

```typescript
// 按 Pack ui.tabs 动态渲染
function ServerDetail({ serverId }: { serverId: string }) {
  const { server, pack } = useServer(serverId);

  return (
    <Tabs>
      {pack.ui.tabs.map(tab => (
        <TabPane key={tab} tab={TAB_LABELS[tab]}>
          <DynamicTabContent tab={tab} server={server} pack={pack} />
        </TabPane>
      ))}
    </Tabs>
  );
}
```

### 9.3 通用 RCON 控制台

支持响应回显（Minecraft/Rust/ARK）和单向发送（Factorio stdin）：

```typescript
function RconConsole({ server, pack }: Props) {
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const [input, setInput] = useState('');

  const send = async () => {
    const result = await api.post(`/servers/${server.id}/command`, { command: input });
    setHistory([...history, { type: 'command', text: input, time: new Date() }]);
    if (pack.protocol.type === 'rcon' && result.response) {
      // RCON 有响应，回显
      setHistory(h => [...h, { type: 'response', text: result.response, time: new Date() }]);
    }
    setInput('');
  };

  // ... 渲染输入框 + 历史输出
}
```

---

## 十、分阶段实施计划（3.0.0 Roadmap）

### 10.1 阶段总览

| 阶段 | 目标 | 主要产出 |
|------|------|---------|
| **P0 内核骨架** | 平台内核可跑通 | Panel + Daemon 双层通信 + 一个 Pack 跑通 |
| **P1 商业化层** | Tebex 式变现 | 商店/订单/履约队列/CDK/Webhook |
| **P2 多游戏 Pack** | 4 款游戏上线 | Factorio/Minecraft/Rust/ARK Pack |
| **P3 数据迁移** | 现有用户平滑升级 | 2.x → 3.0.0 迁移脚本 + 工具 |
| **P4 平台化完善** | 生产就绪 | Docker 部署/监控/多节点/文档 |

### 10.2 P0：内核骨架

**目标**：Panel + Daemon 双层架构跑通，一个 Minecraft 实例可以从 Panel 创建、启动、发命令、停止。

| # | 任务 | 产出 |
|---|------|------|
| 0.1 | Panel 项目脚手架（Express + Knex + React） | 可运行的空壳 |
| 0.2 | Daemon 项目脚手架（独立 npm 包） | 可运行的 daemon |
| 0.3 | Panel ↔ Daemon 通信协议定义（HTTPS + WS） | 接口契约 |
| 0.4 | Daemon Token 鉴权 | 双向认证 |
| 0.5 | Pack Registry + YAML 解析器 | `packs/minecraft/vanilla/pack.yaml` 可加载 |
| 0.6 | ProcessDriver（先不接 Docker） | spawn java server.jar |
| 0.7 | RconClient（基于 rcon-node） | 可发命令拿响应 |
| 0.8 | Server CRUD + 端口分配 | Panel 可创建服务器 |
| 0.9 | 生命周期状态机 + 就绪检测 | start/stop/status 闭环 |
| 0.10 | 前端服务器列表 + 创建 + 详情 Console Tab | 端到端可用 |
| 0.11 | 端到端测试：Minecraft 实例全流程 | 测试报告 |

### 10.3 P1：商业化层

**目标**：Tebex 式变现能力，玩家可在公开商店下单，履约队列自动执行。

| # | 任务 | 产出 |
|---|------|------|
| 1.1 | 商品/分类/商店表 + CRUD | 管理后台可配商品 |
| 1.2 | 公开商店前端（浏览/详情/购物车） | `/store/:id` 可访问 |
| 1.3 | 订单 + 支付网关抽象 + 手动激活实现 | 可下单 + 管理员确认 |
| 1.4 | 履约队列 + 命令模板引擎 | 下单 → 命令派发闭环 |
| 1.5 | 失败重试 + 服务器离线排队 | 离线时不丢任务 |
| 1.6 | 订阅计划 + 续费/到期 | VIP 等级 |
| 1.7 | CDK 批量生成 + 兑换 | 兑换码系统 |
| 1.8 | Webhook 端点 + HMAC 签名 + 投递重试 | 事件订阅 |
| 1.9 | PayPal/Stripe 网关实现（可选） | 在线支付 |
| 1.10 | 端到端测试：下单 → 履约 → 服务器收到命令 | 测试报告 |

### 10.4 P2：多游戏 Pack

**目标**：4 款游戏 Pack 全部可用，跨游戏商品可销售。

| # | 任务 | 产出 |
|---|------|------|
| 2.1 | `packs/factorio/vanilla/` + StdinClient | Factorio Pack |
| 2.2 | `packs/minecraft/vanilla/` + `packs/minecraft/paper/` | Minecraft 双 Pack |
| 2.3 | `packs/rust/vanilla/` + WebRconClient | Rust Pack |
| 2.4 | `packs/ark/vanilla/` + RconClient | ARK Pack |
| 2.5 | 每款 Pack 的配置 schema 完整定义 | 前端动态表单可用 |
| 2.6 | 每款 Pack 的命令映射完整定义 | 履约命令可跨游戏 |
| 2.7 | 版本下载源对接（Mojang/SteamCMD/Factorio API） | 可拉取版本 |
| 2.8 | DockerDriver 实现 | 容器化运行 |
| 2.9 | 跨游戏商品测试：同一商品在 4 款游戏履约 | 测试报告 |

### 10.5 P3：数据迁移

**目标**：现有 Factorio 项目用户可平滑升级到 3.0.0。

| # | 任务 | 产出 |
|---|------|------|
| 3.1 | 字段映射文档（2.x → 3.0.0） | 文档 |
| 3.2 | 迁移脚本（users/instances/shop/cdk/chat） | `migrations/2to3.ts` |
| 3.3 | Factorio Lua 命令 → 通用命令模板转换 | 转换工具 |
| 3.4 | 迁移演练 + 回滚验证 | 演练报告 |
| 3.5 | 升级指南文档 | `UPGRADE-3.0.md` |

### 10.6 P4：平台化完善

| # | 任务 | 说明 |
|---|------|------|
| 4.1 | Docker Compose 一键部署 | panel + daemon + db |
| 4.2 | 多节点管理 UI | 管理后台 |
| 4.3 | 资源监控仪表盘 | CPU/MEM/DISK 图表 |
| 4.4 | 团队协作 | 多人共管服务器 |
| 4.5 | i18n（中/英） | 多语言 |
| 4.6 | 文档站 | 部署/Pack 开发/API 文档 |

---

## 十一、资源需求评估

### 11.1 工作量估算

| 阶段 | 工作量（人天） | 说明 |
|------|--------------|------|
| P0 内核骨架 | 15-20 | 双层架构 + 通信 + 一个 Pack 跑通 |
| P1 商业化层 | 18-25 | 商店/订单/履约/CDK/Webhook/支付 |
| P2 多游戏 Pack | 12-18 | 4 款 Pack + Docker + 跨游戏商品 |
| P3 数据迁移 | 5-8 | 迁移脚本 + 演练 |
| P4 平台化完善 | 10-15 | 部署/监控/文档 |
| **合计** | **60-86** | 净开发工作量 |

建议按 1.4 倍系数预留缓冲：**84-120 人天**。

### 11.2 团队配置建议

- **后端工程师 ×1-2**：Panel + Daemon 核心开发
- **前端工程师 ×1**：React 前端 + 商店
- **DevOps ×0.5**：Docker 部署 + CI/CD（兼职即可）

最小可行团队：**1 全栈 + 1 前端**，P0-P2 周期约 3-4 个月。

### 11.3 基础设施

| 项 | 需求 |
|----|------|
| Panel 服务器 | 1 台，2C4G+，现有 demo 服务器可复用 |
| Daemon 节点 | 每主机 1 个 Daemon，首期与 Panel 同机 |
| 数据库 | MySQL/PostgreSQL 推荐（SQLite 可用于 PoC） |
| Docker | 生产环境必需（PoC 可降级进程模式） |
| 域名/证书 | 现有 trae.ecsrz.com 可复用 |
| 支付账号 | PayPal/Stripe 商家账号（接入支付时） |

---

## 十二、风险评估

### 12.1 技术风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| T1 | Panel/Daemon 双层通信复杂度超预期 | 中 | 高 | P0 先做最小闭环，验证通信模型再扩展 |
| T2 | Docker 驱动跨平台兼容（Linux/Mac/Win） | 中 | 中 | 优先 Linux，Mac/Win 降级进程模式 |
| T3 | 各游戏 RCON 实现差异（Rust WebRCON） | 中 | 中 | 抽象 ProtocolFactory，每游戏独立客户端 |
| T4 | 履约队列在服务器长期离线时堆积 | 中 | 中 | 设置最大重试次数 + 过期清理 + 通知管理员 |
| T5 | 支付网关接入合规性（PCI/税务） | 高 | 高 | 首期手动激活 + PayPal（不接触卡号）|
| T6 | Pack YAML schema 设计不足，后续游戏难适配 | 中 | 中 | P0 充分参考 Pterodactyl Egg，预留扩展字段 |

### 12.2 产品风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| P1 | 与 Pterodactyl 正面竞争 | 中 | 中 | 差异化：聚焦商业化+轻量自部署，不拼运维深度 |
| P2 | 与 Tebex SaaS 竞争 | 低 | 中 | 差异化：自部署零抽成，目标用户不同 |
| P3 | 现有 Factorio 用户流失 | 中 | 中 | P3 迁移脚本保证平滑升级 |
| P4 | 范围蔓延（更多游戏/功能） | 高 | 中 | 严守 P0-P2 范围，P4 才扩展 |

### 12.3 架构风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| A1 | 单 Daemon 单点故障 | 高 | 高 | 多节点支持，关键实例可迁移 |
| A2 | 数据库瓶颈 | 低 | 高 | 读多写少，Knex 三库可横向扩展 |
| A3 | Pack 生态冷启动（无第三方贡献） | 高 | 中 | 首期官方维护 4 款，开放 Pack schema 文档 |

---

## 十三、关键决策点（已裁决）

> 裁决时间：2026-07-02，由人类裁决。以下决策已固化，作为 P0 启动前提。

### 13.1 部署模式 ✅ 单机模式

**裁决**：Panel + Daemon 同机部署，P4 再支持多节点。
**影响**：P0 工期省 30%，Daemon 与 Panel 同进程或同主机通信，简化首版调试。

### 13.2 容器化策略 ✅ 进程模式起步

**裁决**：P0 用 spawn 直接跑游戏进程，P2 引入 Docker。
**影响**：P0 不依赖 Docker，调试简单；ProcessDriver 优先实现，DockerDriver 推迟到 P2.8。

### 13.3 现有项目处置 ✅ 新建独立仓库

**裁决**：3.0.0 走新仓库，2.x 在原 factorio 仓库进入维护模式。
**影响**：需新建仓库（待命名建议：`gameserver-panel`），重新建立 CI/部署；2.x 仅修关键 Bug。

### 13.4 商业模式 ⏸ 暂缓裁决

**待决**：完全开源 / 核心开源+商业增强 / 闭源 SaaS。
**说明**：不影响 P0-P1 启动，可在 P1 商业化层开发前再决定。建议默认 MIT 开源起步，后续可调整。

### 13.5 支付接入优先级 ✅ 手动激活 + PayPal

**裁决**：P1 首期仅手动激活 + PayPal 基础接入，不接 Stripe/支付宝/微信。
**影响**：P1 工期 18-25 人天，PayPal 接入约 2-3 人天；其他支付网关延后到 P4。

---

## 十四、技术选型清单

| 层 | 选型 | 理由 |
|----|------|------|
| 后端语言 | TypeScript 5.7+ | 与前端同栈，类型安全，生态成熟 |
| Panel 框架 | Express 4 / Fastify 5 | 现有项目用 Express，可平滑；Fastify 性能更优 |
| Daemon 框架 | Fastify + ws | 轻量，WS 性能好 |
| ORM | Knex 3 | 现有项目已用，三库支持 |
| 数据库 | PostgreSQL（推荐）/ MySQL / SQLite | PG 对 JSON 支持更好 |
| 前端框架 | React 19 + Vite 6 + React Router 7 | 现有项目已用 |
| UI 库 | shadcn/ui + Tailwind CSS | 现有项目手写 CSS 不可持续，需组件库 |
| 状态管理 | TanStack Query + Zustand | 替代手写 Context，更适合复杂状态 |
| RCON 客户端 | rcon-node | 原生 TS、多游戏、活跃维护 |
| 容器化 | Docker + dockerode | Node.js 控制 Docker |
| 配置解析 | js-yaml + zod | Pack YAML 解析 + schema 校验 |
| 任务队列 | BullMQ + Redis | 履约队列/定时任务 |
| 日志 | pino + pino-pretty | 高性能结构化日志 |
| 测试 | Vitest + Playwright | 单元 + E2E |
| 部署 | Docker Compose | 一键部署 |

---

## 十五、与现有项目的关系

### 15.1 现有项目资产处置

| 资产 | 处置方式 |
|------|---------|
| 后端 Express + Knex 架构 | 保留思路，代码重写（结构更清晰） |
| JWT + 4 级角色 | 直接平移到 `core/auth/` |
| 多实例管理 | 升级为 `core/servers/` + Daemon 模式 |
| 商城 + CDK | 升级为 `commerce/`，概念保留 |
| 聊天增强 / 投票 | 平移到 `games/shared/` |
| WebSocket 日志推送 | 升级为 Panel ↔ Daemon ↔ Client 三方流 |
| Factorio 专属业务 | 迁移到 `games/factorio/` + Factorio Pack |
| 前端 Layout + 路由 | 重写，引入 shadcn/ui |
| 部署脚本 | 重写为 Docker Compose |

### 15.2 版本演进路径

```
v2.16.0 (当前)          v2.x 维护分支             v3.0.0 (新仓库)
    │                       │                         │
    │  ──→ 数据迁移 ──→  │                         │
    │                       │   ←── 升级指南 ──       │
    ▼                       ▼                         ▼
现有 Factorio 用户 ──→ 迁移工具 ──→ 3.0.0 + Factorio Pack
```

- **2.x 进入维护模式**：仅修关键 Bug，不再加新功能
- **3.0.0 主线开发**：所有新功能在 3.0.0
- **迁移工具**：P3 阶段提供，2.x → 3.0.0 一键迁移

---

## 十六、结论与下一步

### 16.1 结论

3.0.0 通用平台方案在技术、产品、商业三个维度均可行：
- **技术**：参考 Pterodactyl 已验证的 Panel/Daemon 架构 + Docker 隔离
- **产品**：参考 Tebex 已验证的履约队列 + 商业化模型
- **商业**：差异化定位（运维+商业化一体化自部署），避开与 Pterodactyl/Tebex 正面竞争

### 16.2 建议下一步

1. **人类裁决第十三节的 5 个关键决策点**
2. **创建 3.0.0 新仓库**（决策后）
3. **制定 P0 详细 spec 三件套**（spec.md / tasks.md / checklist.md）
4. **技术 PoC**：验证 Panel ↔ Daemon 通信 + rcon-node 连接 Minecraft + Pack YAML 解析
5. **启动 P0 开发**

### 16.3 风险提示

- 3.0.0 是重大架构重写，工期 84-120 人天，需评估团队带宽
- 现有 Factorio 用户在 3.0.0 发布前需继续维护 2.x
- 商业化层涉及支付合规，建议首期手动激活 + PayPal 起步

---

## 附录 A：行业参考链接

- [Pterodactyl Panel](https://pterodactyl.io/) — 开源游戏服务器管理面板，30k+ 商用部署
- [Tebex](https://www.tebex.io/) — 游戏服务器商业化平台，30k+ 付费服务器
- [Crafty Control](https://craftycontrol.com/) — 单机 Minecraft 面板
- [PufferPanel](https://www.pufferpanel.com/) — 轻量级多游戏面板
- [rcon-node](https://www.npmjs.com/package/rcon-node) — 多游戏 RCON 客户端

## 附录 B：首期 4 款游戏 RCON 命令对照

| 功能 | Factorio (stdin Lua) | Minecraft (RCON) | Rust (WebRCON) | ARK (RCON) |
|------|---------------------|------------------|----------------|------------|
| 广播 | `game.print(msg)` | `say msg` | `say msg` | `AdminCheat Broadcast msg` |
| 发物品 | `player.insert{name,count}` | `give player item count` | `inv.giveplayer player item count` | `AdminCheat GiveItemNum id qty quality 0` |
| 踢人 | `player.kick(reason)` | `kick player reason` | `kick player reason` | `AdminCheat KickPlayer steamid` |
| 封禁 | — | `ban player reason` | `ban player reason` | `AdminCheat BanPlayer steamid` |
| 玩家列表 | 日志解析 | `list` | `players` | `listplayers` |
| 保存 | `/server-save` | `save-all` | `save.all` | `AdminCheat SaveWorld` |
| 停止 | 杀进程 | `stop` | `quit` | `AdminCheat DoExit` |
| 设置时间 | — | `time set day` | `env.time 12` | `AdminCheat SetTimeOfDay 12:00` |
| 设置天气 | — | `weather clear` | `env.weather clear` | — |

## 附录 C：Pack schema 完整字段定义（草稿）

```typescript
interface GamePack {
  pack: {
    id: string;              // 唯一标识，如 'minecraft-vanilla'
    game: GameType;          // minecraft / factorio / rust / ark
    variant: string;         // vanilla / paper / spigot
    display_name: string;
    version: string;         // Pack 自身版本
  };
  startup: {
    binary: string;          // java / ./factorio / ./RustDedicated
    args: string[];          // 模板化参数
    working_dir: string;     // 模板化路径
    ready_pattern: string;   // 就绪日志正则
    stop_command: string | null;
    stop_timeout: number;
  };
  protocol: {
    type: 'rcon' | 'stdin' | 'webrcon';
    default_port: number;
    auth: 'password' | 'none';
    encrypt: 'none' | 'tls';
    config_key?: {
      file: string;
      enable_key: string;
      port_key: string;
      password_key: string;
    };
  };
  config: {
    format: 'properties' | 'json' | 'ini' | 'yaml';
    main_file: string;
    schema: ConfigField[];
  };
  commands: Record<string, string>;  // action → 命令模板
  versions: {
    source: string;
    manifest_url: string;
    type: 'server-jar' | 'binary' | 'steamcmd';
    download_pattern: string;
    eula_required: boolean;
    eula_file?: string;
  };
  backup: {
    world_dir: string;
    pre_backup_commands: string[];
    post_backup_commands: string[];
  };
  ui: {
    tabs: InstanceTab[];
  };
  resources: {
    min_ram: string;
    recommended_ram: string;
    min_disk: string;
  };
}
```
