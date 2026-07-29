# 三层契约一致性校验报告

> 校验对象：.trae/specs/business-logic-v1-contracts/
> 校验时间：2026-07-25
> 校验者：s0201 Skill 自动校验
> 来源：docs/plans/business-logic-system-completion-plan.md（6 决策点已闭合）

---

## 一、三层契约覆盖清单

### 1.1 数据契约（JSON Schema，draft-07）

| # | 文件 | 类型 | 关联方案章节 |
|---|------|------|--------------|
| 1 | schema/instance-renewals-schema.json | 新建 | §5.1 步骤 3 |
| 2 | schema/recharge-cdks-schema.json | 新建 | §4.1 步骤 1 |
| 3 | schema/recharge-cdk-batches-schema.json | 新建 | §4.1 步骤 1 |
| 4 | schema/wallet-refund-orders-schema.json | 新建 | §4.1 步骤 3 |
| 5 | schema/wallet-daily-snapshots-schema.json | 新建 | §4.1 步骤 2 |
| 6 | schema/coupons-schema.json | 新建 | §4.1 步骤 4 |
| 7 | schema/user-coupons-schema.json | 新建 | §4.1 步骤 4 |
| 8 | schema/user-vip-points-schema.json | 新建 | §3.1 步骤 4 |
| 9 | schema-deltas.md（声明修改 5 个既有 schema） | 修改 | §5.1 步骤 1 / §4.1 步骤 6 / §3.1 步骤 5 / §5.1 步骤 3 |

### 1.2 接口契约（.d.ts 存根）

| # | 文件 | 类型 | 关联方案章节 |
|---|------|------|--------------|
| 1 | interface_stub/instance-expiry-service.d.ts | 新建 | §5.1 步骤 2、3 |
| 2 | interface_stub/vip-point-service.d.ts | 新建 | §3.1 步骤 4 |
| 3 | interface_stub/recharge-cdk-service.d.ts | 新建 | §4.1 步骤 1 |
| 4 | interface_stub/wallet-service.d.ts | 新建（既有 impl 首次发布契约） | §4.1 步骤 2、3 |
| 5 | interface_stub/quota-service.d.ts | 新建（既有 impl 首次发布契约） | §3.1 步骤 2、§6.1 步骤 1 |
| 6 | interface_stub/shared-types-extension.d.ts | 新建 | 跨服务共享 |
| 7 | interface_stub/interface-deltas.md（声明扩展 4 个既有服务：vip-service / shop-service / cdk-service / scheduler） | 扩展 | §3-6 |

### 1.3 配置契约（JSON Schema）

| # | 文件 | 类型 | 关联方案章节 |
|---|------|------|--------------|
| 1 | config_template/system-config-extension.schema.json | 新建 | §3-6（含 vip.* / instance.expiry.* / quota.alerts.* / wallet.* / recharge_cdk.*） |

### 1.4 错误码与异常契约

| # | 文件 | 类型 | 关联方案章节 |
|---|------|------|--------------|
| 1 | schema/error-codes-extension.json | 新建 | §3-6（含 wallet/recharge/refund/coupon/expiry/quota/points 七类 24 个错误码，其中 2 个为既有 impl 已用首次纳入契约：INSUFFICIENT_BALANCE / DAILY_REWARD_ALREADY_CLAIMED） |

---

## 二、一致性校验矩阵

### 2.1 数据契约 ↔ 接口契约 字段对齐

