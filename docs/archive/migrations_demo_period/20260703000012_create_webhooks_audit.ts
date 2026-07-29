// ============================================================================
// P5：webhooks / audit_logs
// 依据：audit-logs-schema.json + shared-types.d.ts Webhook 接口
// 注：webhooks-schema.json 物理文件缺失，webhooks 表字段按
//     public/interface_stub/shared-types.d.ts 中的 Webhook 接口定义
//     （id / server_id / url / event_types / secret / enabled / created_at
//      / updated_at），该接口存根同为三层契约的物理载体（rules-3 §二）。
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- webhooks -----
  if (!(await knex.schema.hasTable('webhooks'))) {
    await knex.schema.createTable('webhooks', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      table.string('url').notNullable();
      // event_types: JSON 数组字符串，默认 '[]'
      table.text('event_types').notNullable().defaultTo('[]');
      table.string('secret').nullable().defaultTo(null);
      table.boolean('enabled').notNullable().defaultTo(true);
      table.text('created_at').notNullable(); // ISO 8601
      table.text('updated_at').notNullable(); // ISO 8601
    });
  }

  // ----- audit_logs -----
  if (!(await knex.schema.hasTable('audit_logs'))) {
    await knex.schema.createTable('audit_logs', (table) => {
      table.increments('id').primary(); // 自增整数
      table.string('server_id').nullable().defaultTo(null); // 引用 servers.id (UUID)
      table.string('user_id').nullable().defaultTo(null); // 引用 users.id (UUID)
      table.string('action').notNullable();
      table.string('target_type').nullable().defaultTo(null);
      table.string('target_id').nullable().defaultTo(null);
      table.text('details_json').nullable().defaultTo(null); // JSON 字符串
      table.string('ip_address').nullable().defaultTo(null);
      table.text('created_at').notNullable(); // ISO 8601
    });
    await knex.schema.alterTable('audit_logs', (table) => {
      table.index('created_at', 'idx_audit_logs_created_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('webhooks');
}
