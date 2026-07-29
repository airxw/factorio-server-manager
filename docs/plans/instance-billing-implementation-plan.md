---
type: plan
title: 实例计费规则落地实施计划（VPS 式 v3）
date: 2026-07-29
status: draft
related: instance-billing-rules-plan.md
tags: [billing, plan, implementation, vps-prepaid]
---

# gsp 实例计费规则落地实施计划（VPS 式 v3）

> 本计划是 [instance-billing-rules-plan.md](./instance-billing-rules-plan.md)（VPS 式简化定稿）的**执行编排文档**，不重复方案设计，仅输出模块拆分、依赖 DAG、并行组、subagent 执行台账与闭合判据。
>
> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 工程过程（锚点文档三段交接 §1）

### 0.1 已完成的前置核查（按顺序）

1. **方案 draft 完整性核查**：方案 §0-§10 + 附录 A/B 完整，§10 未闭合项 6 条全部已决或已核实，无阻塞性开放项。
2. **契约层就绪度核查**（2026-07-29）：
   - `public/schema/instance-type-pricing-schema.json` ✓ 已存在且字段完整
   - `public/schema/instance-billing-settings-schema.json` ✓ 已存在且字段完整
   - `public/schema/instance-renewals-schema.json` ✓ 已含 `billing_cycle_months` / `instance_type_snapshot` 字段，`renewal_type` enum 已含 `'auto'`
   - `public/schema/server-schema.json` ✓ 已含 `billing_type` 字段
   - `public/interface_stub/instance-billing-service.d.ts` ✓ 完整（含 12 个方法签名 + 3 个结果类型 + 7 个异常类导出）
   - `public/interface_stub/instance-expiry-service.d.ts` ✓ 完整（含 renewInstance 路由分流到 instanceBillingService 的契约说明）
   - `public/interface_stub/shared-types.d.ts` ✓ 已含全部相关类型：`InstanceType` / `BillingCycleMonths` / `InstanceTypePricing` / `InstanceBillingSettings` / `BillingExemptReason` / `InstanceRenewal` / `InstanceRenewalType` / `InstanceExpiryStatus` + 7 个异常类
3. **数据层就绪度核查**：
   - `global_balances` ✓（migration `20260727000001_create_global_balances.ts`）
   - `wallet_transactions` ✓（migration `20260727000007_create_wallet_transactions.ts`）
   - `instance_pricing` ✓（migration `20260727000005_create_instance_pricing.ts`，玩家消费侧，非 VPS 月费）
   - `instance_renewals` ✗ **零实现**（baseline migration `20260808000000` 不含此表）
   - `instance_type_pricing` ✗ **零实现**
   - `instance_billing_settings` ✗ **零实现**
   - `servers.billing_type` 字段 ✗ **未添加**
4. **服务层就绪度核查**：
   - `balanceService.ts` ✓ 已存在（含 debit/credit/freeze/unfreeze，原子 UPDATE 防并发超扣），但 `WalletTxType` 枚举**未含 `'instance_billing'`** → 需扩展
   - `instanceBillingService.ts` ✗ **零实现**（需新建）
   - `instanceRenewalService.ts` ✗ **零实现**（方案 §8.3 写"扩展"，实际无此文件 → 改为新建）
   - `instanceExpiryService.ts` ✗ **零实现**（方案 §8.3 写"扩展"，实际无此文件 → 改为新建）
   - `rechargeCdkService.ts` ✗ **零实现**（方案 §8.3 已标注零实现）
5. **路由层就绪度核查**：
   - 路由平铺在 `panel/backend/src/api/routes/`，无 `admin/` 子目录
   - 路由聚合器 `panel/backend/src/routes-registry.ts` 已存在，模式为 `app.use('/api/...', authenticateToken(JWT_SECRET), createXxxRouter(...))`
   - 现有 `/api/admin/*` 命名风格（cleanup/maintenance 等）已建立，新路由对齐此风格
6. **调度层就绪度核查**：
   - `panel/backend/src/services/scheduler.ts` ✓ 已实现（支持 interval_ms / next_run_at / cron_expr 三模式）
   - `panel/backend/src/scheduler-init.ts` ✓ 已存在，已注册大量类似任务（CDK_REFUND_SCAN / WITHDRAW_EXPIRE_SCAN / VIP_SUBSCRIPTION_SCAN 等）
   - 无 `INSTANCE_AUTO_RENEWAL` / `INSTANCE_BILLING_ALERT` 任务 → 需新增
7. **前端层就绪度核查**：
   - `panel/frontend/src/pages/store/components/InstanceEconomyConfig.tsx` ✓ 已存在（玩家消费侧定价，非 VPS 月费）
   - VPS 计费相关页面 ✗ 全部零实现

