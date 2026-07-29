// ============================================================================
// DatabaseConfigStep — v4.20.0 Setup Wizard v2 Step 2: 数据库连接配置
// v4.21.1 改造：MySQL/PostgreSQL 不再让用户输入整串连接链接，
//   改为结构化字段（主机/端口/用户名/密码/数据库名），由前端拼装 url 提交。
//   SQLite 仍保留单文件路径输入。
//
// 职责：
//   - 选择数据库类型（SQLite / MySQL / PostgreSQL）
//   - SQLite：填文件路径
//   - MySQL/PostgreSQL：填主机/端口/用户名/密码/数据库名（结构化字段）
//   - "测试连接"按钮 → 调 POST /api/init/test-database，展示结果
//   - 测试通过才允许下一步
//   - "恢复为 SQLite 默认"快捷按钮
//
// 受控组件：type/url 由父组件持有（提交契约仍是 { type, url }）；
//   结构化字段（host/port/...）为本组件内部状态，通过 onUrlChange 反向同步。
// ============================================================================

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type {
  DatabaseType,
  TestDatabaseConnectionResponse,
} from '@public/schema/panel-api-types';
import { LoadingButton } from '../../components/ui';

/** SQLite 默认文件路径 */
const SQLITE_DEFAULT_URL = './data/panel.db';

/** MySQL/PostgreSQL 结构化字段默认值 */
const DEFAULTS: Record<Exclude<DatabaseType, 'sqlite'>, {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}> = {
  mysql: {
    host: '127.0.0.1',
    port: '3306',
    user: 'root',
    password: '',
    database: 'gameserver_panel',
  },
  postgresql: {
    host: '127.0.0.1',
    port: '5432',
    user: 'postgres',
    password: '',
    database: 'gameserver_panel',
  },
};

/** 各数据库类型的说明 */
const TYPE_DESC: Record<DatabaseType, string> = {
  sqlite: '单文件嵌入式数据库，零配置，适合小型部署或测试环境',
  mysql: 'MySQL / MariaDB，适合中型部署，支持远程连接',
  postgresql: 'PostgreSQL，生产环境推荐，功能强大，支持远程连接',
};

