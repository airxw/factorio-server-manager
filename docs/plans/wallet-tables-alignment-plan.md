---
type: plan
title: user_wallets 语义对齐方案——两份 plan 文档认知矛盾消解
date: 2026-07-29
status: approved（v3 定稿，2026-07-29 人类裁决全部 10 项决策，可进入执行阶段）
related:
  - docs/plans/user-center-consolidation-plan.md
  - docs/plans/role-permission-economy-system-plan.md
  - docs/plans/business-logic-system-completion-plan.md
  - public/schema/instance-renewals-schema.json
  - public/schema/settlement-records-schema.json
  - public/schema/user-wallets-schema.json
  - public/schema/admin-wallets-schema.json
  - public/schema/recharge-cdks-schema.json
  - public/schema/wallet-refund-orders-schema.json
  - public/schema/error-codes-schema.json
  - public/schema/CHANGELOG.md
  - public/schema/panel-api-types.ts
tags: [plan, wallet, alignment, user_wallets, global_balances, instance_points, 语义对齐]
---

# user_wallets 语义对齐方案

> 本方案遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。
> 文档定位：消解 `user-center-consolidation-plan.md`（v4.29.0-v4.29.3 已部署）与 `role-permission-economy-system-plan.md`（2026-07-27 已 approved，代码未落地）+ `business-logic-system-completion-plan.md`（ready-for-implementation）对 `user_wallets` 表语义的认知矛盾，统一到「点券 ≠ 金钱、钱→券单向兑换」业务规则下。
>
> 本版本为 v2 修正版，已根据 GN-004 独立审查（2026-07-29）补全 v1 遗漏的 6 处文档引用、4 个契约文件、迁移数据完整性说明，并修正行号偏差。

---

## 一、背景与触发

### 1.1 触发事件

`/admin/profile` 页面「我的钱包」领取每日点券后，`/admin/center`（UserCenter）页面看不到该笔点券。

### 1.2 根因

1. **迁移未完成**：v4.18.0 引入 `instance_points` 表并从 `user_wallets` 一次性拷贝数据，但 `walletService` 的写入路径（`claimDailyReward` / `debit` / `refund`）未切换，仍写旧表 `user_wallets`；admin/center 读新表 `instance_points`，导致数据分叉。
2. **文档认知矛盾**：三份 plan 文档对 `user_wallets` 的语义定位相互冲突，是迁移混乱的源头。

### 1.3 业务规则约束（用户 2026-07-29 明确）

- **点券 ≠ 金钱**
- **金钱可以买点券**（钱→券，单向兑换）
- **点券不能换金钱**（券→钱，禁止）

---

## 二、三表语义定锚

在业务规则约束下，三张表的真实语义唯一确定：

| 表 | 语义 | 维度 | 角色 | Service | 状态 |
|---|---|---|---|---|---|
| `global_balances` | **金钱**（可提现/冻结/账期/充值上限） | 用户全局（user_id PK） | 钱包 | `balanceService` | v5 新表，活跃 |
| `instance_points` | **点券**（实例级消耗品，仅该实例商城消费） | user_id + server_id 复合 PK | 点券账户 | `pointsService` | v4.18.0 新表，活跃 |
| `user_wallets` | **旧版混合语义**（历史既当钱又当券） | user_id + server_id | 已废弃 | `walletService`（旧） | 应废弃，仅保留备查 |

**单向兑换路径**：

```
global_balances（钱）──兑换──▶ instance_points（券）
        ▲                          │
        │                          │
        └────── 禁止反向 ──────────┘
```

- 充值 CDK / 订单号充值 → `global_balances`（钱入）
- 买点券 → `global_balances` 扣 + `instance_points` 加（钱→券，`linked_tx_id` 双写关联）
- 商品消费 → `instance_points` 扣（券消费）
- 实例续费 / 买 VIP / 买 CDKey / 买服务器 → `global_balances` 扣（钱消费）
- 提现 → `global_balances` 扣（钱出）

### 2.1 设计与实现分裂的说明（GN-004 审查发现）

`user-center-consolidation-plan.md` §2.9 L182 设计意图："数据回填：`user_wallets.balance` 合并到 `global_balances`（同一 user 多实例余额求和）"——把 user_wallets 视为**金钱**。

但实际迁移 `20260727000002_create_instance_points.ts` L53-67：把 user_wallets 全量拷贝到 `instance_points`（点券表）；且 `walletService.ts` L336 writeTransaction 写 `currency_type='points'`——运行时把 user_wallets 视为**点券**。

这一设计与实现的分裂意味着：**user_wallets 历史数据本身是混合语义**，既含本应属于 global_balances 的金钱部分，也含本应属于 instance_points 的点券部分。本方案 §7.2 历史数据兼容中专门处理此问题。

---

## 三、矛盾清单

### 3.1 user-center-consolidation-plan.md 的定位（正确方）

| 位置 | 原文 | 语义定位 |
|---|---|---|
| L21 | "钱包余额 \| ✓ \| 实例级碎片化，且**设计有误（余额应为全局）**" | 认定 user_wallets 设计有误 |
| L51-60 | 双货币模型：全局余额（balance）= 金钱；点券（points）= 实例级 | 钱与券分离 |
| L180 | "现有 `user_wallets` 表保留不删（历史备查）" | 废弃，备查 |
| L182 | "数据回填：`user_wallets.balance` 合并到 `global_balances`（同一 user 多实例余额求和）" | user_wallets 余额 = 金钱 |
| L780 | "点券与积分无关：点券消费不计入积分" | 点券独立概念 |

**结论**：该文档与业务规则完全一致，user_wallets 视为金钱（合并到 global_balances），点券由 instance_points 独立承载。

### 3.2 role-permission-economy-system-plan.md 的定位（矛盾方）

