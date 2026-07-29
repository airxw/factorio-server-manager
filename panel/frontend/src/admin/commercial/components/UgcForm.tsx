import React, { useState } from 'react';
import { WorkbenchPrimaryButton } from '../../../pages/store/components/WorkbenchUI';

interface UgcFormProps {
  onSubmit: (data: { name: string; price: number; is_active: boolean; execution_logic: string }) => void;
}

const INPUT_CLASS =
  'mt-2 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
const TEXTAREA_CLASS =
  'mt-2 w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300';
const LABEL_CLASS =
  'block text-xs font-medium uppercase tracking-[0.18em] text-slate-400';

export const UgcForm: React.FC<UgcFormProps> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [executionLogic, setExecutionLogic] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      price,
      is_active: isActive,
      execution_logic: executionLogic,
    });
    // Reset form
    setName('');
    setPrice(0);
    setIsActive(true);
    setExecutionLogic('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ugc-name" className={LABEL_CLASS}>
          资产名称
        </label>
        <input
          id="ugc-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT_CLASS}
          required
        />
      </div>

      <div>
        <label htmlFor="ugc-price" className={LABEL_CLASS}>
          价格
        </label>
        <input
          id="ugc-price"
          type="number"
          step="0.01"
          min="0"
          value={Number.isNaN(price) ? '' : price}
          onChange={(e) => setPrice(parseFloat(e.target.value))}
          className={INPUT_CLASS}
          required
        />
      </div>

      <div>
        <label htmlFor="ugc-logic" className={LABEL_CLASS}>
          执行逻辑（RCON 指令）
        </label>
        <textarea
          id="ugc-logic"
          value={executionLogic}
          onChange={(e) => setExecutionLogic(e.target.value)}
          rows={3}
          placeholder="例如: give_item {player_id} diamond"
          className={TEXTAREA_CLASS}
          required
        />
        <p className="mt-2 text-xs text-slate-400">
          仅允许字母、数字、下划线、空格和花括号 {'{ }'}。
        </p>
      </div>

      <label
        htmlFor="ugcIsActive"
        className="flex cursor-pointer items-center gap-3 rounded-[18px] border border-slate-200 bg-white/80 px-4 py-3"
      >
        <input
          id="ugcIsActive"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
        />
        <span className="text-sm text-slate-700">创建后立即启用</span>
      </label>

      <div className="pt-2">
        <WorkbenchPrimaryButton type="submit" className="w-full justify-center">
          创建资产
        </WorkbenchPrimaryButton>
      </div>
    </form>
  );
};
