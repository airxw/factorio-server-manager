// ============================================================================
// ServerDetailGuild — v4.15.2 权限修复（移除运维tab嵌入）
// 路由：/guild/servers/:id
// 门控：user+（任何登录用户）
// 承载：沉浸式店铺 Banner + 账号绑定 + 商品列表
// 信息架构：C 端电商导向，强调商品浏览与消费，屏蔽所有运维信息
//
// v4.15.2: 移除 ServerDetail 组件嵌入——普通用户不应看到 RCON 控制台/日志文件/命令帮助等运维 tab
// 视觉：gp-shop-hero 沉浸式 Banner（banner_url 或主题色渐变 + 暗化遮罩 + 实例名/状态叠加）
//       AccountBindingCard / ShopItemList 消费 gp-* 体系，主题色 CTA 保留服主品牌
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Gamepad2, Lock, Send, ShieldX } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast } from '../../components/ui';
import type {
  InstanceShopConfig,
  Binding,
  ServerDetailResponse,
  ServerSummary,
} from '@public/schema/panel-api-types';
import { AccountBindingCard } from './components/AccountBindingCard';
import { ShopItemList } from './components/ShopItemList';

/** 默认主题色（服主未配置时使用 Apple 蓝） */
const DEFAULT_THEME_COLOR = '#0A84FF';

const STATE_LABEL: Record<string, string> = {
  running: '在线',
  stopped: '离线',
  starting: '启动中',
  stopping: '停止中',
  error: '异常',
};

/** 403 详情（私有实例访问被拒时后端在 error.details 内附带） */
interface ForbiddenDetails {
  can_request_binding?: boolean;
  binding_requests_enabled?: boolean;
  is_public?: boolean;
}

