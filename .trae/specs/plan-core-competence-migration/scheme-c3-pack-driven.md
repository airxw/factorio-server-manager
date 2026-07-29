# C-3 Pack 业务能力描述方案 — 核心竞争力迁移设计

> 🚨 【最高优先级规则】本文件为方案设计文档，优先级高于临时对话内容，所有后续实现必须 100% 符合本方案。
>
> 📌 【上下文保留规则】本文件为工程交接锚点，任何上下文压缩、裁剪场景下必须完整保留全部内容。

## 三段交接状态

- **工程过程**：本方案为 C-3 单一方向定稿文档，已完成架构总览、DB schema、模块拆分、关键流程、数据迁移、风险回退、验证计划七部分设计。依据 gameserver-panel 现有 `public/schema/pack-schema.ts`、`panel/backend/src/db/schema.ts` 与 factorio `backend/src/db/schema.ts`、`shopService.ts`、`cdkService.ts` 真实代码反推。
- **交接状态**：方案设计已完成（待主线程 GN-004 审查 + 人类裁决后进入 S2 契约冻结）。后续接续入口：基于本方案生成 spec 三件套与三层契约。
- **最终结果**：产出本方案文档一份；尚未产出代码、契约 schema 或测试套件。验证结论待 GN-004 审查。

---

## 设计倾向定位

| 维度 | 选择 | 说明 |
|------|------|------|
| 架构形态 | 混合架构 | Panel 承载业务逻辑，Daemon 承载进程/解析/执行 |
| 迁移策略 | 参考重写 | 业务模块按 Pack 通用化重设计，非逐行搬运 |
| 价值取向 | 用户价值优先 | P1 先做用户能感知的 VIP/商店，基础设施随业务滚动落地 |
| Pack 角色 | 业务能力描述层 | Pack 不再仅是"启动描述"，而是业务能力的唯一真相源 |

## 核心设计原则

1. **业务能力由 Pack 声明**：shop / cdk / chat_enhancement / players / lists 等业务能力全部在 Pack.business 中声明，Panel 按 Pack 加载对应业务模块。
2. **命令模板由 Pack 渲染**：Panel 按 Pack.business.shop.give_command 模板渲染完整命令字符串，下发到 Daemon；Daemon 不做业务判断，仅执行。
3. **事件解析由 Pack 驱动**：Daemon 按 Pack.event_parsers 解析游戏 stdout，生成结构化事件上报 Panel；Panel 按业务规则消费事件。
4. **物品池由 Pack 提供**：Pack.items 声明该游戏支持的物品全集（含品质、分类），替代 factorio 中硬编码的 item_sync。shop_items 表仅做"实例级商品上架配置"，引用 Pack 物品池。
5. **多游戏零改业务代码**：新增游戏只需写 Pack，业务模块（shopService / cdkService / chatMonitor）通过 Pack 配置自动适配，不写游戏专属分支。

---

## 1. 架构总览

### 1.1 Panel / Daemon 职责矩阵

| 职责域 | Panel（业务大脑） | Daemon（执行手足） |
|--------|------------------|------------------|
| 用户与权限 | 用户注册/登录/JWT、VIP 等级、4 级角色体系、玩家绑定 | 无 |
| Pack 管理 | Pack 加载/校验/注册、按 Pack.business 加载业务模块 | 接收 Panel 下发的 Pack 配置片段（event_parsers / protocol） |
| 商店 | 商品上架配置、订单创建、VIP 品质校验、每日限额、乐观锁领取 | 接收已渲染好的 give 命令，调用 RCON/stdin 发送 |
| CDK | 兑换码批量生成、兑换事务、乐观锁 | 同上，仅执行命令 |
| 聊天增强 P1-P4 | 触发规则匹配、投票踢人状态机、欢迎礼包决策、定时消息调度 | 按 event_parsers.chat 解析 stdout，上报 chat 事件 |
| 玩家管理 | 玩家列表查询、kick/ban 决策 | 上报 join/leave 事件，执行 kick/ban 命令 |
| 名单 | 白名单/黑名单决策 | 执行 whitelist add / ban 命令 |
| Mod/存档/备份 | 元数据记录、任务编排 | 文件系统操作、压缩/解压、调用 Pack.backup.pre_backup_commands |
| 监控 | 历史快照存储、阈值告警 | 采集 CPU/内存/Tick/玩家数，定时上报 |
| 日志 | 持久化存储、检索 | stdout 流式转发（可选本地落盘） |
| 版本下载/热更新 | 下载任务管理、版本清单 | 下载文件、校验、替换二进制 |
| Webhook | 触发规则配置、事件分发 | 无 |

### 1.2 Pack Schema 完整扩展设计

在现有 `public/schema/pack-schema.ts`（zod）基础上新增三个顶层字段：`items`、`event_parsers`、`business`。已有字段（pack / startup / protocol / config / commands / versions / backup / ui / resources）保持不变。

#### 1.2.1 新增 `items` 字段（物品池）

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

- `source.type=github_sync`：Panel 按 `sync_interval_hours` 定时拉取 JSON，写入 `item_sync_log` 表并缓存到 Panel 内存/本地文件。
- `source.type=static`：物品清单直接内联在 Pack YAML，适用于 Minecraft 这类物品数稳定且不大的游戏。
- `qualities` 与 `quality_tiers`：factorio 为 5 级，minecraft 为 0 级（无品质概念，`qualities: []`、`quality_tiers: 0`）。shopService 据此决定是否走品质校验分支。

#### 1.2.2 新增 `event_parsers` 字段（事件解析规则，Daemon 用）

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

- Daemon 按这些正则解析游戏 stdout，匹配成功后生成结构化事件 `{type: 'chat'|'join'|'leave', ...}` 通过 WS 上报 Panel。
- `player_group` 指定从正则哪个捕获组提取玩家名。
- 不同游戏的日志格式差异完全由 Pack 吸收，Daemon 解析器代码通用。

#### 1.2.3 新增 `business` 字段（业务能力声明，Panel 用）

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

#### 1.2.4 Schema 扩展对现有字段的影响

