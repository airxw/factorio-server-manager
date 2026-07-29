---
type: plan
title: 角色权限与经济体系系统设计方案（玩家/腐竹/平台 三方权责与资金流转）
date: 2026-07-27
status: approved（2026-07-27 人类裁决批准 D1-D4 与推荐定价；进入 s0201 契约阶段）
decisions:
  D1: fuzhu_equals_instance_admin          # 腐竹 = instance_admin（不新增角色）
  D2: platform_collects_then_splits         # 仅平台收钱再分账（不新建腐竹直充通道）
  D3: dual_direction_billing                # 双向计费：平台收腐竹资源费 + 腐竹收玩家续费
  D4: self_hosted_node_free_and_autonomous  # 自带节点完全免费 + 完全自主
related:
  - docs/plans/business-logic-system-completion-plan.md
  - docs/plans/binding-unification-multi-role-plan.md
  - docs/plans/v4.11.0_commercialization_upgrade_plan.md
  - public/schema/user-schema.json
  - public/schema/user-wallets-schema.json
  - public/schema/vip-permissions-schema.json
  - public/schema/role-permission-templates-schema.json
  - public/schema/permission-points-schema.json
  - public/schema/recharge-cdks-schema.json
  - public/schema/instance-renewals-schema.json
  - public/schema/bindings-schema.json
tags: [plan, role-permission, vip, wallet, economy, instance-admin, platform-fee, self-hosted, settlement, admin-tier]
---

# 角色权限与经济体系系统设计方案（玩家/腐竹/平台 三方权责与资金流转）

> 本方案遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。
> 文档定位：在现有三角色体系（v4.17.0 多角色重构）+ 玩家 VIP/钱包/CDK/续费（business-logic-system-completion-plan）已落地基础上，**补齐腐竹（instance_admin）跨实例聚合账户 + 平台分账 + 腐竹等级分级 + 自带节点豁免**四个缺口，形成玩家/腐竹/平台三方权责与资金流转闭环。

---

## 0. 决策上下文

### 0.1 用户已确认的 4 个核心架构方向

经 s0101 需求闭合结构化 + AskUserQuestion 人类裁决，确认以下大方向（不可违背）：

1. **腐竹角色映射 = instance_admin**：项目三角色体系（user/instance_admin/server_admin）中，instance_admin 就是腐竹；server_admin 是平台方/超管，不参与腐竹业务。
2. **资金流转路径 = 仅平台收钱再分账**：玩家通过 `recharge_cdks`（卡商机制）充值到平台 `user_wallets`，平台按 `settlement_rules` 定期分账给腐竹；腐竹不直接收款，降低合规风险。
3. **管理员费用语义 = 双向**：
   - 上游（平台 → 腐竹）：腐竹使用平台服务器资源，按实例/资源占用向平台付费（扣 `admin_wallets`）
   - 下游（腐竹 → 玩家）：玩家续费实例，付费给腐竹（已有 `instance_renewals`，扣款源切换）
4. **自带节点计费 = 完全免费 + 完全自主**：自带 daemon 节点的腐竹不收资源占用费，自主管理进程/备份/资源，仅受平台基础规则约束（账号/审计/合规）。

### 0.2 现有契约盘点（不重复造轮子）

| 模块 | 现有契约 | 复用/扩展策略 |
|------|---------|--------------|
| 三角色体系 | `users.roles` + `active_role` (v4.17.0) | 复用，不新增角色 |
| 玩家 VIP | `bindings.vip_level` (0-5) + `vip_permissions` + `user_vip_points` | 复用，仅给推荐定价 |
| 玩家钱包 | `user_wallets`（按 user_id+server_id 作用域） | 复用，不动 |
| 充值 CDK | `recharge_cdks` + `recharge_cdk_batches`（卡商机制） | ⚠️ 契约先行、零实现（无 DB 迁移/无服务代码，2026-07-27 核实），需从零实现服务层，批次支持腐竹归属 |
| 实例续费 | `instance_renewals`（定价=daily×tier×vip） | ⚠️ 契约先行、零实现（同上），需从零实现服务层，扣款源扩展支持 `admin_wallets` |
| 角色权限模板 | `role_permission_templates` + `permission_points`（~90 权限点） | 复用，新增 9 个权限点 |
| 绑定统一表 | `bindings`（v4.17.0 binding_type + scope_type） | 复用，不动 |

### 0.3 方案核心理念

> 三角色体系已落地，本方案不引入新角色，仅在 `instance_admin` 上叠加「腐竹等级（admin_tier）」维度承载权限分级，并通过新增 `admin_wallets` 表实现腐竹跨实例聚合账户。资金流转坚持「平台收钱再分账」的合规模式，避免双线收款带来的对账复杂度与法律风险。自带节点走「免费 + 自主」路径，仅受基础规则约束。

---

## 1. 角色权限体系

### 1.1 三角色权责边界

#### 1.1.1 `user`（玩家）

- **权限范围**：
  - 个人账号管理（注册/登录/密码修改/邮箱）
  - 玩家门户 `/guild` 操作（绑定角色、购买商品、CDK 兑换、投票、领券）
  - 钱包操作（每日领取、查询余额、商品消费）
  - 实例续费（仅自己所属实例，扣 `user_wallets`）
- **限制**：
  - 不可创建/管理实例
  - 不可访问管理后台 `/admin` / `/store`
  - 商品消费受 VIP 等级限制（`max_quality` / `daily_limit`）
  - 不可生成 CDK（任何类型）
- **管理职责**：无（仅自我管理）

#### 1.1.2 `instance_admin`（腐竹）

- **权限范围**：
  - 创建/管理自有实例（数量上限由 `admin_tier` 决定）
  - 管理旗下玩家（封禁/解封/查询玩家历史）
  - 配置商店商品（`shop_items` CRUD，限自有实例）
  - 生成发卡 CDK（`cdk_codes`，限自有实例）
  - 生成充值 CDK（`recharge_cdks`，需 `server_admin` 授权批次）
  - 查看旗下实例运营数据（监控/审计/聊天记录）
  - 接收平台分账（入 `admin_wallets`）
  - 向平台支付资源占用费（扣 `admin_wallets`，针对 `node_source=platform_managed` 的实例）
  - 提现申请（`admin_wallets.balance` → 平台线下转账）
- **限制**：
  - 不可管理其他腐竹的实例
  - 不可访问 `/admin/platform`（平台全局统计/系统设置）
  - 不可修改系统内置账号
  - 受 `admin_tier` 限额约束（实例数/玩家数/资源上限/API 密钥数）
  - `admin_wallets` 与 `user_wallets` 资金隔离，不可互转
- **管理职责**：维护旗下实例稳定运行、处理玩家纠纷、配合审计、按时支付资源费

#### 1.1.3 `server_admin`（平台方/超管）

- **权限范围**：
  - 全局实例/玩家/腐竹管理（含跨腐竹）
  - 系统配置（`system_config` CRUD）
  - 生成充值 CDK 批次（`recharge_cdk_batches`）
  - 节点（daemon）接入与管理
  - 分账规则配置与执行（`settlement_rules`）
  - 全局审计日志查询（含所有 `admin_wallet_transactions`）
  - 腐竹等级（`admin_tier`）分配与调整
  - 腐竹提现申请审批
