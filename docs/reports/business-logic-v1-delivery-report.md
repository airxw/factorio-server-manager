---
type: report
title: business-logic-v1 整体交付报告（VIP / 价格 / 实例有效期体系契约冻结）
date: 2026-07-25
status: delivered
related:
  - docs/plans/business-logic-system-completion-plan.md
  - .trae/specs/business-logic-v1-contracts/README.md
  - .trae/specs/business-logic-v1-contracts/consistency-check-report.md
  - current-note.md
tags: [vip, pricing, wallet, instance-expiry, quota, scheduler, contracts, business-logic-v1]
---

# business-logic-v1 整体交付报告

> 本报告汇总「完善整体基础逻辑设定（VIP / 价格 / 实例有效期体系等）」任务从调研到契约落位的全过程产出。
> 阶段范围：S0 需求分析 → S1 方案对抗与融合 → S2 契约冻结（含落位 + 验证）。
> 下游接续：S3 模块化拆分（s0203）→ S4 并行开发（s0401）→ S5 契约校验 → S6 合流交付。

---

## 一、任务目标

用户原始诉求：完善项目整体基础逻辑设定，覆盖 VIP 体系、价格体系、实例有效期体系等核心业务闭环；先调研项目，再制定方案文档，遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

工程目标：在 v4.11.0 商业化重构（global_assets / instance_assets 已落地）基础上，补齐三类基础逻辑闭环——VIP 等级生命周期、价格与钱包流转、实例有效期与到期处置——并打通四者之间的联动。

---

## 二、调研结论（现状盘点）

### 2.1 已落地能力（可直接复用）

| 体系 | 已落地内容 | 关键文件 |
|------|-----------|----------|
| VIP 等级 | `vip_permissions` 全局模板（0-5 级） | panel/backend/src/db/migrations/20260703000002_create_vip_permissions.ts |
| VIP 实例绑定 | `user_instance_bindings.vip_level` + `vip_expires_at`，已实现过期降级 | panel/backend/src/services/vipService.ts |
| VIP 品质校验 | VIP N 可购 tier ≤ N-1；管理员融合为 VIP5 | panel/backend/src/services/vipService.ts |
| VIP 每日点券 | 阶梯 100/200/400/800/1600/3200 | panel/backend/src/services/walletService.ts |
| VIP 折扣 | `vip.discount_levels` JSON 配置 | panel/backend/src/services/shopService.ts |
| 钱包 | `user_wallets`（按实例作用域）+ debit/credit/refund 原子操作 | panel/backend/src/services/walletService.ts |
| 商品与订单 | `shop_items` / `shop_orders`（价格快照 + 乐观锁状态机） | panel/backend/src/services/shopService.ts |
| 资产继承 | `global_assets` + `instance_assets` | panel/backend/src/db/migrations/20260805000001_create_asset_tables.ts |
| CDK 兑换码 | `cdk_codes` + `cdk_code_items`（多物品礼包，乐观锁状态机） | panel/backend/src/services/cdkService.ts |
| 资源配额 | `resource_quotas`（scope_type: role/user，优先级 user > role > 不限） | panel/backend/src/services/quotaService.ts |
| 三级角色 | server_admin / instance_admin / user | panel/backend/src/services/instanceAdminService.ts |
| 调度器 | 支持 `interval_ms` / `next_run_at` / `cron_expr`，已注册 22 种任务类型 | panel/backend/src/services/scheduler.ts |

### 2.2 关键缺口（本任务补齐）

**A. VIP 体系缺口**
- A1：`checkAndDowngradeExpiredVip` 已实现但未注册到 scheduler（死代码）
- A2：VIP 等级与资源配额无联动
- A3：VIP 升级路径缺失（无积分/成长值机制）
- A4：VIP 类型分层缺失（无月卡/季卡/年卡/终身概念）
- A5：`users.vip_level` / `vip_expires_at` 历史包袱未清理（双源真相风险）

