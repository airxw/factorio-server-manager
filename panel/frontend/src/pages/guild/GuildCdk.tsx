// ============================================================================
// GuildCdk — /guild/cdk（v4.16.0 CDK 兑换页）
//
// 简化流程：输入卡密 → 自动识别实例和奖励 → （如有）确认角色名 → 兑换
// API：lookupCdk / listPlayerBindings / redeemCdkGlobal
// 设计：Apple 浅色主题，兑换成功展示奖励内容 + 自动关注实例提示
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Gift, KeyRound, Package, UserRound, Star } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../components/ui';
import type {
  CdkCodeSummary,
  Binding,
} from '@public/schema/panel-api-types';

const QUALITY_LABEL: Record<string, string> = {
  normal: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

interface CdkPreview {
  gift_name: string | null;
  gift_description: string | null;
  item_name: string;
  count: number;
  quality: string;
  items: Array<{ item_name: string; count: number; quality: string }>;
  expires_at: string;
  status: string;
  server_id: string;
  // v4.37.0: 可重复使用 CDK 预览字段
  max_uses?: number;
  use_count?: number;
}

/** 兑换成功结果卡片 */
function SuccessCard({
  code,
  followed,
  boundPlayerName,
  remainingUses,
  onReset,
}: {
  code: CdkCodeSummary;
  followed: boolean;
  boundPlayerName: string;
  remainingUses: number | null;
  onReset: () => void;
}) {
  const items = code.items.length > 0
    ? code.items
    : [{ item_name: code.item_name, count: code.count, quality: code.quality }];

  // v4.37.0: 多次用 CDK 兑换后展示剩余次数提示
  const showRemaining = remainingUses !== null;
  const remainingText = remainingUses === 0
    ? '该 CDK 已达兑换上限'
    : `该 CDK 还可被兑换 ${remainingUses} 次`;

  return (
    <div className="gp-card-strong gp-pop-in" style={{ padding: 24, textAlign: 'center' }}>
      <div
        style={{
          margin: '0 auto',
          width: 56,
          height: 56,
          borderRadius: 999,
          background: 'linear-gradient(135deg, #34C759 0%, #30D158 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(52,199,89,0.3)',
        }}
      >
        <CheckCircle2 size={26} />
      </div>
      <h2 style={{ margin: '14px 0 4px', fontSize: 18, fontWeight: 700, color: '#1D1D1F' }}>兑换成功</h2>
      {code.gift_name && (
        <p style={{ margin: 0, fontSize: 13, color: '#86868B' }}>{code.gift_name}</p>
      )}
      <div style={{ marginTop: 16, display: 'grid', gap: 8, textAlign: 'left' }}>
        {items.map((item, i) => (
          <div
            key={i}
            className="gp-card"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}
          >
            <Package size={15} style={{ color: '#007AFF', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: '#1D1D1F' }}>
              {item.item_name}
            </span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(0,122,255,0.1)',
              color: '#007AFF',
            }}>
              {QUALITY_LABEL[item.quality] ?? item.quality}
            </span>
            <span style={{ fontSize: 13, color: '#86868B' }}>×{item.count}</span>
          </div>
        ))}
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12, color: '#86868B' }}>
        奖励已发放到游戏角色 <strong style={{ color: '#1D1D1F' }}>{boundPlayerName}</strong>，请上线查收
      </p>
      {showRemaining && (
        <div style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 10,
          background: remainingUses === 0 ? 'rgba(255,149,0,0.1)' : 'rgba(0,122,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: remainingUses === 0 ? '#FF9500' : '#007AFF',
          }}>
            {remainingText}
          </span>
        </div>
      )}
      {followed && (
        <div style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(255,149,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'center',
        }}>
          <Star size={14} style={{ color: '#FF9500' }} />
          <span style={{ fontSize: 12, color: '#FF9500', fontWeight: 500 }}>
            已自动关注该服务器，可在「我的服务器」中查看
          </span>
        </div>
      )}
      <button
        type="button"
        className="gp-btn gp-btn-ghost"
        style={{ marginTop: 16, padding: '10px 20px', fontSize: 13 }}
        onClick={onReset}
      >
        继续兑换
      </button>
    </div>
  );
}

