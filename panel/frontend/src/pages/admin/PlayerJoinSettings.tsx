// ============================================================================
// PlayerJoinSettings — 玩家加入设置管理（仅 admin/system_admin 可见）
// 受控组件：serverId 由父组件传入，不再自管理服务器下拉
// 表单：
//   - 欢迎消息 / 离开消息
//   - 入服礼包（gift_enabled / gift_item / gift_count / gift_quality）
//   - P3 回归礼包（relogin_gift_enabled / relogin_gift_items / cooldown / daily / total）
//   - P4 VIP 专属欢迎语（vip_welcome_messages）
// 保存：upsertPlayerJoinSettings
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type {
  PackItemSummary,
  PlayerJoinSettingsSummary,
  ReloginGiftItem,
  UpsertPlayerJoinSettingsRequest,
  VipWelcomeMessage,
} from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

const QUALITY_OPTIONS = ['normal', 'uncommon', 'rare', 'epic', 'legendary'] as const;
type GiftQuality = (typeof QUALITY_OPTIONS)[number];

interface FormState {
  welcome_message: string;
  gift_enabled: boolean;
  gift_item: string;
  gift_count: string;
  gift_quality: GiftQuality | '';
  leave_message: string;
  // P3 回归礼包
  relogin_gift_enabled: boolean;
  relogin_gift_items: ReloginGiftItem[];
  relogin_cooldown_hours: string;
  relogin_daily_limit: string;
  relogin_total_limit: string;
  // P4 VIP 欢迎语
  vip_welcome_messages: VipWelcomeMessage[];
}

const EMPTY_FORM: FormState = {
  welcome_message: '',
  gift_enabled: false,
  gift_item: '',
  gift_count: '',
  gift_quality: '',
  leave_message: '',
  relogin_gift_enabled: false,
  relogin_gift_items: [],
  relogin_cooldown_hours: '24',
  relogin_daily_limit: '1',
  relogin_total_limit: '',
  vip_welcome_messages: [],
};

function toFormState(settings: PlayerJoinSettingsSummary): FormState {
  return {
    welcome_message: settings.welcome_message ?? '',
    gift_enabled: settings.gift_enabled,
    gift_item: settings.gift_item ?? '',
    gift_count: settings.gift_count === null ? '' : String(settings.gift_count),
    gift_quality: settings.gift_quality ?? '',
    leave_message: settings.leave_message ?? '',
    relogin_gift_enabled: settings.relogin_gift_enabled ?? false,
    relogin_gift_items: settings.relogin_gift_items ?? [],
    relogin_cooldown_hours:
      settings.relogin_cooldown_hours === null ? '24' : String(settings.relogin_cooldown_hours),
    relogin_daily_limit:
      settings.relogin_daily_limit === null ? '1' : String(settings.relogin_daily_limit),
    relogin_total_limit:
      settings.relogin_total_limit === null ? '' : String(settings.relogin_total_limit),
    vip_welcome_messages: settings.vip_welcome_messages ?? [],
  };
}

