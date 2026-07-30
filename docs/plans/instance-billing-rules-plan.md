---
type: plan
title: 实例计费规则方案（VPS 式简化定稿）
date: 2026-07-28
status: deployed（v4.35.0 VPS 预付费计费上线，见 version.md）
related: billing, wallet, settlement, admin_tiers
tags: [billing, plan, vps-prepaid, simplified]
---

# gsp 实例计费规则方案（VPS 式简化定稿）

> 本方案为 2026-07-28 第三次重大简化后的定稿。完整废弃"按人数峰值计费"与"纯月付套餐制（含增值模块/绑定机制）"两版历史方案，回归市面主流 VPS 预付费模型：**按实例类型定价 + 周期预付费 + 到期续扣**。历史方案归档于附录 A，仅供决策溯源，不再作为实施依据。
>
> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 最终简化声明（2026-07-28 VPS 式定稿）

### 0.1 用户核心决定

> 实例的计费太复杂了，我们简化方案，实例就按照类型计算费用，无所谓在多少人，按月算钱，按季度、半年、一年计算费用。和 VPS 的机制一样，采用预付费。重新梳理方案，简化流程。不要太复杂导致项目不能落地。

### 0.2 简化后的核心模型

**VPS 式预付费订阅**：
- 实例按**类型（instance_type）**计费，与人数无关
- 系统管理员配置每种类型的**月费**与**周期折扣**（月/季/半年/年）
- 创建/续费时**预付费扣全额**，周期内不再扣款
- 周期到期前**自动续扣**（沿用上次周期，余额不足进入欠费流程）
- 实例管理员自有实例与自带节点实例**免计费**
- 未预付费（已过期且未续费）实例**禁止启动**

### 0.3 与历史方案对比

| 维度 | v1 按人数峰值（已废弃） | v2 纯月付套餐制（已废弃） | **v3 VPS 式（本定稿）** |
|------|----------------------|------------------------|------------------------|
| 计费依据 | 月度峰值人数落档 | 套餐基础月费+增值模块 | **实例类型月费** |
| 套餐/绑定 | 阶梯表+绑定表 | 套餐表+绑定表+覆盖字段 | **无套餐、无绑定** |
| 增值模块 | 无 | addon_modules_json | **无** |
| 计费记录 | billing_invoices | billing_invoices | **复用 instance_renewals** |
| 新增表 | 8 张 | 6 张 | **2 张** |
| 人数采样 | 必须 | 不需要 | **不需要** |
| 实施难度 | 高（无市面先例） | 中（绑定+覆盖逻辑） | **低（对齐 VPS 主流）** |

### 0.4 保留的历史裁决

以下裁决在 v3 中仍然适用，不因简化而废弃：

| 裁决 | 状态 | 说明 |
|------|------|------|
| §1.4 两级金融体系 | ✅ 保留 | 玩家↔服主（物品交易，平台不抽成）；服主↔管理员（资源租赁，管理员靠月费赚钱） |
| §1.5 市面案例对照 | ✅ 保留 | 本方案回归 DatHost/Nitrado 主流"预付费固定月费"模式 |
| D.4 改用 global_balances | ✅ 保留 | 扣款源为腐竹 `global_balances`（通过 user_id 自然隔离，腐竹 = roles 含 instance_admin 的 user） |
| D.5 允许腐竹直充 | ✅ 保留 | 腐竹直充通道调用 `balanceService.credit()` |
| 自带节点豁免 | ✅ 保留 | `node_source=self_hosted` 实例免计费 |
| 管理员自有实例豁免 | ✅ 保留 | `billing_exempt=true` 标记 |

### 0.5 未来增强方向（画饼，不在本方案范围）

- **人数限制**：靠服务器配置（`max-players=N`）或 docker 容器资源限制实现，不在计费层
- **峰值附加费**：未来 PlayerTracker 接入率达标后，可作为可选附加模块重新引入

---

## 1. 方案概述

### 1.1 核心思路

在项目已有的"按天预付费续费"（`instance_renewals` + `servers.expires_at` + `expiry_status`）模型之上，引入"按类型月费 × 周期"的 VPS 式定价层：

```
amount = monthly_price × billing_cycle_months × cycle_discount
```

- `monthly_price`：由实例类型决定（系统管理员在 `instance_type_pricing` 表配置）
- `billing_cycle_months`：1（月）/ 3（季）/ 6（半年）/ 12（年）
- `cycle_discount`：周期折扣（长周期优惠，如年付 8 折）

