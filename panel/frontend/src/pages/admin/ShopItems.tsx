// ============================================================================
// ShopItems — 管理员配置 shop_items 页面
// 独立模式：路径 /admin/shop-items（不带 serverId，需要先选择服务器）
// 嵌入模式：从实例详情页嵌入，接收 serverId + packId props，跳过服务器选择
// 上方：shop_items 表格 + 新建/编辑/删除
// item_name 候选从 Pack.items 拉取（通过 server.pack_id）
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PackItemSummary,
  ServerSummary,
  ShopItemSummary,
  UpsertShopItemRequest,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import type { PackItemsConfig } from '../../api/client';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { ListSkeleton } from '../../components/ui';
import { useConfirm } from '../../context/ConfirmContext';

type Quality = ShopItemSummary['quality'];

interface FormState {
  item_name: string;
  quality: Quality;
  vip_level_required: string;
  price: string;
  daily_limit: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  item_name: '',
  quality: 'normal',
  vip_level_required: '0',
  price: '0',
  daily_limit: '',
  enabled: true,
};

interface ShopItemsProps {
  /** 嵌入模式：从实例详情页传入，跳过服务器选择 */
  serverId?: string;
  /** 嵌入模式：从实例详情页传入，避免额外 API 查询 */
  packId?: string;
}

