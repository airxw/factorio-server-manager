// ============================================================================
// Layout — 左侧可折叠边栏 + 顶部面包屑 + 内容出口（Outlet）
// 按实例中心化分组：控制台 / 实例 / 商城VIP / 个人设置 / 系统管理（仅 server_admin）
// 折叠状态持久化到 localStorage(key: sidebarCollapsed)
// 五.3: 移动端（<768px）侧边栏改为抽屉，遮罩 + 汉堡按钮触发，导航后自动关闭
// 3.3: 通知作为主导航项，移出 sidebar-footer
// 3.12: 侧边栏激活态精确判定（显式映射表替代 startsWith）
// 3.13: 侧边栏折叠状态跨标签同步（storage 事件）
// 3.14: 退出登录清理客户端状态
// 4.5: 通知轮询改用 api.listNotifications()
// 8.1: 顶部面包屑导航
// 8.2: 全局命令面板（Ctrl+K）
// 8.4: 最近访问记录
// 8.6: 键盘快捷键
// 9.1: 移动端底部导航
// ============================================================================

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Box,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Crown,
  Gauge,
  Globe,
  Group,
  HelpCircle,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Network,
  Package,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sliders,
  ShoppingBag,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Webhook,
  Wrench,
  X,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../api/auth';
import { getVersion } from '../api/client';
import type { UserRole } from '@public/schema/panel-api-types';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../utils/role';
import CommandPalette from './CommandPalette';
import RoleSwitcherModal from './RoleSwitcherModal';
import { useToast } from './ui';
import ShortcutsHelp from './ShortcutsHelp';
import HelpModal from './HelpModal';
import VersionInfoModal from './VersionInfoModal';
import NodeStatusWidget from './NodeStatusWidget';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useRecentPages } from '../hooks/useRecentPages';
import { notificationStore } from '../stores/notificationStore';

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

// v4.28.0: 角色中文标签（头像菜单当前身份显示）
const ROLE_LABEL_ZH: Record<string, string> = {
  user: '玩家',
  instance_admin: '服主',
  server_admin: '管理员',
};

interface SidebarLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

// v3.7.0-E1: 侧边栏分组容器——10 项管理功能聚合为 6 组
interface SidebarLinkGroup {
  title: string;
  links: SidebarLink[];
}

// 主导航项（default variant 旧路由兼容用）
// v4.14.0: 消费侧路径统一到 /guild/* 基座
// v4.15.0: 版本管理迁至 /store 基座（instance_admin+ 职能），从玩家主导航移除
// v4.14.2: MAIN_LINKS 拆分为三层——消费侧（user）/ 实例管理（instance_admin+）/ 全平台（server_admin）
const PLAYER_LINKS: SidebarLink[] = [
  { to: '/guild/shop', label: '商城VIP', icon: ShoppingBag },
  { to: '/guild/discover', label: '发现', icon: Compass },
  { to: '/guild/notifications', label: '消息', icon: Bell },
  { to: '/guild/center', label: '个人中心', icon: Wallet },
  { to: '/guild/friends', label: '好友', icon: UserPlus },
  { to: '/guild/profile/alerts', label: '告警设置', icon: AlertTriangle },
  { to: '/guild/profile', label: '个人设置', icon: Settings },
];

const INSTANCE_ADMIN_LINKS: SidebarLink[] = [
  { to: '/store/servers', label: '我的实例', icon: Server },
  { to: '/store/commercial', label: '商城管理', icon: ShoppingBag },
  { to: '/store/instance-vip', label: 'VIP管理', icon: Crown },
  { to: '/store/operations', label: '运营仪表盘', icon: BarChart3 },
  // v4.28.0: 部署节点对 instance_admin 开放（节点归属创建者）
  { to: '/admin/nodes', label: '部署节点', icon: Network },
  // v4.31.0: 实例管理对 instance_admin 开放（仅查看自己拥有/共管的实例）
  { to: '/admin/servers', label: '实例管理', icon: Box },
];

