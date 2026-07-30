// ============================================================================
// 路由表 + 鉴权守卫（实例中心化导航）
// /                       → 按角色分流到三基座（已登录）/ 渲染 LandingV6（未登录）
// /login                  → 登录页
// /instances              → 实例列表（受保护）
// /instances/new          → 创建实例（受保护）
// /instances/:id          → 实例详情（受保护，内部 tab 承载 vip/item-sync/shop-items/...）
// /instances/:id/shop | shop-orders | cdk-redeem | votes | player-histories | gift-claims
// /shop                   → 商城聚合页（用户所有绑定实例的商城入口）
// /profile                → 个人设置
// /admin/users | system-config | packs | audit-logs | webhooks
// 重定向：/servers/* → /instances/*，已移除的 /admin/* 子页 → /instances
// ============================================================================

import { lazy, useEffect, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './api/auth';
import Layout from './components/Layout';
import RequireRole from './components/RequireRole';
import { GameThemeProvider } from './context/GameThemeContext';
import { AppVersionProvider } from './context/AppVersionContext';
import { useToast } from './context/ToastContext';
import Forbidden from './pages/Forbidden';
import Help from './pages/Help';
import Login from './pages/Login';
import SelectIdentity from './pages/SelectIdentity';
import Landing from './pages/Landing';
import NotFound from './pages/NotFound';
import PlayerHome from './pages/PlayerHome';
// /identity 已废弃：重定向到主页 CTA（方案 homepage-entry-funnel §5.1 收敛建议）
import DemoExperience from './pages/DemoExperience';
import LandingV6 from './pages/LandingV6';
import Register from './pages/Register';
// v3.8.0-S13: 首启动初始化引导向导（公开路由）
import SetupWizard from './pages/SetupWizard';
// v3.9.0-S4/S5: 密码找回 + 邮箱验证（公开路由）
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import EmailVerify from './pages/EmailVerify';
// v3.9.0-S7: 用户协议 + 隐私政策（公开路由）
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
// v3.9.0-S8: 维护模式提示页（公开路由，由 API client 503 检测自动跳转）
import MaintenanceMode from './pages/MaintenanceMode';
// v3.9.0-S9: 500 服务器错误页（公开路由）
import ServerError from './pages/ServerError';
// v4.22.0: 文档与社区页面（公开路由）
import Docs from './pages/Docs';
import DocsConfig from './pages/DocsConfig';
import DocsDaemon from './pages/DocsDaemon';
import DocsPacks from './pages/DocsPacks';
import DocsPlayers from './pages/DocsPlayers';
import DocsReports from './pages/DocsReports';
import DocsShop from './pages/DocsShop';
import ApiReference from './pages/ApiReference';
import PackDev from './pages/PackDev';
import Community from './pages/Community';
import Team from './pages/Team';
import Blog from './pages/Blog';
import Contact from './pages/Contact';
import { getEffectiveRole } from './utils/role';

// 三.1: 路由懒加载——非首屏页面按需加载，减小首屏 bundle
// v4.12.0: Dashboard 已并入 /admin（AdminDashboard），移除旧 Dashboard 组件引用
// v4.13.0: ServerDetail 不再直接挂载到 /instances/:id，改由三套视图组件 lazy import
const CreateServer = lazy(() => import('./pages/CreateServer'));
const Servers = lazy(() => import('./pages/Servers'));
// v4.16.0: 旧版 Shop 已被 GuildShop（玩家门户商城入口）替代，暂保留文件
// const Shop = lazy(() => import('./pages/Shop'));
const ShopOrders = lazy(() => import('./pages/ShopOrders'));
const CdkRedeem = lazy(() => import('./pages/CdkRedeem'));
// v3.7.0-B4: 业务运营二级页面（admin only）
const Business = lazy(() => import('./pages/instance-detail/Business'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PlayerHistories = lazy(() => import('./pages/PlayerHistories'));
const GiftClaims = lazy(() => import('./pages/GiftClaims'));
const PlayerVerify = lazy(() => import('./pages/PlayerVerify'));
const Profile = lazy(() => import('./pages/Profile'));
// v4.5.0: 我的资产聚合页
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const Packs = lazy(() => import('./pages/admin/Packs'));
const PlayerBindings = lazy(() => import('./pages/admin/PlayerBindings'));
const SystemConfig = lazy(() => import('./pages/admin/SystemConfig'));
// v3.8.0-S12: 结构化设置面板（表单式 UI，按 group 分组）
const Settings = lazy(() => import('./pages/admin/Settings'));
const Users = lazy(() => import('./pages/admin/Users'));
const InstanceVipUsers = lazy(() => import('./pages/admin/InstanceVipUsers'));
// v4.26.0: 用户中心经济系统——平台提现审批（server_admin 核销提现码）
const WithdrawApprovals = lazy(() => import('./pages/admin/WithdrawApprovals'));
// v4.29.0: 用户中心经济系统页面
const UserCenter = lazy(() => import('./pages/user-center/UserCenter'));
const UserTransactions = lazy(() => import('./pages/user-center/UserTransactions'));
const UserStats = lazy(() => import('./pages/user-center/UserStats'));
// v4.31.0: 个人安全中心（登录历史 + 我的活动 + 上次登录）
const SecurityCenter = lazy(() => import('./pages/user-center/SecurityCenter'));
const Webhooks = lazy(() => import('./pages/admin/Webhooks'));
// 第十一章 11.4-11.5: 系统健康仪表盘 + 一键诊断
// v3.7.0-D2: Diagnostics 已合并到 SystemHealth 的 diagnostics Tab，不再独立路由
const SystemHealth = lazy(() => import('./pages/admin/SystemHealth'));
// v3.4.0: 版本管理 + 实例清理
const VersionsPage = lazy(() => import('./pages/VersionsPage'));
const CleanupPage = lazy(() => import('./pages/CleanupPage'));
// v3.6.2: 运维清理聚合页
const Maintenance = lazy(() => import('./pages/admin/Maintenance'));
// v4.6.0: 运营仪表盘 + 配额管理 + 告警设置
const OperationsDashboard = lazy(() => import('./pages/admin/OperationsDashboard'));
const Quotas = lazy(() => import('./pages/admin/Quotas'));
// v4.7.0-G2: 全平台总览（仅 server_admin）
const PlatformDashboard = lazy(() => import('./pages/admin/PlatformDashboard'));
const AlertSettings = lazy(() => import('./pages/AlertSettings'));
// v4.8.0: 发现页 + 玩家档案 + 好友（社交功能 P3）
const Discover = lazy(() => import('./pages/Discover'));
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'));
const Friends = lazy(() => import('./pages/Friends'));
// I1-I4: 优化升级方案第四项管理页面（SSL / Tunnel / API Keys / Nodes）
const SslManagement = lazy(() => import('./pages/admin/SslManagement'));
const TunnelManagement = lazy(() => import('./pages/admin/TunnelManagement'));
const ApiKeys = lazy(() => import('./pages/admin/ApiKeys'));
const Nodes = lazy(() => import('./pages/admin/Nodes'));

import AdminLayout from './layouts/AdminLayout';
import StoreLayout from './layouts/StoreLayout';
import GuildLayout from './layouts/GuildLayout';

// v4.11.0: 三基座 index 页（直接导入，去掉 Mock fallback）
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const StoreHome = lazy(() => import('./pages/store/StoreHome'));
const GuildDock = lazy(() => import('./pages/guild/GuildDock'));
const CommercialAdminIndex = lazy(() => import('./admin/commercial/index'));
// GM Workbench 页面（v4.12.0 引入，v4.13.0 后端 API 接入，v4.19.2 玩家操作按钮补齐）
const StorePlayers = lazy(() => import('./pages/store/Players'));
const StoreReportsRevenue = lazy(() => import('./pages/store/ReportsRevenue'));
const StoreReportsPlaytime = lazy(() => import('./pages/store/ReportsPlaytime'));
const StoreServers = lazy(() => import('./pages/store/Servers'));
// v4.13.0: 实例详情页三视图拆分
const ServerDetailAdmin = lazy(() => import('./pages/admin/ServerDetailAdmin'));
const ServerDetailStore = lazy(() => import('./pages/store/ServerDetailStore'));
const ServerDetailGuild = lazy(() => import('./pages/guild/ServerDetailGuild'));
const ShopConfigEditor = lazy(() => import('./pages/store/ShopConfigEditor'));
// v4.15.0: 玩家门户 4 个新页面（我的服务器/绑定管理/CDK兑换/我的订单）
const GuildServers = lazy(() => import('./pages/guild/GuildServers'));
const GuildBind = lazy(() => import('./pages/guild/GuildBind'));
const GuildCdk = lazy(() => import('./pages/guild/GuildCdk'));
const GuildOrders = lazy(() => import('./pages/guild/GuildOrders'));
const GuildShop = lazy(() => import('./pages/guild/GuildShop'));
// v4.16.1: 玩家门户发现页 + 消息中心（Apple 浅色风格）
const GuildDiscover = lazy(() => import('./pages/guild/GuildDiscover'));
const GuildMessages = lazy(() => import('./pages/guild/GuildMessages'));

function ProtectedRoute() {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>加载中…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  }

  return <Outlet />;
}

function RootRedirect() {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>加载中…</p>
      </div>
    );
  }
  // v4.12.0: 按角色跳转对应操作层基座（三层操作逻辑）
  //   server_admin  → /admin  (Platform Dashboard 系统后台)
  //   instance_admin → /store  (GM Workbench 服主工作台)
  //   user          → /guild  (Player Portal 玩家门户)
  if (user) {
    const effectiveRole = getEffectiveRole(user);
    const target =
      effectiveRole === 'server_admin' || effectiveRole === 'system_admin' || effectiveRole === 'admin' ? '/admin'
      : effectiveRole === 'instance_admin' ? '/store'
      : '/guild';
    return <Navigate to={target} replace />;
  }
  // v4.17.0: 未登录用户显示V6风格首页（含演示剧场和三入口CTA）
  return <LandingV6 />;
}

