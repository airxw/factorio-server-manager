// ============================================================================
// CommandProtocol 接口存根（零实现，仅声明签名）
// 依据：spec §3.5 — Factorio stdin 单向通信需独立建模
// 实现方：daemon/src/protocol/
// ============================================================================

// 命令协议统一抽象：
// - RconClient（rcon-client 库）：双向通信，send 返回响应
// - StdinClient（child_process stdin）：单向通信，send 返回 null
export interface CommandProtocol {
  // 建立连接（RCON 需认证，stdin 需获取子进程 stdin 流）
  connect(): Promise<void>;

  // 发送命令，返回响应文本；单向协议（如 stdin）返回 null
  send(command: string): Promise<string | null>;

  // 断开连接，释放资源
  disconnect(): Promise<void>;
}
