// ============================================================================
// CreateServer — 创建实例表单
// 拉 Pack 列表做下拉，填名称，提交调 api.createServer，成功跳详情
// 五.7: 字段级实时校验（onBlur 触发，onChange 清错）
// 一.7: 跳转定时器句柄由 useRef 管理，组件卸载时清理
// v1.1.0: 端口锁定为实例不可变属性，由系统自动分配，表单不再暴露端口输入
// ============================================================================

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Package,
  Tag,
  Wallet,
} from 'lucide-react';
import type { CreateServerRequest } from '@public/schema/panel-api-types';
import type { PackSummary } from '@public/schema/panel-api-types';
import type { GameVersionSummary } from '@public/schema/panel-api-types';
import type { MyQuotaResponse } from '@public/schema/panel-api-types';
import type { NodeInfo } from '../api/client';
import type {
  InstanceTypePricing,
  BillingCycleMonths,
} from '@public/interface_stub/shared-types';
import type { BillingAmountPreview } from '../api/modules/instance-billing';
import { useAuth } from '../api/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useDraftAutosave } from '../hooks/useDraftAutosave';
import { useToast } from '../components/ui';
import {
  clearFieldError,
  validateInstanceName,
  type FieldErrors,
} from '../utils/formValidation';
import { getServerErrorMessage } from '../utils/mapServerErrors';
import { getEffectiveRole, isAdminRole } from '../utils/role';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchNote,
} from './store/components/WorkbenchUI';

type CreateServerField = 'name';

/** v3-billing: 创建实例请求体扩展（后端 servers.ts 已支持 instance_type/billing_cycle_months） */
type CreateServerRequestWithBilling = CreateServerRequest & {
  instance_type?: 'micro' | 'small' | 'medium' | 'large' | 'xlarge';
  billing_cycle_months?: 1 | 3 | 6 | 12;
};

/** v3-billing: 创建实例响应体扩展（后端附加 billing 字段） */
type CreateServerResponseWithBilling = {
  server: import('@public/schema/panel-api-types').ServerSummary;
  billing?: {
    amount_paid: number;
    exempt: boolean;
    new_expires_at: string;
  };
};

const CYCLE_OPTIONS: ReadonlyArray<{ value: BillingCycleMonths; label: string }> = [
  { value: 1, label: '月付' },
  { value: 3, label: '季付' },
  { value: 6, label: '半年付' },
  { value: 12, label: '年付' },
];

