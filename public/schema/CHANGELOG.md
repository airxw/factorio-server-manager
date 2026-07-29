# 契约变更记录 (Changelog)

## [v4.32.2] - 2026-07-29 - 数据量监控告警（B2.8）

> **变更类型**: MINOR（新增 1 个 `/api/admin/maintenance/data-volume` 接口 + 3 个 TS 类型，全部向后兼容，无破坏性变更）
> **决策来源**: `docs/plans/admin-pages-polish-and-consistency-plan.md` §五 B2.8（决策点 3 = B，已审批）
> **依赖**: v3.6.2（maintenance 路由 + system_config KV 表）

### 一、数据契约变更

#### 1.1 新增数据契约

无新表。仅复用 `system_config` KV 表存储自定义阈值（key = `monitor.data_volume_threshold.<table_name>`）。

#### 1.2 新增 TS 类型（panel-api-types.ts）

- `DataVolumeTableName`（联合：`audit_logs` / `user_notifications` / `item_sync_log` / `chat_logs` / `player_bindings` / `webhooks` / `api_keys`）
- `DataVolumeLevel`（联合：`normal` / `warning` / `critical`）
- `DataVolumeTableStatus`（单表状态：行数 + 阈值 + 等级 + 百分比）
- `DataVolumeResponse`（聚合响应：表列表 + 告警计数 + 采集时间）

### 二、接口变更

新增端点：

- `GET /api/admin/maintenance/data-volume` —— 返回 7 张关键表的行数 + 阈值 + 告警等级（normal < 80% < warning < 95% ≤ critical）

### 三、阈值默认值

| 表名 | 默认阈值（行数） | 依据 |
|------|----------------|------|
| audit_logs | 100,000 | 日志表，retention 已兜底 |
| user_notifications | 50,000 | 日志表，retention 已兜底 |
| item_sync_log | 50,000 | 日志表，retention 已兜底 |
| chat_logs | 100,000 | 日志表，retention 来自 Pack 配置 |
| player_bindings | 50,000 | 按服务器维度增长 |
| webhooks | 200 | 通常 <10/实例 |
| api_keys | 500 | 通常 <50/用户 |

阈值可通过 `system_config` KV 覆盖：`key = monitor.data_volume_threshold.<table_name>`, `value = 数字字符串`。

### 四、影响范围

- **后端**：`panel/backend/src/api/routes/maintenance.ts`（新增 GET `/data-volume` 路由 + 阈值常量 + 等级分类函数）
- **前端**：
  - `panel/frontend/src/api/client.ts` + `api/modules/admin.ts`（新增 `getDataVolume` 方法）
  - `panel/frontend/src/api/queries/keys.ts` + `admin.ts`（新增 `useDataVolume` hook）
  - `panel/frontend/src/pages/admin/SystemHealth.tsx`（新增「数据量监控」Tab + `DataVolumePanel` + `DataVolumeTableCard` 组件）

### 五、闭合判据

- 后端 `tsc --noEmit` 通过
- 前端 `tsc --noEmit` 通过
- 阈值判定逻辑覆盖 normal/warning/critical 三档
- 单表查询失败不阻断其他表（best-effort）
- 阈值可通过 system_config KV 覆盖（运行时可配置）

---

## [v4.31.0] - 2026-07-29 - 登录日志与个人活动日志（安全中心）

> **变更类型**: MINOR（新增 1 表 + 新增 3 个 `/api/me/*` 接口类型 + 新增 1 个枚举，全部向后兼容，无破坏性变更）
> **决策来源**: `docs/plans/login-history-and-personal-activity-log-plan.md`（2026-07-29 人类裁决批准，4 项 AskUserQuestion 裁决）
> **依赖**: v3.9.0（audit_logs 表 + auditLogService + audit 中间件，本版本复用并补链）

### 一、数据契约变更

#### 1.1 新增数据契约（1 张表）

- **`login_history`** —— 登录尝试流水表。记录每次登录（成功 + 失败），含 user_id（失败且用户不存在时为 NULL）/ login_type 枚举 / ip_address / user_agent / device_summary（ua-parser-js 解析）/ session_id（JWT jti）/ failure_reason / retention_days（默认 90）/ created_at。3 个索引：`(user_id, created_at)` 用户侧查询、`(created_at)` 清理任务、`(ip_address, created_at)` 风控查询。

#### 1.2 修改数据契约

无。`audit_logs` 表结构不动；`users` 表字段不动（`last_login_at`/`last_login_ip` 已存在于 v3.x）。

### 二、TS 类型同步（panel-api-types.ts）

新增类型（位于 `// ----- Audit Logs -----` 段落之后）：

- `LoginType`（枚举联合：`success` / `fail_password` / `fail_disabled` / `fail_unverified` / `fail_not_found`）
- `LoginHistoryEntry` / `LoginHistoryListResponse` / `LoginHistoryListQuery`
- `MyActivityEntry` / `MyActivityListResponse` / `MyActivityListQuery`（复用 audit_logs 数据，用户侧视图不含 server_id/user_id）
- `LastLoginInfo` / `LastLoginResponse`

### 三、数据库迁移

- 新增迁移 `20260829000000_create_login_history.ts`：`CREATE TABLE IF NOT EXISTS login_history`（11 字段 + 3 索引），幂等建表，不修改任何现有表。`down()` 为 `DROP TABLE`，无外键依赖，回滚无副作用。

### 四、影响范围

