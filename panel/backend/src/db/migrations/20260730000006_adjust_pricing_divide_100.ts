// ============================================================================
// 20260730000006_adjust_pricing_divide_100.ts
// v4.35.1：实例类型定价整体除以 100（用户反馈原价过贵）
//
// 背景：
//   v4.35.0 seed 的默认定价（micro=1500 / small=3000 / medium=9000 /
//   large=24000 / xlarge=60000 点券）经用户反馈过贵，要求整体除以 100。
//   本 migration 将 5 条 seed 记录的 monthly_price 更新为调整后值。
//
// 调整后定价（100 点券 = 1 元）：
//   | 类型    | 原月费 | 调整后月费 | 折合人民币 |
//   |---------|-------|-----------|-----------|
//   | micro   | 1500  | 15        | ¥0.15     |
//   | small   | 3000  | 30        | ¥0.30     |
//   | medium  | 9000  | 90        | ¥0.90     |
//   | large   | 24000 | 240       | ¥2.40     |
//   | xlarge  | 60000 | 600       | ¥6.00     |
//
// 兼容性：
//   - up：按 id 精确 UPDATE 5 条 seed 记录（seed-tp-*），不影响用户自定义定价
//   - down：还原为原价（v4.35.0 seed 值）
//
// 说明：seed migration（20260830000005）已同步更新为调整后值，本 migration
//       仅用于更新已执行过原 seed 的存量数据库。fresh install 时 seed 插入
//       的已是新值，本 migration UPDATE 仍幂等（SET 为相同值）。
// ============================================================================

import type { Knex } from 'knex';

const ADJUSTMENTS: Record<string, number> = {
  'seed-tp-micro': 15,
  'seed-tp-small': 30,
  'seed-tp-medium': 90,
  'seed-tp-large': 240,
  'seed-tp-xlarge': 600,
};

const ORIGINAL_PRICES: Record<string, number> = {
  'seed-tp-micro': 1500,
  'seed-tp-small': 3000,
  'seed-tp-medium': 9000,
  'seed-tp-large': 24000,
  'seed-tp-xlarge': 60000,
};

export async function up(knex: Knex): Promise<void> {
  // v4.39.2 修复（fresh install 启动崩溃）：本 migration 文件名时序（20260730）
  // 先于 20260830000002（建 instance_type_pricing 表）执行，fresh install 时
  // 直接 UPDATE 会报 SQLITE_ERROR: no such table。fresh install 的 seed
  // （20260830000005）插入的已是调整后新值，此处无表时跳过即可。
  if (!(await knex.schema.hasTable('instance_type_pricing'))) {
    console.log(
      '[migration 20260730000006] instance_type_pricing 表不存在（fresh install），跳过——seed 已插入调整后定价',
    );
    return;
  }

  const now = new Date().toISOString();
  let updated = 0;

  for (const [id, newPrice] of Object.entries(ADJUSTMENTS)) {
    const result = await knex('instance_type_pricing')
      .where('id', id)
      .update({ monthly_price: newPrice, updated_at: now });
    updated += result;
  }

  console.log(
    `[migration 20260730000006] instance_type_pricing 定价除以 100 调整完成（更新 ${updated} 条记录）`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // 同 up：fresh install 无表时跳过（无可还原对象）
  if (!(await knex.schema.hasTable('instance_type_pricing'))) {
    return;
  }

  const now = new Date().toISOString();
  let restored = 0;

  for (const [id, originalPrice] of Object.entries(ORIGINAL_PRICES)) {
    const result = await knex('instance_type_pricing')
      .where('id', id)
      .update({ monthly_price: originalPrice, updated_at: now });
    restored += result;
  }

  console.log(
    `[migration 20260730000006] 回滚：还原 instance_type_pricing 至 v4.35.0 原价（${restored} 条）`,
  );
}