- **限制**：
  - 系统内置账号密码不可修改
  - 8080 端口对外禁用
  - 破坏性操作（DELETE）必须先清理磁盘文件再删 DB 记录
  - public/ 路径修改须人类显式授权
- **管理职责**：平台运维、合规审计、腐竹支持、节点健康监控

### 1.2 角色权限边界矩阵

| 资源/操作 | user | instance_admin | server_admin |
|----------|------|-----------------|--------------|
| 创建实例 | ❌ | ✅（限额内） | ✅ |
| 续费自有实例（user_wallets 扣款） | ✅ | ✅ | ✅ |
| 续费自有实例（admin_wallets 扣款） | ❌ | ✅ | ✅ |
| 续费他人实例 | ❌ | ❌ | ✅ |
| 管理玩家（旗下） | ❌ | ✅ | ✅（全部） |
| `shop_items` CRUD | ❌ | ✅（自有实例） | ✅ |
| `recharge_cdk_batches` 生成 | ❌ | ❌ | ✅ |
| `recharge_cdks` 生成 | ❌ | ✅（基于授权批次） | ✅ |
| `cdk_codes` 生成 | ❌ | ✅（自有实例） | ✅ |
| `admin_wallets` 查询（自己） | ❌ | ✅ | ✅（全部） |
| `admin_wallets` 提现申请 | ❌ | ✅ | ❌ |
| `admin_wallets` 提现审批 | ❌ | ❌ | ✅ |
| `admin_tier` 分配 | ❌ | ❌ | ✅ |
| 系统配置 | ❌ | ❌ | ✅ |
| 节点管理 | ❌ | ❌ | ✅ |
| 自带节点接入 | ❌ | ✅（需 server_admin 审核） | ✅ |
| 分账规则配置 | ❌ | ❌ | ✅ |
| 分账结算执行 | ❌ | ❌ | ✅ |

### 1.3 权限点扩展建议

现有 `permission_points` 已覆盖 ~90 个权限点（30+ 类目）。需新增以下 9 个权限点（追加到 `permission-points-schema.json` 的 `category` 枚举与种子数据）：

| code | category | description |
|------|----------|-------------|
| `admin_wallet.view` | wallet | 查看腐竹账户余额与流水 |
| `admin_wallet.withdraw` | wallet | 腐竹账户提现申请 |
| `admin_wallet.settle` | wallet | 平台执行分账结算（仅 server_admin） |
| `admin_tier.assign` | quota | 分配/调整腐竹等级（仅 server_admin） |
| `recharge_cdk_batch.create` | cdk | 生成充值 CDK 批次（仅 server_admin） |
| `recharge_cdk_batch.audit` | cdk | 审计充值 CDK 批次 |
| `platform_fee.collect` | wallet | 平台资源费扣收 |
| `platform_fee.exempt` | wallet | 豁免资源费（自带节点场景） |
| `node.self_hosted.manage` | node | 自带节点自主管理 |

`role_permission_templates` 关联建议：
- `instance_admin` → `admin_wallet.view` / `admin_wallet.withdraw` / `recharge_cdk_batch.audit` / `node.self_hosted.manage`
- `server_admin` → 全部 9 项

---

## 2. VIP 系统设计

### 2.1 玩家 VIP（已有，给出推荐定价）

复用 `bindings.vip_level` (0-5) + `vip_type` (permanent/monthly/quarterly/yearly/trial) + `vip_permissions`。

#### 2.1.1 时间限制规则与收费标准（建议）

| vip_type | 有效期 | 推荐定价（点券） | 等价人民币（100=1 元） | 备注 |
|----------|-------|----------------|---------------------|------|
| trial | 3 天 | 0 | ¥0 | 系统赠送，每用户限 1 次 |
| monthly | 30 天 | 3000 | ¥30 | 基础档 |
| quarterly | 90 天 | 8000 | ¥80 | 83 折 |
| yearly | 365 天 | 28000 | ¥280 | 77 折 |
| permanent | 36500 天（视为永久） | 98000 | ¥980 | 一次性买断 |

> 100 点券 = 1 元等价（与 `shop_orders.total_price` 单位一致，见 `recharge-cdks-schema.json`）。

#### 2.1.2 VIP 等级权益（已有契约，给出推荐值）

| vip_level | display_name | max_quality | daily_limit | daily_reward_amount | 商城折扣 | 续费折扣 |
|-----------|-------------|-------------|-------------|---------------------|---------|---------|
| 0 | 普通用户 | normal | null | 100 | 1.0 | 1.0 |
| 1 | VIP1 | uncommon | 50 | 200 | 0.95 | 0.95 |
| 2 | VIP2 | rare | 100 | 400 | 0.9 | 0.9 |
| 3 | VIP3 | epic | 200 | 800 | 0.85 | 0.85 |
| 4 | VIP4 | legendary | 500 | 1600 | 0.8 | 0.8 |
| 5 | VIP5 | legendary | null | 3200 | 0.75 | 0.75 |

> 注：`max_quality` / `daily_limit` / `daily_reward_amount` 字段已在 `vip_permissions` schema 中存在，本表为推荐配置值。
> `daily_reward_amount` 阶梯已在 schema 描述中给出（VIP0=100 ... VIP5=3200），与本表一致。

#### 2.1.3 VIP 升级路径（已有 `user_vip_points` 表，给出推荐阈值）

| 升级路径 | 推荐积分阈值 | 等价消费 | 触发动作 |
|---------|------------|---------|---------|
| 0 → 1 | 1000 | ¥10 | `vipPointService.checkAndUpgradeVip` |
| 1 → 2 | 5000 | ¥50 | 同上 |
| 2 → 3 | 20000 | ¥200 | 同上 |
| 3 → 4 | 80000 | ¥800 | 同上 |
| 4 → 5 | 300000 | ¥3000 | 同上 |

> 积分获取规则建议：1 元消费 = 100 积分；每日签到 = 10 积分；推荐新用户 = 500 积分。

### 2.2 腐竹权限分级（新增 `admin_tiers` 表）

不复用 `vip_permissions`（专为玩家品质购买设计），新增 `admin_tiers` 表承载腐竹等级。

#### 2.2.1 腐竹等级定义（建议）

| admin_tier | display_name | 实例上限 | 玩家上限/实例 | 资源费折扣 | 分账比例 | 高级功能 | API 密钥 |
|-----------|-------------|---------|--------------|-----------|---------|---------|---------|
| 0 | 试用腐竹 | 1 | 50 | 1.0 | 50% | ❌ | 0 |
| 1 | 基础腐竹 | 3 | 200 | 1.0 | 70% | ❌ | 1 |
| 2 | 标准腐竹 | 10 | 1000 | 0.9 | 80% | ✅ | 3 |
| 3 | 专业腐竹 | 50 | 5000 | 0.8 | 85% | ✅ | 10 |
| 4 | 旗舰腐竹 | 不限 | 不限 | 0.7 | 90% | ✅ | 不限 |

