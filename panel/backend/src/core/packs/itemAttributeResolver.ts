// ============================================================================
// itemAttributeResolver.ts — 物品特殊属性自适应解析器
//
// 步骤 5: 物品池真实化与 special_attributes 自适应机制
//
// 职责:
//   - 解析 pack.items.special_attributes 声明,按当前实例版本号决定:
//     * 版本匹配 → 暴露该属性给前端商店配置页
//     * 版本不匹配 → 按 fallback_behavior 处理(hide/default/disable)
//   - 提供命令模板渲染前的 vars 预处理:
//     * fallback=default 时,未提供值则用 default_value 填充
//     * fallback=hide 时,从命令模板中移除该占位符
//     * fallback=disable 时,标记该物品不可发放
//
// 数据契约:public/schema/pack-schema.ts PackItemSpecialAttributeSchema
// 版本比对:panel/backend/src/core/packs/versionCompare.ts compareVersions
// ============================================================================

import type { GamePack, PackItemSpecialAttribute } from '@public/schema/pack-schema';
import { compareVersions, parseVersionFlex } from './versionCompare.js';

// ----- 类型 -----

/**
 * 单个特殊属性的解析结果。
 */
export interface ResolvedAttribute {
  /** 属性名(如 quality) */
  name: string;
  /** 前端展示名 */
  display_name: string;
  /** 当前实例版本是否适用该属性 */
  applicable: boolean;
  /** 该属性是否应暴露给前端配置页 */
  exposed: boolean;
  /**
   * 降级行为:
   *   - hide     — 前端不展示该属性,命令渲染时移除占位符
   *   - default  — 前端不展示该属性,命令渲染时用 default_value 替换
   *   - disable  — 该物品整体不可发放(前端置灰)
   */
  fallback_behavior: 'hide' | 'default' | 'disable';
  /** 默认值(fallback=default 时使用) */
  default_value?: string;
  /** 可选值枚举(仅 exposed=true 时有意义) */
  values?: string[];
  /** 命令模板中对应的占位符(如 '{{quality}}') */
  command_template_key?: string;
  /** 属性说明 */
  description?: string;
}

/**
 * 物品发放的解析上下文。
 *
 * 调用方在执行 give_command 前调用 resolveGiveCommandVars,
 * 传入用户选择的属性值(如 { quality: 'rare' }),
 * resolver 按当前实例版本自适应返回最终的 vars 对象。
 */
export interface AttributeResolutionResult {
  /** 该物品是否可发放(disable 降级时为 false) */
  dispatchable: boolean;
  /** 解析后的特殊属性列表 */
  attributes: ResolvedAttribute[];
  /**
   * 用于渲染 give_command 的最终 vars 增量。
   * 调用方应将其合并到自身 vars 后再调 commandDispatcher.renderCommand。
   *
   * - exposed=true 且用户提供了值: 用用户值
   * - exposed=true 但用户未提供值: 用 values[0] 或 default_value
   * - fallback=default: 用 default_value
   * - fallback=hide: 不出现在 vars 中(命令模板需先移除占位符)
   * - fallback=disable: dispatchable=false,vars 为空
   */
  vars: Record<string, string>;
  /** 待从命令模板中移除的占位符列表(如 ['{{quality}}']) */
  placeholders_to_remove: string[];
}

// ----- 核心函数 -----

/**
 * 解析语义版本约束(如 '>=2.0.0' / '<3.0.0' / '1.x' / '>=1.20,<1.21')。
 *
 * 支持的格式:
 *   - 简单比较: '>=2.0.0' / '<3.0.0' / '=1.20.4' / '>1.0' / '<=2.5'
 *   - 范围(逗号分隔): '>=1.20,<1.21' / '>=2.0,<=2.5'
 *   - 通配符: '1.x' / '2.0.x' (相当于 '>=1.0.0,<2.0.0' / '>=2.0.0,<2.1.0')
 *   - 空字符串或 undefined: 视为全版本适用
 *
 * @returns true=当前版本满足约束;false=不满足
 */
