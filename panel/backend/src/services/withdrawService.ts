// ============================================================================
// withdrawService — 提现码管理（withdraw_codes）
// 数据契约：docs/plans/user-center-consolidation-plan.md §4 提现机制
//           §6.1 wallet_transactions（所有变动写入流水）
// 表结构：  withdraw_codes、global_balances（经 balanceService）
//
// 设计要点：
// - 提现码模式：用户申请 → 冻结余额 + 生成 16 位字母数字码 → 管理员线下打款后核销
// - 账期限制：last_income_at + 7 天 <= 当前时间 才允许申请（防资金快进快出）
// - 提现比例快照：ratio 取自 system_config(withdraw.ratio)（默认 0.7），申请时落库防配置变更
// - 核销：解冻→正式扣除（unfreezeAndDebit）+ total_withdrawn 累加 + 流水 type='withdraw'
// - 拒绝/过期：解冻退回 + 流水 type='system'
// - 提现码 30 天未核销自动过期（expireOldWithdrawals 由调度器周期调用）
// ============================================================================

import crypto from 'node:crypto';
import type { Knex } from 'knex';
import {
  InsufficientBalanceError,
  ValidationError,
  WithdrawCodeAlreadyProcessedError,
  WithdrawCodeNotFoundError,
  WithdrawPeriodNotMetError,
} from './errors.js';
import type { BalanceServiceImpl } from './balanceService.js';

// ----- 常量 -----

/** 提现账期（天）：最后一笔收入后需等待的天数 */
const WITHDRAW_PERIOD_DAYS = 7;

/** 提现码有效期（天） */
const WITHDRAW_CODE_TTL_DAYS = 30;

/** 提现比例配置键与默认值 */
const WITHDRAW_RATIO_KEY = 'withdraw.ratio';
const WITHDRAW_RATIO_DEFAULT = 0.7;

// ----- DB 行类型 -----

