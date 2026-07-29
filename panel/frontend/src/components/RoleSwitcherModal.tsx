// ============================================================================
// RoleSwitcherModal — v4.17.0 多角色切换弹窗
//
// 触发场景：用户头像下拉菜单中"切换角色"入口（仅 roles.length > 1 时显示）
// 流程（v4.28.0 分级免密，全员服主）：
//   1. 展示当前账号所有可选角色（除 active_role 外）
//   2. 目标为 user / instance_admin（同层身份两面）→ 免密：
//      点选即调 useAuth.switchActiveRole(targetRole)（POST /api/auth/switch-role，JWT-only）
//   3. 目标为 server_admin（level 3 提权）→ 保留密码二次校验：
//      输入密码 → 调 useAuth.selectRole(email, password, targetRole)
//   4. 成功：关闭弹窗 + 跳转到对应工作台（玩家→/guild，服主→/store，管理员→/admin）
//   5. 失败：展示后端错误码（401 密码错误 / 400 角色非法 / 403 闸门或跨用户）
//
// 设计语言：苹果清新（iOS/macOS 蓝 #007AFF，白底 #FBFBFD，圆角 12-16px）
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck, X, Zap } from 'lucide-react';
import type { UserRole } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { PanelApiError } from '../api/client';

interface RoleSwitcherModalProps {
  open: boolean;
  onClose: () => void;
}

// 角色展示元数据（标签 + 图标 + 跳转目标）
const ROLE_META: Record<UserRole, { label: string; desc: string; target: string }> = {
  user: { label: '玩家', desc: '消费侧入口：商城 / 我的资产 / 发现', target: '/guild' },
  instance_admin: { label: '服主', desc: '实例运营：店铺 / 玩家 / 数据报表', target: '/store' },
  server_admin: { label: '平台管理员', desc: '全平台总览：用户 / 节点 / 系统配置', target: '/admin' },
};

// v4.28.0 分级免密：同层身份（user ↔ instance_admin）免密直达；
// 仅 server_admin（level 3 提权）需要密码二次校验
const PASSWORDLESS_ROLES: ReadonlySet<UserRole> = new Set(['user', 'instance_admin']);

