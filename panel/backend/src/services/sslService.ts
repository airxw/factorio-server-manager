// ============================================================================
// v4.4.0-L1: SSL 证书管理服务（适配 nginx 架构）
//
// 架构说明：
//   - Panel 后端是 HTTP-only（127.0.0.1:3002），TLS 由 nginx 在 3001 端口接管
//   - 证书文件位于 /etc/nginx/ssl/gsp.ecsrz.com.{fullchain.pem,privkey.key}
//   - 本服务提供：证书信息读取 + 证书暂存 + nginx 热重载 + 自签证书生成
//
// 权限说明：
//   - 读取证书：PEM 文件需对 gameserver 用户可读（默认 644）
//   - 暂存证书：写入 data/ssl/ 目录（Panel 可写）
//   - 部署到 nginx：需要 root 权限（通过 sudo nginx -s reload）
//   - 自签生成：openssl 命令在暂存目录执行，无需 root
// ============================================================================

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';

const execAsync = promisify(exec);

/** 证书文件路径配置（可通过环境变量覆盖） */
const SSL_CERT_PATH = process.env.SSL_CERT_PATH ?? '/etc/nginx/ssl/gsp.ecsrz.com.fullchain.pem';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH ?? '/etc/nginx/ssl/gsp.ecsrz.com.privkey.key';

/** 暂存目录（Panel 可写） */
const SSL_STAGING_DIR = process.env.SSL_STAGING_DIR ?? './data/ssl';

/** nginx 重载命令（可通过环境变量覆盖，默认 sudo nginx -s reload） */
const NGINX_RELOAD_CMD = process.env.NGINX_RELOAD_CMD ?? 'sudo nginx -s reload';

/** 证书备份目录（rollback 读取源；deploy 前自动备份当前证书到此目录，保留最近 3 份） */
const SSL_BACKUP_DIR = process.env.SSL_BACKUP_DIR ?? '/opt/gameserver-panel/ssl-backup';

/** 保留的备份份数 */
const SSL_BACKUP_KEEP = 3;

/** nginx 配置语法检查命令 */
const NGINX_TEST_CMD = process.env.NGINX_TEST_CMD ?? 'sudo nginx -t';

/** 证书信息（前端展示用） */
export interface CertificateInfo {
  /** 证书文件路径 */
  cert_path: string;
  /** 密钥文件路径 */
  key_path: string;
  /** 是否存在且可读 */
  available: boolean;
  /** 主题 CN */
  subject_cn: string | null;
  /** 签发者 CN */
  issuer_cn: string | null;
  /** SAN 域名列表 */
  san_domains: string[];
  /** 有效期起始 ISO */
  valid_from: string | null;
  /** 有效期截止 ISO */
  valid_to: string | null;
  /** 距过期剩余天数（负数=已过期） */
  days_remaining: number | null;
  /** 证书指纹 SHA-256 */
  fingerprint: string | null;
  /** 是否自签名 */
  self_signed: boolean;
}

/** 自签证书生成参数 */
export interface SelfSignedCertParams {
  /** 通用名 CN */
  common_name: string;
  /** SAN 域名列表（如 ['gsp.ecsrz.com', '192.168.5.14']） */
  san_domains: string[];
  /** 有效天数（默认 365） */
  days?: number;
  /** 组织名 O（可选） */
  organization?: string;
}

/** 自签证书生成结果 */
export interface SelfSignedCertResult {
  cert_path: string;
  key_path: string;
  /** openssl 命令的 stdout/stderr（用于诊断） */
  stdout: string;
  stderr: string;
}

/**
 * v4.4.0-L1: SSL 证书管理服务
 *
 * 功能：
 *   - getCertificateInfo() — 读取当前 nginx 使用的证书信息
 *   - stageCertificate() — 暂存新证书到 data/ssl/
 *   - deployStagedCertificate() — 部署暂存证书到 nginx 路径 + 热重载
 *   - reloadNginx() — 触发 nginx 热重载（不替换证书文件）
 *   - generateSelfSignedCert() — 生成自签证书（openssl fallback）
 *
 * 热重载加锁：同一时刻只允许一个 reload 操作，防止并发 nginx -s reload 冲突
 */
