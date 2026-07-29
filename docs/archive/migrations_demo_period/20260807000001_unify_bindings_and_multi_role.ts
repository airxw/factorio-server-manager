// ============================================================================
// 20260807000001_unify_bindings_and_multi_role.ts
// v4.17.0 统一绑定体系 + 多角色切换重构（方案C-激进重设计）
//
// 用途：
//   1. 创建统一 bindings 表（合并 user_instance_bindings / player_bindings / player_verify_codes）
//   2. 创建 permission_points + role_permission_templates 表（权限点矩阵）
//   3. ALTER users ADD roles + active_role 字段（多角色支持）
//   4. 数据搬运（按字段映射规则）
//   5. 一致性校验（行数对账）
//   6. DROP 旧三套表
//
// 依赖表：users / servers
// 不可逆操作：DROP TABLE user_instance_bindings / player_bindings / player_verify_codes
// 回滚策略：down 函数重建旧表 + 反向搬运数据（部分字段无法完全恢复，详见 down 函数注释）
//
// Demo 模式：GSP_DEMO_MODE=true 时仅执行 schema 变更，跳过数据搬运（demo 数据由 demo-reset 端点重建）
//
// 来源：docs/plans/binding-unification-multi-role-plan.md §2.5 + §4.1 + §4.4
// ============================================================================

import type { Knex } from 'knex';