| 接口方法 | 数据契约 | 字段对齐状态 |
|----------|----------|--------------|
| `instanceExpiryService.renewInstance` | instance_renewals | ✅ 全部字段映射（id/instance_id/user_id/duration_days/amount_paid/base_amount/tier_discount_applied/vip_discount_applied/vip_level_at_renewal/renewal_type/use_wallet/old_expires_at/new_expires_at/renewed_at） |
| `instanceExpiryService.getInstanceExpiry` | servers（expiry_status 字段） | ✅ InstanceExpiryStatus 字面量与 schema enum 一致 |
| `vipPointService.addPoints` | user_vip_points | ✅ UserVipPoints 接口与 schema 字段一致 |
| `vipPointService.checkin` | user_vip_points（last_checkin_date） | ✅ 与 walletService.claimDailyReward 联动 |
| `rechargeCdkService.createBatch` | recharge_cdk_batches + recharge_cdks | ✅ RechargeCdkCreateBatchInput 与 batch schema 字段对应 |
| `rechargeCdkService.redeem` | recharge_cdks（status 状态机） | ✅ RechargeCdkStatus 字面量与 schema enum 一致 |
| `walletService.requestRefund` | wallet_refund_orders | ✅ WalletRefundOrder 接口与 schema 字段一致 |
| `walletService.approveRefund` | wallet_refund_orders（status 状态机） | ✅ RefundOrderStatus 字面量与 schema enum 一致 |
| `walletService.snapshotAllWallets` | wallet_daily_snapshots | ✅ WalletDailySnapshot 接口与 schema 字段一致 |
| `shopService.claimCoupon` | coupons + user_coupons | ✅ Coupon/UserCoupon 接口与 schema 字段一致 |

### 2.2 错误码 ↔ 接口 @throws 对齐

| 接口 @throws | 错误码 | HTTP 状态 | category | 对齐状态 |
|--------------|--------|-----------|----------|----------|
| `InstanceNotRenewableError` | INSTANCE_NOT_RENEWABLE | 409 | expiry | ✅ |
| `InstanceExpiryConfigError` | INSTANCE_EXPIRY_CONFIG_ERROR | 500 | expiry | ✅ |
| `InsufficientBalanceError` | INSUFFICIENT_BALANCE | 400 | wallet | ✅（B-NEW-2 修复：保留既有命名，http_status=400 对齐既有 shop.ts:409） |
| `DailyRewardAlreadyClaimedError` | DAILY_REWARD_ALREADY_CLAIMED | 409 | wallet | ✅（S-NEW-2 修复：既有 impl errors.ts:507 已用，本次首次纳入契约） |
| `WalletNotFoundError` | WALLET_NOT_FOUND | 404 | wallet | ✅ |
| `RefundAmountExceedsLimitError` | REFUND_AMOUNT_EXCEEDS_LIMIT | 400 | refund | ✅ |
| `RechargeCdkInvalidError` | RECHARGE_CDK_INVALID | 404 | recharge | ✅ |
| `RechargeCdkAlreadyRedeemedError` | RECHARGE_CDK_ALREADY_REDEEMED | 409 | recharge | ✅ |
| `RechargeCdkExpiredError` | RECHARGE_CDK_EXPIRED | 409 | recharge | ✅ |
| `RechargeCdkBatchNotFoundError` | RECHARGE_CDK_BATCH_NOT_FOUND | 404 | recharge | ✅ |
| `RechargeCdkBatchCreateFailedError` | RECHARGE_CDK_BATCH_CREATE_FAILED | 400 | recharge | ✅（W-NEW-3 修复：类名对齐错误码 _FAILED 后缀） |
| `RefundOrderNotFoundError` | REFUND_ORDER_NOT_FOUND | 404 | refund | ✅ |
| `RefundOrderNotPendingError` | REFUND_ORDER_NOT_PENDING | 409 | refund | ✅ |
| `OrderNotRefundableError` | ORDER_NOT_REFUNDABLE | 409 | refund | ✅ |
| `CouponInvalidError` | COUPON_INVALID | 404 | coupon | ✅ |
| `CouponAlreadyClaimedError` | COUPON_ALREADY_CLAIMED | 409 | coupon | ✅ |
| `CouponUsageLimitExceededError` | COUPON_USAGE_LIMIT_EXCEEDED | 409 | coupon | ✅ |
| `CouponNotApplicableError` | COUPON_NOT_APPLICABLE | 400 | coupon | ✅ |
| `QuotaLimitReachedError` | QUOTA_LIMIT_REACHED | 429 | quota | ✅ |
| `QuotaConfigError` | QUOTA_CONFIG_ERROR | 500 | quota | ✅ |
| `VipPointsConfigError` | VIP_POINTS_CONFIG_ERROR | 500 | points | ✅ |
| `VipLevelUpgradeFailedError` | VIP_LEVEL_UPGRADE_FAILED | 500 | points | ✅（W-1 修复：类名对齐错误码 _FAILED 后缀） |
| `CheckinAlreadyTodayError` | VIP_CHECKIN_ALREADY_TODAY | 409 | points | ✅（W-1 修复：拆分独立类对应签到防重错误码） |
| `BindingNotFoundError` | BINDING_NOT_FOUND | 404 | vip | ✅ |