- **后端**：
  - `routes-registry.ts`（登录路由 `POST /api/auth/login` 5 个结果分支接入 `loginHistoryService.create()`，恢复 `last_login_at`/`last_login_ip` 更新；`app.locals` 注入 loginHistoryService；注册 `/api/me/*` 路由）
  - 新增 `services/loginHistoryService.ts`（CRUD + ua-parser-js 设备解析 + cleanup）
  - 新增 `api/routes/meSecurity.ts`（`GET /api/me/login-history` / `GET /api/me/audit-logs` / `GET /api/me/last-login`）
  - `package.json` 新增 `ua-parser-js` + `@types/ua-parser-js` 依赖
  - 定时任务调度器接入 `loginHistoryService.cleanupOldLogs()`
- **前端**：
  - 新增 `api/modules/security.ts`（类型 + 请求函数）
  - 新增 `pages/user-center/SecurityCenter.tsx`（安全中心页：上次登录卡 + 登录历史 + 我的活动）
  - 新增 `components/LoginLastLoginModal.tsx`（登录后弹窗）
  - `pages/user-center/UserCenter.tsx`（快捷操作区加"安全中心"入口）
  - `pages/Login.tsx`（登录成功后调用 `/api/me/last-login` 并弹窗）
  - 路由注册 `/user-center/security`
- **契约**：`public/schema/panel-api-types.ts`（新增 9 个类型 + 1 个枚举，MINOR 非破坏性）
- **不修改**：`middleware/audit.ts`（保持 `/api/auth/login` 排除，避免双写）、`api/routes/auditLogs.ts`（admin 路由不变）、`services/auditLogService.ts`（复用不改）、`services/userService.ts`（login() 方法不强行接入）

### 五、决策记录（AskUserQuestion 闭合）

| 决策点 | 裁决 |
|--------|------|
| 存储方式 | 独立 `login_history` 表（与 audit_logs 解耦） |
| 失败记录 | 记录成功+失败（完整安全审计） |
| IP/设备增强 | 解析 UA 为可读设备名（ua-parser-js，不引入 geoip） |
| 前端形态 | 安全中心页 + 登录后弹窗 |

---

## [v4.30.0] - 2026-07-29 - 部署节点对实例管理员开放（落地 v4.28.0 节点归属契约）

> **变更类型**: PATCH（TS 类型同步落地 v4.28.0 已规划字段，无 JSON Schema 变更，无破坏性变更）
> **决策来源**: 用户要求（2026-07-29）—— 部署节点对实例管理员开放，部署的节点归属创建者；未开源场景预览模式
> **依赖**: v4.28.0（nodes-schema.json 已规划 node_source / self_hosted_owner_id / approval_status 等字段）

### 一、数据契约变更

无 JSON Schema 变更（v4.28.0 已在 `nodes-schema.json` 中规划全部字段）。

### 二、TS 类型同步（panel-api-types.ts）

- `NodeClusterInfo` 新增 5 个字段（落地 v4.28.0 契约）：
  - `node_source: NodeSource`（platform_managed / self_hosted）
  - `self_hosted_owner_id: string | null`
  - `approval_status: NodeApprovalStatus`（pending / approved / rejected）
  - `approved_by: string | null`
  - `approved_at: string | null`
- 新增类型别名：`NodeSource` / `NodeApprovalStatus`

### 三、数据库迁移

- 新增迁移 `20260826000000_add_self_hosted_fields_to_nodes.ts`：nodes 表新增 5 列 + 2 索引（idx_nodes_self_hosted_owner_id / idx_nodes_node_source），既有节点默认 platform_managed / approved。

### 四、影响范围

- 后端：nodeService.ts（createInvite / listNodes / assertNodeOwnedByUser）、nodes.ts（requireRole + assertNodeOwnership 中间件）
- 前端：App.tsx（路由守卫）、Layout.tsx（侧边栏入口）、Nodes.tsx（组件守卫 + 未开源预览模式）、Modal.tsx（size prop）
- 契约：panel-api-types.ts（TS 类型同步）

---

## [v4.28.0] - 2026-07-27 - 角色权限与经济体系（腐竹跨实例聚合账户 + 平台分账 + 腐竹等级分级 + 自带节点豁免）

> **变更类型**: MINOR（新增 6 表 + 新增 3 接口存根 + 新增 1 配置契约 + 既有契约向后兼容扩展，无破坏性变更）
> **决策来源**: `docs/plans/role-permission-economy-system-plan.md`（决策 D1-D4，2026-07-27 人类裁决批准）
> **依赖**: v4.17.0（多角色体系）+ business-logic v1（user_wallets / instance_renewals / recharge_cdks 契约基线）

### 一、数据契约变更

#### 1.1 新增数据契约（6 张表）

- **`admin-wallets-schema.json`** —— 腐竹跨实例聚合账户。UNIQUE(admin_user_id)，balance（可消费/可提现）+ pending_balance（T+7 冻结期）+ owed_amount（欠款自动抵扣）三余额分离。
- **`admin-wallet-transactions-schema.json`** —— 腐竹账户流水审计。含 balance_after / pending_balance_after 快照，7 种 transaction_type × 7 种 source_type。
- **`admin-tiers-schema.json`** —— 腐竹等级配置（tier 0-4 共 5 级）。承载实例上限/玩家上限/资源费折扣/分账比例/高级功能/API 密钥数/即时结算标记。
- **`user-admin-tiers-schema.json`** —— 用户↔腐竹等级一对一关联主表（含 assigned_by/last_evaluated_at 审计字段）。
- **`settlement-rules-schema.json`** —— 分账规则配置。scope(instance/game_type/global) + admin_tier 维度，platform_share + admin_share = 1.0，含冻结期与优先级。
- **`settlement-records-schema.json`** —— 分账结算记录。含 rule_snapshot 规则快照（防追溯失真），状态机 pending/released/reversed。