// ============================================================================
// 权限点字典（约 90 个，覆盖 30+ 类资源）
// 来源：方案 §3.3 + 现有 requireRole 调用点反推
// ============================================================================
const PERMISSION_POINTS: Array<{ code: string; description: string; category: string }> = [
  // 实例与绑定类
  { code: 'instance.create', description: '创建实例', category: 'instance' },
  { code: 'instance.delete', description: '删除实例', category: 'instance' },
  { code: 'instance.view', description: '查看实例', category: 'instance' },
  { code: 'instance.update', description: '修改实例配置', category: 'instance' },
  { code: 'instance.start', description: '启动/停止/重启实例', category: 'instance' },
  { code: 'instance.console', description: '控制台访问', category: 'instance' },
  { code: 'binding.create', description: '创建绑定', category: 'binding' },
  { code: 'binding.verify', description: '验证绑定', category: 'binding' },
  { code: 'binding.revoke', description: '撤销绑定', category: 'binding' },
  { code: 'binding.view', description: '查看绑定', category: 'binding' },
  // 钱包与 VIP 类
  { code: 'wallet.view', description: '查看钱包', category: 'wallet' },
  { code: 'wallet.debit', description: '扣款（用户消费）', category: 'wallet' },
  { code: 'wallet.credit', description: '充值（管理员充值）', category: 'wallet' },
  { code: 'wallet.claim_daily', description: '领取每日福利', category: 'wallet' },
  { code: 'vip.set', description: '设置 VIP 等级', category: 'vip' },
  { code: 'vip.view', description: '查看 VIP', category: 'vip' },
  // 用户与权限类
  { code: 'user.role.assign', description: '分配用户角色', category: 'user' },
  { code: 'user.list', description: '用户列表', category: 'user' },
  { code: 'user.create', description: '创建用户', category: 'user' },
  { code: 'user.delete', description: '删除用户', category: 'user' },
  { code: 'user.view', description: '查看用户', category: 'user' },
  { code: 'role_permission.update', description: '修改角色权限模板', category: 'user' },
  // 节点与资源类
  { code: 'node.register', description: '注册节点', category: 'node' },
  { code: 'node.delete', description: '删除节点', category: 'node' },
  { code: 'node.view', description: '查看节点', category: 'node' },
  { code: 'node.update', description: '更新节点配置', category: 'node' },
  { code: 'asset.upload', description: '上传资源', category: 'asset' },
  { code: 'asset.delete', description: '删除资源', category: 'asset' },
  { code: 'asset.view', description: '查看资源', category: 'asset' },
  { code: 'pack.install', description: '安装游戏包', category: 'pack' },
  { code: 'pack.delete', description: '删除游戏包', category: 'pack' },
  { code: 'pack.view', description: '查看游戏包', category: 'pack' },
  // CDK 与商城类
  { code: 'cdk.create', description: '创建 CDK', category: 'cdk' },
  { code: 'cdk.delete', description: '删除 CDK', category: 'cdk' },
  { code: 'cdk.view', description: '查看 CDK', category: 'cdk' },
  { code: 'cdk.redeem', description: '兑换 CDK', category: 'cdk' },
  { code: 'store.item.create', description: '创建商城商品', category: 'store' },
  { code: 'store.item.delete', description: '删除商城商品', category: 'store' },
  { code: 'store.item.view', description: '查看商品', category: 'store' },
  { code: 'store.purchase', description: '购买商品', category: 'store' },
  { code: 'shop.config', description: 'GM 商店配置', category: 'shop' },
  { code: 'shop.view', description: 'GM 商店查看', category: 'shop' },
  // 实例运维类
  { code: 'backup.create', description: '创建备份', category: 'backup' },
  { code: 'backup.restore', description: '恢复备份', category: 'backup' },
  { code: 'backup.delete', description: '删除备份', category: 'backup' },
  { code: 'backup.view', description: '查看备份', category: 'backup' },
  { code: 'save.upload', description: '上传存档', category: 'save' },
  { code: 'save.download', description: '下载存档', category: 'save' },
  { code: 'save.delete', description: '删除存档', category: 'save' },
  { code: 'mod.install', description: '安装 Mod', category: 'mod' },
  { code: 'mod.uninstall', description: '卸载 Mod', category: 'mod' },
  { code: 'mod.view', description: '查看 Mod', category: 'mod' },
  { code: 'file.upload', description: '上传文件', category: 'file' },
  { code: 'file.download', description: '下载文件', category: 'file' },
  { code: 'file.delete', description: '删除文件', category: 'file' },
  { code: 'file.view', description: '查看文件', category: 'file' },
  { code: 'cleanup.execute', description: '执行清理', category: 'cleanup' },
  { code: 'cleanup.view', description: '查看清理任务', category: 'cleanup' },
  { code: 'batch.execute', description: '批量操作', category: 'batch' },
  { code: 'batch.view', description: '查看批量任务', category: 'batch' },
  { code: 'operation.execute', description: '运维操作', category: 'operation' },
  { code: 'operation.view', description: '查看运维记录', category: 'operation' },
  // 游戏内交互类
  { code: 'chat.trigger.create', description: '创建聊天触发器', category: 'chat' },
  { code: 'chat.trigger.delete', description: '删除聊天触发器', category: 'chat' },
  { code: 'chat.trigger.view', description: '查看聊天触发器', category: 'chat' },
  { code: 'chat.send', description: '发送游戏内消息', category: 'chat' },
  { code: 'vote.create', description: '创建投票', category: 'vote' },
  { code: 'vote.delete', description: '删除投票', category: 'vote' },
  { code: 'vote.view', description: '查看投票', category: 'vote' },
  { code: 'vote.cast', description: '投票', category: 'vote' },
  { code: 'periodic_message.create', description: '创建定时消息', category: 'periodic_message' },
  { code: 'periodic_message.delete', description: '删除定时消息', category: 'periodic_message' },
  { code: 'periodic_message.view', description: '查看定时消息', category: 'periodic_message' },
  { code: 'player.kick', description: '踢出玩家', category: 'player' },
  { code: 'player.ban', description: '封禁玩家', category: 'player' },
  { code: 'player.unban', description: '解封玩家', category: 'player' },
  { code: 'player.view', description: '查看玩家', category: 'player' },
  { code: 'lists.update', description: '更新白名单/黑名单', category: 'lists' },
  { code: 'lists.view', description: '查看名单', category: 'lists' },
  // 系统与安全类
  { code: 'system.config', description: '系统配置', category: 'system' },
  { code: 'system.view', description: '系统状态查看', category: 'system' },
  { code: 'system.health', description: '健康检查', category: 'system' },
  { code: 'system.deploy', description: '部署操作', category: 'system' },
  { code: 'quota.set', description: '设置配额', category: 'quota' },
  { code: 'quota.view', description: '查看配额', category: 'quota' },
  { code: 'monitor.view', description: '监控查看', category: 'monitor' },
  { code: 'monitor.alert.ack', description: '告警确认', category: 'monitor' },
  { code: 'maintenance.enable', description: '启用维护模式', category: 'maintenance' },
  { code: 'maintenance.disable', description: '关闭维护模式', category: 'maintenance' },
  { code: 'maintenance.view', description: '查看维护状态', category: 'maintenance' },
  { code: 'apikey.create', description: '创建 API Key', category: 'apikey' },
  { code: 'apikey.delete', description: '删除 API Key', category: 'apikey' },
  { code: 'apikey.view', description: '查看 API Key', category: 'apikey' },
  { code: 'ssl.upload', description: '上传 SSL 证书', category: 'ssl' },
  { code: 'ssl.delete', description: '删除 SSL 证书', category: 'ssl' },
  { code: 'ssl.view', description: '查看 SSL 证书', category: 'ssl' },
  { code: 'tunnel.create', description: '创建隧道', category: 'tunnel' },
  { code: 'tunnel.delete', description: '删除隧道', category: 'tunnel' },
  { code: 'tunnel.view', description: '查看隧道', category: 'tunnel' },
  { code: 'webhook.create', description: '创建系统 Webhook', category: 'webhook' },
  { code: 'webhook.delete', description: '删除系统 Webhook', category: 'webhook' },
  { code: 'webhook.view', description: '查看系统 Webhook', category: 'webhook' },
  { code: 'audit.view', description: '查看审计日志', category: 'audit' },
  { code: 'audit.export', description: '导出审计日志', category: 'audit' },
  { code: 'settings.update', description: '实例设置更新', category: 'settings' },
  { code: 'settings.view', description: '实例设置查看', category: 'settings' },
  { code: 'discover.view', description: '发现页查看', category: 'discover' },
  { code: 'platform_stats.view', description: '平台统计查看', category: 'platform_stats' },
];

