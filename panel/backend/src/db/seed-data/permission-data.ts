// ============================================================================
// permission-data.ts
// v4.19.0: 权限点字典 + 角色权限模板（系统运行必需的字典数据）
//
// 来源：v4.17.0 migration 20260807000001_unify_bindings_and_multi_role.ts
// 提取原因：baseline 脚本需要 seed 这些字典数据，但归档后的 migration 文件
// 不在 TypeScript 编译路径上。提取到独立文件供 baseline 和未来维护使用。
//
// 维护规则：
//   - 新增权限点时，同步更新本文件 + role_permission_templates
//   - 删除权限点时，需确认无角色模板引用
// ============================================================================

export interface PermissionPoint {
  code: string;
  description: string;
  category: string;
}

export interface RolePermissionEntry {
  role: string;
  permission_code: string;
}

// ============================================================================
// 权限点字典（约 90 个，覆盖 30+ 类资源）
// ============================================================================
export const PERMISSION_POINTS: readonly PermissionPoint[] = [
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
] as const;

// ============================================================================
// 角色权限模板（user ⊂ instance_admin ⊂ server_admin，最小权限原则）
// ============================================================================
const USER_PERMISSIONS = [
  'binding.create', 'binding.verify', 'binding.revoke', 'binding.view',
  'wallet.view', 'wallet.debit', 'wallet.claim_daily',
  'vip.view', 'cdk.redeem',
  'store.item.view', 'store.purchase',
  'vote.view', 'vote.cast',
  'discover.view', 'instance.view',
  'maintenance.view', 'user.view',
];

const INSTANCE_ADMIN_PERMISSIONS = [
  ...USER_PERMISSIONS,
  'wallet.credit',
  'cdk.create', 'cdk.delete', 'cdk.view',
  'store.item.create', 'store.item.delete',
  'shop.config', 'shop.view',
  'vote.create', 'vote.delete',
  'instance.create', 'instance.update', 'instance.start', 'instance.console',
  'node.view',
  'asset.upload', 'asset.delete', 'asset.view',
  'pack.view',
  'backup.create', 'backup.restore', 'backup.delete', 'backup.view',
  'save.upload', 'save.download', 'save.delete',
  'mod.install', 'mod.uninstall', 'mod.view',
  'file.upload', 'file.download', 'file.delete', 'file.view',
  'cleanup.execute', 'cleanup.view',
  'chat.trigger.create', 'chat.trigger.delete', 'chat.trigger.view', 'chat.send',
  'periodic_message.create', 'periodic_message.delete', 'periodic_message.view',
  'player.kick', 'player.ban', 'player.unban', 'player.view',
  'lists.update', 'lists.view',
  'monitor.view', 'monitor.alert.ack',
  'settings.update', 'settings.view',
  'quota.view', 'system.view',
];

const SERVER_ADMIN_PERMISSIONS = [
  ...INSTANCE_ADMIN_PERMISSIONS,
  'instance.delete',
  'vip.set',
  'user.list', 'user.create', 'user.delete', 'user.role.assign',
  'role_permission.update',
  'node.register', 'node.delete', 'node.update',
  'pack.install', 'pack.delete',
  'batch.execute', 'batch.view',
  'operation.execute', 'operation.view',
  'quota.set',
  'system.config', 'system.health', 'system.deploy',
  'apikey.create', 'apikey.delete', 'apikey.view',
  'ssl.upload', 'ssl.delete', 'ssl.view',
  'tunnel.create', 'tunnel.delete', 'tunnel.view',
  'webhook.create', 'webhook.delete', 'webhook.view',
  'audit.view', 'audit.export',
  'maintenance.enable', 'maintenance.disable',
  'platform_stats.view',
];

export const ROLE_PERMISSION_TEMPLATES: readonly RolePermissionEntry[] = [
  ...USER_PERMISSIONS.map((code) => ({ role: 'user', permission_code: code })),
  ...INSTANCE_ADMIN_PERMISSIONS.map((code) => ({ role: 'instance_admin', permission_code: code })),
  ...SERVER_ADMIN_PERMISSIONS.map((code) => ({ role: 'server_admin', permission_code: code })),
];
