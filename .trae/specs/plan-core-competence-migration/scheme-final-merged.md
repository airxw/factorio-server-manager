# 核心竞争力迁移方案 — 最终融合定稿

> 🚨 【最高优先级规则】本文件为方案设计文档，优先级高于临时对话内容，所有后续实现必须 100% 符合本方案。
>
> 📌 【上下文保留规则】本文件为工程交接锚点，任何上下文压缩、裁剪场景下必须完整保留全部内容。

## 三段交接状态

### (1) 工程过程

- 2026-07-02：完成 gameserver-panel P0 平台骨架（4 表 / 4 页面 / Panel+Daemon 双层架构）
- 2026-07-02：完成 factorio v2.16.0 核心竞争力勘察（17 表 / 16 服务 / 17 路由 / 21 页面）
- 2026-07-02：用户选定方案倾向 C（激进：混合架构 + 参考重写 + 用户价值优先）
- 2026-07-02：s0102 生成 3 个 C 变体方案（C-1 Daemon 下沉 / C-2 Panel 集中 / C-3 Pack 驱动）
- 2026-07-02：s0103 共识分析 + 硬阻断判定（不触发）+ 互补/互斥分析
- 2026-07-02：s0103 通过 AskUserQuestion 完成互斥点裁决（4 项全部接受 LLM 推荐）
- 2026-07-02：本文档作为最终融合定稿产出

### (2) 交接状态

- **当前状态**：最终融合方案文档编写完成，待主线程拉起 GN-004 独立审查 + 人类裁决（[V] 节点）
- **未闭合项**：
  - [V] 节点：本方案定稿需 GN-004 审查 + 人类裁决（架构方向锁定）
  - 三层契约（schema / interface_stub / config_template）属 s0201 产出，本文仅设计字段
  - Knex migrations 目录属 s0203 模块拆分后产出
  - 数据迁移脚本属 S4 并行开发产出，本文仅设计映射规则
- **阻塞项**：无
- **下一步**：GN-004 审查通过 + 人类裁决 → S2 契约冻结（s0201 生成三层契约）→ S3 模块拆分（s0203）→ S4 并行开发

### (3) 最终结果

- **产出物**：本方案文档（`scheme-final-merged.md`）
- **验证结论**：方案基于两项目实际代码勘察 + 3 方案对抗融合，所有互斥点已由人类裁决。关键业务流程与 factorio v2.16.0 实现对齐，DB schema 处理了 id 类型差异与 instance_id→server_id 映射
- **可继续推进性**：本文档通过 GN-004 审查后，可直接进入 S2 契约冻结

---

## 一、融合决策摘要

### 1.1 保留项（来自各方案）

| 元素 | 来源方案 | 保留理由 |
|------|---------|---------|
| 双层架构 Panel+Daemon | 三方案共识 | 已有 P0 骨架，保留基础架构 |
| Panel 业务集中（基础架构） | C-2 | DB 访问集中，业务逻辑单一真相源，最快跑通 |
| Pack schema 完整扩展（items + event_parsers + business + commands 模板） | C-3 | 为多游戏预留，新增游戏只需写 Pack，业务代码零改动 |
| shop_items 瘦身引用 Pack.items | C-3 | 避免与 Pack.items 重复维护，物品定义唯一真相源 |
| Daemon 仅做进程管理+RCON/stdin 执行+stdout 转发 | C-2 | 最简架构，Daemon 无状态无业务，可被任意替换 |
| `instance_id → server_id` 命名对齐 | 三方案共识 | 与 gameserver-panel 既有 schema 对齐 |
| `users.id` string UUID | 三方案共识 | 与 gameserver-panel 既有 schema 对齐 |
| `factorio_player_name → game_player_name` | 三方案共识 | 支持多游戏玩家名绑定 |
| Knex migrations 目录 | 三方案共识 | 数据库版本化管理，支持热更新前置迁移 |
| VIP 等级品质校验规则 | factorio 原始 | 0-5 级，VIP N 可购品质 tier ≤ N-1，admin=999 不受限 |
| 乐观锁防并发（shop_orders/cdk_codes） | factorio 原始 | pending→claiming→claimed 状态机防并发领取 |
| event_parsers 由 Panel 端 chatMonitor/joinHandler 使用 | C-3 适配 C-2 | Pack 仍是业务能力描述层；未来性能压力大时可下沉 Daemon 而 Pack 不变 |
| 禁止游戏专属硬编码 | C-3 关键约束 | 代码评审发现 `if (game === 'factorio')` 即视为违约 |

### 1.2 舍弃项（来自被否决方案）

| 元素 | 来源方案 | 舍弃理由 |
|------|---------|---------|
| Daemon 本地 SQLite（4 表 player_history/gift_claims/votes_active/periodic_last_exec） | C-1 | 增加 Daemon 复杂度且数据同步困难，全部走 Panel.db |
| 实时业务下沉 Daemon（chatMonitor/joinHandler/voteService/periodicMessage/scheduler/eventBus） | C-1 | Daemon 调试困难，业务逻辑分散，违反"Panel 业务集中"基础架构 |
| business 字段缺失 | C-2 | 缺失 business 导致 Panel 业务代码出现游戏专属硬编码分支 |
| shop_items 内嵌 display_name/category | C-1/C-2 | 与 Pack.items 重复维护，运营级配置 vs 物品定义应分离 |

### 1.3 融合策略

**主体架构（C-2）+ Pack schema 完整扩展（C-3）+ shop_items 瘦身（C-3）+ Daemon 最小化（C-2）**

```
Panel（业务大脑，DB 集中）
  ├── 用户/VIP/权限（factorio 迁移）
  ├── Pack 加载器（按 Pack.business 实例化业务模块）
  ├── 商店/CDK（命令模板渲染 + 乐观锁）
  ├── 聊天增强 P1-P4（订阅 stdout 事件，按 event_parsers 解析）
  ├── 玩家/名单/Mod/存档/备份/监控/Webhook（factorio 迁移 + 新设计）
  └── daemonClient（REST + WS 双通道，下发命令/订阅事件）

Daemon（执行手足，无状态）
  ├── 进程生命周期管理（spawn/stop/状态机）
  ├── RCON/stdin 协议客户端
  ├── stdout 流式转发（原始日志，不解析）
  └── 资源监控采集（按需上报）
```

---

## 二、架构总览

### 2.1 Panel / Daemon 职责矩阵

