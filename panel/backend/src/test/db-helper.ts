// ============================================================================
// db-helper — SQLite 内存数据库工厂
// 每个测试获得独立的 :memory: 实例，互不污染。
//
// 实现说明：
//   connection.ts 的 dbInstance 是单例，测试时直接调用 knex({...}) 创建独立实例，
//   不走 initDatabase()。
//
//   为什么手动建表而不跑 migrations？
//   1. knex 3.x 默认 importFile() 因 package.json "type":"module" 走 Node 原生
//      import()，无法加载 .ts 迁移（ERR_UNKNOWN_FILE_EXTENSION）。
//   2. 自定义 migrationSource 可绕过该限制，但部分生产迁移使用了
//      defaultTo(knex.raw("datetime('now')")) 生成 `DEFAULT datetime('now')`，
//      SQLite 要求 `DEFAULT (datetime('now'))`（函数调用需括号），导致语法错误。
//   3. 测试只需 users + api_keys 两张表（apiKeyService 的全部依赖），
//      手动建表最快、最可靠、与生产迁移解耦。
//
//   Schema 来源：合并以下迁移的 users 列定义
//   - 20260703000001_create_core_tables.ts（基础列）
//   - 20260716000005_add_missing_columns_to_users_and_servers.ts（补齐列）
//   - 20260717000002_add_token_version_and_password_history.ts（token_version）
//   - 20260724000000_add_password_changed_at.ts（password_changed_at）
//   - 20260728000002_add_email_verified_to_users.ts（email_verified）
//   - 20260801000000_add_is_built_in_to_users.ts（is_built_in）
//   api_keys 列定义来源：20260722000000_create_api_keys.ts
// ============================================================================

import knex, { type Knex } from 'knex';

/**
 * 创建独立的 SQLite 内存数据库并建好 users + api_keys 表。
 * @returns 已完成 schema 建表的 knex 实例
 */
