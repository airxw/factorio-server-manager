// ============================================================================
// Nodes — 部署节点管理页（I4，v4.4.0-M1；L2 集群化管理扩展）
// 数据源：api.listNodes() + api.scanNodeJavas(nodeId) +
//         api.createNodeInvite(req) + api.deleteNode(nodeId)
// 功能：
//   1. 节点列表（类型 / 名称 / 状态 / Daemon 地址 / 注册时间 / 操作）
//   2. 每行「Java 环境」按钮 → 展开 JavaInstallationsPanel
//   3. 顶部「添加节点」按钮 → 弹窗输入名称 → 返回 linkKey + slave 启动命令
//   4. slave 节点「删除」按钮（master 不可删，删除前校验无活跃实例）
// ============================================================================

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  Coffee,
  Download,
  Info,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type { NodeInfo } from '../../api/modules/servers';
import type { CreateNodeInviteResponse, ServerSummary } from '@public/schema/panel-api-types';
import type { InstanceState, ScanJavasResult } from '@public/schema/daemon-api-types';
import { useNodeInstances } from '../../api/queries/servers';
import { EmptyState, Modal, useConfirm, useToast } from '../../components/ui';
import { getEffectiveRole, isInstanceAdminOrAbove } from '../../utils/role';
import JavaInstallationsPanel from '../../components/JavaInstallationsPanel';
import { nodeStatusStore } from '../../stores/nodeStatusStore';

