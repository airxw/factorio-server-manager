// ============================================================================
// executionEngineClient — IExecutionEngine 的 Panel 侧实现（v4.11.0）
// 契约：public/interface_stub/asset_interfaces.d.ts (IExecutionEngine)
//
// 职责：将玩家购买/兑换触发的发货逻辑（logicString + variables）转发到 daemon
// 的 /api/instances/:id/execute-logic 端点，由 daemon 侧 ExecutionEngine 沙箱
// 完成变量替换 + 正则白名单校验后投递到游戏进程。
//
// 与 commandDispatcher 的区别：
//   - commandDispatcher：Panel 侧渲染 {{var}} → 入队 → daemon /command（已渲染命令）
//   - executionEngineClient：直接转发 {Var} 模板 + variables → daemon /execute-logic（沙箱渲染）
//
// 前者用于 pack 定义的 redeem_command（变量名固定为 player/item/count 等）；
// 后者用于 UGC 自定义资产的 execution_logic（变量名由实例管理员配置，不经过 Panel 渲染）。
// ============================================================================

import type { Knex } from 'knex';
import type { IExecutionEngine } from '@public/interface_stub/asset_interfaces';
import { DaemonClientImpl } from './daemonClientService.js';

/** servers 表所需字段视图（仅 executionEngineClient 关心的列） */
interface ServerRow {
  id: string;
  node_id: string;
}

/** nodeId 查询失败时的兜底节点（与 commandDispatcher 对齐） */
const LOCAL_NODE_FALLBACK = 'node-local';

/**
 * IExecutionEngine 的 Panel 侧实现。
 *
 * 依赖 DaemonClientImpl（而非 DaemonClient 接口），因为 executeLogic 方法
 * 尚未提升到 DaemonClient 接口契约（避免 public/ 变更）。
 *
 * 错误映射：
 *   - DaemonUnreachableError → 透传（节点不可达）
 *   - InstanceNotFoundError → 透传（实例不存在）
 *   - daemon 返回 400（RCON 注入拦截）→ 抛 Error（含 ERR_RCON_INJECTION 语义）
 *   - daemon 返回 500（投递失败）→ 抛 Error（含 ERR_EXECUTION_FAILED 语义）
 */
export class ExecutionEngineClientImpl implements IExecutionEngine {
  constructor(
    private readonly db: Knex,
    private readonly daemonClient: DaemonClientImpl,
  ) {}

  /**
   * 玩家购买/兑换触发发货逻辑。
   *
   * @param instanceId 实例 ID（= servers.id = daemon instance id）
   * @param logicString 含 {Var} 单花括号占位符的原始指令模板
   * @param variables 变量名 → 变量值映射
   * @returns true 表示投递成功
   * @throws {Error} ERR_RCON_INJECTION（注入拦截）/ ERR_EXECUTION_FAILED（投递失败）
   * @throws {DaemonUnreachableError} 节点不可达
   * @throws {InstanceNotFoundError} 实例不存在
   * @throws {InstanceNotRunningError} 实例未运行
   */
  async executeLogic(
    instanceId: string,
    logicString: string,
    variables: Record<string, string>,
  ): Promise<boolean> {
    const nodeId = await this.resolveNodeId(instanceId);
    try {
      const result = await this.daemonClient.executeLogic(
        nodeId,
        instanceId,
        logicString,
        variables,
      );
      return result.success;
    } catch (err) {
      // daemon 沙箱注入拦截（400）已在 DaemonHttpClient.request 中映射为 DaemonApiError，
      // wrapDaemonError 会将其映射为 DaemonUnreachableError 或透传。
      // 此处补充语义化错误：从原始错误消息中识别注入拦截。
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RCON injection') || msg.includes('ERR_RCON_INJECTION')) {
        throw new Error(`ERR_RCON_INJECTION: ${msg}`);
      }
      throw err;
    }
  }

  /**
   * 解析 serverId 对应的 nodeId（与 commandDispatcher.resolveNodeId 同构）。
   * P0 简化：servers 表无记录或 node_id 缺失时兜底 'node-local'。
   */
  private async resolveNodeId(serverId: string): Promise<string> {
    const row = await this.db<ServerRow>('servers').where({ id: serverId }).first();
    if (!row || !row.node_id) {
      return LOCAL_NODE_FALLBACK;
    }
    return row.node_id;
  }
}

// ----- 工厂 -----

/**
 * 创建 ExecutionEngineClient 实例
 * @param db Knex 实例
 * @param daemonClient DaemonClientImpl 实例（非 DaemonClient 接口，因 executeLogic 未入接口）
 */
export function createExecutionEngineClient(
  db: Knex,
  daemonClient: DaemonClientImpl,
): IExecutionEngine {
  return new ExecutionEngineClientImpl(db, daemonClient);
}
