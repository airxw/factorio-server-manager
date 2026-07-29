// ============================================================================
// SpendingCharts — 消费统计图表组件（用户中心经济系统）
//
// 纯 CSS 柱状图/条形图实现（项目未引入图表库，零依赖）：
//   ① 近 12 个月收支趋势（双柱：收入绿 / 支出红，缺月补零）
//   ② Top 消费实例（横向条形，余额支出降序）
//   ③ 分类汇总（横向条形，按币种+类型）
// 数据契约：GET /api/me/stats（api.ts UserStats）
// ============================================================================

import { useMemo } from 'react';
import {
  formatMoney,
  TX_TYPE_LABEL,
  CURRENCY_TYPE_LABEL,
  type MonthlyTrendItem,
  type StatsByTypeItem,
  type TopServerItem,
} from '../api';

// ============================================================================
// 常量
// ============================================================================

/** 收入柱色（Apple 绿） */
const INCOME_COLOR = '#34C759';
/** 支出柱色（Apple 红） */
const EXPENSE_COLOR = '#FF3B30';
/** 强调条色（Apple 蓝） */
const ACCENT_COLOR = '#007AFF';

/** 分类汇总展示条数上限 */
const BY_TYPE_TOP_N = 8;

// ============================================================================
// Props
// ============================================================================

interface SpendingChartsProps {
  /** 月度收支趋势（后端仅返回有数据月份，组件内部补全近 12 个月） */
  monthlyTrend: MonthlyTrendItem[];
  /** Top 消费实例（余额支出，后端已按降序取前 5） */
  topServers: TopServerItem[];
  /** 按币种+类型汇总（总额/笔数） */
  byType: StatsByTypeItem[];
}

// ============================================================================
// 组件
// ============================================================================

export default function SpendingCharts({ monthlyTrend, topServers, byType }: SpendingChartsProps) {
  // 补全近 12 个月（含无数据月份），保证趋势连续
  const months = useMemo(() => {
    const map = new Map(monthlyTrend.map((m) => [m.month, m]));
    const now = new Date();
    const result: Array<{ month: string; label: string; income: number; expense: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const item = map.get(key);
      result.push({
        month: key,
        label: `${d.getMonth() + 1}月`,
        income: item?.income ?? 0,
        expense: item?.expense ?? 0,
      });
    }
    return result;
  }, [monthlyTrend]);

  const monthMax = useMemo(
    () => Math.max(1, ...months.map((m) => Math.max(m.income, m.expense))),
    [months],
  );

  const serverMax = useMemo(
    () => Math.max(1, ...topServers.map((s) => s.total_spent)),
    [topServers],
  );

  const byTypeRows = useMemo(
    () =>
      [...byType]
        .sort((a, b) => b.total_amount - a.total_amount)
        .slice(0, BY_TYPE_TOP_N),
    [byType],
  );

  const byTypeMax = useMemo(
    () => Math.max(1, ...byTypeRows.map((r) => r.total_amount)),
    [byTypeRows],
  );

  /** 柱高百分比（>0 时保底 2%，避免不可见） */
  const barHeight = (value: number, max: number): string =>
    value <= 0 ? '0%' : `${Math.max(2, Math.round((value / max) * 100))}%`;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ---------- ① 近 12 个月收支趋势 ---------- */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 10,
            flexWrap: 'wrap',
          }}
        >
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>近 12 个月收支趋势</h4>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: INCOME_COLOR, display: 'inline-block' }} />
            收入
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: EXPENSE_COLOR, display: 'inline-block' }} />
            支出
          </span>
        </div>
        <div
          role="img"
          aria-label="近 12 个月收支趋势柱状图"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            height: 140,
            padding: '0 2px',
          }}
        >
          {months.map((m) => (
            <div
              key={m.month}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                height: '100%',
              }}
            >
              <div
                style={{
                  flex: 1,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                <div
                  title={`${m.label} 收入 ${formatMoney(m.income)}`}
                  style={{
                    width: '38%',
                    maxWidth: 14,
                    height: barHeight(m.income, monthMax),
                    borderRadius: '3px 3px 0 0',
                    background: INCOME_COLOR,
                    transition: 'height 0.3s ease',
                  }}
                />
                <div
                  title={`${m.label} 支出 ${formatMoney(m.expense)}`}
                  style={{
                    width: '38%',
                    maxWidth: 14,
                    height: barHeight(m.expense, monthMax),
                    borderRadius: '3px 3px 0 0',
                    background: EXPENSE_COLOR,
                    transition: 'height 0.3s ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- ②③ 两栏：Top 实例 + 分类汇总 ---------- */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {/* ② Top 消费实例 */}
        <div>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Top 消费实例</h4>
          {topServers.length === 0 ? (
            <p className="form-hint" style={{ margin: 0 }}>暂无实例消费记录</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }} role="img" aria-label="Top 消费实例条形图">
              {topServers.map((s) => (
                <div key={s.server_id} style={{ display: 'grid', gap: 3 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.server_name || s.server_id}
                    </span>
                    <span className="mono" style={{ flexShrink: 0, fontWeight: 600 }}>
                      {formatMoney(s.total_spent)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--color-bg-secondary)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      title={`${s.server_name || s.server_id} 消费 ${formatMoney(s.total_spent)}`}
                      style={{
                        width: `${Math.max(2, Math.round((s.total_spent / serverMax) * 100))}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: ACCENT_COLOR,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ③ 分类汇总 */}
        <div>
          <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>分类汇总</h4>
          {byTypeRows.length === 0 ? (
            <p className="form-hint" style={{ margin: 0 }}>暂无交易数据</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }} role="img" aria-label="分类汇总条形图">
              {byTypeRows.map((r) => (
                <div key={`${r.currency_type}-${r.type}`} style={{ display: 'grid', gap: 3 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {CURRENCY_TYPE_LABEL[r.currency_type] ?? r.currency_type}
                      {' · '}
                      {TX_TYPE_LABEL[r.type] ?? r.type}
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        {' '}（{formatMoney(r.tx_count)} 笔）
                      </span>
                    </span>
                    <span className="mono" style={{ flexShrink: 0, fontWeight: 600 }}>
                      {formatMoney(r.total_amount)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--color-bg-secondary)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      title={`${TX_TYPE_LABEL[r.type] ?? r.type} 总额 ${formatMoney(r.total_amount)}`}
                      style={{
                        width: `${Math.max(2, Math.round((r.total_amount / byTypeMax) * 100))}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: ACCENT_COLOR,
                        opacity: 0.75,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