**B. 价格体系缺口**
- B1：钱包无充值通道（无充值 CDK / 第三方支付）
- B2：无账单/对账系统
- B3：无用户发起的退款流程
- B4：无促销/优惠券
- B5：无订阅制
- B6：CDK 与商品价格未对齐（CDK 仅免费发放，无 `price` 字段）

**C. 实例有效期体系缺口（核心）**
- C1：`servers` 表无 `expires_at` 字段（实例默认永久存在）
- C2：无 `instance_renewals` 续费记录表
- C3：scheduler 未注册实例到期扫描任务
- C4：无过期宽限期机制
- C5：无到期数据保留策略
- C6：无试用实例机制
- C7：无手动/自动续费入口
- C8：前端无到期倒计时/到期提醒
- C9：实例到期与 VIP 体系无联动

**D. 配额与调度缺口**
- D1：scheduler 任务清单中无 VIP 过期扫描、实例到期扫描、到期前提醒
- D2：配额校验仅在创建实例和上传文件入口，无预警
- D3：`resource_quotas` 不支持按 VIP 等级派生配额

---

## 三、决策点闭合（6 个 [V] 节点）

用户通过 AskUserQuestion 逐项裁决 6 个决策点：

| 决策点 ID | 主题 | 用户决策 | 影响范围 |
|-----------|------|----------|----------|
| V1 | VIP 升级路径 | **引入积分制** | user_vip_points 表 + vipPointService + 消费/签到/CDK 兑换积分 + 自动升级；积分只升不降 |
| V2 | 钱包充值通道 | **卡商充值 CDK 机制** | 管理员生成充值 CDK 批次 → 卡商转卖 → 用户兑换点券；不接入第三方支付 |
| V3 | 订阅制是否在 v1 引入 | **v1 不引入，v2 评估** | VIP 套餐已覆盖周期权益需求 |
| V4 | 到期处置策略 | **全参数系统管理员可配** | reminder_days_before / grace_days / retention_days / stop_on_expire / cleanup_disk / scan_interval 全部 system_config 可调 |
| V5 | 试用实例机制 | **不引入** | 简化模型，v2 若需引入再评估 |
| V6 | 续费定价模型 | **全部可配置** | pack.business.instance.pricing.daily_price + tier_discounts + vip.renewal_discount_levels 三层配置 |

方案文档状态由 `planning` 转为 `ready-for-implementation`，进入 S2 契约冻结阶段。

---

## 四、三层契约产出

### 4.1 数据契约（JSON Schema draft-07）

新建 8 个：

| # | 文件 | 用途 | 关联决策 |
|---|------|------|----------|
| 1 | instance-renewals-schema.json | 实例续费记录 | V6 |
| 2 | recharge-cdks-schema.json | 充值 CDK | V2 |
| 3 | recharge-cdk-batches-schema.json | 充值 CDK 批次 | V2 |
| 4 | wallet-refund-orders-schema.json | 退款申请 | — |
| 5 | wallet-daily-snapshots-schema.json | 钱包日快照（对账） | — |
| 6 | coupons-schema.json | 优惠券模板 | — |
| 7 | user-coupons-schema.json | 用户优惠券 | — |
| 8 | user-vip-points-schema.json | VIP 积分 | V1 |

修改既有 schema（通过 schema-deltas 声明）：
- `server-schema.json`：新增 `expires_at` / `expiry_status` / `expiry_grace_until`（V4）
- `cdk-codes-schema.json`：新增 `price` 字段（B6）
- `user-schema.json`：`vip_level` / `vip_expires_at` 标注 deprecated（A5）
- `pack-schema-extension.json`：新增 `business.instance.pricing`（V6）
- `vip-permissions-schema.json`：注释补充

### 4.2 接口契约（.d.ts 存根）

新建 5 个：

