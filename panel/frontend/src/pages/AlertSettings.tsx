// ============================================================================
// AlertSettings — 告警配置（v4.6.0-F4）
// 路径：/profile/alerts（所有已登录用户可见）
//
// 功能：
//   1. 邮箱通道卡片：显示当前邮箱 + 验证状态 + email_enabled 开关
//   2. Webhook 通道卡片：webhook_enabled 开关 + webhook_url 输入框 + 测试按钮
//   3. 订阅规则卡片：列出所有预置规则，每个规则一个复选框
//   4. 底部"保存"按钮：提交所有变更
//
// 数据来源：
//   - GET /api/alert-settings + GET /api/alert-settings/rules
//   - PUT /api/alert-settings
//   - POST /api/alert-settings/test-webhook
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import type {
  AlertSettings,
  AlertRule,
  AlertRuleType,
} from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../context/ToastContext';
import { ListSkeleton, SensitiveInput } from '../components/ui';

const SEVERITY_LABEL: Record<string, string> = {
  info: '信息',
  warning: '警告',
  critical: '严重',
};

function severityClass(severity: string): string {
  if (severity === 'critical' || severity === 'error') return 'badge badge-error';
  if (severity === 'warning') return 'badge badge-warning';
  return 'badge badge-running';
}

export default function AlertSettings() {
  const { api } = useAuth();
  const toast = useToast();
  useDocumentTitle('告警设置');

  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [email, setEmail] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 编辑态（本地暂存，点击保存才提交）
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [subscribedRules, setSubscribedRules] = useState<Set<AlertRuleType>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, rulesRes] = await Promise.all([
        api.getAlertSettings(),
        api.listAlertRules(),
      ]);
      setSettings(settingsRes.settings);
      setEmail(settingsRes.email);
      setEmailVerified(settingsRes.email_verified);
      setRules(rulesRes.rules);
      // 同步编辑态
      setEmailEnabled(settingsRes.settings.email_enabled);
      setWebhookEnabled(settingsRes.settings.webhook_enabled);
      setWebhookUrl(settingsRes.settings.webhook_url);
      setSubscribedRules(new Set(settingsRes.settings.subscribed_rules));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载告警设置失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleRule = (ruleType: AlertRuleType) => {
    setSubscribedRules((prev) => {
      const next = new Set(prev);
      if (next.has(ruleType)) next.delete(ruleType);
      else next.add(ruleType);
      return next;
    });
    setDirty(true);
  };

  const handleEmailEnabledChange = (value: boolean) => {
    if (value && !emailVerified) {
      toast.warning('请先验证邮箱后再启用邮箱通道');
      return;
    }
    setEmailEnabled(value);
    setDirty(true);
  };

  const handleWebhookEnabledChange = (value: boolean) => {
    setWebhookEnabled(value);
    setDirty(true);
  };

  const handleWebhookUrlChange = (value: string) => {
    setWebhookUrl(value);
    setDirty(true);
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.trim()) {
      toast.error('请先填写 Webhook URL');
      return;
    }
    setTestingWebhook(true);
    try {
      const res = await api.testAlertWebhook({ webhook_url: webhookUrl.trim() });
      if (res.success) {
        toast.success(res.message || 'Webhook 测试成功');
      } else {
        toast.error(res.message || 'Webhook 测试失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Webhook 测试失败');
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateAlertSettings({
        email_enabled: emailEnabled,
        webhook_enabled: webhookEnabled,
        webhook_url: webhookUrl,
        subscribed_rules: Array.from(subscribedRules),
      });
      setSettings(res.settings);
      setEmailEnabled(res.settings.email_enabled);
      setWebhookEnabled(res.settings.webhook_enabled);
      setWebhookUrl(res.settings.webhook_url);
      setSubscribedRules(new Set(res.settings.subscribed_rules));
      setDirty(false);
      toast.success('告警设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存告警设置失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">告警设置</h2>
        </div>
        <ListSkeleton rows={4} columns={2} />
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">告警设置</h2>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
              刷新
            </button>
          </div>
        </div>
        <div className="alert alert-error" role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              <RefreshCw size={14} /> 重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">告警设置</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              <RefreshCw size={14} /> 重试
            </button>
          </div>
        </div>
      )}

      {/* 邮箱通道卡片 */}
      <div className="info-card">
        <h3 className="card-title">邮箱通道</h3>
        <div className="info-row">
          <span className="info-label">当前邮箱</span>
          <span className="info-value mono">{email || '未设置'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">验证状态</span>
          <span className="info-value">
            {emailVerified ? (
              <span className="badge badge-running">已验证</span>
            ) : (
              <span className="badge badge-warning">未验证</span>
            )}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">启用邮箱通知</span>
          <span className="info-value">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: emailVerified ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => handleEmailEnabledChange(e.target.checked)}
                disabled={!emailVerified}
                aria-label="启用邮箱通知"
              />
              <span className="form-hint" style={{ margin: 0 }}>
                {emailVerified ? '接收告警邮件' : '请先验证邮箱'}
              </span>
            </label>
          </span>
        </div>
      </div>

      {/* Webhook 通道卡片 */}
      <div className="info-card">
        <h3 className="card-title">Webhook 通道</h3>
        <div className="info-row">
          <span className="info-label">启用 Webhook</span>
          <span className="info-value">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={webhookEnabled}
                onChange={(e) => handleWebhookEnabledChange(e.target.checked)}
                aria-label="启用 Webhook"
              />
              <span className="form-hint" style={{ margin: 0 }}>接收告警 Webhook 推送</span>
            </label>
          </span>
        </div>
        <label className="form-field">
          <span className="form-label">Webhook URL</span>
          <SensitiveInput
            value={webhookUrl}
            onChange={(v) => handleWebhookUrlChange(v)}
            placeholder="https://example.com/webhook"
            disabled={!webhookEnabled}
            revealable
          />
          <span className="form-hint">告警事件将通过 POST 请求推送到此地址</span>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleTestWebhook()}
            disabled={!webhookEnabled || !webhookUrl.trim() || testingWebhook}
          >
            {testingWebhook ? '测试中…' : '测试 Webhook'}
          </button>
        </div>
      </div>

      {/* 订阅规则卡片 */}
      <div className="info-card">
        <h3 className="card-title">订阅规则</h3>
        <p className="form-hint" style={{ marginBottom: 12 }}>
          选择要订阅的告警规则，未选中的规则不会向你发送通知
        </p>
        {rules.length === 0 ? (
          <p className="form-hint">暂无可用告警规则</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map((rule) => {
              const checked = subscribedRules.has(rule.type);
              return (
                <label
                  key={rule.type}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: 8,
                    border: '1px solid var(--color-border, #e5e7eb)',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRule(rule.type)}
                    aria-label={`订阅 ${rule.name}`}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span className="badge badge-stopped">{rule.type}</span>
                      <span className={severityClass(rule.severity)}>
                        {SEVERITY_LABEL[rule.severity] ?? rule.severity}
                      </span>
                    </div>
                    <div style={{ fontWeight: 500 }}>{rule.name}</div>
                    <div className="form-hint">{rule.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className="form-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
        >
          {saving ? '保存中…' : '保存设置'}
        </button>
        {dirty && <span className="form-hint">有未保存的更改</span>}
      </div>
    </div>
  );
}
