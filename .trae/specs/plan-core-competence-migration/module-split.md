# s0203 模块拆分与编排

> 🚨 【最高优先级规则】本文件为模块拆分与执行编排的强制约束，优先级高于临时对话内容，所有 S4 并行开发必须 100% 符合本文件。
>
> 📌 【上下文保留规则】本文件为工程交接锚点，任何上下文压缩、裁剪场景下必须完整保留全部内容。

## 三段交接状态

### (1) 工程过程

- 2026-07-02：s0101-s0103 完成需求收束与方案融合，产出 `scheme-final-merged.md`
- 2026-07-02：s0201 完成三层契约冻结（28 表 JSON Schema + 24 服务 .d.ts + 3 配置契约 + 36 错误码）
- 2026-07-02：s0201 GN-004 降级审查通过（人工 checklist 替代），用户批准闭合
- 2026-07-02：s0203 启动，基于 `scheme-final-merged.md §7` + `§10.2` + `§10.3` 输出本文档

### (2) 交接状态

- **当前状态**：s0203 模块拆分文档产出完成，待主线程降级 GN-004 审查 + 人类裁决后进入 S4
- **未闭合项**：
  - s0203 GN-004 降级审查待执行
  - 模块级 AGENTS.md 由 S4 各分支开发时按 s0301 模板生成（不在 s0203 强制产出）
- **阻塞项**：无
- **下一步**：降级 GN-004 审查 → NotifyUser → S4 P1 并行开发

### (3) 最终结果

- **产出物**：本模块拆分文档（`module-split.md`）+ 模块目录骨架 + `public/schema/CHANGELOG.md`
- **验证结论**：拆分表覆盖方案 §7.1-7.3 全部模块，依赖 DAG 与方案 §5 业务流程一致，并行组与方案 §10.3 调度台账对齐
- **可继续推进性**：本文档通过 GN-004 降级审查 + 人类裁决后，可直接进入 S4 P1 开发

---

## 一、模块拆分表

### 1.1 Panel Backend 模块（panel/backend/src/）

| 模块ID | 模块名 | 路径 | 职责 | 优先级 | 依赖 |
|:---:|------|------|------|:---:|------|
| B00 | db/migrations | `db/migrations/` | Knex migrations（28 张表） | P1 | public/schema/ |
| B01 | packLoader | `packLoader/` | Pack 加载/校验/注册/按 business 实例化业务模块 | P1 | public/schema/pack-schema* |
| B02 | eventBus | `services/eventBus.ts` | 内部事件总线（pub/sub） | P1 | 无 |
| B03 | scheduler | `services/scheduler.ts` | 定时任务调度（periodic_message 等） | P1 | B02 |
| B04 | userService | `services/userService.ts` | 用户注册/登录/JWT/VIP 等级 | P1 | B00 |
| B05 | vipService | `services/vipService.ts` | VIP 等级查询/品质校验/限额 | P1 | B00, B01 |
| B06 | systemConfigService | `services/systemConfigService.ts` | 系统配置 KV | P1 | B00 |
| B07 | itemSyncService | `services/itemSyncService.ts` | GitHub 物品同步（按 Pack.items.source） | P1 | B01, B06 |
| B08 | commandDispatcher | `services/commandDispatcher.ts` | 命令渲染/队列/重试/成就预热 | P1 | B01, B09 |
| B09 | daemonClient | `daemonClient/` | REST + WS 双通道（扩展 sendCommand 下行） | P1 | public/interface_stub/daemon-* |
| B10 | shopService | `services/shopService.ts` | 商品/订单/乐观锁/claimOrder 两段事务 | P2 | B01, B05, B08 |
| B11 | cdkService | `services/cdkService.ts` | CDK 生成/兑换/乐观锁 | P2 | B01, B05, B08 |
| B12 | chatMonitor | `services/chatMonitor.ts` | stdout 解析（按 Pack.event_parsers）/命令路由 | P3 | B01, B02, B10, B11 |
| B13 | joinHandler | `services/joinHandler.ts` | 玩家加入/欢迎礼包/!verify | P3 | B01, B02, B08, B10 |
| B14 | voteService | `services/voteService.ts` | 投票踢人状态机 | P3 | B01, B02, B08 |
| B15 | periodicMessageService | `services/periodicMessageService.ts` | 定时消息 | P3 | B01, B03, B08 |
| B16 | playerTracker | `services/playerTracker.ts` | 玩家在线状态跟踪 | P3 | B02 |
| B17 | modService | `services/modService.ts` | Mod 管理记录 | P4 | B00, B09 |
| B18 | saveService | `services/saveService.ts` | 存档记录 | P4 | B00, B09 |
| B19 | backupService | `services/backupService.ts` | 备份任务 | P4 | B00, B09 |
| B20 | monitorService | `services/monitorService.ts` | 监控快照存储/阈值告警 | P4 | B00 |
| B21 | listService | `services/listService.ts` | 白名单/黑名单 | P4 | B00 |
| B22 | webhookService | `services/webhookService.ts` | Webhook 触发/分发 | P5 | B02 |
| B23 | auditLogService | `services/auditLogService.ts` | 审计日志 | P5 | B00 |
| B24 | api/routes | `api/routes/` | Express 路由（shop/cdk/vip/users/chat/vote/mods/...） | 各 | 对应 service |

