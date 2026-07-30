// ============================================================================
// ServerDetailCore — 实例详情核心视图逻辑（v4.36.0 B6 拆分自 pages/ServerDetail）
// 显示 name/status/pack/port/rcon_port + RCON 控制台 + 启动/停止/删除按钮
// 实时状态通过 RconConsole 的 onStateChange 回传（单一 WS 连接）
// 消费方：admin/ServerDetailAdmin（/admin/servers/:id）、store/ServerDetailStore
// （/store/servers/:id）两个角色包装组件；pages/ServerDetail 为兼容再导出层。
// ============================================================================

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RefreshCw, AlertTriangle, Pencil, Wallet } from 'lucide-react';
import type { InstanceState } from '@public/schema/daemon-api-types';
import type { PackSummary, ServerSummary } from '@public/schema/panel-api-types';
import type { UITabObject } from '@public/schema/pack-schema';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSwipe } from '../../hooks/useSwipe';
import { PanelApiError } from '../../api/client';
import { useUpdateServerExpiry } from '../../api/queries/servers';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../../utils/role';
import { formatBytes } from '../../utils/formatBytes';
import { useToast, ErrorState, Skeleton } from '../../components/ui';
import { useConfirm } from '../../context/ConfirmContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import RconConsole from '../../components/RconConsole';
import ExpiryEditModal from './ExpiryEditModal';
// v4.2.0-D2: 玩家管理页（替代 PlayerHistories，包含在线操作 + 白/黑名单 + 历史）
// v3.7.0-B4: 业务相关 tab（shop-admin/chat-triggers/player-join-settings/vote-settings）
// 已迁移到 /instances/:id/business 二级页面，不再在此导入

const StartupGuideWizard = lazy(() => import('../../components/StartupGuideWizard'));
const ConfigFiles = lazy(() => import('./ConfigFiles'));
const WorldGen = lazy(() => import('./WorldGen'));
const Mods = lazy(() => import('./Mods'));
const Saves = lazy(() => import('./Saves'));
const Players = lazy(() => import('./Players'));
const ChatLogs = lazy(() => import('./ChatLogs'));
const UpdateCheck = lazy(() => import('./UpdateCheck'));
const LogFiles = lazy(() => import('./LogFiles'));
const Admins = lazy(() => import('./Admins'));
const InstanceRoles = lazy(() => import('./InstanceRoles'));
const GameCommandHelp = lazy(() => import('./GameCommandHelp'));

// Tab 元数据：key → 显示名
// console / shop-admin 为底座通用 tab，始终显示；
// 其余 tab 由 Pack.ui_tabs 动态追加。
const TAB_LABELS: Record<string, string> = {
  console: '控制台',
  'shop-admin': '商店管理',
  'chat-triggers': '聊天触发',
  'player-join-settings': '加入设置',
  'vote-settings': '投票设置',
  'game-command-help': '命令帮助',
  mods: 'Mod 管理',
  saves: '存档管理',
  'config-files': '配置文件',
  'world-gen': '地图生成',
  'chat-logs': '聊天日志',
  update: '服务端版本',
  'log-files': '日志文件',
  // v4.5.0: 实例共管管理员管理
  admins: '共管管理',
  // v4.7.0-H2: 实例级角色管理（instance_admin+）
  roles: '角色管理',
  // v3.7.0-B4: 业务运营 pseudo-tab，点击跳转到 /instances/:id/business
  __business__: '业务运营',
};

// v3.7.0-B2: Tab 分组显示名（4 组）
const GROUP_LABELS: Record<string, string> = {
  runtime: '运行时',
  config: '配置',
  ops: '运维',
  business: '业务运营',
};

// v3.7.0-B4: 业务运营 pseudo-tab key（点击导航到 /instances/:id/business）
const BUSINESS_TAB_KEY = '__business__';

// v3.7.0: 底座 tab 转 UITabObject 格式（带 group/order/require_state）
// 这样底座 tab 与 Pack.ui_tabs 在数据结构上统一，便于 B2 分组 + B3 状态联动
const ALL_STATES: InstanceState[] = ['stopped', 'starting', 'running', 'stopping', 'error'];
const CLEANUP_LABELS: Record<string, string> = {
  backups: '备份文件',
  saves: '存档文件',
  mods: 'Mod 文件',
  logs: '日志文件',
  cache: '缓存文件',
};
const BASE_USER_TAB_OBJECTS: UITabObject[] = [
  { tab: 'console', group: 'runtime', order: 10, require_state: ALL_STATES },
  { tab: 'log-files', group: 'runtime', order: 20, require_state: ALL_STATES },
  { tab: 'game-command-help', group: 'runtime', order: 60, require_state: ALL_STATES },
  // v4.x.x: admins/roles 已纳入 InstanceTabSchema 枚举（public/schema/pack-schema.ts）
  { tab: 'admins', group: 'ops', order: 70, require_state: ALL_STATES },
  { tab: 'roles', group: 'ops', order: 71, require_state: ALL_STATES },
];

// v3.7.0-B4: 管理员业务 tab（shop-admin/chat-triggers/player-join-settings/vote-settings）
// 全部移到 /instances/:id/business 二级页面，ServerDetail 不再渲染为 inline tab。
// Business.tsx 二级页面会按 pack.business 配置动态渲染这些子组件。

const STATE_LABEL: Record<InstanceState, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  error: '错误',
};

function stateClass(state: InstanceState): string {
  return `badge badge-${state}`;
}

// v3-billing: 有效期日期格式化（本地时区 YYYY-MM-DD）
function formatExpiryDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// v3-billing: 有效期展示辅助（详情页详细版）
// 返回 { text, color?, warning? }——warning 为附加警示文字（橙色）
function getExpiryDetailDisplay(
  expiresAt: string | null,
  expiryStatus: ServerSummary['expiry_status'],
): { text: string; color?: string; warning?: string } {
  if (expiryStatus === 'permanent' || expiresAt === null) {
    return { text: '永久有效' };
  }
  if (expiryStatus === 'cleaned') {
    return { text: '已清理', color: 'var(--color-text-muted)' };
  }
  if (expiryStatus === 'expired') {
    return { text: '已过期', color: 'var(--color-danger)' };
  }
  const dateStr = formatExpiryDate(expiresAt);
  if (expiryStatus === 'grace') {
    return { text: `宽限期（${dateStr} 结束）`, color: 'var(--color-warning)' };
  }
  // active：≤3天附加"即将到期"橙色警示
  const expiryDate = new Date(expiresAt);
  const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
  if (daysLeft <= 3) {
    return { text: `${dateStr} 到期`, warning: '即将到期' };
  }
  return { text: `${dateStr} 到期` };
}