// v4.14.2: /discover 网关——已登录→重定向到 /guild/discover（player 基座），未登录→渲染公开发现页
function DiscoverGate() {
  const { user } = useAuth();
  if (user) {
    return <Navigate to="/guild/discover" replace />;
  }
  return (
    <Layout>
      <Discover />
    </Layout>
  );
}

// /servers/:id → /instances/:id
function ServerIdRedirect() {
  const { id } = useParams();
  return <Navigate to={`/instances/${id ?? ''}`} replace />;
}

// /instances/:id/shop → /guild/servers/:id（统一到玩家门户风格商城页）
function InstanceShopRedirect() {
  const { id } = useParams();
  return <Navigate to={`/guild/servers/${id ?? ''}`} replace />;
}

// v4.12.0: /admin/commercial[/:instanceId] → /store/commercial[/:instanceId]
// commercial 已迁至 /store（GM Workbench），保留重定向向后兼容
function CommercialRedirect() {
  const { instanceId } = useParams();
  const target = instanceId ? `/store/commercial/${instanceId}` : '/store/commercial';
  return <Navigate to={target} replace />;
}

// 3.2: 旧 /admin/* 子页重定向——显示一次性 Toast 引导用户到实例中心对应 Tab
// 旧功能已迁移到实例详情的对应 Tab，重定向到 /instances 并附带 ?uiTab= 引导
const ADMIN_REDIRECT_MAP: Record<string, string> = {
  'vip-permissions': 'shop-admin',
  'item-sync': 'shop-admin',
  'shop-items': 'shop-admin',
  'cdk-codes': 'shop-admin',
  'chat-settings': 'chat-triggers',
  'vote-settings': 'vote-settings',
  'periodic-messages': 'chat-triggers',
  mods: 'mods',
  saves: 'saves',
  backups: 'saves',
  monitor: 'console',
  lists: 'config-files',
  'chat-triggers': 'chat-triggers',
  'player-join-settings': 'player-join-settings',
  // v4.14.0: 补充缺失的旧路由映射
  config: 'config-files',
  'config/*': 'config-files',
};

