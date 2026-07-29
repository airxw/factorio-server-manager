// ============================================================================
// ApiKeys — API Key 管理（I3，v4.4.0-J1）
// 后端：/api/api-keys 4 个端点
//   GET    /api/api-keys        — 列出所有 API Key（不含明文与 hash）
//   POST   /api/api-keys        — 创建 API Key（返回明文仅一次）
//   GET    /api/api-keys/:id    — 查询单个 API Key 详情
//   DELETE /api/api-keys/:id    — 撤销 API Key（软删除）
//
// 两大区块：
//   1. API Key 列表表（name/key_prefix/user/role/created/expires/last_used/状态/操作）
//   2. 创建 API Key 表单（name + user 选择器 + expires_at）
//      v4.30.1：移除「关联角色」选择器——所有 API Key 一律冻结为 instance_admin
//      （用户洞察：当你需要 API Key 时，你一定是想当服主的）
//   3. 创建成功后一次性显示完整 API Key（明文仅此一次）+ 复制按钮 + 警告
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import type {
  AdminUserSummary,
  ApiKeyInfo,
  UserRole,
} from '@public/schema/panel-api-types';
import { MobileCardList, Modal, SensitiveInput, useToast } from '../../components/ui';
import { getEffectiveRole, isAdminRole } from '../../utils/role';

const ROLE_LABEL: Record<UserRole, string> = {
  server_admin: '系统管理员',
  instance_admin: '实例管理员',
  user: '普通用户',
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--color-bg-primary, #fff)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 15,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
};

/** API Key 列表表行 */
interface ApiKeyRowProps {
  apiKey: ApiKeyInfo;
  users: AdminUserSummary[];
  onRevoke: (id: string, name: string) => void;
  revoking: boolean;
}