> 「高级功能」= 跨服投票 / 跨服聊天 / 数据分析仪表盘 / 自带节点接入。

#### 2.2.2 腐竹等级功能矩阵

| 功能模块 | tier 0 | tier 1 | tier 2 | tier 3 | tier 4 |
|---------|--------|--------|--------|--------|--------|
| 实例创建 | 1 个 | 3 个 | 10 个 | 50 个 | 不限 |
| 玩家管理 | 50/实例 | 200/实例 | 1000/实例 | 5000/实例 | 不限 |
| 自定义商城 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 跨服投票 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 跨服聊天 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 云备份 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 数据分析仪表盘 | ❌ | 基础 | 基础 | 高级 | 高级 |
| 自带节点接入 | ❌ | ❌ | ✅ | ✅ | ✅ |
| API 密钥 | 0 | 1 | 3 | 10 | 不限 |
| 优先技术支持 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 即时分账结算 | ❌ | ❌ | ❌ | ❌ | ✅ |

#### 2.2.3 腐竹等级升降级规则

- **升级触发**：
  - 自动：基于「近 30 天日均活跃玩家数 + 月度分账流水」双指标，达到阈值自动升级
  - 手动：`server_admin` 通过 `/admin/admin-tiers` 手动调整
- **降级触发**：
  - 自动：连续 30 天未活跃 → 自动降级（最低降到 tier 0）
  - 自动：欠费超过 7 天 → 自动降级一级
  - 手动：`server_admin` 手动调整
- **影响范围**：
  - 升级：立即生效，限额放宽
  - 降级：实例数超限时禁止创建新实例（已有实例保留），30 天内未升级则冻结超额实例；玩家数超限时禁止新玩家绑定（已有玩家保留）

#### 2.2.4 `admin_tiers` 表设计（新增）

```yaml
admin_tiers:
  id: integer PK
  tier: integer (0-4, UNIQUE)  # 腐竹等级
  display_name: string  # 展示名
  max_instances: integer (≥1, nullable)  # 实例上限，null=不限
  max_players_per_instance: integer (≥1, nullable)  # 玩家上限/实例，null=不限
  resource_fee_discount: number (0-1)  # 资源费折扣（1.0=无折扣）
  settlement_share: number (0-1)  # 腐竹分账比例（如 0.7=70%）
  advanced_features: array  # 高级功能列表 JSON
  max_api_keys: integer (≥0, nullable)  # API 密钥上限，null=不限
  instant_settlement: boolean  # 是否支持即时分账结算
  description: string  # 等级描述
  created_at: datetime
  updated_at: datetime
```

---

## 3. 服务器资源管理

### 3.1 自带节点用户权限（完全自主管理模式）

#### 3.1.1 节点接入方式

复用现有 daemon（节点端）架构，**扩展 `nodes` 表新增 `node_source` 字段**区分来源：

- `platform_managed`：平台提供的服务器资源（计费）
- `self_hosted`：腐竹自带 daemon 节点（免费，需 `server_admin` 审核接入）

#### 3.1.2 自带节点腐竹的完全自主权限

| 操作类别 | 权限 | 说明 |
|---------|-----|------|
| 实例管理 | ✅ 完全自主 | 创建/删除/重启/备份/恢复 |
| 进程管理 | ✅ 完全自主 | 启动/停止/重启 |
| 文件管理 | ✅ 完全自主 | 上传/下载/编辑/删除 |
| 资源监控 | ✅ 完全可见 | CPU/内存/磁盘/网络 |
| 模组管理 | ✅ 完全自主 | 安装/卸载/启用/禁用 |
| 命令执行 | ✅ 完全自主 | RCON 命令 |
| 配置修改 | ✅ 完全自主 | pack.yaml / server.properties 等 |
| 玩家管理 | ✅ 完全自主 | 封禁/解封/白名单 |
| 资源费 | ✅ 完全豁免 | 不扣 `admin_wallets` |

#### 3.1.3 自带节点的限制（仅基础规则约束）

- ❌ 不可绕过账号认证（必须登录）
- ❌ 不可禁用审计日志（操作必须可追溯，写入 `audit_logs`）
- ❌ 不可修改 `system_config` 中的全局安全策略
- ❌ 不可访问其他腐竹的实例数据
- ❌ 8080 端口对外禁用
- ❌ 破坏性操作（DELETE）必须先清理磁盘再删 DB 记录
- ❌ 不可对外提供 daemon 服务（仅自用，防滥用为他人提供算力）

### 3.2 管理员实例计费（平台收腐竹，针对 `platform_managed` 实例）

#### 3.2.1 实例数量计算规则

- **计费单位**：实例·天（instance × day）
- **计费范围**：仅 `node_source=platform_managed` 的实例
- **计费起点**：实例创建时刻（`servers.created_at`）
- **计费终点**：实例删除时刻（或永久实例按 36500 天预扣）
- **排除项**：
  - `node_source=self_hosted` 的实例（免费）
  - `renewal_type=gift` 的赠送续费时段（`amount_paid=0`）
  - trial 实例（试用期）

#### 3.2.2 计价标准（建议）

| 实例规格 | daily_price（点券） | 等价/天 | 适用场景 |
|---------|-------------------|--------|---------|
| micro | 50 | ¥0.5 | 1-2 人小服 |
| small | 100 | ¥1 | 5-10 人 |
| medium | 300 | ¥3 | 20-50 人 |
| large | 800 | ¥8 | 50-100 人 |
| xlarge | 2000 | ¥20 | 100+ 人 |

> `daily_price` 由 `pack.business.instance.pricing.daily_price` 配置（已有契约，见 `instance-renewals-schema.json`），本表为推荐值。

#### 3.2.3 费用扣除机制

**预付费模式**（与现有 `instance_renewals` 一致）：

1. 腐竹发起续费请求（`POST /api/admin/wallet/renew-instance`）
2. 系统校验 `admin_wallets.balance ≥ 应付金额`
3. 应用折扣链：
   - 阶梯折扣：`duration_days ≥ 90` → 0.9；`≥ 365` → 0.8（来自 `pack.business.instance.pricing.tier_discounts`）
   - 腐竹等级折扣：tier 0/1/2/3/4 → 1.0/1.0/0.9/0.8/0.7（来自 `admin_tiers.resource_fee_discount`）
   - VIP 折扣：腐竹在自己实例上 VIP 等级 = 5（管理员不受限，已有规则），故此处折扣 = 1.0
   - 自带节点豁免：`node_source=self_hosted` → `amount_paid=0`
4. 扣款：`admin_wallets.balance -= amount_paid`
5. 写入 `instance_renewals`（`use_wallet=true`, `user_id=腐竹ID`，新增字段 `wallet_source='admin_wallets'` 区分扣款源）
6. 延长：`servers.expires_at = max(old_expires_at, now) + duration_days`

**欠费处理**：

