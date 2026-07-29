// ============================================================================
// Settings — v3.8.0 结构化设置面板（替代纯 KV 编辑器）
// 表单式 UI：按 group 分组展示，每项按 type 渲染对应控件（开关/数字/文本/JSON）
// 支持单行保存 + 重置默认值 + 整体保存指示
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Settings as SettingsIcon } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type { SettingSchemaItem, SettingGroup } from '../../api/modules/settings';
import { SensitiveInput, useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

/** 分组显示配置（与后端 SettingGroup 同步，含 v3.9.0 新增的 mail/maintenance/disk/legal） */
const GROUP_LABELS: Record<SettingGroup, string> = {
  site: '站点信息',
  registration: '注册管理',
  games: '游戏配置',
  vip: 'VIP 体系',
  admin: '管理员配置',
  backup: '备份策略',
  mail: '邮件配置',
  maintenance: '维护模式',
  disk: '磁盘监控',
  legal: '法律条款',
};

/** 分组展示顺序（新分组追加在末尾） */
const GROUP_ORDER: SettingGroup[] = [
  'site',
  'registration',
  'games',
  'vip',
  'admin',
  'backup',
  'mail',
  'maintenance',
  'disk',
  'legal',
];

/**
 * 防御性兜底：后端未来可能新增 group，未在前端 GROUP_LABELS 中声明时归入"其他"，
 * 避免再次出现 groups[s.group] 为 undefined 导致 push 崩溃的问题。
 */
const UNKNOWN_GROUP: SettingGroup = 'admin';
function safeGroup(g: string): SettingGroup {
  return (g in GROUP_LABELS) ? (g as SettingGroup) : UNKNOWN_GROUP;
}

function isEndpointUnavailable(err: unknown): boolean {
  if (err instanceof PanelApiError) {
    return err.status === 404 || err.code === 'HTTP_404' || err.code === 'NETWORK_ERROR';
  }
  return true;
}

export default function Settings() {
  const { api, user } = useAuth();
  const toast = useToast();

  const [settings, setSettings] = useState<SettingSchemaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  // 编辑中的值：key → 当前编辑值（未保存）
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  // v4.1.1: 移动端手风琴分组——只展开一个分组，类似 iOS Settings App
  const [expandedGroup, setExpandedGroup] = useState<SettingGroup | null>('site');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const res = await api.listSettingsSchema();
      setSettings(res.settings ?? []);
      // 初始化编辑值为当前值
      const initial: Record<string, string> = {};
      for (const s of res.settings ?? []) {
        initial[s.key] = s.currentValue ?? s.defaultValue;
      }
      setEditingValues(initial);
      setHasLoaded(true);
    } catch (err) {
      if (isEndpointUnavailable(err)) {
        setUnavailable(true);
      } else {
        const msg = err instanceof Error ? err.message : '加载设置失败';
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSave = useCallback(
    async (key: string) => {
      const value = editingValues[key];
      if (value === undefined) return;
      setSavingKeys((prev) => new Set(prev).add(key));
      try {
        const res = await api.updateSetting(key, value);
        setSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, currentValue: res.setting.currentValue } : s)),
        );
        toast.success(`已保存：${res.setting.label}`);
      } catch (err) {
        if (err instanceof PanelApiError) {
          toast.error('保存失败', err.message);
        } else {
          toast.error('保存失败', err instanceof Error ? err.message : '未知错误');
        }
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [api, editingValues, toast],
  );

  const handleReset = useCallback(
    async (key: string) => {
      setSavingKeys((prev) => new Set(prev).add(key));
      try {
        const res = await api.resetSetting(key);
        setSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, currentValue: res.setting.currentValue } : s)),
        );
        setEditingValues((prev) => ({
          ...prev,
          [key]: res.setting.currentValue ?? res.setting.defaultValue,
        }));
        toast.success(`已重置：${res.setting.label}`);
      } catch (err) {
        toast.error('重置失败', err instanceof Error ? err.message : '未知错误');
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [api, toast],
  );

  // 按分组聚合
  const groupedSettings = useMemo(() => {
    const groups: Record<SettingGroup, SettingSchemaItem[]> = {
      site: [],
      registration: [],
      games: [],
      vip: [],
      admin: [],
      backup: [],
      mail: [],
      maintenance: [],
      disk: [],
      legal: [],
    };
    for (const s of settings) {
      // safeGroup 兜底：后端未来新增 group 不在前端列表时归入 admin，避免 undefined.push 崩溃
      const g = safeGroup(s.group);
      groups[g].push(s);
    }
    // 每组内按 order 升序
    for (const g of Object.keys(groups) as SettingGroup[]) {
      groups[g].sort((a, b) => a.order - b.order);
    }
    return groups;
  }, [settings]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>
            <SettingsIcon size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            面板设置
          </h2>
          <p className="page-description">
            v3.8.0 结构化设置面板——按分组管理站点、注册、游戏、VIP、备份等配置
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void loadSettings()} disabled={loading}>
            <RotateCcw size={14} />
            刷新
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {unavailable ? (
        <div className="empty-state">设置接口暂未开放（v3.8.0+ 后端未启用）。</div>
      ) : loading && !hasLoaded ? (
        <div className="empty-state">加载中…</div>
      ) : settings.length === 0 ? (
        <div className="empty-state">暂无设置项。</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {GROUP_ORDER.map((group) => {
            const items = groupedSettings[group];
            if (items.length === 0) return null;
            const isExpanded = expandedGroup === group;
            return (
              <div
                key={group}
                className={`settings-group${isExpanded ? ' expanded' : ''}`}
                style={{
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  className="settings-group-header"
                  style={{
                    padding: '10px 16px',
                    background: 'var(--color-bg-secondary, #f9fafb)',
                    borderBottom: '1px solid var(--color-border, #e5e7eb)',
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onClick={() => setExpandedGroup(isExpanded ? null : group)}
                  role="button"
                  aria-expanded={isExpanded}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedGroup(isExpanded ? null : group);
                    }
                  }}
                >
                  <span className="settings-group-header-title">{GROUP_LABELS[group]}</span>
                  <span className="settings-group-header-arrow" aria-hidden="true">›</span>
                </div>
                <div className="settings-group-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {items.map((item) => (
                    <SettingRow
                      key={item.key}
                      item={item}
                      editValue={editingValues[item.key] ?? item.currentValue ?? item.defaultValue}
                      onChange={(v) =>
                        setEditingValues((prev) => ({ ...prev, [item.key]: v }))
                      }
                      onSave={() => void handleSave(item.key)}
                      onReset={() => void handleReset(item.key)}
                      saving={savingKeys.has(item.key)}
                      isDirty={
                        (editingValues[item.key] ?? '') !==
                        (item.currentValue ?? item.defaultValue)
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 平台经济配置区（用户中心经济系统，system_config KV，server_admin+） */}
      <PlatformEconomySection />
    </div>
  );
}

// ============================================================================
// 单行设置项渲染
// ============================================================================

interface SettingRowProps {
  item: SettingSchemaItem;
  editValue: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  isDirty: boolean;
}

function SettingRow({ item, editValue, onChange, onSave, onReset, saving, isDirty }: SettingRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 0',
        borderBottom: '1px dashed var(--color-border, #e5e7eb)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{item.label}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '2px 8px' }}
            onClick={onReset}
            disabled={saving}
            title="重置为默认值"
          >
            <RotateCcw size={12} />
            默认
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '2px 8px' }}
            onClick={onSave}
            disabled={saving || !isDirty}
          >
            <Save size={12} />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
        {item.description}
      </div>
      <SettingInput item={item} value={editValue} onChange={onChange} disabled={saving} />
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #6b7280)' }}>
        <span style={{ fontFamily: 'monospace' }}>{item.key}</span>
        <span style={{ margin: '0 6px' }}>·</span>
        类型: {item.type}
        {item.defaultValue && (
          <>
            <span style={{ margin: '0 6px' }}>·</span>
            默认: <code>{item.defaultValue}</code>
          </>
        )}
      </div>
    </div>
  );
}

function SettingInput({
  item,
  value,
  onChange,
  disabled,
}: {
  item: SettingSchemaItem;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--color-border, #d1d5db)',
    borderRadius: 8,
    fontSize: 13,
    boxSizing: 'border-box',
    transition: 'border-color 200ms ease, box-shadow 200ms ease',
  };

  switch (item.type) {
    case 'boolean':
      // v4.22.8: iOS 风格 toggle switch（替代原生 checkbox）
      return (
        <label className={`settings-toggle ${disabled ? 'settings-toggle-disabled' : ''}`}>
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            disabled={disabled}
          />
          <span className="settings-toggle-track" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-label">{value === 'true' ? '已开启' : '已关闭'}</span>
        </label>
      );
    case 'number':
      return (
        <input
          type="number"
          style={inputStyle}
          className="settings-input"
          value={value}
          min={item.min}
          max={item.max}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case 'enum':
      // v4.22.8: segmented chips（替代原生 select），选项少时更直观
      if ((item.enumValues ?? []).length <= 4) {
        return (
          <div className="settings-segmented" role="radiogroup" aria-label={item.label}>
            {(item.enumValues ?? []).map((v) => {
              const active = v === value;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`settings-segmented-item ${active ? 'settings-segmented-item-active' : ''}`}
                  onClick={() => onChange(v)}
                  disabled={disabled}
                >
                  {v}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <select
          style={inputStyle}
          className="settings-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          {(item.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case 'json':
      return (
        <textarea
          style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 80 }}
          className="settings-input settings-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
      );
    case 'string':
    default:
      // B1: sensitive 字段（如 SMTP 密码、API Key）使用 SensitiveInput 隐藏
      if (item.sensitive) {
        return (
          <SensitiveInput
            value={value}
            onChange={onChange}
            disabled={disabled}
            revealable
            copyable
            style={{ fontSize: 13 }}
          />
        );
      }
      return (
        <input
          type="text"
          style={inputStyle}
          className="settings-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
  }
}

// ============================================================================
// 平台经济配置区（用户中心经济系统）
// 三项配置存 system_config（KV），未纳入 settings schema，故经 system-config API 直读写
// 契约：docs/plans/user-center-consolidation-plan.md §2.7 / §十二
// ============================================================================

const ECONOMY_KEY_RECHARGE_MAX = 'recharge.max';
const ECONOMY_KEY_DAILY_MAX = 'consumption.daily_max';
const ECONOMY_KEY_WITHDRAW_RATIO = 'withdraw.ratio';

// 默认值与后端对齐：
// - recharge.max → userCenter.ts RECHARGE_MAX_DEFAULT = 100000
// - consumption.daily_max → pricingService.ts PLATFORM_DAILY_MAX_DEFAULT = 648
// - withdraw.ratio → withdrawService.ts WITHDRAW_RATIO_DEFAULT = 0.7
// 历史漂移：v4.x.x 之前前端用 balance.recharge_max（后端读不到，自定义值从未生效）
const ECONOMY_DEFAULT_RECHARGE_MAX = '100000';
const ECONOMY_DEFAULT_DAILY_MAX = '648';
const ECONOMY_DEFAULT_WITHDRAW_RATIO = '0.7';

function PlatformEconomySection() {
  const { api } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechargeMax, setRechargeMax] = useState(ECONOMY_DEFAULT_RECHARGE_MAX);
  const [dailyMax, setDailyMax] = useState(ECONOMY_DEFAULT_DAILY_MAX);
  const [withdrawRatio, setWithdrawRatio] = useState(ECONOMY_DEFAULT_WITHDRAW_RATIO);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2, r3] = await Promise.all([
        api.getSystemConfig(ECONOMY_KEY_RECHARGE_MAX),
        api.getSystemConfig(ECONOMY_KEY_DAILY_MAX),
        api.getSystemConfig(ECONOMY_KEY_WITHDRAW_RATIO),
      ]);
      setRechargeMax(r1.config?.value ?? ECONOMY_DEFAULT_RECHARGE_MAX);
      setDailyMax(r2.config?.value ?? ECONOMY_DEFAULT_DAILY_MAX);
      setWithdrawRatio(r3.config?.value ?? ECONOMY_DEFAULT_WITHDRAW_RATIO);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载平台经济配置失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!/^[1-9]\d*$/.test(rechargeMax.trim())) {
      setError('充值入口禁用阈值必须为正整数');
      return;
    }
    if (!/^[1-9]\d*$/.test(dailyMax.trim())) {
      setError('单日消费上限必须为正整数');
      return;
    }
    const ratio = Number(withdrawRatio.trim());
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      setError('提现比例必须在 (0, 1] 区间（如 0.7 表示到账 70%）');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        api.setSystemConfig(ECONOMY_KEY_RECHARGE_MAX, {
          value: rechargeMax.trim(),
          description: '余额充值入口禁用阈值（元）——余额 ≥ 此值时禁用全部充值入口',
        }),
        api.setSystemConfig(ECONOMY_KEY_DAILY_MAX, {
          value: dailyMax.trim(),
          description: '平台单日消费上限（元）——实例仅可调低',
        }),
        api.setSystemConfig(ECONOMY_KEY_WITHDRAW_RATIO, {
          value: withdrawRatio.trim(),
          description: '提现比例——余额 × 比例 = 实际到账（平台服务费）',
        }),
      ]);
      toast.success('平台经济配置已保存');
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 160,
    padding: '8px 12px',
    border: '1px solid var(--color-border, #d1d5db)',
    borderRadius: 8,
    fontSize: 13,
    boxSizing: 'border-box',
  };

  return (
    <div
      className="settings-group"
      style={{
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        overflow: 'hidden',
        marginTop: 16,
      }}
      data-testid="platform-economy-section"
    >
      <div
        className="settings-group-header"
        style={{
          padding: '10px 16px',
          background: 'var(--color-bg-secondary, #f9fafb)',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        平台经济配置
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, width: 140 }}>充值入口禁用阈值</span>
              <input
                type="number"
                min={1}
                style={inputStyle}
                value={rechargeMax}
                onChange={(e) => setRechargeMax(e.target.value)}
                disabled={saving}
                aria-label="充值入口禁用阈值"
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                元——余额 ≥ 此值时禁用充值入口（默认 {ECONOMY_DEFAULT_RECHARGE_MAX}）
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, width: 140 }}>单日消费上限</span>
              <input
                type="number"
                min={1}
                style={inputStyle}
                value={dailyMax}
                onChange={(e) => setDailyMax(e.target.value)}
                disabled={saving}
                aria-label="单日消费上限"
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                元——平台级上限，实例仅可调低（默认 {ECONOMY_DEFAULT_DAILY_MAX}）
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, width: 140 }}>提现比例</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                style={inputStyle}
                value={withdrawRatio}
                onChange={(e) => setWithdrawRatio(e.target.value)}
                disabled={saving}
                aria-label="提现比例"
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                余额 × 比例 = 实际到账（默认 {ECONOMY_DEFAULT_WITHDRAW_RATIO}，即 70%）
              </span>
            </div>
            <div>
              <button
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save size={14} />
                {saving ? '保存中…' : '保存配置'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
