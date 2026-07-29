// ============================================================================
// MaintenanceMode — 维护模式提示页面 (v3.9.0-S8)
// 后端开启 maintenance.enabled 后所有非管理员 API 返回 503 + MAINTENANCE_MODE
// 前端 API client 检测到 503 自动跳转到本页面
//
// 页面行为：
//   - 挂载时拉取 /api/settings/site-info（公开接口）展示站点名称
//   - 拉取 /api/legal/maintenance-message 不存在时使用默认提示
//   - 提供「管理员登录」按钮跳转 /login（管理员可登录后关闭维护模式）
//   - 提供「重试」按钮让用户在维护结束后主动恢复
// ============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createApiClient } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function MaintenanceMode() {
  useDocumentTitle('系统维护中');
  // 匿名客户端（无 token），用于拉取公开接口
  const api = createApiClient({ token: null });
  const [siteName, setSiteName] = useState<string>('GameServer Panel');
  const [announcement, setAnnouncement] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // site-info 是公开接口，维护期间仍可访问
        const info = await api.getSiteInfo();
        if (cancelled) return;
        setSiteName(info.name || 'GameServer Panel');
        setAnnouncement(info.announcement || '');
      } catch {
        // 拉取失败时使用默认值
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background:
          'linear-gradient(135deg, var(--color-bg, #f5f7fa) 0%, var(--color-bg-alt, #e8ecf0) 100%)',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          padding: '40px 32px',
          background: 'var(--color-surface, #fff)',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 64, marginBottom: 16 }} aria-hidden>
          🔧
        </div>
        <h1
          className="page-title"
          style={{ fontSize: 28, marginBottom: 8, marginTop: 0 }}
        >
          {siteName} 维护中
        </h1>
        <p
          className="form-hint"
          style={{ fontSize: 16, marginBottom: 24, lineHeight: 1.6 }}
        >
          系统正在进行维护，暂时无法访问。
          <br />
          请稍后再试，或联系管理员了解详情。
        </p>
        {announcement ? (
          <div
            style={{
              padding: 12,
              marginBottom: 24,
              background: 'var(--color-bg-alt, #f5f7fa)',
              borderRadius: 8,
              fontSize: 14,
              color: 'var(--color-text-muted, #666)',
            }}
          >
            {announcement}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
          <Link to="/login" className="btn btn-primary">
            管理员登录
          </Link>
        </div>
      </div>
    </div>
  );
}
