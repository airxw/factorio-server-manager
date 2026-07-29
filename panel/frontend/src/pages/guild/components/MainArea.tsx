import { Hash, Search, Bell, Pin, Users } from 'lucide-react';
import type { ServerSummary } from '@public/schema/panel-api-types';

interface MainAreaProps {
  server: ServerSummary | null;
}

export function MainArea({ server }: MainAreaProps) {
  if (!server) {
    return (
      <div className="flex-1 bg-[#313338] flex items-center justify-center text-[#949ba4]">
        <div className="text-center">
          <h3 className="text-xl font-bold mb-2">欢迎来到沉浸式游戏SaaS模式</h3>
          <p>请在左侧选择一个服务器以开始</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#313338] flex flex-col min-w-0">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 shadow-[0_1px_2px_rgba(0,0,0,0.2)] shrink-0">
        <div className="flex items-center text-white font-semibold text-base min-w-0">
          <Hash className="text-[#80848e] mr-2 shrink-0" size={24} />
          <span className="truncate mr-4">控制台</span>
          <span className="w-[1px] h-6 bg-[#3f4147] mx-2"></span>
          <span className="text-sm text-[#949ba4] font-normal truncate ml-2">
            服务器运行状态与控制看板
          </span>
        </div>

        <div className="flex items-center text-[#b5bac1] gap-4 shrink-0">
          <Hash size={20} className="hover:text-[#dbdee1] cursor-pointer" />
          <Bell size={20} className="hover:text-[#dbdee1] cursor-pointer" />
          <Pin size={20} className="hover:text-[#dbdee1] cursor-pointer" />
          <Users size={20} className="hover:text-[#dbdee1] cursor-pointer" />
          
          <div className="relative flex items-center">
            <input 
              type="text" 
              placeholder="搜索" 
              className="bg-[#1e1f22] text-sm text-[#dbdee1] rounded w-36 focus:w-60 transition-all duration-200 px-2 py-1 outline-none border-none placeholder-[#949ba4]"
            />
            <Search size={14} className="absolute right-2 text-[#949ba4]" />
          </div>
        </div>
      </div>

      {/* Main Content Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="max-w-4xl mx-auto mt-4">
          <div className="flex items-center mb-6">
            <div className="w-16 h-16 bg-[#5865f2] rounded-[16px] flex items-center justify-center text-white text-3xl font-bold mr-4">
              {server.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">欢迎来到 {server.name} 控制台!</h1>
              <p className="text-[#949ba4]">这是您管理 {server.game_type} 服务器的控制中心。</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status Card */}
            <div className="bg-[#2b2d31] rounded-lg p-4">
              <h3 className="text-white font-bold mb-4 uppercase text-xs tracking-wider">运行状态</h3>
              <div className="flex items-center justify-between">
                <span className="text-[#dbdee1]">当前状态</span>
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  server.status === 'running' ? 'bg-[#23a559]/20 text-[#23a559]' :
                  server.status === 'stopped' ? 'bg-[#da373c]/20 text-[#da373c]' :
                  'bg-[#faa61a]/20 text-[#faa61a]'
                }`}>
                  {server.status.toUpperCase()}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="flex-1 bg-[#23a559] hover:bg-[#1a7c43] text-white py-2 rounded font-medium transition-colors">
                  启动
                </button>
                <button className="flex-1 bg-[#da373c] hover:bg-[#a1282c] text-white py-2 rounded font-medium transition-colors">
                  停止
                </button>
              </div>
            </div>

            {/* Info Card */}
            <div className="bg-[#2b2d31] rounded-lg p-4">
              <h3 className="text-white font-bold mb-4 uppercase text-xs tracking-wider">服务器信息</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">ID</span>
                  <span className="text-[#dbdee1] font-mono text-xs">{server.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">游戏类型</span>
                  <span className="text-[#dbdee1]">{server.game_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">所属节点</span>
                  <span className="text-[#dbdee1]">{server.node_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">创建时间</span>
                  <span className="text-[#dbdee1]">
                    {new Date(server.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
