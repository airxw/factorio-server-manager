// ============================================================================
// RconConsole — RCON 控制台
// - 上半部分：滚动日志输出区（终端风格，黑底绿字，显示 [time] line）
// - 下半部分：命令输入框 + 发送按钮
// - 用 useDaemonEvents(serverId) 拉日志流；发送命令调 api.sendCommand
// - 命令与响应回显追加到日志区；仅 running 状态可输入；自动滚到底部
// - 通过 onStateChange 把 WS 实时状态回传父组件，避免父组件再开一条 WS
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { InstanceState } from '@public/schema/daemon-api-types';
import { useAuth } from '../api/auth';
import { useDaemonEvents, type ConsoleLine } from '../hooks/useDaemonEvents';

interface RconConsoleProps {
  serverId: string;
  serverState: InstanceState | null;
  onStateChange?: (state: InstanceState) => void;
  /** 4.8: WS 连接状态变化回调——重连成功时父组件可触发 refresh() 拉取最新状态 */
  onConnectedChange?: (connected: boolean) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 展示行：在 ConsoleLine 基础上附加稳定 id，用作 React key */
interface DisplayLine extends ConsoleLine {
  id: number;
}

export default function RconConsole({
  serverId,
  serverState,
  onStateChange,
  onConnectedChange,
}: RconConsoleProps) {
  const { api } = useAuth();
  const { lines: wsLines, state: wsState, connected } = useDaemonEvents(serverId);

  const [displayLines, setDisplayLines] = useState<DisplayLine[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastWsCount = useRef(0);
  const lineIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 二.5: 是否跟随底部（用户手动上滚后暂停自动跟随，回到底部时恢复）
  const stickToBottomRef = useRef(true);
  // 历史日志加载标记：防止 serverId 未变但组件重挂时重复拉取
  // 用 serverId 作为 key 关联，切换实例时重置
  const historyLoadedRef = useRef<string | null>(null);

  // 二.7: 命令历史栈与当前索引（-1 表示正在输入新命令，未浏览历史）
  // historyRef 存放已执行命令（最新在数组末尾），historyIndexRef 表示当前浏览位置
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>('');

  const nextLineId = () => ++lineIdRef.current;

  // WS 实时状态回传父组件
  useEffect(() => {
    if (wsState && onStateChange) {
      onStateChange(wsState);
    }
  }, [wsState, onStateChange]);

  // 4.8: WS 连接状态变化回传父组件——重连成功时父组件触发 refresh() 拉取最新状态
  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  // 挂载时拉取 Daemon 内存环形缓冲中的历史日志行，预填 displayLines。
  //
  // 背景：用户离开控制台 tab/页面后返回时，RconConsole 会重挂，displayLines 归零；
  // WS 也只从重订阅时刻起推送新行，之前的历史日志永久丢失。本 effect 从
  // GET /api/servers/:id/logs 拉取最近 500 行，prepend 到已有 WS 行之前，
  // 让用户回来后能立即看到上下文。
  //
  // 时序处理：历史行可能比已到的 WS 行更早，故 prepend 而非 append。
  // 重复加载防护：historyLoadedRef 记录已加载的 serverId，切换实例时重置。
  useEffect(() => {
    if (historyLoadedRef.current === serverId) return;
    historyLoadedRef.current = serverId;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await api.getConsoleLogs(serverId, 500);
        if (cancelled) return;
        if (resp.lines.length === 0) return;
        setDisplayLines((prev) => {
          // 历史行包装为 DisplayLine，时间戳留空（Daemon 环形缓冲不保存时间戳）
          const historyLines: DisplayLine[] = resp.lines.map((text) => ({
            time: '',
            text,
            stream: 'stdout' as const,
            id: nextLineId(),
          }));
          return [...historyLines, ...prev];
        });
      } catch {
        // 拉取失败静默处理：实例从未启动时 Daemon 返回空数组或 404，不影响 WS 实时流
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId, api]);

  // 合并 WS 推送的新日志行到 displayLines（处理重置场景）
  useEffect(() => {
    if (wsLines.length < lastWsCount.current) {
      // 一.3: WS 日志被重置（如切换实例），同步清空展示行，避免重复追加
      lastWsCount.current = 0;
      setDisplayLines([]);
      // 二.5: 重置时恢复跟随底部
      stickToBottomRef.current = true;
    }
    if (wsLines.length > lastWsCount.current) {
      const newLines = wsLines.slice(lastWsCount.current);
      lastWsCount.current = wsLines.length;
      setDisplayLines((prev) => [
        ...prev,
        ...newLines.map((line) => ({ ...line, id: nextLineId() })),
      ]);
    }
  }, [wsLines]);

  // 二.5: 虚拟列表，仅渲染可视区域的日志行
  // 行高可变（日志可换行），用 measureElement 动态测量
  const virtualizer = useVirtualizer({
    count: displayLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 16,
  });

  // 二.5: 跟随底部的自动滚动
  // 用户手动上滚后停止跟随；新行到达时仅在跟随状态下滚到底部
  useEffect(() => {
    if (displayLines.length === 0) return;
    if (!stickToBottomRef.current) return;
    // 用 rAF 等待虚拟列表测量完成后再滚动
    const raf = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(displayLines.length - 1, { align: 'end' });
    });
    return () => cancelAnimationFrame(raf);
  }, [displayLines, virtualizer]);