- `commands` 字段保留，用于通用命令模板（broadcast / list_players / save_world 等），与 `business` 下的业务命令模板分工：
  - `commands`：通用运维命令（无业务语义）。
  - `business`：业务能力命令（带业务上下文渲染）。
- `ui.tabs` 枚举需扩展：新增 `shop`、`cdk`、`chat`、`vote`、`players`、`lists`、`mods`、`saves`、`backups`、`monitor`、`logs`、`settings`、`webhooks`。

### 1.3 数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                          Panel (业务大脑)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐     │
│  │shopService│  │cdkService│  │chatMonitor│  │voteService   │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘     │
│       │              │             │               │             │
│  ┌────▼──────────────▼─────────────▼───────────────▼──────────┐  │
│  │       Pack 业务能力加载器（按 Pack.business 实例化）         │  │
│  │  渲染命令模板 → 完整命令字符串                              │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ REST + WS 下行                       │
└───────────────────────────┼─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Daemon (执行手足)                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │命令执行器     │  │事件解析器         │  │进程管理器         │   │
│  │(RCON/stdin)  │  │(按 event_parsers)│  │(startup/stop)    │   │
│  └──────┬───────┘  └──────────┬───────┘  └──────────────────┘   │
│         │                     │ WS 上行事件                     │
└─────────┼─────────────────────┼─────────────────────────────────┘
          ▼                     ▼
   ┌─────────────┐       ┌─────────────┐
   │  游戏进程    │       │  Panel 消费  │
   │ (Factorio/  │       │  事件→业务   │
   │  Minecraft) │       │  决策→下行   │
   └─────────────┘       └─────────────┘
