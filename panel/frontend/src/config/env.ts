// ============================================================================
// 环境变量集中访问层 — 四.10
// 所有 import.meta.env 访问统一经此模块，便于类型约束与默认值管理
// Vite 仅暴露 VITE_ 前缀变量到前端
// ============================================================================

/**
 * REST API 基址。
 * - 开发：留空走 Vite proxy（/api → 同源或动态代理）
 * - 生产：留空走同源（前端由后端 3000 端口托管，/api 同源命中）
 * - 独立部署：显式设置 VITE_API_BASE=https://api.example.com
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

/**
 * REST 请求路径前缀（始终为 /api，拼接在 API_BASE 后）。
 * 开发环境下由 vite.config.ts proxy 转发到 Panel 后端。
 */
export const API_PREFIX: string = '/api';

/** 完整 REST API 根路径（API_BASE + /api） */
export const REST_BASE: string = `${API_BASE}${API_PREFIX}`;

/**
 * WebSocket 基址。
 * - 若 VITE_API_BASE 显式设置，由其推导（http→ws）
 * - 否则使用当前页面同源（生产同域部署场景）
 */
function resolveWsBase(): string {
  const explicit = import.meta.env.VITE_API_BASE as string | undefined;
  if (explicit) {
    return explicit.replace(/^http/, 'ws');
  }
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return '';
}

export const WS_BASE: string = resolveWsBase();

/** 是否开发环境（Vite dev server） */
export const IS_DEV: boolean = import.meta.env.DEV;

/** 是否生产构建 */
export const IS_PROD: boolean = import.meta.env.PROD;