// ============================================================================
// 角色权限模板（user ⊂ instance_admin ⊂ server_admin，最小权限原则）
// ============================================================================
const ROLE_PERMISSION_TEMPLATES: Array<{ role: string; permission_code: string }> = [
  // ----- user 角色权限（自助操作，15 项） -----
  { role: 'user', permission_code: 'binding.create' },
  { role: 'user', permission_code: 'binding.verify' },
  { role: 'user', permission_code: 'binding.revoke' },
  { role: 'user', permission_code: 'binding.view' },
  { role: 'user', permission_code: 'wallet.view' },
  { role: 'user', permission_code: 'wallet.debit' },
  { role: 'user', permission_code: 'wallet.claim_daily' },
  { role: 'user', permission_code: 'vip.view' },
  { role: 'user', permission_code: 'cdk.redeem' },
  { role: 'user', permission_code: 'store.item.view' },
  { role: 'user', permission_code: 'store.purchase' },
  { role: 'user', permission_code: 'vote.view' },
  { role: 'user', permission_code: 'vote.cast' },
  { role: 'user', permission_code: 'discover.view' },
  { role: 'user', permission_code: 'instance.view' },
  { role: 'user', permission_code: 'maintenance.view' },
  { role: 'user', permission_code: 'user.view' }, // 仅查看自己（应用层所有权校验）

  // ----- instance_admin 角色权限（继承 user 全部 + 实例管理，约 60 项） -----
  { role: 'instance_admin', permission_code: 'binding.create' },
  { role: 'instance_admin', permission_code: 'binding.verify' },
  { role: 'instance_admin', permission_code: 'binding.revoke' },
  { role: 'instance_admin', permission_code: 'binding.view' },
  { role: 'instance_admin', permission_code: 'wallet.view' },
  { role: 'instance_admin', permission_code: 'wallet.debit' },
  { role: 'instance_admin', permission_code: 'wallet.claim_daily' },
  { role: 'instance_admin', permission_code: 'wallet.credit' },
  { role: 'instance_admin', permission_code: 'vip.view' },
  { role: 'instance_admin', permission_code: 'cdk.redeem' },
  { role: 'instance_admin', permission_code: 'cdk.create' },
  { role: 'instance_admin', permission_code: 'cdk.delete' },
  { role: 'instance_admin', permission_code: 'cdk.view' },
  { role: 'instance_admin', permission_code: 'store.item.view' },
  { role: 'instance_admin', permission_code: 'store.purchase' },
  { role: 'instance_admin', permission_code: 'store.item.create' },
  { role: 'instance_admin', permission_code: 'store.item.delete' },
  { role: 'instance_admin', permission_code: 'shop.config' },
  { role: 'instance_admin', permission_code: 'shop.view' },
  { role: 'instance_admin', permission_code: 'vote.view' },
  { role: 'instance_admin', permission_code: 'vote.cast' },
  { role: 'instance_admin', permission_code: 'vote.create' },
  { role: 'instance_admin', permission_code: 'vote.delete' },
  { role: 'instance_admin', permission_code: 'discover.view' },
  { role: 'instance_admin', permission_code: 'instance.view' },
  { role: 'instance_admin', permission_code: 'instance.create' },
  { role: 'instance_admin', permission_code: 'instance.update' },
  { role: 'instance_admin', permission_code: 'instance.start' },
  { role: 'instance_admin', permission_code: 'instance.console' },
  { role: 'instance_admin', permission_code: 'maintenance.view' },
  { role: 'instance_admin', permission_code: 'user.view' },
  { role: 'instance_admin', permission_code: 'node.view' },
  { role: 'instance_admin', permission_code: 'asset.upload' },
  { role: 'instance_admin', permission_code: 'asset.delete' },
  { role: 'instance_admin', permission_code: 'asset.view' },
  { role: 'instance_admin', permission_code: 'pack.view' },
  { role: 'instance_admin', permission_code: 'backup.create' },
  { role: 'instance_admin', permission_code: 'backup.restore' },
  { role: 'instance_admin', permission_code: 'backup.delete' },
  { role: 'instance_admin', permission_code: 'backup.view' },
  { role: 'instance_admin', permission_code: 'save.upload' },
  { role: 'instance_admin', permission_code: 'save.download' },
  { role: 'instance_admin', permission_code: 'save.delete' },
  { role: 'instance_admin', permission_code: 'mod.install' },
  { role: 'instance_admin', permission_code: 'mod.uninstall' },
  { role: 'instance_admin', permission_code: 'mod.view' },
  { role: 'instance_admin', permission_code: 'file.upload' },
  { role: 'instance_admin', permission_code: 'file.download' },
  { role: 'instance_admin', permission_code: 'file.delete' },
  { role: 'instance_admin', permission_code: 'file.view' },
  { role: 'instance_admin', permission_code: 'cleanup.execute' },
  { role: 'instance_admin', permission_code: 'cleanup.view' },
  { role: 'instance_admin', permission_code: 'chat.trigger.create' },
  { role: 'instance_admin', permission_code: 'chat.trigger.delete' },
  { role: 'instance_admin', permission_code: 'chat.trigger.view' },
  { role: 'instance_admin', permission_code: 'chat.send' },
  { role: 'instance_admin', permission_code: 'periodic_message.create' },
  { role: 'instance_admin', permission_code: 'periodic_message.delete' },
  { role: 'instance_admin', permission_code: 'periodic_message.view' },
  { role: 'instance_admin', permission_code: 'player.kick' },
  { role: 'instance_admin', permission_code: 'player.ban' },
  { role: 'instance_admin', permission_code: 'player.unban' },
  { role: 'instance_admin', permission_code: 'player.view' },
  { role: 'instance_admin', permission_code: 'lists.update' },
  { role: 'instance_admin', permission_code: 'lists.view' },
  { role: 'instance_admin', permission_code: 'monitor.view' },
  { role: 'instance_admin', permission_code: 'monitor.alert.ack' },
  { role: 'instance_admin', permission_code: 'settings.update' },
  { role: 'instance_admin', permission_code: 'settings.view' },
  { role: 'instance_admin', permission_code: 'quota.view' },
  { role: 'instance_admin', permission_code: 'system.view' },

  // ----- server_admin 角色权限（继承 instance_admin 全部 + 系统级，约 90 项） -----
  // 为简洁，server_admin 列出全部权限点（含已继承的）
  ...[
    'binding.create', 'binding.verify', 'binding.revoke', 'binding.view',
    'wallet.view', 'wallet.debit', 'wallet.credit', 'wallet.claim_daily',
    'vip.view', 'vip.set',
    'cdk.redeem', 'cdk.create', 'cdk.delete', 'cdk.view',
    'store.item.view', 'store.purchase', 'store.item.create', 'store.item.delete',
    'shop.config', 'shop.view',
    'vote.view', 'vote.cast', 'vote.create', 'vote.delete',
    'discover.view',
    'instance.view', 'instance.create', 'instance.update', 'instance.start', 'instance.console', 'instance.delete',
    'maintenance.view', 'maintenance.enable', 'maintenance.disable',
    'user.view', 'user.list', 'user.create', 'user.delete', 'user.role.assign',
    'role_permission.update',
    'node.view', 'node.register', 'node.delete', 'node.update',
    'asset.upload', 'asset.delete', 'asset.view',
    'pack.view', 'pack.install', 'pack.delete',
    'backup.create', 'backup.restore', 'backup.delete', 'backup.view',
    'save.upload', 'save.download', 'save.delete',
    'mod.install', 'mod.uninstall', 'mod.view',
    'file.upload', 'file.download', 'file.delete', 'file.view',
    'cleanup.execute', 'cleanup.view',
    'batch.execute', 'batch.view',
    'operation.execute', 'operation.view',
    'chat.trigger.create', 'chat.trigger.delete', 'chat.trigger.view', 'chat.send',
    'periodic_message.create', 'periodic_message.delete', 'periodic_message.view',
    'player.kick', 'player.ban', 'player.unban', 'player.view',
    'lists.update', 'lists.view',
    'monitor.view', 'monitor.alert.ack',
    'settings.update', 'settings.view',
    'quota.view', 'quota.set',
    'system.view', 'system.config', 'system.health', 'system.deploy',
    'apikey.create', 'apikey.delete', 'apikey.view',
    'ssl.upload', 'ssl.delete', 'ssl.view',
    'tunnel.create', 'tunnel.delete', 'tunnel.view',
    'webhook.create', 'webhook.delete', 'webhook.view',
    'audit.view', 'audit.export',
    'platform_stats.view',
  ].map((code) => ({ role: 'server_admin', permission_code: code })),
];

