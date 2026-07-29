import { ReactNode } from 'react';
import { Settings, Users, ShieldAlert, Activity, MessageSquare } from 'lucide-react';
import type { ServerSummary } from '@public/schema/panel-api-types';

interface ChannelSidebarProps {
  server: ServerSummary | null;
}

export function ChannelSidebar({ server }: ChannelSidebarProps) {
  if (!server) {
    return (
      <div className="w-[240px] min-w-[240px] h-full bg-[#2b2d31] flex flex-col">
      </div>
    );
  }

  return (
    <div className="w-[240px] min-w-[240px] h-full bg-[#2b2d31] flex flex-col shrink-0">
      {/* Header */}
      <div className="h-12 flex items-center px-4 shadow-[0_1px_2px_rgba(0,0,0,0.2)] font-semibold text-white hover:bg-[#35373c] cursor-pointer transition-colors z-10">
        <h2 className="truncate">{server.name}</h2>
      </div>

      {/* Channel List */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-[2px] custom-scrollbar">
        <div className="text-xs font-semibold text-[#949ba4] uppercase tracking-wider mb-1 px-2 hover:text-[#dbdee1] cursor-pointer flex items-center">
          <span className="mr-1">▼</span> 信息看板
        </div>
        <ChannelItem icon={<Activity size={18} />} label="控制台" active />
        <ChannelItem icon={<MessageSquare size={18} />} label="聊天大厅" />
        <ChannelItem icon={<Users size={18} />} label="在线玩家" />

        <div className="text-xs font-semibold text-[#949ba4] uppercase tracking-wider mt-4 mb-1 px-2 hover:text-[#dbdee1] cursor-pointer flex items-center">
          <span className="mr-1">▼</span> 管理工具
        </div>
        <ChannelItem icon={<Settings size={18} />} label="服务器设置" />
        <ChannelItem icon={<ShieldAlert size={18} />} label="封禁名单" />
      </div>

      {/* Bottom User Area */}
      <div className="h-[52px] bg-[#232428] flex items-center px-2 shrink-0">
        <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold mr-2">
          U
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white truncate">User</div>
          <div className="text-[11px] text-[#949ba4] truncate">Online</div>
        </div>
        <div className="flex text-[#b5bac1] gap-1">
          <button className="p-1 hover:bg-[#35373c] rounded hover:text-[#dbdee1]">
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`flex items-center px-2 py-1.5 rounded text-base cursor-pointer group ${
      active 
        ? 'bg-[#404249] text-white' 
        : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'
    }`}>
      <span className="mr-1.5 text-[#80848e] group-hover:text-[#dbdee1]">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}
