// ============================================================================
// 玩家列表（GM Workbench 真实数据页面）
// v4.x: 迁入 Workbench DS 壳层，统一 /store 视觉语言
// 接入 GET /api/store/players 后端 API
// v4.19.2: 操作列（发放补偿 / 封禁 / 调整 VIP 时长）+ 3 Modal
// 服主视角的玩家 CRM 管理——展示该实例绑定的玩家、消费、时长、VIP 等级
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, RefreshCw, Search, Gift, ShieldOff, Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast, DataTable, ErrorState, type DataTableColumn } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { StorePlayer, StoreServerItem } from '../../api/modules/store-gm';
import CompensateModal from './components/CompensateModal';
import BanConfirmModal from './components/BanConfirmModal';
import AdjustPlaytimeModal from './components/AdjustPlaytimeModal';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchFilterBar,
  WorkbenchSelect,
  WorkbenchSearchInput,
  WorkbenchPrimaryButton,
  WorkbenchIconButton,
  WorkbenchStatusBadge,
  WorkbenchChip,
} from './components/WorkbenchUI';
import { formatCurrency, formatDuration, getPlayerStatusMeta } from './utils/format';

const PAGE_LIMIT = 20;

/** 操作类型 */
type ActionType = 'compensate' | 'ban' | 'adjust-playtime';

