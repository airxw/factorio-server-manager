// ============================================================================
// 路由注册表
// 从 index.ts 拆分而来，行为等价。
// 职责：
//   1. 注入 app.locals（所有 Service + db + scheduler + eventBus）
//   2. 注册内联路由（health/login/register/version/changelog/me）
//   3. 注册 59 个业务路由（按业务域分组）
//   4. 静态文件服务（前端构建产物）
//   5. 追加 /api 404 回退 + 全局错误处理（registerErrorHandlers）
// ============================================================================

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Logger } from 'pino';
import type { Knex } from 'knex';
import backendPkg from '../package.json' with { type: 'json' };
import type { PackRegistry } from './core/packs/registry.js';
import { signToken } from './core/auth/jwt.js';
import {
  Role,
  toContractUserRole,
  toContractUserRoles,
  normalizeRoles,
  resolveActiveRole,
  isValidRole,
  ROLE_LEVEL,
} from './core/auth/roles.js';
import { authenticateToken, requireAdmin, requireRole } from './middleware/auth.js';
import { createLoginRateLimiter } from './middleware/rateLimiter.js';
import { checkPasswordStrength, PASSWORD_POLICY_RULES } from './services/passwordPolicy.js';
import { createInitPreflightService } from './services/initPreflightService.js';
// v4.20.0: Setup Wizard v2 新增服务
import { createEnvFileService } from './services/envFileService.js';
import { createDatabaseTestService } from './services/databaseTestService.js';
import { createRestartService } from './services/restartService.js';
// v4.22.0: Pack 三种来源同步服务（GitHub / 自定义 URL / 上传 zip）
import { createPackSyncService } from './services/packSyncService.js';
import { scheduler } from './services/scheduler.js';
import { eventBus } from './services/eventBus.js';
import { DaemonHttpClient } from './daemonClient/client.js';
import { DaemonEventStream } from './daemonClient/eventStream.js';
import { PanelWsServer } from './websocket/server.js';
import { createSystemMonitorService } from './services/systemMonitorService.js';
import { registerErrorHandlers } from './app.js';
import { parseChangelog } from './changelog-parser.js';
import type { ServiceContainer } from './services-init.js';

// 路由工厂导入
import { createPacksRouter } from './api/routes/packs.js';
import { createNodesRouter, createNodesPublicRouter } from './api/routes/nodes.js';
import { createServersRouter } from './api/routes/servers.js';
import { createUsersRouter } from './api/routes/users.js';
import { createSystemConfigRouter } from './api/routes/systemConfig.js';
import { createSettingsRouter, createPublicSiteInfoRouter, createPublicInitRouter, createPublicLegalRouter } from './api/routes/settings.js';
import { createPasswordResetRouter } from './api/routes/passwordReset.js';
import { createEmailVerifyAuthRouter, createEmailVerifyPublicRouter } from './api/routes/emailVerify.js';
import { createVipPermissionsRouter } from './api/routes/vipPermissions.js';
import { createItemSyncRouter } from './api/routes/itemSync.js';
import { createShopRouter } from './api/routes/shop.js';
import { createCdkRouter, createGlobalCdkRouter } from './api/routes/cdk.js';
import { createWalletRouter } from './api/routes/wallet.js';
import { createChatRouter } from './api/routes/chat.js';
import { createVoteRouter } from './api/routes/vote.js';
import { createPlayerRouter } from './api/routes/player.js';
import { createPlayerBindingsRouter, createServerPlayerBindingsRouter } from './api/routes/playerBindings.js';
import { createPeriodicMessageRouter } from './api/routes/periodicMessage.js';
import { createFilesRouter } from './api/routes/files.js';
import { createProxyRouter } from './api/routes/proxy.js';
import { createApiKeysRouter } from './api/routes/apiKeys.js';
import { createInstanceAdminsRouter } from './api/routes/instanceAdmins.js';
import { createMeRouter } from './api/routes/me.js';
// v4.15.0: 玩家门户聚合路由（/api/my/orders + /api/my/overview）
import { createMyRouter } from './api/routes/my.js';
// v5: 用户中心经济系统路由（余额/点券/VIP/定价/流水/提现，挂载 /api）
import { createUserCenterRouter } from './api/routes/userCenter.js';
import { createQuotasRouter } from './api/routes/quotas.js';
import { createOperationsRouter } from './api/routes/operations.js';
import { createPlatformStatsRouter } from './api/routes/platform-stats.js';
import { createInstanceRolesRouter } from './api/routes/instanceRoles.js';
import { createBatchRouter } from './api/routes/batch.js';
import { createDiscoverRouter, createDiscoverAdminRouter } from './api/routes/discover.js';
// v4.38.0: 绑定申请审批路由
import { createBindingRequestsRouter } from './api/routes/bindingRequests.js';
import { createFriendsRouter } from './api/routes/friends.js';
import { createPlayerProfileRouter } from './api/routes/playerProfile.js';
import { createAlertSettingsRouter } from './api/routes/alertSettings.js';
import { createSslRouter } from './api/routes/ssl.js';
import { createTunnelsRouter } from './api/routes/tunnels.js';
import { createBindingsRouter } from './api/routes/bindings.js';
import { createVerifyCodesRouter } from './api/routes/verifyCodes.js';
import { createConfigFilesRouter } from './api/routes/configFiles.js';
import { createWorldGenRouter } from './api/routes/worldGen.js';
import { createChatLogsRouter } from './api/routes/chatLogs.js';
import { createUpdatesRouter } from './api/routes/updates.js';
import { createModsRouter } from './api/routes/mods.js';
import { createSavesRouter } from './api/routes/saves.js';
import { createBackupsRouter } from './api/routes/backups.js';
import { createMonitorRouter } from './api/routes/monitor.js';
import { createListsRouter } from './api/routes/lists.js';
import { createWebhooksRouter } from './api/routes/webhooks.js';
import { createAuditLogsRouter } from './api/routes/auditLogs.js';
import { createNotificationsRouter } from './api/routes/notifications.js';
// v4.31.0: 个人安全中心路由（/api/me/login-history / /api/me/audit-logs / /api/me/last-login）
import { createMeSecurityRouter } from './api/routes/meSecurity.js';
import { createVersionsRouter } from './api/routes/versions.js';
import { createCleanupRouter } from './api/routes/cleanup.js';
import { createDemoRouter } from './api/routes/demo.js';
import { createMaintenanceRouter } from './api/routes/maintenance.js';
import { createSystemUpdateRouter } from '../../../modules/模块0_系统自更新/systemUpdateRoute.js';
import { createSystemMetricsRouter } from '../../../modules/模块1_系统监控/systemMetricsRoute.js';
import { createSystemDiagnosticRouter } from '../../../modules/模块2_系统诊断/systemDiagnosticRoute.js';
import { createPasswordChangeRouter } from '../../../modules/模块3_用户安全/passwordChangeRoute.js';
import { createAssetsRouter } from './api/routes/assets.js';
// v4.13.0: 实例店铺外观配置路由
import { createStoreShopConfigRouter } from './api/routes/store_shop_config.js';
// v4.13.0: GM Workbench 后端 API（玩家CRM/流水/时长/服主实例列表）
import { createStoreGmRouter } from './api/routes/store-gm.js';
// v4.13.0 步骤16: GM Workbench 玩家操作 API（发放补偿/封禁/调整时长）
import { createStorePlayerActionsRouter } from './api/routes/store-player-actions.js';
// v4.13.0: Daemon 上报玩家会话端点（步骤18b 防假闭合写入链路）
import { createDaemonReportRouter } from './api/routes/daemon-report.js';
// v3-billing: VPS 式预付费实例计费路由（类型定价/计费设置/续费/预览/记录）
import { createInstanceBillingRouter } from './api/routes/instance-billing.js';