export default function PlayerJoinSettings({ serverId, packId }: { serverId: string; packId: string }) {
  const { api, user } = useAuth();

  const [settings, setSettings] = useState<PlayerJoinSettingsSummary | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Pack 物品列表（用于礼包物品下拉选择）
  const [packItems, setPackItems] = useState<PackItemSummary[]>([]);
  const [packItemsLoading, setPackItemsLoading] = useState(false);

  const loadSettings = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      setSuccessMsg(null);
      try {
        const res = await api.getPlayerJoinSettings(id);
        setSettings(res.settings);
        setForm(toFormState(res.settings));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载玩家加入设置失败');
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

  // 加载 Pack 物品列表
  useEffect(() => {
    if (!packId) {
      setPackItems([]);
      return;
    }
    let cancelled = false;
    setPackItemsLoading(true);
    api
      .listPackItems(packId)
      .then((res) => {
        if (!cancelled) setPackItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setPackItems([]);
      })
      .finally(() => {
        if (!cancelled) setPackItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, packId]);

  // ----- P3 回归礼包物品编辑 -----
  const handleAddReloginGift = () => {
    setForm((f) => ({
      ...f,
      relogin_gift_items: [...f.relogin_gift_items, { item: '', count: 1, quality: null }],
    }));
  };

  const handleUpdateReloginGift = (index: number, patch: Partial<ReloginGiftItem>) => {
    setForm((f) => ({
      ...f,
      relogin_gift_items: f.relogin_gift_items.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      ),
    }));
  };

  const handleRemoveReloginGift = (index: number) => {
    setForm((f) => ({
      ...f,
      relogin_gift_items: f.relogin_gift_items.filter((_, i) => i !== index),
    }));
  };

  // ----- P4 VIP 欢迎语编辑 -----
  const handleAddVipMessage = () => {
    setForm((f) => ({
      ...f,
      vip_welcome_messages: [...f.vip_welcome_messages, { min_vip_level: 1, message: '' }],
    }));
  };

  const handleUpdateVipMessage = (index: number, patch: Partial<VipWelcomeMessage>) => {
    setForm((f) => ({
      ...f,
      vip_welcome_messages: f.vip_welcome_messages.map((m, i) =>
        i === index ? { ...m, ...patch } : m,
      ),
    }));
  };

  const handleRemoveVipMessage = (index: number) => {
    setForm((f) => ({
      ...f,
      vip_welcome_messages: f.vip_welcome_messages.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);

    // 校验回归礼包物品
    if (form.relogin_gift_enabled) {
      for (const item of form.relogin_gift_items) {
        if (!item.item.trim()) {
          setError('回归礼包物品名不能为空');
          return;
        }
        if (!Number.isInteger(item.count) || item.count <= 0) {
          setError(`回归礼包物品 ${item.item} 的数量需为正整数`);
          return;
        }
      }
    }

    // 校验 VIP 欢迎语
    for (const m of form.vip_welcome_messages) {
      if (!Number.isInteger(m.min_vip_level) || m.min_vip_level < 0) {
        setError('VIP 欢迎语的最低 VIP 等级需为非负整数');
        return;
      }
      if (!m.message.trim()) {
        setError('VIP 欢迎语内容不能为空');
        return;
      }
    }

    const patch: UpsertPlayerJoinSettingsRequest = {
      gift_enabled: form.gift_enabled,
      // P3
      relogin_gift_enabled: form.relogin_gift_enabled,
      relogin_gift_items: form.relogin_gift_enabled ? form.relogin_gift_items : null,
      // P4
      vip_welcome_messages: form.vip_welcome_messages.length > 0 ? form.vip_welcome_messages : null,
    };
    if (form.welcome_message.trim() !== '') {
      patch.welcome_message = form.welcome_message;
    } else {
      patch.welcome_message = null;
    }
    if (form.gift_item.trim() !== '') {
      patch.gift_item = form.gift_item;
    } else {
      patch.gift_item = null;
    }
    if (form.gift_count.trim() === '') {
      patch.gift_count = null;
    } else {
      const num = Number(form.gift_count);
      if (!Number.isInteger(num) || num < 0) {
        setError('gift_count 需为非负整数或留空');
        return;
      }
      patch.gift_count = num;
    }
    if (form.gift_quality !== '') {
      patch.gift_quality = form.gift_quality;
    } else {
      patch.gift_quality = null;
    }
    if (form.leave_message.trim() !== '') {
      patch.leave_message = form.leave_message;
    } else {
      patch.leave_message = null;
    }

    // 回归礼包参数
    if (form.relogin_cooldown_hours.trim() === '') {
      patch.relogin_cooldown_hours = null;
    } else {
      const num = Number(form.relogin_cooldown_hours);
      if (!Number.isInteger(num) || num < 0) {
        setError('回归冷却小时数需为非负整数或留空');
        return;
      }
      patch.relogin_cooldown_hours = num;
    }
    if (form.relogin_daily_limit.trim() === '') {
      patch.relogin_daily_limit = null;
    } else {
      const num = Number(form.relogin_daily_limit);
      if (!Number.isInteger(num) || num < 0) {
        setError('每日回归礼包限额需为非负整数或留空');
        return;
      }
      patch.relogin_daily_limit = num;
    }
    if (form.relogin_total_limit.trim() === '') {
      patch.relogin_total_limit = null;
    } else {
      const num = Number(form.relogin_total_limit);
      if (!Number.isInteger(num) || num < 0) {
        setError('回归礼包总限额需为非负整数或留空');
        return;
      }
      patch.relogin_total_limit = num;
    }

    setSaving(true);
    try {
      const res = await api.upsertPlayerJoinSettings(serverId, patch);
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
        <h2 className="page-title">玩家加入设置</h2>
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

          <label className="form-field">
            <span className="form-label">欢迎消息</span>
            <textarea
              value={form.welcome_message}
              onChange={(e) => setForm((f) => ({ ...f, welcome_message: e.target.value }))}
              rows={3}
              placeholder="例如：欢迎 {player} 来到服务器！"
            />
            <span className="form-hint">
              留空表示无欢迎消息。可用变量：{'{player}'} / {'{player_name}'}
            </span>
          </label>

          <label className="form-field">
            <span className="form-label">离开消息</span>
            <textarea
              value={form.leave_message}
              onChange={(e) => setForm((f) => ({ ...f, leave_message: e.target.value }))}
              rows={2}
              placeholder="例如：玩家 {player} 已离开服务器"
            />
            <span className="form-hint">
              留空表示无离开消息。可用变量：{'{player}'} / {'{player_name}'}
            </span>
          </label>

          <label className="form-checkbox-label">
            <input
              type="checkbox"
              checked={form.gift_enabled}
              onChange={(e) => setForm((f) => ({ ...f, gift_enabled: e.target.checked }))}
            />
            <span className="checkbox-label-text">启用入服礼包</span>
          </label>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">礼包物品</span>
              {packItems.length > 0 ? (
                <select
                  value={form.gift_item}
                  onChange={(e) => setForm((f) => ({ ...f, gift_item: e.target.value }))}
                  disabled={!form.gift_enabled}
                >
                  <option value="">— 请选择 —</option>
                  {packItems.map((it) => (
                    <option key={it.name} value={it.name}>
                      {it.display_name ? `${it.name}（${it.display_name}）` : it.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.gift_item}
                  onChange={(e) => setForm((f) => ({ ...f, gift_item: e.target.value }))}
                  placeholder={packItemsLoading ? '加载物品列表…' : '例如：iron-plate'}
                  disabled={!form.gift_enabled || packItemsLoading}
                />
              )}
            </label>
            <label className="form-field">
              <span className="form-label">礼包数量</span>
              <input
                type="number"
                min={0}
                value={form.gift_count}
                onChange={(e) => setForm((f) => ({ ...f, gift_count: e.target.value }))}
                placeholder="留空表示无"
                disabled={!form.gift_enabled}
              />
            </label>
            <label className="form-field">
              <span className="form-label">礼包品质</span>
              <select
                value={form.gift_quality}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    gift_quality: e.target.value as GiftQuality | '',
                  }))
                }
                disabled={!form.gift_enabled}
              >
                <option value="">不指定</option>
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* ============ P3 回归礼包 ============ */}
          <h3 className="card-title" style={{ marginTop: 24 }}>
            回归礼包（按离线时长触发）
          </h3>

          <label className="form-checkbox-label">
            <input
              type="checkbox"
              checked={form.relogin_gift_enabled}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  relogin_gift_enabled: e.target.checked,
                }))
              }
            />
            <span className="checkbox-label-text">
              启用回归礼包
              <small className="checkbox-label-desc">玩家离线超过冷却时数后再次上线时，自动发放此处配置的物品列表</small>
            </span>
          </label>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">回归冷却（小时）</span>
              <input
                type="number"
                min={0}
                value={form.relogin_cooldown_hours}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    relogin_cooldown_hours: e.target.value,
                  }))
                }
                placeholder="默认 24"
                disabled={!form.relogin_gift_enabled}
              />
            </label>
            <label className="form-field">
              <span className="form-label">每日限额</span>
              <input
                type="number"
                min={0}
                value={form.relogin_daily_limit}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    relogin_daily_limit: e.target.value,
                  }))
                }
                placeholder="默认 1"
                disabled={!form.relogin_gift_enabled}
              />
            </label>
            <label className="form-field">
              <span className="form-label">总限额（留空=不限）</span>
              <input
                type="number"
                min={0}
                value={form.relogin_total_limit}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    relogin_total_limit: e.target.value,
                  }))
                }
                placeholder="留空表示不限"
                disabled={!form.relogin_gift_enabled}
              />
            </label>
          </div>

          <div className="form-field">
            <span className="form-label">回归礼包物品</span>
            {form.relogin_gift_items.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>
                暂无物品，点击下方按钮添加
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.relogin_gift_items.map((item, idx) => (
                  <div key={idx} className="form-row" style={{ alignItems: 'flex-end' }}>
                    <label className="form-field">
                      <span className="form-label">物品名</span>
                      {packItems.length > 0 ? (
                        <select
                          value={item.item}
                          onChange={(e) => handleUpdateReloginGift(idx, { item: e.target.value })}
                          disabled={!form.relogin_gift_enabled}
                        >
                          <option value="">— 请选择 —</option>
                          {packItems.map((it) => (
                            <option key={it.name} value={it.name}>
                              {it.display_name ? `${it.name}（${it.display_name}）` : it.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={item.item}
                          onChange={(e) => handleUpdateReloginGift(idx, { item: e.target.value })}
                          placeholder="例如：iron-plate"
                          disabled={!form.relogin_gift_enabled}
                        />
                      )}
                    </label>
                    <label className="form-field">
                      <span className="form-label">数量</span>
                      <input
                        type="number"
                        min={1}
                        value={item.count}
                        onChange={(e) =>
                          handleUpdateReloginGift(idx, {
                            count: Number(e.target.value) || 0,
                          })
                        }
                        disabled={!form.relogin_gift_enabled}
                      />
                    </label>
                    <label className="form-field">
                      <span className="form-label">品质</span>
                      <select
                        value={item.quality ?? ''}
                        onChange={(e) =>
                          handleUpdateReloginGift(idx, {
                            quality: (e.target.value as GiftQuality | '') || null,
                          })
                        }
                        disabled={!form.relogin_gift_enabled}
                      >
                        <option value="">不指定</option>
                        {QUALITY_OPTIONS.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRemoveReloginGift(idx)}
                      disabled={!form.relogin_gift_enabled}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleAddReloginGift}
              disabled={!form.relogin_gift_enabled}
              style={{ marginTop: 8 }}
            >
              + 添加物品
            </button>
          </div>

          {/* ============ P4 VIP 专属欢迎语 ============ */}
          <h3 className="card-title" style={{ marginTop: 24 }}>
            VIP 专属欢迎语
          </h3>
          <span className="form-hint" style={{ display: 'block', marginBottom: 12 }}>
            按玩家 VIP 等级匹配欢迎语（VIP ≥ min_vip_level 时触发）；可用变量：{'{player}'} / {'{player_name}'} / {'{vip_level}'}
          </span>

          <div className="form-field">
            {form.vip_welcome_messages.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>
                暂无 VIP 欢迎语，点击下方按钮添加
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.vip_welcome_messages.map((msg, idx) => (
                  <div key={idx} className="form-row" style={{ alignItems: 'flex-end' }}>
                    <label className="form-field" style={{ flex: '0 0 140px' }}>
                      <span className="form-label">最低 VIP 等级</span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={msg.min_vip_level}
                        onChange={(e) =>
                          handleUpdateVipMessage(idx, {
                            min_vip_level: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="form-field" style={{ flex: 1 }}>
                      <span className="form-label">欢迎语</span>
                      <input
                        type="text"
                        value={msg.message}
                        onChange={(e) => handleUpdateVipMessage(idx, { message: e.target.value })}
                        placeholder="例如：尊贵的 VIP{vip_level} 玩家 {player_name} 光临"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRemoveVipMessage(idx)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleAddVipMessage}
              style={{ marginTop: 8 }}
            >
              + 添加欢迎语
            </button>
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
