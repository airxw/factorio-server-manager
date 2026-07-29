// ============================================================================
// 模块4_Daemon实例管理 — 就绪检测
// 依据：daemon/src/instances/AGENTS.md §模块专属约束 3
// 职责：按 Pack.startup.ready_pattern 编译正则，匹配 stdout 行判定启动完成
// ============================================================================

/**
 * ReadyMatcher — 包装 ready_pattern 的正则匹配器。
 *
 * 构造时编译 pattern 为 RegExp（pattern 来自 Pack，已通过 zod 校验非空）。
 * match(line) 命中即代表服务器启动完成，触发 starting → running 转换。
 *
 * 注：Minecraft Vanilla 的 ready_pattern 为
 *   `Done \([\d.]+s\)! For help, type "help"`
 * 命中 stdout 中形如 `Done (3.456s)! For help, type "help"` 的行。
 */
export class ReadyMatcher {
  private readonly regex: RegExp;

  constructor(pattern: string) {
    this.regex = new RegExp(pattern);
  }

  match(line: string): boolean {
    return this.regex.test(line);
  }
}
