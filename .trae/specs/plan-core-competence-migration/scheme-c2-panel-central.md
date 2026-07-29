# 方案 C-2：Panel 业务能力集中方案

> 锚点文档：遵循 rules-5 三段交接结构
> 关联项目：gameserver-panel（P0 平台骨架）/ factorio（v2.16.0 业务实现）
> 阶段：S1 多方案对抗 → 单方案细化（C 激进倾向已选定，本文为 C-2 定向细化）
> 状态：待 GN-004 审查 + 人类裁决（[V] 节点）

---

## 〇、三段交接结构

### (1) 工程过程

- 2026-07-02：完成 gameserver-panel P0 平台骨架（4 表 / 4 页面 / Panel+Daemon 双层架构）
- 2026-07-02：完成 factorio 项目结构勘察（17 表 / 16 服务 / 21 页面 / 完整业务链路）
- 2026-07-02：用户选定方案倾向 C（激进：混合架构 + 参考重写 + 用户价值优先）
- 2026-07-02：架构师选定 C-2 定向（Panel 业务能力集中，Daemon 最小化）
- 2026-07-02：本文档生成，涵盖架构/DB/模块/流程/迁移/风险/验证 7 章

### (2) 交接状态

- **当前状态**：方案文档编写完成，待 GN-004 独立审查 + 人类裁决
- **未闭合项**：
  - [V] 节点：本方案定稿需人类裁决（架构方向锁定）
  - Knex migrations 目录尚未建立（属 S3 模块拆分后产出）
  - 数据迁移脚本属 S4 并行开发产出，本文仅设计映射规则
- **阻塞项**：无
- **下一步**：GN-004 审查通过 + 人类裁决 → S2 契约冻结（s0201 生成三层契约）→ S3 模块拆分

### (3) 最终结果

- **产出物**：本方案文档（`scheme-c2-panel-central.md`）
- **验证结论**：方案基于两项目实际代码勘察（非凭空设计），关键业务流程与 factorio v2.16.0 实现对齐，DB schema 处理了 id 类型差异与 instance_id→server_id 映射
- **可继续推进性**：本文档通过审查后，可直接进入 S2 契约冻结（Pack schema 扩展 / WS 事件协议 / DB schema 三层契约）

---

## 一、架构总览

### 1.1 设计原则

**核心原则**：业务逻辑尽可能集中在 Panel backend，Daemon 仅做进程生命周期管理 + RCON/stdin 命令代理 + 日志解析与事件上报。Panel 通过 WS 双向通信接收 Daemon 上行的事件，处理后下发命令。

**这样设计的理由**：
1. 业务规则（VIP/限额/乐观锁）需要集中访问 DB，Daemon 端无 DB，集中化避免数据同步问题
2. Panel 故障时全部节点不可用是可接受代价（运维面板本身不是高可用系统），换来的是业务逻辑单一真相源
3. Daemon 保持无状态/无业务，可被任意替换或重启，降低部署耦合

### 1.2 Panel / Daemon 职责矩阵

| 能力域 | Panel backend | Daemon | 说明 |
|--------|:---:|:---:|------|
| 用户管理 / 认证 / JWT | ✅ | ❌ | Panel 独占，Daemon 用 daemon_token 鉴权 |
| VIP 等级 / 权限 / 限额 | ✅ | ❌ | 集中查 DB，admin 跳过校验 |
| 商店商品 / 订单 / 乐观锁 | ✅ | ❌ | 全程 Panel 处理 |
| CDK 生成 / 兑换 / 乐观锁 | ✅ | ❌ | 全程 Panel 处理 |
| 物品发放命令构建 | ✅ | ❌ | Panel 构建 RCON/Lua 命令字符串 |
| 命令队列 / 成就预热 / 重试 | ✅ | ❌ | Panel 端 commandDispatcher，下发到 Daemon |
| 聊天监控 / !verify / !claim | ✅ | ❌ | Panel 订阅 Daemon 上行 chat 事件并处理 |
| 玩家加入 / 礼包 / 欢迎语 | ✅ | ❌ | Panel 订阅 join 事件，下发 give/say 命令 |
| 定时消息 | ✅ | ❌ | Panel 端 scheduler 定时器，到点下发 |
| 投票踢人 / 阈值判定 | ✅ | ❌ | Panel 解析投票，达标下发 kick |
| 事件总线 / 调度器 | ✅ | ❌ | Panel 内部 EventEmitter + 定时器 |
| 物品同步 / 系统设置 | ✅ | ❌ | Panel 独占 |
| 进程生命周期管理 | ❌ | ✅ | spawn/stop/状态机 |
| RCON / stdin 协议客户端 | ❌ | ✅ | Daemon 持有协议连接 |
| **日志解析（chat/join/leave）** | ❌ | ✅ | **Daemon 按 Pack log_parsers 解析 stdout，WS 上行事件** |
| 命令执行（RCON/stdin 发送） | ❌ | ✅ | 接收 Panel 下发命令，调用协议客户端 |
| 资源监控（CPU/内存） | ❌ | ✅ | 按需采集上报 |
| 日志持久化 | ✅ | 部分 | Daemon 上行 console.output，Panel 落库 |

### 1.3 数据流图（关键业务流程的数据流向）

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Panel Frontend (React)                        │
│   Servers / Shop / CDK / ChatEnhancement / Players / Orders ...      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API + WebSocket
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Panel Backend (Express)                         │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────────┐ │
│  │  REST 路由   │  │  WS 服务端   │  │     业务服务层（全部业务）     │ │
│  │  /api/shop  │  │  (推前端)    │  │  userService / vipService    │ │
│  │  /api/cdk   │  │             │  │  shopService / cdkService    │ │
│  │  /api/chat  │  │             │  │  chatMonitor / joinHandler   │ │
│  │  /api/votes │  │             │  │  voteService / periodicMsg   │ │
│  └──────┬──────┘  └──────▲──────┘  │  commandDispatcher           │ │
│         │                │         │  eventBus / scheduler        │ │
│         │                │         │  playerTracker / itemSync    │ │
│  ┌──────▼──────────────────────────┴──────────────────────────────┐ │
│  │                    事件处理层（Panel 内部）                       │ │
│  │  订阅 DaemonEventStream 上行事件 → 路由到 chatMonitor/joinHandler│ │
│  │  commandDispatcher 下发命令 → DaemonClient.sendCommand()        │ │
│  └──────┬──────────────────────────────────────────▲───────────────┘ │
│         │ REST (启动/停止/状态)       WS 下行 (sendCommand)           │
│         │                              │                              │
│  ┌──────▼──────────────────────────────▼──────────────────────────┐  │
│  │              daemonClient (REST + WS 双通道)                    │  │
│  │  DaemonEventStream (WS 上行事件接收) + DaemonRest (REST 调用)   │  │
│  └──────┬──────────────────────────────▲──────────────────────────┘  │
└─────────┼──────────────────────────────┼─────────────────────────────┘
          │ HTTP REST                     │ WebSocket (双向)
          │ (Bearer Token)                │ (query token)
