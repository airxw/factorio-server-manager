// ============================================================================
// Service 容器初始化
// 从 index.ts 拆分而来，行为等价。
// 职责：按依赖顺序实例化所有 Service（P1-P5 + 模块服务），返回 ServiceContainer。
// 注意：systemMonitorService 依赖 wsServer，不在此处创建（由 index.ts 在 WS 初始化后创建）。
// ============================================================================

import path from 'node:path';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import type { PackRegistry } from './core/packs/registry.js';

// P1 服务
import { createUserService } from './services/userService.js';
import { createVipService } from './services/vipService.js';
// v5 用户中心经济系统服务（balance/points/integral/pricing/withdraw）
import { createBalanceService } from './services/balanceService.js';
import { createPointsService } from './services/pointsService.js';
import { createIntegralService } from './services/integralService.js';
import { createPricingService } from './services/pricingService.js';
import { createWithdrawService } from './services/withdrawService.js';
import { createSystemConfigService } from './services/systemConfigService.js';
import { createSettingSchemaService, type SettingSchemaService } from './services/settingSchemaService.js';
import { createItemSyncService } from './services/itemSyncService.js';
import { createDaemonClient } from './services/daemonClientService.js';
import { createCommandDispatcher } from './services/commandDispatcher.js';
import { createExecutionEngineClient } from './services/executionEngineClient.js';
import type { IExecutionEngine } from '@public/interface_stub/asset_interfaces';
import { createWalletService } from './services/walletService.js';
import { createShopService } from './services/shopService.js';
import { createCdkService } from './services/cdkService.js';
import { createChatService } from './services/chatService.js';
import { createVoteService } from './services/voteService.js';
import { createPlayerService } from './services/playerService.js';
import { createPeriodicMessageService } from './services/periodicMessageService.js';
import { createInGameCommandService } from './services/inGameCommandService.js';
import { verifyBindingByCode, setInstanceBindingServiceDeps } from './services/instanceBindingService.js';

// P4 服务
import { createModService } from './services/modService.js';
import { createSaveService } from './services/saveService.js';
import { createBackupService } from './services/backupService.js';
import { createDbBackupService } from './services/dbBackupService.js';
import { createMonitorService } from './services/monitorService.js';
import { createListService } from './services/listService.js';
import { createPlayerManagementService } from './services/playerManagementService.js';
import { getTaskService } from './services/taskService.js';
import { createFileService } from './services/fileService.js';
import { createWorldGenService } from './services/worldGenService.js';
import { createConfigFileService } from './services/configFileService.js';
import { createUpdateService } from './services/updateService.js';
import { createChatLogService } from './services/chatLogService.js';
import { createSafeRemoveService } from './services/safeRemoveService.js';

// P5 服务
import { createWebhookService } from './services/webhookService.js';
import { createAuditLogService } from './services/auditLogService.js';
import { createNotificationService } from './services/notificationService.js';
// v4.31.0: 登录历史服务（登录流水 + UA 解析 + 上次登录查询）
import { createLoginHistoryService } from './services/loginHistoryService.js';

// App 级服务
import { createMailService } from './services/mailService.js';
import { AlertService } from './services/alertService.js';
import { InstanceRoleService } from './services/instanceRoleService.js';
import { FriendService } from './services/friendService.js';
import { createDiskMonitorService } from './services/diskMonitorService.js';
import { createSslService, type SslService } from './services/sslService.js';
import { createTunnelService } from './services/tunnelService.js';
import { createNodeService, type NodeService } from './services/nodeService.js';

// 模块0-3 服务
import { createSystemUpdateService } from '../../../modules/模块0_系统自更新/systemUpdateService.js';
import { createSystemMetricsService } from '../../../modules/模块1_系统监控/systemMetricsService.js';
import { createSystemDiagnosticService } from '../../../modules/模块2_系统诊断/systemDiagnosticService.js';
import { createPasswordService } from '../../../modules/模块3_用户安全/passwordService.js';

// 模块1_资产管理后端服务（v4.11.0 接入运行时）
import { AssetService } from './modules/asset_service/asset_service.js';
// v4.13.0: 实例店铺外观配置服务
import { InstanceShopConfigService } from './modules/asset_service/instance_shop_config_service.js';
// v3-billing: VPS 式预付费实例计费服务（chargeInstanceCreation/chargeInstanceRenewal/autoRenewInstance）
import { createInstanceBillingService, type InstanceBillingServiceImpl } from './services/instanceBillingService.js';