```

**下行流（Panel → Daemon）**：
1. Panel 业务模块根据用户操作/事件触发，读取 Pack.business.* 模板。
2. 用上下文变量（player / item / count / quality / message / reason）渲染模板，做严格注入校验。
3. 通过 REST（同步命令）或 WS（异步命令）下发完整命令字符串到 Daemon。
4. Daemon 调用 protocol（RCON/stdin）发送给游戏进程。

**上行流（Daemon → Panel）**：
1. 游戏进程 stdout 流入 Daemon。
2. Daemon 按 Pack.event_parsers.* 逐行匹配，命中则生成结构化事件。
3. 通过 WS 上报 Panel：`{type:'chat', instance_id, player, message, timestamp}`。
4. Panel chatMonitor / joinHandler / voteService 消费事件，可能触发新的下行命令（如欢迎礼包发放）。

### 1.4 多游戏适配说明

| 游戏 | items.source | qualities | business.shop | business.chat_enhancement | event_parsers |
|------|--------------|-----------|---------------|---------------------------|---------------|
| Factorio | github_sync (airxw/factorioitem) | 5 级 | enabled, Lua silent-command | welcome/periodic/response/vote_kick 全开 | chat/join/leave 正则 |
| Minecraft | static (内联 ~200 物品) | 0 级 | enabled, give 命令 | 仅 welcome + periodic（无 vote_kick） | chat/join/leave 正则（Minecraft 日志格式） |
| Rust | github_sync | 可扩展 | enabled | 部分 | 待定 |
| 新增游戏 | 写 Pack 即可 | Pack 声明 | Pack 声明 | Pack 声明 | Pack 声明 |

**关键约束**：Panel 业务模块代码中不得出现任何 `if (game === 'factorio')` 分支。所有游戏差异 100% 由 Pack 吸收。代码评审时发现游戏专属硬编码即视为违约。

---

## 2. 数据库 Schema 设计

### 2.1 总览：表清单与归类

Panel 侧统一使用 `panel/backend/data/panel.db`（SQLite），Daemon 保持无状态（进程状态在内存）。所有业务表归属 Panel。

| 分组 | 表名 | 来源 | 说明 |
|------|------|------|------|
| 平台基础（已有） | users / nodes / servers / packs | gameserver-panel P0 | 保留，users 需扩展 |
| 用户与 VIP | vip_permissions / player_bindings | factorio 迁移 | VIP 等级配置、游戏玩家绑定 |
| 商店 | shop_items / shop_orders / shop_order_items / item_sync_log | factorio 迁移 | shop_items 瘦身（引用 Pack 物品池） |
| CDK | cdk_codes | factorio 迁移 | 直接迁移 |
| 聊天增强 | chat_settings / chat_trigger_responses / player_join_settings / periodic_messages / vote_settings / votes / vote_records | factorio 迁移 | instance_id → server_id |
| 系统 | system_config | factorio 迁移 | KV 配置 |
| P4 业务 | mods / saves / backups / monitor_snapshots / players / list_entries | 新设计 | factorio 用文件系统，Panel 用 DB 跟踪 |
| P5 业务 | logs / webhooks / version_downloads / hot_updates | 新设计 | 日志持久化、Webhook、版本管理 |

### 2.2 shop_items 表的去留决策

**决策：保留 shop_items 表，但语义从"物品定义"瘦身为"实例级上架配置"。**

| 字段 | factorio 原表 | C-3 方案 | 说明 |
|------|--------------|----------|------|
| item_name | 自包含 | 必须存在于 Pack.items | 物品定义移到 Pack |
| display_name | 自包含 | **删除** | 从 Pack.items 取 |
| category | 自包含 | **删除** | 从 Pack.items 取 |
| quality | 自包含 | 保留 | 实例可限制商品品质上限 |
| vip_level_required | 保留 | 保留（废弃，品质级 VIP 校验取代） | 兼容历史 |
| daily_limit | 保留 | 保留 | 实例级商品每日限购 |
| enabled | 保留 | 保留 | 上架开关 |
| server_id | — | 新增（替代 instance_id） | 命名对齐 gameserver-panel |

**理由**：
- Pack.items 是"游戏有哪些物品"（全局真相），shop_items 是"本服务器卖哪些物品"（实例配置）。
- 删除 display_name / category 避免与 Pack.items 重复维护。
- 保留 quality / daily_limit / enabled 因为这些是运营级配置，不应硬编码在 Pack。

### 2.3 关键表字段设计

> 仅列出与 factorio 原表有差异或新设计的表；完全照搬 factorio 的表（如 shop_orders / cdk_codes / votes 等）仅做 `instance_id → server_id` 命名替换，字段不变。

#### 2.3.1 users（扩展）

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

**注意**：gameserver-panel 用 string id（UUID），factorio 用 integer id。迁移时需为 factorio 用户分配 UUID，并把所有 `user_id` 外键引用改为 string 类型。详见 §5 数据迁移。

#### 2.3.2 vip_permissions

```
vip_level       INTEGER PRIMARY KEY        (0-5)
display_name    STRING NOT NULL
permissions     TEXT NOT NULL              (JSON array)
max_quality     STRING NULLABLE            (none/normal/uncommon/rare/epic/legendary)
daily_limit     INTEGER NULLABLE           (每日购买总限额)
created_at / updated_at
```

完全照搬 factorio。`max_quality` 与 Pack.items.qualities 联动校验（若 Pack 无 quality 概念，max_quality 强制为 none/normal）。

#### 2.3.3 player_bindings（泛化）

```
id              INTEGER PRIMARY KEY
user_id         STRING NOT NULL REFERENCES users(id)   (改为 string)
game_player_name STRING NOT NULL
verify_code     STRING(6) NOT NULL
status          STRING NOT NULL DEFAULT 'pending'      (pending/verified/rejected)
verified_at     TIMESTAMP NULLABLE
created_at / updated_at
UNIQUE(user_id)
UNIQUE(game_player_name, status)
```

factorio 原表字段名 `factorio_player_name`，C-3 泛化为 `game_player_name`（适用于所有游戏）。

#### 2.3.4 shop_items（瘦身）

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

校验约束：插入/更新时 Panel 校验 `item_name ∈ Pack.items`（运行时校验，非 DB 外键，因 Pack.items 是外部同步数据）。

#### 2.3.5 servers（已有，扩展业务开关）

gameserver-panel 现有 servers 表保留，新增字段：
```
shop_enabled    BOOLEAN DEFAULT true
chat_enabled    BOOLEAN DEFAULT true
mods_enabled    BOOLEAN DEFAULT true
```
（替代 factorio instances 表的 shop_enabled / mod_enabled 字段。1 个 server = 1 个 game instance。）

#### 2.3.6 P4 新表（mods / saves / backups / players / list_entries / monitor_snapshots）

- **mods**：`id, server_id, mod_name, version, enabled, source_url, installed_at` — Daemon 上报已安装 mod 清单，Panel 记录。
- **saves**：`id, server_id, save_name, file_path, size_bytes, modified_at, is_active` — Daemon 扫描存档目录上报。
- **backups**：`id, server_id, file_path, size_bytes, created_at, created_by, status` — 备份任务记录。
- **players**：`id, server_id, game_player_name, online, joined_at, left_at, ip_address` — 在线玩家快照（Daemon 上报，Panel 维护）。
- **list_entries**：`id, server_id, list_type(whitelist/banlist), player_name, added_at, added_by, reason` — 名单条目。
- **monitor_snapshots**：`id, server_id, timestamp, cpu_percent, memory_mb, tick_rate, player_count, json_extra` — 时序监控数据。

#### 2.3.7 P5 新表（logs / webhooks / version_downloads / hot_updates）

- **logs**：`id, server_id, timestamp, level, source, message` — 持久化日志（Panel 可配置保留天数）。
- **webhooks**：`id, server_id, name, url, events(JSON), secret, enabled, created_at` — Webhook 配置。
- **version_downloads**：`id, game_type, version, status, download_url, file_path, started_at, completed_at, error` — 版本下载任务。
- **hot_updates**：`id, server_id, from_version, to_version, status, started_at, completed_at, error` — 热更新记录。

### 2.4 索引与外键策略

- 所有 `server_id` 字段建索引（按服务器查询是最高频路径）。
- 所有 `user_id` 字段建索引。
- `shop_orders.claim_code` 与 `cdk_codes.code` 保持 UNIQUE。
- 外键策略：SQLite 启用 `PRAGMA foreign_keys = ON`，但 `shop_items.item_name` 不设外键（Pack.items 是外部数据），改为应用层校验。

### 2.5 Knex Migrations 文件命名规范

沿用 factorio 现有规范：`YYYYMMDDHHMMSS_简述.ts`，置于 `panel/backend/src/db/migrations/`。

```
panel/backend/src/db/migrations/
  20260702100000_extend_users_with_vip.ts
  20260702101000_create_vip_permissions.ts
  20260702102000_create_player_bindings.ts
  20260702110000_create_shop_items.ts
  20260702111000_create_shop_orders.ts
  20260702112000_create_shop_order_items.ts
  20260702113000_create_item_sync_log.ts
  20260702120000_create_cdk_codes.ts
  20260702130000_create_chat_settings.ts
  20260702131000_create_chat_trigger_responses.ts
  20260702132000_create_player_join_settings.ts
  20260702133000_create_periodic_messages.ts
  20260702134000_create_vote_settings.ts
  20260702135000_create_votes.ts
  20260702136000_create_vote_records.ts
  20260702140000_create_system_config.ts
  20260702150000_extend_servers_with_business_toggles.ts
  20260702160000_create_mods.ts
  20260702161000_create_saves.ts
  20260702162000_create_backups.ts
  20260702163000_create_players.ts
  20260702164000_create_list_entries.ts
  20260702165000_create_monitor_snapshots.ts
  20260702170000_create_logs.ts
  20260702171000_create_webhooks.ts
  20260702172000_create_version_downloads.ts
  20260702173000_create_hot_updates.ts
