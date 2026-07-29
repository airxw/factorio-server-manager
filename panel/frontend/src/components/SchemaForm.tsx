// ============================================================================
// SchemaForm — 基于 JSON Schema 自动生成表单的组件
// 支持两种 schema 形态：
//   1. 标准 JSON Schema：{ type: 'object', properties: { ... }, required: [...] }
//   2. 扁平 map 格式（后端 Pack config_files[].schema 的实际形态）：
//      { FieldName: { type: 'string', description: '...' }, ... }
// 渲染规则根据每个字段的 type 决定控件类型，支持递归嵌套 object 和 array。
// ============================================================================

import type { ChangeEvent } from 'react';

interface SchemaFormProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

// ===== 类型守卫 =====

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === 'string');
}

// ===== Schema 解析辅助 =====

/**
 * 从 schema 中提取 properties 字典和 required 数组。
 * 兼容标准 JSON Schema（type='object' + properties）与扁平 map 格式。
 */
function getProperties(schema: Record<string, unknown>): {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  // 标准 JSON Schema：顶层 type === 'object' 且有 properties
  if (schema.type === 'object' && isObject(schema.properties)) {
    const properties: Record<string, Record<string, unknown>> = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      if (isObject(val)) {
        properties[key] = val;
      }
    }
    const required = isStringArray(schema.required) ? schema.required : [];
    return { properties, required };
  }
  // 扁平 map 格式：schema 本身即为 properties 集合
  // 只收录值为对象且带 type 字段的条目，过滤掉 required 等元信息键
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (isObject(val) && typeof val.type === 'string') {
      properties[key] = val;
    }
  }
  const required = isStringArray(schema.required) ? schema.required : [];
  return { properties, required };
}

/** 获取字段类型，缺省回退到 string */
function getFieldType(schema: Record<string, unknown>): string {
  return typeof schema.type === 'string' ? schema.type : 'string';
}

/** 获取字段中文标签：优先 description，回退到字段名 */
function getFieldLabel(name: string, schema: Record<string, unknown>): string {
  return typeof schema.description === 'string' && schema.description.length > 0
    ? schema.description
    : name;
}

/** 获取 enum 选项列表 */
function getEnumOptions(schema: Record<string, unknown>): string[] {
  return isStringArray(schema.enum) ? schema.enum : [];
}

/**
 * 判断字段是否声明为只读（JSON Schema readOnly 关键字）。
 * v1.1.0: 端口锁定为实例不可变属性，Pack 可在 config_files.schema 中对端口字段
 * 声明 readOnly: true，前端据此渲染为禁用态，禁止用户编辑。
 */
function isFieldReadOnly(schema: Record<string, unknown>): boolean {
  return schema.readOnly === true;
}

/** 根据字段 schema 生成默认值（用于 array 添加新项） */
function getDefaultForSchema(schema: Record<string, unknown> | null): unknown {
  if (!schema) return '';
  switch (getFieldType(schema)) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return '';
  }
}

// ===== 主组件 =====

