// ============================================================================
// CdkCodes — CDK 兑换码管理（仅 admin/system_admin 可见）
// 顶部服务器选择 → 生成 CDK 表单（支持多物品礼包 + 使用次数）+ CDK 列表表格（含复制/删除/兑换记录）
//
// v2 礼包逻辑：
// - 一个 CDK = 一个礼包，礼包由 1 个或多个物品组成
// - 生成表单支持动态添加多个物品（物品选择 + 数量 + 品质）
// - 可选填礼包名称和描述，便于识别和分发
// - 批量生成数量控制一次生成多少个相同的 CDK
//
// v4.37.0 可重复使用 CDK：
// - 生成表单支持选择使用次数：一次性（max_uses=1）/ 限 N 次（max_uses=N）/ 无限次（max_uses=0）
// - 列表显示 use_count/max_uses，多次用 CDK 可展开查看兑换记录
// - 支持 embedded 模式：在 Business 业务运营子 Tab 中嵌入（传入 serverId，隐藏服务器选择）
// ============================================================================

import { Fragment, useCallback, useEffect, useState } from 'react';
import type {
  CdkCodeItem,
  CdkCodeSummary,
  CdkRedemptionRecord,
  CreateCdkCodesRequest,
  PackItemSummary,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { useConfirm } from '../../context/ConfirmContext';

type CdkQuality = CdkCodeSummary['quality'];
const QUALITY_OPTIONS: CdkQuality[] = ['normal', 'uncommon', 'rare', 'epic', 'legendary'];

const QUALITY_LABEL: Record<CdkQuality, string> = {
  normal: '普通',
  uncommon: '精良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

const STATUS_LABEL: Record<CdkCodeSummary['status'], string> = {
  unused: '未使用',
  claiming: '兑换中',
  claimed: '已兑换',
  expired: '已过期',
};

function statusClass(status: CdkCodeSummary['status']): string {
  return `badge badge-${status}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

/** 礼包物品编辑器中的一行（数量用 string 便于受控输入） */
interface ItemFormRow {
  item_name: string;
  count: string;
  quality: CdkQuality;
}

/** 渲染礼包内容摘要（item_name x count · quality） */
function renderGiftItems(
  items: CdkCodeItem[],
  fallbackName: string,
  fallbackCount: number,
  fallbackQuality: CdkQuality,
): string {
  if (items.length === 0) {
    return `${fallbackName} x${fallbackCount} · ${QUALITY_LABEL[fallbackQuality]}`;
  }
  return items
    .map((it) => `${it.item_name} x${it.count} · ${QUALITY_LABEL[it.quality]}`)
    .join('；');
}

export default function CdkCodes({
  embedded = false,
  serverId: propServerId,
}: {
  embedded?: boolean;
  serverId?: string;
} = {}) {
  const { api, user } = useAuth();
  const { confirm } = useConfirm();

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>(propServerId ?? '');
  const [packItems, setPackItems] = useState<PackItemSummary[]>([]);
  const [codes, setCodes] = useState<CdkCodeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成表单：礼包信息 + 动态物品列表 + 生成数量 + 过期天数 + 使用次数
  const [giftName, setGiftName] = useState('');
  const [giftDescription, setGiftDescription] = useState('');
  const [itemRows, setItemRows] = useState<ItemFormRow[]>([
    { item_name: '', count: '1', quality: 'normal' },
  ]);
  const [quantity, setQuantity] = useState('1');
  const [expiresInDays, setExpiresInDays] = useState('30');
  // v4.37.0: 使用次数模式 once=一次性 / limited=限N次 / unlimited=无限次
  const [maxUsesMode, setMaxUsesMode] = useState<'once' | 'limited' | 'unlimited'>('once');
  const [maxUsesValue, setMaxUsesValue] = useState('10');

  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // v4.37.0: 展开的 CDK id（查看兑换记录）；记录展开项的兑换记录缓存
  const [expandedCodeId, setExpandedCodeId] = useState<number | null>(null);
  const [redemptionMap, setRedemptionMap] = useState<Record<number, CdkRedemptionRecord[]>>({});
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);

  const isAdmin = isAdminRole(getEffectiveRole(user));

  // 加载服务器列表（embedded 模式跳过，直接用传入的 serverId）
  useEffect(() => {
    if (!isAdmin) return;
    if (embedded && propServerId) return; // embedded 模式直接使用传入的 serverId
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listServers();
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0 && !selectedServerId) {
          setSelectedServerId(res.servers[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载服务器列表失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isAdmin]);

  // embedded 模式：propServerId 变化时同步 selectedServerId（实例切换场景）
  useEffect(() => {
    if (embedded && propServerId && propServerId !== selectedServerId) {
      setSelectedServerId(propServerId);
      // 切换实例时清空缓存的兑换记录，避免错位展示
      setRedemptionMap({});
      setExpandedCodeId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, propServerId]);

  // 服务器变化时加载 Pack items + CDK 列表
  const refreshAll = useCallback(async () => {
    if (!selectedServerId) {
      setPackItems([]);
      setCodes([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 获取 server 详情以拿 pack_id
      const serverRes = await api.getServer(selectedServerId);
      const packId = serverRes.server.pack_id;
      const [itemsRes, codesRes] = await Promise.all([
        api.listPackItems(packId).catch(() => ({ items: [] as PackItemSummary[] })),
        api.listCdkCodes(selectedServerId),
      ]);
      setPackItems(itemsRes.items);
      setCodes(codesRes.codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 CDK 数据失败');
    } finally {
      setLoading(false);
    }
  }, [api, selectedServerId]);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshAll();
  }, [refreshAll, isAdmin]);

  // ----- 物品行编辑操作 -----
  const updateItemRow = (idx: number, patch: Partial<ItemFormRow>) => {
    setItemRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addItemRow = () => {
    setItemRows((prev) => [...prev, { item_name: '', count: '1', quality: 'normal' }]);
  };
  const removeItemRow = (idx: number) => {
    setItemRows((prev) => {
      if (prev.length <= 1) return prev; // 至少保留一行
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleCreate = async () => {
    if (!selectedServerId) {
      setError('请先选择服务器');
      return;
    }
    const qty = parseInt(quantity, 10);
    const expiresInDaysNum = parseInt(expiresInDays, 10);

    // 校验物品列表：至少一个有效物品
    const validItems = itemRows.filter((r) => r.item_name && r.item_name.trim() !== '');
    if (validItems.length === 0) {
      setError('请至少添加一个物品');
      return;
    }
    for (let i = 0; i < itemRows.length; i++) {
      const row = itemRows[i];
      if (!row.item_name) {
        setError(`第 ${i + 1} 个物品未选择`);
        return;
      }
      const c = parseInt(row.count, 10);
      if (!Number.isFinite(c) || c <= 0) {
        setError(`第 ${i + 1} 个物品的数量必须为正整数`);
        return;
      }
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000) {
      setError('生成数量必须为 1-1000 之间的整数');
      return;
    }
    if (!Number.isFinite(expiresInDaysNum) || expiresInDaysNum <= 0) {
      setError('过期天数必须为正整数');
      return;
    }
    // v4.37.0: 解析 max_uses
    let maxUses: number | undefined;
    if (maxUsesMode === 'unlimited') {
      maxUses = 0;
    } else if (maxUsesMode === 'limited') {
      const n = parseInt(maxUsesValue, 10);
      if (!Number.isFinite(n) || n < 2) {
        setError('限次使用的次数必须为 ≥ 2 的整数（1 请选「一次性」）');
        return;
      }
      maxUses = n;
    }
    // maxUsesMode === 'once' → maxUses 保持 undefined（后端缺省 1）

    setCreating(true);
    setError(null);
    try {
      // 构造 items 数组（多物品礼包）
      const itemsPayload = itemRows.map((r) => ({
        item_name: r.item_name,
        count: parseInt(r.count, 10),
        quality: r.quality,
      }));
      const req: CreateCdkCodesRequest = {
        codes: Array.from({ length: qty }, () => ({
          gift_name: giftName.trim() || undefined,
          gift_description: giftDescription.trim() || undefined,
          items: itemsPayload,
          ...(maxUses !== undefined ? { max_uses: maxUses } : {}),
        })),
        expires_in_days: expiresInDaysNum,
      };
      await api.createCdkCodes(selectedServerId, req);
      // 重置礼包名称/描述，保留物品行方便继续生成
      setGiftName('');
      setGiftDescription('');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成 CDK 失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, code: string) => {
    const ok = await confirm({
      title: '删除 CDK',
      message: `确认删除 CDK "${code}"？此操作不可撤销。`,
      confirmText: '确认删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteCdkCode(selectedServerId, id);
      await refreshAll();
    } catch (err) {
      if (err instanceof PanelApiError && err.code === 'PANEL_VALIDATION_ERROR') {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '删除失败');
      }
    }
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      setError('复制失败：浏览器不支持剪贴板或非 HTTPS 环境');
    }
  };

  /** v4.37.0: 渲染使用次数单元格（一次性/限N次/无限次） */
  const renderUseCount = (c: CdkCodeSummary): string => {
    if (c.max_uses === 1) {
      return c.use_count >= 1 ? '1/1' : '一次性';
    }
    if (c.max_uses === 0) {
      return `${c.use_count}/∞`;
    }
    return `${c.use_count}/${c.max_uses}`;
  };

  /** v4.37.0: 展开/收起兑换记录（仅多次用 CDK；调用 getCode 拉取 redemptions） */
  const handleToggleRedemptions = async (c: CdkCodeSummary) => {
    if (expandedCodeId === c.id) {
      setExpandedCodeId(null);
      return;
    }
    // 已缓存直接展开
    if (redemptionMap[c.id]) {
      setExpandedCodeId(c.id);
      return;
    }
    setLoadingRedemptions(true);
    setError(null);
    try {
      const res = await api.getCdkCode(selectedServerId, c.id);
      setRedemptionMap((prev) => ({ ...prev, [c.id]: res.code.redemptions ?? [] }));
      setExpandedCodeId(c.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载兑换记录失败');
    } finally {
      setLoadingRedemptions(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="alert alert-error">仅管理员可访问此页面</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">CDK 兑换码管理</h2>
        <button className="btn btn-ghost" onClick={() => void refreshAll()} disabled={loading}>
          刷新
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!embedded && (
        <div className="info-card">
          <div className="info-row">
            <span className="info-label">选择服务器</span>
            <select
              className="input"
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
              disabled={servers.length === 0}
            >
              {servers.length === 0 && <option value="">暂无服务器</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.pack_id})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {selectedServerId && (
        <>
          <div className="info-card" style={{ marginTop: 12 }}>
            <h3 className="card-title">生成 CDK（礼包）</h3>
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              一个 CDK 即一个礼包，可包含 1 个或多个物品。兑换时将按顺序为每个物品发放游戏命令。
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">礼包名称（可选）</label>
                <input
                  className="input"
                  type="text"
                  value={giftName}
                  onChange={(e) => setGiftName(e.target.value)}
                  placeholder="便于识别和分发，如：新手大礼包"
                  maxLength={100}
                  disabled={creating}
                />
              </div>
              <div className="form-field">
                <label className="form-label">礼包描述（可选）</label>
                <input
                  className="input"
                  type="text"
                  value={giftDescription}
                  onChange={(e) => setGiftDescription(e.target.value)}
                  placeholder="记录礼包内容说明"
                  maxLength={255}
                  disabled={creating}
                />
              </div>
            </div>

            {/* 动态物品列表 */}
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <label className="form-label" style={{ margin: 0 }}>
                  礼包物品
                </label>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={addItemRow}
                  disabled={creating}
                >
                  + 添加物品
                </button>
              </div>
              {itemRows.map((row, idx) => (
                <div
                  key={idx}
                  className="form-grid"
                  style={{
                    marginBottom: 8,
                    paddingBottom: 8,
                    borderBottom:
                      idx < itemRows.length - 1 ? '1px dashed var(--border-color, #eee)' : 'none',
                  }}
                >
                  <div className="form-field">
                    <label className="form-label">物品 {idx + 1}</label>
                    <select
                      className="input"
                      value={row.item_name}
                      onChange={(e) => updateItemRow(idx, { item_name: e.target.value })}
                      disabled={creating}
                    >
                      <option value="">— 选择物品 —</option>
                      {packItems.map((it) => (
                        <option key={it.name} value={it.name}>
                          {it.display_name ? `${it.display_name} (${it.name})` : it.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">数量</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={row.count}
                      onChange={(e) => updateItemRow(idx, { count: e.target.value })}
                      disabled={creating}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">品质</label>
                    <select
                      className="input"
                      value={row.quality}
                      onChange={(e) =>
                        updateItemRow(idx, { quality: e.target.value as CdkQuality })
                      }
                      disabled={creating}
                    >
                      {QUALITY_OPTIONS.map((q) => (
                        <option key={q} value={q}>
                          {QUALITY_LABEL[q]} ({q})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      className="btn btn-danger btn-sm"
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      disabled={creating || itemRows.length <= 1}
                      title={itemRows.length <= 1 ? '至少保留一个物品' : '删除该物品'}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {packItems.length === 0 && (
                <div className="empty-state" style={{ padding: 12 }}>
                  当前 Pack 暂无物品列表，可手动输入物品名（在下方"物品"框中输入或选择）
                </div>
              )}
            </div>

            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="form-field">
                <label className="form-label">生成数量（一次生成多少个相同礼包的 CDK）</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={1000}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div className="form-field">
                <label className="form-label">过期天数</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div className="form-field form-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => void handleCreate()}
                  disabled={creating || itemRows.every((r) => !r.item_name)}
                >
                  {creating ? '生成中…' : '生成 CDK'}
                </button>
              </div>
            </div>

            {/* v4.37.0: 使用次数选择 */}
            <div className="form-grid" style={{ marginTop: 16 }}>
              <div className="form-field">
                <label className="form-label">使用次数</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {([
                    { key: 'once', label: '一次性' },
                    { key: 'limited', label: '限 N 次' },
                    { key: 'unlimited', label: '无限次' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`btn btn-sm ${maxUsesMode === opt.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setMaxUsesMode(opt.key)}
                      disabled={creating}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {maxUsesMode === 'limited' && (
                    <input
                      className="input"
                      type="number"
                      min={2}
                      style={{ width: 100 }}
                      value={maxUsesValue}
                      onChange={(e) => setMaxUsesValue(e.target.value)}
                      disabled={creating}
                      aria-label="限次使用次数"
                    />
                  )}
                </div>
                <p className="form-hint" style={{ marginTop: 6 }}>
                  一次性：每个 CDK 仅一个玩家可兑换。限 N 次：可被 N 个不同玩家兑换（同一玩家不可重复）。无限次：过期前任意已登录玩家均可兑换（同一玩家不可重复）。
                </p>
              </div>
            </div>
          </div>

          <div className="info-card" style={{ marginTop: 12 }}>
            <h3 className="card-title">CDK 列表 ({codes.length})</h3>
            {loading ? (
              <div className="empty-state">加载中…</div>
            ) : codes.length === 0 ? (
              <div className="empty-state">暂无 CDK 兑换码</div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>礼包名称</th>
                      <th>礼包内容</th>
                      <th>状态</th>
                      <th>使用次数</th>
                      <th>兑换玩家</th>
                      <th>兑换时间</th>
                      <th>过期时间</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => {
                      const isMultiUse = c.max_uses !== 1;
                      const canExpand = isMultiUse && c.use_count > 0;
                      const isExpanded = expandedCodeId === c.id;
                      const canDelete = c.status === 'unused' && c.use_count === 0;
                      return (
                        <Fragment key={c.id}>
                          <tr>
                            <td>
                              <code className="cdk-code">{c.code}</code>
                            </td>
                            <td>{c.gift_name ?? '—'}</td>
                            <td style={{ maxWidth: 320, wordBreak: 'break-all' }}>
                              {renderGiftItems(c.items, c.item_name, c.count, c.quality)}
                            </td>
                            <td>
                              <span className={statusClass(c.status)}>{STATUS_LABEL[c.status]}</span>
                            </td>
                            <td>
                              <span style={{ whiteSpace: 'nowrap' }}>{renderUseCount(c)}</span>
                              {canExpand && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  type="button"
                                  onClick={() => void handleToggleRedemptions(c)}
                                  disabled={loadingRedemptions}
                                  style={{ marginLeft: 6 }}
                                  aria-expanded={isExpanded}
                                  aria-label={isExpanded ? '收起兑换记录' : '展开兑换记录'}
                                >
                                  {isExpanded ? '收起' : '查看记录'}
                                </button>
                              )}
                            </td>
                            <td>{c.claimed_player ?? '—'}</td>
                            <td>{formatTime(c.claimed_at)}</td>
                            <td>{formatTime(c.expires_at)}</td>
                            <td>{formatTime(c.created_at)}</td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void handleCopy(c.code)}
                              >
                                {copiedCode === c.code ? '已复制' : '复制'}
                              </button>
                              {canDelete && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => void handleDelete(c.id, c.code)}
                                  style={{ marginLeft: 8 }}
                                >
                                  删除
                                </button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="cdk-redemptions-row">
                              <td colSpan={10}>
                                {loadingRedemptions && expandedCodeId === c.id ? (
                                  <div className="empty-state" style={{ padding: 12 }}>
                                    加载兑换记录中…
                                  </div>
                                ) : (redemptionMap[c.id]?.length ?? 0) === 0 ? (
                                  <div className="empty-state" style={{ padding: 12 }}>
                                    暂无兑换记录
                                  </div>
                                ) : (
                                  <div className="cdk-redemptions-inner">
                                    <div className="cdk-redemptions-title">
                                      兑换记录（{redemptionMap[c.id]?.length ?? 0} 条）
                                    </div>
                                    <table className="data-table data-table-compact">
                                      <thead>
                                        <tr>
                                          <th>#</th>
                                          <th>玩家名</th>
                                          <th>兑换时间</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(redemptionMap[c.id] ?? []).map((r, idx) => (
                                          <tr key={r.id}>
                                            <td>{idx + 1}</td>
                                            <td>{r.player_name}</td>
                                            <td>{formatTime(r.redeemed_at)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