export default function RoleSwitcherModal({ open, onClose }: RoleSwitcherModalProps) {
  const { user, selectRole, switchActiveRole } = useAuth();
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // 弹窗打开/角色选择变化时重置状态
  useEffect(() => {
    if (open) {
      setSelectedRole(null);
      setPassword('');
      setShowPassword(false);
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open]);

  // 选中需密码校验的角色后自动聚焦密码输入框
  useEffect(() => {
    if (selectedRole && !PASSWORDLESS_ROLES.has(selectedRole) && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [selectedRole]);

  if (!open || !user) return null;

  // 多角色集合（过滤掉当前 active_role，因为切换就是换成另一个）
  const userRoles = (user.roles ?? [user.role]) as UserRole[];
  const currentActiveRole = (user.active_role ?? user.role) as UserRole;
  const switchableRoles = userRoles.filter((r) => r !== currentActiveRole);

  // 单角色或无角色可切换——关闭弹窗
  if (switchableRoles.length === 0) {
    return null;
  }

  // 切换成功后的统一收尾：关弹窗 + 跳工作台
  const finishSwitch = (role: UserRole) => {
    onClose();
    const target = ROLE_META[role]?.target ?? '/guild';
    navigate(target, { replace: true });
  };

  const extractErrorMsg = (err: unknown, fallback: string): string => {
    if (err instanceof PanelApiError) {
      if (err.status === 401) return '邮箱或密码错误，请重试';
      if (err.status === 400) return err.message || '角色切换失败：参数非法';
      if (err.status === 403) return err.message || '无权执行该角色切换';
      return err.message || `切换失败 (${err.code})`;
    }
    return err instanceof Error ? err.message : fallback;
  };

  // v4.28.0 免密通道：点选同层身份卡片后直接切换，无需进入密码表单
  const handleSelectRoleCard = async (role: UserRole) => {
    if (submitting) return;
    if (!PASSWORDLESS_ROLES.has(role)) {
      // server_admin → 进入密码二次校验表单
      setSelectedRole(role);
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await switchActiveRole(role);
      finishSwitch(role);
    } catch (err) {
      setErrorMsg(extractErrorMsg(err, '未知错误'));
      setSubmitting(false);
    }
  };

  // 密码通道（仅 server_admin 目标）
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || !password || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await selectRole(user.email, password, selectedRole);
      finishSwitch(selectedRole);
    } catch (err) {
      setErrorMsg(extractErrorMsg(err, '未知错误'));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="role-switcher-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-switcher-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="role-switcher-modal" onClick={(e) => e.stopPropagation()}>
        <header className="role-switcher-header">
          <h2 id="role-switcher-title">切换角色</h2>
          <button
            type="button"
            className="role-switcher-close"
            onClick={() => !submitting && onClose()}
            aria-label="关闭"
            disabled={submitting}
          >
            <X size={18} />
          </button>
        </header>

        <div className="role-switcher-body">
          {/* 当前角色标识 */}
          <div className="role-switcher-current">
            <span className="role-switcher-current-label">当前角色</span>
            <span className="role-switcher-current-value">
              {ROLE_META[currentActiveRole]?.label ?? currentActiveRole}
            </span>
          </div>

          {!selectedRole ? (
            <>
              <p className="role-switcher-prompt">选择要切换到的角色</p>
              <div className="role-switcher-role-list">
                {switchableRoles.map((role) => {
                  const meta = ROLE_META[role];
                  const passwordless = PASSWORDLESS_ROLES.has(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      className="role-switcher-role-card"
                      onClick={() => void handleSelectRoleCard(role)}
                      disabled={submitting}
                    >
                      <div className="role-switcher-role-card-main">
                        <span className="role-switcher-role-name">{meta?.label ?? role}</span>
                        <span className="role-switcher-role-desc">{meta?.desc}</span>
                      </div>
                      {submitting && passwordless ? (
                        <Loader2 size={20} className="role-switcher-spinner" aria-label="切换中" />
                      ) : passwordless ? (
                        <Zap
                          size={20}
                          className="role-switcher-role-icon"
                          aria-label="免密快捷切换"
                        />
                      ) : (
                        <ShieldCheck
                          size={20}
                          className="role-switcher-role-icon"
                          aria-label="需密码二次校验"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {errorMsg && (
                <div className="role-switcher-error" role="alert">
                  {errorMsg}
                </div>
              )}
              <p className="role-switcher-hint">
                玩家与服主身份免密快捷互切；切换平台管理员需密码二次校验。
              </p>
            </>
          ) : (
            <form className="role-switcher-form" onSubmit={handleSubmit}>
              <div className="role-switcher-target">
                <span className="role-switcher-target-label">切换到</span>
                <span className="role-switcher-target-value">
                  {ROLE_META[selectedRole]?.label ?? selectedRole}
                </span>
                <button
                  type="button"
                  className="role-switcher-target-change"
                  onClick={() => {
                    setSelectedRole(null);
                    setPassword('');
                    setErrorMsg(null);
                  }}
                  disabled={submitting}
                >
                  更改
                </button>
              </div>

              <label className="role-switcher-field">
                <span className="role-switcher-field-label">邮箱</span>
                <input
                  type="email"
                  value={user.email}
                  readOnly
                  className="role-switcher-input role-switcher-input-readonly"
                />
              </label>

              <label className="role-switcher-field">
                <span className="role-switcher-field-label">密码（二次校验）</span>
                <div className="role-switcher-password-wrapper">
                  <input
                    ref={passwordInputRef}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入当前账号密码以确认"
                    className="role-switcher-input"
                    autoComplete="current-password"
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    className="role-switcher-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              {errorMsg && (
                <div className="role-switcher-error" role="alert">
                  {errorMsg}
                </div>
              )}

              <div className="role-switcher-actions">
                <button
                  type="button"
                  className="role-switcher-btn role-switcher-btn-secondary"
                  onClick={() => !submitting && onClose()}
                  disabled={submitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="role-switcher-btn role-switcher-btn-primary"
                  disabled={!password || submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="role-switcher-spinner" />
                      切换中…
                    </>
                  ) : (
                    '确认切换'
                  )}
                </button>
              </div>

              <p className="role-switcher-hint">
                切换后将跳转到对应工作台。可在用户菜单中随时切换回来。
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
