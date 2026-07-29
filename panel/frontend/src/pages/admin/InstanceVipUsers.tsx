// ============================================================================
// InstanceVipUsers — 实例VIP用户管理（instance_admin+ 可见）
// 选择实例 → 展示绑定用户列表 → 调整VIP等级 + 过期时间
// 显示各等级对应的VIP模板权益（从 vip-permissions 读取）
// v4.x: 迁入 Workbench DS 壳层，统一 /store 视觉语言
// @version 3.2.0
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ServerSummary, VipPermissionItem } from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { Crown, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { getEffectiveRole, isInstanceAdminOrAbove } from '../../utils/role';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchFilterBar,
  WorkbenchSelect,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
  WorkbenchTableWrap,
  WorkbenchStatusBadge,
  type WorkbenchStatusTone,
} from '../store/components/WorkbenchUI';

interface InstanceBinding {
  id: number;
  userId: string;
  username: string;
  vipLevel: number;
  vipExpiresAt: string | null;
  status: string;
  boundAt: string;
}

const VIP_LEVELS = [0, 1, 2, 3, 4, 5] as const;

const INPUT_CLASS =
  'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';

function formatExpiresAt(expiresAt: string | null): string {
  if (!expiresAt) return '永久';
  const d = new Date(expiresAt);
  if (isNaN(d.getTime())) return '无效日期';
  return d.toLocaleString('zh-CN');
}

function vipTone(level: number): WorkbenchStatusTone {
  if (level >= 4) return 'amber';
  if (level >= 2) return 'blue';
  if (level >= 1) return 'emerald';
  return 'slate';
}