| 位置 | 原文 | 实际承担角色 | 应映射为 |
|---|---|---|---|
| L40 | "玩家通过 `recharge_cdks` 充值到平台 `user_wallets`" | 充值=金钱 | `global_balances` |
| L52 | "玩家钱包 `user_wallets`（按 user_id+server_id 作用域）**复用，不动**" | 错误定性 | 应改为 global_balances + instance_points 分离 |
| L74 | "实例续费（仅自己所属实例，扣 `user_wallets`）" | 续费=金钱消费 | `global_balances` |
| L99 | "`admin_wallets` 与 `user_wallets` 资金隔离，不可互转" | 账户隔离 | `global_balances` |
| L125 | "续费自有实例（user_wallets 扣款）" | 续费=金钱消费 | `global_balances` |
| L364 | "`wallet_source` \| enum ['user_wallets', 'admin_wallets'] \| 扣款源（默认 `user_wallets`...）" | 字段字面量 | `['global_balances', 'admin_wallets']`，默认 `global_balances` |
| L400-411 | 资金流图：recharge_cdks → user_wallets 增加点券；玩家消费/续费扣 user_wallets | 充值=钱，消费/续费混用 | 充值→global_balances；续费→global_balances；商品消费→instance_points |
| L427-428 | "玩家输入 CDK → 点券入 `user_wallets.balance`；平台获得真实货币，`user_wallets` 增加虚拟点券" | "点券"与"货币"混用 | 充值入 global_balances（钱） |
| L499 | "server_admin 生成，`face_value` 已定，玩家兑换入 `user_wallets`" | 充值=金钱 | `global_balances` |
| L523 | "腐竹账户资金不可回退到 `user_wallets`（账户体系隔离）" | 账户隔离 | `global_balances` |
| L545 | "`user_wallets`（玩家）与 `admin_wallets`（腐竹）必须物理隔离" | 账户隔离 | `global_balances` |
| L549 | "`active_role` 切换必须显式切换钱包视图（`user_wallets` ↔ `admin_wallets`）" | 钱包视图切换 | `global_balances` ↔ `admin_wallets` |
| L575-576 | "玩家兑换 recharge_cdks（face_value=10000）→ `user_wallets.balance += 10000`；玩家购买商品（total_price=3000）→ `user_wallets.balance -= 3000`" | 充值=钱，商品消费=券（混淆） | 充值→global_balances；商品消费→instance_points（需补充钱→券兑换中间步骤） |
| L600 | "`user_wallets.balance -= face_value`（可能产生负数，记入 `owed_balance`）" | 退款扣款=金钱 | `global_balances.balance -= face_value` |
| L621 | "`active_role` 切换时钱包视图切换（`user_wallets` ↔ `admin_wallets`）" | 冲突矩阵 | `global_balances` ↔ `admin_wallets` |
| L633 | "✅ 不修改 `user_wallets` 表（玩家钱包保持按实例作用域）" | 错误承诺 | 删除，改为引用 global_balances + instance_points |
| L652 | "`instance_renewals.wallet_source` 扣款源（`user_wallets` / `admin_wallets`）" | 字段字面量 | `global_balances` / `admin_wallets` |
| L664 | "`instance_renewals.wallet_source` 默认值：现有记录默认为 `user_wallets`" | 字面量默认值 | `global_balances` |
| L700 | "扩展 `instanceRenewalService.ts`：扣款源切换（`user_wallets` ↔ `admin_wallets`）" | 代码层切换 | `global_balances` ↔ `admin_wallets` |
| L792 | "新增字段 `wallet_source` 默认 `user_wallets`，避免破坏既有玩家续费流程" | 历史数据兼容 | 默认 `global_balances` |
| L822 | "跨实例玩家钱包合并（同一玩家在腐竹 A 与腐竹 B 的实例都有 `user_wallets`，是否合并）" | 未决项 | 改为 `global_balances`（注：global_balances 用户全局唯一，此问题自然消解） |

### 3.3 business-logic-system-completion-plan.md 的定位（矛盾方，GN-004 补充发现）

| 位置 | 原文 | 实际承担角色 | 应映射为 |
|---|---|---|---|
| L45 | "钱包 \| `user_wallets`（按实例作用域：balance / total_earned / total_spent）+ debit/credit/refund 原子操作" | 错误定性 | 标注 user_wallets 已废弃，改为 global_balances + instance_points |
| L172 | "玩家在钱包页输入 CDK 码，校验后点券入账 `user_wallets.balance`" | 充值=金钱（"点券"误用） | `global_balances.balance`（钱入） |

### 3.4 矛盾本质

`role-permission-economy-system-plan` 与 `business-logic-system-completion-plan` 把 `user_wallets` 当作"玩家通用钱包"继续复用，但其中 user_wallets 实际**混合承担了金钱（充值/提现/分账/续费）和点券（商品消费）两种语义**。这正是 `user-center-consolidation-plan` L21 所说的"设计有误"。

三份文档定稿时间不一，但从未交叉对齐：
- business-logic-system-completion-plan（2026-07-25，ready-for-implementation）
- user-center-consolidation-plan（2026-07-27，deployed v4.29.0-v4.29.3，代码已落地 global_balances + instance_points）
- role-permission-economy-system-plan（2026-07-27，approved，代码未落地，但契约层已写入 `wallet_source='user_wallets'` 字面量）

---

## 四、对齐方向

### 4.1 主映射规则

`role-permission-economy-system-plan` 与 `business-logic-system-completion-plan` 中所有 `user_wallets` 引用，按上下文语义映射：

| 上下文 | 映射目标 | 理由 |
|---|---|---|
| 玩家充值（recharge_cdks 兑换 / 订单号充值） | `global_balances` | 充值=钱入 |
| 玩家提现 | `global_balances` | 提现=钱出 |
| 平台分账给腐竹（玩家消费触发） | `global_balances`（玩家钱）→ `admin_wallets`（腐竹钱） | 分账=钱流转 |
| 玩家续费实例 | `global_balances` | 续费=钱消费 |
| 腐竹续费自有实例 | `admin_wallets` | 腐竹钱消费 |
| 玩家购买商品（shop_orders） | `instance_points` | 商品消费=券消费 |
| 账户隔离表述 | `global_balances` ↔ `admin_wallets` | 玩家钱 vs 腐竹钱 |
| `instance_renewals.wallet_source` 字段值 | `'global_balances'` / `'admin_wallets'` | 字面量重命名 |

