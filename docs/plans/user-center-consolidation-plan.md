---
type: plan
title: 个人中心功能整合与补全方案
date: 2026-07-27
status: deployed
deployed_in: v4.29.0-v4.29.3
related: [wallet, user, profile, cdk, transactions, points, vip, withdraw]
tags: [个人中心, 钱包, 余额, 点券, CDK充值, 订单号充值, 积分, VIP, 改密, 交易流水, 防刷, 提现]
---

# 个人中心功能整合与补全方案

## 一、现状分析

### 1.1 已有功能清单

| 功能 | 存在 | 问题 |
|------|:--:|------|
| 改密码 | ✓ | Profile.tsx 底部，入口不明显 |
| 忘记密码 | ✓ | `/forgot-password` + `/reset-password`，仅登录页可触达 |
| 钱包余额 | ✓ | 实例级碎片化，且设计有误（余额应为全局） |
| 每日领取 | ✓ | 需逐个实例点击 |
| 我的订单 | ✓ | `/guild/orders`，不在个人中心内 |
| CDK 兑换 | ✓ | `/guild/cdk`，仅物品兑换 |
| 消费流水 | ✗ | 无表无 API |
| CDK 充值 | ✗ | CDK 未对接余额/点券加款 |
| 订单号充值 | ✗ | 管理员手动充值无路由无审计 |
| 点券体系 | ✗ | 实例级虚拟货币 |
| 积分体系 | ✗ | 决定实例内 VIP 等级 |
| VIP 购买 | ✗ | 定价/等级/订阅/买断 |
| 提现 | ✗ | 提现码审批模式（未来可对接支付平台） |
| 个人中心统一入口 | ✗ | 分散在多处 |

### 1.2 充值模式约束

> **硬约束**：因备案限制，本项目不考虑任何在线支付/支付网关集成。所有"充值"一律通过：
> 1. **CDK 兑换码充值**：管理员预生成充值 CDK → 用户输入兑换码 → 余额增加
> 2. **订单号充值（管理端）**：管理员在后台通过订单号为用户手动加款，全链路审计

### 1.3 平台 vs 实例的权责边界

| 域 | 管理者 | 可配置项 |
|------|--------|----------|
| 平台级 | 系统管理员 | 余额充值上限（默认 1000 元）、单日消费上限（默认 648 元）、提现比例（默认 0.7） |
| 实例级 | 实例管理员 | VIP 价格（买断/订阅）、点券兑换比例、积分累计规则、消费上限（仅可调低） |

> 系统管理员不干涉实例管理员的运营行为。

---

## 二、货币架构设计

### 2.1 双货币模型