function ApiKeyRow({ apiKey, users, onRevoke, revoking }: ApiKeyRowProps) {
  const associatedUser = users.find((u) => u.id === apiKey.user_id);
  const userDisplay = associatedUser
    ? `${associatedUser.username}${associatedUser.email ? ` <${associatedUser.email}>` : ''}`
    : apiKey.user_id;
  const isRevoked = apiKey.revoked_at !== null;
  const isExpired = apiKey.expires_at !== null && new Date(apiKey.expires_at).getTime() <= Date.now();

  return (
    <tr style={{ opacity: isRevoked ? 0.6 : 1 }}>
      <td style={{ fontSize: 13 }}>{apiKey.name}</td>
      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
        {apiKey.key_prefix}
        <span style={{ color: '#9ca3af' }}>…</span>
      </td>
      <td style={{ fontSize: 12 }}>{userDisplay}</td>
      <td style={{ fontSize: 12 }}>
        <span className="badge" style={{ background: '#e5e7eb', color: '#374151', fontSize: 11, padding: '2px 6px' }}>
          {ROLE_LABEL[apiKey.role] ?? apiKey.role}
        </span>
      </td>
      <td style={{ fontSize: 11, color: '#6b7280' }}>
        {new Date(apiKey.created_at).toLocaleString()}
      </td>
      <td style={{ fontSize: 11, color: '#6b7280' }}>
        {apiKey.expires_at ? new Date(apiKey.expires_at).toLocaleString() : '永不过期'}
      </td>
      <td style={{ fontSize: 11, color: '#6b7280' }}>
        {apiKey.last_used_at ? new Date(apiKey.last_used_at).toLocaleString() : '从未使用'}
      </td>
      <td>
        {isRevoked ? (
          <span className="badge" style={{ background: '#dc2626', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
            已撤销
          </span>
        ) : isExpired ? (
          <span className="badge" style={{ background: '#d97706', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
            已过期
          </span>
        ) : (
          <span className="badge" style={{ background: '#16a34a', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
            活跃
          </span>
        )}
      </td>
      <td>
        {!isRevoked && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: '#dc2626' }}
            onClick={() => onRevoke(apiKey.id, apiKey.name)}
            disabled={revoking}
            title="撤销此 API Key"
          >
            <Trash2 size={12} />
            撤销
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ApiKeys() {
  const { api, user } = useAuth();
  const toast = useToast();

  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 创建表单状态
  // v4.30.1：移除 role 字段——服务端硬编码为 instance_admin，前端不再可选
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<{
    name: string;
    user_id: string;
    expires_at: string;
  }>({
    name: '',
    user_id: '',
    expires_at: '',
  });
  const [creating, setCreating] = useState(false);

  // 一次性显示明文 API Key 的模态
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);

  // 撤销确认
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [keysRes, usersRes] = await Promise.all([api.listApiKeys(), api.listUsers()]);
      setApiKeys(keysRes.api_keys ?? []);
      setUsers(usersRes.users ?? []);
    } catch (err) {
      if (err instanceof PanelApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '加载 API Key 列表失败');
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateModal = useCallback(() => {
    setCreateForm({
      name: '',
      user_id: user?.id ?? '',
      expires_at: '',
    });
    setCreateOpen(true);
  }, [user]);

  const handleCreate = useCallback(async () => {
    if (!createForm.name.trim()) {
      toast.warning('请填写 API Key 名称');
      return;
    }
    if (!createForm.user_id) {
      toast.warning('请选择关联用户');
      return;
    }
    let expiresAt: string | undefined = undefined;
    if (createForm.expires_at.trim()) {
      const d = new Date(createForm.expires_at);
      if (Number.isNaN(d.getTime())) {
        toast.warning('expires_at 必须为有效的日期时间');
        return;
      }
      if (d.getTime() <= Date.now()) {
        toast.warning('expires_at 必须为未来时间');
        return;
      }
      expiresAt = d.toISOString();
    }
    setCreating(true);
    try {
      // v4.30.1：不再传 role——服务端硬编码为 instance_admin（防提权 + 与全员服主语义对齐）
      const res = await api.createApiKey({
        name: createForm.name.trim(),
        user_id: createForm.user_id,
        expires_at: expiresAt,
      });
      setPlaintextKey(res.api_key);
      setCreateOpen(false);
      toast.success('API Key 创建成功');
      await refresh();
    } catch (err) {
      toast.error('创建 API Key 失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setCreating(false);
    }
  }, [api, createForm, toast, refresh]);

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevoking(true);
      try {
        await api.revokeApiKey(id);
        toast.success('API Key 已撤销');
        setRevokeTarget(null);
        await refresh();
      } catch (err) {
        toast.error('撤销失败', err instanceof Error ? err.message : '未知错误');
      } finally {
        setRevoking(false);
      }
    },
    [api, toast, refresh],
  );

  const sortedKeys = useMemo(() => {
    return [...apiKeys].sort((a, b) => {
      // 已撤销排在最后；活跃的按创建时间倒序
      if (a.revoked_at && !b.revoked_at) return 1;
      if (!a.revoked_at && b.revoked_at) return -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [apiKeys]);

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>
            <KeyRound size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            API Keys
          </h2>
          <p className="page-description">
            管理 API Key 旁路认证——用于 CI/CD、自动化脚本等场景，通过 x-api-key header 鉴权
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? '加载中…' : '刷新'}
          </button>
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={14} />
            创建 API Key
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* API Key 列表表 */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <KeyRound size={16} />
          API Key 列表（{apiKeys.length}）
        </h3>
        {loading && apiKeys.length === 0 ? (
          <div className="empty-state">加载中…</div>
        ) : apiKeys.length === 0 ? (
          <div className="empty-state">暂无 API Key——点击「创建 API Key」开始</div>
        ) : (
          <>
          <div className="desktop-only">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Key 前缀</th>
                  <th>关联用户</th>
                  <th>角色</th>
                  <th>创建时间</th>
                  <th>过期时间</th>
                  <th>最后使用</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedKeys.map((k) => (
                  <ApiKeyRow
                    key={k.id}
                    apiKey={k}
                    users={users}
                    onRevoke={(id, name) => setRevokeTarget({ id, name })}
                    revoking={revoking}
                  />
                ))}
              </tbody>
            </table>
          </div>
          </div>

          {/* 移动端卡片列表（B2.3：复用 MobileCardList 共享组件） */}
          <MobileCardList
            items={sortedKeys}
            keyExtractor={(k) => k.id}
            renderHeader={(k) => {
              const isRevoked = k.revoked_at !== null;
              const isExpired =
                k.expires_at !== null && new Date(k.expires_at).getTime() <= Date.now();
              return (
                <>
                  <span className="mc-item-title">{k.name}</span>
                  {isRevoked ? (
                    <span className="badge" style={{ background: '#dc2626', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
                      已撤销
                    </span>
                  ) : isExpired ? (
                    <span className="badge" style={{ background: '#d97706', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
                      已过期
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#16a34a', color: '#fff', fontSize: 11, padding: '2px 6px' }}>
                      活跃
                    </span>
                  )}
                </>
              );
            }}
            renderBody={(k) => {
              const associatedUser = users.find((u) => u.id === k.user_id);
              const userDisplay = associatedUser
                ? `${associatedUser.username}${associatedUser.email ? ` <${associatedUser.email}>` : ''}`
                : k.user_id;
              return (
                <>
                  <div className="mc-row">
                    <span className="mc-label">Key 前缀</span>
                    <span className="mc-value mono">
                      {k.key_prefix}
                      <span style={{ color: '#9ca3af' }}>…</span>
                    </span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">关联用户</span>
                    <span className="mc-value">{userDisplay}</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">角色</span>
                    <span className="mc-value">
                      <span className="badge" style={{ background: '#e5e7eb', color: '#374151', fontSize: 11, padding: '2px 6px' }}>
                        {ROLE_LABEL[k.role] ?? k.role}
                      </span>
                    </span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">创建时间</span>
                    <span className="mc-value">{new Date(k.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">过期时间</span>
                    <span className="mc-value">
                      {k.expires_at ? new Date(k.expires_at).toLocaleString() : '永不过期'}
                    </span>
                  </div>
                  <div className="mc-row">
                    <span className="mc-label">最后使用</span>
                    <span className="mc-value">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '从未使用'}
                    </span>
                  </div>
                </>
              );
            }}
            renderActions={(k) => {
              const isRevoked = k.revoked_at !== null;
              if (isRevoked) return null;
              return (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                  disabled={revoking}
                  title="撤销此 API Key"
                >
                  <Trash2 size={12} />
                  撤销
                </button>
              );
            }}
          />
          </>
        )}
      </div>

      {/* 创建 API Key 模态 */}
      <Modal
        open={createOpen}
        title="创建 API Key"
        onClose={() => !creating && setCreateOpen(false)}
        disableClose={creating}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? '创建中…' : '创建'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500 }}>名称 *</label>
            <input
              type="text"
              style={inputStyle}
              value={createForm.name}
              maxLength={100}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="CI/CD Pipeline"
            />
            <p className="form-hint">人类可读名称（≤ 100 字符）</p>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500 }}>关联用户 *</label>
            <select
              style={inputStyle}
              value={createForm.user_id}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, user_id: e.target.value }))}
            >
              <option value="">— 选择用户 —</option>
              {users
                .filter((u) => u.status === 'active')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.email}) — {ROLE_LABEL[u.role] ?? u.role}
                  </option>
                ))}
            </select>
            <p className="form-hint">server_admin 可为任意 active 用户创建 API Key</p>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500 }}>过期时间（可选）</label>
            <input
              type="datetime-local"
              style={inputStyle}
              value={createForm.expires_at}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, expires_at: e.target.value }))
              }
            />
            <p className="form-hint">不填则永不过期</p>
          </div>
        </div>
      </Modal>

      {/* 明文 API Key 一次性显示模态 */}
      <Modal
        open={plaintextKey !== null}
        title="API Key 创建成功"
        onClose={() => {
          setPlaintextKey(null);
        }}
        footer={
          <button
            className="btn btn-primary"
            onClick={() => {
              setPlaintextKey(null);
            }}
          >
            <Check size={14} />
            我已保存
          </button>
        }
      >
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          <strong>请妥善保管此 API Key——明文仅此一次显示！</strong>
          <br />
          关闭此对话框后将无法再次查看，请立即复制保存到密码管理器或 CI/CD 密钥存储中。
        </div>
        <SensitiveInput
          value={plaintextKey ?? ''}
          copyable
          revealable
          multiline={false}
        />
      </Modal>

      {/* 撤销确认模态 */}
      <Modal
        open={revokeTarget !== null}
        title="确认撤销 API Key"
        onClose={() => !revoking && setRevokeTarget(null)}
        disableClose={revoking}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
            >
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={() => revokeTarget && void handleRevoke(revokeTarget.id)}
              disabled={revoking}
            >
              {revoking ? '撤销中…' : '确认撤销'}
            </button>
          </>
        }
      >
        <p>
          将撤销 API Key <strong>{revokeTarget?.name}</strong>。
          <br />
          此操作不可逆，使用此 Key 的所有自动化脚本将立即失效。
        </p>
      </Modal>
    </div>
  );
}