```

**幂等原则**：每个 migration 通过 `hasTable` / `hasColumn` 检查，已存在则跳过。遵循 workspace 规则"版本更新时要做迁移脚本前置处理，方便热更新"。

---

## 3. 模块拆分与实施顺序

### 3.1 P1：Pack schema 扩展 + 基础设施 + 用户/VIP

**目标**：奠定 Pack 驱动底座，用户能注册/登录/升级 VIP。

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|-------------|
| Pack schema 扩展 | Panel backend | — | `public/schema/pack-schema.ts`（修改）、`panel/backend/src/core/packs/loader.ts`（修改，支持新字段）、`panel/backend/src/core/packs/businessRegistry.ts`（新，按 Pack.business 注册业务模块） |
| factorio-vanilla Pack | packs/ | Pack schema | `packs/factorio-vanilla/pack.yaml`（新）、`packs/factorio-vanilla/AGENTS.md`（新） |
| minecraft-vanilla Pack 扩展 | packs/ | Pack schema | `packs/minecraft-vanilla/pack.yaml`（修改，补 items/event_parsers/business） |
| 基础设施：eventBus | Panel backend | — | `panel/backend/src/core/eventBus.ts`（新） |
| 基础设施：scheduler | Panel backend | — | `panel/backend/src/core/scheduler.ts`（新） |
| 基础设施：commandDispatcher | Panel backend | Pack.business | `panel/backend/src/core/commandDispatcher.ts`（新，按 Pack 模板渲染 + 下发 Daemon） |
| 用户模块 | Panel backend | users 表 | `panel/backend/src/api/routes/auth.ts`（扩展）、`panel/backend/src/api/routes/users.ts`（新）、`panel/backend/src/services/userService.ts`（新） |
| VIP 模块 | Panel backend | vip_permissions 表 | `panel/backend/src/api/routes/vip.ts`（新）、`panel/backend/src/services/vipService.ts`（新） |
| 玩家绑定模块 | Panel backend | player_bindings 表 | `panel/backend/src/api/routes/bindings.ts`（新）、`panel/backend/src/services/bindingService.ts`（新） |
| Daemon 事件解析器 | Daemon | Pack.event_parsers | `daemon/src/eventParsers/parserFactory.ts`（新）、`daemon/src/eventParsers/chatParser.ts`（新）、`daemon/src/eventParsers/joinLeaveParser.ts`（新） |
| Daemon 命令执行统一入口 | Daemon | — | `daemon/src/protocol/commandExecutor.ts`（新，封装 RCON/stdin 调用） |
| 前端：登录/注册/Profile | Panel frontend | — | `panel/frontend/src/pages/Register.tsx`、`Profile.tsx` |
| 前端：用户管理（admin） | Panel frontend | — | `panel/frontend/src/pages/UserAdmin.tsx`、`VipAdmin.tsx` |

### 3.2 P2：商店 + CDK + 物品发放

**目标**：用户能购买商品、领取订单、兑换 CDK。依赖 P1 的 commandDispatcher 与 VIP 模块。

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|-------------|
| 物品池同步服务 | Panel backend | Pack.items | `panel/backend/src/services/itemSyncService.ts`（新）、`panel/backend/src/api/routes/items.ts`（新，查询物品池） |
| shopService | Panel backend | shop_items/orders/order_items、Pack.business.shop、commandDispatcher、vipService | `panel/backend/src/services/shopService.ts`（新）、`panel/backend/src/api/routes/shop.ts`（新，用户侧）、`panel/backend/src/api/routes/shopAdmin.ts`（新，管理侧） |
| cdkService | Panel backend | cdk_codes、Pack.business.cdk、commandDispatcher | `panel/backend/src/services/cdkService.ts`（新）、`panel/backend/src/api/routes/cdk.ts`（新）、`panel/backend/src/api/routes/cdkAdmin.ts`（新） |
| 过期订单清理 | Panel backend | scheduler、shopService | `panel/backend/src/jobs/cleanupExpiredOrders.ts`（新） |
| 前端：商店 | Panel frontend | shop API | `panel/frontend/src/pages/Shop.tsx`、`Orders.tsx`、`ShopAdmin.tsx`、`CdkAdmin.tsx`、`components/ItemPickerModal.tsx` |

### 3.3 P3：聊天增强 P1-P4

**目标**：游戏内 !verify / 欢迎礼包 / 定时消息 / 自定义响应 / 投票踢人。依赖 P1 的 chat 事件上报与 P2 的物品发放。

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|-------------|
| chatMonitor（事件消费） | Panel backend | Daemon WS 上报、Pack.business.chat_enhancement | `panel/backend/src/services/chatMonitor.ts`（新） |
| chatSettings 服务 | Panel backend | chat_settings 表 | `panel/backend/src/services/chatSettingsService.ts`（新）、`panel/backend/src/api/routes/chatSettings.ts`（新） |
| 触发响应规则 | Panel backend | chat_trigger_responses 表 | `panel/backend/src/services/triggerResponseService.ts`（新）、`panel/backend/src/api/routes/chatTriggerResponses.ts`（新） |
| 欢迎礼包 | Panel backend | player_join_settings 表、shop.give_command | `panel/backend/src/services/joinHandler.ts`（新）、`panel/backend/src/api/routes/playerJoin.ts`（新） |
| 定时消息 | Panel backend | periodic_messages 表、scheduler、broadcast_command | `panel/backend/src/services/periodicMessageService.ts`（新）、`panel/backend/src/api/routes/periodicMessages.ts`（新） |
| 投票踢人 | Panel backend | vote_settings/votes/vote_records 表、kick_command | `panel/backend/src/services/voteService.ts`（新）、`panel/backend/src/api/routes/votes.ts`（新） |
| 玩家绑定 !verify | Panel backend | player_bindings 表、chat 事件 | 复用 P1 bindingService，新增 chatMonitor 中的 !verify 分支 |
| 前端：聊天增强 | Panel frontend | — | `panel/frontend/src/pages/ChatEnhancement.tsx`、`instance-detail/WelcomeSettings.tsx`、`PeriodicMessages.tsx`、`ChatResponseSettings.tsx`、`VoteKickSettings.tsx` |

### 3.4 P4：Mod / 存档 / 备份 / 监控 / 玩家 / 名单

**目标**：完善服务器运维能力。依赖 P1 基础设施。

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|-------------|
| Mod 管理 | Panel + Daemon | mods 表、Daemon 文件操作 | `panel/backend/src/services/modService.ts`、`panel/backend/src/api/routes/mods.ts`、`daemon/src/services/modManager.ts`、前端 `Mods.tsx` |
| 存档管理 | Panel + Daemon | saves 表、Daemon 扫描 | `panel/backend/src/services/saveService.ts`、`panel/backend/src/api/routes/saves.ts`、`daemon/src/services/saveScanner.ts`、前端 `Saves.tsx` |
| 备份管理 | Panel + Daemon | backups 表、Pack.backup | `panel/backend/src/services/backupService.ts`、`panel/backend/src/api/routes/backups.ts`、`daemon/src/services/backupRunner.ts`、前端 `Backups.tsx` |
| 玩家管理 | Panel | players 表、join/leave 事件、Pack.business.players | `panel/backend/src/services/playerService.ts`、`panel/backend/src/api/routes/players.ts`、前端 `Players.tsx` |
| 名单管理 | Panel | list_entries 表、Pack.business.lists | `panel/backend/src/services/listService.ts`、`panel/backend/src/api/routes/lists.ts`、前端 `Lists.tsx` |
| 监控 | Panel + Daemon | monitor_snapshots 表、Daemon 采集 | `panel/backend/src/services/monitorService.ts`、`panel/backend/src/api/routes/monitor.ts`、`daemon/src/services/metricsCollector.ts`、前端 `Monitor.tsx` |

### 3.5 P5：日志持久化 / 版本下载 / 热更新 / Webhook / 系统设置

**目标**：收尾完善。依赖 P1-P4。

| 模块 | 所在端 | 依赖 | 预计文件清单 |
|------|--------|------|-------------|
| 日志持久化 | Panel + Daemon | logs 表、Daemon stdout 转发 | `panel/backend/src/services/logService.ts`、`panel/backend/src/api/routes/logs.ts`、`daemon/src/services/logForwarder.ts`、前端 `Logs.tsx` |
| 版本下载 | Panel + Daemon | version_downloads 表、Pack.versions | `panel/backend/src/services/versionService.ts`、`panel/backend/src/api/routes/version.ts`、`daemon/src/services/downloader.ts`、前端 `VersionManager.tsx` |
| 热更新 | Panel + Daemon | hot_updates 表 | `panel/backend/src/services/hotUpdateService.ts`、`panel/backend/src/api/routes/hotUpdate.ts`、`daemon/src/services/hotUpdater.ts` |
| Webhook | Panel | webhooks 表、eventBus | `panel/backend/src/services/webhookService.ts`、`panel/backend/src/api/routes/webhooks.ts`、前端 `Webhooks.tsx` |
| 系统设置 | Panel | system_config 表 | `panel/backend/src/services/systemConfigService.ts`、`panel/backend/src/api/routes/settings.ts`、前端 `Settings.tsx` |

### 3.6 依赖关系图（DAG）

```
P1 (Pack schema + 基础设施 + 用户/VIP/绑定 + Daemon 解析/执行)
 │
 ├──> P2 (商店 + CDK) ──────────────┐
 │                                  │
 ├──> P3 (聊天增强 P1-P4) <─────────┘ (P3 用 P2 的 give_command)
 │
 ├──> P4 (Mod/存档/备份/监控/玩家/名单)
 │
 └──> P5 (日志/版本/热更新/Webhook/设置)