```
┌──────────────────────────────────────────────────────────────┐
│                     全局余额 (balance)                        │
│  - 全局唯一：一个用户只有一个余额账户                           │
│  - 来源：CDK 余额充值、管理员订单号充值                         │
│  - 用途：开 VIP、买点券、买 CDKey、买服务器（均按面值消费）      │
│  - 上限：充值入口在余额 ≥ 1000 时禁用（余额本身可＞1000）       │
│  - 提现：所有用户可申请提现码，管理员核销后按 7 折到账（平台服务费）  │
│  - 冻结：生成 CDKey 或提现申请时冻结在平台，过期/取消退回              │
│  - 管理员默认额度：1000 元                                     │
├──────────────────────────────────────────────────────────────┤
│                   实例点券 (instance_points)                   │
│  - 实例级：UNIQUE(user_id, server_id)                         │
│  - 来源：管理员发放、CDK 点券兑换、余额兑换                     │
│  - 用途：仅在该实例商城消费                                    │
│  - 上限：无（虚拟物品，与金钱无关）                             │
│  - 可通过 CDKey 转赠                                          │
│  - 与积分无关联                                               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 全局余额表 `global_balances`

```sql
CREATE TABLE global_balances (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  frozen_balance INTEGER NOT NULL DEFAULT 0,   -- CDKey 生成 / 提现申请时冻结在平台
  total_withdrawn INTEGER NOT NULL DEFAULT 0,  -- 累计提现（已核销）
  last_income_at TEXT,                         -- 最后一笔收入类交易时间（用于账期检查）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**余额限制规则**：
- 余额值本身可以超过 1000（如 980 充值 50 → 1030，允许）
- 余额 ≥ 1000 时，充值入口禁用（CDK 充值 + 订单号充值均不可用）
- 前端提示「余额已达上限，请消费后再充值」
- 这是唯一的余额控制手段（无硬截断、无强制退款）

### 2.3 实例点券表 `instance_points`

```sql
CREATE TABLE instance_points (
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, server_id)
);
```

### 2.4 实例积分表 `user_integrals`

```sql
CREATE TABLE user_integrals (
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  total_integral INTEGER NOT NULL DEFAULT 0,        -- 累计积分（只增不减，记录最高成就）
  current_integral INTEGER NOT NULL DEFAULT 0 CHECK(current_integral >= 0),  -- 当前积分，衰减到 0 为止
  last_decay_at TEXT,                                 -- 上次衰减时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, server_id)
);
```

积分规则：
- **仅与余额消费相关**：默认 1 余额消费 = 1 积分（实例管理员可配比例）
- **与点券无关**：点券消费不产生积分
- 每日衰减：每天减掉相当于 1 元等值的积分（`current_integral` 减，`total_integral` 不变）
- VIP 等级由 `current_integral` 所在区间决定

### 2.5 VIP 等级（积分区间制）

VIP 等级由 `current_integral` 落在哪个区间决定：

| 等级 | 积分区间 | 每日点券奖励 |
|:--:|------|------|
| VIP0 | 0 | 100 |
| VIP1 | 1 - 500 | 200 |
| VIP2 | 501 - 1500 | 400 |
| VIP3 | 1501 - 4000 | 800 |
| VIP4 | 4001 - 10000 | 1600 |
| VIP5 | 10001+ | 3200 |

### 2.6 实例定价配置表 `instance_pricing`

```sql
CREATE TABLE instance_pricing (
  server_id TEXT PRIMARY KEY,
  vip_monthly_price INTEGER,          -- VIP 月价（余额），NULL=不开放订阅
  vip_lifetime_price INTEGER,         -- VIP 买断价（余额），NULL=不开放买断
  points_exchange_ratio REAL NOT NULL DEFAULT 1.0,  -- 余额→点券兑换比例
  integral_ratio REAL NOT NULL DEFAULT 1.0,         -- 余额消费→积分比例
  daily_consumption_limit INTEGER,    -- 单日消费上限（≤ 平台上限），NULL=使用平台默认
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.7 平台级限额配置

系统管理员在 `/admin/settings` 配置：

| 配置项 | 默认值 | 说明 |
|--------|:--:|------|
| `balance.recharge_max` | 1000 | 余额 ≥ 此值时禁用充值入口 |
| `consumption.daily_max` | 648 | 平台单日消费上限 |
| `withdraw.ratio` | 0.7 | 提现比例（余额 × 此比例 = 实际到账） |

### 2.8 平台外交易边界

> 平台仅管理平台内发生的经济行为。实例管理员通过平台外渠道（微信/QQ/线下等）出售 CDKey 的行为，平台不干涉、不管理、不抽成。平台的 30% 提现抽成仅针对通过平台提现操作流出的资金，属于平台对经济交易基础设施的服务管理费用。
>
> 换言之：在平台内流转的余额（买 VIP、买点券、买 CDKey、买服务器）均按面值消费无折扣；只有通过提现将余额变现离开平台时，平台才抽成。

### 2.9 现有数据迁入

- 现有 `user_wallets` 表保留不删（历史备查）
- 新结构上线后所有操作走新表
- 数据回填：`user_wallets.balance` 合并到 `global_balances`（同一 user 多实例余额求和）

---

## 三、VIP 体系

### 3.1 两层概念分离

| 概念 | 决定因素 | 说明 |
|------|----------|------|
| VIP 权益资格 | 是否购买（买断/订阅/CDKey 赠送） | 有资格才能享受每日奖励等权益 |
| VIP 等级 | 当前积分所在区间 | 决定每日奖励倍率 |

### 3.2 购买 VIP

| 方式 | 支付 | 说明 |
|------|:--:|------|
| 买断制 | 余额 | 一次性付费（实例管理员定价），永久有效 |
| 订阅制 | 余额 | 按月付费（实例管理员定价），到期后权益资格失效 |
| CDKey 赠送 | CDKey | 他人购买 VIP CDKey 赠送 |

**购买 VIP 时赠送积分**：购买 VIP 时赠送对应 VIP 等级最低门槛的积分，确保购买后等级 ≥ 对应的 VIP 等级。如购买 VIP3 月卡 → 赠送 1501 积分。同时，购买 VIP 本身是一笔余额消费，也会按 `integral_ratio` 产生消费积分（如定价 300 元、比例 1:1 → 额外获得 300 消费积分）。因此购买 VIP3 月卡总计获得 1501 + 300 = 1801 积分。

### 3.3 VIP 过期处理

- **订阅制到期**：权益资格失效，每日奖励不可领；等级称号保留
- **积分衰减**：每日减 1 元等值积分，`current_integral` 低于当前区间下限时降级
- **掉级**：由 `current_integral` 所在的区间自动判定
- **`total_integral` 只增不减**：永久保留最高积分记录

### 3.4 VIP 购买状态表

```sql
CREATE TABLE user_vip_status (
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  vip_type TEXT CHECK(vip_type IN ('lifetime', 'monthly', null)),  -- null=未购买
  vip_expires_at TEXT,       -- 订阅制到期时间
  purchased_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, server_id)
);
```

### 3.5 实例管理员 VIP 调整

- 管理员可在 `/store/players` 中手动调整用户积分（间接调整等级）
- 操作为增加/减少 `current_integral`（`total_integral` 不变）
- 管理员调整自己：不禁止
- 写入审核日志

---

## 四、提现机制

> 因当前充值仅通过 CDKey / 订单号两种非在线支付方式，提现同样暂不对接支付平台。现阶段采用"提现码"模式：用户申请提现 → 生成提现码 → 管理员手动完成打款后核销。未来可对接支付平台（如 Alipay/WeChat Pay），但每笔提现均需审批（底层安全要求不变）。

### 4.1 提现规则

- **适用对象**：所有用户
- **提现比例**：余额 × 提现比例（平台默认 0.7，系统管理员可调）
- **性质**：平台对经济交易基础设施的服务管理费用。仅在余额提现离开平台时收取。
- **账期限制**：最后一笔收入类交易（CDK 充值、管理员加款等）完成后需等待指定天数（默认 7 天）方可提现，防止资金快进快出风险。
- **平台内消费**：不提现则在平台内原价消费（买服务器、买点券、买 CDKey 等），无折扣
- **平台外交易**：实例管理员通过平台外渠道出售 CDKey，平台不干涉、不管理、不抽成

### 4.2 提现流程（提现码模式）

**提现码表**：

```sql
CREATE TABLE withdraw_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                    -- 提现码（16 位字母数字）
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,                      -- 申请提现金额
  actual_amount INTEGER NOT NULL,               -- 实际到账金额 = amount × ratio
  ratio REAL NOT NULL,                          -- 提现比例（快照，防止配置变更影响存量提现码）
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
  operator_user_id TEXT,                        -- 审批操作人
  approved_at TEXT,
  expires_at TEXT NOT NULL,                     -- 申请时间 + 30 天
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**流程**：

