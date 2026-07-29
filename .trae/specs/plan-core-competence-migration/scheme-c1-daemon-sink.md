---
title: C-1 Daemon 业务能力下沉迁移方案
scheme_id: C-1
parent_plan: plan-core-competence-migration
created_at: 2026-07-02
status: 草案
baseline_panel: P0 平台骨架（4 表 + 双层 Panel/Daemon）
baseline_source: factorio v2.16.0（17 表 + 16 服务 + 17 路由 + 21 页面）
owner: 架构组
---

# C-1 Daemon 业务能力下沉迁移方案

> 本文件是 `plan-core-competence-migration` 下的方案文档（C-1 候选方案）。
> 与 C-2（Panel 全集中）、C-3（折中）并列对比，最终方案以 `s0103-merging-schemes` 融合结论为准。

## 0. 文档交接三段

### 0.1 工程过程（已完成）
- 已读 `gameserver-panel/panel/backend/src/db/schema.ts`：确认现有 4 张表（users/nodes/servers/packs）的字段、索引、外键现状。
- 已读 `gameserver-panel/public/schema/pack-schema.ts` 与 `packs/minecraft-vanilla/pack.yaml`：确认 Pack 契约现状（startup/protocol/config/commands/versions/backup/ui/resources 八段）。
- 已读 `gameserver-panel/public/interface_stub/daemon-rest.ts` 与 `public/schema/ws-events.ts`：确认 Daemon REST（health/instances/state/start/stop/command）+ WS 事件（connected/instance.started/instance.stopped/console.output/state.change）现状。
- 已读 `factorio/backend/src/db/schema.ts`：完整掌握 17 张表结构（实际 17 张，非背景描述的 13 张）。
- 已读 `factorio/backend/src/services/{eventBus,commandDispatcher,itemSyncService,shopService,cdkService,vipService,joinHandler,chatMonitor}.ts`：掌握关键基础设施与业务规则。
- 已读历史 spec：`build-factorio-server-manager/spec.md`（factorio 单体历史）、`v2.0.0-instance-centric-spec.md`（factorio 多实例化历史），确认不适用于当前双层架构迁移。
- 已调用 `s0401-safe-file-writing` 完成写前闸门判定（ALLOWED）。

### 0.2 交接状态
- 当前任务：撰写 C-1 方案文档 → **进行中**（待人类评审）。
- 后续依赖：方案评审通过后由 `s0103-merging-schemes` 与 C-2/C-3 方案融合 → `s0201-generating-global-contracts` 生成三层契约 → `s0203-topology-based-module-splitting` 拆分模块。
- 阻断条件：本方案中标记的 **[V] 价值判断节点**（Pack schema 是否承担业务配置、Daemon 本地 SQLite 是否引入、Panel↔Daemon 业务通信契约形态）必须经人类裁决后方可推进。

### 0.3 最终结果（本方案交付物）
- 本文件：`/home/air/Desktop/gameserver-panel/.trae/specs/plan-core-competence-migration/scheme-c1-daemon-sink.md`
- 涵盖 7 大章节：架构总览 / 数据库 schema / 模块拆分与实施顺序 / 关键业务流程 / 数据迁移 / 风险与回退 / 验证计划
- 不含代码实现（按任务要求"只写方案"）

---

## 1. 架构总览

### 1.1 Panel / Daemon 职责矩阵

> 原则：**Panel 拥有所有"真理型"数据（用户/订单/CDK/VIP/物品池/系统配置），Daemon 拥有"就近型"能力（实时事件解析、RCON 命令执行、per-server 状态）。**

| 能力域 | 模块 | 所在端 | 数据归属 | 触发模式 |
|--------|------|--------|----------|----------|
| 用户/认证 | userService / jwt / roles / permissions | Panel | panel.db.users | REST 同步 |
| 节点管理 | nodeService | Panel | panel.db.nodes | REST 同步 |
| 服务器（实例）管理 | serverService | Panel | panel.db.servers | REST 同步 + WS 推送 |
| Pack 注册 | packLoader / packRegistry | Panel | panel.db.packs + 文件系统 | 启动加载 |
| VIP 等级 | vipService | Panel | panel.db.vip_permissions + users.vip_* | REST 同步 |
| 商店订单 | shopService（订单 CRUD + 乐观锁） | Panel | panel.db.shop_orders / shop_order_items / shop_items | REST 同步 |
| CDK 管理 | cdkService（生成/列表/禁用/兑换乐观锁） | Panel | panel.db.cdk_codes | REST 同步 |
| 物品池同步 | itemSyncService（GitHub → Pack.items） | Panel | panel.db.item_sync_log + Pack.items | 定时 + 手动 |
| 系统配置 | systemConfigService | Panel | panel.db.system_config | REST 同步 |
| 玩家绑定 | bindingService（verify_code/状态） | Panel | panel.db.player_bindings | REST 同步 |
| 实例进程管理 | instanceManager / processDriver / stateMachine | Daemon | 内存 | REST + WS |
| RCON 协议 | rconClient / stdinClient / ProtocolFactory | Daemon | 无（无状态协议层） | REST + WS |
| 事件总线 | eventBus（chat/player:join/player:leave 解析与发布） | **Daemon**（下沉） | 内存 | 进程 stdout 订阅 |
| 聊天监控 | chatMonitor（!help/!status/!verify/!claim 解析） | **Daemon**（下沉） | 内存缓冲 + 配置查 Pack | eventBus 订阅 |
| 玩家追踪 | playerTracker（在线列表） | **Daemon**（下沉） | 内存 | eventBus 订阅 |
| 玩家加入处理 | joinHandler（欢迎语/首次礼包/回归礼包） | **Daemon**（下沉） | Daemon 本地 SQLite（登录历史/礼包领取记录） | eventBus 订阅 |
| 定时消息 | periodicMessageService | **Daemon**（下沉） | Daemon 本地 SQLite（last_executed_at） | scheduler 定时 |
| 投票踢人 | voteService（实时阈值判定 + RCON kick） | **Daemon**（下沉） | Daemon 本地 SQLite（active votes） | eventBus + scheduler |
| 物品发放 | commandDispatcher（RCON 命令队列 + 重试 + 预热） | **Daemon**（下沉） | 内存队列 | Panel REST 调用 + Daemon 内部调用 |
| 调度器 | scheduler（Daemon 内部定时任务） | **Daemon**（下沉） | 内存 | 启动注册 |
| 监控 | monitorService（CPU/内存/UPS） | Daemon | 内存环形缓冲 | 定时采集 + REST 查询 |
| 备份 | backupService（存档/配置快照） | Daemon | 文件系统 | REST 同步 |
| Mod 管理 | modService / modDependency | Daemon | 文件系统 + mod-list.json | REST 同步 |
| 存档管理 | saveService | Daemon | 文件系统 | REST 同步 |
| 名单管理 | listService（ban/whitelist/admin） | Daemon | server-*.json | REST 同步 |
| 日志持久化 | logService | Daemon | instances/{id}/logs/ | stdout 落盘 |
| 版本下载 | downloader | Daemon | 文件系统 | REST + SSE |
| 热更新 | updateService | Daemon | 文件系统 | REST + 重启 |
| Webhook | webhookService | Panel（事件源）+ 外部 | panel.db.system_config | Panel 事件触发 |

### 1.2 数据流图（关键业务流向）

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Panel (port 3000)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  users   │  │  shop_*  │  │ cdk_codes│  │ vip_perm │  panel.db  │
│  │  nodes   │  │ orders   │  │          │  │ bindings │  (SQLite)  │
│  │ servers  │  │  items   │  │          │  │ sys_cfg  │            │
│  │  packs   │  │ order_it │  │          │  │          │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│       ▲              │              │              │                │
│       │              │ ①REST claim  │ ①REST redeem │                │
│       │              ▼              ▼              │                │
│  ┌─────────────────────────────────────────────────┐                │
│  │  Panel Service Layer (shopService/cdkService)   │                │
│  │  ① 乐观锁 pending/unused → claiming              │                │
│  │  ② 调 daemonClient.deliverItems() ─────────────┐│                │
│  │  ③ 全部成功 → claimed；失败 → 回滚             ││                │
│  └────────────────────────────────────────────────┘│                │
└─────────────────────────────────────────────────────│────────────────┘
                                                       │ ② HTTP POST
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Daemon (port 8080)                          │
│  ┌──────────────────────────────────────────────────┐               │
│  │  commandDispatcher (RCON 队列 + 预热 + 重试)      │ ◄ ②deliverItems│
│  │  ③ dispatchLuaCommandForInstance(serverId, cmd)  │               │
│  └────────────┬─────────────────────────────────────┘               │
│               │ ④ stdin/rcon                                        │
│               ▼                                                      │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐   │
│  │   game process (stdout)      │  │  eventBus (chat/join/leave)│   │
│  └────────────┬─────────────────┘  └───────────┬───────────────┘   │
│               │ ⑤ stdout line                   │ ⑥ subscribe       │
│               ▼                                  ▼                   │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐   │
│  │  chatMonitor / joinHandler   │  │  playerTracker            │   │
│  │  voteService / periodicMsg   │  │  (online list 内存)       │   │
│  │  (本地状态 + Pack 配置)       │  │                           │   │
│  └────────────┬─────────────────┘  └───────────────────────────┘   │
│               │ ⑦ !verify → WS 上行查 Panel                        │
│               │ ⑧ !claim  → REST 调 Panel /api/shop/claim          │
│               │ ⑨ join 礼包 → 查 Pack.business.join_handler        │
│               ▼                                                      │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐   │
│  │  daemon.db (SQLite, 本地)     │  │  WS uplink → Panel        │   │
│  │  player_history / gift_claims │  │  chat_event / verify_req  │   │
│  │  votes / periodic_last_exec   │  │                           │   │
│  └──────────────────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**关键流向编号说明**：
1. Panel 端 shopService/cdkService 在事务内做乐观锁占用（pending→claiming 或 unused→claiming）。
2. Panel 端通过 daemonClient 调 Daemon `POST /api/instances/:id/deliver-items`，传物品列表 [{item, count, quality}]。
3. Panel 端收到 Daemon 结果：全部成功→置 claimed；部分失败→回滚 pending/unused 允许重试。
4. Daemon 端 commandDispatcher 接收物品发放请求，渲染 Pack.commands.give_item 模板，按 RCON 协议发送。
5. 游戏进程 stdout 每行进入 Daemon eventBus。
6. eventBus 解析后发布 chat/player:join/player:leave 事件，chatMonitor/joinHandler/playerTracker 订阅。
7. !verify 命令：Daemon 解析 → WS 上行 Panel `chat.verify` 事件 → Panel bindingService 校验 → WS 下行 `verify.result` → Daemon 广播消息。
8. !claim 命令：Daemon 解析 → 调 Panel `POST /api/shop/claim` 或 `POST /api/cdk/redeem`（带 claim_code + player_name + server_id） → Panel 走流程 ①②③ → Daemon 发物品 → 返回结果给 Daemon → Daemon 广播。
9. 玩家加入礼包：Daemon joinHandler 订阅 player:join → 查 Pack.business.join_handler.gifts 配置 + Daemon 本地 gift_claims 表（防重发） → 就近 RCON 发物品。