  // 二.5: 监听滚动事件，更新 stickToBottom
  // 判断：距底部 <= 40px 视为在底部
  const handleTerminalScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance <= 40;
  }, []);

  const effectiveState = wsState ?? serverState;
  const isRunning = effectiveState === 'running';

  const appendLine = useCallback((line: ConsoleLine) => {
    setDisplayLines((prev) => [...prev, { ...line, id: nextLineId() }]);
  }, []);

  const handleSend = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || sending) return;
    if (!isRunning) {
      setError('仅 running 状态可发送命令');
      return;
    }
    setError(null);
    setInput('');
    // 二.7: 命令入栈，重置浏览索引到最新（-1）
    // 忽略与最近一条相同的命令，避免历史栈堆积重复项
    const hist = historyRef.current;
    if (hist.length === 0 || hist[hist.length - 1] !== cmd) {
      hist.push(cmd);
      // 限制历史栈大小，避免无限增长
      if (hist.length > 200) {
        hist.splice(0, hist.length - 200);
      }
    }
    historyIndexRef.current = -1;
    draftRef.current = '';
    setSending(true);

    appendLine({ time: nowIso(), text: `> ${cmd}`, stream: 'stdout' });

    try {
      const resp = await api.sendCommand(serverId, cmd);
      if (resp.output) {
        appendLine({ time: nowIso(), text: resp.output, stream: 'stdout' });
      } else if (!resp.success) {
        appendLine({ time: nowIso(), text: '(命令执行失败，无输出)', stream: 'stderr' });
      } else {
        // 一.11: 命令执行成功但无输出，给出占位提示
        appendLine({ time: nowIso(), text: '(无输出)', stream: 'stdout' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLine({ time: nowIso(), text: `错误: ${msg}`, stream: 'stderr' });
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [input, sending, isRunning, appendLine, api, serverId]);

  // 二.7: 上/下键翻历史命令
  // ArrowUp: 浏览更早的命令（索引向 0 方向前进，到 0 为止）
  // ArrowDown: 浏览更新的命令（索引向末尾方向后退，超过末尾回到 -1 表示新输入）
  // 浏览历史时暂存当前未发送的草稿，回到新输入位置时恢复草稿
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSend();
      return;
    }
    const hist = historyRef.current;
    if (hist.length === 0) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      // 当前在最新输入位置（-1），切到末尾索引；否则向 0 前进
      if (historyIndexRef.current === -1) {
        // 进入历史前，保存当前草稿
        draftRef.current = input;
        historyIndexRef.current = hist.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      } else {
        // 已到最早一条，不再前进
        return;
      }
      setInput(hist[historyIndexRef.current]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        // 已在新输入位置，不再后退
        return;
      }
      if (historyIndexRef.current < hist.length - 1) {
        historyIndexRef.current += 1;
        setInput(hist[historyIndexRef.current]);
      } else {
        // 越过末尾，回到新输入位置，恢复草稿
        historyIndexRef.current = -1;
        setInput(draftRef.current);
      }
    }
  };

  const handleClear = () => {
    setDisplayLines([]);
    lastWsCount.current = wsLines.length;
  };

  return (
    <div className="rcon-console">
      <div className="rcon-header">
        <span
          className={`conn-badge ${connected ? 'conn-on' : 'conn-off'}`}
          aria-label={`控制台通道状态: ${connected ? '已连接' : '未连接'}`}
        >
          {connected ? '控制台通道已连接' : '控制台通道未连接'}
        </span>
        <span className="rcon-state">实例状态: {effectiveState ?? '未知'}</span>
        <button className="btn btn-ghost btn-sm" onClick={handleClear}>
          清屏
        </button>
      </div>

      <div className="terminal" ref={scrollRef} onScroll={handleTerminalScroll}>
        {displayLines.length === 0 ? (
          <div className="terminal-empty">暂无日志输出，等待服务器启动…</div>
        ) : (
          // 二.5: 虚拟列表渲染——外层 relative 容器撑开总高度，内层仅渲染可见行
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const line = displayLines[vi.index];
              if (!line) return null;
              return (
                <div
                  key={line.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className={`terminal-line ${line.stream === 'stderr' ? 'stderr' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <span className="terminal-time">[{formatTime(line.time)}]</span>
                  <span className="terminal-text">{line.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rcon-input-row">
        <input
          className="rcon-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? '输入命令后回车发送，例如 list' : '服务器未运行，无法发送命令'}
          disabled={!isRunning || sending}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="btn btn-primary"
          onClick={() => void handleSend()}
          disabled={!isRunning || sending || input.trim() === ''}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
      {error && <div className="rcon-error">{error}</div>}
    </div>
  );
}