- 余额不足 → 续费请求被拒（402 Payment Required）
- 实例过期后 7 天宽限期（`expiry_grace_until`，已有契约）
- 宽限期内可补缴恢复
- 宽限期满 → 实例停止运行（不删除数据）
- 再 30 天未补缴 → 实例归档（数据备份后清理磁盘文件，DB 记录保留）

#### 3.2.4 `instance_renewals` 表扩展

新增字段（不破坏现有契约，向后兼容）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `wallet_source` | enum ['user_wallets', 'admin_wallets'] | 扣款源（默认 `user_wallets`，腐竹续费自有实例时为 `admin_wallets`） |
| `admin_tier_discount_applied` | number (0-1) | 应用的腐竹等级折扣（1.0=无折扣，审计用） |
| `node_source_at_renewal` | enum ['platform_managed', 'self_hosted'] | 续费时节点的来源标记（审计用，便于追溯豁免依据） |

### 3.3 `admin_wallets` 表设计（新增）

```yaml
admin_wallets:
  id: integer PK
  admin_user_id: string UUID (FK users.id, UNIQUE)  # 一个腐竹一个账户
  balance: integer (≥0)  # 当前可用余额（可提现/可消费）
  pending_balance: integer (≥0)  # 待结算分账余额（冻结期内，不可提现/不可消费）
  owed_amount: integer (≥0)  # 欠款金额（退款时已分账资金不足，由后续分账自动抵扣）
  total_earned: integer  # 累计分账收入
  total_spent: integer  # 累计资源费支出
  total_withdrawn: integer  # 累计提现
  settlement_cycle: enum [daily, weekly, monthly]  # 结算周期（默认 daily）
  last_settled_at: datetime (nullable)  # 上次结算时间
  created_at: datetime
  updated_at: datetime
```

约束：
- `balance` + `pending_balance` ≥ 0（不可负）
- `owed_amount` > 0 时优先从 `pending_balance` 抵扣，再从 `balance` 抵扣
- 余额变更必须使用 DB 事务（BEGIN → 校验 → 扣款 → 写流水 → COMMIT），加行锁防并发超扣

---

## 4. 经济流转体系

### 4.1 资金流转全景图

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │                  平台 (server_admin)  —— 唯一收款方                    │
   │   recharge_cdk_batches 生成  →  卡商付费  →  user_wallets 增加点券     │
   │   settlement_rules 配置  →  分账规则匹配  →  分账给腐竹 (admin_wallets) │
   └────────┬───────────────────────────────────────────────┬─────────────┘
            │ 玩家充值 (CDK 兑换)                              │ 平台资源费扣收
            ▼                                                ▲ (扣 admin_wallets.balance)
   ┌──────────────────────┐                                  │
   │   user_wallets       │  ── 玩家消费 / 续费 ──→  平台收款  │
   │  (按 user_id+server_id)│                                │
   └──────────────────────┘                                  │
            │                                                │
            │ 玩家续费实例 (instance_renewals,                │
            │              wallet_source=user_wallets)         │
            ▼                                                │
   ┌──────────────────────────────────────────────────────────┴────────────┐
   │                 腐竹 (instance_admin)                                   │
   │                 admin_wallets (跨实例聚合账户)                          │
   │   收入侧: 平台分账 (T+7 冻结期)  →  pending_balance  →  balance          │
   │   支出侧: 续费自有实例 (扣 balance) + 提现申请 (扣 balance)                │
   └─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 充值流转路径（仅平台收钱再分账）

#### 4.2.1 玩家充值流程（`recharge_cdks` 契约已定义，服务层需从零实现）

1. `server_admin` 生成充值 CDK 批次（`recharge_cdk_batches`）
2. 卡商线下向平台付费购买批次，转卖给玩家
3. 玩家在钱包页输入 CDK 码 → 校验通过 → 点券入 `user_wallets.balance`
4. 平台获得真实货币（卡商付费），`user_wallets` 增加虚拟点券

#### 4.2.2 分账规则（新增 `settlement_rules` 表）

```yaml
settlement_rules:
  id: integer PK
  rule_name: string  # 规则名（如 "Minecraft 标准腐竹"）
  scope_type: enum [instance, game_type, global]  # 作用域
  scope_ref: string (nullable)  # 作用域引用（instance_id / game_type / null=global）
  admin_tier: integer (0-4, nullable)  # 适用腐竹等级，null=全部
  platform_share: number (0-1)  # 平台分成比例
  admin_share: number (0-1)  # 腐竹分成比例（platform_share + admin_share = 1.0）
  min_settlement_amount: integer  # 最低结算金额（低于此值累计到下次）
  settlement_delay_hours: integer  # 结算延迟（冻结期，默认 168h=7 天）
  effective_from: datetime
  effective_until: datetime (nullable)  # null=永久有效
  priority: integer  # 优先级（多规则匹配时取最高）
  created_at: datetime
  updated_at: datetime
```

规则匹配算法（按优先级从高到低）：
1. `scope_type=instance` + `scope_ref=具体实例ID` + `admin_tier=具体等级`
2. `scope_type=game_type` + `scope_ref=具体游戏类型` + `admin_tier=具体等级`
3. `scope_type=global` + `admin_tier=具体等级`
4. `scope_type=instance` + `scope_ref=具体实例ID`（不限等级）
5. `scope_type=game_type` + `scope_ref=具体游戏类型`（不限等级）
6. `scope_type=global`（不限等级）

未匹配到规则时，默认 `platform_share=1.0`（不分账给腐竹）。

#### 4.2.3 分账结算流程

1. 玩家消费（购买商品 / 续费实例）→ 写入 `shop_orders` / `instance_renewals`
2. **异步任务**（每小时扫描）`settlementRunner`：
   - 查询已结算订单的 `instance_id` 对应的 `instance_admin`
   - 按适用 `settlement_rule` 计算腐竹应得分账
   - 写入 `admin_wallets.pending_balance`（冻结期 7 天）
   - 写入 `settlement_records`（结算记录）
3. **冻结期满任务**（每小时扫描）`pendingBalanceReleaser`：
   - 查询 `settlement_records.settled_at + settlement_delay_hours < now` 的记录
   - 迁移 `pending_balance → balance`
   - 标记 `settlement_records.status=released`
4. 腐竹可申请提现（`admin_wallets.balance` → 提现申请单）

#### 4.2.4 `settlement_records` 表设计（新增）

```yaml
settlement_records:
  id: integer PK
  admin_user_id: string UUID (FK users.id)  # 腐竹ID
  source_type: enum [shop_order, instance_renewal]  # 来源类型
  source_ref: string  # 关联订单ID/续费记录ID
  instance_id: string UUID  # 实例ID
  order_amount: integer  # 订单总金额
  platform_share_amount: integer  # 平台分成
  admin_share_amount: integer  # 腐竹分成
  rule_id: integer (FK settlement_rules.id)  # 应用规则
  rule_snapshot: string (JSON)  # 规则快照（防规则后续修改导致追溯失真）
  status: enum [pending, released, reversed]  # 状态：冻结中/已释放/已冲正
  settled_at: datetime  # 结算时间
  released_at: datetime (nullable)  # 释放时间
  reversed_at: datetime (nullable)  # 冲正时间（退款触发）
  reversed_reason: string (nullable)
  created_at: datetime
```

