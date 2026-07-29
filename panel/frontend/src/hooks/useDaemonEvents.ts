// ============================================================================
// useDaemonEvents — 订阅 Panel WebSocket，接收 console.output / instance.state
// v4.2.0: 重构为使用 InstanceHubStore 共享连接（引用计数 + Promise 串行化 + 多订阅者 Set）
//
// 核心改进（MSLX 借鉴）：
//   - 不再每个组件创建独立 WS 连接，改为共享 instanceHub 单例
//   - 多组件订阅同一 instance 时复用连接，引用计数管理订阅生命周期
//   - subscribe/unsubscribe 操作 Promise 串行化，避免竞态
//   - 断线重连后自动恢复订阅
//
// 保留原有特性：
//   - 四.1: 指数退避自动重连（由 store 管理）
//   - 四.2: 心跳（由 store 管理）
//   - 二.3: JWT auth（由 store 管理）
//   - 二.4: 日志环形缓冲，上限 2000 行
//   - 二.6: WS 消息批量更新——requestAnimationFrame 合并多次 setLines
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { instanceHub } from '../stores/instanceHubStore';

export interface ConsoleLine {
  time: string;
  text: string;
  stream: 'stdout' | 'stderr';
}

export interface DaemonEventsState {
  lines: ConsoleLine[];
  state: InstanceState | null;
  connected: boolean;
  /** 四.1: 正在重连中 */
  reconnecting: boolean;
  /** 四.1: 达到最大重试次数，提示用户手动刷新 */
  maxRetriesReached: boolean;
}

/** 二.4: 日志环形缓冲上限 */
const MAX_LINES = 2000;

export function useDaemonEvents(serverId: string): DaemonEventsState {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [state, setState] = useState<InstanceState | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [maxRetriesReached, setMaxRetriesReached] = useState(false);

  // 二.6: 批量更新缓冲——累积新行，在 rAF 中一次性 flush
  const pendingLinesRef = useRef<ConsoleLine[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    // 切换实例时重置
    setLines([]);
    setState(null);
    setConnected(false);
    setReconnecting(false);
    setMaxRetriesReached(false);
    pendingLinesRef.current = [];

    // 二.6: flush 缓冲行到 state，应用环形缓冲裁剪
    const flushPendingLines = () => {
      rafIdRef.current = null;
      const pending = pendingLinesRef.current;
      if (pending.length === 0) return;
      pendingLinesRef.current = [];
      setLines((prev) => {
        const combined = [...prev, ...pending];
        return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined;
      });
    };

    const scheduleFlush = () => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(flushPendingLines);
    };

    // B2: 注册事件 handler 到共享 store（引用计数 + 多订阅者 Set）
    // 使用稳定引用避免 effect 重新触发，handler 内部通过 ref 访问最新闭包
    const handlers = {
      onConsole: (line: string, stream: 'stdout' | 'stderr', timestamp: string) => {
        pendingLinesRef.current.push({ time: timestamp, text: line, stream });
        scheduleFlush();
      },
      onState: (newState: InstanceState) => {
        setState(newState);
      },
    };

    const unsubscribe = instanceHub.subscribe(serverId, handlers);

    // B1: 监听连接状态变更
    const unsubscribeConnection = instanceHub.onConnectionChange((c, r, m) => {
      setConnected(c);
      setReconnecting(r);
      setMaxRetriesReached(m);
    });

    // 确保连接已建立（懒连接）
    instanceHub.ensureConnected();

    return () => {
      unsubscribe();
      unsubscribeConnection();
      // 二.6: flush 残留缓冲
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [serverId]);

  return { lines, state, connected, reconnecting, maxRetriesReached };
}
