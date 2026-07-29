// ============================================================================
// startupGuideService — 启动前置引导工具函数（v1.1.0）
// 来源：docs/plans/instance-startup-guide-and-action-bar-plan.md §3.4
//
// 纯函数模块，无外部依赖（仅依赖 public/schema 契约类型）。
// 提供：
//   - validateStartupGuide：校验用户填写的 startup_config 是否覆盖所有 required 字段
//   - renderStartupArgs：按 args_mapping 渲染 startup.args 模板变量
//   - validateStartupConfig：校验字段值类型/范围/枚举
// ============================================================================

import type {
  StartupGuide,
  StartupGuideField,
} from '@public/schema/pack-schema.js';

/** 启动配置值类型（存入 servers.startup_config_json 解析后） */
export type StartupConfigValue = string | number | boolean;
export type StartupConfig = Record<string, StartupConfigValue>;

/** validateStartupGuide 返回结果 */
export interface StartupGuideValidationResult {
  /** 是否已完成（已覆盖所有 required 且无 default 的字段） */
  completed: boolean;
  /** 缺失的 required 字段 key 清单 */
  missingFields: string[];
  /** 缺失字段所属步骤 key 清单（去重） */
  missingSteps: string[];
}

/**
 * 校验用户填写的 startup_config 是否覆盖 Pack startup_guide 声明的所有 required 字段。
 *
 * 判定规则：
 *   - step.optional=true → 整步跳过
 *   - field.required=true 且 field.default===undefined 且 config 中无该 key → 缺失
 *   - field.required=true 但 field.default 有值 → 视为已覆盖（用户不填则后端用 default 兜底）
 *   - field.required=false → 不校验
 *
 * @param guide Pack 声明的启动前置引导
 * @param config 用户已填写的启动配置（startup_config_json 解析结果，空对象表示未填写）
 */
export function validateStartupGuide(
  guide: StartupGuide,
  config: StartupConfig,
): StartupGuideValidationResult {
  const missingFields: string[] = [];
  const missingSteps: string[] = [];

  for (const step of guide.steps) {
    if (step.optional) continue;
    let stepHasMissing = false;
    for (const field of step.fields) {
      if (!field.required) continue;
      // 有 default 的 required 字段视为已覆盖（用户不填则后端用 default 兜底）
      if (field.default !== undefined) continue;
      if (!(field.key in config)) {
        missingFields.push(field.key);
        stepHasMissing = true;
      }
    }
    if (stepHasMissing && !missingSteps.includes(step.key)) {
      missingSteps.push(step.key);
    }
  }

  return {
    completed: missingFields.length === 0,
    missingFields,
    missingSteps,
  };
}

/**
 * 按 args_mapping 渲染 startup.args 中的模板变量 {{var}}。
 *
 * args_mapping 结构：{ field_key: '{{var_name}}' }
 *   - key = StartupGuideField.key（对应 config 中的字段）
 *   - value = startup.args 中对应的模板占位符
 *
 * 渲染规则：
 *   - 对 args 每个元素，用正则替换所有 {{var}} 形式的占位符
 *   - 占位符能在 args_mapping.value 中找到 → 用 config[对应 field_key] 替换
 *   - 占位符无映射或 config 中无该字段 → 保留原占位符（由调用方决定是否阻断）
 *   - 支持 `{{map}}` 整体占位 和 `ServerName={{server_name}}` 嵌入两种形式
 *
 * @param args Pack startup.args 原始数组
 * @param config 用户填写的启动配置
 * @param argsMapping Pack startup_guide.args_mapping（无则原样返回 args）
 */
export function renderStartupArgs(
  args: string[],
  config: StartupConfig,
  argsMapping?: Record<string, string>,
): string[] {
  if (!argsMapping || Object.keys(argsMapping).length === 0) {
    return args;
  }
  // 反转映射：placeholder('{{var}}') → field_key
  const placeholderToField = new Map<string, string>();
  for (const [fieldKey, placeholder] of Object.entries(argsMapping)) {
    placeholderToField.set(placeholder, fieldKey);
  }
  return args.map((arg) =>
    arg.replace(/\{\{(\w+)\}\}/g, (match, _varName: string) => {
      const fieldKey = placeholderToField.get(match);
      if (fieldKey !== undefined && fieldKey in config) {
        return String(config[fieldKey]);
      }
      return match; // 未找到映射或 config 无该字段，保留原占位符
    }),
  );
}

/** validateStartupConfig 返回的单个字段错误 */
export interface StartupConfigFieldError {
  field: string;
  message: string;
}

/** validateStartupConfig 返回结果 */
export interface StartupConfigValidationResult {
  valid: boolean;
  errors: StartupConfigFieldError[];
}

/**
 * 校验用户填写的 startup_config 字段值是否符合 Pack 声明的类型/范围/枚举约束。
 *
 * 校验项：
 *   - 字段 key 必须在 guide 声明中（防注入未知字段）
 *   - 数字类型字段：必须是 number，且满足 min/max
 *   - enum_values 声明的字段：值必须在枚举内
 *   - map 类型字段：值必须在 options.value 内
 *
 * 不校验 required（由 validateStartupGuide 负责）。
 *
 * @param guide Pack 声明的启动前置引导
 * @param config 用户填写的启动配置
 */
export function validateStartupConfig(
  guide: StartupGuide,
  config: StartupConfig,
): StartupConfigValidationResult {
  const errors: StartupConfigFieldError[] = [];

  // 收集所有字段声明
  const fieldMap = new Map<string, StartupGuideField>();
  for (const step of guide.steps) {
    for (const field of step.fields) {
      fieldMap.set(field.key, field);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    const field = fieldMap.get(key);
    if (!field) {
      errors.push({ field: key, message: `未知字段: ${key}` });
      continue;
    }

    // 数字类型字段校验（max_players 或显式 number 值）
    const isNumericField =
      field.type === 'max_players' ||
      field.min !== undefined ||
      field.max !== undefined;
    if (isNumericField && typeof value !== 'number') {
      errors.push({
        field: key,
        message: `${field.label} 必须是数字`,
      });
      continue;
    }
    if (typeof value === 'number') {
      if (field.min !== undefined && value < field.min) {
        errors.push({
          field: key,
          message: `${field.label} 不能小于 ${field.min}`,
        });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({
          field: key,
          message: `${field.label} 不能大于 ${field.max}`,
        });
      }
    }

    // enum_values 校验
    if (
      field.enum_values &&
      field.enum_values.length > 0 &&
      !field.enum_values.includes(String(value))
    ) {
      errors.push({
        field: key,
        message: `${field.label} 必须是以下值之一: ${field.enum_values.join(', ')}`,
      });
    }

    // map 类型校验 options
    if (field.type === 'map' && field.options && field.options.length > 0) {
      if (!field.options.some((o) => o.value === String(value))) {
        errors.push({
          field: key,
          message: `${field.label} 不是有效的地图选项`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 合并用户配置与字段 default，得到完整的启动配置（用于 renderStartupArgs / applyConfigWrites）。
 *
 * 优先级：config 中显式填写的值 > field.default。
 * 未填写且无 default 的字段不出现在结果中。
 */
export function mergeWithDefaults(
  guide: StartupGuide,
  config: StartupConfig,
): StartupConfig {
  const merged: StartupConfig = { ...config };
  for (const step of guide.steps) {
    for (const field of step.fields) {
      if (!(field.key in merged) && field.default !== undefined) {
        merged[field.key] = field.default;
      }
    }
  }
  return merged;
}
