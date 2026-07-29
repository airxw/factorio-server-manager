// ============================================================================
// StartupGuideWizard — 启动前置引导向导
// v1.1.0: 实例首次启动前弹出，按 Pack startup_guide 声明分步收集基础设定
// 完成 → PUT /startup-config 保存 + config_writes 写入 → 交由父组件调 /start
// 草稿按实例 id 隔离到 localStorage，未完成时自动恢复
// ============================================================================

import { useEffect, useState, type ChangeEvent } from 'react';
import { X, ChevronLeft, ChevronRight, Check, MapPin, Globe, KeyRound } from 'lucide-react';
import type {
  StartupGuide,
  StartupGuideField,
  StartupGuideStep,
  StartupMapOption,
} from '@public/schema/pack-schema';
import { useAuth } from '../api/auth';
import { useToast } from './ui';

type FieldValue = string | number | boolean;
type ConfigMap = Record<string, FieldValue>;

interface StartupGuideWizardProps {
  open: boolean;
  serverId: string;
  serverName: string;
  /** 配置保存完成后的回调（父组件据此调 /start 启动实例） */
  onComplete: () => void;
  onCancel: () => void;
}

const DRAFT_KEY_PREFIX = 'startup-guide-draft:';

/** 获取字段默认值（优先 default，其次按类型给空兜底） */
function getFieldDefault(field: StartupGuideField): FieldValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'max_players':
      return 20;
    case 'difficulty':
      return field.enum_values?.[0] ?? 'normal';
    case 'password':
      return '';
    default:
      return '';
  }
}

/** 合并 Pack 默认值 + 已保存配置 + 草稿 → 当前表单值 */
function mergeInitialConfig(
  guide: StartupGuide,
  savedConfig: ConfigMap,
  draft: ConfigMap | null,
): ConfigMap {
  const result: ConfigMap = {};
  for (const step of guide.steps) {
    for (const field of step.fields) {
      const key = field.key;
      if (draft && key in draft) {
        result[key] = draft[key];
      } else if (key in savedConfig) {
        result[key] = savedConfig[key];
      } else {
        result[key] = getFieldDefault(field);
      }
    }
  }
  return result;
}

/** 判断步骤是否可跳过（optional 步骤或所有 required 字段已有值） */
function isStepComplete(step: StartupGuideStep, config: ConfigMap): boolean {
  for (const field of step.fields) {
    if (!field.required) continue;
    if (field.default !== undefined) continue; // 有默认值的 required 字段视为已满足
    const val = config[field.key];
    if (val === undefined || val === '') return false;
  }
  return true;
}

/** 字段图标——按类型选择 lucide 图标，提升视觉识别 */
function FieldIcon({ type }: { type: StartupGuideField['type'] }) {
  switch (type) {
    case 'map':
      return <MapPin size={16} />;
    case 'world_name':
      return <Globe size={16} />;
    case 'password':
      return <KeyRound size={16} />;
    default:
      return null;
  }
}