```

- P2 与 P3 可部分并行：P3 的欢迎礼包依赖 P2 的 give_command 渲染能力，但 P3 的投票踢人/定时消息仅依赖 P1。
- P4 各子模块相互独立，可并行开发。
- P5 各子模块相互独立，可并行开发。

---

## 4. 关键业务流程

### 4.1 商店下单 + 领取流程

```
用户网页操作                          Panel                              Daemon
   │                                  │                                   │
   │  POST /shop/orders               │                                   │
   │  {items:[{itemId,qty,quality}]}  │                                   │
   │ ────────────────────────────────>│                                   │
   │                                  │ 1. 校验物品属于当前 server.pack    │
   │                                  │ 2. 校验 item_name ∈ Pack.items    │
   │                                  │ 3. 校验 quality ∈ Pack.items.qualities
   │                                  │ 4. 事务内：VIP 品质校验           │
   │                                  │    (effectiveMaxQuality from vip) │
   │                                  │ 5. 每日限额校验                    │
   │                                  │ 6. 生成 claim_code (8位)          │
   │                                  │ 7. 插入 shop_orders + items       │
   │<──────────────────────────────── │ 返回 {orderId, claimCode}         │
   │                                  │                                   │
   (用户进游戏，发 "!claim ABCD1234")  │                                   │
   │                                  │  ← WS 上报 {type:'chat',          │
   │                                  │      player:'Alice',              │
   │                                  │      message:'!claim ABCD1234'}   │
   │                                  │                                   │
   │                                  │ chatMonitor 匹配 !claim:          │
   │                                  │ 1. claimOrder(code, player)       │
   │                                  │ 2. 事务+乐观锁 pending→claiming   │
   │                                  │ 3. 查 shop_order_items            │
   │                                  │ 4. for each item:                 │
   │                                  │    按 Pack.business.shop.give_command
   │                                  │    渲染: /silent-command game     │
   │                                  │    .players['Alice'].insert{...}  │
   │                                  │ ────── WS 下行命令 ─────────────> │
   │                                  │                                   │ RCON 发送
   │                                  │ <───── WS 回执 {ok:true} ──────── │
   │                                  │ 5. 全部成功 → status='claimed'    │
   │                                  │    部分失败 → 回滚 pending        │
   │                                  │ 6. 广播通知（可选）                │
