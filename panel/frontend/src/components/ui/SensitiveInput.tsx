// ============================================================================
// SensitiveInput — 敏感字段输入组件（B1 批次）
// 默认 type="password" 隐藏，点击眼睛图标切换显示；可复制；关闭浏览器自动填充
// 用于：Tunnel token / API Key / Webhook Secret / SMTP 密码 / SSL 私钥 / Alert Webhook URL
//
// 设计原则：
//   - 默认隐藏（type="password"），需主动 reveal 才显示明文
//   - 关闭 autocomplete / autoCorrect / spellCheck，避免浏览器历史记录
//   - 复制按钮使用 navigator.clipboard.writeText，复制后短暂反馈
//   - 支持多行模式（multiline=true）用于 SSL PEM/KEY
//   - 与 shadcn Input 风格一致
// ============================================================================

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Copy, Eye, EyeOff, Check } from 'lucide-react';

export interface SensitiveInputProps {
  /** 当前值 */
  value: string;
  /** 值变更回调 */
  onChange?: (value: string) => void;
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否可切换显示，默认 true */
  revealable?: boolean;
  /** 是否可复制，默认 true */
  copyable?: boolean;
  /** 多行模式（用于 SSL PEM/KEY），默认 false */
  multiline?: boolean;
  /** 多行模式行数，默认 6 */
  rows?: number;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 自动聚焦 */
  autoFocus?: boolean;
  /** 名称（用于 autocomplete） */
  name?: string;
  /** 值为掩码占位时（如 '***'）是否禁用输入，默认 true */
  maskPlaceholderDisabled?: boolean;
  /** 掩码占位字符串（用于判断是否禁用） */
  maskValue?: string;
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 32px 6px 10px',
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  background: 'var(--color-bg-primary, #fff)',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  padding: '6px 10px',
  paddingRight: 32,
  resize: 'vertical',
  minHeight: 80,
};

const iconBtnStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-text-secondary, #6b7280)',
};

const iconBtnTopStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  top: 8,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--color-text-secondary, #6b7280)',
};

export default function SensitiveInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  revealable = true,
  copyable = true,
  multiline = false,
  rows = 6,
  style,
  autoFocus,
  name,
  maskPlaceholderDisabled = true,
  maskValue = '***',
}: SensitiveInputProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleRevealToggle = useCallback(() => {
    setRevealed((prev) => !prev);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!value || value === maskValue) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板 API 不可用（如 HTTP 环境），静默失败
    }
  }, [value, maskValue]);

  // 值为掩码占位时禁用输入（避免误提交掩码）
  const isMasked = maskPlaceholderDisabled && value === maskValue;
  const inputDisabled = disabled || isMasked;

  // 共同的 input 属性
  const commonProps = {
    value,
    onChange: onChange ? (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value) : undefined,
    placeholder,
    disabled: inputDisabled,
    autoFocus,
    name,
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false,
    'aria-label': name || 'sensitive-input',
  };

  if (multiline) {
    return (
      <div style={{ position: 'relative', ...style }}>
        <textarea
          {...(commonProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          rows={rows}
          style={textareaStyle}
          // 多行模式不使用 password type，但默认隐藏通过 CSS（color: transparent + text-shadow）
          // 实际场景：SSL PEM/KEY 通常需要查看，所以多行模式默认显示
        />
        {copyable && (
          <button
            type="button"
            style={iconBtnTopStyle}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制'}
            tabIndex={-1}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        {...(commonProps as React.InputHTMLAttributes<HTMLInputElement>)}
        type={revealed ? 'text' : 'password'}
        style={inputStyle}
      />
      <div style={{ display: 'flex', position: 'absolute', right: 0, top: 0, height: '100%', alignItems: 'center' }}>
        {revealable && (
          <button
            type="button"
            style={iconBtnStyle}
            onClick={handleRevealToggle}
            title={revealed ? '隐藏' : '显示'}
            tabIndex={-1}
            disabled={inputDisabled}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {copyable && (
          <button
            type="button"
            style={iconBtnStyle}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制'}
            tabIndex={-1}
            disabled={inputDisabled}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}
