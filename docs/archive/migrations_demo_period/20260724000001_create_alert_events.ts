// ============================================================================
// v4.6.0: alert_events 表 — 告警事件历史记录
// 存储已触发的告警事件，供运营仪表盘 / 告警历史页查询
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('alert_events')) return;
  await knex.schema.createTable('alert_events', (table) => {
    table.string('id').primary(); // UUID
    table.string('rule_type').notNullable(); // AlertRuleType
    table.string('severity').notNullable(); // 'info' | 'warning' | 'critical'
    table.text('title').notNullable();
    table.text('content').notNullable();
    table.string('related_server_id').nullable().defaultTo(null);
    table.text('triggered_at').notNullable(); // ISO 8601
    table.text('dispatched_channels').notNullable(); // JSON 数组字符串，如 '["in_app","email"]'
    table.text('created_at').notNullable();
    // 索引：按触发时间倒序查询、按 server_id 过滤
    table.index(['triggered_at'], 'idx_alert_events_triggered_at');
    table.index(['related_server_id'], 'idx_alert_events_server_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alert_events');
}