export class SslService {
  private readonly logger: Logger;
  /** 热重载互斥锁：reload 进行中的 Promise */
  private reloadPromise: Promise<{ success: boolean; message: string }> | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 读取当前 nginx 使用的证书信息。
   * 证书文件不可读时返回 available=false 的空壳结构。
   */
  getCertificateInfo(): CertificateInfo {
    const info: CertificateInfo = {
      cert_path: SSL_CERT_PATH,
      key_path: SSL_KEY_PATH,
      available: false,
      subject_cn: null,
      issuer_cn: null,
      san_domains: [],
      valid_from: null,
      valid_to: null,
      days_remaining: null,
      fingerprint: null,
      self_signed: false,
    };

    try {
      const pem = fs.readFileSync(SSL_CERT_PATH, 'utf-8');
      const cert = new X509Certificate(pem);

      info.available = true;
      // X509Certificate.subject / issuer 返回多行字符串，如 "CN=gsp.ecsrz.com\nO=MyOrg"
      // 需从中解析 CN 字段
      info.subject_cn = extractCN(cert.subject);
      info.issuer_cn = extractCN(cert.issuer);

      // SAN 域名（subjectAltName 格式: "DNS:gsp.ecsrz.com, IP:192.168.5.14"）
      const sanRaw = cert.subjectAltName;
      if (sanRaw) {
        info.san_domains = sanRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.startsWith('DNS:'))
          .map((entry) => entry.slice(4));
      }

      info.valid_from = cert.validFrom;
      info.valid_to = cert.validTo;

      // 计算剩余天数
      const expiry = new Date(cert.validTo);
      const now = new Date();
      info.days_remaining = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      info.fingerprint = cert.fingerprint256;

      // 自签名判定：subject === issuer
      info.self_signed = cert.subject === cert.issuer;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), certPath: SSL_CERT_PATH },
        '读取 SSL 证书失败（文件不存在或不可读）',
      );
    }

    return info;
  }

  /**
   * 暂存证书文件到 data/ssl/ 目录。
   * 用于上传新证书后、正式部署到 nginx 前的暂存。
   *
   * @param pemContent PEM 格式证书内容（fullchain）
   * @param keyContent KEY 格式私钥内容
   * @returns 暂存文件路径
   */
  stageCertificate(pemContent: string, keyContent: string): {
    cert_path: string;
    key_path: string;
  } {
    // 确保暂存目录存在
    fs.mkdirSync(SSL_STAGING_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const certPath = path.join(SSL_STAGING_DIR, `staged-${timestamp}.fullchain.pem`);
    const keyPath = path.join(SSL_STAGING_DIR, `staged-${timestamp}.privkey.key`);

    // 写入文件（权限 600，私钥不暴露）
    fs.writeFileSync(certPath, pemContent, { mode: 0o644 });
    fs.writeFileSync(keyPath, keyContent, { mode: 0o600 });

    this.logger.info({ certPath, keyPath }, '证书已暂存到 data/ssl/');

    return { cert_path: certPath, key_path: keyPath };
  }

  /**
   * 部署暂存的证书到 nginx SSL 路径 + 触发热重载。
   *
   * 注意：此操作需要 root 权限（通过 sudo cp + sudo nginx -s reload）。
   * 若 Panel 无 sudo 权限，返回错误，管理员需手动执行部署命令。
   *
   * @param stagedCertPath 暂存的 PEM 文件路径
   * @param stagedKeyPath 暂存的 KEY 文件路径
   */
  async deployStagedCertificate(
    stagedCertPath: string,
    stagedKeyPath: string,
  ): Promise<{ success: boolean; message: string }> {
    // 安全校验：暂存文件必须存在
    if (!fs.existsSync(stagedCertPath) || !fs.existsSync(stagedKeyPath)) {
      return {
        success: false,
        message: `暂存文件不存在: ${stagedCertPath} / ${stagedKeyPath}`,
      };
    }

    // 安全校验：路径必须在暂存目录内（防穿越）
    const resolvedCert = path.resolve(stagedCertPath);
    const resolvedKey = path.resolve(stagedKeyPath);
    const resolvedStagingDir = path.resolve(SSL_STAGING_DIR);
    if (!resolvedCert.startsWith(resolvedStagingDir) || !resolvedKey.startsWith(resolvedStagingDir)) {
      return {
        success: false,
        message: '暂存文件路径不在允许的暂存目录内',
      };
    }

    try {
      // 部署前备份当前证书（best-effort，失败不阻断部署）
      await this.backupCurrentCertificate();

      // 复制到 nginx SSL 路径（需要 sudo）
      const copyCmd = `sudo cp "${resolvedCert}" "${SSL_CERT_PATH}" && sudo cp "${resolvedKey}" "${SSL_KEY_PATH}" && sudo chmod 644 "${SSL_CERT_PATH}" && sudo chmod 600 "${SSL_KEY_PATH}"`;
      this.logger.info({ copyCmd: copyCmd.replace(/"[^"]+"/g, '"***"') }, '部署证书到 nginx 路径');
      await execAsync(copyCmd, { timeout: 10_000 });

      // 触发 nginx 热重载
      await this.reloadNginx();

      this.logger.info('证书部署 + nginx 热重载完成');
      return { success: true, message: '证书已部署并触发 nginx 热重载' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, '部署证书失败（可能缺少 sudo 权限）');
      return {
        success: false,
        message: `部署失败: ${message}。若权限不足，请手动执行: sudo cp "${resolvedCert}" "${SSL_CERT_PATH}" && sudo cp "${resolvedKey}" "${SSL_KEY_PATH}" && sudo nginx -s reload`,
      };
    }
  }

  /**
   * 触发 nginx 热重载（不替换证书文件）。
   * 加锁保护：同一时刻只允许一个 reload 操作。
   */
  async reloadNginx(): Promise<{ success: boolean; message: string }> {
    // 加锁：若已有 reload 进行中，等待其完成
    if (this.reloadPromise) {
      this.logger.info('nginx 热重载已在进行中，等待完成');
      await this.reloadPromise;
      return { success: true, message: 'nginx 热重载已完成（复用进行中的请求）' };
    }

    this.reloadPromise = this.executeNginxReload();
    try {
      const result = await this.reloadPromise;
      return result;
    } finally {
      this.reloadPromise = null;
    }
  }

  /**
   * 部署预览：不实际部署，仅返回当前证书指纹、新证书指纹、nginx 配置语法检查结果。
   *
   * @param pemContent PEM 格式证书内容（fullchain），用于计算新指纹
   */
  async previewDeploy(pemContent: string): Promise<{
    current_fingerprint: string | null;
    new_fingerprint: string | null;
    nginx_config_valid: boolean;
    errors: string | null;
  }> {
    // 1. 当前证书指纹
    const currentInfo = this.getCertificateInfo();
    const currentFingerprint = currentInfo.fingerprint;

    // 2. 解析新证书指纹
    let newFingerprint: string | null = null;
    let parseError: string | null = null;
    try {
      if (!pemContent || typeof pemContent !== 'string') {
        parseError = 'pem_content 必填且为字符串';
      } else if (!pemContent.includes('BEGIN CERTIFICATE')) {
        parseError = 'pem_content 不是有效的 PEM 证书格式';
      } else {
        const cert = new X509Certificate(pemContent);
        newFingerprint = cert.fingerprint256;
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }

    // 3. nginx -t 配置语法检查（需 sudo 读取 nginx 配置）
    let nginxConfigValid = false;
    let nginxError: string | null = null;
    try {
      const { stdout, stderr } = await execAsync(NGINX_TEST_CMD, { timeout: 10_000 });
      const combined = `${stdout}\n${stderr}`;
      nginxConfigValid =
        combined.includes('syntax is ok') && combined.includes('test is successful');
      if (!nginxConfigValid) {
        nginxError = combined.trim() || 'nginx -t 配置检查未通过';
      }
    } catch (err) {
      nginxError = err instanceof Error ? err.message : String(err);
    }

    const errors = [parseError, nginxError].filter(Boolean).join('; ') || null;

    return {
      current_fingerprint: currentFingerprint,
      new_fingerprint: newFingerprint,
      nginx_config_valid: nginxConfigValid,
      errors,
    };
  }

  /**
   * 回滚到上一份证书备份。
   *
   * 流程：
   *   1. 读取备份目录（SSL_BACKUP_DIR），按文件名降序找到最近一份备份
   *   2. 复制备份到 nginx SSL 路径
   *   3. 触发 nginx 热重载
   *   4. 清理旧备份，保留最近 SSL_BACKUP_KEEP 份
   */
  async rollbackCertificate(): Promise<{
    success: boolean;
    rolled_back_to: string | null;
    fingerprint: string | null;
    message: string;
  }> {
    // 1. 列出备份目录中的 fullchain 文件
    let entries: string[];
    try {
      const { stdout } = await execAsync(`sudo ls -1 "${SSL_BACKUP_DIR}"`, { timeout: 5_000 });
      entries = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((name) => name.endsWith('.fullchain.pem'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, backupDir: SSL_BACKUP_DIR }, 'rollback: 读取备份目录失败');
      return {
        success: false,
        rolled_back_to: null,
        fingerprint: null,
        message: `读取备份目录失败: ${message}`,
      };
    }

    if (entries.length === 0) {
      return {
        success: false,
        rolled_back_to: null,
        fingerprint: null,
        message: `备份目录 ${SSL_BACKUP_DIR} 中无可用证书备份`,
      };
    }

    // 降序排序：文件名含 ISO 时间戳，最新在前
    entries.sort((a, b) => b.localeCompare(a));
    const latestCertName = entries[0];
    const latestKeyName = latestCertName.replace('.fullchain.pem', '.privkey.key');
    const backupCertPath = path.join(SSL_BACKUP_DIR, latestCertName);
    const backupKeyPath = path.join(SSL_BACKUP_DIR, latestKeyName);

    // 2. 校验备份文件存在
    try {
      await execAsync(`sudo test -f "${backupCertPath}" && sudo test -f "${backupKeyPath}"`, {
        timeout: 5_000,
      });
    } catch {
      return {
        success: false,
        rolled_back_to: latestCertName,
        fingerprint: null,
        message: `备份私钥文件不存在: ${backupKeyPath}`,
      };
    }

    // 3. 读取备份证书指纹
    let fingerprint: string | null = null;
    try {
      const { stdout } = await execAsync(`sudo cat "${backupCertPath}"`, { timeout: 5_000 });
      const cert = new X509Certificate(stdout);
      fingerprint = cert.fingerprint256;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        rolled_back_to: latestCertName,
        fingerprint: null,
        message: `读取备份证书指纹失败: ${message}`,
      };
    }

    // 4. 复制备份到 nginx 路径
    try {
      const copyCmd = `sudo cp "${backupCertPath}" "${SSL_CERT_PATH}" && sudo cp "${backupKeyPath}" "${SSL_KEY_PATH}" && sudo chmod 644 "${SSL_CERT_PATH}" && sudo chmod 600 "${SSL_KEY_PATH}"`;
      this.logger.info({ copyCmd: copyCmd.replace(/"[^"]+"/g, '"***"') }, 'rollback: 复制备份到 nginx');
      await execAsync(copyCmd, { timeout: 10_000 });

      // 5. 触发 nginx 热重载
      await this.reloadNginx();

      // 6. 清理旧备份，保留最近 SSL_BACKUP_KEEP 份
      await this.pruneOldBackups(entries);

      this.logger.info({ rolledBackTo: latestCertName, fingerprint }, 'rollback: 证书回滚完成');
      return {
        success: true,
        rolled_back_to: latestCertName,
        fingerprint,
        message: '已回滚到上一份证书备份并触发 nginx 热重载',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'rollback: 复制/重载失败');
      return {
        success: false,
        rolled_back_to: latestCertName,
        fingerprint: null,
        message: `回滚失败: ${message}`,
      };
    }
  }

  /**
   * 部署前备份当前 nginx 证书到 SSL_BACKUP_DIR（best-effort，失败不阻断部署）。
   * 同时清理旧备份，保留最近 SSL_BACKUP_KEEP 份。
   */
  private async backupCurrentCertificate(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupCertPath = path.join(SSL_BACKUP_DIR, `backup-${timestamp}.fullchain.pem`);
    const backupKeyPath = path.join(SSL_BACKUP_DIR, `backup-${timestamp}.privkey.key`);

    try {
      // 创建备份目录 + 备份当前证书（若当前证书不存在则跳过）
      const backupCmd = `sudo mkdir -p "${SSL_BACKUP_DIR}" && (sudo test -f "${SSL_CERT_PATH}" && sudo test -f "${SSL_KEY_PATH}" && sudo cp "${SSL_CERT_PATH}" "${backupCertPath}" && sudo cp "${SSL_KEY_PATH}" "${backupKeyPath}" && sudo chmod 644 "${backupCertPath}" && sudo chmod 600 "${backupKeyPath}" || true)`;
      await execAsync(backupCmd, { timeout: 10_000 });

      // 清理旧备份
      const { stdout } = await execAsync(`sudo ls -1 "${SSL_BACKUP_DIR}"`, { timeout: 5_000 });
      const entries = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((name) => name.endsWith('.fullchain.pem'));
      await this.pruneOldBackups(entries);

      this.logger.info({ backupCertPath }, '已备份当前证书');
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '备份当前证书失败（best-effort，不阻断部署）',
      );
    }
  }

  /**
   * 清理旧备份，保留最近 keep 份（按文件名降序）。
   * best-effort，失败不阻断。
   */
  private async pruneOldBackups(entries: string[]): Promise<void> {
    if (entries.length <= SSL_BACKUP_KEEP) return;
    entries.sort((a, b) => b.localeCompare(a)); // 降序，最新在前
    const toRemove = entries.slice(SSL_BACKUP_KEEP);
    for (const name of toRemove) {
      try {
        const certPath = path.join(SSL_BACKUP_DIR, name);
        const keyPath = path.join(SSL_BACKUP_DIR, name.replace('.fullchain.pem', '.privkey.key'));
        await execAsync(`sudo rm -f "${certPath}" "${keyPath}"`, { timeout: 5_000 });
      } catch {
        // best-effort
      }
    }
  }

  /**
   * 生成自签证书（openssl fallback）。
   * 用于无正式证书时快速启用 HTTPS。
   *
   * 生成的证书暂存在 data/ssl/ 目录，需后续调用 deployStagedCertificate 部署。
   */
  async generateSelfSignedCert(params: SelfSignedCertParams): Promise<SelfSignedCertResult> {
    // 确保暂存目录存在
    fs.mkdirSync(SSL_STAGING_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const certPath = path.join(SSL_STAGING_DIR, `selfsigned-${timestamp}.fullchain.pem`);
    const keyPath = path.join(SSL_STAGING_DIR, `selfsigned-${timestamp}.privkey.key`);
    const days = params.days ?? 365;

    // 构建 SAN 参数
    const sanEntries: string[] = [];
    for (const domain of params.san_domains) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
        sanEntries.push(`IP:${domain}`);
      } else {
        sanEntries.push(`DNS:${domain}`);
      }
    }
    // CN 也加入 SAN（现代浏览器要求 SAN 而非 CN）
    if (!sanEntries.includes(`DNS:${params.common_name}`)) {
      sanEntries.push(`DNS:${params.common_name}`);
    }
    const sanString = sanEntries.join(',');

    // openssl 命令生成自签证书
    const orgParam = params.organization ? `-O "${params.organization}"` : '';
    const cmd = [
      'openssl req',
      '-x509',
      '-newkey rsa:2048',
      '-keyout', `"${keyPath}"`,
      '-out', `"${certPath}"`,
      '-days', String(days),
      '-nodes',
      '-subj', `"/CN=${params.common_name}"`,
      orgParam,
      '-addext', `"subjectAltName=${sanString}"`,
    ].filter(Boolean).join(' ');

    this.logger.info({ cmd: cmd.replace(/"[^"]+"/g, '"***"') }, '生成自签证书');

    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000 });

      // 设置文件权限
      fs.chmodSync(certPath, 0o644);
      fs.chmodSync(keyPath, 0o600);

      this.logger.info({ certPath, keyPath }, '自签证书生成完成');
      return { cert_path: certPath, key_path: keyPath, stdout, stderr };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, '自签证书生成失败');
      throw new Error(`自签证书生成失败: ${message}`);
    }
  }

  /**
   * 执行 nginx -s reload 命令（内部方法，由 reloadNginx 加锁调用）。
   */
  private async executeNginxReload(): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.info({ cmd: NGINX_RELOAD_CMD }, '触发 nginx 热重载');
      const { stdout, stderr } = await execAsync(NGINX_RELOAD_CMD, { timeout: 10_000 });
      this.logger.info({ stdout: stdout.trim(), stderr: stderr.trim() }, 'nginx 热重载完成');
      return { success: true, message: 'nginx 热重载成功' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'nginx 热重载失败（可能缺少 sudo 权限）');
      return {
        success: false,
        message: `nginx 热重载失败: ${message}。请手动执行: sudo nginx -s reload`,
      };
    }
  }
}

/**
 * 工厂函数：创建 SslService 实例
 */
export function createSslService(logger: Logger): SslService {
  return new SslService(logger);
}

/**
 * 从 X509Certificate.subject / issuer 字符串中提取 CN 字段。
 *
 * Node.js 的 X509Certificate.subject 返回多行字符串，格式如：
 *   "CN=gsp.ecsrz.com\nO=MyOrg\nC=CN"
 *
 * 本函数按行分割后查找以 "CN=" 开头的行，返回其值。
 * 找不到时返回 null。
 */
function extractCN(dnString: string): string | null {
  const lines = dnString.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CN=')) {
      return trimmed.slice(3);
    }
  }
  return null;
}