// v3-billing: 计费周期展示标签
const BILLING_CYCLE_LABELS: Record<number, string> = {
  1: '月付',
  3: '季付',
  6: '半年付',
  12: '年付',
};

// v3-billing: 实例类型展示标签
const INSTANCE_TYPE_LABELS: Record<string, string> = {
  micro: '微型',
  small: '小型',
  medium: '中型',
  large: '大型',
  xlarge: '超大型',
};

// v3-billing: 豁免原因展示标签
const EXEMPT_REASON_LABELS: Record<string, string> = {
  owner_self: '腐竹自有实例',
  self_hosted_node: '自带节点',
  manual: '管理员豁免',
};

function useMediaQuery(query: string): boolean {
  const getMatches = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    setMatches(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [query]);

  return matches;
}

// 五.10: TabPanel 辅助组件——统一注入 role="tabpanel" / aria-labelledby / id / tabIndex
// 配合 tablist 的 aria-controls 关联，符合 WAI-ARIA Tabs 模式
interface TabPanelProps {
  tabKey: string;
  activeTab: string;
  activated: boolean;
  className?: string;
  children: ReactNode;
}

function TabPanel({ tabKey, activeTab, activated, className, children }: TabPanelProps) {
  if (!activated && activeTab !== tabKey) return null;
  return (
    <div
      id={`tabpanel-${tabKey}`}
      role="tabpanel"
      aria-labelledby={`tab-${tabKey}`}
      tabIndex={0}
      className={className}
      style={{ display: activeTab === tabKey ? 'block' : 'none' }}
    >
      {children}
    </div>
  );
}

function LazyTabContent({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Skeleton lines={6} lineHeight={16} />}>
      {children}
    </Suspense>
  );
}

export interface ServerDetailCoreProps {
  viewMode?: 'default' | 'store';
  listPath?: string;
  businessPathForServer?: (serverId: string) => string;
}