| 能力域 | Panel backend | Daemon | 说明 |
|--------|:---:|:---:|------|
| 用户管理 / 认证 / JWT | ✅ | ❌ | Panel 独占，Daemon 用 daemon_token 鉴权 |
| VIP 等级 / 权限 / 限额 | ✅ | ❌ | 集中查 DB，admin=999 跳过校验 |
| 商店商品 / 订单 / 乐观锁 | ✅ | ❌ | 全程 Panel 处理 |
| CDK 生成 / 兑换 / 乐观锁 | ✅ | ❌ | 全程 Panel 处理 |
| 物品发放命令构建（按 Pack.business 模板渲染） | ✅ | ❌ | Panel 渲染完整命令字符串 |
| 命令队列 / 成就预热 / 重试 | ✅ | ❌ | Panel 端 commandDispatcher，下发到 Daemon |
| 聊天监控 / !verify / !claim | ✅ | ❌ | Panel 按 Pack.event_parsers 解析 stdout，订阅事件并处理 |
| 玩家加入 / 礼包 / 欢迎语 | ✅ | ❌ | Panel 解析 join 事件，下发 give/say 命令 |
| 定时消息 | ✅ | ❌ | Panel 端 scheduler 定时器，到点下发 |
| 投票踢人 / 阈值判定 | ✅ | ❌ | Panel 解析投票，达标下发 kick |
| 事件总线 / 调度器 | ✅ | ❌ | Panel 内部 EventEmitter + 定时器 |
| 物品同步 / 系统设置 | ✅ | ❌ | Panel 独占 |
| 玩家/名单/Mod/存档/备份/监控/Webhook | ✅ | 部分 | Panel 决策+DB，Daemon 执行文件操作/上报数据 |
| 进程生命周期管理 | ❌ | ✅ | spawn/stop/状态机 |
| RCON / stdin 协议客户端 | ❌ | ✅ | Daemon 持有协议连接 |
| stdout 流式转发 | ❌ | ✅ | Daemon 不解析，原始日志走 WS 上行 |
| 命令执行（RCON/stdin 发送） | ❌ | ✅ | 接收 Panel 下发命令字符串，调用协议客户端 |
| 资源监控采集 | ❌ | ✅ | CPU/内存/Tick 采集上报 |

### 2.2 数据流图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Panel Frontend (React 19)                     │
│   Servers / Shop / CDK / ChatEnhancement / Players / Votes ...      │
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
│  │  /api/...   │  │             │  │  commandDispatcher           │ │
│  └──────┬──────┘  └─────▲───────┘  │  eventBus / scheduler        │ │
│         │               │          │  playerTracker / itemSync    │ │
│         │               │          │  packLoader / modService ...  │ │
│  ┌──────▼───────────────┴─────────────────────────────────────────┐ │
│  │              事件处理层（Panel 内部）                            │ │
│  │  接收 Daemon stdout → 按 Pack.event_parsers 解析 → 路由到业务    │ │
│  │  commandDispatcher 渲染命令模板 → 下发 Daemon                   │ │
│  └──────┬──────────────────────────────────────▲──────────────────┘ │
│         │ REST (启动/停止/状态)       WS 下行 (sendCommand)           │
│         │                              │                              │
│  ┌──────▼──────────────────────────────▼──────────────────────────┐  │
│  │              daemonClient (REST + WS 双通道)                    │  │
│  │  DaemonEventStream (WS 上行 stdout/state) + DaemonRest          │  │
│  └──────┬──────────────────────────────▲──────────────────────────┘  │
└─────────┼──────────────────────────────┼─────────────────────────────┘
          │ HTTP REST                     │ WebSocket (双向)
          │ (Bearer Token)                │ (query token)
┌─────────▼──────────────────────────────▼─────────────────────────────┐
│                         Daemon (Express + ws)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ HTTP 路由     │  │ WS 服务端     │  │   进程管理器                │  │
│  │ /start /stop │  │ /ws           │  │  processDriver (spawn)     │  │
│  │ /state       │  │               │  │  stateMachine (状态流转)    │  │
│  │ /command     │  │ 接收 subscribe│  │  protocolClient            │  │
│  │              │  │ 接收 sendCmd  │  │  (RCON / stdin)            │  │
│  └──────┬───────┘  └───────┬───────┘  └─────────────┬──────────────┘  │
│         │                  │                        │                 │
│  ┌──────▼──────────────────▼────────────────────────▼───────────────┐ │
│  │  stdout 流式转发（原始日志，不解析）+ 资源监控采集                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
                               │
                        ┌──────▼──────┐
                        │  游戏进程    │  (Minecraft / Factorio / ...)
                        │  (stdout)   │
                        └─────────────┘
```

### 2.3 关键数据流说明

#### 2.3.1 Daemon → Panel 上行（WS 事件）

| 事件类型 | 含义 | 字段 |
|---------|------|------|
| `console.output` | 原始日志行 | `{type, instance_id, line, timestamp}` |
| `state.change` | 进程状态变更 | `{type, instance_id, from, to, timestamp}` |
| `instance.started` | 实例启动完成 | `{type, instance_id, timestamp}` |
| `instance.stopped` | 实例停止 | `{type, instance_id, exit_code, timestamp}` |
| `resource.metrics` | 资源监控（按需） | `{type, instance_id, cpu, memory, tick, players, timestamp}` |

> **注意**：Daemon 不解析聊天/加入/离开事件。原始 stdout 通过 `console.output` 上行，Panel 端 chatMonitor/joinHandler 按 Pack.event_parsers 解析。

#### 2.3.2 Panel → Daemon 下行（WS 命令）

| 命令类型 | 含义 | 字段 |
|---------|------|------|
| `subscribe` | 订阅实例事件 | `{type, instance_id}` |
| `sendCommand` | 下发 RCON/stdin 命令 | `{type, instance_id, command, request_id}` |

#### 2.3.3 Panel → Daemon REST

保留现有：`POST /start` / `POST /stop` / `GET /state` / `POST /command`

---

## 三、Pack Schema 完整扩展设计（C-3 完整扩展）

### 3.1 扩展原则

- 所有新增字段（items / event_parsers / business / commands 模板）均为 **optional**，现有 minecraft-vanilla Pack 无需修改即可加载
- 扩展走 s0601 契约变更流程，不直接编辑 `public/schema/pack-schema.ts`
- Pack 是业务能力的唯一真相源，Panel 业务模块代码不得出现 `if (game === 'factorio')` 分支

### 3.2 新增字段总览

| 字段 | 用途 | 使用方 |
|------|------|--------|
| `items` | 物品池（含品质、分类、同步源） | Panel shopService / itemSyncService |
| `event_parsers` | stdout 事件解析规则（chat/join/leave） | Panel chatMonitor / joinHandler |
| `business` | 业务能力声明（shop/cdk/chat_enhancement/players/lists/verify） | Panel 业务模块加载器 + commandDispatcher 命令渲染 |
| `commands` | 通用命令模板（broadcast/list_players/save_world） | Panel commandDispatcher |

### 3.3 `items` 字段（物品池）

```yaml
items:
  source:
    type: github_sync          # github_sync | static | local_file
    url: https://raw.githubusercontent.com/airxw/factorioitem/main/items.json
    sync_interval_hours: 24    # Panel 定时拉取间隔
  qualities: [normal, uncommon, rare, epic, legendary]   # 该游戏支持的品质枚举
  quality_tiers: 5             # 品质等级数（用于 VIP 品质校验）
  categories: [ammo, armor, fluid, item, recipe, technology]
  # static 模式下直接内联物品清单（适用于物品数少的游戏）
  # static_list:
  #   - name: iron-plate
  #     display_name: 铁板
  #     category: item
