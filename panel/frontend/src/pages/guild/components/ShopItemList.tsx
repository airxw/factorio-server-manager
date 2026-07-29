// ============================================================================
// ShopItemList — v4.15.5 修复：恢复两种发放模式（直接发放/取件码）
// 位置：/guild/servers/:id 店铺首页
// 功能：展示商品卡片 + 分类筛选（品质）+ 搜索 + 购买
//
// 数据流：
//   api.listShopItems(serverId) → ShopItemSummary[]
//   api.createShopOrder(serverId, req) → 下单
//
// 发放模式（v4.15.5修正）：
//   - direct（直接发放）：必须绑定角色，player_name 锁定为已绑定角色名，不可手动输入
//   - claim_code（取件码）：无需绑定角色，生成取件码，玩家可在游戏内使用或转给他人
//
// 视觉：gp-item-card 品质发光描边 + gp-tabs 品质筛选 + gp-btn-theme 主题色 CTA
// 移动端守卫：使用 grid 自适应列数，不强制固定高度（rules-0 §3.1.6）
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ShoppingBag, Search, Package, Ticket } from 'lucide-react';
import { useAuth } from '../../../api/auth';
import { PanelApiError } from '../../../api/client';
import type {
  Binding,
  ShopItemSummary,
  ListShopItemsResponse,
  CreateShopOrderResponse,
} from '@public/schema/panel-api-types';

interface ShopItemListProps {
  serverId: string;
  currentBinding?: Binding | null;
}

type DeliveryMode = 'direct' | 'claim_code';

const QUALITY_CONFIG: Record<
  ShopItemSummary['quality'],
  { color: string; label: string }
> = {
  normal: { color: '#8E8E93', label: '普通' },
  uncommon: { color: '#30D158', label: '精良' },
  rare: { color: '#64D2FF', label: '稀有' },
  epic: { color: '#0A84FF', label: '史诗' },
  legendary: { color: '#FF9F0A', label: '传说' },
};

const QUALITY_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'normal', label: '普通' },
  { value: 'uncommon', label: '精良' },
  { value: 'rare', label: '稀有' },
  { value: 'epic', label: '史诗' },
  { value: 'legendary', label: '传说' },
] as const;