/** MySQL/PostgreSQL 结构化字段状态 */
interface StructFields {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/**
 * 将结构化字段拼装为连接串 url。
 * - mysql:      mysql://user:password@host:port/database
 * - postgresql: postgresql://user:password@host:port/database
 * 密码中的特殊字符做 encodeURIComponent 转义。
 */
function composeUrl(type: 'mysql' | 'postgresql', f: StructFields): string {
  const host = f.host.trim() || '127.0.0.1';
  const port = f.port.trim() || (type === 'mysql' ? '3306' : '5432');
  const user = f.user.trim() || (type === 'mysql' ? 'root' : 'postgres');
  const password = f.password; // 密码原样，仅做 encodeURIComponent
  const database = f.database.trim() || 'gameserver_panel';
  const pwdPart = password ? `:${encodeURIComponent(password)}` : '';
  return `${type}://${encodeURIComponent(user)}${pwdPart}@${host}:${port}/${encodeURIComponent(database)}`;
}

/**
 * 将连接串 url 解析回结构化字段。
 * 仅在初始化或外部强制覆盖 url 时使用——用户编辑结构化字段时不走此路径。
 */
function parseUrl(type: 'mysql' | 'postgresql', url: string): StructFields {
  const fallback = { ...DEFAULTS[type] };
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  // 匹配 scheme://[user[:password]@]host[:port]/database
  const m = trimmed.match(/^[a-z]+:\/\/([^@]*)@([^:/]+)(?::(\d+))?\/(.*)$/i);
  if (!m) return fallback;
  const [, userInfo, host, port, database] = m;
  let user = '';
  let password = '';
  if (userInfo) {
    const colonIdx = userInfo.indexOf(':');
    if (colonIdx >= 0) {
      user = decodeURIComponent(userInfo.slice(0, colonIdx));
      password = decodeURIComponent(userInfo.slice(colonIdx + 1));
    } else {
      user = decodeURIComponent(userInfo);
    }
  }
  return {
    host: host || fallback.host,
    port: port || fallback.port,
    user: user || fallback.user,
    password,
    database: database ? decodeURIComponent(database) : fallback.database,
  };
}

export interface DatabaseConfigStepProps {
  /** 当前选中的数据库类型 */
  type: DatabaseType;
  /** 连接串（父组件持有，作为提交 / 测试连接的唯一来源） */
  url: string;
  /** 测试是否已通过（通过后才允许下一步） */
  tested: boolean;
  /** 最近一次测试结果（null=未测试） */
  testResult: TestDatabaseConnectionResponse | null;
  /** 是否正在测试中 */
  testing: boolean;
  /** 切换数据库类型 */
  onTypeChange: (type: DatabaseType) => void;
  /** 修改连接串（由本组件内部结构化字段拼装后回调） */
  onUrlChange: (url: string) => void;
  /** 触发测试连接 */
  onTest: () => void;
  /** 恢复为 SQLite 默认配置 */
  onResetDefault: () => void;
  /** 连接串是否有效（非空） */
  urlValid: boolean;
  /** v4.22.1: SQLite 警告确认状态（用户勾选"我已知悉 SQLite 不推荐用于生产环境"） */
  dbAck: boolean;
  /** v4.22.1: 修改 SQLite 警告确认状态 */
  onDbAckChange: (ack: boolean) => void;
}

export default function DatabaseConfigStep({
  type,
  url,
  tested,
  testResult,
  testing,
  onTypeChange,
  onUrlChange,
  onTest,
  onResetDefault,
  urlValid,
  dbAck,
  onDbAckChange,
}: DatabaseConfigStepProps) {
  // 结构化字段（仅 MySQL/PostgreSQL 使用）
  const [structFields, setStructFields] = useState<StructFields>(() => {
    if (type === 'mysql' || type === 'postgresql') {
      return parseUrl(type, url);
    }
    return { ...DEFAULTS.mysql };
  });

  // 当 type 切换或 url 被外部强制覆盖（如"恢复默认"）时，重新解析结构化字段
  useEffect(() => {
    if (type === 'mysql' || type === 'postgresql') {
      setStructFields(parseUrl(type, url));
    }
    // 仅依赖 type 和 url——内部字段变化不再触发回解析（避免循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, url]);

  // 内部字段变化时，拼装 url 并回调父组件
  const updateField = (field: keyof StructFields, value: string) => {
    if (type !== 'mysql' && type !== 'postgresql') return;
    const next = { ...structFields, [field]: value };
    setStructFields(next);
    onUrlChange(composeUrl(type, next));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onTest();
  };

  // 当前结构化字段摘要（用于测试结果展示）
  const structSummary = useMemo(() => {
    if (type === 'mysql' || type === 'postgresql') {
      return `${structFields.user}@${structFields.host}:${structFields.port}/${structFields.database}`;
    }
    return '';
  }, [type, structFields]);

  return (
    <form className="setup-form" onSubmit={handleSubmit}>
      <div className="setup-admin-hint">
        <p>
          <Database size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />
          选择面板数据库类型并填写连接信息。提交后需重启服务生效。
        </p>
        <p className="form-field-hint">
          可选择本机或外部数据库。生产环境建议 PostgreSQL。
        </p>
      </div>

      {/* 数据库类型选择 */}
      <div className="form-field">
        <span className="form-label">数据库类型</span>
        <div className="setup-db-type-row">
          {(['sqlite', 'mysql', 'postgresql'] as const).map((t) => (
            <label
              key={t}
              className={`setup-db-type-chip ${type === t ? 'setup-db-type-chip-active' : ''}`}
            >
              <input
                type="radio"
                name="db-type"
                value={t}
                checked={type === t}
                onChange={() => onTypeChange(t)}
              />
              <span className="setup-db-type-radio" aria-hidden="true" />
              <span className="setup-db-type-info">
                <span className="setup-db-type-name">
                  {t === 'sqlite' ? 'SQLite' : t === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                </span>
                <span className="setup-db-type-desc">{TYPE_DESC[t]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SQLite：单文件路径输入 */}
      {type === 'sqlite' && (
        <>
          <label className="form-field">
            <span className="form-label">数据库文件路径</span>
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder={SQLITE_DEFAULT_URL}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            <span className="form-field-hint">
              SQLite 文件路径（相对 panel/backend/ 目录，默认 {SQLITE_DEFAULT_URL}）
            </span>
          </label>

          {/* v4.22.1: SQLite 生产警告确认 checkbox */}
          <label className={`setup-db-ack-field ${dbAck ? 'setup-db-ack-confirmed' : ''}`}>
            <input
              type="checkbox"
              checked={dbAck}
              onChange={(e) => onDbAckChange(e.target.checked)}
            />
            <span className="setup-db-ack-label">
              我已知悉 SQLite 主要适用于小型部署/测试环境，生产环境推荐使用 PostgreSQL。
              如后续遇到并发性能瓶颈，可在系统设置中迁移至 MySQL/PostgreSQL。
            </span>
          </label>
        </>
      )}

      {/* MySQL / PostgreSQL：结构化字段 */}
      {type !== 'sqlite' && (
        <>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">主机地址 *</span>
              <input
                type="text"
                value={structFields.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder="127.0.0.1"
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="form-field setup-db-port-field">
              <span className="form-label">端口 *</span>
              <input
                type="text"
                inputMode="numeric"
                value={structFields.port}
                onChange={(e) => updateField('port', e.target.value)}
                placeholder={type === 'mysql' ? '3306' : '5432'}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="form-row">
            <label className="form-field">
              <span className="form-label">用户名 *</span>
              <input
                type="text"
                value={structFields.user}
                onChange={(e) => updateField('user', e.target.value)}
                placeholder={type === 'mysql' ? 'root' : 'postgres'}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="form-field">
              <span className="form-label">密码</span>
              <input
                type="password"
                value={structFields.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="留空表示无密码"
                autoComplete="new-password"
              />
            </label>
          </div>

          <label className="form-field">
            <span className="form-label">数据库名 *</span>
            <input
              type="text"
              value={structFields.database}
              onChange={(e) => updateField('database', e.target.value)}
              placeholder="gameserver_panel"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="form-field-hint">
              数据库需提前创建（{type === 'mysql' ? 'MySQL' : 'PostgreSQL'} 不会自动建库）。
              当前连接摘要：<code>{structSummary}</code>
            </span>
          </label>
        </>
      )}

      {/* 测试连接结果 */}
      {testResult && (
        <div
          className={`preflight-item preflight-item-${testResult.ok ? 'ok' : 'error'}`}
          style={{ marginBottom: 12 }}
        >
          <div className="preflight-item-icon">
            {testResult.ok ? (
              <CheckCircle2 size={18} className="preflight-icon-ok" />
            ) : (
              <XCircle size={18} className="preflight-icon-error" />
            )}
          </div>
          <div className="preflight-item-body">
            <div className="preflight-item-label">
              {testResult.ok ? '连接成功' : '连接失败'}
            </div>
            <div className="preflight-item-detail">
              {testResult.ok
                ? `延迟 ${testResult.latency_ms}ms · 版本 ${testResult.server_version ?? '未知'}`
                : testResult.error}
            </div>
          </div>
        </div>
      )}

      {/* 操作按钮区：测试连接 + 恢复默认 */}
      <div className="setup-db-actions">
        <LoadingButton
          type="submit"
          variant="ghost"
          loading={testing}
          loadingText="测试中…"
          disabled={!urlValid || testing}
        >
          <RefreshCw size={14} />
          测试连接
        </LoadingButton>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onResetDefault}
          disabled={testing}
        >
          恢复 SQLite 默认
        </button>
      </div>

      {/* 测试通过提示 */}
      {tested && (
        <div className="preflight-item preflight-item-ok" style={{ marginBottom: 12 }}>
          <div className="preflight-item-icon">
            <CheckCircle2 size={18} className="preflight-icon-ok" />
          </div>
          <div className="preflight-item-body">
            <div className="preflight-item-detail">
              测试已通过，可点击"下一步"继续。配置将在最终提交后写入 .env 并重启生效。
            </div>
          </div>
        </div>
      )}

      {testing && !testResult && (
        <div className="setup-loading" style={{ marginBottom: 12 }}>
          <Loader2 size={20} className="spin" />
          <p>正在测试数据库连接…</p>
        </div>
      )}
    </form>
  );
}