export default function ServerDetailCore({
  viewMode = 'default',
  listPath = '/instances',
  businessPathForServer = (serverId: string) => `/instances/${serverId}/business`,
}: ServerDetailCoreProps) {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useAuth();
  const effectiveRole = getEffectiveRole(user);
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isStoreView = viewMode === 'store';
  const isMobileTabView = useMediaQuery('(max-width: 768px)');
  // 3.1: Tab 状态持久化到 URL ?tab=
  const [searchParams, setSearchParams] = useSearchParams();

  const [server, setServer] = useState<ServerSummary | null>(null);
  const [liveState, setLiveState] = useState<InstanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  // v1.1.0: 启动前置引导向导
  const [showStartupWizard, setShowStartupWizard] = useState(false);
  // 一.4: 删除二次确认弹窗
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // v3.6.1-B2: 磁盘占用刷新中状态
  const [refreshingDisk, setRefreshingDisk] = useState(false);
  // v3.6.2-B2: 子目录清理中状态（记录正在清理的 subdir 名，null 表示无操作）
  const [cleaningSubdir, setCleaningSubdir] = useState<string | null>(null);
  // 管理员修改有效期弹窗
  const [showExpiryEdit, setShowExpiryEdit] = useState(false);
  const updateExpiryMutation = useUpdateServerExpiry();

  // v3-billing: 实例计费设置 + 续费记录 + 续费操作状态
  const [billingSettings, setBillingSettings] = useState<
    import('@public/interface_stub/shared-types').InstanceBillingSettings | null
  >(null);
  const [renewals, setRenewals] = useState<
    import('@public/interface_stub/shared-types').InstanceRenewal[]
  >([]);
  const [renewCycle, setRenewCycle] = useState<
    import('@public/interface_stub/shared-types').BillingCycleMonths
  >(1);
  const [renewing, setRenewing] = useState(false);
  const [showRenewals, setShowRenewals] = useState(false);

  // Pack.ui_tabs：用于动态渲染实例详情子页 tab
  // v3.7.0: 后端 loader 已规范化为 UITabObject[] 对象数组
  const [uiTabs, setUiTabs] = useState<UITabObject[] | null>(null);

  // v3.7.0-B1: 信息卡折叠状态——默认折叠（移动端优先），桌面端记忆 localStorage
  // 首次进入：collapsed（移动端友好，首屏直接看到 Tab）；用户展开后记忆到 localStorage
  const [infoExpanded, setInfoExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = window.localStorage.getItem('gsp:server-detail:info-expanded');
      return saved === '1';
    } catch {
      return false;
    }
  });
  const toggleInfoExpanded = useCallback(() => {
    setInfoExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('gsp:server-detail:info-expanded', next ? '1' : '0');
      } catch {
        // localStorage 不可用时静默降级（隐私模式等）
      }
      return next;
    });
  }, []);
  // 3.1: 当前激活的 tab，初始从 URL ?tab= 读取，校验失败回落到 console
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabFromUrl = searchParams.get('tab');
    return tabFromUrl && TAB_LABELS[tabFromUrl] ? tabFromUrl : 'console';
  });
  // 三.4: 已激活过的 tab 集合（keep-alive）
  // 子页首次访问后保持挂载，切换 tab 用 display:none 隐藏而非卸载，保留内部状态（分页/草稿等）
  const [activatedTabs, setActivatedTabs] = useState<Set<string>>(() => new Set(['console']));

  useDocumentTitle(server?.name ? `实例 - ${server.name}` : '实例详情');

  const serverId = id ?? '';

  const refresh = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getServer(serverId);
      // 4.7: cancelled 守卫——组件卸载或切换实例后丢弃结果
      if (cancelledRef.current) return;
      setServer(res.server);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : '加载服务器失败');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [api, serverId]);

  // 4.7: 取消守卫——切换实例/卸载组件时丢弃未完成请求的 setState
  // 关键：不使用 AbortController——AbortController.abort() 触发的
  // net::ERR_ABORTED 会被浏览器网络层写入控制台，JS try/catch 无法抑制。
  // 正确做法：让请求自然完成，仅在结果到达时根据 cancelled 标志决定是否 setState。
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  // 加载 Pack 列表获取当前 server.pack_id 对应的 ui_tabs
  // 仅在 server 加载完成后触发一次（按 pack_id）
  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    api
      .listPacks()
      .then((res) => {
        if (cancelled) return;
        const target: PackSummary | undefined = res.packs.find((p) => p.id === server.pack_id);
        setUiTabs(target?.ui_tabs ?? []);
      })
      .catch(() => {
        if (!cancelled) setUiTabs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, server]);

  // v3-billing: 加载实例计费设置 + 续费记录（server 加载完成后触发）
  // 计费设置用于展示实例类型/豁免/自动续扣；续费记录用于展示历史扣款
  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    api
      .getInstanceBillingSettings(server.id)
      .then((res) => {
        if (cancelled) return;
        setBillingSettings(res.settings);
        if (res.settings.last_billing_cycle_months) {
          setRenewCycle(res.settings.last_billing_cycle_months);
        }
      })
      .catch(() => {
        // 计费设置加载失败不阻断详情页（可能未接入计费）
        if (cancelled) setBillingSettings(null);
      });
    api
      .listInstanceRenewals(server.id, 20)
      .then((res) => {
        if (cancelled) return;
        setRenewals(res.renewals);
      })
      .catch(() => {
        if (cancelled) setRenewals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, server]);

  // v3-billing: 手动续费
  const handleRenew = useCallback(async () => {
    if (!server || renewing) return;
    setRenewing(true);
    try {
      const res = await api.renewInstance(server.id, { billing_cycle_months: renewCycle });
      const result = res.renewal;
      if (result.exempt || result.amount_paid === 0) {
        toast.success('续费成功（免计费）');
      } else {
        toast.success(`续费成功，已扣费 ${result.amount_paid} 点券`);
      }
      // 刷新详情页（更新 expires_at）+ 计费记录
      void refresh();
      api
        .listInstanceRenewals(server.id, 20)
        .then((r) => setRenewals(r.renewals))
        .catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '续费失败');
    } finally {
      setRenewing(false);
    }
  }, [api, server, renewing, renewCycle, toast, refresh]);

  // v3.7.0: 最终展示的 tab 列表（UITabObject[] 格式，含 group/order/require_state）
  // - 合并底座 tab（BASE_USER_TAB_OBJECTS）+ Pack.ui_tabs（去重，按 group+order 排序）
  // - B4: business group 的 tab 替换为 __business__ pseudo-tab（点击导航到 /business）
  // - B3: require_state 不匹配当前实例状态的 tab 被过滤掉
  const allTabs: UITabObject[] = useMemo(() => {
    const admin = isAdminRole(effectiveRole);
    const instanceAdminOrAbove = isInstanceAdminOrAbove(effectiveRole);
    // v4.5.0: admins tab 仅 instance_admin+（此处用 isAdminRole 与现有 business 门控一致）可见
    let result: UITabObject[] = [...BASE_USER_TAB_OBJECTS];
    if (!admin) {
      result = result.filter((t) => String(t.tab) !== 'admins');
    }
    // v4.7.0-H2: roles tab 仅 instance_admin+ 可见
    if (!instanceAdminOrAbove) {
      result = result.filter((t) => String(t.tab) !== 'roles');
    }

    if (uiTabs) {
      const seen = new Set(result.map((t) => t.tab));
      for (const t of uiTabs) {
        if (!seen.has(t.tab) && TAB_LABELS[t.tab]) {
          result.push(t);
          seen.add(t.tab);
        }
      }
    }
    return result;
  }, [uiTabs, effectiveRole]);

  // v3.7.0-B3: 按当前实例状态过滤 tab（require_state 不匹配的不渲染）
  // 同时 B4: 把 business group 的所有 tab 替换为单个 __business__ pseudo-tab
  const displayState = liveState ?? server?.status ?? null;
  const visibleTabs: UITabObject[] = useMemo(() => {
    if (!displayState) return [];

    // 先按 require_state 过滤
    const filtered = allTabs.filter((t) => {
      const allowed = t.require_state ?? ALL_STATES;
      return allowed.includes(displayState);
    });

    // B4: business group 折叠为单个 __business__ pseudo-tab（仅管理员可见）
    const admin = isAdminRole(effectiveRole);
    const hasBusiness = filtered.some((t) => t.group === 'business');
    const nonBusiness = filtered.filter((t) => t.group !== 'business');
    if (admin && hasBusiness) {
      return [
        ...nonBusiness,
        {
          tab: BUSINESS_TAB_KEY as unknown as UITabObject['tab'],
          group: 'business',
          order: 1000,
          require_state: ALL_STATES,
        },
      ];
    }
    return nonBusiness;
  }, [allTabs, displayState, effectiveRole]);

  // v3.7.0-B2: 按分组聚合 visibleTabs，组内按 order 升序
  // 返回有序的 [group, tabs][] 数组，便于渲染
  const groupedTabs: Array<{ group: string; tabs: UITabObject[] }> = useMemo(() => {
    const map = new Map<string, UITabObject[]>();
    for (const t of visibleTabs) {
      const g = t.group ?? 'runtime';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    // 组内按 order 升序
    for (const tabs of map.values()) {
      tabs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    // 组间按固定顺序：runtime → config → ops → business
    const groupOrder = ['runtime', 'config', 'ops', 'business'];
    return groupOrder.filter((g) => map.has(g)).map((g) => ({ group: g, tabs: map.get(g)! }));
  }, [visibleTabs]);

  // v4.32.5: 2 级菜单——当前激活分组由 activeTab 反推（activeTab 所在组即激活组）
  const activeGroup = useMemo(() => {
    const tab = visibleTabs.find((t) => String(t.tab) === activeTab);
    return tab?.group ?? 'runtime';
  }, [visibleTabs, activeTab]);

  // v4.32.5: 当前激活分组的子 tab 列表
  const activeGroupTabs = useMemo(
    () => groupedTabs.find((g) => g.group === activeGroup)?.tabs ?? [],
    [groupedTabs, activeGroup],
  );

  // v4.32.5: 记忆每个分组最后访问的 tab，切换分组时恢复（business pseudo-tab 不记忆）
  const [lastTabByGroup, setLastTabByGroup] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!activeTab || activeTab === BUSINESS_TAB_KEY) return;
    setLastTabByGroup((prev) =>
      prev[activeGroup] === activeTab ? prev : { ...prev, [activeGroup]: activeTab },
    );
  }, [activeTab, activeGroup]);

  // v3.7.0: 兼容旧代码——保留 `tabs` 字符串数组（供 useSwipe / URL 校验等使用）
  const tabs: string[] = useMemo(() => visibleTabs.map((t) => t.tab), [visibleTabs]);

  // v3.7.0-B6: 当前 activeTab 的警告条内容（基于 tab 类型 + 实例状态）
  // 返回 null 表示无警告；返回 { text, danger } 显示警告条
  const activeTabWarning: { text: string; danger?: boolean } | null = useMemo(() => {
    if (!displayState) return null;
    // ConfigFiles 在 running 状态下修改需重启生效
    if (
      activeTab === 'config-files' &&
      (displayState === 'running' || displayState === 'starting')
    ) {
      return { text: '实例运行中，修改配置文件后需重启实例才能生效。' };
    }
    // world-gen / update / saves / mods 在非 stopped/error 状态下操作受限
    if (
      (activeTab === 'world-gen' ||
        activeTab === 'update' ||
        activeTab === 'saves' ||
        activeTab === 'mods') &&
      (displayState === 'running' || displayState === 'starting' || displayState === 'stopping')
    ) {
      return { text: '实例运行中，此 Tab 下的操作不可用。请先停止实例。', danger: true };
    }
    return null;
  }, [activeTab, displayState]);

  // 3.1: 切换 Tab 时同步到 URL ?tab=
  const switchTab = useCallback(
    (key: string) => {
      setActiveTab(key);
      setSearchParams({ tab: key }, { replace: true });
    },
    [setSearchParams],
  );

  // v4.32.5: business 路径提前到 hooks 区计算——server 未加载时回落到 URL serverId
  // （值等价：server 由 id 参数拉取，加载后 server.id === serverId）
  const businessPath = businessPathForServer(server?.id ?? serverId);

  // v4.32.5: 切换一级分组——business 直接导航到 /business（pseudo-tab 唯一入口），
  // 其他分组切到该组上次访问的 tab，无记忆时回落到该组第一个 tab
  // 注：必须在早退 return 之前的 hooks 区定义（React hooks 规则），且位于 switchTab 之后避免 TDZ
  const switchGroup = useCallback(
    (group: string) => {
      if (group === 'business') {
        navigate(businessPath);
        return;
      }
      const groupTabs = groupedTabs.find((g) => g.group === group)?.tabs ?? [];
      if (groupTabs.length === 0) return;
      const lastTab = lastTabByGroup[group];
      const targetTabObj =
        lastTab && groupTabs.some((t) => String(t.tab) === lastTab)
          ? (groupTabs.find((t) => String(t.tab) === lastTab) ?? groupTabs[0])
          : groupTabs[0];
      switchTab(String(targetTabObj.tab));
    },
    [groupedTabs, lastTabByGroup, switchTab, navigate, businessPath],
  );

  // 9.6: 移动端左右滑动切换 Tab（含越界 bounds check）
  const tabContentRef = useSwipe({
    onSwipeLeft: () => {
      const idx = tabs.indexOf(activeTab);
      if (idx === -1) return;
      const next = idx + 1;
      if (next < tabs.length) switchTab(tabs[next]);
    },
    onSwipeRight: () => {
      const idx = tabs.indexOf(activeTab);
      if (idx === -1) return;
      const prev = idx - 1;
      if (prev >= 0) switchTab(tabs[prev]);
    },
  });

  // 若当前 activeTab 被移除（如切换 server 后 Pack 不支持该 tab 或角色无权限），回落到 console
  useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(activeTab)) {
      switchTab('console');
    }
  }, [tabs, activeTab, switchTab]);

  // 3.1: 浏览器前进/后退恢复 Tab——URL ?tab= 变化时同步 activeTab
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (
      tabFromUrl &&
      tabFromUrl !== activeTab &&
      TAB_LABELS[tabFromUrl] &&
      tabs.includes(tabFromUrl)
    ) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams, activeTab, tabs]);

  // 三.4: activeTab 变化时登记到 activatedTabs，使该 tab 首次访问后保持挂载
  useEffect(() => {
    setActivatedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // displayState 已在 v3.7.0 B3 状态联动过滤处声明，此处仅保留 handleStateChange
  const handleStateChange = useCallback((state: InstanceState) => {
    setLiveState(state);
  }, []);

  // 4.8: WS 重连成功时拉取一次最新状态，避免 WS 断线期间错过的状态变更
  // WS 断线时（connected === false）不覆盖 server.status，仅当重连成功时 refresh()
  const prevConnectedRef = useRef<boolean | null>(null);
  const handleConnectedChange = useCallback(
    (connected: boolean) => {
      // 仅在 false → true（重连成功）时触发 refresh
      if (prevConnectedRef.current === false && connected) {
        void refresh();
      }
      prevConnectedRef.current = connected;
    },
    [refresh],
  );

  const handleStart = async () => {
    if (!server) return;
    // v1.1.0: 启动前置引导——先检查 Pack 是否声明 startup_guide 且未完成
    try {
      const guideResp = await api.getStartupGuide(server.id);
      if (guideResp.guide && !guideResp.completed) {
        // 需要引导但未完成 → 打开向导，完成后再启动
        setShowStartupWizard(true);
        return;
      }
    } catch {
      // 获取引导失败不阻断启动（向后兼容，后端 /start 也会再校验）
    }
    await doStart();
  };

  // v1.1.0: 实际调用 /start（引导完成或无需引导时）
  const doStart = async () => {
    if (!server) return;
    setActioning(true);
    setError(null);
    try {
      await api.startServer(server.id);
      setLiveState('starting');
      toast.success('实例启动中');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setActioning(false);
    }
  };

  // v1.1.0: 启动向导完成（配置已保存）→ 执行启动
  const handleStartupWizardComplete = () => {
    setShowStartupWizard(false);
    void doStart();
  };

  const handleStop = async () => {
    if (!server) return;
    setActioning(true);
    setError(null);
    try {
      await api.stopServer(server.id);
      setLiveState('stopping');
      toast.success('实例停止中');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '停止失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setActioning(false);
    }
  };

  // v4.29.8: 强制重置状态（error → stopped，仅 admin，纯 DB 操作不调 daemon）
  const handleResetState = async () => {
    if (!server) return;
    const ok = await confirm({
      title: '强制重置状态',
      message: `将实例「${server.name}」从 error 强制回退到 stopped。此操作不调用 daemon，若有残留进程请先尝试停止。`,
      confirmText: '重置',
      danger: true,
    });
    if (!ok) return;
    setActioning(true);
    setError(null);
    try {
      await api.resetServerState(server.id);
      setLiveState('stopped');
      toast.success('已重置为 stopped');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重置状态失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setActioning(false);
    }
  };

  // v3.6.1-B2: 刷新实例磁盘占用（调用 /servers/:id/disk-usage，后端 du 实时计算 + 非阻塞更新 DB 缓存）
  const handleRefreshDiskUsage = async () => {
    if (!server) return;
    setRefreshingDisk(true);
    try {
      const res = await api.getServerDiskUsage(server.id);
      setServer((prev) =>
        prev
          ? {
              ...prev,
              disk_usage_bytes: res.usage.total_bytes,
              disk_usage_updated_at: res.usage.updated_at,
            }
          : prev,
      );
      toast.success('磁盘占用已刷新');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '刷新磁盘占用失败';
      toast.error(msg);
    } finally {
      setRefreshingDisk(false);
    }
  };

  // v3.6.2-B2: 清理实例子目录（backups/saves/mods/logs/cache）
  // 后端 DELETE /servers/:id/subdir/:subdir 会先校验实例状态（running/starting 返回 409），
  // 再通过 safeRemoveService 调 daemon rm -rf 删除目录并返回 freed_bytes。
  const ALLOWED_SUBDIRS = ['backups', 'saves', 'mods', 'logs', 'cache'] as const;
  const handleCleanupSubdir = async (subdir: string) => {
    if (!server) return;
    const subdirLabel = CLEANUP_LABELS[subdir] ?? subdir;
    // 运行中实例禁止清理（后端会返回 409，前端预判减少请求）
    const currentState = liveState ?? server.status;
    if (currentState === 'running' || currentState === 'starting') {
      toast.error('实例运行中，无法清理子目录（请先停止实例）');
      return;
    }
    const ok = await confirm({
      title: `清理${subdirLabel}`,
      message: `将删除实例 ${server.name} 的${subdirLabel}。此操作不可撤销，是否继续？`,
      confirmText: '清理',
      danger: true,
    });
    if (!ok) return;

    setCleaningSubdir(subdir);
    try {
      const res = await api.cleanupSubdir(server.id, subdir);
      const freed = res.freed_bytes;
      toast.success(
        `${subdirLabel}清理完成${freed != null && freed > 0 ? `，释放 ${formatBytes(freed)}` : ''}`,
      );
      // 清理后刷新磁盘占用，让用户看到释放效果
      void handleRefreshDiskUsage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : `${subdirLabel}清理失败`;
      toast.error(msg);
    } finally {
      setCleaningSubdir(null);
    }
  };

  // 一.4: 点击删除打开确认弹窗（需输入实例名确认），替代 window.confirm
  const handleDelete = () => {
    if (!server) return;
    setShowDeleteConfirm(true);
  };

  // 实际执行删除
  const executeDelete = async () => {
    if (!server) return;
    setActioning(true);
    setError(null);
    try {
      await api.deleteServer(server.id);
      toast.success('实例已删除');
      navigate(listPath, { replace: true });
    } catch (err) {
      let msg: string;
      if (err instanceof PanelApiError && err.code === 'INVALID_SERVER_STATE') {
        msg = '仅 stopped 状态可删除';
      } else {
        msg = err instanceof Error ? err.message : '删除失败';
      }
      setError(msg);
      toast.error(msg);
      setShowDeleteConfirm(false);
    } finally {
      setActioning(false);
    }
  };

  // 管理员修改有效期：duration_days = null 表示永久
  const submitExpiry = (durationDays: number | null) => {
    if (!server) return;
    updateExpiryMutation.mutate(
      { id: server.id, req: { duration_days: durationDays } },
      {
        onSuccess: () => {
          setShowExpiryEdit(false);
          toast.success('有效期已更新');
          void refresh();
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : '修改有效期失败');
        },
      },
    );
  };

  // 6.4: 首次加载显示骨架屏，替代"加载中…"纯文本
  if (loading && !server) {
    return (
      <div className="page">
        <Skeleton lines={1} lineHeight={28} style={{ marginBottom: 16 }} />
        <div className="info-card">
          <Skeleton lines={7} lineHeight={20} />
        </div>
      </div>
    );
  }

  // 5.3: 加载失败使用 ErrorState 组件（带重试按钮）
  if (!server) {
    return (
      <div className="page">
        <ErrorState
          error={error ?? '服务器不存在或加载失败'}
          onRetry={() => void refresh()}
          retrying={loading}
        />
        <div className="empty-state">
          <button className="btn btn-ghost" onClick={() => navigate(listPath)}>
            返回列表
          </button>
        </div>
      </div>
    );
  }

  const canStart = displayState === 'stopped';
  // v4.29.8: error 状态下可停止（走 daemon 清理，失败 DB 回滚到 error）
  const canStop = displayState === 'running' || displayState === 'starting' || displayState === 'error';
  // v4.29.8: error 状态下可删除（best-effort 调 daemon 清理，失败不阻断）
  const canDelete = displayState === 'stopped' || displayState === 'error';
  // v4.29.8: error 状态下显示"重置状态"按钮（仅 admin，纯 DB 修复不调 daemon）
  const canResetState = displayState === 'error' && isAdminRole(effectiveRole);
  const businessLabel = isStoreView ? '商城管理' : '业务运营';
  const packLabel = isStoreView ? '游戏模板' : 'Pack';
  const portLabel = isStoreView ? '服务端口' : '游戏端口';
  const nodeLabel = isStoreView ? '部署节点' : '节点';
  const ownerLabel = isStoreView ? '实例归属' : '归属者';
  const cleanupGroupLabel = isStoreView ? '目录清理' : '子目录清理';
  // v3-billing: 有效期展示（详情页详细版）
  const expiryDisplay = getExpiryDetailDisplay(server.expires_at, server.expiry_status);
  const getTabLabel = (tabKey: string) => {
    if (isStoreView && tabKey === BUSINESS_TAB_KEY) return businessLabel;
    return TAB_LABELS[tabKey] ?? tabKey;
  };
  // v4.29.x: 实例操作按钮组——启动/停止按状态只显示当前可用项，避免底部固定栏误触
  // v1.1.0: 重置状态移入 error 专属提示条（与主操作分离），刷新降级为图标按钮
  const instanceActionButtons = (
    <>
      {canStart && (
        <button className="btn btn-success" onClick={() => void handleStart()} disabled={actioning}>
          启动
        </button>
      )}
      {canStop && (
        <button className="btn btn-warning" onClick={() => void handleStop()} disabled={actioning}>
          停止
        </button>
      )}
      <button
        className="btn btn-ghost btn-icon-only"
        onClick={() => void refresh()}
        disabled={loading}
        title="刷新"
        aria-label="刷新实例状态"
      >
        <RefreshCw size={16} className={loading ? 'spin' : ''} />
      </button>
    </>
  );

  return (
    <div className={`page${isStoreView ? ' server-detail-store-embedded' : ''}`}>
      {isStoreView ? (
        <div className="server-detail-inline-header">
          <div className="server-detail-inline-copy">
            <p className="server-detail-inline-eyebrow">当前实例</p>
            <h2 className="server-detail-inline-title">{server.name}</h2>
            <p className="server-detail-inline-description">
              运行时、配置与运维操作集中在下方工作区。
            </p>
          </div>
          <div className="page-actions">
            {instanceActionButtons}
            {isAdminRole(effectiveRole) && (
              <button
                className="btn btn-ghost"
                onClick={() => navigate(businessPath)}
                title="打开该实例的商业化配置页"
              >
                {businessLabel}
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={actioning || !canDelete}
              title={!canDelete ? '需先停止实例才能删除（仅 stopped/error 状态可删除）' : '删除实例'}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm back-btn" onClick={() => navigate(listPath)}>
              ← 返回列表
            </button>
            <h2 className="page-title">{server.name}</h2>
          </div>
          <div className="page-actions">
            {instanceActionButtons}
            {isAdminRole(effectiveRole) && (
              <button
                className="btn btn-ghost"
                onClick={() => navigate(businessPath)}
                title="业务运营管理（商店/订单/CDK/聊天触发/加入设置/投票设置/命令）"
              >
                {businessLabel}
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={actioning || !canDelete}
              title={!canDelete ? '需先停止实例才能删除（仅 stopped/error 状态可删除）' : '删除实例'}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {error && <ErrorState error={error} onRetry={() => void refresh()} retrying={loading} />}

      {/* v1.1.0: 实例异常状态提示条——error 状态下显示重置状态入口（与主操作分离） */}
      {canResetState && (
        <div className="instance-error-banner" role="alert">
          <AlertTriangle size={18} className="instance-error-banner-icon" />
          <div className="instance-error-banner-body">
            <span className="instance-error-banner-title">实例处于异常状态</span>
            <span className="instance-error-banner-desc">
              进程可能已崩溃或 daemon 不可达。可尝试停止，或强制重置状态（仅 DB 回退，不调 daemon）。
            </span>
          </div>
          <button
            className="btn btn-warning btn-sm"
            onClick={() => void handleResetState()}
            disabled={actioning}
            title="将实例从 error 强制回退到 stopped"
          >
            重置状态
          </button>
        </div>
      )}

      {/* v3.7.0-B1: 可折叠信息卡——默认折叠为一行摘要，点击展开完整 9 行 */}
      <div className="info-card-collapsible">
        <div
          className={`info-card-header${infoExpanded ? ' expanded' : ''}`}
          onClick={toggleInfoExpanded}
          role="button"
          aria-expanded={infoExpanded}
          aria-controls="info-card-details"
          tabIndex={0}
          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleInfoExpanded();
            }
          }}
        >
          <div className="info-card-summary">
            {isStoreView && <span className="summary-name">{server.name}</span>}
            <span
              className={displayState ? stateClass(displayState) : 'badge'}
              aria-label={`实例状态: ${displayState ? STATE_LABEL[displayState] : '未知'}`}
            >
              {displayState ? STATE_LABEL[displayState] : '未知'}
            </span>
            <span className="summary-item">
              游戏: <strong>{server.game_type}</strong>
            </span>
            {server.current_version && (
              <span className="summary-item">
                版本: <strong className="mono">{server.current_version}</strong>
              </span>
            )}
            <span className="summary-item">
              端口: <strong>{server.port}</strong>
            </span>
            {server.disk_usage_bytes != null && (
              <span className="summary-item">
                磁盘: <strong>{formatBytes(server.disk_usage_bytes)}</strong>
              </span>
            )}
          </div>
          <button
            type="button"
            className={`info-card-toggle${infoExpanded ? ' expanded' : ''}`}
            aria-label={infoExpanded ? '收起信息卡' : '展开信息卡'}
            onClick={(e) => {
              e.stopPropagation();
              toggleInfoExpanded();
            }}
          >
            {infoExpanded ? '收起' : '展开'}
            <span className="toggle-icon">▼</span>
          </button>
        </div>
        <div
          id="info-card-details"
          className={`info-card-details${infoExpanded ? '' : ' collapsed'}`}
        >
          <div className="info-card info-card-2col">
            <div className="info-row">
              <span className="info-label">状态</span>
              <span
                className={displayState ? stateClass(displayState) : 'badge'}
                aria-label={`实例状态: ${displayState ? STATE_LABEL[displayState] : '未知'}`}
              >
                {displayState ? STATE_LABEL[displayState] : '未知'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">游戏</span>
              <span className="info-value">{server.game_type}</span>
            </div>
            <div className="info-row">
              <span className="info-label">{packLabel}</span>
              <span className="info-value">{server.pack_id}</span>
            </div>
            {server.current_version && (
              <div className="info-row">
                <span className="info-label">游戏版本</span>
                <span className="info-value mono">{server.current_version}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">{portLabel}</span>
              <span className="info-value">{server.port}</span>
            </div>
            <div className="info-row">
              <span className="info-label">RCON 端口</span>
              <span className="info-value">{server.rcon_port}</span>
            </div>
            <div className="info-row">
              <span className="info-label">{nodeLabel}</span>
              <span className="info-value">{server.node_id}</span>
            </div>
            <div className="info-row">
              <span className="info-label">{ownerLabel}</span>
              <span className="info-value">{server.owner_username}</span>
            </div>
            <div className="info-row">
              <span className="info-label">创建时间</span>
              <span className="info-value">
                {new Date(server.created_at).toLocaleString('zh-CN')}
              </span>
            </div>
            {/* v3-billing: 有效期信息行 */}
            <div className="info-row">
              <span className="info-label">有效期</span>
              <span className="info-value">
                <span style={expiryDisplay.color ? { color: expiryDisplay.color } : undefined}>
                  {expiryDisplay.text}
                </span>
                {expiryDisplay.warning && (
                  <span
                    className="info-hint"
                    style={{ marginLeft: 8, color: 'var(--color-warning)' }}
                  >
                    {expiryDisplay.warning}
                  </span>
                )}
                {isAdminRole(effectiveRole) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowExpiryEdit(true)}
                    style={{ marginLeft: 8, padding: '2px 8px' }}
                    aria-label="修改有效期"
                    title="修改有效期"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </span>
            </div>
            {/* v3-billing: 实例计费信息行（实例类型 / 计费周期 / 自动续扣 / 豁免状态） */}
            {billingSettings && (
              <div className="info-row">
                <span className="info-label">实例计费</span>
                <span className="info-value">
                  <Wallet size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                  <span className="mono">
                    {INSTANCE_TYPE_LABELS[billingSettings.instance_type] ??
                      billingSettings.instance_type}
                  </span>
                  {billingSettings.last_billing_cycle_months && (
                    <span className="info-hint" style={{ marginLeft: 8 }}>
                      ·{' '}
                      {BILLING_CYCLE_LABELS[billingSettings.last_billing_cycle_months] ??
                        `${billingSettings.last_billing_cycle_months}个月`}
                    </span>
                  )}
                  <span className="info-hint" style={{ marginLeft: 8 }}>
                    · {billingSettings.auto_renew_enabled ? '自动续扣' : '手动续费'}
                  </span>
                  {billingSettings.billing_exempt && (
                    <span
                      className="info-hint"
                      style={{ marginLeft: 8, color: 'var(--color-success, #16a34a)' }}
                    >
                      · 免计费
                      {billingSettings.exempt_reason &&
                        `（${
                          EXEMPT_REASON_LABELS[billingSettings.exempt_reason] ??
                          billingSettings.exempt_reason
                        }）`}
                    </span>
                  )}
                </span>
              </div>
            )}
            {/* v3-billing: 手动续费操作行（仅非豁免实例展示续费入口） */}
            {billingSettings && !billingSettings.billing_exempt && (
              <div className="info-row">
                <span className="info-label">续费</span>
                <span className="info-value">
                  <select
                    value={renewCycle}
                    onChange={(e) =>
                      setRenewCycle(
                        Number(e.target.value) as import('@public/interface_stub/shared-types').BillingCycleMonths,
                      )
                    }
                    className="select select-sm"
                    style={{ marginRight: 8, padding: '2px 8px' }}
                    disabled={renewing}
                    aria-label="续费周期"
                  >
                    <option value={1}>月付</option>
                    <option value={3}>季付</option>
                    <option value={6}>半年付</option>
                    <option value={12}>年付</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleRenew()}
                    disabled={renewing}
                    style={{ marginRight: 8 }}
                  >
                    {renewing ? '续费中…' : '立即续费'}
                  </button>
                  {renewals.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowRenewals((v) => !v)}
                      aria-expanded={showRenewals}
                    >
                      {showRenewals ? '收起记录' : `续费记录(${renewals.length})`}
                    </button>
                  )}
                </span>
              </div>
            )}
            {/* v3-billing: 续费记录列表（展开时显示最近 20 条） */}
            {billingSettings && showRenewals && renewals.length > 0 && (
              <div className="info-row" style={{ alignItems: 'flex-start' }}>
                <span className="info-label">续费明细</span>
                <span className="info-value" style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      maxHeight: 200,
                      overflowY: 'auto',
                      borderRadius: 8,
                      border: '1px solid var(--color-border, #e2e8f0)',
                      padding: '4px 0',
                    }}
                  >
                    {renewals.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          padding: '4px 12px',
                          fontSize: 12,
                          borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)',
                        }}
                      >
                        <span className="mono">
                          {new Date(r.renewed_at).toLocaleString('zh-CN')}
                        </span>
                        <span className="info-hint">
                          {r.renewal_type === 'manual'
                            ? '手动'
                            : r.renewal_type === 'auto'
                              ? '自动'
                              : '赠送'}
                          {r.billing_cycle_months
                            ? `· ${BILLING_CYCLE_LABELS[r.billing_cycle_months] ?? `${r.billing_cycle_months}个月`}`
                            : ''}
                        </span>
                        <span className="mono">
                          {r.amount_paid === 0
                            ? '免计费'
                            : `扣 ${r.amount_paid} 点券`}
                        </span>
                        {r.duration_days > 0 && (
                          <span className="info-hint">+{r.duration_days}天</span>
                        )}
                      </div>
                    ))}
                  </div>
                </span>
              </div>
            )}
            {/* v3.6.1-B2: 磁盘占用行 + 刷新按钮 */}
            <div className="info-row">
              <span className="info-label">磁盘占用</span>
              <span className="info-value">
                <span
                  className="mono"
                  style={
                    server.disk_usage_bytes != null &&
                    server.disk_usage_bytes > 10 * 1024 * 1024 * 1024
                      ? { fontWeight: 'bold', color: 'var(--color-warning, #d97706)' }
                      : undefined
                  }
                >
                  {formatBytes(server.disk_usage_bytes)}
                </span>
                {server.disk_usage_updated_at && (
                  <span className="info-hint" style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
                    更新于 {new Date(server.disk_usage_updated_at).toLocaleString('zh-CN')}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void handleRefreshDiskUsage()}
                  disabled={refreshingDisk}
                  style={{ marginLeft: 8 }}
                  aria-label="刷新磁盘占用"
                >
                  {refreshingDisk ? '刷新中…' : '刷新'}
                </button>
              </span>
            </div>
            {/* v3.6.2-B2: 子目录清理行（运行中禁用） */}
            <div className="info-row">
              <span className="info-label">{cleanupGroupLabel}</span>
              <span className="info-value">
                {ALLOWED_SUBDIRS.map((subdir) => {
                  const subdirLabel = CLEANUP_LABELS[subdir] ?? subdir;
                  const isRunning =
                    (liveState ?? server.status) === 'running' ||
                    (liveState ?? server.status) === 'starting';
                  const isCleaning = cleaningSubdir === subdir;
                  return (
                    <button
                      key={subdir}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleCleanupSubdir(subdir)}
                      disabled={isRunning || isCleaning || cleaningSubdir !== null}
                      style={{ marginRight: 4 }}
                      title={isRunning ? '实例运行中，无法清理' : `清理${subdirLabel}`}
                    >
                      {isCleaning ? `${subdirLabel}…` : subdirLabel}
                    </button>
                  );
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* v3.7.0-B6: Tab 警告条（基于 activeTab + displayState 动态显示） */}
      {activeTabWarning && (
        <div className={`tab-warning-bar${activeTabWarning.danger ? ' warning-danger' : ''}`}>
          <span className="warning-icon">⚠</span>
          <span>{activeTabWarning.text}</span>
        </div>
      )}

      {/* v3.7.0-B2: Tab 抽屉分组导航——4 组（runtime/config/ops/business），可折叠 */}
      {/* 五.10: WAI-ARIA Tabs 模式——aria-controls 关联面板 / 键盘 ←→ 切换 / tabindex roving */}
      {isMobileTabView ? (
        <div className="mobile-tab-scroller" role="tablist" aria-label="移动端标签页">
          {tabs.map((tabKey) => {
            const key = String(tabKey);
            const isBusinessPseudo = key === BUSINESS_TAB_KEY;
            const active = activeTab === tabKey;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                className={`mobile-tab-btn${active ? ' active' : ''}`}
                onClick={() => {
                  if (isBusinessPseudo) {
                    navigate(businessPath);
                    return;
                  }
                  switchTab(tabKey);
                }}
              >
                {getTabLabel(key)}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="tab-groups-2level">
          {/* 第一级：分组 pill */}
          <div
            className="tab-group-pills"
            role="tablist"
            aria-label="实例详情分组"
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const idx = groupedTabs.findIndex((g) => g.group === activeGroup);
              if (idx === -1) return;
              const next =
                e.key === 'ArrowRight'
                  ? (idx + 1) % groupedTabs.length
                  : (idx - 1 + groupedTabs.length) % groupedTabs.length;
              switchGroup(groupedTabs[next].group);
              const pill = document.getElementById(`tab-group-pill-${groupedTabs[next].group}`);
              pill?.focus();
            }}
          >
            {groupedTabs.map(({ group, tabs: groupTabs }) => {
              const active = activeGroup === group;
              return (
                <button
                  key={group}
                  id={`tab-group-pill-${group}`}
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className={`tab-group-pill${active ? ' active' : ''}`}
                  onClick={() => switchGroup(group)}
                >
                  {GROUP_LABELS[group] ?? group}
                  <span className="tab-group-pill-count" aria-hidden="true">
                    {groupTabs.length}
                  </span>
                </button>
              );
            })}
          </div>
          {/* 第二级：当前分组子 tab */}
          <div
            className="tab-sub-tabs"
            role="tablist"
            aria-label={`${GROUP_LABELS[activeGroup] ?? activeGroup}标签页`}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const subTabs = activeGroupTabs.map((t) => String(t.tab));
              const idx = subTabs.indexOf(activeTab);
              if (idx === -1) return;
              const next =
                e.key === 'ArrowRight'
                  ? (idx + 1) % subTabs.length
                  : (idx - 1 + subTabs.length) % subTabs.length;
              const nextTab = subTabs[next];
              if (nextTab === BUSINESS_TAB_KEY) {
                navigate(businessPath);
                return;
              }
              switchTab(nextTab);
              const btn = document.getElementById(`tab-${nextTab}`);
              btn?.focus();
            }}
          >
            {activeGroupTabs.map((tabObj) => {
              const tabKey = String(tabObj.tab);
              const active = activeTab === tabKey;
              const isBusinessPseudo = tabKey === BUSINESS_TAB_KEY;
              return (
                <button
                  key={tabKey}
                  id={`tab-${tabKey}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`tabpanel-${tabKey}`}
                  tabIndex={active ? 0 : -1}
                  className={`tab-btn${active ? ' active' : ''}`}
                  onClick={() => {
                    if (isBusinessPseudo) {
                      navigate(businessPath);
                      return;
                    }
                    switchTab(tabKey);
                  }}
                >
                  {getTabLabel(tabKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 内容区 */}
      {/* 三.4: keep-alive——子页首次访问后保持挂载，切换 tab 用 display 隐藏，保留内部状态 */}
      {/* 五.10: 使用 TabPanel 统一注入 role="tabpanel" / aria-labelledby / id */}
      {/* 9.6: 移动端左右滑动切换 Tab */}
      <div style={{ marginTop: 16 }} ref={tabContentRef}>
        <TabPanel
          tabKey="console"
          activeTab={activeTab}
          activated={activatedTabs.has('console')}
          className="console-card"
        >
          <h3 className="card-title">RCON 控制台</h3>
          <RconConsole
            key={server.id}
            serverId={server.id}
            serverState={server.status}
            onStateChange={handleStateChange}
            onConnectedChange={handleConnectedChange}
          />
        </TabPanel>

        {/* v3.7.0-B4: shop-admin / chat-triggers / player-join-settings / vote-settings
            已迁移到 /instances/:id/business 二级页面，此处不再渲染 inline TabPanel。
            用户点击 __business__ pseudo-tab 时会 navigate 到 /business 页面。 */}
        <TabPanel
          tabKey="game-command-help"
          activeTab={activeTab}
          activated={activatedTabs.has('game-command-help')}
        >
            <LazyTabContent>
              <GameCommandHelp />
            </LazyTabContent>
        </TabPanel>

        <TabPanel tabKey="mods" activeTab={activeTab} activated={activatedTabs.has('mods')}>
            <LazyTabContent>
              <Mods serverId={server.id} gameType={server.game_type} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel tabKey="saves" activeTab={activeTab} activated={activatedTabs.has('saves')}>
            <LazyTabContent>
              <Saves serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel
          tabKey="config-files"
          activeTab={activeTab}
          activated={activatedTabs.has('config-files')}
        >
            <LazyTabContent>
              <ConfigFiles serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel
          tabKey="world-gen"
          activeTab={activeTab}
          activated={activatedTabs.has('world-gen')}
        >
            <LazyTabContent>
              <WorldGen serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel
          tabKey="chat-logs"
          activeTab={activeTab}
          activated={activatedTabs.has('chat-logs')}
        >
            <LazyTabContent>
              <ChatLogs serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel tabKey="players" activeTab={activeTab} activated={activatedTabs.has('players')}>
            <LazyTabContent>
              <Players serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel tabKey="update" activeTab={activeTab} activated={activatedTabs.has('update')}>
            <LazyTabContent>
              <UpdateCheck serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        <TabPanel
          tabKey="log-files"
          activeTab={activeTab}
          activated={activatedTabs.has('log-files')}
        >
            <LazyTabContent>
              <LogFiles serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        {/* v4.5.0: 实例共管管理员管理 */}
        <TabPanel tabKey="admins" activeTab={activeTab} activated={activatedTabs.has('admins')}>
            <LazyTabContent>
              <Admins serverId={server.id} />
            </LazyTabContent>
        </TabPanel>

        {/* v4.7.0-H2: 实例级角色管理（instance_admin+） */}
        <TabPanel tabKey="roles" activeTab={activeTab} activated={activatedTabs.has('roles')}>
            <LazyTabContent>
              <InstanceRoles serverId={server.id} />
            </LazyTabContent>
        </TabPanel>
      </div>

      {/* 一.4: 删除二次确认弹窗 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`删除实例「${server.name}」`}
        description="此操作不可撤销，仅 stopped 状态可删除。请输入实例名称以确认。"
        requireInput={server.name}
        confirmLabel="确认删除"
        loading={actioning}
        onConfirm={() => void executeDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* v1.1.0: 启动前置引导向导 */}
        <Suspense fallback={null}>
          <StartupGuideWizard
            open={showStartupWizard}
            serverId={server.id}
            serverName={server.name}
            onComplete={handleStartupWizardComplete}
            onCancel={() => setShowStartupWizard(false)}
          />
        </Suspense>

      {/* 管理员修改有效期弹窗（v4.36.0 抽离为 ExpiryEditModal） */}
      {showExpiryEdit && (
        <ExpiryEditModal
          currentExpiryText={expiryDisplay.text}
          isPending={updateExpiryMutation.isPending}
          onSubmit={submitExpiry}
          onClose={() => setShowExpiryEdit(false)}
        />
      )}
    </div>
  );
}