### 1.3 Pack schema 扩展设计

> [V] 价值判断节点：Pack schema 是否承担业务能力配置？
> 倾向：是。这是 C-1 方案的核心差异点——把 per-Pack 的业务能力（聊天监控/加入处理/定时消息/投票踢人）下沉到 Pack 描述，Daemon 加载 Pack 时一并加载业务配置，无需 Panel 推送。

在现有 `GamePackSchema` 基础上扩展三段（新增字段全部 optional，向后兼容）：

```yaml
# 新增段 1：物品池（itemSyncService 同步目标）
items:
  source_url: https://raw.githubusercontent.com/airxw/factorioitem/main/items.json  # GitHub 同步源
  sync_enabled: true
  sync_interval_hours: 24
  quality_tiers: [normal, uncommon, rare, epic, legendary]   # 该 Pack 支持的品质枚举
  categories: [ammo, armor, capsule, fluid, item, recipe, tile]
  # 同步结果写入 panel.db.shop_items（item_name 由 Pack 校验规则验证）

# 新增段 2：业务能力开关 + 配置（Daemon 端读取）
business:
  chat_monitor:
    enabled: true
    command_prefix: '!'
    global_cooldown_seconds: 3
    builtin_commands: ['!help', '!status', '!players', '!uptime']
    # !verify / !claim 由 Daemon 硬编码路由到 Panel（不在此配置）
  join_handler:
    enabled: true
    join_message: '欢迎 {player_name} 加入 {server_name}！当前在线 {online_count} 人。'
    first_join_message: '{player_name} 首次加入服务器，大家欢迎！'
    leave_message: '{player_name} 已离开服务器。'
    first_gift:
      enabled: false
      items: []  # [{name, count, quality}]
    relogin_gift:
      enabled: false
      items: []
      cooldown_hours: 24
      daily_limit: 1
      total_limit: 0  # 0=无限
    gift_command_interval_ms: 300
    join_debounce_ms: 2000
  periodic_messages:
    enabled: false
    # 任务列表存 panel.db.periodic_messages（Panel 管理），Daemon 拉取并执行
    sync_interval_seconds: 30
  vote_kick:
    enabled: true
    pass_ratio: 0.65
    min_votes: 3
    vote_threshold: 6
    vote_duration_seconds: 60
    cooldown_seconds: 300
    target_cooldown_seconds: 600
    admin_immune: true
    vip_immune_min_level: 3
    trigger_keywords: ['投票踢人', 'votekick', 'vk']

# 新增段 3：commands 模板扩展（已有 commands 段，新增以下键）
commands:
  # 已有：broadcast / give_item / kick_player / ban_player / list_players / save_world / op_player / set_time / set_weather
  # 新增（Factorio 用 silent-command，Minecraft 用原生指令，由 Pack 模板差异化）：
  silent_insert: "/silent-command game.players['{{player}}'].insert{name='{{item}}',count={{count}},quality='{{quality}}'}"  # Factorio 专用
  private_message: "/silent-command if game.players['{{player}}'] then game.players['{{player}}'].print('{{message}}') end"  # Factorio 专用
  # Minecraft 可用 /tell {{player}} {{message}}
```

**Pack schema 校验规则扩展**：
- `items.*` 段全部 optional，缺省时 itemSyncService 跳过该 Pack。
- `business.*` 段全部 optional，缺省时 Daemon 关闭对应业务能力。
- `commands.silent_insert` / `commands.private_message` 在 Pack.game=factorio 时建议提供；game=minecraft 时使用 `give_item` + `tell`。
- 所有 `business.*` 配置在 Pack 加载时由 Panel 端 packRegistry 校验，Daemon 启动实例时拉取 Pack 全量（含 business 段）。

**配置覆盖优先级**（从高到低）：
1. Panel 端 `panel.db.system_config` 中 per-server 覆盖（管理员可在 Panel UI 调整某 server 的 business 配置）。
2. Pack YAML 内 `business.*` 默认值。
3. Daemon 内置硬编码兜底（最简默认）。

> 覆盖配置由 Panel 在 `POST /api/servers/:id/pack-config` 推送到 Daemon，Daemon 缓存在内存（实例启动时拉取）。

---

## 2. 数据库 schema 设计

### 2.1 表清单总览

> factorio 实际 17 张表（非任务描述的 13 张），gameserver-panel 现有 4 张表。
> 迁移后 panel.db 共 18 张表（复用 4 + 新增 14），daemon 端引入独立 SQLite 4 张表（per-server 状态）。

| # | 表名 | 所在 DB | 来源 | 用途 |
|---|------|---------|------|------|
| 1 | users | panel.db | 已有 + 扩展 | 用户认证（扩展 vip_level / vip_expires_at / is_verified / player_name） |
| 2 | nodes | panel.db | 已有 | Daemon 节点注册 |
| 3 | servers | panel.db | 已有 | 服务器（实例）元数据 |
| 4 | packs | panel.db | 已有 + 扩展 | Pack 元数据（扩展 items_source_json / business_config_json） |
| 5 | vip_permissions | panel.db | 新增（迁移自 factorio） | VIP 等级权限映射 |
| 6 | player_bindings | panel.db | 新增（迁移自 factorio） | 网站用户 ↔ 游戏玩家绑定 |
| 7 | shop_items | panel.db | 新增（迁移自 factorio） | 商品目录（per-server） |
| 8 | shop_orders | panel.db | 新增（迁移自 factorio） | 订单头 |
| 9 | shop_order_items | panel.db | 新增（迁移自 factorio） | 订单明细 |
| 10 | cdk_codes | panel.db | 新增（迁移自 factorio） | CDK 兑换码 |
| 11 | item_sync_log | panel.db | 新增（迁移自 factorio） | 物品同步日志 |
| 12 | system_config | panel.db | 新增（迁移自 factorio） | 系统配置（含 per-server business 覆盖） |
| 13 | chat_trigger_responses | panel.db | 新增（迁移自 factorio） | 自定义触发响应规则（Panel 管理，Daemon 拉取） |
| 14 | periodic_messages | panel.db | 新增（迁移自 factorio） | 定时消息任务（Panel 管理，Daemon 拉取） |
| 15 | audit_logs | panel.db | 新增 | 操作审计日志（替代 factorio logs 路由） |
| 16 | webhook_configs | panel.db | 新增 | Webhook 配置（替代 factorio system_config 中的 webhook 段） |
| 17 | server_pack_overrides | panel.db | 新增 | per-server Pack business 配置覆盖 |
| 18 | migrations_log | panel.db | 新增 | Knex migration 执行记录（与 knex_migrations 互补） |
| D1 | player_history | daemon.db | 新增（Daemon 本地） | 玩家登录历史（首次/回归判定） |
| D2 | gift_claims | daemon.db | 新增（Daemon 本地） | 礼包领取记录（防重发 + 限额） |
| D3 | votes_active | daemon.db | 新增（Daemon 本地） | 活跃投票（阈值判定中间态） |
| D4 | periodic_last_exec | daemon.db | 新增（Daemon 本地） | 定时任务最后执行时间 |

