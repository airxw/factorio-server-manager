---
type: plan
title: GSP 基础逻辑体系完善方案（VIP / 价格 / 实例有效期 / 配额）
date: 2026-07-25
decided_at: 2026-07-25
status: ready-for-implementation
decisions:
  V1: introduce_points_system   # 引入积分制
  V2: card_reseller_recharge_cdks  # 卡商机制：管理员生成充值CDK，用户兑换点券
  V3: defer_to_v2                # 订阅制 v1 不引入
  V4: admin_configurable_all_params  # 到期策略全参数系统管理员可配
  V5: no_trial_instance          # 不引入试用实例
  V6: fully_configurable_pricing # 续费定价全部可配置
related:
  - docs/plans/v4.11.0_commercialization_upgrade_plan.md
  - docs/plans/three-tier-operation-logic-rebuild-plan.md
  - panel/backend/src/services/vipService.ts
  - panel/backend/src/services/walletService.ts
  - panel/backend/src/services/shopService.ts
  - panel/backend/src/services/quotaService.ts
  - panel/backend/src/services/instanceAdminService.ts
  - panel/backend/src/services/instanceBindingService.ts
  - panel/backend/src/services/scheduler.ts
tags: [vip, pricing, wallet, instance-expiry, quota, scheduler, business-logic]
---

# GSP 基础逻辑体系完善方案（VIP / 价格 / 实例有效期 / 配额）

> 本方案遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。
> 文档定位：在 v4.11.0 商业化重构（global_assets / instance_assets 已落地）基础上，**补齐三类基础逻辑闭环**——VIP 等级生命周期、价格与钱包流转、实例有效期与到期处置——并打通四者之间的联动。

---

## 一、调研结论（现状盘点）

### 1.1 已落地能力（可直接复用）

