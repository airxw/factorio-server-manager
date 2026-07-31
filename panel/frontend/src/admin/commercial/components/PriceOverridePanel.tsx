import React, { useState, useEffect } from 'react';
import { MergedAsset } from '../../../../../../public/interface_stub/asset_interfaces';
import {
  WorkbenchPrimaryButton,
  WorkbenchSecondaryButton,
} from '../../../pages/store/components/WorkbenchUI';

interface PriceOverridePanelProps {
  asset: MergedAsset;
  onSave: (globalAssetId: string, price: number, isActive: boolean) => void;
  onCancel: () => void;
}

export const PriceOverridePanel: React.FC<PriceOverridePanelProps> = ({ asset, onSave, onCancel }) => {
  const [price, setPrice] = useState<number>(asset.price);
  const [isActive, setIsActive] = useState<boolean>(asset.is_active);

  useEffect(() => {
    setPrice(asset.price);
    setIsActive(asset.is_active);
  }, [asset]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(asset.id, price, isActive);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
          资产名称
        </label>
        <div className="mt-2 rounded-full border border-slate-200 bg-slate-50/80 px-4 py-2 text-sm text-slate-600">
          {asset.name}
        </div>
      </div>

      <div>
        <label
          htmlFor="override-price"
          className="block text-xs font-medium uppercase tracking-[0.08em] text-slate-400"
        >
          价格（覆盖）
        </label>
        <input
          id="override-price"
          type="number"
          step="0.01"
          min="0"
          value={Number.isNaN(price) ? '' : price}
          onChange={(e) => setPrice(parseFloat(e.target.value))}
          className="mt-2 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          required
        />
      </div>

      <label
        htmlFor="isActive"
        className="form-checkbox-label"
      >
        <input
          id="isActive"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        <span>是否启用（在该实例上架）</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <WorkbenchSecondaryButton type="button" onClick={onCancel}>
          取消
        </WorkbenchSecondaryButton>
        <WorkbenchPrimaryButton type="submit">保存配置</WorkbenchPrimaryButton>
      </div>
    </form>
  );
};