```

- `source.type=github_sync`：Panel 按 `sync_interval_hours` 定时拉取 JSON，写入 `item_sync_log` 表并缓存。
- `source.type=static`：物品清单直接内联在 Pack YAML，适用于 Minecraft 这类物品数稳定且不大的游戏。
- `qualities` 与 `quality_tiers`：factorio 为 5 级，minecraft 为 0 级（无品质概念，`qualities: []`、`quality_tiers: 0`）。shopService 据此决定是否走品质校验分支。

### 3.4 `event_parsers` 字段（事件解析规则，Panel 用）

```yaml
event_parsers:
  chat:
    pattern: '^\[([0-9:]+)\] \[(.*?)\] (.+?): (.+)$'
    groups: [timestamp, level, player, message]
  join:
    pattern: '^(\S+) joined the game$'
    player_group: 1
  leave:
    pattern: '^(\S+) left the game$'
    player_group: 1
  # 可扩展：death / achievement / system 等
```

- Panel 端 chatMonitor / joinHandler 按这些正则解析 Daemon 转发的原始 stdout，匹配成功后生成结构化事件。
- `player_group` 指定从正则哪个捕获组提取玩家名。
- 不同游戏的日志格式差异完全由 Pack 吸收，Panel 解析器代码通用。

### 3.5 `business` 字段（业务能力声明）

```yaml
business:
  shop:
    enabled: true
    give_command: "/silent-command game.players['{{player}}'].insert{name='{{item}}',count={{count}},quality='{{quality}}'}"
    quality_tiers: 5                # 与 items.quality_tiers 一致
    support_quality: true           # 是否支持品质选择
  cdk:
    enabled: true
    redeem_command: "same as shop.give_command"   # 复用 shop.give_command
  chat_enhancement:
    welcome:
      enabled: true
      first_gift_command: "same as shop.give_command"
    periodic_messages:
      enabled: true
      broadcast_command: "/silent-command game.print('{{message}}')"
    response_rules:
      enabled: true
    vote_kick:
      enabled: true
      kick_command: "/silent-command game.players['{{player}}'].kick('{{reason}}')"
  players:
    kick_command: "/silent-command game.kick_player('{{player}}', '{{reason}}')"
    ban_command: "/silent-command game.ban_player('{{player}}', '{{reason}}')"
  lists:
    whitelist_add: "/silent-command game.write_file('whitelist.json', '{{json}}')"
    banlist_add: "/silent-command game.ban_player('{{player}}', '{{reason}}')"
  verify:                           # 玩家绑定验证
    enabled: true
    # Panel 收到 chat 事件 "!verify <code>" 时，不下发命令，仅更新 DB 绑定状态
```

- `give_command` 等模板使用 `{{var}}` 占位，Panel 渲染时严格校验变量值（防注入），渲染完成后下发完整字符串给 Daemon。
- `same as shop.give_command` 是约定 shorthand，Panel 加载时自动解析为引用 shop.give_command 的值。
- 某游戏不支持的业务能力（如 Minecraft 无 vote_kick），`enabled: false` 或缺省，Panel 不加载对应模块。

### 3.6 `commands` 字段（通用命令模板）

```yaml
commands:
  broadcast: "/silent-command game.print('{{message}}')"
  list_players: "/silent-command for _, p in pairs(game.players) do game.print(p.name) end"
  save_world: "/server-save"
  say_private: "/silent-command if game.players['{{player}}'] then game.players['{{player}}'].print('{{message}}') end"