> **不迁移的 factorio 表**：
> - `instances`：gameserver-panel 已用 `servers` 表替代（servers.id 等价于 factorio instance_id）。
> - `chat_settings` / `player_join_settings` / `vote_settings`：配置下沉到 Pack.business 段，per-server 覆盖走 server_pack_overrides 表。
> - `votes` / `vote_records`：投票活跃态下沉到 Daemon 本地（D3），结束时 WS 上行 Panel 写 audit_logs。
> - `item_sync_log` 保留在 Panel（同步日志需要全局视图）。

### 2.2 各表字段定义（关键字段）

#### 2.2.1 users（扩展）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | string | 是 | - | 主键（已有） |
| email | string | 是 | - | 唯一（已有） |
| username | string | 是 | - |（已有） |
| password_hash | string | 是 | - |（已有） |
| role | string | 是 | 'viewer' | system_admin/admin/operator/viewer（已有） |
| status | string | 是 | 'active' |（已有） |
| created_at | text | 是 | - |（已有） |
| **vip_level** | integer | 否 | 0 | **新增**：VIP 等级 0-5+ |
| **vip_expires_at** | text | 否 | null | **新增**：VIP 过期时间，null=永久 |
| **is_verified** | boolean | 否 | false | **新增**：是否已绑定游戏玩家 |
| **player_name** | text | 否 | null | **新增**：默认绑定玩家名（取代 factorio_player_name，泛化字段名） |
| **last_login_at** | text | 否 | null | **新增**：最近登录时间 |
| **last_login_ip** | text | 否 | null | **新增**：最近登录 IP |

索引：`idx_users_role`、`idx_users_status`（已有则保留）

#### 2.2.2 servers（扩展）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | string | 是 | - |（已有） |
| name | string | 是 | - |（已有） |
| pack_id | string | 是 | - |（已有） |
| game_type | string | 是 | - |（已有） |
| node_id | string | 是 | - |（已有） |
| owner_user_id | string | 是 | - |（已有） |
| status | string | 是 | 'stopped' |（已有） |
| port | integer | 是 | - |（已有） |
| rcon_port | integer | 是 | - |（已有） |
| rcon_password_enc | text | 否 | null |（已有） |
| resource_limits_json | text | 否 | null |（已有） |
| created_at | text | 是 | - |（已有） |
| updated_at | text | 是 | - |（已有） |
| **shop_enabled** | boolean | 否 | true | **新增**：本服是否启用商店 |
| **chat_monitor_enabled** | boolean | 否 | true | **新增**：本服是否启用聊天监控（覆盖 Pack） |
| **vote_kick_enabled** | boolean | 否 | true | **新增**：本服是否启用投票踢人 |

索引：`idx_servers_node_id`、`idx_servers_owner`、`idx_servers_status`

#### 2.2.3 packs（扩展）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | string | 是 | - |（已有） |
| game | string | 是 | - |（已有） |
| variant | string | 是 | - |（已有） |
| display_name | string | 是 | - |（已有） |
| version | string | 是 | - |（已有） |
| enabled | boolean | 是 | true |（已有） |
| loaded_at | text | 是 | - |（已有） |
| **items_source_url** | text | 否 | null | **新增**：物品同步源 URL |
| **items_synced_at** | text | 否 | null | **新增**：最近同步时间 |
| **items_count** | integer | 否 | 0 | **新增**：已同步物品数 |
| **business_config_json** | text | 否 | null | **新增**：business 段原始 JSON（Pack YAML 加载时序列化） |

#### 2.2.4 vip_permissions（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| vip_level | integer | 是 | - | 主键 |
| display_name | string(50) | 是 | - | 显示名 |
| permissions | text | 是 | - | JSON 数组 |
| max_quality | string(20) | 否 | null | 可购最高品质，null=走默认规则 |
| daily_limit | integer | 否 | null | 每日限额，null=走默认规则 |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

种子：VIP 0（普通用户，max_quality=none, daily_limit=0）

#### 2.2.5 player_bindings（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | 自增主键 |
| user_id | string | 是 | - | 外键 → users.id |
| player_name | string(100) | 是 | - | 游戏内玩家名（取代 factorio_player_name） |
| verify_code | string(6) | 是 | - | 验证码 |
| status | string(20) | 是 | 'pending' | pending/verified/rejected |
| verified_at | text | 否 | null | |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

约束：`uq_bindings_user`（一个 user 只能有一个活跃绑定）、`uq_bindings_player_status`（player_name + status 唯一，避免重复 verified）

#### 2.2.6 shop_items（新增，迁移自 factorio，字段名按 server_id 改造）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | 自增主键 |
| server_id | string(64) | 是 | - | 外键 → servers.id（取代 instance_id） |
| item_name | string(100) | 是 | - | 物品内部名 |
| display_name | string(200) | 否 | null | |
| category | string(50) | 否 | null | |
| quality | string(20) | 是 | 'normal' | normal/uncommon/rare/epic/legendary |
| vip_level_required | integer | 是 | 0 | @deprecated（品质级校验已取代） |
| daily_limit | integer | 否 | null | null=无限 |
| enabled | boolean | 是 | false | |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

约束：`uq_shop_items_server_item`（server_id + item_name 唯一）
索引：`idx_shop_items_server_id`

#### 2.2.7 shop_orders（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | 自增主键 |
| server_id | string(64) | 是 | - | 取代 instance_id |
| user_id | string | 是 | - | 外键 → users.id |
| status | string(20) | 是 | 'pending' | pending/claiming/claimed/expired |
| claim_code | string(8) | 是 | - | 唯一 |
| items_count | integer | 是 | 0 | |
| claimed_at | text | 否 | null | |
| claimed_player | string(100) | 否 | null | **新增**：兑换玩家名（原 factorio 无） |
| expires_at | text | 是 | - | 创建后 24 小时 |
| created_at | text | 是 | now | |

索引：`idx_shop_orders_user`、`idx_shop_orders_status`、`idx_shop_orders_claim_code`、`idx_shop_orders_server_id`

#### 2.2.8 shop_order_items（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| order_id | integer | 是 | - | 外键 → shop_orders.id |
| item_name | string(100) | 是 | - | |
| quantity | integer | 是 | - | |
| quality | string(20) | 是 | 'normal' | |
| created_at | text | 是 | now | |

索引：`idx_shop_order_items_order_id`、`idx_shop_order_items_item_name`

#### 2.2.9 cdk_codes（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| code | string(8) | 是 | - | 唯一 |
| server_id | string(64) | 是 | - | 取代 instance_id |
| rewards | text | 是 | - | JSON: [{item_name, quality, quantity}] |
| batch_id | string(64) | 是 | - | |
| note | text | 否 | null | |
| created_by | string | 是 | - | 外键 → users.id |
| created_at | text | 是 | now | |
| expires_at | text | 否 | null | null=永久 |
| status | string(20) | 是 | 'unused' | unused/claiming/claimed/disabled |
| claimed_by | string | 否 | null | |
| claimed_at | text | 否 | null | |
| claimed_player | string(100) | 否 | null | |

索引：`idx_cdk_codes_code`、`idx_cdk_codes_server_id`、`idx_cdk_codes_batch_id`、`idx_cdk_codes_status`

#### 2.2.10 item_sync_log（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| pack_id | string | 否 | null | **改造**：原 source 字段改为 pack_id 关联 |
| status | string(20) | 是 | - | success/failed |
| items_count | integer | 是 | 0 | |
| error_message | text | 否 | null | |
| created_at | text | 是 | now | |

#### 2.2.11 system_config（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| key | string(100) | 是 | - | 主键 |
| value | text | 否 | null | |
| updated_at | text | 是 | now | |

> 默认 key：`registration_enabled` / `webhook_url` / `webhook_enabled` / `webhook_secret` / `item_sync_auto_enabled` / `item_sync_interval_hours`

#### 2.2.12 chat_trigger_responses（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| server_id | string(64) | 是 | - | 取代 instance_id |
| trigger_text | string(255) | 是 | - | |
| response_text | text | 是 | - | |
| mode | string(20) | 是 | 'prefix' | prefix/exact/contains |
| case_sensitive | boolean | 是 | false | |
| cooldown_seconds | integer | 是 | 10 | |
| enabled | boolean | 是 | true | |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

索引：`idx_chat_trigger_responses_server_enabled`

#### 2.2.13 periodic_messages（新增，迁移自 factorio）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| server_id | string(64) | 是 | - | 取代 instance_id |
| name | string(100) | 是 | - | |
| type | string(10) | 是 | 'chat' | chat/give |
| content | text | 是 | - | chat=文本；give=JSON 数组 |
| interval_value | integer | 是 | 30 | |
| interval_unit | string(10) | 是 | 'minute' | second/minute/hour |
| target_player | string(100) | 否 | null | null=所有在线 |
| enabled | boolean | 是 | true | |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

> `last_executed_at` 不存 Panel，下沉到 Daemon 本地 `periodic_last_exec` 表（每个 Daemon 各自维护）。

索引：`idx_periodic_messages_server_enabled`

#### 2.2.14 audit_logs（新增）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| actor_user_id | string | 否 | null | 操作者 |
| action | string(50) | 是 | - | login/server.start/order.claim/cdk.redeem/vip.set/... |
| target_type | string(30) | 否 | null | server/order/cdk/user/... |
| target_id | string | 否 | null | |
| detail_json | text | 否 | null | |
| ip | string(45) | 否 | null | |
| created_at | text | 是 | now | |