### 4.2 商品消费的特殊处理

`role-permission-economy-system-plan` L575-576 场景"玩家兑换 10000 → 购买商品 3000"需补充中间步骤：

```
1. 玩家兑换 recharge_cdks（face_value=10000）→ global_balances.balance += 10000
2. 玩家用余额买点券（global_balances -= 3000, instance_points += 3000，linked_tx_id 关联）
3. 玩家购买商品（total_price=3000）→ instance_points.balance -= 3000
4. settlementRunner 扫描 → 命中规则 admin_share=0.7 → admin_wallets.pending_balance += 2100
```

> 若商品消费实际走"余额直接消费"（不经过点券兑换），则需在 user-center-consolidation-plan 中明确"商品消费扣 global_balances 还是 instance_points"。当前 user-center-consolidation-plan L60 把"买点券"列为 global_balances 用途，L780 把"点券消费"列为点券用途，暗示商品消费扣 instance_points。此点需在代码修复阶段最终确认，本方案仅做文档层对齐。

### 4.3 不变更项

- `admin_wallets` / `admin_wallet_transactions` / `settlement_rules` / `settlement_records` 表名与语义不变（腐竹金钱账户体系）
- `admin_wallets` 与玩家账户的隔离关系不变，仅把隔离对象从 `user_wallets` 改为 `global_balances`
- `user_wallets` 表物理保留（备查），不 DROP（有外键 + 历史数据 + 字面量引用）

---

## 五、执行步骤（文档层）

### 5.1 修改 `docs/plans/role-permission-economy-system-plan.md`

按 §3.2 矛盾清单逐项修改（共 21 项，覆盖该文档全部 user_wallets 引用）：

1. **L40** "玩家通过 `recharge_cdks` 充值到平台 `user_wallets`" → "充值到平台 `global_balances`"
2. **L52** "玩家钱包 `user_wallets`（按 user_id+server_id 作用域）**复用，不动**" → "玩家金钱账户 `global_balances`（用户全局）+ 玩家点券账户 `instance_points`（user_id+server_id 作用域），均已在 v4.18.0/v5 落地，复用不动；`user_wallets` 表已废弃保留备查"
3. **L74** "实例续费（仅自己所属实例，扣 `user_wallets`）" → "扣 `global_balances`"
4. **L99** "`admin_wallets` 与 `user_wallets` 资金隔离，不可互转" → "`admin_wallets` 与 `global_balances` 资金隔离，不可互转"
5. **L125** "续费自有实例（user_wallets 扣款）" → "续费自有实例（global_balances 扣款）"
6. **L364** "`wallet_source` \| enum ['user_wallets', 'admin_wallets'] \| 扣款源（默认 `user_wallets`...）" → "enum ['global_balances', 'admin_wallets']，默认 `global_balances`"
7. **L400-411** 资金流图中所有 `user_wallets` → `global_balances`；"玩家消费"分支标注"商品消费扣 instance_points，详见 user-center-consolidation-plan §2"
8. **L427-428** "点券入 `user_wallets.balance`" → "余额入 `global_balances.balance`"；"平台获得真实货币，`user_wallets` 增加虚拟点券" → "平台获得真实货币，`global_balances` 增加余额"
9. **L499** "玩家兑换入 `user_wallets`" → "玩家兑换入 `global_balances`"
10. **L523** "腐竹账户资金不可回退到 `user_wallets`" → "不可回退到 `global_balances`"
11. **L545** "`user_wallets`（玩家）与 `admin_wallets`（腐竹）必须物理隔离" → "`global_balances`（玩家金钱）与 `admin_wallets`（腐竹金钱）必须物理隔离"
12. **L549** "钱包视图切换（`user_wallets` ↔ `admin_wallets`）" → "钱包视图切换（`global_balances` ↔ `admin_wallets`）"
13. **L575-576** 场景 A 流程按 §4.2 补充"钱→券兑换"中间步骤
14. **L600** "`user_wallets.balance -= face_value`（可能产生负数，记入 `owed_balance`）" → "`global_balances.balance -= face_value`"
15. **L621** "`active_role` 切换时钱包视图切换（`user_wallets` ↔ `admin_wallets`）" → "（`global_balances` ↔ `admin_wallets`）"
16. **L633** "✅ 不修改 `user_wallets` 表（玩家钱包保持按实例作用域）" → "✅ `user_wallets` 表已废弃保留备查，玩家金钱走 `global_balances`、点券走 `instance_points`"
17. **L652** "`wallet_source` 扣款源（`user_wallets` / `admin_wallets`）" → "（`global_balances` / `admin_wallets`）"
18. **L664** "`instance_renewals.wallet_source` 默认值：现有记录默认为 `user_wallets`" → "默认为 `global_balances`"
19. **L700** "扣款源切换（`user_wallets` ↔ `admin_wallets`）" → "扣款源切换（`global_balances` ↔ `admin_wallets`）"
20. **L792** "新增字段 `wallet_source` 默认 `user_wallets`，避免破坏既有玩家续费流程" → "默认 `global_balances`"
21. **L822** "跨实例玩家钱包合并（同一玩家在腐竹 A 与腐竹 B 的实例都有 `user_wallets`，是否合并）" → "（同一玩家在腐竹 A 与腐竹 B 的实例都有 `global_balances`，是否合并）——注：global_balances 用户全局唯一，本就只有一个账户，此问题自然消解"

### 5.2 修改 `docs/plans/user-center-consolidation-plan.md`（仅补充交叉引用）