function AdminRedirectWithToast({ adminKey }: { adminKey: string }) {
  const toast = useToast();
  const firedRef = useRef(false);
  const targetTab = ADMIN_REDIRECT_MAP[adminKey] ?? 'console';

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    toast.info('该功能已迁移至实例中心的对应 Tab，请选择实例');
  }, [toast]);

  return <Navigate to={`/instances?uiTab=${targetTab}`} replace />;
}

// /servers/:serverId/* → /instances/:serverId/*
// 2.7: 边界保护——serverId 为空或格式无效时跳转 /instances
function ServerSplatRedirect() {
  const params = useParams();
  const serverId = params.serverId;
  const splat = params['*'];
  // 校验 serverId 必须是有效格式（字母数字 + 连字符 + 下划线）
  if (!serverId || !/^[a-zA-Z0-9_-]+$/.test(serverId)) {
    return <Navigate to="/instances" replace />;
  }
  const target = splat ? `/instances/${serverId}/${splat}` : `/instances/${serverId}`;
  return <Navigate to={target} replace />;
}

// v4.13.0: /instances/:id 按角色重定向到三套视图之一
//   server_admin  → /admin/servers/:id
//   instance_admin → /store/servers/:id
//   user          → /guild/servers/:id
function InstanceDetailRoleRedirect() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  if (!id) return <Navigate to="/instances" replace />;
  if (!user) return <Navigate to="/login" replace />;
  const effectiveRole = getEffectiveRole(user);
  const target =
    effectiveRole === 'server_admin' || effectiveRole === 'system_admin' || effectiveRole === 'admin' ? `/admin/servers/${id}`
    : effectiveRole === 'instance_admin' ? `/store/servers/${id}`
    : `/guild/servers/${id}`;
  return <Navigate to={target} replace />;
}