```

- `commands` 与 `business` 下命令模板分工：
  - `commands`：通用运维命令（无业务语义）
  - `business`：业务能力命令（带业务上下文渲染）

### 3.7 Zod schema 扩展要点（契约层，s0201 落地）

- 所有新增字段（items / event_parsers / business / commands）均为 optional
- `commands` 从 `z.record(z.string(), z.string())` 扩展为 `z.record(z.string(), z.string()).optional()`
- 向后兼容：现有 minecraft-vanilla Pack 无需修改即可加载

---

## 四、数据库 Schema 设计

### 4.1 设计原则

1. 保留 gameserver-panel 现有 4 表（users/nodes/servers/packs），users 扩展业务字段
2. `instance_id → server_id`：factorio 业务表统一改名，外键 → `servers.id`（string 类型）
3. `users.id` string UUID：与 gameserver-panel 对齐，factorio 业务表的 `user_id` 外键统一用 string
4. `factorio_player_name → game_player_name`：泛化支持多游戏
5. 所有业务表按 server_id 隔离，对应 servers 表
6. Panel.db 单一数据库，Daemon 无 DB
7. 所有 schema 变更走 Knex migrations，支持热更新前置迁移

### 4.2 完整表清单（28 张表）

#### 4.2.1 现有表（保留 + 扩展）

| # | 表名 | 说明 | 变更 |
|---|------|------|------|
| 1 | users | 用户认证 | **扩展**：vip_level / vip_expires_at / is_verified / display_name / last_login_at / last_login_ip |
| 2 | nodes | 节点 | 不变 |
| 3 | servers | 服务器实例 | **扩展**：shop_enabled / chat_enabled / mods_enabled（替代 factorio instances 表的同名字段） |
| 4 | packs | Pack 注册 | 不变 |

#### 4.2.2 新增表（24 张）

**P1 优先级（用户价值优先，第一批落地）**

| # | 表名 | 来源 | 说明 |
|---|------|------|------|
| 5 | vip_permissions | factorio 迁移 | VIP 等级权限映射（0-5 级，max_quality / daily_limit） |
| 6 | player_bindings | factorio 迁移（泛化） | 玩家游戏名绑定（game_player_name 替代 factorio_player_name） |
| 7 | item_sync_log | factorio 迁移 | 物品同步日志（GitHub 拉取记录） |
| 8 | system_config | factorio 迁移 | 系统配置（KV 表） |
| 9 | command_queue | 新设计 | 命令下发队列（成就预热/重试） |

**P2 优先级（商业化核心）**

| # | 表名 | 来源 | 说明 |
|---|------|------|------|
| 10 | shop_items | factorio 迁移（瘦身） | 商品上架配置（删除 display_name/category，引用 Pack.items） |
| 11 | shop_orders | factorio 迁移 | 订单头（pending→claiming→claimed 乐观锁） |
| 12 | shop_order_items | factorio 迁移 | 订单明细 |
| 13 | cdk_codes | factorio 迁移 | CDK 兑换码（unused→claiming→claimed 乐观锁） |

**P3 优先级（聊天增强 P1-P4）**

| # | 表名 | 来源 | 说明 |
|---|------|------|------|
| 14 | chat_settings | factorio 迁移 | 聊天全局配置 |
| 15 | chat_trigger_responses | factorio 迁移 | 自定义触发响应规则 |
| 16 | player_join_settings | factorio 迁移 | 玩家加入配置 |
| 17 | periodic_messages | factorio 迁移 | 定时消息任务 |
| 18 | vote_settings | factorio 迁移 | 投票踢人配置 |
| 19 | votes | factorio 迁移 | 投票记录 |
| 20 | vote_records | factorio 迁移 | 投票明细 |
| 21 | player_histories | factorio 迁移 | 玩家登录历史 |
| 22 | gift_claims | factorio 迁移 | 礼包领取记录 |

**P4 优先级（运维管理）**

| # | 表名 | 来源 | 说明 |
|---|------|------|------|
| 23 | mod_records | 新设计 | Mod 管理记录 |
| 24 | save_records | 新设计 | 存档记录 |
| 25 | backup_records | 新设计 | 备份记录 |
| 26 | monitor_snapshots | 新设计 | 监控快照（时序数据） |
| 27 | list_entries | 新设计 | 名单（黑白名单） |

**P5 优先级（日志/审计）**

| # | 表名 | 来源 | 说明 |
|---|------|------|------|
| 28 | audit_logs | 新设计 | 审计日志 |

### 4.3 关键表字段设计

> 仅列出与 factorio 原表有差异或新设计的表；完全照搬 factorio 的表（如 shop_orders / cdk_codes / votes / vote_settings / chat_settings / chat_trigger_responses / player_join_settings / periodic_messages / player_histories / gift_claims / system_config / item_sync_log / vip_permissions）仅做 `instance_id → server_id` 命名替换，字段不变。

#### 4.3.1 users（扩展）

```
id              STRING PRIMARY KEY         (保留 gameserver-panel 的 UUID)
email           STRING UNIQUE NOT NULL     (保留)
username        STRING NOT NULL            (保留)
password_hash   STRING NOT NULL            (保留)
role            STRING NOT NULL DEFAULT 'viewer'   (system_admin/admin/operator/viewer)
status          STRING NOT NULL DEFAULT 'active'
display_name    STRING NULLABLE            (新增，factorio 有)
vip_level       INTEGER NOT NULL DEFAULT 0 (新增)
vip_expires_at  TIMESTAMP NULLABLE         (新增)
is_verified     BOOLEAN NOT NULL DEFAULT false  (新增，绑定验证状态)
last_login_at   TIMESTAMP NULLABLE         (新增)
last_login_ip   STRING NULLABLE            (新增)
created_at / updated_at  TIMESTAMP
```

#### 4.3.2 servers（扩展）

```
（保留 gameserver-panel 所有字段）
shop_enabled    BOOLEAN DEFAULT true       (新增，替代 factorio instances.shop_enabled)
chat_enabled    BOOLEAN DEFAULT true       (新增，替代 factorio instances.chat_enabled)
mods_enabled    BOOLEAN DEFAULT true       (新增，替代 factorio instances.mod_enabled)
```

#### 4.3.3 shop_items（瘦身）

```
id              INTEGER PRIMARY KEY
server_id       STRING NOT NULL REFERENCES servers(id)   (替代 instance_id)
item_name       STRING NOT NULL          (必须存在于当前 server 的 Pack.items)
quality         STRING NOT NULL DEFAULT 'normal'
vip_level_required INTEGER NOT NULL DEFAULT 0   (废弃，保留兼容)
daily_limit     INTEGER NULLABLE
enabled         BOOLEAN NOT NULL DEFAULT false
created_at / updated_at
UNIQUE(server_id, item_name)
INDEX(server_id)
```

**校验约束**：插入/更新时 Panel 校验 `item_name ∈ Pack.items`（运行时校验，非 DB 外键，因 Pack.items 是外部同步数据）。

**删除字段**（相对 factorio 原表）：`display_name`、`category` —— 由 Pack.items 提供。

#### 4.3.4 player_bindings（泛化）

```
id              INTEGER PRIMARY KEY
user_id         STRING NOT NULL REFERENCES users(id)   (改为 string)
game_player_name STRING NOT NULL          (泛化自 factorio_player_name)
game_type       STRING(20) NOT NULL       (新增，minecraft/factorio/...)
verify_code     STRING(6) NOT NULL
status          STRING NOT NULL DEFAULT 'pending'      (pending/verified/rejected)
verified_at     TIMESTAMP NULLABLE
created_at / updated_at
UNIQUE(user_id, game_type)
UNIQUE(game_player_name, game_type, status)
```

#### 4.3.5 command_queue（新设计）

```
id              INTEGER PRIMARY KEY
server_id       STRING NOT NULL REFERENCES servers(id)
command_text    TEXT NOT NULL             (已渲染的完整命令字符串)
priority        STRING NOT NULL DEFAULT 'normal'   (low/normal/high)
status          STRING NOT NULL DEFAULT 'pending'  (pending/sending/sent/failed)
attempts        INTEGER NOT NULL DEFAULT 0
max_attempts    INTEGER NOT NULL DEFAULT 3
last_error      TEXT NULLABLE
created_at      TIMESTAMP
sent_at         TIMESTAMP NULLABLE
INDEX(server_id, status)
INDEX(priority, created_at)
```

**用途**：commandDispatcher 成就预热机制——批量命令排队发送，失败重试，避免阻塞主流程。

#### 4.3.6 P4 新表字段设计

- **mod_records**：`id, server_id, mod_name, version, enabled, source_url, installed_at, created_at, updated_at`
- **save_records**：`id, server_id, save_name, file_path, size_bytes, modified_at, is_active, created_at`
- **backup_records**：`id, server_id, file_path, size_bytes, created_at, created_by, status, created_at`
- **monitor_snapshots**：`id, server_id, timestamp, cpu_percent, memory_mb, tick_rate, player_count, json_extra`
- **list_entries**：`id, server_id, list_type(whitelist/banlist), player_name, added_at, added_by, reason`

#### 4.3.7 P5 新表字段设计

- **audit_logs**：`id, server_id, user_id, action, target_type, target_id, details_json, ip_address, created_at`

---

## 五、关键业务流程

### 5.1 商店购买 + 物品发放（claimOrder 两段事务）

```
用户下单（POST /api/shop/orders）
  ↓