扣款源为腐竹 `global_balances`（通过 `user_id` 自然隔离，腐竹 = `roles` 含 `instance_admin` 的 user），调用 `balanceService.debit()`。

### 1.2 设计原则

1. **极简优先**：能复用就不新建，能合并就不拆分
2. **对齐市面主流**：DatHost/Nitrado/G-Portal 都是"预付费 + 固定月费 + 周期折扣"，本方案完全对齐
3. **零人数依赖**：不依赖 PlayerTracker、不采样、不落档，纯按类型计费
4. **向后兼容**：复用 `instance_renewals` 现有字段，新增字段不破坏存量记录

### 1.3 适用场景

- 面向腐竹（instance_admin）运营的 `platform_managed` 实例的资源计费
- 不适用于 `self_hosted` 已审核节点实例（自动豁免）
- 不适用于腐竹自有实例（`billing_exempt=true` 手动豁免）

### 1.4 金融体系约束（保留自 v1）

**两级金融体系**：
- **第一级（玩家↔服主）**：物品交易体系，平台不抽成。玩家充值（CDK/订单号）→ 玩家 `global_balances` 增加 → 在服主实例商城消费 → 钱流到服主 `global_balances`
- **第二级（服主↔管理员）**：资源租赁体系，管理员唯一收入为服务器月费。服主用余额付月费 → 钱从服主 `global_balances` 流到管理员 `global_balances`

**关键约束**：
1. 管理员**只靠售卖服务器月费赚钱**，不分账玩家充值
2. 提现手续费是管理费用，独立计算，不流向管理员账户
3. 玩家↔服主资金流转无平台抽成

---

## 2. 数据模型设计（极简：2 张新表 + 2 个字段扩展）

> 命名与类型风格对齐现有 schema（snake_case、UUID 主键 string、ISO 8601 text 时间、integer 存点券）。
> 100 点券 = 1 元，所有金额字段为整数点券。
> 新表归属 `public/schema/` 契约层（受保护，变更须走 s0601 流程），migration 放 `panel/backend/src/db/migrations/`。

### 2.1 新增表 1：`instance_type_pricing`（实例类型定价表）

系统管理员配置每种实例类型的月费与周期折扣。一张表承载全部定价规则。

| 字段 | 类型 | 约束 | 默认值 | 描述 |
|------|------|------|--------|------|
| id | string(UUID) | PK | — | 定价 ID |
| instance_type | string enum | NOT NULL, UNIQUE | — | 实例类型：micro / small / medium / large / xlarge |
| display_name | string | NOT NULL, 1-32 | — | 展示名（如"微型""标准""大型"） |
| monthly_price | integer | NOT NULL, ≥0 | — | 基础月费（点券）。0=免费类型 |
| quarterly_discount | number | NOT NULL, 0-1 | 1.0 | 季付折扣（1.0=无折扣，0.95=95 折） |
| semiannual_discount | number | NOT NULL, 0-1 | 1.0 | 半年付折扣 |
| annual_discount | number | NOT NULL, 0-1 | 1.0 | 年付折扣 |
| recommended_slots | integer | nullable | null | 推荐人数上限（仅展示参考，不强制，画饼用） |
| cpu_limit | string | nullable | null | CPU 限制建议（仅展示，如"2 核"） |
| memory_limit_mb | integer | nullable | null | 内存限制建议（仅展示） |
| disk_limit_gb | integer | nullable | null | 磁盘限制建议（仅展示） |
| status | string enum | NOT NULL | 'active' | active / archived |
| description | text | nullable | null | 类型描述 |
| created_by | string(UUID) | NOT NULL | — | 创建者 user_id（仅 system_admin） |
| created_at | text(ISO8601) | NOT NULL | — | 创建时间 |
| updated_at | text(ISO8601) | NOT NULL | — | 更新时间 |

索引：`UNIQUE(instance_type) WHERE status='active'`（同类型同时只一个 active）；`INDEX(status)`。

**推荐初始定价（建议值，可调整）**：