### 0.2 关键修正（与方案 §8.3 不一致处）

| 方案 §8.3 原文 | 实际状态 | 修正动作 |
|---------------|---------|---------|
| "扩展 `instanceService.ts`：createInstance 流程接入计费" | `instanceService.ts` 不存在；实例创建逻辑在 `panel/backend/src/api/routes/servers.ts` 的 POST `/api/servers` 处理器内 | 改为"扩展 `servers.ts` 路由的 createInstance 处理器" |
| "扩展 `instanceRenewalService.ts`" | 文件零实现 | 改为"新建 `instanceRenewalService.ts`" |
| "扩展 `instance-expiry-service.ts`" | 文件零实现 | 改为"新建 `instanceExpiryService.ts`" |
| "扩展 `instance-expiry-service.ts`：新增 `assertInstanceNotExpired` 守卫方法" | `instance-expiry-service.d.ts` 契约中**未定义** `assertInstanceNotExpired` 方法 | 守卫逻辑下放到 `instanceBillingService.isBillingExempt` 或在 `servers.ts` 启动路由内联；不修改已冻结的 public/ 契约 |
| WalletTxType 枚举扩展 `'instance_billing'` | `balanceService.ts:26-43` 的 `WalletTxType` 未含此值 + DB CHECK 约束未含此值 | 在模块A（契约验证与补全层）扩展 `balanceService.ts` 的 `WalletTxType` 枚举（属于对已存在基础服务的补全范畴）+ 在模块B（数据层）扩展 DB `wallet_transactions.type` CHECK 约束 |

### 0.3 当前交接状态

- **当前 task**：模块拆分与编排（s0203）
- **状态**：已闭合（模块拆分表、依赖 DAG、并行组、回退锚点、执行台账均已明确）
- **下一步**：人类审批本计划 → 进入 S4 并行开发

### 0.4 产出物清单

本计划文档产出物：

1. 本计划文档本身：`docs/plans/instance-billing-implementation-plan.md`
2. 模块拆分表（§1）：9 个模块的职责/输入/输出/依赖定义
3. 依赖 DAG（§2.1）：树形依赖图 + 模块G 依赖关系说明
4. 并行组编排（§2.2）：7 个 Wave 的串行/并行模式 + 失败回退锚点
5. subagent 执行台账（§4）：10 行台账（9 个模块 + 1 个交付前审查）
6. 闭合判据表（§5）：9 个模块的运行时接入校验类型与 grep/curl 验证命令
7. 未闭合项清单（§7）：5 项待核实/暂缓项
8. 风险提示（§6.3）：5 项风险与保护策略

本计划不产生代码，仅为执行编排文档。代码产出在各模块执行阶段生成。

---

## 1. 模块拆分表

> 命名规则：`模块N_中文名`（N 从 0 递增，表达依赖顺序）。所有模块跨模块协作仅通过 `public/` 契约或显式暴露的稳定边界完成，禁止跨模块直连内部实现。

| 模块 | 中文名 | 职责 | 输入 | 输出 | 依赖 |
|------|--------|------|------|------|------|
| 模块A | 契约验证与补全 | 验证 public/ 契约完整性 + 补生成 pre_generated_mock + 扩展 balanceService.WalletTxType 枚举 | 现有 public/schema、interface_stub、balanceService.ts | mock 文件、WalletTxType 扩展、契约验证报告 | 无（基础层） |
| 模块B | 数据层迁移 | 新建 5 个 migration + 1 个 seed：instance_renewals 建表 + instance_type_pricing 建表 + instance_billing_settings 建表 + servers.billing_type 加列 + wallet_transactions.type CHECK 扩展 | 模块A 的契约定义 | migration 文件、seed 数据 | 模块A |
| 模块C | 计费核心服务 | 新建 instanceBillingService.ts：calculateAmount / isBillingExempt / chargeInstanceCreation / chargeInstanceRenewal / autoRenewInstance / scanAndAutoRenew / upsertTypePricing / archiveTypePricing / getOrCreateBillingSettings / updateBillingSettings / listActiveTypePricings / getTypePricing | 模块A 契约 + 模块B 表 + balanceService | instanceBillingService.ts | 模块A、模块B |
| 模块D | 有效期与续费服务 | 新建 instanceExpiryService.ts（含 renewInstance 路由分流到 instanceBillingService）+ 新建 instanceRenewalService.ts（续费记录查询） | 模块A 契约 + 模块B 表 + 模块C instanceBillingService | instanceExpiryService.ts、instanceRenewalService.ts | 模块A、模块B、模块C |
| 模块E | 腐竹直充服务 | 新建 rechargeCdkService.ts：redeemRechargeCdk / createAdminRechargeOrder（依赖现有 recharge_cdks 表与 balanceService.credit） | 模块A 契约 + balanceService | rechargeCdkService.ts | 模块A（独立于 C/D） |
| 模块F | 路由层 | 新建 instance-billing.ts 路由（types CRUD / settings get-put / renew / 直充端点）+ 挂载到 routes-registry.ts + 扩展 servers.ts createInstance 接入计费 | 模块C、模块D、模块E 服务 | instance-billing.ts 路由 + 挂载点 + servers.ts 修改 | 模块C、模块D、模块E |
| 模块G | 调度任务 | 在 scheduler-init.ts 注册 INSTANCE_AUTO_RENEWAL（每日 03:00）+ INSTANCE_BILLING_ALERT（每日 09:00）任务，注入 instanceBillingService.scanAndAutoRenew | 模块C instanceBillingService | scheduler-init.ts 修改 | 模块C |
| 模块H | 前端层 | 腐竹端"实例计费"页面 + 系统管理端"类型定价配置"页面 + 实例创建表单加入类型选择 + 实例详情页计费状态展示 | 模块F API | 前端页面 + 路由 | 模块F |
| 模块I | 测试层 | 单测（calculateAmount / isBillingExempt 全路径）+ E2E（创建→扣款→续费→到期→自动续扣→欠费→恢复全链路）+ Mock 回归 | 模块C、D、F、H | 测试文件 + 测试报告 | 模块C、模块D、模块F、模块H |

