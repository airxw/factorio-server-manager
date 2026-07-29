// ============================================================================
// user_instance_bindings 表：VIP-实例绑定关系
// 用途：记录用户在某实例上的 VIP 绑定状态，支撑 VIP 权限的实例级落地
// 依赖表：users（id）/ servers（id, owner_user_id）
// 数据迁移：将 users.vip_level > 0 的存量 VIP 用户绑定到其自有实例；
//           无自有实例时回退到 id='default' 的实例（若存在）
// 幂等设计：建表用 hasTable 保护；数据插入前检查 (user_id, server_id) 是否已存在
// ============================================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ----- 建表 -----
  if (!(await knex.schema.hasTable('user_instance_bindings'))) {
    await knex.schema.createTable('user_instance_bindings', (table) => {
      table.increments('id').primary(); // 自增整数主键
      table.string('user_id').notNullable(); // 引用 users.id (UUID)
      table.string('server_id').notNullable(); // 引用 servers.id (UUID)
      // vip_level：绑定时的 VIP 等级，默认 1
      table.integer('vip_level').notNullable().defaultTo(1);
      // status 枚举：active / unbound
      table.string('status').notNullable().defaultTo('active');
      table.text('bound_at').notNullable(); // ISO 8601
      table.text('unbound_at').nullable().defaultTo(null); // ISO 8601
    });

    // UNIQUE(user_id, server_id)
    await knex.schema.alterTable('user_instance_bindings', (table) => {
      table.unique(['user_id', 'server_id'], 'idx_user_instance_bindings_unique');
      // INDEX(server_id)
      table.index('server_id', 'idx_uib_server');
      // INDEX(user_id, status)
      table.index(['user_id', 'status'], 'idx_uib_user_status');
    });
  }

  // ----- 数据迁移：存量 VIP 用户绑定到实例 -----
  // 防御：旧数据库可能没有 vip_level 列（users 表在 vip_level 字段添加前创建）
  const hasVipLevelColumn = await knex.schema.hasColumn('users', 'vip_level');

  if (hasVipLevelColumn) {
    await knex.transaction(async (trx) => {
      // 查询所有 vip_level > 0 的用户
      const vipUsers: Array<{ id: string; vip_level: number }> = await trx('users')
        .select('id', 'vip_level')
        .where('vip_level', '>', 0);

      const now = new Date().toISOString();

    for (const user of vipUsers) {
      // 查找该用户自有的实例（servers.owner_user_id = user.id）
      const ownedServers: Array<{ id: string }> = await trx('servers')
        .select('id')
        .where('owner_user_id', user.id);

      if (ownedServers.length > 0) {
        // 有自有实例：为每个实例创建绑定记录
        for (const server of ownedServers) {
          // 防重复：检查 (user_id, server_id) 是否已存在
          const existing = await trx('user_instance_bindings')
            .where({ user_id: user.id, server_id: server.id })
            .first();

          if (!existing) {
            await trx('user_instance_bindings').insert({
              user_id: user.id,
              server_id: server.id,
              vip_level: user.vip_level,
              status: 'active',
              bound_at: now,
              unbound_at: null,
            });
          }
        }
      } else {
        // 无自有实例：查找 id='default' 的 server
        const defaultServer: { id: string } | undefined = await trx('servers')
          .select('id')
          .where('id', 'default')
          .first();

        if (defaultServer) {
          // 防重复：检查 (user_id, server_id='default') 是否已存在
          const existing = await trx('user_instance_bindings')
            .where({ user_id: user.id, server_id: 'default' })
            .first();

          if (!existing) {
            await trx('user_instance_bindings').insert({
              user_id: user.id,
              server_id: 'default',
              vip_level: user.vip_level,
              status: 'active',
              bound_at: now,
              unbound_at: null,
            });
          }
        }
      }
    }
  });
  } // end if hasVipLevelColumn
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_instance_bindings');
}