```

**关键点**：
- 命令渲染在 Panel 完成，Daemon 收到的是完整字符串，无业务上下文。
- 乐观锁防止并发领取：`UPDATE shop_orders SET status='claiming' WHERE claim_code=? AND status='pending'`。
- 部分失败回滚为 pending，允许玩家重试。

### 4.2 CDK 兑换流程

```
游戏内聊天                        Panel                              Daemon
   │                                │                                   │
   │ "!claim CDKCODE12"             │                                   │
   │ ──────────────────────────────>│ (Daemon 解析为 chat 事件上报)      │
   │                                │                                   │
   │                                │ chatMonitor:                      │
   │                                │ 1. 先查 cdk_codes (按 code+server_id)
   │                                │ 2. 命中 → cdkService.redeem()     │
   │                                │    未命中 → 回退查 shop_orders    │
   │                                │ 3. 事务+乐观锁 unused→claiming    │
   │                                │ 4. 解析 rewards JSON              │
   │                                │ 5. for each reward:               │
   │                                │    按 Pack.business.cdk.redeem_command
   │                                │    (= shop.give_command) 渲染     │
   │                                │ ───── WS 下行 ──────────────────> │ RCON 发送
   │                                │ <──── 回执 ──────────────────────  │
   │                                │ 6. 全部成功 → status='claimed'    │
   │                                │    记录 claimed_player            │
```

**与商店领取的差异**：
- CDK 兑换码是运营者批量生成，绑定奖励包；shop claim_code 是用户购买后生成。
- chatMonitor 优先查 cdk_codes，回退 shop_orders，避免歧义。
- CDK 不绑定 user_id（游戏内兑换），只记录 game_player_name。

### 4.3 聊天 !verify 流程

```
游戏内聊天                        Panel                              Daemon
   │                                │                                   │
   │ "!verify A1B2C3"               │                                   │
   │ ──────────────────────────────>│ chat 事件上报                     │
   │                                │                                   │
   │                                │ chatMonitor 匹配 !verify:         │
   │                                │ 1. 提取 verify_code='A1B2C3'      │
   │                                │ 2. 查 player_bindings WHERE       │
   │                                │    verify_code='A1B2C3' AND       │
   │                                │    status='pending'               │
   │                                │ 3. 命中 → UPDATE status='verified'│
   │                                │    绑定 game_player_name 到 user  │
   │                                │ 4. 按 Pack.business.verify 决定   │
   │                                │    是否下发广播命令（可选）        │
   │                                │ ───── WS 下行广播 ──────────────> │ (可选) RCON
   │                                │                                   │
   │ (游戏内显示：绑定成功)          │                                   │
```

**关键点**：
- !verify 不下发 give 命令，仅更新 DB 绑定状态。
- 绑定成功后，该 game_player_name 与 user_id 关联，后续 shop/CDK 兑换可识别用户身份。
- Daemon 只负责解析 chat 事件上报，不参与绑定逻辑。

### 4.4 玩家加入礼包流程

```
游戏进程 stdout                   Daemon                              Panel
   │                                │                                   │
   │ "Alice joined the game"        │                                   │
   │ ──────────────────────────────>│ joinParser 匹配 event_parsers.join│
   │                                │ 生成 {type:'join', player:'Alice'}│
   │                                │ ───── WS 上报 join 事件 ─────────> │
   │                                │                                   │
   │                                │                        joinHandler:
   │                                │                        1. 查 player_join_settings
   │                                │                           (按 server_id)
   │                                │                        2. 判断首次加入 vs 回归
   │                                │                           (查 players 表历史)
   │                                │                        3. 若 first_gift_enabled:
   │                                │                           for each gift item:
   │                                │                             按 Pack.business.chat_enhancement
   │                                │                             .welcome.first_gift_command
   │                                │                             (= shop.give_command) 渲染
   │                                │                        4. 发送欢迎语（broadcast_command）
   │                                │ <──── WS 下行 give 命令 ───────── │
   │                                │ RCON 发送                         │
   │                                │ <──── WS 下行 broadcast ─────────  │
   │                                │ RCON 发送                         │
```

**关键点**：
- Daemon 按 `event_parsers.join` 正则解析 join 事件，不硬编码 Factorio 格式。
- Panel joinHandler 查 `player_join_settings` 决定是否发礼包、发什么。
- 礼包发放复用 shop.give_command 模板，保持命令渲染统一。
- 回归礼包（relogin_gift）有冷却与每日限额，由 Panel 在 joinHandler 中校验。

---

## 5. 数据迁移方案

### 5.1 迁移总体策略

```
factorio manager.db ──┐
                      ├──> 迁移脚本 ──> gameserver-panel panel.db