/** 节点状态徽章（L2 扩展：支持 online/offline/pending/degraded） */
function NodeStatusBadge({ status }: { status: NodeInfo['status'] }) {
  const map: Record<NodeInfo['status'], { label: string; className: string; icon?: ReactNode }> = {
    online: { label: '在线', className: 'badge badge-running' },
    offline: { label: '离线', className: 'badge badge-error', icon: <XCircle size={12} /> },
    pending: { label: '待注册', className: 'badge badge-warning' },
    degraded: { label: '降级', className: 'badge badge-warning' },
  };
  const cfg = map[status] ?? map.offline;
  return (
    <span className={cfg.className} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/** 节点类型徽章 */
function NodeTypeBadge({ nodeType }: { nodeType: NodeInfo['node_type'] }) {
  if (nodeType === 'master') {
    return <span className="badge badge-info">主节点</span>;
  }
  return <span className="badge badge-default">从节点</span>;
}

/** 实例运行状态文案（对齐 Servers.tsx 的 STATE_LABEL） */
const INSTANCE_STATE_LABEL: Record<InstanceState, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  error: '错误',
};

/** 实例有效期紧凑展示（对齐 Servers.tsx getExpiryDisplay 逻辑） */
function getInstanceExpiryDisplay(
  expiresAt: string | null,
  expiryStatus: ServerSummary['expiry_status'],
): { text: string; color?: string } {
  if (expiryStatus === 'permanent' || expiresAt === null) {
    return { text: '永久', color: 'var(--color-text-muted)' };
  }
  if (expiryStatus === 'cleaned') {
    return { text: '已清理', color: 'var(--color-text-muted)' };
  }
  if (expiryStatus === 'expired') {
    return { text: '已过期', color: 'var(--color-danger)' };
  }
  if (expiryStatus === 'grace') {
    return { text: '宽限期', color: 'var(--color-warning)' };
  }
  const expiryDate = new Date(expiresAt);
  const daysLeft = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
  const text = expiryDate.toLocaleDateString('zh-CN');
  if (daysLeft <= 3) {
    return { text, color: 'var(--color-warning)' };
  }
  return { text };
}

/**
 * 节点实例列表展开面板（lazy load：仅在展开挂载时调用 useNodeInstances）。
 * Apple 清新风格——紧凑卡片网格 + CSS transition 淡入动画。
 */
function NodeInstancesPanel({ nodeId }: { nodeId: string }) {
  const { data, isLoading, error } = useNodeInstances(nodeId);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const instances = data?.instances ?? [];
  const containerStyle = {
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(-4px)',
    transition: 'opacity 180ms ease-out, transform 180ms ease-out',
  };

  return (
    <div style={containerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
        }}
      >
        <Boxes size={14} style={{ color: 'var(--color-primary, #2563eb)' }} />
        <strong style={{ color: 'var(--color-text-primary)' }}>实例列表</strong>
        {!isLoading && !error && (
          <span style={{ color: 'var(--color-text-muted)' }}>（{instances.length} 个）</span>
        )}
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>加载实例中…</div>
      ) : error ? (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} />
          {error instanceof Error ? error.message : '加载实例失败'}
        </div>
      ) : instances.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>该节点暂无实例</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 8,
          }}
        >
          {instances.map((inst) => {
            const exp = getInstanceExpiryDisplay(inst.expires_at, inst.expiry_status);
            return (
              <div
                key={inst.id}
                style={{
                  background: 'var(--color-bg, #fff)',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--color-text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={inst.name}
                  >
                    {inst.name}
                  </span>
                  <span className={`badge badge-${inst.status}`}>
                    {INSTANCE_STATE_LABEL[inst.status]}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 10px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span>游戏：{inst.game_type}</span>
                  <span>归属：{inst.owner_username}</span>
                  <span style={{ color: exp.color }}>有效期：{exp.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 单个节点的展开行（包含 Java 扫描结果与 JavaInstallationsPanel） */
interface NodeRowState {
  expanded: boolean;
  loading: boolean;
  result: ScanJavasResult | null;
  error: string | null;
}

/** 添加节点弹窗的状态 */
interface AddNodeState {
  open: boolean;
  submitting: boolean;
  name: string;
  displayFqdn: string;
  result: CreateNodeInviteResponse | null;
  error: string | null;
  /** 部署引导 Tab：command=复制命令 / script=下载脚本 / manual=手动步骤 */
  activeTab: 'command' | 'script' | 'manual';
}

const INITIAL_ADD_STATE: AddNodeState = {
  open: false,
  submitting: false,
  name: '',
  displayFqdn: '',
  result: null,
  error: null,
  activeTab: 'command',
};

/**
 * v4.28.0: 节点部署开关
 * 当前项目未开源，部署脚本位于私密仓库，节点部署功能暂不启用。
 * 用户仍可点击「添加节点」进入弹窗查看部署引导内容（命令模板、脚本说明、手动步骤），
 * 但实际部署动作（创建邀请、下载脚本）禁用。开源后将此标志改为 true 即可启用实际部署。
 */
const NODE_DEPLOYMENT_ENABLED = false;

/**
 * v4.28.0: 未开源场景下的部署引导占位数据
 * 让用户能在不实际创建邀请的情况下查看部署引导内容与实现机制
 */
const DEPLOYMENT_PREVIEW_RESULT: CreateNodeInviteResponse = {
  node_id: 'preview-node-id（示例，未实际创建）',
  link_key: 'gsp_link_preview_example_key_not_valid_for_real_registration',
  slave_command:
    'SLAVE_MODE=true MASTER_URL=https://gsp.ecsrz.com:3001 LINK_KEY=gsp_link_preview_example_key_not_valid_for_real_registration npm run start:slave',
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

export default function Nodes() {
  const { api, user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 每个节点的展开态 + Java 扫描结果（按 node.id 索引）
  const [rowStates, setRowStates] = useState<Record<string, NodeRowState>>({});
  // L2: 添加节点弹窗
  const [addState, setAddState] = useState<AddNodeState>(INITIAL_ADD_STATE);
  // L2: 删除节点中（按 nodeId 索引，避免重复点击）
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  // v4.31.0: 节点实例列表展开态（按 nodeId 索引；lazy load，仅展开时挂载 NodeInstancesPanel）
  const [expandedInstancesId, setExpandedInstancesId] = useState<string | null>(null);

  const refreshNodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listNodes();
      // 兼容字段：daemon_url = fqdn
      const enriched = res.nodes.map((n) => ({ ...n, daemon_url: n.fqdn || n.daemon_url }));
      setNodes(enriched);
    } catch (err) {
      const msg =
        err instanceof PanelApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '加载节点列表失败';
      setError(msg);
      toast.error('加载节点列表失败', err);
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  useEffect(() => {
    void refreshNodes();
  }, [refreshNodes]);

  // L2: 订阅 node.status WS 事件，节点上线/离线时自动刷新列表
  useEffect(() => {
    const unsubscribe = nodeStatusStore.subscribe(() => {
      void refreshNodes();
    });
    return unsubscribe;
  }, [refreshNodes]);

  /** 判断端点是否不存在（404/网络错误） */
  const isUnavailable = useCallback((err: unknown): boolean => {
    if (err instanceof PanelApiError) {
      return err.status === 404 || err.code === 'HTTP_404' || err.code === 'NETWORK_ERROR';
    }
    return true;
  }, []);

  /** 拉取某节点的 Java 扫描结果 */
  const scanJavas = useCallback(
    async (nodeId: string) => {
      setRowStates((prev) => ({
        ...prev,
        [nodeId]: {
          expanded: true,
          loading: true,
          result: prev[nodeId]?.result ?? null,
          error: null,
        },
      }));
      try {
        const result = await api.scanNodeJavas(nodeId);
        setRowStates((prev) => ({
          ...prev,
          [nodeId]: { expanded: true, loading: false, result, error: null },
        }));
      } catch (err) {
        const msg =
          err instanceof PanelApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '扫描 Java 失败';
        setRowStates((prev) => ({
          ...prev,
          [nodeId]: {
            expanded: true,
            loading: false,
            result: prev[nodeId]?.result ?? null,
            error: isUnavailable(err) ? 'Java 扫描接口暂未开放' : msg,
          },
        }));
      }
    },
    [api, isUnavailable],
  );

  /** 切换某行展开 / 折叠；首次展开触发 Java 扫描 */
  const toggleExpand = useCallback(
    (node: NodeInfo) => {
      const current = rowStates[node.id];
      if (current?.expanded) {
        // 折叠
        setRowStates((prev) => ({
          ...prev,
          [node.id]: { ...current, expanded: false },
        }));
        return;
      }
      // 展开：若已有结果则直接展开，否则触发扫描
      if (current?.result) {
        setRowStates((prev) => ({
          ...prev,
          [node.id]: { ...current, expanded: true },
        }));
      } else {
        void scanJavas(node.id);
      }
    },
    [rowStates, scanJavas],
  );

  /** L2: 打开添加节点弹窗 */
  const openAddDialog = useCallback(() => {
    if (!NODE_DEPLOYMENT_ENABLED) {
      // v4.28.0: 未开源场景——直接展示部署引导内容（占位数据），不进入表单流程
      setAddState({
        ...INITIAL_ADD_STATE,
        open: true,
        result: DEPLOYMENT_PREVIEW_RESULT,
      });
      return;
    }
    setAddState({ ...INITIAL_ADD_STATE, open: true });
  }, []);

  /** L2: 关闭添加节点弹窗 */
  const closeAddDialog = useCallback(() => {
    setAddState(INITIAL_ADD_STATE);
  }, []);

  /** L2: 提交创建邀请 */
  const submitAddNode = useCallback(async () => {
    if (!addState.name.trim()) {
      setAddState((s) => ({ ...s, error: '节点名称必填' }));
      return;
    }
    setAddState((s) => ({ ...s, submitting: true, error: null }));
    try {
      const result = await api.createNodeInvite({
        name: addState.name.trim(),
        ...(addState.displayFqdn.trim() ? { display_fqdn: addState.displayFqdn.trim() } : {}),
      });
      setAddState((s) => ({ ...s, submitting: false, result }));
      toast.success('节点邀请已创建，请复制 slave 启动命令到目标机器执行');
    } catch (err) {
      const msg =
        err instanceof PanelApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '创建节点邀请失败';
      setAddState((s) => ({ ...s, submitting: false, error: msg }));
      toast.error('创建节点邀请失败', err);
    }
  }, [api, addState, toast]);

  /** L2: 复制文本到剪贴板 */
  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(`${label}已复制到剪贴板`);
      } catch {
        toast.error('复制失败，请手动选择文本复制');
      }
    },
    [toast],
  );

  /** L2: v4.22.9 下载后端生成的 slave-bootstrap.sh（替换原前端字符串拼接） */
  const downloadBootstrapScript = useCallback(
    async (result: CreateNodeInviteResponse) => {
      try {
        const script = await api.downloadNodeBootstrapScript(result.link_key);
        const blob = new Blob([script], { type: 'text/x-shellscript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'slave-bootstrap.sh';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('部署脚本已下载');
      } catch (err) {
        const msg =
          err instanceof PanelApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '下载部署脚本失败';
        toast.error('下载部署脚本失败', err);
        setError(msg);
      }
    },
    [api, toast],
  );

  /** L2: v4.22.9 重新生成邀请密钥（针对 pending 节点） */
  const handleRegenerateInvite = useCallback(
    async (node: NodeInfo) => {
      const ok = await confirm({
        title: '重新生成邀请密钥',
        message:
          `确认重新生成节点「${node.name}」的邀请密钥？\n` +
          `原密钥将立即失效，已生成的部署脚本也无法再下载。`,
        danger: true,
        confirmText: '重新生成',
      });
      if (!ok) return;
      try {
        const result = await api.regenerateInvite(node.id);
        setAddState({
          ...INITIAL_ADD_STATE,
          open: true,
          result,
        });
        toast.success('邀请密钥已重新生成，请复制新密钥到目标机器执行');
        await refreshNodes();
      } catch (err) {
        const msg =
          err instanceof PanelApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '重新生成邀请密钥失败';
        toast.error('重新生成邀请密钥失败', err);
        setError(msg);
      }
    },
    [api, confirm, refreshNodes, toast],
  );

  /** L2: 删除 slave 节点 */
  const handleDeleteNode = useCallback(
    async (node: NodeInfo) => {
      if (node.node_type === 'master') {
        toast.error('主节点不可删除');
        return;
      }
      const ok = await confirm({
        title: '删除节点确认',
        message: `确认删除从节点「${node.name}」？\n该操作不可恢复，请确保节点下无活跃实例。`,
        danger: true,
        confirmText: '删除',
      });
      if (!ok) return;
      setDeletingIds((prev) => new Set(prev).add(node.id));
      try {
        await api.deleteNode(node.id);
        toast.success(`节点「${node.name}」已删除`);
        await refreshNodes();
      } catch (err) {
        const msg =
          err instanceof PanelApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '删除节点失败';
        toast.error('删除节点失败', err);
        setError(msg);
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }
    },
    [api, confirm, refreshNodes, toast],
  );

  // v4.28.0: 组件守卫从 server_admin+ 降级到 instance_admin+（部署节点对实例管理员开放）
  if (!isInstanceAdminOrAbove(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">部署节点</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refreshNodes()} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button
            className="btn btn-primary"
            onClick={openAddDialog}
            title={NODE_DEPLOYMENT_ENABLED ? '添加从节点' : '查看部署引导（节点部署暂未启用）'}
          >
            <Plus size={14} />
            添加节点
          </button>
        </div>
      </div>

      {/* v4.28.0: 未开源提示横幅——部署脚本在私密仓库，节点部署暂不启用，但仍可查看实现机制 */}
      {!NODE_DEPLOYMENT_ENABLED && (
        <div
          className="alert alert-info"
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}
        >
          <Info size={16} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, lineHeight: 1.6 }}>
            <strong>节点部署暂未启用</strong>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              当前项目尚未开源，部署脚本位于私密仓库。点击「添加节点」可查看完整的部署引导内容
             （命令模板、脚本说明、手动步骤），但实际部署动作暂不启用。开源后将自动开放实际部署能力。
            </div>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {nodes.length === 0 && !loading ? (
        <EmptyState
          icon={<Server size={32} />}
          title="暂无部署节点"
          description="点击「添加节点」生成 slave 节点邀请密钥，然后在目标机器执行启动命令完成注册"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>类型</th>
                <th>名称</th>
                <th>状态</th>
                <th>Daemon 地址</th>
                <th>注册时间 / 邀请过期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const rs = rowStates[node.id];
                const expanded = rs?.expanded ?? false;
                const isDeleting = deletingIds.has(node.id);
                return (
                  <Fragment key={node.id}>
                    <tr>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 4px' }}
                          aria-label={expanded ? '折叠 Java 环境' : '展开 Java 环境'}
                          onClick={() => toggleExpand(node)}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td>
                        <NodeTypeBadge nodeType={node.node_type} />
                      </td>
                      <td>{node.name}</td>
                      <td>
                        <NodeStatusBadge status={node.status} />
                      </td>
                      <td className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                        {node.fqdn || node.display_fqdn || '—'}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {node.status === 'pending' && node.link_key_expires_at ? (
                          <span title="邀请密钥过期时间" style={{ color: 'var(--color-warning, #d97706)' }}>
                            ⏰ {node.link_key_expires_at}
                          </span>
                        ) : (
                          node.linked_at ?? '—'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleExpand(node)}
                          disabled={rs?.loading}
                          title="扫描 Java 环境"
                        >
                          <Coffee size={13} />
                          {rs?.loading ? '扫描中…' : 'Java'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setExpandedInstancesId((prev) => (prev === node.id ? null : node.id))
                          }
                          title={expandedInstancesId === node.id ? '收起实例列表' : '查看该节点下的实例'}
                          aria-expanded={expandedInstancesId === node.id}
                          style={{ marginLeft: 4 }}
                        >
                          <Boxes size={13} />
                          {expandedInstancesId === node.id ? '收起实例' : '查看实例'}
                        </button>
                        {node.node_type === 'slave' && node.status === 'pending' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleRegenerateInvite(node)}
                            title="重新生成邀请密钥（原密钥将立即失效）"
                            style={{ marginLeft: 4, color: 'var(--color-primary, #2563eb)' }}
                          >
                            <RefreshCw size={13} />
                            重新邀请
                          </button>
                        )}
                        {node.node_type === 'slave' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleDeleteNode(node)}
                            disabled={isDeleting}
                            title="删除从节点"
                            style={{ marginLeft: 4, color: 'var(--color-danger, #dc2626)' }}
                          >
                            <Trash2 size={13} />
                            {isDeleting ? '删除中…' : '删除'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${node.id}-detail`}>
                        <td colSpan={7} style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: '12px 16px' }}>
                          {rs?.error ? (
                            <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <AlertTriangle size={14} />
                              {rs.error}
                            </div>
                          ) : null}
                          <JavaInstallationsPanel
                            result={rs?.result ?? null}
                            loading={rs?.loading ?? false}
                            onRescan={() => {
                              void scanJavas(node.id);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                    {expandedInstancesId === node.id && (
                      <tr key={`${node.id}-instances`}>
                        <td
                          colSpan={7}
                          style={{
                            background: 'var(--color-bg-secondary, #f9fafb)',
                            padding: '12px 16px',
                          }}
                        >
                          <NodeInstancesPanel nodeId={node.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* L2: 添加节点弹窗（v4.28.0: size=lg 适配长代码与多步骤部署引导） */}
      <Modal
        open={addState.open}
        title={addState.result ? (NODE_DEPLOYMENT_ENABLED ? '节点邀请已创建' : '部署引导（预览）') : '添加从节点'}
        onClose={closeAddDialog}
        disableClose={addState.submitting}
        size="lg"
        footer={
          addState.result ? (
            <button className="btn btn-primary" onClick={closeAddDialog}>
              完成
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={closeAddDialog} disabled={addState.submitting}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void submitAddNode()}
                disabled={addState.submitting || !addState.name.trim()}
              >
                {addState.submitting ? '创建中…' : '创建邀请'}
              </button>
            </>
          )
        }
      >
        {addState.result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* v4.28.0: 未开源场景提示——展示部署引导内容，但实际部署动作禁用 */}
            {!NODE_DEPLOYMENT_ENABLED && (
              <div
                className="alert alert-warning"
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
              >
                <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ lineHeight: 1.6 }}>
                  <strong>节点部署暂未启用（预览模式）</strong>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    以下为部署引导示例内容，用于展示实现机制。当前项目未开源，部署脚本位于私密仓库，
                    实际创建邀请与下载脚本动作已禁用。开源后将自动开放实际部署能力。
                  </div>
                </div>
              </div>
            )}

            <div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <strong>
                  {NODE_DEPLOYMENT_ENABLED
                    ? '邀请密钥仅显示一次，请立即复制保存！'
                    : '示例邀请密钥（不可用于实际注册）'}
                </strong>
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  节点 ID：<code>{addState.result.node_id}</code>
                </div>
                {addState.result.expires_at && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-warning, #d97706)' }}>
                    ⏰ 邀请密钥过期时间：<code>{addState.result.expires_at}</code>
                    <span style={{ marginLeft: 4 }}>（过期后需重新生成）</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tab 切换 */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
              {([
                { key: 'command', label: '复制命令' },
                { key: 'script', label: '下载脚本' },
                { key: 'manual', label: '手动步骤' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{
                    borderRadius: 0,
                    borderBottom: addState.activeTab === tab.key ? '2px solid var(--color-primary, #2563eb)' : '2px solid transparent',
                    fontWeight: addState.activeTab === tab.key ? 600 : 400,
                  }}
                  onClick={() => setAddState((s) => ({ ...s, activeTab: tab.key }))}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 1: 复制命令 */}
            {addState.activeTab === 'command' && (
              <>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                    邀请密钥（linkKey）
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input"
                      readOnly
                      value={addState.result.link_key}
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void copyToClipboard(addState.result!.link_key, '邀请密钥')}
                    >
                      复制
                    </button>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                    slave 启动命令（在目标机器执行）
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      className="form-input"
                      readOnly
                      value={addState.result.slave_command}
                      rows={3}
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void copyToClipboard(addState.result!.slave_command, '启动命令')}
                    >
                      复制
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  提示：在 slave 机器设置环境变量 <code>SLAVE_MODE=true</code>、<code>MASTER_URL</code>（指向本 Panel）、
                  <code>LINK_KEY</code>（上方密钥），然后启动 daemon 即可自动注册。
                </div>
              </>
            )}

            {/* Tab 2: 下载脚本 */}
            {addState.activeTab === 'script' && (
              <>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  下载一键部署脚本，上传到目标 Debian/Ubuntu 机器后执行：
                </div>
                <div style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}>
                  <div style={{ color: 'var(--color-text-secondary)' }}># 上传后执行</div>
                  <div>chmod +x slave-bootstrap.sh</div>
                  <div>sudo bash slave-bootstrap.sh</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  脚本已注入 MASTER_URL 和 LINK_KEY，执行后自动安装 Node.js、克隆项目、配置 systemd 并启动 daemon。
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => void downloadBootstrapScript(addState.result!)}
                  disabled={!NODE_DEPLOYMENT_ENABLED}
                  title={
                    NODE_DEPLOYMENT_ENABLED
                      ? '下载 slave-bootstrap.sh'
                      : '节点部署暂未启用（项目未开源）'
                  }
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Download size={14} />
                  下载 slave-bootstrap.sh
                </button>
                {!NODE_DEPLOYMENT_ENABLED && (
                  <div style={{ fontSize: 12, color: 'var(--color-warning, #d97706)', marginTop: 4 }}>
                    ⚠️ 部署脚本位于私密仓库，开源后开放下载
                  </div>
                )}
              </>
            )}

            {/* Tab 3: 手动步骤 */}
            {addState.activeTab === 'manual' && (
              <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--color-text-primary)' }}>
                <ol style={{ paddingLeft: 20, margin: 0 }}>
                  <li>
                    SSH 登录目标 Debian/Ubuntu 机器
                  </li>
                  <li>
                    安装 Node.js 20+：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git`}</pre>
                  </li>
                  <li>
                    创建用户并克隆项目：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`useradd -r -m -s /bin/bash gameserver
sudo -u gameserver git clone --depth 1 https://github.com/airxw/GSP-Panel.git /opt/gsp-slave`}</pre>
                  </li>
                  <li>
                    安装依赖并构建：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`cd /opt/gsp-slave/daemon
sudo -u gameserver npm install
sudo -u gameserver npm run build
sudo -u gameserver npm prune --production`}</pre>
                  </li>
                  <li>
                    创建配置文件 <code>/opt/gsp-slave/daemon/.env</code>：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`SLAVE_MODE=true
MASTER_URL=${addState.result.slave_command.match(/MASTER_URL=(\S+)/)?.[1] ?? 'https://gsp.ecsrz.com:3001'}
LINK_KEY=${addState.result.link_key}
PORT=8080
LOG_LEVEL=info`}</pre>
                  </li>
                  <li>
                    创建 systemd 服务 <code>/etc/systemd/system/gsp-slave-daemon.service</code>：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`[Unit]
Description=GSP Slave Daemon
After=network.target

[Service]
Type=simple
User=gameserver
WorkingDirectory=/opt/gsp-slave/daemon
EnvironmentFile=/opt/gsp-slave/daemon/.env
ExecStart=/usr/bin/node /opt/gsp-slave/daemon/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target`}</pre>
                  </li>
                  <li>
                    启动服务：
                    <pre style={{ background: 'var(--color-bg-secondary, #f9fafb)', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto', marginTop: 4 }}>{`mkdir -p /opt/gsp-slave/daemon/data
chown gameserver:gameserver /opt/gsp-slave/daemon/data
systemctl daemon-reload
systemctl enable --now gsp-slave-daemon
systemctl status gsp-slave-daemon`}</pre>
                  </li>
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                节点名称 <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <input
                className="form-input"
                value={addState.name}
                onChange={(e) => setAddState((s) => ({ ...s, name: e.target.value, error: null }))}
                placeholder="如：节点-北京-01"
                maxLength={100}
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                对外展示地址（可选）
              </label>
              <input
                className="form-input"
                value={addState.displayFqdn}
                onChange={(e) => setAddState((s) => ({ ...s, displayFqdn: e.target.value }))}
                placeholder="如：http://slave.example.com:8080"
              />
            </div>
            {addState.error && <div className="alert alert-error">{addState.error}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
