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
} from 'lucide-react';
import type { CreateServerRequest } from '@public/schema/panel-api-types';
import type { PackSummary } from '@public/schema/panel-api-types';
import type { GameVersionSummary } from '@public/schema/panel-api-types';
import type { MyQuotaResponse } from '@public/schema/panel-api-types';
import type { NodeInfo } from '../api/client';
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
      const req: CreateServerRequest = {
        name: name.trim(),
        pack_id: packId,
        node_id: nodeId,
        version_id: versionId || undefined,
      };

      setSubmitting(true);
      try {
        const res = await api.createServer(req);
        setSuccess(true);
        // 6.5: 成功 Toast 反馈
        toast.success('实例创建成功');
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
    [submitting, name, packId, nodeId, api, navigate, clearDraft, toast, isServerAdmin, quota],
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
