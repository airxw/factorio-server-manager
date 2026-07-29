/**
 * scripts/db-clean-demo.ts
 * v4.19.0 M5-阶段三：Demo 期数据清洗脚本
 *
 * 用途：Demo 期结束后清理测试数据，为生产环境准备干净的数据库。
 *
 * 清洗内容：
 *   1. 清理 Demo 账号（email LIKE '%@local.dev' AND is_built_in=0）
 *      - 级联清理 friendships / resource_quotas / api_keys / user_wallets / user_notifications
 *        / password_resets / email_verifications / user_password_history
 *   2. 截断高频流水表
 *      - chat_logs / item_sync_log / command_queue / audit_logs
 *   3. 清理僵尸绑定（bindings 表中 scope_ref 关联已删除 servers 的记录）
 *
 * ⚠️ 生产环境防呆锁：
 *   - NODE_ENV=production 时必须显式设置 CONFIRM_DEMO_PURGE=YES 才能执行
 *   - 否则抛出异常并退出
 *
 * 运行方式：npm run db:clean-demo
 *           （或：npx tsx scripts/db-clean-demo.ts）
 */

import knex, { type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// 生产环境防呆锁
// ============================================================================
if (process.env.NODE_ENV === 'production' && process.env.CONFIRM_DEMO_PURGE !== 'YES') {
  console.error('❌ 禁止在生产环境意外执行清洗！');
  console.error('   如确需执行，请设置环境变量：CONFIRM_DEMO_PURGE=YES');
  console.error('   （例：NODE_ENV=production CONFIRM_DEMO_PURGE=YES npm run db:clean-demo）');
  process.exit(1);
}

// ============================================================================
// 初始化 Knex 连接（与 panel/backend/src/db/connection.ts 一致）
// ============================================================================
const DATABASE_URL = process.env.DATABASE_URL || './panel/backend/data/panel.db';
const dbPath = path.isAbsolute(DATABASE_URL)
  ? DATABASE_URL
  : path.resolve(PROJECT_ROOT, DATABASE_URL);

const db: Knex = knex({
  client: 'sqlite3',
  connection: { filename: dbPath },
  useNullAsDefault: true,
});

// ============================================================================
// 清洗统计
// ============================================================================
interface CleanStats {
  demoUsers: number;
  cascaded: Record<string, number>;
  truncated: Record<string, number>;
  zombieBindings: number;
}

const stats: CleanStats = {
  demoUsers: 0,
  cascaded: {},
  truncated: {},
  zombieBindings: 0,
};

// ============================================================================
// 主流程
// ============================================================================
async function main(): Promise<void> {
  console.log('=== v4.19.0 Demo 数据清洗脚本 ===');
  console.log(`数据库路径: ${dbPath}`);
  console.log(`环境: NODE_ENV=${process.env.NODE_ENV || '(未设置)'}, CONFIRM_DEMO_PURGE=${process.env.CONFIRM_DEMO_PURGE ? 'YES' : '(未设置)'}`);
  console.log('');

  // 备份提醒
  console.warn('⚠️  此操作不可逆！请确保已备份 panel.db');
  console.warn(`   备份命令: cp ${dbPath} ${dbPath}.bak.$(date +%Y%m%d%H%M%S)`);
  console.log('');

  // ------------------------------------------------------------------
  // Step 1: 清理 Demo 账号 + 级联表
  // ------------------------------------------------------------------
  console.log('--- Step 1: 清理 Demo 账号 ---');

  // 1.1 查询待清理的 demo 用户 ID 列表
  const demoUsers: Array<{ id: string; email: string; username: string }> = await db('users')
    .select('id', 'email', 'username')
    .where('email', 'like', '%@local.dev')
    .andWhere('is_built_in', 0);
  stats.demoUsers = demoUsers.length;
  console.log(`找到 ${demoUsers.length} 个 demo 账号（email LIKE '%@local.dev' AND is_built_in=0）`);
  if (demoUsers.length > 0) {
    console.log('  示例:', demoUsers.slice(0, 3).map((u) => u.email).join(', '));
  }

  if (demoUsers.length > 0) {
    const demoUserIds = demoUsers.map((u) => u.id);

    // 1.2 级联清理关联表（按外键依赖顺序）
    const cascadeTables = [
      'user_password_history',
      'password_resets',
      'email_verifications',
      'user_notifications',
      'user_wallets',
      'friendships', // user_id 或 friend_user_id
      'resource_quotas', // scope_type='user' AND scope_id IN (...)
      'api_keys',
      'bindings', // demo 用户的绑定
      'instance_admins', // demo 用户被分配的实例管理权限
      'instance_roles',
      'alert_settings', // demo 用户的告警配置
    ];

    for (const table of cascadeTables) {
      const hasTable = await db.schema.hasTable(table);
      if (!hasTable) {
        console.log(`  跳过 ${table}（表不存在）`);
        continue;
      }
      try {
        let deleted: number;
        if (table === 'friendships') {
          // friendships 有 user_id 和 friend_user_id 两列
          deleted = await db(table).whereIn('user_id', demoUserIds).orWhereIn('friend_user_id', demoUserIds).del();
        } else if (table === 'resource_quotas') {
          // resource_quotas 用 scope_type + scope_id
          deleted = await db(table).where({ scope_type: 'user' }).whereIn('scope_id', demoUserIds).del();
        } else {
          deleted = await db(table).whereIn('user_id', demoUserIds).del();
        }
        stats.cascaded[table] = deleted;
        if (deleted > 0) {
          console.log(`  级联清理 ${table}: ${deleted} 行`);
        }
      } catch (err) {
        console.warn(`  ⚠️ 级联清理 ${table} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 1.3 删除 demo 用户本身
    const deletedUsers = await db('users').whereIn('id', demoUserIds).del();
    console.log(`已删除 ${deletedUsers} 个 demo 用户`);
  }
  console.log('');

  // ------------------------------------------------------------------
  // Step 2: 截断高频流水表
  // ------------------------------------------------------------------
  console.log('--- Step 2: 截断高频流水表 ---');
  const truncateTables = ['chat_logs', 'item_sync_log', 'command_queue', 'audit_logs'];
  for (const table of truncateTables) {
    const hasTable = await db.schema.hasTable(table);
    if (!hasTable) {
      console.log(`  跳过 ${table}（表不存在）`);
      continue;
    }
    try {
      // SQLite 用 DELETE FROM 截断（比 TRUNCATE 兼容性好，会触发 cascade）
      const before = (await db(table).count('* as cnt').first()) as any;
      const beforeCount = Number(before?.cnt ?? 0);
      await db(table).del();
      stats.truncated[table] = beforeCount;
      console.log(`  截断 ${table}: 清除 ${beforeCount} 行`);
    } catch (err) {
      console.warn(`  ⚠️ 截断 ${table} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('');

  // ------------------------------------------------------------------
  // Step 3: 清理僵尸绑定（bindings 表中 scope_ref 关联已删除 servers 的记录）
  // ------------------------------------------------------------------
  console.log('--- Step 3: 清理僵尸绑定 ---');
  const hasBindings = await db.schema.hasTable('bindings');
  const hasServers = await db.schema.hasTable('servers');
  if (hasBindings && hasServers) {
    try {
      // 查找 scope_type='instance' 且 scope_ref 不在 servers 表中的绑定
      const zombieBindings = await db('bindings')
        .where({ scope_type: 'instance' })
        .whereNotIn('scope_ref', db('servers').select('id'))
        .select('id', 'user_id', 'scope_ref');
      stats.zombieBindings = zombieBindings.length;
      console.log(`找到 ${zombieBindings.length} 条僵尸绑定（关联已删除实例）`);

      if (zombieBindings.length > 0) {
        const zombieIds = zombieBindings.map((b) => b.id);
        const deleted = await db('bindings').whereIn('id', zombieIds).del();
        console.log(`已清理 ${deleted} 条僵尸绑定`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 清理僵尸绑定失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('  跳过（bindings 或 servers 表不存在）');
  }
  console.log('');

  // ------------------------------------------------------------------
  // 汇总报告
  // ------------------------------------------------------------------
  console.log('=== 清洗完成汇总 ===');
  console.log(`Demo 账号: ${stats.demoUsers} 个`);
  console.log(`级联清理:`);
  for (const [table, count] of Object.entries(stats.cascaded)) {
    if (count > 0) console.log(`  - ${table}: ${count} 行`);
  }
  console.log(`流水表截断:`);
  for (const [table, count] of Object.entries(stats.truncated)) {
    console.log(`  - ${table}: ${count} 行`);
  }
  console.log(`僵尸绑定: ${stats.zombieBindings} 条`);
  console.log('');
  console.log('✅ 数据清洗完成');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ 数据清洗失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.destroy();
  });