| # | 文件 | 说明 |
|---|------|------|
| 1 | instance-expiry-service.d.ts | 实例有效期服务（扫描/宽限/续费/清理） |
| 2 | vip-point-service.d.ts | VIP 积分服务（积分/签到/自动升级） |
| 3 | recharge-cdk-service.d.ts | 充值 CDK 服务（批次管理/兑换） |
| 4 | wallet-service.d.ts | 钱包服务完整存根（既有 impl 首次发布契约，含退款/账单/快照） |
| 5 | quota-service.d.ts | 配额服务完整存根（既有 impl 首次发布契约，含 VIP 派生配额/预警） |

扩展既有接口（通过 interface-deltas 声明）：
- `vip-service.d.ts`：新增 `setVipWithType` / `listVipTypes`
- `shop-service.d.ts`：`createOrder` 追加 `couponCode` 参数 + `applied_discount` 返回；新增 `claimCoupon`
- `cdk-service.d.ts`：`redeem` 增加 `userId` 参数 + `amount_paid` 返回（付费 CDK）
- `shared-types.d.ts`：SchedulerTaskType union 追加 9 个新成员

### 4.3 配置契约

新建 `system-config-extension.schema.json`，扩展 system_config：
- `vip.*`：points_thresholds / checkin_points / cdk_redeem_points / purchase_points_ratio / quota_overrides / renewal_discount_levels / grace_days_overrides / retention_days_overrides / vip_type_prices
- `instance.expiry.*`：reminder_days_before / grace_days / retention_days / stop_on_expire / cleanup_disk_after_retention / scan_interval_hours
- `quota.alerts.*`：warning_threshold / critical_threshold
- `wallet.*`：snapshot_retention_days / refund_allowed / refund_max_amount
- `recharge_cdk.*`：code_length / code_charset / max_batch_size / claiming_timeout_minutes

### 4.4 错误码契约

`error-codes-extension.json` 新增 24 个错误码（含 2 个既有 impl 已用首次纳入契约）：
- wallet 类：INSUFFICIENT_BALANCE / DAILY_REWARD_ALREADY_CLAIMED / WALLET_NOT_FOUND
- recharge 类：RECHARGE_CDK_INVALID / RECHARGE_CDK_ALREADY_REDEEMED / RECHARGE_CDK_EXPIRED / RECHARGE_CDK_BATCH_NOT_FOUND / RECHARGE_CDK_BATCH_CREATE_FAILED
- refund 类：REFUND_ORDER_NOT_FOUND / REFUND_ORDER_NOT_PENDING / ORDER_NOT_REFUNDABLE / REFUND_AMOUNT_EXCEEDS_LIMIT
- coupon 类：COUPON_INVALID / COUPON_ALREADY_CLAIMED / COUPON_USAGE_LIMIT_EXCEEDED / COUPON_NOT_APPLICABLE
- expiry 类：INSTANCE_NOT_RENEWABLE / INSTANCE_EXPIRY_CONFIG_ERROR
- vip 类：BINDING_NOT_FOUND
- quota 类：QUOTA_LIMIT_REACHED / QUOTA_CONFIG_ERROR
- points 类：VIP_POINTS_CONFIG_ERROR / VIP_LEVEL_UPGRADE_FAILED / VIP_CHECKIN_ALREADY_TODAY

category enum 扩展 7 个新类别：wallet / recharge / refund / coupon / expiry / quota / points

---

## 五、独立审查（GN-004）过程

按 rules-0 §四-8.0 Spec/Plan 交付前独立审查闸门执行，由 `general_purpose_task` 承载（prompt 注入审查 rubric，仅审查不写代码）。

### 5.1 三轮审查