| instance_type | display_name | monthly_price | quarterly_discount | semiannual_discount | annual_discount | recommended_slots |
|---------------|-------------|---------------|-------------------|--------------------|-----------------|-------------------|
| micro | 微型 | 1500 (¥15) | 0.95 | 0.90 | 0.80 | 1-5 |
| small | 小型 | 3000 (¥30) | 0.95 | 0.90 | 0.80 | 5-15 |
| medium | 标准 | 9000 (¥90) | 0.95 | 0.90 | 0.80 | 15-50 |
| large | 大型 | 24000 (¥240) | 0.95 | 0.90 | 0.80 | 50-100 |
| xlarge | 超大 | 60000 (¥600) | 0.95 | 0.90 | 0.80 | 100+ |

### 2.2 新增表 2：`instance_billing_settings`（实例计费设置表）

每个实例一行的计费设置，替代 v2 的 `instance_billing_bindings`（去掉套餐绑定，仅保留类型+豁免标记）。

| 字段 | 类型 | 约束 | 默认值 | 描述 |
|------|------|------|--------|------|
| id | string(UUID) | PK | — | 设置 ID |
| instance_id | string(UUID) | NOT NULL, UNIQUE, FK→servers.id | — | 实例 ID（一对一） |
| instance_type | string enum | NOT NULL | 'small' | 实例类型：micro/small/medium/large/xlarge |
| custom_monthly_price | integer | nullable | null | 实例级覆盖月费（null=用类型默认） |
| billing_exempt | boolean | NOT NULL | false | 免计费标记 |
| exempt_reason | string | nullable | null | 免计费原因（'owner_self'/'self_hosted_node'/'manual'） |
| auto_renew_enabled | boolean | NOT NULL | true | 是否启用到期自动续扣 |
| last_billing_cycle_months | integer | nullable | null | 上次续费周期（1/3/6/12），自动续扣沿用 |
| created_at | text(ISO8601) | NOT NULL | — | 创建时间 |
| updated_at | text(ISO8601) | NOT NULL | — | 更新时间 |

约束：`UNIQUE(instance_id)`（一对一）。

### 2.3 字段扩展：`servers` 表

新增 1 个字段（不改现有字段语义，向后兼容）：

| 字段 | 类型 | 约束 | 默认值 | 描述 |
|------|------|------|--------|------|
| billing_type | string enum | nullable | null | 计费类型快照：null=未接入计费（存量兼容）；'vps_prepaid'=VPS 预付费 |

> `servers.expires_at` / `expiry_status` / `expiry_grace_until` 字段已存在，本方案直接复用，无需新增。

### 2.4 字段扩展：`instance_renewals` 表

复用现有 `instance_renewals` 表记录每次预付费扣款，新增 2 个字段（不破坏存量记录）：

| 字段 | 类型 | 约束 | 默认值 | 描述 |
|------|------|------|--------|------|
| billing_cycle_months | integer | nullable | null | 计费周期（1/3/6/12）。null=存量按天续费记录（兼容） |
| instance_type_snapshot | string | nullable | null | 计费时实例类型快照（审计用） |

**复用现有字段说明**：
- `instance_id` / `user_id` / `amount_paid` / `base_amount` / `duration_days` / `old_expires_at` / `new_expires_at` / `renewed_at`：直接复用
- `duration_days` = `billing_cycle_months × 30`（按月换算为天，兼容现有过期计算逻辑）
- `wallet_source='admin_wallets'`（腐竹付月费，复用 v-economy 字段；实际扣 global_balances，详见 §6）
- `admin_tier_discount_applied`：腐竹等级折扣快照（当前默认 null，未来启用腐竹等级折扣时填充）
- `node_source_at_renewal`：节点来源快照（self_hosted 时 amount_paid=0）
- `renewal_type='manual'`（手动续费）或新增枚举值 `'auto'`（自动续扣）

### 2.5 不再新建的表（v2 方案表全部废弃）

以下 v2 方案设计的表在 v3 中**不再新建**：

| 废弃表 | 废弃原因 |
|--------|---------|
| `billing_plans`（计费套餐表） | VPS 式无需套餐，按类型直接定价 |
| `instance_billing_bindings`（实例绑定表） | 改用 `instance_billing_settings`（去掉 plan_id，直接存类型） |
| `billing_invoices`（月度账单表） | 复用 `instance_renewals` 作为计费记录，无需独立账单表 |
| `billing_daily_player_peaks`（人数采样表） | 不再按人数计费 |
| `upgrade_requests`（升级请求表） | 不再有升级机制 |
| `billing_rule_audit`（规则审计表） | 不再有规则评估 |
| `recharge_codes`（充值码表） | 复用现有 `recharge_cdks` 体系（卡商机制） |
| `admin_recharge_orders`（订单号充值表） | 复用现有订单号充值机制 |