#### 4.2.5 发卡兑换（CDK）两种模式

**模式 A：平台统一卡**（`recharge_cdks` 契约已定义，服务层需从零实现）
- `server_admin` 生成，`face_value` 已定，玩家兑换入 `user_wallets`
- 资金流：卡商 → 平台，玩家获得点券
- 适用：全局通用充值

**模式 B：腐竹发卡**（已有 `cdk_codes` 表，不改动）
- `instance_admin` 生成 `cdk_codes`（游戏内物品卡），玩家兑换触发 RCON 命令发放物品
- 资金流：玩家向腐竹支付（线下），腐竹发卡，玩家获得游戏物品
- 平台不参与资金流转，仅记录发放审计
- 适用：腐竹自主运营工具，不涉及 `admin_wallets`

> 模式 B 的资金流不进入 `admin_wallets`，仅作为腐竹运营工具。如需纳入平台分账体系，需走模式 A（`recharge_cdks` + 分账规则）。

### 4.3 腐竹账户资金支付管理员费用

#### 4.3.1 可支付场景

✅ **腐竹向平台支付资源占用费**（实例续费，已有 `instance_renewals`，扣款源扩展为 `admin_wallets`）
✅ **腐竹向平台支付高级功能订阅费**（如云备份、跨服投票，按月扣款）
✅ **腐竹向平台支付 API 调用费**（按量计费，每万次扣 N 点券）
✅ **腐竹向平台支付即时结算手续费**（tier 4 专属，提现手续费 5%）

#### 4.3.2 不可支付场景

❌ 腐竹账户资金不可转给他腐竹（防洗钱）
❌ 腐竹账户资金不可回退到 `user_wallets`（账户体系隔离）
❌ 腐竹账户资金不可直接提现到银行卡（仅可申请，由平台线下转账）
❌ 腐竹账户 `pending_balance` 不可消费（仅 `balance` 可消费）

#### 4.3.3 资金来源与去向

| 来源/去向 | 说明 | 入账账户 | 字段 |
|----------|------|---------|------|
| 平台分账 | 玩家消费按比例分账 | `admin_wallets.pending_balance` → `balance` | `+pending_balance` |
| 腐竹充值 | 腐竹主动充值（线下付费给平台） | `admin_wallets.balance` | `+balance` |
| 平台赠送 | `server_admin` 赠送 | `admin_wallets.balance` | `+balance` |
| 退款回滚 | 错扣后退回 | `admin_wallets.balance` | `+balance` |
| 资源费支出 | 续费实例（`platform_managed`） | `admin_wallets.balance` | `-balance` |
| 提现申请 | 提现到银行卡 | `admin_wallets.balance` | `-balance` |
| 即时结算手续费 | tier 4 专属 | `admin_wallets.balance` | `-balance` |

### 4.4 存款与消费一体化结算系统

#### 4.4.1 可行性结论

**可行**，需注意以下约束：

1. **资金隔离**：`user_wallets`（玩家）与 `admin_wallets`（腐竹）必须物理隔离，禁止互相转账
2. **冻结期机制**：分账资金有 7 天冻结期（`settlement_delay_hours=168`），防止退款时资金链断裂
3. **结算周期**：建议 `daily`（每日凌晨自动结算）+ `manual`（腐竹可手动申请即时结算，仅 tier 4，手续费 5%）
4. **审计完备**：所有 `admin_wallets` 流水写入 `audit_logs` + `admin_wallet_transactions`，支持 `server_admin` 全局查询
5. **多角色账号**：用户同时持有 `user` + `instance_admin` 时，`active_role` 切换必须显式切换钱包视图（`user_wallets` ↔ `admin_wallets`），资金不互通

#### 4.4.2 `admin_wallet_transactions` 表设计（新增，流水审计）

```yaml
admin_wallet_transactions:
  id: integer PK
  admin_user_id: string UUID (FK users.id)  # 腐竹ID
  wallet_id: integer (FK admin_wallets.id)
  transaction_type: enum [credit, debit, freeze, unfreeze, settle, withdraw, refund]
  amount: integer (≥0)  # 金额（正数）
  direction: enum [in, out]  # 入账/出账
  source_type: enum [settlement, recharge, gift, refund, fee, withdrawal, adjustment]
  source_ref: string  # 关联ID（如订单ID/续费记录ID/分账记录ID）
  balance_after: integer  # 操作后余额快照（审计用）
  pending_balance_after: integer  # 操作后冻结余额快照
  status: enum [pending, completed, failed, reversed]
  metadata: string (JSON)  # 扩展字段（如规则快照、操作员ID）
  created_at: datetime
  completed_at: datetime (nullable)
```

#### 4.4.3 流转示例

**场景 A：玩家充值 100 元 → 消费 30 元 → 腐竹分账 70%**

1. 玩家兑换 `recharge_cdks`（`face_value=10000`）→ `user_wallets.balance += 10000`
2. 玩家购买商品（`total_price=3000`）→ `user_wallets.balance -= 3000`，写入 `shop_orders`
3. `settlementRunner` 扫描 → 命中规则 `admin_share=0.7` → `admin_wallets.pending_balance += 2100`，写入 `settlement_records`（status=pending）
4. 7 天后 `pendingBalanceReleaser` → `admin_wallets.pending_balance -= 2100`，`admin_wallets.balance += 2100`，`settlement_records.status=released`

**场景 B：腐竹续费自有实例 30 天，规格 small，tier 2**

1. 腐竹发起续费（`POST /api/admin/wallet/renew-instance`）
2. 计算：`base = 100 × 30 = 3000`
3. 折扣：tier 2 资源费折扣 = 0.9 → `amount_paid = 3000 × 0.9 = 2700`
4. 扣款：`admin_wallets.balance -= 2700`
5. 写入 `instance_renewals`：`wallet_source='admin_wallets'`, `admin_tier_discount_applied=0.9`, `node_source_at_renewal='platform_managed'`
6. 写入 `admin_wallet_transactions`：`type=debit, direction=out, source_type=fee, amount=2700, balance_after=新余额`

**场景 C：自带节点腐竹续费自有实例 30 天**

1. 腐竹发起续费（同上）
2. 计算：`base = 100 × 30 = 3000`
3. 折扣：`node_source=self_hosted` → `amount_paid = 0`（豁免）
4. 不扣款，仅写入 `instance_renewals`：`wallet_source='admin_wallets'`, `amount_paid=0`, `node_source_at_renewal='self_hosted'`, `renewal_type='manual'`
5. 实例 `expires_at` 延长 30 天

**场景 D：玩家充值 7 天内退款**

1. `recharge_cdks` 已 used → 标记 `status=reversed`
2. `user_wallets.balance -= face_value`（可能产生负数，记入 `owed_balance`）
3. 已分账的 `settlement_records` 状态查询：
   - `status=pending`（未释放）→ `status=reversed`，`admin_wallets.pending_balance -= admin_share_amount`
   - `status=released`（已释放）→ `admin_wallets.balance -= admin_share_amount`（可能产生负数，记入 `owed_amount`，由后续分账自动抵扣）