该文档本身正确，仅需在 §2.9 现有数据迁入部分追加一句交叉引用：

- **L182 后** 追加："本设计与 `role-permission-economy-system-plan.md` / `business-logic-system-completion-plan.md` 对齐——两份文档中所有 `user_wallets` 引用均按语义映射为 `global_balances`（金钱）或 `instance_points`（点券），详见 `docs/plans/wallet-tables-alignment-plan.md`"

### 5.3 修改 `docs/plans/business-logic-system-completion-plan.md`（GN-008 补充）

按 §3.3 矛盾清单修改：

1. **L45** "钱包 \| `user_wallets`（按实例作用域：balance / total_earned / total_spent）+ debit/credit/refund 原子操作" → "钱包 \| `global_balances`（金钱，用户全局）+ `instance_points`（点券，user_id+server_id 作用域）+ debit/credit/refund 原子操作；`user_wallets` 表已废弃保留备查"
2. **L172** "玩家在钱包页输入 CDK 码，校验后点券入账 `user_wallets.balance`" → "玩家在钱包页输入 CDK 码，校验后余额入账 `global_balances.balance`（金钱充值）"

### 5.4 不修改项

- `docs/reports/business-logic-v1-delivery-report.md` L41：报告类历史文档，仅描述当时状态，不改
- `current-note.md` L18：v4.29.0 部署记录"迁移合并 user_wallets 生效"，属历史日志，不改
- `version.md` L1517：清理脚本注释中"user_wallets"在级联清理表清单中，属代码注释引用表名，不改

---

## 六、开发事项（契约层，需人类显式授权）

> ⚠️ 以下涉及 `public/` 目录修改，受 rules-0 §四-10 与 §四-7.2 `ec7_action_gate` 双重保护，必须人类显式授权且走 s0601 契约变更流程，不得自动执行。

### 6.1 `public/schema/instance-renewals-schema.json`

- **L5** title description：含"user-wallets-schema.json（amount_paid 从钱包余额扣款）"和"wallet_source：扣款源。玩家续费=user_wallets" → 全部 `user_wallets` 改为 `global_balances`
- **L67** description："扣哪个钱包由 wallet_source 字段决定：user_wallets=玩家钱包 / admin_wallets=腐竹聚合账户" → "global_balances=玩家金钱钱包 / admin_wallets=腐竹聚合账户"
- **L86** `wallet_source` 字段 enum 值：`["user_wallets", "admin_wallets"]` → `["global_balances", "admin_wallets"]`（注：v1 误标为 L84，实际 enum 行在 L86）
- **L87** default：`"user_wallets"` → `"global_balances"`
- **L88** description："扣款源：user_wallets=玩家钱包（默认，存量记录兼容值）；admin_wallets=腐竹聚合账户" → "global_balances=玩家金钱钱包（默认）；admin_wallets=腐竹聚合账户"

### 6.2 `public/schema/settlement-records-schema.json`

- **L22** description："instance_renewal=实例续费记录（instance_renewals.id，wallet_source=user_wallets 的玩家续费）" → "wallet_source=global_balances 的玩家续费"

### 6.3 `public/schema/CHANGELOG.md`

- **L97** v4.28.0 依赖说明含"user_wallets / instance_renewals / recharge_cdks 契约基线" → 历史记录，标注"(已废弃，见 wallet-tables-alignment-plan)"
- **L113** `wallet_source`（user_wallets/admin_wallets，默认 user_wallets） → （global_balances/admin_wallets，默认 global_balances）
- **L138** extend_instance_renewals_fields 默认 user_wallets → 默认 global_balances
- **L154** "admin_wallets 与 user_wallets 物理隔离" → "admin_wallets 与 global_balances 物理隔离"
- 追加新条目：MAJOR 变更说明（wallet_source 枚举值重命名，触发依赖模块 TODO 适配提示）

### 6.4 `public/schema/user-wallets-schema.json`

- 追加 `deprecated: true` 标记与"保留备查，新代码禁用"说明（不删文件，仅标记废弃）

### 6.5 `public/schema/error-codes-schema.json`

- **L656** ADMIN_WALLET_TRANSFER_FORBIDDEN description："admin_wallets ↔ user_wallets 互转" → "admin_wallets ↔ global_balances 互转"
- **L784** GLOBAL_BALANCE_INSUFFICIENT description 中对比引用 "INSUFFICIENT_BALANCE(400, 玩家 user_wallets)" → "INSUFFICIENT_BALANCE(400, 玩家 global_balances/instance_points)"（注：INSUFFICIENT_BALANCE 本体在 L434-440，其 description 不含 user_wallets 字样，无需修改）

### 6.6 `public/schema/bindings-schema.json`

- **L49** description："引用 user_wallets.id" → 标注"历史外键，user_wallets 已废弃；新逻辑不依赖此外键"

### 6.7 `public/schema/admin-wallets-schema.json`（GN-008 补充）

- **L5** description 含"与 user_wallets（玩家钱包，按 user_id+server_id 作用域）物理隔离，禁止互转" → "与 global_balances（玩家金钱钱包，用户全局）物理隔离，禁止互转"

### 6.8 `public/schema/recharge-cdks-schema.json`（GN-008 补充）

- **L5** description 含"用户兑换后点券入账 user_wallets.balance"和"调用 walletService.credit 加款" → "用户兑换后余额入账 global_balances.balance"和"调用 balanceService.credit 加款"
- **L25** face_value description："兑换成功后加到 user_wallets.balance" → "兑换成功后加到 global_balances.balance"

### 6.9 `public/schema/wallet-refund-orders-schema.json`（GN-008 补充）

- **L34** description 含"approve 后通过 walletService.refund 加到 user_wallets.balance" → "approve 后通过 balanceService.credit 加到 global_balances.balance"

### 6.10 `public/schema/panel-api-types.ts`（GN-008 补充）

