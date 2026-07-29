// ============================================================================
// ConfigDiff — 配置变更预览组件（7.6 配置修改预览与对比）
// 以表格形式展示改动字段的当前值 / 新值，并提供「重置为原值」操作。
// 用法：
//   <ConfigDiff
//     changes={[{ field: 'shop.enabled', oldValue: 'true', newValue: 'false' }]}
//     onReset={(field) => console.log('reset', field)}
//   />
// ============================================================================

interface ConfigChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface ConfigDiffProps {
  /** 变更字段列表 */
  changes: ConfigChange[];
  /** 重置单个字段到原值的回调；不传则不显示重置按钮 */
  onReset?: (field: string) => void;
}

/** 将任意值格式化为可展示字符串 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** 判断两个值是否相等（浅比较 + 字符串归一化） */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return formatValue(a) === formatValue(b);
}

export default function ConfigDiff({ changes, onReset }: ConfigDiffProps) {
  if (changes.length === 0) {
    return (
      <div className="config-diff-empty form-hint">没有检测到变更的字段。</div>
    );
  }

  return (
    <div className="config-diff table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>当前值</th>
            <th>新值</th>
            <th className="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const changed = !isSameValue(c.oldValue, c.newValue);
            return (
              <tr key={c.field} className={changed ? 'config-diff-changed' : ''}>
                <td className="mono cell-key">{c.field}</td>
                <td className="config-diff-old">
                  <span className="mono">{formatValue(c.oldValue)}</span>
                </td>
                <td className="config-diff-new">
                  <span className="mono">{formatValue(c.newValue)}</span>
                </td>
                <td className="col-actions">
                  {onReset && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onReset(c.field)}
                      aria-label={`重置 ${c.field} 为原值`}
                    >
                      重置
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type { ConfigChange, ConfigDiffProps };