---

## 5. 系统兼容性与冲突解决方案

### 5.1 冲突矩阵

| 冲突场景 | 触发条件 | 解决方案 |
|---------|---------|---------|
| 腐竹欠费但玩家续费 | `admin_wallets.balance < 实例续费金额` | 拒绝续费请求（402），保留实例 7 天宽限期，玩家走「提示腐竹补缴」流程 |
| 自带节点腐竹托管到平台 | 节点迁移 `self_hosted → platform_managed` | 按迁移时刻切换计费模式，迁移前的免费时段不追溯，迁移后新续费按 `platform_managed` 计价 |
| 平台节点迁移到自带 | `platform_managed → self_hosted` | 已续费时段不退费，新续费按 `self_hosted` 豁免 |
| 腐竹等级降级超限 | `admin_tier` 降低后实例数/玩家数超限 | 禁止创建新实例（已有保留），30 天内未升级则冻结超额实例（不删除） |
| 玩家 VIP 过期但已购高阶商品 | `vip_level` 从 N 降到 0 | 已购商品保留，新购受 VIP0 限制；不追溯扣回 |
| 分账资金未结算腐竹就提现 | `pending_balance` 不可提现 | 强制冻结期 7 天，仅 `balance` 可提现 |
| 退款时已分账给腐竹 | 玩家兑换 CDK 后申请退款 | 7 天冻结期内可逆（扣 `pending_balance`）；冻结期外仍追回腐竹分账（扣 `balance`，不足记 `owed_amount` 由后续分账抵扣）——与 §4.4.3 场景 D / §6.3-7 一致，2026-07-27 GN-004 审查后人类裁决确认 |
| 退款时腐竹分账已提现 | `balance < admin_share_amount` | 不足部分记入 `owed_amount`，由后续分账自动抵扣（最多 30 天，超期 `server_admin` 介入） |
| 多角色账号账户切换 | 用户同时是 `user + instance_admin` | `active_role` 切换时钱包视图切换（`user_wallets` ↔ `admin_wallets`），资金不互通 |
| 自带节点腐竹也使用平台节点 | 同时管理 `self_hosted + platform_managed` 实例 | 按实例维度独立计费，`admin_wallets` 仅扣 `platform_managed` 部分 |
| 腐竹账户余额冻结期争议 | `pending_balance` 来源订单已退款 | 退款优先从 `pending_balance` 扣回，不足则从 `balance` 扣回（可能产生 `owed_amount`） |
| 并发扣款导致超扣 | 多请求同时扣 `admin_wallets.balance` | DB 事务 + 余额校验 + 行锁（`SELECT ... FOR UPDATE`） |
| 腐竹降级后已分配的玩家 VIP | `admin_tier` 降低不影响玩家 VIP | 玩家 VIP 由 `bindings.vip_level` 决定，与腐竹等级解耦，互不影响 |
| 跨游戏类型分账规则冲突 | 同一腐竹管理 Minecraft + Factorio 实例 | 按 `scope_type=game_type` 规则匹配，未配置则降级到 `global` 规则 |

### 5.2 兼容性保证

#### 5.2.1 与现有契约的兼容

- ✅ 不修改 `users` 表（`roles`/`active_role` 已支持多角色）
- ✅ 不修改 `user_wallets` 表（玩家钱包保持按实例作用域）
- ✅ 不修改 `vip_permissions` / `bindings`（玩家 VIP 系统不变）
- ✅ 不修改 `recharge_cdks` / `recharge_cdk_batches`（卡商机制保持）
- ✅ 不修改 `instance_renewals` 现有字段（仅新增 3 个字段，向后兼容）
- ✅ 复用 `role_permission_templates` + `permission_points`（仅新增 9 个权限点）
- ✅ 复用 `scheduler`（仅注册 2 个新任务）
- ✅ 复用 `audit_logs`（`admin_wallet_transactions` 同步写入审计）

#### 5.2.2 新增表/字段清单

| 类型 | 表名/字段 | 用途 |
|------|----------|------|
| 新增表 | `admin_wallets` | 腐竹跨实例聚合账户 |
| 新增表 | `admin_wallet_transactions` | 腐竹账户流水审计 |
| 新增表 | `admin_tiers` | 腐竹等级配置 |
| 新增表 | `user_admin_tiers` | 用户 ↔ 腐竹等级关联（一对一） |
| 新增表 | `settlement_rules` | 分账规则配置 |
| 新增表 | `settlement_records` | 分账结算记录 |
| 新增字段 | `nodes.node_source` | 节点来源标记（`platform_managed` / `self_hosted`） |
| 新增字段 | `instance_renewals.wallet_source` | 扣款源（`user_wallets` / `admin_wallets`） |
| 新增字段 | `instance_renewals.admin_tier_discount_applied` | 腐竹等级折扣（审计用） |
| 新增字段 | `instance_renewals.node_source_at_renewal` | 续费时节点来源（审计用） |
| 新增字段 | `users.admin_tier_id` | 用户当前腐竹等级（仅 `instance_admin` 有值） |
| 新增权限点 | 9 个 | 见 §1.3 |

### 5.3 数据迁移注意事项

- `admin_tiers` 默认值：初始化 5 条记录（tier 0-4 + 推荐配置）
- `users.admin_tier_id` 默认值：现有 `instance_admin` 用户默认为 tier 1（基础腐竹）
- `nodes.node_source` 默认值：现有节点默认为 `platform_managed`（保守原则，避免漏计费）
- `admin_wallets` 自动初始化：`instance_admin` 用户首次访问管理后台时自动创建钱包（`balance=0`）
- `instance_renewals.wallet_source` 默认值：现有记录默认为 `user_wallets`（向后兼容）
- Historical 数据不迁移：现有 `instance_renewals` 保留不变，新扣款走 `admin_wallets`
- Migration 脚本必须按 [rules-0 §二-4] 提供 `if (hasTable) return` 守卫的同时，**新增字段用 `ALTER TABLE ADD COLUMN IF NOT EXISTS`**（SQLite 3.35+ 支持），避免 migration guard 导致缺列（项目历史 bug 教训）

---

## 6. 执行步骤与开发事项

### 6.1 执行步骤

1. **新增契约文件**：编写 5 张新表的 schema 文件到 `public/schema/`
   - `admin-wallets-schema.json`
   - `admin-wallet-transactions-schema.json`
   - `admin-tiers-schema.json`
   - `settlement-rules-schema.json`
   - `settlement-records-schema.json`

2. **扩展现有契约**：
   - `nodes-schema.json` 新增 `node_source` 字段
   - `server-schema.json` 无需修改（`admin_tier_discount_applied` 在 `instance_renewals`）
   - `instance-renewals-schema.json` 新增 3 个字段（`wallet_source` / `admin_tier_discount_applied` / `node_source_at_renewal`）
   - `permission-points-schema.json` 新增 9 个权限点到种子数据
   - `role-permission-templates-schema.json` 关联新权限点