export function matchesVersionConstraint(
  currentVersion: string,
  constraint: string | undefined,
): boolean {
  if (!constraint || constraint.trim() === '') {
    return true; // 全版本适用
  }

  const trimmed = constraint.trim();

  // 通配符:1.x / 2.0.x
  if (/^\d+(\.\d+)?\.x$/i.test(trimmed)) {
    const segments = trimmed.replace(/\.x$/i, '').split('.').map(Number);
    if (segments.length === 1) {
      // "1.x" → 匹配 >=1.0.0, <2.0.0
      const lower = `${segments[0]}.0.0`;
      const upper = `${segments[0] + 1}.0.0`;
      return (
        compareVersions(currentVersion, lower) >= 0 &&
        compareVersions(currentVersion, upper) < 0
      );
    } else {
      // "2.0.x" → 匹配 >=2.0.0, <2.1.0
      const lower = `${segments[0]}.${segments[1]}.0`;
      const upper = `${segments[0]}.${segments[1] + 1}.0`;
      return (
        compareVersions(currentVersion, lower) >= 0 &&
        compareVersions(currentVersion, upper) < 0
      );
    }
  }

  // 多约束(逗号分隔)
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.every((part) => matchesSingleConstraint(currentVersion, part));
}

function matchesSingleConstraint(version: string, constraint: string): boolean {
  const m = constraint.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] || '=';
  const target = m[2].trim();
  const cmp = compareVersions(version, target);
  switch (op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>':  return cmp > 0;
    case '<':  return cmp < 0;
    case '=':
    default:   return cmp === 0;
  }
}

/**
 * 解析 Pack 的所有 special_attributes,返回每个属性在当前实例版本下的状态。
 *
 * @param pack 游戏 Pack(必须已通过 zod 校验)
 * @param currentVersion 实例当前版本号(如 '2.0.77' / '1.1.109')
 * @returns 解析后的属性列表(供前端配置页使用)
 */
export function resolveAttributes(
  pack: GamePack,
  currentVersion: string,
): ResolvedAttribute[] {
  const attrs = pack.items?.special_attributes;
  if (!attrs || attrs.length === 0) {
    return [];
  }

  return attrs.map((attr) => resolveAttribute(attr, currentVersion));
}

function resolveAttribute(
  attr: PackItemSpecialAttribute,
  currentVersion: string,
): ResolvedAttribute {
  const applicable = matchesVersionConstraint(currentVersion, attr.applicable_versions);
  const exposed = applicable;
  return {
    name: attr.name,
    display_name: attr.display_name,
    applicable,
    exposed,
    fallback_behavior: attr.fallback_behavior,
    default_value: attr.default_value,
    values: attr.values,
    command_template_key: attr.command_template_key,
    description: attr.description,
  };
}

/**
 * 解析物品发放命令的最终 vars。
 *
 * 调用方应在 commandDispatcher.renderCommand 之前调用本函数,将返回的 vars 合并到
 * 自身 vars 中,并按 placeholders_to_remove 预处理命令模板(移除被隐藏的占位符)。
 *
 * 行为:
 *   - 当任一属性的 fallback_behavior=disable 且版本不匹配 → dispatchable=false
 *   - 当 fallback=default 且版本不匹配 → vars[name] = default_value
 *   - 当 fallback=hide 且版本不匹配 → placeholders_to_remove 含该占位符,vars 不含该键
 *   - 当 exposed=true 时:
 *     * 用户提供了值 → vars[name] = 用户值
 *     * 用户未提供值 → vars[name] = values?.[0] ?? default_value ?? ''
 *
 * @param pack 游戏 Pack
 * @param currentVersion 实例当前版本号
 * @param userInput 用户输入的特殊属性值(如 { quality: 'rare' });未提供的属性走默认逻辑
 * @returns 解析结果,包含 dispatchable / vars / placeholders_to_remove
 */
