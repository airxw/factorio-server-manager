// ============================================================================
// 20260830000005_seed_instance_type_pricing.ts
// v3-billing：instance_type_pricing 表初始定价 seed（作为 migration 执行）
//
// 设计目标：
//   插入 5 种实例类型的默认定价。仅当 instance_type_pricing 表为空时执行
//   （幂等，不覆盖已有配置）。
//
// 默认定价（与 instance-billing-mock.ts DEFAULT_TYPE_PRICINGS 对齐）：
//   | 类型    | 月费（点券） | 季付折扣 | 半年付折扣 | 年付折扣 | 推荐人数 |
//   |---------|------------|---------|-----------|---------|---------|
//   | micro   | 1500       | 0.95    | 0.90      | 0.80    | 5       |
//   | small   | 3000       | 0.95    | 0.90      | 0.80    | 15      |
//   | medium  | 9000       | 0.95    | 0.90      | 0.80    | 30      |
//   | large   | 24000      | 0.95    | 0.90      | 0.80    | 60      |
//   | xlarge  | 60000      | 0.95    | 0.90      | 0.80    | 120     |
//
// 100 点券 = 1 元，所有金额为整数点券。
//
// 兼容性：
//   - up：仅当表为空时 INSERT（幂等）
//   - down：DELETE 这 5 条默认记录（按 id 前缀 'seed-tp-' 识别）
//
// 来源：docs/plans/instance-billing-rules-plan.md §2.1（VPS 式简化定稿）
// ============================================================================

import type { Knex } from 'knex';
import crypto from 'node:crypto';

interface TypePricingSeed {
  id: string;
  instance_type: string;
  display_name: string;
  monthly_price: number;
  quarterly_discount: number;
  semiannual_discount: number;
  annual_discount: number;
  recommended_slots: number;
  cpu_limit: string;
  memory_limit_mb: number;
  disk_limit_gb: number;
  description: string;
}

const SEED_DATA: TypePricingSeed[] = [
  {
    id: 'seed-tp-micro',
    instance_type: 'micro',
    display_name: '微型',
    monthly_price: 1500,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 5,
    cpu_limit: '1.0',
    memory_limit_mb: 1024,
    disk_limit_gb: 10,
    description: '适合 1-5 人小服',
  },
  {
    id: 'seed-tp-small',
    instance_type: 'small',
    display_name: '小型',
    monthly_price: 3000,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 15,
    cpu_limit: '2.0',
    memory_limit_mb: 2048,
    disk_limit_gb: 20,
    description: '适合 5-15 人服',
  },
  {
    id: 'seed-tp-medium',
    instance_type: 'medium',
    display_name: '标准',
    monthly_price: 9000,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 30,
    cpu_limit: '4.0',
    memory_limit_mb: 4096,
    disk_limit_gb: 40,
    description: '适合 15-30 人服',
  },
  {
    id: 'seed-tp-large',
    instance_type: 'large',
    display_name: '大型',
    monthly_price: 24000,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 60,
    cpu_limit: '8.0',
    memory_limit_mb: 8192,
    disk_limit_gb: 80,
    description: '适合 30-60 人服',
  },
  {
    id: 'seed-tp-xlarge',
    instance_type: 'xlarge',
    display_name: '超大',
    monthly_price: 60000,
    quarterly_discount: 0.95,
    semiannual_discount: 0.9,
    annual_discount: 0.8,
    recommended_slots: 120,
    cpu_limit: '16.0',
    memory_limit_mb: 16384,
    disk_limit_gb: 160,
    description: '适合 60+ 人大型服',
  },
];

export async function up(knex: Knex): Promise<void> {
  // 幂等：仅当表为空时插入
  const count = await knex('instance_type_pricing').count('* as cnt').first();
  const total = (count?.cnt as number) ?? 0;
  if (total > 0) {
    console.log(
      `[migration 20260830000005] instance_type_pricing 已有 ${total} 条记录，跳过 seed`,
    );
    return;
  }

  const now = new Date().toISOString();
  const rows = SEED_DATA.map((seed) => ({
    ...seed,
    status: 'active' as const,
    created_by: 'system-seed',
    created_at: now,
    updated_at: now,
  }));

  await knex('instance_type_pricing').insert(rows);
  console.log(
    `[migration 20260830000005] instance_type_pricing seed 完成（插入 ${rows.length} 条默认定价）`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // 仅删除 seed 记录（按 id 前缀识别），不删除用户自定义配置
  await knex('instance_type_pricing')
    .whereLike('id', 'seed-tp-%')
    .del();
  console.log('[migration 20260830000005] 回滚：删除 seed 定价记录（seed-tp-*）');
}

// 抑制未使用导入告警（crypto 预留给未来 UUID 生成）
void crypto;
