// ============================================================================
// VoteSettings — 投票设置管理（仅 admin/system_admin 可见）
// 受控组件：serverId 由父组件传入，不再自管理服务器下拉
// 表单：enabled / threshold / duration_seconds / reason_prefix
//       + trigger_keywords / cooldown_seconds / target_cooldown_seconds
//       + admin_immune / vip_immune_min_level
// 保存：upsertVoteSettings
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  UpsertVoteSettingsRequest,
  VoteSettingsSummary,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

interface FormState {
  enabled: boolean;
  threshold: string;
  duration_seconds: string;
  reason_prefix: string;
  trigger_keywords: string;
  cooldown_seconds: string;
  target_cooldown_seconds: string;
  admin_immune: boolean;
  vip_immune_min_level: string;
}

const DEFAULT_FORM: FormState = {
  enabled: false,
  threshold: '3',
  duration_seconds: '60',
  reason_prefix: '[VoteKick]',
  trigger_keywords: '!vk',
  cooldown_seconds: '60',
  target_cooldown_seconds: '300',
  admin_immune: true,
  vip_immune_min_level: '0',
};

function toFormState(settings: VoteSettingsSummary): FormState {
  return {
    enabled: settings.enabled,
    threshold: String(settings.threshold),
    duration_seconds: String(settings.duration_seconds),
    reason_prefix: settings.reason_prefix,
    trigger_keywords: (settings.trigger_keywords ?? ['!vk']).join(', '),
    cooldown_seconds: String(settings.cooldown_seconds ?? 60),
    target_cooldown_seconds: String(settings.target_cooldown_seconds ?? 300),
    admin_immune: settings.admin_immune ?? true,
    vip_immune_min_level: String(settings.vip_immune_min_level ?? 0),
  };
}

export default function VoteSettings({ serverId }: { serverId: string }) {
  const { api, user } = useAuth();

  const [settings, setSettings] = useState<VoteSettingsSummary | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      setSuccessMsg(null);
      try {
        const res = await api.getVoteSettings(id);
        setSettings(res.settings);
        setForm(toFormState(res.settings));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载投票设置失败');
        setSettings(null);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadSettings(serverId);
  }, [serverId, loadSettings]);

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);

    const thresholdNum = Number(form.threshold);
    if (!Number.isInteger(thresholdNum) || thresholdNum < 1) {
      setError('通过阈值需为正整数');
      return;
    }
    const durationNum = Number(form.duration_seconds);
    if (!Number.isInteger(durationNum) || durationNum < 1) {
      setError('持续时间需为正整数（秒）');
      return;
    }
    const reasonPrefix = form.reason_prefix.trim();
    if (!reasonPrefix) {
      setError('请填写原因前缀');
      return;
    }

    const keywords = form.trigger_keywords
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (keywords.length === 0) {
      setError('请至少填写一个触发关键词');
      return;
    }

    const cooldownNum = Number(form.cooldown_seconds);
    const targetCooldownNum = Number(form.target_cooldown_seconds);
    const vipImmuneNum = Number(form.vip_immune_min_level);

    setSaving(true);
    try {
      const req: UpsertVoteSettingsRequest = {
        enabled: form.enabled,
        threshold: thresholdNum,
        duration_seconds: durationNum,
        reason_prefix: reasonPrefix,
        trigger_keywords: keywords,
        cooldown_seconds: cooldownNum,
        target_cooldown_seconds: targetCooldownNum,
        admin_immune: form.admin_immune,
        vip_immune_min_level: vipImmuneNum,
      };
      const res = await api.upsertVoteSettings(serverId, req);
      setSettings(res.settings);
      setForm(toFormState(res.settings));
      setSuccessMsg('保存成功');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">投票踢人设置</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void loadSettings(serverId)}
            disabled={dataLoading}
          >
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {dataLoading ? (
        <div className="empty-state">加载中…</div>
      ) : (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <h3 className="card-title">
            {settings ? `编辑设置 (${settings.server_id})` : '新建设置'}
          </h3>

          <label className="form-checkbox-label">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            <span className="checkbox-label-text">
              启用投票踢人
              <small className="checkbox-label-desc">开启后玩家可在游戏内使用 !vk 命令发起投票</small>
            </span>
          </label>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">通过阈值（yes 票数）*</span>
              <input
                type="number"
                min={1}
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">持续时间（秒）*</span>
              <input
                type="number"
                min={1}
                value={form.duration_seconds}
                onChange={(e) => setForm((f) => ({ ...f, duration_seconds: e.target.value }))}
                required
              />
            </label>
          </div>

          <label className="form-field">
            <span className="form-label">原因前缀 *</span>
            <input
              type="text"
              value={form.reason_prefix}
              onChange={(e) => setForm((f) => ({ ...f, reason_prefix: e.target.value }))}
              placeholder="[VoteKick]"
              required
            />
            <span className="form-hint">投票发起时展示在 reason 前的前缀</span>
          </label>

          <label className="form-field">
            <span className="form-label">触发关键词</span>
            <input
              type="text"
              value={form.trigger_keywords}
              onChange={(e) => setForm((f) => ({ ...f, trigger_keywords: e.target.value }))}
              placeholder="!vk"
            />
            <span className="form-hint">逗号分隔，如 !vk,投票踢人,vk</span>
          </label>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">发起人冷却（秒）</span>
              <input
                type="number"
                min={0}
                value={form.cooldown_seconds}
                onChange={(e) => setForm((f) => ({ ...f, cooldown_seconds: e.target.value }))}
              />
            </label>
            <label className="form-field">
              <span className="form-label">目标冷却（秒）</span>
              <input
                type="number"
                min={0}
                value={form.target_cooldown_seconds}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    target_cooldown_seconds: e.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="form-row">
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={form.admin_immune}
                onChange={(e) => setForm((f) => ({ ...f, admin_immune: e.target.checked }))}
              />
              <span className="checkbox-label-text">
                管理员免疫
                <small className="checkbox-label-desc">开启后管理员不能被投票踢出</small>
              </span>
            </label>
            <label className="form-field">
              <span className="form-label">VIP 免疫最低等级</span>
              <input
                type="number"
                min={0}
                max={5}
                value={form.vip_immune_min_level}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    vip_immune_min_level: e.target.value,
                  }))
                }
              />
              <span className="form-hint">VIP 等级 ≥ 此值时免疫踢出（0=不免疫）</span>
            </label>
          </div>

          {settings && <div className="form-hint">最后更新：{settings.updated_at}</div>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
