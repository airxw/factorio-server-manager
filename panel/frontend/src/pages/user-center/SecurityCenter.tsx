// ============================================================================
// SecurityCenter — 个人安全中心页（v4.31.0）
//
// 路由：/user-center/security（或 /guild/center/security、/store/center/security）
//
// 三块内容：
//   1. 上次登录信息卡（顶部醒目）— 时间 / IP / 设备 / 距今多久 / 警示文案
//   2. 登录历史（中部表格）— 时间 / 结果徽章 / IP / 设备，含分页
//   3. 我的活动（下部表格）— 时间 / 操作 / 目标类型 / IP / 详情，含分页
//
// API：getMyLoginHistory / getMyActivity / getLastLogin（api/modules/security）
// 设计：Apple 浅色主题，与 UserCenter.tsx 一致；KPI 卡片 + 徽章 + 表格
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import {
  getMyLoginHistory,
  getMyActivity,
  getLastLogin,
  loginTypeBadgeClass,
} from '../../api/modules/security';
import type {
  LoginHistoryListResponse,
  MyActivityListResponse,
  LastLoginInfo,
} from '@public/schema/panel-api-types';
import { formatFullTime } from './api';

const LOGIN_PAGE_SIZE = 20;
const ACTIVITY_PAGE_SIZE = 20;

