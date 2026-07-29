import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Server, AlertCircle } from 'lucide-react';
import { useAuth } from '../api/auth';
import { nodeStatusStore } from '../stores/nodeStatusStore';
import type { NodeInfo } from '../api/modules/servers';
import type { PanelNodeStatusEvent } from '@public/schema/ws-events';
import { getEffectiveRole, isInstanceAdminOrAbove } from '../utils/role';

export default function NodeStatusWidget() {
  const { user, api } = useAuth();
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);

  // 仅对 server_admin / instance_admin 显示（以 active_role 会话身份为准）
  const isAdmin = isInstanceAdminOrAbove(getEffectiveRole(user));

  // 1. 初始化拉取节点列表

  const { data, refetch } = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: () => api.listNodes(),
    enabled: isAdmin,
    staleTime: 60000,
  });

  useEffect(() => {
    if (data?.nodes) {
      setNodes(data.nodes);
    }
  }, [data]);

  // 2. 监听 WS 事件实时更新节点在线状态
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = nodeStatusStore.subscribe((event: PanelNodeStatusEvent) => {
      setNodes((prev) => {
        const next = [...prev];
        const idx = next.findIndex((n) => n.id === event.node_id);
        if (idx >= 0) {
          next[idx] = { ...next[idx], status: event.status };
        } else {
          // 若为新注册的节点，可触发全量刷新
          refetch();
        }
        return next;
      });
    });
    return unsub;
  }, [isAdmin, refetch]);

  // 3. 测速循环
  const pingNodes = useCallback(async () => {
    if (!nodes.length) return;
    const nextLatencies = { ...latencies };
    for (const node of nodes) {
      if (node.status === 'online') {
        try {
          const res = await api.pingNode(node.id);
          nextLatencies[node.id] = res.latency_ms;
        } catch {
          nextLatencies[node.id] = -1; // -1 表示超时或不可达
        }
      } else {
        nextLatencies[node.id] = -1;
      }
    }
    setLatencies(nextLatencies);
  }, [nodes, latencies]);

  useEffect(() => {
    if (!isAdmin || !expanded || !nodes.length) return;
    // 首次展开立即测速
    pingNodes();
    // 之后每 10s 测速一次
    const timer = setInterval(pingNodes, 10000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, expanded, nodes.length]);

  if (!isAdmin) return null;

  const onlineCount = nodes.filter((n) => n.status === 'online').length;
  const hasError = nodes.some((n) => n.status === 'offline' || n.status === 'degraded');

  return (
    <div className="node-status-widget" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
      <div className={`widget-trigger ${hasError ? 'has-error' : 'is-ok'}`}>
        <Activity size={16} className={hasError ? 'text-error' : 'text-success'} />
        <span className="widget-label">
          {onlineCount} / {nodes.length} 在线
        </span>
      </div>

      {expanded && nodes.length > 0 && (
        <div className="widget-dropdown">
          <div className="widget-header">集群节点状态</div>
          <div className="widget-list">
            {nodes.map((node) => {
              const isOnline = node.status === 'online';
              const latency = latencies[node.id];
              let latencyColor = 'var(--color-text-muted)';
              if (isOnline && latency !== undefined && latency >= 0) {
                if (latency < 50) latencyColor = 'var(--color-success)';
                else if (latency < 200) latencyColor = 'var(--color-warning)';
                else latencyColor = 'var(--color-error)';
              }

              return (
                <div key={node.id} className="widget-item">
                  <div className="node-info">
                    {isOnline ? (
                      <Server size={14} className="text-success" />
                    ) : (
                      <AlertCircle size={14} className="text-error" />
                    )}
                    <span className="node-name">{node.name}</span>
                    {node.node_type === 'master' && <span className="badge badge-info" style={{ fontSize: 10, padding: '0 4px', transform: 'scale(0.8)' }}>M</span>}
                  </div>
                  <div className="node-latency" style={{ color: latencyColor }}>
                    {!isOnline ? '离线' : latency === undefined ? '测速中...' : latency < 0 ? '超时' : `${latency}ms`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
