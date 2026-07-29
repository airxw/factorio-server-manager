// ============================================================================
// SetupWizard — v4.20.0 Setup Wizard v2 首启动初始化引导向导
//
// 8 步流程（方案 docs/plans/setup-wizard-v2-configuration-plan.md §4.1）：
//   Step 0: 环境预检（调 GET /api/init/preflight，展示 8 项检查；warn 不阻塞）
//   Step 1: 运行模式选择（v4.21.0 改为可点击选择，提交时写入 .env 重启生效）
//   Step 2: 数据库连接配置（新增：SQLite/MySQL/PostgreSQL 选择 + 测试连接）
//   Step 3: Daemon 节点配置（新增：添加节点 / 单机模式）
//   Step 4: 站点信息 + 公网入口（合并：site.name + PUBLIC_BASE_URL）
//   Step 5: 管理员账号（邮箱/用户名/密码，实时校验 + 禁用弱密码）
//   Step 6: 启用游戏 Pack
//   Step 7: 完成 + 重启（触发 systemctl restart，轮询健康检查，跳转登录）
//
// 路由：/setup（公开，未登录可访问）
// 门控：访问前先调 GET /api/init/status，needs_init=false 时跳转 /login
// 提交：POST /api/init 一次性提交所有字段，成功后进入 Step 7 触发重启
//
// v4.20.0 改造点：
//   1. 移除 Step 0 dbConfigAck 强制勾选（warn 项不再阻塞，提示"可在后续步骤配置"）
//   2. 新增 Step 2 数据库连接配置（DatabaseConfigStep 组件）
//   3. 新增 Step 3 Daemon 节点配置（DaemonNodeStep 组件）
//   4. Step 4 合并公网入口配置（SiteInfoStep 组件）
//   5. Step 7 新增重启流程（RestartStep 组件）
//   6. 提交时一次性发送 database / daemon_nodes / public_base_url / skip_daemon
//   7. 提交成功后若返回 restart_token，进入 Step 7 触发重启
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Rocket,
  XCircle,
} from 'lucide-react';
import { PanelApiError, createApiClient } from '../api/client';
import type {
  DatabaseType,
  InitPreflightCheck,
  InitPreflightResponse,
  InitSubmitResponse,
  PackSourceType,
  PackSummary,
  PackSyncConfig,
  PasswordPolicyResponse,
  SyncPacksResponse,
  TestDaemonConnectionResponse,
  TestDatabaseConnectionResponse,
} from '@public/schema/panel-api-types';
import type { DaemonNodeInput } from '@public/schema/panel-api-types';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { LoadingButton, useToast } from '../components/ui';
import { getBuildFooterText } from '../utils/buildFooterText';
import DatabaseConfigStep from './setup/DatabaseConfigStep';
import DaemonNodeStep, {
  LOCAL_DEFAULTS,
  parseDaemonImportLink,
  type DaemonMode,
  type DaemonNodeDraft,
} from './setup/DaemonNodeStep';
import SiteInfoStep, { validatePublicBaseUrl } from './setup/SiteInfoStep';
import RestartStep from './setup/RestartStep';
// v4.22.0: 拆分 Step 5/6 为独立组件
import AdminStep, { validateAdminStep } from './setup/AdminStep';
import PackStep from './setup/PackStep';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export default function SetupWizard() {
  useDocumentTitle('初始化向导');
  const navigate = useNavigate();
  const toast = useToast();
  // 直接用匿名 api client（首启动时未登录），避免 useAuth 的 onUnauthorized 触发跳登录
  const anonymousApi = useMemo(() => createApiClient({ token: null }), []);

  const [statusLoading, setStatusLoading] = useState(true);
  const [needsInit, setNeedsInit] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [submitting, setSubmitting] = useState(false);

  // Step 0: 环境预检
  const [preflight, setPreflight] = useState<InitPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  // Step 1: 运行模式（只读，从 preflight 获取）
  const [currentMode, setCurrentMode] = useState<'demo' | 'production'>('production');

  // Step 2: 数据库连接配置
  const [dbType, setDbType] = useState<DatabaseType>('sqlite');
  const [dbUrl, setDbUrl] = useState('./data/panel.db');
  const [dbTested, setDbTested] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<TestDatabaseConnectionResponse | null>(null);
  const [dbTesting, setDbTesting] = useState(false);
  // v4.22.1: SQLite 警告确认状态（提交时附带 database_ack 字段）
  const [dbAck, setDbAck] = useState(false);

  // Step 3: Daemon 节点配置（v4.22.0 重构：local/multi/skip 三模式）
  //   - local : 本机单节点模式（默认推荐）— 127.0.0.1:8080 + 自动读取 daemon/.env DAEMON_TOKEN
  //   - multi : 多节点模式 — 通过 deploy-daemon.sh 部署独立 Daemon 后导入链接
  //   - skip  : 暂不配置 — 跳过 Daemon 配置（旧"单机模式"语义）
  const [daemonMode, setDaemonMode] = useState<DaemonMode>('local');
  // local 模式状态
  const [localDaemonToken, setLocalDaemonToken] = useState('');
  const [localTestResult, setLocalTestResult] = useState<TestDaemonConnectionResponse | null>(null);
  const [localTesting, setLocalTesting] = useState(false);
  const [localTested, setLocalTested] = useState(false);
  // v4.22.1: 自动检测错误状态（auto-detect 失败时展示给用户）
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [autoDetectEnvPath, setAutoDetectEnvPath] = useState<string | null>(null);
  // multi 模式状态
  const [daemonNodes, setDaemonNodes] = useState<DaemonNodeDraft[]>([]);
  const [importLink, setImportLink] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importTestResult, setImportTestResult] = useState<TestDaemonConnectionResponse | null>(null);

  // Step 4: 站点信息 + 公网入口
  const [siteName, setSiteName] = useState('GameServer Panel');
  const [publicBaseUrl, setPublicBaseUrl] = useState('');

  // Step 5: 管理员账号
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  // v4.22.0: 新增昵称字段（对应 users.display_name）
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicyResponse | null>(null);
  const [submitError, setSubmitError] = useState<string[] | null>(null);

  // Step 6: 启用的 packs
  // v4.22.0: 改为四种来源 Tab 切换（github / custom-url / upload / skip）
  const [packSource, setPackSource] = useState<PackSourceType>('github');
  const [packGithubRepo, setPackGithubRepo] = useState('airxw/GSP-Panel');
  const [packGithubRef, setPackGithubRef] = useState('main');
  const [packCustomUrl, setPackCustomUrl] = useState('');
  const [packUploadId, setPackUploadId] = useState('');
  const [syncedPacks, setSyncedPacks] = useState<PackSummary[]>([]);
  const [packSyncing, setPackSyncing] = useState(false);
  const [packSyncResult, setPackSyncResult] = useState<SyncPacksResponse | null>(null);
  const [packSyncError, setPackSyncError] = useState<string | null>(null);

  // Step 7: 重启
  const [restartToken, setRestartToken] = useState<string>('');
  // v4.22.2: 是否需要重启（由 initResp.restart_required 传入）
  const [restartRequired, setRestartRequired] = useState<boolean>(false);

  // ----- 首启动状态检查 -----
  // v4.21.0: 移除构建时 VITE_ENABLE_DEMO 检查，改用 API 返回的 mode 字段
  //   后端 GET /api/init/status 现在返回 { needs_init, mode }
  //   demo 模式下 needs_init 恒为 false（detectInitStatus 短路），自然跳转登录
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await anonymousApi.getInitStatus();
        if (cancelled) return;
        setNeedsInit(res.needs_init);
        if (res.mode === 'demo') {
          setCurrentMode('demo');
        } else {
          setCurrentMode('production');
        }
      } catch {
        if (cancelled) return;
        // 接口不可用时保守视为"已初始化"，避免阻塞用户登录
        setNeedsInit(false);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anonymousApi]);

  // ----- Step 0: 拉取 preflight -----
  const loadPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setPreflightError(null);
    try {
      const res = await anonymousApi.getInitPreflight();
      setPreflight(res);
      // 从 preflight checks 中提取当前模式（mode 检查项的 detail 含"演示模式"/"生产模式"）
      const modeCheck = res.checks.find((c) => c.key === 'mode');
      if (modeCheck?.detail.includes('演示模式')) {
        setCurrentMode('demo');
      } else {
        setCurrentMode('production');
      }
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '环境预检失败';
      setPreflightError(msg);
    } finally {
      setPreflightLoading(false);
    }
  }, [anonymousApi]);

  useEffect(() => {
    if (step === 0 && !preflight && !preflightLoading) {
      void loadPreflight();
    }
  }, [step, preflight, preflightLoading, loadPreflight]);

  // ----- Step 5: 拉取密码策略 -----
  const loadPasswordPolicy = useCallback(async () => {
    if (passwordPolicy) return;
    try {
      const res = await anonymousApi.getPasswordPolicy();
      setPasswordPolicy(res);
    } catch {
      // 拉取失败不阻塞——后端会做最终校验
    }
  }, [anonymousApi, passwordPolicy]);

  useEffect(() => {
    if (step === 5) {
      void loadPasswordPolicy();
    }
  }, [step, loadPasswordPolicy]);

  // v4.22.0: Step 6 不再预加载本地 packs 列表——改为 PackStep Tab 切换四种来源，
  //   用户选择来源后通过 onSync / onFileSelected 触发同步或上传。

  // ----- Step 2: 测试数据库连接 -----
  const handleTestDatabase = useCallback(async () => {
    if (dbTesting) return;
    setDbTesting(true);
    setDbTestResult(null);
    setDbTested(false);
    try {
      const result = await anonymousApi.testDatabaseConnection({ type: dbType, url: dbUrl.trim() });
      setDbTestResult(result);
      setDbTested(result.ok);
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '测试连接请求失败';
      setDbTestResult({ ok: false, error: msg });
      setDbTested(false);
    } finally {
      setDbTesting(false);
    }
  }, [anonymousApi, dbType, dbUrl, dbTesting]);

  // ----- Step 2: 切换数据库类型时重置测试状态 -----
  // v4.21.1: MySQL/PostgreSQL 默认 URL 与 DatabaseConfigStep 内部 DEFAULTS 对齐
  //   （无密码、默认 user=root/postgres），由子组件 parseUrl 回填结构化字段
  // v4.22.1: 切换类型时同时重置 dbAck（仅 SQLite 需要 ack）
  const handleDbTypeChange = useCallback((type: DatabaseType) => {
    setDbType(type);
    setDbTested(false);
    setDbTestResult(null);
    setDbAck(false);
    if (type === 'sqlite') {
      setDbUrl('./data/panel.db');
    } else if (type === 'mysql') {
      setDbUrl('mysql://root@127.0.0.1:3306/gameserver_panel');
    } else {
      setDbUrl('postgresql://postgres@127.0.0.1:5432/gameserver_panel');
    }
  }, []);

  // ----- Step 2: 修改连接串时重置测试状态 -----
  const handleDbUrlChange = useCallback((url: string) => {
    setDbUrl(url);
    setDbTested(false);
    setDbTestResult(null);
  }, []);

  // ----- Step 2: 恢复 SQLite 默认 -----
  const handleDbResetDefault = useCallback(() => {
    setDbType('sqlite');
    setDbUrl('./data/panel.db');
    setDbTested(false);
    setDbTestResult(null);
    setDbAck(false);
  }, []);

  // ----- Step 6: Pack 同步（GitHub / 自定义 URL） -----
  const handlePackSync = useCallback(async () => {
    if (packSyncing) return;
    setPackSyncing(true);
    setPackSyncResult(null);
    setPackSyncError(null);
    try {
      let req;
      if (packSource === 'github') {
        req = {
          source: 'github' as const,
          github_repo: packGithubRepo.trim(),
          github_ref: packGithubRef.trim() || 'main',
        };
      } else if (packSource === 'custom-url') {
        req = {
          source: 'custom-url' as const,
          custom_url: packCustomUrl.trim(),
        };
      } else {
        // upload / skip 不走同步
        return;
      }
      const result = await anonymousApi.syncPacks(req);
      setPackSyncResult(result);
      if (result.ok && result.packs) {
        setSyncedPacks(result.packs);
      }
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '同步 Pack 失败';
      setPackSyncError(msg);
    } finally {
      setPackSyncing(false);
    }
  }, [anonymousApi, packSyncing, packSource, packGithubRepo, packGithubRef, packCustomUrl]);

  // ----- Step 6: Pack 上传 zip -----
  const handlePackUpload = useCallback(
    async (file: File) => {
      setPackSyncing(true);
      setPackSyncError(null);
      setPackSyncResult(null);
      try {
        const result = await anonymousApi.uploadPack(file);
        if (result.ok && result.upload_id) {
          setPackUploadId(result.upload_id);
          // 上传成功后立即拉取已同步列表（单 pack）
          if (result.pack_id) {
            // 后端返回 pack_id 时，直接展示
            setSyncedPacks([
              {
                id: result.pack_id,
                display_name: file.name.replace(/\.zip$/i, ''),
                game: 'unknown',
                variant: 'unknown',
                version: '0.0.0',
              },
            ]);
          }
        } else {
          setPackSyncError(result.error ?? '上传失败');
        }
      } catch (err) {
        const msg = err instanceof PanelApiError ? err.message : '上传 Pack 失败';
        setPackSyncError(msg);
      } finally {
        setPackSyncing(false);
      }
    },
    [anonymousApi],
  );

  // ----- Step 3: Daemon 节点配置回调 -----
  // v4.22.1: 三模式 + 自动检测本机 Daemon + 导入链接解析

  /** 切换 Daemon 模式：清空当前模式的临时状态（测试结果/错误），但保留已添加的节点列表 */
  const handleDaemonModeChange = useCallback((mode: DaemonMode) => {
    setDaemonMode(mode);
    // 切换模式时清空测试结果与错误（避免跨模式残留误导）
    setLocalTestResult(null);
    setLocalTested(false);
    setLocalDaemonToken('');
    setAutoDetectError(null);
    setAutoDetectEnvPath(null);
    setImportError(null);
    setImportTestResult(null);
  }, []);

  /** v4.22.1: 本机模式自动检测本机 Daemon
   *  流程：调 POST /api/init/auto-detect-local-daemon
   *       → 后端读取 daemon/.env 的 DAEMON_TOKEN + 探测 /health
   *       → 成功时自动填入 localToken 并标记 localTested=true
   *       → 失败时展示 autoDetectError 引导用户修复 */
  const handleAutoDetectLocalDaemon = useCallback(async () => {
    if (localTesting) return;
    setLocalTesting(true);
    setLocalTestResult(null);
    setLocalTested(false);
    setAutoDetectError(null);
    setAutoDetectEnvPath(null);
    try {
      const result = await anonymousApi.autoDetectLocalDaemon();
      if (result.ok && result.daemon_token) {
        // 自动检测成功——填入 token 并标记已测试通过
        setLocalDaemonToken(result.daemon_token);
        setLocalTestResult({
          ok: true,
          latency_ms: result.latency_ms,
          ...(result.daemon_version ? { daemon_version: result.daemon_version } : {}),
        });
        setLocalTested(true);
      } else {
        // 自动检测失败——展示错误信息
        setAutoDetectError(result.error ?? '未知错误');
        if (result.env_path) {
          setAutoDetectEnvPath(result.env_path);
        }
      }
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '自动检测请求失败';
      setAutoDetectError(msg);
    } finally {
      setLocalTesting(false);
    }
  }, [anonymousApi, localTesting]);

  /** 本机模式：测试连接（保留 v4.22.0 接口，现在由 auto-detect 接管）
   *  v4.22.1: handleTestLocalDaemon 改为代理调用 auto-detect */
  const handleTestLocalDaemon = useCallback(async () => {
    await handleAutoDetectLocalDaemon();
  }, [handleAutoDetectLocalDaemon]);

  // v4.22.1: Step 3 进入本机模式时自动触发 auto-detect（无需用户手动点击）
  //   仅在 daemonMode='local' 且尚未测试时触发，避免重复请求
  //   注意：此 useEffect 必须在 handleAutoDetectLocalDaemon 定义之后，
  //         否则依赖数组会引用 TDZ 中的变量导致运行时 ReferenceError。
  useEffect(() => {
    if (step === 3 && daemonMode === 'local' && !localTested && !localTesting && !autoDetectError) {
      void handleAutoDetectLocalDaemon();
    }
  }, [step, daemonMode, localTested, localTesting, autoDetectError, handleAutoDetectLocalDaemon]);

  /** 多节点模式：修改导入链接时清空错误与测试结果 */
  const handleImportLinkChange = useCallback((link: string) => {
    setImportLink(link);
    setImportError(null);
    setImportTestResult(null);
  }, []);

  /** 多节点模式：测试连接并导入节点
   *  流程：解析链接 → 调 test-daemon 测试 → 通过则加入 daemonNodes 列表 */
  const handleTestAndImport = useCallback(async () => {
    if (importing) return;
    setImportError(null);
    setImportTestResult(null);
    const parsed = parseDaemonImportLink(importLink);
    if ('error' in parsed) {
      setImportError(parsed.error);
      return;
    }
    setImporting(true);
    try {
      const result = await anonymousApi.testDaemonConnection({
        fqdn: parsed.fqdn,
        port: parsed.port,
        token: parsed.token,
      });
      setImportTestResult(result);
      if (!result.ok) {
        setImportError(result.error ?? '连接失败');
        return;
      }
      // 测试通过 → 加入节点列表
      // v4.22.3: fqdn 拼装为 host:port 写入数据库，避免后端 getHttpClient
      //   拼成默认端口 80 导致 ECONNREFUSED（DaemonNodeInput schema 无 port 字段，
      //   端口信息必须并入 fqdn）
      const draft: DaemonNodeDraft = {
        draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: parsed.name,
        fqdn: `${parsed.fqdn}:${parsed.port}`,
        daemon_token: parsed.token,
        node_type: parsed.node_type ?? 'master',
        ...(parsed.public_ip ? { public_ip: parsed.public_ip } : {}),
      };
      setDaemonNodes((prev) => [...prev, draft]);
      // 清空输入框，准备导入下一个节点
      setImportLink('');
      toast.success(`节点「${parsed.name}」已加入列表`);
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '测试连接请求失败';
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  }, [anonymousApi, importLink, importing, toast]);

  /** 移除已添加的 Daemon 节点 */
  const handleRemoveNode = useCallback((draftId: string) => {
    setDaemonNodes((prev) => prev.filter((n) => n.draftId !== draftId));
  }, []);

  // ----- 校验 -----
  // Step 0: v4.20.0 移除 dbConfigAck 强制勾选——warn 项不再阻塞，仅 error 阻塞
  const preflightHasError = preflight?.checks.some((c) => c.status === 'error') ?? false;
  const step0Valid = !preflightHasError;

  // Step 2: 测试连接通过
  // v4.22.1: SQLite 类型还需 dbAck=true（生产环境警告确认）
  //   MySQL/PostgreSQL 不需要 dbAck（preflight 不会返回 warn）
  const dbUrlValid = dbUrl.trim().length > 0;
  const step2Valid = dbTested && dbUrlValid && (dbType !== 'sqlite' || dbAck);

  // Step 3: 三模式校验
  //   - local : DAEMON_TOKEN 非空 + 测试通过
  //   - multi : 至少 1 个已导入节点（导入时已测试通过）
  //   - skip  : 直接合法
  const step3Valid =
    daemonMode === 'skip'
      ? true
      : daemonMode === 'local'
        ? localTested && localDaemonToken.trim().length > 0
        : daemonMode === 'multi'
          ? daemonNodes.length > 0
          : false;

  // Step 4: 站点名称 + 公网入口（公网入口允许留空，格式错误才阻塞）
  const step4SiteNameValid = siteName.trim().length > 0 && siteName.trim().length <= 64;
  const step4UrlCheck = validatePublicBaseUrl(publicBaseUrl);
  const step4Valid = step4SiteNameValid && step4UrlCheck.level !== 'error';

  // Step 5: 管理员账号（v4.22.0 用 validateAdminStep 统一校验）
  const adminValidation = validateAdminStep({
    email: adminEmail,
    username: adminUsername,
    displayName: adminDisplayName,
    password: adminPassword,
    passwordConfirm: adminPasswordConfirm,
    passwordPolicy,
  });
  const step5Valid = adminValidation.allValid;

  // Step 6: Pack 来源校验
  //   - skip: 直接合法
  //   - github / custom-url: 需要同步成功（packSyncResult.ok=true）
  //   - upload: 需要 packUploadId 非空
  const step6Valid =
    packSource === 'skip' ||
    (packSource === 'upload' ? packUploadId.trim().length > 0 : packSyncResult?.ok === true);

  // ----- 提交 -----
  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // v4.22.0: pack_source 优先于 enabled_packs
      //   - skip / upload / github / custom-url 均传 enabled_packs=[]（pack_source 接管）
      const packSourceConfig: PackSyncConfig | undefined =
        packSource === 'skip'
          ? undefined
          : packSource === 'upload'
            ? { source: 'upload', upload_id: packUploadId }
            : packSource === 'github'
              ? {
                  source: 'github',
                  github_repo: packGithubRepo.trim(),
                  github_ref: packGithubRef.trim() || 'main',
                }
              : { source: 'custom-url', custom_url: packCustomUrl.trim() };
      // v4.22.0: 根据三模式构造 daemon 提交字段
      //   - local : 提交单条节点（fqdn=127.0.0.1:8080, name=本机节点, daemon_token=用户输入）
      //   - multi : 提交 daemonNodes 列表（导入时已测试通过，fqdn 已含端口）
      //   - skip  : skip_daemon=true（DAEMON_URL 留空）
      // v4.22.3: fqdn 拼装为 host:port，避免后端 getHttpClient 拼成默认端口 80
      //   导致 ECONNREFUSED（DaemonNodeInput schema 无 port 字段，端口信息并入 fqdn）
      const daemonField =
        daemonMode === 'skip'
          ? { skip_daemon: true }
          : daemonMode === 'local'
            ? {
                daemon_nodes: [
                  {
                    name: LOCAL_DEFAULTS.name,
                    fqdn: `${LOCAL_DEFAULTS.fqdn}:${LOCAL_DEFAULTS.port}`,
                    daemon_token: localDaemonToken.trim(),
                    node_type: 'master' as const,
                  },
                ] as DaemonNodeInput[],
              }
            : {
                daemon_nodes: daemonNodes.map(
                  ({ draftId: _id, ...rest }) => rest,
                ) as DaemonNodeInput[],
              };

      // v4.20.0: 一次性提交所有配置字段
      const initResp: InitSubmitResponse = await anonymousApi.submitInit({
        site_name: siteName.trim(),
        admin: {
          password: adminPassword,
          email: adminEmail.trim(),
          username: adminUsername.trim(),
          display_name: adminDisplayName.trim(),
        },
        enabled_packs: [],
        mode: currentMode,
        // v4.22.1: SQLite 类型时附带 database_ack=true（用户已在 Step 2 勾选确认）
        ...(dbType === 'sqlite' ? { database_ack: dbAck } : {}),
        // v4.20.0 新增字段
        database: { type: dbType, url: dbUrl.trim() },
        ...daemonField,
        ...(publicBaseUrl.trim() ? { public_base_url: publicBaseUrl.trim() } : {}),
        ...(packSourceConfig ? { pack_source: packSourceConfig } : {}),
      });
      // 提交成功后，若需要重启则进入 Step 7
      // v4.22.2: 区分三种路径，避免 restart_token 为空时仍调用 triggerRestart
      //   - restart_required=true && restart_token 非空：自动重启路径
      //   - restart_required=true && restart_token 为空：手动重启路径（restartService 未注入）
      //   - restart_required=false：无需重启，但仍进入 Step 7 走"配置已保存"完成态
      setRestartRequired(Boolean(initResp.restart_required));
      if (initResp.restart_token) {
        setRestartToken(initResp.restart_token);
      } else {
        setRestartToken('');
      }
      setStep(7);
    } catch (err) {
      if (err instanceof PanelApiError) {
        // v4.18.0: WEAK_PASSWORD 错误展示 details.failures 全部条目
        const failures = err.details?.failures;
        if (failures && failures.length > 0) {
          setSubmitError(failures);
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('初始化失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ----- 渲染辅助：preflight 检查项状态图标 -----
  const renderCheckStatusIcon = (status: InitPreflightCheck['status']) => {
    if (status === 'ok') return <CheckCircle2 size={18} className="preflight-icon-ok" />;
    if (status === 'warn') return <XCircle size={18} className="preflight-icon-warn" />;
    return <XCircle size={18} className="preflight-icon-error" />;
  };

  // ----- 渲染：加载中 -----
  if (statusLoading) {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <div className="setup-loading">
            <Loader2 size={32} className="spin" />
            <p>正在检查系统状态…</p>
          </div>
        </div>
        <SetupBuildFooter />
      </div>
    );
  }

  // 已初始化 → 跳转登录
  if (needsInit === false) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-header">
          <Rocket size={36} className="setup-header-icon" />
          <h1 className="setup-title">欢迎使用 GameServer Panel</h1>
          <p className="setup-subtitle">首次使用前请完成初始化配置</p>
        </div>

        <SetupStepIndicator currentStep={step} mode={currentMode} />

        {/* Step 0: 环境预检 */}
        {step === 0 && (
          <div className="setup-form">
            <div className="setup-admin-hint">
              <p>
                <AlertCircle size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
                进入初始化前，请确认服务器环境已就绪。
              </p>
              <p className="form-field-hint">
                v4.20.0 起，<span className="preflight-status-warn">警告</span> 项不再阻塞，可在后续步骤中配置；
                <span className="preflight-status-error">错误</span> 项需在服务器 SSH 修复后刷新。
              </p>
            </div>

            {preflightLoading ? (
              <div className="setup-loading">
                <Loader2 size={24} className="spin" />
                <p>正在执行环境预检（8 项检查）…</p>
              </div>
            ) : preflightError ? (
              <div className="setup-empty">
                <p className="form-field-error">{preflightError}</p>
                <LoadingButton
                  type="button"
                  variant="ghost"
                  loading={false}
                  onClick={() => void loadPreflight()}
                >
                  重新检测
                </LoadingButton>
              </div>
            ) : preflight ? (
              <div className="preflight-list">
                {preflight.checks.map((c) => (
                  <div key={c.key} className={`preflight-item preflight-item-${c.status}`}>
                    <div className="preflight-item-icon">{renderCheckStatusIcon(c.status)}</div>
                    <div className="preflight-item-body">
                      <div className="preflight-item-label">{c.label}</div>
                      <div className="preflight-item-detail">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="setup-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void loadPreflight()}
                disabled={preflightLoading}
              >
                刷新预检
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                disabled={!step0Valid}
                onClick={() => setStep(1)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </div>
        )}

        {/* Step 1: 运行模式选择（v4.21.0 改为可点击选择） */}
        {step === 1 && (
          <div className="setup-form">
            <div className="setup-mode-display">
              <button
                type="button"
                className={`setup-mode-card setup-mode-production ${currentMode === 'production' ? 'setup-mode-card-active' : ''}`}
                onClick={() => setCurrentMode('production')}
              >
                <div className="setup-mode-icon">
                  <CheckCircle2 size={28} />
                </div>
                <div className="setup-mode-body">
                  <div className="setup-mode-title">
                    生产模式
                    {currentMode === 'production' && <span className="setup-mode-badge">已选</span>}
                  </div>
                  <div className="setup-mode-desc">
                    仅创建 1 个待初始化的管理员账号 admin@local.dev（可在后续步骤修改邮箱/用户名/密码）。
                  </div>
                </div>
              </button>

              <button
                type="button"
                className={`setup-mode-card setup-mode-demo ${currentMode === 'demo' ? 'setup-mode-card-active' : ''}`}
                onClick={() => setCurrentMode('demo')}
              >
                <div className="setup-mode-icon">
                  <Rocket size={28} />
                </div>
                <div className="setup-mode-body">
                  <div className="setup-mode-title">
                    演示模式
                    {currentMode === 'demo' && <span className="setup-mode-badge">已选</span>}
                  </div>
                  <div className="setup-mode-desc">
                    初始化仅走过场，不真正修改任何数据。演示账号密码保持 admin123。
                  </div>
                </div>
              </button>

              {currentMode === 'demo' && (
                <div className="setup-mode-meta-shared">
                  选择演示模式后，提交时将向 <code>.env</code> 写入 <code>VITE_ENABLE_DEMO=true</code> 并重启服务生效。
                </div>
              )}
              {currentMode === 'production' && (
                <div className="setup-mode-meta-shared">
                  生产模式将完成完整初始化流程（数据库 / Daemon / 站点 / 管理员 / 启用游戏）。
                </div>
              )}
            </div>

            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                onClick={() => setStep(currentMode === 'demo' ? 6 : 2)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </div>
        )}

        {/* Step 2: 数据库连接配置（v4.20.0 新增） */}
        {step === 2 && (
          <>
            <DatabaseConfigStep
              type={dbType}
              url={dbUrl}
              tested={dbTested}
              testResult={dbTestResult}
              testing={dbTesting}
              onTypeChange={handleDbTypeChange}
              onUrlChange={handleDbUrlChange}
              onTest={handleTestDatabase}
              onResetDefault={handleDbResetDefault}
              urlValid={dbUrlValid}
              dbAck={dbAck}
              onDbAckChange={setDbAck}
            />
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                disabled={!step2Valid}
                onClick={() => setStep(3)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </>
        )}

        {/* Step 3: Daemon 节点配置（v4.22.1 重构：本机模式自动检测） */}
        {step === 3 && (
          <>
            <DaemonNodeStep
              mode={daemonMode}
              localTestResult={localTestResult}
              localTesting={localTesting}
              localTested={localTested}
              autoDetectError={autoDetectError}
              autoDetectEnvPath={autoDetectEnvPath}
              nodes={daemonNodes}
              importLink={importLink}
              importError={importError}
              importing={importing}
              importTestResult={importTestResult}
              onModeChange={handleDaemonModeChange}
              onTestLocal={handleTestLocalDaemon}
              onImportLinkChange={handleImportLinkChange}
              onTestAndImport={handleTestAndImport}
              onRemoveNode={handleRemoveNode}
            />
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                disabled={!step3Valid}
                onClick={() => setStep(4)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </>
        )}

        {/* Step 4: 站点信息 + 公网入口（v4.20.0 合并） */}
        {step === 4 && (
          <>
            <SiteInfoStep
              siteName={siteName}
              publicBaseUrl={publicBaseUrl}
              onSiteNameChange={setSiteName}
              onPublicBaseUrlChange={setPublicBaseUrl}
            />
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(3)}>
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                disabled={!step4Valid}
                onClick={() => setStep(5)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </>
        )}

        {/* Step 5: 管理员账号（v4.22.0 改用 AdminStep 组件） */}
        {step === 5 && (
          <>
            <AdminStep
              email={adminEmail}
              username={adminUsername}
              displayName={adminDisplayName}
              password={adminPassword}
              passwordConfirm={adminPasswordConfirm}
              passwordPolicy={passwordPolicy}
              submitError={submitError}
              onEmailChange={setAdminEmail}
              onUsernameChange={setAdminUsername}
              onDisplayNameChange={setAdminDisplayName}
              onPasswordChange={setAdminPassword}
              onPasswordConfirmChange={setAdminPasswordConfirm}
            />
            <div className="setup-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(4)}>
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={false}
                disabled={!step5Valid}
                onClick={() => setStep(6)}
              >
                下一步
                <ArrowRight size={16} />
              </LoadingButton>
            </div>
          </>
        )}

        {/* Step 6: 启用游戏 Pack（v4.22.0 改用 PackStep 组件，Tab 切换四种来源） */}
        {step === 6 && (
          <>
            <PackStep
              source={packSource}
              githubRepo={packGithubRepo}
              githubRef={packGithubRef}
              customUrl={packCustomUrl}
              uploadId={packUploadId}
              packs={syncedPacks}
              syncing={packSyncing}
              syncResult={packSyncResult}
              syncError={packSyncError}
              onSourceChange={(s) => {
                setPackSource(s);
                // 切换来源时清空同步结果
                setPackSyncResult(null);
                setPackSyncError(null);
              }}
              onGithubRepoChange={setPackGithubRepo}
              onGithubRefChange={setPackGithubRef}
              onCustomUrlChange={setPackCustomUrl}
              onFileSelected={handlePackUpload}
              onSync={handlePackSync}
            />
            <div className="setup-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep(currentMode === 'demo' ? 1 : 5)}
                disabled={submitting || packSyncing}
              >
                <ArrowLeft size={16} />
                上一步
              </button>
              <LoadingButton
                type="button"
                variant="primary"
                loading={submitting}
                loadingText="提交中…"
                disabled={!step6Valid || packSyncing}
                onClick={() => void handleSubmit()}
              >
                完成并应用配置
                <Check size={16} />
              </LoadingButton>
            </div>
          </>
        )}

        {/* Step 7: 重启（v4.20.0 新增） */}
        {step === 7 && (
          <RestartStep
            restartToken={restartToken}
            restartRequired={restartRequired}
            api={anonymousApi}
            onRestarted={() => navigate('/login', { replace: true })}
          />
        )}
      </div>
      <SetupBuildFooter />
    </div>
  );
}

// ----- 步骤指示器 -----

function SetupStepIndicator({ currentStep, mode }: { currentStep: Step; mode: 'demo' | 'production' }) {
  // 演示模式跳过 Step 2/3/4/5，仅展示 Step 0/1/6/7
  const steps: Array<{ n: Step; label: string }> =
    mode === 'demo'
      ? [
          { n: 0, label: '环境预检' },
          { n: 1, label: '运行模式' },
          { n: 6, label: '启用游戏' },
          { n: 7, label: '完成' },
        ]
      : [
          { n: 0, label: '环境预检' },
          { n: 1, label: '运行模式' },
          { n: 2, label: '数据库' },
          { n: 3, label: 'Daemon' },
          { n: 4, label: '站点信息' },
          { n: 5, label: '管理员' },
          { n: 6, label: '启用游戏' },
          { n: 7, label: '完成' },
        ];

  return (
    <div className="setup-steps">
      {steps.map((s, idx) => {
        const state = currentStep > s.n ? 'done' : currentStep === s.n ? 'active' : 'pending';
        return (
          <div key={s.n} className={`setup-step setup-step-${state}`}>
            <div className="setup-step-num">
              {state === 'done' ? <Check size={14} /> : <span>{idx + 1}</span>}
            </div>
            <span className="setup-step-label">{s.label}</span>
            {idx < steps.length - 1 && <div className="setup-step-line" />}
          </div>
        );
      })}
    </div>
  );
}

// ----- BUILD footer（符合 .trae/rules/1.md 规范） -----

function SetupBuildFooter() {
  return (
    <footer className="app-footer-build">
        {getBuildFooterText()}
    </footer>
  );
}