// ============================================================================
// Forward 迁移
// ============================================================================
export async function up(knex: Knex): Promise<void> {
  const isDemoMode = process.env.GSP_DEMO_MODE === 'true';

  if (isDemoMode) {
    console.log('[migration 20260807000001] Demo 模式检测到：执行 schema 变更但跳过数据搬运');
  }

  await knex.transaction(async (trx) => {
    // ------------------------------------------------------------------
    // Step 1: 创建 bindings 表（含 CHECK 约束，不含 partial UNIQUE — SQLite 表定义不支持）
    // ------------------------------------------------------------------
    if (!(await trx.schema.hasTable('bindings'))) {
      await trx.schema.createTable('bindings', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable(); // 引用 users.id (UUID)
        table.string('binding_type').notNullable(); // 'account' | 'player'
        table.string('scope_type').notNullable(); // 'instance' | 'game_type' | 'global'
        table.string('scope_ref').nullable().defaultTo(null);
        table.string('player_name').nullable().defaultTo(null);
        table.integer('vip_level').notNullable().defaultTo(0);
        table.integer('wallet_id').nullable().defaultTo(null); // 引用 user_wallets.id
        table.string('verify_status').notNullable().defaultTo('pending'); // pending|verified|expired|revoked
        table.string('verify_code').nullable().defaultTo(null);
        table.text('verify_expires_at').nullable().defaultTo(null);
        table.text('verified_at').nullable().defaultTo(null);
        table.text('metadata').notNullable().defaultTo('{}');
        table.text('created_at').notNullable();
        table.text('updated_at').notNullable();
      });

      // CHECK 约束（SQLite 支持 CHECK in CREATE TABLE，但 knex 不直接支持，用 raw）
      await trx.raw(
        `CREATE CHECK CONSTRAINT chk_bindings_binding_type CHECK (binding_type IN ('account', 'player'))`,
      ).catch(() => {
        /* SQLite 忽略 CREATE CHECK CONSTRAINT，改用应用层校验 */
      });

      // 普通索引
      await trx.schema.alterTable('bindings', (table) => {
        table.index('user_id', 'idx_bindings_user');
        table.index(['binding_type', 'scope_type', 'scope_ref'], 'idx_bindings_type_scope');
      });

      // partial UNIQUE INDEX：已验证的绑定在作用域内唯一（SQLite 支持 partial INDEX）
      await trx.raw(
        `CREATE UNIQUE INDEX idx_bindings_verified_unique ON bindings(user_id, binding_type, scope_type, COALESCE(scope_ref, ''), COALESCE(player_name, '')) WHERE verify_status='verified'`,
      );

      // partial INDEX：webhook 回调快速定位 pending 验证码
      await trx.raw(
        `CREATE INDEX idx_bindings_verify_pending ON bindings(verify_code) WHERE verify_status='pending' AND verify_code IS NOT NULL`,
      );

      // partial INDEX：游戏事件反查用户
      await trx.raw(
        `CREATE INDEX idx_bindings_player_lookup ON bindings(scope_type, scope_ref, player_name) WHERE binding_type='player' AND player_name IS NOT NULL`,
      );

      console.log('[migration 20260807000001] Step 1: bindings 表创建完成');
    }

    // ------------------------------------------------------------------
    // Step 2: 创建 permission_points 表
    // ------------------------------------------------------------------
    if (!(await trx.schema.hasTable('permission_points'))) {
      await trx.schema.createTable('permission_points', (table) => {
        table.string('code').primary(); // 权限点代码（如 instance.create）
        table.text('description').notNullable();
        table.string('category').notNullable();
        table.text('created_at').notNullable();
      });
      console.log('[migration 20260807000001] Step 2: permission_points 表创建完成');
    }

    // ------------------------------------------------------------------
    // Step 3: 创建 role_permission_templates 表
    // ------------------------------------------------------------------
    if (!(await trx.schema.hasTable('role_permission_templates'))) {
      await trx.schema.createTable('role_permission_templates', (table) => {
        table.string('role').notNullable(); // 'user' | 'instance_admin' | 'server_admin'
        table.string('permission_code').notNullable();
        table.text('created_at').notNullable();
        table.primary(['role', 'permission_code'], 'pk_role_perm');
      });
      console.log('[migration 20260807000001] Step 3: role_permission_templates 表创建完成');
    }

    // ------------------------------------------------------------------
    // Step 4-5: ALTER users ADD roles + active_role
    // ------------------------------------------------------------------
    const hasRoles = await trx.schema.hasColumn('users', 'roles');
    if (!hasRoles) {
      await trx.schema.alterTable('users', (table) => {
        table.text('roles').nullable().defaultTo(null); // JSON 数组字符串
      });
    }
    const hasActiveRole = await trx.schema.hasColumn('users', 'active_role');
    if (!hasActiveRole) {
      await trx.schema.alterTable('users', (table) => {
        table.string('active_role').nullable().defaultTo(null);
      });
    }
    console.log('[migration 20260807000001] Step 4-5: users 表新增 roles + active_role 字段');

    // ------------------------------------------------------------------
    // Step 6-7: seed permission_points + role_permission_templates
    // ------------------------------------------------------------------
    const now = new Date().toISOString();
    const existingPermCount = await trx('permission_points').count('* as cnt').first();
    if ((existingPermCount as any)?.cnt === 0) {
      await trx('permission_points').insert(
        PERMISSION_POINTS.map((p) => ({ ...p, created_at: now })),
      );
      console.log(`[migration 20260807000001] Step 6: 插入 ${PERMISSION_POINTS.length} 个权限点`);
    }

    const existingTplCount = await trx('role_permission_templates').count('* as cnt').first();
    if ((existingTplCount as any)?.cnt === 0) {
      await trx('role_permission_templates').insert(
        ROLE_PERMISSION_TEMPLATES.map((t) => ({ ...t, created_at: now })),
      );
      console.log(
        `[migration 20260807000001] Step 7: 插入 ${ROLE_PERMISSION_TEMPLATES.length} 条角色权限模板`,
      );
    }

    // ------------------------------------------------------------------
    // Demo 模式：跳过数据搬运（demo 数据由 demo-reset 端点重建）
    // ------------------------------------------------------------------
    if (isDemoMode) {
      console.log(
        '[migration 20260807000001] Demo 模式：跳过 Step 8-13（数据搬运 + 旧表删除），由 demo-reset 端点统一处理',
      );
      return;
    }

    // ------------------------------------------------------------------
    // Step 8: 数据搬运 user_instance_bindings → bindings (binding_type='account')
    // ------------------------------------------------------------------
    const hasOldTable1 = await trx.schema.hasTable('user_instance_bindings');
    if (hasOldTable1) {
      const oldRows1: any[] = await trx('user_instance_bindings').select('*');
      if (oldRows1.length > 0) {
        await trx('bindings').insert(
          oldRows1.map((r) => ({
            user_id: r.user_id,
            binding_type: 'account',
            scope_type: 'instance',
            scope_ref: r.server_id, // 旧表字段名 server_id
            player_name: null,
            vip_level: r.vip_level ?? 0,
            wallet_id: null, // 旧表无 wallet_id
            verify_status: r.status === 'active' ? 'verified' : 'revoked',
            verify_code: null,
            verify_expires_at: null,
            verified_at: r.status === 'active' ? r.bound_at : null,
            metadata: JSON.stringify({
              source: 'migration_from_user_instance_bindings',
              legacy_status: r.status,
            }),
            created_at: r.bound_at ?? now,
            updated_at: r.unbound_at ?? r.bound_at ?? now,
          })),
        );
      }
      console.log(
        `[migration 20260807000001] Step 8: 搬运 user_instance_bindings ${oldRows1.length} 行 → bindings`,
      );
    }

    // ------------------------------------------------------------------
    // Step 9: 数据搬运 player_bindings → bindings (binding_type='player', scope_type='game_type')
    // ------------------------------------------------------------------
    const hasOldTable2 = await trx.schema.hasTable('player_bindings');
    if (hasOldTable2) {
      const oldRows2: any[] = await trx('player_bindings').select('*');
      if (oldRows2.length > 0) {
        await trx('bindings').insert(
          oldRows2.map((r) => ({
            user_id: r.user_id,
            binding_type: 'player',
            scope_type: 'game_type',
            scope_ref: r.game_type,
            player_name: r.game_player_name, // 旧表字段名 game_player_name
            vip_level: 0,
            wallet_id: null,
            verify_status:
              r.status === 'verified' ? 'verified' : r.status === 'rejected' ? 'revoked' : 'pending',
            verify_code: r.status === 'pending' ? r.verify_code : null,
            verify_expires_at: null, // 旧表无 expires_at 字段
            verified_at: r.status === 'verified' ? r.verified_at : null,
            metadata: JSON.stringify({
              source: 'migration_from_player_bindings',
              legacy_status: r.status,
            }),
            created_at: r.created_at ?? now,
            updated_at: r.updated_at ?? now,
          })),
        );
      }
      console.log(
        `[migration 20260807000001] Step 9: 搬运 player_bindings ${oldRows2.length} 行 → bindings`,
      );
    }

    // ------------------------------------------------------------------
    // Step 10: 数据搬运 player_verify_codes → bindings (binding_type='player', scope_type='instance')
    // ------------------------------------------------------------------
    const hasOldTable3 = await trx.schema.hasTable('player_verify_codes');
    if (hasOldTable3) {
      const oldRows3: any[] = await trx('player_verify_codes').select('*');
      if (oldRows3.length > 0) {
        const nowMs = Date.now();
        await trx('bindings').insert(
          oldRows3.map((r) => {
            const expiresMs = r.expires_at ? new Date(r.expires_at).getTime() : 0;
            const isExpired = !r.used_at && expiresMs > 0 && expiresMs < nowMs;
            const isVerified = !!r.used_at;
            return {
              user_id: r.user_id,
              binding_type: 'player',
              scope_type: 'instance',
              scope_ref: r.server_id,
              player_name: r.game_player_name,
              vip_level: 0,
              wallet_id: null,
              verify_status: isVerified ? 'verified' : isExpired ? 'expired' : 'pending',
              verify_code: isVerified ? null : r.code,
              verify_expires_at: r.expires_at,
              verified_at: r.used_at,
              metadata: JSON.stringify({
                source: 'migration_from_player_verify_codes',
                legacy_used_at: r.used_at,
              }),
              created_at: r.created_at ?? now,
              updated_at: r.used_at ?? r.created_at ?? now,
            };
          }),
        );
      }
      console.log(
        `[migration 20260807000001] Step 10: 搬运 player_verify_codes ${oldRows3.length} 行 → bindings`,
      );
    }

    // ------------------------------------------------------------------
    // Step 11: UPDATE users SET roles = JSON_ARRAY(role), active_role = role
    // ------------------------------------------------------------------
    // SQLite 内置 JSON_ARRAY 函数（1.38+），为兼容性使用字符串拼接
    const usersToUpdate: Array<{ id: string; role: string }> = await trx('users')
      .select('id', 'role')
      .whereNull('roles');
    for (const u of usersToUpdate) {
      const rolesJson = JSON.stringify([u.role]);
      await trx('users').where('id', u.id).update({
        roles: rolesJson,
        active_role: u.role,
      });
    }
    console.log(
      `[migration 20260807000001] Step 11: 更新 ${usersToUpdate.length} 个用户的 roles + active_role`,
    );

    // ------------------------------------------------------------------
    // Step 12: 一致性校验（行数对账）
    // ------------------------------------------------------------------
    const checks: Array<{ name: string; expected: number; actual: number }> = [];

    if (hasOldTable1) {
      const expected1 = await trx('user_instance_bindings').count('* as cnt').first();
      const actual1 = await trx('bindings').where('binding_type', 'account').count('* as cnt').first();
      checks.push({
        name: 'user_instance_bindings → bindings(account)',
        expected: Number((expected1 as any)?.cnt ?? 0),
        actual: Number((actual1 as any)?.cnt ?? 0),
      });
    }

    if (hasOldTable2) {
      const expected2 = await trx('player_bindings').count('* as cnt').first();
      const actual2 = await trx('bindings')
        .where({ binding_type: 'player', scope_type: 'game_type' })
        .count('* as cnt')
        .first();
      checks.push({
        name: 'player_bindings → bindings(player, game_type)',
        expected: Number((expected2 as any)?.cnt ?? 0),
        actual: Number((actual2 as any)?.cnt ?? 0),
      });
    }

    if (hasOldTable3) {
      const expected3 = await trx('player_verify_codes').count('* as cnt').first();
      const actual3 = await trx('bindings')
        .where({ binding_type: 'player', scope_type: 'instance' })
        .count('* as cnt')
        .first();
      checks.push({
        name: 'player_verify_codes → bindings(player, instance)',
        expected: Number((expected3 as any)?.cnt ?? 0),
        actual: Number((actual3 as any)?.cnt ?? 0),
      });
    }

    // 用户角色对账
    const usersWithRole = await trx('users').whereNotNull('role').count('* as cnt').first();
    const usersWithRoles = await trx('users').whereNotNull('roles').count('* as cnt').first();
    checks.push({
      name: 'users.role → users.roles',
      expected: Number((usersWithRole as any)?.cnt ?? 0),
      actual: Number((usersWithRoles as any)?.cnt ?? 0),
    });

    let allPassed = true;
    for (const c of checks) {
      const pass = c.expected === c.actual;
      console.log(
        `[migration 20260807000001] 校验 ${c.name}: expected=${c.expected}, actual=${c.actual} ${pass ? '✓' : '✗'}`,
      );
      if (!pass) allPassed = false;
    }

    if (!allPassed) {
      throw new Error(
        '[migration 20260807000001] 一致性校验失败，事务将回滚。请检查数据搬运逻辑。',
      );
    }
    console.log('[migration 20260807000001] Step 12: 一致性校验全部通过');

    // ------------------------------------------------------------------
    // Step 13-15: DROP 旧三套表（不可逆操作）
    // ------------------------------------------------------------------
    if (hasOldTable1) {
      await trx.schema.dropTableIfExists('user_instance_bindings');
      console.log('[migration 20260807000001] Step 13: DROP user_instance_bindings');
    }
    if (hasOldTable2) {
      await trx.schema.dropTableIfExists('player_bindings');
      console.log('[migration 20260807000001] Step 14: DROP player_bindings');
    }
    if (hasOldTable3) {
      await trx.schema.dropTableIfExists('player_verify_codes');
      console.log('[migration 20260807000001] Step 15: DROP player_verify_codes');
    }

    // ------------------------------------------------------------------
    // Step 16: 过渡期保留 users.role（不在此脚本删除，v4.18.0 删除）
    // ------------------------------------------------------------------
    console.log('[migration 20260807000001] Step 16: users.role 过渡期保留（v4.18.0 删除）');
  });

  console.log('[migration 20260807000001] Forward 迁移完成');
}