### 1.2 Panel Frontend 模块（panel/frontend/src/pages/）

| 页面ID | 页面名 | 路径 | 优先级 | 依赖 API |
|:---:|------|------|:---:|------|
| F01 | Login | `Login.tsx`（已有） | - | auth |
| F02 | Servers | `Servers.tsx`（已有） | - | servers |
| F03 | CreateServer | `CreateServer.tsx`（已有） | - | servers, packs |
| F04 | ServerDetail | `ServerDetail.tsx`（已有，扩展 Tab） | - | servers, daemon |
| F05 | VipPermissions | `VipPermissions/` | P1 | vip-permissions |
| F06 | SystemConfig | `SystemConfig/` | P1 | system-config |
| F07 | ItemSync | `ItemSync/` | P1 | item-sync |
| F08 | Users | `Users/` | P1 | users |
| F09 | Shop | `Shop/` | P2 | shop-items, shop-orders |
| F10 | ShopOrders | `ShopOrders/` | P2 | shop-orders |
| F11 | CDK | `CDK/` | P2 | cdk-codes |
| F12 | CDKRedeem | `CDKRedeem/` | P2 | cdk-codes |
| F13 | ChatEnhancement | `ChatEnhancement/` | P3 | chat-settings, chat-trigger-responses |
| F14 | PeriodicMessages | `PeriodicMessages/` | P3 | periodic-messages |
| F15 | Votes | `Votes/` | P3 | votes, vote-records |
| F16 | Players | `Players/` | P3 | player-bindings, player-histories |
| F17 | PlayerBindings | `PlayerBindings/` | P3 | player-bindings |
| F18 | Mods | `Mods/` | P4 | mods |
| F19 | Saves | `Saves/` | P4 | saves |
| F20 | Backups | `Backups/` | P4 | backups |
| F21 | Monitor | `Monitor/` | P4 | monitor |
| F22 | Lists | `Lists/` | P4 | lists |
| F23 | Webhooks | `Webhooks/` | P5 | webhooks |
| F24 | AuditLogs | `AuditLogs/` | P5 | audit-logs |

### 1.3 Daemon 模块（daemon/src/，已有无需新增）

| 模块ID | 模块名 | 路径 | 职责 | 状态 |
|:---:|------|------|------|:---:|
| D01 | instances | `instances/` | 进程管理 + 状态机 | 既有 |
| D02 | protocol | `protocol/` | RCON/stdin 客户端 | 既有 |
| D03 | server | `server.ts` | HTTP + WS 服务端（仅转发 stdout，不解析） | 既有 |
| D04 | auth | `auth.ts` | Bearer Token 鉴权 | 既有 |

### 1.4 公共契约模块（public/，仅项目负责人可修改）