索引：`idx_audit_logs_actor`、`idx_audit_logs_action`、`idx_audit_logs_created_at`

#### 2.2.15 webhook_configs（新增）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| name | string(50) | 是 | - | |
| url | text | 是 | - | |
| secret | text | 否 | null | 签名密钥 |
| events | text | 是 | - | JSON 数组：触发事件列表 |
| enabled | boolean | 是 | true | |
| created_at | text | 是 | now | |
| updated_at | text | 是 | now | |

#### 2.2.16 server_pack_overrides（新增）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| server_id | string(64) | 是 | - | 外键 → servers.id |
| config_path | string(100) | 是 | - | 点分路径，如 `business.chat_monitor.enabled` |
| config_value | text | 是 | - | JSON 序化值 |
| updated_at | text | 是 | now | |

约束：`uq_overrides_server_path`（server_id + config_path 唯一）

#### 2.2.17 migrations_log（新增）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | |
| migration_id | string(64) | 是 | - | 文件名去 `.ts` |
| direction | string(5) | 是 | - | up/down |
| executed_at | text | 是 | now | |
| execution_ms | integer | 是 | - | 耗时 |
| success | boolean | 是 | - | |
| error_message | text | 否 | null | |

#### 2.2.18 Daemon 本地表（daemon.db）

> 每个 Daemon 节点独立 SQLite，不与 Panel 同步；Daemon 重启时若丢失，玩家登录历史/礼包领取记录会丢失（业务可容忍：首次礼包会重新发，回归礼包会按冷却重新判定）。

##### player_history
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| server_id | string | 是 | 复合主键 |
| player_name | string | 是 | 复合主键 |
| first_seen_at | text | 是 | 首次加入时间 |
| last_login_at | text | 是 | 最近登录时间 |
| last_logout_at | text | 否 | 最近登出时间 |
| login_count | integer | 是 | 0 |

##### gift_claims
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 是 | |
| server_id | string | 是 | 索引 |
| player_name | string | 是 | |
| gift_type | string(20) | 是 | first/relogin |
| claimed_at | text | 是 | |
| items_json | text | 是 | 实际发放物品快照 |

索引：`idx_gift_claims_server_player_type`、`idx_gift_claims_date`

##### votes_active
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | integer | 是 | |
| server_id | string | 是 | |
| target_player | string | 是 | |
| initiator | string | 是 | |
| yes_count | integer | 是 | 0 |
| no_count | integer | 是 | 0 |
| started_at | text | 是 | |
| ends_at | text | 是 | |
| status | string(20) | 是 | active/passed/failed |

##### periodic_last_exec
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| server_id | string | 是 | 复合主键 |
| task_id | integer | 是 | 复合主键（对应 panel.db.periodic_messages.id） |
| last_executed_at | text | 是 | |

### 2.3 Knex migrations 文件命名规范

```
panel/backend/src/db/migrations/
├── 20260702090000_extend_users_with_vip.ts            # 扩展 users 表
├── 20260702090100_extend_servers_with_business.ts     # 扩展 servers 表
├── 20260702090200_extend_packs_with_items.ts          # 扩展 packs 表
├── 20260702090300_create_vip_permissions.ts
├── 20260702090400_create_player_bindings.ts
├── 20260702090500_create_shop_items.ts
├── 20260702090600_create_shop_orders.ts
├── 20260702090700_create_shop_order_items.ts
├── 20260702090800_create_cdk_codes.ts
├── 20260702090900_create_item_sync_log.ts
├── 20260702091000_create_system_config.ts
├── 20260702091100_create_chat_trigger_responses.ts
├── 20260702091200_create_periodic_messages.ts
├── 20260702091300_create_audit_logs.ts
├── 20260702091400_create_webhook_configs.ts
├── 20260702091500_create_server_pack_overrides.ts
├── 20260702091600_create_migrations_log.ts
└── 20260702091700_seed_default_vip0.ts                # 种子数据
```

**规范**：
- 文件名：`YYYYMMDDHHMMSS_<verb>_<object>.ts`，verb 用 create/extend/seed/drop/alter。
- 每个文件导出 `up(knex)` 与 `down(knex)`，幂等设计（hasTable/hasColumn 检查）。
- up 内禁止删除已有数据；alter column 必须保留旧值兼容。
- 执行后写入 `migrations_log` 表。
- Daemon 本地 4 张表不走 Knex migrations，Daemon 启动时 `ensureSchema()` 幂等创建（参考 factorio 现有 schema.ts 模式）。

---

## 3. 模块拆分与实施顺序

> 优先级：P1 基础设施 → P2 商店/CDK → P3 聊天增强 → P4 Mod/存档/备份/监控/玩家/名单 → P5 日志/版本/热更新/Webhook/系统设置。
> 每个 P 完成后即"可发版"，不允许跨 P 大跃进。

### 3.1 P1：基础设施 + 用户/VIP

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|--------------|
| Knex migrations 框架 | Panel | 无 | `panel/backend/src/db/migrations/index.ts`、`panel/backend/src/db/migrator.ts`、`panel/backend/src/db/migrations/20260702090000_extend_users_with_vip.ts` 等 4 个 P1 migration |
| userService | Panel | users 表 | `panel/backend/src/services/userService.ts`、`panel/backend/src/api/routes/users.ts`（重构） |
| vipService | Panel | vip_permissions 表、userService | `panel/backend/src/services/vipService.ts`、`panel/backend/src/api/routes/vip.ts` |
| bindingService | Panel | player_bindings 表、userService | `panel/backend/src/services/bindingService.ts`、`panel/backend/src/api/routes/bindings.ts` |
| role/permission 体系 | Panel | users 表 | `panel/backend/src/core/auth/roles.ts`（扩展 system_admin）、`panel/backend/src/core/auth/permissions.ts`（扩展） |
| itemSyncService | Panel | packs 表、shop_items 表（P2 前置） | `panel/backend/src/services/itemSyncService.ts`、`panel/backend/src/api/routes/items.ts` |
| Pack schema 扩展 | Panel | packs 表、pack-schema.ts | `public/schema/pack-schema.ts`（修改）、`panel/backend/src/core/packs/loader.ts`（修改） |
| daemonClient.deliverItems | Panel | daemonClient | `panel/backend/src/daemonClient/client.ts`（扩展）、`panel/backend/src/daemonClient/types.ts`（扩展） |
| Daemon eventBus | Daemon | processDriver | `daemon/src/services/eventBus.ts`、`daemon/src/services/parser.ts`（按 Pack.game 差异化解析） |
| Daemon commandDispatcher | Daemon | eventBus、protocol | `daemon/src/services/commandDispatcher.ts`、`daemon/src/services/commandTemplate.ts`（Pack.commands 模板渲染） |
| Daemon scheduler | Daemon | 无 | `daemon/src/services/scheduler.ts` |
| Daemon REST 扩展 | Daemon | commandDispatcher | `daemon/src/api/deliverItems.ts`（新增 `POST /api/instances/:id/deliver-items`） |
| daemon.db schema | Daemon | 无 | `daemon/src/db/schema.ts`、`daemon/src/db/connection.ts` |

**P1 验收标准**：
- Knex migration 全部 up 成功，migrations_log 表有 17 条记录。
- userService CRUD + JWT 认证可用。
- vipService 可设置/查询 VIP 等级（含 max_quality/daily_limit 自定义）。
- bindingService 可发起 verify、校验 verify_code。
- itemSyncService 可从 GitHub 同步物品到 shop_items（P2 前置，需先建表）。
- Pack schema 扩展 zod 校验通过（business.* / items.* / commands.silent_insert 段）。
- Daemon eventBus 可订阅 stdout，解析 chat/player:join/player:leave 事件并 emit（按 Pack.game 差异化正则）。
- Daemon commandDispatcher 可渲染 Pack.commands.give_item 模板并 RCON 发送，含预热/重试。
- Daemon `POST /api/instances/:id/deliver-items` 接口可用，返回 {success, failed_items[]}。

### 3.2 P2：商店 + CDK + 物品发放

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|--------------|
| shopService | Panel | shop_items/orders/order_items、vipService、daemonClient | `panel/backend/src/services/shopService.ts`、`panel/backend/src/api/routes/shop.ts`、`panel/backend/src/api/routes/shopAdmin.ts` |
| cdkService | Panel | cdk_codes、daemonClient | `panel/backend/src/services/cdkService.ts`、`panel/backend/src/api/routes/cdk.ts` |
| 订单/CDK 状态机 | Panel | shopService、cdkService | `panel/backend/src/services/orderStateMachine.ts` |
| 过期清理任务 | Panel | scheduler（Panel 端简易定时） | `panel/backend/src/services/cronTasks.ts` |
| 前端 Shop 页面 | Frontend | shopService API | `panel/frontend/src/pages/Shop.tsx`、`panel/frontend/src/pages/Orders.tsx` |
| 前端 ShopAdmin 页面 | Frontend | shopAdmin API | `panel/frontend/src/pages/ShopAdmin.tsx` |
| 前端 CDKAdmin 页面 | Frontend | cdk API | `panel/frontend/src/pages/CdkAdmin.tsx` |
| 前端 VIP 管理页面 | Frontend | vip API | `panel/frontend/src/pages/VipAdmin.tsx` |

