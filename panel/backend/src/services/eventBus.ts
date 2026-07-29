// ============================================================================
// eventBus — Panel 内部事件总线实现
// 基于 Node.js EventEmitter，异常隔离（一个订阅者抛错不影响其他）
// 接口契约：@public/interface_stub/event-bus.d.ts
// 来源：scheme-final-merged.md §2.1 / §5.4 聊天增强数据流 / §7.1 P1
// ============================================================================

import { EventEmitter } from 'node:events';
import type { EventBus } from '@public/interface_stub/event-bus';

// 预定义事件类型常量（与 event-bus.d.ts 契约对齐）
// 注：.d.ts 中 `export declare const` 仅为类型声明，运行时无值；实现在此提供值
export const CHAT_EVENT = 'chat.event' as const;
export const PLAYER_JOIN = 'player.join' as const;
export const PLAYER_LEAVE = 'player.leave' as const;
export const ORDER_CLAIMED = 'order.claimed' as const;
export const CDK_REDEEMED = 'cdk.redeemed' as const;
export const VOTE_STARTED = 'vote.started' as const;
export const VOTE_THRESHOLD_MET = 'vote.threshold_met' as const;

export type { PredefinedEventType } from '@public/interface_stub/event-bus';

/**
 * Panel 内部事件总线实现
 *
 * 设计要点：
 * - 同步派发：emit 时同步调用所有订阅者（与 .d.ts 契约一致）
 * - 异常隔离：单个订阅者抛错不影响其他订阅者，错误记录到 stderr
 * - 返回 unsubscribe：on() 返回取消订阅函数，避免调用方手动管理 off
 * - 单例导出：全局共享一个 eventBus 实例
 */
export class EventBusImpl implements EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // 业务模块多时避免 MaxListenersExceededWarning
    this.emitter.setMaxListeners(50);
  }

  /**
   * 发射事件。同步派发给所有订阅者，异常隔离。
   * 不使用 emitter.emit 以便在派发循环中捕获每个订阅者的异常。
   */
  emit(eventType: string, payload: any): void {
    // listeners() 返回副本，避免派发过程中订阅者修改监听器列表导致迭代异常
    const listeners = this.emitter.listeners(eventType);
    for (const listener of listeners) {
      try {
        (listener as (payload: any) => void)(payload);
      } catch (err) {
        // 异常隔离：记录错误后继续派发给下一个订阅者
        console.error(`[eventBus] subscriber error on "${eventType}":`, err);
      }
    }
  }

  /**
   * 订阅事件。返回 unsubscribe 函数，调用后取消订阅。
   */
  on(eventType: string, callback: (payload: any) => void): () => void {
    this.emitter.on(eventType, callback);
    return () => {
      this.emitter.off(eventType, callback);
    };
  }

  /**
   * 取消订阅。需传入与 on 时相同的回调引用。
   */
  off(eventType: string, callback: (payload: any) => void): void {
    this.emitter.off(eventType, callback);
  }

  /**
   * 移除某事件类型的全部订阅者（仅用于测试与优雅退出）
   */
  removeAllListeners(eventType?: string): void {
    this.emitter.removeAllListeners(eventType);
  }
}

/** 全局单例事件总线 */
export const eventBus = new EventBusImpl();
