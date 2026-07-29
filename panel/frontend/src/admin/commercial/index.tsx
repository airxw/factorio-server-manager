// ============================================================================
// CommercialAdminIndex — v4.12.0 GM Workbench 商业化控制台（去 Mock 接真实 API）
//
// 路由（v4.12.0 从 /admin 迁至 /store = GM Workbench）：
//   /store/commercial             → 实例选择器（列出所有实例，点击进入资产列表）
//   /store/commercial/:instanceId → 该实例的资产列表（合并 Global + Instance）
//
// 数据来源：PanelApiClient.asset 方法（见 src/api/modules/asset.ts）
// 后端：panel/backend/src/api/routes/assets.ts（挂载于 /api）
//   - listMergedAssets / overrideAsset / createUgcAsset（instance_admin 门控）
//   - listGlobalAssets / createGlobalAsset / updateGlobalAsset / deleteGlobalAsset（requireAdmin）
//
// v4.11.0 收尾：移除 MockAssetService，移除写死的 'test_instance_1'，
//               从路由参数取 instanceId，所有数据走真实后端。
// v4.12.0：路由从 /admin/commercial 迁至 /store/commercial（GM Workbench）。
// v4.x：迁入 Workbench DS 壳层，统一 /store 视觉语言。
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Package, Server as ServerIcon, AlertCircle } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { MergedAsset } from '../../../../../public/interface_stub/asset_interfaces';
import {
  WorkbenchShell,
  WorkbenchHeader,
  WorkbenchSection,
  WorkbenchEmpty,
  WorkbenchSecondaryButton,
} from '../../pages/store/components/WorkbenchUI';
import { ProductList } from './components/ProductList';
import { PriceOverridePanel } from './components/PriceOverridePanel';
import { UgcForm } from './components/UgcForm';

interface ServerOption {
  id: string;
  name: string;
}

export const CommercialAdminPanel: React.FC = () => {
  const { api } = useAuth();
  const navigate = useNavigate();
  // /admin/commercial → instanceId undefined（显示实例选择器）
  // /admin/commercial/:instanceId → instanceId 取自路由参数
  const { instanceId } = useParams<{ instanceId?: string }>();
  useDocumentTitle(instanceId ? '商城管理 - 实例配置' : '商城管理');

  const [assets, setAssets] = useState<MergedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<MergedAsset | null>(null);

  // 实例选择器状态（无 instanceId 时使用）
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);

  const fetchAssets = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listMergedAssets(id);
      setAssets(data.assets);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取资产列表失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchServers = async () => {
    setServersLoading(true);
    setServersError(null);
    try {
      const data = await api.listServers();
      setServers(
        data.servers.map((s: { id: string; name: string }) => ({
          id: s.id,
          name: s.name,
        })),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取实例列表失败';
      setServersError(msg);
    } finally {
      setServersLoading(false);
    }
  };

  useEffect(() => {
    if (instanceId) {
      void fetchAssets(instanceId);
      // 切换实例时清空已选中资产
      setSelectedAsset(null);
    } else {
      void fetchServers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const handleOverride = async (
    globalAssetId: string,
    price: number,
    isActive: boolean,
  ) => {
    if (!instanceId) return;
    try {
      await api.overrideAsset(instanceId, globalAssetId, {
        price,
        is_active: isActive,
      });
      await fetchAssets(instanceId);
      setSelectedAsset(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '覆盖改价失败';
      alert(`覆盖改价失败: ${msg}`);
    }
  };

  const handleCreateUgc = async (data: {
    name: string;
    price: number;
    is_active: boolean;
    execution_logic: string;
  }) => {
    if (!instanceId) return;
    try {
      await api.createUgcAsset(instanceId, data);
      await fetchAssets(instanceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建 UGC 失败';
      alert(`创建 UGC 失败: ${msg}`);
    }
  };

  // ----- 无 instanceId：实例选择器 -----
  if (!instanceId) {
    return (
      <WorkbenchShell>
        <WorkbenchHeader
          eyebrow="GM Workbench · Commercial"
          title="商业化控制台"
          description="从全实例视角挑选要配置商品/改价的实例。所有商品、覆盖价与 UGC 资产统一在右侧实例详情中维护。"
        />
        <WorkbenchSection
          title="选择实例"
          description="点击实例进入资产列表（合并全局标品与实例级覆盖/UGC）。"
          icon={ServerIcon}
        >
          {serversLoading && (
            <div className="h-32 animate-pulse rounded-[20px] bg-slate-100/70" />
          )}
          {serversError && (
            <WorkbenchEmpty
              title="实例列表加载失败"
              description={serversError}
              icon={AlertCircle}
              tone="rose"
            />
          )}
          {!serversLoading && !serversError && servers.length === 0 && (
            <WorkbenchEmpty
              title="暂无实例"
              description="请先创建实例，再进行商业化配置。"
              icon={ServerIcon}
              tone="slate"
            />
          )}
          {servers.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {servers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/store/commercial/${encodeURIComponent(s.id)}`)}
                  className="group flex items-center justify-between gap-3 rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3 text-left shadow-[0_18px_40px_-34px_rgba(15,23,42,0.30)] transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{s.id}</p>
                  </div>
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-hover:bg-blue-50 group-hover:text-blue-600">
                    <ArrowLeft size={14} className="rotate-180" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </WorkbenchSection>
      </WorkbenchShell>
    );
  }

  // ----- 有 instanceId：资产列表 + 改价 + UGC -----
  return (
    <WorkbenchShell>
      <WorkbenchHeader
        eyebrow="GM Workbench · Commercial"
        title="商业化控制台"
        description="合并展示全局标品与实例级覆盖/UGC。选中非 UGC 资产可改价与上下架；右侧可创建实例专属 UGC。"
        actions={
          <WorkbenchSecondaryButton
            icon={ArrowLeft}
            onClick={() => navigate('/store/commercial')}
          >
            切换实例
          </WorkbenchSecondaryButton>
        }
        badges={[
          { label: '当前实例', value: instanceId, tone: 'blue' },
        ]}
      />

      {error && (
        <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WorkbenchSection
          title="资产列表"
          description="全局标品 + 实例覆盖 + UGC 合并视图。"
          icon={Package}
        >
          <ProductList
            assets={assets}
            loading={loading}
            onSelectAsset={setSelectedAsset}
          />
        </WorkbenchSection>

        <div className="space-y-4">
          {selectedAsset && !selectedAsset.is_ugc && (
            <WorkbenchSection
              title="覆盖改价"
              description="为该实例单独覆盖全局标品的价格与上下架状态。"
              icon={Package}
            >
              <PriceOverridePanel
                asset={selectedAsset}
                onSave={handleOverride}
                onCancel={() => setSelectedAsset(null)}
              />
            </WorkbenchSection>
          )}

          <WorkbenchSection
            title="创建 UGC 资产"
            description="实例专属自定义商品，绑定 RCON 执行逻辑。"
            icon={Package}
          >
            <UgcForm onSubmit={handleCreateUgc} />
          </WorkbenchSection>
        </div>
      </div>
    </WorkbenchShell>
  );
};

export default CommercialAdminPanel;
