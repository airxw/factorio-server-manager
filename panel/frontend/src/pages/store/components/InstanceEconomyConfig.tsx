// ============================================================================
// InstanceEconomyConfig — 实例经济配置（用户中心经济系统，instance_admin+）
// 挂载：/store/servers/:id（ServerDetailStore 顶部折叠卡片）
// 数据：GET /api/servers/:serverId/pricing；保存：PUT /api/servers/:serverId/pricing
// 契约：docs/plans/user-center-consolidation-plan.md §2.6 instance_pricing / §十一
//   - VIP 定价 null = 不开放对应购买方式（买断/订阅）
//   - daily_consumption_limit null = 使用平台默认；不得超过平台上限（后端校验）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Coins } from 'lucide-react';
import { useAuth } from '../../../api/auth';
import { userCenterRequest } from '../../../api/userCenter';
import { useToast } from '../../../components/ui';
import {
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
} from '../components/WorkbenchUI';

/** 实例定价配置（与后端 pricingService.InstancePricingRow 对齐） */
interface InstancePricing {
  server_id: string;
  vip_monthly_price: number | null;
  vip_lifetime_price: number | null;
  points_exchange_ratio: number;
  integral_ratio: number;
  daily_consumption_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface InstanceEconomyConfigProps {
  serverId: string;
}

/** 非负整数校验（允许 0） */
function isNonNegativeInt(v: string): boolean {
  return /^\d+$/.test(v.trim());
}

/** 正数校验（比例字段，允许小数） */
function isPositiveNumber(v: string): boolean {
  const n = Number(v.trim());
  return v.trim() !== '' && Number.isFinite(n) && n > 0;
}

export default function InstanceEconomyConfig({ serverId }: InstanceEconomyConfigProps) {
  const { token } = useAuth();
  const toast = useToast();

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单态（字符串，保存时解析；开关态对应后端 null 语义）
  const [lifetimeEnabled, setLifetimeEnabled] = useState(false);
  const [lifetimePrice, setLifetimePrice] = useState('');
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [pointsRatio, setPointsRatio] = useState('1');
  const [integralRatio, setIntegralRatio] = useState('1');
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('');

  const applyPricing = (p: InstancePricing) => {
    setLifetimeEnabled(p.vip_lifetime_price !== null);
    setLifetimePrice(p.vip_lifetime_price !== null ? String(p.vip_lifetime_price) : '');
    setMonthlyEnabled(p.vip_monthly_price !== null);
    setMonthlyPrice(p.vip_monthly_price !== null ? String(p.vip_monthly_price) : '');
    setPointsRatio(String(p.points_exchange_ratio));
    setIntegralRatio(String(p.integral_ratio));
    setDailyLimitEnabled(p.daily_consumption_limit !== null);
    setDailyLimit(p.daily_consumption_limit !== null ? String(p.daily_consumption_limit) : '');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userCenterRequest<{ pricing: InstancePricing }>(
        token,
        `/servers/${encodeURIComponent(serverId)}/pricing`,
      );
      applyPricing(res.pricing);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实例经济配置失败');
    } finally {
      setLoading(false);
    }
  }, [token, serverId]);

  // 懒加载：首次展开时才请求，避免进入实例详情即多一次 API 调用
  useEffect(() => {
    if (expanded && !loaded && !loading) {
      void load();
    }
  }, [expanded, loaded, loading, load]);

  const handleSave = async () => {
    if (lifetimeEnabled && !isNonNegativeInt(lifetimePrice)) {
      setError('VIP 买断价必须为非负整数');
      return;
    }
    if (monthlyEnabled && !isNonNegativeInt(monthlyPrice)) {
      setError('VIP 订阅价必须为非负整数');
      return;
    }
    if (!isPositiveNumber(pointsRatio)) {
      setError('点券兑换比例必须为正数');
      return;
    }
    if (!isPositiveNumber(integralRatio)) {
      setError('积分累计比例必须为正数');
      return;
    }
    if (dailyLimitEnabled && !isNonNegativeInt(dailyLimit)) {
      setError('单日消费上限必须为非负整数');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await userCenterRequest<{ pricing: InstancePricing }>(
        token,
        `/servers/${encodeURIComponent(serverId)}/pricing`,
        {
          method: 'PUT',
          body: JSON.stringify({
            vip_lifetime_price: lifetimeEnabled ? Number(lifetimePrice.trim()) : null,
            vip_monthly_price: monthlyEnabled ? Number(monthlyPrice.trim()) : null,
            points_exchange_ratio: Number(pointsRatio.trim()),
            integral_ratio: Number(integralRatio.trim()),
            daily_consumption_limit: dailyLimitEnabled ? Number(dailyLimit.trim()) : null,
          }),
        },
      );
      applyPricing(res.pricing);
      toast.success('实例经济配置已保存');
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 140,
    padding: '8px 12px',
    border: '1px solid var(--color-border, #d1d5db)',
    borderRadius: 8,
    fontSize: 13,
    boxSizing: 'border-box',
  };

  return (
    <section
      className="rounded-[26px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.34)] xl:p-6"
      data-testid="instance-economy-config"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Coins size={16} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">实例经济配置</h2>
            <p className="mt-1 text-xs leading-6 text-slate-500">
              VIP 定价（买断/订阅）· 点券兑换比例 · 积分累计比例 · 单日消费上限
            </p>
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="mt-5 space-y-4 border-t border-slate-200/80 pt-5">
          {error && (
            <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {loading && !loaded ? (
            <div className="h-24 animate-pulse rounded-[20px] bg-slate-100/70" />
          ) : (
            <>
              {/* VIP 定价 */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>VIP 定价</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, width: 56 }}>买断制</span>
                    <input
                      type="number"
                      min={0}
                      style={inputStyle}
                      value={lifetimePrice}
                      onChange={(e) => setLifetimePrice(e.target.value)}
                      disabled={!lifetimeEnabled || saving}
                      placeholder="余额"
                      aria-label="VIP 买断价"
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                      余额（一次性付费，永久有效）
                    </span>
                    <label className={`settings-toggle ${saving ? 'settings-toggle-disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={lifetimeEnabled}
                        onChange={(e) => setLifetimeEnabled(e.target.checked)}
                        disabled={saving}
                      />
                      <span className="settings-toggle-track" aria-hidden="true">
                        <span className="settings-toggle-thumb" />
                      </span>
                      <span className="settings-toggle-label">
                        {lifetimeEnabled ? '开放' : '不开放'}
                      </span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, width: 56 }}>订阅制</span>
                    <input
                      type="number"
                      min={0}
                      style={inputStyle}
                      value={monthlyPrice}
                      onChange={(e) => setMonthlyPrice(e.target.value)}
                      disabled={!monthlyEnabled || saving}
                      placeholder="余额/月"
                      aria-label="VIP 订阅价"
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                      余额/月（到期后权益失效）
                    </span>
                    <label className={`settings-toggle ${saving ? 'settings-toggle-disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={monthlyEnabled}
                        onChange={(e) => setMonthlyEnabled(e.target.checked)}
                        disabled={saving}
                      />
                      <span className="settings-toggle-track" aria-hidden="true">
                        <span className="settings-toggle-thumb" />
                      </span>
                      <span className="settings-toggle-label">
                        {monthlyEnabled ? '开放' : '不开放'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* 比例配置 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, width: 96 }}>点券兑换比例</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    style={inputStyle}
                    value={pointsRatio}
                    onChange={(e) => setPointsRatio(e.target.value)}
                    disabled={saving}
                    aria-label="点券兑换比例"
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                    1 余额 = {pointsRatio || '?'} 点券
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, width: 96 }}>积分累计比例</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    style={inputStyle}
                    value={integralRatio}
                    onChange={(e) => setIntegralRatio(e.target.value)}
                    disabled={saving}
                    aria-label="积分累计比例"
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                    1 余额消费 = {integralRatio || '?'} 积分
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, width: 96 }}>单日消费上限</span>
                  <input
                    type="number"
                    min={0}
                    style={inputStyle}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    disabled={!dailyLimitEnabled || saving}
                    placeholder="使用平台默认"
                    aria-label="单日消费上限"
                  />
                  <label className={`settings-toggle ${saving ? 'settings-toggle-disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={dailyLimitEnabled}
                      onChange={(e) => setDailyLimitEnabled(e.target.checked)}
                      disabled={saving}
                    />
                    <span className="settings-toggle-track" aria-hidden="true">
                      <span className="settings-toggle-thumb" />
                    </span>
                    <span className="settings-toggle-label">
                      {dailyLimitEnabled ? '自定义' : '平台默认'}
                    </span>
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)' }}>
                    仅可调低，不得超过平台上限
                  </span>
                </div>
              </div>

              {/* 操作行 */}
              <div className="flex flex-wrap gap-2 pt-2">
                <WorkbenchPrimaryButton
                  onClick={() => void handleSave()}
                  disabled={saving || loading}
                >
                  {saving ? '保存中…' : '保存配置'}
                </WorkbenchPrimaryButton>
                <WorkbenchSecondaryButton
                  onClick={() => void load()}
                  disabled={saving || loading}
                >
                  重置
                </WorkbenchSecondaryButton>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