```
用户申请提现（指定金额）
    ↓
系统校验：账期检查（`last_income_at` + 7 天 ≤ 当前时间）+ 可用余额
    ↓
系统生成提现码（16 位字母数字），冻结对应余额，写入 withdraw_codes(status='pending')
    ↓
管理员在后台看到待审批提现 → 线下打款 → 输入提现码核销
    ↓
系统：解冻→正式扣除余额（`balance -= amount`, `frozen_balance -= amount`）
    写入 wallet_transactions(type='withdraw')，标记 withdraw_codes(status='approved')
    ↓
若管理员拒绝 → 解冻退回余额，标记 withdraw_codes(status='rejected')
若 30 天未核销 → 自动取消，解冻退回，标记 withdraw_codes(status='expired')
```

### 4.3 提现 API

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `POST /api/me/withdraw` | JWT | 申请提现 `{amount}` → 返回 `{withdraw_code, actual_amount, expires_at}` |
| `GET /api/me/withdraw/history` | JWT | 提现记录 |
| `GET /api/admin/withdraw/pending` | JWT + `wallet.credit` | 管理端查询待审批提现列表 |
| `POST /api/admin/withdraw/:code/approve` | JWT + `wallet.credit` | 管理员核销提现码（确认已打款） |
| `POST /api/admin/withdraw/:code/reject` | JWT + `wallet.credit` | 管理员拒绝提现（解冻退回） |

### 4.4 未来支付平台对接预留

- 提现审批流程保留（每笔均需审批，不可绕过）
- `withdraw` 流水 type 保持不变
- 新增支付方式字段预留（`payment_method`），当前为 `manual`（人工打款），未来扩展 `alipay` / `wechat` 等
- 提现码过期自动取消定时任务

### 4.5 管理员默认额度

- 实例管理员创建时自动获得 1000 余额（`global_balances.balance = 1000`, `total_earned = 1000`）
- 该初始额度写入流水 `type='admin_credit'`, `description='管理员初始额度'`

