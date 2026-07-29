// ============================================================================
// settings — v3.8.0 结构化设置面板 API 路由
// 替代纯 KV 编辑器的 /api/system-config，提供 schema + 当前值 + 校验
//
// 端点：
//   GET    /api/settings/schema           列出全部设置项 schema + 当前值
//   GET    /api/settings/schema/:key      查询单个设置项
//   PUT    /api/settings/:key             设置值（带 schema 校验）
//   POST   /api/settings/:key/reset       重置为默认值
//   GET    /api/settings/site-info        公开站点信息（无需鉴权）
//   GET    /api/init/status               公开首启动状态查询（S13）
//   POST   /api/init                      公开首启动向导提交（S13，门控：needs_init=true）
//
// v4.20.0 Setup Wizard v2 新增端点：
//   POST   /api/init/test-database        测试数据库连接（向导内填写后实时验证）
//   POST   /api/init/restart              触发 systemctl restart gameserver-panel（一次性 token）
//   POST   /api/init 扩展字段：database / daemon_nodes / public_base_url / skip_daemon
//
// v4.22.0 Setup Wizard v3 新增端点：
//   POST   /api/init/test-daemon          测试 Daemon 连接（向导内粘贴导入链接后调用）
//
// 鉴权：在 index.ts 挂载时统一套 authenticateToken + requireAdmin
//       /api/settings/site-info 与 /api/init/* 除外（公开接口）
// ============================================================================

