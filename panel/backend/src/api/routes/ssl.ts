// ============================================================================
// v4.4.0-L1: SSL 证书管理路由
//
// 端点：
//   GET  /api/system/ssl                   — 获取当前证书信息
//   POST /api/system/ssl/reload            — 触发 nginx 热重载
//   POST /api/system/ssl/stage             — 暂存上传的证书文件
//   POST /api/system/ssl/deploy            — 部署暂存证书到 nginx + 热重载
//   POST /api/system/ssl/deploy/preview    — 部署预览（指纹对比 + nginx -t，不实际部署）
//   POST /api/system/ssl/rollback          — 回滚到上一份证书备份
//   POST /api/system/ssl/self-signed       — 生成自签证书（openssl fallback）
//
// 鉴权：authenticateToken + requireAdmin（仅 server_admin 可操作）
// ============================================================================

import { Router } from 'express';
import type { Logger } from 'pino';
import type { SslService, CertificateInfo } from '../../services/sslService.js';
import type { PanelErrorResponse } from '@public/schema/panel-api-types';

/** GET /api/system/ssl 响应 */
interface GetSslInfoResponse {
  certificate: CertificateInfo;
}

/** POST /api/system/ssl/stage 请求 */
interface StageCertificateRequest {
  /** PEM 格式证书内容（fullchain） */
  pem_content: string;
  /** KEY 格式私钥内容 */
  key_content: string;
}

/** POST /api/system/ssl/stage 响应 */
interface StageCertificateResponse {
  cert_path: string;
  key_path: string;
  message: string;
}

/** POST /api/system/ssl/deploy 请求 */
interface DeployCertificateRequest {
  cert_path: string;
  key_path: string;
}

/** POST /api/system/ssl/deploy 响应 */
interface DeployCertificateResponse {
  success: boolean;
  message: string;
}

/** POST /api/system/ssl/deploy/preview 请求 */
interface DeployPreviewRequest {
  /** PEM 格式证书内容（fullchain），用于计算新指纹（不实际部署） */
  pem_content: string;
}

/** POST /api/system/ssl/deploy/preview 响应 */
interface DeployPreviewResponse {
  /** 当前证书指纹 SHA-256（无证书时为 null） */
  current_fingerprint: string | null;
  /** 新证书指纹 SHA-256（解析失败时为 null） */
  new_fingerprint: string | null;
  /** nginx 配置语法是否通过（nginx -t） */
  nginx_config_valid: boolean;
  /** 错误信息（PEM 解析错误 / nginx -t 错误），无错误为 null */
  errors: string | null;
}

/** POST /api/system/ssl/rollback 响应 */
interface RollbackResponse {
  success: boolean;
  /** 回滚到的备份文件名 */
  rolled_back_to: string | null;
  /** 回滚后证书指纹 SHA-256 */
  fingerprint: string | null;
  message: string;
}

/** POST /api/system/ssl/reload 响应 */
interface ReloadNginxResponse {
  success: boolean;
  message: string;
}

/** POST /api/system/ssl/self-signed 请求 */
interface GenerateSelfSignedRequest {
  common_name: string;
  san_domains: string[];
  days?: number;
  organization?: string;
}

/** POST /api/system/ssl/self-signed 响应 */
interface GenerateSelfSignedResponse {
  cert_path: string;
  key_path: string;
  message: string;
}

/**
 * 创建 SSL 证书管理路由
 *
 * @param sslService SSL 证书管理服务实例
 * @param logger     日志记录器
 */