---

## 五、CDKey 体系

### 5.1 CDKey 类型扩展

| 类型 | 内容 | 用途 | 可转赠 |
|------|------|------|:--:|
| `item` | 装备/物品 | 商城等价物 | ✓ 管理员生成 |
| `balance` | 全局余额 | 充值到余额 | ✗ 仅管理员 |
| `points` | 实例点券 | 充值到指定实例点券 | ✓ 管理员/用户 |
| `vip` | VIP | 赠送 VIP（买断/订阅） | ✓ 管理员/用户 |

### 5.2 CDKey 表扩展

```sql
ALTER TABLE cdk_keys ADD COLUMN type TEXT NOT NULL DEFAULT 'item' CHECK(type IN ('item', 'balance', 'points', 'vip'));
ALTER TABLE cdk_keys ADD COLUMN amount INTEGER;
ALTER TABLE cdk_keys ADD COLUMN server_id TEXT;
ALTER TABLE cdk_keys ADD COLUMN vip_duration TEXT;       -- 'monthly' / 'lifetime'
ALTER TABLE cdk_keys ADD COLUMN creator_user_id TEXT;
ALTER TABLE cdk_keys ADD COLUMN expires_at TEXT;          -- 生成时间 + 7 天
ALTER TABLE cdk_keys ADD COLUMN refunded_at TEXT;
ALTER TABLE cdk_keys ADD COLUMN refund_tx_id INTEGER;
```

### 5.3 CDKey 生命周期

```
生成 CDKey → 余额冻结在平台（类似美团券，大家都看得到冻结金额）
    ↓
CDKey 有效期 7 天
    ↓
┌──────────────┬────────────────────┐
│ 被人兑换     │ 7 天到期未兑换     │
│ → 冻结余额   │ → 到期自动退费    │
│   正式扣除   │   冻结余额解冻    │
│ → 积分发放   │ → 不涉及积分      │
│ （此时才发） │   （从未发放）    │
└──────────────┴────────────────────┘
```

关键规则：
- 生成 CDKey 时**冻结**余额（在平台可见），**不发放积分**
- 积分在 CDKey 被实际兑换时才发放给购买者
- 过期自动退费：解冻余额，不涉及积分操作
- 管理员生成 balance 类型 CDKey 不扣余额（是充值码）
- 管理员生成 points/vip CDKey 不扣余额（运营工具），写入审计日志

### 5.4 用户自生成 CDKey 转赠

- 类型仅限 `points` 和 `vip`
- 生成时冻结余额（点券按兑换比例折算，VIP 按定价）
- 7 天未兑换 → 自动解冻退回
- 单次受消费上限约束

### 5.5 CDKey 过期退费定时任务

每日凌晨执行：扫描 `cdk_keys WHERE used_at IS NULL AND refunded_at IS NULL AND expires_at < datetime('now')` → 解冻余额 → 标记 `refunded_at`。

---

## 六、交易流水基础设施

### 6.1 `wallet_transactions` 表

```sql
CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  server_id TEXT,
  currency_type TEXT NOT NULL CHECK(currency_type IN ('balance', 'points', 'integral')),
  type TEXT NOT NULL CHECK(type IN (
    'daily_reward',       -- 每日领取
    'shop_purchase',      -- 商城购买（点券）
    'shop_refund',        -- 商城退款（点券）
    'cdk_recharge',       -- CDK 兑换充值（余额/点券）
    'admin_credit',       -- 管理员订单号充值 / 初始额度
    'admin_debit',        -- 管理员扣款
    'vip_purchase',       -- 购买 VIP（余额）
    'points_exchange',    -- 余额兑换点券
    'cdk_generate',       -- 生成 CDKey（冻结余额）
    'cdk_redeem',         -- CDKey 被兑换（解冻→扣除）
    'cdk_refund',         -- CDKey 过期退费（解冻）
    'withdraw',           -- 提现
    'integral_earn',      -- 积分获得
    'integral_decay',     -- 积分每日衰减
    'integral_adjust',    -- 管理员调整积分
    'gift',               -- 赠送
    'system'              -- 系统调整
  )),
  amount INTEGER NOT NULL CHECK(amount != 0),
  balance_after INTEGER NOT NULL,
  linked_tx_id INTEGER,                              -- 关联流水 ID
  order_id TEXT,                                     -- 关联订单号
  cdk_id INTEGER,                                    -- 关联 CDK ID
  withdraw_code_id INTEGER,                          -- 关联提现码 ID
  description TEXT,
  operator_user_id TEXT,                             -- 操作人
  trace_id TEXT NOT NULL,                            -- 请求追踪 ID
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_tx_server ON wallet_transactions(server_id);
CREATE INDEX idx_wallet_tx_type ON wallet_transactions(type);
CREATE INDEX idx_wallet_tx_currency ON wallet_transactions(currency_type);
CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at);
CREATE UNIQUE INDEX idx_wallet_tx_order_id ON wallet_transactions(order_id) WHERE order_id IS NOT NULL;
```