---

## 3. 实例类型与定价

### 3.1 类型定义

实例类型为固定枚举，与游戏类型无关（任何游戏都可选择任意类型）：

| instance_type | 适用场景 | 资源建议（仅展示） |
|---------------|---------|------------------|
| micro | 个人测试 / 1-2 人小服 | 1 核 / 1GB / 10GB |
| small | 5-15 人小服 | 2 核 / 2GB / 20GB |
| medium | 15-50 人中服 | 4 核 / 4GB / 40GB |
| large | 50-100 人大服 | 6 核 / 8GB / 80GB |
| xlarge | 100+ 人超大服 | 8 核 / 16GB / 160GB |

> `recommended_slots` / `cpu_limit` / `memory_limit_mb` / `disk_limit_gb` 字段仅用于前端展示与购买引导，**不在计费层强制**。实际资源限制靠 daemon 在启动实例时注入配置或 docker 容器限制实现（未来增强方向，画饼）。

### 3.2 定价计算公式

```
amount = monthly_price_effective × billing_cycle_months × cycle_discount
```

其中：
- `monthly_price_effective` = `instance_billing_settings.custom_monthly_price ?? instance_type_pricing.monthly_price`
- `billing_cycle_months` ∈ {1, 3, 6, 12}
- `cycle_discount` 根据 `billing_cycle_months` 查表：
  - 1 → 1.0（月付无折扣）
  - 3 → `quarterly_discount`
  - 6 → `semiannual_discount`
  - 12 → `annual_discount`
- `duration_days` = `billing_cycle_months × 30`（用于 `expires_at` 计算，统一按 30 天/月）

### 3.3 实例级覆盖

通过 `instance_billing_settings.custom_monthly_price` 字段实现实例级议价：
- `null`：用类型默认月费
- 整数值：覆盖为指定月费（≥0，0=免费实例）

> 大客户特殊定价场景由系统管理员手动设置 `custom_monthly_price`，无需复杂审批流程。

---

## 4. 预付费流程

### 4.1 创建实例

```
1. 腐竹选择 instance_type + billing_cycle_months
2. 系统查询 instance_billing_settings（首次创建则初始化）
3. 免计费判定（见 §5）：
   - billing_exempt=true → amount=0，跳过扣款
   - node_source=self_hosted → amount=0，跳过扣款
   - 否则 → 计算 amount 并预扣
4. 调用 balanceService.debit(fuzhu_user_id, amount, 'instance_billing', instance_id)
   - 余额不足 → 抛 402 Payment Required，实例创建失败
5. 写 instance_renewals 记录（renewal_type='manual', wallet_source='admin_wallets'）
6. 设置 servers.expires_at = now + duration_days × 86400000
7. 设置 servers.expiry_status = 'active'
8. 设置 servers.billing_type = 'vps_prepaid'
9. 创建实例（如已预扣款且失败，需回滚扣款）
```

### 4.2 手动续费

```
1. 腐竹选择 billing_cycle_months（可不同于上次）
2. 免计费判定 → 豁免则 amount=0
3. 计算 amount 并预扣（同 §4.1 步骤 4）
4. 写 instance_renewals 记录（renewal_type='manual'）
5. servers.expires_at = max(old_expires_at, now) + duration_days × 86400000
   （未过期则叠加，已过期则从现在起算）
6. servers.expiry_status = 'active'（从 grace/expired 恢复）
```

### 4.3 自动续扣（scheduler）

```
触发：每日 03:00 扫描 expires_at 在未来 3 天内的 active 实例
条件：instance_billing_settings.auto_renew_enabled=true
流程：
1. 取 last_billing_cycle_months 作为续扣周期（默认 1=月付）
2. 免计费判定 → 豁免则直接延长 expires_at（amount=0）
3. 计算 amount 并尝试扣款
   - 余额足够 → 扣款 + 写 instance_renewals（renewal_type='auto'）+ 延长 expires_at
   - 余额不足 → 不扣款，记录告警日志，等待到期进入宽限期
```

### 4.4 到期与欠费处理

复用现有 `expiry_status` 状态机：

```
active（有效期内）
  ↓ expires_at 到达
grace（宽限期内，已停止但可续费，宽限 7 天）
  ↓ 宽限期满
expired（已过期，待清理，30 天）
  ↓ 30 天未续费
cleaned（已清理磁盘，DB 记录保留）
```

