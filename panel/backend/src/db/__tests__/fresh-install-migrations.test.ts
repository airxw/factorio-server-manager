// ============================================================================
// fresh-install-migrations.test.ts
// DEF-008 回归测试：fresh install 迁移全链路按序执行
//
// 背景：
//   migration 20260730000006_adjust_pricing_divide_100 文件名时序先于建表迁移
//   20260830000002，fresh install 时直接 UPDATE 不存在的表导致 Panel 启动崩溃
//   （SQLITE_ERROR: no such table: instance_type_pricing）。根因之一是 fresh
//   install 路径（空库按文件名序执行全部迁移）自 v4.35.4 起无测试覆盖。
//
// 覆盖：
//   1. 空内存库按文件名序执行全部迁移（fresh install 全链路，缺陷类覆盖）
//   2. 全链路执行后 instance_type_pricing 为调整后定价（seed 新值）
//   3. DEF-008 防护：20260730000006 up/down 在无表库上不抛错
//   4. 存量库行为不变：20260730000006 up 调整定价 / down 还原原价
// ============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import knex, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { up, down } from '../migrations/20260730000006_adjust_pricing_divide_100.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

let dbs: Knex[] = [];

function createBlankDb(): Knex {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  dbs.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(dbs.map((db) => db.destroy()));
  dbs = [];
});

/**
 * 复刻 knex migrate.latest() 的核心语义：按文件名升序依次执行每个迁移的 up()。
 * 直接在 vitest 中动态 import（经 vite 转换），不依赖 knex 运行时的 ts 加载能力。
 */
async function runAllMigrationsInOrder(db: Knex): Promise<string[]> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const mod = (await import(path.join(MIGRATIONS_DIR, file))) as {
      up: (k: Knex) => Promise<void>;
    };
    await mod.up(db);
  }
  return files;
}

describe('fresh install 迁移全链路（DEF-008 回归）', () => {
  it('空库按文件名序执行全部迁移不抛错', async () => {
    const db = createBlankDb();
    const files = await runAllMigrationsInOrder(db);
    // 防护目标：任何迁移在依赖表尚未创建时直接读写都会在此抛错
    expect(files).toContain('20260730000006_adjust_pricing_divide_100.ts');
    expect(files).toContain('20260808000000_baseline_v4_post_demo.ts');
  }, 60000);

  it('fresh install 后 instance_type_pricing 为调整后定价（÷100）', async () => {
    const db = createBlankDb();
    await runAllMigrationsInOrder(db);

    const rows = (await db('instance_type_pricing').select('id', 'monthly_price')) as Array<{
      id: string;
      monthly_price: number;
    }>;
    const priceById = Object.fromEntries(rows.map((r) => [r.id, r.monthly_price]));

    // seed 迁移 20260830000005 插入的已是调整后新值
    expect(priceById['seed-tp-micro']).toBe(15);
    expect(priceById['seed-tp-small']).toBe(30);
    expect(priceById['seed-tp-medium']).toBe(90);
    expect(priceById['seed-tp-large']).toBe(240);
    expect(priceById['seed-tp-xlarge']).toBe(600);
  }, 60000);
});

describe('migration 20260730000006_adjust_pricing_divide_100（DEF-008 防护）', () => {
  it('fresh install（表不存在）up/down 均跳过不抛错', async () => {
    const db = createBlankDb();
    await expect(up(db)).resolves.toBeUndefined();
    await expect(down(db)).resolves.toBeUndefined();
  });

  it('存量库：up 调整定价为 ÷100 新值，down 还原原价', async () => {
    const db = createBlankDb();
    const now = new Date().toISOString();
    await db.schema.createTable('instance_type_pricing', (table) => {
      table.string('id').primary();
      table.integer('monthly_price').notNullable();
      table.string('created_at').notNullable();
      table.string('updated_at').notNullable();
    });
    await db('instance_type_pricing').insert([
      { id: 'seed-tp-micro', monthly_price: 1500, created_at: now, updated_at: now },
      { id: 'seed-tp-small', monthly_price: 3000, created_at: now, updated_at: now },
      { id: 'seed-tp-medium', monthly_price: 9000, created_at: now, updated_at: now },
      { id: 'seed-tp-large', monthly_price: 24000, created_at: now, updated_at: now },
      { id: 'seed-tp-xlarge', monthly_price: 60000, created_at: now, updated_at: now },
    ]);

    await up(db);
    const adjusted = Object.fromEntries(
      ((await db('instance_type_pricing').select('id', 'monthly_price')) as Array<{
        id: string;
        monthly_price: number;
      }>).map((r) => [r.id, r.monthly_price]),
    );
    expect(adjusted['seed-tp-micro']).toBe(15);
    expect(adjusted['seed-tp-xlarge']).toBe(600);

    await down(db);
    const restored = Object.fromEntries(
      ((await db('instance_type_pricing').select('id', 'monthly_price')) as Array<{
        id: string;
        monthly_price: number;
      }>).map((r) => [r.id, r.monthly_price]),
    );
    expect(restored['seed-tp-micro']).toBe(1500);
    expect(restored['seed-tp-xlarge']).toBe(60000);
  });
});