#### 1.2 修改数据契约（向后兼容扩展）

- **`nodes-schema.json`**（新建补齐）—— 新增 `node_source`（platform_managed/self_hosted）+ `self_hosted_owner_id` + `approval_status`（pending/approved/rejected）字段。既有节点迁移默认 platform_managed（保守原则，避免漏计费）。
- **`instance-renewals-schema.json`** —— 新增 3 字段：`wallet_source`（user_wallets/admin_wallets，默认 user_wallets）/ `admin_tier_discount_applied`（腐竹等级折扣快照）/ `node_source_at_renewal`（节点来源快照）。既有记录默认 wallet_source='user_wallets'。
- **`user-schema.json`** —— 新增 `admin_tier_id` 字段（integer，nullable，默认 null；查询加速冗余，主表 user_admin_tiers，写入同事务同步）。
- **`permission-points-schema.json`** —— `definitions.predefined_points` 新增 9 个腐竹经济域权限点种子文档（admin_wallet.view/withdraw/settle、admin_tier.assign、recharge_cdk_batch.create/audit、platform_fee.collect/exempt、node.self_hosted.manage）。category 枚举无变更。
- **`role-permission-templates-schema.json`** —— `definitions.recommended_seed_associations` 新增角色关联种子文档（instance_admin 4 项 / server_admin 9 项 / user 0 项）。
- **`error-codes-schema.json`** —— 新增 14 个错误码（ADMIN_WALLET_NOT_FOUND、ADMIN_WALLET_INSUFFICIENT_BALANCE(402)、ADMIN_WALLET_PENDING_NOT_SPENDABLE、ADMIN_WALLET_TRANSFER_FORBIDDEN、WITHDRAWAL_NOT_FOUND、WITHDRAWAL_NOT_PENDING、WITHDRAWAL_BELOW_MIN_AMOUNT、SETTLEMENT_RULE_NOT_FOUND、SETTLEMENT_RULE_INVALID、SETTLEMENT_RECORD_NOT_FOUND、ADMIN_TIER_NOT_FOUND、ADMIN_TIER_LIMIT_EXCEEDED(429)、ADMIN_TIER_FEATURE_LOCKED、SELF_HOSTED_NODE_NOT_APPROVED）；category 枚举新增 node/demo 两类（demo 修复 DEMO_MODE_DISABLED 既有类目越界不一致）。

### 二、接口契约变更

#### 2.1 新增接口存根（3 个）

- **`admin-wallet-service.d.ts`** —— `AdminWalletService`：账户查询/扣款/加款/冻结入账/释放/腐竹续费自有实例/提现申请与审批。并发安全要求 DB 事务 + 行锁。
- **`admin-tier-service.d.ts`** —— `AdminTierService`：等级查询/限额校验（instances/players_per_instance/api_keys）/高级功能判定/手动分配/自动评估（近 30 天双指标）。
- **`settlement-service.d.ts`** —— `SettlementService`：规则 CRUD/六档优先级匹配/SETTLEMENT_RUNNER 异步结算/PENDING_BALANCE_RELEASER 冻结释放/即时结算（tier 4，手续费 5%）/退款冲正（pending→balance→owed_amount 三段抵扣）。

#### 2.2 修改接口契约

- **`shared-types.d.ts`** —— 新增 v4.28.0 段落：12 个字面量类型（NodeSource/WalletSource/SettlementCycle/AdminWalletTransactionType 等）+ 6 个实体类型（AdminWallet/AdminWalletTransaction/AdminTier/UserAdminTier/SettlementRule/SettlementRecord）+ 5 个 DTO（AdminWalletInfo/WithdrawalRequestInput/AdminRenewInstanceInput/AdminRenewInstanceResult/SettlementRuleMatch）+ 14 个错误类。`InstanceRenewal` 扩展 3 字段（wallet_source/admin_tier_discount_applied/node_source_at_renewal）；`User` 扩展 admin_tier_id；`SchedulerTaskType` 新增 3 成员（SETTLEMENT_RUNNER/PENDING_BALANCE_RELEASER/ADMIN_TIER_EVALUATOR）。

### 三、配置契约变更

- **`economy.config.schema.json`**（新增，`public/config_template/`）—— 14 项可调参数：分账冻结期（168h）/最低结算金额/默认分账比例（0.7）/提现最低限额（10000 点券）/即时结算手续费率（0.05）/欠款宽限（30 天）/等级评估阈值与降级规则/自带节点单节点实例上限（10）。system_config key 前缀 economy.*，zod default 自动补齐。

### 四、向后兼容性

- **破坏性变更**: 无。全部为新增表/新增字段（带默认值）/新增枚举值/新增错误码，既有消费方不受影响。
- **数据迁移**: 6 个 migration（init_admin_tiers 种子 5 条 / init_admin_wallets 既有 instance_admin 自动建户 / init_settlement 默认 global 规则 admin_share=0.7 / extend_nodes_field 默认 platform_managed / extend_instance_renewals_fields 默认 user_wallets / extend_users_admin_tier_id 既有 instance_admin 默认 tier 1）。新增字段必须 `ALTER TABLE ADD COLUMN IF NOT EXISTS`（项目历史 bug 教训）。
- **回退策略**: 新表 DROP 即可回退；新增字段保留不影响旧代码。

### 五、影响范围

#### 5.1 下游待实现（契约先行、零实现；s0202 Mock → s0203 模块拆分 → S4 并行开发）