| 模块ID | 路径 | 内容 |
|:---:|------|------|
| P00 | `public/schema/` | 28 张表 JSON Schema + error-codes + pack-schema-extension + CHANGELOG.md |
| P01 | `public/interface_stub/` | 24 服务 .d.ts + shared-types + panel-rest + daemon-rest + command-protocol + daemon-api-types + panel-api-types + ws-events |
| P02 | `public/config_template/` | panel-config.schema + daemon-config.schema + panel.env.template + daemon.env.template + pack-template.yaml |
| P03 | `public/pre_generated_mock/` | rcon-mock-server.ts（既有） |
| P04 | `public/test_cases/` | pack-fixtures（既有） |

---

## 二、依赖 DAG

```
                     ┌──────────────────────────────────────────┐
                     │           public/ (P00-P04)              │  ← 契约层（冻结）
                     │   schema / interface_stub / config_tmpl  │
                     └────────────┬─────────────────────────────┘
                                  │
                                  ▼
                     ┌──────────────────────────────────────────┐
                     │            B00 db/migrations             │  ← P1 数据库基座
                     └────────────┬─────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
      ┌──────────┐         ┌────────────┐        ┌──────────────┐
      │ B01      │         │ B02        │        │ B09          │
      │ packLoader│        │ eventBus   │        │ daemonClient │
      └───┬──────┘         └─────┬──────┘        └──────┬───────┘
          │                      │                      │
          │   ┌──────────────────┴────────────────┐     │
          ▼   ▼                                   ▼     │
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
    │ B03         │  │ B04          │  │ B08          │ │
    │ scheduler   │  │ userService  │  │ commandDispatcher│◀┘
    └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
           │                │                 │
           │                ▼                 │
           │         ┌──────────────┐         │
           │         │ B05          │         │
           │         │ vipService   │◀────────┤
           │         └──────┬───────┘         │
           │                │                 │
           │   ┌────────────┼─────────────┐   │
           │   ▼            ▼              ▼   │
           │ ┌──────────┐ ┌────────────┐ ┌──────────────┐
           │ │ B06      │ │ B07        │ │              │
           │ │ sysConfig│ │ itemSync   │ │              │
           │ └────┬─────┘ └────────────┘ │              │
           │      │                        │              │
           │      ▼                        ▼              │
           │ ┌──────────────────────────────────────┐    │
           │ │       P1 闭合 ★回退锚点1              │    │
           │ └──────────────────────────────────────┘    │
           │                                              │
           ▼                                              ▼
    ┌─────────────────────────────────────────────────────────┐
    │  P2: B10 shopService  +  B11 cdkService                 │
    │  依赖: B01 + B05 + B08                                   │
    └─────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │       P2 闭合 ★回退锚点2          │
                └─────────────────┬───────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       ▼                          ▼                          ▼
 ┌───────────┐            ┌──────────────┐          ┌──────────────┐
 │ B12       │            │ B13          │          │ B14          │
 │ chatMonitor│           │ joinHandler  │          │ voteService  │
 └─────┬─────┘            └──────┬───────┘          └──────┬───────┘
       │                         │                         │
       │                  ┌──────┴──────┐                  │
       │                  │ B10 claim   │                  │
       │                  │ Order       │                  │
       │                  └─────────────┘                  │
       │                                                  │
       ├─────────────┬────────────────┬───────────────────┤
       ▼             ▼                ▼                   ▼
 ┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
 │ B15      │  │ B16         │  │              │  │              │
 │ periodic │  │ player      │  │              │  │              │
 │ Message  │  │ Tracker     │  │              │  │              │
 └──────────┘  └─────────────┘  └──────────────┘  └──────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │       P3 闭合 ★回退锚点3          │
                └─────────────────┬───────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       ▼             ▼            ▼             ▼            ▼
 ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 │ B17 mod  │ │ B18 save │ │ B19 back │ │ B20 mon  │ │ B21 list │
 └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │       P4 闭合 ★回退锚点4          │
                └─────────────────┬───────────────┘
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
                    ┌──────────┐    ┌──────────┐
                    │ B22 hook │    │ B23 audit│
                    └──────────┘    └──────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │       P5 闭合 ★回退锚点5          │
                └─────────────────────────────────┘
```

### 2.1 关键依赖关系（文字描述）