export default function CreateServer() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('创建实例');

  // v4.6.0-E3: 角色判断——server_admin 无配额限制（以 active_role 会话身份为准）
  const isServerAdmin = isAdminRole(getEffectiveRole(user));

  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [name, setName] = useState('');
  const [packId, setPackId] = useState('');
  const [nodeId, setNodeId] = useState('');
  // v3.4.0: 版本选择
  const [versions, setVersions] = useState<GameVersionSummary[]>([]);
  const [versionId, setVersionId] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<CreateServerField>>({});
  // v4.6.0-E3: 配额预检（仅非 server_admin 角色加载）
  const [quota, setQuota] = useState<MyQuotaResponse | null>(null);

  // v3-billing: 实例类型定价 + 计费周期选择 + 价格预览
  const [typePricings, setTypePricings] = useState<InstanceTypePricing[]>([]);
  const [selectedInstanceType, setSelectedInstanceType] = useState<
    'micro' | 'small' | 'medium' | 'large' | 'xlarge'
  >('small');
  const [billingCycleMonths, setBillingCycleMonths] = useState<BillingCycleMonths>(1);
  const [pricePreview, setPricePreview] = useState<BillingAmountPreview | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // 7.5: 表单草稿自动保存——草稿恢复提示未决时暂停自动保存，避免空表单覆盖草稿
  const [draftPromptResolved, setDraftPromptResolved] = useState(false);
  const draftValue = { name, packId, nodeId };
  const { hasDraft, restoreDraft, clearDraft } = useDraftAutosave(
    'create-server-draft',
    draftValue,
    1000,
    draftPromptResolved,
  );

  // 一.7: 保存跳转定时器句柄，组件卸载时清理，避免对已卸载组件调用 navigate
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPacks(true);
    api
      .listPacks()
      .then((res) => {
        if (cancelled) return;
        setPacks(res.packs);
        if (res.packs.length > 0) {
          setPackId(res.packs[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载 Pack 列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPacks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // v3.4.0: 加载选中 Pack 的可用版本
  useEffect(() => {
    if (!packId) return;
    let cancelled = false;
    setLoadingVersions(true);
    api
      .listVersions(packId)
      .then((res) => {
        if (cancelled) return;
        setVersions(res.versions);
        // 默认选中最新版本
        if (res.versions.length > 0 && !versionId) {
          setVersionId(res.versions[0].id);
        }
      })
      .catch(() => {
        // 版本列表加载失败不阻塞创建（可能没有任何已下载版本）
        if (!cancelled) setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, packId]);

  // 加载部署节点列表，默认选中第一个节点（替代原硬编码 DEFAULT_NODE_ID）
  useEffect(() => {
    let cancelled = false;
    setLoadingNodes(true);
    api
      .listNodes()
      .then((res) => {
        if (cancelled) return;
        setNodes(res.nodes);
        if (res.nodes.length > 0) {
          setNodeId(res.nodes[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载节点列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingNodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // v4.6.0-E3: 加载配额（server_admin 不加载）
  useEffect(() => {
    if (isServerAdmin) return;
    let cancelled = false;
    api
      .getMyQuota()
      .then((res) => {
        if (!cancelled) setQuota(res);
      })
      .catch(() => {
        // 静默失败
      });
    return () => {
      cancelled = true;
    };
  }, [api, isServerAdmin]);

  // v3-billing: 加载实例类型定价（任意已登录用户可读）
  useEffect(() => {
    let cancelled = false;
    setLoadingTypes(true);
    api
      .listInstanceTypePricings()
      .then((res) => {
        if (cancelled) return;
        setTypePricings(res.types);
        // 默认选中 small（若不存在则选第一个）
        const hasSmall = res.types.some((t) => t.instance_type === 'small');
        if (!hasSmall && res.types.length > 0) {
          setSelectedInstanceType(res.types[0].instance_type);
        }
      })
      .catch(() => {
        // 定价加载失败不阻塞创建（后端会用默认 small 定价）
        if (!cancelled) setTypePricings([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // v3-billing: 实时价格预览（实例类型或周期变化时刷新）
  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    api
      .previewBillingAmount(selectedInstanceType, billingCycleMonths)
      .then((res) => {
        if (!cancelled) setPricePreview(res.preview);
      })
      .catch(() => {
        // 预览失败不阻塞创建（后端会重新计算）
        if (!cancelled) setPricePreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedInstanceType, billingCycleMonths]);

  const validateField = (field: CreateServerField, value: string): string | null => {
    if (field === 'name') return validateInstanceName(value);
    return null;
  };

  const handleBlur = (field: CreateServerField, value: string) => {
    const msg = validateField(field, value);
    setFieldErrors((prev) => ({ ...prev, [field]: msg }));
  };

  const handleChange = (field: CreateServerField, value: string) => {
    if (field === 'name') setName(value);
    if (fieldErrors[field]) {
      setFieldErrors((prev) => clearFieldError(prev, field));
    }
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);

      // 五.7: 提交前字段级校验
      const errors: FieldErrors<CreateServerField> = {
        name: validateInstanceName(name),
      };
      setFieldErrors(errors);
      if (errors.name) return;

      if (!packId) {
        setError('请选择一个 Pack');
        return;
      }
      if (!nodeId) {
        setError('请选择部署节点');
        return;
      }

      // v4.6.0-E3: 配额预检——非 server_admin 角色提交前检查 can_create_instance
      if (!isServerAdmin && quota && quota.can_create_instance === false) {
        const msg = '实例配额已满，请联系管理员调整';
        setError(msg);
        toast.error(msg);
        return;
      }

      // v1.1.0: 端口由系统自动分配，前端不再传 port/rcon_port
      // v3-billing: 附带 instance_type + billing_cycle_months，后端预付费扣款
      const req: CreateServerRequestWithBilling = {
        name: name.trim(),
        pack_id: packId,
        node_id: nodeId,
        version_id: versionId || undefined,
        instance_type: selectedInstanceType,
        billing_cycle_months: billingCycleMonths,
      };

      setSubmitting(true);
      try {
        const res = (await api.createServer(req)) as CreateServerResponseWithBilling;
        setSuccess(true);
        // v3-billing: 展示计费结果（扣款金额/豁免/到期时间）
        if (res.billing) {
          if (res.billing.exempt || res.billing.amount_paid === 0) {
            toast.success('实例创建成功（免计费）');
          } else {
            toast.success(`实例创建成功，已扣费 ${res.billing.amount_paid} 点券`);
          }
        } else {
          // 6.5: 成功 Toast 反馈（未接入计费的兜底）
          toast.success('实例创建成功');
        }
        // 7.5: 提交成功后清除草稿
        clearDraft();
        // 一.7: 延迟跳转，让用户看到成功提示；定时器由 redirectTimerRef 管理，卸载时清理
        redirectTimerRef.current = setTimeout(() => {
          navigate(`/instances/${res.server.id}`, { replace: true });
        }, 1200);
      } catch (err) {
        const msg = getServerErrorMessage(err, '创建失败');
        setError(msg);
        // 6.6: 失败 Toast 反馈
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      name,
      packId,
      nodeId,
      api,
      navigate,
      clearDraft,
      toast,
      isServerAdmin,
      quota,
      selectedInstanceType,
      billingCycleMonths,
    ],
  );

  const INPUT_CLASS =
    'w-full rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60';
  const SELECT_CLASS = INPUT_CLASS;
  const LABEL_CLASS = 'block text-xs font-medium uppercase tracking-[0.18em] text-slate-400';
  const HINT_CLASS = 'mt-1.5 text-xs leading-5 text-slate-500';
  const ERROR_CLASS = 'mt-1.5 text-xs leading-5 text-rose-600';

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Create"
        title="创建新实例"
        description="从已注册的 Pack 中选择一种游戏配置，选择部署节点并填写实例名称，即可拉起一台新的游戏实例。端口由系统自动分配，启动前可在详情页完成地图与基础配置引导。"
        actions={
          <WorkbenchSecondaryButton icon={ArrowLeft} onClick={() => navigate('/instances')}>
            返回列表
          </WorkbenchSecondaryButton>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <WorkbenchSection
          title="基础信息"
          description="实例的标识与所属 Pack。Pack 决定启动命令、变量模板与生命周期管理。"
          icon={Tag}
        >
          <div className="space-y-5">
            {error && (
              <WorkbenchNote tone="rose" icon={AlertTriangle}>
                {error}
              </WorkbenchNote>
            )}
            {success && (
              <WorkbenchNote tone="emerald" icon={CheckCircle2}>
                实例创建成功，正在跳转...
              </WorkbenchNote>
            )}

            {/* v4.6.0-E3: 配额提示横幅（非 server_admin 且配额存在时显示） */}
            {!isServerAdmin &&
              quota &&
              quota.quota &&
              (quota.quota.max_instances != null || quota.quota.max_disk_mb != null) && (
                <WorkbenchNote
                  tone={quota.can_create_instance === false ? 'rose' : 'blue'}
                  icon={quota.can_create_instance === false ? AlertTriangle : Info}
                >
                  <span className="font-semibold">配额提示：</span>
                  {quota.quota.max_instances != null && (
                    <span>
                      {' '}
                      实例 {quota.usage.instances_used}/{quota.quota.max_instances}
                    </span>
                  )}
                  {quota.quota.max_instances != null && quota.quota.max_disk_mb != null && (
                    <span>；</span>
                  )}
                  {quota.quota.max_disk_mb != null && (
                    <span>
                      {' '}
                      磁盘 {quota.usage.disk_used_mb}/{quota.quota.max_disk_mb} MB
                    </span>
                  )}
                  {quota.can_create_instance === false && (
                    <span>（已满，无法创建新实例）</span>
                  )}
                </WorkbenchNote>
              )}

            {/* 7.5: 草稿恢复提示——挂载时若存在草稿，提示恢复或丢弃 */}
            {hasDraft && !draftPromptResolved && (
              <WorkbenchNote tone="blue" icon={Info}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>发现未提交的草稿，是否恢复？</span>
                  <div className="flex gap-2">
                    <WorkbenchPrimaryButton
                      onClick={() => {
                        const draft = restoreDraft();
                        if (draft) {
                          setName(draft.name ?? '');
                          setPackId(draft.packId ?? '');
                          setNodeId(draft.nodeId ?? '');
                        }
                        setDraftPromptResolved(true);
                      }}
                    >
                      恢复
                    </WorkbenchPrimaryButton>
                    <WorkbenchSecondaryButton
                      onClick={() => {
                        clearDraft();
                        setDraftPromptResolved(true);
                      }}
                    >
                      丢弃
                    </WorkbenchSecondaryButton>
                  </div>
                </div>
              </WorkbenchNote>
            )}

            <div>
              <label htmlFor="create-name" className={LABEL_CLASS}>
                实例名称 <span className="ml-1 normal-case tracking-normal text-rose-500">*</span>
              </label>
              <input
                id="create-name"
                type="text"
                className={`mt-2 ${INPUT_CLASS}`}
                value={name}
                onChange={(e) => handleChange('name', e.target.value)}
                onBlur={(e) => handleBlur('name', e.target.value)}
                placeholder="例如：我的生存服"
                required
                maxLength={64}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'create-name-error' : undefined}
              />
              <p className={HINT_CLASS}>玩家可见的实例名，1-64 个字符。</p>
              {fieldErrors.name && (
                <p id="create-name-error" className={ERROR_CLASS}>
                  {fieldErrors.name}
                </p>
              )}
            </div>
          </div>
        </WorkbenchSection>

        <WorkbenchSection
          title="部署配置"
          description="选择 Pack、部署节点与游戏版本。这些字段决定实例的运行环境。"
          icon={Package}
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="create-pack" className={LABEL_CLASS}>
                Pack <span className="ml-1 normal-case tracking-normal text-rose-500">*</span>
              </label>
              <p className={`mb-2 ${HINT_CLASS}`}>
                Pack 是游戏配置包，包含启动参数、命令定义等。
              </p>
              {loadingPacks ? (
                <p className={HINT_CLASS}>加载 Pack 列表中…</p>
              ) : packs.length === 0 ? (
                <p className={HINT_CLASS}>没有可用的 Pack，请先在 Panel 注册 Pack。</p>
              ) : (
                <select
                  id="create-pack"
                  className={SELECT_CLASS}
                  value={packId}
                  onChange={(e) => setPackId(e.target.value)}
                  required
                >
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name} — {p.game}/{p.variant} (v{p.version})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="create-node" className={LABEL_CLASS}>
                部署节点 <span className="ml-1 normal-case tracking-normal text-rose-500">*</span>
              </label>
              {loadingNodes ? (
                <p className={`mt-2 ${HINT_CLASS}`}>加载节点列表中…</p>
              ) : nodes.length === 0 ? (
                <p className={`mt-2 ${HINT_CLASS}`}>没有可用的部署节点。</p>
              ) : (
                <select
                  id="create-node"
                  className={`mt-2 ${SELECT_CLASS}`}
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  required
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}（{n.status === 'online' ? '在线' : '离线'}）
                    </option>
                  ))}
                </select>
              )}
              <p className={HINT_CLASS}>选择实例部署的目标节点。</p>
            </div>

            {/* v3.4.0: 版本选择 */}
            {versions.length > 0 && (
              <div>
                <label htmlFor="create-version" className={LABEL_CLASS}>
                  游戏版本
                </label>
                {loadingVersions ? (
                  <p className={`mt-2 ${HINT_CLASS}`}>加载版本列表中…</p>
                ) : (
                  <select
                    id="create-version"
                    className={`mt-2 ${SELECT_CLASS}`}
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.version}
                      </option>
                    ))}
                  </select>
                )}
                <p className={HINT_CLASS}>选择实例使用的游戏版本，默认最新。</p>
              </div>
            )}
          </div>
        </WorkbenchSection>

        {/* v3-billing: 实例计费配置（类型选择 + 周期选择 + 实时价格预览） */}
        <WorkbenchSection
          title="实例计费"
          description="选择实例类型与计费周期。创建实例时将预付费扣全额，到期后自动续扣。"
          icon={Wallet}
        >
          <div className="space-y-5">
            {loadingTypes ? (
              <p className={HINT_CLASS}>加载实例类型定价中…</p>
            ) : typePricings.length === 0 ? (
              <WorkbenchNote tone="blue" icon={Info}>
                暂无类型定价配置，将使用系统默认 small 类型计费。
              </WorkbenchNote>
            ) : (
              <>
                <div>
                  <label className={LABEL_CLASS}>实例类型</label>
                  <p className={`mb-3 ${HINT_CLASS}`}>
                    不同类型对应不同的资源配额与月费，请按实际需求选择。
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {typePricings.map((t) => {
                      const isSelected = selectedInstanceType === t.instance_type;
                      return (
                        <button
                          key={t.instance_type}
                          type="button"
                          onClick={() => setSelectedInstanceType(t.instance_type)}
                          className={`rounded-[14px] border p-4 text-left transition ${
                            isSelected
                              ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-700">
                              {t.display_name}
                            </span>
                            {isSelected && (
                              <CheckCircle2 size={16} className="text-blue-500" />
                            )}
                          </div>
                          <div className="mt-1 text-lg font-bold text-slate-800">
                            ¥{t.monthly_price}
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              /月
                            </span>
                          </div>
                          <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                            {t.recommended_slots != null && (
                              <div>推荐 {t.recommended_slots} 人</div>
                            )}
                            {t.cpu_limit && <div>CPU {t.cpu_limit} 核</div>}
                            {t.memory_limit_mb != null && (
                              <div>内存 {t.memory_limit_mb} MB</div>
                            )}
                            {t.disk_limit_gb != null && (
                              <div>磁盘 {t.disk_limit_gb} GB</div>
                            )}
                          </div>
                          {t.description && (
                            <p className="mt-2 text-xs leading-5 text-slate-400">
                              {t.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>计费周期</label>
                  <p className={`mb-3 ${HINT_CLASS}`}>
                    选择更长周期可享受折扣优惠，到期后自动按相同周期续扣。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CYCLE_OPTIONS.map((opt) => {
                      const isSelected = billingCycleMonths === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBillingCycleMonths(opt.value)}
                          className={`rounded-[12px] border px-4 py-2 text-sm font-medium transition ${
                            isSelected
                              ? 'border-blue-400 bg-blue-50 text-blue-600 ring-2 ring-blue-200'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* v3-billing: 价格预览 */}
                <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                      应付金额
                    </span>
                    {loadingPreview ? (
                      <span className="text-xs text-slate-400">计算中…</span>
                    ) : pricePreview ? (
                      <div className="text-right">
                        <div className="text-2xl font-bold text-slate-800">
                          {pricePreview.amount}
                          <span className="ml-1 text-sm font-normal text-slate-400">
                            点券
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {pricePreview.monthly_price_effective} ×{' '}
                          {pricePreview.billing_cycle_months} 月
                          {pricePreview.cycle_discount_applied < 1 && (
                            <span className="ml-1 text-emerald-600">
                              （{(pricePreview.cycle_discount_applied * 10).toFixed(1)}折）
                            </span>
                          )}
                          {' · '}
                          有效期 {pricePreview.duration_days} 天
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">无法预览</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </WorkbenchSection>

        <div className="flex flex-wrap justify-end gap-2">
          <WorkbenchSecondaryButton
            onClick={() => navigate('/instances')}
            disabled={submitting || success}
          >
            取消
          </WorkbenchSecondaryButton>
          <WorkbenchPrimaryButton
            type="submit"
            disabled={submitting || loadingPacks || loadingNodes || success}
          >
            {submitting ? '创建中…' : '创建实例'}
          </WorkbenchPrimaryButton>
        </div>
      </form>
    </WorkbenchShell>
  );
}
