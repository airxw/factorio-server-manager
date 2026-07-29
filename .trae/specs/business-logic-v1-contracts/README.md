# business-logic-v1-contracts — 三层契约草案

> **状态**：已闭合（待独立审查 + 人类授权落位到 public/）
> **来源**：docs/plans/business-logic-system-completion-plan.md（6 决策点已闭合）
> **生成 Skill**：s0201-generating-global-contracts
> **生成时间**：2026-07-25

---

## 一、目录结构

```
.trae/specs/business-logic-v1-contracts/
├── README.md                                          # 本文件
├── consistency-check-report.md                        # 三层契约一致性校验报告
├── schema/                                            # 数据契约（JSON Schema draft-07）
│   ├── instance-renewals-schema.json                  # 新建：实例续费记录
│   ├── recharge-cdks-schema.json                      # 新建：充值 CDK
│   ├── recharge-cdk-batches-schema.json               # 新建：充值 CDK 批次
│   ├── wallet-refund-orders-schema.json               # 新建：退款申请
│   ├── wallet-daily-snapshots-schema.json             # 新建：钱包日快照
│   ├── coupons-schema.json                            # 新建：优惠券模板
│   ├── user-coupons-schema.json                       # 新建：用户优惠券
│   ├── user-vip-points-schema.json                    # 新建：VIP 积分
│   ├── error-codes-extension.json                     # 新建：错误码扩展（24 个新错误码，含 2 个既有 impl 已用首次纳入契约）
│   └── schema-deltas.md                               # 修改声明：5 个既有 schema 变更点
├── interface_stub/                                    # 接口契约（.d.ts 存根）
│   ├── instance-expiry-service.d.ts                   # 新建：实例有效期服务
│   ├── vip-point-service.d.ts                         # 新建：VIP 积分服务
│   ├── recharge-cdk-service.d.ts                      # 新建：充值 CDK 服务
│   ├── wallet-service.d.ts                            # 新建（既有 impl 首次发布契约）：钱包服务完整存根（含既有方法 + v1 新增退款/账单/快照）
│   ├── quota-service.d.ts                             # 新建（既有 impl 首次发布契约）：配额服务完整存根（含既有方法 + v1 新增 VIP 派生配额/预警）
│   ├── shared-types-extension.d.ts                    # 新建：共享类型扩展
│   └── interface-deltas.md                            # 扩展声明：4 个既有服务接口扩展（vip-service / shop-service / cdk-service / scheduler）
└── config_template/                                   # 配置契约
    └── system-config-extension.schema.json            # 新建：system_config 扩展（vip.* / instance.expiry.* / quota.alerts.* / wallet.* / recharge_cdk.*）
```

---

## 二、契约覆盖统计

| 层 | 新建 | 修改/扩展 | 总计 |
|----|------|-----------|------|
| 数据契约（JSON Schema） | 9 | 5（schema-deltas.md 声明） | 14 |
| 接口契约（.d.ts） | 6（含 2 个既有 impl 首次发布契约：wallet-service / quota-service） | 4（interface-deltas.md 声明：vip-service / shop-service / cdk-service / scheduler） | 10 |
| 配置契约（JSON Schema） | 1 | 0 | 1 |
| 错误码契约 | 1（含 24 个新错误码，含 2 个既有 impl 已用首次纳入契约） | 1（category enum 扩展） | 2 |
| **合计** | **17** | **10** | **27** |

---

## 三、与决策点对齐

| 决策点 | 决策内容 | 契约落点 |
|--------|----------|----------|
| V1 | 引入积分制 | user-vip-points-schema.json + vip-point-service.d.ts + system-config.vip.points_thresholds |
| V2 | 卡商充值 CDK 机制 | recharge-cdks-schema.json + recharge-cdk-batches-schema.json + recharge-cdk-service.d.ts + system-config.recharge_cdk.* |
| V3 | 订阅制 v1 不引入 | （无契约，v2 预留） |
| V4 | 到期策略全参数可配 | system-config.instance.expiry.* + instance-expiry-service.d.ts.getExpiryConfig |
| V5 | 不引入试用实例 | （无契约） |
| V6 | 续费定价全可配 | pack-schema-extension.business.instance.pricing + instance-renewals-schema.json + system-config.vip.renewal_discount_levels |

---

## 四、落位到 public/ 的前置条件

按 rules-0 §四-10 public/ 保护指令：

1. **独立审查（GN-004）通过**：由 general_purpose_task 承载，审查 rubric 见 consistency-check-report.md §七
2. **人类显式授权**：通过 AskUserQuestion 获得对 public/ 写操作的授权
3. **落位操作**：
   - 新建文件直接复制到 public/schema/ 或 public/interface_stub/
   - 修改文件应用 schema-deltas.md / interface-deltas.md 声明的变更
   - 错误码合并到 public/schema/error-codes-schema.json 的 error_codes 数组
   - category enum 扩展（新增 wallet/recharge/refund/coupon/expiry/quota/points）
   - shared-types-extension.d.ts 合并到 public/interface_stub/shared-types.d.ts

---

## 五、下游接续入口

- **s0202（生成稳定 Mock）**：基于本契约草案生成预生成 Mock，落位到 public/pre_generated_mock/
- **s0203（拓扑化模块拆分）**：基于本契约草案设计模块依赖 DAG，输出 AGENTS.md 模板

**前置阻断**：独立审查未通过前不得下推。