### 6.2 交易流水查询 API

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/me/transactions` | JWT | 用户流水，支持 `?currency_type=&type=&server_id=&page=&page_size=` |
| `GET /api/servers/:serverId/transactions` | JWT + `wallet.read` | 实例全用户流水 |
| `GET /api/me/transactions/export` | JWT | 导出 CSV |
| `GET /api/servers/:serverId/transactions/export` | JWT + `wallet.read` | 全服导出 CSV |

---

## 七、消费链路与大额管控

### 7.1 消费类型

| 消费 | 支付 | 说明 |
|------|:--:|------|
| 开 VIP | 余额 | 实例管理员定价，购买时赠送该等级门槛积分 |
| 买点券 | 余额 | 按实例兑换比例 |
| 买 CDKey | 余额 | 生成可转赠的点券/VIP/装备 CDKey |
| 商城购买 | 点券 | 仅点券，在该实例内 |
| 买服务器 | 余额 | 面向实例管理员，按原价（无折扣） |
| 提现 | 余额 | 所有用户，提交提现码申请，管理员核销后按比例到账 |

### 7.2 大额管控

| 规则 | 默认值 | 配置者 |
|------|:--:|:--:|
| 充值入口禁用阈值 | 余额 ≥ 1000 | 系统管理员 |
| 单日消费上限 | 648 元等值 | 系统管理员（平台），实例管理员仅可调低 |
| 管理员初始额度 | 1000 | 固定 |
| 提现比例 | 0.7 | 系统管理员 |

**消费可用余额检查**：所有消费操作（买 VIP、买点券、买 CDKey）检查的是可用余额（`balance - frozen_balance`），而非总余额。冻结部分不可用于消费。

### 7.3 余额兑换点券的双边流水

```
用户余额 1000 → 兑换 A 实例点券（比例 0.8）

流水 1: currency_type='balance', type='points_exchange', amount=-1000
流水 2: currency_type='points', type='points_exchange', amount=+800, linked_tx_id=流水1.id
```

### 7.4 充值超限行为

- 余额 980，CDK 充值 50 → 余额变为 1030，**允许**
- 之后 balance ≥ 1000 → **所有充值方式**（CDK 兑换 + 订单号充值，含管理后台操作）均拒绝
- 前端提示「余额已达上限（¥1000），请消费后再充值」
- 后端校验：充值前检查目标用户 `global_balances.balance >= recharge_max` → 返回 409

---

## 八、消费统计与精细化运营

### 8.1 消费统计 API

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/me/stats` | JWT | 按类型汇总、按月趋势、Top 消费实例 |
| `GET /api/servers/:serverId/stats` | JWT + `wallet.read` | 实例消费概况 |

