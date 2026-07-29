// ============================================================================
// Forbidden — 403 无权限页面
// v4.15.2: 返回按钮按角色返回对应基座首页（避免 /dashboard→/admin→403 死循环）
// v4.28.0: 全员服主——目标页所需角色已在账号角色集内时，提供免密切换引导按钮
// ============================================================================

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import type { UserRole } from '@public/schema/panel-api-types';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../api/auth';
import { useToast } from '../components/ui';
import { getEffectiveRole, isAdminRole, isInstanceAdminOrAbove } from '../utils/role';

export default function Forbidden() {
  useDocumentTitle('无权限');
  const { user, switchActiveRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  const effectiveRole = getEffectiveRole(user);

  // v4.15.2: 按角色返回对应基座首页，避免 /dashboard→/admin→403 死循环
  const homePath = user
    ? isAdminRole(effectiveRole)
      ? '/admin'
      : isInstanceAdminOrAbove(effectiveRole)
        ? '/store'
        : '/guild'
    : '/';

  // v4.28.0: RequireRole 跳转时携带的目标路径与所需角色
  const navState = location.state as { from?: string; allow?: string[] } | null;
  const from = navState?.from;
  const allow = navState?.allow ?? [];

  // 免密切换引导条件：
  //   1. 目标页允许 instance_admin（服主层页面，如 /store、/instances/new）
  //   2. 目标页非仅 server_admin 可达（管理员提权须走密码通道，不提供免密引导）
  //   3. 账号角色集包含 instance_admin 且当前 active_role 不是
  const userRoles = (user?.roles ?? (effectiveRole ? [effectiveRole] : [])) as UserRole[];
  const activeRole = (effectiveRole ?? undefined) as UserRole | undefined;
  const adminOnly = allow.length > 0 && !allow.includes('instance_admin');
  const canSwitchToContinue =
    !!user &&
    allow.includes('instance_admin') &&
    !adminOnly &&
    activeRole !== 'instance_admin' &&
    userRoles.includes('instance_admin');

  // 免密切换为服主身份后回跳原目标页（缺省落 /store 工作台）
  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      await switchActiveRole('instance_admin');
      navigate(from && from !== '/forbidden' ? from : '/store', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '角色切换失败，请稍后重试');
      setSwitching(false);
    }
  };

  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: 64 }}>
      <h1 className="page-title" style={{ fontSize: 48, marginBottom: 8 }}>
        403
      </h1>
      <p className="form-hint" style={{ fontSize: 16, marginBottom: 24 }}>
        抱歉，您没有权限访问该页面
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {canSwitchToContinue && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSwitch()}
            disabled={switching}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowLeftRight size={16} />
            {switching ? '切换中…' : '切换为服主身份继续'}
          </button>
        )}
        <Link
          to={homePath}
          className={canSwitchToContinue ? 'btn btn-ghost' : 'btn btn-primary'}
        >
          返回首页
        </Link>
      </div>
      {canSwitchToContinue && (
        <p className="form-hint" style={{ marginTop: 16 }}>
          您的账号已具备服主身份，免密切换后即可继续访问
        </p>
      )}
    </div>
  );
}
