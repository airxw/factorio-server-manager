// ============================================================================
// 监控快照表迁移
//
// 说明：monitor_snapshots 表已由 20260703000011_create_ops_tables.ts 创建
//       （字段：server_id / timestamp / cpu_percent / memory_mb / tick_rate
//        / player_count / json_extra，索引 idx_monitor_snapshots_server_timestamp）。
// 本迁移保留 hasTable 守卫作为幂等保护：表已存在则跳过，避免重复创建。
// Panel 侧监控查询 API（GET /api/servers/:serverId/monitoring）复用既有表结构。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('monitor_snapshots');
  if (!hasTable) {
    await knex.schema.createTable('monitor_snapshots', (table) => {
      table.increments('id').primary();
      table.string('instance_id').notNullable();
      table.float('cpu_pct').nullable();        // CPU使用率%
      table.float('mem_mb').nullable();          // 内存使用MB
      table.integer('players').nullable();       // 在线玩家数
      table.integer('uptime_sec').nullable();    // 运行时长秒
      table.string('status').nullable();         // 实例状态
      table.timestamp('collected_at').defaultTo(knex.fn.now());
      table.index(['instance_id', 'collected_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // 不删除表：既有 monitor_snapshots 表由 20260703000011 管理，回滚交由该迁移负责
  void knex;
}