export default function SecurityCenter() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('安全中心');

  // ----- 上次登录 -----
  const [lastLogin, setLastLogin] = useState<LastLoginInfo | null | undefined>(undefined);
  // undefined=加载中, null=首次登录, 对象=有历史

  // ----- 登录历史 -----
  const [loginPage, setLoginPage] = useState<LoginHistoryListResponse | null>(null);
  const [loginPageNum, setLoginPageNum] = useState(1);
  const [loginLoading, setLoginLoading] = useState(true);

  // ----- 我的活动 -----
  const [activityPage, setActivityPage] = useState<MyActivityListResponse | null>(null);
  const [activityPageNum, setActivityPageNum] = useState(1);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadLastLogin = useCallback(async () => {
    if (!token) return;
    try {
      const info = await getLastLogin(token);
      setLastLogin(info);
    } catch (err) {
      // 上次登录加载失败不阻断主页面，仅 toast
      setLastLogin(null);
      toast.error(err instanceof PanelApiError ? err.message : '上次登录信息加载失败');
    }
  }, [token, toast]);

  const loadLoginHistory = useCallback(async () => {
    if (!token) return;
    setLoginLoading(true);
    try {
      const res = await getMyLoginHistory(token, loginPageNum, LOGIN_PAGE_SIZE);
      setLoginPage(res);
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '登录历史加载失败');
      setLoginPage(null);
    } finally {
      setLoginLoading(false);
    }
  }, [token, loginPageNum, toast]);

  const loadActivity = useCallback(async () => {
    if (!token) return;
    setActivityLoading(true);
    try {
      const res = await getMyActivity(token, { page: activityPageNum, page_size: ACTIVITY_PAGE_SIZE });
      setActivityPage(res);
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '活动记录加载失败');
      setActivityPage(null);
    } finally {
      setActivityLoading(false);
    }
  }, [token, activityPageNum, toast]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadLastLogin(), loadLoginHistory(), loadActivity()]);
  }, [loadLastLogin, loadLoginHistory, loadActivity]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // 登录历史分页数
  const loginTotalPages = useMemo(() => {
    if (!loginPage) return 1;
    return Math.max(1, Math.ceil(loginPage.total / LOGIN_PAGE_SIZE));
  }, [loginPage]);

  // 我的活动分页数
  const activityTotalPages = useMemo(() => {
    if (!activityPage) return 1;
    return Math.max(1, Math.ceil(activityPage.total / ACTIVITY_PAGE_SIZE));
  }, [activityPage]);

  return (
    <div className="page">
      {/* 页头 */}
      <div className="page-header">
        <h2 className="page-title">安全中心</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refreshAll()} disabled={loginLoading || activityLoading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {/* 1. 上次登录信息卡（顶部醒目） */}
      <div className="info-card" style={{ borderColor: 'var(--accent-primary, #007aff)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <ShieldCheck size={20} style={{ color: 'var(--accent-primary, #007aff)' }} />
          <h3 className="card-title" style={{ margin: 0 }}>上次登录信息</h3>
        </div>
        {lastLogin === undefined ? (
          <div className="empty-state" style={{ padding: '16px' }}>
            <p>加载中…</p>
          </div>
        ) : lastLogin === null ? (
          <div className="empty-state" style={{ padding: '16px' }}>
            <p>这是您的首次登录，无历史记录</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <LastLoginItem icon={<Clock size={14} />} label="上次登录时间" value={formatFullTime(lastLogin.last_login_at)} />
            <LastLoginItem icon={<Globe size={14} />} label="上次登录 IP" value={lastLogin.ip_address ?? '-'} />
            <LastLoginItem icon={<Monitor size={14} />} label="上次登录设备" value={lastLogin.device_summary ?? '-'} />
            <LastLoginItem icon={<Clock size={14} />} label="距今" value={humanizeRelative(lastLogin.last_login_at)} />
          </div>
        )}
        {lastLogin && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            若以上信息非本人操作，请立即
            <button
              className="btn btn-link"
              style={{ padding: '0 4px', verticalAlign: 'baseline' }}
              onClick={() => navigate('/guild/profile')}
            >
              修改密码
            </button>
          </div>
        )}
      </div>

      {/* 2. 登录历史 */}
      <div className="info-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>登录历史</h3>
          {loginPage && (
            <span className="form-hint">共 {loginPage.total} 条记录</span>
          )}
        </div>
        {loginLoading ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>加载中…</p>
          </div>
        ) : !loginPage || loginPage.items.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>暂无登录记录</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>结果</th>
                    <th>IP</th>
                    <th>设备</th>
                  </tr>
                </thead>
                <tbody>
                  {loginPage.items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatFullTime(item.created_at)}</td>
                      <td>
                        <span className={loginTypeBadgeClass(item.login_type)}>
                          {item.login_type_label}
                        </span>
                      </td>
                      <td className="mono">{item.ip_address ?? '-'}</td>
                      <td>{item.device_summary ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={loginPage.page}
              totalPages={loginTotalPages}
              loading={loginLoading}
              onPrev={() => setLoginPageNum((p) => Math.max(1, p - 1))}
              onNext={() => setLoginPageNum((p) => Math.min(loginTotalPages, p + 1))}
            />
          </>
        )}
      </div>

      {/* 3. 我的活动 */}
      <div className="info-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>我的活动</h3>
          {activityPage && (
            <span className="form-hint">共 {activityPage.total} 条记录</span>
          )}
        </div>
        {activityLoading ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>加载中…</p>
          </div>
        ) : !activityPage || activityPage.items.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <p>暂无活动记录</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作</th>
                    <th>目标类型</th>
                    <th>目标 ID</th>
                    <th>IP</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {activityPage.items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatFullTime(item.created_at)}</td>
                      <td className="mono">{item.action}</td>
                      <td>{item.target_type ?? '-'}</td>
                      <td className="mono">{item.target_id ?? '-'}</td>
                      <td className="mono">{item.ip_address ?? '-'}</td>
                      <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(item.details ?? {})}>
                        {item.details ? formatDetails(item.details) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={activityPage.page}
              totalPages={activityTotalPages}
              loading={activityLoading}
              onPrev={() => setActivityPageNum((p) => Math.max(1, p - 1))}
              onNext={() => setActivityPageNum((p) => Math.min(activityTotalPages, p + 1))}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 子组件
// ============================================================================

function LastLoginItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="stats-chip">
      <span className="stats-chip-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        {label}
      </span>
      <span className="stats-chip-value">{value}</span>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  loading,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
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
        第 {page} / {totalPages} 页
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={page <= 1 || loading}>
          <ChevronLeft size={14} />
          上一页
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={page >= totalPages || loading}>
          下一页
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

/** ISO 时间 → "5 分钟前 / 2 小时前 / 3 天前" */
function humanizeRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return '刚刚';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  const year = Math.floor(month / 12);
  return `${year} 年前`;
}

/** details 对象 → 简短摘要字符串 */
function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return '-';
  // 取前 2 个键值对，避免详情过长
  const parts = entries.slice(0, 2).map(([k, v]) => {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return `${k}=${v}`;
    }
    return `${k}=…`;
  });
  return parts.join(', ');
}
