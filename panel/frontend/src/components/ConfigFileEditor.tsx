// ============================================================================
// ConfigFileEditor — 通用配置文件编辑器（混合模式）
// 加载时调用 readConfigFile + getConfigFileSchema
// 支持两种编辑模式：
//   - 表单模式：有 Schema 时用 SchemaForm 渲染结构化表单
//   - JSON 模式：用 <textarea> 直接编辑原始 JSON 文本
// 两种模式数据同步；保存时 JSON.parse 后调用 writeConfigFile
// readOnly=true 时禁用编辑且不显示保存按钮
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import type { WriteConfigFileRequest } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import CodeEditor from './CodeEditor';
import SchemaForm from './SchemaForm';

export type ConfigFileFormat = 'json' | 'yaml' | 'properties' | 'ini';

export interface ConfigFileEditorProps {
  serverId: string;
  configName: string;
  format: ConfigFileFormat;
  readOnly: boolean;
  onSave?: () => void;
}

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** 将 readConfigFile 返回的 data 序列化为 textarea 文本 */
function serializeData(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data ?? '');
  }
}

export default function ConfigFileEditor({
  serverId,
  configName,
  format,
  readOnly,
  onSave,
}: ConfigFileEditorProps) {
  const { api } = useAuth();

  const [text, setText] = useState('');
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // 编辑模式：表单模式优先，无 schema 时自动切到 json
  const [mode, setMode] = useState<'form' | 'json'>('form');

  // 是否有可用 Schema（非 null 且非空对象）
  const hasSchema = schema !== null && Object.keys(schema).length > 0;

  useEffect(() => {
    let cancelled = false;
    let pending = 2;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setText('');
    setSchema(null);
    setMode('form');

    const checkDone = () => {
      pending--;
      if (pending === 0 && !cancelled) setLoading(false);
    };

    // 分别加载内容与 schema：schema 加载失败时（如用户自定义文件无 Pack schema）
    // 不阻断整体流程，仅回退到 JSON 模式编辑
    api.readConfigFile(serverId, configName)
      .then((contentRes) => {
        if (cancelled) return;
        setText(serializeData(contentRes.data));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载配置文件失败');
        }
      })
      .finally(checkDone);

    api.getConfigFileSchema(serverId, configName)
      .then((schemaRes) => {
        if (cancelled) return;
        setSchema(schemaRes.schema);
      })
      .catch(() => {
        // schema 不存在时静默处理（回退到 JSON 模式）
        if (!cancelled) setSchema(null);
      })
      .finally(checkDone);

    return () => {
      cancelled = true;
    };
  }, [api, serverId, configName]);

  // 无 Schema 时自动切到 JSON 模式（仅在加载完成后触发，避免加载过程中误切）
  useEffect(() => {
    if (!loading && !hasSchema && mode === 'form') {
      setMode('json');
    }
  }, [loading, hasSchema, mode]);

  // 表单模式：从 text 解析出结构化值供 SchemaForm 使用
  const { parsedValue, parseError } = useMemo(() => {
    if (!text) return { parsedValue: {} as unknown, parseError: null };
    try {
      return { parsedValue: JSON.parse(text), parseError: null };
    } catch (err) {
      return {
        parsedValue: {} as unknown,
        parseError: err instanceof Error ? err.message : 'JSON 解析失败',
      };
    }
  }, [text]);

  // SchemaForm 值变更 → 序列化回 text
  const handleFormChange = (newVal: unknown) => {
    setText(JSON.stringify(newVal, null, 2));
    if (success) setSuccess(null);
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`JSON 解析失败：${err instanceof Error ? err.message : '格式错误'}`);
      return;
    }
    setSaving(true);
    try {
      const req: WriteConfigFileRequest = { data: parsed };
      const res = await api.writeConfigFile(serverId, configName, req);
      if (!res.written) {
        setError('后端未写入文件（written=false）');
        return;
      }
      setSuccess('保存成功');
      onSave?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="empty-state">加载中…</div>;
  }

  return (
    <div className="form-card">
      <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono">{configName}</span>
        <span className="badge badge-stopped">{format}</span>
        {readOnly && <span className="badge badge-starting">只读</span>}
      </h3>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-info">{success}</div>}

      {/* 模式切换 */}
      <div className="tabs">
        <button
          className={`tab-btn${mode === 'form' ? ' active' : ''}`}
          onClick={() => setMode('form')}
          disabled={!hasSchema}
          title={hasSchema ? '表单模式' : '无 Schema，无法使用表单模式'}
        >
          表单模式
        </button>
        <button
          className={`tab-btn${mode === 'json' ? ' active' : ''}`}
          onClick={() => setMode('json')}
        >
          JSON 模式
        </button>
      </div>

      {/* 表单模式：有 Schema 时用 SchemaForm 渲染 */}
      {mode === 'form' && schema ? (
        parseError ? (
          <div className="alert alert-error">
            JSON 解析失败：{parseError}。请切换到 JSON 模式修正格式。
          </div>
        ) : (
          <div style={{ minHeight: 320, overflow: 'auto' }}>
            <SchemaForm
              schema={schema}
              value={parsedValue}
              onChange={handleFormChange}
              disabled={readOnly}
            />
          </div>
        )
      ) : (
        /* JSON 模式：CodeEditor 语法高亮编辑器
           说明：「JSON 模式」始终展示 JSON.stringify 后的内容（后端 parseByFormat 对所有
           format 均返回对象，前端 serializeData 再 JSON.stringify），因此这里固定使用
           json 语法高亮，与用户实际看到的 JSON 文本一致。language-detect.ts 工具供未来
           原始文件内容编辑场景使用。 */
        <CodeEditor
          value={text}
          language="json"
          onChange={(newText) => {
            setText(newText);
            if (success) setSuccess(null);
          }}
          onSave={!readOnly ? () => void handleSave() : undefined}
          readOnly={readOnly}
        />
      )}

      {schema && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 13,
            }}
          >
            查看 Schema
          </summary>
          <pre
            style={{
              fontFamily: MONO_FONT,
              background: '#f8fafc',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: 12,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 320,
              margin: '8px 0 0',
            }}
          >
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      )}

      {!readOnly && (
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}
