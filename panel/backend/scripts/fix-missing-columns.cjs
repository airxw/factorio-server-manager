// 临时修复脚本：补建 chat_trigger_responses.mode/cooldown_seconds
// 与 vote_settings.trigger_keywords/cooldown_seconds/target_cooldown_seconds/admin_immune/vip_immune_min_level
//
// 触发原因：迁移文件已在 knex_migrations 表中标记为已执行（batch 6），
// 但实际表未添加列。本脚本幂等执行 ALTER TABLE，列已存在则跳过。
// 修复后可删除本脚本。

const path = require('node:path');
const Database = require('sqlite3').Database;

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '..', 'data', 'panel.db');

function runAsync(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function allAsync(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function main() {
  console.log('DB_PATH:', DB_PATH);
  const db = new Database(DB_PATH);

  // 1. 检查 chat_trigger_responses 列
  const chatCols = await allAsync(db, "PRAGMA table_info(chat_trigger_responses)");
  const chatColNames = new Set(chatCols.map((c) => c.name));
  console.log('chat_trigger_responses columns:', [...chatColNames].join(', '));

  if (!chatColNames.has('mode')) {
    await runAsync(db, "ALTER TABLE chat_trigger_responses ADD COLUMN mode TEXT NOT NULL DEFAULT 'prefix'");
    console.log('[OK] Added chat_trigger_responses.mode');
  } else {
    console.log('[SKIP] chat_trigger_responses.mode already exists');
  }

  if (!chatColNames.has('cooldown_seconds')) {
    await runAsync(db, 'ALTER TABLE chat_trigger_responses ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 0');
    console.log('[OK] Added chat_trigger_responses.cooldown_seconds');
  } else {
    console.log('[SKIP] chat_trigger_responses.cooldown_seconds already exists');
  }

  // 2. 检查 vote_settings 列
  const voteCols = await allAsync(db, "PRAGMA table_info(vote_settings)");
  const voteColNames = new Set(voteCols.map((c) => c.name));
  console.log('vote_settings columns:', [...voteColNames].join(', '));

  const newVoteCols = [
    { name: 'trigger_keywords', type: 'TEXT', def: "'[\"!vk\"]'" },
    { name: 'cooldown_seconds', type: 'INTEGER', def: '60' },
    { name: 'target_cooldown_seconds', type: 'INTEGER', def: '300' },
    { name: 'admin_immune', type: 'INTEGER', def: '1' },
    { name: 'vip_immune_min_level', type: 'INTEGER', def: '0' },
  ];

  for (const col of newVoteCols) {
    if (!voteColNames.has(col.name)) {
      await runAsync(
        db,
        `ALTER TABLE vote_settings ADD COLUMN ${col.name} ${col.type} NOT NULL DEFAULT ${col.def}`,
      );
      console.log(`[OK] Added vote_settings.${col.name}`);
    } else {
      console.log(`[SKIP] vote_settings.${col.name} already exists`);
    }
  }

  // 3. 关闭 db
  await new Promise((resolve) => db.close(resolve));
  console.log('Done.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