- `panel/backend/src/services/adminWalletService.ts` / `adminTierService.ts` / `settlementService.ts`（新建）
- `panel/backend/src/services/instanceRenewalService.ts`（扣款源切换扩展）
- `panel/backend/src/services/scheduler.ts`（注册 3 个新任务）
- `panel/backend/src/api/` admin-wallet / admin-tier / admin-settlement / admin-withdrawal 路由
- `panel/frontend/src/pages/admin/` AdminWalletPage / AdminTierPage / SettlementPage / AdminTiersManagePage / WithdrawalApprovalPage
- 6 个 migration 脚本 + 单测/契约测试/E2E（admin-economy-flow.spec.ts）

#### 5.2 关键约束（下游实现必须遵守）

- admin_wallets 与 user_wallets 物理隔离，禁止互转（ADMIN_WALLET_TRANSFER_FORBIDDEN）
- 余额变更必须 DB 事务 + 行锁（防并发超扣）
- 分账资金 T+7 冻结期，仅 balance 可消费/提现
- 自带节点（node_source=self_hosted）续费 amount_paid=0 豁免，需 approval_status='approved'；**self_hosted 节点插入必须显式写 approval_status='pending'**（不得依赖 schema 静态默认值 'approved'，该默认值仅为兼容既有 platform_managed 节点迁移），未过审节点续费抛 SELF_HOSTED_NODE_NOT_APPROVED
- 未匹配分账规则时默认 platform_share=1.0 不分账
- 充值 CDK 批次支持腐竹归属（recharge_cdk_batches 扩展在实施阶段评估，本版不冻结字段）

---

## [v4.27.0] - 2026-07-27 - 玩家角色绑定从 game_type 全局语义迁移至 instance 实例级语义

> **变更类型**: MAJOR（BREAKING，请求体字段重命名 + 数据语义变更 + 旧数据物理删除）
> **决策来源**: `docs/plans/player-binding-instance-scope-migration-plan.md` + `current-note.md` v4.27.0 s0601 留痕
> **依赖**: 无（独立变更，但下游 8 处消费方需同步）

### 一、接口契约变更（panel-api-types.ts）

#### 1.1 `CreatePlayerBindingRequest` 字段重命名 `game_type` → `server_id`

- **类型**: MAJOR（BREAKING）
- **差异**:
  ```diff
  export interface CreatePlayerBindingRequest {
    game_player_name: string;
  - game_type: string;
  + server_id: string;
  }
  ```
- **语义变更**:
  - 旧：玩家角色绑定到 `game_type`（跨实例全局），后端写入 `bindings.scope_type='game_type', scope_ref=game_type`
  - 新：玩家角色绑定到 `server_id`（实例级），后端写入 `bindings.scope_type='instance', scope_ref=server_id`
- **响应类型 `Binding`**：无变更（`scope_type` / `scope_ref` 字段语义本就支持 instance）
- **`bindings-schema.json`**：无修改（schema 本就支持 `scope_type='instance'`，仅废弃 `binding_type='player' + scope_type='game_type'` 组合）

### 二、向后兼容性

- **破坏性变更**: 是。`POST /api/player-bindings` 请求体字段从 `game_type` 改为 `server_id`，所有调用方必须同步。
- **数据迁移**: 旧 `bindings` 表中 `binding_type='player' AND scope_type='game_type'` 的记录由迁移脚本 `20260727100000_drop_game_type_player_bindings.ts` 物理删除。
- **回退策略**: 不可逆——旧数据物理删除后无法恢复，部署前必须备份 `panel.db`。

### 三、影响范围

#### 3.1 P0 必须立即同步（破坏性变更，20 项）
- `public/pre_generated_mock/bindings.ts` mock #2 #6 改为 instance
- `public/test_cases/bindings-contract.test.ts` 用例 #2 改为 instance
- `public/test_cases/bindings-api-contract.test.ts` createBinding 测试改为 instance
- `panel/backend/src/services/playerService.ts` list/create/verify/reject/delete WHERE
- `panel/backend/src/services/instanceBindingService.ts` verifyBindingByCode 删 step 2 + getVipLevelByGamePlayerName 改查询
- `panel/backend/src/api/routes/playerBindings.ts` POST 请求体校验 + createServerPlayerBindingsRouter
- `panel/backend/src/api/routes/{my,store-player-actions,store-gm,daemon-report}.ts`
- `panel/backend/src/services/{cdkService,userService,myAssetsService}.ts`
- `panel/frontend/src/pages/guild/GuildBind.tsx` 向导第 1 步改实例下拉框
- `panel/frontend/src/pages/guild/components/AccountBindingCard.tsx`
- `panel/frontend/src/api/modules/servers.ts` + `panel/frontend/src/api/client.ts`
- 新增 `panel/backend/src/db/migrations/20260727100000_drop_game_type_player_bindings.ts`

#### 3.2 P1 测试同步更新（5 项）
- `panel/backend/src/api/routes/{playerBindings,my,users.roles}.test.ts`
- `panel/frontend/src/pages/guild/__tests__/GuildBind.test.tsx`
- `panel/frontend/src/mocks/handlers.ts`

#### 3.3 P2 文档与留痕（3 项）
- `version.md` 追加 v4.27.0
- `current-note.md`（已写留痕）
- `README.md`（无需修改）

### 四、下游阻断条件

- 调用 `POST /api/player-bindings` 的所有客户端必须将请求体 `game_type` 字段改为 `server_id`
- 后端 `playerService.createBinding` 校验逻辑从 `(user_id, game_type)` 重复检查改为 `(user_id, server_id)`
- 数据库迁移脚本必须最后执行（所有代码改完且测试通过后）

---

## [v4.22.9] - 2026-07-26 - nodes linkKey 过期机制