**关键行为**：
- 进入 `grace` 时：daemon 停止实例进程（`instanceService.stopInstance`）
- `grace` / `expired` 状态下：`instanceService.startInstance` 加守卫，禁止启动（返回 402/409）
- 宽限期内续费成功 → 恢复 `active`，可重新启动
- `cleaned` 状态不可恢复（数据已清理）

### 4.5 未预付费实例禁止启动

在 `instanceService.startInstance` 入口加守卫：

```typescript
// 伪代码（对应错误码 INSTANCE_EXPIRED_NOT_RENEWED，HTTP 409 Conflict）
if (server.billing_type === 'vps_prepaid') {
  if (server.expiry_status === 'grace' || server.expiry_status === 'expired') {
    throw new InstanceExpiredError('实例已过期，请续费后启动');
  }
}
```

---

## 5. 免计费白名单

三路径免计费判定，优先级从高到低：

### 5.1 路径 1：手动豁免（`billing_exempt=true`）

- 系统管理员在 `instance_billing_settings` 手动设置 `billing_exempt=true`
- `exempt_reason='manual'`
- 任何计费操作直接返回 amount=0

### 5.2 路径 2：自带节点豁免（`node_source=self_hosted`）

- 查询 `nodes.node_source`，若为 `self_hosted` 且 `approval_status='approved'`
- `exempt_reason='self_hosted_node'`
- amount=0，但仍写 `instance_renewals` 记录（`amount_paid=0`, `node_source_at_renewal='self_hosted'`）

### 5.3 路径 3：腐竹自有实例豁免

- 腐竹为自己运营的实例（`servers.owner_user_id == 操作者 user_id`）
- 创建实例时自动设置 `billing_exempt=true`, `exempt_reason='owner_self'`
- 后续计费操作直接返回 amount=0

### 5.4 豁免判定伪代码

```typescript
function isBillingExempt(server, operatorUserId, node): { exempt: boolean; reason: string | null } {
  const settings = getInstanceBillingSettings(server.id);
  if (settings?.billing_exempt) {
    return { exempt: true, reason: settings.exempt_reason ?? 'manual' };
  }
  if (node.node_source === 'self_hosted' && node.approval_status === 'approved') {
    return { exempt: true, reason: 'self_hosted_node' };
  }
  if (server.owner_user_id === operatorUserId) {
    return { exempt: true, reason: 'owner_self' };
  }
  return { exempt: false, reason: null };
}
```

---

## 6. 扣款链路

### 6.1 扣款源与收款方

- **扣款源**：腐竹 `global_balances`（通过 `user_id` 自然隔离，腐竹 = `roles` 含 `instance_admin` 的 user）
- **收款方**：管理员 `global_balances`（系统管理员 user_id 的账户）
- **调用接口**：`balanceService.debit(from_user_id, amount, 'instance_billing', instance_id)` + `balanceService.credit(to_user_id, amount, 'instance_billing', instance_id)`

> ⚠️ `wallet_source` 字段在 `instance_renewals` 中保留为 `'admin_wallets'`（v-economy 既有枚举值），实际扣款走 `global_balances`，服务层做映射，不改契约枚举。

### 6.2 事务与并发安全

扣款必须 DB 事务 + 行锁（`SELECT ... FOR UPDATE`）：

```
BEGIN
  SELECT * FROM global_balances WHERE user_id=? FOR UPDATE
  校验 balance >= amount
  UPDATE global_balances SET balance=balance-?, total_spent=total_spent+? WHERE user_id=?
  INSERT INTO global_balance_transactions (...)
  COMMIT
```

### 6.3 腐竹直充通道

腐竹可通过 CDK（`recharge_cdks`）或管理员订单号充值到自己的 `global_balances`（腐竹 user_id 的账户）：
- CDK 兑换：`balanceService.credit(fuzhu_user_id, amount, 'recharge_cdk', cdk_id)`
- 订单号充值：`balanceService.credit(fuzhu_user_id, amount, 'admin_order', order_id)`

> D.5 裁决（2026-07-28）：修改 D2 允许腐竹直充，腐竹直充通道保留。

---

## 7. 调度任务

### 7.1 自动续扣扫描

```
任务名：INSTANCE_AUTO_RENEWAL
频率：每日 03:00
扫描范围：expires_at <= now + 3 days 且 expiry_status='active' 且 auto_renew_enabled=true
处理：见 §4.3
```