export type WithdrawStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface WithdrawCodeRow {
  id: number;
  code: string;
  user_id: string;
  amount: number;
  actual_amount: number;
  ratio: number;
  status: WithdrawStatus;
  operator_user_id: string | null;
  approved_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreateWithdrawResult {
  code: string;
  actual_amount: number;
  expires_at: string;
}

export interface WithdrawHistoryPage {
  items: WithdrawCodeRow[];
  total: number;
  page: number;
  page_size: number;
}

// ----- 服务实现 -----

export class WithdrawServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly balanceService: BalanceServiceImpl,
  ) {}

  /**
   * 申请提现：账期校验 + 可用余额校验 → 冻结余额 → 生成提现码。
   *
   * @throws {ValidationError} 金额非正整数
   * @throws {WithdrawPeriodNotMetError} 账期未满（最后一笔收入未满 7 天）
   * @throws {InsufficientBalanceError} 可用余额不足
   */
  async createWithdraw(
    userId: string,
    amount: number,
    traceId?: string,
  ): Promise<CreateWithdrawResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ValidationError(`提现金额必须为正整数: ${amount}`);
    }
    const txTraceId = traceId ?? crypto.randomUUID();

    // 1. 账期检查：last_income_at + 7 天 <= now（无收入记录视为满足，可用余额兜底）
    const balance = await this.balanceService.getBalance(userId);
    if (balance.last_income_at) {
      const periodEnd = new Date(balance.last_income_at).getTime()
        + WITHDRAW_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      if (periodEnd > Date.now()) {
        throw new WithdrawPeriodNotMetError(
          `账期未满：最后一笔收入（${balance.last_income_at}）需满 ${WITHDRAW_PERIOD_DAYS} 天后方可提现`,
        );
      }
    }

    // 2. 可用余额检查（冻结部分不可提现）
    if (balance.available_balance < amount) {
      throw new InsufficientBalanceError(
        `可用余额不足：当前可用 ${balance.available_balance}，申请提现 ${amount}`,
      );
    }

    // 3. 提现比例快照（配置变更不影响存量提现码）
    const ratio = await this.getWithdrawRatio();
    const actualAmount = Math.floor(amount * ratio);

    // 4. 先落提现码记录（拿到 id 供流水关联），再冻结余额；冻结失败补偿删除
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + WITHDRAW_CODE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const inserted = await this.db('withdraw_codes')
      .insert({
        code,
        user_id: userId,
        amount,
        actual_amount: actualAmount,
        ratio,
        status: 'pending',
        operator_user_id: null,
        approved_at: null,
        expires_at: expiresAt,
        created_at: now.toISOString(),
      })
      .returning('id');
    const withdrawCodeId = extractInsertId(inserted);

    try {
      await this.balanceService.freeze(
        userId,
        amount,
        'withdraw',
        '提现申请冻结',
        txTraceId,
        { withdrawCodeId },
      );
    } catch (err) {
      // 补偿：冻结失败删除已创建的提现码记录
      await this.db('withdraw_codes').where({ id: withdrawCodeId }).delete();
      throw err;
    }

    return { code, actual_amount: actualAmount, expires_at: expiresAt };
  }

  /**
   * 管理员核销提现码（确认已线下打款）。
   * 解冻→正式扣除余额，total_withdrawn 累加，流水 type='withdraw'。
   *
   * @throws {WithdrawCodeNotFoundError} 提现码不存在
   * @throws {WithdrawCodeAlreadyProcessedError} 非 pending 状态
   */
  async approveWithdraw(
    code: string,
    operatorUserId: string,
    traceId?: string,
  ): Promise<void> {
    const row = await this.getPendingWithdraw(code);

    await this.balanceService.unfreezeAndDebit(
      row.user_id,
      row.amount,
      'withdraw',
      '提现核销',
      traceId,
      { withdrawCodeId: row.id },
    );
    await this.balanceService.incrementTotalWithdrawn(row.user_id, row.amount);

    await this.db('withdraw_codes')
      .where({ id: row.id })
      .update({
        status: 'approved',
        operator_user_id: operatorUserId,
        approved_at: new Date().toISOString(),
      });
  }

  /**
   * 管理员拒绝提现（解冻退回余额），流水 type='system'。
   *
   * @throws {WithdrawCodeNotFoundError} 提现码不存在
   * @throws {WithdrawCodeAlreadyProcessedError} 非 pending 状态
   */
  async rejectWithdraw(
    code: string,
    operatorUserId: string,
    traceId?: string,
  ): Promise<void> {
    const row = await this.getPendingWithdraw(code);

    await this.balanceService.unfreeze(
      row.user_id,
      row.amount,
      'system',
      '提现已拒绝',
      traceId,
      { withdrawCodeId: row.id },
    );

    await this.db('withdraw_codes')
      .where({ id: row.id })
      .update({ status: 'rejected', operator_user_id: operatorUserId });
  }

  /**
   * 过期提现码自动取消（调度器周期调用）。
   * 扫描 pending 且 expires_at < now 的记录 → 解冻退回 → 标记 expired。
   *
   * @returns { expired } 本次过期的提现码数
   */
  async expireOldWithdrawals(): Promise<{ expired: number }> {
    const nowIso = new Date().toISOString();
    const rows = await this.db<WithdrawCodeRow>('withdraw_codes')
      .where({ status: 'pending' })
      .where('expires_at', '<', nowIso);

    let expired = 0;
    for (const row of rows) {
      await this.balanceService.unfreeze(
        row.user_id,
        row.amount,
        'system',
        '提现码过期自动退回',
        undefined,
        { withdrawCodeId: row.id },
      );
      await this.db('withdraw_codes').where({ id: row.id }).update({ status: 'expired' });
      expired++;
    }
    return { expired };
  }

  /** 用户提现记录（按申请时间倒序分页） */
  async getHistory(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<WithdrawHistoryPage> {
    const { safePage, safePageSize, offset } = normalizePagination(page, pageSize);

    const countRow = await this.db('withdraw_codes')
      .where({ user_id: userId })
      .count('id as cnt')
      .first();
    const items = await this.db<WithdrawCodeRow>('withdraw_codes')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(safePageSize)
      .offset(offset);

    return {
      items,
      total: Number(countRow?.cnt ?? 0),
      page: safePage,
      page_size: safePageSize,
    };
  }

  /** 管理端待审批提现列表（按申请时间升序分页，先申请先处理） */
  async getPendingList(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<WithdrawHistoryPage> {
    const { safePage, safePageSize, offset } = normalizePagination(page, pageSize);

    const countRow = await this.db('withdraw_codes')
      .where({ status: 'pending' })
      .count('id as cnt')
      .first();
    const items = await this.db<WithdrawCodeRow>('withdraw_codes')
      .where({ status: 'pending' })
      .orderBy('created_at', 'asc')
      .limit(safePageSize)
      .offset(offset);

    return {
      items,
      total: Number(countRow?.cnt ?? 0),
      page: safePage,
      page_size: safePageSize,
    };
  }

  // ----- 内部辅助 -----

  /** 查询待处理提现码（不存在/已处理分别抛错） */
  private async getPendingWithdraw(code: string): Promise<WithdrawCodeRow> {
    const row = await this.db<WithdrawCodeRow>('withdraw_codes').where({ code }).first();
    if (!row) {
      throw new WithdrawCodeNotFoundError();
    }
    if (row.status !== 'pending') {
      throw new WithdrawCodeAlreadyProcessedError(
        `提现码已处理（当前状态: ${row.status}），不可重复操作`,
      );
    }
    return row;
  }

  /** 平台提现比例（system_config: withdraw.ratio，默认 0.7，钳制在 (0, 1]） */
  private async getWithdrawRatio(): Promise<number> {
    const row = await this.db<{ key: string; value: string }>('system_config')
      .where({ key: WITHDRAW_RATIO_KEY })
      .first();
    const parsed = Number(row?.value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      return WITHDRAW_RATIO_DEFAULT;
    }
    return parsed;
  }
}

// ----- 工厂 -----

export function createWithdrawService(
  db: Knex,
  balanceService: BalanceServiceImpl,
): WithdrawServiceImpl {
  return new WithdrawServiceImpl(db, balanceService);
}

// ----- 纯函数 -----

/** 生成 16 位字母数字提现码（密码学安全随机） */
function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/** 分页参数归一化（page >= 1, 1 <= pageSize <= 100） */
function normalizePagination(
  page: number,
  pageSize: number,
): { safePage: number; safePageSize: number; offset: number } {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const safePageSize =
    Number.isInteger(pageSize) && pageSize >= 1 ? Math.min(pageSize, 100) : 20;
  return { safePage, safePageSize, offset: (safePage - 1) * safePageSize };
}

/** 从 knex insert(...).returning('id') 结果中提取 ID（兼容 sqlite3 返回形态） */
function extractInsertId(inserted: unknown): number {
  const first = Array.isArray(inserted) ? inserted[0] : inserted;
  if (typeof first === 'object' && first !== null) {
    return Number((first as { id: number }).id);
  }
  return Number(first);
}