> **变更类型**: MINOR（新增字段 + 新增错误码，向后兼容）
> **决策来源**: `docs/plans/nodes-add-node-fix-plan.md` + `.trae/documents/20260726_契约变更适配清单_nodes_linkKey过期.md`
> **依赖**: 无（独立变更）

### 一、接口契约变更（panel-api-types.ts）

#### 1.1 `CreateNodeInviteResponse` 新增 `expires_at` 字段

- **类型**: MINOR（新增必填字段）
- **兼容策略**: 数据库迁移时为 `status='pending'` 的历史节点回填 `link_key_expires_at = now + 24h`
- **新字段**: `expires_at: string`（ISO 8601，linkKey 过期时间）

#### 1.2 新增错误码 `NODE_LINK_KEY_EXPIRED`

- **类型**: MINOR（新增枚举值）
- **触发条件**: `linkSlave` 调用时 `link_key_expires_at < now`
- **HTTP 状态**: 401

### 二、向后兼容性

- **破坏性变更**: 无（历史 pending 节点通过迁移回填保证兼容）
- **运行时影响**: 新创建的邀请将有过期时间；旧 pending 节点回填后同样有过期时间
- **消费方**: 前端 `CreateNodeInviteResponse` 类型自动同步；后端 `nodeService` 需实现过期校验

### 三、影响范围

- `panel/backend/src/services/nodeService.ts`：createInvite / regenerateInvite 返回 expires_at；linkSlave 增加过期校验
- `panel/backend/src/api/routes/nodes.ts`：POST / 和 POST /:id/regenerate-invite 透传 expires_at
- `panel/frontend/src/pages/admin/Nodes.tsx`：展示 expires_at + 补 regenerate-invite 入口
- `panel/frontend/src/api/modules/servers.ts`：新增 regenerateNodeInvite 方法
- 数据库迁移：nodes 表新增 `link_key_expires_at` 列

---

## [v4.19.3] - 2026-07-25 - PlayerBindingSummary 物理删除 + 全量迁移到统一 Binding 契约

> **变更类型**: MINOR（类型删除 + 响应模型变更，破坏性变更但运行时已全量迁移）
> **决策来源**: `docs/plans/v4.19.0-unified-release-plan.md` §五 M3.4 + `docs/plans/v4.19.1-deferred-implementation-plan.md` §四 M3
> **依赖**: v4.19.2（M3.4 标注 @deprecated + 迁移路径公示完成）

### 一、接口契约变更（panel-api-types.ts）

#### 1.1 `PlayerBindingStatus` 类型物理删除

- **原状态**：v4.19.2 标注 `@deprecated v4.19.2 M3`
- **v4.19.3 操作**：物理删除（旧枚举 `pending|verified|rejected` 已被 `BindingVerifyStatus` 取代，后者含 `pending|verified|expired|revoked`）
- **替代**：`BindingVerifyStatus`

#### 1.2 `PlayerBindingSummary` 类型物理删除

- **原状态**：v4.19.2 标注 `@deprecated v4.19.2 M3` + 迁移路径公示
- **v4.19.3 操作**：物理删除（~12 字段旧响应模型）
- **替代**：统一 `Binding` 契约（v4.17.0 引入，字段含 `binding_type` / `scope_type` / `scope_ref` / `verify_status` / `verify_code` / `verify_expires_at` / `metadata` 等）

#### 1.3 响应类型签名变更

| 响应类型 | 原字段 | 新字段 |
|---------|--------|--------|
| `ListPlayerBindingsResponse` | `bindings: PlayerBindingSummary[]` | `bindings: Binding[]` |
| `CreatePlayerBindingResponse` | `binding: PlayerBindingSummary` | `binding: Binding` |
| `VerifyPlayerBindingResponse` | `binding: PlayerBindingSummary` | `binding: Binding` |
| `RejectPlayerBindingResponse` | `binding: PlayerBindingSummary` | `binding: Binding` |
| `ListServerPlayerBindingsResponse` | `bindings: Array<PlayerBindingSummary & { username: string }>` | `bindings: Array<Binding & { username: string }>` |

#### 1.4 字段映射表（消费方迁移指南）

| 旧字段（PlayerBindingSummary） | 新字段（Binding） | 说明 |
|-------------------------------|------------------|------|
| `game_player_name` | `player_name` | 仅 binding_type='player' 有值 |
| `game_type` | `scope_ref` | scope_type='game_type' 时填游戏类型字符串 |
| `status` | `verify_status` | 枚举值扩展：新增 `expired` / `revoked` |
| — | `binding_type` | 新增：`account` / `player` |
| — | `scope_type` | 新增：`instance` / `game_type` / `global` |
| — | `vip_level` | 新增：默认 0 |
| — | `wallet_id` | 新增：仅 binding_type='account' 有值 |
| — | `verify_expires_at` | 新增：验证码过期时间 |
| — | `metadata` | 新增：JSON 字符串，存储游戏特有属性 |

### 二、向后兼容性

- **破坏性变更**：旧消费方读取 `game_player_name` / `game_type` / `status` 字段会失败
- **运行时影响**：无（前后端 + Mock + 测试 fixture 已在 v4.19.3 全量迁移完成）
- **历史数据**：无影响（`bindings` 表 schema 在 v4.17.0 已按 `Binding` 契约建表，数据无需迁移）

### 三、影响范围

- `panel/backend/src/services/playerService.ts`：返回类型改用 `Binding`
- `panel/backend/src/api/routes/playerBindings.ts`：SELECT 别名调整 + 补齐 `Binding` 必需字段
- `panel/frontend/src/pages/guild/GuildBind.tsx`：state / 字段访问 / 子组件 prop 类型全量迁移
- `panel/frontend/src/api/client.ts`：方法返回类型改用 `Binding`
- `panel/frontend/src/mocks/handlers.ts`：MSW handler 响应体改用统一 `Binding` 字段
- `panel/frontend/src/pages/guild/__tests__/GuildBind.test.tsx`：测试 fixture 改用 `Binding` 字段