// v4.13.0: /instances 列表按角色重定向到对应基座
function InstanceListRoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const effectiveRole = getEffectiveRole(user);
  const target =
    effectiveRole === 'server_admin' || effectiveRole === 'system_admin' || effectiveRole === 'admin' ? '/admin/servers'
    : effectiveRole === 'instance_admin' ? '/store/servers'
    : '/guild';
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppVersionProvider>
        <GameThemeProvider>
          <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/select-identity" element={<SelectIdentity />} />
        <Route path="/register" element={<Register />} />
        {/* v3.8.0-S13: 首启动初始化引导向导（公开，首启动门控由页面内部 + 后端协同保障） */}
        <Route path="/setup" element={<SetupWizard />} />
        {/* v3.9.0-S4/S5: 密码找回 + 邮箱验证（公开路由） */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<EmailVerify />} />
        {/* v3.9.0-S7: 用户协议 + 隐私政策（公开路由） */}
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        {/* v3.9.0-S8: 维护模式提示页（公开路由） */}
        <Route path="/maintenance" element={<MaintenanceMode />} />
        {/* v3.9.0-S9: 500 服务器错误页（公开路由） */}
        <Route path="/500" element={<ServerError />} />
        {/* v4.1: 帮助中心（公开路由，不要求登录） */}
        <Route path="/help" element={<Help />} />
        <Route path="/home" element={<LandingV6 />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/player" element={<PlayerHome />} />
        {/* v4.16.0: 公开动态演示页——「先看看」入口目的地，无需登录观看自动循环演示 + 三角色一键进入 */}
        <Route path="/demo" element={<DemoExperience />} />
        {/* v4.22.0: 文档与社区页面（公开路由，无需登录） */}
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/config" element={<DocsConfig />} />
        <Route path="/docs/packs" element={<DocsPacks />} />
        <Route path="/docs/shop" element={<DocsShop />} />
        <Route path="/docs/players" element={<DocsPlayers />} />
        <Route path="/docs/reports" element={<DocsReports />} />
        <Route path="/docs/daemon" element={<DocsDaemon />} />
        <Route path="/api-reference" element={<ApiReference />} />
        <Route path="/pack-dev" element={<PackDev />} />
        <Route path="/community" element={<Community />} />
        <Route path="/team" element={<Team />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/contact" element={<Contact />} />
        {/* v4.17.0: /identity 已废弃——重定向到主页 CTA（方案 homepage-entry-funnel §5.1）
            未登录 → LandingV6 主页；已登录 → RootRedirect 按角色分流；避免第三套身份营销页 */}
        <Route path="/identity" element={<Navigate to="/" replace />} />
        <Route path="/identity/*" element={<Navigate to="/" replace />} />

        {/* 根路径：未登录→V6首页，已登录→控制台 Dashboard */}
        <Route path="/" element={<RootRedirect />} />
        {/* v4.8.0-P3: 公开但带 Layout 的页面（未登录也可访问，套 Layout 但不套 ProtectedRoute）
            - /discover: 发现页（v4.14.2: 已登录用户自动重定向到 /guild/discover player 基座）
            - /players/:userId: 玩家档案（公开访问，登录后可执行好友操作） */}
        <Route element={<Layout />}>
          <Route path="/players/:userId" element={<PlayerProfile />} />
        </Route>
        {/* v4.14.2: /discover 网关——登录用户跳 /guild/discover，未登录渲染公开发现页 */}
        <Route path="/discover" element={<DiscoverGate />} />
        <Route element={<ProtectedRoute />}>
          {/* 旧链接重定向（不挂 Layout，直接跳转） */}
          <Route path="/servers" element={<Navigate to="/instances" replace />} />
          <Route path="/servers/new" element={<Navigate to="/instances/new" replace />} />
          <Route path="/servers/:id" element={<ServerIdRedirect />} />
          <Route path="/servers/:serverId/*" element={<ServerSplatRedirect />} />
          {/* 3.2: 已移除的 /admin/* 子页 → /instances?uiTab=xxx，并显示一次性 Toast 引导 */}
          <Route path="/admin/vip-permissions" element={<AdminRedirectWithToast adminKey="vip-permissions" />} />
          <Route path="/admin/item-sync" element={<AdminRedirectWithToast adminKey="item-sync" />} />
          <Route path="/admin/shop-items" element={<AdminRedirectWithToast adminKey="shop-items" />} />
          <Route path="/admin/cdk-codes" element={<AdminRedirectWithToast adminKey="cdk-codes" />} />
          <Route path="/admin/chat-settings" element={<AdminRedirectWithToast adminKey="chat-settings" />} />
          <Route path="/admin/vote-settings" element={<AdminRedirectWithToast adminKey="vote-settings" />} />
          <Route path="/admin/periodic-messages" element={<AdminRedirectWithToast adminKey="periodic-messages" />} />
          <Route path="/admin/mods" element={<AdminRedirectWithToast adminKey="mods" />} />
          <Route path="/admin/saves" element={<AdminRedirectWithToast adminKey="saves" />} />
          <Route path="/admin/backups" element={<AdminRedirectWithToast adminKey="backups" />} />
          <Route path="/admin/monitor" element={<AdminRedirectWithToast adminKey="monitor" />} />
          <Route path="/admin/lists" element={<AdminRedirectWithToast adminKey="lists" />} />
          <Route path="/admin/chat-triggers" element={<AdminRedirectWithToast adminKey="chat-triggers" />} />
          <Route
            path="/admin/player-join-settings"
            element={<AdminRedirectWithToast adminKey="player-join-settings" />}
          />
          {/* v4.14.0: 补充 /console 和 /admin/config/* 旧路由重定向 */}
          <Route path="/console" element={<AdminRedirectWithToast adminKey="monitor" />} />
          <Route path="/admin/config" element={<AdminRedirectWithToast adminKey="config" />} />
          <Route path="/admin/config/*" element={<AdminRedirectWithToast adminKey="config" />} />

          {/* V4.12.0: /admin 基座门控上提 server_admin+（Platform Dashboard 系统管理员层） */}
          <Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin']} />}>
            <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            {/* 系统管理子路由（server_admin+ 门控，从旧 Layout 迁入） */}
            <Route element={<RequireRole allow={['server_admin', 'system_admin', 'admin']} />}>
              <Route path="users" element={<Users />} />
              <Route path="system-config" element={<SystemConfig />} />
              {/* v3.8.0-S12: 结构化设置面板（表单式 UI，替代纯 KV 编辑器） */}
              <Route path="settings" element={<Settings />} />
              <Route path="system-health" element={<SystemHealth />} />
              {/* v3.7.0-D2: /admin/diagnostics 已合并到 /admin/system-health?tab=diagnostics，保留向后兼容重定向 */}
              <Route path="diagnostics" element={<Navigate to="/admin/system-health?tab=diagnostics" replace />} />
              <Route path="packs" element={<Packs />} />
              <Route path="player-bindings" element={<PlayerBindings />} />
              {/* v4.26.0: 用户中心经济系统——平台提现审批（核销/拒绝提现码） */}
              <Route path="withdraws" element={<WithdrawApprovals />} />
              <Route path="audit-logs" element={<AuditLogs />} />
              <Route path="webhooks" element={<Webhooks />} />
              {/* 站内消息 */}
              <Route path="notifications" element={<NotificationsPage />} />
              {/* v3.4.0: 实例清理面板（仅 server_admin） */}
              <Route path="cleanup" element={<CleanupPage />} />
              {/* v3.6.2: 运维清理聚合页（仅 server_admin） */}
              <Route path="maintenance" element={<Maintenance />} />
              {/* v4.6.0-E3: 配额管理（仅 server_admin） */}
              <Route path="quotas" element={<Quotas />} />
              {/* v4.32.x: 版本管理（server_admin+，admin 基座内，避免穿台到 /store） */}
              <Route path="versions" element={<VersionsPage />} />
              {/* v4.7.0-G2: 全平台总览（仅 server_admin） */}
              <Route path="platform" element={<PlatformDashboard />} />
              {/* I1-I4: 优化升级方案第四项管理页面 */}
              <Route path="ssl" element={<SslManagement />} />
              <Route path="tunnel" element={<TunnelManagement />} />
              <Route path="api-keys" element={<ApiKeys />} />
              {/* v4.28.0: nodes 路由迁出 /admin 基座，独立挂到 instance_admin+ 守卫下，允许实例管理员访问 */}
              {/* v4.14.2: 个人设置挂载到 admin 基座内（避免跨基座跳转） */}
              <Route path="profile" element={<Profile />} />
              <Route path="profile/verify" element={<PlayerVerify />} />
              <Route path="profile/alerts" element={<AlertSettings />} />
              {/* v4.29.0: 个人中心经济系统 */}
              <Route path="center" element={<UserCenter />} />
              <Route path="center/transactions" element={<UserTransactions />} />
              <Route path="center/stats" element={<UserStats />} />
              {/* v4.31.0: 个人安全中心（登录历史 + 我的活动 + 上次登录） */}
              <Route path="center/security" element={<SecurityCenter />} />
            </Route>
            {/* v4.12.0: instance-vip/operations 已迁至 /store（GM Workbench），保留重定向向后兼容 */}
            <Route path="instance-vip" element={<Navigate to="/store/instance-vip" replace />} />
            <Route path="operations" element={<Navigate to="/store/operations" replace />} />
            {/* v4.12.0: commercial 已迁至 /store（GM Workbench），保留重定向向后兼容 */}
            <Route path="commercial" element={<CommercialRedirect />} />
            <Route path="commercial/:instanceId" element={<CommercialRedirect />} />
            </Route>
          </Route>

          {/* V4.12.0: /store 基座门控上提 instance_admin+（GM Workbench 服主工作台层） */}
          <Route element={<RequireRole allow={['instance_admin', 'server_admin', 'system_admin', 'admin']} />}>
            <Route path="/store" element={<StoreLayout />}>
              <Route index element={<StoreHome />} />
              {/* v4.12.0: GM Workbench 核心功能（instance_admin+ 门控，从 /admin 迁入） */}
              <Route element={<RequireRole allow={['instance_admin', 'server_admin', 'system_admin', 'admin']} />}>
                {/* 商业化控制台：/store/commercial → 实例选择器；/store/commercial/:instanceId → 资产列表 */}
                <Route path="commercial" element={<CommercialAdminIndex />} />
                <Route path="commercial/:instanceId" element={<CommercialAdminIndex />} />
                {/* 实例运营：VIP 用户管理 + 运营仪表盘（从 /admin 迁入） */}
                <Route path="instance-vip" element={<InstanceVipUsers />} />
                <Route path="operations" element={<OperationsDashboard />} />
                {/* GM Workbench 页面（v4.19.2 玩家操作按钮已补齐） */}
                <Route path="players" element={<StorePlayers />} />
                <Route path="reports/revenue" element={<StoreReportsRevenue />} />
                <Route path="reports/playtime" element={<StoreReportsPlaytime />} />
                <Route path="servers" element={<StoreServers />} />
                <Route path="servers/new" element={<CreateServer />} />
                {/* v4.13.0: 服主实例详情视图 + 店铺外观配置编辑器 */}
                <Route path="servers/:id" element={<ServerDetailStore />} />
                <Route path="servers/:id/shop-config" element={<ShopConfigEditor />} />
                {/* v4.15.0: 版本管理从 /guild 迁入（服主/管理员职能归位，G7） */}
                <Route path="versions" element={<VersionsPage />} />
                {/* v4.14.2: 个人设置 + 通知挂载到 store 基座内（避免跨基座跳转） */}
                <Route path="profile" element={<Profile />} />
                <Route path="profile/verify" element={<PlayerVerify />} />
                <Route path="profile/alerts" element={<AlertSettings />} />
                <Route path="notifications" element={<NotificationsPage />} />
                {/* v4.29.4: /store/me 重定向到个人中心（与 /guild/me → /guild/center 设计对齐） */}
                <Route path="me" element={<Navigate to="/store/center" replace />} />
                {/* v4.29.0: 个人中心经济系统 */}
                <Route path="center" element={<UserCenter />} />
                <Route path="center/transactions" element={<UserTransactions />} />
                <Route path="center/stats" element={<UserStats />} />
                {/* v4.31.0: 个人安全中心（登录历史 + 我的活动 + 上次登录） */}
                <Route path="center/security" element={<SecurityCenter />} />
              </Route>
            </Route>
          </Route>

          {/* v4.28.0: 部署节点独立路由组——instance_admin+ 守卫，复用 AdminLayout 保持视觉一致 */}
          {/* 设计说明：路径仍为 /admin/nodes（侧边栏入口、命令面板、激活态映射均引用此路径）， */}
          {/* 但路由本身从 /admin 基座（server_admin+）中迁出，允许 instance_admin 访问。 */}
          {/* AdminLayout 内部根据角色分层渲染侧边栏：instance_admin 只看到 INSTANCE_ADMIN_LINKS。 */}
          <Route element={<RequireRole allow={['instance_admin', 'server_admin', 'system_admin', 'admin']} />}>
            <Route path="/admin/nodes" element={<AdminLayout />}>
              <Route index element={<Nodes />} />
            </Route>
          </Route>

          {/* v4.31.0: 实例管理独立路由组——instance_admin+ 守卫，复用 AdminLayout */}
          {/* 设计说明：与 /admin/nodes 同模式，从 /admin 基座迁出以允许 instance_admin 访问。 */}
          {/* server_admin 看到全部实例；instance_admin 仅看到自己拥有/共管的实例（后端过滤）。 */}
          <Route element={<RequireRole allow={['instance_admin', 'server_admin', 'system_admin', 'admin']} />}>
            <Route path="/admin/servers" element={<AdminLayout />}>
              <Route index element={<Servers />} />
              <Route path=":id" element={<ServerDetailAdmin />} />
            </Route>
          </Route>

          {/* V4.12.0 /guild 基座 = Player Portal（玩家门户）—— 消费与社交（所有登录用户可访问） */}
          <Route path="/guild" element={<GuildLayout />}>
            <Route index element={<GuildDock />} />
            {/* v4.15.0: 我的服务器列表（/guild/servers）+ 4 新页面路由注册 */}
            <Route path="servers" element={<GuildServers />} />
            {/* v4.13.0: 玩家实例详情视图（/guild/servers/:id）—— 店铺首页 + 商品列表 */}
            <Route path="servers/:id" element={<ServerDetailGuild />} />
            {/* v4.15.0: 绑定角色管理 / CDK 兑换 / 我的订单（跨实例聚合） */}
            <Route path="bind" element={<GuildBind />} />
            <Route path="cdk" element={<GuildCdk />} />
            <Route path="orders" element={<GuildOrders />} />
            {/* v4.12.0: 从 /store 迁入——消费侧页面（玩家视角） */}
            <Route path="shop" element={<GuildShop />} />
            {/* v4.29.0: /guild/me 重定向到个人中心 */}
            <Route path="me" element={<Navigate to="/guild/center" replace />} />
            {/* v4.29.0: 个人中心经济系统 */}
            <Route path="center" element={<UserCenter />} />
            <Route path="center/transactions" element={<UserTransactions />} />
            <Route path="center/stats" element={<UserStats />} />
            {/* v4.31.0: 个人安全中心（登录历史 + 我的活动 + 上次登录） */}
            <Route path="center/security" element={<SecurityCenter />} />
            {/* v4.8.0-P3: 好友页（已登录用户社交中心） */}
            <Route path="friends" element={<Friends />} />
            {/* v4.16.1: 发现页 + 消息页（Apple 浅色风格，移动端优先） */}
            <Route path="discover" element={<GuildDiscover />} />
            <Route path="notifications" element={<GuildMessages />} />
            {/* 个人设置（从旧 Layout 迁入） */}
            <Route path="profile" element={<Profile />} />
            <Route path="profile/verify" element={<PlayerVerify />} />
            {/* v4.6.0-F4: 告警配置页（所有已登录用户） */}
            <Route path="profile/alerts" element={<AlertSettings />} />
          </Route>

          {/* 旧绝对路径重定向 → /guild 基座规范路径 */}
          <Route path="/shop" element={<Navigate to="/guild/shop" replace />} />
          <Route path="/me" element={<Navigate to="/guild/center" replace />} />
          {/* v4.15.0: 版本管理迁至 /store 基座（instance_admin+ 门控，user 命中 Forbidden） */}
          <Route path="/versions" element={<Navigate to="/store/versions" replace />} />
          <Route path="/friends" element={<Navigate to="/guild/friends" replace />} />
          {/* v4.14.2: /discover 已由公开路由 DiscoverGate 处理（登录用户重定向到 /guild/discover） */}
          <Route path="/notifications" element={<Navigate to="/guild/notifications" replace />} />
          <Route path="/profile" element={<Navigate to="/guild/profile" replace />} />
          <Route path="/profile/verify" element={<Navigate to="/guild/profile/verify" replace />} />
          <Route path="/profile/alerts" element={<Navigate to="/guild/profile/alerts" replace />} />

          {/* 剩余旧 Layout 路由（实例中心化 + 公开页面，暂不迁入基座） */}
          <Route element={<Layout />}>
            {/* v4.12.0: /dashboard 已并入 /admin（Platform Dashboard），重定向消除旧控制台独立入口 */}
            <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
            {/* v4.13.0: /instances 列表 + 详情按角色重定向到三套视图 */}
            <Route path="/instances" element={<InstanceListRoleRedirect />} />
            {/* v4.15.2: /instances/new 加 instance_admin+ 门控（普通用户不应创建实例） */}
            <Route element={<RequireRole allow={['instance_admin', 'server_admin', 'admin', 'system_admin']} />}>
              <Route path="/instances/new" element={<CreateServer />} />
              {/* v4.15.2: 业务运营/玩家历史/礼包领取加门控（普通用户不应访问） */}
              <Route path="/instances/:id/business" element={<Business />} />
              <Route path="/instances/:id/player-histories" element={<PlayerHistories />} />
              <Route path="/instances/:id/gift-claims" element={<GiftClaims />} />
            </Route>
            <Route path="/instances/:id" element={<InstanceDetailRoleRedirect />} />
            {/* 旧 /instances/:id/shop → 重定向到玩家门户风格商城页 */}
            <Route path="/instances/:id/shop" element={<InstanceShopRedirect />} />
            <Route path="/instances/:id/shop-orders" element={<ShopOrders />} />
            <Route path="/instances/:id/cdk-redeem" element={<CdkRedeem />} />
            {/* 403 无权限页 */}
            <Route path="/forbidden" element={<Forbidden />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
        </GameThemeProvider>
      </AppVersionProvider>
    </AuthProvider>
  );
}