factorio 配置文件 ────┘                  (已存在 users/nodes/servers/packs)
```

- 迁移脚本独立于运行时，一次性执行：`panel/backend/src/scripts/migrateFromFactorio.ts`。
- 迁移前备份 `panel.db`，迁移后输出报告（各表迁移条数、失败条数）。
- 迁移是单向的：factorio manager.db → panel.db，迁移完成后 factorio 项目不再作为生产数据源。

### 5.2 factorio manager.db → panel.db 迁移

#### 5.2.1 users 表迁移（关键：id 类型转换）

factorio users 用 integer id，gameserver-panel 用 string id（UUID）。

**策略**：
1. 为每个 factorio user 生成 UUID。
2. 建立 `old_id → new_uuid` 映射表（迁移脚本内内存 Map）。
3. 所有引用 user_id 的表（shop_orders / cdk_codes.claimed_by / player_bindings / votes 等）在迁移时用映射表转换。
4. 保留 factorio 的 username / password_hash / role / vip_level / vip_expires_at / is_verified / display_name / email。
5. 首个 system_admin 升级逻辑（factorio 的 migrateFirstAdminToSystemAdmin）不再需要，迁移时直接按 role 字段映射。

**冲突处理**：若 panel.db 已有同 username/email 用户，跳过该 factorio 用户并记录到失败报告，由人工裁决合并。

#### 5.2.2 instances → servers 映射

factorio `instances` 表与 gameserver-panel `servers` 表语义重合（1 实例 = 1 服务器进程）。

**策略**：
1. factorio 每个 instance 在 panel.db 创建一条 server 记录。
2. `instance.id` → `server.id`（保留原 ID，如 'default' 或 'inst-xxx'）。
3. `instance.shop_enabled / mod_enabled` → `servers.shop_enabled / mods_enabled`。
4. 其余 server 字段（node_id / pack_id / port / rcon_port）由人工在迁移时配置（factorio 未存这些）。

#### 5.2.3 业务表迁移（instance_id → server_id）

以下表直接迁移，仅做 `instance_id` → `server_id` 字段重命名与 `user_id` 类型转换：

- shop_items（删除 display_name / category 字段，从 Pack.items 补）
- shop_orders / shop_order_items
- cdk_codes
- chat_settings / chat_trigger_responses
- player_join_settings / periodic_messages
- vote_settings / votes / vote_records
- player_bindings（factorio_player_name → game_player_name）
- vip_permissions（直接迁移）
- system_config（直接迁移）
- item_sync_log（直接迁移）

#### 5.2.4 不迁移的数据

- factorio 的 `mod-list.json` / `server-settings.json` 等文件：由新系统的 Pack + Daemon 重新管理。
- factorio 的 `data/factorio/config/backups/`：备份文件不迁移，由新系统重新生成。
- factorio 的内存态数据（在线玩家、进程状态）：迁移时自然丢失，新系统启动后重建。

### 5.3 shop_items 表数据的特殊处理

**决策：shop_items 表数据迁移到 panel.db，但 display_name / category 字段丢弃。**

| factorio shop_items 字段 | 迁移处理 |
|--------------------------|----------|
| item_name | 保留，迁移后校验是否存在于 factorio-vanilla Pack.items |
| display_name | **丢弃**，运行时从 Pack.items 取 |
| category | **丢弃**，运行时从 Pack.items 取 |
| quality | 保留 |
| vip_level_required | 保留（兼容，但 createOrder 不再读） |
| daily_limit | 保留 |
| enabled | 保留 |
| instance_id | 重命名为 server_id |

**迁移后校验**：迁移脚本输出"item_name 不在 Pack.items 中"的清单，由人工处理（可能是 Pack.items 未同步或 factorio 数据脏）。

### 5.4 迁移脚本输出

```
[Migration Report]
  users:         migrated 42, skipped 3 (username conflict), failed 0
  servers:       migrated 5
  shop_items:    migrated 128, warnings 2 (item_name not in Pack.items)
  shop_orders:   migrated 156
  cdk_codes:     migrated 89
  ... (各表)
  Total: migrated 1234 records, 5 warnings, 0 failures