**P2 验收标准**：
- 商店下单流程：用户选 server → 选物品 → 创建订单（事务 + VIP 校验 + 每日限额）→ 生成 8 位 claim_code。
- !claim 兑换流程：Daemon 收到 !claim → 调 Panel `POST /api/shop/claim` → Panel 乐观锁 pending→claiming → 调 Daemon deliverItems → 全部成功置 claimed / 部分失败回滚 pending。
- CDK 批量生成 + 兑换流程同上。
- 过期订单定时清理（每小时跑 cleanupExpiredOrders）。
- 前端商店/订单/ShopAdmin/CDKAdmin/VIP 管理页面可用。

### 3.3 P3：聊天增强 P1-P4（欢迎/定时/响应/投票）

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|--------------|
| chatMonitor | Daemon | eventBus、Pack.business.chat_monitor、playerTracker | `daemon/src/services/chatMonitor.ts` |
| playerTracker | Daemon | eventBus | `daemon/src/services/playerTracker.ts` |
| joinHandler | Daemon | eventBus、Pack.business.join_handler、player_history、gift_claims、commandDispatcher | `daemon/src/services/joinHandler.ts` |
| periodicMessageService | Daemon | scheduler、periodic_last_exec、Panel periodic_messages 表拉取 | `daemon/src/services/periodicMessageService.ts` |
| voteService | Daemon | eventBus、Pack.business.vote_kick、votes_active、commandDispatcher | `daemon/src/services/voteService.ts` |
| chat trigger responses 拉取 | Daemon | Panel chat_trigger_responses 表 | `daemon/src/services/chatTriggerSync.ts` |
| Panel WS 上行通道 | Panel/Daemon | 现有 WS | `panel/backend/src/websocket/server.ts`（扩展）、`daemon/src/protocol/uplink.ts` |
| Panel binding verify 处理 | Panel | bindingService、WS | `panel/backend/src/services/verifyHandler.ts` |
| 前端 ChatSettings 页面 | Frontend | system_config + server_pack_overrides API | `panel/frontend/src/pages/ChatSettings.tsx` |
| 前端 PeriodicMessages 页面 | Frontend | periodic_messages API | `panel/frontend/src/pages/PeriodicMessages.tsx` |
| 前端 VoteSettings 页面 | Frontend | server_pack_overrides API | `panel/frontend/src/pages/VoteSettings.tsx` |
| 前端 PlayerJoinSettings 页面 | Frontend | server_pack_overrides API | `panel/frontend/src/pages/PlayerJoinSettings.tsx` |

**P3 验收标准**：
- !verify 流程：玩家发 `!verify <code>` → Daemon 解析 → WS 上行 Panel `chat.verify` → Panel bindingService 校验 → WS 下行 `verify.result` → Daemon 广播结果。
- !help/!status/!players/!uptime 内置命令在 Daemon 本地处理（不查 Panel）。
- 自定义触发响应：Daemon 启动时从 Panel 拉取 chat_trigger_responses，缓存内存，每 30s 增量刷新。
- 玩家加入：Daemon joinHandler 订阅 player:join → 防抖 → 查 Pack.business.join_handler + server_pack_overrides 覆盖 → 查 player_history 判首次/回归 → 查 gift_claims 防重 → RCON 发物品 → 写 gift_claims。
- 定时消息：Daemon scheduler 每 30s 扫描 periodic_messages → 到点 → RCON 发送 → 更新 periodic_last_exec。
- 投票踢人：玩家发触发关键词 → Daemon voteService 创建 vote_active → 玩家发 yes/no → 阈值判定 → RCON kick → 写 audit_logs（WS 上行 Panel）。

### 3.4 P4：Mod/存档/备份/监控/玩家/名单

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|--------------|
| modService | Daemon | 文件系统、mod-list.json | `daemon/src/services/modService.ts`、`daemon/src/api/routes/mods.ts` |
| modDependency | Daemon | modService | `daemon/src/services/modDependency.ts` |
| saveService | Daemon | 文件系统 | `daemon/src/services/saveService.ts`、`daemon/src/api/routes/saves.ts` |
| backupService | Daemon | saveService | `daemon/src/services/backupService.ts`、`daemon/src/api/routes/backups.ts` |
| monitorService | Daemon | /proc/<pid> | `daemon/src/services/monitorService.ts`、`daemon/src/api/routes/monitor.ts` |
| listService | Daemon | server-*.json | `daemon/src/services/listService.ts`、`daemon/src/api/routes/lists.ts` |
| playerListService | Daemon | playerTracker | `daemon/src/api/routes/players.ts` |
| Panel 转发层 | Panel | daemonClient | `panel/backend/src/api/routes/{mods,saves,backups,monitor,lists,players}.ts`（转发） |
| 前端实例详情页 10 tabs | Frontend | 各 API | `panel/frontend/src/pages/ServerDetail/{Mods,Saves,Backups,Monitor,Lists,Players}.tsx` |

**P4 验收标准**：
- Mod 上传/启用/禁用/删除/同步全流程通过 Panel → Daemon 转发。
- 存档上传/下载/删除/重命名/校验。
- 备份创建/列表/恢复/删除（tar.gz 快照）。
- 监控页 CPU/内存/UPS 图表（5s 采集，1h 环形缓冲）。
- 名单 ban/whitelist/admin 三表 CRUD。
- 玩家列表实时刷新 + 踢出/封禁操作。

### 3.5 P5：日志持久化/版本下载/热更新/Webhook/系统设置

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|--------------|
| logService | Daemon | 文件系统 | `daemon/src/services/logService.ts`、`daemon/src/api/routes/logs.ts` |
| downloader | Daemon | axios、tar | `daemon/src/services/downloader.ts`、`daemon/src/api/routes/download.ts`（SSE） |
| updateService | Daemon | downloader、processDriver | `daemon/src/services/updateService.ts`、`daemon/src/api/routes/update.ts` |
| webhookService | Panel | webhook_configs、audit_logs | `panel/backend/src/services/webhookService.ts` |
| systemConfigService | Panel | system_config | `panel/backend/src/services/systemConfigService.ts`、`panel/backend/src/api/routes/settings.ts` |
| Panel 事件分发 | Panel | audit_logs、webhookService | `panel/backend/src/services/eventDispatcher.ts` |
| 前端 Logs 页面 | Frontend | logs API | `panel/frontend/src/pages/ServerDetail/Logs.tsx` |
| 前端 Version 页面 | Frontend | download API | `panel/frontend/src/pages/Versions.tsx` |
| 前端 Settings 页面 | Frontend | settings API | `panel/frontend/src/pages/Settings.tsx` |
| 前端 Webhook 页面 | Frontend | webhook API | `panel/frontend/src/pages/Webhooks.tsx` |

**P5 验收标准**：
- 日志按 server_id 隔离落盘 `instances/{id}/logs/factorio.log`，可分页查询。
- 版本下载 SSE 推送进度，下载完成自动解压。
- 热更新：上传新 Pack → Panel 注册 → 在线 server 平滑切换 Pack（不重启进程的配置变更）。
- Webhook 在 server.start/server.stop/order.claim/cdk.redeem 等事件触发，含 HMAC 签名。
- 系统设置页面可调整注册开关、Webhook、自动同步开关等。

---

## 4. 关键业务流程

### 4.1 商店下单 + 领取流程

```
用户                 Panel                    Daemon                游戏进程
 │                     │                        │                      │
 │ POST /api/shop/orders│                       │                      │
 │ {server_id, items}──▶│                        │                      │
 │                     │ 事务开启                │                      │
 │                     │ 校验 user + VIP         │                      │
 │                     │ 校验 max_quality        │                      │
 │                     │ 校验 daily_limit        │                      │
 │                     │ 生成 claim_code (8位)   │                      │
 │                     │ 插入 shop_orders        │                      │
 │                     │ 插入 shop_order_items   │                      │
 │                     │ 事务提交                │                      │
 │ ◀──{order_id, code}─│                        │                      │
 │                     │                        │                      │
 │ （用户在游戏内发 !claim ABCD1234）            │                      │
 │                     │                        │ ◀──[CHAT] !claim ────│
 │                     │                        │ chatMonitor 解析     │
 │                     │                        │ 提取 code=ABCD1234   │
 │                     │ POST /api/shop/claim   │                      │
 │                     │ {code, player, server} │                      │
 │                     │◀───────────────────────│                      │
 │                     │ 事务 + 乐观锁           │                      │
 │                     │ UPDATE shop_orders      │                      │
 │                     │   SET status='claiming' │                      │
 │                     │   WHERE code=? AND      │                      │
 │                     │     status='pending'    │                      │
 │                     │ 查询 order_items        │                      │
 │                     │ POST /deliver-items     │                      │
 │                     │ {server_id, items[]}    │                      │
 │                     │───────────────────────▶│                      │
 │                     │                        │ commandDispatcher    │
 │                     │                        │ 渲染 Pack.commands   │
 │                     │                        │   .silent_insert     │
 │                     │                        │ RCON 发送 ───────────▶│
 │                     │                        │ ◀──stdout 确认────── │
 │                     │ ◀──{success, failed[]}─│                      │
 │                     │ if 全部成功:            │                      │
 │                     │   UPDATE status=claimed│                      │
 │                     │   claimed_at=now()     │                      │
 │                     │   claimed_player=...   │                      │
 │                     │ else:                   │                      │
 │                     │   UPDATE status=pending│                      │
 │                     │   (允许重试)            │                      │
 │                     │ {success, message}      │                      │
 │                     │───────────────────────▶│                      │
 │                     │                        │ broadcastMessage     │
 │                     │                        │ "兑换成功..." ──────▶│
```