┌─────────▼──────────────────────────────▼─────────────────────────────┐
│                         Daemon (Express + ws)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ HTTP 路由     │  │ WS 服务端     │  │   日志解析器 (logParsers)   │  │
│  │ /start /stop │  │ /ws           │  │  按 Pack.log_parsers 正则   │  │
│  │ /state       │  │               │  │  解析 stdout → 生成事件     │  │
│  │ /command     │  │ 接收 subscribe│  │  chat.event / player.join   │  │
│  │              │  │ 接收 sendCmd  │  │  player.leave               │  │
│  └──────┬───────┘  └───────┬───────┘  └─────────────┬──────────────┘  │
│         │                  │                        │                 │
│  ┌──────▼──────────────────▼────────────────────────▼───────────────┐ │
│  │            InstanceManager (进程生命周期)                         │ │
│  │  processDriver (spawn) + stateMachine (状态流转)                 │ │
│  │  protocolClient (RCON / stdin) ← 接收 Panel 下发命令执行          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
                               │
                        ┌──────▼──────┐
                        │  游戏进程    │  (Minecraft / Factorio / ...)
                        │  (stdout)   │
                        └─────────────┘
```

**关键数据流说明**：

1. **Daemon → Panel 上行（WS 事件）**：
   - `console.output`：原始日志行（保留现有）
   - `chat.event`：**新增**，Daemon 日志解析器匹配到聊天行后生成，含 username/message/type
   - `player.join`：**新增**，匹配到加入行后生成，含 player 名
   - `player.leave`：**新增**，匹配到离开行后生成，含 player 名
   - `state.change` / `instance.started` / `instance.stopped`：保留现有

2. **Panel → Daemon 下行（WS 命令）**：
   - `subscribe`：保留现有，订阅实例事件
   - `sendCommand`：**新增**，Panel 下发 RCON/stdin 命令字符串，Daemon 调用协议客户端执行

3. **Panel → Daemon REST**（保留现有）：`/start` `/stop` `/state` `/command`

### 1.4 Pack schema 扩展设计

现有 Pack schema（`public/schema/pack-schema.ts`）需扩展 3 个字段。**扩展走 s0601 契约变更流程，不直接编辑 public/ 文件**。

#### 1.4.1 `log_parsers` 字段（核心扩展）

描述如何从游戏 stdout 日志解析 chat/join/leave 事件。Daemon 端日志解析器读取此配置，替代 factorio eventBus 中硬编码的正则。

```yaml
log_parsers:
  chat:
    # 正则匹配聊天行，捕获组：1=类型(team/chat，可空) 2=用户名 3=消息
    pattern: '^\s*\[CHAT\]\s*(?:\((team|force)\)\s+)?(\S+):\s*(.+)$'
    flags: 'i'
    # 捕获组索引（从1开始），用于提取字段
    groups:
      type: 1        # 可选，缺失时默认 'chat'
      username: 2
      message: 3
  join:
    # 支持多个正则，按顺序匹配，第一个命中即返回
    patterns:
      - '\[JOIN\]\s+(\S+)\s+joined the game'
      - '^(\S+)\s+joined the game'
      - "'([^']+)'\s+joined the game"
    flags: 'i'
    groups:
      player: 1
  leave:
    patterns:
      - '\[LEAVE\]\s+(\S+)\s+left the game'
      - '^(\S+)\s+left the game'
      - "'([^']+)'\s+left the game"
    flags: 'i'
    groups:
      player: 1
```

**设计要点**：
- 不同游戏的日志格式差异大（Factorio `[CHAT]`、Minecraft `<player> message`），必须由 Pack 描述
- 捕获组索引化设计，避免正则改写时字段错位
- `patterns` 数组支持多格式兼容（新旧版本/多种日志形态）
- 未配置 `log_parsers` 的 Pack，Daemon 不解析业务事件，仅上行 `console.output`

#### 1.4.2 `items` 字段（物品池）

```yaml
items:
  # 物品同步源（GitHub raw / 本地文件）
  sync_source: 'https://raw.githubusercontent.com/.../items.json'
  # 物品列表（可由 sync_source 自动填充，也可手动维护）
  list:
    - name: 'iron-plate'
      display_name: '铁板'
      category: 'material'
    - name: 'copper-plate'
      display_name: '铜板'
      category: 'material'
```

#### 1.4.3 `commands` 模板扩展

现有 `commands` 是 `Record<string, string>`，扩展为支持模板变量：

```yaml
commands:
  give: "/silent-command game.players['{player}'].insert{name='{item}',count={count},quality='{quality}'}"
  give_minecraft: "give {player} {item} {count}"
  kick: "/silent-command game.kick_player('{player}')"
  kick_minecraft: "kick {player}"
  ban: "/silent-command game.ban_player('{player}', '{reason}')"
  broadcast: "/silent-command game.print('{message}')"
  say_private: "/silent-command if game.players['{player}'] then game.players['{player}'].print('{message}') end"