3. **数据迁移脚本**：
   - `migrations/xxx_init_admin_tiers.sql`（5 条默认等级配置）
   - `migrations/xxx_init_admin_wallets.sql`（自动为现有 `instance_admin` 创建钱包）
   - `migrations/xxx_init_settlement.sql`（默认分账规则：global + admin_tier=null + admin_share=0.7）
   - `migrations/xxx_extend_nodes_field.sql`（`ALTER TABLE nodes ADD COLUMN node_source TEXT DEFAULT 'platform_managed'`）
   - `migrations/xxx_extend_instance_renewals_fields.sql`（3 个新字段，向后兼容默认值）
   - `migrations/xxx_extend_users_admin_tier_id.sql`（`ALTER TABLE users ADD COLUMN admin_tier_id INTEGER DEFAULT 1`）

4. **服务层实现**：
   - `panel/backend/src/services/adminWalletService.ts`：余额查询/充值申请/提现申请/扣款（事务+行锁）
   - `panel/backend/src/services/adminTierService.ts`：等级查询/限额校验/升降级评估
   - `panel/backend/src/services/settlementService.ts`：规则匹配/异步结算/冻结期满释放/退款冲正
   - 扩展 `panel/backend/src/services/instanceRenewalService.ts`：扣款源切换（`user_wallets` ↔ `admin_wallets`），新增 `wallet_source` 判定逻辑
   - 扩展 `panel/backend/src/services/instanceAdminService.ts`：腐竹续费自有实例入口

5. **API 路由实现**：
   - `GET /api/admin/wallet`：腐竹钱包查询
   - `POST /api/admin/wallet/recharge`：腐竹充值申请（线下付费后 server_admin 审批）
   - `POST /api/admin/wallet/withdraw`：腐竹提现申请
   - `GET /api/admin/wallet/transactions`：流水查询（分页/筛选）
   - `GET /api/admin/tier`：腐竹等级查询
   - `GET /api/admin/tier/permissions`：等级权益表
   - `POST /api/admin/wallet/renew-instance`：腐竹续费自有实例（扣 `admin_wallets`）
   - `GET /api/admin/settlements`：分账记录查询（腐竹查自己，`server_admin` 查全部）
   - `POST /api/admin/settlement-rules`：分账规则配置（仅 `server_admin`）
   - `GET /api/admin/admin-tiers`：腐竹等级列表（仅 `server_admin`）
   - `POST /api/admin/admin-tiers/assign`：腐竹等级分配（仅 `server_admin`）
   - `POST /api/admin/withdrawals/:id/approve`：提现审批（仅 `server_admin`）

6. **定时任务**：扩展 `panel/backend/src/services/scheduler.ts` 注册：
   - `settlementRunner`：每小时扫描已结算订单，匹配规则，写入 `pending_balance`
   - `pendingBalanceReleaser`：每小时扫描冻结期满记录，迁移 `pending_balance → balance`
   - `adminTierEvaluator`：每日凌晨评估腐竹等级升降级（基于 30 天指标）

7. **前端实现**：
   - 腐竹工作台 `panel/frontend/src/pages/admin/AdminWalletPage.tsx`：账户余额/流水/提现申请
   - 腐竹工作台 `panel/frontend/src/pages/admin/AdminTierPage.tsx`：等级信息/权益表/升级路径
   - 平台管理 `panel/frontend/src/pages/admin/SettlementPage.tsx`：分账规则配置/结算记录
   - 平台管理 `panel/frontend/src/pages/admin/AdminTiersManagePage.tsx`：腐竹等级分配
   - 平台管理 `panel/frontend/src/pages/admin/WithdrawalApprovalPage.tsx`：提现审批
   - 敏感字段（提现银行卡号等）使用 `<SensitiveInput>` 组件

8. **测试套件**：
   - 单元测试：`adminWalletService.test.ts` / `adminTierService.test.ts` / `settlementService.test.ts` / `instanceRenewalService.test.ts`（扣款源切换）
   - 契约测试：5 张新表 schema 校验 + 9 个新权限点匹配
   - E2E 测试：`admin-economy-flow.spec.ts` 覆盖「玩家充值 → 消费 → 分账 → 腐竹提现」全链路
   - Mock 回归：`/store/wallet` / `/store/tier` 页面 Mock 模式渲染验证

9. **审计与监控**：
   - 所有 `admin_wallets` 流水同步写入 `audit_logs`（含余额查询）
   - 监控指标新增：「分账待结算金额」「腐竹欠费实例数」「提现申请积压数」「腐竹等级分布」
   - 异常告警：`balance < 0` / `owed_amount > 阈值` / 节点接入审核积压

### 6.2 开发事项清单

- [ ] 编写 `public/schema/admin-wallets-schema.json`
- [ ] 编写 `public/schema/admin-wallet-transactions-schema.json`
- [ ] 编写 `public/schema/admin-tiers-schema.json`
- [ ] 编写 `public/schema/settlement-rules-schema.json`
- [ ] 编写 `public/schema/settlement-records-schema.json`
- [ ] 扩展 `public/schema/nodes-schema.json`（`node_source` 字段）
- [ ] 扩展 `public/schema/instance-renewals-schema.json`（3 个新字段）
- [ ] 扩展 `public/schema/permission-points-schema.json`（9 个新权限点）
- [ ] 扩展 `public/schema/role-permission-templates-schema.json`（关联新权限点）
- [ ] 扩展 `public/schema/user-schema.json`（`admin_tier_id` 字段）
- [ ] 编写 `migrations/xxx_init_admin_tiers.sql`
- [ ] 编写 `migrations/xxx_init_admin_wallets.sql`
- [ ] 编写 `migrations/xxx_init_settlement.sql`
- [ ] 编写 `migrations/xxx_extend_nodes_field.sql`
- [ ] 编写 `migrations/xxx_extend_instance_renewals_fields.sql`
- [ ] 编写 `migrations/xxx_extend_users_admin_tier_id.sql`
- [ ] 实现 `panel/backend/src/services/adminWalletService.ts`
- [ ] 实现 `panel/backend/src/services/adminTierService.ts`
- [ ] 实现 `panel/backend/src/services/settlementService.ts`
- [ ] 扩展 `panel/backend/src/services/instanceRenewalService.ts`（扣款源切换）
- [ ] 扩展 `panel/backend/src/services/scheduler.ts`（注册 3 个新任务）
- [ ] 实现 `panel/backend/src/api/admin-wallet.ts`（路由）
- [ ] 实现 `panel/backend/src/api/admin-tier.ts`（路由）
- [ ] 实现 `panel/backend/src/api/admin-settlement.ts`（路由）
- [ ] 实现 `panel/backend/src/api/admin-withdrawal.ts`（路由）
- [ ] 实现 `panel/frontend/src/pages/admin/AdminWalletPage.tsx`
- [ ] 实现 `panel/frontend/src/pages/admin/AdminTierPage.tsx`
- [ ] 实现 `panel/frontend/src/pages/admin/SettlementPage.tsx`
- [ ] 实现 `panel/frontend/src/pages/admin/AdminTiersManagePage.tsx`
- [ ] 实现 `panel/frontend/src/pages/admin/WithdrawalApprovalPage.tsx`
- [ ] 编写 `panel/backend/src/__tests__/adminWalletService.test.ts`
- [ ] 编写 `panel/backend/src/__tests__/adminTierService.test.ts`
- [ ] 编写 `panel/backend/src/__tests__/settlementService.test.ts`
- [ ] 编写 `panel/backend/src/__tests__/instanceRenewalService.test.ts`（扣款源切换）
- [ ] 编写 `e2e/admin-economy-flow.spec.ts`
- [ ] 更新 `version.md` 与 `README.md`（重大功能说明）

