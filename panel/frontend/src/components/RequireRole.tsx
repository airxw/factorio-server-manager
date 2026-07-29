// ============================================================================
// RequireRole — 基于角色的路由权限守卫
// 不满足所需角色时跳转 403 无权限页
// v4.28.0: 跳转携带 from/allow state，Forbidden 页据此提供免密身份切换引导
// ============================================================================

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../api/auth';
import { getEffectiveRole } from '../utils/role';

interface RequireRoleProps {
  /** 允许通过的角色列表；为空表示任意已登录用户均可 */
  allow?: string[];
}

export default function RequireRole({ allow }: RequireRoleProps) {
  const { user, roleSwitching } = useAuth();
  const location = useLocation();
  const effectiveRole = getEffectiveRole(user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // v4.28.2: 角色切换进行中暂缓重定向——user 已按新 active_role 更新而 URL 仍在旧工作台时，
  // 本守卫会误判并无权限把用户弹到 /forbidden；切换流程由调用方负责导航到目标工作台。
  if (roleSwitching) {
    return null;
  }

  if (allow && allow.length > 0 && !effectiveRole) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname + location.search, allow }} />;
  }

  if (allow && allow.length > 0 && effectiveRole && !allow.includes(effectiveRole)) {
    return (
      <Navigate
        to="/forbidden"
        replace
        state={{ from: location.pathname + location.search, allow }}
      />
    );
  }

  return <Outlet />;
}