export default function ServerDetailGuild() {
  const { id } = useParams<{ id: string }>();
  const { api } = useAuth();
  const toast = useToast();
  const [shopConfig, setShopConfig] = useState<InstanceShopConfig | null>(null);
  const [server, setServer] = useState<ServerSummary | null>(null);
  const [currentBinding, setCurrentBinding] = useState<Binding | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  // v4.38.0: 403 详情（用于展示"申请绑定"按钮）
  const [forbiddenDetails, setForbiddenDetails] = useState<ForbiddenDetails | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  const handleBindingChange = useCallback((binding: Binding | null) => {
    setCurrentBinding(binding);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    setForbiddenDetails(null);
    // 并行拉取店铺配置 + 实例摘要（实例名/状态用于 Banner 叠加层）
    Promise.all([
      api.getInstanceShopConfig(id).catch((err) => {
        if (!cancelled) {
          // v4.15.2: 对 403 错误显示友好提示
          if (err instanceof PanelApiError && err.code === 'PANEL_FORBIDDEN') {
            setConfigError('您无权访问该实例');
            // v4.38.0: 提取 error.details 中的 can_request_binding / binding_requests_enabled
            if (err.details) {
              setForbiddenDetails(err.details as ForbiddenDetails);
            }
          } else {
            const msg = err instanceof PanelApiError ? err.message : '店铺配置加载失败';
            setConfigError(msg);
          }
        }
        return null;
      }),
      api.getServer(id).catch(() => null),
    ])
      .then(([configRes, serverRes]) => {
        if (cancelled) return;
        if (configRes) setShopConfig(configRes.config);
        if (serverRes) setServer((serverRes as ServerDetailResponse).server);
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  // 动态主题色：通过 CSS 变量注入到当前页面根容器
  const themeColor = shopConfig?.shop_theme_color || DEFAULT_THEME_COLOR;

  // v4.15.3: API 403 时（用户无权访问该实例）——不渲染任何功能卡片，仅显示友好提示
  // 这是系统层面的权限错误（非"先显示再提示"），完全隐藏子项而非显示错误
  const isForbidden = configError === '您无权访问该实例';

  // v4.38.0: 申请绑定（私有实例 + 服主开启申请通道时可用）
  const handleApplyBind = async () => {
    if (!id) return;
    setApplyBusy(true);
    try {
      await api.createBindingApplication(id);
      toast.success('已提交申请，请等待服主审批');
      // 申请成功后刷新详情（仍会 403，但 details.can_request_binding 会变 false）
      setForbiddenDetails((prev) =>
        prev ? { ...prev, can_request_binding: false } : prev,
      );
    } catch (err) {
      const code = err instanceof PanelApiError ? err.code : '';
      if (code === 'BINDING_REQUEST_ALREADY_PENDING') {
        toast.info('已存在待审批的申请，请等待服主处理');
      } else if (code === 'BINDING_REQUEST_ALREADY_BOUND') {
        toast.info('已绑定该实例');
      } else if (code === 'BINDING_REQUEST_DISABLED') {
        toast.error('该实例已关闭申请通道');
        setForbiddenDetails((prev) =>
          prev ? { ...prev, can_request_binding: false, binding_requests_enabled: false } : prev,
        );
      } else {
        toast.error(err instanceof PanelApiError ? err.message : '提交申请失败');
      }
    } finally {
      setApplyBusy(false);
    }
  };

  if (isForbidden && !configLoading) {
    // v4.38.0: 根据 forbiddenDetails 渲染不同状态
    const canRequest = forbiddenDetails?.can_request_binding === true;
    const requestsEnabled = forbiddenDetails?.binding_requests_enabled === true;
    return (
      <div
        className="guild-server-detail-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
          paddingTop: 60,
          paddingInline: 20,
        }}
      >
        {canRequest ? (
          <>
            <Lock size={48} style={{ color: 'var(--gp-amber, #FF9500)' }} />
            <p
              style={{
                fontSize: 16,
                color: 'var(--gp-text-secondary, #424245)',
                margin: 0,
                fontWeight: 600,
              }}
            >
              该实例为私有实例
            </p>
            <p
              style={{
                fontSize: 13,
                color: 'var(--gp-text-faint, #86868B)',
                margin: 0,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              需要服主审批通过后才能访问。提交绑定申请并等待服主处理。
            </p>
            <button
              type="button"
              className="gp-btn gp-btn-primary"
              style={{ marginTop: 8, padding: '10px 22px', fontSize: 13 }}
              onClick={() => void handleApplyBind()}
              disabled={applyBusy}
            >
              <Send size={13} /> {applyBusy ? '提交中…' : '提交绑定申请'}
            </button>
          </>
        ) : requestsEnabled ? (
          // can_request_binding=false 但 requestsEnabled=true：通常意味着已提交过 pending 申请
          // （后端 403 时 is_public=false + requestsEnabled=true，但用户已有 pending）
          <>
            <ShieldX size={48} style={{ color: 'var(--gp-amber, #FF9500)' }} />
            <p
              style={{
                fontSize: 16,
                color: 'var(--gp-text-secondary, #424245)',
                margin: 0,
                fontWeight: 600,
              }}
            >
              您无权访问该实例
            </p>
            <p
              style={{
                fontSize: 13,
                color: 'var(--gp-text-faint, #86868B)',
                margin: 0,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              您的绑定申请正在等待服主审批，请耐心等候。
            </p>
          </>
        ) : (
          <>
            <Gamepad2 size={48} style={{ color: 'var(--gp-text-dim, #86868B)' }} />
            <p
              style={{
                fontSize: 16,
                color: 'var(--gp-text-secondary, #424245)',
                margin: 0,
                fontWeight: 600,
              }}
            >
              您无权访问该实例
            </p>
            <p
              style={{
                fontSize: 13,
                color: 'var(--gp-text-faint, #86868B)',
                margin: 0,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              该实例未开放绑定申请通道，请联系服主或管理员。
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="guild-server-detail-container"
      style={
        {
          // CSS 变量，子组件可通过 var(--shop-theme-color) 引用
          ['--shop-theme-color' as string]: themeColor,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        } as React.CSSProperties
      }
    >
      {/* 沉浸式店铺 Banner（主题色融合霓虹体系） */}
      <ShopHeader
        config={shopConfig}
        server={server}
        loading={configLoading}
        error={configError}
      />

      {/* v4.15.3: 仅在有权限时渲染功能卡片（isForbidden 时不渲染） */}
      {id && !isForbidden && (
        <AccountBindingCard serverId={id} onBindingChange={handleBindingChange} />
      )}

      {/* 商品列表卡片流（品质发光描边 + 主题色 CTA） */}
      {id && !isForbidden && (
        <ShopItemList serverId={id} currentBinding={currentBinding} />
      )}
    </div>
  );
}

/** 沉浸式店铺头部：Banner 图片/主题色渐变 + 暗化遮罩 + 实例名/状态叠加 */
function ShopHeader({
  config,
  server,
  loading,
  error,
}: {
  config: InstanceShopConfig | null;
  server: ServerSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <div className="gp-skeleton" style={{ height: 200 }} />;
  }

  const bannerUrl = config?.banner_url;
  const bannerLink = config?.banner_link;
  const description = config?.shop_description;
  const isOnline = server?.status === 'running';

  const heroInner = (
    <>
      {bannerUrl ? (
        <img
          src={bannerUrl}
          alt="店铺 Banner"
          onError={(e) => {
            // Banner 加载失败时切换为主题色渐变兜底
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <div className="gp-shop-hero-fallback" style={bannerUrl ? { opacity: 0 } : undefined} />
      <div className="gp-shop-hero-shade" />
      <div className="gp-shop-hero-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="gp-badge gp-badge-violet">
            <Gamepad2 size={11} />
            {server?.game_type ?? '游戏服务器'}
          </span>
          {server && (
            <span className="gp-badge" style={{ gap: 6 }}>
              <span className={`gp-dot ${isOnline ? 'gp-dot-online' : 'gp-dot-offline'}`} />
              {STATE_LABEL[server.status] ?? server.status}
            </span>
          )}
        </div>
        <h1 className="gp-shop-hero-title">{server?.name ?? '店铺首页'}</h1>
        {description && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'rgba(236, 234, 246, 0.78)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              textShadow: '0 1px 8px rgba(3, 5, 14, 0.7)',
            }}
          >
            {description}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div>
      {bannerUrl && bannerLink ? (
        <a href={bannerLink} target="_blank" rel="noopener noreferrer" className="gp-shop-hero" style={{ display: 'block' }}>
          {heroInner}
        </a>
      ) : (
        <div className="gp-shop-hero">{heroInner}</div>
      )}
      {error && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--gp-amber)' }}>
          店铺配置加载失败: {error}
        </p>
      )}
    </div>
  );
}