export default function GuildCdk() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('CDK 兑换');

  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(true);

  const [code, setCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [preview, setPreview] = useState<CdkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [success, setSuccess] = useState<{ code: CdkCodeSummary; followed: boolean; playerName: string; remainingUses: number | null } | null>(null);

  const loadBindings = useCallback(async () => {
    setLoadingBindings(true);
    try {
      const bindRes = await api.listPlayerBindings().catch(() => ({ bindings: [] as Binding[] }));
      const verifiedBindings = (bindRes.bindings ?? []).filter((b) => b.verify_status === 'verified');
      setBindings(verifiedBindings);
    } catch (err) {
      setBindings([]);
    } finally {
      setLoadingBindings(false);
    }
  }, [api]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  // 查找CDK预览
  const lookupCode = useCallback(async (codeStr: string) => {
    const trimmed = codeStr.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await api.lookupCdk(trimmed);
      setPreview(res.code);
      // 如果用户有绑定角色，自动填充
      if (bindings.length > 0 && !playerName) {
        setPlayerName(bindings[0].player_name ?? '');
      }
    } catch (err) {
      setPreview(null);
      if (err instanceof PanelApiError && err.status !== 404) {
        // 404 是码不存在，不提示；其他错误提示
        toast.error(err.message);
      }
    } finally {
      setPreviewLoading(false);
    }
  }, [api, bindings, playerName, toast]);

  // 防抖查询预览
  useEffect(() => {
    if (!code.trim()) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void lookupCode(code);
    }, 500);
    return () => clearTimeout(timer);
  }, [code, lookupCode]);

  const handleRedeem = async () => {
    const trimmedCode = code.trim();
    const trimmedPlayer = playerName.trim();
    if (!trimmedCode) {
      toast.error('请输入卡密');
      return;
    }
    if (!trimmedPlayer) {
      toast.error('请输入游戏角色名');
      return;
    }
    setRedeeming(true);
    try {
      const res = await api.redeemCdkGlobal({ code: trimmedCode, player_name: trimmedPlayer });
      if (res.delivered) {
        setSuccess({ code: res.code, followed: res.followed, playerName: trimmedPlayer, remainingUses: res.remaining_uses });
        setCode('');
        setPlayerName('');
        setPreview(null);
        // 刷新绑定列表（如果followed了新服务器）
        void loadBindings();
      } else {
        toast.error('兑换失败：卡密无效或已被使用');
      }
    } catch (err) {
      toast.error(err instanceof PanelApiError ? err.message : '兑换失败，请稍后重试');
    } finally {
      setRedeeming(false);
    }
  };

  const handleReset = () => {
    setSuccess(null);
    setCode('');
    setPlayerName('');
    setPreview(null);
  };

  if (success) {
    return (
      <SuccessCard
        code={success.code}
        followed={success.followed}
        boundPlayerName={success.playerName}
        remainingUses={success.remainingUses}
        onReset={handleReset}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 页头 */}
      <div className="gp-hero" style={{ padding: '20px' }}>
        <div style={{ position: 'relative' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1D1D1F' }}>CDK 兑换</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#86868B' }}>
            输入卡密，奖励直接发放到游戏角色，自动关注对应服务器
          </p>
        </div>
      </div>

      <section className="gp-card-strong" style={{ padding: 16, display: 'grid', gap: 16 }}>
        {/* 第 1 步：输入卡密 */}
        <div>
          <label className="gp-section-title" style={{ margin: '0 0 8px', fontSize: 13, color: '#1D1D1F', fontWeight: 600 }}>
            <KeyRound size={14} style={{ color: '#007AFF' }} />
            输入卡密
          </label>
          <input
            className="gp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            maxLength={64}
            aria-label="卡密"
            style={{
              letterSpacing: '0.1em',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 16,
              textAlign: 'center',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && preview) void handleRedeem();
            }}
          />
        </div>

        {/* 卡密预览 */}
        {previewLoading && (
          <div className="gp-skeleton" style={{ height: 80, borderRadius: 12 }} />
        )}
        {preview && !previewLoading && (
          <div style={{
            padding: 14,
            borderRadius: 12,
            background: 'rgba(0,122,255,0.05)',
            border: '1px solid rgba(0,122,255,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Gift size={16} style={{ color: '#007AFF' }} />
              <span style={{ fontWeight: 600, fontSize: 14, color: '#1D1D1F' }}>
                {preview.gift_name ?? 'CDK 礼包'}
              </span>
            </div>
            {preview.gift_description && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#86868B' }}>{preview.gift_description}</p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {preview.items.length > 0 ? preview.items.map((item, i) => (
                <span key={i} style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: '#fff',
                  color: '#1D1D1F',
                  border: '1px solid rgba(0,0,0,0.06)',
                }}>
                  {item.item_name} ×{item.count}
                </span>
              )) : (
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: '#fff',
                  color: '#1D1D1F',
                  border: '1px solid rgba(0,0,0,0.06)',
                }}>
                  {preview.item_name} ×{preview.count}
                </span>
              )}
            </div>
            {/* v4.37.0: 多次用 CDK 预览提示剩余次数 */}
            {preview.max_uses !== undefined && preview.max_uses !== 1 && preview.use_count !== undefined && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#86868B' }}>
                {preview.max_uses === 0
                  ? `可重复兑换（已兑换 ${preview.use_count} 次）`
                  : preview.use_count >= preview.max_uses
                    ? '该 CDK 已达兑换上限'
                    : `可重复兑换：剩余 ${preview.max_uses - preview.use_count}/${preview.max_uses} 次`}
              </p>
            )}
          </div>
        )}

        {/* 第 2 步：游戏角色（有预览才显示） */}
        {preview && (
          <div>
            <label className="gp-section-title" style={{ margin: '0 0 8px', fontSize: 13, color: '#1D1D1F', fontWeight: 600 }}>
              <UserRound size={14} style={{ color: '#007AFF' }} />
              游戏角色
            </label>
            {loadingBindings ? (
              <div className="gp-skeleton" style={{ height: 44, borderRadius: 10 }} />
            ) : bindings.length > 0 ? (
              <select
                className="gp-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                aria-label="选择游戏角色"
              >
                {bindings.map((b) => (
                  <option key={b.id} value={b.player_name ?? ''}>
                    {b.player_name ?? ''}（{b.scope_ref ?? ''}）
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="gp-input"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="输入游戏角色名"
                maxLength={64}
                aria-label="游戏角色名"
              />
            )}
            {bindings.length === 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#FF9500' }}>
                提示：绑定游戏角色后可自动填充角色名，<button
                  type="button"
                  onClick={() => navigate('/guild/bind')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#007AFF',
                    padding: 0,
                    fontSize: 12,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  去绑定
                </button>
              </p>
            )}
          </div>
        )}

        {/* 兑换按钮 */}
        <button
          type="button"
          className="gp-btn gp-btn-primary"
          style={{
            padding: '14px 20px',
            fontSize: 15,
            justifyContent: 'center',
            fontWeight: 600,
            opacity: preview && playerName.trim() ? 1 : 0.5,
          }}
          onClick={() => void handleRedeem()}
          disabled={redeeming || !preview || !playerName.trim()}
        >
          <Gift size={16} />
          {redeeming ? '兑换中…' : '立即兑换'}
        </button>
      </section>

      {/* 帮助提示 */}
      <div style={{ textAlign: 'center', padding: '0 20px' }}>
        <p style={{ margin: 0, fontSize: 12, color: '#86868B', lineHeight: 1.6 }}>
          CDK 兑换码由服务器管理员发放，兑换成功后奖励直接发送到游戏内
          <br />
          该服务器将自动添加到「我的服务器」列表
        </p>
      </div>
    </div>
  );
}