| 轮次 | 阻断类型 | 数量 | 处理 |
|------|----------|------|------|
| v1 | 阻断（BLOCK） | 5 | B1 shop-service createOrder 签名破坏 / B2 scheduler TaskType 冲突 / B3 BindingNotFoundError 未定义 / B4 RechargeCdkBatchCreateError 未定义 / B5 退款扣积分与"积分只升不降"冲突 |
| v1 | 软阻断（SOFT_BLOCK） | 2 | S1 wallet-service.d.ts 与 quota-service.d.ts 缺失 / S2 error-codes category enum 遗漏 7 个既有类别 |
| v1.1 | 阻断（B-NEW） | 2 | B-NEW-1 wallet/quota-service 引用 9 个未声明类型 / B-NEW-2 错误码命名 + HTTP 状态不一致 |
| v1.1 | 软阻断（S-NEW） | 2 | S-NEW-1 报告风险项与 schema 不一致 / S-NEW-2 DailyRewardAlreadyClaimedError 缺错误码 |
| v1.1 | 警示（W-NEW） | 4 | W-NEW-1 错误码数量 / W-NEW-2 Error 类数量 / W-NEW-3 类名与错误码不一致 / W-NEW-4 对齐表缺失 |
| v1.2 | 数字同步修复 | — | 全部对齐 |
| 最终 | — | — | 通过 |

### 5.2 关键设计修正

- **B5 退款扣积分**：移除 `wallet_refund_orders.points_to_deduct` 字段，明确"退款不扣积分（决策 V1：积分只升不降）"，避免负向体验
- **B-NEW-2 错误码命名**：保留既有 `INSUFFICIENT_BALANCE`（不重命名为 `WALLET_INSUFFICIENT_BALANCE`），HTTP 状态对齐既有 `shop.ts` 的 400（不改为 402）
- **S-NEW-2 既有 impl 已用错误码首次纳入契约**：`INSUFFICIENT_BALANCE` 与 `DAILY_REWARD_ALREADY_CLAIMED` 在既有 impl `errors.ts` 已使用，本次首次纳入 public 契约
- **S1 既有 impl 首次发布契约**：walletService / quotaService 实现已存在但契约从未发布，本次补齐完整契约（既有方法 + v1 新增方法）

---

## 六、public/ 落位变更

按 rules-0 §四-10 public/ 保护指令，获人类显式授权后执行分批落位。

### 6.1 新建文件（14 个）

**8 个新 schema**（落位到 `public/schema/`）：
- instance-renewals-schema.json
- recharge-cdks-schema.json
- recharge-cdk-batches-schema.json
- wallet-refund-orders-schema.json
- wallet-daily-snapshots-schema.json
- coupons-schema.json
- user-coupons-schema.json
- user-vip-points-schema.json

**5 个新 .d.ts**（落位到 `public/interface_stub/`）：
- instance-expiry-service.d.ts
- vip-point-service.d.ts
- recharge-cdk-service.d.ts
- wallet-service.d.ts
- quota-service.d.ts

**1 个新 config 模板**（落位到 `public/config_template/`）：
- system-config-extension.schema.json

### 6.2 修改文件（9 个）

**4 个 schema 修改**：
- server-schema.json（+3 expiry 字段）
- cdk-codes-schema.json（+price 字段）
- user-schema.json（vip_level + vip_expires_at 标 deprecated）
- pack-schema-extension.json（+business.instance.pricing）

**4 个 .d.ts 修改**：
- vip-service.d.ts（+setVipWithType / +listVipTypes）
- shop-service.d.ts（createOrder +couponCode/+applied_discount，+claimCoupon）
- cdk-service.d.ts（redeem +userId/+amount_paid）
- shared-types.d.ts（+9 SchedulerTaskType 成员，+43 新类型）

**1 个错误码合并**：
- error-codes-schema.json（+24 codes / +7 categories，共 71 codes / 19 categories）

---

## 七、验证结果

落位后执行全面验证，全部通过：

