// ============================================================================
// passwordService.ts — 模块3_用户安全：改密服务
//
// 接口契约：@public/interface_stub/user-service.d.ts → updatePassword 方法签名（@version 1.3.0）
// 数据契约：
//   - public/schema/user-schema.json → token_version 字段
//   - public/schema/user_password_history-schema.json → 历史表数据契约
// 来源：s0103 融合定稿 v3.4.0 §互斥点④ A+B+C 全保留
//
// 三层安全校验（顺序不可颠倒，AGENTS.md §1）：
//   Layer 0: 旧密码校验 bcrypt.compare(oldPassword, user.password_hash)
//            不匹配 → InvalidCredentialError (INVALID_CREDENTIAL, 401)
//   Layer 1: zxcvbn 强度校验 score < minZxcvbnScore
//            → PasswordStrengthInsufficientError (AUTH_PWD_002, 400)
//   Layer 2: bcrypt 历史对比，最近 maxHistory 条任一 match
//            → PasswordReusedError (AUTH_PWD_003, 409)
//   Layer 3: token_version +1，使旧 JWT 在下次请求被 authenticateToken 拒绝
//
// 事务保护（AGENTS.md §5）：UPDATE users + INSERT user_password_history 在同一 knex transaction 内
//
// 哈希库：bcryptjs（与 panel/backend 既有依赖一致，async 版本，10 rounds）
// ============================================================================

import bcrypt from 'bcryptjs';
import zxcvbn from 'zxcvbn';
import type { Knex } from 'knex';
import {
  InvalidCredentialError,
  PasswordStrengthInsufficientError,
  PasswordReusedError,
  BuiltInAccountPasswordReadOnlyError,
} from './errors.js';

/** bcrypt 哈希轮数（与 userService.register / login 一致） */
const BCRYPT_ROUNDS = 10;

/** users 表行类型（仅取改密所需字段） */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  token_version: number;
  updated_at: string;
  /** v3.8.0-S8: 上次密码修改时间，改密成功后更新为 NOW() */
  password_changed_at: string | null;
  /** v4.0.2: 系统内置账号标记，1 = 不可改密 */
  is_built_in: number;
}

/** user_password_history 表行类型 */
interface PasswordHistoryRow {
  id: string;
  user_id: string;
  password_hash: string;
  created_at: string;
}

/**
 * 改密服务实现。
 *
 * 通过构造函数注入 db / minZxcvbnScore / maxHistory（共享基础设施注入，
 * 不视为模块内部依赖，符合 AGENTS.md binding_rules）。
 */
export class PasswordServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly minZxcvbnScore: number = 3,
    private readonly maxHistory: number = 5,
  ) {}

  /**
   * 修改当前用户密码（v3.4.0 / user-service 1.3.0）。
   *
   * @returns 新的 token_version（前端可选用新 token 重新登录，或强制下线）
   * @throws {InvalidCredentialError} oldPassword 不匹配当前密码（401）
   * @throws {PasswordStrengthInsufficientError} zxcvbn score 不达标（400）
   * @throws {PasswordReusedError} 新密码命中历史（409）
   */
  async updatePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ tokenVersion: number }> {
    // ----- Layer 0: 取用户 + 旧密码校验 -----
    const user = await this.db<UserRow>('users')
      .select('id', 'email', 'password_hash', 'token_version', 'is_built_in')
      .where({ id: userId })
      .first();
    // 防枚举：用户不存在时同样抛 InvalidCredentialError
    if (!user) {
      throw new InvalidCredentialError();
    }

    const oldMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!oldMatch) {
      throw new InvalidCredentialError();
    }

    // ----- Layer 0.5: v4.0.2 系统内置账号拦截 -----
    //   演示账号（admin/manager/user 三个 *@local.dev）密码不可修改
    //   必须在旧密码校验之后才检查（避免暴露账号是否存在）
    if (user.is_built_in === 1) {
      throw new BuiltInAccountPasswordReadOnlyError(
        `此为系统内置账号（${user.email}），密码不可修改`,
      );
    }

    // ----- Layer 1: zxcvbn 强度校验 -----
    // minZxcvbnScore = 0 时禁用强度校验（仅开发环境，配置契约允许）
    if (this.minZxcvbnScore > 0) {
      const strength = zxcvbn(newPassword);
      if (strength.score < this.minZxcvbnScore) {
        throw new PasswordStrengthInsufficientError(
          `密码强度不足: zxcvbn score ${strength.score} < required ${this.minZxcvbnScore}`,
        );
      }
    }

    // ----- Layer 2: bcrypt 历史对比 -----
    // maxHistory = 0 时禁用历史校验（配置契约允许）
    if (this.maxHistory > 0) {
      const history = await this.db<PasswordHistoryRow>('user_password_history')
        .select('password_hash')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(this.maxHistory);

      for (const row of history) {
        const reused = await bcrypt.compare(newPassword, row.password_hash);
        if (reused) {
          throw new PasswordReusedError();
        }
      }
    }

    // ----- Layer 3: 事务保护 — UPDATE users + INSERT history -----
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date().toISOString();
    const nextTokenVersion = user.token_version + 1;

    await this.db.transaction(async (trx) => {
      // 1. UPDATE users：password_hash + token_version+1 + updated_at + password_changed_at
      //    v3.8.0-S8: 同步更新 password_changed_at 作为 admin.expiry_days 计算基准
      await trx<UserRow>('users').where({ id: userId }).update({
        password_hash: newHash,
        token_version: nextTokenVersion,
        updated_at: now,
        password_changed_at: now,
      });

      // 2. INSERT user_password_history：记录旧密码哈希（旧密码生效时间 = 当前）
      await trx<PasswordHistoryRow>('user_password_history').insert({
        user_id: userId,
        password_hash: user.password_hash,
        created_at: now,
      });

      // 3. 历史条数超限时删除旧行（保留最近 maxHistory 条）
      if (this.maxHistory > 0) {
        // 删除当前用户超出 maxHistory 的旧行（按 created_at 升序删最旧的）
        const overflowRows = await trx<PasswordHistoryRow>('user_password_history')
          .select('id')
          .where({ user_id: userId })
          .orderBy('created_at', 'desc')
          .offset(this.maxHistory)
          .limit(this.maxHistory);

        if (overflowRows.length > 0) {
          const overflowIds = overflowRows.map((r) => r.id);
          await trx<PasswordHistoryRow>('user_password_history')
            .whereIn('id', overflowIds)
            .delete();
        }
      }
    });

    return { tokenVersion: nextTokenVersion };
  }
}

/**
 * 创建改密服务的工厂函数。
 *
 * @param db knex 连接（由 index.ts 装配时注入）
 * @param minZxcvbnScore zxcvbn 最低强度分（默认 3，来自 PASSWORD_MIN_ZXCVBN_SCORE）
 * @param maxHistory 历史密码保留条数（默认 5，来自 PASSWORD_MAX_HISTORY）
 */
export function createPasswordService(
  db: Knex,
  minZxcvbnScore?: number,
  maxHistory?: number,
): PasswordServiceImpl {
  return new PasswordServiceImpl(db, minZxcvbnScore, maxHistory);
}