- **L3314** 注释"钱包余额合计（跨实例 user_wallets 汇总，点券）" → "钱包余额合计（global_balances 金钱 + instance_points 点券汇总）"

---

## 七、建议

### 7.1 代码层修复（后续独立任务，不在本次对齐范围）

本次方案仅做文档与契约对齐。代码层修复应作为独立任务推进，范围：

- `walletService` 废弃：`claimDailyReward` / `debit` / `refund` 切换到 `pointsService`（点券类操作）或 `balanceService`（金钱类操作）
- `shopService` 依赖从 `walletService` 切换到 `pointsService`（商品消费扣 instance_points）
- `routes-registry.ts` / `services-init.ts` 移除 `walletService` 初始化与注入
- `wallet.ts` 路由（Profile 页面 `/api/servers/:serverId/wallet`）改为调用 `pointsService`

### 7.2 历史数据兼容

#### 7.2.1 user_wallets 表保留

- `user_wallets` 表物理保留，不 DROP（有外键 + 历史数据 + 字面量引用）
- `instance_renewals.wallet_source` 历史数据中已有的 `'user_wallets'` 字面量需迁移为 `'global_balances'`（UPDATE 脚本，幂等）
- 迁移脚本需在 §六 契约变更落地后执行

#### 7.2.2 迁移 20260727000002 数据完整性风险（GN-004 审查发现）

**问题**：迁移 `20260727000002_create_instance_points.ts` L53-67 把 `user_wallets` 全量行拷贝到 `instance_points`（点券表）。但 `user-center-consolidation-plan.md` §2.9 L182 设计意图是把 `user_wallets.balance` 合并到 `global_balances`（金钱表）。由于 user_wallets 历史数据是混合语义（既含金钱部分又含点券部分），已拷贝到 instance_points 的数据**可能包含本应属于 global_balances 的金钱部分**。

**风险定性**：待人类裁决的数据完整性风险。本方案无法在不读取生产数据的情况下判定 user_wallets 历史余额的金钱/点券占比。

**建议处理路径**（三选一，需人类裁决）：
1. **保守路径**：假定 user_wallets 历史余额全部为点券，已拷贝到 instance_points 的数据不动；同时按 user-center-consolidation-plan §2.9 设计，把 user_wallets.balance 求和后合并到 global_balances（即金钱部分从 0 开始，不追溯历史）。风险：若历史 user_wallets 余额实际是金钱，玩家金钱账户会凭空多出一笔
2. **激进路径**：读取 user_wallets 历史流水（wallet_transactions），按流水类型判定每笔是金钱还是点券，回滚重算 instance_points 与 global_balances。风险：计算复杂，且历史流水类型可能不规范
3. **冻结路径**：user_wallets 历史余额不动，新规则从迁移时刻起生效；玩家历史余额锁定在 user_wallets 备查表，仅用于审计查询，不影响新表。风险：玩家历史余额"看不到也用不了"，需运营公告

**本方案推荐**：路径 3（冻结路径），因风险最低、可执行性最高。但最终需人类裁决。

### 7.3 字面量迁移顺序

1. 先改文档（§五）
2. 再改契约（§六，需人类授权 + s0601）
3. 再改代码（§7.1）
4. 最后跑数据迁移脚本（§7.2）

### 7.4 验证要求

- 文档对齐后，grep `user_wallets` 在 `docs/plans/role-permission-economy-system-plan.md` 中应无残留（除"已废弃"说明外）
- 文档对齐后，grep `user_wallets` 在 `docs/plans/business-logic-system-completion-plan.md` 中应无残留（除"已废弃"说明外）
- 契约变更后，grep `'user_wallets'` 字面量在 `public/schema/` 下应无残留（除 user-wallets-schema.json 自身的废弃标记外）
- 代码修复后，grep `walletService` 在 `panel/backend/src/` 下应无残留

---

## 八、工程过程与交接状态

### 8.1 工程过程（已完成）

1. 读取 `Profile.tsx` / `wallet.ts` / `walletService.ts` / `userCenter.ts` / `balanceService.ts` / `pointsService.ts` / `UserCenter.tsx`，定位 Profile 领取与 admin/center 展示的数据流
2. 读取 `20260727000002_create_instance_points.ts` 迁移，确认 v4.18.0 仅做数据拷贝未做代码切换
3. 读取 `user-center-consolidation-plan.md` 与 `role-permission-economy-system-plan.md` 关键段落，梳理矛盾全貌
4. grep 确认 `admin_wallets` / `settlement_rules` 代码层未落地，但 `public/schema/instance-renewals-schema.json` 已写入 `wallet_source='user_wallets'` 字面量
5. 基于业务规则（点券≠金钱、钱→券单向）确定三表语义定锚与对齐映射
6. 输出 v1 方案文档
7. GN-004 独立审查（2026-07-29）结论：警示放行，发现 §5.1 遗漏 6 处文档引用、§六 遗漏 4 个契约文件、迁移数据完整性未识别、business-logic-system-completion-plan 未读取、行号偏差
8. 人类裁决：要求修正后复审
9. 读取 business-logic-system-completion-plan.md，补全 §3.3 矛盾清单
10. 读取 instance-renewals-schema.json / admin-wallets-schema.json / recharge-cdks-schema.json 确认行号与内容
11. 输出 v2 修正版方案文档

### 8.2 交接状态

