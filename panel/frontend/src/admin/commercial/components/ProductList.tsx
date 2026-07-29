import React from 'react';
import { Settings2 } from 'lucide-react';
import { MergedAsset } from '../../../../../../public/interface_stub/asset_interfaces';
import {
  WorkbenchEmpty,
  WorkbenchIconButton,
  WorkbenchStatusBadge,
  WorkbenchTableWrap,
} from '../../../pages/store/components/WorkbenchUI';

interface ProductListProps {
  assets: MergedAsset[];
  loading: boolean;
  onSelectAsset: (asset: MergedAsset) => void;
}

export const ProductList: React.FC<ProductListProps> = ({ assets, loading, onSelectAsset }) => {
  if (loading) {
    return <div className="h-32 animate-pulse rounded-[20px] bg-slate-100/70" />;
  }

  if (assets.length === 0) {
    return (
      <WorkbenchEmpty
        title="暂无资产"
        description="该实例还没有全局标品、覆盖价或 UGC 资产。"
        icon={Settings2}
        tone="slate"
      />
    );
  }

  return (
    <WorkbenchTableWrap>
      <table className="data-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>价格</th>
            <th>状态</th>
            <th>类型</th>
            <th className="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id}>
              <td className="cell-name">{asset.name}</td>
              <td className="mono">¥{asset.price.toFixed(2)}</td>
              <td>
                <WorkbenchStatusBadge
                  label={asset.is_active ? '启用' : '禁用'}
                  tone={asset.is_active ? 'emerald' : 'rose'}
                />
              </td>
              <td>
                <span className="text-xs text-slate-500">
                  {asset.is_ugc ? 'UGC' : '全局标品'}
                </span>
              </td>
              <td className="col-actions">
                {!asset.is_ugc && (
                  <WorkbenchIconButton
                    icon={Settings2}
                    label="覆盖配置"
                    onClick={() => onSelectAsset(asset)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </WorkbenchTableWrap>
  );
};