export function ShopItemList({ serverId, currentBinding }: ShopItemListProps) {
  const { api } = useAuth();
  const [items, setItems] = useState<ShopItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('claim_code');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isBound = currentBinding?.verify_status === 'verified';

  useEffect(() => {
    if (!isBound && deliveryMode === 'direct') {
      setDeliveryMode('claim_code');
    }
  }, [isBound, deliveryMode]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadItems = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = (await api.listShopItems(serverId)) as ListShopItemsResponse;
      setItems((resp.items ?? []).filter((i) => i.enabled));
    } catch (err) {
      setError(err instanceof PanelApiError ? err.message : '商品列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [api, serverId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (qualityFilter !== 'all') {
      result = result.filter((i) => i.quality === qualityFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((i) => i.item_name.toLowerCase().includes(q));
    }
    const qualityOrder = ['legendary', 'epic', 'rare', 'uncommon', 'normal'];
    return [...result].sort(
      (a, b) => qualityOrder.indexOf(a.quality) - qualityOrder.indexOf(b.quality) || a.price - b.price,
    );
  }, [items, qualityFilter, search]);

  return (
    <section className="gp-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 className="gp-section-title" style={{ margin: 0 }}>
          <ShoppingBag size={16} style={{ color: 'var(--shop-theme-color, var(--gp-violet))' }} />
          商品列表
        </h2>
        {items.length > 0 && (
          <span className="gp-text-faint gp-mono-num" style={{ fontSize: 11 }}>
            {filteredItems.length} / {items.length} 件商品
          </span>
        )}
      </div>

      <div
        style={{
          padding: '10px 14px',
          marginBottom: 14,
          borderRadius: 10,
          background: isBound
            ? 'linear-gradient(135deg, rgba(52,199,89,0.05), rgba(10,132,255,0.05))'
            : 'linear-gradient(135deg, rgba(255,159,10,0.06), rgba(255,159,10,0.02))',
          border: `1px solid ${isBound ? 'rgba(52,199,89,0.18)' : 'rgba(255,159,10,0.2)'}`,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setDeliveryMode('claim_code')}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid',
              borderColor: deliveryMode === 'claim_code' ? 'var(--gp-violet)' : 'var(--gp-border)',
              background: deliveryMode === 'claim_code' ? 'color-mix(in srgb, var(--gp-violet) 12%, transparent)' : 'transparent',
              color: deliveryMode === 'claim_code' ? 'var(--gp-violet)' : 'var(--gp-text-secondary)',
              fontSize: 12,
              fontWeight: deliveryMode === 'claim_code' ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Ticket size={13} />
            取件码
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isBound) {
                showToast('error', '请先绑定游戏角色才能使用「直接发放」');
                return;
              }
              setDeliveryMode('direct');
            }}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid',
              borderColor: deliveryMode === 'direct' ? '#34C759' : isBound ? 'var(--gp-border)' : 'var(--gp-border)',
              background: deliveryMode === 'direct' ? 'rgba(52,199,89,0.1)' : 'transparent',
              color: deliveryMode === 'direct' ? '#34C759' : isBound ? 'var(--gp-text-secondary)' : 'var(--gp-text-dim)',
              fontSize: 12,
              fontWeight: deliveryMode === 'direct' ? 600 : 400,
              cursor: isBound ? 'pointer' : 'not-allowed',
              opacity: isBound ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Package size={13} />
            直接发放
            {!isBound && <span style={{ fontSize: 10, marginLeft: 2 }}>（需绑定角色）</span>}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gp-text-dim)' }}>
          {deliveryMode === 'claim_code'
            ? '📦 生成取件码后，可在游戏内输入领取，也可将取件码分享给其他玩家使用'
            : `✓ 已绑定角色「${currentBinding?.player_name ?? ''}」，购买后物品直接发放到该角色背包`}
        </div>
      </div>

      {!loading && !error && items.length > 0 && (
        <div style={{ marginBottom: 14, display: 'grid', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索商品名称..."
              className="gp-input"
              style={{ paddingLeft: 36 }}
            />
            <Search
              size={15}
              className="gp-text-faint"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
          </div>
          <div className="gp-tabs" style={{ flexWrap: 'wrap', display: 'inline-flex' }}>
            {QUALITY_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`gp-tab ${qualityFilter === f.value ? 'gp-tab-active' : ''}`}
                onClick={() => setQualityFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="gp-skeleton" style={{ height: 128 }} />
          ))}
        </div>
      )}

      {error && (
        <div className="gp-empty" style={{ padding: '20px', borderColor: 'rgba(251, 113, 133, 0.4)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--gp-rose)' }}>{error}</p>
          <button
            type="button"
            className="gp-btn gp-btn-ghost"
            style={{ marginTop: 10, padding: '6px 16px', fontSize: 12 }}
            onClick={() => void loadItems()}
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && filteredItems.length === 0 && (
        <div className="gp-empty" style={{ padding: '32px 20px' }}>
          <ShoppingBag size={36} className="gp-text-faint" style={{ margin: '0 auto 8px', opacity: 0.4 }} />
          <p style={{ margin: 0, fontSize: 13 }}>
            {items.length === 0 ? '店铺暂无商品' : '没有匹配的商品'}
          </p>
        </div>
      )}

      {!loading && !error && filteredItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {filteredItems.map((item) => (
            <ShopItemCard
              key={item.id}
              item={item}
              serverId={serverId}
              onPurchased={loadItems}
              api={api}
              deliveryMode={deliveryMode}
              isBound={isBound}
              boundPlayerName={currentBinding?.player_name ?? ''}
              showToast={showToast}
            />
          ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 90,
            left: '50%',
            transform: 'translateX(-50%)',
            background: toast.type === 'success' ? '#34C759' : '#FF3B30',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 1000,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            maxWidth: 'calc(100% - 40px)',
            whiteSpace: 'pre-wrap',
            textAlign: 'center',
          }}
        >
          {toast.message}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 子组件：单个商品卡片
// ---------------------------------------------------------------------------

interface ShopItemCardProps {
  item: ShopItemSummary;
  serverId: string;
  onPurchased: () => void;
  api: ReturnType<typeof useAuth>['api'];
  deliveryMode: DeliveryMode;
  isBound: boolean;
  boundPlayerName?: string;
  showToast: (type: 'success' | 'error', message: string) => void;
}

function ShopItemCard({
  item,
  serverId,
  onPurchased,
  api,
  deliveryMode,
  isBound,
  boundPlayerName,
  showToast,
}: ShopItemCardProps) {
  const [purchasing, setPurchasing] = useState(false);
  const [count, setCount] = useState(1);
  const [showCount, setShowCount] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState<string | null>(null);

  const qConfig = QUALITY_CONFIG[item.quality];

  const handlePurchase = async () => {
    if (deliveryMode === 'direct' && (!isBound || !boundPlayerName)) {
      setErr('请先绑定游戏角色');
      return;
    }

    setPurchasing(true);
    setErr(null);
    setClaimCode(null);
    try {
      const body: Parameters<typeof api.createShopOrder>[1] = {
        items: [{ item_name: item.item_name, count, quality: item.quality }],
        delivery_mode: deliveryMode,
      };
      if (deliveryMode === 'direct') {
        body.player_name = boundPlayerName!;
      }
      const res = (await api.createShopOrder(serverId, body)) as CreateShopOrderResponse;
      if (deliveryMode === 'claim_code' && res.order.claim_code) {
        setClaimCode(res.order.claim_code);
        showToast('success', `取件码：${res.order.claim_code}\n请在游戏内输入领取，可分享给好友`);
      } else {
        showToast('success', `购买成功！${item.item_name} ×${count} 已发放到 ${boundPlayerName}`);
      }
      setShowCount(false);
      setCount(1);
      onPurchased();
    } catch (e) {
      const msg = e instanceof PanelApiError ? e.message : '购买失败';
      setErr(msg);
      showToast('error', msg);
    } finally {
      setPurchasing(false);
    }
  };

  const directDisabled = deliveryMode === 'direct' && !isBound;

  return (
    <div
      className="gp-card gp-card-hover gp-item-card"
      style={{ ['--gp-quality-color' as string]: qConfig.color, padding: 14 } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontWeight: 700, fontSize: 13, lineHeight: 1.4, color: 'var(--gp-text)' }}>
            {item.item_name}
          </h4>
          <span
            className="gp-badge"
            style={{
              flexShrink: 0,
              color: qConfig.color,
              borderColor: `color-mix(in srgb, ${qConfig.color} 45%, transparent)`,
              background: `color-mix(in srgb, ${qConfig.color} 13%, transparent)`,
            }}
          >
            {qConfig.label}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12, minHeight: 18 }}>
          {item.vip_level_required > 0 && (
            <span className="gp-badge gp-badge-amber">VIP {item.vip_level_required}+</span>
          )}
          {item.daily_limit !== null && (
            <span className="gp-badge">限购 {item.daily_limit}/日</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              className="gp-mono-num"
              style={{ fontSize: 20, fontWeight: 800, color: 'var(--shop-theme-color, var(--gp-violet))' }}
            >
              {item.price}
            </span>
            <span className="gp-text-faint" style={{ fontSize: 11 }}>点券</span>
          </div>

          {showCount ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                min={1}
                max={99}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                className="gp-input"
                style={{ width: 52, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
                disabled={purchasing}
              />
              <button
                type="button"
                className="gp-btn gp-btn-theme"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => void handlePurchase()}
                disabled={purchasing || directDisabled}
              >
                {purchasing ? '...' : '确认'}
              </button>
              <button
                type="button"
                className="gp-btn gp-btn-ghost"
                style={{ padding: '6px 10px', fontSize: 12 }}
                onClick={() => {
                  setShowCount(false);
                  setCount(1);
                  setErr(null);
                  setClaimCode(null);
                }}
                disabled={purchasing}
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="gp-btn gp-btn-theme"
              style={{
                padding: '7px 18px',
                fontSize: 12,
                opacity: directDisabled ? 0.5 : 1,
              }}
              onClick={() => {
                if (directDisabled) {
                  setErr('请先绑定游戏角色');
                  return;
                }
                setShowCount(true);
                setErr(null);
                setClaimCode(null);
              }}
              disabled={purchasing || directDisabled}
            >
              {purchasing ? '处理中...' : directDisabled ? '需绑定' : deliveryMode === 'claim_code' ? '购买取件码' : '直接购买'}
            </button>
          )}
        </div>

        {claimCode && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(88,86,214,0.08), rgba(10,132,255,0.08))',
              border: '1px dashed var(--gp-violet)',
              fontSize: 12,
            }}
          >
            <div style={{ color: 'var(--gp-text-dim)', marginBottom: 4 }}>✓ 购买成功，您的取件码：</div>
            <div
              className="gp-mono-num"
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: 'var(--gp-violet)',
                letterSpacing: '0.1em',
                textAlign: 'center',
                padding: '6px 0',
                userSelect: 'all',
              }}
            >
              {claimCode}
            </div>
            <div style={{ color: 'var(--gp-text-dim)', fontSize: 11, textAlign: 'center' }}>
              进入游戏后输入此码领取物品，也可分享给好友
            </div>
          </div>
        )}

        {err && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--gp-rose)' }}>{err}</p>}
      </div>
    </div>
  );
}