| 验证项 | 方法 | 结果 |
|--------|------|------|
| JSON syntax | `python3 json.load` | 14/14 文件 valid |
| TypeScript compile | `npx tsc --noEmit --skipLibCheck` | exit 0（0 错误） |
| .d.ts brace 平衡 | grep 计数 `{` / `}` | 9/9 文件平衡 |
| 24 个新错误码 | grep + JSON 路径校验 | 全部在 definitions.predefined_codes.properties |
| 7 个新 category | JSON enum 校验 | 全部在 category enum |
| 43 个新类型 | grep shared-types.d.ts | 全部在位 |
| 9 个新 SchedulerTaskType | grep shared-types.d.ts | 全部在位 |
| Schema Deltas 应用 | grep 各 schema 文件 | 6 项全部应用 |
| Interface Deltas 应用 | grep 各 .d.ts 文件 | 4 项全部应用（含 shop-service.d.ts 补齐 claimCoupon） |

---

## 八、关键设计决策记录

| 决策 | 内容 |
|------|------|
| VIP 升级路径 | 积分制（消费 1 点券 = 1 积分，签到 +10，CDK 兑换 +5，积分只升不降） |
| 钱包充值 | 卡商机制（管理员批量生成充值 CDK → 卡商转卖 → 玩家兑换） |
| 实例到期 | 全参数可配（grace_days / retention_days / reminder_days_before / stop_on_expire / cleanup_disk_after_retention） |
| 续费定价 | 全可配（daily_price × tier_discounts × vip_discount，支持 manual/gift 两种类型） |
| 配额优先级 | user > role > VIP 派生 > default |
| 调度任务 | 9 个新任务（VIP 过期扫描 / VIP 积分升级 / 实例到期扫描 / 宽限清理 / 磁盘清理 / 到期提醒 / 钱包日快照 / 快照清理 / 配额预警扫描） |
| 实例过期状态机 | permanent / active / grace / expired / cleaned |
| 充值 CDK 状态机 | unused / claiming / used / expired（乐观锁抢占 + 5min 超时回滚） |
| 退款状态机 | pending / approved / rejected / completed / cancelled |
| 退款积分处理 | 不扣减（决策 V1：积分只升不降，避免负向体验） |
| 优惠券折扣叠加 | VIP 折扣与优惠券不叠加，取最优 |
| 0 元订单 | 仅允许 total_price = 0 的免费商品 |

---

## 九、调度任务清单（9 个新任务）

| 任务类型 | cron_expr | executor | 来源 |
|----------|-----------|----------|------|
| VIP_EXPIRY_SCAN | `0 * * * *` | vipService.checkAndDowngradeExpiredVip | 激活既有死代码 |
| VIP_POINTS_CHECK | `0 */6 * * *` | vipPointService.checkAndUpgradeVip | 新增（每 6 小时） |
| INSTANCE_EXPIRY_SCAN | `0 * * * *` | instanceExpiryService.scanExpiringInstances + processExpiredInstances | 新增 |
| INSTANCE_GRACE_CLEANUP | `0 3 * * *` | instanceExpiryService.processGraceExpiredInstances | 新增 |
| INSTANCE_DISK_CLEANUP | `0 4 * * *` | instanceExpiryService.cleanupExpiredInstances | 新增 |
| INSTANCE_EXPIRY_REMINDER | `0 9 * * *` | instanceExpiryService.sendExpiryReminders | 新增 |
| WALLET_DAILY_SNAPSHOT | `0 1 * * *` | walletService.snapshotAllWallets | 新增 |
| WALLET_SNAPSHOT_CLEANUP | `0 5 * * *` | walletService.cleanupOldSnapshots（保留 90 天） | 新增 |
| QUOTA_ALERT_SCAN | `0 9 * * *` | quotaService.scanQuotaAlerts | 新增 |

v2 预留任务（v1 不实施）：
- `SUBSCRIPTION_RENEWAL_SCAN`（`0 2 * * *`，subscriptionService.processRenewal）

---

## 十、产出物清单

### 10.1 方案与契约文档

