// ============================================================================
// proxy.ts — 第三方服务反向代理（v4.4.0-I1）
//
// 路由本身不套鉴权中间件（在 index.ts 挂载时统一套 authenticateToken）
// 依赖：app.locals.db（Knex，读取 system_config 表的服务端 API Key）
//
// 挂载前缀：/api/proxy
//   GET  /                                  — 列出可用的代理服务
//   ALL  /:service/*                        — 透传请求到第三方 API
//
// 设计要点：
//   1. 服务白名单（modrinth/curseforge/mojang/steam），拒绝任意主机代理（防 SSRF）
//   2. 仅允许 HTTPS 上游
//   3. header 转换：前端 X-Service-Authorization → 上游 Authorization / x-api-key / ?key=
//   4. 服务端 API Key fallback：system_config.proxy.<service>.api_key（server_admin 配置）
//   5. 剥离 hop-by-hop / 敏感头（Authorization/Cookie/Host 不透传）
//   6. 请求体上限 10MB，响应体上限 50MB，超时 30s
//   7. 流式透传响应体（避免大响应耗尽内存）
// ============================================================================

import { Router, type Response as ExpressResponse } from 'express';
import type { Knex } from 'knex';
import type {
  ProxyListServicesResponse,
  ProxyService,
  ProxyServiceInfo,
  PanelErrorResponse,
} from '@public/schema/panel-api-types';

// ----- 服务配置 -----

interface ServiceConfig {
  baseUrl: string;
  displayName: string;
  requiresApiKey: boolean;
  /**
   * 上游 API Key 的载体：
   *  - 'Authorization' / 'x-api-key' 等 → 作为请求头
   *  - 'key' → 作为查询参数（Steam 风格）
   *  - null → 不需要 API Key
   */
  apiKeyHeader: string | null;
  description: string;
}

const SERVICE_CONFIG: Record<ProxyService, ServiceConfig> = {
  modrinth: {
    baseUrl: 'https://api.modrinth.com',
    displayName: 'Modrinth',
    // Modrinth 大部分端点公开，user-specific 操作才需要 Authorization
    requiresApiKey: false,
    apiKeyHeader: 'Authorization',
    description: 'Modrinth Mod 仓库 API（搜索/查询 Mod/项目/版本，部分端点需要用户 token）',
  },
  curseforge: {
    baseUrl: 'https://api.curseforge.com',
    displayName: 'CurseForge',
    // CurseForge 所有端点都需要 x-api-key
    requiresApiKey: true,
    apiKeyHeader: 'x-api-key',
    description: 'CurseForge Mod 仓库 API（搜索/查询 Mod/项目/文件，需要 API Key）',
  },
  mojang: {
    baseUrl: 'https://api.mojang.com',
    displayName: 'Mojang',
    // Mojang 大部分端点公开（UUID/档案查询），登录操作走单独域
    requiresApiKey: false,
    apiKeyHeader: 'Authorization',
    description: 'Mojang 官方 API（玩家档案/UUID 查询/版本清单）',
  },
  steam: {
    baseUrl: 'https://api.steampowered.com',
    displayName: 'Steam',
    // Steam 大部分端点需要 key 查询参数
    requiresApiKey: true,
    apiKeyHeader: 'key',
    description: 'Steam Web API（服务器查询/玩家摘要，需要 API Key）',
  },
};

// ----- 常量 -----

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RESPONSE_BODY_BYTES = 50 * 1024 * 1024; // 50MB
const PANEL_USER_AGENT = 'GameServerPanel/4.4 (+https://github.com/airxw/gameserver-panel)';

