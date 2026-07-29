// ============================================================================
// v4.8.0: servers 表新增 is_public / is_recommended / recommended_at 字段
// 用途：服务器推荐位（K1）
//   - is_public: 0=私有（默认），1=公开（在发现页可见）
//   - is_recommended: 0=普通（默认），1=推荐置顶（server_admin 手动置顶）
//   - recommended_at: 推荐时间，取消推荐时置 NULL
// 幂等：逐列 hasColumn 守卫，已存在则跳过
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('servers', 'is_public'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.integer('is_public').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn('servers', 'is_recommended'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.integer('is_recommended').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn('servers', 'recommended_at'))) {
    await knex.schema.alterTable('servers', (table) => {
      table.text('recommended_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const col of ['recommended_at', 'is_recommended', 'is_public']) {
    if (await knex.schema.hasColumn('servers', col)) {
      await knex.schema.alterTable('servers', (table) => {
        table.dropColumn(col);
      });
    }
  }
}