**关键点**：
- Panel 事务边界不含 RCON 调用，避免长事务持锁。
- 乐观锁占用 claiming 后，Panel 调 Daemon 是同步 HTTP 调用（超时 10s）；超时回滚 pending。
- 部分失败回滚 pending 后，玩家可重新 !claim 同一 code（幂等）。
- 重复 !claim 同一 code 在 claiming 状态时返回"正在兑换中"。

### 4.2 CDK 兑换流程

> 与商店领取流程高度相似，区别：
> - CDK 由管理员批量预生成（绑定 server_id 与 rewards 包），无 user_id 创建订单环节。
> - !claim 触发后，Daemon 优先查 Panel `cdk_codes`，找不到再回退 `shop_orders.claim_code`（与 factorio chatMonitor 现有逻辑保持一致）。
> - CDK 兑换状态机：unused→claiming→claimed / unused→disabled（过期/管理员禁用）。

```
玩家发 !claim ABCD1234
  │
  ▼
Daemon.chatMonitor 解析
  │
  ├─ POST /api/cdk/redeem {code, player, server_id}  ──▶ Panel
  │                                                       │
  │                                                       ├─ 查 cdk_codes WHERE code=? AND server_id=?
  │                                                       │  └─ 不存在 → 返回 {success:false, msg:"兑换码无效"}
  │                                                       │
  │                                                       ├─ 乐观锁 UPDATE status='claiming'
  │                                                       │  WHERE code=? AND status='unused'
  │                                                       │
  │                                                       ├─ 解析 rewards JSON
  │                                                       │
  │                                                       ├─ POST /deliver-items ──▶ Daemon
  │                                                       │                              ├─ RCON 发物品
  │                                                       │                              └─ 返回结果
  │                                                       │
  │                                                       ├─ 全部成功 → UPDATE status='claimed', claimed_player, claimed_at
  │                                                       └─ 部分失败 → UPDATE status='unused'（回滚）
  │
  └─ 收到 Panel 结果 → 广播游戏内消息
```

### 4.3 聊天 !verify 流程

> !verify 是少数必须查 Panel DB 的聊天命令（player_bindings 表）。其他 !help/!status/!players/!uptime 在 Daemon 本地处理。

```
玩家发 !verify ABC123
  │
  ▼
Daemon.chatMonitor 解析
  │
  ├─ 提取 code=ABC123
  │
  ├─ WS 上行 Panel {type:'chat.verify', server_id, player, code}
  │
  ▼
Panel.websocket 收到 chat.verify
  │
  ├─ bindingService.verifyCode(player, code)
  │  ├─ 查 player_bindings WHERE verify_code=? AND status='pending'
  │  ├─ 校验 player_name 匹配
  │  ├─ UPDATE status='verified', verified_at=now()
  │  └─ UPDATE users.is_verified=true, users.player_name=player
  │
  ├─ WS 下行 Daemon {type:'verify.result', server_id, player, success, message}
  │
  ▼
Daemon 收到 verify.result
  │
  ├─ commandDispatcher.broadcastMessage
  │   "玩家 X 绑定成功！" 或 "绑定失败：验证码错误"
  │
  └─ RCON 发送
```

**关键点**：
- WS 上行/下行使用现有 WS 通道，新增事件类型 `chat.verify` / `verify.result`（在 `public/schema/ws-events.ts` 扩展）。
- Panel 端 verifyHandler 单独服务，不耦合到 shopService。
- 超时处理：Daemon 发出 chat.verify 后启动 5s 定时器，超时广播"验证超时，请稍后重试"。

### 4.4 玩家加入礼包流程

```
游戏进程 stdout 输出 "[JOIN] player1 joined the game"
  │
  ▼
Daemon.eventBus 解析 → emit player:join {server_id, player}
  │
  ▼
Daemon.joinHandler 订阅
  │
  ├─ 防抖：debounce 2s（按 server_id + player 去重）
  │
  ├─ 加载配置：Pack.business.join_handler + server_pack_overrides
  │
  ├─ 查 player_history（Daemon 本地）
  │  ├─ 不存在 → first_join=true
  │  └─ 存在 → 检查 last_logout_at 判回归
  │
  ├─ 更新 player_history.last_login_at
  │
  ├─ 广播欢迎语（renderTemplate + server_name + online_count）
  │
  ├─ if first_join AND first_gift.enabled:
  │    ├─ 查 gift_claims WHERE player=? AND type='first'  → 已存在则跳过
  │    ├─ RCON 发物品（间隔 300ms）
  │    └─ 写 gift_claims
  │
  └─ if relogin AND relogin_gift.enabled:
       ├─ 检查 daily_limit / total_limit
       ├─ 查 gift_claims 防重
       ├─ RCON 发物品
       └─ 写 gift_claims
```

**关键点**：
- 礼包配置从 Pack.business.join_handler 读取（Daemon 启动实例时拉取 Pack 全量并缓存）。
- 玩家登录历史/礼包领取记录在 Daemon 本地 SQLite（不查 Panel）。
- VIP 联动（factorio 现有 joinHandler 有 vip:join_msg 特殊欢迎语）：Daemon 可选通过 WS 查 Panel 缓存 VIP 等级（P3 阶段实现，缓存 5min）。

---

## 5. 数据迁移方案

### 5.1 迁移源与目标

| 源 | 目标 | 迁移工具 |
|----|------|----------|
| `factorio/backend/manager.db`（17 表） | `gameserver-panel/panel/backend/data/panel.db`（18 表） | Node.js 一次性脚本 |
| `factorio/backend/manager.db` instances 表 | 不迁移（gameserver-panel 已有 servers 表，需手动对齐） | 人工映射 |
| `factorio/backend/manager.db` chat_settings/player_join_settings/vote_settings | 不迁移（配置下沉到 Pack YAML business 段） | 人工整理到 Pack YAML |
| `factorio/backend/manager.db` votes/vote_records | 不迁移（活跃投票瞬态，迁移时已结束） | 丢弃 |

### 5.2 字段映射

#### users 表映射

| factorio 字段 | panel 字段 | 转换 |
|--------------|-----------|------|
| id (integer) | id (string) | `'u_' + id` |
| username | username | 直接 |
| password_hash | password_hash | 直接 |
| role | role | system_admin/admin/operator/viewer 直接；factorio 的 admin/system_admin 都映射为 system_admin（按 migrateFirstAdminToSystemAdmin 逻辑） |
| status | status | 直接 |
| display_name | （丢弃） | panel.users 无此字段 |
| email | email | 直接（panel.users.email 必填，factorio 可为 null，迁移时 null → `{username}@migrated.local`） |
| last_login_at | last_login_at | 直接 |
| last_login_ip | last_login_ip | 直接 |
| vip_level | vip_level | 直接 |
| vip_expires_at | vip_expires_at | 直接 |
| is_verified | is_verified | 直接 |
| factorio_player_name | player_name | 字段名泛化 |
| created_at | created_at | 直接 |
| updated_at | （丢弃） | panel.users 无此字段 |

#### shop_items / shop_orders / shop_order_items / cdk_codes 表映射

| factorio 字段 | panel 字段 | 转换 |
|--------------|-----------|------|
| instance_id | server_id | 需 instances → servers 映射表（见 5.3） |
| 其余字段 | 同名 | 直接 |

> factorio `shop_orders.claim_code` 是 8 位提取码，与 `cdk_codes.code` 共享同一字符集，迁移时无需转换。

#### player_bindings 表映射

| factorio 字段 | panel 字段 | 转换 |
|--------------|-----------|------|
| id | id | 直接（panel 用 integer 自增） |
| user_id (integer) | user_id (string) | `'u_' + user_id` |
| factorio_player_name | player_name | 字段名泛化 |
| verify_code | verify_code | 直接 |
| status | status | 直接 |
| verified_at | verified_at | 直接 |

#### vip_permissions 表映射

字段名完全一致，直接迁移。需种子 VIP 0 配置（panel 默认 max_quality='none', daily_limit=0）。

#### item_sync_log 表映射

| factorio 字段 | panel 字段 | 转换 |
|--------------|-----------|------|
| source | pack_id | factorio 用 GitHub URL，panel 改为 pack_id 关联；迁移时统一设为 `'minecraft-vanilla'` 或对应 Pack ID |
| 其余字段 | 同名 | 直接 |

#### system_config 表映射

字段名一致，直接迁移 key/value。需筛选 factorio system_config 中与 Webhook/item_sync 相关的 key，剔除过时项。

### 5.3 instances → servers 映射

> factorio 的 instances 表与 panel 的 servers 表概念重合，但 ID 体系不同。
> 迁移前需人工建立映射表（CSV 或 JSON），脚本读取后批量转换 instance_id → server_id。

```
# instance_server_map.csv
factorio_instance_id,panel_server_id
default,srv-0001
inst-abc123,srv-0002
```

