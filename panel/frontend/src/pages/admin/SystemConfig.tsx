// ============================================================================
// SystemConfig — 系统配置管理（仅 admin/system_admin 可见）
// 表格展示 KV 配置 + 行内编辑 + 新建配置 + 删除确认
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { SystemConfigItem } from '@public/schema/panel-api-types';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../api/auth';
import { getEffectiveRole, isAdminRole } from '../../utils/role';
import { Modal, SensitiveInput, useConfirm, useToast } from '../../components/ui';
import ConfigDiff, { type ConfigChange } from '../../components/ConfigDiff';

// 预定义 Key 参考：面板各功能模块读取的全局配置项
interface PredefinedKey {
  key: string;
  desc: string;
  range: string;
  defaultValue: string;
}

const PREDEFINED_KEYS: PredefinedKey[] = [
  { key: 'shop.currency_name', desc: '商城货币名称', range: '字符串', defaultValue: '点券' },
  { key: 'shop.enabled', desc: '商城开关', range: 'true / false', defaultValue: 'true' },
  { key: 'chat.enabled', desc: '聊天增强开关', range: 'true / false', defaultValue: 'true' },
  { key: 'vote.enabled', desc: '投票系统开关', range: 'true / false', defaultValue: 'true' },
  { key: 'welcome.gift_item', desc: '欢迎礼包物品', range: '物品 ID', defaultValue: 'stone_sword' },
  { key: 'backup.max_count', desc: '备份最大保留数', range: '数字', defaultValue: '10' },
  { key: 'monitor.retention_days', desc: '监控数据保留天数', range: '数字', defaultValue: '7' },
];

// 第十一章 11.6: 配置分类——按 key 前缀归类到不同 Tab
type ConfigCategory = 'all' | 'basic' | 'security' | 'mail' | 'storage' | 'feature';

interface CategoryDef {
  value: ConfigCategory;
  label: string;
  /** 判定一个 key 是否属于该分类 */
  match: (key: string) => boolean;
}

const CATEGORIES: CategoryDef[] = [
  { value: 'all', label: '全部', match: () => true },
  {
    value: 'basic',
    label: '基础设置',
    match: (k) =>
      k.startsWith('site.') || k.startsWith('welcome.') || k.startsWith('general.'),
  },
  {
    value: 'security',
    label: '安全设置',
    match: (k) => k.startsWith('security.') || k.startsWith('auth.'),
  },
  {
    value: 'mail',
    label: '邮件设置',
    match: (k) => k.startsWith('mail.') || k.startsWith('email.') || k.startsWith('smtp.'),
  },
  {
    value: 'storage',
    label: '存储设置',
    match: (k) =>
      k.startsWith('backup.') || k.startsWith('monitor.') || k.startsWith('storage.'),
  },
  {
    value: 'feature',
    label: '功能开关',
    match: (k) =>
      k.startsWith('shop.') || k.startsWith('chat.') || k.startsWith('vote.') || k.endsWith('.enabled'),
  },
];

/** 预定义 key 的默认值查找表（用于"恢复默认值"） */
const PREDEFINED_DEFAULTS: Record<string, string> = Object.fromEntries(
  PREDEFINED_KEYS.map((k) => [k.key, k.defaultValue]),
);

/**
 * 受保护 key 清单——被业务代码引用的 key 禁止删除（与后端 PROTECTED_KEYS 同步）。
 * 来源：panel/backend/src/api/routes/systemConfig.ts 的 PROTECTED_KEYS 常量。
 * 删除会丢失管理员自定义值，业务回退到默认值且无回收站。
 */
const PROTECTED_KEYS: ReadonlySet<string> = new Set([
  'withdraw.ratio',
  'consumption.daily_max',
  'recharge.max',
]);

function isProtectedKey(key: string): boolean {
  return PROTECTED_KEYS.has(key);
}

/**
 * B1: 识别敏感 key（value 含密码/密钥/token 等不应明文展示的字段）
 * 匹配模式：key 包含 password / secret / smtp_pass / api_key / token / private_key
 */
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /smtp_pass/i,
  /api[_-]?key/i,
  /token/i,
  /private[_-]?key/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