| 上游 | 下游 | 依赖性质 |
|------|------|---------|
| public/ | 所有模块 | 契约层冻结，所有模块以此为唯一真相源 |
| B00 migrations | B04/B05/B06/B17-B23 | DB 表存在才能写入 |
| B01 packLoader | B05/B07/B08/B10/B11/B12/B13/B14/B15 | 所有需要 Pack.business / event_parsers 的服务 |
| B02 eventBus | B12/B13/B14/B15/B16/B22 | 事件订阅 |
| B03 scheduler | B15 | 定时任务 |
| B04 userService | B05（查询用户 VIP 等级） | 用户身份 |
| B05 vipService | B10/B11 | 商店/CDK 品质校验 |
| B08 commandDispatcher | B10/B11/B13/B14/B15 | 命令下发 |
| B09 daemonClient | B08/B17/B18/B19 | REST+WS 通道 |
| B10 shopService | B12/B13 | chatMonitor 路由 !claim / joinHandler 欢迎礼包 |
| B11 cdkService | B12 | chatMonitor 路由 !redeem |

### 2.2 循环依赖检查

- **无循环依赖**：B10 shopService.claimOrder 被 B12 chatMonitor 调用，但 B10 不反向调用 B12（B10 通过 B08 直接下发命令）
- **B13 joinHandler → B10 shopService.claimOrder**（欢迎礼包）：单向依赖，无循环
- **B12 chatMonitor → B10/B11**：单向依赖，B10/B11 不订阅 chatMonitor 事件

---

## 三、并行组与串行顺序

### 3.1 并行组划分

> **降级路径声明**：parallel-sub-agent 不可用（用户已选降级路径），全部使用 `general_purpose_task` 串行执行。下表保留并行组划分，待 parallel-sub-agent 可用时可直接启用。

| 组 | 优先级 | 包含模块 | 并行可行性 | 串行原因 |
|:---:|:---:|------|:---:|------|
| G1 | P1 | B00, B01, B02, B03, B04, B05, B06, B07, B08, B09 | 可并行（独立上下文） | 降级路径下串行执行 |
| G2 | P2 | B10, B11 | 可并行 | 降级路径下串行执行 |
| G3 | P3 | B12, B13, B14, B15, B16 | 可并行（独立上下文） | 降级路径下串行执行 |
| G4 | P4 | B17, B18, B19, B20, B21 | 可并行 | 降级路径下串行执行 |
| G5 | P5 | B22, B23 | 可并行 | 降级路径下串行执行 |
| G-FE-P1 | P1 | F05, F06, F07, F08 | 可并行 | 降级路径下串行执行 |
| G-FE-P2 | P2 | F09, F10, F11, F12 | 可并行 | 降级路径下串行执行 |
| G-FE-P3 | P3 | F13, F14, F15, F16, F17 | 可并行 | 降级路径下串行执行 |
| G-FE-P4 | P4 | F18, F19, F20, F21, F22 | 可并行 | 降级路径下串行执行 |
| G-FE-P5 | P5 | F23, F24 | 可并行 | 降级路径下串行执行 |

### 3.2 组间串行顺序

```
G1 (P1 后端) → G2 (P2 后端) → G3 (P3 后端) → G4 (P4 后端) → G5 (P5 后端)
                                                                        │
                                                                        ▼
                                                            G-FE-P1 → G-FE-P2 → ... → G-FE-P5
```

**优化策略**：前端 P1 可在后端 P1 完成后立即启动（不依赖后端 P2-P5），实现后端 P2 与前端 P1 的并行。降级路径下不启用此优化，按顺序串行。

### 3.3 失败回退锚点

| 锚点 | 触发条件 | 回退动作 | 保留物 |
|:---:|---------|---------|--------|
| ★回退锚点1 | G1 (P1) 任一模块开发失败 | 回退到 P0 平台骨架 | 保留 users/nodes/servers/packs 4 表 |
| ★回退锚点2 | G2 (P2) shopService/cdkService 失败 | 删除 shop/cdk 表与服务，保留 P1 | P1 全部模块 + 28 表 migrations 中的 P1 表 |
| ★回退锚点3 | G3 (P3) 聊天增强失败 | 删除 chat/vote/periodic_message 表与服务，禁用 chat_enabled | P1+P2 |
| ★回退锚点4 | G4 (P4) 运维管理失败 | 删除 mods/saves/backups/monitor/lists 表与服务 | P1+P2+P3 |
| ★回退锚点5 | G5 (P5) audit/webhook 失败 | 删除 audit_logs/webhooks 表与服务 | P1-P4 |

