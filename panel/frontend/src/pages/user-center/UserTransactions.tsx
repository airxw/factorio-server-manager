// ============================================================================
// UserTransactions — 交易记录页（/user-center/transactions）
//
// 功能：本人钱包流水查询，支持币种/类型过滤 + 分页
// API：getTransactions（GET /me/transactions）、getBalanceSummary（实例名称映射）
// 设计：Apple 浅色主题，过滤条 + 数据表格 + 分页控制
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import {
  getBalanceSummary,
  getTransactions,
  formatMoney,
  formatFullTime,
  TX_TYPE_LABEL,
  TX_TYPE_BADGE,
  CURRENCY_TYPE_LABEL,
  type TransactionPage,
  type WalletCurrencyType,
  type WalletTxType,
} from './api';

/** 每页条数 */
const PAGE_SIZE = 20;

/** 币种过滤选项 */
const CURRENCY_OPTIONS: Array<{ value: WalletCurrencyType | ''; label: string }> = [
  { value: '', label: '全部币种' },
  { value: 'balance', label: '余额' },
  { value: 'points', label: '点券' },
  { value: 'integral', label: '积分' },
];

/** 类型过滤选项（与 wallet_transactions.type CHECK 约束一致） */
const TYPE_OPTIONS: Array<{ value: WalletTxType | ''; label: string }> = [
  { value: '', label: '全部类型' },
  ...(Object.entries(TX_TYPE_LABEL) as Array<[WalletTxType, string]>).map(
    ([value, label]) => ({ value, label }),
  ),
];

export default function UserTransactions() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  useDocumentTitle('交易记录');

  // 返回到个人中心首页（去掉 URL 最后一段：/xxx/center/transactions → /xxx/center）
  const backToCenter = useMemo(
    () => location.pathname.replace(/\/[^/]+$/, '') || '/',
    [location.pathname],
  );

  // 过滤状态
  const [currencyType, setCurrencyType] = useState<WalletCurrencyType | ''>('');
  const [txType, setTxType] = useState<WalletTxType | ''>('');
  const [page, setPage] = useState(1);

  // 数据状态
  const [txPage, setTxPage] = useState<TransactionPage | null>(null);
  const [serverNames, setServerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // 实例名称映射（用于流水的 server_id 展示）
  useEffect(() => {
    if (!token) return;
    getBalanceSummary(token)
      .then((summary) => {
        const map = new Map<string, string>();
        for (const inst of summary.instances) {
          if (inst.server_name) map.set(inst.server_id, inst.server_name);
        }
        setServerNames(map);
      })
      .catch(() => {
        // 名称映射失败不阻断流水展示（降级显示 server_id）
      });
  }, [token]);

  const loadTransactions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await getTransactions(token, {
        ...(currencyType ? { currency_type: currencyType } : {}),
        ...(txType ? { type: txType } : {}),
        page,
        page_size: PAGE_SIZE,
      });
      setTxPage(result);
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, currencyType, txType, page, toast]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  // 过滤条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [currencyType, txType]);

  const totalPages = useMemo(() => {
    if (!txPage) return 1;
    return Math.max(1, Math.ceil(txPage.total / PAGE_SIZE));
  }, [txPage]);

  return (
    <div className="page">
      {/* 页头 */}
      <div className="page-header">
        <h2 className="page-title">交易记录</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => navigate(backToCenter)}>
            <ArrowLeft size={14} />
            返回
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void loadTransactions()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* 过滤条 */}
      <div className="info-card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ minWidth: 140, flex: '0 1 180px' }}>
            <label className="form-hint" style={{ display: 'block', marginBottom: 4 }}>
              币种
            </label>
            <select
              value={currencyType}
              onChange={(e) => setCurrencyType(e.target.value as WalletCurrencyType | '')}
              aria-label="币种过滤"
              style={{ width: '100%' }}
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 140, flex: '0 1 180px' }}>
            <label className="form-hint" style={{ display: 'block', marginBottom: 4 }}>
              类型
            </label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value as WalletTxType | '')}
              aria-label="类型过滤"
              style={{ width: '100%' }}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {txPage && (
            <span className="form-hint" style={{ marginLeft: 'auto' }}>
              共 {formatMoney(txPage.total)} 条记录
            </span>
          )}
        </div>
      </div>

      {/* 流水表格 */}
      <div className="info-card">
        {loading ? (
          <div className="empty-state" style={{ padding: '32px' }}>
            <p>加载中…</p>
          </div>
        ) : !txPage || txPage.items.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px' }}>
            <p>暂无符合条件的交易记录</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>币种</th>
                    <th style={{ textAlign: 'right' }}>金额</th>
                    <th style={{ textAlign: 'right' }}>交易后余额</th>
                    <th>实例</th>
                    <th>描述</th>
                  </tr>
                </thead>
                <tbody>
                  {txPage.items.map((tx) => (
                    <tr key={tx.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatFullTime(tx.created_at)}</td>
                      <td>
                        <span className={`badge ${TX_TYPE_BADGE[tx.type] ?? 'badge-stopped'}`}>
                          {TX_TYPE_LABEL[tx.type] ?? tx.type}
                        </span>
                      </td>
                      <td>{CURRENCY_TYPE_LABEL[tx.currency_type] ?? tx.currency_type}</td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color: tx.amount >= 0 ? '#34C759' : '#FF3B30',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {tx.amount >= 0 ? '+' : ''}
                        {formatMoney(tx.amount)}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {formatMoney(tx.balance_after)}
                      </td>
                      <td>
                        {tx.server_id
                          ? (serverNames.get(tx.server_id) ?? tx.server_id)
                          : '-'}
                      </td>
                      <td
                        style={{
                          maxWidth: 240,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={tx.description ?? undefined}
                      >
                        {tx.description ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页控制 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 12,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span className="form-hint">
                第 {txPage.page} / {totalPages} 页
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft size={14} />
                  上一页
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  下一页
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