### 四、未删除项（继续保留）

- `UserInfo.role` / `AdminUserSummary.role`：暂不物理删除（前端 / Mock 迁移完成度待 M7/M8 评估）
- `user-schema.json` 中 `role` 字段定义：暂不删除（避免存量部署 schema 校验失败）
- JWT `payload.role`：保留（旧 JWT 向后兼容）

---

## [v4.19.2] - 2026-07-25 - 过渡期字段标注 + PlayerBindingSummary 废弃标记

> **变更类型**: PATCH（标注 @deprecated，无字段删除；为 v4.19.3 物理删除铺路）
> **决策来源**: `docs/plans/v4.19.0-unified-release-plan.md` §五 M3 + `docs/plans/v4.19.1-deferred-implementation-plan.md` §四 M3
> **依赖**: v4.19.0（M5 基线已 DROP users.role 列）+ v4.19.1（M1 闭合）

### 一、接口契约变更（panel-api-types.ts）

#### 1.1 `PlayerBindingSummary` 标注 @deprecated v4.19.2

- **原状态**：`@deprecated v4.18.0 删除` 标注，但实际未删除
- **新状态**：`@deprecated v4.19.2 M3` — 标注运行时使用方清单 + 迁移路径，明确 v4.19.3 物理删除
- **签名**：不变
- **向后兼容性**：完全兼容（仅注释变更）

#### 1.2 `UserInfo.role` / `AdminUserSummary.role` 保留 @deprecated 标注

- **现状**：保留 `@deprecated v4.17.0 过渡期保留，等同 active_role；v4.18.0 删除`
- **v4.19.2 决策**：暂不物理删除——前端 / Mock / 部分 API 路由仍依赖此字段作为响应中的派生字段
- **后续**：v4.19.3 M6 评估前端迁移完成后物理删除

### 二、数据契约变更

#### 2.1 `user-schema.json` — `users.role` 字段保留 @deprecated 标注

- **现状**：M5 基线已不创建此列；schema 仍保留字段定义供历史数据迁移参考
- **v4.19.2 决策**：暂不删除 schema 字段定义（避免存量部署 schema 校验失败）
- **后续**：v4.19.3 M6 评估后决定是否从 schema 中移除

#### 2.2 `player-bindings-schema.json` — 物理删除

- **原状态**：v4.17.0 标注 `x-deprecated-removal-version: v4.18.0`，运行时无引用
- **v4.19.2 操作**：经 `ec7_action_gate`（rules-0 §四-7.2）+ 人类显式授权（rules-0 §四-10）后物理删除
- **授权记录**：用户在 v4.19.2 实施过程中明确授权（2026-07-25）
- **替代契约**：`bindings-schema.json` + `public/interface_stub/bindings.d.ts`（v4.17.0 起为唯一真相源）
- **向后兼容性**：完全兼容（运行时已无任何 .ts/.tsx 引用，仅在历史文档/计划文件中作为参考被提及）

### 三、影响范围

- 所有引用 `PlayerBindingSummary` 的代码（标注 @deprecated，IDE 警告）
- 所有读取 `UserInfo.role` / `AdminUserSummary.role` 的代码（无影响，字段保留）

### 四、迁移说明

- 无需数据迁移
- 部署后立即生效（无存量数据兼容问题）
- v4.19.3 M6 计划：迁移 `PlayerBindingSummary` 使用方到统一 `Binding` 契约，完成后物理删除

---

## [v4.19.0] - 2026-07-25 - 鉴权链路加固（R3 遗留项修复）

> **变更类型**: PATCH（行为变更，签名不变；事务/异常语义加强）
> **决策来源**: `docs/plans/v4.19.0-unified-release-plan.md` §四 M2（GN-004 R3 审查遗留项）
> **依赖**: v4.17.0（多角色重构）+ v4.18.0（Setup Wizard 修复）

### 一、接口契约变更（user-service.d.ts）

#### 1.1 `revokeAllUserTokens` / `revokeUserTokens` 行为变更（R3-3）

- **原行为**：SELECT token_version + 内存黑名单 + UPDATE token_version+1 三步操作未在事务内；DB 异常静默降级返回 0
- **新行为**：SELECT + UPDATE 包进 `db.transaction()`；事务异常向上抛出（不再静默降级），由调用方决定回滚/阻断策略
- **签名**：不变
- **向后兼容性**：异常语义从"静默降级"变为"向上抛出"。原依赖"失败返回 0"的调用方需改为 try-catch。

#### 1.2 `selectActiveRole` 行为变更（R3-4）

- **原行为**：不撤销旧 token（角色切换不强制下线）
- **新行为**：角色权限降级（高→低，按 ROLE_LEVEL 比较）时强制撤销旧 token；同级或升级不撤销
- **签名**：不变
- **向后兼容性**：新增"角色降级时撤销"行为。前端切换角色降级后旧 token 立即失效，需用返回的新 token 替换。

#### 1.3 `updateUserRoles` 行为变更（R3-11-1 + R3-11-2）