// 系统管理分组（v3.7.0-E1：10 项 → 6 组）
// - 用户与权限 / 系统监控 / 配置管理 / 审计与日志 / 运维清理 / 业务运营
// - v3.7.0-D2: 系统诊断已合并到系统监控页（diagnostics Tab），不再单独入口
const ADMIN_GROUPS: SidebarLinkGroup[] = [
  {
    title: '全平台总览',
    links: [{ to: '/admin/platform', label: '全平台总览', icon: Globe }],
  },
  {
    title: '用户与权限',
    links: [
      { to: '/admin/users', label: '用户管理', icon: Users },
      // I3: API Key 管理（v4.4.0-M2，绕过认证）
      { to: '/admin/api-keys', label: 'API Keys', icon: KeyRound },
    ],
  },
  {
    title: '系统监控',
    links: [
      { to: '/admin/system-health', label: '系统监控', icon: Activity },
    ],
  },
  {
    title: '部署节点',
    links: [
      // I4: 部署节点管理（Java 环境扫描）
      { to: '/admin/nodes', label: '节点管理', icon: Server },
      // v4.31.0: 实例管理入口（管理员视角，跨用户查看全部实例）
      { to: '/admin/servers', label: '实例管理', icon: Box },
    ],
  },
  {
    title: '配置管理',
    links: [
      { to: '/admin/system-config', label: '底座配置', icon: Settings },
      // v3.8.0-S12: 结构化设置面板（表单式 UI）
      { to: '/admin/settings', label: '面板设置', icon: Sliders },
      { to: '/admin/packs', label: 'Pack 管理', icon: Package },
      // I1: SSL 证书管理（v4.4.0-L1）
      { to: '/admin/ssl', label: 'SSL 证书', icon: ShieldCheck },
      // I2: 隧道管理（v4.4.0-O1）
      { to: '/admin/tunnel', label: '隧道管理', icon: Network },
    ],
  },
  {
    title: '审计与日志',
    links: [
      { to: '/admin/audit-logs', label: '审计日志', icon: ScrollText },
      { to: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    title: '运维清理',
    links: [
      { to: '/admin/cleanup', label: '实例清理', icon: Trash2 },
      { to: '/admin/maintenance', label: '运维清理', icon: Wrench },
    ],
  },
  {
    title: '业务运营',
    links: [
      { to: '/admin/player-bindings', label: '玩家绑定', icon: UserCheck },
      // v4.26.0: 用户中心经济系统——平台提现审批（server_admin 核销提现码）
      { to: '/admin/withdraws', label: '提现审批', icon: Wallet },
      // v4.25.2: VIP管理已迁至 /store 基座（instance_admin+ 职能），从 admin 侧边栏移除以避免跨基座穿台
    ],
  },
  {
    title: '运营与配额',
    links: [
      // v4.25.2: 运营仪表盘已迁至 /store 基座（instance_admin+ 职能），从 admin 侧边栏移除以避免跨基座穿台
      { to: '/admin/quotas', label: '配额管理', icon: Gauge },
    ],
  },
  {
    title: '个人',
    links: [
      { to: '/admin/center', label: '个人中心', icon: Wallet },
      { to: '/admin/profile', label: '个人设置', icon: Settings },
    ],
  },
];

// v4.12.0: GM Workbench 服主工作台导航（/store 基座 variant='store' 时使用）
// 弱化终端命令行，强化商城管理/玩家列表/数据报表三块主导航
// 终端/控制台/raw RCON 入口折叠到"实例运营 → 我的实例 → 实例详情"二级 Tab，默认不可见
const STORE_NAV_GROUPS: SidebarLinkGroup[] = [
  {
    title: '店铺运营',
    links: [
      { to: '/store', label: '工作台首页', icon: Home },
      { to: '/store/commercial', label: '商城管理', icon: ShoppingBag },
      { to: '/store/operations', label: '运营仪表盘', icon: Activity },
    ],
  },
  {
    title: '玩家管理',
    links: [
      { to: '/store/players', label: '玩家列表', icon: Users },
      { to: '/store/instance-vip', label: 'VIP 管理', icon: Crown },
    ],
  },
  {
    title: '数据报表',
    links: [
      { to: '/store/reports/revenue', label: '流水报表', icon: Wallet },
      { to: '/store/reports/playtime', label: '时长统计', icon: Gauge },
    ],
  },
  {
    title: '实例运营',
    links: [
      { to: '/store/servers', label: '我的实例', icon: Server },
      // v4.15.0: 版本管理从 /guild 迁入（服主/管理员职能归位）
      { to: '/store/versions', label: '版本管理', icon: Box },
    ],
  },
  {
    title: '个人',
    links: [
      { to: '/store/center', label: '个人中心', icon: Wallet },
      { to: '/store/profile', label: '个人设置', icon: Settings },
    ],
  },
];

// 3.12: 路径 → 激活导航项的显式映射表
// v4.14.0: 补全 /guild 基座与 /store 子路由激活态
const PATH_ACTIVE_MAP: Record<string, string> = {
  '/dashboard': '/dashboard',
  '/instances': '/instances',
  '/instances/new': '/instances',
  // /guild 基座（Player Portal）
  '/guild': '/guild',
  '/guild/shop': '/guild/shop',
  '/guild/me': '/guild/center',
  '/guild/center': '/guild/center',
  '/guild/center/transactions': '/guild/center',
  '/guild/center/stats': '/guild/center',
  '/guild/friends': '/guild/friends',
  '/guild/discover': '/guild/discover',
  '/guild/notifications': '/guild/notifications',
  '/guild/profile': '/guild/profile',
  '/guild/profile/verify': '/guild/profile',
  '/guild/profile/alerts': '/guild/profile/alerts',
  '/guild/servers': '/guild',
  // v4.15.0: 绑定/兑换/订单页归属首页 tab（底部 tab 激活态）
  '/guild/bind': '/guild',
  '/guild/cdk': '/guild',
  '/guild/orders': '/guild',
  // 旧路径兼容（重定向前的瞬态匹配）
  // 注：/discover 由公开路由首个匹配（App.tsx），激活态见下方 P3 段，此处不重复
  '/shop': '/guild/shop',
  '/me': '/guild/center',
  '/friends': '/guild/friends',
  '/notifications': '/guild/notifications',
  '/profile': '/guild/profile',
  '/profile/verify': '/guild/profile',
  '/profile/alerts': '/guild/profile/alerts',
  '/admin/notifications': '/admin/notifications',
  '/admin/users': '/admin/users',
  '/admin/system-config': '/admin/system-config',
  // v3.8.0-S12: 结构化设置面板
  '/admin/settings': '/admin/settings',
  '/admin/system-health': '/admin/system-health',
  // v3.7.0-D2: /admin/diagnostics 重定向到 /admin/system-health?tab=diagnostics
  '/admin/diagnostics': '/admin/system-health',
  '/admin/packs': '/admin/packs',
  '/admin/audit-logs': '/admin/audit-logs',
  '/admin/webhooks': '/admin/webhooks',
  '/admin/player-bindings': '/admin/player-bindings',
  // v4.26.0: 用户中心经济系统——平台提现审批
  '/admin/withdraws': '/admin/withdraws',
  // v4.12.0: GM Workbench 服主工作台导航激活态
  '/store': '/store',
  '/store/commercial': '/store/commercial',
  '/store/commercial/:instanceId': '/store/commercial',
  '/store/operations': '/store/operations',
  '/store/players': '/store/players',
  '/store/reports/revenue': '/store/reports/revenue',
  '/store/reports/playtime': '/store/reports/playtime',
  '/store/servers': '/store/servers',
  '/store/servers/new': '/store/servers',
  '/store/instance-vip': '/store/instance-vip',
  '/store/servers/:id': '/store/servers',
  '/store/servers/:id/shop-config': '/store/servers',
  // v4.15.0: 版本管理迁至 /store 基座（/versions 旧路径重定向后命中）
  '/store/versions': '/store/versions',
  '/versions': '/store/versions',
  '/admin/cleanup': '/admin/cleanup',
  '/admin/maintenance': '/admin/maintenance',
  // v4.6.0: 运营仪表盘 + 配额管理 + 告警设置
  '/admin/quotas': '/admin/quotas',
  // v4.7.0-G2: 全平台总览（仅 server_admin）
  '/admin/platform': '/admin/platform',
  // I1-I4: 优化升级方案第四项管理页面
  '/admin/ssl': '/admin/ssl',
  '/admin/tunnel': '/admin/tunnel',
  '/admin/api-keys': '/admin/api-keys',
  '/admin/nodes': '/admin/nodes',
  // v4.31.0: 实例管理入口
  '/admin/servers': '/admin/servers',
  // v4.14.2: admin/store 基座内 profile + notifications 激活态
  '/admin/profile': '/admin/profile',
  '/admin/profile/verify': '/admin/profile',
  '/admin/profile/alerts': '/admin/profile/alerts',
  // v4.29.0: 个人中心经济系统
  '/admin/center': '/admin/center',
  '/admin/center/transactions': '/admin/center',
  '/store/center': '/store/center',
  '/store/center/transactions': '/store/center',
  '/store/profile': '/store/profile',
  '/store/profile/verify': '/store/profile',
  '/store/profile/alerts': '/store/profile/alerts',
  '/store/notifications': '/store/notifications',
  // v4.8.0-P3: 发现页 / 好友页 / 玩家档案
  '/discover': '/discover',
  '/players': '/players',
  '/forbidden': '',
};

// 8.1: 面包屑路径映射
// v4.14.0: 支持三层基座（admin/store/guild）面包屑
interface BreadcrumbItem {
  label: string;
  to?: string;
}

function getBreadcrumbs(pathname: string, variant: string): BreadcrumbItem[] {
  // 根据基座确定首页
  let homeLabel = '控制台';
  let homeTo = '/dashboard';
  if (variant === 'admin') {
    homeLabel = '平台大盘';
    homeTo = '/admin';
  } else if (variant === 'store') {
    homeLabel = '工作台首页';
    homeTo = '/store';
  } else if (variant === 'player') {
    homeLabel = '玩家门户';
    homeTo = '/guild';
  }

  const items: BreadcrumbItem[] = [{ label: homeLabel, to: homeTo }];
  if (pathname === homeTo || pathname === '/dashboard') return items;

  // /admin 基座
  if (pathname.startsWith('/admin/')) {
    const adminLabelMap: Record<string, string> = {
      users: '用户管理',
      'system-config': '底座配置',
      settings: '面板设置',
      'system-health': '系统监控',
      diagnostics: '系统诊断',
      packs: 'Pack 管理',
      'audit-logs': '审计日志',
      webhooks: 'Webhooks',
      'player-bindings': '玩家绑定',
      // v4.26.0: 用户中心经济系统——平台提现审批
      withdraws: '提现审批',
      // v4.29.0: 个人中心
      center: '个人中心',
      cleanup: '实例清理',
      maintenance: '运维清理',
      quotas: '配额管理',
      platform: '全平台总览',
      ssl: 'SSL 证书',
      tunnel: '隧道管理',
      'api-keys': 'API Keys',
      nodes: '部署节点',
      notifications: '站内消息',
      'instance-vip': 'VIP管理',
      operations: '运营仪表盘',
      // v4.14.2: 个人设置挂载到 admin 基座
      profile: '个人设置',
    };
    const adminPage = pathname.split('/')[2];
    if (variant !== 'admin') items.push({ label: '系统管理' });
    if (adminLabelMap[adminPage]) items.push({ label: adminLabelMap[adminPage] });
    // v4.14.2: profile 子路由面包屑
    if (adminPage === 'profile' && pathname.split('/')[3]) {
      const sub = pathname.split('/')[3];
      if (sub === 'verify') items.push({ label: '玩家验证' });
      else if (sub === 'alerts') items.push({ label: '告警设置' });
    }
    return items;
  }

  // /store 基座
  if (pathname.startsWith('/store/') || (variant === 'store' && pathname === '/store')) {
    if (pathname === '/store') return items;
    const storeLabelMap: Record<string, string> = {
      commercial: '商城管理',
      'instance-vip': 'VIP管理',
      operations: '运营仪表盘',
      players: '玩家列表',
      reports: '数据报表',
      servers: '我的实例',
      versions: '版本管理',
      // v4.14.2: 个人设置 + 通知挂载到 store 基座
      profile: '个人设置',
      // v4.29.0: 个人中心
      center: '个人中心',
      notifications: '站内消息',
    };
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const page = parts[1];
      if (page === 'reports' && parts[2]) {
        items.push({ label: '数据报表' });
        const reportMap: Record<string, string> = { revenue: '流水报表', playtime: '时长统计' };
        if (reportMap[parts[2]]) items.push({ label: reportMap[parts[2]] });
      } else if (page === 'servers') {
        items.push({ label: '我的实例', to: '/store/servers' });
        if (parts[2] === 'new') {
          items.push({ label: '创建实例' });
        } else if (parts[2]) {
          items.push({ label: '实例详情' });
          if (parts[3] === 'shop-config') items.push({ label: '店铺外观' });
        }
      } else if (page === 'commercial' && parts[2]) {
        items.push({ label: '商城管理', to: '/store/commercial' });
        items.push({ label: '实例配置' });
      } else if (page === 'profile') {
        // v4.14.2: store 基座下 profile 子路由面包屑
        items.push({ label: '个人设置', to: '/store/profile' });
        if (parts[2] === 'verify') items.push({ label: '玩家验证' });
        else if (parts[2] === 'alerts') items.push({ label: '告警设置' });
      } else if (storeLabelMap[page]) {
        items.push({ label: storeLabelMap[page] });
      }
    }
    return items;
  }

  // /guild 基座
  if (pathname.startsWith('/guild/') || (variant === 'player' && pathname === '/guild')) {
    if (pathname === '/guild') return items;
    const guildLabelMap: Record<string, string> = {
      shop: '商城',
      me: '个人中心',
      center: '个人中心',
      friends: '好友',
      discover: '发现',
      notifications: '消息',
      profile: '个人设置',
      servers: '我的服务器',
      bind: '绑定角色',
      cdk: 'CDK 兑换',
      orders: '我的订单',
    };
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const page = parts[1];
      if (page === 'servers' && parts[2]) {
        items.push({ label: '服务器详情' });
      } else if (page === 'profile') {
        items.push({ label: '个人设置', to: '/guild/profile' });
        if (parts[2] === 'verify') items.push({ label: '玩家验证' });
        else if (parts[2] === 'alerts') items.push({ label: '告警设置' });
      } else if (guildLabelMap[page]) {
        items.push({ label: guildLabelMap[page] });
      }
    }
    return items;
  }

  // 旧路由兼容
  if (pathname.startsWith('/instances')) {
    items.push({ label: '实例', to: '/instances' });
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      if (parts[1] === 'new') {
        items.push({ label: '创建实例' });
      } else {
        items.push({ label: '实例详情' });
        if (parts.length >= 3) {
          const subPageMap: Record<string, string> = {
            shop: '商城',
            'shop-orders': '订单',
            'cdk-redeem': 'CDK兑换',
            'player-histories': '玩家历史',
            'gift-claims': '礼包领取',
            business: '业务运营',
          };
          const subLabel = subPageMap[parts[2]];
          if (subLabel) items.push({ label: subLabel });
        }
      }
    }
  } else if (pathname.startsWith('/guild/shop') || pathname === '/shop') {
    items.push({ label: '商城' });
  } else if (pathname.startsWith('/guild/me') || pathname === '/me') {
    items.push({ label: '我的资产' });
  } else if (pathname.startsWith('/guild/profile')) {
    items.push({ label: '个人设置', to: '/guild/profile' });
    if (pathname.includes('/verify')) items.push({ label: '玩家验证' });
    else if (pathname.includes('/alerts')) items.push({ label: '告警设置' });
  } else if (pathname.startsWith('/guild/friends') || pathname === '/friends') {
    items.push({ label: '好友' });
  } else if (pathname === '/discover') {
    items.push({ label: '发现' });
  } else if (pathname.startsWith('/players/')) {
    items.push({ label: '玩家档案' });
  } else if (pathname === '/forbidden') {
    items.push({ label: '无权限' });
  }

  return items;
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}