### 2.3 配置契约 ↔ 接口依赖对齐

| 配置项 | 接口消费方 | 默认值 | 对齐状态 |
|--------|------------|--------|----------|
| `vip.points_thresholds` | vipPointService.checkAndUpgradeVip | `{1:100, 2:500, 3:2000, 4:8000, 5:30000}` | ✅ |
| `vip.checkin_points` | vipPointService.checkin | 10 | ✅ |
| `vip.cdk_redeem_points` | cdkService.redeem（埋点） | 5 | ✅ |
| `vip.purchase_points_ratio` | shopService.createOrder（埋点） | 1.0 | ✅ |
| `vip.quota_overrides` | quotaService.getEffectiveQuota | `{3:{...}, 4:{...}, 5:{...}}` | ✅ |
| `vip.renewal_discount_levels` | instanceExpiryService.renewInstance | `{3:90, 4:80, 5:50}` | ✅ |
| `vip.grace_days_overrides` | instanceExpiryService.processExpiredInstances | `{3:14, 4:21, 5:30}` | ✅ |
| `vip.retention_days_overrides` | instanceExpiryService.cleanupExpiredInstances | `{3:60, 4:120, 5:180}` | ✅ |
| `vip.vip_type_prices` | vipService.listVipTypes | `{monthly:3000, quarterly:8000, yearly:28000, permanent:88000}` | ✅ |
| `instance.expiry.reminder_days_before` | instanceExpiryService.sendExpiryReminders | `[7,3,1]` | ✅ |
| `instance.expiry.grace_days` | instanceExpiryService.processExpiredInstances | 7 | ✅ |
| `instance.expiry.retention_days` | instanceExpiryService.cleanupExpiredInstances | 30 | ✅ |
| `instance.expiry.stop_on_expire` | instanceExpiryService.processExpiredInstances | true | ✅ |
| `instance.expiry.cleanup_disk_after_retention` | instanceExpiryService.cleanupExpiredInstances | true | ✅ |
| `instance.expiry.scan_interval_hours` | scheduler（INSTANCE_EXPIRY_SCAN cron） | 1 | ✅ |
| `quota.alerts.warning_threshold` | quotaService.getQuotaAlerts | 0.8 | ✅ |
| `quota.alerts.critical_threshold` | quotaService.getQuotaAlerts | 0.95 | ✅ |
| `wallet.snapshot_retention_days` | walletService.cleanupOldSnapshots | 90 | ✅ |
| `wallet.refund_allowed` | walletService.requestRefund | true | ✅ |
| `wallet.refund_max_amount` | walletService.requestRefund | 10000 | ✅ |
| `recharge_cdk.code_length` | rechargeCdkService.createBatch | 16 | ✅ |
| `recharge_cdk.code_charset` | rechargeCdkService.createBatch | 去除易混淆字符 | ✅ |
| `recharge_cdk.max_batch_size` | rechargeCdkService.createBatch | 10000 | ✅ |
| `recharge_cdk.claiming_timeout_minutes` | rechargeCdkService.rollbackStaleClaiming | 5 | ✅ |

---

## 三、与既有契约的兼容性校验

### 3.1 向后兼容性

| 既有 schema | 修改类型 | 兼容性 | 校验状态 |
|-------------|----------|--------|----------|
| server-schema.json | 新增 3 字段（expires_at / expiry_status / expiry_grace_until） | ✅ 全部 nullable + 默认值，存量数据无破坏 | 通过 |
| cdk-codes-schema.json | 新增 1 字段（price） | ✅ 默认 0，存量 CDK 视为免费 | 通过 |
| user-wallets-schema.json | 仅扩展关联子 schema，无字段变更 | ✅ 完全兼容 | 通过 |
| vip-permissions-schema.json | 仅注释补充 | ✅ 无字段变更 | 通过 |
| user-schema.json | 字段标注 deprecated | ✅ 不删除字段，保留 2 个版本周期 | 通过 |
| pack-schema-extension.json | 新增 business.instance 子对象 | ✅ optional，向后兼容 | 通过 |

