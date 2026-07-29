# 数据契约变更补丁（v1 实施）

> 本文档声明对既有 public/schema/ 文件的变更点，**不直接修改原文件**。
> 待独立审查通过 + 人类授权后，由正式落位阶段应用到 public/。
>
> 来源：docs/plans/business-logic-system-completion-plan.md §十一、公共契约变更清单

---

## 1. server-schema.json（MINOR）

**变更类型**：新增字段（向后兼容，存量数据回填默认值）

**新增字段**：

```json
{
  "expires_at": {
    "type": ["string", "null"],
    "format": "date-time",
    "default": null,
    "description": "实例过期时间（ISO 8601）。null=永久实例（默认）。由创建实例时 duration_days 参数计算：now + duration_days × 86400000"
  },
  "expiry_status": {
    "type": "string",
    "enum": ["permanent", "active", "grace", "expired", "cleaned"],
    "default": "permanent",
    "description": "过期状态机：permanent=永久实例；active=有效期内；grace=宽限期内（已停止但可续费）；expired=已过期（待清理）；cleaned=已清理磁盘。状态转换：permanent→（设置 expires_at）→active→（到期）→grace→（宽限期结束）→expired→（清理磁盘）→cleaned"
  },
  "expiry_grace_until": {
    "type": ["string", "null"],
    "format": "date-time",
    "default": null,
    "description": "宽限期结束时间（ISO 8601）。仅 expiry_status='grace' 时有值。= expires_at + grace_days × 86400000（grace_days 由 system_config.instance.expiry.grace_days 配置，默认 7）"
  }
}
```

**存量数据回填**：
- `expires_at = NULL`
- `expiry_status = 'permanent'`
- `expiry_grace_until = NULL`

**required 字段**：无新增（所有新字段均可空）

---

## 2. cdk-codes-schema.json（MINOR）

**变更类型**：新增字段（向后兼容，存量数据回填 `price = 0`）

**新增字段**：

```json
{
  "price": {
    "type": "integer",
    "minimum": 0,
    "default": 0,
    "description": "兑换所需点券数（付费 CDK 机制）。0=免费 CDK（默认，向后兼容存量数据）。>0 时 cdkService.redeem 先 walletService.debit 扣款再下发命令，失败回滚"
  }
}
```

**存量数据回填**：
- `price = 0`（所有既有 CDK 视为免费）

**实现注意**：
- `cdkService.redeem` 增加余额校验逻辑：`if (price > 0) { await walletService.debit(userId, serverId, price); }`
- 失败回滚：若命令下发失败，需 `walletService.credit` 退还点券
- 前端 CDK 兑换页显示价格（免费 CDK 显示"免费"，付费 CDK 显示点券数）

---

## 3. user-wallets-schema.json（MAJOR）

**变更类型**：扩展关联子 schema（不在原文件内嵌，仅声明关联关系）

**关联新增 schema**：
- `wallet-refund-orders-schema.json`（退款申请表，通过 user_id + server_id 关联）
- `wallet-daily-snapshots-schema.json`（每日快照表，通过 user_id + server_id 关联）

**user_wallets 表本身无字段变更**，仅扩展业务关系：
- 退款流程：`wallet_refund_orders.status='approved'` 时调用 `walletService.refund` 加款到 `user_wallets.balance`
- 快照流程：`wallet_daily_snapshots` 每日 1 点冗余存储 `user_wallets.balance / total_earned / total_spent`

**版本号变更原因**：MAJOR（关联子 schema 引入新业务流程，影响钱包余额计算逻辑）

---

## 4. vip-permissions-schema.json（PATCH）

**变更类型**：仅注释补充（无字段变更）

**description 字段追加说明**：

```
原 description: "vip_permissions 表数据契约。VIP 等级权限映射表，0-5 级，含 max_quality / daily_limit。..."

追加说明：
"""
v4.x 关联说明（business-logic-v1-contracts）：
- vip_type 字段位于 user_instance_bindings 表（不在本表），区分 permanent/monthly/quarterly/yearly/trial
- vip_expires_at 字段位于 user_instance_bindings 表，控制 VIP 等级过期降级
- vip_permissions 表是全局模板，不按实例区分（与 user_instance_bindings 按实例存储解耦）
- VIP 升级路径：通过 user_vip_points 表积分驱动（vipPointService.checkAndUpgradeVip）
- VIP 续费折扣：通过 system_config.vip.renewal_discount_levels 配置（不在本表）
"""
```

---

## 5. user-schema.json（PATCH）

**变更类型**：字段标注 deprecated（不删除，保留 2 个版本周期）

**字段标注**：

```json
{
  "vip_level": {
    "type": "integer",
    "minimum": 0,
    "maximum": 5,
    "default": 0,
    "deprecated": true,
    "description": "[DEPRECATED v4.x] 已被 user_instance_bindings.vip_level 取代。仅保留用于历史数据兼容，新代码禁止读取此字段。唯一真相源：instanceBindingService.getUserVipLevel"
  },
  "vip_expires_at": {
    "type": ["string", "null"],
    "format": "date-time",
    "default": null,
    "deprecated": true,
    "description": "[DEPRECATED v4.x] 已被 user_instance_bindings.vip_expires_at 取代。仅保留用于历史数据兼容，新代码禁止读取此字段"
  }
}
```

**CI 强制规则**（在 vipService.ts 头部加 ESLint 注解）：
- 新代码禁止引用 `users.vip_level` / `users.vip_expires_at`
- 既有引用逐步迁移到 `instanceBindingService.getUserVipLevel`

---

## 6. pack-schema-extension.json（MINOR）

**变更类型**：新增 business.instance.pricing 子 schema

**新增字段**（在 `business` 下新增 `instance` 子对象）：

```json
{
  "instance": {
    "type": "object",
    "description": "实例业务能力（有效期/续费定价，决策 V6 全可配）",
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": false,
        "description": "是否启用实例有效期机制。false=该 Pack 的实例默认永久（不强制续费）"
      },
      "pricing": {
        "type": "object",
        "description": "续费定价配置（决策 V6 全可配）",
        "additionalProperties": false,
        "properties": {
          "daily_price": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "每日单价（点券数）。0=免费 Pack（实例永久免费）。续费金额 = daily_price × duration_days × tier_discount × vip_discount"
          },
          "tier_discounts": {
            "type": "object",
            "description": "阶梯折扣（按 duration_days 匹配）。键为天数门槛，值为折扣系数（1.0=无折扣，0.8=8 折）",
            "patternProperties": {
              "^\\d+$": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              }
            },
            "additionalProperties": false,
            "default": {},
            "examples": [
              { "30": 1.0, "90": 0.9, "365": 0.8 }
            ]
          },
          "currency": {
            "type": "string",
            "enum": ["points", "gift_only"],
            "default": "points",
            "description": "支付货币：points=点券（从钱包扣款）；gift_only=仅赠送（不可用户购买，amount_paid=0）"
          }
        },
        "required": ["daily_price"]
      }
    },
    "required": ["enabled"]
  }
}
```

**示例 pack.yaml 片段**：

```yaml
business:
  instance:
    enabled: true
    pricing:
      daily_price: 100        # 100 点券/天
      tier_discounts:
        30: 1.0                # 30 天原价
        90: 0.9                # 90 天 9 折
        365: 0.8               # 365 天 8 折
      currency: points
```