export async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  // ----- users 表（合并全部迁移的列定义） -----
  await db.schema.createTable('users', (table) => {
    table.string('id').primary();
    table.string('email').notNullable().unique();
    table.string('username').notNullable();
    table.string('password_hash').notNullable();
    table.string('role').notNullable().defaultTo('viewer');
    table.string('status').notNullable().defaultTo('active');
    table.string('display_name').nullable().defaultTo(null);
    table.integer('vip_level').notNullable().defaultTo(0);
    table.text('vip_expires_at').nullable().defaultTo(null);
    table.boolean('is_verified').notNullable().defaultTo(false);
    table.text('last_login_at').nullable().defaultTo(null);
    table.string('last_login_ip').nullable().defaultTo(null);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
    table.integer('token_version').notNullable().defaultTo(0);
    table.text('password_changed_at').nullable().defaultTo(null);
    table.integer('email_verified').notNullable().defaultTo(0);
    table.integer('is_built_in').notNullable().defaultTo(0);
  });

  // ----- api_keys 表 -----
  await db.schema.createTable('api_keys', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('key_prefix').notNullable();
    table.string('key_hash', 64).notNullable().unique();
    table.string('user_id').notNullable();
    table.string('role').notNullable();
    table.text('created_at').notNullable();
    table.text('expires_at').nullable().defaultTo(null);
    table.text('last_used_at').nullable().defaultTo(null);
    table.text('last_used_ip').nullable().defaultTo(null);
    table.text('revoked_at').nullable().defaultTo(null);
    table.index(['key_hash'], 'idx_api_keys_key_hash');
    table.index(['user_id'], 'idx_api_keys_user_id');
    table.foreign('user_id').references('id').inTable('users');
  });

  await db.schema.createTable('nodes', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('fqdn').notNullable();
    table.string('daemon_token_hash').notNullable();
    table.string('public_ip').nullable();
    table.string('status').notNullable().defaultTo('offline');
    table.text('last_seen_at').nullable();
    table.string('node_type').notNullable().defaultTo('slave');
    table.string('comms_key').nullable();
    table.string('link_key_hash').nullable();
    table.text('link_key_expires_at').nullable();
    table.text('linked_at').nullable();
    table.string('display_fqdn').nullable();
    // v4.28.0 节点归属字段（来源：migration 20260826000000_add_self_hosted_fields_to_nodes.ts）
    table.string('node_source').notNullable().defaultTo('platform_managed');
    table.string('self_hosted_owner_id').nullable().defaultTo(null);
    table.string('approval_status').notNullable().defaultTo('approved');
    table.string('approved_by').nullable().defaultTo(null);
    table.text('approved_at').nullable().defaultTo(null);
    table.index(['self_hosted_owner_id'], 'idx_nodes_self_hosted_owner_id');
    table.index(['node_source'], 'idx_nodes_node_source');
  });

  // ----- servers 表 -----
  await db.schema.createTable('servers', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('pack_id').notNullable();
    table.string('game_type').notNullable();
    table.string('node_id').notNullable();
    table.string('owner_user_id').notNullable();
    table.string('status').notNullable().defaultTo('stopped');
    table.integer('port').notNullable();
    table.integer('rcon_port').notNullable();
    table.string('rcon_password_enc').nullable();
    table.text('resource_limits_json').nullable();
    table.string('current_version').nullable();
    table.string('version_id').nullable();
    table.text('last_activity_at').nullable();
    table.integer('marked_for_deletion').notNullable().defaultTo(0);
    table.integer('disk_usage_bytes').nullable();
    table.text('disk_usage_updated_at').nullable();
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // ----- game_versions 表 -----
  await db.schema.createTable('game_versions', (table) => {
    table.string('id').primary();
    table.string('pack_id').notNullable();
    table.string('version').notNullable();
    table.integer('version_major').notNullable().defaultTo(0);
    table.integer('version_minor').notNullable().defaultTo(0);
    table.integer('version_patch').notNullable().defaultTo(0);
  });

  // ----- shop_items 表 -----
  await db.schema.createTable('shop_items', (table) => {
    table.increments('id').primary();
    table.string('server_id').notNullable();
    table.string('item_name').notNullable();
    table.string('quality').notNullable().defaultTo('normal');
    table.integer('vip_level_required').notNullable().defaultTo(1);
    table.integer('daily_limit').nullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // v4.17.0: user_instance_bindings 已物理删除，统一 bindings 表在下文创建

  // ----- instance_admins 表 -----
  await db.schema.createTable('instance_admins', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('instance_id').notNullable();
  });

  // ----- v4.17.0: 统一 bindings 表（多态绑定：account/player × instance/game_type/global） -----
  await db.schema.createTable('bindings', (table) => {
    table.string('id').primary();
    table.string('user_id').notNullable();
    table.string('binding_type').notNullable(); // 'account' | 'player'
    table.string('scope_type').notNullable();   // 'instance' | 'game_type' | 'global'
    table.string('scope_ref').notNullable();     // instance_id | game_type | null（global）
    table.string('player_name').nullable();
    table.integer('vip_level').notNullable().defaultTo(0);
    table.string('wallet_id').nullable();
    table.string('verify_status').notNullable().defaultTo('pending'); // pending|verified|revoked|expired
    table.string('verify_code').nullable();
    table.text('verify_expires_at').nullable();
    table.text('verified_at').nullable();
    table.text('metadata').nullable();
    table.text('created_at').notNullable();
    table.text('updated_at').notNullable();
  });

  // ----- v4.17.0: permission_points 表（权限点字典） -----
  await db.schema.createTable('permission_points', (table) => {
    table.string('code').primary();
    table.string('description').notNullable();
    table.string('category').notNullable();
    table.text('created_at').notNullable();
  });

  // ----- v4.17.0: role_permission_templates 表（角色-权限点映射） -----
  await db.schema.createTable('role_permission_templates', (table) => {
    table.string('role').notNullable();
    table.string('permission_code').notNullable();
    table.text('created_at').notNullable();
    table.primary(['role', 'permission_code']);
  });

  // v4.17.0: seed 关键权限点 + server_admin/instance_admin 角色权限模板（测试用最小集）
  const now = new Date().toISOString();
  await db('permission_points').insert([
    { code: 'instance.create', description: '创建实例', category: 'instance', created_at: now },
    { code: 'instance.view', description: '查看实例', category: 'instance', created_at: now },
    { code: 'instance.update', description: '修改实例配置', category: 'instance', created_at: now },
    { code: 'instance.delete', description: '删除实例', category: 'instance', created_at: now },
  ]);
  await db('role_permission_templates').insert([
    // instance_admin: 继承 user + 实例管理
    { role: 'instance_admin', permission_code: 'instance.create', created_at: now },
    { role: 'instance_admin', permission_code: 'instance.view', created_at: now },
    { role: 'instance_admin', permission_code: 'instance.update', created_at: now },
    { role: 'instance_admin', permission_code: 'instance.delete', created_at: now },
    // server_admin: 继承 instance_admin + 系统级
    { role: 'server_admin', permission_code: 'instance.create', created_at: now },
    { role: 'server_admin', permission_code: 'instance.view', created_at: now },
    { role: 'server_admin', permission_code: 'instance.update', created_at: now },
    { role: 'server_admin', permission_code: 'instance.delete', created_at: now },
  ]);

  return db;
}

/**
 * 在已初始化的测试 DB 上创建资产服务相关表（global_assets / instance_assets）。
 * 与生产迁移 20260805000001_create_asset_tables.ts 保持列定义一致。
 * 供 AssetService 单元/集成测试使用。
 */
export async function createAssetTables(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('global_assets'))) {
    await db.schema.createTable('global_assets', (table) => {
      table.string('id').primary();
      table.string('type').notNullable();
      table.string('name').notNullable();
      table.float('default_price').nullable().defaultTo(null);
      table.text('execution_logic').nullable().defaultTo(null);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.string('game_pack_id').nullable().defaultTo(null);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
  }
  if (!(await db.schema.hasTable('instance_assets'))) {
    await db.schema.createTable('instance_assets', (table) => {
      table.string('id').primary();
      table.string('instance_id').notNullable();
      table.string('global_asset_id').nullable().defaultTo(null);
      table.boolean('is_ugc').notNullable().defaultTo(false);
      table.float('override_price').nullable().defaultTo(null);
      table.string('override_name').nullable().defaultTo(null);
      table.boolean('override_is_active').nullable().defaultTo(null);
      table.text('custom_execution_logic').nullable().defaultTo(null);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
  }
}

/**
 * 在已初始化的测试 DB 上创建经济系统相关表。
 * 与生产迁移保持列定义一致，来源：
 * - user_wallets / cdk_codes / cdk_code_items / shop_orders / shop_order_items /
 *   system_config / vip_permissions：baseline 20260808000000_baseline_v4_post_demo.ts
 * - global_balances / instance_points / user_integrals / user_vip_status /
 *   instance_pricing / wallet_transactions / withdraw_codes：2026072700000{1..8}
 * - cdk_codes 扩展列（type/amount/vip_duration/creator_user_id/refunded_at/refund_tx_id）：
 *   20260727000006_extend_cdk_keys.ts
 * 另：createTestDb 中的 shop_items 缺 price 列（生产基线含），此处补齐。
 * 供 wallet/balance/withdraw/points/integral/pricing/vip/cdk/shop 服务测试使用。
 */
export async function createEconomyTables(db: Knex): Promise<void> {
  // ----- shop_items 补 price 列（生产基线含 price，createTestDb 版本缺） -----
  if (!(await db.schema.hasColumn('shop_items', 'price'))) {
    await db.schema.alterTable('shop_items', (table) => {
      table.integer('price').notNullable().defaultTo(0);
    });
  }

  // ----- user_wallets（实例点券钱包，UNIQUE(user_id, server_id)） -----
  if (!(await db.schema.hasTable('user_wallets'))) {
    await db.schema.createTable('user_wallets', (table) => {
      table.increments('id').primary();
      table.string('user_id').notNullable();
      table.string('server_id').notNullable();
      table.integer('balance').notNullable().defaultTo(0);
      table.integer('total_earned').notNullable().defaultTo(0);
      table.integer('total_spent').notNullable().defaultTo(0);
      table.text('last_daily_claim_at').nullable();
      table.text('last_daily_claim_date').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.unique(['user_id', 'server_id'], { indexName: 'idx_user_wallets_user_server' });
    });
  }

  // ----- wallet_transactions（统一流水；order_id 部分唯一索引为幂等键） -----
  if (!(await db.schema.hasTable('wallet_transactions'))) {
    await db.schema.createTable('wallet_transactions', (table) => {
      table.increments('id').primary();
      table.string('user_id').notNullable();
      table.string('server_id').nullable();
      table.string('currency_type').notNullable();
      table.string('type').notNullable();
      table.integer('amount').notNullable();
      table.integer('balance_after').notNullable();
      table.integer('linked_tx_id').nullable();
      table.string('order_id').nullable();
      table.integer('cdk_id').nullable();
      table.integer('withdraw_code_id').nullable();
      table.text('description').nullable();
      table.string('operator_user_id').nullable();
      table.string('trace_id').notNullable();
      table.text('created_at').notNullable();
    });
    await db.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS `idx_wallet_tx_order_id` ON `wallet_transactions` (`order_id`) WHERE `order_id` IS NOT NULL',
    );
  }

  // ----- global_balances（全局余额，user_id PK） -----
  if (!(await db.schema.hasTable('global_balances'))) {
    await db.schema.createTable('global_balances', (table) => {
      table.string('user_id').primary();
      table.integer('balance').notNullable().defaultTo(0);
      table.integer('total_earned').notNullable().defaultTo(0);
      table.integer('total_spent').notNullable().defaultTo(0);
      table.integer('frozen_balance').notNullable().defaultTo(0);
      table.integer('total_withdrawn').notNullable().defaultTo(0);
      table.text('last_income_at').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
  }

  // ----- instance_points（实例点券，PK(user_id, server_id)） -----
  if (!(await db.schema.hasTable('instance_points'))) {
    await db.schema.createTable('instance_points', (table) => {
      table.string('user_id').notNullable();
      table.string('server_id').notNullable();
      table.integer('balance').notNullable().defaultTo(0);
      table.integer('total_earned').notNullable().defaultTo(0);
      table.integer('total_spent').notNullable().defaultTo(0);
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.primary(['user_id', 'server_id']);
    });
  }

  // ----- user_integrals（成长积分，PK(user_id, server_id)） -----
  if (!(await db.schema.hasTable('user_integrals'))) {
    await db.schema.createTable('user_integrals', (table) => {
      table.string('user_id').notNullable();
      table.string('server_id').notNullable();
      table.integer('total_integral').notNullable().defaultTo(0);
      table.integer('current_integral').notNullable().defaultTo(0);
      table.text('last_decay_at').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.primary(['user_id', 'server_id']);
    });
  }

  // ----- user_vip_status（VIP 状态，PK(user_id, server_id)） -----
  if (!(await db.schema.hasTable('user_vip_status'))) {
    await db.schema.createTable('user_vip_status', (table) => {
      table.string('user_id').notNullable();
      table.string('server_id').notNullable();
      table.string('vip_type').nullable();
      table.text('vip_expires_at').nullable();
      table.text('purchased_at').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
      table.primary(['user_id', 'server_id']);
    });
  }

  // ----- instance_pricing（实例定价，server_id PK） -----
  if (!(await db.schema.hasTable('instance_pricing'))) {
    await db.schema.createTable('instance_pricing', (table) => {
      table.string('server_id').primary();
      table.integer('vip_monthly_price').nullable();
      table.integer('vip_lifetime_price').nullable();
      table.float('points_exchange_ratio').notNullable().defaultTo(1.0);
      table.float('integral_ratio').notNullable().defaultTo(1.0);
      table.integer('daily_consumption_limit').nullable();
      table.text('created_at').notNullable();
      table.text('updated_at').notNullable();
    });
  }

  // ----- withdraw_codes（提现码，code UNIQUE） -----
  if (!(await db.schema.hasTable('withdraw_codes'))) {
    await db.schema.createTable('withdraw_codes', (table) => {
      table.increments('id').primary();
      table.string('code').notNullable().unique();
      table.string('user_id').notNullable();
      table.integer('amount').notNullable();
      table.integer('actual_amount').notNullable();
      table.float('ratio').notNullable();
      table.string('status').notNullable().defaultTo('pending');
      table.string('operator_user_id').nullable();
      table.text('approved_at').nullable();
      table.text('expires_at').notNullable();
      table.text('created_at').notNullable();
    });
  }

  // ----- system_config（平台配置，key PK） -----
  if (!(await db.schema.hasTable('system_config'))) {
    await db.schema.createTable('system_config', (table) => {
      table.string('key').primary();
      table.string('value').notNullable();
      table.string('description').nullable();
      table.text('updated_at').notNullable();
    });
  }

  // ----- vip_permissions（VIP 权益模板，vip_level UNIQUE） -----
  if (!(await db.schema.hasTable('vip_permissions'))) {
    await db.schema.createTable('vip_permissions', (table) => {
      table.increments('id').primary();
      table.integer('vip_level').notNullable().unique();
      table.string('display_name').notNullable();
      table.text('permissions').defaultTo('[]');
      table.string('max_quality').notNullable().defaultTo('normal');
      table.integer('daily_limit').nullable();
      table.integer('daily_reward_amount').notNullable().defaultTo(0);
    });
  }

  // ----- cdk_codes（基线 + v5 经济扩展列，code UNIQUE） -----
  if (!(await db.schema.hasTable('cdk_codes'))) {
    await db.schema.createTable('cdk_codes', (table) => {
      table.increments('id').primary();
      table.string('server_id').notNullable();
      table.string('code').notNullable().unique();
      table.string('item_name').notNullable();
      table.integer('count').notNullable();
      table.string('quality').notNullable().defaultTo('normal');
      table.string('status').notNullable().defaultTo('unused');
      table.string('claimed_player').nullable();
      table.text('claimed_at').nullable();
      table.text('claiming_at').nullable();
      table.text('expires_at').notNullable();
      table.string('created_by').notNullable();
      table.text('created_at').notNullable();
      table.string('gift_name').nullable();
      table.string('gift_description').nullable();
      // v5 经济系统扩展列（migration 20260727000006）
      table.string('type').notNullable().defaultTo('item');
      table.integer('amount').nullable();
      table.string('vip_duration').nullable();
      table.string('creator_user_id').nullable();
      table.text('refunded_at').nullable();
      table.integer('refund_tx_id').nullable();
      // v4.37.0 可重复使用扩展列（migration 20260901000000）
      table.integer('max_uses').notNullable().defaultTo(1);
      table.integer('use_count').notNullable().defaultTo(0);
    });
  }

  // ----- cdk_code_items（礼包子表） -----
  if (!(await db.schema.hasTable('cdk_code_items'))) {
    await db.schema.createTable('cdk_code_items', (table) => {
      table.increments('id').primary();
      table.integer('cdk_code_id').notNullable();
      table.string('item_name').notNullable();
      table.integer('count').notNullable();
      table.string('quality').notNullable().defaultTo('normal');
      table.integer('sort_order').notNullable().defaultTo(0);
    });
  }

  // ----- cdk_redemptions（v4.37.0 多次用 CDK 兑换记录子表） -----
  if (!(await db.schema.hasTable('cdk_redemptions'))) {
    await db.schema.createTable('cdk_redemptions', (table) => {
      table.increments('id').primary();
      table.integer('cdk_code_id').notNullable();
      table.string('player_name', 255).notNullable();
      table.text('redeemed_at').notNullable();
      table.unique(['cdk_code_id', 'player_name']);
    });
  }

  // ----- shop_orders（商店订单，claim_code UNIQUE） -----
  if (!(await db.schema.hasTable('shop_orders'))) {
    await db.schema.createTable('shop_orders', (table) => {
      table.increments('id').primary();
      table.string('server_id').notNullable();
      table.string('user_id').notNullable();
      table.string('status').notNullable().defaultTo('pending');
      table.string('claim_code').notNullable().unique();
      table.integer('items_count').notNullable();
      table.integer('total_price').notNullable().defaultTo(0);
      table.text('claimed_at').nullable();
      table.text('claiming_at').nullable();
      table.text('expires_at').notNullable();
      table.string('claimed_player').nullable();
      table.text('created_at').notNullable();
    });
  }

  // ----- shop_order_items（订单明细，含 price 快照） -----
  if (!(await db.schema.hasTable('shop_order_items'))) {
    await db.schema.createTable('shop_order_items', (table) => {
      table.increments('id').primary();
      table.integer('order_id').notNullable();
      table.string('item_name').notNullable();
      table.integer('count').notNullable();
      table.string('quality').notNullable().defaultTo('normal');
      table.integer('price').notNullable().defaultTo(0);
    });
  }
}

/**
 * 销毁测试数据库实例，释放 :memory: 连接。
 */
export async function destroyTestDb(db: Knex): Promise<void> {
  await db.destroy();
}