### 7.2 过期状态转换

复用现有 `instance-expiry-service`（已实现）：
```
任务名：INSTANCE_EXPIRY_CHECKER
频率：每小时
扫描范围：根据 expires_at 转换 expiry_status（active→grace→expired→cleaned）
```

### 7.3 欠费告警

```
任务名：INSTANCE_BILLING_ALERT
频率：每日 09:00
扫描范围：自动续扣失败（余额不足）的实例
处理：写告警日志 + 通知腐竹（未来接入消息系统）
```

---

## 8. 执行步骤

> 不区分优先级，按依赖顺序输出。

### 8.1 契约层（s0201）

1. 新建 `public/schema/instance-type-pricing-schema.json`（实例类型定价表数据契约）
2. 新建 `public/schema/instance-billing-settings-schema.json`（实例计费设置表数据契约）
3. 扩展 `public/schema/server-schema.json`：新增 `billing_type` 字段
4. 扩展 `public/schema/instance-renewals-schema.json`：新增 `billing_cycle_months` / `instance_type_snapshot` 字段，`renewal_type` 枚举新增 `'auto'`
5. 新建 `public/interface_stub/instance-billing-service.d.ts`（计费服务接口存根）
6. 扩展 `public/interface_stub/instance-expiry-service.d.ts`：新增 `assertInstanceNotExpired` 守卫方法签名
7. 生成 `public/pre_generated_mock/` 对应 Mock 实现
8. 编写契约测试套件与合规 rubric

### 8.2 数据层（s0203 模块拆分后并行）

1. 新建 migration `create_instance_renewals.ts`（**已核实此表零实现，需从零建表**，schema 对齐 `public/schema/instance-renewals-schema.json`，含 v-economy 扩展字段 `wallet_source` / `admin_tier_discount_applied` / `node_source_at_renewal`）
2. 新建 migration `create_instance_type_pricing.ts`
3. 新建 migration `create_instance_billing_settings.ts`
4. 新建 migration `alter_servers_add_billing_type.ts`
5. 新建 migration `alter_instance_renewals_add_billing_fields.ts`（在 1 建表基础上追加 `billing_cycle_months` / `instance_type_snapshot`，并将 `renewal_type` 枚举扩展 `'auto'`）
6. 扩展 `wallet_transactions.type` CHECK 约束：追加 `'instance_billing'` 流水类型（balanceService.WalletTxType 枚举同步扩展）
7. 编写 seed 数据：5 种类型的初始定价（micro/small/medium/large/xlarge）

### 8.3 服务层

1. 新建 `panel/backend/src/services/instanceBillingService.ts`：
   - `calculateAmount(instance_type, cycle_months, custom_price?)`
   - `isBillingExempt(server, operatorUserId, node)`
   - `chargeInstanceCreation(server, operatorUserId, cycle_months)`
   - `chargeInstanceRenewal(server, operatorUserId, cycle_months)`
   - `autoRenewInstance(server)`（供 scheduler 调用）
2. 扩展 `instanceService.ts`：
   - `createInstance` 流程接入计费（预扣款 → 失败回滚）
   - `startInstance` 加 `expiry_status` 守卫
3. 扩展 `instanceRenewalService.ts`：
   - 续费流程改用 `instanceBillingService.calculateAmount` 计算金额
   - 扣款源切换为 `global_balances`（`wallet_source='admin_wallets'`，调用 `balanceService.debit(userId, amount, 'instance_billing', ...)`）
4. 扩展 `instance-expiry-service.ts`：
   - 过期停止实例时调用 `instanceService.stopInstance`
   - 新增 `assertInstanceNotExpired(serverId)` 守卫方法
5. **新建 `rechargeCdkService.ts`（腐竹直充通道，已核实零实现）**：
   - `redeemRechargeCdk(user_id, cdk_code)`：腐竹兑换充值 CDK，调用 `balanceService.credit(userId, amount, 'cdk_recharge', ...)`
   - `createAdminRechargeOrder(user_id, amount, order_no)`：管理员订单号充值，调用 `balanceService.credit(userId, amount, 'admin_credit', ...)`
   - 依赖现有 `recharge_cdks` 契约（`public/schema/recharge-cdks-schema.json`）

### 8.4 路由层