| 文件 | 类型 | 状态 |
|------|------|------|
| docs/plans/business-logic-system-completion-plan.md | 方案文档（13 章 + 6 决策点） | 闭合 |
| .trae/specs/business-logic-v1-contracts/README.md | 契约草案总览 | 闭合 |
| .trae/specs/business-logic-v1-contracts/consistency-check-report.md | 一致性校验报告 | 闭合 |
| .trae/specs/business-logic-v1-contracts/schema/schema-deltas.md | Schema 变更声明 | 闭合 |
| .trae/specs/business-logic-v1-contracts/interface_stub/interface-deltas.md | 接口变更声明 | 闭合 |
| current-note.md（business-logic-v1 段落） | 工程交接锚点 | 已更新 |

### 10.2 public/ 契约文件（23 个变更）

详见 §六「public/ 落位变更」。

### 10.3 验证证据链

- 14 个 JSON 文件 syntax valid
- TypeScript compile 0 错误
- 24 错误码 + 7 category + 43 类型 + 9 调度任务全部在位
- Schema Deltas 6 项 + Interface Deltas 4 项全部应用

---

## 十一、下游接续入口

### 11.1 s0202（生成稳定 Mock）

- **前置条件**：本次契约已落位（已满足）
- **任务**：基于 8 个新建 schema + 6 个新建 .d.ts 生成预生成 Mock
- **落位目标**：`public/pre_generated_mock/`

### 11.2 s0203（拓扑化模块拆分）

- **前置条件**：s0202 完成（Mock 就位）
- **任务**：基于 3 个新服务 + 6 个扩展服务设计模块依赖 DAG + AGENTS.md 模板
- **模块拆分维度**：
  - VIP 模块（vipService + vipPointService + vip-permissions schema）
  - 钱包模块（walletService + rechargeCdkService + wallet/refund/snapshot schema）
  - 实例有效期模块（instanceExpiryService + instance-renewals schema + server-schema 扩展）
  - 商城模块（shopService + coupons schema + cdk-codes 扩展）
  - 配额模块（quotaService + system-config vip.quota_overrides）
  - 调度模块（scheduler + 9 个新任务类型）

### 11.3 实施层（S4 并行开发）

按方案文档 §七-§十 的迁移/服务/路由/前端清单推进：
- 数据库迁移：9 个新迁移文件（v1）+ 2 个 v2 预留
- 服务层改造：3 个新服务 + 6 个扩展服务
- API 路由：17 个新路由
- 前端改造：12 个页面/组件

---

## 十二、阻断项与未闭合项

### 12.1 阻断项
无。本次任务全部闭合。

### 12.2 未闭合项（v2 预留）

| 项 | 性质 | 说明 |
|----|------|------|
| 订阅制（subscriptions） | v2 预留 | V3 决策：v1 不引入，v2 评估 |
| 试用实例（user_trial_records） | v2 预留 | V5 决策：v1 不引入 |
| 退款积分漂移处理 | v2 评估 | 退款不扣积分，可能产生积分"漂移"，v2 评估是否引入积分过期机制 |
| `users.vip_level` 物理删除 | 2 个版本周期后 | v1 仅标 deprecated，保留 2 个版本周期后删除 |

---

## 十三、阶段判定

| 阶段 | 状态 | 说明 |
|------|------|------|
| S0 需求分析 | ✅ 闭合 | 6 决策点结构化产出 |
| S1 方案对抗与融合 | ✅ 闭合 | 6 决策点全部裁决，方案 ready-for-implementation |
| S2 契约冻结 | ✅ 闭合 | 三层契约生成 + GN-004 3 轮审查 + 人类授权 + public/ 落位 + 验证 |
| S3 模块化拆分 | ⏳ 待启动 | 前置已满足，可进入 s0203 |
| S4 并行开发 | ⏳ 待启动 | 前置 S3 |
| S5 契约校验 | ⏳ 待启动 | 前置 S4 |
| S6 合流交付 | ⏳ 待启动 | 前置 S5 |
| S7 运维 | ⏳ 待启动 | 前置 S6 |

---

> 本报告为 business-logic-v1 任务的端到端交付记录，作为下游 S3-S7 阶段的入口文档。所有产出物已落位 public/ 与 .trae/specs/，状态锚点已写入 current-note.md。