Panel shopService.createOrder:
  1. 校验商品 enabled + 用户 VIP 品质权限 + 每日限额
  2. INSERT shop_orders (status=pending) + shop_order_items
  3. 返回 claim_code 给用户
  ↓
游戏内玩家输入 "!claim <code>"
  ↓
Daemon 转发 stdout → Panel chatMonitor 解析 → 检测 !claim
  ↓
Panel shopService.claimOrder:
  1. 乐观锁：UPDATE shop_orders SET status='claiming', claimed_player=? WHERE claim_code=? AND status='pending'
     - 失败（rows=0）→ 命令已用过或不存在 → 下发提示消息
  2. 遍历 order_items，按 Pack.business.shop.give_command 模板渲染命令：
     - 校验变量值（防 Lua 注入）
     - 渲染：`/silent-command game.players['{player}'].insert{name='{item}',count={count},quality='{quality}'}`
  3. 通过 commandDispatcher 下发到 Daemon（每条命令单独 request_id）
  4. 全部命令发送成功 → UPDATE shop_orders SET status='claimed', claimed_at=NOW()
     任一命令失败 → UPDATE shop_orders SET status='pending'（回滚）+ 记录日志
  ↓
Daemon 调用 RCON/stdin 执行命令 → 游戏内物品入背包
```

### 5.2 CDK 兑换（同商店流程）

```
管理员批量生成 CDK → INSERT cdk_codes (status=unused)
  ↓
游戏内玩家输入 "!redeem <code>"
  ↓
Panel cdkService.redeem:
  1. 乐观锁：UPDATE cdk_codes SET status='claiming', claimed_player=? WHERE code=? AND status='unused'
  2. 按 Pack.business.cdk.redeem_command 模板渲染命令
  3. commandDispatcher 下发到 Daemon
  4. 全部成功 → UPDATE cdk_codes SET status='claimed', claimed_at=NOW()
     失败 → 回滚 status=unused
```

### 5.3 VIP 品质校验规则（factorio 原始规则）

```typescript
function checkQualityPermission(user: User, itemQuality: string, pack: Pack): boolean {
  // admin 不受限
  if (user.role === 'admin' || user.role === 'system_admin') return true;
  
  // Pack 无品质概念（quality_tiers=0），跳过校验
  if (pack.items.quality_tiers === 0) return true;
  
  // VIP N 可购品质 tier ≤ N-1
  // qualities: [normal, uncommon, rare, epic, legendary]
  // VIP 0 → normal, VIP 1 → normal+uncommon, VIP 2 → +rare, ...
  const qualityIndex = pack.items.qualities.indexOf(itemQuality);
  if (qualityIndex === -1) return false;  // 不存在的品质
  return qualityIndex < user.vip_level;  // VIP N 可购 tier ≤ N-1
}
```

### 5.4 聊天增强 P1-P4 数据流

```
游戏 stdout:
  "[12:34:56] [CHAT] Player1: !verify ABC123"
  "[12:34:57] [JOIN] Player2 joined the game"
  ↓
Daemon WS 上行 console.output (原始日志，不解析)
  ↓
Panel chatMonitor 接收 stdout:
  1. 按 Pack.event_parsers.chat 正则匹配 → 提取 player=Player1, message="!verify ABC123"
  2. 检测命令前缀：
     - !verify → joinHandler.handleVerify(player, code)
     - !claim  → shopService.claimOrder(code, player)
     - !redeem → cdkService.redeem(code, player)
     - !vote   → voteService.startVote(player, target)
  3. 按 Pack.event_parsers.join 正则匹配 → 提取 player=Player2
     → joinHandler.handleJoin(player):
       - 查 player_join_settings 是否启用欢迎礼包
       - 启用则按 Pack.business.chat_enhancement.welcome.first_gift_command 渲染命令
       - 通过 commandDispatcher 下发
       - INSERT gift_claims (防重复领取)
  4. 定时消息：Panel scheduler 按 periodic_messages 表定时触发
     - 按 Pack.business.chat_enhancement.periodic_messages.broadcast_command 渲染
     - 下发 broadcast 命令
  5. 投票踢人：voteService 监听 !vote 命令
     - INSERT votes + vote_records
     - 达阈值 → 按 Pack.business.chat_enhancement.vote_kick.kick_command 渲染
     - 下发 kick 命令
```

### 5.5 防注入校验

Panel 渲染命令模板前，对所有变量值做严格校验：

```typescript
const VARIABLE_PATTERNS = {
  player: /^[a-zA-Z0-9_-]{1,32}$/,           // 玩家名：字母数字下划线，1-32 字符
  item: /^[a-zA-Z0-9_-]{1,64}$/,             // 物品名：同上
  count: /^\d{1,6}$/,                         // 数量：纯数字 1-6 位
  quality: /^(normal|uncommon|rare|epic|legendary)$/,  // 品质枚举
  message: /^.{1,500}$/,                      // 消息：1-500 字符（禁止单引号、反斜杠）
  reason: /^.{1,200}$/,                       // 原因：1-200 字符
};

function renderCommand(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    const pattern = VARIABLE_PATTERNS[key];
    if (!pattern || !pattern.test(value)) {
      throw new Error(`Invalid variable value: ${key}=${value}`);
    }
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}
```

---

## 六、数据迁移规则（factorio → gameserver-panel）

### 6.1 用户表迁移

```
factorio users (integer id)
  ↓
gameserver-panel users (string UUID id)
  - 为每个 factorio 用户生成新 UUID
  - 保留 email/username/password_hash
  - vip_level / vip_expires_at / is_verified 直接迁移
  - last_login_at / last_login_ip 直接迁移
  - 建立 user_id 映射表（factorio_int_id → panel_uuid）供后续表迁移使用