import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  PasswordPolicyResponse,
  RegisterRequest,
  RegisterResponse,
  SelectRoleRequest,
  SelectRoleResponse,
  SwitchRoleRequest,
  SwitchRoleResponse,
  RevokeUserTokensResponse,
  UserInfo,
  UserRole,
  UserRoles,
} from '@public/schema/panel-api-types';

// ----- DB 行类型（从 index.ts 迁移） -----
interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  /**
   * @deprecated v4.17.0 过渡期保留；v4.19.2 M3 基线已 DROP 此列。
   * 保留为可选字段仅为向后兼容旧 SELECT * 查询结果（实际恒为 undefined）。
   * 严禁向此字段写入（INSERT/UPDATE），DB 列已不存在会抛 SQL 错误。
   */
  role?: string;
  status: string;
  /** JWT 失效版本号（改密后 +1 使旧 JWT 失效；DEFAULT 0 跳过校验兼容旧 JWT） */
  token_version: number;
  /** 上次密码修改时间，NULL=未知（既有用户初始为 NULL） */
  password_changed_at: string | null;
  /** 邮箱是否已验证（0=未验证，1=已验证） */
  email_verified: number;
  created_at: string;
  updated_at: string;
  /** v4.17.0: 角色集合 JSON 字符串 */
  roles?: string | null;
  /** v4.17.0: 当前活动角色（会话级） */
  active_role?: string | null;
  /** v4.31.0: 上次登录时间 ISO（登录成功时更新） */
  last_login_at?: string | null;
  /** v4.31.0: 上次登录 IP（登录成功时更新） */
  last_login_ip?: string | null;
}

/**
 * 将 DB 行或 User 记录转换为公共契约的 UserInfo
 * @version 4.17.0 输出 roles + active_role
 *          3.1.0: status 扩展 'deleted'
 */
function toUserInfo(row: {
  id: string;
  email: string;
  username: string;
  /** v4.19.2 M3: users.role 列已 DROP，此处接受 undefined（不再使用此字段） */
  role?: string;
  status: string;
  created_at: string;
  is_built_in?: number;
  roles?: string | null;
  active_role?: string | null;
}): UserInfo {
  // v4.19.2 M3: users.role 列已 DROP，移除 ?? row.role fallback；
  //   roles=null 时 normalizeRoles 返回 [USER]（最低权限默认）
  const roles = normalizeRoles(row.roles);
  const activeRole = resolveActiveRole(row.active_role, roles);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: toContractUserRole(activeRole),
    roles: toContractUserRoles(roles),
    active_role: toContractUserRole(activeRole),
    status: row.status as 'active' | 'disabled' | 'deleted',
    created_at: row.created_at,
    ...(row.is_built_in !== undefined ? { is_built_in: row.is_built_in } : {}),
  };
}

// v4.31.0: 提取客户端真实 IP（nginx 透传 X-Forwarded-For，回退 req.ip）
// nginx 监听 0.0.0.0:3000/3001 反代到 127.0.0.1:3002，Panel 收到的 req.ip 恒为 127.0.0.1
// 必须优先取 X-Forwarded-For 首段，否则 login_history.ip_address 失去意义
function extractClientIp(req: express.Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xff) && xff.length > 0) {
    const first = xff[0]?.trim();
    if (first) return first;
  }
  // x-real-ip（部分 nginx 配置补充）
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.length > 0) {
    return xRealIp.trim();
  }
  return req.ip ?? null;
}

// v4.31.0: 脱敏登录输入（仅 fail_not_found 时记录，安全审计追溯攻击目标）
// 邮箱：保留首字符 + @域名  →  j***@example.com
// 用户名：保留首尾各 1 字符 →  j***n
function maskLoginInput(input: string): string {
  if (!input) return '';
  if (input.includes('@')) {
    // 邮箱脱敏
    const [local, domain] = input.split('@');
    if (!domain) return input;
    const maskedLocal = local.length <= 1 ? local : local[0] + '***';
    return `${maskedLocal}@${domain}`;
  }
  // 用户名脱敏
  if (input.length <= 2) return input[0] + '*';
  if (input.length === 3) return input[0] + '*' + input[2];
  return input[0] + '***' + input[input.length - 1];
}

export interface RouteDeps {
  app: express.Express;
  db: Knex;
  registry: PackRegistry;
  services: ServiceContainer;
  JWT_SECRET: string;
  logger: Logger;
  wsServer: PanelWsServer;
  daemonEventStream: DaemonEventStream;
}

export interface RouteResult {
  systemMonitorService: ReturnType<typeof createSystemMonitorService>;
}