// v4.12.0: Layout variant——三层操作逻辑差异化
//   'default'：旧 Layout（给 /instances 等剩余旧路由用），显示完整 MAIN_LINKS + 角色相关 ADMIN_GROUPS
//   'admin'：Platform Dashboard（/admin 基座），只显示系统管理组，不显示玩家入口
//   'store'：GM Workbench（/store 基座），显示服主工作台导航（店铺运营/玩家管理/数据报表/实例运营）
//   'player'：Player Portal（/guild 基座），移动端优先 C 端电商——隐藏侧边栏，顶部导航 + 底部 tab，屏蔽运维
type LayoutVariant = 'default' | 'admin' | 'store' | 'player';

interface LayoutProps {
  children?: ReactNode;
  variant?: LayoutVariant;
}

export default function Layout({ children, variant = 'default' }: LayoutProps = {}) {
  const { user, logout, api, sessionKey, switchActiveRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  const [version, setVersion] = useState<string>('...');
  const [unreadCount, setUnreadCount] = useState(0);
  // 五.3: 移动端抽屉状态
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuToggleRef = useRef<HTMLButtonElement | null>(null);
  // 8.6: 快捷键帮助模态状态
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  // 十.5: 帮助中心模态状态
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  // 第十一章 11.1: 版本信息模态状态
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  // v4.8.0-P3 (J2): 侧边栏分组折叠状态——记录被折叠的分组标题
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // v4.14.0: player 顶部栏用户菜单下拉状态
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  // v4.25.0: 侧边栏左下角用户菜单下拉状态（替代原"登出"按钮）
  const [sidebarUserMenuOpen, setSidebarUserMenuOpen] = useState(false);
  const sidebarUserMenuRef = useRef<HTMLDivElement | null>(null);
  // v4.28.0: 全员服主——免密切换进行中状态 + 角色切换弹窗状态
  const [roleSwitching, setRoleSwitching] = useState(false);
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);

  // 8.4: 记录最近访问页面（路由变化时写入 localStorage）
  // 返回值未使用——CommandPalette 通过 readRecentPages() 直接读取
  useRecentPages(location.pathname);

  // 8.6: 全局键盘快捷键（? 帮助 / g 前缀跳转 / / 聚焦搜索）
  useKeyboardShortcuts({
    onOpenShortcutsHelp: useCallback(() => setShortcutsHelpOpen(true), []),
  });

  // 拉取版本号
  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((res) => {
        if (!cancelled) setVersion(res.version);
      })
      .catch(() => {
        if (!cancelled) setVersion('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // I5: 通知未读数——WebSocket 实时推送（notificationStore）+ 断线降级 30s 轮询
  // 主路径：notificationStore 维护 /ws 连接，后端 broadcastToUser 推送
  //         notification.new / notification.unread_count 事件，未读数由 store 驱动
  // 降级路径：WS 断开时自动切换到 30s 轮询 GET /api/notifications；WS 重连后停止轮询
  // 4.9: 依赖 sessionKey，登出/登录切换会话时重置连接与未读数
  // 3.3.7: 降级轮询沿用 AbortController 主动 abort，避免 net::ERR_ABORTED 控制台日志
  useEffect(() => {
    if (!user) return;
    setUnreadCount(0);

    // 未读数由 store 驱动（WS 收到 notification.unread_count / notification.new）
    const unsubUnread = notificationStore.onUnreadCountChange((count) => {
      setUnreadCount(count);
    });

    // 降级轮询状态机：WS 断开时启动 30s 轮询，连上时停止
    // v4.14.2: 改用 cancelled flag 替代 AbortController
    // 原因：AbortController.abort() 会触发 Chrome 网络层 net::ERR_ABORTED 控制台日志
    // （JS try/catch 无法抑制），cancelled flag 让请求自然完成，response 被丢弃
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stopPolling = () => {
      polling = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const startPolling = () => {
      if (polling) return;
      polling = true;
      const tick = async () => {
        if (!polling) return;
        try {
          const res = await api.listNotifications();
          if (polling) {
            setUnreadCount(res.unread_count ?? 0);
          }
        } catch {
          // 静默错误，下一轮重试
        }
        if (polling) {
          timer = setTimeout(tick, 30000);
        }
      };
      void tick();
    };

    // 连接状态驱动降级：disconnected → 轮询，connected → 停轮询
    // onConnectionChange 立即推送当前状态：初始 disconnected 时立即起轮询兜底，
    // WS 鉴权成功后切回实时推送
    const unsubConn = notificationStore.onConnectionChange((connected) => {
      if (connected) {
        stopPolling();
      } else {
        startPolling();
      }
    });

    // v4.14.2: notificationStore 生命周期已迁至 AuthProvider（依赖 user 状态）
    // Layout 仅负责订阅 unreadCount / connectionChange，不再管理 init/destroy
    // 这样路由切换 Layout unmount/remount 不会断开 WS 连接

    return () => {
      unsubUnread();
      unsubConn();
      stopPolling();
    };
  }, [user, api, sessionKey]);

  // 3.13: 侧边栏折叠状态跨标签同步——监听 storage 事件
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SIDEBAR_COLLAPSED_KEY && e.newValue !== null) {
        setCollapsed(e.newValue === '1');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // 五.3: 路由变化时关闭移动端抽屉，避免导航后抽屉仍展开遮挡内容
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // 五.3: 抽屉关闭时将焦点回到触发按钮，符合 a11y 焦点返回预期
  useEffect(() => {
    if (!mobileMenuOpen && mobileMenuToggleRef.current) {
      const t = mobileMenuToggleRef.current;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const isInput =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement;
        if (!isInput) t.focus();
      });
    }
  }, [mobileMenuOpen]);

  // 五.3: 抽屉打开时 ESC 关闭
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveCollapsed(next);
      return next;
    });
  }, []);

  // v4.8.0-P3 (J2): 切换侧边栏分组折叠状态
  const toggleGroup = useCallback((title: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);

  // v4.14.0: 点击外部关闭 player 用户菜单
  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  // v4.25.0: 点击外部关闭侧边栏用户菜单
  useEffect(() => {
    if (!sidebarUserMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (sidebarUserMenuRef.current && !sidebarUserMenuRef.current.contains(e.target as Node)) {
        setSidebarUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sidebarUserMenuOpen]);

  // 3.14: 退出登录清理客户端状态——重置 unreadCount + 折叠状态
  // v4.14.0: 按 variant 区分退出后跳转目标
  const handleLogout = useCallback(() => {
    setUnreadCount(0);
    setMobileMenuOpen(false);
    logout();
    const logoutTo = variant === 'player' ? '/player' : '/home';
    navigate(logoutTo, { replace: true });
  }, [logout, navigate, variant]);

  // 角色判断（以 active_role 会话身份为准——多角色切换后侧边栏跟随当前身份）
  const effectiveRole = getEffectiveRole(user);
  const isServerAdmin = isAdminRole(effectiveRole);
  const isInstanceAdminOrHigher = isInstanceAdminOrAbove(effectiveRole);

  // v4.28.0: 全员服主——角色集合与免密切换目标
  // 同层身份两面互切：user ↔ instance_admin 免密；server_admin 目标走弹窗密码通道
  const userRoles = (user?.roles ?? (user?.role ? [user.role] : [])) as UserRole[];
  const activeRole = (user?.active_role ?? user?.role) as UserRole | undefined;
  const quickSwitchTarget: UserRole | null =
    activeRole === 'user' && userRoles.includes('instance_admin')
      ? 'instance_admin'
      : activeRole === 'instance_admin' && userRoles.includes('user')
        ? 'user'
        : null;
  // 2 角色同层互切 → 一键项；其余多角色账号（3 角色或非常规组合）→ 「切换角色…」弹窗
  const showQuickSwitch = quickSwitchTarget !== null && userRoles.length <= 2;
  const canOpenRoleSwitcher = userRoles.length > 1 && !showQuickSwitch;
  const quickSwitchLabel = quickSwitchTarget === 'instance_admin' ? '切换为服主' : '切换为玩家';

  // v4.28.0: 免密快捷互切（玩家 ↔ 服主），成功跳转目标工作台，失败 toast 提示
  const handleQuickRoleSwitch = useCallback(
    async (target: UserRole) => {
      if (roleSwitching) return;
      setRoleSwitching(true);
      try {
        await switchActiveRole(target);
        navigate(target === 'instance_admin' ? '/store' : '/guild', { replace: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '角色切换失败，请稍后重试');
        setRoleSwitching(false);
      }
    },
    [roleSwitching, switchActiveRole, navigate, toast],
  );

  const sidebarClass = collapsed ? 'sidebar collapsed' : 'sidebar';
  const sidebarMobileClass = mobileMenuOpen ? `${sidebarClass} mobile-open` : sidebarClass;

  // 3.12: 激活态精确判定——使用显式映射表，而非 startsWith
  const activePath = useMemo(() => {
    const path = location.pathname;
    // 先尝试精确匹配
    if (PATH_ACTIVE_MAP[path] !== undefined) return PATH_ACTIVE_MAP[path] || null;

    // 动态路由优先：支持 /store/servers/:id 这类显式模式，避免被 /store 前缀误吞
    for (const [pattern, active] of Object.entries(PATH_ACTIVE_MAP)) {
      if (!active || !pattern.includes(':')) continue;
      if (matchPath({ path: pattern, end: true }, path)) return active;
    }

    // 退回到静态前缀匹配，并选择最长前缀避免宽模式抢命中
    let bestMatch: string | null = null;
    let bestPrefixLength = -1;
    for (const [prefix, active] of Object.entries(PATH_ACTIVE_MAP)) {
      if (!active || prefix.includes(':')) continue;
      if (path.startsWith(prefix + '/') && prefix.length > bestPrefixLength) {
        bestMatch = active;
        bestPrefixLength = prefix.length;
      }
    }

    return bestMatch;
  }, [location.pathname]);

  // 8.1: 面包屑（v4.14.0: 传入 variant 以支持三层基座）
  const breadcrumbs = useMemo(
    () => getBreadcrumbs(location.pathname, variant),
    [location.pathname, variant],
  );

  const renderLink = useCallback(
    (link: SidebarLink) => {
      const Icon = link.icon;
      const isActive = activePath === link.to;
      return (
        <button
          key={link.to}
          type="button"
          className={`sidebar-item${isActive ? ' active' : ''}`}
          title={collapsed ? link.label : undefined}
          onClick={() => navigate(link.to)}
          aria-current={isActive ? 'page' : undefined}
          aria-label={collapsed ? link.label : undefined}
        >
          <Icon size={18} />
          <span className="sidebar-label">{link.label}</span>
          {/* 通知未读数角标 */}
          {link.to === '/admin/notifications' && unreadCount > 0 && (
            <span
              className="badge badge-error"
              style={{ fontSize: 10, padding: '0 4px', marginLeft: 'auto' }}
            >
              {unreadCount}
            </span>
          )}
        </button>
      );
    },
    [activePath, collapsed, navigate, unreadCount],
  );

  // 9.1: 移动端底部导航项
  // v4.14.0: 路径统一到基座路由，player variant 商城/我的/发现用 /guild/*
  const mobileNavItems = useMemo(() => {
    if (variant === 'admin') {
      // v4.14.2: 底部nav全部在 /admin 基座内，"我的"指向 /admin/profile
      return [
        { to: '/admin', label: '大盘', icon: Home },
        { to: '/admin/users', label: '用户', icon: Users },
        { to: '/admin/notifications', label: '消息', icon: Bell },
        { to: '/admin/center', label: '我的', icon: Settings },
      ];
    }
    if (variant === 'store') {
      // v4.14.2: 底部nav全部在 /store 基座内，消息/我的不再跨基座到 /guild
      return [
        { to: '/store', label: '首页', icon: Home },
        { to: '/store/commercial', label: '商城', icon: ShoppingBag },
        { to: '/store/players', label: '玩家', icon: Users },
        { to: '/store/notifications', label: '消息', icon: Bell },
        { to: '/store/center', label: '我的', icon: Settings },
      ];
    }
    if (variant === 'player') {
      // v4.14.1: Player Portal 底部 tab——首页/商城/我的/发现/消息（全部在 /guild 基座内）
      return [
        { to: '/guild', label: '首页', icon: Home },
        { to: '/guild/shop', label: '商城', icon: ShoppingBag },
        { to: '/guild/center', label: '我的', icon: Wallet },
        { to: '/guild/discover', label: '发现', icon: Compass },
        { to: '/guild/notifications', label: '消息', icon: Bell },
      ];
    }
    // v4.14.2: default variant 按角色动态——暂用 player 的5tab（default variant 仅用于向后兼容路由）
    return [
      { to: '/guild', label: '首页', icon: Home },
      { to: '/guild/shop', label: '商城', icon: ShoppingBag },
      { to: '/guild/me', label: '我的', icon: Wallet },
      { to: '/guild/discover', label: '发现', icon: Compass },
      { to: '/guild/notifications', label: '消息', icon: Bell },
    ];
  }, [variant]);

  // v4.12.0: Player Portal 玩家门户布局——移动端优先 C 端电商
  // 隐藏侧边栏/汉堡按钮，改用顶部导航 + 常驻底部 tab；NodeStatusWidget 对玩家屏蔽
  // v4.14.0: 顶部栏增加用户头像/昵称/下拉菜单、搜索按钮、BUILD ID
  if (variant === 'player') {
    const userInitial = user?.username?.charAt(0)?.toUpperCase() || '?';
    // v4.30.0: 根容器挂 gp-theme——Apple 浅色设计 token；玩家门户蓝#007AFF / 服主工作台橙#FF9500 视觉区分
    return (
      <div className="app-layout guild-layout gp-theme" data-variant="player">
        {/* 十.1: 跳到主内容链接 */}
        <a href="#main-content" className="skip-link">
          跳到主内容
        </a>

        {/* 顶部导航栏——品牌 + 搜索 + 通知 + 用户头像菜单 */}
        <header className="guild-topbar">
          <button type="button" className="guild-brand" onClick={() => navigate('/guild')}>
            玩家门户
          </button>
          <div className="guild-topbar-actions">
            {/* 搜索按钮 */}
            <button
              type="button"
              className="guild-topbar-btn"
              onClick={() => navigate('/discover')}
              aria-label="发现服务器"
              title="发现服务器"
            >
              <Search size={20} />
            </button>
            {/* 通知铃铛 + 未读数角标 */}
            <button
              type="button"
              className="guild-topbar-btn"
              onClick={() => navigate('/guild/notifications')}
              aria-label="消息"
              title="消息"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="badge badge-error guild-topbar-badge">{unreadCount}</span>
              )}
            </button>
            {/* 用户头像 + 下拉菜单 */}
            {user && (
              <div className="guild-user-menu" ref={userMenuRef}>
                <button
                  type="button"
                  className="guild-avatar-btn"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-label="用户菜单"
                  aria-expanded={userMenuOpen}
                  title={user.username}
                >
                  <span className="guild-avatar">{userInitial}</span>
                </button>
                {userMenuOpen && (
                  <div className="guild-user-dropdown">
                    <div className="guild-user-dropdown-info">
                      <span className="guild-user-dropdown-name">{user.username}</span>
                      <span className="guild-user-dropdown-role">
                        {(effectiveRole && ROLE_LABEL_ZH[effectiveRole]) ?? effectiveRole ?? ''}
                      </span>
                    </div>
                    <div className="guild-user-dropdown-divider" />
                    {/* v4.28.0: 全员服主——同层身份一键免密切换 / 3 角色账号开弹窗 */}
                    {showQuickSwitch && quickSwitchTarget && (
                      <button
                        type="button"
                        className="guild-user-dropdown-item"
                        disabled={roleSwitching}
                        onClick={() => {
                          setUserMenuOpen(false);
                          void handleQuickRoleSwitch(quickSwitchTarget);
                        }}
                      >
                        <ArrowLeftRight size={16} />
                        <span>{roleSwitching ? '切换中…' : quickSwitchLabel}</span>
                      </button>
                    )}
                    {canOpenRoleSwitcher && (
                      <button
                        type="button"
                        className="guild-user-dropdown-item"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setRoleSwitcherOpen(true);
                        }}
                      >
                        <ArrowLeftRight size={16} />
                        <span>切换角色…</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="guild-user-dropdown-item"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/guild/profile');
                      }}
                    >
                      <User size={16} />
                      <span>个人设置</span>
                    </button>
                    {isServerAdmin && (
                      <button
                        type="button"
                        className="guild-user-dropdown-item"
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/admin');
                        }}
                      >
                        <ShieldCheck size={16} />
                        <span>平台大盘</span>
                      </button>
                    )}
                    {isInstanceAdminOrHigher && (
                      <button
                        type="button"
                        className="guild-user-dropdown-item"
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/store');
                        }}
                      >
                        <Crown size={16} />
                        <span>服主工作台</span>
                      </button>
                    )}
                    <div className="guild-user-dropdown-divider" />
                    <button
                      type="button"
                      className="guild-user-dropdown-item guild-user-dropdown-logout"
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLogout();
                      }}
                    >
                      <LogOut size={16} />
                      <span>退出登录</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* 内容区——全宽，无侧边栏 */}
        <main id="main-content" className="app-content guild-content">
          {breadcrumbs.length > 0 && (
            <p className="mobile-page-title">{breadcrumbs[breadcrumbs.length - 1].label}</p>
          )}
          <Suspense
            fallback={
              <div className="loading-screen">
                <div className="loading-spinner" />
                <p>加载中…</p>
              </div>
            }
          >
            {children ?? <Outlet />}
          </Suspense>
        </main>

        {/* 底部 tab 导航——常驻所有视口（C 端电商主导航） */}
        <nav className="mobile-bottom-nav guild-bottom-nav" aria-label="主导航">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePath === item.to;
            return (
              <button
                key={item.to}
                type="button"
                className={`mobile-bottom-item${isActive ? ' active' : ''}`}
                onClick={() => navigate(item.to)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
              >
                <Icon size={20} />
                <span className="mobile-bottom-label">{item.label}</span>
                {(item.to === '/admin/notifications' ||
                  item.to === '/guild/notifications' ||
                  item.to === '/store/notifications') &&
                  unreadCount > 0 && (
                    <span className="badge badge-error mobile-bottom-badge">{unreadCount}</span>
                  )}
              </button>
            );
          })}
        </nav>

        {/* chrome 组件保留——命令面板 / 快捷键帮助 / 帮助中心 / 版本信息 */}
        <CommandPalette />
        <ShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
        <HelpModal
          open={helpModalOpen}
          onClose={() => setHelpModalOpen(false)}
          onOpenShortcuts={() => setShortcutsHelpOpen(true)}
        />
        <VersionInfoModal open={versionModalOpen} onClose={() => setVersionModalOpen(false)} />
        {/* v4.28.0: 角色切换弹窗（3 角色账号入口；2 角色走一键免密切换） */}
        <RoleSwitcherModal open={roleSwitcherOpen} onClose={() => setRoleSwitcherOpen(false)} />
      </div>
    );
  }

  return (
    <div className="app-layout" data-variant={variant}>
      {/* 十.1: 跳到主内容链接——键盘用户快速跳过侧边栏导航 */}
      <a href="#main-content" className="skip-link">
        跳到主内容
      </a>

      {/* 五.3: 移动端顶部汉堡按钮（<768px 显示） */}
      <button
        ref={mobileMenuToggleRef}
        type="button"
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(true)}
        aria-label="打开菜单"
        aria-expanded={mobileMenuOpen}
        aria-controls="app-sidebar"
      >
        <Menu size={20} />
      </button>

      {/* 五.3: 移动端抽屉遮罩 */}
      {mobileMenuOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside id="app-sidebar" className={sidebarMobileClass} aria-label="主导航">
        <div className="sidebar-header">
          <span className="sidebar-brand">
            {variant === 'admin'
              ? 'Platform Dashboard'
              : variant === 'store'
                ? '服主工作台'
                : 'GameServer Panel'}
          </span>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
          {/* 五.3: 移动端关闭按钮 */}
          <button
            type="button"
            className="sidebar-close-mobile"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="关闭菜单"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {variant === 'store' ? (
            // v4.12.0: GM Workbench 服主工作台导航——店铺运营/玩家管理/数据报表/实例运营
            STORE_NAV_GROUPS.map((group) => {
              const isGroupCollapsed = collapsedGroups.has(group.title);
              return (
                <div
                  key={group.title}
                  className={`sidebar-group${isGroupCollapsed ? ' group-collapsed' : ''}`}
                >
                  <button
                    type="button"
                    className="sidebar-group-title sidebar-group-toggle"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={!isGroupCollapsed}
                    title={isGroupCollapsed ? `展开「${group.title}」` : `折叠「${group.title}」`}
                  >
                    <Group size={12} />
                    <span>{group.title}</span>
                    <ChevronDown size={14} className="sidebar-group-chevron" />
                  </button>
                  {!isGroupCollapsed && group.links.map((link) => renderLink(link))}
                </div>
              );
            })
          ) : (
            <>
              {/* v4.14.2: default variant 侧边栏按角色分层显示 */}
              {variant !== 'admin' && (
                <div className="sidebar-group">
                  {/* 消费侧入口（所有登录用户可见） */}
                  {PLAYER_LINKS.map(renderLink)}
                </div>
              )}

              {/* instance_admin+ 可见的实例管理分组（default/admin variant 下，非 server_admin） */}
              {/* v4.28.0: variant='admin' 时 instance_admin 进入 /admin/nodes 独立路由，需渲染此分组 */}
              {(variant === 'default' || variant === 'admin') && isInstanceAdminOrHigher && !isServerAdmin && (
                <div className="sidebar-group">
                  <div className="sidebar-group-title">
                    <Crown size={12} />
                    <span>实例管理</span>
                  </div>
                  {INSTANCE_ADMIN_LINKS.map(renderLink)}
                </div>
              )}

              {/* v4.28.0: variant='admin' 时仅 server_admin 才渲染 ADMIN_GROUPS（避免 instance_admin 看到无权访问的入口） */}
              {((variant === 'admin' && isServerAdmin) || (variant === 'default' && isServerAdmin)) && (
                <>
                  {/* v3.7.0-E1: 系统管理分组——用户与权限 / 系统监控 / 配置管理 / 审计与日志 / 运维清理 / 业务运营 */}
                  {/* v4.8.0-P3 (J2): 分组标题可点击折叠，减少移动端抽屉滚动距离 */}
                  {ADMIN_GROUPS.map((group) => {
                    const isGroupCollapsed = collapsedGroups.has(group.title);
                    return (
                      <div
                        key={group.title}
                        className={`sidebar-group${isGroupCollapsed ? ' group-collapsed' : ''}`}
                      >
                        <button
                          type="button"
                          className="sidebar-group-title sidebar-group-toggle"
                          onClick={() => toggleGroup(group.title)}
                          aria-expanded={!isGroupCollapsed}
                          title={
                            isGroupCollapsed ? `展开「${group.title}」` : `折叠「${group.title}」`
                          }
                        >
                          <Group size={12} />
                          <span>{group.title}</span>
                          <ChevronDown size={14} className="sidebar-group-chevron" />
                        </button>
                        {!isGroupCollapsed && group.links.map((link) => renderLink(link))}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          {/* 十.5: 帮助中心入口——? 图标按钮（顶部） */}
          <button
            type="button"
            className="btn btn-ghost sidebar-help-btn"
            onClick={() => setHelpModalOpen(true)}
            title="帮助中心"
            aria-label="帮助中心"
          >
            <HelpCircle size={16} />
            <span className="sidebar-label">帮助</span>
          </button>
          {/* v4.25.0: 用户名按钮——点击弹出二级菜单（用户管理 / 退出登录） */}
          {user && (
            <div className="sidebar-user-menu" ref={sidebarUserMenuRef}>
              <button
                type="button"
                className="sidebar-user-trigger"
                onClick={() => setSidebarUserMenuOpen((v) => !v)}
                aria-label="用户菜单"
                aria-expanded={sidebarUserMenuOpen}
                title={user.username}
              >
                <span className="sidebar-user-avatar" aria-hidden="true">
                  {(user.username?.charAt(0) || '?').toUpperCase()}
                </span>
                <span className="sidebar-user-text">
                  <span className="user-name">{user.username}</span>
                  <span className="user-role">
                    {effectiveRole === 'server_admin'
                      ? '服务器管理员'
                      : effectiveRole === 'instance_admin'
                        ? '实例管理员'
                        : effectiveRole === 'user'
                          ? '普通用户'
                          : effectiveRole}
                  </span>
                </span>
                <ChevronDown size={14} className="sidebar-user-chevron" aria-hidden="true" />
              </button>
              {sidebarUserMenuOpen && (
                <div className="sidebar-user-dropdown" role="menu">
                  {isServerAdmin && (
                    <button
                      type="button"
                      className="sidebar-user-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setSidebarUserMenuOpen(false);
                        navigate('/admin/users');
                      }}
                    >
                      <Users size={16} />
                      <span>用户管理</span>
                    </button>
                  )}
                  {/* v4.28.0: 全员服主——同层身份一键免密切换 / 3 角色账号开弹窗 */}
                  {showQuickSwitch && quickSwitchTarget && (
                    <button
                      type="button"
                      className="sidebar-user-dropdown-item"
                      role="menuitem"
                      disabled={roleSwitching}
                      onClick={() => {
                        setSidebarUserMenuOpen(false);
                        void handleQuickRoleSwitch(quickSwitchTarget);
                      }}
                    >
                      <ArrowLeftRight size={16} />
                      <span>{roleSwitching ? '切换中…' : quickSwitchLabel}</span>
                    </button>
                  )}
                  {canOpenRoleSwitcher && (
                    <button
                      type="button"
                      className="sidebar-user-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setSidebarUserMenuOpen(false);
                        setRoleSwitcherOpen(true);
                      }}
                    >
                      <ArrowLeftRight size={16} />
                      <span>切换角色…</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="sidebar-user-dropdown-item sidebar-user-dropdown-logout"
                    role="menuitem"
                    onClick={() => {
                      setSidebarUserMenuOpen(false);
                      handleLogout();
                    }}
                  >
                    <LogOut size={16} />
                    <span>退出登录</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {/* 第十一章 11.1: 版本号可点击打开版本信息模态（检查更新/回退）——置底 */}
          <button
            type="button"
            className="version"
            onClick={() => setVersionModalOpen(true)}
            title="查看版本信息 / 检查更新"
            aria-label="查看版本信息"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: 'inherit',
            }}
          >
            v{version}
          </button>
        </div>
      </aside>

      <main id="main-content" className="app-content">
        {/* v4.8.0-P3 (J2): 移动端页面标题——移动端隐藏完整面包屑，仅显示当前页标题 */}
        {breadcrumbs.length > 0 && (
          <h1 className="mobile-page-title">{breadcrumbs[breadcrumbs.length - 1].label}</h1>
        )}
        {/* 8.1: 顶部面包屑导航（桌面端完整路径，移动端由 .mobile-page-title 替代） */}
        {breadcrumbs.length > 1 && (
          <nav className="breadcrumbs" aria-label="面包屑导航">
            {breadcrumbs.map((item, i) => (
              <span key={i} className="breadcrumb-item">
                {item.to && i < breadcrumbs.length - 1 ? (
                  <button
                    type="button"
                    className="breadcrumb-link"
                    onClick={() => navigate(item.to!)}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span className="breadcrumb-current">{item.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <span className="breadcrumb-separator">/</span>}
              </span>
            ))}
          </nav>
        )}
        <Suspense
          fallback={
            <div className="loading-screen">
              <div className="loading-spinner" />
              <p>加载中…</p>
            </div>
          }
        >
          {children ?? <Outlet />}
        </Suspense>
      </main>

      {/* 9.1: 移动端底部导航（<768px 显示） */}
      <nav className="mobile-bottom-nav" aria-label="移动端主导航">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePath === item.to;
          return (
            <button
              key={item.to}
              type="button"
              className={`mobile-bottom-item${isActive ? ' active' : ''}`}
              onClick={() => navigate(item.to)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
            >
              <Icon size={20} />
              <span className="mobile-bottom-label">{item.label}</span>
              {item.to === '/admin/notifications' && unreadCount > 0 && (
                <span className="badge badge-error mobile-bottom-badge">{unreadCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 8.2: 全局命令面板（Ctrl+K / Cmd+K）— 自管理 open 状态 */}
      <CommandPalette />
      {/* 8.6: 快捷键帮助模态（? 触发） */}
      <ShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
      {/* 十.5: 帮助中心模态——快捷键入口复用 ShortcutsHelp */}
      <HelpModal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        onOpenShortcuts={() => setShortcutsHelpOpen(true)}
      />
      {/* 第十一章 11.1: 版本信息模态——检查更新 / 版本回退 */}
      <VersionInfoModal open={versionModalOpen} onClose={() => setVersionModalOpen(false)} />
      {/* v4.28.0: 角色切换弹窗（3 角色账号入口；2 角色走一键免密切换） */}
      <RoleSwitcherModal open={roleSwitcherOpen} onClose={() => setRoleSwitcherOpen(false)} />
      {/* 极简节点状态悬浮组件 */}
      <NodeStatusWidget />
    </div>
  );
}
