// ============================================================================
// Profile — 个人设置 + 实例绑定管理
// 顶部展示当前用户信息（用户名/邮箱/角色徽章）
// 「我的实例绑定」区域：列出已绑定实例，支持解绑
// 「可绑定实例」区域：列出所有实例，支持绑定/解绑（不要求 running 状态）
// 「我的钱包」区域：列出每个已绑定实例的点券余额 + 每日领取按钮
// 绑定/解绑后刷新绑定列表；409 冲突提示「已绑定该实例」
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ServerSummary, WalletInfo } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { PanelApiError, type MyBinding } from '../api/client';
import { EmptyState, Skeleton, useConfirm, useToast } from '../components/ui';
import { getEffectiveRole } from '../utils/role';

// v4.14.2: 根据当前基座动态计算路径前缀，避免跨基座跳转
function useBasePath(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin')) return '/admin';
  if (pathname.startsWith('/store')) return '/store';
  return '/guild';
}

// 实例状态中文标签
function instanceStatusLabel(status: string | undefined): string {
  if (!status) return '未知';
  const map: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    stopped: '已停止',
    error: '错误',
    crashed: '已崩溃',
  };
  return map[status] ?? status;
}

function instanceStatusBadgeClass(status: string | undefined): string {
  if (status === 'running') return 'badge badge-running';
  if (status === 'starting' || status === 'stopping') return 'badge badge-starting';
  return 'badge badge-stopped';
}

// 角色中文标签映射（兼容新旧角色值）
const ROLE_LABEL: Record<string, string> = {
  server_admin: '服务器管理员',
  system_admin: '服务器管理员',
  instance_admin: '实例管理员',
  admin: '实例管理员',
  user: '用户',
  operator: '用户',
  viewer: '用户',
};

function roleLabel(role: string | null | undefined): string {
  if (!role) return '用户';
  return ROLE_LABEL[role] ?? '用户';
}