export function resolveGiveCommandVars(
  pack: GamePack,
  currentVersion: string,
  userInput: Record<string, string> = {},
): AttributeResolutionResult {
  const attrs = pack.items?.special_attributes ?? [];
  const result: AttributeResolutionResult = {
    dispatchable: true,
    attributes: [],
    vars: {},
    placeholders_to_remove: [],
  };

  for (const attr of attrs) {
    const resolved = resolveAttribute(attr, currentVersion);
    result.attributes.push(resolved);

    // 版本不匹配:按 fallback_behavior 处理
    if (!resolved.applicable) {
      switch (resolved.fallback_behavior) {
        case 'disable':
          result.dispatchable = false;
          break;
        case 'default':
          if (resolved.default_value !== undefined) {
            result.vars[attr.name] = resolved.default_value;
          }
          break;
        case 'hide':
          if (resolved.command_template_key) {
            result.placeholders_to_remove.push(resolved.command_template_key);
          }
          break;
      }
      continue;
    }

    // 版本匹配:优先用用户输入,其次用 values[0],最后用 default_value
    const userVal = userInput[attr.name];
    if (userVal !== undefined && userVal !== '') {
      result.vars[attr.name] = userVal;
    } else if (resolved.values && resolved.values.length > 0) {
      result.vars[attr.name] = resolved.values[0];
    } else if (resolved.default_value !== undefined) {
      result.vars[attr.name] = resolved.default_value;
    }
  }

  return result;
}

/**
 * 预处理命令模板:移除被 hide 的占位符。
 *
 * 被移除的占位符会被替换为空字符串。
 * 调用方应在 commandDispatcher.renderCommand 之前调用本函数。
 *
 * @param template 原始命令模板
 * @param placeholdersToRemove 待移除的占位符列表(如 ['{{quality}}'])
 * @returns 处理后的模板
 */
export function stripHiddenPlaceholders(
  template: string,
  placeholdersToRemove: string[],
): string {
  if (placeholdersToRemove.length === 0) {
    return template;
  }
  let result = template;
  for (const ph of placeholdersToRemove) {
    // 转义占位符中的特殊字符(如 {{ }}),构造正则
    const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 允许占位符两侧有空白,替换为单个空格(保持词间分隔)
    const re = new RegExp(`\\s*${escaped}\\s*`, 'g');
    result = result.replace(re, ' ');
  }
  // 清理因移除占位符可能产生的多余空格(如 "give  Steve  1" → "give Steve 1")
  // 并移除首尾空格
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * 判断 Pack 是否声明了某个特殊属性。
 *
 * 用于前端在未声明任何 special_attributes 的 Pack 上跳过自适应逻辑(向后兼容)。
 */
export function hasSpecialAttributes(pack: GamePack): boolean {
  const attrs = pack.items?.special_attributes;
  return !!attrs && attrs.length > 0;
}

// ----- 辅助:从 GamePack 提取 special_attributes(便于单测) -----

/**
 * 直接从 Pack 取出 special_attributes 原始声明(便于调试与单测)。
 */
export function getSpecialAttributes(pack: GamePack): PackItemSpecialAttribute[] {
  return pack.items?.special_attributes ?? [];
}

// ----- 兼容性导出 -----

/**
 * 当 Pack 未声明 special_attributes 或当前版本全适用时,
 * 调用方可直接用 userInput 渲染命令,无需走 resolveGiveCommandVars。
 *
 * 本函数提供一个快速判断:是否需要走自适应流程。
 */
export function needsAttributeResolution(
  pack: GamePack,
  currentVersion: string,
): boolean {
  const attrs = pack.items?.special_attributes;
  if (!attrs || attrs.length === 0) {
    return false;
  }
  // 任一属性版本不匹配 → 需要走自适应
  return attrs.some((attr) => !matchesVersionConstraint(currentVersion, attr.applicable_versions));
}

// 用于版本号解析的辅助(导出便于单测)
export { parseVersionFlex };
