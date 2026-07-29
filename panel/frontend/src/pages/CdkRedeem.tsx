// ============================================================================
// CdkRedeem — CDK 兑换页面（任意已登录用户）
// 路径：/instances/:id/cdk-redeem
// 表单：CDK code + player_name → 调 redeemCdk → 显示成功/失败结果
// 成功显示：发放的物品名称、数量、品质
// ============================================================================

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CdkCodeItem, CdkCodeSummary, RedeemCdkRequest } from '@public/schema/panel-api-types';
import { useAuth } from '../api/auth';
import { PanelApiError } from '../api/client';
import { useToast } from '../components/ui';

const QUALITY_LABEL: Record<CdkCodeItem['quality'], string> = {
  normal: '普通',
  uncommon: '精良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

interface RedeemSuccessView {
  code: CdkCodeSummary;
  delivered: boolean;
}

const ERROR_CODE_LABEL: Record<string, string> = {
  CDK_NOT_FOUND: '兑换码不存在',
  CDK_ALREADY_CLAIMED: '兑换码已被领取或正在领取中',
  CDK_EXPIRED: '兑换码已过期',
  COMMAND_RENDER_FAILED: '命令渲染失败（物品名或玩家名含非法字符）',
  COMMAND_QUEUE_FULL: '命令队列已满，请稍后重试',
  PACK_NOT_FOUND: '服务器对应 Pack 未加载',
};

// v3.7.0-B4/C1: 支持 embedded 模式（在 /instances/:id/business 子 Tab 中嵌入）
// - embedded=true：隐藏返回按钮（Business.tsx 已提供顶层返回）
// - embedded=false（独立路由 /instances/:id/cdk-redeem）：返回按钮跳转到 /instances/:id?tab=business
export default function CdkRedeem({ embedded = false }: { embedded?: boolean } = {}) {
  const { id } = useParams<{ id: string }>();
  const { api } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [code, setCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<RedeemSuccessView | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) {
      setError('缺少实例 ID');
      return;
    }
    const trimmedCode = code.trim();
    const trimmedPlayer = playerName.trim();
    if (!trimmedCode) {
      setError('请输入 CDK 兑换码');
      return;
    }
    if (!trimmedPlayer) {
      setError('请输入玩家名');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const req: RedeemCdkRequest = { code: trimmedCode, player_name: trimmedPlayer };
      const res = await api.redeemCdk(id, req);
      setSuccess({ code: res.code, delivered: res.delivered });
      toast.success('兑换成功');
      setCode('');
      setPlayerName('');
    } catch (err) {
      let msg: string;
      if (err instanceof PanelApiError) {
        msg = ERROR_CODE_LABEL[err.code] ?? err.message;
      } else {
        msg = err instanceof Error ? err.message : '兑换失败';
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          {!embedded && (
            <button
              className="btn btn-ghost btn-sm back-btn"
              onClick={() => navigate(`/instances/${id ?? ''}?tab=business`)}
            >
              ← 返回
            </button>
          )}
          <h2 className="page-title">CDK 兑换</h2>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {success && success.delivered && (
        <div className="alert alert-success">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>兑换成功！礼包已发放到游戏内。</div>
          {success.code.gift_name && (
            <div>
              礼包名称：<strong>{success.code.gift_name}</strong>
            </div>
          )}
          {success.code.gift_description && <div>礼包说明：{success.code.gift_description}</div>}
          <div style={{ marginTop: 8, marginBottom: 4, fontWeight: 600 }}>礼包内容：</div>
          {success.code.items.length > 0 ? (
            <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>
              {success.code.items.map((it, idx) => (
                <li key={idx}>
                  <strong>{it.item_name}</strong> × {it.count}
                  <span style={{ color: 'var(--text-secondary, #666)', marginLeft: 8 }}>
                    （{QUALITY_LABEL[it.quality]}）
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>
              <li>
                <strong>{success.code.item_name}</strong> × {success.code.count}
                <span style={{ color: 'var(--text-secondary, #666)', marginLeft: 8 }}>
                  （{QUALITY_LABEL[success.code.quality]}）
                </span>
              </li>
            </ul>
          )}
          <div>
            兑换玩家：<strong>{success.code.claimed_player ?? '—'}</strong>
          </div>
          <div>
            兑换时间：
            {success.code.claimed_at
              ? new Date(success.code.claimed_at).toLocaleString('zh-CN')
              : '—'}
          </div>
        </div>
      )}

      <div className="info-card">
        <form className="form-grid" onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-field">
            <label className="form-label">CDK 兑换码</label>
            <input
              className="input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="输入 CDK 兑换码"
              autoComplete="off"
              disabled={submitting}
            />
          </div>
          <div className="form-field">
            <label className="form-label">玩家名</label>
            <input
              className="input"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="输入游戏内玩家名"
              autoComplete="off"
              disabled={submitting}
            />
          </div>
          <div className="form-field form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={submitting || !code.trim() || !playerName.trim()}
            >
              {submitting ? '兑换中…' : '兑换'}
            </button>
          </div>
        </form>
      </div>

      <div className="info-card" style={{ marginTop: 12 }}>
        <h3 className="card-title">说明</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary, #666)' }}>
          <li>每个 CDK 兑换码仅可使用一次。</li>
          <li>兑换成功后，物品会通过游戏命令直接发放给指定玩家。</li>
          <li>玩家名必须与游戏内在线玩家名一致，且仅允许字母、数字、下划线、连字符。</li>
          <li>兑换码过期后无法再使用。</li>
        </ul>
      </div>
    </div>
  );
}