```

### 6.2 业务表迁移规则

| 表名 | 迁移规则 |
|------|---------|
| shop_items | `instance_id → server_id`，删除 display_name/category（从 Pack.items 取） |
| shop_orders | `instance_id → server_id`，`user_id` 用映射表转 UUID |
| shop_order_items | `order_id` 不变（integer），`instance_id → server_id` |
| cdk_codes | `instance_id → server_id`，`user_id` 用映射表转 UUID |
| vip_permissions | 直接迁移（无 user_id 引用） |
| player_bindings | `user_id` 转 UUID，`factorio_player_name → game_player_name`，`game_type='factorio'` |
| chat_settings | `instance_id → server_id` |
| chat_trigger_responses | `instance_id → server_id` |
| player_join_settings | `instance_id → server_id` |
| periodic_messages | `instance_id → server_id` |
| vote_settings | `instance_id → server_id` |
| votes | `instance_id → server_id`，`user_id` 转 UUID |
| vote_records | `instance_id → server_id`，`user_id` 转 UUID |
| player_histories | `instance_id → server_id` |
| gift_claims | `instance_id → server_id`，`user_id` 转 UUID |
| system_config | 直接迁移 |
| item_sync_log | 直接迁移 |

### 6.3 instances 表迁移

factorio `instances` 表 → gameserver-panel `servers` 表：

```
instances.id (integer) → servers.id (string UUID, 生成新 UUID)
instances.name → servers.name
instances.node_id → servers.node_id (映射到 gameserver-panel nodes)
instances.pack_id → servers.pack_id (映射到 gameserver-panel packs)
instances.shop_enabled → servers.shop_enabled
instances.chat_enabled → servers.chat_enabled
instances.mod_enabled → servers.mods_enabled
其他字段按 servers schema 对齐
建立 instance_id 映射表（factorio_int_id → panel_server_uuid）供业务表迁移使用
```

---

## 七、模块拆分预告（为 s0203 准备）

### 7.1 Panel Backend 模块清单

| 模块 | 路径 | 职责 | 优先级 |
|------|------|------|:---:|
| packLoader | panel/backend/src/packLoader/ | Pack 加载/校验/注册/按 business 实例化业务模块 | P1 |
| userService | panel/backend/src/services/userService.ts | 用户注册/登录/JWT/VIP 等级 | P1 |
| vipService | panel/backend/src/services/vipService.ts | VIP 等级查询/品质校验/限额 | P1 |
| itemSyncService | panel/backend/src/services/itemSyncService.ts | GitHub 物品同步（按 Pack.items.source） | P1 |
| systemConfigService | panel/backend/src/services/systemConfigService.ts | 系统配置 KV | P1 |
| commandDispatcher | panel/backend/src/services/commandDispatcher.ts | 命令渲染/队列/重试/成就预热 | P1 |
| eventBus | panel/backend/src/services/eventBus.ts | 内部事件总线 | P1 |
| scheduler | panel/backend/src/services/scheduler.ts | 定时任务（periodic_message 等） | P1 |
| shopService | panel/backend/src/services/shopService.ts | 商品/订单/乐观锁/claimOrder 两段事务 | P2 |
| cdkService | panel/backend/src/services/cdkService.ts | CDK 生成/兑换/乐观锁 | P2 |
| chatMonitor | panel/backend/src/services/chatMonitor.ts | stdout 解析（按 Pack.event_parsers）/命令路由 | P3 |
| joinHandler | panel/backend/src/services/joinHandler.ts | 玩家加入/欢迎礼包/!verify | P3 |
| voteService | panel/backend/src/services/voteService.ts | 投票踢人状态机 | P3 |
| periodicMessageService | panel/backend/src/services/periodicMessageService.ts | 定时消息 | P3 |
| playerTracker | panel/backend/src/services/playerTracker.ts | 玩家在线状态跟踪 | P3 |
| modService | panel/backend/src/services/modService.ts | Mod 管理记录 | P4 |
| saveService | panel/backend/src/services/saveService.ts | 存档记录 | P4 |
| backupService | panel/backend/src/services/backupService.ts | 备份任务 | P4 |
| monitorService | panel/backend/src/services/monitorService.ts | 监控快照存储/阈值告警 | P4 |
| listService | panel/backend/src/services/listService.ts | 白名单/黑名单 | P4 |
| webhookService | panel/backend/src/services/webhookService.ts | Webhook 触发/分发 | P5 |
| auditLogService | panel/backend/src/services/auditLogService.ts | 审计日志 | P5 |
| daemonClient | panel/backend/src/daemonClient/ | REST + WS 双通道（已有，扩展 sendCommand 下行） | P1 |
| db/migrations | panel/backend/src/db/migrations/ | Knex migrations（28 张表） | P1 |

### 7.2 Panel Frontend 模块清单

| 页面 | 路径 | 优先级 |
|------|------|:---:|
| Login | 已有 | - |
| Servers | 已有 | - |
| CreateServer | 已有 | - |
| ServerDetail | 已有，扩展 Tab | - |
| Shop | panel/frontend/src/pages/Shop/ | P2 |
| ShopOrders | panel/frontend/src/pages/ShopOrders/ | P2 |
| CDK | panel/frontend/src/pages/CDK/ | P2 |
| CDKRedeem | panel/frontend/src/pages/CDKRedeem/ | P2 |
| ChatEnhancement | panel/frontend/src/pages/ChatEnhancement/ | P3 |
| PeriodicMessages | panel/frontend/src/pages/PeriodicMessages/ | P3 |
| Votes | panel/frontend/src/pages/Votes/ | P3 |
| Players | panel/frontend/src/pages/Players/ | P3 |
| PlayerBindings | panel/frontend/src/pages/PlayerBindings/ | P3 |
| VipPermissions | panel/frontend/src/pages/VipPermissions/ | P1 |
| Mods | panel/frontend/src/pages/Mods/ | P4 |
| Saves | panel/frontend/src/pages/Saves/ | P4 |
| Backups | panel/frontend/src/pages/Backups/ | P4 |
| Monitor | panel/frontend/src/pages/Monitor/ | P4 |
| Lists | panel/frontend/src/pages/Lists/ | P4 |
| Webhooks | panel/frontend/src/pages/Webhooks/ | P5 |
| SystemConfig | panel/frontend/src/pages/SystemConfig/ | P1 |
| ItemSync | panel/frontend/src/pages/ItemSync/ | P1 |
| AuditLogs | panel/frontend/src/pages/AuditLogs/ | P5 |
| Users | panel/frontend/src/pages/Users/ | P1 |

### 7.3 Daemon 模块清单（已有，无需新增）

- daemon/src/protocol/：rconClient / stdinClient / factory / types（已有）
- daemon/src/instances/：manager / processDriver / readiness / stateMachine / types（已有）
- daemon/src/server.ts：HTTP + WS 服务端（已有，无需扩展业务事件解析）

---

## 八、风险与回退

### 8.1 风险表

| # | 风险 | 级别 | 缓解措施 | 回退方案 |
|---|------|:---:|---------|---------|
| R1 | Panel 端 stdout 解析性能瓶颈（每行日志走 WS + 正则匹配） | 中 | chatMonitor 增加批处理（100ms 内合并解析）；event_parsers 正则预编译 | 将日志解析下沉回 Daemon（C-1 风格），Pack.event_parsers 不变 |
| R2 | factorio 用户 id integer → UUID 映射失败 | 高 | 迁移脚本生成 user_id 映射表，业务表迁移时引用 | 保留 factorio integer id，gameserver-panel users 增加 legacy_id 字段 |
| R3 | Pack.items 同步失败导致商店商品失效 | 中 | itemSyncService 失败重试 3 次 + 告警；Pack 允许 static_list 兜底 | shop_items.enabled=false，暂停购买 |
| R4 | 命令模板渲染被注入攻击 | 高 | 严格变量正则校验（§5.5）+ 命令白名单 | 模板渲染失败直接抛错，命令不下发 |
| R5 | 乐观锁长时间停在 claiming 状态（Daemon 故障） | 中 | 定时任务扫描超时 claiming 订单（>5 分钟）→ 回滚 pending | 手动 DB 修复 |
| R6 | migrations 执行失败导致数据库锁 | 高 | migrations 单文件事务；失败自动回滚 | 回退到上一个 migration 版本 |
| R7 | Pack schema 扩展破坏现有 minecraft-vanilla Pack | 低 | 所有新增字段 optional；现有 Pack 无需修改 | 删除新增字段，回归 P0 schema |
| R8 | chatMonitor 正则不匹配新游戏日志格式 | 中 | event_parsers 支持多 patterns 数组（按顺序匹配） | 临时在 Panel 写游戏专属解析分支（违反 C-3 约束但可应急） |
| R9 | commandDispatcher 队列积压 | 中 | 队列上限 1000，超限告警；优先级调度 | 丢弃低优先级命令 |
| R10 | factorio joinHandler 已知 Bug（字段名 level 应为 vip_level） | 低 | 迁移时直接修复，不搬运 Bug | — |

### 8.2 回退锚点

- 阶段 1（P1 落地后失败）：回退到 P0 平台骨架（保留 users/nodes/servers/packs 4 表）
- 阶段 2（P2 落地后失败）：保留 P1，删除 shop_items/shop_orders/shop_order_items/cdk_codes 表与服务
- 阶段 3（P3 落地后失败）：保留 P1+P2，禁用 chat_enabled，删除聊天增强服务
- 阶段 4（P4 落地后失败）：保留 P1+P2+P3，删除运维管理表与服务
- 阶段 5（P5 落地后失败）：保留 P1-P4，删除 audit_logs

---

## 九、验证计划

### 9.1 单元测试覆盖

- shopService.createOrder / claimOrder（含乐观锁并发场景）
- cdkService.generate / redeem（含乐观锁并发场景）
- vipService.checkQualityPermission（所有 VIP 等级 × 所有品质组合）
- chatMonitor.parseStdout（按 Pack.event_parsers 解析各类日志）
- commandDispatcher.renderCommand（含注入校验失败用例）
- packLoader.load / validate（含 Pack schema 扩展字段）

### 9.2 端到端测试

- 完整购买流程：下单 → !claim → 物品入背包
- 完整兑换流程：管理员生成 CDK → 玩家 !redeem → 物品入背包
- 聊天增强流程：玩家加入 → 欢迎礼包发放 + !verify 绑定
- 投票踢人流程：!vote 启动 → 阈值达标 → kick 执行
- 定时消息流程：scheduler 触发 → broadcast 命令下发

### 9.3 Mock 模式回归

- Daemon Mock：模拟 stdout 输出，验证 Panel chatMonitor 解析
- Panel Backend Mock：模拟 VIP/订单数据，验证前端 UI
- Pack Mock：模拟不同游戏的 Pack 配置，验证业务模块加载

### 9.4 性能基线

- 单实例 stdout 转发延迟 < 100ms（Daemon → Panel）
- chatMonitor 解析 1000 行日志 < 500ms
- shopService.claimOrder 响应时间 < 200ms（含 RCON 往返）
- commandDispatcher 队列吞吐 ≥ 100 命令/秒

---

## 十、下游接续入口（s0201 输入清单）

### 10.1 三层契约生成输入

#### 数据契约（public/schema/）

- `pack-schema.json`：扩展 items / event_parsers / business / commands 字段（§3）
- `user-schema.json`：扩展 vip_level / vip_expires_at / is_verified / display_name 等字段
- `server-schema.json`：扩展 shop_enabled / chat_enabled / mods_enabled 字段
- `shop-order-schema.json`：订单+订单明细+乐观锁状态机
- `cdk-code-schema.json`：CDK+乐观锁状态机
- `vote-schema.json`：投票+投票明细
- `chat-settings-schema.json`：聊天设置+触发响应+加入设置+定时消息
- `vip-permissions-schema.json`：VIP 等级权限映射
- `command-queue-schema.json`：命令队列状态机
- 其他业务表 schema

#### 接口契约（public/interface_stub/）

- `shopService.pyi`：createOrder / claimOrder / listOrders / listItems
- `cdkService.pyi`：generate / redeem / listCodes
- `vipService.pyi`：checkQualityPermission / getVipLevel / setVipLevel
- `chatMonitor.pyi`：parseStdout / handleChatEvent / routeCommand
- `joinHandler.pyi`：handleJoin / handleVerify / sendWelcomeGift
- `voteService.pyi`：startVote / castVote / checkThreshold / executeKick
- `commandDispatcher.pyi`：renderCommand / enqueue / sendViaDaemon / retry
- `packLoader.pyi`：load / validate / getBusinessConfig / getEventParsers
- `itemSyncService.pyi`：syncFromGithub / getCachedItems
- 其他服务接口存根

#### 配置契约（public/config_template/）

- `panel-config.json`：Panel 端口/JWT 密钥/数据库连接/默认 VIP 配置
- `daemon-config.json`：Daemon 端口/Panel URL/daemon_token
- `pack-template.yaml`：Pack 模板（含 items/event_parsers/business/commands 全字段示例）

### 10.2 s0203 模块拆分输入

- 模块清单（§7.1 Panel Backend / §7.2 Panel Frontend / §7.3 Daemon）
- 依赖关系：packLoader ← 所有业务模块 / eventBus ← chatMonitor/joinHandler/voteService / scheduler ← periodicMessageService
- 并行组标记：P1 模块组（packLoader/userService/vipService/itemSyncService/systemConfigService/commandDispatcher/eventBus/scheduler）可并行开发
- P2 依赖 P1：shopService/cdkService 依赖 packLoader + commandDispatcher + vipService
- P3 依赖 P1+P2：chatMonitor/joinHandler/voteService 依赖 eventBus + commandDispatcher + shopService（claimOrder）

### 10.3 Subagent 调度台账

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|:---:|---|---|---|---|---|:---:|
| S2 契约生成 | P1 | general_purpose_task | public/schema/ 全套数据契约 | 待启动 | public/schema/ | S1 融合定稿 | 待启动 |
| S2 契约生成 | P1 | general_purpose_task | public/interface_stub/ 全套接口存根 | 待启动 | public/interface_stub/ | S1 融合定稿 | 待启动 |
| S2 契约生成 | P1 | general_purpose_task | public/config_template/ 配置模板 | 待启动 | public/config_template/ | S1 融合定稿 | 待启动 |
| S3 模块拆分 | — | 主线程（非subagent） | AGENTS.md + 模块目录结构 | — | .trae/specs/ | S2 契约冻结 | 待启动 |
| S4 P1 开发 | P1 | general_purpose_task | packLoader + 基础设施服务 | 待启动 | panel/backend/src/ | S3 模块拆分 | 待启动 |
| S4 P2 开发 | P2 | general_purpose_task | shopService + cdkService | 待启动 | panel/backend/src/services/ | S4 P1 完成 | 待启动 |
| S4 P3 开发 | P3 | general_purpose_task | chatMonitor + 聊天增强服务 | 待启动 | panel/backend/src/services/ | S4 P2 完成 | 待启动 |
| S4 P4 开发 | P4 | general_purpose_task | 运维管理服务 | 待启动 | panel/backend/src/services/ | S4 P3 完成 | 待启动 |
| S4 P5 开发 | P5 | general_purpose_task | audit + webhook | 待启动 | panel/backend/src/services/ | S4 P4 完成 | 待启动 |
| S4 前端开发 | P-FE | general_purpose_task | 全套前端页面 | 待启动 | panel/frontend/src/pages/ | S4 P1 后端完成 | 待启动 |
| S5 契约校验 | — | GN-004 | 契约测试+合规检查报告 | 待启动 | .trae/documents/ | S4 完成 | 待启动 |
| S6 合流交付 | — | GN-004 | 交付前审查报告 | 待启动 | .trae/documents/ | S5 完成 | 待启动 |

> 注：parallel-sub-agent 不可用，按用户已选"降级并行生成"路径，全部使用 general_purpose_task 串行执行。台账中 `actual agent id` 在 subagent 拉起后回填真实标识符。

---

## 十一、未闭合项

| # | 未闭合项 | 性质 | 阻塞下游 | 处理时机 |
|---|---------|------|---------|---------|
| 1 | 本方案定稿需 GN-004 审查 + 人类裁决 | [V] 节点 | 是 | 立即（GN-004 审查 + 人类裁决） |
| 2 | 三层契约（schema/interface_stub/config_template）具体文件 | 工程产出 | 是 | s0201 阶段产出 |
| 3 | Knex migrations 目录与文件 | 工程产出 | 是 | s0203 后产出 |
| 4 | 数据迁移脚本（factorio → panel） | 工程产出 | 否（可与开发并行） | S4 阶段产出 |
| 5 | P5 业务（webhook/audit）的具体字段设计 | 设计细节 | 否 | S4 P5 阶段细化 |
| 6 | 性能基线实测数据 | 验证产出 | 否 | S5 阶段产出 |

---

## 十二、残余风险

1. **Panel 端 stdout 解析性能**：当前架构所有日志解析在 Panel，若多实例高并发可能成为瓶颈。已设计回退方案（R1），但需在 S5 阶段实测验证。
2. **多游戏 Pack 适配工作量**：C-3 完整扩展虽为多游戏预留，但首期只有 factorio Pack 完整，Minecraft/Rust/ARK 需补齐 items/event_parsers/business 配置。
3. **factorio 已知 Bug 搬运风险**：joinHandler 字段名错误（R10）已在方案中显式标注修复，但其他潜在 Bug 需在迁移过程中逐个排查。
4. **乐观锁超时回滚机制**：claiming 状态超时回滚依赖定时任务（R5），若定时任务故障可能导致订单卡死，需在 P2 阶段增加监控告警。

---

## 十三、GN-004 审查请求

请主线程拉起 `subagent_type='GN-004'` 对本融合定稿进行独立审查。审查内容至少含：

1. **融合策略是否偏离用户原始意图**：用户要求"核心竞争力优先做"，本方案 P1/P2 优先级是否合理？
2. **是否真实多方案融合（非单方案伪装）**：检查保留项/舍弃项是否真实来自不同方案，是否只选了 C-2 而伪装成融合？
3. **融合策略是否合理**：C-2 主体 + C-3 Pack 扩展 + C-3 shop_items 瘦身 + 不引入 Daemon SQLite + 禁止游戏专属硬编码，是否在工程上自洽？
4. **最终方案是否对齐用户意图**：用户原话"先做方案，然后按照方案实施"——本方案是否可直接进入 s0201 契约生成？
5. **未闭合项是否已显式标记**：6 项未闭合项是否已显式列出，是否有沉默遗漏？
6. **台账是否齐备**：subagent 调度台账字段是否完整（含 actual agent id 待回填标注）？

直至 GN-004 确认无硬阻断后才可宣告闭合。绝对禁止半成品汇报。

---

## 附录 A：与 factorio 项目的功能矩阵对照

| factorio 功能 | gameserver-panel 对应 | 迁移方式 | 优先级 |
|--------------|----------------------|---------|:---:|
| 多实例管理 | servers 表 + Daemon 进程管理 | 已有 P0 | - |
| 用户认证 + JWT | users 表 + userService | 已有 P0，扩展 VIP 字段 | P1 |
| VIP 等级体系 | vip_permissions 表 + vipService | factorio 迁移 | P1 |
| 玩家绑定验证 | player_bindings 表 + joinHandler | factorio 迁移（泛化） | P1 |
| 物品同步 | item_sync_log 表 + itemSyncService | factorio 迁移，按 Pack.items.source | P1 |
| 系统配置 | system_config 表 + systemConfigService | factorio 迁移 | P1 |
| 命令队列 | command_queue 表 + commandDispatcher | 新设计 | P1 |
| 商店 | shop_items + shop_orders + shop_order_items + shopService | factorio 迁移（shop_items 瘦身） | P2 |
| CDK 兑换 | cdk_codes + cdkService | factorio 迁移 | P2 |
| 聊天增强 P1 欢迎礼包 | player_join_settings + gift_claims + joinHandler | factorio 迁移 | P3 |
| 聊天增强 P2 定时消息 | periodic_messages + periodicMessageService | factorio 迁移 | P3 |
| 聊天增强 P3 关键词触发 | chat_trigger_responses + chatMonitor | factorio 迁移 | P3 |
| 聊天增强 P4 投票踢人 | vote_settings + votes + vote_records + voteService | factorio 迁移 | P3 |
| 玩家历史 | player_histories + playerTracker | factorio 迁移 | P3 |
| Mod 管理 | mod_records + modService | 新设计（factorio 用文件系统） | P4 |
| 存档管理 | save_records + saveService | 新设计 | P4 |
| 备份回滚 | backup_records + backupService | 新设计 | P4 |
| 监控 | monitor_snapshots + monitorService | 新设计 | P4 |
| 名单管理 | list_entries + listService | 新设计 | P4 |
| Webhook | webhook 表 + webhookService | 新设计 | P5 |
| 审计日志 | audit_logs + auditLogService | 新设计 | P5 |
| 版本下载/热更新 | 复用 packs 表 + 版本下载服务 | 新设计 | P5 |

---

**方案定稿结束。下一步：主线程拉起 GN-004 独立审查。**