export default function Players() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('玩家列表');

  const [servers, setServers] = useState<StoreServerItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [players, setPlayers] = useState<StorePlayer[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingServers, setLoadingServers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reqIdRef = useRef(0);

  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [actionPlayer, setActionPlayer] = useState<StorePlayer | null>(null);

  // 1. 加载实例列表
  useEffect(() => {
    let cancelled = false;
    setLoadingServers(true);
    (async () => {
      try {
        const res = await api.listStoreServers();
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0) {
          setSelectedInstanceId(res.servers[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof PanelApiError ? err.message : '加载实例列表失败');
        }
      } finally {
        if (!cancelled) setLoadingServers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, toast]);

  // 2. 搜索 debounce
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // 3. 加载玩家列表
  const refresh = useCallback(async () => {
    if (!selectedInstanceId) {
      setPlayers([]);
      setPagination({ page: 1, total: 0, total_pages: 0 });
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.listStorePlayers(selectedInstanceId, page, PAGE_LIMIT, debouncedSearch);
      if (reqId !== reqIdRef.current) return;
      setPlayers(res.players);
      setPagination(res.pagination);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof PanelApiError ? err.message : '加载玩家列表失败');
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [api, selectedInstanceId, page, debouncedSearch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAction = (type: ActionType, player: StorePlayer) => {
    setActionType(type);
    setActionPlayer(player);
  };

  const closeAction = () => {
    setActionType(null);
    setActionPlayer(null);
  };

  const onActionSuccess = () => {
    void refresh();
  };

  const columns: DataTableColumn<StorePlayer>[] = [
    {
      header: '用户',
      render: (row) => (
        <div>
          <div className="font-medium text-slate-900">{row.username}</div>
          <div className="text-xs text-slate-500">{row.email}</div>
        </div>
      ),
    },
    {
      header: '游戏ID',
      accessor: 'game_player_name',
    },
    {
      header: '状态',
      render: (row) => {
        const meta = getPlayerStatusMeta(row.status);
        return <WorkbenchStatusBadge label={meta.label} tone={meta.tone} />;
      },
    },
    {
      header: 'VIP',
      render: (row) => (
        <WorkbenchChip tone="amber">
          <span className="font-medium">Lv.{row.vip_level}</span>
          {row.vip_expires_at && (
            <span className="text-xs opacity-70">
              {new Date(row.vip_expires_at).toLocaleDateString()}
            </span>
          )}
        </WorkbenchChip>
      ),
    },
    {
      header: '累计消费',
      render: (row) => (
        <span className="font-semibold tabular-nums text-emerald-700">
          {formatCurrency(row.total_spent)}
        </span>
      ),
    },
    { header: '订单', accessor: 'order_count' },
    {
      header: '在线时长',
      render: (row) => (
        <span className="tabular-nums text-slate-700">{formatDuration(row.total_playtime_seconds)}</span>
      ),
    },
    { header: '会话', accessor: 'session_count' },
    {
      header: '绑定时间',
      render: (row) => (
        <span className="text-slate-500">{row.bound_at ? new Date(row.bound_at).toLocaleDateString() : '-'}</span>
      ),
    },
    {
      header: '操作',
      render: (row) => (
        <div className="flex items-center gap-1">
          <WorkbenchIconButton
            icon={Gift}
            label={`向 ${row.username} 发放补偿`}
            onClick={() => openAction('compensate', row)}
            disabled={!selectedInstanceId}
          />
          <WorkbenchIconButton
            icon={ShieldOff}
            label={`封禁 ${row.username}`}
            tone="rose"
            onClick={() => openAction('ban', row)}
            disabled={!selectedInstanceId || row.status === 'banned'}
          />
          <WorkbenchIconButton
            icon={Clock}
            label={`调整 ${row.username} VIP 时长`}
            onClick={() => openAction('adjust-playtime', row)}
            disabled={!selectedInstanceId}
          />
        </div>
      ),
    },
  ];

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · CRM"
        title="玩家列表"
        description="查看本实例绑定玩家的消费、时长、VIP 等级与会话行为。支持发放补偿、封禁与调整 VIP 时长。"
        actions={
          <WorkbenchPrimaryButton
            onClick={() => void refresh()}
            disabled={refreshing || !selectedInstanceId}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </WorkbenchPrimaryButton>
        }
      />

      <WorkbenchFilterBar>
        <WorkbenchSelect
          aria-label="选择实例"
          value={selectedInstanceId}
          onChange={(e) => {
            setSelectedInstanceId(e.target.value);
            setPage(1);
          }}
          disabled={loadingServers || servers.length === 0}
        >
          {loadingServers && <option value="">加载实例中…</option>}
          {!loadingServers && servers.length === 0 && <option value="">暂无实例</option>}
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.game_type})
            </option>
          ))}
        </WorkbenchSelect>
        <WorkbenchSearchInput
          icon={Search}
          placeholder="搜索用户名 / 邮箱 / 游戏 ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </WorkbenchFilterBar>

      {!selectedInstanceId && !loadingServers ? (
        <WorkbenchEmpty
          title="还没有实例"
          description="先创建实例，玩家绑定后才会出现在这里。"
          icon={Users}
          tone="blue"
        />
      ) : error ? (
        <WorkbenchSection title="玩家列表加载失败" icon={AlertTriangle}>
          <ErrorState error={error} onRetry={refresh} retrying={refreshing} />
        </WorkbenchSection>
      ) : (
        <WorkbenchSection
          title="玩家明细"
          description={`${pagination.total} 位玩家 · 第 ${pagination.page} / ${Math.max(pagination.total_pages, 1)} 页`}
          icon={Users}
        >
          <DataTable
            rows={players}
            columns={columns}
            rowKey={(row) => row.user_id}
            loading={loading}
            emptyTitle="暂无玩家"
            emptyDescription={
              debouncedSearch
                ? `未找到匹配「${debouncedSearch}」的玩家`
                : '该实例尚无绑定的玩家'
            }
            page={pagination.page}
            totalPages={pagination.total_pages}
            onPageChange={(p) => setPage(p)}
          />
        </WorkbenchSection>
      )}

      <CompensateModal
        open={actionType === 'compensate'}
        player={actionPlayer}
        instanceId={selectedInstanceId}
        onClose={closeAction}
        onSuccess={onActionSuccess}
      />
      <BanConfirmModal
        open={actionType === 'ban'}
        player={actionPlayer}
        instanceId={selectedInstanceId}
        onClose={closeAction}
        onSuccess={onActionSuccess}
      />
      <AdjustPlaytimeModal
        open={actionType === 'adjust-playtime'}
        player={actionPlayer}
        instanceId={selectedInstanceId}
        onClose={closeAction}
        onSuccess={onActionSuccess}
      />
    </WorkbenchShell>
  );
}