export interface ServiceContainer {
  // P1
  userService: ReturnType<typeof createUserService>;
  vipService: ReturnType<typeof createVipService>;
  // v5 用户中心经济系统
  balanceService: ReturnType<typeof createBalanceService>;
  pointsService: ReturnType<typeof createPointsService>;
  integralService: ReturnType<typeof createIntegralService>;
  pricingService: ReturnType<typeof createPricingService>;
  withdrawService: ReturnType<typeof createWithdrawService>;
  systemConfigService: ReturnType<typeof createSystemConfigService>;
  settingSchemaService: SettingSchemaService;
  itemSyncService: ReturnType<typeof createItemSyncService>;
  daemonClientService: ReturnType<typeof createDaemonClient>;
  commandDispatcher: ReturnType<typeof createCommandDispatcher>;
  walletService: ReturnType<typeof createWalletService>;
  shopService: ReturnType<typeof createShopService>;
  cdkService: ReturnType<typeof createCdkService>;
  chatService: ReturnType<typeof createChatService>;
  voteService: ReturnType<typeof createVoteService>;
  playerService: ReturnType<typeof createPlayerService>;
  periodicMessageService: ReturnType<typeof createPeriodicMessageService>;
  inGameCommandService: ReturnType<typeof createInGameCommandService>;
  // P4
  modService: ReturnType<typeof createModService>;
  saveService: ReturnType<typeof createSaveService>;
  backupService: ReturnType<typeof createBackupService>;
  dbBackupService: ReturnType<typeof createDbBackupService>;
  monitorService: ReturnType<typeof createMonitorService>;
  listService: ReturnType<typeof createListService>;
  playerManagementService: ReturnType<typeof createPlayerManagementService>;
  taskService: ReturnType<typeof getTaskService>;
  fileService: ReturnType<typeof createFileService>;
  worldGenService: ReturnType<typeof createWorldGenService>;
  configFileService: ReturnType<typeof createConfigFileService>;
  updateService: ReturnType<typeof createUpdateService>;
  chatLogService: ReturnType<typeof createChatLogService>;
  safeRemoveService: ReturnType<typeof createSafeRemoveService>;
  // P5
  webhookService: ReturnType<typeof createWebhookService>;
  auditLogService: ReturnType<typeof createAuditLogService>;
  notificationService: ReturnType<typeof createNotificationService>;
  /** v4.31.0: 登录历史服务（登录流水记录 + 上次登录查询 + UA 解析） */
  loginHistoryService: ReturnType<typeof createLoginHistoryService>;
  // App 级
  mailService: ReturnType<typeof createMailService>;
  alertService: AlertService;
  instanceRoleService: InstanceRoleService;
  friendService: FriendService;
  diskMonitorService: ReturnType<typeof createDiskMonitorService>;
  sslService: SslService;
  tunnelService: ReturnType<typeof createTunnelService>;
  /** L2: 节点集群管理服务（主从节点注册/heartbeat/离线扫描） */
  nodeService: NodeService;
  // 模块0-3
  systemUpdateService: ReturnType<typeof createSystemUpdateService>;
  systemMetricsService: ReturnType<typeof createSystemMetricsService>;
  systemDiagnosticService: ReturnType<typeof createSystemDiagnosticService>;
  passwordService: ReturnType<typeof createPasswordService>;
  // 模块1_资产管理后端（v4.11.0）
  assetService: AssetService;
  // v4.13.0: 实例店铺外观配置服务（Banner/描述/主题色）
  instanceShopConfigService: InstanceShopConfigService;
  // v4.11.0: IExecutionEngine 的 Panel 侧实现（daemon 沙箱发货入口）
  executionEngineClient: IExecutionEngine;
  // v3-billing: VPS 式预付费实例计费服务（创建/续费扣款 + 自动续扣扫描）
  instanceBillingService: InstanceBillingServiceImpl;
}

export interface InitServicesConfig {
  JWT_SECRET: string;
  DAEMON_URL: string;
  DAEMON_TOKEN: string;
  logger: Logger;
}