export default function SystemConfig() {
  const { api, user } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [configs, setConfigs] = useState<SystemConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ value: string; description: string }>({
    value: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // 7.6: 配置变更预览弹窗——保存前展示字段级 diff
  const [diffPreviewKey, setDiffPreviewKey] = useState<string | null>(null);

  // 第十一章 11.6: 当前选中的配置分类 Tab
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSystemConfigs();
      setConfigs(res.configs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载系统配置失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 11.6: 按分类过滤配置项
  const filteredConfigs = useMemo(() => {
    if (activeCategory === 'all') return configs;
    const def = CATEGORIES.find((c) => c.value === activeCategory);
    if (!def) return configs;
    return configs.filter((c) => def.match(c.key));
  }, [configs, activeCategory]);

  const startEdit = (c: SystemConfigItem) => {
    setEditingKey(c.key);
    setEditDraft({ value: c.value, description: c.description ?? '' });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft({ value: '', description: '' });
  };

  const handleSave = async (key: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.setSystemConfig(key, {
        value: editDraft.value,
        description: editDraft.description || undefined,
      });
      setConfigs((prev) => prev.map((c) => (c.key === key ? res.config : c)));
      setEditingKey(null);
      setDiffPreviewKey(null);
      // 11.6: 保存成功 Toast 反馈
      toast.success(`配置 "${key}" 已保存`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      toast.error('保存失败', msg);
    } finally {
      setSaving(false);
    }
  };

  // 11.6: 恢复单个配置项到预定义默认值（仅预定义 key 可用）
  const handleRestoreDefault = async (key: string) => {
    const defaultValue = PREDEFINED_DEFAULTS[key];
    if (defaultValue === undefined) {
      toast.info('该配置项无预定义默认值');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.setSystemConfig(key, { value: defaultValue });
      setConfigs((prev) => prev.map((c) => (c.key === key ? res.config : c)));
      toast.success(`配置 "${key}" 已恢复默认值`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '恢复默认值失败';
      setError(msg);
      toast.error('恢复默认值失败', msg);
    } finally {
      setSaving(false);
    }
  };

  // 7.6: 计算当前编辑项的字段级变更（用于 ConfigDiff 预览）
  const diffChanges: ConfigChange[] = useMemo(() => {
    if (!diffPreviewKey) return [];
    const original = configs.find((c) => c.key === diffPreviewKey);
    if (!original) return [];
    const changes: ConfigChange[] = [];
    if (original.value !== editDraft.value) {
      changes.push({ field: 'value', oldValue: original.value, newValue: editDraft.value });
    }
    if ((original.description ?? '') !== editDraft.description) {
      changes.push({
        field: 'description',
        oldValue: original.description ?? '',
        newValue: editDraft.description,
      });
    }
    return changes;
  }, [diffPreviewKey, configs, editDraft]);

  const resetDiffField = (field: string) => {
    const original = configs.find((c) => c.key === diffPreviewKey);
    if (!original) return;
    if (field === 'value') {
      setEditDraft((d) => ({ ...d, value: original.value }));
    } else if (field === 'description') {
      setEditDraft((d) => ({ ...d, description: original.description ?? '' }));
    }
  };

  const handleDelete = async (key: string) => {
    const ok = await confirm({
      title: '删除确认',
      message: `确认删除配置项 "${key}"？此操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteSystemConfig(key);
      setConfigs((prev) => prev.filter((c) => c.key !== key));
      // 11.6: 删除成功 Toast 反馈
      toast.success(`配置 "${key}" 已删除`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      setError(msg);
      toast.error('删除失败', msg);
    }
  };

  const handleCreate = async () => {
    if (!newKey.trim()) {
      setError('请填写配置 key');
      return;
    }
    if (newValue === '') {
      setError('请填写配置 value');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await api.setSystemConfig(newKey.trim(), {
        value: newValue,
        description: newDesc.trim() || undefined,
      });
      setConfigs((prev) => {
        const filtered = prev.filter((c) => c.key !== res.config.key);
        return [...filtered, res.config];
      });
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      setShowCreate(false);
      // 11.6: 创建成功 Toast 反馈
      toast.success(`配置 "${newKey.trim()}" 已创建`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setError(msg);
      toast.error('创建失败', msg);
    } finally {
      setCreating(false);
    }
  };

  if (!isAdminRole(getEffectiveRole(user))) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">系统配置</h2>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate((v) => !v)}
            disabled={loading}
          >
            {showCreate ? '收起新建' : '+ 新建配置'}
          </button>
        </div>
      </div>

      {/* 引导说明 + 预定义 Key 参考表 */}
      <div className="info-card">
        <h3 className="card-title">系统配置</h3>
        <p className="config-guide-text">此页面用于管理面板的全局配置项。以下为预定义 Key 参考：</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>说明</th>
                <th>取值范围</th>
                <th>默认值</th>
              </tr>
            </thead>
            <tbody>
              {PREDEFINED_KEYS.map((k) => (
                <tr key={k.key}>
                  <td className="mono">{k.key}</td>
                  <td>{k.desc}</td>
                  <td>{k.range}</td>
                  <td className="mono">{k.defaultValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showCreate && (
        <form
          className="form-card"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">Key *</span>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="例如：site.title"
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">Value *</span>
              {isSensitiveKey(newKey) ? (
                <SensitiveInput
                  value={newValue}
                  onChange={setNewValue}
                  placeholder="敏感值（默认隐藏）"
                  revealable
                  copyable={false}
                />
              ) : (
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  required
                />
              )}
            </label>
          </div>
          <label className="form-field">
            <span className="form-label">描述（可选）</span>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="该配置项的说明"
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : configs.length === 0 ? (
        <div className="empty-state">暂无系统配置。</div>
      ) : (
        <>
          {/* 第十一章 11.6: 配置分类 Tab */}
          <div className="tabs" style={{ marginBottom: 12 }}>
            {CATEGORIES.map((cat) => {
              const count = cat.value === 'all'
                ? configs.length
                : configs.filter((c) => cat.match(c.key)).length;
              return (
                <button
                  key={cat.value}
                  type="button"
                  className={`tab-btn${activeCategory === cat.value ? ' active' : ''}`}
                  onClick={() => setActiveCategory(cat.value)}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>

          {filteredConfigs.length === 0 ? (
            <div className="empty-state">该分类下暂无配置项。</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>描述</th>
                    <th>更新时间</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConfigs.map((c) => {
                    const isEditing = editingKey === c.key;
                    // 11.6: 是否有预定义默认值可恢复
                    const hasDefault = PREDEFINED_DEFAULTS[c.key] !== undefined;
                    const isDefaultValue = hasDefault && c.value === PREDEFINED_DEFAULTS[c.key];
                    // B1: 敏感 key 检测
                    const sensitive = isSensitiveKey(c.key);
                    // 受保护 key：被业务代码引用，禁止删除
                    const protectedKey = isProtectedKey(c.key);
                    return (
                      <tr key={c.key}>
                        <td className="cell-key">{c.key}</td>
                        <td>
                          {isEditing ? (
                            sensitive ? (
                              <SensitiveInput
                                value={editDraft.value}
                                onChange={(v) => setEditDraft((d) => ({ ...d, value: v }))}
                                revealable
                                copyable={false}
                              />
                            ) : (
                              <input
                                type="text"
                                value={editDraft.value}
                                onChange={(e) => setEditDraft((d) => ({ ...d, value: e.target.value }))}
                              />
                            )
                          ) : sensitive ? (
                            <SensitiveInput
                              value={c.value}
                              revealable
                              copyable
                            />
                          ) : (
                            <span className="mono">{c.value}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.description}
                              placeholder="可选描述"
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, description: e.target.value }))
                              }
                            />
                          ) : (
                            (c.description ?? '—')
                          )}
                        </td>
                        <td>{new Date(c.updated_at).toLocaleString('zh-CN')}</td>
                        <td className="col-actions">
                          {isEditing ? (
                            <>
                              {/* 7.6: 预览变更——保存前展示字段级 diff */}
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => setDiffPreviewKey(c.key)}
                                disabled={saving}
                              >
                                预览变更
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={cancelEdit}
                                disabled={saving}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)}>
                                编辑
                              </button>
                              {/* 11.6: 恢复默认值（仅预定义 key 且当前值非默认值时显示） */}
                              {hasDefault && !isDefaultValue && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => void handleRestoreDefault(c.key)}
                                  disabled={saving}
                                  title={`恢复为默认值：${PREDEFINED_DEFAULTS[c.key]}`}
                                >
                                  <RotateCcw size={12} />
                                  恢复默认
                                </button>
                              )}
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => void handleDelete(c.key)}
                                disabled={protectedKey}
                                title={
                                  protectedKey
                                    ? '该配置项被业务代码引用，禁止删除（可编辑值或恢复默认）'
                                    : undefined
                                }
                              >
                                删除
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 7.6: 配置变更预览弹窗 */}
      <Modal
        open={diffPreviewKey !== null}
        title="配置变更预览"
        onClose={() => setDiffPreviewKey(null)}
        disableClose={saving}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDiffPreviewKey(null)}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (diffPreviewKey) void handleSave(diffPreviewKey);
              }}
              disabled={saving || diffChanges.length === 0}
            >
              {saving ? '保存中…' : '确认保存'}
            </button>
          </>
        }
      >
        {diffChanges.length === 0 ? (
          <p className="form-hint">没有检测到变更的字段，无需保存。</p>
        ) : (
          <ConfigDiff changes={diffChanges} onReset={resetDiffField} />
        )}
      </Modal>
    </div>
  );
}
