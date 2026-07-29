// ============================================================================
// Packs — Pack 管理（仅 admin/system_admin 可见）
// 路径：/admin/packs
// 功能：
//   1. 列出所有已加载的 Pack（id/game/variant/display_name/version/ui_tabs）
//   2. 查看 Pack 完整 YAML 详情
//   3. 在线编辑/创建/删除 Pack（后端 API 支持 CRUD）
//   4. 重载 Pack（POST /api/packs/reload）
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import type { ListPacksResponse, PackSummary } from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import type { DeletePackPreviewResponse } from '../../api/modules/servers';
import { useDestructiveAction } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

const GAME_TYPE_OPTIONS = [
  'minecraft', 'factorio', 'rust', 'ark', 'palworld', 'custom',
  'terraria', 'valheim', 'zomboid',
] as const;

interface ReloadResult {
  loaded: string[];
  failed: Array<{ pack: string; error: string }>;
  total: number;
}

interface PackDetail {
  id: string;
  yaml_path: string;
  content: string;
}

// ============================================================================
// Pack CRUD API helpers
// v4.x.x: 全部改走 useAuth().api 统一鉴权（修复 localStorage token 不刷新 bug）
// ============================================================================

/** 将 API 客户端返回的 GetPackYamlResponse 转换为本地 PackDetail 视图模型 */
function toPackDetail(res: {
  id: string;
  yaml_path: string;
  content: string;
}): PackDetail {
  return { id: res.id, yaml_path: res.yaml_path, content: res.content };
}