---

## 四、模块命名与目录规范

### 4.1 模块命名方案

- **Panel Backend 服务**：`panel/backend/src/services/{serviceName}.ts`（camelCase，如 `shopService.ts`）
- **Panel Backend 路由**：`panel/backend/src/api/routes/{resourceName}.ts`（kebabCase 或 camelCase，如 `shop.ts`）
- **Panel Backend Pack 加载器**：`panel/backend/src/packLoader/`（独立目录，含 loader.ts/registry.ts）
- **Panel Frontend 页面**：`panel/frontend/src/pages/{PageName}/`（PascalCase 目录，含 index.tsx）
- **Knex migrations**：`panel/backend/src/db/migrations/{YYYYMMDDHHMMSS}_{action}_{table}.ts`

### 4.2 public/ 边界

```yaml
public_protected:
  - 任何对 public/ 的删除/修改/覆盖/移动操作必须经人类显式授权
  - 契约变更必须走 s0601 流程
  - 不存在"零引用即可删除"的例外

cross_module_rules:
  - panel/backend/ 不得 import daemon/src/ 内部代码
  - daemon/src/ 不得 import panel/backend/ 内部代码
  - 模块间仅允许通过 public/ 下的契约（schema/, interface_stub/）协作
  - 数据读写必须通过 zod schema 校验
  - 所有对外接口必须严格匹配 .d.ts 存根签名
```

### 4.3 跨模块协作约束

| 协作场景 | 允许方式 | 禁止方式 |
|---------|---------|---------|
| Panel ↔ Daemon | REST API + WS 事件（按 daemon-rest.ts / ws-events.ts 契约） | 直接 import daemon/src/ |
| Service ↔ Service | 通过 eventBus 发布订阅 / 显式 import service 模块 | 通过全局变量 / 隐式单例 |
| Frontend ↔ Backend | REST API（按 panel-rest.ts 契约）+ WS | 直接读写 DB |
| Pack ↔ 业务模块 | packLoader 加载后通过 registry.getBusinessConfig(packId) 查询 | 业务模块自行解析 pack.yaml |

---

## 五、Subagent 调度台账

> 本台账为 s0203 阶段输出，actual agent id 在 S4 各 subagent 拉起后回填。

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|:---:|---|---|---|---|---|:---:|
| S3 模块拆分 | — | 主线程（非subagent） | module-split.md + 模块目录骨架 + CHANGELOG.md | — | .trae/specs/plan-core-competence-migration/ | S2 契约冻结 | 进行中 |
| S4 P1 后端 | G1 | general_purpose_task | B00-B09 全部实现 + 单测 | 待启动 | panel/backend/src/ | ★回退锚点1 | 待启动 |
| S4 P2 后端 | G2 | general_purpose_task | B10 + B11 实现 + 单测 | 待启动 | panel/backend/src/services/ | ★回退锚点2 | 待启动 |
| S4 P3 后端 | G3 | general_purpose_task | B12-B16 实现 + 单测 | 待启动 | panel/backend/src/services/ | ★回退锚点3 | 待启动 |
| S4 P4 后端 | G4 | general_purpose_task | B17-B21 实现 + 单测 | 待启动 | panel/backend/src/services/ | ★回退锚点4 | 待启动 |
| S4 P5 后端 | G5 | general_purpose_task | B22 + B23 实现 + 单测 | 待启动 | panel/backend/src/services/ | ★回退锚点5 | 待启动 |
| S4 前端 P1 | G-FE-P1 | general_purpose_task | F05-F08 4 页面 | 待启动 | panel/frontend/src/pages/ | S4 P1 后端完成 | 待启动 |
| S4 前端 P2 | G-FE-P2 | general_purpose_task | F09-F12 4 页面 | 待启动 | panel/frontend/src/pages/ | S4 P2 后端完成 | 待启动 |
| S4 前端 P3 | G-FE-P3 | general_purpose_task | F13-F17 5 页面 | 待启动 | panel/frontend/src/pages/ | S4 P3 后端完成 | 待启动 |
| S4 前端 P4 | G-FE-P4 | general_purpose_task | F18-F22 5 页面 | 待启动 | panel/frontend/src/pages/ | S4 P4 后端完成 | 待启动 |
| S4 前端 P5 | G-FE-P5 | general_purpose_task | F23-F24 2 页面 | 待启动 | panel/frontend/src/pages/ | S4 P5 后端完成 | 待启动 |
| S5 契约校验 | — | GN-004（降级人工） | 契约测试+合规检查报告 | 待启动 | .trae/documents/ | S4 完成 | 待启动 |
| S6 合流交付 | — | GN-004（降级人工） | 交付前审查报告 | 待启动 | .trae/documents/ | S5 完成 | 待启动 |