1. 新建 `panel/backend/src/api/admin/instance-billing.ts`：
   - `GET /api/admin/instance-billing/types`（查询类型定价列表）
   - `POST /api/admin/instance-billing/types`（创建/更新类型定价，仅 system_admin）
   - `GET /api/admin/instance-billing/settings/:instance_id`（查询实例计费设置）
   - `PUT /api/admin/instance-billing/settings/:instance_id`（更新实例计费设置）
   - `POST /api/admin/instance-billing/renew/:instance_id`（手动续费）
2. 在路由聚合器 `panel/backend/src/api/index.ts` 挂载新路由
3. 在 `panel/backend/src/api/admin/servers.ts` 的创建实例接口接入计费

### 8.5 调度层

1. 在 `panel/backend/src/scheduler/` 注册 `INSTANCE_AUTO_RENEWAL` 任务
2. 复用现有 `INSTANCE_EXPIRY_CHECKER` 任务
3. 注册 `INSTANCE_BILLING_ALERT` 任务

### 8.6 前端层

1. 新建腐竹端"实例计费"页面：
   - 类型选择（micro/small/medium/large/xlarge）
   - 周期选择（月/季/半年/年）+ 价格预览
   - 续费按钮 + 余额展示
   - 计费记录列表（查询 `instance_renewals`）
2. 新建系统管理端"类型定价配置"页面：
   - 5 种类型的月费 / 折扣配置
   - 启用/归档
3. 在实例创建表单中加入类型选择与价格预览
4. 在实例详情页展示计费状态（有效期、到期时间、自动续扣开关）

### 8.7 测试层（s0402 三重闸门）

1. 单元测试：`instanceBillingService.calculateAmount` / `isBillingExempt` 全路径覆盖
2. E2E 测试：创建实例→扣款→续费→到期→自动续扣→欠费→恢复 全链路
3. Mock 回归：前端计费页面 Mock 模式回归验证

---

## 9. 开发事项与建议

### 9.1 关键开发事项

1. **复用优先**：`instance_renewals` 已有完整的续费记录字段，扩展 2 字段即可，不要新建账单表
2. **过期状态机复用**：`servers.expiry_status` 已有完整状态机（permanent/active/grace/expired/cleaned），本方案直接接入，不重新设计
3. **扣款源映射**：`wallet_source='admin_wallets'` 是 v-economy 既有枚举值，服务层映射到 `global_balances` 扣款，不改契约枚举
4. **自动续扣失败不立即停机**：余额不足时仅记录告警，等 `expires_at` 到达后由过期状态机处理，避免频繁扣款失败导致实例抖动
5. **duration_days 换算**：统一按 30 天/月换算（`billing_cycle_months × 30`），与现有 `instance_renewals.duration_days` 逻辑兼容

### 9.2 建议

1. **类型定价初始值参考市面**：micro ¥15/月 对标 DatHost 2GB 方案，xlarge ¥600/月 对标 32GB 方案，可根据实际成本调整
2. **周期折扣梯度**：建议季付 95 折 / 半年 90 折 / 年付 80 折，对齐市面主流梯度
3. **腐竹等级折扣暂不启用**：`admin_tier_discount_applied` 字段保留但默认 null，未来启用腐竹等级体系时填充
4. **前端展示资源建议**：`recommended_slots` / `cpu_limit` 等字段仅展示用，帮助腐竹选型，不在计费层强制
5. **未来人数限制走配置层**：靠 daemon 在启动实例时注入 `max-players=N` 配置或 docker 资源限制，不进计费层

### 9.3 风险提示

1. **存量实例兼容**：`servers.billing_type=null` 表示未接入计费（存量实例），migration 不应自动设置 `billing_type='vps_prepaid'`，避免存量实例被错误计费
2. **自动续扣需腐竹明确授权**：`auto_renew_enabled` 默认 true，但首次创建实例时应在 UI 明确告知腐竹"将开启自动续扣"
3. **扣款失败回滚**：创建实例时若扣款成功但实例创建失败，必须回滚扣款（`balanceService.credit` 退款）
4. **并发安全**：自动续扣与手动续费可能并发，扣款必须 DB 事务 + 行锁

---

## 10. 未闭合项