### 1.1 `public/` 共享边界说明

- **已冻结契约（本计划不修改）**：
  - `public/schema/instance-type-pricing-schema.json`
  - `public/schema/instance-billing-settings-schema.json`
  - `public/schema/instance-renewals-schema.json`
  - `public/schema/server-schema.json`
  - `public/interface_stub/instance-billing-service.d.ts`
  - `public/interface_stub/instance-expiry-service.d.ts`
  - `public/interface_stub/shared-types.d.ts` 中相关类型与异常类
- **模块A 可写**：`public/pre_generated_mock/instance-billing-mock.ts`、`public/pre_generated_mock/instance-expiry-mock.ts`（如缺失则生成）
- **跨模块协作约束**：模块 D 的 `instanceExpiryService.renewInstance` 调用模块 C 的 `instanceBillingService.chargeInstanceRenewal`，必须通过 import 公开导出的类方法，不得直接读对方私有状态。

---

## 2. 依赖 DAG 与并行编排

### 2.1 依赖 DAG

```
模块A (契约验证与补全)
  │
  ▼
模块B (数据层迁移)
  │
  ├──────────────┐
  ▼              ▼
模块C (计费核心服务)  模块E (腐竹直充服务)
  │              │
  ├──┐           │
  ▼  ▼           │
模块D 模块G       │   (G 依赖 C，不依赖 F；与 H 在 Wave 5 并行启动)
  │  │           │
  └──┴───────────┘   (D + E 汇入 F)
         │
         ▼
模块F (路由层)
         │
         ▼
模块H (前端)
         │
         ▼
模块I (测试层) ◄── 模块G (G + H 汇入 I)
```

> **依赖说明**：模块G 依赖模块C（已完成即可启动），不依赖模块F。Wave 5 让 G 与 H 并行启动是为了编排便利（G 可在 Wave 2 完成后即启动，但为减少并行分支管理复杂度，统一在 Wave 5 与 H 同批启动）。

### 2.2 并行组与串行顺序

> 当前环境无 `parallel-sub-agent` 专用 subagent_type，统一用 `general_purpose_task` 承载（prompt 注入并行/隔离要求）。单批并行上限 2，全局并行上限 3。

| Wave | 模块 | 模式 | 并行理由 | 失败回退锚点 |
|------|------|------|---------|-------------|
| Wave 0 | 模块A | 串行 | 契约基础层，下游全部依赖 | 回退到方案 §8.1 重新核对契约 |
| Wave 1 | 模块B | 串行 | 数据层，下游服务的表必须先存在 | 回退到模块A，重新核对 schema 与 migration 对齐 |
| Wave 2 | 模块C | 串行 | 核心服务，模块D 强依赖其 instanceBillingService 实例 | 回退到模块A/B，重新实现服务 |
| Wave 3 | `[P]` 模块D + 模块E | **并行（2 分支）** | D 依赖 C 已完成；E 独立于 C/D，仅依赖 A 的契约与 balanceService。两分支无共享可变状态，可隔离开发 | D 失败→回退到模块C；E 失败→回退到模块A |
| Wave 4 | 模块F | 串行 | 路由层需聚合 C/D/E 三个服务 | 回退到对应服务模块 |
| Wave 5 | `[P]` 模块G + 模块H | **并行（2 分支）** | G 依赖 C（已完成）；H 依赖 F（已完成）。G 是后端调度注册，H 是前端页面，互不污染 | G 失败→回退到模块C；H 失败→回退到模块F |
| Wave 6 | 模块I | 串行 | 测试需覆盖全部上游模块 | 回退到对应缺陷模块 |

