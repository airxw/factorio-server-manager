# 接口契约扩展补丁（v1 实施）

> 本文档声明对既有 public/interface_stub/*.d.ts 文件的扩展点，**不直接修改原文件**。
> 待独立审查通过 + 人类授权后，由正式落位阶段应用到 public/。
>
> 来源：docs/plans/business-logic-system-completion-plan.md §八、服务层改造清单

---

## 1. vip-service.d.ts 扩展

**新增方法**（追加到 VipService interface）：

```typescript
/**
 * 设置用户在某实例的 VIP 等级（带类型，决策 V1/V3）。
 * 根据 vip_type 自动计算 vip_expires_at：
 *   - monthly → +30 天
 *   - quarterly → +90 天
 *   - yearly → +365 天
 *   - permanent → NULL（永久）
 *   - trial → 由"试用实例机制"另行控制（v1 不引入）
 *
 * @param vipType VIP 类型（permanent/monthly/quarterly/yearly）
 * @throws {BindingNotFoundError} 无 active 绑定记录
 */
setVipWithType(
  userId: string,
  serverId: string,
  level: number,
  vipType: 'permanent' | 'monthly' | 'quarterly' | 'yearly',
): Promise<void>;

/**
 * 查询 VIP 套餐类型列表（GET /api/vip/types）。
 * 返回 4 档套餐配置（月/季/年/永久），前端 VIP 开通页使用。
 * @returns 套餐列表（含 type / display_name / duration_days / 推荐价格）
 */
listVipTypes(): Promise<Array<{
  type: 'permanent' | 'monthly' | 'quarterly' | 'yearly';
  display_name: string;
  duration_days: number | null; // null=永久
  recommended_price: number; // 建议售价（点券，由 system_config 配置）
}>>;
```

---

## 2. wallet-service.d.ts 新建（既有 impl 首次发布契约）

> **说明**：public/interface_stub/ 下不存在既有 wallet-service.d.ts，本文件为新建完整存根。
> 既有 impl panel/backend/src/services/walletService.ts 已实现 getOrCreateWallet/getWalletInfo/claimDailyReward/debit/credit/refund 等方法，但从未发布契约。
> 本次 v1 首次发布完整契约，包含既有方法 + v1 新增方法（退款/账单/快照）。
> 下方"新增方法"清单仅列出 v1 新增部分，完整方法签名见 wallet-service.d.ts。

**v1 新增方法**（既有方法已在 wallet-service.d.ts 完整声明，此处仅列 v1 新增）：

```typescript
/**
 * 发起退款申请（POST /api/wallet/refund/request）。
 * @param userId 申请人
 * @param serverId 实例 ID
 * @param amount 退款金额
 * @param reason 退款原因
 * @param orderId 关联订单 ID（可空，null=直接申请余额退款）
 * @returns 退款申请记录
 * @throws {InsufficientBalanceError} 退款金额超过钱包余额
 * @throws {OrderNotRefundableError} 订单已领取（status != 'pending'）
 */
requestRefund(
  userId: string,
  serverId: string,
  amount: number,
  reason: string,
  orderId?: number | null,
): Promise<WalletRefundOrder>;

/**
 * 管理员审批退款（POST /api/wallet/refund/:id/approve）。
 * 流程：
 *   1. 更新 wallet_refund_orders.status='approved', processed_at, processed_by
 *   2. 调用 walletService.refund 加款到 user_wallets.balance
 *   3. 更新 status='completed', completed_at
 *   4. 写入 audit_logs
 *
 * 注：积分不扣减（决策 V1：积分只升不降，避免退款产生负向体验）。
 *     退款产生的积分"漂移"由 v2 评估是否引入积分过期机制。
 *
 * @throws {RefundOrderNotFoundError} 退款申请不存在
 * @throws {RefundOrderNotPendingError} 退款申请非 pending 状态
 */
approveRefund(
  refundId: number,
  processedBy: string,
  adminNote?: string,
): Promise<WalletRefundOrder>;

/**
 * 管理员拒绝退款（POST /api/wallet/refund/:id/reject）。
 * @throws {RefundOrderNotFoundError} 退款申请不存在
 * @throws {RefundOrderNotPendingError} 退款申请非 pending 状态
 */
rejectRefund(
  refundId: number,
  processedBy: string,
  adminNote: string,
): Promise<WalletRefundOrder>;

/**
 * 查询退款申请列表（管理员后台）。
 */
listRefundOrders(filter?: {
  user_id?: string;
  server_id?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';
}): Promise<WalletRefundOrder[]>;

/**
 * 获取月度账单（GET /api/wallet/bill?year=&month=）。
 * 聚合当月 shop_orders（消费）+ recharge_cdks（充值）+ wallet_refund_orders（退款）。
 * @returns 结构化账单（含收支明细 + 余额变化曲线）
 */