export function createSslRouter(sslService: SslService, logger: Logger): Router {
  const router = Router();

  // ----------------------------------------------------------------
  // GET /api/system/ssl — 获取当前证书信息
  // ----------------------------------------------------------------
  router.get('/', (_req, res) => {
    try {
      const certificate = sslService.getCertificateInfo();
      const body: GetSslInfoResponse = { certificate };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/get-info: 读取证书信息失败');
      const body: PanelErrorResponse = {
        error: {
          code: 'SSL_CERT_READ_FAILED',
          message,
        },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/reload — 触发 nginx 热重载
  // ----------------------------------------------------------------
  router.post('/reload', async (_req, res) => {
    try {
      const result = await sslService.reloadNginx();
      const body: ReloadNginxResponse = result;
      res.status(result.success ? 200 : 502).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/reload: nginx 热重载失败');
      const body: PanelErrorResponse = {
        error: {
          code: 'SSL_NGINX_RELOAD_FAILED',
          message,
        },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/stage — 暂存上传的证书文件
  // ----------------------------------------------------------------
  router.post('/stage', (req, res) => {
    try {
      const { pem_content, key_content } = req.body as StageCertificateRequest;

      if (!pem_content || typeof pem_content !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'pem_content 必填且为字符串' },
        };
        res.status(400).json(body);
        return;
      }
      if (!key_content || typeof key_content !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'key_content 必填且为字符串' },
        };
        res.status(400).json(body);
        return;
      }

      // 基础格式校验：PEM 必须含 BEGIN CERTIFICATE，KEY 必须含 PRIVATE KEY
      if (!pem_content.includes('BEGIN CERTIFICATE')) {
        const body: PanelErrorResponse = {
          error: { code: 'SSL_CERT_FORMAT_INVALID', message: 'pem_content 不是有效的 PEM 证书格式' },
        };
        res.status(400).json(body);
        return;
      }
      if (!key_content.includes('PRIVATE KEY')) {
        const body: PanelErrorResponse = {
          error: { code: 'SSL_KEY_FORMAT_INVALID', message: 'key_content 不是有效的私钥格式' },
        };
        res.status(400).json(body);
        return;
      }

      const result = sslService.stageCertificate(pem_content, key_content);
      const body: StageCertificateResponse = {
        ...result,
        message: '证书已暂存，可调用 /deploy 部署到 nginx',
      };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/stage: 暂存证书失败');
      const body: PanelErrorResponse = {
        error: { code: 'SSL_STAGE_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/deploy — 部署暂存证书到 nginx + 热重载
  // ----------------------------------------------------------------
  router.post('/deploy', async (req, res) => {
    try {
      const { cert_path, key_path } = req.body as DeployCertificateRequest;

      if (!cert_path || typeof cert_path !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'cert_path 必填' },
        };
        res.status(400).json(body);
        return;
      }
      if (!key_path || typeof key_path !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'key_path 必填' },
        };
        res.status(400).json(body);
        return;
      }

      const result = await sslService.deployStagedCertificate(cert_path, key_path);
      const body: DeployCertificateResponse = result;
      res.status(result.success ? 200 : 502).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/deploy: 部署证书失败');
      const body: PanelErrorResponse = {
        error: { code: 'SSL_DEPLOY_FAILED', message },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/deploy/preview — 部署预览
  //   返回当前证书指纹 + 新证书指纹 + nginx 配置语法检查结果，不实际部署
  // ----------------------------------------------------------------
  router.post('/deploy/preview', async (req, res) => {
    try {
      const { pem_content } = req.body as DeployPreviewRequest;

      if (!pem_content || typeof pem_content !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'pem_content 必填且为字符串' },
        };
        res.status(400).json(body);
        return;
      }

      const result = await sslService.previewDeploy(pem_content);
      const body: DeployPreviewResponse = result;
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/deploy/preview: 部署预览失败');
      const body: PanelErrorResponse = {
        error: { code: 'SSL_DEPLOY_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/rollback — 回滚到上一份证书备份
  //   读取 SSL_BACKUP_DIR 中最近一份备份，覆盖当前证书 + nginx reload
  // ----------------------------------------------------------------
  router.post('/rollback', async (_req, res) => {
    try {
      const result = await sslService.rollbackCertificate();
      const body: RollbackResponse = result;
      res.status(result.success ? 200 : 502).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/rollback: 证书回滚失败');
      const body: PanelErrorResponse = {
        error: { code: 'SSL_NGINX_RELOAD_FAILED', message },
      };
      res.status(502).json(body);
    }
  });

  // ----------------------------------------------------------------
  // POST /api/system/ssl/self-signed — 生成自签证书
  // ----------------------------------------------------------------
  router.post('/self-signed', async (req, res) => {
    try {
      const params = req.body as GenerateSelfSignedRequest;

      if (!params.common_name || typeof params.common_name !== 'string') {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'common_name 必填' },
        };
        res.status(400).json(body);
        return;
      }
      if (!Array.isArray(params.san_domains) || params.san_domains.length === 0) {
        const body: PanelErrorResponse = {
          error: { code: 'PANEL_VALIDATION_ERROR', message: 'san_domains 必填且为数组' },
        };
        res.status(400).json(body);
        return;
      }

      const result = await sslService.generateSelfSignedCert({
        common_name: params.common_name,
        san_domains: params.san_domains,
        days: params.days,
        organization: params.organization,
      });

      const body: GenerateSelfSignedResponse = {
        cert_path: result.cert_path,
        key_path: result.key_path,
        message: '自签证书已生成，可调用 /deploy 部署到 nginx',
      };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, 'ssl/self-signed: 生成自签证书失败');
      const body: PanelErrorResponse = {
        error: { code: 'SSL_SELF_SIGNED_FAILED', message },
      };
      res.status(500).json(body);
    }
  });

  return router;
}