```

**模板变量**：`{player}` `{item}` `{count}` `{quality}` `{message}` `{reason}`，由 Panel 端 commandDispatcher 在构建命令时填充。Pack 按 game type 选择对应模板（如 Factorio 用 `give`，Minecraft 用 `give_minecraft`）。

#### 1.4.4 Zod schema 扩展要点（契约层，s0201 落地）

- `log_parsers`：可选字段（向后兼容现有 minecraft-vanilla Pack），未配置时 Daemon 不解析业务事件
- `items`：可选字段
- `commands`：保持 `z.record(z.string(), z.string())`，模板变量由运行时替换
- **向后兼容**：所有扩展字段均为 optional，现有 Pack 无需修改即可加载

---

## 二、数据库 schema 设计

### 2.1 设计原则

1. **保留 gameserver-panel 现有 4 表**（users/nodes/servers/packs），结构兼容
2. **instance_id → server_id 映射**：factorio 业务表用 `instance_id`，迁移后统一用 `server_id`（外键 → `servers.id`，string 类型）
3. **users.id 类型差异处理**：gameserver-panel 用 `string`，factorio 用 `integer`。新增业务表的 `user_id` 外键统一用 `string` 对应 gameserver-panel 的 `users.id`
4. **game_player_name 泛化**：factorio 的 `factorio_player_name` 泛化为 `game_player_name`，支持多游戏
5. **所有业务表按 server_id 隔离**，对应 servers 表

### 2.2 完整表清单

#### 现有表（保留 + 扩展）

| # | 表名 | 说明 | 变更 |
|---|------|------|------|
| 1 | users | 用户认证 | **扩展**：vip_level / vip_expires_at / is_verified / game_player_name |
| 2 | nodes | 节点 | 不变 |
| 3 | servers | 服务器实例 | 不变（对应 factorio 的 instances） |
| 4 | packs | Pack 注册 | 不变 |

#### 新增表

| # | 表名 | 说明 | 优先级 |
|---|------|------|:---:|
| 5 | vip_permissions | VIP 等级权限映射 | P1 |
| 6 | player_bindings | 玩家游戏名绑定 | P1 |
| 7 | shop_items | 商品目录 | P2 |
| 8 | shop_orders | 订单头 | P2 |
| 9 | shop_order_items | 订单明细 | P2 |
| 10 | item_sync_log | 物品同步日志 | P1 |
| 11 | system_config | 系统配置（KV） | P1 |
| 12 | chat_settings | 聊天全局配置 | P3 |
| 13 | chat_trigger_responses | 自定义触发响应规则 | P3 |
| 14 | player_join_settings | 玩家加入配置 | P3 |
| 15 | periodic_messages | 定时消息任务 | P3 |
| 16 | vote_settings | 投票踢人配置 | P3 |
| 17 | votes | 投票记录 | P3 |
| 18 | vote_records | 投票明细 | P3 |
| 19 | cdk_codes | CDK 兑换码 | P2 |
| 20 | player_histories | 玩家登录历史 | P3 |
| 21 | gift_claims | 礼包领取记录 | P3 |
| 22 | command_queue | 命令下发队列（成就预热/重试） | P1 |
| 23 | audit_logs | 审计日志 | P5 |
| 24 | mod_records | Mod 管理记录 | P4 |
| 25 | save_records | 存档记录 | P4 |
| 26 | backup_records | 备份记录 | P4 |
| 27 | monitor_snapshots | 监控快照 | P4 |
| 28 | list_entries | 名单（黑白名单） | P4 |

### 2.3 关键表字段设计

> 以下仅列出与 factorio 存在差异或需要泛化的关键字段。与 factorio 完全一致的表（如 vote_settings）字段直接复用，仅 `instance_id` → `server_id`。

#### users（扩展）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string PK | 保留现有（UUID） |
| email | string UNIQUE | 保留现有 |
| username | string | 保留现有 |
| password_hash | string | 保留现有 |
| role | string | 保留现有（system_admin/admin/operator/viewer） |
| status | string | 保留现有 |
| **vip_level** | integer DEFAULT 0 | **新增**，0-5+ |
| **vip_expires_at** | text NULL | **新增**，VIP 过期时间 |
| **is_verified** | boolean DEFAULT false | **新增**，是否已验证 |
| **game_player_name** | string(100) NULL | **新增**，泛化自 factorio_player_name |
| last_login_at | text NULL | 新增（factorio 有） |
| last_login_ip | string(45) NULL | 新增 |
| created_at | text | 保留现有 |

**索引**：idx_users_username / idx_users_role / idx_users_status

#### vip_permissions

| 字段 | 类型 | 说明 |
|------|------|------|
| vip_level | integer PK | 0-5+ |
| display_name | string(50) | 显示名 |
| permissions | text | JSON 数组，权限列表 |
| max_quality | string(20) NULL | 可购最高品质（none/normal/uncommon/rare/epic/legendary），NULL=默认规则 |
| daily_limit | integer NULL | 每日购买限额，NULL=默认规则（=vip_level） |
| created_at / updated_at | timestamp | |

#### player_bindings

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| user_id | string NOT NULL | **FK → users.id**（string，与 factorio integer 不同） |
| game_player_name | string(100) NOT NULL | **泛化**自 factorio_player_name |
| game_type | string(20) NOT NULL | **新增**，minecraft/factorio/...（同一用户可绑定不同游戏） |
| verify_code | string(6) NOT NULL | |
| status | string(20) DEFAULT 'pending' | pending/verified/rejected |
| verified_at | timestamp NULL | |
| created_at / updated_at | timestamp | |

**唯一约束**：`(user_id, game_type)` UNIQUE、`(game_player_name, game_type, status)` UNIQUE

#### shop_items

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| **server_id** | string(64) NOT NULL | **FK → servers.id**（替代 instance_id） |
| item_name | string(100) NOT NULL | |
| display_name | string(200) NULL | |
| category | string(50) NULL | |
| quality | string(20) DEFAULT 'normal' | |
| vip_level_required | integer DEFAULT 0 | deprecated，改用 vip_permissions |
| daily_limit | integer NULL | NULL=无限 |
| enabled | boolean DEFAULT false | |
| created_at / updated_at | timestamp | |

**唯一约束**：`(server_id, item_name)` UNIQUE
**索引**：idx_shop_items_server_id

#### shop_orders

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| **server_id** | string(64) NOT NULL | 替代 instance_id |
| user_id | string NOT NULL | **FK → users.id**（string） |
| status | string(20) DEFAULT 'pending' | pending/claiming/claimed/expired |
| claim_code | string(8) NOT NULL UNIQUE | |
| items_count | integer DEFAULT 0 | |
| claimed_at | timestamp NULL | |
| expires_at | timestamp NOT NULL | 24 小时 |
| claimed_player | string(100) NULL | 兑换时游戏内玩家名 |
| created_at | timestamp | |

**索引**：idx_shop_orders_user_id / idx_shop_orders_status / idx_shop_orders_claim_code / idx_shop_orders_server_id

#### cdk_codes

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| code | string(8) NOT NULL UNIQUE | |
| **server_id** | string(64) NOT NULL | 替代 instance_id |
| rewards | text NOT NULL | JSON 数组 [{item_name, quality, quantity}] |
| batch_id | string(64) NOT NULL | |
| note | text NULL | |
| created_by | string NOT NULL | **FK → users.id**（string） |
| created_at | timestamp | |
| expires_at | timestamp NULL | NULL=永久 |
| status | string(20) DEFAULT 'unused' | unused/claiming/claimed/disabled |
| claimed_by | string NULL | FK → users.id |
| claimed_at | timestamp NULL | |
| claimed_player | string(100) NULL | |

**索引**：idx_cdk_codes_code / idx_cdk_codes_server_id / idx_cdk_codes_batch_id / idx_cdk_codes_status

#### chat_settings / chat_trigger_responses / player_join_settings / periodic_messages / vote_settings / votes / vote_records

字段与 factorio 完全一致，仅 `instance_id` → `server_id`（string(64)），不再赘述。

#### player_histories（新增，对应 factorio instanceStateStore 的持久化部分）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| server_id | string(64) NOT NULL | |
| game_player_name | string(100) NOT NULL | |
| first_join_at | timestamp NOT NULL | 首次加入时间 |
| last_login_at | timestamp NULL | 最后登录 |
| last_logout_at | timestamp NULL | 最后登出 |
| total_playtime_seconds | integer DEFAULT 0 | 总游戏时长 |

**唯一约束**：`(server_id, game_player_name)` UNIQUE

#### gift_claims（新增，对应 factorio instanceStateStore 的礼包领取记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| server_id | string(64) NOT NULL | |
| game_player_name | string(100) NOT NULL | |
| gift_type | string(20) NOT NULL | first/relogin |
| claimed_at | timestamp NOT NULL | |
| claim_date | string(10) NOT NULL | YYYY-MM-DD，用于日限统计 |

**索引**：idx_gift_claims_server_player_type / idx_gift_claims_date

#### command_queue（新增，Panel 端命令下发队列）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer PK AUTO | |
| server_id | string(64) NOT NULL | |
| command | text NOT NULL | 完整命令字符串 |
| status | string(20) DEFAULT 'pending' | pending/sent/confirmed/failed |
| retry_count | integer DEFAULT 0 | |
| created_at | timestamp | |
| sent_at | timestamp NULL | |
| confirmed_at | timestamp NULL | |

**说明**：Panel 端 commandDispatcher 用此表持久化待发送命令，支持宕机恢复。对应 factorio commandDispatcher 的内存队列（pendingCommands / awaitingConfirmation）。

### 2.4 Knex migrations 文件命名规范

**目录**：`panel/backend/src/db/migrations/`（新建）

**命名格式**：`YYYYMMDDHHMMSS_动词_表名_简述.ts`

**动词**：`create` / `alter` / `drop` / `seed`

**示例**：

```
20260702100000_create_users_extend_vip_fields.ts
20260702100100_create_vip_permissions_table.ts
20260702100200_create_player_bindings_table.ts
20260702110000_create_shop_items_table.ts
20260702110100_create_shop_orders_table.ts
20260702110200_create_shop_order_items_table.ts
20260702110300_create_cdk_codes_table.ts
20260702120000_create_chat_settings_table.ts
...
20260702130000_create_command_queue_table.ts
```

**迁移规则**（遵循项目规则 1.md）：
- 版本更新时数据库字段变更必须做迁移脚本前置处理，方便热更新
- 每个 migration 必须幂等（hasTable/hasColumn 检查）
- 新增字段用 `alter` + `hasColumn` 守卫，保证向前兼容
- 迁移脚本在 Panel backend 启动时自动执行（`db.migrate.latest()`）

---

## 三、模块拆分与实施顺序

### 3.1 优先级分组（用户价值优先）

```
P1 基础设施 + 用户/VIP
  ├── eventBus（Panel 内部事件总线）
  ├── scheduler（Panel 端定时器）
  ├── commandDispatcher（Panel 端命令队列 + 成就预热 + 下发）
  ├── itemSyncService（物品池同步）
  ├── systemConfigService（系统配置 KV）
  ├── userService（用户 CRUD + 角色）
  ├── vipService（VIP 等级 + 权限 + 限额）
  └── Daemon 端日志解析器（按 Pack.log_parsers 解析，WS 上行事件）

