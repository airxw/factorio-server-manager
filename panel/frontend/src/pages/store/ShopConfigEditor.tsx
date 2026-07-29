// ============================================================================
// ShopConfigEditor — v4.13.0 服主店铺外观配置编辑器
// 路由：/store/servers/:id/shop-config
// 门控：instance_admin+
// 承载：服主编辑店铺 Banner / 描述 / 主题色
//
// 实现：独立表单页，调用 PUT /api/store/servers/:serverId/shop-config
// v4.x：迁入 Workbench DS 壳层，统一 /store 视觉语言。
// ============================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Palette } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { PanelApiError } from '../../api/client';
import { useToast } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
} from './components/WorkbenchUI';

/** 主题色预设（服主可快速选择，Apple 色系） */
const THEME_COLOR_PRESETS = [
  '#FF9500', // orange
  '#30D158', // green
  '#0A84FF', // blue
  '#5E5CE6', // indigo
  '#FF3B30', // red
  '#64D2FF', // cyan
  '#BF5AF2', // purple（保留，游戏品牌色）
  '#FFD60A', // yellow
];

const INPUT_CLASS =
  'w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
const TEXTAREA_CLASS =
  'w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
const LABEL_CLASS = 'block text-xs font-medium uppercase tracking-[0.18em] text-slate-400';

export default function ShopConfigEditor() {
  const { id } = useParams<{ id: string }>();
  const { api } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('店铺外观配置');

  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerLink, setBannerLink] = useState('');
  const [shopDescription, setShopDescription] = useState('');
  const [shopThemeColor, setShopThemeColor] = useState('#0A84FF');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    api
      .getInstanceShopConfig(id)
      .then((res) => {
        if (cancelled) return;
        setBannerUrl(res.config.banner_url ?? '');
        setBannerLink(res.config.banner_link ?? '');
        setShopDescription(res.config.shop_description ?? '');
        setShopThemeColor(res.config.shop_theme_color ?? '#0A84FF');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof PanelApiError ? err.message : '加载配置失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateInstanceShopConfig(id, {
        banner_url: bannerUrl.trim() || null,
        banner_link: bannerLink.trim() || null,
        shop_description: shopDescription.trim() || null,
        shop_theme_color: shopThemeColor.trim() || null,
      });
      toast.success('店铺外观配置已保存');
      navigate(`/store/servers/${id}`);
    } catch (err) {
      const msg = err instanceof PanelApiError ? err.message : '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <WorkbenchShell>
        <div className="h-40 animate-pulse rounded-[28px] border border-slate-200/80 bg-white/80" />
        <div className="h-80 animate-pulse rounded-[26px] border border-slate-200/80 bg-white/80" />
      </WorkbenchShell>
    );
  }

  if (error && !bannerUrl && !shopDescription) {
    return (
      <WorkbenchShell>
        <WorkbenchHeader
          eyebrow="GM Workbench · Shop Config"
          title="店铺外观配置"
          description="自定义玩家在店铺首页看到的 Banner、描述与主题色。"
          actions={
            <WorkbenchSecondaryButton
              icon={ArrowLeft}
              onClick={() => navigate(`/store/servers/${id}`)}
            >
              返回实例
            </WorkbenchSecondaryButton>
          }
        />
        <WorkbenchSection title="配置加载失败" icon={ImageIcon}>
          <WorkbenchEmpty
            title="无法加载店铺外观配置"
            description={error}
            icon={ImageIcon}
            tone="rose"
            action={
              <WorkbenchSecondaryButton onClick={() => window.location.reload()}>
                重试
              </WorkbenchSecondaryButton>
            }
          />
        </WorkbenchSection>
      </WorkbenchShell>
    );
  }

  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Shop Config"
        title="店铺外观配置"
        description="自定义玩家在店铺首页看到的 Banner、描述与主题色。所有改动即时生效。"
        actions={
          <WorkbenchSecondaryButton
            icon={ArrowLeft}
            onClick={() => navigate(`/store/servers/${id}`)}
            disabled={saving}
          >
            返回实例
          </WorkbenchSecondaryButton>
        }
        badges={id ? [{ label: '实例 ID', value: id, tone: 'blue' }] : undefined}
      />

      {error && (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <WorkbenchSection
        title="Banner 与描述"
        description="玩家进入店铺首页时最先看到的视觉与文案。"
        icon={ImageIcon}
      >
        <div className="space-y-5">
          <div>
            <label htmlFor="banner-url" className={LABEL_CLASS}>
              Banner 图片 URL
              <span className="ml-2 normal-case tracking-normal text-slate-400">
                推荐尺寸 1920×480
              </span>
            </label>
            <input
              id="banner-url"
              type="url"
              className={`mt-2 ${INPUT_CLASS}`}
              placeholder="https://example.com/banner.png"
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
            />
            {bannerUrl && (
              <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200">
                <img
                  src={bannerUrl}
                  alt="Banner 预览"
                  className="max-h-40 w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="banner-link" className={LABEL_CLASS}>
              Banner 点击跳转链接（可选）
            </label>
            <input
              id="banner-link"
              type="url"
              className={`mt-2 ${INPUT_CLASS}`}
              placeholder="https://example.com/promo"
              value={bannerLink}
              onChange={(e) => setBannerLink(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="shop-description" className={LABEL_CLASS}>
              店铺描述
              <span className="ml-2 normal-case tracking-normal text-slate-400">
                {shopDescription.length}/500
              </span>
            </label>
            <textarea
              id="shop-description"
              className={`mt-2 ${TEXTAREA_CLASS}`}
              rows={4}
              maxLength={500}
              placeholder="介绍你的服务器特色、玩法规则等"
              value={shopDescription}
              onChange={(e) => setShopDescription(e.target.value)}
            />
          </div>
        </div>
      </WorkbenchSection>

      <WorkbenchSection
        title="主题色"
        description="用于店铺按钮、强调元素与品牌点缀。建议保持与游戏调性一致。"
        icon={Palette}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              className="h-10 w-12 cursor-pointer rounded-full border border-slate-200"
              value={shopThemeColor}
              onChange={(e) => setShopThemeColor(e.target.value)}
              aria-label="主题色选择器"
            />
            <input
              type="text"
              className={`${INPUT_CLASS} max-w-[200px]`}
              placeholder="#0A84FF"
              value={shopThemeColor}
              onChange={(e) => setShopThemeColor(e.target.value)}
              aria-label="主题色 HEX"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {THEME_COLOR_PRESETS.map((color) => {
              const active = shopThemeColor.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                    active ? 'border-slate-900' : 'border-slate-200'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setShopThemeColor(color)}
                  aria-label={`选择主题色 ${color}`}
                />
              );
            })}
          </div>
        </div>
      </WorkbenchSection>

      <div className="flex flex-wrap justify-end gap-2">
        <WorkbenchSecondaryButton
          onClick={() => navigate(`/store/servers/${id}`)}
          disabled={saving}
        >
          取消
        </WorkbenchSecondaryButton>
        <WorkbenchPrimaryButton onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存配置'}
        </WorkbenchPrimaryButton>
      </div>
    </WorkbenchShell>
  );
}
