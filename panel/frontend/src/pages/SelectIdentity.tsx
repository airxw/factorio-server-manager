// ============================================================================
// SelectIdentity — 身份选择页（v4.16.x 身份体系重构）
// 登录成功后，根据用户身份数量决定跳转：
// - 无身份 → 强制选择身份（腐竹/玩家），选择后绑定到账号
// - 多身份 → 选择本次进入哪个身份
// - 单身份 → 自动激活并跳转对应工作台（不展示选择 UI，方案 §3.2 修复）
// 系统管理员不经过此页面，直接进入 /admin
// from 深链：单身份/多身份选完后，若 from 匹配目标基座则跳 from 深链（方案 §5.3）
// BUILD: 20260725-013
// ============================================================================

import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Server, Users, ArrowRight } from 'lucide-react';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { createApiClient, PanelApiError } from '../api/client';
import { getBuildFooterText } from '../utils/buildFooterText';
import { getEffectiveRole } from '../utils/role';

interface Identity {
  id: number;
  identity_type: 'instance_admin' | 'player';
  instance_id?: number;
  instance_name?: string;
  is_default: boolean;
}

interface LocationState {
  from?: string;
}

export default function SelectIdentity() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  useDocumentTitle('选择身份');

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const effectiveRole = getEffectiveRole(user);

  // 未登录用户跳回登录页
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 系统管理员直接进入管理后台
  if (effectiveRole === 'server_admin' || effectiveRole === 'system_admin' || effectiveRole === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  // 解析 from 深链（优先 URL searchParams，其次 location.state）
  const resolveFrom = (): string => {
    const urlFrom = searchParams.get('from');
    const stateFrom = (location.state as LocationState | null)?.from;
    return urlFrom || stateFrom || '/';
  };

  // 计算落地目标：from 匹配基座则跳 from 深链，否则跳基座
  const resolveTarget = (identityType: 'instance_admin' | 'player'): string => {
    const targetBase = identityType === 'instance_admin' ? '/store' : '/guild';
    const from = resolveFrom();
    if (from && from !== '/' && from.startsWith(targetBase)) {
      return from;
    }
    return targetBase;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient({});
        const res = await api.listIdentities();
        if (cancelled) return;
        const list = res.identities || [];
        setIdentities(list);
        // 单身份自动直达（方案 §3.2 修复 + §5.3）：不展示选择 UI，直接激活跳转
        if (list.length === 1) {
          const identity = list[0];
          try {
            await api.activateIdentity(identity.id);
            if (cancelled) return;
            navigate(resolveTarget(identity.identity_type), { replace: true });
            return;
          } catch {
            // 激活失败降级到选择页 UI（让用户手动选）
          }
        }
      } catch (err) {
        if (cancelled) return;
        // API 尚未实现时，显示空列表
        if (err instanceof PanelApiError && err.message.includes('Not implemented')) {
          setIdentities([]);
        } else {
          setError('加载身份列表失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectIdentity = async (identity: Identity) => {
    if (selecting) return;
    setSelecting(true);
    try {
      const api = createApiClient({});
      // 设置当前活跃身份
      await api.activateIdentity(identity.id);
      // 如果是首次选择，设置为默认身份
      if (identities.length === 1 || !identities.some((i) => i.is_default)) {
        await api.setDefaultIdentity(identity.id);
      }
      // 跳转到 from 深链（若匹配基座）或对应工作台
      navigate(resolveTarget(identity.identity_type), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '选择身份失败');
      setSelecting(false);
    }
  };

  const handleCreateIdentity = async (identityType: 'instance_admin' | 'player') => {
    if (selecting) return;
    setSelecting(true);
    try {
      const api = createApiClient({});
      // 创建身份（不关联实例，后续再绑定）
      const newIdentity = await api.createIdentity({
        identity_type: identityType,
      });
      // 设置为默认身份
      await api.setDefaultIdentity(newIdentity.id);
      // 跳转到 from 深链（若匹配基座）或对应工作台
      navigate(resolveTarget(identityType), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建身份失败');
      setSelecting(false);
    }
  };

  if (loading) {
    return (
      <div className="select-identity-page">
        <div className="select-identity-card">
          <p style={{ textAlign: 'center' }}>加载中…</p>
        </div>
      </div>
    );
  }

  // 无身份 — 强制选择身份类型
  if (identities.length === 0) {
    return (
      <div className="select-identity-page">
        <div className="select-identity-card">
          <h1 className="select-identity-title">选择您的身份</h1>
          <p className="select-identity-subtitle">
            您是第一次登录，请选择您的身份类型
          </p>

          {error && <div className="form-error">{error}</div>}

          <div className="select-identity-options">
            <button
              type="button"
              className="select-identity-option select-identity-option-admin"
              onClick={() => handleCreateIdentity('instance_admin')}
              disabled={selecting}
            >
              <div className="select-identity-icon">
                <Server size={32} />
              </div>
              <div className="select-identity-content">
                <h2>我是腐竹</h2>
                <p>管理自己的游戏服务器</p>
                <ul>
                  <li>创建和配置游戏服务器</li>
                  <li>监控服务器状态和日志</li>
                  <li>管理玩家和权限</li>
                </ul>
              </div>
              <ArrowRight size={20} className="select-identity-arrow" />
            </button>

            <button
              type="button"
              className="select-identity-option select-identity-option-player"
              onClick={() => handleCreateIdentity('player')}
              disabled={selecting}
            >
              <div className="select-identity-icon">
                <Users size={32} />
              </div>
              <div className="select-identity-content">
                <h2>我是玩家</h2>
                <p>加入别人的游戏服务器</p>
                <ul>
                  <li>浏览和加入游戏服务器</li>
                  <li>购买道具和礼包</li>
                  <li>参与社区和投票</li>
                </ul>
              </div>
              <ArrowRight size={20} className="select-identity-arrow" />
            </button>
          </div>
        </div>
        {/* BUILD ID — 底部规范化 footer span（部署核对用） */}
        <footer className="app-footer-build">
            {getBuildFooterText()}
        </footer>
      </div>
    );
  }

  // 多身份 — 选择本次进入哪个身份
  return (
    <div className="select-identity-page">
      <div className="select-identity-card">
        <h1 className="select-identity-title">选择身份</h1>
        <p className="select-identity-subtitle">
          您绑定了 {identities.length} 个身份，选择本次进入哪个
        </p>

        {error && <div className="form-error">{error}</div>}

        <div className="select-identity-options">
          {identities.map((identity) => (
            <button
              key={identity.id}
              type="button"
              className={`select-identity-option ${
                identity.identity_type === 'instance_admin'
                  ? 'select-identity-option-admin'
                  : 'select-identity-option-player'
              }`}
              onClick={() => handleSelectIdentity(identity)}
              disabled={selecting}
            >
              <div className="select-identity-icon">
                {identity.identity_type === 'instance_admin' ? (
                  <Server size={32} />
                ) : (
                  <Users size={32} />
                )}
              </div>
              <div className="select-identity-content">
                <h2>
                  {identity.identity_type === 'instance_admin' ? '腐竹' : '玩家'}
                </h2>
                <p>{identity.instance_name || '未关联实例'}</p>
                {identity.is_default && (
                  <span className="select-identity-badge">默认身份</span>
                )}
              </div>
              <ArrowRight size={20} className="select-identity-arrow" />
            </button>
          ))}
        </div>

        <div className="select-identity-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
        </div>
      </div>
      {/* BUILD ID — 底部规范化 footer span（部署核对用） */}
      <footer className="app-footer-build">
          {getBuildFooterText()}
      </footer>
    </div>
  );
}