getMonthlyBill(
  userId: string,
  serverId: string,
  year: number,
  month: number,
): Promise<{
  opening_balance: number; // 月初余额（来自 wallet_daily_snapshots）
  closing_balance: number; // 月末余额
  total_recharged: number; // 充值总额
  total_spent: number; // 消费总额
  total_refunded: number; // 退款总额
  transactions: Array<{
    type: 'recharge' | 'purchase' | 'refund' | 'daily_reward';
    amount: number;
    description: string;
    timestamp: string;
  }>;
  balance_curve: Array<{ date: string; balance: number }>; // 来自 wallet_daily_snapshots
}>;

/**
 * 每日钱包快照（调度任务 WALLET_DAILY_SNAPSHOT，cron '0 1 * * *'）。
 * 快照所有 active 钱包的余额到 wallet_daily_snapshots 表。
 * @returns 快照数量
 */
snapshotAllWallets(): Promise<{ snapshotted: number }>;

/**
 * 清理旧快照（调度任务 WALLET_SNAPSHOT_CLEANUP，cron '0 5 * * *'）。
 * 保留 90 天，超期清理。
 * @returns 清理数量
 */
cleanupOldSnapshots(retentionDays?: number): Promise<{ cleaned: number }>;
```

---

## 3. shop-service.d.ts 扩展

**createOrder 方法追加可选参数**（保持既有签名顺序与返回类型，仅追加 couponCode 参数 + 返回值追加可选 applied_discount 字段，向后兼容）：

既有签名（不可破坏）：
```typescript
createOrder(
  userId: string,
  serverId: string,
  items: ShopOrderItemInput[],
): Promise<{ orderId: number; claimCode: string }>;
```

v1 扩展签名（追加可选参数，既有调用方零改动）：
```typescript
/**
 * 创建订单（v1 扩展：支持优惠券）。
 *
 * 折扣叠加规则（强校验）：
 *   - VIP 折扣与优惠券不叠加，取最优
 *   - 0 元订单仅允许 total_price = 0 的免费商品
 *
 * @param userId 用户 ID（既有，位置不变）
 * @param serverId 实例 ID（既有，位置不变）
 * @param items 物品列表（既有，位置不变）
 * @param couponCode 优惠券码（v1 新增，可选）。提供则校验并应用折扣
 * @returns 既有 { orderId, claimCode } + v1 新增可选 applied_discount（无优惠券时该字段为 undefined）
 * @throws {CouponInvalidError} 优惠券不存在或已过期（v1 新增）
 * @throws {CouponNotApplicableError} 优惠券不适用于当前订单（v1 新增）
 */
createOrder(
  userId: string,
  serverId: string,
  items: ShopOrderItemInput[],
  couponCode?: string,
): Promise<{
  orderId: number;
  claimCode: string;
  /** v1 新增：折扣明细。无优惠券时为 undefined */
  applied_discount?: {
    type: 'vip' | 'coupon' | 'none';
    original_amount: number;
    discount_amount: number;
    final_amount: number;
    coupon_id?: number;
  };
}>;

/**
 * 领取优惠券（POST /api/coupons/:code/claim）。
 * @throws {CouponInvalidError} 优惠券不存在或已过期
 * @throws {CouponAlreadyClaimedError} 用户已领取过
 * @throws {CouponUsageLimitExceededError} 优惠券已达使用上限
 */
claimCoupon(userId: string, code: string, serverId?: string): Promise<UserCoupon>;
```

---

## 4. cdk-service.d.ts 扩展

**修改 redeem 方法**（增加付费 CDK 余额扣款逻辑）：

```typescript
/**
 * 兑换 CDK（v4.x 扩展：支持付费 CDK）。
 *
 * 付费 CDK 流程（cdk_codes.price > 0）：
 *   1. 乐观锁抢占 unused → claiming
 *   2. 校验钱包余额 ≥ price
 *   3. walletService.debit 扣款
 *   4. 按 Pack.business.cdk.redeem_command 渲染命令并下发
 *   5. 成功 → status='claimed'；失败 → walletService.credit 退还 + 回滚 status='unused'
 *
 * 免费 CDK 流程（cdk_codes.price = 0）：
 *   沿用既有逻辑，无扣款步骤
 *
 * @param gamePlayerName 兑换的游戏内玩家名
 * @param userId 兑换者用户 ID（付费 CDK 必填，免费 CDK 可空）
 * @throws {InsufficientBalanceError} 钱包余额不足（付费 CDK）
 */