export default function SchemaForm({ schema, value, onChange, disabled }: SchemaFormProps) {
  const objValue = isObject(value) ? value : {};
  const { properties, required } = getProperties(schema);

  const handleFieldChange = (fieldName: string, fieldValue: unknown) => {
    onChange({ ...objValue, [fieldName]: fieldValue });
  };

  return (
    <div className="schema-form">
      {Object.entries(properties).map(([name, fieldSchema]) => (
        <SchemaField
          key={name}
          name={name}
          fieldSchema={fieldSchema}
          value={objValue[name]}
          onChange={(v) => handleFieldChange(name, v)}
          required={required.includes(name)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ===== 单字段渲染组件 =====

interface SchemaFieldProps {
  name: string;
  fieldSchema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  disabled?: boolean;
}

function SchemaField({ name, fieldSchema, value, onChange, required, disabled }: SchemaFieldProps) {
  const type = getFieldType(fieldSchema);
  const label = getFieldLabel(name, fieldSchema);
  // v1.1.0: 字段级 readOnly（JSON Schema readOnly 关键字）与表单级 disabled 合并
  const fieldDisabled = disabled || isFieldReadOnly(fieldSchema);

  return (
    <div className="form-field" style={{ marginBottom: 12 }}>
      <label className="form-label">
        {label}
        {required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
        {isFieldReadOnly(fieldSchema) && !disabled && (
          <span style={{ color: 'var(--color-text-muted)', marginLeft: 6, fontSize: 12 }}>
            （只读）
          </span>
        )}
      </label>
      <FieldInput
        type={type}
        fieldSchema={fieldSchema}
        value={value}
        onChange={onChange}
        disabled={fieldDisabled}
      />
    </div>
  );
}

// ===== 输入控件分发 =====

interface FieldInputProps {
  type: string;
  fieldSchema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function FieldInput({ type, fieldSchema, value, onChange, disabled }: FieldInputProps) {
  switch (type) {
    case 'string':
      return (
        <StringInput
          fieldSchema={fieldSchema}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'number':
    case 'integer':
      return <NumberInput type={type} value={value} onChange={onChange} disabled={disabled} />;
    case 'boolean':
      return <BooleanInput value={value} onChange={onChange} disabled={disabled} />;
    case 'object':
      return (
        <ObjectInput
          fieldSchema={fieldSchema}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'array':
      return (
        <ArrayInput
          fieldSchema={fieldSchema}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    default:
      return (
        <StringInput
          fieldSchema={fieldSchema}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
  }
}

// ===== 字符串输入（含 enum 下拉） =====

interface StringInputProps {
  fieldSchema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function StringInput({ fieldSchema, value, onChange, disabled }: StringInputProps) {
  const options = getEnumOptions(fieldSchema);
  const strValue = typeof value === 'string' ? value : value == null ? '' : String(value);

  if (options.length > 0) {
    return (
      <select value={strValue} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">— 请选择 —</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={strValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

// ===== 数字输入 =====

interface NumberInputProps {
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function NumberInput({ type, value, onChange, disabled }: NumberInputProps) {
  const numValue =
    typeof value === 'number' ? value : value == null || value === '' ? '' : Number(value);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const str = e.target.value;
    if (str === '') {
      onChange(0);
      return;
    }
    const num = type === 'integer' ? parseInt(str, 10) : Number(str);
    onChange(Number.isNaN(num) ? 0 : num);
  };

  return (
    <input
      type="number"
      value={numValue}
      onChange={handleChange}
      disabled={disabled}
      step={type === 'integer' ? 1 : 'any'}
    />
  );
}

// ===== 布尔输入（checkbox + 文字提示） =====

interface BooleanInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function BooleanInput({ value, onChange, disabled }: BooleanInputProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
      }}
    >
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ width: 'auto' }}
      />
      {value ? '是' : '否'}
    </label>
  );
}

// ===== 嵌套对象输入（递归渲染子字段，左边距缩进） =====

interface ObjectInputProps {
  fieldSchema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function ObjectInput({ fieldSchema, value, onChange, disabled }: ObjectInputProps) {
  const { properties, required } = getProperties(fieldSchema);
  const objValue = isObject(value) ? value : {};

  if (Object.keys(properties).length === 0) {
    return <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>无子字段</span>;
  }

  return (
    <div
      style={{
        marginLeft: 16,
        paddingLeft: 12,
        borderLeft: '2px solid var(--color-border)',
      }}
    >
      {Object.entries(properties).map(([name, childSchema]) => (
        <SchemaField
          key={name}
          name={name}
          fieldSchema={childSchema}
          value={objValue[name]}
          onChange={(v) => onChange({ ...objValue, [name]: v })}
          required={required.includes(name)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ===== 数组输入（列表 + 添加/删除） =====

interface ArrayInputProps {
  fieldSchema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function ArrayInput({ fieldSchema, value, onChange, disabled }: ArrayInputProps) {
  const itemsSchema = isObject(fieldSchema.items) ? fieldSchema.items : null;
  const arrValue = Array.isArray(value) ? value : [];

  const handleItemChange = (index: number, itemValue: unknown) => {
    const newArr = [...arrValue];
    newArr[index] = itemValue;
    onChange(newArr);
  };

  const handleAdd = () => {
    onChange([...arrValue, getDefaultForSchema(itemsSchema)]);
  };

  const handleRemove = (index: number) => {
    onChange(arrValue.filter((_, i) => i !== index));
  };

  return (
    <div>
      {arrValue.map((item, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 8,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1 }}>
            {itemsSchema ? (
              <FieldInput
                type={getFieldType(itemsSchema)}
                fieldSchema={itemsSchema}
                value={item}
                onChange={(v) => handleItemChange(index, v)}
                disabled={disabled}
              />
            ) : (
              <input
                type="text"
                value={typeof item === 'string' ? item : String(item ?? '')}
                onChange={(e) => handleItemChange(index, e.target.value)}
                disabled={disabled}
              />
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleRemove(index)}
              style={{ flexShrink: 0 }}
            >
              删除
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleAdd}>
          + 添加
        </button>
      )}
    </div>
  );
}
