// ============================================================================
// mapServerErrors — 服务端错误到表单字段级错误的映射工具
// 7.1: 将 PanelApiError 映射为 FieldErrors，供表单在字段下方显示服务端错误
// 用法：
//   const fieldErrs = mapServerFieldErrors(err, { port: 'PORT_CONFLICT' });
//   // 若 err.code === 'PORT_CONFLICT'，返回 { port: err.message }
// ============================================================================

import { PanelApiError } from '../api/client';
import type { FieldErrors } from './formValidation';

/**
 * 将服务端错误映射到表单字段级错误。
 *
 * @param error    捕获到的错误对象（通常是 PanelApiError）
 * @param fieldMap 表单字段名 -> 期望匹配的服务端错误码
 *                 例如 { port: 'PORT_CONFLICT' } 表示当 error.code === 'PORT_CONFLICT'
 *                 时把错误信息绑定到 port 字段
 * @returns 字段错误映射；未匹配时返回空对象
 */
export function mapServerFieldErrors(
  error: unknown,
  fieldMap: Record<string, string>,
): FieldErrors<string> {
  if (!(error instanceof PanelApiError)) return {};

  // 1. 支持服务端返回字段级 details（{ field: message } 形式，未来扩展）
  //    仅保留 fieldMap 中声明的字段（白名单），避免注入未知字段
  const details = (
    error as PanelApiError & { details?: Record<string, string> }
  ).details;
  if (details && typeof details === 'object') {
    const result: FieldErrors<string> = {};
    for (const [field, msg] of Object.entries(details)) {
      if (field in fieldMap) {
        result[field] = typeof msg === 'string' ? msg : String(msg);
      }
    }
    if (Object.keys(result).length > 0) return result;
  }

  // 2. 按 error.code 匹配 fieldMap（fieldMap: formField -> errorCode）
  for (const [field, code] of Object.entries(fieldMap)) {
    if (error.code === code) {
      return { [field]: error.message };
    }
  }

  return {};
}

/**
 * 判断错误是否为指定的服务端错误码。
 * 用于表单顶部红色提示条显示非字段级错误（如 INVALID_CREDENTIALS）。
 */
export function isServerErrorCode(error: unknown, code: string): boolean {
  return error instanceof PanelApiError && error.code === code;
}

/**
 * 提取服务端错误的可展示信息。
 * 非 PanelApiError 时回退到 Error.message 或默认提示。
 */
export function getServerErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof PanelApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
