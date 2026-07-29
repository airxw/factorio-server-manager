// ============================================================================
// Dashboard — 控制台首页（已登录用户入口）
// 路径：/dashboard
// 数据来源：api.listServers() 获取实例列表
// 内容：实例概览统计卡片 + 快捷操作 + 最近活动摘要
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import type { InstanceState } from '@public/schema/daemon-api-types';
import type { ServerSummary } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useTour, type TourStep } from '../hooks/useTour';
import Tour from '../components/Tour';
import { EmptyState, ListSkeleton } from '../components/ui';

const STATE_LABEL: Record<InstanceState, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  error: '异常',
};

function stateClass(state: InstanceState): string {
  return `badge badge-${state}`;
}

// 十.4: 控制台新手引导步骤
// 3.3.4: 第 3 步 target 由 #app-sidebar（占满 100vh）改为 .sidebar-nav（导航项区域），
//   避免 tooltip 定位到视口下方而看不见（placeBelow 误判）
const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    target: '#tour-dashboard-title',
    title: '欢迎',
    content: '欢迎使用 GameServer Panel',
  },
  {
    target: '#tour-dashboard-stats',
    title: '实例概览',
    content: '这里显示你的实例概览',
  },
  {
    target: '.sidebar-nav',
    title: '导航',
    content: '使用左侧菜单导航到不同功能',
  },
];

interface StatCard {
  label: string;
  value: number;
  tone: 'total' | 'running' | 'stopped' | 'error';
}

export default function Dashboard() {
  const { api } = useAuth();
  const navigate = useNavigate();
  useDocumentTitle('控制台');

  // 十.4: 新手引导——首次访问自动触发，可手动重新观看
  const tour = useTour('dashboard', DASHBOARD_TOUR_STEPS);

  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listServers();
      setServers(res.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实例列表失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 统计各状态实例数
  const countBy = (state: InstanceState) => servers.filter((s) => s.status === state).length;

  const stats: StatCard[] = [
    { label: '实例总数', value: servers.length, tone: 'total' },
    { label: '运行中', value: countBy('running'), tone: 'running' },
    { label: '已停止', value: countBy('stopped'), tone: 'stopped' },
    { label: '异常', value: countBy('error'), tone: 'error' },
  ];

  // 最近活动：按 updated_at 倒序取前 5
  const recent = [...servers]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title" id="tour-dashboard-title">
          控制台
        </h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={tour.start}>
            重新观看引导
          </button>
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 实例概览统计卡片 */}
      <div className="stat-grid" id="tour-dashboard-stats">
        {stats.map((s) => (
          <div key={s.label} className={`stat-card stat-${s.tone}`}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* 快捷操作 */}
      <div className="info-card">
        <h3 className="card-title">快捷操作</h3>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-primary" onClick={() => navigate('/instances/new')}>
            + 创建服务器
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/instances')}>
            查看实例列表
          </button>
        </div>
      </div>

      {/* 最近活动摘要 */}
      <div className="info-card">
        <h3 className="card-title">最近活动</h3>
        {loading ? (
          <ListSkeleton rows={4} columns={5} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<Home size={48} />}
            description="暂无实例。点击「创建服务器」开始管理你的游戏服务器。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>游戏</th>
                  <th>状态</th>
                  <th>归属者</th>
                  <th>最近更新</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    {/* 五.8: 名称改为 Link，支持键盘 Enter 触发 + focus 样式 */}
                    <td>
                      <Link
                        to={`/instances/${s.id}`}
                        className="cell-name"
                        aria-label={`查看实例 ${s.name} 详情`}
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td>{s.game_type}</td>
                    <td>
                      <span className={stateClass(s.status)}>{STATE_LABEL[s.status]}</span>
                    </td>
                    <td>{s.owner_username}</td>
                    <td className="mono">{new Date(s.updated_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 十.4: 新手引导巡游 */}
      <Tour
        isActive={tour.isActive}
        steps={DASHBOARD_TOUR_STEPS}
        onClose={tour.close}
      />
    </div>
  );
}
