// ============================================================================
// LoginLastLoginModal — 登录成功后弹窗（v4.31.0）
//
// 触发时机：Login.tsx 登录成功后调用 /api/me/last-login，若有历史则弹窗展示
// 内容：上次登录时间 / IP / 设备 / 距今多久
//   - 若上次登录设备/IP 与当前不一致 → 显示警示文案
//   - 首次登录（无历史）→ 不弹窗
//
// 按钮：
//   - "知道了" → 关闭弹窗，继续跳转目标页
//   - "立即修改密码" → 跳转个人设置页（/guild/profile）
//
// 设计：Apple 浅色主题，与现有 Modal 一致；不持久化"已读"状态，每次登录都提醒
// ============================================================================

import { useMemo } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Modal from './ui/Modal';
import type { LastLoginInfo } from '@public/schema/panel-api-types';

interface LoginLastLoginModalProps {
  /** 是否打开弹窗 */
  open: boolean;
  /** 上次登录信息（null 时不应打开弹窗，但本组件仍容错处理） */
  lastLogin: LastLoginInfo | null;
  /** 当前会话 IP（用于异常比对，可选） */
  currentIp?: string | null;
  /** 当前会话 User-Agent（用于异常比对，可选） */
  currentUserAgent?: string | null;
  /** 关闭弹窗（"知道了"） */
  onClose: () => void;
  /** 跳转修改密码（"立即修改密码"） */
  onChangePassword: () => void;
}

export default function LoginLastLoginModal({
  open,
  lastLogin,
  currentIp,
  currentUserAgent,
  onClose,
  onChangePassword,
}: LoginLastLoginModalProps) {
  // 异常判定：上次登录 IP 或设备与当前不一致时显示警示
  const isSuspicious = useMemo(() => {
    if (!lastLogin) return false;
    // 仅在当前 IP 已知且与上次不同时判定异常
    if (currentIp && lastLogin.ip_address && currentIp !== lastLogin.ip_address) {
      return true;
    }
    // 设备比对：若当前 UA 含上次设备关键字（如浏览器名）则视为一致
    // 简化处理：仅 IP 不一致触发警示，设备差异不强制（同 IP 多设备正常）
    return false;
  }, [lastLogin, currentIp, currentUserAgent]);

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--accent-primary, #007aff)' }} />
          登录成功
        </span>
      }
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={onClose}>
            知道了
          </button>
          {isSuspicious && (
            <button className="btn btn-ghost" onClick={onChangePassword}>
              立即修改密码
            </button>
          )}
        </>
      }
    >
      {!lastLogin ? (
        <p>欢迎首次登录，无历史记录可对比。</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <p className="form-hint" style={{ margin: 0 }}>
            欢迎回来，这是您的上次登录信息：
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <InfoRow label="登录时间" value={formatFullTime(lastLogin.last_login_at)} />
            <InfoRow label="IP 地址" value={lastLogin.ip_address ?? '-'} />
            <InfoRow label="设备" value={lastLogin.device_summary ?? '-'} />
            <InfoRow label="距今" value={humanizeRelative(lastLogin.last_login_at)} />
          </div>
          {isSuspicious && (
            <div className="alert alert-error" style={{ marginTop: 4 }}>
              <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              检测到本次登录与上次登录 IP 不一致，若非本人操作请立即修改密码
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================================
// 子组件
// ============================================================================

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-chip">
      <span className="stats-chip-label">{label}</span>
      <span className="stats-chip-value" style={{ fontSize: 14 }}>{value}</span>
    </div>
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

/** ISO 时间 → "5 分钟前 / 2 小时前 / 3 天前" */
function humanizeRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return '刚刚';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  const year = Math.floor(month / 12);
  return `${year} 年前`;
}

/** 完整时间格式化（YYYY/M/D HH:mm:ss） */
function formatFullTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}