redeem(
  code: string,
  gamePlayerName: string,
  userId?: string,
): Promise<{ success: boolean; message: string; items?: CdkItemOutput[]; amount_paid?: number }>;
```

---

## 5. quota-service.d.ts 新建（既有 impl 首次发布契约）

> **说明**：public/interface_stub/ 下不存在既有 quota-service.d.ts，本文件为新建完整存根。
> 既有 impl panel/backend/src/services/quotaService.ts 已实现 getQuota/setQuota/getEffectiveQuota/getUsage/checkInstanceQuota/checkDiskQuota 等方法，但从未发布契约。
> 本次 v1 首次发布完整契约，包含既有方法 + v1 新增方法（VIP 派生配额/预警）。
> 下方列出 v1 对既有 getEffectiveQuota 签名的破坏性变更 + 新增方法。

**v1 破坏性变更**（impl 层签名变更，既有调用方需迁移）：

```typescript
/**
 * 获取生效配额（v4.x 扩展：VIP 派生配额）。
 *
 * ⚠️ 破坏性变更：既有 impl quotaService.ts:162 签名为 getEffectiveQuota(userId: string)，
 *    v1 扩展为 getEffectiveQuota(userId, serverId, userRole)。
 *    既有调用方需补传 serverId + userRole 参数（既有调用方数量有限，可在 v1 一次性迁移）。
 *
 * 优先级（高 → 低）：
 *   1. user 配额（resource_quotas WHERE scope_type='user'）
 *   2. role 配额（resource_quotas WHERE scope_type='role'）
 *   3. VIP 派生配额（system_config.vip.quota_overrides，按用户 VIP 等级匹配）
 *   4. 默认不限（null）
 *
 * @param userId 用户 ID
 * @param serverId 实例 ID（v1 新增，用于查询用户 VIP 等级）
 * @param userRole 用户角色（v1 新增，用于 VIP 等级融合判定）
 * @returns 生效配额（含来源标记 source: 'user' | 'role' | 'vip' | 'default'）
 */
getEffectiveQuota(
  userId: string,
  serverId: string,
  userRole: string,
): Promise<{
  max_instances: number | null;
  max_disk_mb: number | null;
  max_players_total: number | null;
  source: 'user' | 'role' | 'vip' | 'default';
}>;
```

**v1 新增方法**（完整签名见 quota-service.d.ts）：
- `getQuotaAlerts(userId): Promise<QuotaAlertResult>` — 查询配额预警（GET /api/quotas/alerts）
- `scanQuotaAlerts(): Promise<{ alerts_sent: number }>` — 扫描配额预警并发送通知（调度任务 QUOTA_ALERT_SCAN）

---

## 6. scheduler.d.ts / shared-types.d.ts 扩展

**扩展现有 SchedulerTaskType**（在 shared-types.d.ts:536-565 既有 22 个成员基础上追加 9 个新成员，**不重命名类型，不修改既有成员**）：

既有 SchedulerTaskType（不可破坏，共 22 个成员）：
```typescript
export type SchedulerTaskType =
  | 'PERIODIC_MESSAGE'
  | 'ITEM_SYNC'
  | 'OPTIMISTIC_LOCK_TIMEOUT_SCAN'
  | 'MONITOR_SNAPSHOT'
  | 'COMMAND_QUEUE_PROCESS'
  | 'STATE_TIMEOUT_SCAN'
  | 'CHAT_LOG_CLEANUP'
  | 'DISK_USAGE_REFRESH'
  | 'AUDIT_LOG_CLEANUP'
  | 'NOTIFICATION_CLEANUP'
  | 'ITEM_SYNC_LOG_CLEANUP'
  | 'AUTO_BACKUP'
  | 'DB_BACKUP'
  | 'DISK_SPACE_MONITOR'
  | 'CRON_COMMAND'
  | 'CRON_START'
  | 'CRON_STOP'
  | 'CRON_RESTART'
  | 'CRON_BACKUP'
  | 'ALERT_SSL_EXPIRY_CHECK'
  | 'ALERT_BACKUP_HEALTH_CHECK'
  | 'NODE_OFFLINE_SCAN';
```

v1 扩展（追加 9 个新成员到 union，既有 22 个保持不变）：
```typescript
export type SchedulerTaskType =
  // ===== 既有 22 个成员（保持不变，此处省略详细列表，见上） =====
  | ... // 既有 22 个
  // ===== v1 新增 9 个成员 =====
  | 'VIP_EXPIRY_SCAN' // 激活既有死代码：VIP 过期扫描（每小时）
  | 'VIP_POINTS_CHECK' // 新增：VIP 积分升级检查（每 6 小时）
  | 'INSTANCE_EXPIRY_SCAN' // 新增：实例到期扫描（每小时）
  | 'INSTANCE_GRACE_CLEANUP' // 新增：宽限期清理（每日 3 点）
  | 'INSTANCE_DISK_CLEANUP' // 新增：磁盘清理（每日 4 点）
  | 'INSTANCE_EXPIRY_REMINDER' // 新增：到期提醒（每日 9 点）
  | 'WALLET_DAILY_SNAPSHOT' // 新增：钱包日快照（每日 1 点）
  | 'WALLET_SNAPSHOT_CLEANUP' // 新增：快照清理（每日 5 点）
  | 'QUOTA_ALERT_SCAN'; // 新增：配额预警扫描（每日 9 点）

// v2 预留（v1 不实施，不加入 union）
// | 'SUBSCRIPTION_RENEWAL_SCAN'
```

**说明**：本扩展仅向 union 追加成员，既有 22 个成员名不变，既有调度器引用零改动。落位时由合并阶段在 shared-types.d.ts:565 末尾追加 9 行 `| '...'`。