### 6.3 建议

1. **冻结期建议设为 7 天**（`settlement_delay_hours=168`）：玩家充值后 7 天内退款可逆，超过则进入腐竹可提现余额；避免退款时资金链断裂。
2. **分账比例建议区间 70-90%**：参考行业惯例，平台抽取 10-30%，自带节点腐竹可上调至 90%（无资源成本）。
3. **结算周期建议 daily**：每日凌晨结算前日所有消费，T+7 入账腐竹可提现余额；tier 4 腐竹可申请即时结算（手续费 5%）。
4. **腐竹等级自动评估算法**：基于「近 30 天日均活跃玩家数 + 月度分账流水」双指标，避免单一指标作弊。
5. **自带节点接入审核**：建议 `server_admin` 审核 daemon 接入请求，防止恶意节点接入；审核通过后 `node_source=self_hosted` 永久免费。
6. **法务合规建议**：仅平台收钱再分账模式降低腐竹直接收款的合规风险；建议保留所有 `admin_wallet_transactions` 流水至少 5 年备查。
7. **退款优先级**：退款先扣 `pending_balance`（未入账分账），再扣 `balance`（已入账），不足时记 `owed_amount` 由后续分账自动抵扣。
8. **审计完备性**：所有 `admin_wallets` 操作（包括余额查询）写入 `audit_logs`，支持 `server_admin` 全局查询与导出。
9. **多角色账号隔离**：用户同时持有 `user + instance_admin` 时，工作台切换必须显式切换钱包视图，禁止跨账户操作。
10. **数据一致性**：`admin_wallets` 余额变更必须使用事务（`BEGIN → 余额校验 → 扣款 → 写流水 → COMMIT`），避免并发导致超扣；DB 层加行锁（`SELECT ... FOR UPDATE`）。
11. **历史数据兼容**：现有 `instance_renewals` 保留原字段值，新增字段 `wallet_source` 默认 `user_wallets`，避免破坏既有玩家续费流程。
12. **Migration 守卫**：新增字段必须用 `ALTER TABLE ADD COLUMN IF NOT EXISTS`，避免项目历史 bug「guard clauses 导致缺列」（见 project_memory.md 教训）。
13. **定价参数化**：所有定价（VIP 价格、腐竹等级折扣、实例规格单价、分账比例）均通过 `system_config` 或新表配置，禁止硬编码。
14. **前端 UI 一致性**：新增页面遵循 Apple 风格清新设计（iOS 蓝 #007AFF / 白底 #F5F5F7），敏感字段（提现银行卡号）用 `<SensitiveInput>`，移动端适配 44px+ 触控目标。
15. **BUILD 序号**：所有新增页面底部 footer 显示唯一 `BUILD YYYYMMDD-XXX` 序号，不在其他位置冗余渲染。

---

## 7. 风险与未决项

### 7.1 已知风险

| 风险 | 等级 | 缓解措施 |
|------|-----|---------|
| 分账计算与实际消费的时序漂移 | 中 | 异步任务幂等 + 7 天冻结期对账 |
| 腐竹等级自动降级误伤 | 中 | 30 天观察期 + 人工申诉通道 |
| 自带节点接入恶意节点 | 高 | `server_admin` 审核制 + 节点健康度监控 |
| 多角色账号钱包视图切换 UX 复杂 | 中 | 工作台切换时显式提示当前钱包类型 |
| 退款时腐竹分账已提现 | 高 | 7 天冻结期 + `owed_amount` 自动抵扣（最多 30 天） |
| `admin_wallets` 并发扣款导致超扣 | 高 | DB 事务 + 余额校验 + 行锁（`SELECT FOR UPDATE`） |
| 跨游戏类型分账规则配置膨胀 | 低 | 优先用 `global` 规则兜底，按需细化 `game_type` 规则 |
| 自带节点腐竹对外提供算力滥用 | 中 | daemon 接入审核 + 限制单节点实例数（按 `admin_tier`） |

### 7.2 未决项（需后续澄清）

1. **提现到银行卡的具体方式**（线下转账 vs 第三方支付通道）—— 暂建议线下转账，由 `server_admin` 审批后人工执行。
2. **腐竹充值通道**（线下付费给平台 vs 在线支付）—— 暂建议线下付费 + `server_admin` 手动加款到 `admin_wallets.balance`。
3. **跨游戏类型分账规则差异**（如 Minecraft vs Factorio）—— 暂建议全局统一规则，后续按 `game_type` 细化。
4. **腐竹等级自动评估的具体阈值** —— 待运营数据积累后调参（建议初始值：tier 1→2 需 30 天日均 50 玩家 + 月流水 10000 点券）。
5. **法务合规细节**（如发票开具、税务申报）—— 建议咨询专业财务，本方案不涵盖。
6. **跨实例玩家钱包合并**（同一玩家在腐竹 A 与腐竹 B 的实例都有 `user_wallets`，是否合并）—— 暂建议保持按实例作用域（现有契约），不合并。
7. **腐竹转让/继承流程**（腐竹退出后实例与账户如何处理）—— 暂建议 `server_admin` 介入，将实例转移给其他腐竹或归档。

---

## 8. 需求闭合状态（s0101 三值状态）

- **当前状态**：`已闭合`
- **已闭合项**：
  - 4 个核心架构方向（腐竹角色映射、资金流转路径、管理员费用语义、自带节点计费）
  - 现有契约盘点（不重复造轮子）
  - 新增表/字段清单
  - 冲突矩阵与解决方案
  - 执行步骤与开发事项
- **未决项**：见 §7.2（不阻断方案生成，待运营后澄清）
- **下一步接续入口**：
  - 人类裁决批准本方案后 → 进入 s0201（生成全局契约）：补全 5 张新表 + 9 个权限点的 zod schema 与 .d.ts 接口存根
  - 契约冻结后 → 进入 s0202（生成预生成 Mock）：为 `adminWalletService` / `settlementService` 生成 Mock 实现
  - Mock 就位后 → 进入 s0203（拓扑化模块拆分）：按服务层/路由层/前端层拆分并行开发任务

---

> 本方案遵循 [rules-0 §四-5 价值判断节点显式标记] 规则，§2.1 / §2.2 / §3.2 / §4.2 中的具体定价数值、§5.1 的冲突解决方案均涉及价值判断，标记为 `[V]` 节点。`[V]` 节点不因独立审查通过而免于人类裁决，需 `server_admin`（或项目负责人）最终确认后方可冻结。