| 体系 | 已落地内容 | 关键文件 |
|------|-----------|----------|
| VIP 等级 | `vip_permissions` 全局模板（0-5 级，含 `max_quality` / `daily_limit` / `daily_reward_amount`） | [migrations/20260703000002_create_vip_permissions.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260703000002_create_vip_permissions.ts) |
| VIP 实例绑定 | `user_instance_bindings.vip_level` + `vip_expires_at`（按实例作用域，已实现过期降级 `checkAndDowngradeExpiredVip`） | [vipService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/vipService.ts) |
| VIP 品质校验 | VIP N 可购 tier ≤ N-1；server_admin / instance_admin+owner 融合为 VIP5 | [vipService.ts#L271](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/vipService.ts#L271) |
| VIP 每日点券 | 阶梯 100/200/400/800/1600/3200；`claimDailyReward` 防重领 | [walletService.ts#L120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/walletService.ts#L120) |
| VIP 折扣 | `vip.discount_levels` JSON 配置（如 `{ "3": 80, "4": 75, "5": 50 }`），下单时应用 | [shopService.ts#L222](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/shopService.ts#L222) |
| 钱包 | `user_wallets`（按实例作用域：balance / total_earned / total_spent）+ debit/credit/refund 原子操作 | [walletService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/walletService.ts) |
| 商品与订单 | `shop_items` / `shop_orders` / `shop_order_items`（价格快照 + 乐观锁状态机） | [shopService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/shopService.ts) |
| 资产继承 | `global_assets`（COMMODITY/TEMPLATE/RULE）+ `instance_assets`（override_price / override_name / is_ugc） | [migrations/20260805000001_create_asset_tables.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/migrations/20260805000001_create_asset_tables.ts) |
| CDK 兑换码 | `cdk_codes` + `cdk_code_items`（多物品礼包，乐观锁状态机，带 expires_at） | [cdkService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/cdkService.ts) |
| 资源配额 | `resource_quotas`（scope_type: role/user，max_instances / max_disk_mb / max_players_total），优先级 user > role > 不限 | [quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts) |
| 三级角色 | server_admin / instance_admin / user；`instance_admins`（共管）+ `instance_roles`（含 expires_at） | [instanceAdminService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/instanceAdminService.ts) |
| 调度器 | 支持 `interval_ms` / `next_run_at` / `cron_expr` 三种时序，已注册 14 种任务类型 | [scheduler.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/scheduler.ts) |

### 1.2 关键缺口（本方案需要补齐）

#### A. VIP 体系缺口
- **A1**：`vipService.checkAndDowngradeExpiredVip` 已实现但**未注册到 scheduler**——VIP 过期降级是死代码（需扫描 `user_instance_bindings.vip_expires_at`）
- **A2**：VIP 等级与资源配额**无联动**——`resource_quotas` 仅按 role/user 维度，未支持按 VIP 等级自动放宽配额
- **A3**：VIP 升级路径缺失——当前 VIP 等级只能由管理员手工设置或绑定默认 VIP1，**无积分/成长值/经验值机制**
- **A4**：VIP 类型分层缺失——无"月卡 / 季卡 / 年卡 / 终身 / 试用"概念，`vip_expires_at` 仅是时间戳，无类型标识
- **A5**：`users.vip_level` + `users.vip_expires_at` 字段在 v2.1.0 后**已被 `user_instance_bindings` 取代但仍保留**——历史包袱未清理（双源真相风险）

#### B. 价格体系缺口
- **B1**：钱包**仅支持平台内点券流转**，无充值通道（法币→点券），`walletService.credit` 已预留但无入口
- **B2**：无账单/对账系统——`shop_orders` 是订单流水，但**无月度账单聚合、无对账快照**
- **B3**：无退款流程——`walletService.refund` 已实现但仅在订单事务失败时调用，**无用户发起的退款申请**
- **B4**：无促销/优惠券——仅有 VIP 折扣单一折扣维度
- **B5**：无订阅制（月卡/季卡/年卡）——`shop_items` 是单次购买，无周期扣款
- **B6**：CDK 与商品价格**未对齐**——CDK 是免费发放的兑换码，`cdk_codes` 无 `price` 字段，无法支撑"付费 CDK"

#### C. 实例有效期体系缺口（核心缺口）
- **C1**：**`servers` 表无 `expires_at` 字段**——[servers.ts#L359-L376](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L359-L376) 创建实例时未设置任何有效期，实例默认永久存在
- **C2**：无 `instance_renewals` 续费记录表——续费无审计追踪
- **C3**：scheduler **未注册实例到期扫描任务**——无定时检查 `servers.expires_at`
- **C4**：无"过期宽限期"机制——到期立即处置 vs 保留 N 天可续费
- **C5**：无"到期数据保留策略"——到期后磁盘文件保留多久、何时清理
- **C6**：无"试用实例"机制——无"免费试用 N 天后自动停止"
- **C7**：无手动/自动续费入口——前端无续费按钮、无"到期前自动扣款续费"配置
- **C8**：前端**无到期倒计时/到期提醒**——实例列表/详情未展示有效期
- **C9**：实例到期与 VIP 体系**无联动**——VIP 等级不影响实例有效期/保留期/续费折扣

#### D. 配额与调度缺口
- **D1**：scheduler 任务清单中**无 VIP 过期扫描、无实例到期扫描、无到期前提醒**三类任务的注册
- **D2**：配额校验仅在"创建实例"和"上传文件"两个入口，**无"配额即将耗尽"预警**
- **D3**：`resource_quotas` 不支持"按 VIP 等级自动派生配额"——需管理员手工为每个用户/角色配置

---

## 二、设计目标与原则

### 2.1 设计目标
1. **VIP 生命周期闭环**：等级获取 → 过期降级 → 升级路径 → 与配额/折扣/有效期联动
2. **价格流转闭环**：充值 → 钱包 → 下单（含折扣）→ 退款 → 对账
3. **实例有效期闭环**：创建设有效期 → 到期前提醒 → 到期宽限 → 续费/清理 → 审计追踪
4. **四体系联动**：VIP 等级 → 影响配额/折扣/续费价/保留期；钱包余额 → 支撑续费/订阅自动扣款

### 2.2 设计原则
- **沿用既有契约**：不破坏 `user_instance_bindings` 按实例作用域的 VIP 模型，仅在 `servers` 表新增有效期字段
- **渐进式迁移**：所有 DB 变更用 `hasColumn` / `hasTable` 保护，存量数据回填为"永久"（`expires_at = NULL`）
- **死代码激活优先**：A1（VIP 过期扫描）、C3（实例到期扫描）优先激活已有方法，不重写
- **调度器复用**：所有周期任务通过既有 `scheduler.schedule()` 注册，复用 `cron_expr` 模式
- **public/ 保护**：契约变更走 s0601 流程，本方案仅声明变更点，不动 public/ 文件

---

## 三、VIP 体系完善方案

### 3.1 执行步骤

#### 步骤 1：激活 VIP 过期扫描调度任务（修复 A1）
- **开发事项**：
  - 在 `panel/backend/src/index.ts`（或调度初始化模块）中调用 `scheduler.schedule()` 注册任务：
    - `type: 'VIP_EXPIRY_SCAN'`
    - `cron_expr: '0 * * * *'`（每小时整点扫描一次）
    - executor 调用 `vipService.checkAndDowngradeExpiredVip()`
  - 在 [scheduler.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/scheduler.ts) 任务类型常量中新增 `VIP_EXPIRY_SCAN`
- **建议**：扫描频率不宜过高（每小时足够），避免与 `getVipLevel` 内联过期检查重复触发降级

#### 步骤 2：VIP 等级与配额联动（修复 A2、D3）
- **开发事项**：
  - 在 [quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts) 的 `getEffectiveQuota` 中增加第三优先级：**user 配额 > role 配额 > VIP 派生配额 > 默认不限**
  - 新增配置契约 `vip.quota_overrides`（JSON，形如 `{ "3": { "max_instances": 5, "max_disk_mb": 10240 }, "5": { "max_instances": 20, "max_disk_mb": 51200 } }`），存于 `system_config` 表
  - 派生逻辑：查询用户在某实例的 VIP 等级（按 `user_instance_bindings.vip_level`），匹配 `vip.quota_overrides` 返回派生配额
- **建议**：VIP 派生配额仅在 role 配额缺失时生效，避免与显式配置冲突；优先级文档需写入 [quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts) 头注释

#### 步骤 3：VIP 类型分层（修复 A4）
- **开发事项**：
  - 在 `user_instance_bindings` 表新增 `vip_type` 字段（枚举：`permanent` / `monthly` / `quarterly` / `yearly` / `trial`，默认 `permanent`）
  - `vip_type` 仅作展示与统计用，过期判定仍以 `vip_expires_at` 为准
  - 创建实例时由 `setVipWithExpiry` 根据 `vip_type` 自动计算 `vip_expires_at`：
    - `monthly` → +30 天
    - `quarterly` → +90 天
    - `yearly` → +365 天
    - `permanent` / `trial` → NULL（trial 由"试用实例机制"另行控制）
  - 前端 VIP 开通页提供 4 档套餐选择
- **建议**：`vip_type` 字段命名避开 `membership_type`，保持与既有 `vip_*` 前缀一致

#### 步骤 4：VIP 升级路径（积分/成长值，修复 A3）
- **开发事项**：
  - 新增 `user_vip_points` 表：`user_id` / `server_id` / `points` / `total_earned` / `updated_at`，UNIQUE(user_id, server_id)
  - 积分获取规则（在 `shopService.createOrder` 成功后埋点）：
    - 每消费 1 点券 = 1 积分
    - 每日签到 = +10 积分
    - CDK 兑换 = +5 积分
  - 积分→VIP 等级映射配置契约 `vip.points_thresholds`（JSON，形如 `{ "1": 100, "2": 500, "3": 2000, "4": 8000, "5": 30000 }`）
  - 新增 `vipPointService.ts`：`addPoints` / `getPoints` / `checkAndUpgradeVip`（积分达标自动升级，但不自动降级——降级仍由 `vip_expires_at` 控制）
- **建议**：积分只升不降（避免用户因退款/到期产生负向体验）；积分达标升级后发送通知

#### 步骤 5：清理 `users.vip_level` 历史包袱（修复 A5）
- **开发事项**：
  - 标注 `users.vip_level` / `users.vip_expires_at` 为 **deprecated**（不删除字段，避免破坏存量数据）
  - 全代码扫描确认无服务读取这两个字段（`instanceBindingService.getUserVipLevel` 已是唯一真相源）
  - 在 [user-schema.json](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/user-schema.json) 中将这两个字段标注 `deprecated: true`
- **建议**：字段保留 2 个版本周期后再删除，避免回滚风险

### 3.2 决策点（已闭合）

> **决策点 V1（已闭合）**：VIP 升级路径 → **引入积分制**
> - 全套实施 3.1 步骤 4：新增 `user_vip_points` 表 + `vipPointService` + 积分获取规则（消费/签到/CDK 兑换）+ 积分→VIP 等级自动升级
> - 积分只升不降，避免用户因退款/到期产生负向体验

---

## 四、价格体系完善方案

### 4.1 执行步骤

#### 步骤 1：卡商充值 CDK 机制（修复 B1，决策 V2 已采纳）
- **机制说明**：不接入第三方支付，通过"卡商机制"实现充值闭环——
  1. 系统管理员在后台批量生成"点券充值 CDK"（指定面值、数量、过期时间），按批次管理
  2. 卡商（代理商）线下向平台付费购买充值 CDK 批次
  3. 卡商将 CDK 转卖给玩家（线下交易，平台不介入）
  4. 玩家在钱包页输入 CDK 码，校验后点券入账 `user_wallets.balance`
- **开发事项**：
  - 新增 `recharge_cdks` 表：`id` / `code`（UNIQUE）/ `face_value`（点券面值）/ `batch_id`（批次 ID）/ `status`（`unused` / `used` / `expired`）/ `claimed_by` / `claimed_at` / `expires_at` / `created_by` / `created_at`
  - 新增 `recharge_cdk_batches` 表：`id` / `batch_name` / `total_count` / `used_count` / `face_value` / `expires_at` / `created_by` / `created_at`（批次管理，便于卡商对账）
  - 新增 `rechargeCdkService.ts`：`createBatch`（批量生成）/ `listBatches` / `listCodesByBatch` / `redeem`（用户兑换，原子 UPDATE 抢占 unused→used + `walletService.credit` 加款）/ `rollbackStaleClaiming`（复用既有乐观锁超时回滚模式）
  - 新增路由：`POST /api/recharge-cdks/batches`（管理员创建批次）/ `GET /api/recharge-cdks/batches`（管理员列表）/ `GET /api/recharge-cdks/batches/:id/codes`（批次下 CDK 列表）/ `POST /api/wallet/recharge-cdk/redeem`（用户兑换）
  - 前端管理员后台新增"充值 CDK 管理"页：批次创建/列表/CDK 导出（CSV）
  - 前端钱包页新增"兑换充值码"入口
- **建议**：
  - `redeem` 采用与 `cdkService.redeem` 一致的两段事务（乐观锁状态机），保证原子性
  - 兑换成功后写入 `audit_logs`（事件类型 `RECHARGE_CDK_REDEEMED`），便于追溯
  - 批次导出 CSV 时仅管理员可见，CDK 码生成后不可再次查看明文（防止平台方留存盗用）—— v1 可暂不实现加密存储，但需在 UI 警示

#### 步骤 2：账单与对账（修复 B2）
- **开发事项**：
  - 新增 `walletService.getMonthlyBill(userId, serverId, year, month)`：聚合当月 `shop_orders`（消费）+ `recharge_cdks`（充值 CDK 兑换）+ `wallet_refund_orders`（退款），返回结构化账单
  - 新增 `GET /api/wallet/bill?year=&month=` 路由
  - 新增 `wallet_daily_snapshots` 表：每日凌晨快照所有钱包余额（cron `'0 1 * * *'`），支撑月度对账
  - 前端钱包页新增"账单"tab，展示月度收支明细 + 余额变化曲线
- **建议**：日快照表保留 90 天，超期清理（注册 `WALLET_SNAPSHOT_CLEANUP` 调度任务）

#### 步骤 3：退款流程（修复 B3）
- **开发事项**：
  - 新增 `wallet_refund_orders` 表：`id` / `user_id` / `server_id` / `order_id`（关联 `shop_orders.id`，可空）/ `amount` / `reason` / `status`（`pending` / `approved` / `rejected` / `completed`）/ `requested_at` / `processed_at` / `processed_by`
  - 新增 `walletService.requestRefund` / `approveRefund` / `rejectRefund` / `listRefundOrders`
  - 新增路由：`POST /api/wallet/refund/request`（用户发起）、`POST /api/wallet/refund/:id/approve`（管理员审批）、`POST /api/wallet/refund/:id/reject`
  - 审批通过后调用 `walletService.refund`，并联动 `vipPointService`（如已实现）扣减对应积分
- **建议**：退款仅限未领取（`shop_orders.status = 'pending'`）的订单；已领取订单需走"补偿发放"流程

#### 步骤 4：促销与优惠券（修复 B4）
- **开发事项**：
  - 新增 `coupons` 表：`id` / `code` / `discount_type`（`percent` / `fixed`）/ `discount_value` / `min_order_amount` / `max_discount_amount` / `valid_from` / `valid_until` / `usage_limit` / `used_count` / `scope`（`global` / `server` / `item`）/ `scope_id` / `created_by` / `created_at`
  - 新增 `user_coupons` 表：`user_id` / `coupon_id` / `status`（`unused` / `used` / `expired`）/ `claimed_at` / `used_at` / `order_id`
  - `shopService.createOrder` 增加 `coupon_code` 参数，校验并应用折扣（与 VIP 折扣叠加规则：**VIP 折扣与优惠券不叠加，取最优**）
  - 前端结算页新增"使用优惠券"入口
- **建议**：叠加规则需在 UI 明确提示，避免用户预期不符

#### 步骤 5：订阅制（月卡/季卡/年卡，修复 B5）—— **v1 不引入，v2 评估**（决策 V3 已采纳）
- **v1 决策**：暂不引入订阅制，VIP 套餐（3.1 步骤 3 的 4 档套餐）已覆盖"按周期开通权益"需求
- **v2 评估条件**：
  - 用户调研反馈"周期自动续费"为强需求
  - 钱包余额自动扣款的风控机制完备（防余额不足重复扣款）
  - 退款流程已稳定运行
- **v2 预留设计**（不在 v1 实现，仅记录设计）：
  - `subscriptions` 表：`id` / `user_id` / `server_id` / `plan_id` / `status` / `started_at` / `next_billing_at` / `auto_renew` / `cancelled_at`
  - `shop_items` 新增 `is_subscription` / `billing_cycle_days`
  - `subscriptionService.ts`：`subscribe` / `cancel` / `processRenewal`
  - 调度任务 `SUBSCRIPTION_RENEWAL_SCAN`（每日扫描 `next_billing_at < now` 的订阅）
- **v1 影响范围**：本方案后续章节（七/八/九/十/十一）中涉及 `subscriptions` 的条目均标记为 **v2 预留**，v1 不实现

#### 步骤 6：付费 CDK（修复 B6）
- **开发事项**：
  - `cdk_codes` 表新增 `price` 字段（默认 0，免费 CDK 保持兼容）
  - `cdkService.redeem` 增加余额校验：`price > 0` 时先 `walletService.debit` 再发命令，失败回滚
  - 前端 CDK 兑换页显示价格（免费 CDK 显示"免费"，付费 CDK 显示点券数）
- **建议**：付费 CDK 与普通 CDK 共用一张表，通过 `price` 字段区分，避免双表维护

### 4.2 决策点（已闭合）

> **决策点 V2（已闭合）**：钱包充值通道 → **采用卡商充值 CDK 机制**
> - 不接入第三方支付（支付宝/微信/Stripe），通过"管理员生成充值 CDK → 卡商转卖 → 用户兑换点券"闭环
> - 详见 4.1 步骤 1

> **决策点 V3（已闭合）**：订阅制是否在 v1 引入 → **v1 不引入，v2 评估**
> - VIP 套餐已覆盖"按周期开通权益"需求，订阅制 v2 评估
> - 详见 4.1 步骤 5

---

## 五、实例有效期体系完善方案（核心）

### 5.1 执行步骤

#### 步骤 1：`servers` 表新增有效期字段（修复 C1）
- **开发事项**：
  - 新增迁移 `20260807000001_add_expiry_to_servers.ts`：
    - `servers.expires_at`（TEXT, nullable, ISO 8601，NULL = 永久）
    - `servers.expiry_status`（TEXT, 默认 `'permanent'`，枚举：`permanent` / `active` / `grace` / `expired` / `cleaned`）
    - `servers.expiry_grace_until`（TEXT, nullable, 宽限期结束时间）
  - 存量数据回填：`expires_at = NULL`，`expiry_status = 'permanent'`
  - 修改 [servers.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts) 创建实例逻辑：
    - 接收 `duration_days` 参数（不传 = 永久）
    - 计算 `expires_at = now + duration_days * 86400000`
    - 写入 `expires_at` 与 `expiry_status = 'active'`
  - 修改 `toSummary` 返回 `expires_at` / `expiry_status` / `expiry_grace_until`
- **建议**：`expiry_status` 状态机：`permanent`（永久） / `active`（有效期内） / `grace`（宽限期内，已停止但可续费） / `expired`（已过期，待清理） / `cleaned`（已清理磁盘）
- **决策 V5 已采纳**：不引入试用实例，故不新增 `trial_until` / `trial_instance` 字段

#### 步骤 2：实例到期扫描调度任务（修复 C3）
- **开发事项**：
  - 在 [scheduler.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/scheduler.ts) 新增任务类型常量 `INSTANCE_EXPIRY_SCAN` / `INSTANCE_GRACE_CLEANUP`
  - 新增 `instanceExpiryService.ts`：
    - `scanExpiringInstances()`：每小时扫描 `expires_at < now + 3day` 且 `expiry_status = 'active'` 的实例，发送到期前提醒通知
    - `processExpiredInstances()`：每小时扫描 `expires_at < now` 且 `expiry_status = 'active'` 的实例：
      1. 调用 daemon `stop` 停止实例
      2. 更新 `expiry_status = 'grace'`，设置 `expiry_grace_until = now + grace_days * 86400000`
      3. 发送"已过期进入宽限期"通知
    - `processGraceExpiredInstances()`：每小时扫描 `expiry_grace_until < now` 且 `expiry_status = 'grace'` 的实例：
      1. 更新 `expiry_status = 'expired'`
      2. 发送"宽限期结束，即将清理"通知（提前 1 天）
    - `cleanupExpiredInstances()`：每日扫描 `expiry_status = 'expired'` 且 `expired_at < now - retention_days` 的实例，调用 `safeRemoveService` 清理磁盘后更新 `expiry_status = 'cleaned'`
  - 在调度初始化模块注册 4 个任务（cron 表达式建议见下表）

| 任务类型 | cron_expr | 说明 |
|----------|-----------|------|
| `INSTANCE_EXPIRY_SCAN` | `0 * * * *` | 每小时扫描即将到期/已到期实例 |
| `INSTANCE_GRACE_CLEANUP` | `0 3 * * *` | 每日凌晨 3 点清理宽限期结束的实例 |
| `INSTANCE_DISK_CLEANUP` | `0 4 * * *` | 每日凌晨 4 点清理已过期超 retention_days 的实例磁盘 |
| `INSTANCE_EXPIRY_REMINDER` | `0 9 * * *` | 每日上午 9 点发送到期前提醒（避免凌晨打扰） |

- **建议（决策 V4 已采纳）**：到期处置策略所有参数通过 `system_config` 表统一配置，系统管理员可在系统设置页动态调整，不预设固定数值。可配参数清单：
  - `instance.expiry.reminder_days_before`（到期前提醒天数，默认 `[7, 3, 1]`）
  - `instance.expiry.grace_days`（宽限期天数，默认 7）
  - `instance.expiry.retention_days`（磁盘保留天数，默认 30）
  - `instance.expiry.stop_on_expire`（到期是否立即停止实例，默认 true）
  - `instance.expiry.cleanup_disk_after_retention`（保留期结束后是否清理磁盘，默认 true）
  - `instance.expiry.scan_interval_hours`（扫描频率，默认 1 小时）

#### 步骤 3：续费机制（修复 C7，决策 V6 已采纳全可配定价）
- **开发事项**：
  - 新增 `instance_renewals` 表：`id` / `instance_id` / `user_id` / `duration_days` / `amount_paid`（点券数，0 = 免费） / `renewal_type`（`manual` / `gift`） / `renewed_at` / `old_expires_at` / `new_expires_at`
  - 新增 `instanceExpiryService.renewInstance(instanceId, userId, durationDays, useWallet)`：
    1. 校验实例 `expiry_status` ∈ {`active`, `grace`, `expired`}（`cleaned` 不可续费）
    2. 计算续费金额（**决策 V6：全部可配置**）：
       - 基础单价：`pack.business.instance.pricing.daily_price`（每个 Pack 可独立配置，未配置则 0=免费）
       - 阶梯折扣：`pack.business.instance.pricing.tier_discounts`（JSON，形如 `{ "30": 1.0, "90": 0.9, "365": 0.8 }`，按续费时长匹配折扣，未匹配则 1.0）
       - 续费金额 = `daily_price * duration_days * tier_discount`
    3. 应用 VIP 续费折扣（`vip.renewal_discount_levels` JSON 配置）
    4. `walletService.debit` 扣款
    5. 更新 `servers.expires_at` = max(now, old_expires_at) + duration_days
    6. 重置 `expiry_status = 'active'`，清空 `expiry_grace_until`
    7. 写入 `instance_renewals` 审计记录
  - 新增路由：`POST /api/servers/:id/renew`（body: `{ duration_days, use_wallet }`）
  - 前端实例详情页新增"续费"按钮，弹窗选择时长（7天/30天/90天/365天/永久）
- **建议**：续费时长从当前 `expires_at` 起算（未过期）或从 `now` 起算（已过期），避免"续费反而缩短有效期"

#### 步骤 4：前端到期展示与提醒（修复 C8）
- **开发事项**：
  - 实例列表页：在实例卡片右上角展示有效期徽章（`永久` / `剩余 N 天` / `已过期` / `宽限期剩余 N 天`），剩余 ≤ 3 天显示红色
  - 实例详情页：新增"有效期"区块，展示倒计时 + 续费按钮 + 历史续费记录（`instance_renewals` 列表）
  - 用户通知中心：到期前提醒天数由 `instance.expiry.reminder_days_before` 配置（默认 7/3/1 天），复用既有 `notificationService`
  - 移动端玩家门户：服主可在 `instance_shop_configs` 配置"到期提醒文案"，玩家进入实例时展示
- **建议**：徽章颜色遵循 Apple 风格（绿色=永久/有效、橙色=即将到期、红色=已过期）

#### 步骤 5：实例有效期与 VIP 联动（修复 C9）
- **开发事项**：
  - VIP 等级影响（全部通过 `system_config` 配置，管理员可调）：
    - 续费折扣：`vip.renewal_discount_levels`（默认 `{"3": 90, "4": 80, "5": 50}`，单位百分比）
    - 宽限期延长：`vip.grace_days_overrides`（默认 `{"3": 14, "4": 21, "5": 30}`，覆盖 `instance.expiry.grace_days`）
    - 磁盘保留期延长：`vip.retention_days_overrides`（默认 `{"3": 60, "4": 120, "5": 180}`，覆盖 `instance.expiry.retention_days`）
  - 配置契约统一存于 `system_config` 表，key 前缀 `vip.*`
  - `instanceExpiryService` 在计算宽限期/保留期时查询用户在该实例的 VIP 等级并应用 override
- **建议**：override 配置仅在 VIP 等级 ≥ 3 时生效，避免低等级用户滥用

### 5.2 决策点（已闭合）

> **决策点 V4（已闭合）**：到期处置策略 → **全参数系统管理员可配**
> - 不预设 A/B/C 三档固定策略，所有参数（提醒天数、宽限期、保留期、是否立即停止、是否清理磁盘、扫描频率）通过 `system_config` 表统一配置
> - 系统管理员可在系统设置页动态调整，详见 5.1 步骤 2 建议清单

> **决策点 V5（已闭合）**：试用实例机制 → **不引入**
> - 简化模型，用户直接购买或创建永久实例
> - 不新增 `trial_until` / `trial_instance` 字段，不新增 `user_trial_records` 表
> - v2 若需引入再单独评估

> **决策点 V6（已闭合）**：续费定价模型 → **全部可配置**
> - 每个 Pack 在 `pack.business.instance.pricing.daily_price` 独立配置基础单价
> - 阶梯折扣通过 `pack.business.instance.pricing.tier_discounts` JSON 配置（按续费时长匹配折扣）
> - VIP 续费折扣叠加通过 `vip.renewal_discount_levels` 配置
> - 详见 5.1 步骤 3

---

## 六、配额与调度补强方案

### 6.1 执行步骤

#### 步骤 1：配额预警（修复 D2）
- **开发事项**：
  - 在 [quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts) 新增 `getQuotaAlerts(userId)`：返回 `{ instances: { used, limit, percent }, disk: {...} }`，percent ≥ 80% 标记预警
  - 调度任务 `QUOTA_ALERT_SCAN`（每日 9 点）：扫描所有用户配额使用率，对 ≥ 80% 的用户发送站内信预警
  - 前端用户工作台首页新增"配额使用"卡片，展示进度条 + 升级提示
- **建议**：预警阈值（80%/95%）通过 `system_config` 配置

#### 步骤 2：调度任务注册清单汇总（修复 D1）

**v1 实施任务（9 个）**：

| 任务类型 | cron_expr | executor | 来源步骤 |
|----------|-----------|----------|----------|
| `VIP_EXPIRY_SCAN` | `0 * * * *` | `vipService.checkAndDowngradeExpiredVip` | 3.1 步骤 1 |
| `VIP_POINTS_CHECK` | `0 */6 * * *` | `vipPointService.checkAndUpgradeVip`（每 6 小时） | 3.1 步骤 4 |
| `INSTANCE_EXPIRY_SCAN` | `0 * * * *` | `instanceExpiryService.scanExpiringInstances` + `processExpiredInstances` | 5.1 步骤 2 |
| `INSTANCE_GRACE_CLEANUP` | `0 3 * * *` | `instanceExpiryService.processGraceExpiredInstances` | 5.1 步骤 2 |
| `INSTANCE_DISK_CLEANUP` | `0 4 * * *` | `instanceExpiryService.cleanupExpiredInstances` | 5.1 步骤 2 |
| `INSTANCE_EXPIRY_REMINDER` | `0 9 * * *` | `instanceExpiryService.sendExpiryReminders` | 5.1 步骤 2 |
| `WALLET_DAILY_SNAPSHOT` | `0 1 * * *` | `walletService.snapshotAllWallets` | 4.1 步骤 2 |
| `WALLET_SNAPSHOT_CLEANUP` | `0 5 * * *` | `walletService.cleanupOldSnapshots`（保留 90 天） | 4.1 步骤 2 |
| `QUOTA_ALERT_SCAN` | `0 9 * * *` | `quotaService.scanQuotaAlerts` | 6.1 步骤 1 |

**v2 预留任务（v1 不实施）**：

| 任务类型 | cron_expr | executor | 来源步骤 |
|----------|-----------|----------|----------|
| `SUBSCRIPTION_RENEWAL_SCAN`（v2） | `0 2 * * *` | `subscriptionService.processRenewal` | 4.1 步骤 5 |

---

## 七、数据库迁移变更清单

### 7.1 新增迁移文件清单（v1 实施）

| 迁移文件名 | 变更内容 | 关联步骤 |
|-----------|----------|----------|
| `20260807000001_add_expiry_to_servers.ts` | `servers` 新增 `expires_at` / `expiry_status` / `expiry_grace_until` | 5.1 步骤 1 |
| `20260807000002_add_vip_type_to_bindings.ts` | `user_instance_bindings` 新增 `vip_type` | 3.1 步骤 3 |
| `20260807000003_create_user_vip_points.ts` | 新建 `user_vip_points` 表 | 3.1 步骤 4 |
| `20260807000004_create_recharge_cdks.ts` | 新建 `recharge_cdks` + `recharge_cdk_batches` 表 | 4.1 步骤 1 |
| `20260807000005_create_wallet_refund_orders.ts` | 新建 `wallet_refund_orders` 表 | 4.1 步骤 3 |
| `20260807000006_create_wallet_daily_snapshots.ts` | 新建 `wallet_daily_snapshots` 表 | 4.1 步骤 2 |
| `20260807000007_create_coupons.ts` | 新建 `coupons` + `user_coupons` 表 | 4.1 步骤 4 |
| `20260807000008_add_price_to_cdk_codes.ts` | `cdk_codes` 新增 `price` 字段 | 4.1 步骤 6 |
| `20260807000009_create_instance_renewals.ts` | 新建 `instance_renewals` 表 | 5.1 步骤 3 |

### 7.2 v2 预留迁移（v1 不实施）

| 迁移文件名 | 变更内容 | 关联步骤 |
|-----------|----------|----------|
| `create_subscriptions.ts`（v2） | 新建 `subscriptions` 表 + `shop_items` 新增订阅字段 | 4.1 步骤 5 |
| `create_user_trial_records.ts`（v2） | 新建 `user_trial_records` 表（若 v2 引入试用实例） | 5.1 步骤 4（v1 已删除） |

### 7.3 迁移编写规范
- 所有迁移用 `hasTable` / `hasColumn` 保护，幂等可重跑
- 存量数据回填：`expires_at = NULL`、`expiry_status = 'permanent'`、`vip_type = 'permanent'`、`price = 0`
- 禁止在迁移中删除既有列（deprecated 字段保留 2 个版本周期）
- 每个迁移文件头注释需包含：变更说明、依据契约、热更新安全性说明

---

## 八、服务层改造清单（v1 实施）

| 服务文件 | 改造内容 | 关联步骤 |
|----------|----------|----------|
| [vipService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/vipService.ts) | 新增 `setVipWithType`（按 `vip_type` 自动计算过期时间） | 3.1 步骤 3 |
| **vipPointService.ts**（新建） | `addPoints` / `getPoints` / `checkAndUpgradeVip` | 3.1 步骤 4 |
| [walletService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/walletService.ts) | 新增 `requestRefund` / `approveRefund` / `getMonthlyBill` / `snapshotAllWallets`（充值由 rechargeCdkService 调用既有 `credit`） | 4.1 步骤 2、3 |
| **rechargeCdkService.ts**（新建） | `createBatch` / `listBatches` / `listCodesByBatch` / `redeem`（调用 `walletService.credit` 加款）/ `rollbackStaleClaiming` | 4.1 步骤 1 |
| [shopService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/shopService.ts) | `createOrder` 增加 `coupon_code` 参数；订单成功后调用 `vipPointService.addPoints` | 4.1 步骤 4、3.1 步骤 4 |
| [cdkService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/cdkService.ts) | `redeem` 增加 `price > 0` 时的余额扣款逻辑 | 4.1 步骤 6 |
| [quotaService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/quotaService.ts) | `getEffectiveQuota` 增加 VIP 派生配额优先级；新增 `getQuotaAlerts` / `scanQuotaAlerts` | 3.1 步骤 2、6.1 步骤 1 |
| **instanceExpiryService.ts**（新建） | `scanExpiringInstances` / `processExpiredInstances` / `processGraceExpiredInstances` / `cleanupExpiredInstances` / `renewInstance` / `sendExpiryReminders` | 5.1 步骤 2、3 |
| [scheduler.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/scheduler.ts) | 新增 9 个任务类型常量（移除 `SUBSCRIPTION_RENEWAL_SCAN`） | 6.1 步骤 2 |

### v2 预留服务（v1 不实施）

| 服务文件 | 改造内容 | 关联步骤 |
|----------|----------|----------|
| **subscriptionService.ts**（v2 新建） | `subscribe` / `cancel` / `processRenewal` | 4.1 步骤 5 |

---

## 九、API 路由变更清单（v1 实施）

| 路由 | 方法 | 说明 | 关联步骤 |
|------|------|------|----------|
| `/api/servers` | POST | 新增 `duration_days` 参数 | 5.1 步骤 1 |
| `/api/servers/:id/renew` | POST | 续费实例 | 5.1 步骤 3 |
| `/api/servers/:id/renewals` | GET | 续费历史 | 5.1 步骤 3 |
| `/api/servers/:id/expiry` | GET | 查询有效期状态 | 5.1 步骤 1 |
| `/api/recharge-cdks/batches` | POST | 管理员创建充值 CDK 批次 | 4.1 步骤 1 |
| `/api/recharge-cdks/batches` | GET | 管理员查询批次列表 | 4.1 步骤 1 |
| `/api/recharge-cdks/batches/:id/codes` | GET | 批次下 CDK 列表（含 CSV 导出） | 4.1 步骤 1 |
| `/api/wallet/recharge-cdk/redeem` | POST | 用户兑换充值 CDK | 4.1 步骤 1 |
| `/api/wallet/bill` | GET | 月度账单 | 4.1 步骤 2 |
| `/api/wallet/refund/request` | POST | 发起退款申请 | 4.1 步骤 3 |
| `/api/wallet/refund/:id/approve` | POST | 管理员审批退款 | 4.1 步骤 3 |
| `/api/wallet/refund/:id/reject` | POST | 管理员拒绝退款 | 4.1 步骤 3 |
| `/api/coupons` | GET/POST | 优惠券列表/创建 | 4.1 步骤 4 |
| `/api/coupons/:code/claim` | POST | 领取优惠券 | 4.1 步骤 4 |
| `/api/vip/points` | GET | 查询积分 | 3.1 步骤 4 |
| `/api/vip/types` | GET | VIP 套餐类型列表 | 3.1 步骤 3 |
| `/api/quotas/alerts` | GET | 配额预警 | 6.1 步骤 1 |

### v2 预留路由（v1 不实施）

| 路由 | 方法 | 说明 | 关联步骤 |
|------|------|------|----------|
| `/api/wallet/subscriptions` | GET/POST | 订阅列表/创建订阅（v2） | 4.1 步骤 5 |
| `/api/wallet/subscriptions/:id/cancel` | POST | 取消订阅（v2） | 4.1 步骤 5 |

---

## 十、前端改造清单（v1 实施）

| 页面/组件 | 改造内容 | 关联步骤 |
|-----------|----------|----------|
| 实例列表页 | 卡片新增有效期徽章 + 倒计时 | 5.1 步骤 4 |
| 实例详情页 | 新增"有效期"区块 + 续费弹窗 + 续费历史 | 5.1 步骤 4 |
| 创建实例页 | 新增时长选择（7天/30天/90天/365天/永久） | 5.1 步骤 1 |
| 钱包页 | 新增"兑换充值码" / "账单" / "退款" tab | 4.1 步骤 1、2、3 |
| 管理员后台 | 新增"充值 CDK 管理"页：批次创建/列表/CDK 导出（CSV） | 4.1 步骤 1 |
| 商城结算页 | 新增"使用优惠券"入口 | 4.1 步骤 4 |
| CDK 兑换页 | 显示付费 CDK 价格 | 4.1 步骤 6 |
| VIP 开通页 | 4 档套餐选择（月/季/年/永久） | 3.1 步骤 3 |
| VIP 权益页 | 展示积分 + 等级进度 | 3.1 步骤 4 |
| 工作台首页 | 新增"配额使用"卡片 | 6.1 步骤 1 |
| 用户通知中心 | 到期前提醒 + 宽限期通知（天数可配） | 5.1 步骤 4 |
| 系统设置页 | 新增"实例到期策略"配置区块（grace_days / retention_days 等） | 5.1 步骤 2 |

---

## 十一、公共契约变更清单（v1 实施）

> 所有 `public/` 变更走 s0601 适配契约变更流程，需人类显式授权。

| 契约文件 | 变更类型 | 变更内容 |
|----------|----------|----------|
| `public/schema/server-schema.json` | MINOR | 新增 `expires_at` / `expiry_status` / `expiry_grace_until` |
| `public/schema/user-wallets-schema.json` | MAJOR | 新增 `wallet_refund_orders` / `wallet_daily_snapshots` 子 schema |
| **新建** `public/schema/recharge-cdks-schema.json` | — | 充值 CDK + 批次 schema |
| `public/schema/cdk-codes-schema.json` | MINOR | 新增 `price` 字段 |
| **新建** `public/schema/instance-renewals-schema.json` | — | 续费记录 schema |
| **新建** `public/schema/coupons-schema.json` | — | 优惠券 schema |
| **新建** `public/schema/user-vip-points-schema.json` | — | VIP 积分 schema |
| `public/schema/vip-permissions-schema.json` | PATCH | 注释补充 `vip_type` 与 `vip_expires_at` 的关系说明 |
| `public/schema/user-schema.json` | PATCH | `vip_level` / `vip_expires_at` 标注 `deprecated: true` |
| `public/config_template/system-config.json` | MINOR | 新增 `vip.*` / `instance.expiry.*` / `quota.alerts.*` 配置项 |
| `public/interface_stub/instance-expiry-service.d.ts` | — | 新增接口存根 |
| `public/interface_stub/vip-point-service.d.ts` | — | 新增接口存根 |
| `public/interface_stub/recharge-cdk-service.d.ts` | — | 新增接口存根 |
| `public/schema/pack-schema-extension.json` | MINOR | 新增 `pack.business.instance.pricing.daily_price` / `tier_discounts` |

### v2 预留契约（v1 不实施）

| 契约文件 | 变更类型 | 变更内容 |
|----------|----------|----------|
| `public/schema/shop-items-schema.json`（v2） | MINOR | 新增 `is_subscription` / `billing_cycle_days` |
| **新建** `public/schema/subscriptions-schema.json`（v2） | — | 订阅 schema |
| `public/interface_stub/subscription-service.d.ts`（v2） | — | 新增接口存根 |

---

## 十二、风险与建议

### 12.1 风险

1. **数据迁移风险**：`servers` 表新增 `expires_at` 后，存量实例默认 `permanent`，但若管理员误批量设置短期有效期，可能导致大量实例同时到期触发调度任务雪崩
   - 建议：调度任务增加单次处理上限（如 500 条/次），超限分批
2. **调度任务并发风险**：10 个新增调度任务与既有 14 个任务叠加，每小时并发触发可能压垮 SQLite
   - 建议：调度任务错峰执行（cron 表达式分散到不同分钟），关键任务用 `next_run_at` 锁防重入
3. **VIP 折扣与优惠券叠加风险**：用户可能组合使用导致 0 元订单
   - 建议：叠加规则在 `shopService.createOrder` 入口强校验，0 元订单仅允许 `total_price = 0` 的免费商品
4. **试用实例滥用风险**：用户重复注册账号创建试用实例
   - 建议：试用实例绑定 `game_player_name` 或设备指纹，限制每设备/Pack 仅 1 个试用
5. **`users.vip_level` 双源真相风险**：deprecated 字段仍可能被新代码误读
   - 建议：在 [vipService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/vipService.ts) 头部加 ESLint `@deprecated` 注解，CI 增加规则禁止新代码引用

### 12.2 整体建议

1. **分批落地**：建议按"决策点 → 迁移 → 服务 → 路由 → 前端 → 调度注册"顺序推进，每批落地后跑 E2E 验证
2. **配置先行**：所有可调参数（宽限期、保留期、折扣、配额 override）统一存 `system_config` 表，避免硬编码
3. **审计完备**：续费、退款、到期处置、VIP 升级等关键操作必须写入 `audit_logs`，复用既有 `auditLogService`
4. **演示模式同步**：[demo 模式](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/demo.ts) 需同步注入演示数据：试用实例、VIP 套餐、优惠券、订阅记录，确保演示页 5 个场景仍可正常循环
5. **文档同步**：落地后更新 `version.md`（小版本号 +1）与 `README.md`（如涉及功能结构调整），遵循 [bb.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/bb.md) 版本号规则
6. **独立审查**：每个决策点（V1-V6）闭合后，建议在交付前由独立审查（GN-004 能力，由 `general_purpose_task` 承载）对契约变更、迁移幂等性、调度任务注册做一次完整审查

---

## 十三、决策点汇总（已全部闭合）

| 决策点 ID | 主题 | 用户决策 | 影响范围 |
|-----------|------|----------|----------|
| V1 | VIP 升级路径 | **引入积分制**（user_vip_points 表 + vipPointService + 消费/签到/CDK 兑换积分 + 自动升级） | VIP 体系复杂度 |
| V2 | 钱包充值通道 | **卡商充值 CDK 机制**（管理员生成充值 CDK 批次 → 卡商转卖 → 用户兑换点券，不接入第三方支付） | 支付合规与开发量 |
| V3 | 订阅制是否在 v1 引入 | **v1 不引入，v2 评估**（VIP 套餐已覆盖周期权益需求） | 与 VIP 套餐的关系 |
| V4 | 到期处置策略 | **全参数系统管理员可配**（reminder_days_before / grace_days / retention_days / stop_on_expire / cleanup_disk / scan_interval 全部通过 system_config 配置） | 用户体验与磁盘成本 |
| V5 | 试用实例机制 | **不引入**（简化模型，v2 若需引入再评估） | 用户增长与防滥用 |
| V6 | 续费定价模型 | **全部可配置**（pack.business.instance.pricing.daily_price + tier_discounts + vip.renewal_discount_levels 三层配置） | 商业化收益 |

> ✅ V1-V6 全部闭合，本方案状态由 `planning` 转为 `ready-for-implementation`。
> 下一步按 s0201/s0203 流程生成三层契约与模块拆分，进入 S2 契约冻结阶段（[V] 节点，需独立审查 + 人类裁决）。

---

> *本方案遵循 gsp 项目规范 AC 范式 v6 锚点管理原则，作为基础逻辑体系完善的顶层规划指南，存放于 `docs/plans/` 目录。决策点已闭合，下一步走 s0201/s0203 流程收束为可执行方案。*
