// ============================================================================
// UserStats — 消费统计页（/user-center/stats）
//
// 功能：本人消费统计总览（KPI + 图表）
// API：getUserStats（GET /me/stats：分类汇总 + 近 12 月趋势 + Top5 实例）
// 设计：Apple 浅色主题，KPI 卡片 + SpendingCharts 纯 CSS 图表
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import { getUserStats, formatMoney, type UserStats } from './api';
import SpendingCharts from './components/SpendingCharts';

export default function UserStats() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  useDocumentTitle('消费统计');

  // 返回到个人中心首页（去掉 URL 最后一段：/xxx/center/stats → /xxx/center）
  const backToCenter = useMemo(
    () => location.pathname.replace(/\/[^/]+$/, '') || '/',
    [location.pathname],
  );

  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setStats(await getUserStats(token));
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 本月 / 近 12 月收支汇总
  const kpi = useMemo(() => {
    const trend = stats?.monthly_trend ?? [];
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = trend.find((m) => m.month === currentMonth);
    const totalIncome = trend.reduce((sum, m) => sum + m.income, 0);
    const totalExpense = trend.reduce((sum, m) => sum + m.expense, 0);
    return {
      monthIncome: current?.income ?? 0,
      monthExpense: current?.expense ?? 0,
      totalIncome,
      totalExpense,
    };
  }, [stats]);

  const hasData =
    !!stats &&
    (stats.by_type.length > 0 ||
      stats.monthly_trend.length > 0 ||
      stats.top_servers.length > 0);

  return (
    <div className="page">
      {/* 页头 */}
      <div className="page-header">
        <h2 className="page-title">消费统计</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => navigate(backToCenter)}>
            <ArrowLeft size={14} />
            返回
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="stats-chip stats-chip-active">
          <span className="stats-chip-label">
            <TrendingUp size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            本月收入
          </span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(kpi.monthIncome)}
          </span>
        </div>
        <div className="stats-chip stats-chip-disabled">
          <span className="stats-chip-label">
            <TrendingDown size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            本月支出
          </span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(kpi.monthExpense)}
          </span>
        </div>
        <div className="stats-chip">
          <span className="stats-chip-label">近 12 月收入</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(kpi.totalIncome)}
          </span>
        </div>
        <div className="stats-chip">
          <span className="stats-chip-label">近 12 月支出</span>
          <span className="stats-chip-value">
            {loading ? '…' : formatMoney(kpi.totalExpense)}
          </span>
        </div>
      </div>

      {/* 图表区 */}
      <div className="info-card">
        {loading ? (
          <div className="empty-state" style={{ padding: '32px' }}>
            <p>加载中…</p>
          </div>
        ) : !hasData ? (
          <div className="empty-state" style={{ padding: '32px' }}>
            <p>暂无统计数据，完成首笔交易后此处将展示消费分析</p>
          </div>
        ) : (
          <SpendingCharts
            monthlyTrend={stats.monthly_trend}
            topServers={stats.top_servers}
            byType={stats.by_type}
          />
        )}
      </div>
    </div>
  );
}
