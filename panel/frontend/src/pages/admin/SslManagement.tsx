// ============================================================================
// SslManagement — SSL 证书管理（I1，v4.4.0-L1）
// 后端：/api/system/ssl 5 个端点
//   GET  /api/system/ssl             — 获取当前证书信息
//   POST /api/system/ssl/reload      — 触发 nginx 热重载（不替换证书文件）
//   POST /api/system/ssl/stage       — 暂存上传的证书（PEM + KEY）
//   POST /api/system/ssl/deploy      — 部署暂存证书到 nginx 路径 + 热重载
//   POST /api/system/ssl/self-signed — 生成自签证书（仅写入暂存目录）
//
// 三大区块：
//   1. 当前证书信息卡（CN/签发者/SAN/有效期/指纹 + 剩余天数徽章）
//   2. 证书操作区（热重载 / 上传新证书 / 生成自签证书）
//   3. 暂存证书区（展示暂存证书列表 + 部署按钮）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Coffee,
  FileUp,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Zap,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type {
  CertificateInfo,
  DeployCertificateRequest,
  GenerateSelfSignedRequest,
  StageCertificateRequest,
} from '../../api/modules/system';
import { Modal, SensitiveInput, useDestructiveAction, useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

/** 剩余天数徽章颜色：>30 绿 / <30 黄 / <7 红 / 已过期 红 */
function daysRemainingBadge(days: number | null): { text: string; color: string } {
  if (days === null) return { text: '未知', color: '#6b7280' };
  if (days < 0) return { text: '已过期', color: '#dc2626' };
  if (days < 7) return { text: `${days} 天`, color: '#dc2626' };
  if (days < 30) return { text: `${days} 天`, color: '#d97706' };
  return { text: `${days} 天`, color: '#16a34a' };
}

interface InfoRowProps {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}

function InfoRow({ label, value, mono }: InfoRowProps) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <span
        style={{
          minWidth: 100,
          color: 'var(--color-text-secondary, #6b7280)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ wordBreak: 'break-all', fontFamily: mono ? 'monospace' : undefined }}>
        {value || <span style={{ color: '#9ca3af' }}>—</span>}
      </span>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--color-bg-primary, #fff)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 15,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
};

export default function SslManagement() {
  const { api, user } = useAuth();
  const toast = useToast();

  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 暂存证书（仅记录最后一次 stage / self-signed 的结果）
  const [staged, setStaged] = useState<{
    cert_path: string;
    key_path: string;
    source: 'upload' | 'self-signed';
    /** 上传来源保留 pem_content，用于部署预览（指纹对比）；自签来源为 null */
    pem_content: string | null;
  } | null>(null);

  // 「热重载 nginx」确认模态
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);

  // 「上传新证书」表单
  const [uploadForm, setUploadForm] = useState<StageCertificateRequest>({
    pem_content: '',
    key_content: '',
  });
  const [uploadBusy, setUploadBusy] = useState(false);

  // 「生成自签证书」表单
  const [selfSignedForm, setSelfSignedForm] = useState<{
    common_name: string;
    sanInput: string;
    days: number;
    organization: string;
  }>({
    common_name: '',
    sanInput: '',
    days: 365,
    organization: '',
  });
  const [selfSignedBusy, setSelfSignedBusy] = useState(false);

  // 「部署暂存证书」确认模态
  const [deployBusy, setDeployBusy] = useState(false);

  const loadCertInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSslCertInfo();
      setCertInfo(res.certificate);
    } catch (err) {
      if (err instanceof PanelApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '加载证书信息失败');
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCertInfo();
  }, [loadCertInfo]);

  const handleReload = useCallback(async () => {
    setReloadBusy(true);
    try {
      const res = await api.reloadNginx();
      if (res.success) {
        toast.success(`nginx 热重载成功：${res.message}`);
      } else {
        toast.error('nginx 热重载失败', res.message);
      }
      setReloadConfirmOpen(false);
    } catch (err) {
      toast.error('nginx 热重载失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setReloadBusy(false);
    }
  }, [api, toast]);

  const handleStageUpload = useCallback(async () => {
    if (!uploadForm.pem_content.trim() || !uploadForm.key_content.trim()) {
      toast.warning('请填写 PEM 证书与私钥内容');
      return;
    }
    setUploadBusy(true);
    try {
      const res = await api.stageCertificate(uploadForm);
      setStaged({
        cert_path: res.cert_path,
        key_path: res.key_path,
        source: 'upload',
        pem_content: uploadForm.pem_content,
      });
      toast.success('证书已暂存，可点击「部署」按钮部署到 nginx');
    } catch (err) {
      toast.error('暂存证书失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setUploadBusy(false);
    }
  }, [api, uploadForm, toast]);

  const handleGenerateSelfSigned = useCallback(async () => {
    if (!selfSignedForm.common_name.trim()) {
      toast.warning('请填写 Common Name (CN)');
      return;
    }
    const sanDomains = selfSignedForm.sanInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sanDomains.length === 0) {
      toast.warning('请至少填写一个 SAN 域名/IP');
      return;
    }
    const req: GenerateSelfSignedRequest = {
      common_name: selfSignedForm.common_name.trim(),
      san_domains: sanDomains,
      days: selfSignedForm.days > 0 ? selfSignedForm.days : 365,
    };
    if (selfSignedForm.organization.trim()) {
      req.organization = selfSignedForm.organization.trim();
    }
    setSelfSignedBusy(true);
    try {
      const res = await api.generateSelfSignedCert(req);
      setStaged({
        cert_path: res.cert_path,
        key_path: res.key_path,
        source: 'self-signed',
        pem_content: null,
      });
      toast.success('自签证书已生成，可点击「部署」按钮部署到 nginx');
    } catch (err) {
      toast.error('生成自签证书失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSelfSignedBusy(false);
    }
  }, [api, selfSignedForm, toast]);

  // B2: 破坏性操作统一 hook —— SSL 部署（含 dry-run 预览 + 失败回滚）
  const deployAction = useDestructiveAction<
    import('../../api/modules/system').DeployPreviewResponse | null,
    DeployCertificateRequest
  >({
    preview: async () => {
      // 仅 upload 来源能拿到 pem_content 进行指纹对比；self-signed 返回 null（走默认提示）
      if (!staged || !staged.pem_content) return null;
      return api.previewSslDeploy({ pem_content: staged.pem_content });
    },
    execute: async (req) => {
      const res = await api.deployStagedCertificate(req);
      if (!res.success) {
        throw new Error(res.message);
      }
    },
    rollback: async () => {
      // 部署失败时自动尝试回滚到上一份备份
      await api.rollbackSslCertificate();
    },
  });

  const handleDeployStaged = useCallback(async () => {
    if (!staged) return;
    const req: DeployCertificateRequest = {
      cert_path: staged.cert_path,
      key_path: staged.key_path,
    };
    setDeployBusy(true);
    try {
      const ok = await deployAction.run(req, {
        title: '确认部署暂存证书到 nginx',
        message:
          '将暂存证书部署到 nginx 路径并触发热重载。此操作不可逆，部署失败时将自动尝试回滚到上一份备份。',
        confirmText: '确认部署',
        formatPreview: (preview) => {
          if (preview === null) {
            return '⚠️ 自签证书无法预览指纹对比（前端无 PEM 内容），请直接确认。';
          }
          const p = preview as import('../../api/modules/system').DeployPreviewResponse;
          const lines: string[] = [];
          lines.push(`当前证书指纹：${p.current_fingerprint ?? '（无证书）'}`);
          lines.push(`新证书指纹：${p.new_fingerprint ?? '（解析失败）'}`);
          lines.push(`nginx -t 校验：${p.nginx_config_valid ? '✓ 通过' : '✗ 失败'}`);
          if (p.errors) {
            lines.push(`错误信息：${p.errors}`);
          }
          return lines.join('\n');
        },
      });
      if (ok) {
        toast.success('部署成功');
        setStaged(null);
        await loadCertInfo();
      }
    } finally {
      setDeployBusy(false);
    }
  }, [staged, deployAction, toast, loadCertInfo]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  const daysBadge = certInfo ? daysRemainingBadge(certInfo.days_remaining) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>
            <ShieldCheck size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            SSL 证书管理
          </h2>
          <p className="page-description">
            管理 nginx 使用的 TLS 证书——查看当前证书、热重载、上传新证书、生成自签证书
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void loadCertInfo()}
            disabled={loading}
          >
            <RefreshCw size={14} />
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* 1. 当前证书信息卡 */}
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <h3 style={sectionTitleStyle}>
          <ShieldCheck size={16} />
          当前证书信息
        </h3>
        {loading && !certInfo ? (
          <div className="empty-state">加载中…</div>
        ) : !certInfo ? (
          <div className="empty-state">暂无证书信息</div>
        ) : !certInfo.available ? (
          <div className="alert alert-warning">
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            证书文件不可读或不存在——请上传证书或生成自签证书
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 12 }}>
              <span
                className="badge"
                style={{
                  background: daysBadge?.color,
                  color: '#fff',
                  fontSize: 12,
                  padding: '2px 8px',
                }}
              >
                剩余 {daysBadge?.text}
              </span>
              {certInfo.self_signed && (
                <span
                  className="badge"
                  style={{
                    background: '#9ca3af',
                    color: '#fff',
                    fontSize: 12,
                    padding: '2px 8px',
                    marginLeft: 6,
                  }}
                >
                  自签名
                </span>
              )}
            </div>
            <InfoRow label="主题 CN" value={certInfo.subject_cn} mono />
            <InfoRow label="签发者 CN" value={certInfo.issuer_cn} mono />
            <InfoRow
              label="SAN 域名"
              value={
                certInfo.san_domains.length > 0 ? certInfo.san_domains.join(', ') : null
              }
              mono
            />
            <InfoRow label="有效期起" value={certInfo.valid_from} mono />
            <InfoRow label="有效期止" value={certInfo.valid_to} mono />
            <InfoRow label="指纹 SHA-256" value={certInfo.fingerprint} mono />
            <InfoRow label="证书路径" value={certInfo.cert_path} mono />
            <InfoRow label="密钥路径" value={certInfo.key_path} mono />
          </div>
        )}
      </div>

      {/* 2. 证书操作区 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* 2.1 热重载 nginx */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>
            <Zap size={16} />
            热重载 nginx
          </h3>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            触发 nginx 配置重载，不替换证书文件。适用于手动修改 nginx 配置后生效。
          </p>
          <button
            className="btn btn-warning"
            onClick={() => setReloadConfirmOpen(true)}
          >
            <Zap size={14} />
            热重载 nginx
          </button>
        </div>

        {/* 2.2 上传新证书 */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>
            <FileUp size={16} />
            上传新证书
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>
              PEM 证书内容（fullchain）
            </label>
            <SensitiveInput
              value={uploadForm.pem_content}
              onChange={(v) =>
                setUploadForm((prev) => ({ ...prev, pem_content: v }))
              }
              multiline
              rows={8}
              placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            />
            <label style={{ fontSize: 13, fontWeight: 500 }}>私钥内容（KEY）</label>
            <SensitiveInput
              value={uploadForm.key_content}
              onChange={(v) =>
                setUploadForm((prev) => ({ ...prev, key_content: v }))
              }
              multiline
              rows={8}
              placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
            />
            <button
              className="btn btn-primary"
              onClick={() => void handleStageUpload()}
              disabled={uploadBusy}
            >
              <Upload size={14} />
              {uploadBusy ? '暂存中…' : '暂存证书'}
            </button>
            <p className="form-hint">
              暂存后需在「暂存证书区」点击「部署到 nginx」生效
            </p>
          </div>
        </div>

        {/* 2.3 生成自签证书 */}
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>
            <ShieldAlert size={16} />
            生成自签证书
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>Common Name (CN)</label>
            <input
              type="text"
              style={inputStyle}
              value={selfSignedForm.common_name}
              onChange={(e) =>
                setSelfSignedForm((prev) => ({ ...prev, common_name: e.target.value }))
              }
              placeholder="gsp.ecsrz.com"
            />
            <label style={{ fontSize: 13, fontWeight: 500 }}>
              SAN 域名/IP（逗号或空格分隔）
            </label>
            <input
              type="text"
              style={inputStyle}
              value={selfSignedForm.sanInput}
              onChange={(e) =>
                setSelfSignedForm((prev) => ({ ...prev, sanInput: e.target.value }))
              }
              placeholder="gsp.ecsrz.com, 192.168.5.14"
            />
            <label style={{ fontSize: 13, fontWeight: 500 }}>有效天数</label>
            <input
              type="number"
              style={inputStyle}
              value={selfSignedForm.days}
              min={1}
              max={3650}
              onChange={(e) =>
                setSelfSignedForm((prev) => ({
                  ...prev,
                  days: parseInt(e.target.value, 10) || 365,
                }))
              }
            />
            <label style={{ fontSize: 13, fontWeight: 500 }}>组织名 O（可选）</label>
            <input
              type="text"
              style={inputStyle}
              value={selfSignedForm.organization}
              onChange={(e) =>
                setSelfSignedForm((prev) => ({ ...prev, organization: e.target.value }))
              }
              placeholder="GameServer Panel"
            />
            <button
              className="btn btn-primary"
              onClick={() => void handleGenerateSelfSigned()}
              disabled={selfSignedBusy}
            >
              <Plus size={14} />
              {selfSignedBusy ? '生成中…' : '生成自签证书'}
            </button>
            <p className="form-hint">仅生成到暂存目录，需在「暂存证书区」部署生效</p>
          </div>
        </div>
      </div>

      {/* 3. 暂存证书区 */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <Coffee size={16} />
          暂存证书
        </h3>
        {!staged ? (
          <div className="empty-state">暂无暂存证书——上传或生成后在此展示</div>
        ) : (
          <div>
            <div className="alert alert-info" style={{ marginBottom: 12 }}>
              来源：{staged.source === 'upload' ? '上传' : '自签生成'}
            </div>
            <InfoRow label="证书路径" value={staged.cert_path} mono />
            <InfoRow label="私钥路径" value={staged.key_path} mono />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={() => void handleDeployStaged()}
                disabled={deployBusy}
              >
                <Upload size={14} />
                {deployBusy ? '部署中…' : '部署到 nginx'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setStaged(null)}
              >
                丢弃暂存
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 热重载确认模态 */}
      <Modal
        open={reloadConfirmOpen}
        title="确认热重载 nginx"
        onClose={() => !reloadBusy && setReloadConfirmOpen(false)}
        disableClose={reloadBusy}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setReloadConfirmOpen(false)}
              disabled={reloadBusy}
            >
              取消
            </button>
            <button
              className="btn btn-warning"
              onClick={() => void handleReload()}
              disabled={reloadBusy}
            >
              {reloadBusy ? '重载中…' : '确认重载'}
            </button>
          </>
        }
      >
        <p>此操作会执行 <code>nginx -s reload</code>，期间 HTTPS 服务可能短暂中断。</p>
      </Modal>

      {/* 部署确认弹窗已迁移至 useDestructiveAction + ConfirmDialog（全局 ConfirmProvider 渲染） */}
    </div>
  );
}
