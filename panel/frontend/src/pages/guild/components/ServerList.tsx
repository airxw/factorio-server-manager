import { Plus, Compass, Download } from 'lucide-react';
import type { ServerSummary } from '@public/schema/panel-api-types';

interface ServerListProps {
  servers: ServerSummary[];
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  isLoading: boolean;
}

export function ServerList({ servers, activeServerId, onSelectServer, isLoading }: ServerListProps) {
  return (
    <nav className="w-[72px] min-w-[72px] h-full bg-[#1e1f22] flex flex-col items-center py-3 gap-2 overflow-y-auto overflow-x-hidden scrollbar-hide shrink-0 z-20">
      {/* Home Button */}
      <div className="relative group flex items-center justify-center">
        <div className="absolute left-0 w-1 h-0 bg-white rounded-r-full transition-all duration-200 group-hover:h-5"></div>
        <button className="w-12 h-12 bg-[#313338] hover:bg-[#5865f2] hover:rounded-[16px] rounded-[24px] transition-all duration-200 flex items-center justify-center text-[#dbdee1] hover:text-white">
          <Compass className="w-7 h-7" />
        </button>
      </div>

      <div className="w-8 h-[2px] bg-[#313338] rounded-full mx-auto my-1"></div>

      {isLoading ? (
        <div className="w-12 h-12 bg-[#313338] rounded-[24px] animate-pulse"></div>
      ) : (
        servers.map((server) => {
          const isActive = server.id === activeServerId;
          return (
            <div key={server.id} className="relative group flex items-center justify-center w-full">
              {/* Active Indicator */}
              <div 
                className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                  isActive ? 'h-10' : 'h-0 group-hover:h-5'
                }`}
              ></div>
              
              {/* Server Icon */}
              <button
                onClick={() => onSelectServer(server.id)}
                className={`w-12 h-12 flex items-center justify-center text-lg font-bold transition-all duration-200 overflow-hidden ${
                  isActive 
                    ? 'bg-[#5865f2] rounded-[16px] text-white' 
                    : 'bg-[#313338] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white hover:rounded-[16px] rounded-[24px]'
                }`}
              >
                {server.name.charAt(0).toUpperCase()}
              </button>
            </div>
          );
        })
      )}

      <div className="relative group flex items-center justify-center mt-2 w-full">
        <button className="w-12 h-12 bg-[#313338] hover:bg-[#23a559] hover:rounded-[16px] rounded-[24px] transition-all duration-200 flex items-center justify-center text-[#23a559] hover:text-white">
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <div className="relative group flex items-center justify-center w-full">
        <button className="w-12 h-12 bg-[#313338] hover:bg-[#23a559] hover:rounded-[16px] rounded-[24px] transition-all duration-200 flex items-center justify-center text-[#23a559] hover:text-white">
          <Download className="w-6 h-6" />
        </button>
      </div>
    </nav>
  );
}