/** 剥离的请求头（hop-by-hop / 敏感 / 由 fetch 自身管理） */
const STRIPPED_REQ_HEADERS = new Set([
  'host',
  'authorization',
  'cookie',
  'x-api-key',
  'x-service-authorization',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

/** 剥离的响应头（避免与 Express 冲突 / fetch 已解压） */
const STRIPPED_RES_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

// ----- 路由 -----

export function createProxyRouter(): Router {
  const router = Router();

  // ===== GET / — 列出可用的代理服务 =====
  router.get('/', async (req, res) => {
    try {
      const db = req.app.locals.db as Knex | undefined;
      const services: ProxyServiceInfo[] = [];
      for (const name of Object.keys(SERVICE_CONFIG) as ProxyService[]) {
        const cfg = SERVICE_CONFIG[name];
        let apiKeyConfigured = false;
        if (db && cfg.requiresApiKey) {
          try {
            const row = await db<{ value: string }>('system_config')
              .select('value')
              .where('key', '=', `proxy.${name}.api_key`)
              .first();
            apiKeyConfigured = !!row?.value;
          } catch {
            // 表未就绪 / 查询失败 → 视为未配置
          }
        }
        services.push({
          name,
          display_name: cfg.displayName,
          base_url: cfg.baseUrl,
          requires_api_key: cfg.requiresApiKey,
          api_key_header: cfg.apiKeyHeader,
          api_key_configured: apiKeyConfigured,
          description: cfg.description,
        });
      }
      const response: ProxyListServicesResponse = { services };
      res.json(response);
    } catch (err) {
      handleProxyError(res, err);
    }
  });

  // ===== ALL /:service/* — 透传请求到上游 =====
  router.all('/:service/*', async (req, res) => {
    try {
      const serviceName = req.params.service as string;
      const cfg = (SERVICE_CONFIG as Record<string, ServiceConfig | undefined>)[serviceName];
      if (!cfg) {
        sendProxyError(res, 400, 'PROXY_SERVICE_NOT_ALLOWED', `不支持的代理服务: ${serviceName}`);
        return;
      }

      if (!ALLOWED_METHODS.has(req.method)) {
        sendProxyError(res, 405, 'PROXY_TARGET_INVALID', `不支持的 HTTP 方法: ${req.method}`);
        return;
      }

      // 解析路径段与查询串
      // Express 4 中 /:service/* 匹配后 req.params[0] 为通配部分（不含查询串）
      // TypeScript 仅识别具名参数 service，需 cast 取通配段
      const params = req.params as unknown as Record<string, string>;
      const pathSegments = params['0'] ?? '';
      // req.url 在 router 内是剥离了挂载前缀的剩余 URL（含查询串）
      const rawQuery = req.url.split('?')[1] ?? '';

      // 解析 API Key：前端 X-Service-Authorization 优先，其次 system_config
      const db = req.app.locals.db as Knex | undefined;
      let apiKey: string | null = null;
      const clientApiKey = req.get('x-service-authorization');
      if (clientApiKey) {
        apiKey = clientApiKey;
      } else if (db && cfg.requiresApiKey) {
        try {
          const row = await db<{ value: string }>('system_config')
            .select('value')
            .where('key', '=', `proxy.${serviceName}.api_key`)
            .first();
          apiKey = row?.value ?? null;
        } catch {
          // 表未就绪 → 视为未配置
        }
      }

      if (cfg.requiresApiKey && !apiKey) {
        sendProxyError(
          res,
          400,
          'PROXY_API_KEY_MISSING',
          `服务 ${serviceName} 需要 API Key，但前端未传 X-Service-Authorization 头且服务端未配置 system_config.proxy.${serviceName}.api_key`,
        );
        return;
      }

      // 构造上游 URL
      const fullPath = pathSegments.startsWith('/') ? pathSegments.slice(1) : pathSegments;
      let url: string;
      if (cfg.apiKeyHeader === 'key' && apiKey) {
        // Steam 风格：key 作为查询参数
        const sep = rawQuery ? '&' : '';
        url = `${cfg.baseUrl}/${fullPath}?${rawQuery}${sep}key=${encodeURIComponent(apiKey)}`;
      } else {
        url = rawQuery ? `${cfg.baseUrl}/${fullPath}?${rawQuery}` : `${cfg.baseUrl}/${fullPath}`;
      }

      // 验证 URL（防 SSRF：仅允许 HTTPS + host 与服务配置一致）
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        sendProxyError(res, 400, 'PROXY_TARGET_INVALID', `URL 解析失败: ${url}`);
        return;
      }
      if (parsedUrl.protocol !== 'https:') {
        sendProxyError(
          res,
          400,
          'PROXY_TARGET_INVALID',
          `仅允许 HTTPS 协议（拒绝 ${parsedUrl.protocol}）`,
        );
        return;
      }
      const expectedHost = new URL(cfg.baseUrl).host;
      if (parsedUrl.host !== expectedHost) {
        sendProxyError(
          res,
          400,
          'PROXY_TARGET_INVALID',
          `目标主机 ${parsedUrl.host} 与服务配置 ${expectedHost} 不一致`,
        );
        return;
      }

      // 构造请求头
      const headers: Record<string, string> = {
        'User-Agent': PANEL_USER_AGENT,
        Accept: 'application/json',
      };
      // 透传 Content-Type（POST/PUT/PATCH 需要）
      const contentType = req.get('content-type');
      if (contentType) {
        headers['Content-Type'] = contentType;
      }
      // 注入 API Key（Steam 已作为查询参数处理，此处跳过）
      if (apiKey && cfg.apiKeyHeader && cfg.apiKeyHeader !== 'key') {
        headers[cfg.apiKeyHeader] = apiKey;
      }
      // 透传其他非剥离头
      for (const [k, v] of Object.entries(req.headers)) {
        if (STRIPPED_REQ_HEADERS.has(k.toLowerCase())) continue;
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          headers[k] = v.join(', ');
        } else {
          headers[k] = v;
        }
      }

      // 读取请求体（仅非 GET/HEAD 方法）
      let body: Buffer | undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let bodyTooLarge = false;
        for await (const chunk of req) {
          if (typeof chunk === 'string') {
            // 理论上 Express 4 默认 Buffer，保险起见处理 string
            totalBytes += Buffer.byteLength(chunk);
          } else {
            totalBytes += chunk.length;
          }
          if (totalBytes > MAX_REQUEST_BODY_BYTES) {
            bodyTooLarge = true;
            break;
          }
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
        }
        if (bodyTooLarge) {
          sendProxyError(
            res,
            413,
            'PROXY_TARGET_INVALID',
            `请求体超过 ${MAX_REQUEST_BODY_BYTES} 字节上限`,
          );
          return;
        }
        if (chunks.length > 0) {
          body = Buffer.concat(chunks);
        }
      }

      // 发起上游请求（带超时）
      // 注：fetch 返回全局 Response 类型，与 Express Response 不同，此处显式标注
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      let upstreamRes: globalThis.Response;
      try {
        upstreamRes = await fetch(url, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          sendProxyError(
            res,
            504,
            'PROXY_TIMEOUT',
            `上游响应超时（${UPSTREAM_TIMEOUT_MS}ms）`,
          );
          return;
        }
        sendProxyError(
          res,
          502,
          'PROXY_UPSTREAM_ERROR',
          `上游请求失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      } finally {
        clearTimeout(timer);
      }

      // 透传响应头（剥离 hop-by-hop / content-encoding / content-length）
      const resHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((value: string, key: string) => {
        if (STRIPPED_RES_HEADERS.has(key.toLowerCase())) return;
        resHeaders[key] = value;
      });

      // 透传状态码与响应头
      res.status(upstreamRes.status);
      for (const [k, v] of Object.entries(resHeaders)) {
        res.setHeader(k, v);
      }

      // 流式透传响应体（限制 50MB，超限截断）
      if (upstreamRes.body) {
        let bytesWritten = 0;
        let exceeded = false;
        const reader = upstreamRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytesWritten += value.length;
              if (bytesWritten > MAX_RESPONSE_BODY_BYTES) {
                exceeded = true;
                break;
              }
              res.write(value);
            }
          }
        } finally {
          reader.releaseLock();
        }
        if (exceeded) {
          // 响应头与状态码已发送，无法改 → 截断并终止连接
          // 日志由全局中间件记录（此处仅结束响应）
          res.end();
          return;
        }
      }
      res.end();
    } catch (err) {
      // 如果响应头已发送（流式透传中途出错），只能终止连接
      if (res.headersSent) {
        res.end();
        return;
      }
      handleProxyError(res, err);
    }
  });

  return router;
}

// ----- 辅助：错误响应 -----

function sendProxyError(
  res: ExpressResponse,
  status: number,
  code: PanelErrorResponse['error']['code'],
  message: string,
): void {
  const body: PanelErrorResponse = {
    error: { code, message },
  };
  res.status(status).json(body);
}

function handleProxyError(res: ExpressResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const body: PanelErrorResponse = {
    error: { code: 'PANEL_INTERNAL_ERROR', message: `代理内部错误: ${message}` },
  };
  res.status(500).json(body);
}