### 3.2 命名冲突检查

| 检查项 | 结果 |
|--------|------|
| 新建 schema `$id` 与既有冲突 | ✅ 无冲突（recharge-cdks / recharge-cdk-batches / instance-renewals / coupons / user-coupons / user-vip-points / wallet-refund-orders / wallet-daily-snapshots 均为新名） |
| 新建 .d.ts 与既有冲突 | ✅ 无冲突（instance-expiry-service / vip-point-service / recharge-cdk-service / wallet-service / quota-service / shared-types-extension 均为新名；其中 wallet-service / quota-service 虽基于既有 impl，但 .d.ts 文件本身在 public/interface_stub/ 下原本不存在，属新建） |
| 错误码 code 与既有冲突 | ✅ 无冲突（24 个新错误码：22 个带新前缀 WALLET_/RECHARGE_/REFUND_/COUPON_/INSTANCE_/QUOTA_/VIP_POINTS 等；2 个为既有 impl 已用首次纳入契约：INSUFFICIENT_BALANCE / DAILY_REWARD_ALREADY_CLAIMED，与既有 impl errors.ts 完全对齐） |
| category 枚举扩展 | ⚠️ 需扩展 error-codes-schema.json 的 category enum（新增 wallet/recharge/refund/coupon/expiry/quota/points） |

### 3.3 状态机一致性

| 状态机 | 数据契约 enum | 接口契约字面量 | 对齐状态 |
|--------|---------------|----------------|----------|
| 实例过期 | `permanent/active/grace/expired/cleaned` | `InstanceExpiryStatus` | ✅ |
| 充值 CDK | `unused/claiming/used/expired` | `RechargeCdkStatus` | ✅ |
| 退款申请 | `pending/approved/rejected/completed/cancelled` | `RefundOrderStatus` | ✅ |
| 用户优惠券 | `unused/used/expired` | `UserCouponStatus` | ✅ |
| VIP 类型 | `permanent/monthly/quarterly/yearly`（trial v1 不引入） | `VipType` | ✅ |
| 续费类型 | `manual/gift` | `InstanceRenewalType` | ✅ |

---

## 四、未闭合项与风险

### 4.1 未闭合项

| # | 未闭合项 | 影响 | 建议处理方式 |
|---|----------|------|--------------|
| 1 | shared-types-extension.d.ts 需合并到既有 shared-types.d.ts | 落位阶段需手工合并，避免类型重复声明 | 待独立审查通过后，由正式落位阶段处理 |
| 2 | error-codes-schema.json 的 category enum 需扩展 | 既有 enum 仅 12 类，新增 7 类需同步 | schema-deltas.md 已声明，待落位时同步 |
| 3 | scheduler.d.ts TaskType 扩展需合并 | 既有 TaskType 是 union type，新增 9 个成员需合并 | interface-deltas.md 已声明，待落位时合并 |
| 4 | pack-schema-extension.json 的 business.instance 子对象需合并 | 既有 schema 是 additionalProperties:true，需追加字段定义 | schema-deltas.md 已声明，待落位时合并 |

### 4.2 风险

| # | 风险 | 严重性 | 缓解措施 |
|---|------|--------|----------|
| 1 | `wallet_refund_orders.points_to_deduct` 字段与"积分只升不降"原则冲突 | — | ✅ 已修复（B5）：schema 已移除 points_to_deduct 字段，walletService.approveRefund 注释明确"积分不扣减（决策 V1：积分只升不降）"。退款产生的积分"漂移"由 v2 评估是否引入积分过期机制 |
| 2 | `recharge_cdks.claiming_locked_at` 与既有 `cdk_codes` 状态机不一致（cdk_codes 无此字段） | 低 | 两表独立，claiming_locked_at 仅 recharge_cdks 有；既有 cdk_codes 沿用原有超时回滚逻辑 |
| 3 | `instance_renewals.new_expires_at` nullable 与 `duration_days=36500`（视为永久）的语义重叠 | 低 | 在 instanceExpiryService.renewInstance 中明确：duration_days=36500 时 new_expires_at=NULL（永久） |
| 4 | `coupons.scope_id` 多态（server_id UUID 或 item_name 字符串） | 中 | 在 shopService.createOrder 校验时按 scope 类型解析 scope_id |
| 5 | v2 预留契约（subscriptions / user_trial_records）未在本次定义 | 低 | v1 不实施，v2 启动时再定义，避免过度设计 |