| 任务 | 状态 | 说明 |
|---|---|---|
| 根因分析 | 已完成 | v5 迁移未完成 + 文档认知矛盾 |
| 三表语义定锚 | 已完成 | global_balances=钱 / instance_points=券 / user_wallets=废弃 |
| 矛盾清单 | 已完成 | §三 列出 21+2 处冲突点（role-permission 21 处 + business-logic 2 处） |
| 对齐方向 | 已完成 | §四 主映射规则 |
| 文档修改步骤 | 已完成 | §五 列出 21+2+1 项修改（覆盖全部 user_wallets 引用） |
| 契约层修改事项 | 已完成 | §六 列出 10 个文件（覆盖全部 public/schema 引用） |
| 迁移数据完整性风险 | 已识别 | §7.2.2 列出三种处理路径，推荐冻结路径，待人类裁决 |
| 代码层修复 | 未开始 | §7.1 列为后续独立任务 |
| 独立审查 v1 | 已完成 | 警示放行，已修正 |
| 独立审查 v2（复审） | 已完成 | 警示放行，覆盖完整性独立核对通过，修正 4 项行号偏差后放行 |
| 人类裁决 | 待触发 | NotifyUser 交付后 |

### 8.3 最终结果（当前阶段）

- 产出物：本方案文档 v2 `docs/plans/wallet-tables-alignment-plan.md`
- 验证结论：矛盾梳理完整（覆盖三份 plan 文档全部 user_wallets 引用），对齐方向与业务规则一致，契约层修改范围完整（覆盖 public/schema 全部引用），迁移数据完整性风险已识别并给出处理路径
- 待决项：
  1. GN-004 复审通过
  2. 人类裁决是否批准文档修改 + 是否授权 public/ 契约变更 + 迁移数据完整性路径选择

---

## 九、遗漏检查（GN-004 补充）

已核查以下文件中的 user_wallets 引用，判定为不改：

| 文件 | 位置 | 引用内容 | 不改理由 |
|---|---|---|---|
| `current-note.md` | L18 | v4.29.0 部署记录"迁移合并 user_wallets 生效" | 历史日志，记录当时状态，不改 |
| `version.md` | L1557 | 清理脚本注释中"user_wallets"在级联清理表清单 | 代码注释引用表名，非语义声明，清理脚本仍需引用物理表名，不改 |
| `docs/reports/business-logic-v1-delivery-report.md` | L41 | "钱包 \| `user_wallets`（按实例作用域）" | 报告类历史文档，描述当时状态，不改 |

---

## 十、参考

- [user-center-consolidation-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/user-center-consolidation-plan.md)（v4.29.0-v4.29.3 已部署，正确方）
- [role-permission-economy-system-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/role-permission-economy-system-plan.md)（approved，代码未落地，矛盾方）
- [business-logic-system-completion-plan.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/business-logic-system-completion-plan.md)（ready-for-implementation，矛盾方）
- [walletService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/walletService.ts)（旧表写入路径，待废弃）
- [pointsService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/pointsService.ts)（新表 service）
- [balanceService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/balanceService.ts)（金钱 service）
- [20260727000002_create_instance_points.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260727000002_create_instance_points.ts)（数据拷贝迁移）

---

## 十一、基于用户裁决的设计调整（2026-07-29）

> ⚠️ 本章节为 v3 重大设计变更，基于用户 2026-07-29 明确裁决的 6 个核心决策，对 §二~§六 的设计产生连锁影响。本章节优先级高于 §二~§六 的原设计描述。

### 11.1 用户裁决的 6 个核心决策

| 编号 | 决策 | 裁决内容 | 影响 |
|------|------|----------|------|
| D1 | 点券定位 | 点券=商品消费单位，金钱=平台服务消费单位 | 商品消费扣 instance_points；续费/买VIP 扣 global_balances |
| D2 | 分账来源 | 仅从提现分账（非实时分账） | 取消 pending_balance 冻结期机制；settlement_records 触发时机变更 |
| D3 | 分账机制 | 腐竹账户仅展示，提现时平台审核打款 | admin_wallets 字段语义变更；不涉及实时资金流转 |
| D4 | 钱→券兑换入口 | 玩家主动兑换，前端有入口 | 新增"买点券"API 与前端页面；global_balances 为玩家金钱主账户 |
| D5 | 点券消费与分账关系 | 点券消费不触发分账 | shop_orders 消费不分账给腐竹；仅 instance_renewals（金钱消费）参与分账 |
| D6 | 单向兑换规则 | 金钱→点券单向，点券不能换金钱 | 禁止任何形式的点券→金钱转换（含间接转换） |

### 11.2 完整资金流转路径（基于用户裁决重建）

#### 11.2.1 玩家侧资金流

```
[线下人民币] ──卡商购买CDK──▶ [CDK码]
                                    │
                                    ▼
                              [前端兑换CDK]
                                    │
                                    ▼
                         global_balances.balance += face_value
                              [玩家金钱账户]
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            [买点券入口]    [续费实例]      [买VIP]
            玩家主动操作    扣global_balances  扣global_balances
                    │
                    ▼
         global_balances -= amount
         instance_points += amount
         (linked_tx_id 关联，单向不可逆)
                    │
                    ▼
            [玩家点券账户]
                    │
                    ▼
            [商品消费]
            instance_points -= total_price
            (不触发分账)
```

#### 11.2.2 VIP 每日领取

```
[系统赠送] ──▶ instance_points.balance += daily_reward_amount
              [玩家点券账户]
              (点券，不可提现，仅商品消费)
```

> 注：VIP 每日领取的点券不可逆向兑换回金钱（见 D6），仅能用于商品消费。

#### 11.2.3 腐竹侧资金流（重大变更）

```
[玩家续费实例] ──▶ global_balances.balance -= amount_paid
                  [钱进入平台账户]
                  (不实时分账给腐竹)

[腐竹查看收益] ──▶ admin_wallets.balance (仅展示计算值)
                  (基于玩家续费记录按规则计算的应得收益)
                  (不涉及实时资金流转)

[腐竹申请提现] ──▶ 提现申请单
                        │
                        ▼
                  [server_admin 审核]
                        │
                        ▼
                  平台计算实际打款金额
                  = 腐竹应得收益 - 资源费 - 其他支出
                        │
                        ▼
                  [平台线下打款]
                        │
                        ▼
                  记录提现单（admin_wallet_transactions）
```