> **降级声明**：parallel-sub-agent 不可用，全部使用 `general_purpose_task` 串行执行。`actual agent id` 在 subagent 拉起后回填真实标识符。

---

## 六、下游接续入口

### 6.1 S4 P1 开发输入清单

**B00 db/migrations**：
- 输入：`public/schema/*.json`（28 张表 JSON Schema）
- 输出：`panel/backend/src/db/migrations/{YYYYMMDDHHMMSS}_create_*.ts`（按 P1-P5 分批创建）
- 闭合判据：`npx knex migrate:latest` 成功 + 表结构与 schema 一致

**B01 packLoader**：
- 输入：`public/schema/pack-schema-extension.json` + `public/config_template/pack-template.yaml` + `packs/minecraft-vanilla/pack.yaml`
- 输出：`panel/backend/src/packLoader/{loader,registry}.ts`
- 闭合判据：能加载 minecraft-vanilla Pack + 通过 schema 校验 + getBusinessConfig 返回正确配置

**B02-B09 基础设施服务**：
- 输入：`public/interface_stub/{event-bus,scheduler,user-service,vip-service,system-config-service,item-sync-service,command-dispatcher,daemon-client}.d.ts`
- 输出：`panel/backend/src/services/*.ts` + `panel/backend/src/daemonClient/client.ts`（扩展）
- 闭合判据：实现匹配 .d.ts 签名 + 单测通过

### 6.2 S4 各阶段闭合判据

| 阶段 | 闭合判据 |
|:---:|---------|
| P1 后端 | B00-B09 全部实现 + 单测通过 + `npm run dev` 启动无错误 + Pack 加载成功 |
| P2 后端 | B10-B11 实现 + 单测通过（含乐观锁并发场景）+ `POST /api/shop/orders` 端到端通 |
| P3 后端 | B12-B16 实现 + 单测通过 + chatMonitor 能解析 minecraft-vanilla stdout |
| P4 后端 | B17-B21 实现 + 单测通过 |
| P5 后端 | B22-B23 实现 + 单测通过 |
| 前端 P1 | F05-F08 4 页面渲染 + 与后端 API 联调通 |
| 前端 P2-P5 | 对应页面渲染 + 联调通 |

### 6.3 阻断条件

- 任何模块实现违反 public/ 契约 → 阻断，回退到对应锚点
- 任何模块出现游戏专属硬编码（`if (game === 'factorio')`）→ 阻断，重写
- migrations 失败 → 阻断，回退到上一版本
- 命令模板渲染被注入攻击 → 阻断，强化 VARIABLE_PATTERNS 校验

---

## 七、未闭合项

| # | 未闭合项 | 性质 | 阻塞下游 | 处理时机 |
|---|---------|------|---------|---------|
| 1 | s0203 GN-004 降级审查待执行 | [V] 节点 | 是 | 立即（人工 checklist 替代） |
| 2 | 模块级 AGENTS.md 未生成 | 工程产出 | 否 | S4 各分支按 s0301 模板生成 |
| 3 | pack-template.yaml 中 `same as shop.give_command` shorthand 解析逻辑 | 工程产出 | 否 | B01 packLoader 实现时处理 |
| 4 | factorio 数据迁移脚本（§6）未生成 | 工程产出 | 否 | S4 P1 完成后按需生成 |
