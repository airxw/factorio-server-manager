// ============================================================================
// SiteInfoStep — v4.20.0 Setup Wizard v2 Step 4: 站点信息 + 公网入口
//
// 职责：
//   - 站点名称输入（1-64 字符）
//   - 公网入口 URL 输入（PUBLIC_BASE_URL，写入 .env）
//   - 实时 HTTPS 校验：http:// 标 warn，https:// 标 ok
//
// 受控组件：siteName 与 publicBaseUrl 由父组件持有。
// ============================================================================

import { type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Globe, XCircle } from 'lucide-react';

export interface SiteInfoStepProps {
  /** 站点名称 */
  siteName: string;
  /** 公网入口 URL */
  publicBaseUrl: string;
  /** 修改站点名称 */
  onSiteNameChange: (name: string) => void;
  /** 修改公网入口 URL */
  onPublicBaseUrlChange: (url: string) => void;
}

/** 校验公网入口 URL：返回 { valid, protocol, message, level } */
export function validatePublicBaseUrl(url: string): {
  valid: boolean;
  protocol: 'http' | 'https' | null;
  message: string;
  level: 'ok' | 'warn' | 'error';
} {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      valid: false,
      protocol: null,
      message: '未配置（玩家无法通过域名访问，可在提交后通过 .env 补充）',
      level: 'warn',
    };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      protocol: null,
      message: 'URL 必须以 http:// 或 https:// 开头',
      level: 'error',
    };
  }
  const protocol = trimmed.toLowerCase().startsWith('https://') ? 'https' : 'http';
  if (protocol === 'http') {
    return {
      valid: true,
      protocol: 'http',
      message: 'HTTP 协议可用但不安全，生产环境建议使用 HTTPS',
      level: 'warn',
    };
  }
  return {
    valid: true,
    protocol: 'https',
    message: 'HTTPS 协议，安全可用',
    level: 'ok',
  };
}

export default function SiteInfoStep({
  siteName,
  publicBaseUrl,
  onSiteNameChange,
  onPublicBaseUrlChange,
}: SiteInfoStepProps) {
  const urlCheck = validatePublicBaseUrl(publicBaseUrl);
  const siteNameValid = siteName.trim().length > 0 && siteName.trim().length <= 64;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  return (
    <form className="setup-form" onSubmit={handleSubmit}>
      <div className="setup-admin-hint">
        <p>
          <Globe size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
          配置站点基本信息与玩家访问入口。
        </p>
        <p className="form-field-hint">
          站点名称显示在浏览器标题栏和登录页；公网入口用于玩家门户访问。
        </p>
      </div>

      <label className="form-field">
        <span className="form-label">站点名称 *</span>
        <input
          type="text"
          value={siteName}
          onChange={(e) => onSiteNameChange(e.target.value)}
          maxLength={64}
          required
          placeholder="例如：我的游戏服务器"
          autoFocus
        />
        <span className="form-field-hint">
          显示在浏览器标题栏和登录页（1-64 个字符）
        </span>
      </label>

      <label className="form-field">
        <span className="form-label">公网入口 URL（PUBLIC_BASE_URL）</span>
        <input
          type="text"
          value={publicBaseUrl}
          onChange={(e) => onPublicBaseUrlChange(e.target.value)}
          maxLength={255}
          placeholder="https://gsp.ecsrz.com:3001"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="form-field-hint">
          玩家访问面板的完整 URL。留空可后续通过 .env 补充并重启生效。
        </span>
      </label>

      {/* 公网入口校验结果 */}
      {publicBaseUrl.trim() && (
        <div
          className={`preflight-item preflight-item-${urlCheck.level === 'ok' ? 'ok' : urlCheck.level === 'warn' ? 'warn' : 'error'}`}
          style={{ marginBottom: 12 }}
        >
          <div className="preflight-item-icon">
            {urlCheck.level === 'ok' ? (
              <CheckCircle2 size={18} className="preflight-icon-ok" />
            ) : urlCheck.level === 'warn' ? (
              <AlertTriangle size={18} className="preflight-icon-warn" />
            ) : (
              <XCircle size={18} className="preflight-icon-error" />
            )}
          </div>
          <div className="preflight-item-body">
            <div className="preflight-item-label">
              {urlCheck.protocol ? `${urlCheck.protocol.toUpperCase()} 协议` : '格式错误'}
            </div>
            <div className="preflight-item-detail">{urlCheck.message}</div>
          </div>
        </div>
      )}

      {/* 隐藏 valid 标记供父组件读取（通过 onPublicBaseUrlChange 已传递） */}
      <input type="hidden" data-site-valid={siteNameValid ? '1' : '0'} />
    </form>
  );
}