export function registerRoutes(deps: RouteDeps): RouteResult {
  const { app, db, registry, services, JWT_SECRET, logger, wsServer, daemonEventStream } = deps;
  const {
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
    mailService,
    alertService,
    instanceRoleService,
    friendService,
    sslService,
    tunnelService,
    systemUpdateService,
    systemMetricsService,
    systemDiagnosticService,
    passwordService,
    assetService,
    instanceShopConfigService,
  } = services;

  // ===== app.locals 注入（所有 Service + db + scheduler + eventBus） =====
  app.locals.userService = userService;
  app.locals.vipService = vipService;
  // v5 用户中心经济系统服务
  app.locals.balanceService = balanceService;
  app.locals.pointsService = pointsService;
  app.locals.integralService = integralService;
  app.locals.pricingService = pricingService;
  app.locals.withdrawService = withdrawService;
  app.locals.systemConfigService = systemConfigService;
  app.locals.settingSchemaService = settingSchemaService;
  app.locals.db = db;
  // v4.18.0: 注入 registry + daemonClientService 供 initPreflightService 使用
  app.locals.packRegistry = registry;
  app.locals.daemonClientService = daemonClientService;
  // v4.18.0: 初始化环境预检服务（含 8 项检查：db/migrations/daemon/packs/db_config/mode/disk/public_url）
  app.locals.initPreflightService = createInitPreflightService({
    db,
    registry,
    daemonClientService,
  });
  // v4.20.0: Setup Wizard v2 新增服务
  // envFileService：写入 .env（database.url / public_base_url / daemon_url），重启后生效
  // databaseTestService：测试数据库连接（向导内"测试连接"按钮调用）
  // restartService：一次性 token 触发 systemctl restart gameserver-panel
  app.locals.envFileService = createEnvFileService();
  app.locals.databaseTestService = createDatabaseTestService();
  app.locals.restartService = createRestartService();
  // v4.22.0: Pack 三种来源同步服务——供 /api/init/packs/sync 与 /api/init/packs/upload 调用
  //   packsDir 与 index.ts 中 PackRegistry.loadFromDir 用的目录一致：
  //   优先用环境变量 PACKS_DIR，回退到 process.cwd()/../../packs
  {
    const packsDir = process.env.PACKS_DIR ?? path.resolve(process.cwd(), '../../packs');
    app.locals.packSyncService = createPackSyncService(packsDir, registry);
  }
  app.locals.mailService = mailService;
  app.locals.alertService = alertService;
  app.locals.instanceRoleService = instanceRoleService;
  app.locals.friendService = friendService;
  app.locals.itemSyncService = itemSyncService;
  app.locals.commandDispatcher = commandDispatcher;
  app.locals.scheduler = scheduler;
  app.locals.eventBus = eventBus;
  app.locals.shopService = shopService;
  app.locals.cdkService = cdkService;
  app.locals.chatService = chatService;
  app.locals.voteService = voteService;
  app.locals.playerService = playerService;
  app.locals.periodicMessageService = periodicMessageService;
  app.locals.inGameCommandService = inGameCommandService;
  app.locals.modService = modService;
  app.locals.saveService = saveService;
  app.locals.backupService = backupService;
  app.locals.monitorService = monitorService;
  app.locals.listService = listService;
  app.locals.playerManagementService = playerManagementService;
  app.locals.taskService = taskService;
  app.locals.fileService = fileService;
  app.locals.worldGenService = worldGenService;
  app.locals.configFileService = configFileService;
  app.locals.updateService = updateService;
  app.locals.chatLogService = chatLogService;
  app.locals.webhookService = webhookService;
  app.locals.auditLogService = auditLogService;
  app.locals.notificationService = notificationService;
  // v4.31.0: 注入登录历史服务（供登录路由与 /api/me/* 路由使用）
  app.locals.loginHistoryService = services.loginHistoryService;
  app.locals.systemUpdateService = systemUpdateService;
  app.locals.systemMetricsService = systemMetricsService;
  app.locals.systemDiagnosticService = systemDiagnosticService;
  app.locals.passwordService = passwordService;
  app.locals.sslService = sslService;
  app.locals.tunnelService = tunnelService;
  app.locals.assetService = assetService;
  app.locals.instanceShopConfigService = instanceShopConfigService;
  // v3-billing: 注入实例计费服务（供 servers.ts 创建实例时调用 chargeInstanceCreation）
  app.locals.instanceBillingService = services.instanceBillingService;

  // ===== 内联路由 =====

  // GET /api/health（无需鉴权）
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // v4.18.0: GET /api/auth/password-policy（公开接口，供前端实时密码校验）
  //   - 与后端 checkPasswordStrength 规则 1:1 对齐
  //   - 前端 SetupWizard / 改密页 / 注册页可拉取后做实时 zxcvbn 评分展示
  //   - 无需鉴权（首启动向导场景下用户尚未登录）
  app.get('/api/auth/password-policy', (_req, res) => {
    const response: PasswordPolicyResponse = {
      min_length: PASSWORD_POLICY_RULES.min_length,
      max_length: PASSWORD_POLICY_RULES.max_length,
      min_zxcvbn_score: PASSWORD_POLICY_RULES.min_zxcvbn_score,
      require_letter: PASSWORD_POLICY_RULES.require_letter,
      require_digit: PASSWORD_POLICY_RULES.require_digit,
      forbidden_passwords: PASSWORD_POLICY_RULES.forbidden_passwords,
    };
    res.json(response);
  });

  // POST /api/auth/login（无需鉴权）
  // D11: 登录速率限制——每 IP 每 15 分钟最多 10 次请求
  // v4.22.0: 支持邮箱或用户名登录——LoginRequest.email 字段实际接受邮箱或用户名
  //   保留契约字段名 email 不变（向后兼容前端），后端按 OR 查询匹配 email 或 username
  // v4.31.0: 5 个登录结果分支均记录 login_history（成功+失败审计断链补齐）
  //          成功分支同步更新 users.last_login_at / last_login_ip
  const loginRateLimiter = createLoginRateLimiter();
  app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
    const body = req.body as Partial<LoginRequest>;
    if (!body.email || !body.password) {
      res.status(400).json({
        error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 email 或 password' },
      });
      return;
    }

    // v4.31.0: 提取客户端 IP 与 UA，供 login_history 记录
    const clientIp = extractClientIp(req);
    const userAgent = req.headers['user-agent'] ?? null;
    // v4.31.0: 非阻塞记录登录尝试（失败不阻断响应）
    const recordLogin = (input: {
      login_type: 'success' | 'fail_password' | 'fail_disabled' | 'fail_unverified' | 'fail_not_found';
      user_id?: string | null;
      login_input?: string | null;
      failure_reason?: string | null;
    }) => {
      void services.loginHistoryService
        .create({
          login_type: input.login_type,
          user_id: input.user_id ?? null,
          login_input: input.login_input ?? null,
          ip_address: clientIp,
          user_agent: userAgent,
          failure_reason: input.failure_reason ?? null,
        })
        .catch((err) => {
          logger.warn({ err }, '[login_history] 记录登录尝试失败（非阻断）');
        });
    };

    // v4.22.0: 同时匹配 email 或 username（防枚举——错误消息保持"邮箱或密码错误"不暴露具体字段）
    const loginInput = (body.email || '').trim();
    const user = await db<UserRow>('users')
      .where(function () {
        this.where({ email: loginInput }).orWhere({ username: loginInput });
      })
      .first();
    if (!user) {
      // v4.31.0: 用户不存在 → 记录 fail_not_found（脱敏 login_input 供安全审计追溯）
      recordLogin({
        login_type: 'fail_not_found',
        user_id: null,
        login_input: maskLoginInput(loginInput),
        failure_reason: 'user_not_found',
      });
      // 防枚举：用户不存在时同样抛"邮箱或密码错误"
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '邮箱或密码错误' },
      });
      return;
    }

    const passwordMatch = await bcrypt.compare(body.password, user.password_hash);
    if (!passwordMatch) {
      // v4.31.0: 密码错误 → 记录 fail_password（user_id 落目标用户，便于本人查看异常尝试）
      recordLogin({
        login_type: 'fail_password',
        user_id: user.id,
        failure_reason: 'password_mismatch',
      });
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '邮箱或密码错误' },
      });
      return;
    }

    if (user.status !== 'active') {
      // v4.31.0: 账号禁用/删除 → 记录 fail_disabled（区分 disabled/deleted 详情）
      recordLogin({
        login_type: 'fail_disabled',
        user_id: user.id,
        failure_reason: user.status === 'deleted' ? 'account_deleted' : 'account_disabled',
      });
      const message =
        user.status === 'deleted' ? '账号已删除' : '账号已禁用';
      res.status(403).json({
        error: { code: 'PANEL_FORBIDDEN', message },
      });
      return;
    }

    // v3.9.0-S5: 邮箱验证门控
    try {
      const requireEmailVerify = await settingSchemaService.getBoolean('registration.require_email_verify');
      if (requireEmailVerify && user.email_verified !== 1) {
        // v4.19.2 M3: users.role 列已 DROP，改用 active_role（兼容多角色字段）
        const loginRoles = normalizeRoles(user.roles);
        const loginActiveRole = resolveActiveRole(undefined, loginRoles);
        const normalizedRole = loginActiveRole.toLowerCase();
        if (normalizedRole !== 'server_admin' && normalizedRole !== 'admin' && normalizedRole !== 'system_admin') {
          // v4.31.0: 邮箱未验证 → 记录 fail_unverified
          recordLogin({
            login_type: 'fail_unverified',
            user_id: user.id,
            failure_reason: 'email_not_verified',
          });
          res.status(403).json({
            error: {
              code: 'EMAIL_NOT_VERIFIED',
              message: '邮箱未验证，请查收验证邮件后再登录。如未收到，可在登录后通过个人设置重发。',
            },
          });
          return;
        }
      }
    } catch {
      // 设置读取失败时降级放行
    }

    // v4.28.5: 登录默认恢复账号主身份（roles[0]），不继承上次会话残留到 DB 的 active_role。
    const loginRoles = normalizeRoles(user.roles);
    const loginActiveRole = resolveActiveRole(undefined, loginRoles);
    const token = signToken(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: loginActiveRole,
        token_version: user.token_version,
        roles: loginRoles,
        active_role: loginActiveRole,
      },
      JWT_SECRET,
    );

    // v3.8.0-S8: 管理员密码过期检查
    let passwordExpired = false;
    try {
      // v4.19.2 M3: users.role 列已 DROP，改用 active_role（兼容多角色字段）
      const normalizedRole = loginActiveRole.toLowerCase();
      if (normalizedRole === 'server_admin' || normalizedRole === 'admin' || normalizedRole === 'system_admin') {
        const expiryDays = await settingSchemaService.getNumber('admin.expiry_days');
        if (expiryDays > 0 && user.password_changed_at) {
          const changedAt = Date.parse(user.password_changed_at);
          if (Number.isFinite(changedAt)) {
            const ageMs = Date.now() - changedAt;
            if (ageMs > expiryDays * 24 * 60 * 60 * 1000) {
              passwordExpired = true;
            }
          }
        }
      }
    } catch {
      // 设置读取失败时不强制过期检查
    }

    // v4.31.0: 登录成功 → 记录 success + 更新 users.last_login_at/last_login_ip
    recordLogin({
      login_type: 'success',
      user_id: user.id,
    });
    {
      const nowIsoLogin = new Date().toISOString();
      // 非阻塞更新 last_login 字段（失败仅记日志，不影响登录响应）
      void db<UserRow>('users')
        .where('id', user.id)
        .update({
          last_login_at: nowIsoLogin,
          last_login_ip: clientIp,
        })
        .catch((err) => {
          logger.warn({ err }, '[login_history] 更新 users.last_login_at/ip 失败（非阻断）');
        });
    }

    const responseUser = {
      ...toUserInfo(user),
      role: toContractUserRole(loginActiveRole),
      active_role: toContractUserRole(loginActiveRole),
      roles: toContractUserRoles(loginRoles),
    };
    const response: LoginResponse = { token, user: responseUser };
    if (passwordExpired) {
      (response as LoginResponse & { password_expired?: boolean }).password_expired = true;
    }
    res.json(response);
  });

  // POST /api/auth/register（无需鉴权，v3.1.0 新增）
  app.post('/api/auth/register', async (req, res) => {
    try {
      const registrationEnabled = await settingSchemaService.getBoolean('registration.enabled');
      if (!registrationEnabled) {
        res.status(403).json({
          error: { code: 'PANEL_REGISTRATION_DISABLED', message: '管理员已关闭新用户注册' },
        });
        return;
      }
    } catch {
      // 设置读取失败时默认允许注册
    }
    const body = req.body as Partial<RegisterRequest>;
    if (!body.email || !body.username || !body.password) {
      res.status(400).json({
        error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 email、username 或 password' },
      });
      return;
    }
    const email = String(body.email).trim().toLowerCase();
    const username = String(body.username).trim();
    const password = String(body.password);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 128) {
      res.status(400).json({
        error: { code: 'PANEL_VALIDATION_ERROR', message: '邮箱格式不合法' },
      });
      return;
    }
    if (username.length < 2 || username.length > 32) {
      res.status(400).json({
        error: { code: 'PANEL_VALIDATION_ERROR', message: '用户名需为 2-32 字符' },
      });
      return;
    }
    const pwdCheck = checkPasswordStrength(password);
    if (!pwdCheck.ok) {
      res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: '密码强度不足',
          details: {
            failures: pwdCheck.failures,
            suggestions: pwdCheck.suggestions,
            score: pwdCheck.score,
          },
        },
      });
      return;
    }

    try {
      const { userId, verifyCode } = await userService.register(email, username, password);
      const loginResult = await userService.login(email, password, { ip: req.ip });
      const response: RegisterResponse = {
        userId,
        verifyCode,
        token: loginResult.token,
        user: toUserInfo({
          id: loginResult.user.id,
          email: loginResult.user.email,
          username: loginResult.user.username,
          role: loginResult.user.role as unknown as string,
          status: loginResult.user.status as unknown as string,
          created_at: loginResult.user.created_at,
        }),
      };

      // v3.9.0-S5: 注册成功后自动发送邮箱验证邮件（best-effort）
      void (async () => {
        try {
          const verifyToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomBytes(16).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
          const now = new Date();
          const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
          await db('email_verifications').insert({
            id: crypto.randomUUID(),
            user_id: userId,
            token_hash: tokenHash,
            expires_at: expiresAt,
            used_at: null,
            created_at: now.toISOString(),
          });
          const origin = (req.headers.origin ?? `https://${req.headers.host}`) as string;
          const verifyUrl = `${origin}/verify-email?token=${verifyToken}`;
          const siteName = await settingSchemaService.getString('site.name');
          await mailService.sendEmailVerifyEmail(email, verifyUrl, siteName);
        } catch (verifyErr) {
          logger.warn(
            { err: verifyErr instanceof Error ? verifyErr.message : String(verifyErr), userId },
            '[register] 自动发送邮箱验证邮件失败（不影响注册结果）',
          );
        }
      })();

      void auditLogService
        .create({
          user_id: userId,
          action: 'auth.register',
          target_type: 'user',
          target_id: userId,
          details: { email, username, verifyCode },
          ip_address: req.ip ?? null,
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'auth.register audit log 写入失败',
          );
        });
      res.status(201).json(response);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : undefined;
      if (code === 'USER_ALREADY_EXISTS') {
        res.status(409).json({
          error: { code: 'USER_ALREADY_EXISTS', message: '邮箱已被注册' },
        });
        return;
      }
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'auth.register 失败',
      );
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: '注册失败，请稍后重试' },
      });
    }
  });

  // GET /api/version（无需鉴权，返回后端版本号）
  app.get('/api/version', (_req, res) => {
    res.json({ version: backendPkg.version });
  });

  // GET /api/version/changelog（无需鉴权，解析 version.md 返回版本更新日志）
  app.get('/api/version/changelog', (_req, res) => {
    try {
      const changelog = parseChangelog();
      res.json(changelog);
    } catch (err) {
      res.status(500).json({ error: '解析版本日志失败' });
    }
  });

  // GET /api/auth/me（JWT 鉴权）
  app.get('/api/auth/me', authenticateToken(JWT_SECRET), async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
      });
      return;
    }

    const user = await db<UserRow>('users').where({ id: userId }).first();
    if (!user) {
      res.status(404).json({
        error: { code: 'PANEL_UNAUTHORIZED', message: '用户不存在' },
      });
      return;
    }
    if (user.status === 'deleted') {
      res.status(403).json({
        error: { code: 'PANEL_FORBIDDEN', message: '账号已删除' },
      });
      return;
    }

    // v4.28.5: /auth/me 优先回显当前 JWT 会话中的 active_role，
    // 这样刷新页面仍保持本会话已切换的身份，而新登录默认身份由 /auth/login 控制。
    const responseUser = toUserInfo({
      ...user,
      active_role: req.activeRole ?? user.active_role,
    });
    const response: MeResponse = { user: responseUser };
    res.json(response);
  });

  // ==========================================================================
  // v4.17.0 多角色管理 — 内联鉴权路由
  // ==========================================================================

  // POST /api/auth/select-role（JWT 鉴权 + 二次密码校验）
  // 已认证用户选定会话级活动角色；返回新 token（含新 active_role）
  app.post('/api/auth/select-role', authenticateToken(JWT_SECRET), async (req, res) => {
    try {
      const body = req.body as Partial<SelectRoleRequest>;
      if (!body.email || !body.password || !body.active_role) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 email、password 或 active_role' },
        });
        return;
      }
      if (!isValidRole(body.active_role)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 active_role: ${body.active_role}` },
        });
        return;
      }

      // 1. 当前 JWT 必须属于该用户（防止 A 用户用 B 的凭证切换角色）
      const jwtUserId = req.user?.userId;
      if (!jwtUserId) {
        res.status(401).json({
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        });
        return;
      }

      // 2. 二次密码校验（防 session hijack 后切换角色提权）
      const targetUser = await db<UserRow>('users').where({ email: body.email }).first();
      if (!targetUser) {
        res.status(401).json({
          error: { code: 'PANEL_UNAUTHORIZED', message: '邮箱或密码错误' },
        });
        return;
      }
      const passwordMatch = await bcrypt.compare(body.password, targetUser.password_hash);
      if (!passwordMatch) {
        res.status(401).json({
          error: { code: 'PANEL_UNAUTHORIZED', message: '邮箱或密码错误' },
        });
        return;
      }
      // 3. JWT 用户必须与凭证用户一致
      if (targetUser.id !== jwtUserId) {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '不能为其他用户切换角色' },
        });
        return;
      }
      if (targetUser.status !== 'active') {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '账号状态异常' },
        });
        return;
      }

      // 4. 调用 userService 切换活动角色 + 签发新 JWT
      const userService = services.userService;
      const result = await userService.selectActiveRole(jwtUserId, body.active_role as UserRole);

      // 5. 审计日志（异步，失败不阻断响应）
      const auditLogService = services.auditLogService;
      void auditLogService
        .create({
          user_id: jwtUserId,
          action: 'user.select_role',
          target_type: 'user',
          target_id: jwtUserId,
          details: { new_active_role: body.active_role },
          ip_address: req.ip ?? null,
        })
        .catch(() => undefined);

      // 6. 构造 SelectRoleResponse（user 转 UserInfo）
      const userRow: UserRow = {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        password_hash: result.user.password_hash,
        role: result.user.role as unknown as string,
        status: result.user.status,
        token_version: targetUser.token_version, // selectActiveRole 不改 token_version
        password_changed_at: null,
        email_verified: 0,
        created_at: result.user.created_at,
        updated_at: result.user.updated_at,
        roles: JSON.stringify(normalizeRoles((result.user as { roles?: UserRoles }).roles)),
        active_role: (result.user as { active_role?: UserRole }).active_role as string,
      };
      const response: SelectRoleResponse = {
        token: result.token,
        user: toUserInfo(userRow),
      };
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // InvalidCredentialError 表示角色不在集合中
      if (message.includes('不在用户角色集合中')) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message },
        });
        return;
      }
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
      });
    }
  });

  // POST /api/auth/switch-role（JWT 免密——v4.28.0 全员服主同级身份快捷切换）
  // 与 select-role 的区别：
  //   - 免密：仅凭 JWT 会话切换，无需 email+password 二次校验
  //   - 等级闸门：目标角色等级必须 ≤ 2（user / instance_admin）；
  //     server_admin 目标一律拒绝（403），须走 select-role 密码通道
  app.post('/api/auth/switch-role', authenticateToken(JWT_SECRET), async (req, res) => {
    try {
      const body = req.body as Partial<SwitchRoleRequest>;
      if (!body.active_role) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 active_role' },
        });
        return;
      }
      if (!isValidRole(body.active_role)) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message: `非法 active_role: ${body.active_role}` },
        });
        return;
      }

      // 等级闸门：免密通道仅允许同级身份两面（user ↔ instance_admin）
      if (ROLE_LEVEL[body.active_role as Role] > ROLE_LEVEL[Role.INSTANCE_ADMIN]) {
        res.status(403).json({
          error: {
            code: 'PANEL_FORBIDDEN',
            message: 'server_admin 角色切换须走 /api/auth/select-role 密码通道',
          },
        });
        return;
      }

      // 1. 当前 JWT 必须有效
      const jwtUserId = req.user?.userId;
      if (!jwtUserId) {
        res.status(401).json({
          error: { code: 'PANEL_UNAUTHORIZED', message: '未认证' },
        });
        return;
      }

      // 2. 用户状态校验（防已删除/禁用账号切换）
      const targetUser = await db<UserRow>('users').where({ id: jwtUserId }).first();
      if (!targetUser) {
        res.status(401).json({
          error: { code: 'PANEL_UNAUTHORIZED', message: '用户不存在' },
        });
        return;
      }
      if (targetUser.status !== 'active') {
        res.status(403).json({
          error: { code: 'PANEL_FORBIDDEN', message: '账号状态异常' },
        });
        return;
      }

      // 3. 调用 userService 切换活动角色 + 签发新 JWT（含 roles 成员资格校验）
      const userService = services.userService;
      const result = await userService.selectActiveRole(jwtUserId, body.active_role as UserRole);

      // 4. 审计日志（异步，失败不阻断响应）
      const auditLogService = services.auditLogService;
      void auditLogService
        .create({
          user_id: jwtUserId,
          action: 'user.switch_role',
          target_type: 'user',
          target_id: jwtUserId,
          details: { new_active_role: body.active_role, channel: 'jwt_passwordless' },
          ip_address: req.ip ?? null,
        })
        .catch(() => undefined);

      // 5. 构造 SwitchRoleResponse
      const userRow: UserRow = {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        password_hash: result.user.password_hash,
        role: result.user.role as unknown as string,
        status: result.user.status,
        token_version: targetUser.token_version, // selectActiveRole 不改 token_version
        password_changed_at: null,
        email_verified: 0,
        created_at: result.user.created_at,
        updated_at: result.user.updated_at,
        roles: JSON.stringify(normalizeRoles((result.user as { roles?: UserRoles }).roles)),
        active_role: (result.user as { active_role?: UserRole }).active_role as string,
      };
      const response: SwitchRoleResponse = {
        token: result.token,
        user: toUserInfo(userRow),
      };
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // InvalidCredentialError 表示角色不在集合中
      if (message.includes('不在用户角色集合中')) {
        res.status(400).json({
          error: { code: 'PANEL_VALIDATION_ERROR', message },
        });
        return;
      }
      res.status(500).json({
        error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
      });
    }
  });

  // POST /api/auth/revoke-tokens（JWT 鉴权 + requireAdmin）
  // server_admin 强制下线目标用户（撤销所有未过期 token + token_version+1）
  app.post(
    '/api/auth/revoke-tokens',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    async (req, res) => {
      try {
        const body = req.body as { user_id?: string };
        if (!body.user_id) {
          res.status(400).json({
            error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 user_id' },
          });
          return;
        }
        const userService = services.userService;
        const result = await userService.revokeUserTokens(body.user_id);
        const response: RevokeUserTokensResponse = {
          user_id: body.user_id,
          revoked_token_count: result.revokedTokenCount,
          revoked_at: new Date().toISOString(),
        };

        // 审计日志
        const auditLogService = services.auditLogService;
        const operatorId = req.user?.userId ?? null;
        void auditLogService
          .create({
            user_id: operatorId,
            action: 'user.revoke_tokens',
            target_type: 'user',
            target_id: body.user_id,
            details: { revoked_token_count: result.revokedTokenCount },
            ip_address: req.ip ?? null,
          })
          .catch(() => undefined);

        res.json(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('不存在')) {
          res.status(404).json({
            error: { code: 'USER_NOT_FOUND', message },
          });
          return;
        }
        res.status(500).json({
          error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
        });
      }
    },
  );

  // ===== 业务路由 =====

  const daemonClient = new DaemonHttpClient({ baseUrl: process.env.DAEMON_URL ?? 'http://localhost:8080', token: process.env.DAEMON_TOKEN ?? '' });

  // ----- packs / nodes / servers -----
  app.use('/api/packs', authenticateToken(JWT_SECRET), createPacksRouter(registry, db));
  app.use('/api/packs', authenticateToken(JWT_SECRET), createItemSyncRouter());
  app.use('/api/packs', authenticateToken(JWT_SECRET), createVersionsRouter(db, registry, daemonClientService, safeRemoveService));
  // L2: 节点公开路由（slave 注册/heartbeat/verify-token，无 authenticateToken，用 linkKey/commsKey 自鉴权）
  app.use('/api/nodes', createNodesPublicRouter(services.nodeService, JWT_SECRET, logger, daemonClientService));
  // L2: 节点鉴权路由（列表/详情/创建邀请/删除 + 原有 disk-usage/javas）
  app.use('/api/nodes', authenticateToken(JWT_SECRET), createNodesRouter(services.nodeService, daemonClientService, logger));
  app.use('/api/servers', authenticateToken(JWT_SECRET), createServersRouter(
    db,
    registry,
    daemonClient,
    wsServer,
    logger,
    (serverId) => daemonEventStream.subscribe(serverId),
    daemonClientService,
    safeRemoveService,
    services.configFileService,
  ));
  // v5: 用户中心经济系统（余额/点券/VIP/定价/流水/统计/提现，路由内部带 /me、/servers/:serverId、/admin 前缀）
  // ⚠️ 必须挂在所有 app.use('/api/servers', ..., requireAdmin, ...) 之前——
  //    Express 的 app.use(path, m1, m2, router) 中 m1/m2 是挂载层中间件，会在子 router 之前执行，
  //    不论子 router 内部是否匹配子路径。若挂在后面，instance_admin 访问
  //    /api/servers/:serverId/pricing 会被 requireAdmin 拦截返回 403「权限不足」，
  //    根本到不了本路由的 requireInstanceAccess('serverId')。详见 InstanceEconomyConfig bug。
  app.use('/api', authenticateToken(JWT_SECRET), createUserCenterRouter({
    db,
    balanceService,
    pointsService,
    integralService,
    vipService,
    pricingService,
    withdrawService,
    auditLogService,
    logger,
  }));

  // ----- shop / cdk / wallet -----
  app.use('/api/cdk', authenticateToken(JWT_SECRET), createGlobalCdkRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createShopRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createCdkRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createWalletRouter(services.walletService));
  // ----- instance admins -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createInstanceAdminsRouter(db, logger));
  // ----- chat / vote / player / periodicMessage -----
  // v4.29.9 修复：移除 router 级 requireAdmin，改为在各 router 内部每个路由上挂 requireAdmin。
  // 原因：app.use(path, mw1, requireAdmin, router) 中 requireAdmin 是挂载层中间件，会在
  // 子 router 之前执行。若用户角色不匹配，requireAdmin 直接 res.status(403) 结束响应且
  // 不调用 next()，导致后续所有 app.use('/api/servers', ...) 都不会执行——本应允许
  // instance_admin 访问的 chat-logs/config-files/worldGen/updates 路由被错误拦截返回 403。
  app.use('/api/servers', authenticateToken(JWT_SECRET), createChatRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createVoteRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createPlayerRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createPeriodicMessageRouter());
  // ----- mods / saves / backups / monitor / lists -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createModsRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createSavesRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createBackupsRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createMonitorRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createListsRouter());
  // ----- configFiles / worldGen / chatLogs / updates -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createConfigFilesRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createWorldGenRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createChatLogsRouter());
  app.use('/api/servers', authenticateToken(JWT_SECRET), createUpdatesRouter());
  // ----- files -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createFilesRouter());
  // ----- player bindings (server level) -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createServerPlayerBindingsRouter());
  // ----- instance roles -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createInstanceRolesRouter(db, logger));
  // ----- webhooks -----
  app.use('/api/servers', authenticateToken(JWT_SECRET), createWebhooksRouter());

  // ----- proxy / api-keys -----
  app.use('/api/proxy', authenticateToken(JWT_SECRET), createProxyRouter());
  app.use('/api/api-keys', authenticateToken(JWT_SECRET), requireAdmin, createApiKeysRouter());

  // ----- system monitor -----
  const systemMonitorService = createSystemMonitorService(wsServer, logger);
  app.locals.systemMonitorService = systemMonitorService;
  app.get(
    '/api/system-monitor/history',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    (req, res) => {
      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 60;
      const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 1800)) : 60;
      const history = systemMonitorService.getHistory(limit);
      res.json({ history });
    },
  );
  systemMonitorService.start();

  // ----- SSL / tunnel -----
  app.use('/api/system/ssl', authenticateToken(JWT_SECRET), requireAdmin, createSslRouter(sslService, logger));
  app.use('/api/system/tunnel', authenticateToken(JWT_SECRET), requireAdmin, createTunnelsRouter(tunnelService, logger));

  // ----- audit logs -----
  app.use('/api/audit-logs', authenticateToken(JWT_SECRET), requireAdmin, createAuditLogsRouter());

  // ----- users / system-config / settings -----
  app.use('/api/users', authenticateToken(JWT_SECRET), requireAdmin, createUsersRouter());
  app.use('/api/system-config', authenticateToken(JWT_SECRET), requireAdmin, createSystemConfigRouter());
  app.use('/api/settings', authenticateToken(JWT_SECRET), requireAdmin, createSettingsRouter());
  app.use('/api/settings', createPublicSiteInfoRouter());
  app.use('/api/init', createPublicInitRouter());
  app.use('/api/legal', createPublicLegalRouter());

  // ----- auth: password-reset / email-verify / change-password -----
  app.use('/api/auth/password-reset', createPasswordResetRouter(db, settingSchemaService, mailService, logger));
  app.use(
    '/api/auth/email-verify',
    authenticateToken(JWT_SECRET),
    createEmailVerifyAuthRouter(db, settingSchemaService, mailService, logger),
  );
  app.use('/api/auth/email-verify', createEmailVerifyPublicRouter(db, logger));
  app.use('/api/auth', authenticateToken(JWT_SECRET), createPasswordChangeRouter());

  // ----- vip-permissions / player-bindings / bindings / verify-codes -----
  app.use('/api/vip-permissions', authenticateToken(JWT_SECRET), createVipPermissionsRouter());
  // v4.16.1: 移除整组 requireAdmin——玩家自助绑定（list/create/verify/delete）是玩家门户
  // 核心路径；路由内部按角色分流（reject 管理动作仍 admin-only），见 playerBindings.ts 头注释
  app.use('/api/player-bindings', authenticateToken(JWT_SECRET), createPlayerBindingsRouter());
  app.use('/api', authenticateToken(JWT_SECRET), createBindingsRouter());
  app.use('/api/verify-codes', authenticateToken(JWT_SECRET), createVerifyCodesRouter());

  // ----- admin: cleanup / demo / maintenance -----
  // v4.29.10: 移除挂载层 requireAdmin——与 v4.29.9 修复模板对齐。
  //   原因：app.use('/api/admin', authenticateToken, requireAdmin, createCleanupRouter) 中
  //   requireAdmin 是挂载层中间件，会在子 router 之前执行——不论子 router 内部是否匹配子路径。
  //   instance_admin 角色不匹配 requireRole(SERVER_ADMIN)，requireAdmin 直接
  //   res.status(403).json({message:'权限不足'}) 后 return，不调用 next()，
  //   导致 /api/admin/instances/:id/assets 等本应由 requireInstanceAdmin 门控的端点
  //   被错误拦截（assets 路由挂在下方 app.use('/api', ..., createAssetsRouter)）。
  //   修复：requireAdmin 移入 cleanup.ts 各路由内部，挂载层仅保留 authenticateToken。
  app.use('/api/admin', authenticateToken(JWT_SECRET), createCleanupRouter(db, safeRemoveService));

  // v3-billing: 实例计费路由（类型定价/计费设置/续费/预览/记录）
  //   权限在路由内部逐端点校验：types 写操作仅 server_admin，settings/renew/renewals 按实例归属校验
  app.use(
    '/api/admin/instance-billing',
    authenticateToken(JWT_SECRET),
    createInstanceBillingRouter({
      instanceBillingService: services.instanceBillingService,
      db,
      logger,
    }),
  );
  app.use('/api/demo', authenticateToken(JWT_SECRET), createDemoRouter(db, registry, logger));
  app.use(
    '/api/admin/maintenance',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    createMaintenanceRouter({
      db,
      auditLogService,
      notificationService,
      itemSyncService,
      chatLogService,
      logger,
    }),
  );

  // ----- notifications / me / quotas / operations -----
  app.use('/api/notifications', authenticateToken(JWT_SECRET), createNotificationsRouter());
  app.use('/api/me', authenticateToken(JWT_SECRET), createMeRouter(db, logger));
  // v4.31.0: 个人安全中心路由（/api/me/login-history / /api/me/audit-logs / /api/me/last-login）
  //   与 createMeRouter 共用 /api/me 前缀，但路由内部各管各的子路径不冲突
  //   套 authenticateToken，强制按当前 user_id 过滤（路由层覆盖客户端 user_id）
  app.use('/api/me', authenticateToken(JWT_SECRET), createMeSecurityRouter(logger));
  // v4.15.0: 玩家门户聚合（跨实例"我的"数据，任意已登录用户，仅本人数据）
  app.use('/api/my', authenticateToken(JWT_SECRET), createMyRouter(db, logger));
  // v5: 用户中心经济系统挂载已前移至 /api/servers 子路由之前（见下方注释），避免被 requireAdmin 拦截
  app.use('/api/quotas', authenticateToken(JWT_SECRET), createQuotasRouter(db, logger));
  app.use(
    '/api/operations',
    authenticateToken(JWT_SECRET),
    requireRole(Role.INSTANCE_ADMIN, Role.SERVER_ADMIN),
    createOperationsRouter(db, logger),
  );

  // ----- alert settings -----
  app.use('/api/alert-settings', authenticateToken(JWT_SECRET), createAlertSettingsRouter(db, alertService, logger));

  // ----- platform stats / batch / discover -----
  app.use(
    '/api/platform',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    createPlatformStatsRouter(db, logger),
  );
  app.use(
    '/api/batch',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    createBatchRouter(db, registry, daemonClient, logger),
  );
  app.use('/api/discover', createDiscoverRouter(db, logger));
  // v4.38.0: 移除挂载层 requireAdmin——visibility/binding-requests-settings 下放给 owner/instance_admin，
  //   recommend 保持仅 server_admin；权限改由 discover.ts 路由内部逐端点校验
  app.use(
    '/api/admin/servers',
    authenticateToken(JWT_SECRET),
    createDiscoverAdminRouter(db, logger),
  );
  // v4.38.0: 绑定申请审批路由（/servers/:serverId/binding-requests / /binding-requests/:id / /my/binding-requests）
  app.use('/api', authenticateToken(JWT_SECRET), createBindingRequestsRouter(db, logger));

  // ----- friends / player profile -----
  app.use(
    '/api/friends',
    authenticateToken(JWT_SECRET),
    createFriendsRouter(db, friendService, logger),
  );
  app.use('/api/players', createPlayerProfileRouter(db, logger, JWT_SECRET));

  // ----- 模块0-3 路由 -----
  app.use(
    '/api/system-update',
    authenticateToken(JWT_SECRET),
    requireAdmin,
    createSystemUpdateRouter(),
  );
  app.use('/api/system', authenticateToken(JWT_SECRET), createSystemMetricsRouter());
  app.use('/api/system', authenticateToken(JWT_SECRET), createSystemDiagnosticRouter());

  // ----- 模块1_资产管理后端路由（v4.11.0 接入运行时） -----
  // 实例级端点用 requireInstanceAdmin('instanceId') 门控；全局资产 CRUD 用 requireAdmin。
  // 挂载前缀 /api，路由内部路径以 /admin/instances/... 与 /admin/assets 开头。
  app.use('/api', authenticateToken(JWT_SECRET), createAssetsRouter(assetService, logger));

  // ----- v4.13.0: 实例店铺外观配置路由 -----
  // GET  /store/servers/:serverId/shop-config 门控 requireInstanceAccess（user+ 拥有实例访问权即可读）
  // PUT  /store/servers/:serverId/shop-config 门控 requireInstanceAdmin（instance_admin+ 服主才能改）
  app.use('/api', authenticateToken(JWT_SECRET), createStoreShopConfigRouter(instanceShopConfigService, logger));

  // ----- v4.13.0: GM Workbench 后端 API（玩家CRM/流水/时长/服主实例列表） -----
  // 路由内部 requireRole(INSTANCE_ADMIN, SERVER_ADMIN) + 处理器内实例级权限校验
  app.use('/api', authenticateToken(JWT_SECRET), createStoreGmRouter(db, logger));

  // ----- v4.13.0 步骤16: GM Workbench 玩家操作 API（发放补偿/封禁/调整VIP时长） -----
  // 路由内部 requireRole(INSTANCE_ADMIN, SERVER_ADMIN) + authorizeInstanceAccess
  // playerManagementService 从 app.locals 获取（与 player.ts 路由模式一致）
  app.use('/api', authenticateToken(JWT_SECRET), createStorePlayerActionsRouter(db, logger));

  // ----- v4.13.0 步骤18b: Daemon 上报玩家会话端点 -----
  // 鉴权：header x-report-key（环境变量 DAEMON_REPORT_KEY），不走 authenticateToken
  // 数据流：daemon PlayerSessionReporter → POST /api/daemon/player-sessions/{join,leave} → player_sessions 表
  app.use('/api', createDaemonReportRouter(db, logger));

  // ===== 静态文件服务（前端构建产物）—— 必须放在所有 API 路由之后 =====
  const frontendDistDir = path.resolve(process.cwd(), '../frontend/dist');
  if (fs.existsSync(frontendDistDir)) {
    // assets/ 目录带 contenthash，可安全长缓存（1年 + immutable）
    app.use(
      '/assets',
      express.static(path.join(frontendDistDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // 其他静态文件（favicon 等）—— 中等缓存
    app.use(
      express.static(frontendDistDir, {
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );
    // SPA 路由回退：所有非 API 请求返回 index.html（强制 no-cache）
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(frontendDistDir, 'index.html'));
    });
    logger.info({ dir: frontendDistDir }, '前端静态文件服务已挂载');
  } else {
    logger.warn({ dir: frontendDistDir }, '前端构建目录不存在，跳过静态文件服务');
  }

  // ===== /api 404 回退 + 全局错误处理（必须在所有路由之后） =====
  registerErrorHandlers(app, logger);

  return { systemMonitorService };
}