**默认策略**：
- factorio `default` 实例 → 在 panel.servers 中查找 owner_user_id=system_admin 且 pack_id 匹配的第一条 server，复用其 id。
- factorio 自定义实例 → 在 panel.servers 中按 port 匹配，找不到则提示人工创建后重跑迁移。

### 5.4 迁移脚本设计

```
panel/backend/scripts/migrate-from-factorio.ts
├── 1. 打开源 DB（factorio manager.db，只读）
├── 2. 打开目标 DB（panel panel.db，读写）
├── 3. 加载 instance_server_map.csv
├── 4. 对每张表按依赖顺序迁移：
│    4.1 users（去重 email 冲突）
│    4.2 vip_permissions
│    4.3 player_bindings（user_id 已映射）
│    4.4 shop_items（instance_id → server_id）
│    4.5 shop_orders（instance_id → server_id）
│    4.6 shop_order_items（按 order_id 关联）
│    4.7 cdk_codes（instance_id → server_id）
│    4.8 item_sync_log（source → pack_id）
│    4.9 system_config（筛选 key）
│    4.10 chat_trigger_responses（instance_id → server_id）
│    4.11 periodic_messages（instance_id → server_id）
├── 5. 输出迁移报告（每表成功/失败/跳过数）
├── 6. 失败记录写入 panel.db.migrations_log
└── 7. 支持 --dry-run 预演
```

**幂等设计**：
- 每张表迁移前检查目标是否已有数据（COUNT > 0），有则提示是否覆盖（默认跳过）。
- 失败时回滚单表（按表分事务，不整体回滚）。

### 5.5 迁移丢弃项

| 丢弃项 | 原因 |
|--------|------|
| instances 表 | panel.servers 已替代 |
| chat_settings / player_join_settings / vote_settings 表 | 配置下沉到 Pack YAML business 段 |
| votes / vote_records 表 | 活跃投票瞬态，迁移时已结束 |
| users.display_name | panel.users 无此字段（可写入 username 备用） |
| users.updated_at | panel.users 无此字段 |
| factorio 的 instances 表 shop_enabled/mod_enabled/is_default | 用 server_pack_overrides + servers.shop_enabled 替代 |
| factorio 的 mod-list.json / server-*.json | 不迁移（Daemon 端文件系统重新组织） |

---

## 6. 风险与回退

### 6.1 关键风险点

| 风险 ID | 风险描述 | 影响 | 概率 | 缓解措施 |
|---------|---------|------|------|----------|
| R1 | Pack schema 复杂度上升（business 段含 4 子段、items 段、commands 模板扩展），Pack YAML 维护成本增加 | 中 | 高 | 提供 Pack 模板生成器；minecraft-vanilla Pack 仅扩展 commands，business 段 optional |
| R2 | Daemon 本地 SQLite 引入（4 张表），多 Daemon 部署时数据分散 | 中 | 中 | 业务可容忍（玩家登录历史/礼包记录丢失仅影响首次礼包重发）；后续可加 Panel↔Daemon 状态同步机制 |
| R3 | Panel↔Daemon 业务通信契约复杂化（新增 deliver-items / chat.verify / verify.result / periodic sync 等多个端点） | 高 | 高 | 严格走 s0201 三层契约流程，public/interface_stub + schema + config_template 同步生成；契约测试覆盖 |
| R4 | claimOrder/redeem 拆成两段后，事务一致性弱化（Panel 事务 + Daemon HTTP 调用，无法跨进程事务） | 高 | 中 | 乐观锁 + 状态机：claiming 占用 → Daemon 调用 → 全部成功 claimed / 失败回滚 pending；超时（10s）自动回滚；玩家可幂等重试 |
| R5 | factorio 17 张表迁移到 panel 18 张表，instance_id → server_id 映射失败导致数据孤立 | 高 | 中 | 迁移脚本 --dry-run 预演 + 失败行单独导出 + 人工映射表 CSV |
| R6 | Daemon 业务能力下沉后，Daemon 单点故障影响面扩大（chatMonitor/joinHandler/voteService 全挂） | 高 | 低 | Daemon 健康检查 + 自动重启；Panel 端记录最后一次 deliver-items 失败的 order/cdk，可手动重发 |
| R7 | VIP 等级查询走 WS 上行 + 缓存，缓存过期窗口内 VIP 升级不及时生效 | 低 | 中 | 缓存 TTL 5min；VIP 升级时 Panel 主动 WS 推送 invalidate 事件 |
| R8 | chat trigger responses 在 Daemon 缓存 30s 才刷新，管理员修改后延迟生效 | 低 | 高 | 接受 30s 延迟；提供"立即刷新"按钮（Panel WS 推送 `chat.invalidate` 事件） |
| R9 | Knex migrations 目录首次引入，与现有 schema.ts 幂等创建逻辑冲突 | 中 | 中 | 保留 schema.ts 作为 fallback；migrations 优先执行；schema.ts 仅在 migrations 全部失败时兜底 |
| R10 | factorio 现有 vitest 测试不迁移（游戏面板重写），测试覆盖率短期下降 | 中 | 高 | 按 s0402 前端三重闸门 + s0602 技术债扫描，每个 P 阶段补测试 |

### 6.2 回退方案

> [V] 价值判断节点：C-1 方案失败时是否回退到纯双层架构（C-2 Panel 全集中）？
> 倾向：分阶段回退，不整体回退。

**回退触发条件**：
- P1 验收失败：Daemon eventBus/commandDispatcher 无法稳定运行 → 回退到纯 Panel 集中（无业务下沉）。
- P2 验收失败：claimOrder 两段事务一致性无法保证 → 回退到 Panel 端单事务（Daemon 仅做无状态 RCON 转发，Panel 端事务内同步 HTTP 调 Daemon，超时即整单失败）。
- P3 验收失败：Daemon 业务能力下沉导致 Daemon 资源占用过高 → 把 chatMonitor/voteService 回退到 Panel 端（WS 转发 stdout 到 Panel，Panel 解析处理）。

**回退操作**：
1. 保留 git 分支 `release/c1-p1`、`release/c1-p2`、`release/c1-p3`，每个 P 验收通过后打 tag。
2. 回退时 revert 到上一个 tag，Panel.db 不回退（migrations 仅 up，down 仅用于开发环境）。
3. 已迁移数据保留，回退代码兼容旧数据（如 shop_orders.claiming 状态在回退后由 Panel 端定时器清理为 expired）。

**回退到 C-2（Panel 全集中）的硬阻断点**：
- 若 C-1 在 P1 阶段即无法让 Daemon eventBus 稳定运行（连续 3 次崩溃），直接放弃 C-1，回退到 C-2 候选方案重新设计。
- 此决策必须经人类裁决（L3 AskUserQuestion）。

---

## 7. 验证计划

### 7.1 每阶段验证标准

| 阶段 | 验证维度 | 验证方法 | 通过标准 |
|------|---------|---------|----------|
| P1 | migration 幂等性 | 连续执行 up 两次 | 第二次无错误，migrations_log 无新增 |
| P1 | migration 回滚 | 执行 down 后再 up | 数据结构一致 |
| P1 | Pack schema 校验 | 加载 minecraft-vanilla + 测试 Pack（含 business 段） | zod 校验通过 |
| P1 | Daemon eventBus | mock stdout 行（[CHAT]/[JOIN]/[LEAVE]） | 事件正确 emit，订阅者收到 |
| P1 | Daemon commandDispatcher | mock RCON 协议 | 命令渲染正确，预热+重试逻辑通过 |
| P1 | deliver-items 接口 | curl POST + mock RCON | 返回 {success, failed_items} |
| P2 | 商店下单 E2E | 前端选物品 → 下单 → 数据库有订单 | 订单状态 pending，claim_code 8 位 |
| P2 | !claim 兑换 E2E | mock 游戏进程发 [CHAT] !claim | 订单状态 pending→claiming→claimed，物品发放命令正确 |
| P2 | 部分失败回滚 | mock RCON 部分失败 | 订单回滚 pending，可重试 |
| P2 | CDK 兑换 E2E | 批量生成 → !claim 兑换 | 状态 unused→claiming→claimed |
| P3 | !verify E2E | mock 玩家发 !verify | Panel bindingService 收到，WS 下行结果 |
| P3 | 玩家加入礼包 E2E | mock [JOIN] 行 | 欢迎语广播 + 物品发放 + gift_claims 记录 |
| P3 | 投票踢人 E2E | mock 多个玩家发投票 | 阈值达成时 RCON kick 命令正确 |
| P3 | 定时消息 E2E | 创建 1min 任务 → 等待 | 到点 RCON 发送，last_executed 更新 |
| P4 | Mod/存档/备份 E2E | 各上传/下载/创建 | 文件落盘正确，列表可查询 |
| P4 | 监控数据 | 启动 server → 5s 后查询 | CPU/内存/UPS 数据返回 |
| P5 | 日志持久化 | 启动 server → 输出 100 行 → 查询 | 文件存在，可分页 |
| P5 | Webhook 触发 | 配置 webhook → 触发 order.claim | 外部收到 POST，HMAC 签名正确 |
| P5 | 热更新 | 上传新 Pack → 切换 | 在线 server 配置变更，进程不重启 |

### 7.2 端到端测试用例

> 测试入口：`tests/e2e/`（已有目录），新增 `tests/e2e/c1-migration/`。