import { Router, type Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
// v4.22.0: Role.SERVER_ADMIN 用于创建首管理员时设置 roles + active_role
// v4.28.0: universalRolesFor 全员服主角色集合工厂
import { Role, universalRolesFor } from '../../core/auth/roles.js';
import type { SettingSchemaService } from '../../services/settingSchemaService.js';
import type {
  PanelErrorResponse,
  DatabaseConfig,
  DaemonNodeInput,
  PackSyncConfig,
  TestDaemonConnectionRequest,
  TestDaemonConnectionResponse,
  TestDatabaseConnectionRequest,
  TestDatabaseConnectionResponse,
  RestartTriggerRequest,
  RestartTriggerResponse,
  SyncPacksRequest,
  SyncPacksResponse,
  UploadPackResponse,
  AutoDetectLocalDaemonResponse,
} from '@public/schema/panel-api-types';
// v3.9.0-S3: 密码强度校验
import { checkPasswordStrength } from '../../services/passwordPolicy.js';
// v4.18.0: 环境预检服务
import type { InitPreflightService } from '../../services/initPreflightService.js';
// v4.20.0: .env 读写 / 数据库连接测试 / 重启服务
import type { EnvFileService } from '../../services/envFileService.js';
import type { DatabaseTestService } from '../../services/databaseTestService.js';
import type { RestartService } from '../../services/restartService.js';
// v4.22.0: Pack 三种来源同步服务
import type { PackSyncService } from '../../services/packSyncService.js';

// v4.22.0: multer 内存存储——上传的 zip 直接保留在内存中（buffer），交给 packSyncService.uploadZip 处理
//   - 限制 50MB（足够单个 pack zip，过大文件应由专用上传通道处理）
//   - 仅接受单文件上传，字段名 'pack'
const packUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/**
 * 创建 Settings 路由
 * 依赖通过 req.app.locals 注入：settingSchemaService
 */
export function createSettingsRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/settings/schema — 列出全部设置项 schema + 当前值
  // ----------------------------------------------------------------
  router.get('/schema', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const items = await service.listSchema();
      res.json({ settings: items });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/settings/schema/:key — 查询单个设置项
  // ----------------------------------------------------------------
  router.get('/schema/:key', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const item = await service.getSchema(req.params.key);
      if (!item) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: `设置项 ${req.params.key} 不存在` },
        };
        res.status(404).json(errBody);
        return;
      }
      res.json({ setting: item });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // PUT /api/settings/:key — 设置值（带 schema 校验）
  // ----------------------------------------------------------------
  router.put('/:key', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const body = req.body as { value?: string };
      if (typeof body.value !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 value 字段' },
        };
        res.status(400).json(errBody);
        return;
      }
      await service.setValue(req.params.key, body.value);
      const item = await service.getSchema(req.params.key);
      res.json({ setting: item });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 校验失败返回 400，其他错误返回 500
      if (message.includes('必须为') || message.includes('不能小于') || message.includes('不能大于') || message.includes('未知的设置项')) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message },
        };
        res.status(400).json(errBody);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/settings/:key/reset — 重置为默认值
  // ----------------------------------------------------------------
  router.post('/:key/reset', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      await service.resetValue(req.params.key);
      const item = await service.getSchema(req.params.key);
      res.json({ setting: item });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

/**
 * 创建公开站点信息路由（无需鉴权）
 * GET /api/settings/site-info — 返回站点名称/公告/Logo（供登录页使用）
 */
export function createPublicSiteInfoRouter(): Router {
  const router = Router();

  router.get('/site-info', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const [name, announcement, logoUrl] = await Promise.all([
        service.getString('site.name'),
        service.getString('site.announcement'),
        service.getString('site.logo_url'),
      ]);
      res.json({ name, announcement, logoUrl });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

/**
 * v3.9.0-S7: 创建公开法律内容路由（无需鉴权）
 *   GET /api/legal/terms   — 返回用户协议文本（管理员在设置面板配置）
 *   GET /api/legal/privacy — 返回隐私政策文本
 *
 * 内容来源：SettingSchemaService 的 legal.terms_content / legal.privacy_content
 * 未配置时返回空字符串，前端展示默认占位提示
 */
export function createPublicLegalRouter(): Router {
  const router = Router();

  router.get('/terms', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const content = await service.getString('legal.terms_content');
      res.json({ content });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  router.get('/privacy', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const content = await service.getString('legal.privacy_content');
      res.json({ content });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// v3.8.0-S13: 初始化引导向导（公开路由，首启动门控）
// ===========================================================================

/**
 * 检测首启动状态——满足以下任一条件即视为需要初始化：
 *   1. v4.22.0: users 表为空（count=0）—— 检测首个管理员是否已创建
 *   2. v4.18.0: system.mode 未设置（首次启动）
 *   3. v4.18.0: system.preflight_passed != true（未完成环境预检）
 *
 * v4.22.5 重构说明：
 *   - 旧条件 2（site.name 仍为默认值 'GameServer Panel'）已移除
 *   - 原因：用户保留默认站点名是合理选择，不应因此被强制再次进入向导
 *   - v4.22.0 已用 users 表是否为空作为首要判定条件，site.name 检查多余且有害
 *
 * v4.22.0 重构说明：
 *   - 旧条件 1 检测 admin@local.dev 存在 + password_changed_at IS NULL
 *   - 新条件 1 直接检测 users 表是否为空（移除内置默认账号后更精确）
 *   - 已完成初始化的部署：users 表非空 + system.mode 已写入 +
 *     system.preflight_passed=true → needs_init=false
 *
 * v4.18.0 兼容性说明：
 *   - migration 20260808000001 已为已初始化的部署自动写入 system.mode + system.preflight_passed=true
 *   - 因此旧部署升级后不会因新字段缺失而被强制再次进入向导
 */
async function detectInitStatus(db: Knex, service: SettingSchemaService): Promise<boolean> {
  // v4.0.2: 演示模式——init 永远视为"已完成"，避免在登录前卡 SetupWizard
  //   演示账号密码是 admin@local.dev/admin@local.dev/admin@local.dev = admin123
  //   不允许 SetupWizard 改密（演示场景下密码固定为 admin123）
  if (process.env.VITE_ENABLE_DEMO === 'true') {
    return false;
  }

  // v4.22.0 条件 1：users 表为空——尚未创建首个管理员
  //   旧条件（admin@local.dev + password_changed_at IS NULL）已被移除，
  //   因 v4.22.0 起 seedProvisionalAdminIfEmpty 不再创建 admin@local.dev/admin123。
  //   生产模式首启动时 users 表为空 → needs_init=true → 强制进入 SetupWizard
  //   注：Knex .count() 返回聚合结果，类型推断不友好，使用与 seed.ts 一致的宽松类型
  const userCountRow = await db('users').count('* as cnt').first() as
    | { cnt: number | string }
    | undefined;
  const userCount = Number(userCountRow?.cnt ?? 0);
  const usersEmpty = userCount === 0;

  // v4.22.5: 条件 2（site.name 仍为默认值）已移除
  //   原因：用户保留默认站点名 'GameServer Panel' 是合理选择，不应因此被强制再次
  //   进入向导。v4.22.0 已用 users 表是否为空作为首要判定条件，site.name 检查是
  //   v4.18.0 历史遗留，多余且有害——用户不动 site_name 字段时向导永远走不完。
  //   前端表单校验（step4SiteNameValid = siteName.trim().length > 0）已防止空提交。

  // v4.18.0 条件 3：system.mode 未设置（首次启动）
  //   migration 20260808000001 已写入 'production'，未写入或缺失视为需要初始化
  const systemMode = await service.getString('system.mode');
  const modeUnset = !systemMode || systemMode === '';

  // v4.18.0 条件 4：未完成 preflight（system.preflight_passed != 'true'）
  const preflightPassedRaw = await service.getString('system.preflight_passed');
  const preflightPassed = preflightPassedRaw === 'true';

  // 任一条件满足即视为需要初始化
  return usersEmpty || modeUnset || !preflightPassed;
}

/**
 * 创建公开初始化向导路由（无需鉴权，但内部 needs_init 门控）
 *
 *   GET  /api/init/status   返回 { needs_init, step }
 *   POST /api/init          一次性提交：site_name + admin_password + enabled_packs
 *
 * 安全设计：
 *   - 完成一次初始化后 needs_init=false，POST 端点返回 409 拒绝
 *   - admin_password 直接通过 bcrypt 更新默认 admin（不走 PasswordService 历史校验，
 *     因为首次启动没有"旧密码"概念；密码强度由前端 zxcvbn 提示，后端只校验最小长度）
 *   - enabled_packs 为空数组时表示"启用全部"（与 games.enabled_packs 默认语义一致）
 */
export function createPublicInitRouter(): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/init/status — 查询首启动状态
  // ----------------------------------------------------------------
  router.get('/status', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const db: Knex = req.app.locals.db;
      const needsInit = await detectInitStatus(db, service);
      const mode = process.env.VITE_ENABLE_DEMO === 'true' ? 'demo' as const : 'production' as const;
      res.json({ needs_init: needsInit, mode });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // GET /api/init/preflight — 服务器环境预检（8 项检查）
  //
  // v4.18.0: 公开接口，未登录可访问（首启动场景下用户尚未登录）
  // 返回 InitPreflightResponse：needs_init + all_ok + checks[]
  //
  // 闭合判据（rules-0 §四-13）：本路由是 InitPreflightService 接入运行时的
  // 唯一入口——服务已注入 app.locals.initPreflightService，但若缺本路由则
  // 前端 SetupWizard Step 0 调用 getInitPreflight() 必然 404，整个初始化
  // 流程被阻塞。此即 v4.11.0 假闭合事件的同类问题，必须显式暴露路由。
  // ----------------------------------------------------------------
  router.get('/preflight', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const db: Knex = req.app.locals.db;
      const preflightService = req.app.locals.initPreflightService as InitPreflightService | undefined;

      if (!preflightService) {
        // 防御性兜底：服务未注入时返回 503，避免 404 误导前端
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_INTERNAL_ERROR',
            message: '预检服务未初始化（initPreflightService 未注入 app.locals）',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      const checks = await preflightService.runChecks();
      const needsInit = await detectInitStatus(db, service);
      const allOk = checks.every((c) => c.status !== 'error');
      res.json({ needs_init: needsInit, all_ok: allOk, checks });
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/init — 一次性提交向导数据
  // ----------------------------------------------------------------
  router.post('/', async (req, res) => {
    try {
      const service = req.app.locals.settingSchemaService as SettingSchemaService;
      const db: Knex = req.app.locals.db;

      // v4.0.2: 演示模式短路——不进行 needsInit 门控检查，直接走 demo 分支
      //   detectInitStatus 在 demo 模式下永久返回 false（导致 POST 直接 409），
      //   但 demo 模式应当允许反复模拟初始化流程（不修改真实数据）
      const isDemoMode = process.env.VITE_ENABLE_DEMO === 'true';
      // v4.21.0: 运行时模式切换——用户在生产模式向导中选择 demo 模式
      //   当前 .env 中 VITE_ENABLE_DEMO != true，但 body.mode === 'demo'
      //   需写入 .env 并返回 restart_token，重启后生效
      const switchToDemo = !isDemoMode && (req.body as { mode?: string })?.mode === 'demo';
      if (switchToDemo) {
        const envFileService = req.app.locals.envFileService as EnvFileService | undefined;
        let envUpdated = false;
        let envUpdateError: string | null = null;
        if (!envFileService) {
          envUpdateError = 'envFileService 未注入 app.locals，.env 写入被跳过';
          console.warn(`[setup-wizard] ${envUpdateError}`);
        } else {
          try {
            await envFileService.writeEnvFile({ VITE_ENABLE_DEMO: 'true' });
            envUpdated = true;
          } catch (err) {
            envUpdateError = err instanceof Error ? err.message : String(err);
            console.warn(`[setup-wizard] .env 写入失败: ${envUpdateError}`);
          }
        }
        let restartToken: string | undefined;
        if (envUpdated) {
          const restartService = req.app.locals.restartService as RestartService | undefined;
          if (restartService) {
            restartToken = restartService.issueToken();
          }
        }
        res.json({
          initialized: true,
          site_name: typeof req.body?.site_name === 'string' ? req.body.site_name.trim() : '',
          admin_password_updated: false,
          enabled_packs: Array.isArray(req.body?.enabled_packs) ? req.body.enabled_packs : [],
          demo_mode: true,
          mode: 'demo',
          env_updated: envUpdated,
          env_update_error: envUpdateError,
          restart_required: envUpdated,
          restart_token: restartToken,
        });
        return;
      }
      if (!isDemoMode) {
        // 门控：已初始化则拒绝
        const needsInit = await detectInitStatus(db, service);
        if (!needsInit) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: '系统已完成初始化，无法重复执行',
            },
          };
          res.status(409).json(errBody);
          return;
        }
      }

      // v4.18.0: 扩展请求体——支持 admin 对象（邮箱/用户名可改）、mode、database_ack
      //   旧字段 admin_password 保留向后兼容（与 admin.password 等价，优先取 admin.password）
      // v4.20.0: 新增 database / daemon_nodes / public_base_url / skip_daemon 字段
      // v4.22.0: admin.{email, username, display_name, password} 在生产模式下均为必填
      //   （旧 admin@local.dev/admin123 默认账号已被移除，向导必须显式创建首个管理员）
      // v4.22.0: 新增 pack_source 字段（与 enabled_packs 二选一；优先于 enabled_packs）
      //   - source='github' / 'custom-url': 提交时再次同步（覆盖 Step 6 测试时的结果）
      //   - source='upload': 验证 upload_id 非空（zip 已在 Step 6 上传时解压）
      //   - source='skip': 跳过 Pack 配置，games.enabled_packs 设为 '[]'（全部启用默认行为）
      const body = req.body as {
        site_name?: string;
        admin_password?: string;
        admin?: {
          email?: string;
          username?: string;
          display_name?: string;
          password?: string;
        };
        enabled_packs?: string[];
        mode?: 'demo' | 'production';
        database_ack?: boolean;
        // v4.20.0 新增字段
        database?: DatabaseConfig;
        daemon_nodes?: DaemonNodeInput[];
        public_base_url?: string;
        skip_daemon?: boolean;
        // v4.22.0 新增字段
        pack_source?: PackSyncConfig;
      };

      // ----- 字段校验 -----
      const siteName = typeof body.site_name === 'string' ? body.site_name.trim() : '';
      if (!siteName) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '站点名称不能为空' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (siteName.length > 64) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '站点名称不能超过 64 个字符' },
        };
        res.status(400).json(errBody);
        return;
      }

      // ----- v4.22.0: admin 字段提取与校验（生产模式下均必填） -----
      // 旧逻辑：admin.password 可从 admin_password 旧字段回退（向后兼容已废弃前端）
      //   v4.22.0: admin.{email, username, display_name, password} 在生产模式下均必填
      //   admin_password 旧字段保留向后兼容（仅作 password 回退，不可作为完整 admin 创建凭据）
      const adminEmail = typeof body.admin?.email === 'string' ? body.admin.email.trim() : '';
      const adminUsername = typeof body.admin?.username === 'string' ? body.admin.username.trim() : '';
      const adminDisplayName =
        typeof body.admin?.display_name === 'string' ? body.admin.display_name.trim() : '';
      const adminPassword =
        typeof body.admin?.password === 'string'
          ? body.admin.password
          : typeof body.admin_password === 'string'
            ? body.admin_password
            : '';

      // 演示模式下 admin 字段可为空（demo 模式不创建真实账号，仅走过场）
      // 但生产模式下 admin.{email, username, display_name, password} 均必填
      const requireAdminFields = !isDemoMode;
      if (requireAdminFields) {
        if (!adminEmail) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员邮箱不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
        if (!adminUsername) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员用户名不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
        if (!adminDisplayName) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员昵称不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
        if (!adminPassword) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员密码不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // v3.9.0-S3: 增强为 zxcvbn 评分 + 字母数字组合校验（与 register 一致）
      // v4.18.0: 启用禁用密码硬拦截——拒绝 admin123 等常见弱密码（即便 zxcvbn 评分达标）
      // v4.22.0: 仅当 adminPassword 非空时校验（演示模式可省略）
      if (adminPassword) {
        const pwdCheck = checkPasswordStrength(adminPassword, { checkForbidden: true });
        if (!pwdCheck.ok) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'WEAK_PASSWORD',
              message: '管理员密码强度不足',
              details: {
                failures: pwdCheck.failures,
                suggestions: pwdCheck.suggestions,
                score: pwdCheck.score,
              },
            } as PanelErrorResponse['error'] & { details?: unknown },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // v4.22.0: 邮箱格式校验（必填，前端向导已校验，后端二次防御）
      if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员邮箱格式无效' },
        };
        res.status(400).json(errBody);
        return;
      }
      // v4.22.0: 用户名长度校验（2-32 字符，与 register 一致）
      if (adminUsername && (adminUsername.length < 2 || adminUsername.length > 32)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员用户名长度须为 2-32 字符' },
        };
        res.status(400).json(errBody);
        return;
      }
      // v4.22.0: 昵称长度校验（1-32 字符）
      if (adminDisplayName && (adminDisplayName.length < 1 || adminDisplayName.length > 32)) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '管理员昵称长度须为 1-32 字符' },
        };
        res.status(400).json(errBody);
        return;
      }

      const enabledPacks = Array.isArray(body.enabled_packs) ? body.enabled_packs : [];
      for (const p of enabledPacks) {
        if (typeof p !== 'string' || !p.trim()) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'enabled_packs 必须为字符串数组' },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // v4.18.0: database_ack 校验——若 preflight 中 db_config.status === 'warn'，
      //   必须 database_ack === true 才允许提交（避免用户忽略 SQLite 用于生产的警告）
      //   性能考量：POST /api/init 是一次性提交，重跑 preflight 可接受
      const preflightService = req.app.locals.initPreflightService as InitPreflightService | undefined;
      if (preflightService) {
        const checks = await preflightService.runChecks();
        const dbConfigCheck = checks.find((c) => c.key === 'db_config');
        if (dbConfigCheck && dbConfigCheck.status === 'warn' && body.database_ack !== true) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `数据库配置存在警告（${dbConfigCheck.detail}），需确认后方可继续`,
              details: {
                db_config_status: dbConfigCheck.status,
                db_config_detail: dbConfigCheck.detail,
              },
            } as PanelErrorResponse['error'] & { details?: unknown },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // ----- v4.20.0 新增字段校验 -----
      // database：若提供，校验 type + url
      if (body.database) {
        const dbType = body.database.type;
        if (dbType !== 'sqlite' && dbType !== 'mysql' && dbType !== 'postgresql') {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: `database.type 必须为 sqlite/mysql/postgresql，实际: ${dbType}` },
          };
          res.status(400).json(errBody);
          return;
        }
        if (!body.database.url || typeof body.database.url !== 'string') {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'database.url 不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // public_base_url：若提供，必须是 https:// 开头（生产强制 HTTPS，符合 rules 0.md）
      const publicBaseUrl = typeof body.public_base_url === 'string' ? body.public_base_url.trim() : '';
      if (publicBaseUrl && !publicBaseUrl.startsWith('https://')) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'public_base_url 必须以 https:// 开头（生产环境强制 HTTPS）' },
        };
        res.status(400).json(errBody);
        return;
      }

      // daemon_nodes / skip_daemon 互斥校验
      const skipDaemon = body.skip_daemon === true;
      const daemonNodes = Array.isArray(body.daemon_nodes) ? body.daemon_nodes : [];
      if (skipDaemon && daemonNodes.length > 0) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'skip_daemon=true 时不允许提供 daemon_nodes' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!skipDaemon) {
        for (let i = 0; i < daemonNodes.length; i++) {
          const node = daemonNodes[i];
          if (!node || typeof node.name !== 'string' || !node.name.trim()) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `daemon_nodes[${i}].name 不能为空` },
            };
            res.status(400).json(errBody);
            return;
          }
          if (!node || typeof node.fqdn !== 'string' || !node.fqdn.trim()) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `daemon_nodes[${i}].fqdn 不能为空` },
            };
            res.status(400).json(errBody);
            return;
          }
          if (!node || typeof node.daemon_token !== 'string' || node.daemon_token.length < 8) {
            const errBody: PanelErrorResponse = {
              error: { code: 'PANEL_VALIDATION_ERROR', message: `daemon_nodes[${i}].daemon_token 至少 8 字符` },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      // ----- v4.22.0: pack_source 字段校验（与 enabled_packs 二选一）-----
      // pack_source 优先于 enabled_packs：若提供 pack_source，则忽略 enabled_packs 字段
      //   - source='github': github_repo 必填（格式 owner/repo），github_ref 可选（默认 main）
      //   - source='custom-url': custom_url 必填（http/https 开头）
      //   - source='upload': upload_id 必填（Step 6 上传后返回的 UUID）
      //   - source='skip': 无附加字段
      const packSource = body.pack_source;
      if (packSource) {
        const validSources: PackSyncConfig['source'][] = ['github', 'custom-url', 'upload', 'skip'];
        if (!validSources.includes(packSource.source)) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `pack_source.source 必须为 ${validSources.join('/')}，实际: ${packSource.source}`,
            },
          };
          res.status(400).json(errBody);
          return;
        }
        if (packSource.source === 'github') {
          const repo = typeof packSource.github_repo === 'string' ? packSource.github_repo.trim() : '';
          if (!repo || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: `pack_source.github_repo 格式非法（应为 owner/repo，实际: ${repo}）`,
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }
        if (packSource.source === 'custom-url') {
          const url = typeof packSource.custom_url === 'string' ? packSource.custom_url.trim() : '';
          if (!url || !/^https?:\/\//i.test(url)) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: 'pack_source.custom_url 必须以 http:// 或 https:// 开头',
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }
        if (packSource.source === 'upload') {
          const uploadId = typeof packSource.upload_id === 'string' ? packSource.upload_id.trim() : '';
          if (!uploadId) {
            const errBody: PanelErrorResponse = {
              error: {
                code: 'PANEL_VALIDATION_ERROR',
                message: 'pack_source.upload_id 不能为空（请先在 Pack 配置步骤上传 zip）',
              },
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      // ----- 执行初始化 -----
      // v4.0.2: 演示模式（VITE_ENABLE_DEMO=true）下仅走过场，不真正修改任何数据
      //   演示账号密码不可改（is_built_in=1），admin 密码保持 admin123
      //   site_name / enabled_packs 也保留默认，避免误改 system_config 影响演示
      //   注：isDemoMode 在前面已计算（用于门控短路），此处复用
      if (isDemoMode) {
        res.json({
          initialized: true,
          site_name: siteName,
          admin_password_updated: false,
          enabled_packs: enabledPacks,
          demo_mode: true,
          mode: 'demo',
        });
        return;
      }

      // ----- v4.20.0: 写入 .env（database.url / public_base_url / daemon_url）-----
      // 提交逻辑顺序（按 plan §4.7）：
      //   1. 写入 .env（database.url / public_base_url / daemon_url）
      //   2. 写入 nodes 表（daemon_nodes）
      //   3. 写入 system_config（site.name / system.mode / system.preflight_passed）
      //   4. 更新 admin 密码/邮箱/用户名
      //   5. 写入 games.enabled_packs
      //   6. 返回 restart_token（若 env_updated=true）
      let envUpdated = false;
      let envUpdateError: string | null = null;
      const envUpdates: Record<string, string> = {};

      if (body.database) {
        // 将 database 配置转换为 DATABASE_URL
        // sqlite: 直接用路径；mysql/postgresql: 用连接串
        envUpdates['DATABASE_URL'] = body.database.url;
      }
      if (publicBaseUrl) {
        envUpdates['PUBLIC_BASE_URL'] = publicBaseUrl;
      }
      if (skipDaemon) {
        envUpdates['DAEMON_URL'] = '';
      } else if (daemonNodes.length > 0) {
        // 首个节点的 fqdn 作为 DAEMON_URL（向后兼容单机部署）
        envUpdates['DAEMON_URL'] = daemonNodes[0].fqdn;
      }

      if (Object.keys(envUpdates).length > 0) {
        const envFileService = req.app.locals.envFileService as EnvFileService | undefined;
        if (!envFileService) {
          // envFileService 未注入——记录警告但不阻断（生产部署时 .env 可能权限受限）
          envUpdateError = 'envFileService 未注入 app.locals，.env 写入被跳过';
          console.warn(`[setup-wizard] ${envUpdateError}`);
        } else {
          try {
            await envFileService.writeEnvFile(envUpdates);
            envUpdated = true;
          } catch (err) {
            envUpdateError = err instanceof Error ? err.message : String(err);
            console.warn(`[setup-wizard] .env 写入失败: ${envUpdateError}（配置已写入 system_config，但需手动同步 .env 后重启）`);
          }
        }
      }

      // ----- v4.20.0: 写入 nodes 表（daemon_nodes）-----
      let nodesAdded = 0;
      if (!skipDaemon && daemonNodes.length > 0) {
        for (const node of daemonNodes) {
          const nodeId = crypto.randomUUID();
          const tokenHash = await bcrypt.hash(node.daemon_token, 10);
          await db('nodes').insert({
            id: nodeId,
            name: node.name.trim(),
            fqdn: node.fqdn.trim(),
            daemon_token_hash: tokenHash,
            public_ip: node.public_ip ?? null,
            status: 'offline',
            last_seen_at: null,
            node_type: node.node_type ?? 'master',
            comms_key: null,
            link_key_hash: null,
            linked_at: null,
            display_fqdn: null,
          });
          nodesAdded++;
        }
      }

      // 1. 设置 site.name
      await service.setValue('site.name', siteName);

      // 2. v4.22.0: 创建首个管理员账号（不再更新 admin@local.dev/admin123）
      //    旧逻辑：找到 admin@local.dev → 更新密码/邮箱/用户名
      //    新逻辑：调用 INSERT 直接创建新用户（role=server_admin, is_built_in=0,
      //           is_verified=true, password_changed_at=now 标记已初始化）
      //
      //    不调用 userService.register 的原因：
      //    - userService.register 会创建一个 pending 玩家绑定记录（bindings 表），
      //      但首管理员不需要玩家绑定（管理员不绑定游戏角色）
      //    - 直接 db.insert 与 seedProvisionalAdminIfEmpty 旧逻辑风格一致
      //    - 显式设置 password_changed_at=now 避免 detectInitStatus 误判（虽然 v4.22.0
      //      detectInitStatus 已改为检测 users 表是否为空，但 password_changed_at 仍
      //      用于密码过期检查 /login 路由的 admin.expiry_days 校验）
      //
      //    唯一性校验：
      //    - users.email 有 UNIQUE 索引（基线 migration 已创建 users_email_unique）
      //    - users.username 无 DB 层 UNIQUE 约束，需应用层校验（避免重名）
      //    - 演示模式下 admin 字段可能为空（demo 模式不创建真实账号），跳过此步骤
      //
      //    v4.22.4 幂等性修复：向导中断后再次提交时，上次创建的管理员账号可能已存在
      //      但 system.preflight_passed 未被设置，导致用户卡在"邮箱已被注册"错误。
      //      修复策略：
      //      - email/username 已存在且 is_built_in=0：视为"上次向导中断留下的痕迹"，
      //        执行 UPSERT（更新密码/角色/display_name），让向导继续往下走
      //      - email/username 已存在且 is_built_in=1：内置账号不可复用，返回 409
      //      - email 与 username 不属于同一用户：说明用户填了别人的邮箱/用户名，返回 409
      let adminCreated = false;
      let adminEmailFinal = '';
      if (!isDemoMode && adminEmail && adminUsername && adminPassword) {
        // 唯一性预检：email 已存在
        const existingByEmail = await db('users').where({ email: adminEmail }).first();
        // 唯一性预检：username 已存在
        const existingByUsername = await db('users').where({ username: adminUsername }).first();

        if (existingByEmail && existingByUsername && existingByEmail.id !== existingByUsername.id) {
          // email 和 username 都已存在，但属于不同用户——说明用户填了别人的邮箱+用户名组合
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `邮箱 ${adminEmail} 与用户名 ${adminUsername} 已被不同账号占用，请更换`,
            },
          };
          res.status(409).json(errBody);
          return;
        }

        if (existingByEmail && existingByEmail.is_built_in === 1) {
          // 内置账号（admin@local.dev / manager@local.dev / user@local.dev）不可复用
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `邮箱 ${adminEmail} 为系统内置账号，请使用其他邮箱`,
            },
          };
          res.status(409).json(errBody);
          return;
        }

        if (existingByUsername && existingByUsername.is_built_in === 1) {
          const errBody: PanelErrorResponse = {
            error: {
              code: 'PANEL_VALIDATION_ERROR',
              message: `用户名 ${adminUsername} 为系统内置账号，请使用其他用户名`,
            },
          };
          res.status(409).json(errBody);
          return;
        }

        const newHash = await bcrypt.hash(adminPassword, 10);
        const now = new Date().toISOString();

        if (existingByEmail || existingByUsername) {
          // v4.22.4: 幂等 UPSERT——上次向导中断留下的非内置管理员账号，更新密码/角色/字段
          //   场景：用户首次向导提交时 INSERT 成功，但后续步骤（重启/Daemon 连接）失败，
          //   system.preflight_passed 未设置，用户再次进入 /setup 重新提交。
          //   此时邮箱+用户名是同一账号（前面已校验），直接 UPDATE 让向导继续。
          const targetUser = existingByEmail ?? existingByUsername;
          await db('users').where({ id: targetUser.id }).update({
            // 仅更新可变字段：email/username 由当前提交决定（处理"上次填 A，这次填 B"场景）
            email: adminEmail,
            username: adminUsername,
            password_hash: newHash,
            // 修正 role/active_role（修正历史脏数据：曾误存为 viewer）
            // v4.28.0 全员服主：管理员角色集合补齐 instance_admin + user
            roles: JSON.stringify(universalRolesFor(Role.SERVER_ADMIN)),
            active_role: Role.SERVER_ADMIN,
            status: 'active',
            display_name: adminDisplayName || adminUsername,
            vip_level: 999,
            vip_expires_at: null,
            is_verified: true,
            email_verified: 1,
            is_built_in: 0,
            password_changed_at: now,
            updated_at: now,
          });
          adminCreated = true;
          adminEmailFinal = adminEmail;
        } else {
          // INSERT 新管理员（与 seedProvisionalAdminIfEmpty 旧风格对齐，但 is_built_in=0
          //   + password_changed_at=now 标记已初始化）
          const adminUserId = crypto.randomUUID();
          await db('users').insert({
            id: adminUserId,
            email: adminEmail,
            username: adminUsername,
            password_hash: newHash,
            // v4.17.0 多角色字段：roles=[server_admin], active_role=server_admin
            // v4.28.0 全员服主：管理员角色集合补齐 instance_admin + user
            roles: JSON.stringify(universalRolesFor(Role.SERVER_ADMIN)),
            active_role: Role.SERVER_ADMIN,
            status: 'active',
            display_name: adminDisplayName || adminUsername,
            vip_level: 999, // admin 不受限（与原 seedProvisionalAdminIfEmpty 一致）
            vip_expires_at: null,
            // is_verified=true：管理员账号无需邮箱验证（首管理员场景）
            is_verified: true,
            // v4.18.0: email_verified 字段同步设为 1，避免 /login 路由的 require_email_verify 门控
            email_verified: 1,
            // is_built_in=0：生产管理员可改邮箱/密码/删除（与演示模式 is_built_in=1 区分）
            is_built_in: 0,
            // password_changed_at=now：标记已初始化（避免 admin.expiry_days 误判过期）
            password_changed_at: now,
            last_login_at: null,
            last_login_ip: null,
            created_at: now,
            updated_at: now,
          });
          adminCreated = true;
          adminEmailFinal = adminEmail;
        }
      }

      // 3. v4.22.0: Pack 来源执行（pack_source 优先于 enabled_packs）
      //   - pack_source.source='github': 提交时再次同步（确保最终状态一致；Step 6 测试时已同步过，
      //     这里幂等再跑一次以应对"用户在 Step 6 同步后又改了 ref"等边界情况）
      //   - pack_source.source='custom-url': 同上，再次同步
      //   - pack_source.source='upload': 不再重复解压（Step 6 已解压），仅设置 enabled_packs=[]
      //     （即"全部启用"，让上传的 pack 自动生效）
      //   - pack_source.source='skip': enabled_packs=[] 即"全部启用"，但此时通常 packsDir 为空
      //   - 未提供 pack_source: 回退到 enabled_packs 字段（旧契约，向后兼容）
      let packSyncFinalCount = 0;
      let packSyncError: string | null = null;
      if (packSource) {
        const packSyncService = req.app.locals.packSyncService as PackSyncService | undefined;
        if (packSource.source === 'github' || packSource.source === 'custom-url') {
          if (!packSyncService) {
            // 服务未注入——记录错误但不阻断（避免阻塞整个向导流程）
            packSyncError = 'packSyncService 未注入 app.locals，Pack 同步被跳过';
            console.warn(`[setup-wizard] ${packSyncError}`);
          } else {
            try {
              const syncResult =
                packSource.source === 'github'
                  ? await packSyncService.syncFromGithub(
                      packSource.github_repo!.trim(),
                      (packSource.github_ref ?? 'main').trim() || 'main',
                    )
                  : await packSyncService.syncFromUrl(packSource.custom_url!.trim());
              if (!syncResult.ok) {
                // 同步失败 → 400（向导要求用户修复后重试）
                const errBody: PanelErrorResponse = {
                  error: {
                    code: 'PANEL_VALIDATION_ERROR',
                    message: `Pack 同步失败: ${syncResult.error ?? '未知错误'}`,
                  },
                };
                res.status(400).json(errBody);
                return;
              }
              packSyncFinalCount = syncResult.synced_count ?? 0;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const errBody: PanelErrorResponse = {
                error: {
                  code: 'PANEL_VALIDATION_ERROR',
                  message: `Pack 同步异常: ${message}`,
                },
              };
              res.status(400).json(errBody);
              return;
            }
          }
        }
        // pack_source 提供时，统一将 games.enabled_packs 设为 '[]'（全部启用）
        //   - upload/skip 模式：用户已选定来源，全部启用已同步/已上传的 pack
        //   - github/custom-url 模式：同步已覆盖 packs/，全部启用让用户后续在 Pack 管理页精细控制
        await service.setValue('games.enabled_packs', JSON.stringify([]));
      } else {
        // 旧契约：未提供 pack_source，使用 enabled_packs 字段（空数组=全部启用）
        await service.setValue('games.enabled_packs', JSON.stringify(enabledPacks));
      }

      // 4. v4.18.0: 写入 system.mode（若提供；未提供则默认 production）
      const finalMode = body.mode ?? 'production';
      await service.setValue('system.mode', finalMode);

      // 5. v4.18.0: 标记 preflight 通过（避免下次访问 /setup 又进入向导）
      await service.setValue('system.preflight_passed', 'true');

      // ----- v4.20.0: 生成 restart_token（若 env_updated=true）-----
      // 仅当 .env 被写入时才需要重启 Panel 后端（让新配置生效）
      // 否则返回 env_updated=false，前端直接跳转登录页
      let restartToken: string | undefined;
      if (envUpdated) {
        const restartService = req.app.locals.restartService as RestartService | undefined;
        if (restartService) {
          restartToken = restartService.issueToken();
        } else {
          // restartService 未注入——记录警告，前端需提示用户手动重启
          console.warn('[setup-wizard] restartService 未注入 app.locals，无法生成 restart_token；用户需手动重启 Panel');
        }
      }

      res.json({
        initialized: true,
        site_name: siteName,
        // v4.22.0: 字段语义从"是否更新默认 admin 密码"改为"是否创建首管理员账号"
        //   旧值含义：defaultAdmin !== undefined（找到 admin@local.dev 并更新密码）
        //   新值含义：adminCreated（INSERT 新用户成功）
        //   字段名保留 admin_password_updated 以向后兼容前端（前端用此字段判断向导是否完成管理员配置）
        admin_password_updated: adminCreated,
        enabled_packs: enabledPacks,
        admin_email: adminEmailFinal,
        mode: finalMode,
        // v4.20.0 新增字段
        env_updated: envUpdated,
        env_update_error: envUpdateError,
        nodes_added: nodesAdded,
        // v4.22.2: 始终返回 restart_required（与 demo 路径对齐），避免前端误判
        //   - env_updated=true：需重启（即使 restartService 未注入，前端也应展示手动重启指引）
        //   - env_updated=false：无需重启，前端直接跳转登录页
        restart_required: envUpdated,
        restart_token: restartToken,
        // v4.22.0 新增字段：Pack 同步结果（pack_source 提供时返回）
        pack_synced_count: packSyncFinalCount,
        pack_sync_error: packSyncError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // schema 校验失败返回 400
      if (message.includes('必须为') || message.includes('不能小于') || message.includes('不能大于') || message.includes('未知的设置项')) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message },
        };
        res.status(400).json(errBody);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.20.0: POST /api/init/test-database — 测试数据库连接
  //
  // 公开接口（无需鉴权），向导内用户填写连接串后实时验证。
  // 不写入 .env，不修改任何状态，纯只读测试。
  // ----------------------------------------------------------------
  router.post('/test-database', async (req, res) => {
    try {
      const databaseTestService = req.app.locals.databaseTestService as DatabaseTestService | undefined;
      if (!databaseTestService) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_INTERNAL_ERROR',
            message: 'databaseTestService 未注入 app.locals',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      const body = req.body as TestDatabaseConnectionRequest;
      const result: TestDatabaseConnectionResponse = await databaseTestService.testConnection(body);
      res.json(result);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.22.0: POST /api/init/test-daemon — 测试 Daemon 连接
  //
  // 公开接口（无需鉴权），向导内用户粘贴导入链接或手动输入 Daemon 地址后调用。
  // 不写入 nodes 表，不修改任何状态，纯只读测试。
  //
  // 实现细节：
  //   - 用 node 原生 fetch（Node 18+ 内置）调用 http://<fqdn>:<port>/health
  //   - 携带 Authorization: Bearer <token>，daemon /health 当前无需鉴权但仍透传头部
  //   - 超时 5 秒（与前端体验对齐）
  //   - 测量 latency_ms（Date.now() 差值）
  //   - daemon /health 响应含 version 字段时透传为 daemon_version
  // ----------------------------------------------------------------
  router.post('/test-daemon', async (req, res) => {
    try {
      const body = req.body as Partial<TestDaemonConnectionRequest>;
      const fqdn = typeof body?.fqdn === 'string' ? body.fqdn.trim() : '';
      const port = typeof body?.port === 'number' ? body.port : Number(body?.port);
      const token = typeof body?.token === 'string' ? body.token : '';

      if (!fqdn) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'fqdn 不能为空' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'port 必须为 1-65535 的整数' },
        };
        res.status(400).json(errBody);
        return;
      }
      if (!token) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'token 不能为空' },
        };
        res.status(400).json(errBody);
        return;
      }

      // 仅允许 IP/FQDN，禁止携带 scheme（避免构造出非 http 链接）
      const safeHost = fqdn.replace(/^[a-z]+:\/\//i, '').split('/')[0];
      const url = `http://${safeHost}:${port}/health`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const startMs = Date.now();
      try {
        const upstream = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - startMs;
        clearTimeout(timer);

        if (!upstream.ok) {
          const result: TestDaemonConnectionResponse = {
            ok: false,
            latency_ms: latencyMs,
            error: `Daemon 返回 HTTP ${upstream.status}`,
          };
          res.json(result);
          return;
        }
        // 解析响应体（容忍非 JSON 响应）
        let daemonVersion: string | undefined;
        try {
          const data = (await upstream.json()) as { version?: string; status?: string };
          if (typeof data.version === 'string') {
            daemonVersion = data.version;
          }
        } catch {
          // daemon 返回非 JSON（如纯文本），忽略版本字段
        }
        const result: TestDaemonConnectionResponse = {
          ok: true,
          latency_ms: latencyMs,
          ...(daemonVersion ? { daemon_version: daemonVersion } : {}),
        };
        res.json(result);
      } catch (err) {
        clearTimeout(timer);
        const latencyMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        // 区分超时 vs 拒绝连接
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const result: TestDaemonConnectionResponse = {
          ok: false,
          latency_ms: latencyMs,
          error: isAbort ? `连接超时（5s）：${safeHost}:${port}` : `无法连接到 Daemon：${message}`,
        };
        res.json(result);
      }
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.22.1: POST /api/init/auto-detect-local-daemon — 自动检测本机 Daemon
  //
  // 公开接口（无需鉴权），向导 Step 3 本机模式加载时自动调用。
  //
  // 实现逻辑：
  //   1. 解析 daemon/.env 路径（panel/backend/ → ../../daemon/.env）
  //      兼容部署目录（/opt/gameserver-panel/panel/backend/）和开发目录
  //   2. 读取 .env 文件，解析 DAEMON_TOKEN 和 PORT
  //   3. 调用 http://127.0.0.1:<port>/health 验证可达性
  //   4. 成功时返回 { ok, daemon_token, port, daemon_version, latency_ms }
  //      失败时返回 { ok=false, error, env_path }
  //
  // 安全性：
  //   - 仅读取本机 daemon/.env（路径写死为相对 panel/backend/ 的 ../../daemon/.env）
  //   - 不接受外部参数，不暴露任意文件读取能力
  //   - daemon_token 仅在 ok=true 时返回（用户已通过向导场景下的合法访问）
  // ----------------------------------------------------------------
  router.post('/auto-detect-local-daemon', async (_req, res) => {
    try {
      // 解析 daemon/.env 路径
      // panel/backend/ 的 cwd → ../../daemon/.env
      // 部署目录：/opt/gameserver-panel/panel/backend/ → /opt/gameserver-panel/daemon/.env
      // 开发目录：/home/airxw/.../panel/backend/ → /home/airxw/.../daemon/.env
      const daemonEnvPath = path.resolve(process.cwd(), '../../daemon/.env');

      // 1. 检查文件存在性
      if (!fs.existsSync(daemonEnvPath)) {
        const result: AutoDetectLocalDaemonResponse = {
          ok: false,
          error: `Daemon 配置文件不存在：${daemonEnvPath}（请确认 Daemon 已部署）`,
          env_path: daemonEnvPath,
        };
        res.json(result);
        return;
      }

      // 2. 读取并解析 .env
      let daemonToken = '';
      let daemonPort = 8080;
      try {
        const content = await fs.promises.readFile(daemonEnvPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          if (key === 'DAEMON_TOKEN') daemonToken = value;
          else if (key === 'PORT') {
            const parsed = parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
              daemonPort = parsed;
            }
          }
        }
      } catch (err) {
        const result: AutoDetectLocalDaemonResponse = {
          ok: false,
          error: `读取 Daemon 配置失败：${err instanceof Error ? err.message : String(err)}`,
          env_path: daemonEnvPath,
        };
        res.json(result);
        return;
      }

      if (!daemonToken) {
        const result: AutoDetectLocalDaemonResponse = {
          ok: false,
          error: `Daemon 配置中未找到 DAEMON_TOKEN（请检查 ${daemonEnvPath}）`,
          env_path: daemonEnvPath,
        };
        res.json(result);
        return;
      }

      // 3. 探测 daemon /health
      const url = `http://127.0.0.1:${daemonPort}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const startMs = Date.now();
      try {
        const upstream = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${daemonToken}` },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - startMs;
        clearTimeout(timer);

        if (!upstream.ok) {
          const result: AutoDetectLocalDaemonResponse = {
            ok: false,
            port: daemonPort,
            env_path: daemonEnvPath,
            latency_ms: latencyMs,
            error: `Daemon 返回 HTTP ${upstream.status}（请检查 systemd 服务状态）`,
          };
          res.json(result);
          return;
        }
        // 解析版本号
        let daemonVersion: string | undefined;
        try {
          const data = (await upstream.json()) as { version?: string };
          if (typeof data.version === 'string') {
            daemonVersion = data.version;
          }
        } catch {
          // 非 JSON 响应，忽略版本字段
        }
        const result: AutoDetectLocalDaemonResponse = {
          ok: true,
          daemon_token: daemonToken,
          port: daemonPort,
          daemon_version: daemonVersion,
          latency_ms: latencyMs,
          env_path: daemonEnvPath,
        };
        res.json(result);
      } catch (err) {
        clearTimeout(timer);
        const latencyMs = Date.now() - startMs;
        const message = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const result: AutoDetectLocalDaemonResponse = {
          ok: false,
          port: daemonPort,
          env_path: daemonEnvPath,
          latency_ms: latencyMs,
          error: isAbort
            ? `Daemon 连接超时（5s）——Daemon 服务可能未启动，请执行 systemctl status gameserver-daemon 检查`
            : `无法连接到 Daemon（${message}）——请确认 Daemon 服务已启动`,
        };
        res.json(result);
      }
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.20.0: POST /api/init/restart — 触发 Panel 后端重启
  //
  // 公开接口（无需鉴权），但需一次性 restart_token（由 POST /api/init 返回）。
  // 触发后 Panel 后端进程被 systemd 杀掉并重启，新 .env 配置生效。
  // ----------------------------------------------------------------
  router.post('/restart', async (req, res) => {
    try {
      const restartService = req.app.locals.restartService as RestartService | undefined;
      if (!restartService) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_INTERNAL_ERROR',
            message: 'restartService 未注入 app.locals',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      const body = req.body as RestartTriggerRequest;
      if (!body.restart_token || typeof body.restart_token !== 'string') {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: '缺少 restart_token 字段' },
        };
        res.status(400).json(errBody);
        return;
      }

      const result: RestartTriggerResponse = restartService.triggerRestart(body.restart_token);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // token 无效/已使用/已过期 → 400
      if (message.includes('restart_token')) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message },
        };
        res.status(400).json(errBody);
        return;
      }
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.22.0: POST /api/init/packs/sync — 同步 Pack（GitHub / 自定义 URL）
  //
  // 公开接口（无需鉴权），向导内"Pack 配置"步骤调用。
  // 接收 { source, github_repo?, github_ref?, custom_url? }：
  //   - source='github'：调 packSyncService.syncFromGithub(github_repo, github_ref)
  //   - source='custom-url'：调 packSyncService.syncFromUrl(custom_url)
  //   - source='upload' / 'skip'：返回 400（upload 应走 /init/packs/upload；skip 无需同步）
  //
  // 闭合判据（rules-0 §四-13）：本路由是 packSyncService 接入运行时的入口之一，
  // 与 /init/packs/upload 共同承担 Pack 同步能力暴露。若缺失则前端 SetupWizard
  // PackStep 的 GitHub/自定义 URL Tab 调用 syncPacks() 必然 404。
  // ----------------------------------------------------------------
  router.post('/packs/sync', async (req, res) => {
    try {
      const packSyncService = req.app.locals.packSyncService as PackSyncService | undefined;
      if (!packSyncService) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_INTERNAL_ERROR',
            message: 'packSyncService 未注入 app.locals',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      const body = req.body as Partial<SyncPacksRequest>;
      const source = body?.source;
      if (source !== 'github' && source !== 'custom-url') {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_VALIDATION_ERROR',
            message: `source 必须为 'github' 或 'custom-url'（upload 请走 /init/packs/upload，skip 无需同步），实际: ${source}`,
          },
        };
        res.status(400).json(errBody);
        return;
      }

      let result: SyncPacksResponse;
      if (source === 'github') {
        const repo = typeof body.github_repo === 'string' ? body.github_repo.trim() : '';
        const ref = typeof body.github_ref === 'string' ? body.github_ref.trim() : 'main';
        if (!repo) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'github_repo 不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
        const syncResult = await packSyncService.syncFromGithub(repo, ref);
        result = {
          ok: syncResult.ok,
          synced_count: syncResult.synced_count,
          packs: syncResult.packs,
          error: syncResult.error,
        };
      } else {
        // source === 'custom-url'
        const url = typeof body.custom_url === 'string' ? body.custom_url.trim() : '';
        if (!url) {
          const errBody: PanelErrorResponse = {
            error: { code: 'PANEL_VALIDATION_ERROR', message: 'custom_url 不能为空' },
          };
          res.status(400).json(errBody);
          return;
        }
        const syncResult = await packSyncService.syncFromUrl(url);
        result = {
          ok: syncResult.ok,
          synced_count: syncResult.synced_count,
          packs: syncResult.packs,
          error: syncResult.error,
        };
      }

      // 同步失败时返回 400（让前端展示错误信息）；成功返回 200
      if (!result.ok) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: result.error ?? 'Pack 同步失败' },
        };
        res.status(400).json(errBody);
        return;
      }
      res.json(result);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  // ----------------------------------------------------------------
  // v4.22.0: POST /api/init/packs/upload — 上传 Pack zip（multipart/form-data）
  //
  // 公开接口（无需鉴权），向导内"Pack 配置 > 上传"步骤调用。
  // 接收 multipart/form-data，字段名 'pack'（单文件，最大 50MB）。
  // 调 packSyncService.uploadZip(buffer, originalname) 解压并验证 pack.yaml。
  //
  // 闭合判据（rules-0 §四-13）：本路由是 packSyncService 接入运行时的入口之一，
  // 与 /init/packs/sync 共同承担 Pack 同步能力暴露。若缺失则前端 SetupWizard
  // PackStep 的上传 Tab 调用 uploadPack() 必然 404。
  // ----------------------------------------------------------------
  router.post('/packs/upload', packUploadMulter.single('pack'), async (req, res) => {
    try {
      const packSyncService = req.app.locals.packSyncService as PackSyncService | undefined;
      if (!packSyncService) {
        const errBody: PanelErrorResponse = {
          error: {
            code: 'PANEL_INTERNAL_ERROR',
            message: 'packSyncService 未注入 app.locals',
          },
        };
        res.status(503).json(errBody);
        return;
      }

      if (!req.file) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: "未收到上传文件（字段名应为 'pack'）" },
        };
        res.status(400).json(errBody);
        return;
      }

      const { buffer, originalname } = req.file;
      const uploadResult = await packSyncService.uploadZip(buffer, originalname);
      const response: UploadPackResponse = {
        ok: uploadResult.ok,
        upload_id: uploadResult.upload_id,
        pack_id: uploadResult.pack_id,
        error: uploadResult.error,
      };

      if (!response.ok) {
        const errBody: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: response.error ?? 'Pack 上传失败' },
        };
        res.status(400).json(errBody);
        return;
      }
      res.json(response);
    } catch (err) {
      handleInternal(res, err);
    }
  });

  return router;
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function handleInternal(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `内部错误: ${message}` },
  };
  res.status(500).json(body);
}