P2 商店 + CDK + 物品发放
  ├── shopService（商品 + 订单 + 乐观锁）
  ├── cdkService（CDK 生成 + 兑换 + 乐观锁）
  ├── bindingService（玩家绑定 + !verify）
  └── Daemon WS sendCommand 通道（接收 Panel 下发命令）

P3 聊天增强 P1-P4
  ├── chatMonitor（订阅 chat 事件 + !verify/!claim + 自动回复）
  ├── joinHandler（订阅 join 事件 + 欢迎语 + 礼包）
  ├── playerTracker（基于 join/leave 维护在线列表）
  ├── periodicMessageService（定时消息）
  └── voteService（投票踢人 + 阈值判定）

P4 Mod / 存档 / 备份 / 监控 / 玩家 / 名单
  ├── modService（Mod 管理）
  ├── saveService（存档管理）
  ├── backupService（备份管理）
  ├── monitorService（资源监控，Daemon 采集上报）
  ├── playerService（玩家历史 + 在线列表查询）
  └── listService（黑白名单）

P5 日志持久化 / 版本下载 / 热更新 / Webhook / 系统设置
  ├── logService（日志持久化落库）
  ├── versionService（版本下载 + manifest）
  ├── updateService（热更新）
  ├── webhookService（Webhook 通知）
  └── systemConfigService 完善（系统设置 UI）