- **R3-11-1 原行为**：activeRole 显式传入但不在 roles 中时，`resolveActiveRole` 静默降级到 roles[0]
- **R3-11-1 新行为**：activeRole 显式传入但不在 roles 中时抛 `InvalidCredentialError`（与契约声明一致）
- **R3-11-2 原行为**：UPDATE users 与 revokeAllUserTokens 是两个独立操作，撤销失败不回滚 UPDATE
- **R3-11-2 新行为**：UPDATE + token_version+1 包进同一事务，撤销失败自动回滚 UPDATE
- **签名**：不变
- **向后兼容性**：原依赖"activeRole 不在 roles 时降级到 roles[0]"的调用方需改为传入合法 activeRole。

### 二、数据契约变更

无（users 表结构未变化，仅服务层行为变更）

### 三、影响范围

- 调用 `updateUserRoles` / `selectActiveRole` / `revokeUserTokens` 的所有路由和服务
- 前端角色切换 UI（降级后需用新 token）
- 测试用例：原"activeRole 不在 roles 时降级"的断言需改为"抛错"

### 四、迁移说明

- 无需数据迁移
- 部署后立即生效（无存量数据兼容问题）

---

## [v4.18.0] - 2026-07-25 - 初始化向导（Setup Wizard）修复

> **变更类型**: MINOR（新增字段、新增接口；旧字段保留向后兼容）
> **决策来源**: `docs/plans/setup-wizard-fix-plan.md`（已通过影响评估 + 人类裁决批准）
> **依赖**: v4.17.0（多角色重构）必须先部署，本版本 users.roles/active_role 字段适配依赖 v4.17.0 migration

### 一、数据契约变更

#### 1.1 修改数据契约

- **`panel-api-types.ts`** —— 新增初始化向导相关类型（详见接口契约变更）

### 二、接口契约变更

#### 2.1 新增类型

- `InitStatusResponse` — GET /api/init/status 响应（旧接口显式化）
- `InitPreflightCheck` — 单项预检结果
- `InitPreflightResponse` — GET /api/init/preflight 响应（8 项检查）
- `PasswordPolicyResponse` — GET /api/auth/password-policy 响应（密码规则前端可见）
- `InitRequest` — POST /api/init 请求体（扩展：admin 对象 / mode / database_ack，旧 admin_password 保留向后兼容）
- `InitSubmitResponse` — POST /api/init 响应（扩展：admin_email / mode）

#### 2.2 新增接口存根

- `IPanelRestApi.getPasswordPolicy()` — GET /api/auth/password-policy（公开）
- `IPanelRestApi.getInitStatus()` — GET /api/init/status（公开，旧接口显式化）
- `IPanelRestApi.getInitPreflight()` — GET /api/init/preflight（公开）
- `IPanelRestApi.submitInit(req)` — POST /api/init（公开，签名扩展）

### 三、向后兼容性

- 旧 `admin_password` 字段保留，与 `admin.password` 等价
- 旧 `submitInit({ site_name, admin_password, enabled_packs })` 调用仍可工作
- 旧 `getInitStatus()` 返回 `{ needs_init: boolean }` 不变

### 四、影响范围

- 前端：`panel/frontend/src/api/client.ts`、`panel/frontend/src/pages/SetupWizard.tsx`
- 后端：`panel/backend/src/api/routes/settings.ts`、`panel/backend/src/api/routes/auth.ts`、`panel/backend/src/services/passwordPolicy.ts`、`panel/backend/src/services/initPreflightService.ts`（新建）、`panel/backend/src/db/seed.ts`、`panel/backend/src/index.ts`、`panel/backend/src/db/migrations/20260808000001_system_mode_and_preflight.ts`（新建）

---

## [v4.17.0] - 2026-07-25 - 统一绑定体系 + 多角色切换重构（方案C-激进重设计）

> **变更类型**: MAJOR（字段新增、表删除、类型扩展、配置契约新增）
> **决策来源**: `docs/plans/binding-unification-multi-role-plan.md` v1.1（已通过 GN-004 独立审查 + 人类裁决批准）
> **s0601 适配清单**: `.trae/documents/20260725_v4.17.0_契约变更适配清单.md`

### 一、数据契约变更

#### 1.1 新增数据契约

- **`bindings-schema.json`** —— 统一绑定数据契约。合并旧三套表（user_instance_bindings / player_bindings / player_verify_codes）为单一 bindings 表，通过 `binding_type` (account/player) + `scope_type` (instance/game_type/global) 多态引用。
- **`permission-points-schema.json`** —— 权限点字典。将原硬编码于 `permissions.ts` 的权限点提升为契约化定义，新增 30+ 权限点，覆盖实例/绑定/钱包/用户/系统五大类。
- **`role-permission-templates-schema.json`** —— 角色权限模板。定义 user / instance_admin / server_admin 三角色默认拥有的权限点集合。

#### 1.2 修改数据契约

- **`user-schema.json`** —— 多角色重构：
  - 新增 `roles` 字段（TEXT，JSON 数组字符串）：角色集合，支持多身份（如 `["user","instance_admin"]`）
  - 新增 `active_role` 字段（TEXT，NULLABLE）：当前活动角色（会话级）
  - `role` 字段标记 `@deprecated`（过渡期保留，等同 active_role），v4.18.0 物理删除
  - `required` 列表新增 `roles`；`active_role` 可空
- **`panel-api-types.ts`** —— 新增多角色 + 绑定统一 + 权限点 + Webhook 类型（见接口契约变更）

#### 1.3 标记废弃（保留至 v4.18.0 后删除）

- **`player-bindings-schema.json`** —— 已被 `bindings-schema.json` 取代，标记 `deprecated: true` + `x-deprecated-since: v4.17.0`

### 二、接口契约变更

#### 2.1 新增接口存根

- **`public/interface_stub/bindings.d.ts`** —— 统一绑定服务接口 `IBindingService`，覆盖 CRUD + verify + revoke + cleanup + 反查

