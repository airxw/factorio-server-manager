import React from 'react';
import { Download, Info, Server } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { PackSummary } from '@public/schema/panel-api-types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GameCardProps {
  pack: PackSummary;
  onClickInstall?: (pack: PackSummary) => void;
}

// 映射游戏类型到不同的背景渐变色，模拟游戏封面
const GAME_GRADIENTS: Record<string, string> = {
  minecraft: 'from-green-500/80 to-emerald-700/80',
  factorio: 'from-orange-500/80 to-red-700/80',
  rust: 'from-amber-600/80 to-orange-800/80',
  ark: 'from-cyan-600/80 to-blue-800/80',
  palworld: 'from-blue-400/80 to-indigo-600/80',
  dst: 'from-purple-600/80 to-gray-800/80',
  dyson: 'from-blue-500/80 to-purple-700/80',
  enshrouded: 'from-slate-500/80 to-zinc-800/80',
  satisfactory: 'from-yellow-500/80 to-orange-600/80',
  terraria: 'from-green-400/80 to-teal-700/80',
  valheim: 'from-sky-500/80 to-blue-800/80',
  zomboid: 'from-red-800/80 to-stone-900/80',
  custom: 'from-gray-500/80 to-slate-700/80',
};

const GAME_TAGS: Record<string, string> = {
  minecraft: '沙盒建造',
  factorio: '自动化工厂',
  rust: '硬核生存',
  ark: '恐龙生存',
  palworld: '幻兽收集',
  dst: '合作生存',
  dyson: '戴森球建造',
  enshrouded: '动作RPG',
  satisfactory: '第一人称工厂',
  terraria: '2D沙盒',
  valheim: '北欧神话',
  zomboid: '僵尸末日',
  custom: '自定义',
};

export const GameCard: React.FC<GameCardProps> = ({ pack, onClickInstall }) => {
  const gradient = GAME_GRADIENTS[pack.game] || GAME_GRADIENTS.custom;
  const tag = GAME_TAGS[pack.game] || pack.game.toUpperCase();

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/50 transition-all hover:-translate-y-1 hover:shadow-xl hover:ring-slate-300 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700">
      {/* 封面图区域 */}
      <div className={cn('relative h-48 w-full overflow-hidden bg-gradient-to-br', gradient)}>
        <div className="absolute inset-0 bg-black/10 mix-blend-overlay transition-opacity group-hover:bg-black/0" />

        {/* 右上角标签 */}
        <div className="absolute right-3 top-3 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
          {tag}
        </div>

        {/* 中间大字 */}
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <h3 className="text-3xl font-bold tracking-tight text-white drop-shadow-md">
            {pack.game.toUpperCase()}
          </h3>
        </div>
      </div>

      {/* 信息区域 */}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4
                className="text-lg font-semibold text-slate-900 dark:text-white line-clamp-1"
                title={pack.display_name}
              >
                {pack.display_name}
              </h4>
              <p className="mt-1 flex items-center text-sm text-slate-500 dark:text-slate-400">
                <Server className="mr-1.5 h-4 w-4" />
                {pack.variant}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              v{pack.version}
            </span>
            {pack.ui_tabs && pack.ui_tabs.length > 0 && (
              <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                支持 UI 面板
              </span>
            )}
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <Info className="mr-1.5 h-4 w-4" />
            查看详情
          </button>
          <button
            onClick={() => onClickInstall?.(pack)}
            type="button"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 dark:focus:ring-white dark:focus:ring-offset-slate-900 cursor-pointer"
          >
            <Download className="mr-2 h-4 w-4" />
            安装应用
          </button>
        </div>
      </div>
    </div>
  );
};
