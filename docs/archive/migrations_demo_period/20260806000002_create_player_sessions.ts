// ============================================================================
// v4.13.0: 玩家会话表（player_sessions）
// 依据：docs/plans/v4.13.0-instances-split-plan.md 步骤18a
//
// 用途：记录玩家每次加入/离开实例的会话，供时长统计 API 聚合查询。
// 写入链路：daemon 在玩家 join/leave 事件时通过 Panel API 上报（步骤18b）。
//
// v4.11.0 假闭合教训补强：本表必须配合 daemon 写入链路（步骤18b），
// 否则时长统计 API 查询永远返回空数据，构成孤岛代码。
// 热更新安全：使用 hasTable 保护，已存在则跳过。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('player_sessions'))) {
    await knex.schema.createTable('player_sessions', (table) => {
      // 会话 ID（UUID，由上报端生成）
      table.string('session_id').primary();
      // 玩家对应的 Panel 用户 ID（引用 users.id，不设外键约束以避免删除顺序依赖）
      table.string('player_user_id').notNullable();
      // 实例 ID（引用 servers.id）
      table.string('instance_id').notNullable();
      // 游戏内玩家名（快照，便于无 user_id 时也能聚合）
      table.string('game_player_name').nullable().defaultTo(null);
      // 加入时间（ISO 8601）
      table.text('join_at').notNullable();
      // 离开时间（ISO 8601，null = 仍在会话中）
      table.text('leave_at').nullable().defaultTo(null);
      // 会话时长（秒，leave_at 非 null 时由 daemon 计算）
      table.integer('duration_seconds').nullable().defaultTo(null);
      // 创建时间（ISO 8601，记录写入数据库的时间）
      table.text('created_at').notNullable();
    });

    // 索引：按实例 + 日期范围查询（时长统计 API 用）
    await knex.schema.alterTable('player_sessions', (table) => {
      table.index(['instance_id', 'join_at'], 'idx_player_sessions_inst_join');
      table.index(['instance_id', 'leave_at'], 'idx_player_sessions_inst_leave');
      table.index(['player_user_id', 'instance_id'], 'idx_player_sessions_user_inst');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('player_sessions');
}