#### 2.2 修改接口契约

- **`panel-api-types.ts`** 新增类型：
  - `UserRoles`（角色集合类型）
  - `Binding` / `BindingType` / `BindingScopeType` / `BindingVerifyStatus`（统一绑定）
  - `PermissionPoint` / `PermissionCategory` / `RolePermissionTemplate`（权限矩阵）
  - `WebhookEvent` / `WebhookEventType` / `WebhookEventPayload`（事件订阅）
  - `CreateBindingRequest` / `ListBindingsQuery` / `VerifyBindingRequest` / `VerifyBindingViaWebhookRequest` 等请求响应类型
  - `SelectRoleRequest` / `SelectRoleResponse`（角色切换）
  - `ListUserRolesResponse` / `UpdateUserRolesRequest` / `UpdateUserRolesResponse`（多角色管理）
  - `RevokeUserTokensResponse`（令牌吊销）
- **`panel-api-types.ts`** 修改类型：
  - `UserInfo` 新增 `roles?: UserRoles` / `active_role?: UserRole`
  - `AdminUserSummary` 新增 `roles?: UserRoles` / `active_role?: UserRole`
  - `role` 字段标记 `@deprecated v4.17.0`（过渡期保留，v4.18.0 删除）
- **`panel-api-types.ts`** 废弃类型：
  - `UpdateUserRoleRequest` 标记 `@deprecated v4.17.0`，替换为 `UpdateUserRolesRequest`
  - `PlayerBindingSummary` 标记 `@deprecated v4.17.0`，替换为 `Binding`

### 三、配置契约变更

新增三个配置契约（位于 `public/config_template/`）：

- **`binding.config.schema.json`** —— 绑定流程可调参数（验证码 TTL/长度/锁定时长/格式正则等）
- **`permission.config.schema.json`** —— 权限系统可调参数（缓存 TTL/容量/预热/失败策略）
- **`webhook.config.schema.json`** —— Webhook 安全可调参数（HMAC 算法/签名头/时间窗口/nonce 缓存）

### 四、Mock 与测试套件

#### 4.1 新增 Mock（`public/pre_generated_mock/`）

- `bindings.ts` —— 绑定服务 Mock（覆盖 verified/pending/expired/revoked 四态）
- `permission-service.ts` —— 权限服务 Mock（覆盖三角色）
- `auth-service.ts` —— 认证服务 Mock（多角色登录分叉 + select-role 流程）
- `webhook-receiver.ts` —— Webhook 接收 Mock（签名校验通过/失败场景）

#### 4.2 新增测试套件（`public/test_cases/`）

- `bindings-contract.test.ts` —— 数据契约测试（~30 用例）
- `permission-points-contract.test.ts` —— 权限点契约测试（~10 用例）
- `role-permission-templates-contract.test.ts` —— 角色权限模板测试（~15 用例）
- `bindings-api-contract.test.ts` —— 接口契约测试（~20 用例）
- `config-contract.test.ts` —— 配置契约测试（~15 用例）

### 五、影响范围与下游适配

| 影响层级 | 涉及模块 | 适配动作 |
|---------|---------|---------|
| **BLOCK（必须立即阻断）** | panel/backend permissions.ts / auth/roles.ts / users 路由 | 升级为多角色 + 权限点矩阵；登录签发新 JWT；旧 JWT 通过 token_version 黑名单失效 |
| **BLOCK** | panel/backend verifyCodes.ts / playerBindings.ts 路由 | 废弃，迁移到统一 binding-service |
| **BLOCK** | 数据库 migrations 目录 | 新增 20260725 bindings 表 + users 多角色字段迁移脚本（含数据搬运） |
| **BLOCK** | daemon 端 chat 事件订阅 | 替代游戏内 `!verify` 命令消费 |
| **SYNC（必须同步更新）** | panel/frontend /guild 首页 | 重做信息架构，移除重复绑定入口 |
| **SYNC** | panel/frontend /guild/profile 页 | 移除游戏内绑定验证码卡片 |
| **SYNC** | panel/frontend /guild/bind 流程 | 改为引导式绑定，区分账户级/玩家级 |
| **SYNC** | panel/frontend 工作台切换 UI | 新增 active_role 选择器 |
| **DEFER（可延后复核）** | 现有 demo 模式种子数据 | 隔离保护，不参与迁移 |
| **DEFER** | 旧 `role` 字段物理删除 | 推迟到 v4.18.0 |

### 六、回退锚点

- 迁移前 DB 全量备份：`/opt/gameserver-panel/data/backup/pre-v4.17.0-<timestamp>.db`
- 回滚脚本：`migrations/20260725_rollback_unified_binding.ts`
- 失败回退点：迁移脚本任一步骤失败 → 立即回滚到备份 DB + 保留旧表 schema

---

## [v4.11.0] - 商业化重构契约基线
- **版本号**: v4.11.0
- **变更内容**:
  1. 新增 `GlobalAsset` 与 `InstanceAsset` 数据结构契约。
  2. 新增 `asset_interfaces.d.ts` 接口存根。
  3. 新增 `commercial_config.schema.json` 商业化配置契约。
  4. 新增 `error_codes.json` 全局商业化错误码。
- **变更原因**: 从“运维管理面板”向“B2B2C游戏私服商业化 SaaS 平台”转型，建立全局模板与局部重写（Template & Override）的数据与接口基础边界。
- **影响范围**:
  - Panel 后端：需新增 AssetService 和相应的路由/中间件。
  - Panel 前端：需新增商城管理面板及渲染层合并逻辑。
  - Daemon 节点端：需引入沙箱机制执行 `executeLogic`。