### 8.2 CDK 批次追溯报表

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/admin/cdk/report` | JWT + `cdk.manage` | CDK 批次使用率、兑换用户、兑换时间线 |

### 8.3 异常流水告警

| 规则 | 条件 | 动作 |
|------|------|------|
| 单日大额流入 | 某用户单日 `admin_credit` + `cdk_recharge` > 200000 | 写入 `system_alerts` |
| 异常兑换频率 | CDK 批次 1h 兑换率 > 80% | 标记 `suspicious` |
| 负余额检测 | balance < 0 | 立即告警 |

---

## 九、防刷与安全设计

### 9.1 充值入口防刷

| 层级 | 措施 |
|------|------|
| CDK 兑换频率 | 同一用户 1 分钟 ≤ 3 次；同一 IP 5 分钟 ≤ 10 次 |
| CDK 复杂度 | 16 位字母数字，SHA-256 哈希存储 |
| CDK 单次使用 | 原子 UPDATE `WHERE used_at IS NULL` |
| CDK 批量生成限流 | 单次 ≤ 100，每日 ≤ 1000 |
| 订单号不可重复 | `order_id` UNIQUE 约束 |
| 充值入口禁用 | 余额 ≥ 1000 时不允许充值 |

### 9.2 SQL 注入防护

- Knex 参数化查询，禁止拼接
- 输入 Zod schema 校验（长度/字符集白名单）
- amount 范围校验

### 9.3 幂等性

- CDK 兑换：原子 UPDATE
- 订单号充值：UNIQUE 约束
- 每日领取/衰减：日期字段兜底

### 9.4 审计

- 所有变动写入 `wallet_transactions`（`operator_user_id` + `trace_id`）
- 管理端操作写入 `audit_logs`
- 流水表只读（无 DELETE/UPDATE）
- CDKey 全生命周期可追溯

### 9.5 积分反刷

- 生成 CDKey 时不发积分
- 积分在 CDKey 被兑换时发放
- CDKey 过期退费不涉及积分
- 消费产生积分后才衰减

---

## 十、前端 — 个人中心页面

### 10.1 `UserCenter.tsx` 页面结构

```
┌─────────────────────────────────────────────────────────┐
│  个人中心                                                │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   账户信息    │ │   我的余额    │ │   快捷操作    │   │
│  │ 用户名: xxx  │ │ ¥ 1,030      │ │ 🔑 改密码    │   │
│  │ 邮箱: xxx    │ │ 冻结: 50     │ │ 💳 CDK充值   │   │
│  │ 角色: 玩家   │ │ ──────────   │ │   (余额≥1000  │   │
│  │ 注册: xxx    │ │ 可用: 980    │ │    时禁用)   │   │
│  │              │ │ 总获得 8,500 │ │ 🎫 兑换CDKey  │   │
│  │              │ │ 总消费 7,470 │ │ 📦 我的订单  │   │
│  │              │ │              │ │ 🎁 物品兑换  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────────┤
│  📊 最近交易流水（5条）                   [查看全部 →]   │
│  07-27 生成CDKey    -50冻结  余额:1030  冻结:50        │
│  07-27 CDK充值      +50余额  余额:1080                 │
│  07-27 购买VIP      -300余额 余额:1030  积分+1501      │
│  07-26 余额兑点券    -200余额 余额:1330  点券+160(ARK)  │
│  07-26 每日领取      +200点券 点券:1000 (ARK)           │
├─────────────────────────────────────────────────────────┤
│  🎮 已绑定实例                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ ARK 生存  │ │ MC 创造   │ │ 七日杀    │               │
│  │ VIP3     │ │ VIP1     │ │ VIP0     │               │
│  │ 积分 4200│ │ 积分 800 │ │ 积分 150 │               │
│  │ 点券 5300│ │ 点券 1200│ │ 点券 300 │               │
│  │ [商城][VIP]│ │[商城][VIP]│ │[商城][VIP]│               │
│  └──────────┘ └──────────┘ └──────────┘               │
│                                                         │
│  💰 提现                                               │
│  可提现: ¥ 1,030 × 0.7 = ¥ 721    [申请提现]            │
└─────────────────────────────────────────────────────────┘
```

### 10.2 路由注册

| 路由 | 说明 |
|------|------|
| `/guild/center` | 玩家基座个人中心 |
| `/store/center` | 服主基座个人中心（含提现入口） |
| `/admin/center` | 管理基座个人中心 |
| `/guild/center/transactions` | 完整流水页（筛选 + CSV 导出） |
| `/store/center/transactions` | 同上 |
| `/admin/center/transactions` | 同上 |
| `/guild/center/stats` | 消费统计页 |

### 10.3 导航精简

| 原入口 | 变化 |
|--------|------|
| `/guild/me` | 301 → `/guild/center` |
| `/guild/profile` | 移除独立入口 |
| `/guild/orders` | 保留路由，个人中心加链接 |
| `/guild/cdk` | 保留路由，个人中心加 CDK 充值弹窗 |
| 底部 Tab「我的」 | → `/guild/center` |

---

## 十一、实例管理员配置页面

```
┌──────────────────────────────────────────────┐
│  实例经济配置 — ARK 生存                       │
├──────────────────────────────────────────────┤
│  VIP 定价                                    │
│  买断制: [ 300 ] 余额  ☑ 开放                │
│  订阅制: [ 30  ] 余额/月  ☑ 开放             │
│                                              │
│  点券兑换比例: [ 0.8 ] (100余额 = 80点券)     │
│  积分累计比例: [ 1.0 ] (1余额消费 = 1积分)     │
│                                              │
│  单日消费上限: [ 500 ] (≤ 平台上限 648)       │
│                                              │
│  [保存配置]                                   │
└──────────────────────────────────────────────┘
```

---

## 十二、系统管理员配置（平台级）

在 `/admin/settings` 新增经济配置区域：

```
┌──────────────────────────────────────────────┐
│  平台经济配置                                 │
├──────────────────────────────────────────────┤
│  充值入口禁用阈值: [ 1000 ] 元               │
│  单日消费上限:     [ 648  ] 元               │
│  提现比例:         [ 0.7  ] (70%)           │
│                                              │
│  [保存配置]                                   │
└──────────────────────────────────────────────┘
```

---

## 十三、完整 API 路由清单

### 余额相关

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/me/balance` | JWT | 查询当前用户余额（含冻结） |
| `GET /api/me/balance/summary` | JWT | 余额汇总（跨实例点券 + VIP 状态） |