export default function ShopItems({ serverId: propServerId, packId: propPackId }: ShopItemsProps = {}) {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();
  const embedded = propServerId !== undefined;

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState(propServerId ?? '');
  const [serversLoading, setServersLoading] = useState(!embedded);

  const [items, setItems] = useState<ShopItemSummary[]>([]);
  const [packItems, setPackItems] = useState<PackItemSummary[]>([]);
  // 3.4.5: 当前服务器的 Pack 物品池配置（决定是否渲染品质列 / 动态生成品质下拉）
  const [packItemsConfig, setPackItemsConfig] = useState<PackItemsConfig | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 加载服务器列表（仅独立模式）
  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    setServersLoading(true);
    api
      .listServers()
      .then((res) => {
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0 && !propServerId) {
          setServerId(res.servers[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载服务器列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, embedded, propServerId]);

  // 当前选中的服务器的 pack_id（用于加载物品候选和品质配置）
  // 嵌入模式：直接使用 propPackId
  const currentPackId = useMemo(() => {
    if (embedded) return propPackId ?? '';
    const srv = servers.find((s) => s.id === serverId);
    return srv?.pack_id ?? '';
  }, [embedded, propPackId, servers, serverId]);

  const loadItems = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listShopItems(id);
        setItems(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载商品列表失败');
        setItems([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  const loadPackItems = useCallback(
    async (packId: string) => {
      try {
        const res = await api.listPackItems(packId);
        setPackItems(res.items);
      } catch {
        // Pack 物品拉取失败不阻断主流程，仅清空候选
        setPackItems([]);
      }
    },
    [api],
  );

  // 3.4.5: 加载 Pack 物品池配置（quality_tiers / qualities / support_quality）
  const loadPackItemsConfig = useCallback(
    async (packId: string) => {
      try {
        const cfg = await api.getPackItemsConfig(packId);
        setPackItemsConfig(cfg);
      } catch {
        // 配置拉取失败：降级为"无品质"
        setPackItemsConfig(null);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setItems([]);
      setPackItems([]);
      setPackItemsConfig(null);
      return;
    }
    void loadItems(serverId);
    if (currentPackId) {
      void loadPackItems(currentPackId);
      void loadPackItemsConfig(currentPackId);
    }
  }, [serverId, currentPackId, loadItems, loadPackItems, loadPackItemsConfig]);

  // 3.4.5: 派生——当前 Pack 是否支持品质
  const supportQuality =
    (packItemsConfig?.quality_tiers ?? 0) > 0 && (packItemsConfig?.support_quality ?? false);
  // 3.4.5: 派生——当前 Pack 允许的品质枚举
  const allowedQualities: Quality[] =
    (packItemsConfig?.qualities && packItemsConfig.qualities.length > 0
      ? (packItemsConfig.qualities as Quality[])
      : ['normal']);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, quality: (allowedQualities[0] ?? 'normal') as Quality });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (it: ShopItemSummary) => {
    setEditingId(it.id);
    // 防御：若编辑时 Pack 不支持品质 / 枚举已变化，降级到首个允许值
    const safeQuality = (allowedQualities.includes(it.quality as Quality)
      ? it.quality
      : (allowedQualities[0] ?? 'normal')) as Quality;
    setForm({
      item_name: it.item_name,
      quality: safeQuality,
      vip_level_required: String(it.vip_level_required),
      price: String(it.price),
      daily_limit: it.daily_limit === null ? '' : String(it.daily_limit),
      enabled: it.enabled,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleSubmit = async () => {
    if (!serverId) return;
    setError(null);
    const itemName = form.item_name.trim();
    if (!itemName) {
      setError('请填写或选择物品名');
      return;
    }
    const vipNum = Number(form.vip_level_required);
    if (!Number.isInteger(vipNum) || vipNum < 0 || vipNum > 5) {
      setError('所需 VIP 等级需为 0-5 的整数');
      return;
    }
    const priceNum = Number(form.price);
    if (!Number.isInteger(priceNum) || priceNum < 0) {
      setError('单价需为非负整数');
      return;
    }
    const dailyNum = form.daily_limit.trim() === '' ? null : Number(form.daily_limit);
    if (dailyNum !== null && (!Number.isInteger(dailyNum) || dailyNum < 0)) {
      setError('每日上限需为非负整数或留空');
      return;
    }

    setSaving(true);
    try {
      const req: UpsertShopItemRequest = {
        item_name: itemName,
        quality: form.quality,
        vip_level_required: vipNum,
        price: priceNum,
        daily_limit: dailyNum,
        enabled: form.enabled,
      };
      const res = await api.upsertShopItem(serverId, req);
      setItems((prev) => {
        const filtered = prev.filter(
          (it) => it.id !== res.item.id && it.item_name !== res.item.item_name,
        );
        return [...filtered, res.item].sort((a, b) => a.id - b.id);
      });
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!serverId) return;
    const ok = await confirm({
      title: '删除商品',
      message: `确认删除商品 #${id}？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteShopItem(serverId, id);
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">商店配置</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => serverId && void loadItems(serverId)}
            disabled={dataLoading || !serverId}
          >
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={dataLoading || !serverId || showForm}
          >
            + 新建商品
          </button>
        </div>
      </div>

      {!embedded && (
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">选择服务器</span>
            {serversLoading ? (
              <div className="form-hint">加载服务器列表中…</div>
            ) : servers.length === 0 ? (
              <div className="form-hint">没有可用的服务器。</div>
            ) : (
              <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.game_type}/{s.pack_id})
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <h3 className="card-title">
            {editingId === null ? '新建商品' : `编辑商品 #${editingId}`}
          </h3>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">物品名 *</span>
              {packItems.length > 0 ? (
                <select
                  value={form.item_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                  disabled={editingId !== null}
                  required
                >
                  <option value="">— 请选择 —</option>
                  {packItems.map((it) => (
                    <option key={it.name} value={it.name}>
                      {it.display_name ? `${it.name}（${it.display_name}）` : it.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.item_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                  disabled={editingId !== null}
                  placeholder="例如：diamond"
                  required
                />
              )}
              <span className="form-hint">物品名需存在于 Pack.items</span>
            </label>
            {supportQuality && (
              <label className="form-field">
                <span className="form-label">品质</span>
                <select
                  value={form.quality}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, quality: e.target.value as Quality }))
                  }
                >
                  {allowedQualities.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <span className="form-hint">
                  当前 Pack 支持 {packItemsConfig?.quality_tiers ?? 0} 档品质
                </span>
              </label>
            )}
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">所需 VIP 等级（0-5）</span>
              <input
                type="number"
                min={0}
                max={5}
                value={form.vip_level_required}
                onChange={(e) => setForm((f) => ({ ...f, vip_level_required: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span className="form-label">单价（点券）</span>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0 表示免费"
              />
            </label>
            <label className="form-field">
              <span className="form-label">每日上限（留空=不限）</span>
              <input
                type="number"
                min={0}
                value={form.daily_limit}
                onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))}
                placeholder="留空表示不限"
              />
            </label>
            <label className="form-field">
              <span className="form-label">是否上架</span>
              <select
                value={form.enabled ? '1' : '0'}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value === '1' }))}
              >
                <option value="1">上架</option>
                <option value="0">下架</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={saving}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      )}

      {!serverId ? (
        <div className="empty-state">请先选择一个服务器。</div>
      ) : dataLoading ? (
        <ListSkeleton rows={5} columns={7} />
      ) : items.length === 0 ? (
        <div className="empty-state">该服务器暂无商品配置。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>物品名</th>
                {supportQuality && <th>品质</th>}
                <th>单价（点券）</th>
                <th>所需 VIP</th>
                <th>每日上限</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.id}</td>
                  <td className="mono">{it.item_name}</td>
                  {supportQuality && <td>{it.quality}</td>}
                  <td className="mono">{it.price}</td>
                  <td>{it.vip_level_required}</td>
                  <td>{it.daily_limit === null ? '不限' : it.daily_limit}</td>
                  <td>
                    <span className={it.enabled ? 'badge badge-running' : 'badge badge-stopped'}>
                      {it.enabled ? '上架' : '下架'}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(it)}
                      disabled={showForm}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => void handleDelete(it.id)}
                      disabled={showForm}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
