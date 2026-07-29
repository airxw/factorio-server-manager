// ============================================================================
// mailService — v3.9.0-S6 邮件发送服务
//
// 设计要点：
//   - 基于 nodemailer，SMTP 配置从 settingSchemaService 读取（mail.* 组）
//   - mail.enabled=false 时仅写日志不实际发送（开发模式）
//   - 每次发送前重新读取配置（不缓存 transporter），便于管理员即时调整 SMTP
//   - 提供 sendPasswordResetEmail / sendEmailVerifyEmail 两个业务模板方法
//
// 契约对齐：
//   - 内部服务，不对外暴露接口契约
//   - 被 passwordReset 路由 / emailVerify 路由 / register 流程调用
// ============================================================================

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { SettingSchemaService } from './settingSchemaService.js';

export interface MailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
}

export class MailService {
  constructor(
    private readonly settings: SettingSchemaService,
    private readonly logger: Logger,
  ) {}

  /**
   * 从设置面板读取当前 SMTP 配置。
   * 每次调用都重新读取，便于管理员即时调整。
   */
  async loadConfig(): Promise<MailConfig> {
    return {
      enabled: await this.settings.getBoolean('mail.enabled'),
      smtpHost: await this.settings.getString('mail.smtp_host'),
      smtpPort: await this.settings.getNumber('mail.smtp_port'),
      smtpSecure: await this.settings.getBoolean('mail.smtp_secure'),
      smtpUser: await this.settings.getString('mail.smtp_user'),
      smtpPass: await this.settings.getString('mail.smtp_pass'),
      fromAddress: await this.settings.getString('mail.from_address'),
    };
  }

  /**
   * 发送邮件。若 mail.enabled=false 仅写日志，不抛错（开发模式）。
   * 若 enabled=true 但 SMTP 配置不完整，抛 Error 提示管理员配置。
   */
  async sendMail(to: string, subject: string, html: string): Promise<void> {
    const config = await this.loadConfig();

    if (!config.enabled) {
      this.logger.info(
        { to, subject, preview: html.slice(0, 200) },
        '[mailService] mail.enabled=false，仅记录日志未实际发送',
      );
      return;
    }

    if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
      this.logger.error({ to, subject }, '[mailService] SMTP 配置不完整，邮件发送失败');
      throw new Error('SMTP 配置不完整（host/user/pass 任一为空），请在设置面板配置 mail.* 组');
    }

    let transporter: Transporter;
    try {
      transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[mailService] 创建 SMTP transporter 失败',
      );
      throw err;
    }

    try {
      const info = await transporter.sendMail({
        from: config.fromAddress,
        to,
        subject,
        html,
      });
      this.logger.info(
        { to, subject, messageId: info.messageId, response: info.response },
        '[mailService] 邮件发送成功',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), to, subject },
        '[mailService] 邮件发送失败',
      );
      throw err;
    } finally {
      // nodemailer transporter 无显式 close 需求，GC 回收即可
    }
  }

  /**
   * 发送密码找回邮件。
   * @param to 收件人邮箱
   * @param resetUrl 重置链接（含 token，如 https://gsp.ecsrz.com:3000/reset-password?token=xxx）
   * @param siteName 站点名（来自 site.name 设置项）
   */
  async sendPasswordResetEmail(to: string, resetUrl: string, siteName: string): Promise<void> {
    const subject = `[${siteName}] 密码重置`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #2563eb;">${siteName} — 密码重置</h2>
        <p>您好，</p>
        <p>我们收到了您重置密码的请求。请点击下方按钮重置密码：</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">重置密码</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">或直接访问以下链接：</p>
        <p style="background: #f5f6f8; padding: 12px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px;">${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #e2e5ea; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 13px;">
          此链接 1 小时后失效。如非本人操作请忽略此邮件，您的密码不会变更。
        </p>
        <p style="color: #6b7280; font-size: 12px;">—— ${siteName}</p>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  /**
   * 发送邮箱验证邮件。
   * @param to 收件人邮箱
   * @param verifyUrl 验证链接（含 token）
   * @param siteName 站点名
   */
  async sendEmailVerifyEmail(to: string, verifyUrl: string, siteName: string): Promise<void> {
    const subject = `[${siteName}] 邮箱验证`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #16a34a;">${siteName} — 邮箱验证</h2>
        <p>您好，</p>
        <p>感谢注册 ${siteName}。请点击下方按钮验证您的邮箱地址：</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #16a34a; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">验证邮箱</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">或直接访问以下链接：</p>
        <p style="background: #f5f6f8; padding: 12px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px;">${verifyUrl}</p>
        <hr style="border: none; border-top: 1px solid #e2e5ea; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 13px;">
          此链接 24 小时后失效。如非本人注册请忽略此邮件。
        </p>
        <p style="color: #6b7280; font-size: 12px;">—— ${siteName}</p>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  /**
   * v4.6.0-F2: 发送告警邮件
   * @param to 收件人邮箱
   * @param subject 主题（已包含 [告警] 前缀）
   * @param body 正文（纯文本，会被 HTML 转义后包装）
   */
  async sendAlertEmail(to: string, subject: string, body: string): Promise<void> {
    const siteName = await this.settings.getString('site.name');
    const fullSubject = `[${siteName}][告警] ${subject}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">${escapeHtml(subject)}</h2>
        <pre style="background: #f5f6f8; padding: 12px; border-radius: 4px; font-size: 13px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(body)}</pre>
        <hr style="border: none; border-top: 1px solid #e2e5ea; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px;">—— ${escapeHtml(siteName)} 告警系统</p>
      </div>
    `;
    await this.sendMail(to, fullSubject, html);
  }
}

export function createMailService(settings: SettingSchemaService, logger: Logger): MailService {
  return new MailService(settings, logger);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