### 点券相关

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/servers/:serverId/points` | JWT | 查询该实例点券余额 |
| `POST /api/servers/:serverId/points/exchange` | JWT | 余额兑换点券 `{amount}` |
| `POST /api/servers/:serverId/points/grant` | JWT + `instance_admin` | 管理员发放点券 `{user_id, amount}` |

### VIP 相关

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/servers/:serverId/vip/status` | JWT | 查询 VIP 购买状态 + 积分 |
| `POST /api/servers/:serverId/vip/purchase` | JWT | 购买 VIP `{type: 'lifetime'|'monthly'}` |

### CDK 相关

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `POST /api/cdk/redeem` | JWT | 兑换 CDK（已有，扩展类型） |
| `POST /api/cdk/generate` | JWT | 用户自生成转赠 CDKey `{type, server_id, amount?}` |
| `POST /api/admin/cdk/generate` | JWT + `cdk.manage` | 管理端生成 CDK（已有，扩展类型） |
| `GET /api/admin/cdk/report` | JWT + `cdk.manage` | CDK 批次追溯报表 |

### 提现相关

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `POST /api/me/withdraw` | JWT | 申请提现 `{amount}` → 返回提现码 |
| `GET /api/me/withdraw/history` | JWT | 提现记录 |
| `GET /api/admin/withdraw/pending` | JWT + `wallet.credit` | 待审批提现列表 |
| `POST /api/admin/withdraw/:code/approve` | JWT + `wallet.credit` | 核销提现码（确认打款） |
| `POST /api/admin/withdraw/:code/reject` | JWT + `wallet.credit` | 拒绝提现（解冻退回） |

### 流水/统计

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/me/transactions` | JWT | 交易流水查询 |
| `GET /api/me/transactions/export` | JWT | 导出 CSV |
| `GET /api/servers/:serverId/transactions` | JWT + `wallet.read` | 实例全用户流水 |
| `GET /api/servers/:serverId/transactions/export` | JWT + `wallet.read` | 全服导出 |
| `GET /api/me/stats` | JWT | 消费统计 |
| `GET /api/servers/:serverId/stats` | JWT + `wallet.read` | 实例消费概况 |

### 定价配置

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/servers/:serverId/pricing` | JWT | 查询实例定价 |
| `PUT /api/servers/:serverId/pricing` | JWT + `instance_admin` | 更新实例定价 |

### 管理端

| 端点 | 鉴权 | 说明 |
|------|------|------|
| `POST /api/servers/:serverId/wallet/credit` | JWT + `wallet.credit` | 订单号充值 `{user_id, amount, order_id}` |
| `PATCH /api/servers/:serverId/integrals/:userId` | JWT + `instance_admin` | 管理员调整用户积分 |

---

## 十四、开发事项