```

报告写入 `.trae/documents/YYYYMMDD_模块0_factorio数据迁移.md`。

---

## 6. 风险与回退

### 6.1 关键风险点

| 风险 | 等级 | 影响 | 缓解措施 |
|------|------|------|---------|
| Pack schema 过度复杂，新游戏 Pack 编写门槛高 | 🔴 高 | 阻碍多游戏扩展 | 提供 Pack 模板生成器 + factorio-vanilla / minecraft-vanilla 作为参考实现；编写 Pack 编写指南 |
| `same as shop.give_command` 等 shorthand 约定未被 Panel 正确解析 | 🟡 中 | 命令渲染失败 | 在 Pack 加载阶段（loader.ts）即展开 shorthand，运行时只见最终模板 |
| Daemon 事件解析器正则性能差（高吞吐 stdout） | 🟡 中 | 事件丢失或延迟 | 限制正则复杂度；Daemon 端流式逐行匹配，避免全量缓冲；性能压测 |
| 物品池 github_sync 失败（网络问题） | 🟡 中 | 商店无法上新物品 | itemSyncService 有重试 + 本地缓存；shop_items 引用的 item_name 即使物品池未同步也不影响已上架商品 |
| factorio 用户 id (int) → UUID (string) 迁移映射错误 | 🔴 高 | 数据关联断裂 | 迁移脚本严格校验外键引用完整性；迁移后跑一致性检查 |
| 多游戏品质概念差异（factorio 5 级 vs minecraft 0 级）导致 shopService 分支爆炸 | 🟡 中 | 违反"零游戏分支"原则 | shopService 按 Pack.items.quality_tiers 自动决定是否走品质校验，无 if(game) 分支 |
| Panel↔Daemon WS 断连导致命令丢失 | 🟡 中 | 物品发放失败 | 命令下发支持重试 + 幂等（claim_code/cdk_code 状态机保证）；WS 重连后补发未确认命令 |
| Pack.business 模板注入攻击（恶意 item_name） | 🔴 高 | 游戏进程执行恶意命令 | Panel 渲染时严格白名单校验（`/^[A-Za-z0-9_-]+$/`），与 factorio 现有 buildInsertCommand 一致 |

### 6.2 回退方案

**C-3 失败回退到 C-2（Panel 内置业务逻辑，Pack 仅描述启动）**：

| C-3 元素 | C-2 回退处理 |
|----------|-------------|
| Pack.business.* | 移除该字段，业务逻辑内联到 Panel 服务（shopService 直接构建命令字符串） |
| Pack.event_parsers | 移除该字段，Daemon 内置 Factorio 解析器（仅支持 Factorio） |
| Pack.items | 移除该字段，shop_items 表恢复 display_name / category 字段 |
| 通用 shopService | 拆分为 factorioShopService（含 Lua 命令构建） |

**C-3 失败回退到 C-1（直接搬运 factorio 代码到 Panel）**：

- 放弃 Pack 驱动，把 factorio 的 shopService / cdkService / chatMonitor 等服务原样移植到 Panel backend。
- Daemon 仅做 RCON 转发与 stdout 透传。
- 多游戏支持延后，仅支持 Factorio。

**回退触发条件**：
- P1 完成后若 Pack schema 扩展导致 Pack 加载失败率 > 5%。
- P2 完成后若 shopService 命令渲染错误率 > 1%。
- 任何阶段若 GN-004 审查判定方向性偏离且无法修正。

**回退执行**：
1. 保留 C-3 已完成代码在 `feature/c3-pack-driven` 分支。
2. 切回 main 分支，按 C-2 或 C-1 重新实现。
3. 将 C-3 经验沉淀到 `.trae/documents/`，供后续评估是否重启。

---

## 7. 验证计划

### 7.1 验证分层

| 层级 | 范围 | 执行者 | 通过标准 |
|------|------|--------|---------|
| 单元测试 | 每个 service 的纯函数（命令渲染、品质校验、限额计算、正则解析） | LLM 自主执行 | 覆盖率 ≥ 80%，全部 PASS |
| 契约测试 | Pack schema zod 校验、接口存根签名匹配 | LLM 自主执行 | 全部 PASS |
| E2E 测试 | 关键业务路径（下单-领取、CDK 兑换、!verify、加入礼包） | LLM 自主执行 | 全部 PASS |
| Mock 回归 | 前端页面在 Mock 模式下渲染与交互 | LLM 自主执行 | 4 个关键页面无回归 |
| GN-004 审查 | spec 三件套 + 锚点闭合 + 契约有效性 | 主线程拉起 GN-004 | 通过或警示放行 |
| 人工验收 | 真实游戏进程联调 | 人类 | 用户价值优先场景可用 |

### 7.2 关键验证用例

#### 7.2.1 Pack schema 扩展验证

- factorio-vanilla Pack 通过扩展后的 zod schema 校验。
- minecraft-vanilla Pack（无 quality）通过校验。
- 缺失 items / event_parsers / business 任一字段的 Pack 加载失败并报错。

#### 7.2.2 商店下单-领取全链路

1. 用户登录（VIP 2）→ 选物品（uncommon 品质）→ 下单成功。
2. 用户登录（VIP 0）→ 选物品（uncommon 品质）→ 下单失败（品质超限）。
3. 用户下单 → 生成 claim_code → 游戏 !claim → 物品发放成功 → 订单 claimed。
4. 并发 !claim 同一 claim_code → 仅一个成功（乐观锁验证）。

#### 7.2.3 CDK 兑换全链路

1. 管理员批量生成 100 个 CDK → 全部唯一。
2. 游戏内 !claim CDKCODE → 物品发放成功 → 状态 claimed。
3. 重复 !claim 同一 CDK → 失败（已被使用）。
4. CDK 跨实例兑换 → 失败（instance_id 不匹配）。

#### 7.2.4 聊天增强全链路

1. 玩家加入 → 欢迎语广播 + 首次礼包发放。
2. 玩家发 "!verify A1B2C3" → 绑定状态 verified。
3. 玩家发 "投票踢人 Bob" → 发起投票 → 达到阈值 → Bob 被 kick。
4. 定时消息按 scheduler 触发广播。

#### 7.2.5 多游戏适配验证

1. factorio-vanilla Pack 加载 → shop 启用品质选择（5 级）。
2. minecraft-vanilla Pack 加载 → shop 无品质选择。
3. 同一 shopService 代码服务两种 Pack，无 if(game) 分支。

#### 7.2.6 数据迁移验证

1. factorio manager.db 迁移到 panel.db → 各表条数一致。
2. 迁移后用户可登录（password_hash 保留）。
3. 迁移后订单 claim_code 仍可领取。
4. 迁移报告无 failure。

### 7.3 验证执行顺序

按 s0402 前端三重闸门规则：单测 → E2E → Mock 回归，不可跳关。

1. **P1 完成**：跑 Pack schema 单测 + 用户/VIP 模块单测 + 登录 E2E。
2. **P2 完成**：跑 shop/cdk 单测 + 下单-领取 E2E + 商店页面 Mock 回归。
3. **P3 完成**：跑 chatMonitor/voteService 单测 + !verify E2E + 聊天设置页面 Mock 回归。
4. **P4 完成**：跑 mod/save/backup 单测 + 监控 E2E。
5. **P5 完成**：跑 log/webhook 单测 + 系统设置 E2E。
6. **整体交付前**：GN-004 交付前审查 + 人工真实游戏联调。

---

## 附录 A：与 factorio 原系统的差异对照

| 维度 | factorio 原系统 | C-3 方案 | 差异理由 |
|------|----------------|----------|---------|
| 架构 | 单体 backend | Panel + Daemon 三层 | 多节点支持 |
| 业务逻辑位置 | backend 内联 | Panel 按 Pack.business 加载 | 多游戏适配 |
| 命令构建 | shopService.buildInsertCommand 硬编码 Lua | Pack.business.shop.give_command 模板渲染 | 多游戏适配 |
| 物品池 | itemSyncService 同步到 shop_items 表 | Pack.items + item_sync_log，shop_items 仅引用 | 解耦物品定义与上架配置 |
| 事件解析 | chatMonitor 内联 Factorio 正则 | Daemon 按 Pack.event_parsers 解析 | 多游戏适配 |
| 实例隔离 | instances 表 | servers 表（1 server = 1 instance） | 命名对齐 |
| 用户 id | integer 自增 | string UUID | 分布式友好 |
| 玩家绑定字段 | factorio_player_name | game_player_name | 多游戏通用 |

## 附录 B：未决问题（待 GN-004 审查或人类裁决）

1. **品质校验与 Pack.items.quality_tiers 的联动**：若某游戏 Pack.items.quality_tiers=0，vip_permissions.max_quality 应如何处理？（建议：强制为 'normal' 或 'none'，shopService 跳过品质校验分支）
2. **Minecraft give 命令的 quality 处理**：Minecraft 无品质概念，shop_items.quality 字段对 Minecraft 是否保留？（建议：保留字段但强制 'normal'，前端不显示品质选择器）
3. **Daemon 是否需要自己的 DB**：监控数据（monitor_snapshots）量大，是否放 Daemon 本地 SQLite 而非 Panel？（建议：P4 实现时评估，默认放 Panel）
4. **Pack 版本升级时 shop_items.item_name 引用过期物品**：Pack.items 移除某物品后，引用它的 shop_items 如何处理？（建议：Panel 启动校验，标记 disabled 并告警）

---

> 本方案为 C-3 方向定稿，后续进入 S2 契约冻结时基于本方案生成 spec 三件套与三层契约（public/schema/）。任何与本方案偏离的实现需经 GN-004 审查 + 人类裁决。