### 2.3 失败回退总锚点

- **整体回退点**：模块B（数据层迁移）—— 若 migration 失败或破坏存量数据，立即停止所有下游模块，回退到模块B 重新设计 migration。
- **不可逆操作保护**：所有 migration 必须先在测试库验证，确认 `down()` 回滚可用后再合流。`servers.billing_type` 字段添加不得自动设置存量实例为 `'vps_prepaid'`（保持 null 兼容）。

---

## 3. 执行步骤（按 Wave 顺序）

> 不区分优先级，按依赖顺序输出。每个模块的执行步骤对齐方案 §8.1-§8.7。

### 3.1 Wave 0：模块A_契约验证与补全

1. 读取并验证 `public/schema/instance-type-pricing-schema.json` 字段完整性（对齐方案 §2.1）
2. 读取并验证 `public/schema/instance-billing-settings-schema.json` 字段完整性（对齐方案 §2.2）
3. 读取并验证 `public/schema/instance-renewals-schema.json` 已含 `billing_cycle_months` / `instance_type_snapshot`
4. 读取并验证 `public/schema/server-schema.json` 已含 `billing_type`
5. 读取并验证 `public/interface_stub/instance-billing-service.d.ts` 12 个方法签名齐备
6. 读取并验证 `public/interface_stub/instance-expiry-service.d.ts` 含 `renewInstance` 路由分流契约
7. 读取并验证 `public/interface_stub/shared-types.d.ts` 含全部相关类型与异常类
8. 检查 `public/pre_generated_mock/` 是否有 `instance-billing-mock.ts` / `instance-expiry-mock.ts`，缺失则按 s0202 规范生成
9. 扩展 `panel/backend/src/services/balanceService.ts` 的 `WalletTxType` 枚举，追加 `'instance_billing'`（注意：此非 public/ 契约修改，是服务层枚举扩展，public/AGENTS.md 不限制）
10. 编写契约验证报告（写入 `.trae/documents/instance-billing-contract-verification.md`）

### 3.2 Wave 1：模块B_数据层迁移

1. 新建 migration `create_instance_renewals.ts`（schema 对齐 `instance-renewals-schema.json`，含 v-economy 扩展字段 `wallet_source` / `admin_tier_discount_applied` / `node_source_at_renewal` + v3-billing 字段 `billing_cycle_months` / `instance_type_snapshot`）
2. 新建 migration `create_instance_type_pricing.ts`（含 `UNIQUE(instance_type) WHERE status='active'` 索引）
3. 新建 migration `create_instance_billing_settings.ts`（含 `UNIQUE(instance_id)` 约束）
4. 新建 migration `alter_servers_add_billing_type.ts`（加 `billing_type` 字段，默认 null，**不自动填充存量实例**）
5. 新建 migration `alter_wallet_transactions_type_check_add_instance_billing.ts`（扩展 `wallet_transactions.type` CHECK 约束追加 `'instance_billing'`）
6. 编写 seed `seed_instance_type_pricing.ts`（5 种类型初始定价：micro 1500 / small 3000 / medium 9000 / large 24000 / xlarge 60000，折扣 0.95/0.90/0.80）
7. 在测试库执行 migration up + down 验证可回滚
8. 执行 seed 验证数据正确

### 3.3 Wave 2：模块C_计费核心服务

1. 新建 `panel/backend/src/services/instanceBillingService.ts`，实现 `InstanceBillingService` 接口的 12 个方法：
   - 定价查询：`listActiveTypePricings` / `getTypePricing` / `upsertTypePricing` / `archiveTypePricing`
   - 计费设置：`getOrCreateBillingSettings` / `updateBillingSettings`
   - 金额计算（纯函数）：`calculateAmount`
   - 免计费判定：`isBillingExempt`
   - 计费操作（有副作用）：`chargeInstanceCreation` / `chargeInstanceRenewal` / `autoRenewInstance` / `scanAndAutoRenew`
2. 扣款链路：调用 `balanceService.debit(fuzhu_user_id, amount, 'instance_billing', instance_id)` + `balanceService.credit(admin_user_id, amount, 'instance_billing', instance_id)`
3. 并发安全：依赖 `balanceService.debit` 已实现的原子 `UPDATE ... WHERE (balance - frozen_balance) >= amount`，无需额外行锁
4. 系统管理员 user_id 解析：从 `system_config` 或 `users` 表查询 `roles` 含 `system_admin` 的 user（缓存避免每次查询）
5. 单测：`calculateAmount` 全路径（5 类型 × 4 周期 × 自定义价格覆盖）+ `isBillingExempt` 3 路径优先级
6. 在 `panel/backend/src/services-init.ts` 注册 `instanceBillingService` 到 `ServiceContainer`