export async function initServices(
  db: Knex,
  registry: PackRegistry,
  config: InitServicesConfig,
): Promise<ServiceContainer> {
  const { JWT_SECRET, DAEMON_URL, DAEMON_TOKEN, logger } = config;

  // ----- P1 服务（B02-B09）-----
  const userService = createUserService(db, JWT_SECRET);
  // v5 用户中心经济系统：基础货币服务（vipService/withdrawService 依赖）
  const balanceService = createBalanceService(db);
  const pointsService = createPointsService(db);
  const integralService = createIntegralService(db);
  const pricingService = createPricingService(db);
  const vipService = createVipService(db, balanceService, integralService, pricingService);
  const withdrawService = createWithdrawService(db, balanceService);
  const systemConfigService = createSystemConfigService(db);
  // v3.8.0-S1: 结构化设置服务——包装 systemConfigService 提供类型校验 + 默认值 + schema 查询
  const settingSchemaService = createSettingSchemaService(db);
  // 首次启动时 seed 默认设置值（幂等）
  try {
    await settingSchemaService.seedDefaults();
  } catch (err) {
    logger.warn({ err }, 'v3.8.0 设置默认值 seed 失败（非致命，继续启动）');
  }
  const itemSyncService = createItemSyncService(db, registry);
  const daemonClientService = createDaemonClient(db, registry, DAEMON_URL, DAEMON_TOKEN);
  const commandDispatcher = createCommandDispatcher(db, daemonClientService);
  // P2 商店服务（复用 db / registry / commandDispatcher / walletService）
  // 经济系统改造：钱包按实例作用域，与 VIP 按实例绑定设计一致
  const walletService = createWalletService(db);
  const shopService = createShopService(db, registry, commandDispatcher, walletService, settingSchemaService);
  // P2 CDK 服务（复用 db / registry / commandDispatcher）
  // v5 经济系统：注入经济服务依赖（balance/points/integral/pricing，上方已实例化），
  // 支撑 generateUserCdk / redeemEconomic / refundExpiredCdk
  const cdkService = createCdkService(db, registry, commandDispatcher, {
    balanceService,
    pointsService,
    integralService,
    pricingService,
  });
  // P3 聊天 / 投票 / 玩家 / 定时消息 服务
  const chatService = createChatService(db);
  const voteService = createVoteService(db);
  const playerService = createPlayerService(db);
  // v4.38.0: 注入 verifyBindingByCode 广播所需的下游服务（playerService + daemonClientService）
  // 使 verifyBindingByCode 事务提交后能调用 getVipWelcomeMessage + sendCommand 广播 VIP 欢迎语
  setInstanceBindingServiceDeps({ playerService, daemonClientService });
  const periodicMessageService = createPeriodicMessageService(db);
  // 模块10 Task 6: 游戏内聊天命令服务（统一分发 !verify/!claim/!vk/!register/!help/!status/!players/!uptime）
  const inGameCommandService = createInGameCommandService(db, registry, {
    commandDispatcher,
    cdkService,
    voteService,
    verifyBindingByCode,
    registerUser: async (email, username, password, gamePlayerName, serverId) => {
      // v4.27.0: registerFromGame 改为实例级绑定，直接传 serverId 作为 scope_ref
      // 旧版查询 server.game_type 已移除（game_type 字段不再用于绑定语义）
      const server = await db<{ id: string }>('servers')
        .select('id')
        .where('id', serverId)
        .first();
      if (!server) {
        return { success: false, message: '注册失败: 服务器不存在' };
      }
      return userService.registerFromGame(email, username, password, gamePlayerName, serverId);
    },
    // v4.33.0 W5: !uptime 接 Daemon 真实 uptime（实例摘要 uptime 字段）
    getInstanceUptime: (nodeId, serverId) =>
      daemonClientService.getInstanceUptime(nodeId, serverId),
  });

  // ----- P4 服务 -----
  const modService = createModService(db, registry, daemonClientService);
  const saveService = createSaveService(db, registry, daemonClientService);
  const backupService = createBackupService(db, daemonClientService, registry);
  // v3.9.0-D1: DB 自动备份服务（与实例 backupService 区分——本服务备份 panel.db 全量文件）
  const dbBackupService = createDbBackupService(db, settingSchemaService, logger);
  const monitorService = createMonitorService(db);
  const listService = createListService(db);
  // v4.2.0-D1: 玩家管理操作服务（kick/ban/pardon/op/deop/whitelist add/remove + online）
  const playerManagementService = createPlayerManagementService(db, registry, commandDispatcher);
  // v4.3.0-E1: 异步任务服务（单例，全应用共享任务表）
  const taskService = getTaskService();
  // v4.3.0-F1~F5: 文件管理服务（依赖 daemonClientService + taskService）
  const fileService = createFileService(db, daemonClientService, taskService);
  // Factorio 集成扩展服务（Task 4-10）：worldGenService 依赖 db/registry/daemonClientService
  const worldGenService = createWorldGenService(db, registry, daemonClientService);
  // Task 7/8/9 新增服务：configFileService / updateService / chatLogService
  const configFileService = createConfigFileService(db, registry, daemonClientService);
  const updateService = createUpdateService(db, registry, daemonClientService);
  const chatLogService = createChatLogService(db, registry);
  // v3.6.0-A3: 安全删除服务（versions DELETE / cleanup confirm-delete 共用）
  const safeRemoveService = createSafeRemoveService(daemonClientService);

  // ----- P5 服务 -----
  const webhookService = createWebhookService(db);
  const auditLogService = createAuditLogService(db);
  // v3.3.0: 用户通知服务
  const notificationService = createNotificationService(db);
  // v4.31.0: 登录历史服务（记录每次登录尝试，含设备解析）
  const loginHistoryService = createLoginHistoryService(db);

  // ----- App 级服务 -----
  // v3.9.0-S6: 注入 mailService（passwordReset/emailVerify 路由依赖）
  const mailService = createMailService(settingSchemaService, logger);
  // v4.6.0-F1: 告警服务（依赖 mailService + notificationService + db + logger）
  const alertService = new AlertService(db, notificationService, mailService, logger);
  // v4.7.0: 实例级角色覆盖服务（auth 中间件 requireInstanceAccess/requireInstanceAdmin 已引用）
  const instanceRoleService = new InstanceRoleService(db, logger);
  // v4.8.0: 好友系统服务
  const friendService = new FriendService(db, logger);
  // v3.9.0-D2: 磁盘空间监控服务（v4.6.0-F3: 追加 alertService 参数以触发 disk_high 告警事件）
  const diskMonitorService = createDiskMonitorService(db, settingSchemaService, notificationService, logger, alertService);
  // v4.4.0-L1 SSL 证书管理服务
  const sslService = createSslService(logger);
  // v4.4.0-O1 FRP 隧道管理服务
  const tunnelService = createTunnelService(logger);
  // L2: 节点集群管理服务（主从节点注册/heartbeat/离线扫描）
  const nodeService = createNodeService(db, logger);

  // ----- 模块0-3 服务 -----
  // cwd 为 panel/backend/，modules/ 位于项目根 → ../../modules/...
  const systemUpdateService = createSystemUpdateService(db);
  const systemMetricsService = createSystemMetricsService(db, DAEMON_URL);
  const diagnosticRulesPath = path.resolve(
    process.cwd(),
    '../../modules/模块2_系统诊断/config/diagnostic-rules.json',
  );
  const diagnosticFixesPath = path.resolve(
    process.cwd(),
    '../../modules/模块2_系统诊断/config/diagnostic-fixes.json',
  );
  const diagnosticScriptsDir = path.resolve(
    process.cwd(),
    '../../modules/模块2_系统诊断/scripts',
  );
  const systemDiagnosticService = createSystemDiagnosticService(
    diagnosticRulesPath,
    diagnosticFixesPath,
    diagnosticScriptsDir,
    db,
  );
  const passwordMinZxcvbnScore = Number(process.env.PASSWORD_MIN_ZXCVBN_SCORE ?? '3');
  const passwordMaxHistory = Number(process.env.PASSWORD_MAX_HISTORY ?? '5');
  const passwordService = createPasswordService(
    db,
    Number.isFinite(passwordMinZxcvbnScore) ? passwordMinZxcvbnScore : undefined,
    Number.isFinite(passwordMaxHistory) ? passwordMaxHistory : undefined,
  );

  // 模块1_资产管理后端服务（v4.11.0 接入运行时，DB-backed，依赖 global_assets/instance_assets 表）
  const assetService = new AssetService(db);

  // v4.13.0: 实例店铺外观配置服务（DB-backed，依赖 instance_shop_configs 表）
  const instanceShopConfigService = new InstanceShopConfigService(db);

  // v4.11.0: IExecutionEngine 的 Panel 侧实现——接入 daemon /execute-logic 沙箱端点。
  // 依赖 DaemonClientImpl（非 DaemonClient 接口，因 executeLogic 未入接口契约）。
  // 供未来 UGC 资产发货链路调用：玩家购买 → 读取 execution_logic → 调用 executeLogic。
  const executionEngineClient = createExecutionEngineClient(db, daemonClientService);

  // v3-billing: VPS 式预付费实例计费服务（依赖 balanceService + systemConfigService + logger）
  const instanceBillingService = createInstanceBillingService(
    db,
    balanceService,
    systemConfigService,
    logger,
  );

  logger.info('P1 服务已初始化（userService/vipService/systemConfigService/itemSyncService/daemonClient/commandDispatcher/scheduler）');

  return {
    userService,
    vipService,
    balanceService,
    pointsService,
    integralService,
    pricingService,
    withdrawService,
    systemConfigService,
    settingSchemaService,
    itemSyncService,
    daemonClientService,
    commandDispatcher,
    walletService,
    shopService,
    cdkService,
    chatService,
    voteService,
    playerService,
    periodicMessageService,
    inGameCommandService,
    modService,
    saveService,
    backupService,
    dbBackupService,
    monitorService,
    listService,
    playerManagementService,
    taskService,
    fileService,
    worldGenService,
    configFileService,
    updateService,
    chatLogService,
    safeRemoveService,
    webhookService,
    auditLogService,
    notificationService,
    loginHistoryService,
    mailService,
    alertService,
    instanceRoleService,
    friendService,
    diskMonitorService,
    sslService,
    tunnelService,
    nodeService,
    systemUpdateService,
    systemMetricsService,
    systemDiagnosticService,
    passwordService,
    assetService,
    instanceShopConfigService,
    executionEngineClient,
    instanceBillingService,
  };
}