export default function InstanceVipUsers() {
  const { api, user } = useAuth();
  useDocumentTitle('VIP管理');

  // 服务器列表
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(true);

  // 绑定列表
  const [bindings, setBindings] = useState<InstanceBinding[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VIP模板（用于显示各等级权益）
  const [vipTemplates, setVipTemplates] = useState<VipPermissionItem[]>([]);

  // 编辑状态
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editVipLevel, setEditVipLevel] = useState<number>(1);
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 加载服务器列表
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.listServers();
        if (cancelled) return;
        setServers(res.servers);
        if (res.servers.length > 0) {
          setServerId(res.servers[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载服务器列表失败');
        }
      } finally {
        if (!cancelled) setServersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // 加载VIP模板
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.listVipPermissions();
        setVipTemplates(res.permissions);
      } catch {
        // 非server_admin可能看不到模板，降级为空
        setVipTemplates([]);
      }
    })();
  }, [api]);

  // 加载绑定列表
  const loadBindings = useCallback(
    async (id: string) => {
      setDataLoading(true);
      setError(null);
      try {
        const res = await api.listInstanceBindings(id);
        setBindings(res.bindings);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载VIP用户列表失败');
        setBindings([]);
      } finally {
        setDataLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!serverId) {
      setBindings([]);
      return;
    }
    void loadBindings(serverId);
  }, [serverId, loadBindings]);

  // 根据等级查找模板
  const vipTemplateMap = useMemo(() => {
    const map = new Map<number, VipPermissionItem>();
    for (const t of vipTemplates) {
      map.set(t.vip_level, t);
    }
    return map;
  }, [vipTemplates]);

  // 开始编辑
  const startEdit = (b: InstanceBinding) => {
    setEditingUserId(b.userId);
    setEditVipLevel(b.vipLevel);
    setEditExpiresAt(b.vipExpiresAt ?? '');
  };

  const cancelEdit = () => {
    setEditingUserId(null);
  };

  // 保存VIP调整
  const handleSave = async (userId: string) => {
    if (!serverId) return;
    setSaving(true);
    setError(null);
    try {
      const expiresAt = editExpiresAt.trim() || null;
      await api.updateBindingVip(serverId, userId, editVipLevel, expiresAt);
      // 乐观更新本地列表
      setBindings((prev) =>
        prev.map((b) =>
          b.userId === userId ? { ...b, vipLevel: editVipLevel, vipExpiresAt: expiresAt } : b,
        ),
      );
      setEditingUserId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isInstanceAdminOrAbove(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · VIP"
        title="实例 VIP 管理"
        description="调整用户在当前实例的 VIP 等级与过期时间。等级 0 为普通用户，等级 5 为最高；server_admin 与实例拥有者自动享有 VIP5。"
        actions={
          <WorkbenchSecondaryButton
            icon={RefreshCw}
            onClick={() => serverId && void loadBindings(serverId)}
            disabled={dataLoading || !serverId}
          >
            刷新
          </WorkbenchSecondaryButton>
        }
      />

      <WorkbenchFilterBar>
        <span className="text-xs font-medium text-slate-500">选择实例</span>
        <WorkbenchSelect
          aria-label="选择实例"
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          disabled={serversLoading}
        >
          {servers.length === 0 && <option value="">暂无实例</option>}
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.id})
            </option>
          ))}
        </WorkbenchSelect>
      </WorkbenchFilterBar>

      {error && (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {vipTemplates.length > 0 && (
        <WorkbenchSection
          title="各等级权益参考"
          description="展开查看当前生效的 VIP 模板配置。"
          icon={Crown}
        >
          <WorkbenchTableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>等级</th>
                  <th>名称</th>
                  <th>最高品质</th>
                  <th>每日限额</th>
                  <th>每日点券</th>
                </tr>
              </thead>
              <tbody>
                {vipTemplates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <WorkbenchStatusBadge label={`VIP${t.vip_level}`} tone={vipTone(t.vip_level)} />
                    </td>
                    <td className="cell-name">{t.display_name}</td>
                    <td className="mono">{t.max_quality}</td>
                    <td className="mono">{t.daily_limit === null ? '不限' : t.daily_limit}</td>
                    <td className="mono">{t.daily_reward_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </WorkbenchTableWrap>
        </WorkbenchSection>
      )}

      <WorkbenchSection
        title="绑定用户列表"
        description="点击「调整 VIP」修改用户在当前实例的等级与过期时间。"
        icon={Users}
      >
        {!serverId ? (
          <WorkbenchEmpty
            title="请先选择实例"
            description="选择上方实例后，绑定用户列表会显示在这里。"
            icon={Users}
            tone="slate"
          />
        ) : dataLoading ? (
          <div className="h-32 animate-pulse rounded-[20px] bg-slate-100/70" />
        ) : bindings.length === 0 ? (
          <WorkbenchEmpty
            title="该实例暂无绑定用户"
            description="玩家通过玩家门户绑定角色后，会在这里出现。"
            icon={Users}
            tone="slate"
          />
        ) : (
          <WorkbenchTableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>当前 VIP 等级</th>
                  <th>过期时间</th>
                  <th>绑定时间</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => {
                  const isEditing = editingUserId === b.userId;
                  const template = vipTemplateMap.get(b.vipLevel);
                  return (
                    <tr key={b.id}>
                      <td className="cell-name">{b.username}</td>
                      <td>
                        {isEditing ? (
                          <select
                            value={editVipLevel}
                            onChange={(e) => setEditVipLevel(Number(e.target.value))}
                            className={INPUT_CLASS}
                          >
                            {VIP_LEVELS.map((l) => (
                              <option key={l} value={l}>
                                VIP{l}
                                {template && l === b.vipLevel ? '（当前）' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <WorkbenchStatusBadge label={`VIP${b.vipLevel}`} tone={vipTone(b.vipLevel)} />
                            {template && (
                              <span className="text-xs text-slate-400">{template.display_name}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={editExpiresAt ? editExpiresAt.slice(0, 16) : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditExpiresAt(v ? new Date(v).toISOString() : '');
                            }}
                            placeholder="留空=永久"
                            className={INPUT_CLASS}
                          />
                        ) : (
                          <span title={b.vipExpiresAt ?? undefined}>
                            {formatExpiresAt(b.vipExpiresAt)}
                          </span>
                        )}
                      </td>
                      <td className="mono">{new Date(b.boundAt).toLocaleString('zh-CN')}</td>
                      <td className="col-actions">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <WorkbenchPrimaryButton
                              onClick={() => void handleSave(b.userId)}
                              disabled={saving}
                            >
                              保存
                            </WorkbenchPrimaryButton>
                            <WorkbenchSecondaryButton onClick={cancelEdit} disabled={saving}>
                              取消
                            </WorkbenchSecondaryButton>
                          </div>
                        ) : (
                          <WorkbenchSecondaryButton onClick={() => startEdit(b)}>
                            调整 VIP
                          </WorkbenchSecondaryButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </WorkbenchTableWrap>
        )}
      </WorkbenchSection>
    </WorkbenchShell>
  );
}