### 3.4 Wave 3：`[P]` 模块D + 模块E 并行

#### 3.4.1 模块D_有效期与续费服务（并行分支 1）

1. 新建 `panel/backend/src/services/instanceExpiryService.ts`，实现 `InstanceExpiryService` 接口：
   - `setInstanceExpiry` / `getInstanceExpiry`
   - `scanExpiringInstances` / `processExpiredInstances` / `processGraceExpiredInstances` / `cleanupExpiredInstances` / `sendExpiryReminders`
   - `renewInstance`（**关键路由分流**：`servers.billing_type='vps_prepaid'` → 委托 `instanceBillingService.chargeInstanceRenewal`；`billing_type=null` → 走 V6 全可配定价流程）
   - `listRenewals` / `getExpiryConfig`
2. 过期停止实例：调用 `daemonClient.stopInstance` 或现有等效接口
3. 启动守卫：在 `servers.ts` 的 POST `/api/servers/:id/start` 处理器内联守卫逻辑——`billing_type='vps_prepaid'` 且 `expiry_status ∈ {grace, expired}` 时返回 409/402
4. 新建 `panel/backend/src/services/instanceRenewalService.ts`：`listRenewals(serverId)` 查询 `instance_renewals` 表
5. 在 `services-init.ts` 注册 `instanceExpiryService` / `instanceRenewalService`

#### 3.4.2 模块E_腐竹直充服务（并行分支 2）

1. 新建 `panel/backend/src/services/rechargeCdkService.ts`：
   - `redeemRechargeCdk(user_id, cdk_code)`：校验 `recharge_cdks` 表 → 调用 `balanceService.credit(userId, amount, 'cdk_recharge', cdk_id)` → 标记 CDK 已兑换
   - `createAdminRechargeOrder(user_id, amount, order_no)`：管理员订单号充值 → 调用 `balanceService.credit(userId, amount, 'admin_credit', order_id)`
2. 依赖现有 `recharge_cdks` 契约（`public/schema/recharge-cdks-schema.json`）
3. 在 `services-init.ts` 注册 `rechargeCdkService`

### 3.5 Wave 4：模块F_路由层

1. 新建 `panel/backend/src/api/routes/instance-billing.ts`，导出 `createInstanceBillingRouter` 工厂：
   - `GET /api/admin/instance-billing/types`（listActiveTypePricings，任意已登录用户可读）
   - `POST /api/admin/instance-billing/types`（upsertTypePricing，仅 system_admin）
   - `DELETE /api/admin/instance-billing/types/:instance_type`（archiveTypePricing，仅 system_admin）
   - `GET /api/admin/instance-billing/settings/:instance_id`（getOrCreateBillingSettings，腐竹可读自己的实例，system_admin 可读任意）
   - `PUT /api/admin/instance-billing/settings/:instance_id`（updateBillingSettings，腐竹可改自己的实例，system_admin 可改任意）
   - `POST /api/admin/instance-billing/renew/:instance_id`（chargeInstanceRenewal，腐竹续费自己的实例）
   - `POST /api/admin/instance-billing/recharge-cdk`（redeemRechargeCdk，腐竹直充）
   - `POST /api/admin/instance-billing/recharge-order`（createAdminRechargeOrder，仅 system_admin）
2. 在 `routes-registry.ts` 挂载：`app.use('/api/admin/instance-billing', authenticateToken(JWT_SECRET), createInstanceBillingRouter(...))`
3. 扩展 `panel/backend/src/api/routes/servers.ts` 的 POST `/api/servers` 处理器：在实例创建流程中接入 `instanceBillingService.chargeInstanceCreation`（预扣款 → 失败回滚）
4. 扩展 `servers.ts` 的 POST `/api/servers/:id/start` 处理器：内联 `expiry_status` 守卫
5. 扩展 `servers.ts` 的 POST `/api/servers/:id/renew` 处理器：调用 `instanceExpiryService.renewInstance`（已含路由分流）
6. 新增 GET `/api/servers/:id/renewals` 路由：调用 `instanceRenewalService.listRenewals`

### 3.6 Wave 5：`[P]` 模块G + 模块H 并行

#### 3.6.1 模块G_调度任务（并行分支 1）

1. 在 `panel/backend/src/scheduler-init.ts` 注册 `INSTANCE_AUTO_RENEWAL` 任务（cron `0 3 * * *`，每日 03:00），executor 调用 `instanceBillingService.scanAndAutoRenew()`
2. 在 `scheduler-init.ts` 注册 `INSTANCE_BILLING_ALERT` 任务（cron `0 9 * * *`，每日 09:00），executor 扫描自动续扣失败的实例，写告警日志 + 调用 `notificationService` 通知腐竹
3. 在 `panel/backend/src/services/scheduler.ts` 顶部常量区追加 `INSTANCE_AUTO_RENEWAL` / `INSTANCE_BILLING_ALERT` 常量

