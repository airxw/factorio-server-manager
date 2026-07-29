/**
 * event-bus.d.ts — eventBus 接口存根
 *
 * 职责：Panel 内部事件总线（基于 EventEmitter），用于业务模块解耦
 * 来源：scheme-final-merged.md §2.1 / §5.4 聊天增强数据流 / §7.1 P1
 */

/** 预定义事件类型常量 */
export declare const CHAT_EVENT: 'chat.event';
export declare const PLAYER_JOIN: 'player.join';
export declare const PLAYER_LEAVE: 'player.leave';
export declare const ORDER_CLAIMED: 'order.claimed';
export declare const CDK_REDEEMED: 'cdk.redeemed';
export declare const VOTE_STARTED: 'vote.started';
export declare const VOTE_THRESHOLD_MET: 'vote.threshold_met';

/** 预定义事件类型联合 */
export type PredefinedEventType =
  | typeof CHAT_EVENT
  | typeof PLAYER_JOIN
  | typeof PLAYER_LEAVE
  | typeof ORDER_CLAIMED
  | typeof CDK_REDEEMED
  | typeof VOTE_STARTED
  | typeof VOTE_THRESHOLD_MET;

export interface EventBus {
  /**
   * 发射事件。同步派发给所有订阅者，异常隔离（一个订阅者抛错不影响其他）。
   * @param eventType 事件类型（可用预定义常量或自定义字符串）
   * @param payload 事件负载
   */
  emit(eventType: string, payload: any): void;

  /**
   * 订阅事件。
   * @returns unsubscribe 函数，调用后取消订阅
   */
  on(eventType: string, callback: (payload: any) => void): () => void;

  /**
   * 取消订阅。需传入与 on 时相同的回调引用。
   */
  off(eventType: string, callback: (payload: any) => void): void;
}