### 11.3 与原方案的差异（需要调整的设计点）

#### 11.3.1 admin_wallets 表语义变更

**原设计**（role-permission-economy-system-plan §3.3）：
- `balance` = 可用余额（可消费/可提现）
- `pending_balance` = 分账冻结中余额（T+7 冻结期）
- `owed_amount` = 欠款（退款时已分账资金不足）
- `total_earned` / `total_spent` / `total_withdrawn` = 累计收支

**v3 新设计**（基于 D2+D3）：
- `balance` = **展示用计算值**（腐竹应得收益累计，基于玩家续费记录按规则计算，非实时入账）
- `pending_balance` = **废弃或重定义**（取消冻结期机制；若保留则改为"待提现结算的收益"）
- `owed_amount` = 保留语义（腐竹欠平台资源费）
- `total_earned` = 展示用累计收益（计算值）
- `total_spent` = 展示用累计资源费支出（计算值）
- `total_withdrawn` = 累计提现金额（实际打款记录）

**影响**：admin_wallets 不再承载实时资金流转，仅作为腐竹收益展示与提现审核依据。实际资金始终在平台账户。

#### 11.3.2 settlement_records 表触发时机变更

**原设计**：
- settlementRunner（每小时）扫描玩家消费，写入 pending 记录
- pendingBalanceReleaser（每小时）释放到期记录（pending → released）
- 退款流程触发 reversed

**v3 新设计**（基于 D2）：
- settlementRunner 不再实时写入 pending 记录
- settlement_records 改为**提现时批量生成**（腐竹申请提现 → 平台计算 → 生成结算记录）
- 状态机简化：取消 pending → released 流转；改为 `computed`（已计算）→ `withdrawn`（已提现）
- 退款冲正逻辑需重新设计（因不涉及冻结期）

**影响**：settlement_records 表结构与状态机需调整；settlement_rules 配置不变（仅计算时机变更）。

#### 11.3.3 instance_renewals 分账触发变更

**原设计**：
- 玩家续费（wallet_source=user_wallets）→ 触发分账给腐竹
- 腐竹续费自有实例（wallet_source=admin_wallets）→ 不触发分账

**v3 新设计**（基于 D5）：
- 玩家续费（wallet_source=global_balances）→ **不实时触发分账**，但记录续费数据用于提现时计算
- 腐竹续费自有实例 → 详见 §11.4 遗留问题

#### 11.3.4 新增"买点券"入口（基于 D4）

**原设计**：无独立的"钱→券兑换"入口，商品消费直接扣钱包

**v3 新设计**：
- 新增 API：`POST /api/wallet/buy-points`（参数：amount）
  - 校验 global_balances.balance >= amount
  - 事务：global_balances.balance -= amount + instance_points.balance += amount
  - 写入 linked_tx_id 双写关联（balance_transaction_id + points_transaction_id）
  - 不可逆（单向兑换）
- 前端钱包页新增"买点券"入口（金额选择 + 确认兑换）
- 记录 audit_logs（事件类型 `POINTS_PURCHASED`）

### 11.4 遗留问题（已获人类裁决，2026-07-29）

> 以下问题由 D2+D3 的"腐竹账户仅展示"设计引出，已获人类裁决。

#### 11.4.1 腐竹如何消费（续费自有实例、资源费支付）—— **已裁决：路径 A**

**裁决**：腐竹续费自有实例不扣钱（自有实例免费续费）；资源费在提现时一并扣除。

**实现要点**：
- 腐竹续费自有实例：`instance_renewals` 记录 `wallet_source=admin_wallets` 但 `amount_paid=0`（免费续费标记）
- 资源费计算：提现时平台根据腐竹旗下 `platform_managed` 实例的资源占用（实例·天）计算资源费
- 提现打款公式：`实际打款 = 腐竹应得收益 - 资源费 - 其他支出`
- 若资源费 > 应得收益，差额记入 `admin_wallets.owed_amount`（腐竹欠平台）

#### 11.4.2 settlement_records 表结构是否保留 —— **已裁决：废弃 + 仅提现时计算**

**裁决**：废弃 settlement_records 表；不保留分账计算过程明细；仅在提现时计算腐竹应得分成；计算结果直接记入 admin_wallet_transactions。

**实现要点**：
- settlement_records 表废弃（保留备查，不写入新数据）
- settlementRunner / pendingBalanceReleaser 调度任务废弃
- 提现时实时计算：`腐竹应得收益 = Σ(玩家续费金额 × 分账比例)`，按 settlement_rules 配置执行
- 计算结果直接写入 admin_wallet_transactions（类型=withdrawal_settlement）
- 不保留逐笔分账明细（用户明确："只计算提现，不计算过程。不管怎么流通都没关系，只取提现时候的分成"）

#### 11.4.3 腐竹侧退款如何处理 —— **已裁决：路径 A**

**裁决**：退款直接扣 admin_wallets.balance（展示计算值）；若余额不足记 owed_amount。

**实现要点**：
- 腐竹侧退款（如玩家续费后退款）：直接扣减 admin_wallets.balance
- 若 balance 不足，差额记入 owed_amount（腐竹欠平台）
- owed_amount 在下次提现时优先抵扣

#### 11.4.4 玩家侧退款在 D6 约束下的处理 —— **已裁决：路径 D**

**裁决**：商品消费不支持退款（仅未领取的 shop_orders 可退，已领取的走补偿发放）。

**实现要点**：
- shop_orders.status=pending（未领取）可退，退款退回 instance_points（点券，未经过钱→券转换，不违反 D6）
- shop_orders.status=completed（已领取）不支持退款，走补偿发放流程
- wallet_refund_orders 仅限 pending 订单退款
- 商品消费后点券已消耗，不支持逆向退回金钱（遵守 D6）

### 11.5 对契约层的影响（补充 §六，基于 §11.4 裁决更新）