#### 3.6.2 模块H_前端层（并行分支 2）

1. 新建腐竹端"实例计费"页面 `panel/frontend/src/pages/InstanceBilling.tsx`：
   - 类型选择卡片（micro/small/medium/large/xlarge，展示资源建议与月费）
   - 周期选择（月/季/半年/年）+ 实时价格预览（调用 `calculateAmount` 等价前端计算或后端预览接口）
   - 续费按钮 + 当前余额展示
   - 计费记录列表（查询 `GET /api/servers/:id/renewals`）
   - 自动续扣开关（调用 `PUT /api/admin/instance-billing/settings/:instance_id`）
2. 新建系统管理端"类型定价配置"页面 `panel/frontend/src/pages/admin/InstanceTypePricing.tsx`：
   - 5 种类型的月费 / 折扣配置表单
   - 启用/归档操作
3. 在实例创建表单（`panel/frontend/src/pages/admin/ServersCreate.tsx` 或等效）中加入类型选择与价格预览
4. 在实例详情页（`panel/frontend/src/pages/ServerDetail.tsx`）展示计费状态（有效期、到期时间、自动续扣开关）
5. 在前端路由表中注册新页面
6. 前端 API 查询层：在 `panel/frontend/src/api/queries/` 新建 `instanceBilling.ts`（react-query hooks）

### 3.7 Wave 6：模块I_测试层

1. 单元测试（s0402 第一重）：
   - `instanceBillingService.calculateAmount`：5 类型 × 4 周期 × {无覆盖, 自定义覆盖} = 40 用例
   - `instanceBillingService.isBillingExempt`：3 路径优先级（billing_exempt > self_hosted > owner_self）
   - `instanceBillingService.chargeInstanceCreation`：余额充足 / 余额不足 / 豁免 / 回滚
   - `instanceBillingService.chargeInstanceRenewal`：未过期叠加 / 已过期从现在起算 / 豁免
   - `instanceBillingService.autoRenewInstance`：成功 / 余额不足告警 / 豁免
2. E2E 测试（s0402 第二重）：
   - 全链路：创建实例→扣款→续费→到期→自动续扣→欠费→恢复
   - 路由鉴权：腐竹只能操作自己实例 / system_admin 可操作任意 / user 拒绝
3. Mock 回归（s0402 第三重）：
   - 前端计费页面在 Mock 模式下渲染验证
   - 类型定价配置页面 Mock 模式回归

---

## 4. subagent 执行台账

> 根据 rules-0 §四-11，所有涉及 subagent 调度的模块必须登记台账。当前环境统一用 `general_purpose_task` 承载并行/审查能力。

| 阶段标签 | `[P]`组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|--------|---------------|---------|------------------|---------|-----------|------|
| Wave 0 模块A | — | general_purpose_task | 契约验证报告 + mock 文件 + WalletTxType 扩展 | 主线程（非subagent） | `.trae/documents/instance-billing-contract-verification.md` | 方案 §8.1 | 已完成 |
| Wave 1 模块B | — | general_purpose_task | 5 个 migration + 1 个 seed | 主线程（非subagent） | `panel/backend/src/db/migrations/` | 模块A | 已完成 |
| Wave 2 模块C | — | general_purpose_task | instanceBillingService.ts + 单测 | 待回填 | `panel/backend/src/services/instanceBillingService.ts` | 模块A/B | 待启动 |
| Wave 3 模块D | `[P]` 组1 | general_purpose_task | instanceExpiryService.ts + instanceRenewalService.ts | 待回填 | `panel/backend/src/services/instanceExpiryService.ts` | 模块C | 待启动 |
| Wave 3 模块E | `[P]` 组1 | general_purpose_task | rechargeCdkService.ts | 待回填 | `panel/backend/src/services/rechargeCdkService.ts` | 模块A | 待启动 |
| Wave 4 模块F | — | general_purpose_task | instance-billing.ts 路由 + servers.ts 修改 + 挂载点 | 待回填 | `panel/backend/src/api/routes/instance-billing.ts` | 模块C/D/E | 待启动 |
| Wave 5 模块G | `[P]` 组2 | general_purpose_task | scheduler-init.ts + scheduler.ts 修改 | 待回填 | `panel/backend/src/scheduler-init.ts` | 模块C | 待启动 |
| Wave 5 模块H | `[P]` 组2 | general_purpose_task | 前端页面 + 路由 + API 查询层 | 待回填 | `panel/frontend/src/pages/InstanceBilling.tsx` | 模块F | 待启动 |
| Wave 6 模块I | — | general_purpose_task | 单测 + E2E + Mock 回归报告 | 待回填 | `panel/backend/src/services/instanceBillingService.test.ts` | 对应缺陷模块 | 待启动 |
| 交付前审查 | — | general_purpose_task | 独立审查报告（GN-004） | 待回填 | `.trae/documents/instance-billing-gn004-review.md` | — | 待启动 |