export default function Packs() {
  const { api, user } = useAuth();

  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<ReloadResult | null>(null);

  // 编辑模态
  const [editTarget, setEditTarget] = useState<PackSummary | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 新建模态
  const [showCreate, setShowCreate] = useState(false);
  const [createId, setCreateId] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 删除确认（仅保留 target，弹窗改走 useDestructiveAction + ConfirmDialog）
  const [deleteTarget, setDeleteTarget] = useState<PackSummary | null>(null);

  // B2: 破坏性操作统一 hook —— Pack 删除（含 dry-run 预览）
  const deleteAction = useDestructiveAction<DeletePackPreviewResponse, string>({
    preview: async (packId) => api.previewDeletePack(packId),
    execute: async (packId) => {
      await api.deletePack(packId);
    },
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: ListPacksResponse = await api.listPacks();
      setPacks(res.packs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Pack 列表失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleReload = async () => {
    setReloading(true);
    setError(null);
    setSuccess(null);
    setReloadResult(null);
    try {
      const result = await api.reloadPacks();
      setReloadResult(result);
      setSuccess(
        `已重载 ${result.total} 个 Pack（成功 ${result.loaded.length}，失败 ${result.failed.length}）`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重载 Pack 失败');
    } finally {
      setReloading(false);
    }
  };

  // 打开编辑弹窗：拉取完整 YAML
  const openEdit = async (p: PackSummary) => {
    setEditTarget(p);
    setEditContent('');
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await api.getPackYaml(p.id);
      setEditContent(toPackDetail(res).content);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '加载 Pack 详情失败');
    } finally {
      setEditLoading(false);
    }
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditContent('');
    setEditError(null);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editTarget || !editContent.trim()) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await api.updatePackYaml(editTarget.id, { content: editContent });
      setSuccess(`Pack ${editTarget.id} 已保存`);
      closeEdit();
      await handleReload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '保存失败');
      setEditLoading(false);
    }
  };

  // 新建 Pack
  const handleCreate = async () => {
    if (!createId.trim() || !createContent.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      await api.createPack({ pack_id: createId.trim(), content: createContent });
      setSuccess(`Pack ${createId.trim()} 已创建`);
      setShowCreate(false);
      setCreateId('');
      setCreateContent('');
      await handleReload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
      setCreateLoading(false);
    }
  };

  // 删除 Pack —— 走 useDestructiveAction preview → confirm → execute 流程
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const packId = deleteTarget.id;
    const ok = await deleteAction.run(packId, {
      title: `删除 Pack：${packId}`,
      message: `此操作将永久删除 packs/${packId}/ 目录及其中所有文件，不可恢复。`,
      confirmText: '确认删除',
      requireText: true,
      requireTextMatch: packId,
      formatPreview: (preview) => {
        const p = preview as DeletePackPreviewResponse;
        const lines: string[] = [`将删除目录：${p.pack_dir}`];
        if (p.dependent_instances.length > 0) {
          lines.push(
            `⚠️ 发现 ${p.dependent_instances.length} 个依赖实例（不可删除）：`,
            ...p.dependent_instances.map(
              (inst) => `  - ${inst.name}（id=${inst.id}, status=${inst.status}）`,
            ),
          );
        } else {
          lines.push('✓ 无依赖实例，可安全删除');
        }
        return lines.join('\n');
      },
    });
    if (ok) {
      setSuccess(`Pack ${packId} 已删除`);
      setDeleteTarget(null);
      await handleReload();
    } else {
      setDeleteTarget(null);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Pack 管理</h2>
        <div className="page-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={loading || reloading}
          >
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
            disabled={loading || reloading}
          >
            + 新建 Pack
          </button>
          <button
            className="btn btn-warning"
            onClick={() => void handleReload()}
            disabled={loading || reloading}
          >
            {reloading ? '重载中…' : '重载 Pack'}
          </button>
        </div>
      </div>

      <div className="alert alert-info">
        Pack 是游戏类型的配置包，定义了游戏服务器的启动方式、配置文件、商城命令等。 Pack
        来源文件存放在 <code>packs/&lt;id&gt;/pack.yaml</code>，通过本页面可在线编辑、创建、删除
        Pack， 修改后需点击「重载 Pack」使变更生效。 游戏类型支持：minecraft / factorio / rust /
        ark / palworld / dst / enshrouded / satisfactory / terraria / valheim / zomboid /
        custom。
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {reloadResult && reloadResult.failed.length > 0 && (
        <div className="alert alert-warning">
          <h4>以下 Pack 加载失败：</h4>
          <ul style={{ marginTop: 8 }}>
            {reloadResult.failed.map((f) => (
              <li key={f.pack} className="mono">
                {f.pack}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : packs.length === 0 ? (
        <div className="empty-state">
          暂无已加载的 Pack。请新建 Pack 或确保 packs/ 目录下有有效的 pack.yaml 文件后点击「重载
          Pack」。
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pack ID</th>
                <th>游戏</th>
                <th>变体</th>
                <th>显示名称</th>
                <th>版本</th>
                <th>UI Tabs</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td>{p.game}</td>
                  <td>{p.variant}</td>
                  <td>{p.display_name}</td>
                  <td className="mono">{p.version}</td>
                  <td>
                    {p.ui_tabs && p.ui_tabs.length > 0 ? (
                      <span className="mono">
                        {p.ui_tabs.map((t) => t.tab).join(', ')}
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td className="col-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => void openEdit(p)}>
                      编辑
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={deleteAction.loading}
                      onClick={() => {
                        setDeleteTarget(p);
                        void handleDelete();
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑 Pack 弹窗 */}
      {editTarget && (
        <div className="modal-mask" onClick={closeEdit}>
          <div className="modal" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>编辑 Pack：{editTarget.id}</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeEdit}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {editLoading && !editContent ? (
                <div className="empty-state">加载中…</div>
              ) : (
                <>
                  <p className="form-hint" style={{ marginBottom: 8 }}>
                    编辑 <code>packs/{editTarget.id}/pack.yaml</code> 内容。保存后需点击「重载
                    Pack」使变更生效。
                  </p>
                  {editError && <div className="alert alert-error">{editError}</div>}
                  <textarea
                    className="yaml-editor"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minHeight: 420,
                      fontFamily: 'monospace',
                      fontSize: 13,
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-input)',
                      color: 'var(--text)',
                      resize: 'vertical',
                    }}
                  />
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeEdit}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleSaveEdit()}
                disabled={editLoading || !editContent.trim()}
              >
                {editLoading ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建 Pack 弹窗 */}
      {showCreate && (
        <div
          className="modal-mask"
          onClick={() => {
            setShowCreate(false);
            setCreateId('');
            setCreateContent('');
            setCreateError(null);
          }}
        >
          <div className="modal" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建 Pack</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowCreate(false);
                  setCreateId('');
                  setCreateContent('');
                  setCreateError(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="form-hint" style={{ marginBottom: 12 }}>
                填写 Pack ID 和完整的 <code>pack.yaml</code> 内容。Pack 必须符合 Pack Schema 规范。
              </p>
              {createError && <div className="alert alert-error">{createError}</div>}
              <div className="form-row" style={{ marginBottom: 12 }}>
                <label className="form-field">
                  <span className="form-label">Pack ID *</span>
                  <input
                    type="text"
                    value={createId}
                    onChange={(e) => setCreateId(e.target.value)}
                    placeholder="例如：mygame-vanilla"
                  />
                </label>
                <label className="form-field">
                  <span className="form-label">游戏类型</span>
                  <select
                    value={createId.includes('-') ? '' : ''}
                    onChange={() => {
                      // 不自动修改 ID，仅作参考提示
                    }}
                  >
                    <option value="">选择参考类型</option>
                    {GAME_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                placeholder={`# pack.yaml 内容示例（请根据 Schema 完整填写）\npack_id: mygame-vanilla\ndisplay_name: 我的游戏\nversion: "1.0.0"\ngame_type: custom\nvariant: default\n\nstartup:\n  binary: ./server\n  args: []\n  working_dir: "{{instance_root}}"\n  ready_pattern: "Server started"\n  stop_command: stop\n\nprotocol:\n  type: stdin\n\ncommands:\n  broadcast: say {{message}}\n\nversions:\n  source: custom\n  type: binary\n\nbackup:\n  world_dir: world\n  pre_backup_commands: []\n  post_backup_commands: []\n\nui:\n  tabs:\n    - overview`}
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 360,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg-input)',
                  color: 'var(--text)',
                  resize: 'vertical',
                }}
              />
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowCreate(false);
                  setCreateId('');
                  setCreateContent('');
                  setCreateError(null);
                }}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleCreate()}
                disabled={createLoading || !createId.trim() || !createContent.trim()}
              >
                {createLoading ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除 Pack 确认弹窗已迁移至 useDestructiveAction + ConfirmDialog */}
      {/* deleteTarget 仅作为触发标记，弹窗由 ConfirmProvider 全局渲染 */}
    </div>
  );
}