| 编号 | 问题 | 状态 | 说明 |
|------|------|------|------|
| 1 | `instance_renewals` 表是否已实现 migration | **已核实：零实现** | baseline migration `20260808000000` 不含此表，无任何 migration 创建。本方案需新增 migration 建表（见 §8.2 已补充） |
| 2 | `balanceService` 是否支持 `account_role` 隔离 | **已核实：不存在 account_role** | `global_balances` 表仅 `user_id` PK，无 `account_role` 字段。**结论：不需要 account_role**——腐竹是 `roles` 含 `instance_admin` 的 user，其 `global_balances` 通过 `user_id` 自然隔离。方案中 `account_role='fuzhu'` 表述已修正为"腐竹 user_id 的 global_balances"。需扩展 `WalletTxType` 枚举新增 `'instance_billing'` 类型 |
| 3 | `recharge_cdks` 服务层是否已实现 | **已核实：零实现** | 后端 src 无任何 `recharge_cdks` / `rechargeCdk` 引用。腐竹直充通道需纳入本方案 §8.3 服务层 |
| 4 | 腐竹等级折扣启用时点 | 暂缓 | `admin_tier_discount_applied` 默认 null，未来腐竹等级体系上线时再启用 |
| 5 | 自动续扣通知机制 | 暂缓 | 当前仅写告警日志，未来接入消息系统后扩展 |
| 6 | `duration_days` 按月换算精度 | 已决 | 统一 30 天/月，与现有逻辑兼容，不按日历月精确计算 |

---

## 附录 A：历史方案归档（仅供决策溯源，不作为实施依据）

### A.1 v1 方案：按人数峰值计费（2026-07-28 废弃）

**核心思路**：daemon PlayerTracker 实时追踪在线人数 → 每日采样存 `billing_daily_player_peaks` → 月底取峰值落档计费。

**废弃原因**：
1. 技术复杂度过高（多模块改造 + 依赖 Pack 接入 PlayerTracker）
2. 市面无先例（游戏服务器行业无"按实际在线人数后付费"案例）
3. 白嫖漏洞难以杜绝（未接入 PlayerTracker 的 Pack 让峰值=0）
4. 用户评估"可能实现不了"

**废弃裁决**：用户在 §14.3 不确定点 15 讨论中决定取消人数限制。

### A.2 v2 方案：纯月付套餐制（2026-07-28 废弃）

**核心思路**：系统管理员定义计费套餐（基础月费+增值模块）→ 实例绑定套餐 → 预付费扣全额 → 周期续扣 → 换绑按日比例退款。

**废弃原因**：
1. 套餐+绑定+覆盖字段机制过度复杂
2. 增值模块（`addon_modules_json`）实现成本高
3. 换绑退款逻辑复杂
4. 用户反馈"太复杂导致项目不能落地"

**废弃裁决**：用户要求"实例就按照类型计算费用...和 VPS 的机制一样，采用预付费"。

### A.3 保留的历史裁决

| 裁决编号 | 内容 | 状态 |
|---------|------|------|
| D.4 | 改用 `global_balances` 替代 `admin_wallets` | ✅ 保留（v3 沿用） |
| D.5 | 修改 D2 允许腐竹直充 | ✅ 保留（v3 沿用） |
| C类16 | 绑定即扣全额 | ✅ 转化为 v3 的"创建/续费即扣全额" |
| C类17 | 未绑定套餐禁止启动 | ✅ 转化为 v3 的"未预付费禁止启动" |
| C类18 | 换绑按日比例退款 | ❌ 废弃（v3 无套餐绑定，无需换绑） |

### A.4 多方案对抗融合结论（v1 阶段，已废弃）

v1 阶段通过保守·静态套餐制 / 平衡·动态阶梯制 / 激进·规则引擎制三方案对抗，以平衡方案为骨架融合。该融合结论在 v3 中不再适用，v3 直接采用 VPS 式极简模型，不再有阶梯/升级/规则引擎概念。

---

## 附录 B：人类裁决记录

| 日期 | 裁决 | 内容 |
|------|------|------|
| 2026-07-28 | 用户取消人数限制 | "你取消人数限制吧...未来这个线是靠接触不同的服务器进行管理，靠服务器配置，或者 docker，这个画个饼就行了" |
| 2026-07-28 | 用户要求 VPS 式简化 | "实例的计费太复杂了，我们简化方案，实例就按照类型计算费用，无所谓在多少人，按月算钱，按季度、半年、一年计算费用。和 VPS 的机制一样，采用预付费。重新梳理方案，简化流程。不要太复杂导致项目不能落地。" |

---

> 本方案为 VPS 式简化定稿，替代所有历史版本。实施依据以 §0-§9 为准，附录 A 仅供决策溯源。