// ----- 单字段渲染 -----

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: StartupGuideField;
  value: FieldValue;
  onChange: (val: FieldValue) => void;
}) {
  const fieldId = `sg-field-${field.key}`;

  // map 类型：单选卡片组
  if (field.type === 'map' && field.options) {
    return (
      <div className="sg-field-map-group" role="radiogroup" aria-label={field.label}>
        {field.options.map((opt: StartupMapOption) => {
          const selected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={`sg-map-card${selected ? ' selected' : ''}`}
              role="radio"
              aria-checked={selected}
            >
              <input
                type="radio"
                name={fieldId}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="sg-map-radio"
              />
              <div className="sg-map-card-content">
                <span className="sg-map-card-name">{opt.display_name}</span>
                {opt.description && (
                  <span className="sg-map-card-desc">{opt.description}</span>
                )}
              </div>
              {selected && <Check size={16} className="sg-map-card-check" />}
            </label>
          );
        })}
      </div>
    );
  }

  // difficulty / 枚举类型：select 下拉
  if (field.enum_values && field.enum_values.length > 0) {
    return (
      <select
        id={fieldId}
        className="form-input"
        value={String(value)}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {field.enum_values.map((v: string) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  // max_players / 数字类型：number input
  if (field.type === 'max_players' || (field.min !== undefined && field.max !== undefined)) {
    return (
      <input
        id={fieldId}
        type="number"
        className="form-input"
        value={Number(value)}
        min={field.min}
        max={field.max}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    );
  }

  // password 类型：password input
  if (field.type === 'password') {
    return (
      <input
        id={fieldId}
        type="text"
        className="form-input"
        value={String(value)}
        placeholder={field.description ?? '留空则无密码'}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        autoComplete="off"
      />
    );
  }

  // 默认：text input（world_name / seed / server_name / config_ref / custom）
  return (
    <input
      id={fieldId}
      type="text"
      className="form-input"
      value={String(value)}
      placeholder={field.description ?? ''}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      autoComplete="off"
    />
  );
}

// ----- 主组件 -----

export default function StartupGuideWizard({
  open,
  serverId,
  serverName,
  onComplete,
  onCancel,
}: StartupGuideWizardProps) {
  const { api } = useAuth();
  const toast = useToast();

  const [guide, setGuide] = useState<StartupGuide | null>(null);
  const [config, setConfig] = useState<ConfigMap>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noGuideNeeded, setNoGuideNeeded] = useState(false);

  const draftKey = `${DRAFT_KEY_PREFIX}${serverId}`;

  // 打开时拉取引导声明 + 已保存配置
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCurrentStep(0);

    (async () => {
      try {
        const resp = await api.getStartupGuide(serverId);
        if (cancelled) return;
        if (!resp.guide) {
          // Pack 无 startup_guide 声明 → 直接完成（父组件调 /start）
          setNoGuideNeeded(true);
          setLoading(false);
          return;
        }
        setGuide(resp.guide);
        // 合并：草稿 > 已保存配置 > Pack 默认值
        let draft: ConfigMap | null = null;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) draft = JSON.parse(raw) as ConfigMap;
        } catch {
          draft = null;
        }
        const initial = mergeInitialConfig(resp.guide, resp.current_config, draft);
        setConfig(initial);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '获取启动引导失败';
        setError(msg);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, serverId, api, draftKey]);

  // 无需引导时直接完成
  useEffect(() => {
    if (noGuideNeeded) {
      onComplete();
      setNoGuideNeeded(false);
    }
  }, [noGuideNeeded, onComplete]);

  // 草稿自动保存（config 变化时写 localStorage）
  useEffect(() => {
    if (!open || !guide) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(config));
    } catch {
      // localStorage 满或禁用时静默降级
    }
  }, [config, open, guide, draftKey]);

  if (!open) return null;

  const steps = guide?.steps ?? [];
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const stepComplete = step ? isStepComplete(step, config) : true;

  const handleFieldChange = (key: string, val: FieldValue) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
  };

  const handleNext = () => {
    if (!stepComplete) {
      toast.error('请填写必填项后再继续');
      return;
    }
    if (isLastStep) {
      void handleConfirm();
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveStartupConfig(serverId, { config });
      // 保存成功 → 清除草稿
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      toast.success('启动配置已保存');
      onComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存启动配置失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // 保留草稿（用户下次打开可恢复）
    onCancel();
  };

  return (
    <div className="sg-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="sg-dialog" role="dialog" aria-modal="true" aria-labelledby="sg-title">
        {/* 头部 */}
        <div className="sg-header">
          <div>
            <h3 id="sg-title" className="sg-title">
              启动配置
            </h3>
            <p className="sg-subtitle">{serverName}</p>
          </div>
          <button
            className="btn btn-ghost btn-icon-only"
            onClick={handleCancel}
            disabled={saving}
            title="取消"
            aria-label="取消"
          >
            <X size={18} />
          </button>
        </div>

        {/* 加载态 */}
        {loading && (
          <div className="sg-body sg-loading">
            <p>正在获取启动配置…</p>
          </div>
        )}

        {/* 错误态 */}
        {error && !loading && (
          <div className="sg-body">
            <div className="sg-error">{error}</div>
            <div className="sg-actions">
              <button className="btn btn-ghost" onClick={handleCancel}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void window.location.reload()}>
                重试
              </button>
            </div>
          </div>
        )}

        {/* 向导主体 */}
        {guide && !loading && !error && step && (
          <>
            {/* 步骤指示器 */}
            <div className="sg-stepper">
              {steps.map((s: StartupGuideStep, idx: number) => (
                <div
                  key={s.key}
                  className={`sg-step-dot${idx === currentStep ? ' active' : ''}${idx < currentStep ? ' done' : ''}`}
                >
                  <span className="sg-step-num">{idx < currentStep ? <Check size={12} /> : idx + 1}</span>
                  <span className="sg-step-label">{s.title}</span>
                </div>
              ))}
            </div>

            {/* 当前步骤内容 */}
            <div className="sg-body">
              <div className="sg-step-title">{step.title}</div>
              {step.description && <p className="sg-step-desc">{step.description}</p>}

              <div className="sg-fields">
                {step.fields.map((field: StartupGuideField) => (
                  <div key={field.key} className="sg-field">
                    <label className="sg-field-label" htmlFor={`sg-field-${field.key}`}>
                      <FieldIcon type={field.type} />
                      <span>
                        {field.label}
                        {field.required && field.default === undefined && (
                          <span className="sg-required-mark"> *</span>
                        )}
                      </span>
                    </label>
                    {field.description && field.type !== 'map' && (
                      <p className="sg-field-hint">{field.description}</p>
                    )}
                    <FieldRenderer
                      field={field}
                      value={config[field.key] ?? getFieldDefault(field)}
                      onChange={(val) => handleFieldChange(field.key, val)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 底部操作 */}
            <div className="sg-actions">
              <button
                className="btn btn-ghost"
                onClick={handleCancel}
                disabled={saving}
              >
                取消
              </button>
              {currentStep > 0 && (
                <button className="btn btn-ghost" onClick={handlePrev} disabled={saving}>
                  <ChevronLeft size={16} />
                  上一步
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleNext}
                disabled={saving || !stepComplete}
              >
                {saving ? '保存中…' : isLastStep ? (
                  <>
                    确认并启动
                    <Check size={16} />
                  </>
                ) : (
                  <>
                    下一步
                    <ChevronRight size={16} />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