| # | 事项 | 类型 |
|---|------|:--:|
| 1 | 新建 `global_balances` migration | 后端 |
| 2 | 新建 `instance_points` migration | 后端 |
| 3 | 新建 `user_integrals` migration | 后端 |
| 4 | 新建 `user_vip_status` migration | 后端 |
| 5 | 新建 `instance_pricing` migration | 后端 |
| 6 | 扩展 `cdk_keys` 表字段 migration | 后端 |
| 7 | 新建 `wallet_transactions` migration | 后端 |
| 8 | 新建 `withdraw_codes` migration | 后端 |
| 9 | 新建 `balanceService`（CRUD + 冻结/解冻 + 可用余额校验 + 充值超限检查 + last_income_at 更新） | 后端 |
| 10 | 新建 `pointsService`（CRUD + 管理员发放） | 后端 |
| 11 | 新建 `integralService`（积分 + VIP 等级区间判定 + 每日衰减） | 后端 |
| 12 | 新建 `vipService`（购买 + 状态管理 + 赠送积分） | 后端 |
| 13 | 新建 `pricingService`（定价配置 CRUD） | 后端 |
| 14 | 新建 `withdrawService`（提现码生成/账期校验/审批核销/过期取消） | 后端 |
| 15 | 改造 `walletService`（写操作写入流水 + linked_tx_id） | 后端 |
| 16 | 扩展 CDK redeem（balance/points/vip 类型 + 积分在兑换时发放） | 后端 |
| 17 | 新增 CDK generate 路由（用户自生成，冻结余额） | 后端 |
| 18 | 新增 CDK 过期退费定时任务 | 后端 |
| 19 | 新增 CDK 兑换频率限制中间件 | 后端 |
| 20 | 新增余额兑换点券路由 | 后端 |
| 21 | 新增管理员发放点券路由 | 后端 |
| 22 | 新增 VIP 购买路由 | 后端 |
| 23 | 新增管理员调整积分路由 | 后端 |
| 24 | 新增提现路由（申请 + 管理端审批/拒绝） | 后端 |
| 25 | 新增提现码过期自动取消定时任务 | 后端 |
| 26 | 新增订单号充值路由 | 后端 |
| 27 | 新增交易流水查询 API | 后端 |
| 28 | 新增消费统计 API | 后端 |
| 29 | 新增余额查询 + 汇总 API | 后端 |
| 30 | 新增实例定价配置 API | 后端 |
| 31 | 新增 CDK 批次追溯报表 API | 后端 |
| 32 | 新增积分每日衰减定时任务 | 后端 |
| 33 | 新增 VIP 订阅过期检查定时任务 | 后端 |
| 34 | 新增余额超限/单日消费上限校验中间件 | 后端 |
| 35 | 新增异常告警定时任务 | 后端 |
| 36 | 实例管理员创建时自动 seed 1000 初始额度 | 后端 |
| 37 | 现有 `user_wallets` 数据迁入新表（含 VIP 数据） | 后端 |
| 38 | 新建 `UserCenter.tsx`（账户 + 余额含冻结 + 快捷操作含充值超限状态 + 提现入口） | 前端 |
| 39 | 新建 `UserTransactions.tsx`（筛选 + CSV 导出 + 币种标签） | 前端 |
| 40 | 新建 `CdkRechargeModal.tsx`（CDK 充值弹窗，含超限禁用态） | 前端 |
| 41 | 新建 `CdkGenerateModal.tsx`（用户自生成转赠 CDKey 弹窗） | 前端 |
| 42 | 新建 `SpendingCharts.tsx`（消费统计图表） | 前端 |
| 43 | 新建 `WithdrawModal.tsx`（提现弹窗，显示提现比例/实际到账/账期状态） | 前端 |
| 44 | 新建管理端提现审批页面（待审批列表 + 核销/拒绝操作） | 前端 |
| 45 | 新建实例经济配置组件 | 前端 |
| 46 | 新建平台经济配置组件（系统管理员 `/admin/settings`） | 前端 |
| 47 | 注册全部路由 | 前端 |
| 48 | 调整 Layout 导航 | 前端 |
| 49 | 旧路由 301 重定向 | 前端 |
| 50 | 更新 schema 类型定义 | 公共 |

---

## 十五、注意事项

1. **数据迁移向前兼容**：新增表/字段，不动现有结构；`user_wallets` 保留备查
2. **CDK 安全**：SHA-256 哈希，通用错误提示
3. **幂等性**：CDK 原子 UPDATE + 订单号 UNIQUE + 日期兜底
4. **流水只读**：无 DELETE/UPDATE 路由
5. **积分在兑换时发放**：生成 CDKey 时不发，避免过期退费难题
6. **linked_tx_id**：双边操作双向关联
7. **充值超限逻辑**：只禁用入口，不截断已成功的充值；管理后台充值同样检查目标用户余额
8. **提现码机制**：当前不支持在线支付，提现采用提现码模式——用户申请→生成提现码→管理员打款后核销；每笔提现均需审批
9. **提现账期限制**：最后一笔收入类交易完成后需等待 7 天方可提现，防止快进快出
10. **管理员初始额度**：创建实例管理员时自动 seed
11. **点券与积分无关**：点券消费不计入积分
12. **积分衰减保底**：`current_integral` 衰减到 0 为止，不出现负值
13. **消费可用余额**：所有消费检查 `balance - frozen_balance`，冻结部分不可用