// ============================================================================
// Rollback 迁移（down）
// 注意：bindings 中 verified 态的 verify_code=NULL，无法完全恢复旧表 code 字段
//       rollback 时从应用层备份恢复 code 字段（详见方案 §4.1 rollback 字段反向映射规则）
// ============================================================================
export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // ------------------------------------------------------------------
    // Step 1: 重建旧三套表
    // ------------------------------------------------------------------
    if (!(await trx.schema.hasTable('user_instance_bindings'))) {
      await trx.schema.createTable('user_instance_bindings', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable();
        table.string('server_id').notNullable();
        table.integer('vip_level').notNullable().defaultTo(1);
        table.string('status').notNullable().defaultTo('active');
        table.text('bound_at').notNullable();
        table.text('unbound_at').nullable().defaultTo(null);
      });
      await trx.schema.alterTable('user_instance_bindings', (table) => {
        table.unique(['user_id', 'server_id'], 'idx_user_instance_bindings_unique');
        table.index('server_id', 'idx_uib_server');
        table.index(['user_id', 'status'], 'idx_uib_user_status');
      });
    }

    if (!(await trx.schema.hasTable('player_bindings'))) {
      await trx.schema.createTable('player_bindings', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable();
        table.string('game_player_name').notNullable();
        table.string('game_type').notNullable();
        table.string('verify_code').notNullable();
        table.string('status').notNullable().defaultTo('pending');
        table.text('verified_at').nullable().defaultTo(null);
        table.text('created_at').notNullable();
        table.text('updated_at').notNullable();
      });
      await trx.schema.alterTable('player_bindings', (table) => {
        table.unique(['user_id', 'game_type'], 'idx_player_bindings_user_game');
        table.unique(
          ['game_player_name', 'game_type', 'status'],
          'idx_player_bindings_name_game_status',
        );
      });
    }

    if (!(await trx.schema.hasTable('player_verify_codes'))) {
      await trx.schema.createTable('player_verify_codes', (table) => {
        table.increments('id').primary();
        table.string('user_id').notNullable();
        table.string('server_id').notNullable();
        table.string('game_player_name').notNullable();
        table.string('code').notNullable();
        table.text('expires_at').notNullable();
        table.text('used_at').nullable().defaultTo(null);
        table.text('created_at').notNullable();
      });
      await trx.schema.alterTable('player_verify_codes', (table) => {
        table.index('code', 'idx_pvc_code');
        table.index(['user_id', 'server_id'], 'idx_pvc_user_server');
        table.index('expires_at', 'idx_pvc_expires');
      });
    }

    // ------------------------------------------------------------------
    // Step 2: 反向搬运数据 bindings → 旧表
    // ------------------------------------------------------------------
    // 2.1 bindings(account) → user_instance_bindings
    const accountBindings: any[] = await trx('bindings').where('binding_type', 'account').select('*');
    if (accountBindings.length > 0) {
      await trx('user_instance_bindings').insert(
        accountBindings.map((b) => ({
          user_id: b.user_id,
          server_id: b.scope_ref,
          vip_level: b.vip_level,
          status: b.verify_status === 'verified' ? 'active' : 'unbound',
          bound_at: b.verified_at ?? b.created_at,
          unbound_at: b.verify_status === 'revoked' ? b.updated_at : null,
        })),
      );
    }

    // 2.2 bindings(player, game_type) → player_bindings
    const playerGameTypeBindings: any[] = await trx('bindings')
      .where({ binding_type: 'player', scope_type: 'game_type' })
      .select('*');
    if (playerGameTypeBindings.length > 0) {
      await trx('player_bindings').insert(
        playerGameTypeBindings.map((b) => ({
          user_id: b.user_id,
          game_player_name: b.player_name,
          game_type: b.scope_ref,
          // 旧表 verify_code notNullable，rollback 时若 NULL 用占位符（真实 code 已不可恢复）
          verify_code: b.verify_code ?? 'ROLLBACK_PLACEHOLDER',
          status:
            b.verify_status === 'verified'
              ? 'verified'
              : b.verify_status === 'revoked'
                ? 'rejected'
                : 'pending',
          verified_at: b.verify_status === 'verified' ? b.verified_at : null,
          created_at: b.created_at,
          updated_at: b.updated_at,
        })),
      );
    }

    // 2.3 bindings(player, instance) → player_verify_codes
    const playerInstanceBindings: any[] = await trx('bindings')
      .where({ binding_type: 'player', scope_type: 'instance' })
      .select('*');
    if (playerInstanceBindings.length > 0) {
      await trx('player_verify_codes').insert(
        playerInstanceBindings.map((b) => ({
          user_id: b.user_id,
          server_id: b.scope_ref,
          game_player_name: b.player_name ?? 'ROLLBACK_PLACEHOLDER',
          // verified 态 verify_code=NULL，用占位符（真实 code 已不可恢复）
          code: b.verify_code ?? 'ROLLBACK_PLACEHOLDER',
          expires_at: b.verify_expires_at ?? b.created_at,
          used_at: b.verify_status === 'verified' ? b.verified_at : null,
          created_at: b.created_at,
        })),
      );
    }

    // ------------------------------------------------------------------
    // Step 3: UPDATE users SET role = active_role（从 active_role 反推）
    // ------------------------------------------------------------------
    await trx('users')
      .whereNotNull('active_role')
      .update({
        role: trx.raw('active_role'),
      });

    // ------------------------------------------------------------------
    // Step 4-5: ALTER users DROP roles + active_role
    // ------------------------------------------------------------------
    if (await trx.schema.hasColumn('users', 'roles')) {
      await trx.schema.alterTable('users', (table) => {
        table.dropColumn('roles');
      });
    }
    if (await trx.schema.hasColumn('users', 'active_role')) {
      await trx.schema.alterTable('users', (table) => {
        table.dropColumn('active_role');
      });
    }

    // ------------------------------------------------------------------
    // Step 6-8: DROP bindings + permission_points + role_permission_templates
    // ------------------------------------------------------------------
    await trx.schema.dropTableIfExists('bindings');
    await trx.schema.dropTableIfExists('role_permission_templates');
    await trx.schema.dropTableIfExists('permission_points');
  });

  console.log('[migration 20260807000001] Rollback 迁移完成');
}