function roleBadgeClass(role: string | null | undefined): string {
  if (role === 'server_admin' || role === 'system_admin') return 'badge badge-running';
  if (role === 'instance_admin' || role === 'admin') return 'badge badge-starting';
  return 'badge badge-stopped';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function Profile() {
  const { user, api, refreshUser } = useAuth();
  const effectiveRole = getEffectiveRole(user);
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const basePath = useBasePath();

  const [bindings, setBindings] = useState<MyBinding[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // 经济系统：钱包余额（按已绑定实例查询）
  const [wallets, setWallets] = useState<Record<string, WalletInfo>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  // 编辑资料
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const isDemo = user?.email === 'admin@local.dev';

  // v3.9.0-S5: 邮箱验证状态 + 重发按钮
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendingVerify, setResendingVerify] = useState(false);

  // v3.4.0: 修改密码（模块3 用户安全）
  //   3 个 Demo 账号（admin/manager/user@local.dev）禁用改密，避免破坏 demo 环境固定密码
  const DEMO_EMAILS = ['admin@local.dev', 'manager@local.dev', 'user@local.dev'] as const;
  const isPasswordChangeDisabled = DEMO_EMAILS.includes(user?.email as (typeof DEMO_EMAILS)[number]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setWalletNotice(null);
    try {
      const [bindRes, srvRes] = await Promise.all([api.listMyBindings(), api.listServers()]);
      setBindings(bindRes);
      setServers(srvRes.servers);
      // 加载已绑定实例的钱包信息（并行查询，失败不阻塞主流程）
      const active = bindRes.filter((b) => !b.unboundAt);
      const walletEntries = await Promise.all(
        active.map(async (b) => {
          try {
            const w = await api.getWallet(b.serverId);
            return [b.serverId, w.wallet] as const;
          } catch {
            return null;
          }
        }),
      );
      const walletMap: Record<string, WalletInfo> = {};
      for (const e of walletEntries) {
        if (e) walletMap[e[0]] = e[1];
      }
      setWallets(walletMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // v3.9.0-S5: 加载邮箱验证状态（best-effort，后端未实现时静默忽略）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getEmailVerifyStatus();
        if (!cancelled) setEmailVerified(res.email_verified);
      } catch {
        // 接口不可用时不阻塞页面（保守视为未知）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleResendVerify = async () => {
    if (resendingVerify) return;
    setResendingVerify(true);
    try {
      const res = await api.requestEmailVerify();
      if (res.sent) {
        toast.success('验证邮件已发送，请查收');
      } else if (res.reason === 'already_verified') {
        toast.info('邮箱已验证，无需重发');
        setEmailVerified(true);
      } else {
        toast.info('邮件发送结果未知，请稍后查看邮箱');
      }
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '发送失败';
      toast.error(msg);
    } finally {
      setResendingVerify(false);
    }
  };

  // serverId -> ServerSummary 映射，用于在绑定列表中显示实例名
  const serverMap = useMemo(() => {
    const m = new Map<string, ServerSummary>();
    for (const s of servers) m.set(s.id, s);
    return m;
  }, [servers]);

  // 当前已绑定（unboundAt 为空）的 serverId 集合
  const boundServerIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bindings) {
      if (!b.unboundAt) s.add(b.serverId);
    }
    return s;
  }, [bindings]);

  // 仅展示当前生效的绑定
  const activeBindings = useMemo(() => bindings.filter((b) => !b.unboundAt), [bindings]);

  // 可绑定实例：所有存在的实例均可绑定（不要求运行中，与"绑定不要求实例运行"需求一致）
  const bindableServers = useMemo(() => servers, [servers]);

  // 编辑资料：保存 display_name
  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      await api.updateUser(user.id, { display_name: editDisplayName || null });
      setNotice('资料已更新');
      toast.success('资料已更新');
      setShowEditProfile(false);
      // 一.10: 保存成功后刷新全局 user，使侧边栏/顶栏显示名称同步更新
      await refreshUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  // 打开编辑资料时，加载当前 display_name
  const openEditProfile = async () => {
    if (!user) return;
    setError(null);
    setNotice(null);
    try {
      const res = await api.getUser(user.id);
      setEditDisplayName(res.user.display_name ?? '');
    } catch {
      setEditDisplayName('');
    }
    setShowEditProfile(true);
  };

  // v3.4.0: 修改密码 handler
  //   前端先做两层校验（长度 + 两次输入一致），后端再做 zxcvbn + 历史 + token_version 三重校验
  //   成功后清空表单、提示用户旧登录已失效需重新登录
  const handleChangePassword = async () => {
    setError(null);
    setNotice(null);
    if (!oldPassword || !newPassword || !confirmPassword) {
      setError('请填写所有密码字段');
      return;
    }
    if (newPassword.length < 6) {
      setError('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与旧密码相同');
      return;
    }
    setSavingPassword(true);
    try {
      const result = await api.changePassword(oldPassword, newPassword);
      // 清空表单
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
      setNotice(`密码修改成功（token_version=${result.tokenVersion}）。旧登录已失效，请重新登录。`);
      toast.success('密码修改成功，请重新登录');
    } catch (err) {
      // 后端错误码映射：
      //   INVALID_CREDENTIAL (401) → 旧密码错误
      //   AUTH_PWD_002 (400) → 密码强度不足（zxcvbn 分 < 3）
      //   AUTH_PWD_003 (409) → 与近期使用过的密码重复
      //   BUILT_IN_ACCOUNT_PASSWORD_READONLY (403, v4.0.2) → 系统内置账号不可改密
      let msg: string;
      if (err instanceof PanelApiError) {
        if (err.code === 'INVALID_CREDENTIAL') {
          msg = '旧密码错误';
        } else if (err.code === 'AUTH_PWD_002') {
          msg = '新密码强度不足，请使用更复杂的密码';
        } else if (err.code === 'AUTH_PWD_003') {
          msg = '新密码与近期使用过的密码重复，请更换';
        } else if (err.code === 'BUILT_IN_ACCOUNT_PASSWORD_READONLY') {
          msg = '此为系统内置账号，密码不可修改（演示场景）';
        } else {
          msg = err.message;
        }
      } else {
        msg = err instanceof Error ? err.message : '密码修改失败';
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const openChangePassword = () => {
    setError(null);
    setNotice(null);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowChangePassword(true);
  };

  const handleBind = async (serverId: string) => {
    setActioningId(serverId);
    setError(null);
    setNotice(null);
    try {
      await api.bindInstance(serverId);
      setNotice('绑定成功');
      toast.success('绑定成功');
      await refresh();
    } catch (err) {
      let msg: string;
      if (err instanceof PanelApiError && err.code === 'ALREADY_BOUND') {
        msg = '已绑定该实例';
      } else {
        msg = err instanceof Error ? err.message : '绑定失败';
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setActioningId(null);
    }
  };

  const handleUnbind = async (serverId: string) => {
    const ok = await confirm({
      title: '解绑确认',
      message: '确认解绑该实例？解绑后该实例的 VIP 等级与相关权限将失效。',
      danger: true,
      confirmText: '解绑',
    });
    if (!ok) return;
    setActioningId(serverId);
    setError(null);
    setNotice(null);
    try {
      await api.unbindInstance(serverId);
      setNotice('解绑成功');
      toast.success('解绑成功');
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解绑失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setActioningId(null);
    }
  };

  // 经济系统：领取每日点券
  const handleClaimDaily = async (serverId: string) => {
    setClaimingId(serverId);
    setWalletNotice(null);
    try {
      const res = await api.claimDailyReward(serverId);
      setWallets((prev) => ({ ...prev, [serverId]: res.wallet }));
      setWalletNotice(`领取成功！获得 ${res.claimed_amount} 点券`);
      toast.success(`领取成功！获得 ${res.claimed_amount} 点券`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '领取每日点券失败';
      setWalletNotice(msg);
      toast.error(msg);
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">个人设置</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      {/* 账户信息 */}
      <div className="info-card">
        <h3 className="card-title">账户信息</h3>
        <div className="info-row">
          <span className="info-label">用户名</span>
          <span className="info-value">{user?.username ?? '-'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">邮箱</span>
          <span className="info-value">{user?.email ?? '-'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">邮箱验证</span>
          <span className="info-value">
            {emailVerified === null ? (
              <span className="badge badge-stopped">未知</span>
            ) : emailVerified ? (
              <span className="badge badge-running">已验证</span>
            ) : (
              <>
                <span className="badge badge-stopped">未验证</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 8 }}
                  onClick={() => void handleResendVerify()}
                  disabled={resendingVerify}
                >
                  {resendingVerify ? '发送中…' : '重发验证邮件'}
                </button>
              </>
            )}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">角色</span>
          <span className="info-value">
            <span className={roleBadgeClass(effectiveRole)}>{roleLabel(effectiveRole)}</span>
          </span>
        </div>
        <div className="info-row" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void openEditProfile()}>
            编辑资料
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 8 }}
            onClick={() => navigate(`${basePath}/me`)}
          >
            查看我的资产
          </button>
        </div>
      </div>

      {/* 编辑资料表单 */}
      {showEditProfile && (
        <div className="info-card">
          <h3 className="card-title">编辑资料</h3>
          <label className="form-field">
            <span className="form-label">显示名称</span>
            <input
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              disabled={isDemo}
              placeholder={isDemo ? 'Demo账号不可修改' : '留空则使用用户名'}
            />
            {isDemo && <span className="form-hint">Demo账号不可修改</span>}
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowEditProfile(false)}
              disabled={savingProfile}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSaveProfile()}
              disabled={isDemo || savingProfile}
            >
              {savingProfile ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 修改密码（v3.4.0 已实现 — 模块3 用户安全） */}
      <div className="info-card">
        <h3 className="card-title">修改密码</h3>
        {isPasswordChangeDisabled ? (
          <p className="form-hint">Demo 账号不可修改密码。请使用普通账号体验该功能。</p>
        ) : (
          <>
            <p className="form-hint">
              修改密码后当前登录将失效（token_version + 1），需使用新密码重新登录。
            </p>
            <div className="info-row" style={{ marginTop: 12 }}>
              {!showChangePassword ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={openChangePassword}
                >
                  修改密码
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowChangePassword(false)}
                  disabled={savingPassword}
                >
                  取消
                </button>
              )}
            </div>
            {showChangePassword && (
              <div style={{ marginTop: 12 }}>
                <label className="form-field">
                  <span className="form-label">当前密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    disabled={savingPassword}
                    placeholder="请输入当前密码"
                  />
                </label>
                <label className="form-field">
                  <span className="form-label">新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={savingPassword}
                    placeholder="至少 6 位，建议含字母/数字/符号"
                  />
                  <span className="form-hint">
                    zxcvbn 强度分需 ≥ 3，且不能与最近 5 次历史密码重复
                  </span>
                </label>
                <label className="form-field">
                  <span className="form-label">确认新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={savingPassword}
                    placeholder="再次输入新密码"
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleChangePassword()}
                    disabled={
                      savingPassword ||
                      !oldPassword ||
                      !newPassword ||
                      !confirmPassword
                    }
                  >
                    {savingPassword ? '保存中…' : '保存新密码'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 我的实例绑定 */}
      <div className="info-card">
        <h3 className="card-title">我的实例绑定</h3>
        {loading ? (
          <Skeleton lines={4} lineHeight={20} />
        ) : activeBindings.length === 0 ? (
          <EmptyState
            title="尚未绑定任何实例"
            description="请在下方「可绑定实例」选择绑定。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>VIP 等级</th>
                  <th>绑定时间</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {activeBindings.map((b) => {
                  const srv = serverMap.get(b.serverId);
                  const name = srv?.name ?? b.serverId;
                  const busy = actioningId === b.serverId;
                  return (
                    <tr key={b.id}>
                      <td className="cell-name">{name}</td>
                      <td>
                        <span className="badge badge-running">VIP{b.vipLevel}</span>
                      </td>
                      <td>{formatDate(b.boundAt)}</td>
                      <td className="col-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void handleUnbind(b.serverId)}
                          disabled={busy}
                        >
                          {busy ? '处理中…' : '解绑'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* v4.17.0: 游戏内绑定验证码入口已移除——pending 验证码统一在 /guild 首页卡片内展示，见 GuildDock.tsx */}

      {/* 可绑定实例 */}
      <div className="info-card">
        <h3 className="card-title">可绑定实例</h3>
        {loading ? (
          <Skeleton lines={4} lineHeight={20} />
        ) : bindableServers.length === 0 ? (
          <EmptyState title="暂无可绑定实例" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>游戏</th>
                  <th>状态</th>
                  <th>绑定状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {bindableServers.map((s) => {
                  const bound = boundServerIds.has(s.id);
                  const busy = actioningId === s.id;
                  return (
                    <tr key={s.id}>
                      <td className="cell-name">{s.name}</td>
                      <td>{s.game_type}</td>
                      <td>
                        <span className={instanceStatusBadgeClass(s.status)}>
                          {instanceStatusLabel(s.status)}
                        </span>
                      </td>
                      <td>
                        {bound ? (
                          <span className="badge badge-running">已绑定</span>
                        ) : (
                          <span className="badge badge-stopped">未绑定</span>
                        )}
                      </td>
                      <td className="col-actions">
                        {bound ? (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => void handleUnbind(s.id)}
                            disabled={busy}
                          >
                            {busy ? '处理中…' : '解绑'}
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void handleBind(s.id)}
                            disabled={busy}
                          >
                            {busy ? '处理中…' : '绑定'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 经济系统：我的钱包 */}
      <div className="info-card">
        <h3 className="card-title">我的钱包</h3>
        {walletNotice && <div className="alert alert-info mb-3">{walletNotice}</div>}
        {loading ? (
          <Skeleton lines={4} lineHeight={20} />
        ) : activeBindings.length === 0 ? (
          <EmptyState
            title="暂无已绑定实例的钱包信息"
            description="请先绑定实例。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>实例名</th>
                  <th>点券余额</th>
                  <th>累计获得</th>
                  <th>累计消费</th>
                  <th>今日可领</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {activeBindings.map((b) => {
                  const srv = serverMap.get(b.serverId);
                  const name = srv?.name ?? b.serverId;
                  const wallet = wallets[b.serverId];
                  const busy = claimingId === b.serverId;
                  return (
                    <tr key={b.id}>
                      <td className="cell-name">{name}</td>
                      <td className="mono">{wallet?.balance ?? '-'}</td>
                      <td className="mono">{wallet?.total_earned ?? '-'}</td>
                      <td className="mono">{wallet?.total_spent ?? '-'}</td>
                      <td className="mono">{wallet?.daily_reward_amount ?? '-'}</td>
                      <td className="col-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleClaimDaily(b.serverId)}
                          disabled={busy || !wallet?.can_claim_daily}
                          title={wallet?.can_claim_daily ? '领取今日点券' : '今日已领取'}
                        >
                          {busy
                            ? '领取中…'
                            : wallet?.can_claim_daily
                              ? '领取每日点券'
                              : '今日已领取'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