**lineage 规则**：同阶段重开时，新的 `actual agent id` 必须保留前驱 ID 作为 `previous_id`，台账中追加 `retry_count` 和 `failure_reason`。

**未保护上下文隔离**：Wave 3 的 D/E 分支、Wave 5 的 G/H 分支启动时，仅传递受保护上下文（已冻结契约 + 已闭合的模块产出），不传递当前会话的实时调试信息或未闭合判断。

---

## 5. 闭合判据

> 根据 rules-0 §四-13 运行时接入闭合判据，每个模块闭合需满足"运行时接入校验"四者至少其一。

| 模块 | 闭合判据 | 运行时接入校验类型 |
|------|---------|------------------|
| 模块A | 契约验证报告生成 + `tsc --noEmit` 通过 + mock 文件可被 import | 被上游调用方引用（`grep -rn "instance-billing-mock\|instance-expiry-mock" panel/backend/src/ public/pre_generated_mock/` 可查） |
| 模块B | migration up/down 验证通过 + seed 数据正确 + `tsc --noEmit` 通过 | 被上游调用方引用（表被服务层 SELECT，`grep -n "instance_renewals\|instance_type_pricing\|instance_billing_settings" panel/backend/src/services/` 可查） |
| 模块C | `instanceBillingService` 12 个方法全部实现 + 单测 PASS + 在 `services-init.ts` 注册 | 被上游调用方引用（`grep -n "instanceBillingService" panel/backend/src/services-init.ts` + `grep -rn "from.*instanceBillingService" panel/backend/src/` 可查） |
| 模块D | `instanceExpiryService` 全部方法实现 + `renewInstance` 路由分流逻辑正确 + 在 `services-init.ts` 注册 | 被上游调用方引用（`grep -n "instanceExpiryService" panel/backend/src/services-init.ts` + `grep -rn "from.*instanceExpiryService" panel/backend/src/` 可查） |
| 模块E | `rechargeCdkService` 2 个方法实现 + 在 `services-init.ts` 注册 | 被上游调用方引用（`grep -n "rechargeCdkService" panel/backend/src/services-init.ts` + `grep -rn "from.*rechargeCdkService" panel/backend/src/` 可查） |
| 模块F | 路由挂载到 `routes-registry.ts` + `curl /api/admin/instance-billing/types` 返回 200 | **路由注册**（`grep -n "instance-billing" panel/backend/src/routes-registry.ts` 可查） |
| 模块G | `INSTANCE_AUTO_RENEWAL` / `INSTANCE_BILLING_ALERT` 在 `scheduler-init.ts` 注册 + 启动后任务列表可查 | **事件总线订阅 / 调度注册**（`grep -n "INSTANCE_AUTO_RENEWAL" panel/backend/src/scheduler-init.ts` 可查） |
| 模块H | 前端页面渲染 + 路由表注册 + API 查询层 hooks 可用 + Mock 模式回归 PASS | 路由注册（`grep -rn "InstanceBilling" panel/frontend/src/pages/ panel/frontend/src/router` 可查） |
| 模块I | 单测 PASS + E2E PASS + Mock 回归 PASS + 测试报告生成 | **测试层豁免运行时接入校验**（闭合判据为测试 PASS，不强制满足四者之一；测试层本身是校验者而非被接入者） |

**孤岛判定**：仅有"文件存在 + 单测通过 + build 通过"而未满足上述运行时接入条件者，判定为孤岛代码，不得标记已闭合，禁止合流。

---

## 6. 开发事项与建议

### 6.1 关键开发事项