基于 v3 设计调整 + §11.4 裁决，以下契约文件需追加修改（在 §六 原有 10 个文件基础上）：

| 文件 | 变更内容 | 性质 |
|------|----------|------|
| `public/schema/admin-wallets-schema.json` | L5 description 重写（取消"可提现余额/冻结中分账余额"表述，改为"展示用计算值"）；L19-35 字段语义说明调整（balance=展示计算值，pending_balance 废弃，owed_amount 保留） | MAJOR 变更 |
| `public/schema/settlement-records-schema.json` | **废弃标记**：追加 `deprecated: true` + "v3 起废弃，仅保留备查；分账计算改在提现时实时执行，结果记入 admin_wallet_transactions" | 废弃 |
| `public/schema/settlement-rules-schema.json` | 不涉及触发时机（仅规则配置：分成比例、作用域），不需要修改 | 无变更 |
| `public/schema/wallet-refund-orders-schema.json` | 退款目标账户变更（user_wallets → instance_points，仅限 pending 订单）；已领取订单不支持退款（见 §11.4.4 裁决） | MAJOR 变更 |
| `public/schema/panel-api-types.ts` | 新增"买点券"API 类型定义；腐竹提现结算 API 类型定义 | MINOR 新增 |
| `public/schema/instance-renewals-schema.json` | 补充：腐竹续费自有实例 `wallet_source=admin_wallets` 时 `amount_paid=0`（免费续费标记，见 §11.4.1 裁决） | MINOR 补充 |

### 11.6 对代码层的影响（补充 §7.1，基于 §11.4 裁决更新）

基于 v3 设计调整 + §11.4 裁决，代码层修复范围扩大：

| 模块 | 变更内容 |
|------|----------|
| `balanceService.ts` | 新增 `buyPoints(userId, serverId, amount)` 方法（钱→券兑换，事务+双写） |
| `pointsService.ts` | 保持不变（点券消费逻辑不变） |
| `walletService.ts` | 废弃（claimDailyReward 切换到 pointsService） |
| `shopService.ts` | 依赖从 walletService 切换到 pointsService（商品消费扣 instance_points） |
| `settlementRunner` | **废弃**（§11.4.2 裁决：不保留分账计算过程，提现时实时计算） |
| `pendingBalanceReleaser` | **废弃**（取消冻结期） |
| `adminWalletService` | 重构：balance 改为计算值；新增提现结算逻辑（实时计算腐竹应得收益 - 资源费 - owed_amount） |
| `instanceRenewalService` | 腐竹续费自有实例：wallet_source=admin_wallets 时 amount_paid=0（免费续费标记） |
| 退款服务（walletRefundOrderService） | 仅限 pending 订单退款，退款退回 instance_points；已领取订单不支持退款 |
| 路由层 | 新增 `POST /api/wallet/buy-points`；提现流程调整（提现时实时计算分成） |
| 前端钱包页 | 新增"买点券"入口；腐竹工作台收益展示调整（展示计算值） |

### 11.7 v3 方案对原 §五~§六 的影响

原 §五（文档层修改）与 §六（契约层修改）的字面量对齐修改**仍然有效**，但需叠加 §11.5 列出的 v3 语义变更（admin_wallets/settlement_records 字段语义与状态机调整）。文档层修改方向不变（user_wallets → global_balances/instance_points 语义对齐），仅增加"买点券入口"和"分账机制变更"的描述。

### 11.8 工程过程与交接状态更新

#### 11.8.1 v3 新增工程过程

12. 用户提出核心业务规则确认："点券≠金钱，金钱可以买点券，点券不能换金钱"
13. 基于规则进一步分析，发现 4 个逻辑矛盾（商品消费扣款源、分账资金来源、续费扣款源、钱→券兑换入口）
14. AskUserQuestion 请示用户裁决点券定位与分账来源
15. 用户裁决：点券=商品消费单位；仅从提现分账
16. AskUserQuestion 请示用户裁决分账机制与钱→券兑换入口
17. 用户裁决：腐竹账户仅展示，提现时平台审核打款；玩家主动兑换，前端有入口
18. 输出 v3 方案文档（本章节）
19. GN-004 独立审查 v3（2026-07-29）结论：警示放行，发现 1 个警示问题（P1：玩家侧退款在 D6 约束下未识别）+ 5 个建议性问题（P2-P6）
20. 根据 GN-004 建议修正方案文档（P1-P6 全部处理）
21. NotifyUser 交付 v3 方案，用户批准方案文档
22. AskUserQuestion 裁决 §11.4.1（腐竹消费）+ §11.4.4（玩家退款）：自有实例免费续费 + 商品消费不支持退款
23. AskUserQuestion 裁决 §11.4.2（settlement_records）+ §11.4.3（腐竹退款）：废弃 settlement_records + 直接扣腐竹展示余额
24. 根据 4 项裁决更新 §11.4/§11.5/§11.6，方案定稿

#### 11.8.2 v3 交接状态（最终）

| 任务 | 状态 | 说明 |
|------|------|------|
| v2.1 原方案 | 已完成 | §一~§十，已过 GN-004 复审警示放行 |
| 用户裁决收集 | 已完成 | 6 个核心决策 + 4 个遗留问题裁决，共 10 项决策 |
| v3 设计调整 | 已完成 | §十一 记录完整设计变更 |
| v3 遗留问题 | 已裁决 | §11.4 全部 4 项已获人类裁决 |
| v3 契约层影响 | 已更新 | §11.5 基于 §11.4 裁决更新（settlement_records 改为废弃） |
| v3 代码层影响 | 已更新 | §11.6 基于 §11.4 裁决更新（settlementRunner 废弃） |
| GN-004 审查 v3 | 已完成 | 警示放行，P1-P6 全部修正 |
| 人类最终裁决 | 已完成 | 方案文档已批准 + 4 个遗留问题已裁决 |
| **方案状态** | **approved** | v3 方案定稿，可进入执行阶段 |
