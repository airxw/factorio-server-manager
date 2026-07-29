// ============================================================================
// GuildOrders — /guild/orders（v4.15.0 我的订单页，跨实例聚合）
//
// 数据源：GET /api/my/orders?status=pending|claimed|expired（v4.15.0 新增聚合 API）
// 功能：状态筛选 tab（全部/待领取/已领取/已过期）、订单卡片、领取码一键复制
// 设计：深色电竞风（gp-* 类），待领取订单高亮置顶
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Package, Receipt, RefreshCw, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type { MyOrdersStatusFilter } from '../../api/client';
import type { MyOrderSummary } from '@public/schema/panel-api-types';

type TabKey = 'all' | MyOrdersStatusFilter;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待领取' },
  { key: 'claimed', label: '已领取' },
  { key: 'expired', label: '已过期' },
];

const STATUS_META: Record<MyOrderSummary['status'], { label: string; badge: string }> = {
  pending: { label: '待领取', badge: 'gp-badge-amber' },
  claiming: { label: '领取中', badge: 'gp-badge-cyan' },
  claimed: { label: '已领取', badge: 'gp-badge-emerald' },
  expired: { label: '已过期', badge: '' },
};

const QUALITY_LABEL: Record<string, string> = {
  normal: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 单个订单卡片 */
function OrderCard({ order, highlight }: { order: MyOrderSummary; highlight: boolean }) {
  const toast = useToast();
  const meta = STATUS_META[order.status] ?? STATUS_META.pending;

  const copyClaimCode = () => {
    void navigator.clipboard
      .writeText(order.claim_code)
      .then(() => toast.success('领取码已复制'))
      .catch(() => toast.error('复制失败'));
  };

  return (
    <div
      className={highlight ? 'gp-card-strong' : 'gp-card'}
      style={{
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...(highlight ? { borderColor: 'rgba(251, 191, 36, 0.4)', boxShadow: '0 0 0 1px rgba(251, 191, 36, 0.2), var(--gp-shadow)' } : {}),
      }}
    >
      {/* 头部：实例名 + 状态 + 金额 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="gp-badge gp-badge-violet">{order.instance_name || '未知实例'}</span>
        <span className={`gp-badge ${meta.badge}`}>{meta.label}</span>
        <span className="gp-text-faint" style={{ fontSize: 12 }}>{formatTime(order.created_at)}</span>
        <span className="gp-stat-value gp-mono-num" style={{ marginLeft: 'auto', fontSize: 18 }}>
          {order.total_price}
        </span>
      </div>

      {/* 物品明细 */}
      <div style={{ display: 'grid', gap: 6 }}>
        {order.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Package size={13} style={{ color: 'var(--gp-violet)', flexShrink: 0 }} />
            <span className={`gp-quality-${item.quality}`} style={{ fontWeight: 600, flex: 1 }}>
              {item.item_name}
            </span>
            <span className="gp-text-faint" style={{ fontSize: 11 }}>{QUALITY_LABEL[item.quality] ?? item.quality}</span>
            <span className="gp-text-dim gp-mono-num">×{item.count}</span>
          </div>
        ))}
        {order.items.length === 0 && (
          <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>无物品明细</p>
        )}
      </div>

      {/* 领取码（待领取/领取中展示） */}
      {(order.status === 'pending' || order.status === 'claiming') && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(34, 211, 238, 0.07)',
            border: '1px solid rgba(34, 211, 238, 0.25)',
          }}
        >
          <span className="gp-text-dim" style={{ fontSize: 12 }}>领取码</span>
          <code className="gp-mono-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--gp-cyan)', letterSpacing: '0.08em' }}>
            {order.claim_code}
          </code>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12, marginLeft: 'auto' }}
            onClick={copyClaimCode}
            aria-label={`复制领取码 ${order.claim_code}`}
          >
            <Copy size={12} /> 复制
          </button>
        </div>
      )}

      {/* 已领取时间 */}
      {order.status === 'claimed' && order.claimed_at && (
        <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
          领取于 {formatTime(order.claimed_at)}
        </p>
      )}
    </div>
  );
}

export default function GuildOrders() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('我的订单');

  const [tab, setTab] = useState<TabKey>('all');
  const [orders, setOrders] = useState<MyOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (status: TabKey) => {
    setLoading(true);
    try {
      const res = await api.listMyOrders(status === 'all' ? undefined : status);
      setOrders(res.orders ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载订单失败');
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refresh(tab);
  }, [refresh, tab]);

  // 待领取置顶（all tab 下高亮）
  const sorted = useMemo(() => {
    const pending = orders.filter((o) => o.status === 'pending' || o.status === 'claiming');
    const rest = orders.filter((o) => o.status !== 'pending' && o.status !== 'claiming');
    return [...pending, ...rest];
  }, [orders]);

  const pendingCount = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'claiming').length,
    [orders],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px 20px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>我的订单</h1>
            <p className="gp-text-dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
              跨实例购买记录，待领取订单凭领取码到游戏内兑换
            </p>
          </div>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => void refresh(tab)}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* 状态筛选 tab */}
      <div className="gp-tabs" role="tablist" aria-label="订单状态筛选">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`gp-tab${tab === t.key ? ' gp-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 && (
              <span className="gp-mono-num" style={{ marginLeft: 4 }}>({pendingCount})</span>
            )}
          </button>
        ))}
      </div>

      {/* 订单列表 */}
      {loading && orders.length === 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="gp-skeleton" style={{ height: 110 }} />
          ))}
        </div>
      ) : sorted.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {sorted.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              highlight={tab === 'all' && (o.status === 'pending' || o.status === 'claiming')}
            />
          ))}
        </div>
      ) : (
        <div className="gp-empty" style={{ padding: '36px 20px' }}>
          <div
            style={{
              margin: '0 auto',
              width: 52,
              height: 52,
              borderRadius: 999,
              background: 'var(--gp-grad-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Receipt size={22} />
          </div>
          <p style={{ margin: '12px 0 4px', fontWeight: 600, fontSize: 14 }}>
            {tab === 'all' ? '暂无订单' : `暂无${TABS.find((t) => t.key === tab)?.label ?? ''}订单`}
          </p>
          <p className="gp-text-faint" style={{ margin: 0, fontSize: 12 }}>
            前往商城挑选心仪的商品
          </p>
          <a href="/guild/shop" className="gp-btn gp-btn-primary" style={{ marginTop: 16, padding: '10px 22px', fontSize: 13, textDecoration: 'none' }}>
            <ShoppingBag size={14} />
            去逛逛
          </a>
        </div>
      )}
    </div>
  );
}