---

## 五、下游消费接续入口

### 5.1 可进入 s0202（生成稳定 Mock）

- **消费方**：s0202 基于本次 8 个新建 schema + 6 个新建 .d.ts 生成预生成 Mock
- **前置条件**：独立审查（GN-004）通过 + 人类授权落位到 public/
- **Mock 文件落位**：`public/pre_generated_mock/` 下新增 8 个 mock 文件（每个 schema 对应一个）

### 5.2 可进入 s0203（拓扑化模块拆分）

- **消费方**：s0203 基于 3 个新建服务（instanceExpiryService / vipPointService / rechargeCdkService）+ 6 个扩展服务设计模块依赖 DAG
- **前置条件**：s0202 完成（Mock 就位）
- **模块拆分维度**：
  - VIP 模块（vipService + vipPointService + vip-permissions schema）
  - 钱包模块（walletService + rechargeCdkService + wallet/refund/snapshot schema）
  - 实例有效期模块（instanceExpiryService + instance-renewals schema + server-schema 扩展）
  - 商城模块（shopService + coupons schema + cdk-codes 扩展）
  - 配额模块（quotaService + system-config vip.quota_overrides）
  - 调度模块（scheduler + 9 个新任务类型）

### 5.3 不可下推的阻断项

无。本次契约草案已完成三层覆盖 + 一致性校验，待独立审查通过后可下推。

---

## 六、s0201 闭环信号自检

| 闭环信号 | 自检结果 |
|----------|----------|
| 存在一套覆盖数据、接口、配置三层的契约结果 | ✅ 8 schema + 6 d.ts + 1 config schema + 1 error-codes schema |
| 数据契约为 JSON Schema | ✅ 全部 draft-07 |
| 接口契约为 .d.ts | ✅ 6 个新文件 + 4 个扩展声明（vip-service / shop-service / cdk-service / scheduler） |
| 配置契约含默认值与自动补齐规则 | ✅ system-config-extension.schema.json 全字段带 default |
| 错误码与异常契约已被显式纳入 | ✅ 24 个新错误码（含 2 个既有 impl 已用首次纳入契约：INSUFFICIENT_BALANCE / DAILY_REWARD_ALREADY_CLAIMED） + 24 个 Error 类（含 1 个既有 impl 已用首次纳入契约：DailyRewardAlreadyClaimedError；3 个 v1 新增契约类 impl 待实现：RefundAmountExceedsLimitError / QuotaLimitReachedError / QuotaConfigError；1 个 W-1 修复拆分新增：CheckinAlreadyTodayError） |
| 明确给出一致性结论 | ✅ §二、§三 校验通过 |
| 明确写出未闭合项、冲突项和下游接续入口 | ✅ §四、§五 |
| 状态判定 | **已闭合**（可进入独立审查 → s0202/s0203） |

---

## 七、独立审查拉起请求

按 s0201 Action Flow 第 8 步要求：

> 请主线程拉起独立审查（GN-004 能力，由 general_purpose_task 承载）对本契约产出进行独立审查，确认无硬阻断后，方可将本契约作为下游唯一边界。
>
> 在独立审查审查通过前，不得将契约下推至 s0202/s0203。

独立审查范围：
1. 三层契约完整性（数据/接口/配置/错误码四层是否齐全）
2. 与既有契约的兼容性（无破坏性变更）
3. 字段命名一致性（snake_case / camelCase / PascalCase 规范）
4. 状态机定义完备性（含异常路径）
5. 决策点对齐（V1-V6 全部体现在契约中）
6. 与方案文档 business-logic-system-completion-plan.md 的一致性