1. **WalletTxType 枚举扩展是跨层操作**：`balanceService.ts` 的 `WalletTxType` 类型 + DB `wallet_transactions.type` CHECK 约束必须同步扩展，否则扣款时写入流水会抛 CHECK 约束错误。
2. **instanceExpiryService.renewInstance 的路由分流是核心契约**：必须严格按 `instance-expiry-service.d.ts` 第 111-116 行的契约实现——`billing_type='vps_prepaid'` 委托 `instanceBillingService.chargeInstanceRenewal`，`billing_type=null` 走 V6 全可配定价流程。两条路径不可混淆。
3. **存量实例兼容**：`servers.billing_type` 字段添加时**不得自动填充**存量实例为 `'vps_prepaid'`，保持 null 表示"未接入计费"，避免存量实例被错误计费或被启动守卫拦截。
4. **扣款失败回滚**：创建实例时若 `balanceService.debit` 成功但实例创建失败，必须 `balanceService.credit` 退款，否则腐竹余额被错误扣减。
5. **自动续扣失败不立即停机**：余额不足时仅记录告警日志，等 `expires_at` 到达后由过期状态机处理，避免频繁扣款失败导致实例抖动。
6. **duration_days 换算**：统一按 30 天/月换算（`billing_cycle_months × 30`），与现有 `instance_renewals.duration_days` 逻辑兼容。`days_per_month` 由 `system_config.instance.billing.days_per_month` 配置，默认 30。
7. **系统管理员 user_id 解析**：扣款收款方是"管理员 global_balances"，需明确是哪个 system_admin 用户。建议从 `system_config.billing.admin_user_id` 读取，缺失时 fallback 到 `users` 表第一个 `roles` 含 `system_admin` 的 user，结果缓存。

### 6.2 建议

1. **前端价格预览**：`calculateAmount` 是纯函数，建议前端复用同一计算逻辑（从 `public/pre_generated_mock/` 或共享 util import），避免前后端价格计算不一致。
2. **腐竹等级折扣暂不启用**：`admin_tier_discount_applied` 字段保留但默认 null，未来启用腐竹等级体系时填充。
3. **未来人数限制走配置层**：靠 daemon 在启动实例时注入 `max-players=N` 配置或 docker 资源限制，不进计费层（方案 §0.5 画饼）。
4. **审计日志**：所有计费操作（创建扣款 / 续费扣款 / 自动续扣 / 豁免判定 / 直充）写入 `audit_logs`，事件类型 `instance.billing.*`。
5. **告警通知**：`INSTANCE_BILLING_ALERT` 任务检测到欠费实例时，调用现有 `notificationService` 发送站内信给腐竹。

### 6.3 风险提示

1. **契约不可变性**：本计划涉及的所有 `public/` 契约已冻结，模块A 仅做验证与 mock 补全，**不得修改契约字段**。如发现契约缺陷，必须走 s0601（适配契约变更）流程，不得直接编辑。
2. **servers.ts 修改风险**：`servers.ts` 是核心路由，修改 createInstance / startInstance / renew 处理器时必须保留所有现有逻辑，仅在合适位置插入计费接入，避免破坏现有实例创建/启停流程。
3. **migration 顺序**：5 个 migration 必须按依赖顺序执行——先建 `instance_renewals`，再加 `servers.billing_type`，最后扩展 `wallet_transactions.type` CHECK（CHECK 约束修改依赖表已存在）。
4. **并行分支隔离**：Wave 3 的 D/E 分支、Wave 5 的 G/H 分支必须隔离启动，不得共享未保护上下文（如当前会话的调试信息、未闭合判断）。
5. **`recharge_cdks` 表依赖**：模块E 依赖现有 `recharge_cdks` 表与 `public/schema/recharge-cdks-schema.json` 契约，开发前需确认此契约字段与方案 §6.3 描述一致。

---

## 7. 未闭合项

| 编号 | 问题 | 状态 | 说明 |
|------|------|------|------|
| 1 | `public/pre_generated_mock/instance-billing-mock.ts` 是否已存在 | 待模块A 核实 | 若缺失则按 s0202 生成；存在则验证字段对齐 |
| 2 | 系统管理员 user_id 解析策略 | 建议方案已给（system_config + fallback） | 模块C 实现时确认 `system_config` 是否有 `billing.admin_user_id` 配置项，缺失则 fallback |
| 3 | `recharge_cdks` 表与契约字段对齐 | 待模块E 核实 | 开发前读取 `public/schema/recharge-cdks-schema.json` 确认字段 |
| 4 | 前端价格预览是否复用后端纯函数 | 建议 | 模块H 实现时决定——若前端独立实现需保证公式一致 |
| 5 | 现有 `instance_pricing` 表（玩家消费侧）与 VPS 月费的关系 | 已澄清 | 两者独立，`instance_pricing` 是玩家消费定价（VIP/积分），`instance_type_pricing` 是腐竹付管理员的月费，不冲突 |

---

## 8. 下一步接续入口

- **人类审批本计划** → 通过后进入 S4 并行开发
- **审批驳回** → 按驳回意见修订本计划，重新拉起独立审查
- **暂停搁置** → 本计划归档，`current-note.md` 同步状态

> 本计划已通过 s0203 模块拆分与编排 Skill 的闭合判据核验：模块拆分表 ✓ / 依赖 DAG ✓ / 并行组 ✓ / 失败回退锚点 ✓ / subagent 执行台账 ✓ / 闭合判据含运行时接入校验 ✓。