```

### 3.2 各组详细清单

#### P1：基础设施 + 用户/VIP

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|:---:|------|------|
| eventBus | Panel | 无 | `panel/backend/src/core/eventBus.ts` |
| scheduler | Panel | 无 | `panel/backend/src/core/scheduler.ts` |
| commandDispatcher | Panel | eventBus / daemonClient | `panel/backend/src/core/commandDispatcher.ts` |
| itemSyncService | Panel | systemConfig | `panel/backend/src/services/itemSyncService.ts` |
| systemConfigService | Panel | db | `panel/backend/src/services/systemConfigService.ts` |
| userService | Panel | db | `panel/backend/src/services/userService.ts` + `routes/users.ts` |
| vipService | Panel | db / userService | `panel/backend/src/services/vipService.ts` + `routes/vip.ts` |
| 日志解析器 | Daemon | Pack loader | `daemon/src/instances/logParser.ts` |
| WS 协议扩展 | 双端 | ws-events 契约 | `public/schema/ws-events.ts`（s0601 变更） |

**P1 闭合判据**：
- eventBus 可订阅/发布 chat/join/leave 事件（Panel 内部）
- commandDispatcher 可下发命令到 Daemon 并接收执行确认
- Daemon 日志解析器能按 Pack.log_parsers 解析 Factorio stdout 并上行 chat.event/player.join
- VIP 等级与限额查询可用

#### P2：商店 + CDK + 物品发放

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|:---:|------|------|
| shopService | Panel | db / vipService / commandDispatcher | `services/shopService.ts` + `routes/shop.ts` + `routes/shopAdmin.ts` |
| cdkService | Panel | db / commandDispatcher | `services/cdkService.ts` + `routes/cdk.ts` |
| bindingService | Panel | db / chatMonitor | `services/bindingService.ts` + `routes/bindings.ts` |
| sendCommand 通道 | Daemon | WS server | `daemon/src/server.ts`（扩展 WS 消息处理） |
| 前端商店/CDK页 | Frontend | api client | `pages/Shop.tsx` / `pages/Orders.tsx` / `pages/CdkAdmin.tsx` / `pages/ShopAdmin.tsx` |

**P2 闭合判据**：
- 商店下单 → 生成 claim_code → 游戏 !claim → 物品发放全流程通
- CDK 批量生成 → 游戏 !claim → 物品发放全流程通
- 乐观锁 pending→claiming→claimed 状态流转正确

#### P3：聊天增强 P1-P4

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|:---:|------|------|
| chatMonitor | Panel | eventBus / commandDispatcher / shopService / cdkService / bindingService | `services/chatMonitor.ts` + `routes/chat.ts` + `routes/chatSettings.ts` |
| joinHandler | Panel | eventBus / commandDispatcher / playerTracker / vipService | `services/joinHandler.ts` + `routes/playerJoin.ts` |
| playerTracker | Panel | eventBus | `services/playerTracker.ts` |
| periodicMessageService | Panel | scheduler / commandDispatcher | `services/periodicMessageService.ts` + `routes/periodicMessages.ts` |
| voteService | Panel | eventBus / commandDispatcher / playerTracker | `services/voteService.ts` + `routes/votes.ts` |
| 前端聊天增强页 | Frontend | api client | `pages/ChatEnhancement.tsx` + `instance-detail/*` 子组件 |

**P3 闭合判据**：
- P1 欢迎礼包：玩家加入 → 首次礼包/回归礼包发放
- P2 定时消息：到点自动广播
- P3 关键词触发：自定义规则匹配 + 自动回复
- P4 投票踢人：投票发起 → 阈值判定 → kick 执行

#### P4：Mod / 存档 / 备份 / 监控 / 玩家 / 名单

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|:---:|------|------|
| modService | Panel + Daemon | db / Daemon 文件操作 | `services/modService.ts` + `routes/mods.ts` + Daemon 文件 API |
| saveService | Panel + Daemon | Daemon 文件操作 | `services/saveService.ts` + `routes/saves.ts` |
| backupService | Panel + Daemon | Daemon 文件操作 / scheduler | `services/backupService.ts` + `routes/backups.ts` |
| monitorService | Panel + Daemon | Daemon 资源采集 | `services/monitorService.ts` + `routes/monitor.ts` + Daemon 采集上报 |
| playerService | Panel | db / playerTracker | `services/playerService.ts` + `routes/players.ts` |
| listService | Panel | db / commandDispatcher | `services/listService.ts` + `routes/lists.ts` |
| 前端页面 | Frontend | api client | `pages/Mods.tsx` / `pages/Saves.tsx` / `pages/Backups.tsx` / `pages/Monitor.tsx` / `pages/Players.tsx` / `pages/Lists.tsx` |

#### P5：日志持久化 / 版本下载 / 热更新 / Webhook / 系统设置

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|:---:|------|------|
| logService | Panel | db / eventBus | `services/logService.ts` + `routes/logs.ts` |
| versionService | Panel | db / Pack versions | `services/versionService.ts` + `routes/version.ts` |
| updateService | Panel | versionService / scheduler | `services/updateService.ts` |
| webhookService | Panel | eventBus / scheduler | `services/webhookService.ts` |
| 系统设置完善 | Panel + Frontend | systemConfigService | `pages/Settings.tsx` / `pages/Config.tsx` |

### 3.3 依赖关系图

```
P1 eventBus ──┬──→ P3 chatMonitor ──→ P2 shopService（!claim 调用）
              ├──→ P3 joinHandler ──→ P3 playerTracker
              └──→ P3 voteService
P1 commandDispatcher ──→ P2 shopService（物品发放）
                     └──→ P3 全部模块（命令下发）
P1 vipService ──→ P2 shopService（品质/限额校验）
P2 bindingService ──→ P3 chatMonitor（!verify 调用）
P1 systemConfigService ──→ P5 全部
P1 itemSyncService ──→ P2 shopService（物品池）
```

**并行可能性**：
- P1 内部：eventBus / scheduler / systemConfigService 可并行（无依赖）
- P2 与 P3：shopService/cdkService 与 chatMonitor 有依赖（!claim），但 joinHandler/voteService 可与 P2 并行
- P4 各模块相互独立，可并行
- P5 各模块相互独立，可并行

---

## 四、关键业务流程

### 4.1 商店下单 + 领取流程

**Panel 全程处理，Daemon 仅执行 RCON**

```
[下单阶段] Panel frontend → Panel backend
  1. 用户在商店页选择物品 + 品质 + 数量
  2. POST /api/shop/orders { server_id, items: [{item_id, quantity, quality}] }
  3. Panel shopService.createOrder():
     a. 事务外校验物品存在性 + 启用状态 + 同 server_id
     b. 生成 8 位 claim_code（去易混淆字符，DB 唯一性重试）
     c. 事务内：
        - 查用户 VIP 等级（vipService.getEffectiveVipLevel）
        - 校验品质 tier ≤ VIP 允许的 max_quality（admin 跳过）
        - 校验每日限额（聚合查询当日已下单数量，admin 跳过）
        - 插入 shop_orders（status=pending）+ shop_order_items
     d. 返回订单详情 + claim_code

[领取阶段] 游戏内 !claim → Daemon → Panel → Daemon
  1. 玩家在游戏内发送 "!claim ABCD1234"
  2. Daemon 日志解析器匹配 chat 正则 → 生成 chat.event {username, message:"!claim ABCD1234"}
  3. Daemon WS 上行 chat.event 到 Panel
  4. Panel eventBus 发布 chat 事件 → chatMonitor 订阅处理
  5. chatMonitor 解析 "!claim" 命令 → 提取 code
  6. chatMonitor 调用 cdkService.findCodeInInstance(code, server_id)：
     - 找到 → cdkService.redeem()（CDK 流程，见 4.2）
     - 未找到 → 回退 shopService.claimOrder(code, playerName)
  7. shopService.claimOrder():
     a. 事务 + 乐观锁：UPDATE shop_orders SET status='claiming' WHERE claim_code=? AND status='pending'
     b. 更新 0 行 → 返回错误（已被提取/正在提取/过期）
     c. 更新 1 行 → 查订单明细，循环构建 give 命令
     d. 调用 commandDispatcher.dispatch(server_id, give_command)
        - commandDispatcher 通过 WS sendCommand 下发到 Daemon
        - Daemon 调用 RCON/stdin 发送命令
     e. 全部成功 → UPDATE status='claimed', claimed_at=now
     f. 部分失败 → UPDATE status='pending'（回滚，允许重试）
  8. chatMonitor 通过 commandDispatcher 下发 say_private 命令通知玩家结果
```

### 4.2 CDK 兑换流程

**Daemon 上行 chat 事件 → Panel 解析 !claim → Panel 查 CDK → Panel 下发 give 命令**

```
  1. 玩家游戏内发送 "!claim XYZ12345"
  2. Daemon 日志解析 → chat.event 上行 Panel
  3. Panel chatMonitor 解析 !claim → 调用 cdkService.findCodeInInstance(code, server_id)
  4. 找到 CDK → cdkService.redeem(code, playerName, server_id):
     a. 校验 code 长度（8 位）+ playerName 合法性
     b. 事务 + 乐观锁：UPDATE cdk_codes SET status='claiming' WHERE code=? AND server_id=? AND status='unused'
     c. 更新 0 行 → 查实际状态返回错误（已被使用/正在兑换/已禁用/过期）
     d. 更新 1 行 → 解析 rewards JSON，循环构建 give 命令
     e. commandDispatcher.dispatch(server_id, give_command) → WS sendCommand → Daemon RCON
     f. 全部成功 → UPDATE status='claimed', claimed_at, claimed_player
     g. 部分失败 → UPDATE status='unused'（回滚，允许重试）
  5. chatMonitor 下发 say_private 通知玩家兑换结果
```

### 4.3 聊天 !verify 流程

**Daemon 上行 chat → Panel 解析 → Panel 校验绑定 → Panel 下发 say 命令**

```
  1. 玩家游戏内发送 "!verify ABC123"
  2. Daemon 日志解析 → chat.event {username:"player_x", message:"!verify ABC123"} 上行 Panel
  3. Panel eventBus 发布 chat → chatMonitor 订阅
  4. chatMonitor 解析 "!verify" 命令 → 提取 verify_code
  5. chatMonitor 调用 bindingService.verifyBinding(game_player_name, verify_code):
     a. 查 player_bindings WHERE game_player_name=? AND verify_code=? AND status='pending'
     b. 找到 → UPDATE status='verified', verified_at=now
     c. 未找到 → 返回错误（验证码无效/已验证）
  6. chatMonitor 通过 commandDispatcher 下发 say_private 命令：
     "/silent-command if game.players['player_x'] then game.players['player_x'].print('验证成功') end"
  7. commandDispatcher → WS sendCommand → Daemon RCON 执行
```

### 4.4 玩家加入礼包流程

**Daemon 上行 join → Panel 处理 → Panel 下发 give 命令**

```
  1. 玩家加入游戏，stdout 输出 "player_x joined the game"
  2. Daemon 日志解析器按 Pack.log_parsers.join 正则匹配 → 生成 player.join {player:"player_x"}
  3. Daemon WS 上行 player.join 到 Panel
  4. Panel eventBus 发布 player:join → joinHandler 订阅
  5. joinHandler.handlePlayerJoin():
     a. 防抖：同一 server_id + player 在 join_debounce_ms 内只处理最后一次
     b. 加载 player_join_settings（按 server_id）
     c. 判断是否首次加入（player_histories 无记录）
     d. 记录登录（UPDATE/INSERT player_histories）
     e. 加载 server_name + online_count
     f. 广播欢迎语（broadcastMessageForServer → commandDispatcher → WS sendCommand → Daemon RCON）
     g. 若首次加入 + first_gift_enabled：
        - 检查 gift_claims 是否已领（防重发）
        - 循环构建 give 命令，间隔 gift_command_interval_ms
        - commandDispatcher.dispatch → WS sendCommand → Daemon RCON
        - 记录 gift_claims
        - 下发 say_private 通知玩家
     h. 若回归（离线时长 ≥ relogin_cooldown_hours）+ relogin_gift_enabled：
        - 日限/总限检查（gift_claims 聚合）
        - 发放回归礼包（同上）
  6. 玩家离开 → Daemon 上行 player.leave → joinHandler 记录登出 + 广播离开消息
```

---

## 五、数据迁移方案

### 5.1 迁移脚本设计

**迁移路径**：`/home/air/Desktop/factorio/backend/data/manager.db` → `/home/air/Desktop/gameserver-panel/panel/backend/data/panel.db`

**脚本位置**：`panel/backend/src/db/migrate-from-factorio.ts`（独立脚本，不随启动执行，手动运行）

**脚本设计**：
1. 只读打开 factorio manager.db（SQLite）
2. 读写打开 gameserver-panel panel.db（SQLite）
3. 按表顺序迁移，处理字段映射与 id 类型转换
4. 全程事务包裹，失败回滚
5. 输出迁移报告（每表迁移行数 / 失败行数 / 跳过原因）

### 5.2 字段映射

#### users 表

| factorio 字段 | panel 字段 | 转换规则 |
|--------------|-----------|---------|
| id (integer) | id (string) | `String(id)` 或生成 UUID（推荐 UUID 避免冲突） |
| username | username | 直接映射 |
| password_hash | password_hash | 直接映射 |
| role | role | 直接映射（system_admin/admin/operator/viewer 体系一致） |
| status | status | 直接映射 |
| display_name | — | 丢弃（panel 无此字段，或存入 username） |
| email | email | 直接映射 |
| vip_level | vip_level | 直接映射 |
| vip_expires_at | vip_expires_at | 直接映射 |
| is_verified | is_verified | 直接映射 |
| factorio_player_name | game_player_name | **字段名泛化** |
| last_login_at / last_login_ip | 同名 | 直接映射 |
| created_at / updated_at | created_at | 直接映射 |

**id 映射策略**：建立 `old_id → new_id` 映射表（内存 Map），后续表的外键 user_id 用此映射转换。推荐生成新 UUID，避免与 panel 已有用户冲突。

#### instances → servers

| factorio 字段 | panel 字段 | 转换规则 |
|--------------|-----------|---------|
| id (string, 'default'/'inst-xxx') | id (string) | **需要重新映射**为 panel 的 server UUID，建立映射表 |
| name | name | 直接映射 |
| version | — | 丢弃（panel 的 version 在 Pack 中） |
| port | port | 直接映射 |
| — | pack_id | 根据 factorio 实例推断（default → factorio-vanilla pack_id） |
| — | game_type | 'factorio' |
| — | node_id | 需人工指定（panel 的 node，默认单机 node） |
| — | owner_user_id | 映射到 panel users.id |
| — | rcon_port / rcon_password_enc | 从 factorio 配置推断 |
| shop_enabled / mod_enabled / is_default | — | 丢弃（panel 用 server 级配置） |

**关键**：factorio 的 instance_id（'default'）需要映射为 panel 的 server_id（UUID），建立 `old_instance_id → new_server_id` 映射表，所有业务表的 instance_id 用此转换。

#### shop_items / shop_orders / shop_order_items / cdk_codes

| factorio 字段 | panel 字段 | 转换规则 |
|--------------|-----------|---------|
| instance_id | server_id | 用 `old_instance_id → new_server_id` 映射表转换 |
| user_id (integer) | user_id (string) | 用 `old_user_id → new_user_id` 映射表转换 |
| created_by (integer) | created_by (string) | 同上 |
| claimed_by (integer) | claimed_by (string) | 同上 |
| 其余字段 | 同名 | 直接映射 |

#### player_bindings

| factorio 字段 | panel 字段 | 转换规则 |
|--------------|-----------|---------|
| user_id (integer) | user_id (string) | 映射表转换 |
| factorio_player_name | game_player_name | 字段名泛化 |
| — | game_type | 固定填 'factorio' |
| 其余字段 | 同名 | 直接映射 |

#### chat_settings / vote_settings / player_join_settings 等按 instance 隔离的配置表

- `instance_id` → `server_id`，用映射表转换
- 其余字段直接映射
- **注意**：factorio 的 default 实例配置迁移到 panel 的对应 server_id

#### vip_permissions

- 直接全表迁移，无 id 转换

#### item_sync_log / system_config

- 直接全表迁移

### 5.3 迁移执行步骤

```
1. 停止 factorio 服务（确保 manager.db 不再写入）
2. 备份 manager.db → manager.db.pre-migration
3. 备份 panel.db → panel.db.pre-migration
4. 运行 Panel 现有 migrations（确保 panel.db schema 最新）
5. 运行迁移脚本：
   node panel/backend/src/db/migrate-from-factorio.ts \
     --source /home/air/Desktop/factorio/backend/data/manager.db \
     --target /home/air/Desktop/gameserver-panel/panel/backend/data/panel.db
6. 检查迁移报告，核对行数
7. 启动 Panel，手动验证关键数据（用户/订单/CDK）
```

### 5.4 迁移注意事项

1. **id 类型转换是最大风险点**：factorio integer id → panel string id，必须保证映射表一致性，所有外键都要转换
2. **default 实例特殊处理**：factorio 的 'default' instance_id 必须映射到 panel 的某个 server_id，建议迁移前先在 panel 创建对应的 factorio server 记录
3. **时间戳格式**：factorio 用 Knex timestamp（ISO string），panel 用 text 存 ISO，格式兼容
4. **JSON 字段**：rewards / permissions / feature_keywords 等 JSON 字段直接迁移，无需转换
5. **跳过已迁移数据**：脚本支持 `--skip-existing` 参数，按唯一约束判断是否跳过，支持重试

---

## 六、风险与回退

### 6.1 关键风险点

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|:---:|---------|
| R1 | **WS 双向通信延迟**：Panel → Daemon sendCommand 有网络延迟，物品发放命令密集时可能堆积 | 玩家领取礼包延迟 | 中 | commandDispatcher 命令队列 + 间隔发送（gift_command_interval_ms），避免瞬时洪水 |
| R2 | **Panel 单点故障影响全部节点**：所有业务集中在 Panel，Panel 宕机则全部 server 的 !claim/!verify/礼包失效 | 业务全断 | 中 | Panel 端 command_queue 表持久化待发命令，Panel 恢复后重放；Daemon 持有 RCON 连接不中断，仅业务事件处理暂停 |
| R3 | **Daemon 日志解析器正则不准**：Pack.log_parsers 配置错误导致 chat/join/leave 事件丢失或误匹配 | 聊天增强功能失效 | 中 | 每个 Pack 的 log_parsers 必须附带测试用例（sample log lines），Daemon 加载时自测；提供日志回放工具用于验证 |
| R4 | **id 类型迁移错误**：integer → string 映射表不一致导致外键悬空 | 数据完整性破坏 | 高 | 迁移脚本严格校验外键完整性，失败行单独报告；迁移后运行一致性检查脚本 |
| R5 | **成就预热机制跨进程失效**：factorio commandDispatcher 的成就预热/重试依赖本地日志监听，迁移到 Panel 后无法直接监听 Daemon 日志 | 物品发放命令丢失 | 高 | Panel 端 commandDispatcher 改为基于 WS 事件确认（Daemon 上行 console.output 检测成就警告），或简化为超时重试机制 |
| R6 | **Pack log_parsers 向后兼容**：现有 minecraft-vanilla Pack 无 log_parsers，升级后 Daemon 不解析事件 | Minecraft 聊天增强失效 | 低 | log_parsers 设为 optional，P3 阶段为 minecraft-vanilla 补充 log_parsers 配置 |
| R7 | **多游戏命令模板差异**：Factorio 用 Lua（/silent-command），Minecraft 用原生命令（give/kick），commandDispatcher 命令构建需区分 | 物品发放/kick 命令在 Minecraft 失效 | 中 | Pack.commands 模板化，commandDispatcher 按 Pack.game_type 选择模板；P2 阶段先做 Factorio，Minecraft 在 P3 后补 |

### 6.2 回退方案

**场景 A：迁移后业务异常，需回退到 factorio 单体**

- 回退条件：核心业务（商店/CDK/聊天增强）在 Panel 上线后 48 小时内出现不可恢复故障
- 回退步骤：
  1. 停止 Panel backend
  2. 恢复 factorio 服务（manager.db.pre-migration 未被修改，可直接启动）
  3. Panel 已迁移的数据保留，待问题修复后重新增量迁移
- 回退成本：低（factorio manager.db 不变，数据无损）

**场景 B：Daemon 日志解析器故障，事件丢失**

- 回退条件：chat.event/player.join 上行缺失率 > 5%
- 回退步骤：
  1. Panel 端增加"原始日志回放"模式：订阅 console.output，Panel 内部用 factorio 原有正则解析（临时兼容）
  2. 修复 Daemon log_parsers 配置
  3. 切回 Daemon 端解析
- 回退成本：中（Panel 端临时解析逻辑与 Daemon 解析逻辑双轨）

**场景 C：WS 通信不稳定，命令下发丢失**

- 回退条件：sendCommand 成功率 < 99%
- 回退步骤：
  1. commandDispatcher 降级为 REST API 下发（POST /api/instances/:id/command），牺牲实时性换可靠性
  2. command_queue 表持久化所有待发命令，定时重试
  3. 修复 WS 连接稳定性后切回
- 回退成本：低（REST 通道已存在）

**场景 D：数据迁移失败**

- 回退条件：迁移脚本报告外键完整性错误 > 0.1%
- 回退步骤：
  1. 回滚 panel.db（恢复 panel.db.pre-migration）
  2. 修复迁移脚本映射逻辑
  3. 重新迁移（脚本支持 `--skip-existing` 增量重试）
- 回退成本：低（factorio manager.db 不变）

---

## 七、验证计划

### 7.1 验证阶段划分

| 阶段 | 验证内容 | 通过标准 |
|:---:|------|------|
| V1 | P1 基础设施单元测试 | eventBus/scheduler/commandDispatcher 单测全 PASS |
| V2 | Daemon 日志解析器测试 | 按 Pack.log_parsers 解析 10 条样本日志，事件字段正确 |
| V3 | P2 商店/CDK 端到端 | 下单 → !claim → 物品发放全流程通，乐观锁并发测试通过 |
| V4 | P3 聊天增强端到端 | !verify/!claim/加入礼包/定时消息/投票踢人 5 个流程全通 |
| V5 | 数据迁移验证 | 迁移后行数一致，外键完整性检查通过，关键业务可查询 |
| V6 | 回归测试 | gameserver-panel 现有 P0 功能（创建/启动/停止/RCON 控制台）不退化 |

### 7.2 关键验证用例

#### V2：Daemon 日志解析器

```
输入样本（Factorio 日志）：
  "[CHAT] player_a: hello world"
  "[CHAT] (team) player_b: team message"
  "player_c joined the game"
  "player_d left the game"

预期输出（WS 上行事件）：
  chat.event { username:"player_a", message:"hello world", type:"chat" }
  chat.event { username:"player_b", message:"team message", type:"team" }
  player.join { player:"player_c" }
  player.leave { player:"player_d" }
```

#### V3：商店乐观锁并发测试

```
场景：同一 claim_code 被两个并发 !claim 请求
预期：
  - 请求 A 成功（status: pending → claiming → claimed）
  - 请求 B 失败（"订单正在提取中，请稍后重试"）
  - 物品只发放一次
```

#### V3：CDK 兑换跨实例隔离

```
场景：CDK code 绑定 server_A，玩家在 server_B 游戏 !claim
预期：
  - findCodeInInstance(code, server_B) 返回 null
  - 回退 shopService.claimOrder（若 server_B 有对应订单则领取，否则返回"兑换码无效"）
```

#### V4：玩家加入礼包防重发

```
场景：同一玩家首次加入触发礼包，再次加入不应重复发放
预期：
  - 第一次 join：gift_claims 记录 first 类型，物品发放
  - 第二次 join：hasGiftClaim 返回 true，跳过发放
```

#### V5：数据迁移一致性

```
验证项：
  - factorio users 行数 == panel users 行数（含 VIP 字段）
  - factorio shop_orders 行数 == panel shop_orders 行数
  - panel shop_orders.user_id 全部能在 panel users.id 找到（外键完整性）
  - panel shop_orders.server_id 全部能在 panel servers.id 找到
  - factorio default 实例的订单全部映射到 panel 的对应 server_id
```

### 7.3 验证执行方式

- **单元测试**：每个 service 文件配套 `.test.ts`，使用 vitest（factorio 已用），覆盖核心逻辑
- **端到端测试**：`tests/e2e/` 下按业务流程编写，Mock Daemon WS 事件注入 + 断言 Panel 下发命令
- **Mock 回归**：前端变更通过 s0402 三重闸门（单测 → E2E → Mock 回归）
- **数据迁移验证**：迁移脚本输出报告 + 独立一致性检查脚本 `verify-migration.ts`
- **GN-004 交付前审查**：每个 P 阶段闭合时由主线程拉起 GN-004 审查（subagent 上下文不自行拉取）

---

## 附录 A：与 factorio 实现的关键差异对照

| 维度 | factorio v2.16.0 | gameserver-panel C-2 方案 | 差异原因 |
|------|------------------|--------------------------|---------|
| 架构 | 单体后端 | Panel + Daemon 双层 | 多游戏/多节点支持 |
| eventBus 日志源 | 直接订阅 factorioProcess.onLogLine | 订阅 Daemon WS 上行事件 | 跨进程架构 |
| commandDispatcher 命令发送 | 直接调用 sendCommand（本地 stdin/RCON） | 通过 WS sendCommand 下发到 Daemon | 跨进程架构 |
| 成就预热确认 | 监听本地日志检测成就警告 | 监听 Daemon 上行 console.output 检测 | 跨进程架构 |
| instance_id | string（'default'/'inst-xxx'） | server_id（string UUID） | 多 server 模型 |
| users.id | integer auto increment | string UUID | 与 panel 现有 schema 对齐 |
| 玩家名字段 | factorio_player_name | game_player_name | 多游戏泛化 |
| 业务逻辑位置 | 后端单进程 | Panel backend 集中 | C-2 设计原则 |
| Daemon 职责 | 无 Daemon（单体） | 进程管理 + RCON + 日志解析 + 事件上报 | 双层架构 |

## 附录 B：后续待人类裁决的 [V] 节点

1. **本方案定稿**：C-2 Panel 业务能力集中方案是否批准进入 S2 契约冻结
2. **Pack schema 扩展**：log_parsers/items/commands 模板的 public/ 契约变更是否授权（走 s0601）
3. **数据迁移执行时机**：是否在 P2 阶段（商店/CDK 上线前）执行 factorio → panel 数据迁移
4. **多游戏支持节奏**：P2-P3 阶段是否仅做 Factorio，Minecraft 推迟到 P4 之后