#### TC-01 用户注册 → 绑定 → VIP 升级 → 商店下单 → !claim 兑换

```
1. POST /api/auth/register {username, password, email}
2. POST /api/bindings/initiate {player_name} → 返回 verify_code
3. 模拟游戏内 [CHAT] !verify <code> → Daemon 转发 → Panel 校验 → WS 下行 → Daemon 广播"绑定成功"
4. 管理员 POST /api/vip/users/:id {level:2, expires_at:null}
5. POST /api/shop/orders {server_id, items:[{item_id:1, quantity:1, quality:'uncommon'}]}
6. 模拟游戏内 [CHAT] !claim <claim_code>
7. 验证：shop_orders.status=claimed，shop_orders.claimed_player=player_name
8. 验证：Daemon RCON 收到 silent_insert 命令（mock 验证）
```

#### TC-02 CDK 批量生成 → 多玩家兑换

```
1. 管理员 POST /api/cdk/batch {count:10, server_id, rewards:[{item_name:'iron-plate', quantity:100, quality:'normal'}]}
2. 返回 10 个 code
3. 模拟玩家 A 发 !claim <code1> → 成功
4. 模拟玩家 B 发 !claim <code1> → 失败"已被使用"
5. 模拟玩家 C 发 !claim <code2> → 成功
6. 验证：cdk_codes 表 10 条记录，2 条 claimed，8 条 unused
```

#### TC-03 玩家加入 → 首次礼包 → 回归礼包

```
1. 配置 Pack.business.join_handler.first_gift.enabled=true, items=[{name:'iron-plate', count:50}]
2. 配置 relogin_gift.enabled=true, cooldown_hours=1, items=[{name:'copper-plate', count:20}]
3. 模拟 [JOIN] player1 → 首次礼包发放 + gift_claims 记录 type='first'
4. 模拟 [LEAVE] player1 → player_history.last_logout_at 更新
5. 等待 1h+ → 模拟 [JOIN] player1 → 回归礼包发放 + gift_claims 记录 type='relogin'
6. 立即再模拟 [JOIN] player1 → 不发礼包（daily_limit=1 已达）
```

#### TC-04 投票踢人

```
1. 配置 Pack.business.vote_kick.enabled=true, min_votes=3, vote_threshold=2
2. 模拟玩家 A 发 "投票踢人 playerX"
3. 模拟玩家 B 发 "yes"
4. 模拟玩家 C 发 "yes"
5. 验证：vote_threshold 未达成（2 < 3 min_votes），playerX 未被 kick
6. 模拟玩家 D 发 "yes"
7. 验证：min_votes=3 达成 + yes_count=3 ≥ min_votes → RCON kick 命令发出
8. 验证：votes_active.status=passed，audit_logs 有记录
```

#### TC-05 数据迁移端到端

```
1. 准备 factorio manager.db（含 17 表测试数据，10 用户、5 实例、100 商品、50 订单、20 CDK）
2. 准备 instance_server_map.csv（5 行映射）
3. 运行 node scripts/migrate-from-factorio.ts --dry-run
4. 验证：报告显示每表待迁移数
5. 运行 node scripts/migrate-from-factorio.ts
6. 验证：panel.db 各表数据数与源一致（除丢弃项）
7. 验证：用户可登录（password_hash 兼容），订单可查询，CDK 可兑换
```

### 7.3 性能验证

| 指标 | 目标 | 测试方法 |
|------|------|----------|
| Panel API P95 响应 | < 200ms（不含 RCON） | wrk 压测 |
| Daemon deliver-items 耗时 | < 500ms（单物品）/ < 2s（10 物品） | mock RCON 计时 |
| WS 事件延迟（chat→verify.result） | < 1s | 时间戳打点 |
| migration 脚本执行 | < 60s（10k 行数据） | 计时 |
| Daemon 内存占用（含 eventBus + chatMonitor） | < 200MB | 启动后 1h 监控 |

### 7.4 文档与契约验证

- [ ] Pack schema 扩展后，`public/schema/pack-schema.ts` zod 校验单测通过
- [ ] `public/interface_stub/daemon-rest.ts` 新增 deliver-items 签名
- [ ] `public/schema/ws-events.ts` 新增 chat.verify / verify.result / chat.invalidate 事件类型
- [ ] `public/schema/daemon-api-types.ts` 新增 DeliverItemsRequest/Response
- [ ] `public/schema/panel-api-types.ts` 新增 shop/cdk/vip/bindings 类型
- [ ] 每个 P 阶段交付前过 s0402 前端三重闸门（单测→E2E→Mock 回归）
- [ ] 每个 P 阶段交付前过 GN-004 独立审查

---

## 8. 附录

### 8.1 与 factorio 现有代码的复用关系

| factorio 文件 | 复用方式 | 目标位置 |
|--------------|---------|----------|
| `services/eventBus.ts` | 改造（去掉 factorioProcess 依赖，改订阅 Daemon processDriver） | `daemon/src/services/eventBus.ts` |
| `services/commandDispatcher.ts` | 改造（去掉 achievement 预热对 factorio 特化，改为 Pack.commands 模板渲染） | `daemon/src/services/commandDispatcher.ts` |
| `services/shopService.ts` | 拆分：订单 CRUD + 乐观锁留 Panel，RCON 调用拆给 Daemon | `panel/backend/src/services/shopService.ts` |
| `services/cdkService.ts` | 同上 | `panel/backend/src/services/cdkService.ts` |
| `services/vipService.ts` | 几乎原样迁移到 Panel | `panel/backend/src/services/vipService.ts` |
| `services/itemSyncService.ts` | 改造（写入 shop_items 时按 Pack 校验 + 关联 pack_id） | `panel/backend/src/services/itemSyncService.ts` |
| `services/joinHandler.ts` | 改造（订阅 Daemon eventBus + 配置从 Pack 读取 + 本地 SQLite 状态） | `daemon/src/services/joinHandler.ts` |
| `services/chatMonitor.ts` | 改造（!verify/!claim 路由到 Panel，其余本地处理） | `daemon/src/services/chatMonitor.ts` |
| `services/voteService.ts` | 几乎原样迁移到 Daemon | `daemon/src/services/voteService.ts` |
| `services/periodicMessageService.ts` | 改造（任务从 Panel 拉取，本地维护 last_executed） | `daemon/src/services/periodicMessageService.ts` |
| `services/bindingService.ts` | 几乎原样迁移到 Panel | `panel/backend/src/services/bindingService.ts` |
| `services/systemConfigService.ts` | 几乎原样迁移到 Panel | `panel/backend/src/services/systemConfigService.ts` |
| `services/instanceStateStore.ts` | 拆分：player_history/gift_claims 下沉 Daemon 本地 SQLite | `daemon/src/db/instanceStateStore.ts` |
| `db/schema.ts` | 拆分：Panel 18 表 + Daemon 4 表 | 两侧各自 `db/schema.ts` |

### 8.2 未决问题（待人类裁决）

> [V] 以下问题需在方案评审时由人类逐项裁决，未裁决前不得进入 s0201 契约生成。

1. **Pack schema 是否承担 business 配置**：本方案倾向于"是"，但这会让 Pack YAML 复杂度上升 30%+。备选：business 配置完全存 Panel.system_config + server_pack_overrides，Daemon 启动时拉取。
2. **Daemon 本地 SQLite 是否引入**：本方案倾向于"是"（4 张表，per-server 状态）。备选：所有状态走 WS 上行 Panel（性能差但无数据分散）。
3. **claimOrder 两段事务的回滚策略**：本方案采用"部分失败回滚 pending，玩家重试"。备选：部分失败也置 claimed（已发物品不收回），记录失败明细让管理员处理。
4. **factorio 默认实例迁移目标**：本方案默认映射到 panel.servers 中第一条匹配 Pack 的 server。备选：强制要求人工创建对应 server 后再迁移。
5. **Daemon 业务能力下沉后多 Daemon 部署**：本方案假定单 Daemon（与 P0 一致）。若未来多 Daemon，Daemon 本地状态如何同步（选项：Panel 集中 + Daemon 缓存 / Daemon 间 Gossip / 接受数据分散）。

### 8.3 与 AC 范式 Skill 的对接

| 阶段 | Skill | 触发时机 |
|------|-------|----------|
| 方案融合 | s0103-merging-schemes | C-1/C-2/C-3 三方案对比后 |
| 契约生成 | s0201-generating-global-contracts | 方案定稿后，生成 Pack schema 扩展 + ws-events 扩展 + daemon-api 扩展 |
| Mock 生成 | s0202-generating-stable-mocks | 契约冻结后，生成 Daemon/Panel Mock 实现 |
| 模块拆分 | s0203-topology-based-module-splitting | 按 P1-P5 优先级拆分依赖 DAG |
| 规则生成 | s0301-generating-agent-rules | 模块拆分后，生成各模块 AGENTS.md |
| 安全写入 | s0401-safe-file-writing | 写 public/ 与 .trae/rules/ 时触发 |
| 前端三重闸门 | s0402-frontend-triple-gate | 每个前端页面变更 |
| 契约变更适配 | s0601-adapting-contract-changes | Pack schema 后续变更 |
| 技术债扫描 | s0602-scanning-technical-debt | 每个 P 阶段收束前 |

---

**文档结束**
