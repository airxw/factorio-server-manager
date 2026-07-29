// ============================================================================
// cdkService — CDK 兑换码生成 / 查询 / 删除 / 兑换（两段事务）
// 接口契约：@public/interface_stub/cdk-service.d.ts（如已声明）
// 数据契约：public/schema/cdk-codes-schema.json
// 表结构：  cdk_codes（见 db/migrations/20260703000007_create_cdk_codes.ts）
//           cdk_code_items（见 db/migrations/20260716150000_create_cdk_code_items.ts）
// 来源：scheme-final-merged.md §5.2 CDK + §7.1 P2
//
// v2 礼包逻辑重做：
// - 支持礼包（gift）包含多个物品，通过 cdk_code_items 子表存储
// - createCodes 支持 items 数组（多物品礼包），向后兼容旧 item_name/count/quality
// - redeem 读取 cdk_code_items，为每个物品渲染并发送命令；子表为空时降级用主物品
//
// v5 经济系统扩展（user-center-consolidation-plan.md §5）：
// - cdk_codes 扩展列：type('item'默认/'balance'/'points'/'vip')、amount、vip_duration、
//   creator_user_id、refunded_at、refund_tx_id（migration 20260727000006）
// - createCodes 支持经济类型条目（管理员运营工具，不扣余额）：balance 类型 server_id 存 ''，
//   item_name 存占位文案，count 存 1
// - generateUserCdk：用户自生成 points/vip CDK，冻结余额（points 按兑换比折算，vip 按定价），
//   受单日消费上限约束，7 天有效期；amount 存点券面值/价格，count 列存冻结成本（vip 存 1）
// - redeemEconomic：经济类型兑换两段事务（redeemGlobal 中 type!=='item' 时分派），
//   兑换成功时生成者冻结余额正式核销（unfreezeAndDebit）并按 integral_ratio 发积分
// - refundExpiredCdk：每日扫描过期未兑换的经济 CDK，用户自生成的解冻退费（cdk_refund），
//   管理员生成的仅标记 expired
//
// 设计要点：
// - redeem 采用两段事务：unused → claiming（条件 UPDATE，原子）→
//   命令发送（每个物品一条命令）→ claimed（成功）/ unused（回滚）
// - 命令模板从 Pack.business.cdk.redeem_command 读取，通过 commandDispatcher 渲染并入队
// - createCodes 批量插入，code 未指定则 crypto.randomUUID().slice(0,12).toUpperCase()
// - deleteCode 仅允许删除 unused 状态的码
// ============================================================================

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import type { PackRegistry } from '../core/packs/registry.js';
import type { CommandDispatcher } from '@public/interface_stub/command-dispatcher';
import { bindInstance, isBound } from './instanceBindingService.js';
import type {
  CdkCodeItem,
  CdkCodeSummary,
  CreateCdkCodesRequest,
  RedeemCdkRequest,
} from '@public/schema/panel-api-types';
import {
  CdkNotFoundError,
  CdkAlreadyClaimedError,
  CdkExpiredError,
  PackNotFoundError,
  ValidationError,
  VipPricingNotConfiguredError,
  VipAlreadyActiveError,
  DailyLimitExceededError,
} from './errors.js';
import type { BalanceServiceImpl } from './balanceService.js';
import type { PointsServiceImpl } from './pointsService.js';
import { VIP_THRESHOLDS, type IntegralServiceImpl } from './integralService.js';
import type { PricingServiceImpl } from './pricingService.js';
import type { UserVipStatusRow } from './vipService.js';

// ----- DB 行类型 -----

/** cdk_codes 表行（含 v2 新增 gift_name / gift_description 字段、v5 经济系统扩展列） */
interface CdkCodeRow {
  id: number;
  server_id: string;
  code: string;
  gift_name: string | null;
  gift_description: string | null;
  item_name: string;
  count: number;
  quality: string;
  status: string;
  claimed_player: string | null;
  claimed_at: string | null;
  claiming_at: string | null; // S7-1: 进入 claiming 的时间戳，用于超时回滚
  expires_at: string;
  created_by: string;
  created_at: string;
  // ----- v5 经济系统扩展列（migration 20260727000006） -----
  /** CDK 类型：'item'（默认）/ 'balance' / 'points' / 'vip' */
  type: string;
  /** 金额或点券数量（balance/points 面值；用户自生成 vip 存价格=冻结成本） */
  amount: number | null;
  /** VIP 时长：'monthly' / 'lifetime'（type=vip 时使用） */
  vip_duration: string | null;
  /** 生成者用户 ID（用户自购生成场景；管理员生成为 NULL） */
  creator_user_id: string | null;
  /** 过期退费时间（refundExpiredCdk 扫描后写入） */
  refunded_at: string | null;
  /** 退费关联交易流水 ID（wallet_transactions.id） */
  refund_tx_id: number | null;
}

/** cdk_code_items 子表行 */
interface CdkCodeItemRow {
  id: number;
  cdk_code_id: number;
  item_name: string;
  count: number;
  quality: string;
  sort_order: number;
}

/** servers 表所需字段视图（仅 cdkService 关心的列） */
interface ServerRow {
  id: string;
  pack_id: string;
  game_type?: string;
}

/**
 * v4.17.0: 统一 bindings 表行类型（玩家全局绑定相关字段）。
 * 旧表 player_bindings 已物理删除，数据迁移至 bindings WHERE binding_type='player', scope_type='game_type'。
 * v4.27.0: scope_type 由 'game_type' 改为 'instance'，scope_ref 含义由 game_type 改为 server_id。
 * 字段映射：旧 game_player_name → bindings.player_name，旧 game_type → bindings.scope_ref（v4.27.0: =server_id），旧 status='verified' → bindings.verify_status='verified'。
 * 仅查询 player_name，但声明完整字段以便 knex where 条件类型推断通过。
 */
interface PlayerBindingRowSimple {
  id: number;
  user_id: string;
  binding_type: string;
  scope_type: string;
  scope_ref: string | null;
  player_name: string | null;
  vip_level: number;
  wallet_id: string | null;
  verify_status: string;
  verify_code: string | null;
  verify_expires_at: string | null;
  verified_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** CDK 状态枚举 */
type CdkStatus = 'unused' | 'claiming' | 'claimed' | 'expired';

/** CDK 品质枚举 */
type CdkQuality = 'normal' | 'uncommon' | 'rare' | 'epic' | 'legendary';

const VALID_QUALITIES: ReadonlyArray<CdkQuality> = [
  'normal',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

/** 默认过期天数 */
const DEFAULT_EXPIRES_IN_DAYS = 30;

/** 用户自生成 CDK 有效期（天） */
const USER_GENERATED_EXPIRES_IN_DAYS = 7;

/** 订阅制 VIP 有效期（天） */
const MONTHLY_VIP_DURATION_DAYS = 30;

// ----- v5 经济系统扩展类型 -----

/** CDK 类型枚举 */
export type CdkCodeType = 'item' | 'balance' | 'points' | 'vip';

const VALID_CDK_TYPES: ReadonlyArray<CdkCodeType> = ['item', 'balance', 'points', 'vip'];

/**
 * createCodes 条目扩展字段（v5 经济系统）。
 * 说明：CreateCdkCodesRequest 来自 @public/schema/panel-api-types（public/ 冻结不可修改），
 * 故以交叉类型扩展；新字段由路由层做运行时校验后透传至此。
 */
export interface CreateCdkCodeEntryExt {
  /** CDK 类型，缺省 'item'（向后兼容） */
  type?: CdkCodeType;
  /** 金额或点券数量（balance=余额面值，points=点券面值；vip 可选存价格） */
  amount?: number;
  /** VIP 时长（type=vip 时必填） */
  vip_duration?: 'monthly' | 'lifetime';
}

/** 扩展后的批量创建请求（向后兼容：原 CreateCdkCodesRequest 可直接传入） */
export type CreateCdkCodesRequestExt = Omit<CreateCdkCodesRequest, 'codes'> & {
  codes: Array<CreateCdkCodesRequest['codes'][number] & CreateCdkCodeEntryExt>;
};

/** 用户自生成 CDK 请求（POST /api/cdk/generate） */
export interface GenerateUserCdkRequest {
  type: 'points' | 'vip';
  server_id: string;
  /** 点券面值（type=points 时必填，正整数） */
  amount?: number;
  /** VIP 时长（type=vip 时必填） */
  vip_duration?: 'monthly' | 'lifetime';
}

/** 用户自生成 CDK 返回 */
export interface GenerateUserCdkResult {
  code: string;
  /** 冻结的余额成本 */
  frozen_amount: number;
  expires_at: string;
}

/** cdkService 经济方法依赖（由 services-init 注入；未注入时经济方法抛明确错误） */
export interface CdkEconomicDeps {
  balanceService: BalanceServiceImpl;
  pointsService: PointsServiceImpl;
  integralService: IntegralServiceImpl;
  pricingService: PricingServiceImpl;
}

// ----- 实现 -----

/**
 * CDK 服务实现
 *
 * 设计要点：
 * - createCodes 遍历 req.codes 生成记录，code 缺失则自动生成
 * - 支持 items 数组（多物品礼包），写入 cdk_code_items 子表
 * - redeem 两段事务：条件 UPDATE 抢占 claiming → 逐物品命令发送 → claimed/回滚
 * - commandDispatcher 通过构造函数注入
 */
export class CdkServiceImpl {
  constructor(
    private readonly db: Knex,
    private readonly registry: PackRegistry,
    private readonly commandDispatcher: CommandDispatcher,
    private readonly economicDeps?: CdkEconomicDeps,
  ) {}

  /** 取经济服务依赖；未注入时抛明确错误（item 类型路径不依赖，不受影响） */
  private requireEconomicDeps(): CdkEconomicDeps {
    if (!this.economicDeps) {
      throw new Error(
        'cdkService 未注入经济服务依赖（balanceService/pointsService/integralService/pricingService），经济类型 CDK 功能不可用',
      );
    }
    return this.economicDeps;
  }

  /**
   * 批量创建 CDK 兑换码（管理员）
   *
   * - code 未指定则 crypto.randomUUID().slice(0,12).toUpperCase() 生成
   * - expires_at = now + (req.expires_in_days ?? 30) 天
   * - status='unused', created_by=userId
   * - 支持 items 数组（多物品礼包）：写入 cdk_code_items 子表
   * - 向后兼容：未提供 items 时，使用 item_name/count/quality 作为单物品礼包
   * - v5 经济系统：条目可携带 type/amount/vip_duration。
   *   经济类型（balance/points/vip）为管理员运营工具，不扣余额（审计日志由路由层写入）：
   *   item_name 存占位文案（'余额充值'/'点券充值'/'VIP'），count 存 1，不写子表；
   *   balance 类型 server_id 存空字符串 ''（全局余额不绑定实例）
   */
  async createCodes(
    userId: string,
    serverId: string,
    req: CreateCdkCodesRequestExt,
  ): Promise<CdkCodeSummary[]> {
    if (!Array.isArray(req.codes) || req.codes.length === 0) {
      throw new Error('codes 不能为空');
    }

    // v5 经济系统（方案 §9.1）：CDK 批量生成限流——单次 ≤ 100，同一创建者每日 ≤ 1000
    if (req.codes.length > 100) {
      throw new ValidationError(`单次批量生成不能超过 100 个 CDK（当前 ${req.codes.length} 个）`);
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dailyRow = await this.db('cdk_codes')
      .where('created_by', userId)
      .where('created_at', '>=', dayStart.toISOString())
      .count<{ cnt: number }[]>('* as cnt')
      .first();
    const dailyCount = Number(dailyRow?.cnt ?? 0);
    if (dailyCount + req.codes.length > 1000) {
      throw new ValidationError(
        `每日批量生成上限 1000 个 CDK：今日已生成 ${dailyCount} 个，本次请求 ${req.codes.length} 个`,
      );
    }

    const expiresInDays = req.expires_in_days ?? DEFAULT_EXPIRES_IN_DAYS;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    // 预处理每个 code 条目：解析出 items 列表和主物品字段
    const preparedEntries: Array<{
      codeRow: Omit<CdkCodeRow, 'id'>;
      items: Array<{ item_name: string; count: number; quality: CdkQuality; sort_order: number }>;
    }> = req.codes.map((c) => {
      const code = (c.code ?? randomUUID().slice(0, 12).toUpperCase()).trim();
      if (!code) {
        throw new Error('code 不能为空字符串');
      }

      // v5 经济系统：经济类型条目走独立分支（不解析 items、不校验物品字段）
      const entryType = (c.type ?? 'item') as CdkCodeType;
      if (!VALID_CDK_TYPES.includes(entryType)) {
        throw new ValidationError(`无效 CDK 类型: ${String(c.type)}`);
      }
      if (entryType !== 'item') {
        return { codeRow: buildEconomicCodeRow(entryType, c, serverId, userId, code, expiresAt, nowIso), items: [] };
      }

      // 解析礼包物品列表
      let items: Array<{ item_name: string; count: number; quality: CdkQuality; sort_order: number }>;
      let primaryItemName: string;
      let primaryCount: number;
      let primaryQuality: CdkQuality;

      if (Array.isArray(c.items) && c.items.length > 0) {
        // 多物品礼包：从 items 数组构造
        items = c.items.map((it, idx) => {
          if (!it.item_name || typeof it.item_name !== 'string') {
            throw new Error(`items[${idx}].item_name 无效`);
          }
          if (typeof it.count !== 'number' || it.count <= 0) {
            throw new Error(`items[${idx}].count 必须为正整数: ${it.count}`);
          }
          const quality = (it.quality ?? 'normal') as CdkQuality;
          if (!VALID_QUALITIES.includes(quality)) {
            throw new Error(`items[${idx}].quality 无效: ${quality}`);
          }
          return {
            item_name: it.item_name,
            count: it.count,
            quality,
            sort_order: idx,
          };
        });
        // 主物品字段存第一个物品（向后兼容）
        primaryItemName = items[0].item_name;
        primaryCount = items[0].count;
        primaryQuality = items[0].quality;
      } else {
        // 单物品礼包：使用 item_name/count/quality（向后兼容）
        if (!c.item_name || typeof c.item_name !== 'string') {
          throw new Error('item_name 无效（未提供 items 时必填 item_name）');
        }
        if (typeof c.count !== 'number' || c.count <= 0) {
          throw new Error(`count 必须为正整数: ${c.count}`);
        }
        const quality = (c.quality ?? 'normal') as CdkQuality;
        if (!VALID_QUALITIES.includes(quality)) {
          throw new Error(`quality 无效: ${quality}`);
        }
        primaryItemName = c.item_name;
        primaryCount = c.count;
        primaryQuality = quality;
        items = []; // 单物品礼包不写子表，兑换时降级用主物品
      }

      const codeRow: Omit<CdkCodeRow, 'id'> = {
        server_id: serverId,
        code,
        gift_name: c.gift_name ?? null,
        gift_description: c.gift_description ?? null,
        item_name: primaryItemName,
        count: primaryCount,
        quality: primaryQuality,
        status: 'unused',
        claimed_player: null,
        claimed_at: null,
        claiming_at: null,
        expires_at: expiresAt,
        created_by: userId,
        created_at: nowIso,
        type: 'item',
        amount: null,
        vip_duration: null,
        creator_user_id: null,
        refunded_at: null,
        refund_tx_id: null,
      };

      return { codeRow, items };
    });

    // 批量插入 cdk_codes 并取回记录
    const inserted: unknown = await this.db('cdk_codes')
      .insert(preparedEntries.map((e) => e.codeRow))
      .returning('*');
    const insertedRows: CdkCodeRow[] = Array.isArray(inserted)
      ? (inserted as CdkCodeRow[])
      : [inserted as CdkCodeRow];

    // 为每个多物品礼包写入 cdk_code_items 子表
    for (let i = 0; i < insertedRows.length; i++) {
      const insertedRow = insertedRows[i];
      const items = preparedEntries[i].items;
      if (items.length > 0) {
        const itemRows: Array<Omit<CdkCodeItemRow, 'id'>> = items.map((it) => ({
          cdk_code_id: insertedRow.id,
          item_name: it.item_name,
          count: it.count,
          quality: it.quality,
          sort_order: it.sort_order,
        }));
        await this.db('cdk_code_items').insert(itemRows);
      }
    }

    // 返回时附带 items 子表数据
    const summaries: CdkCodeSummary[] = [];
    for (const row of insertedRows) {
      const items = await this.fetchItems(row.id);
      summaries.push(toSummary(row, items));
    }
    return summaries;
  }

  /**
   * 列出指定 server 的 CDK 兑换码
   */
  async listCodes(
    serverId: string,
    filter?: { status?: CdkStatus },
  ): Promise<CdkCodeSummary[]> {
    const query = this.db<CdkCodeRow>('cdk_codes').where({ server_id: serverId });
    if (filter?.status) {
      void query.where({ status: filter.status });
    }
    const rows = await query.orderBy('created_at', 'desc');

    // 批量查询所有 CDK 的 items 子表数据，避免 N+1 查询
    const ids = rows.map((r) => r.id);
    const allItems: CdkCodeItemRow[] = ids.length > 0
      ? await this.db<CdkCodeItemRow>('cdk_code_items').whereIn('cdk_code_id', ids).orderBy('sort_order', 'asc')
      : [];

    return rows.map((row) => {
      const items = allItems
        .filter((it) => it.cdk_code_id === row.id)
        .map(toItemSummary);
      return toSummary(row, items);
    });
  }

  /**
   * 查询单条 CDK 兑换码
   */
  async getCode(serverId: string, id: number): Promise<CdkCodeSummary> {
    const row = await this.db<CdkCodeRow>('cdk_codes')
      .where({ server_id: serverId, id })
      .first();
    if (!row) {
      throw new CdkNotFoundError(`CDK not found: server=${serverId}, id=${id}`);
    }
    const items = await this.fetchItems(id);
    return toSummary(row, items);
  }

  /**
   * 删除 CDK 兑换码（仅 unused 可删）
   * cdk_code_items 子表通过 ON DELETE CASCADE 自动删除
   */
  async deleteCode(serverId: string, id: number): Promise<void> {
    const row = await this.db<CdkCodeRow>('cdk_codes')
      .where({ server_id: serverId, id })
      .first();
    if (!row) {
      throw new CdkNotFoundError(`CDK not found: server=${serverId}, id=${id}`);
    }
    if (row.status !== 'unused') {
      throw new Error(`仅 unused 状态可删除，当前状态: ${row.status}`);
    }
    await this.db<CdkCodeRow>('cdk_codes').where({ id }).delete();
    // cdk_code_items 通过外键 ON DELETE CASCADE 自动清理
  }

  /**
   * 通过 code 全局查找 CDK（不需要 serverId）
   */
  async findCodeByCode(code: string): Promise<CdkCodeSummary | null> {
    const row = await this.db<CdkCodeRow>('cdk_codes')
      .where({ code: code.trim() })
      .first();
    if (!row) return null;
    const items = await this.fetchItems(row.id);
    return toSummary(row, items);
  }

  /**
   * 全局兑换 CDK —— 通过 code 自动查找 serverId，兑换成功后自动关注实例
   *
   * @param userId 兑换用户ID（用于自动关注实例）
   * @param req 兑换请求（code 必填，player_name 可选；若用户已绑定该实例角色可自动填充）
   */
  async redeemGlobal(
    userId: string,
    req: { code: string; player_name?: string },
  ): Promise<{ code: CdkCodeSummary; delivered: boolean; followed: boolean }> {
    const trimmedCode = (req.code ?? '').trim();
    if (!trimmedCode) {
      throw new Error('code 不能为空');
    }

    // 先通过 code 查找对应的 CDK 记录和 server_id
    const cdkRow = await this.db<CdkCodeRow>('cdk_codes')
      .where({ code: trimmedCode })
      .first();
    if (!cdkRow) {
      throw new CdkNotFoundError(`CDK not found: code=${trimmedCode}`);
    }

    // v5 经济系统：经济类型 CDK（balance/points/vip）分派到 redeemEconomic（player_name 非必填）
    if ((cdkRow.type ?? 'item') !== 'item') {
      const result = await this.redeemEconomic(userId, trimmedCode);
      // balance 类型 server_id 为空字符串（全局余额），无实例可关注
      let followed = false;
      if (cdkRow.server_id) {
        try {
          const alreadyBound = await isBound(userId, cdkRow.server_id);
          if (!alreadyBound) {
            await bindInstance(userId, cdkRow.server_id);
            followed = true;
          }
        } catch {
          // 关注失败不影响兑换结果
        }
      }
      return { ...result, followed };
    }

    const serverId = cdkRow.server_id;

    // 如果没有传 player_name，尝试查找用户在该实例的已验证绑定
    let playerName = (req.player_name ?? '').trim();
    if (!playerName) {
      // v4.27.0: 直接按 scope_type='instance', scope_ref=serverId 查询（不再 JOIN servers 查 game_type）
      // v4.17.0: 查找用户在该实例下的 verified 绑定（统一 bindings 表）
      // 旧 player_bindings.status='verified' ↔ bindings.verify_status='verified'
      const binding = await this.db<PlayerBindingRowSimple>('bindings')
        .where({
          binding_type: 'player',
          scope_type: 'instance',
          user_id: userId,
          verify_status: 'verified',
          scope_ref: serverId,
        })
        .first();
      if (binding) {
        // binding.player_name 在 verify_status='verified' 时一定非 null，但类型上为 string | null，用 ?? '' 兜底
        playerName = binding.player_name ?? '';
      }
    }

    if (!playerName) {
      throw new Error('请输入游戏角色名，或先绑定游戏角色');
    }

    // 调用原有兑换逻辑
    const result = await this.redeem(serverId, { code: trimmedCode, player_name: playerName });

    // 兑换成功后，自动关注该实例（幂等操作）
    let followed = false;
    try {
      const alreadyBound = await isBound(userId, serverId);
      if (!alreadyBound) {
        await bindInstance(userId, serverId);
        followed = true;
      }
    } catch {
      // 关注失败不影响兑换结果
    }

    return { ...result, followed };
  }

  /**
   * 兑换 CDK —— 两段事务实现（v2 支持多物品礼包）
   *
   * 流程：
   *   1. 条件 UPDATE 抢占 claiming（unused → claiming，需 expires_at > now）
   *      影响行数 0 → 查当前状态抛对应错误
   *   2. 读取 cdk_code_items 子表（若为空，降级用主物品 item_name/count/quality）
   *   3. 为每个物品渲染 redeem_command 并入队命令队列
   *      任一物品渲染/入队失败 → 回滚 status='unused'，抛错
   *   4. 成功 → UPDATE status='claimed', claimed_at=now, claimed_player=?
   *   5. 返回 {code, delivered: true}
   */
  async redeem(
    serverId: string,
    req: RedeemCdkRequest,
  ): Promise<{ code: CdkCodeSummary; delivered: boolean }> {
    const code = (req.code ?? '').trim();
    const player = (req.player_name ?? '').trim();
    if (!code) {
      throw new Error('code 不能为空');
    }
    if (!player) {
      throw new Error('player_name 不能为空');
    }

    const nowIso = new Date().toISOString();

    // ---- 第一段：条件 UPDATE 抢占 claiming ----
    let claimedRow: CdkCodeRow | undefined;
    await this.db.transaction(async (trx) => {
      const updated = await trx<CdkCodeRow>('cdk_codes')
        .where({
          code,
          server_id: serverId,
          status: 'unused',
        })
        .where('expires_at', '>', nowIso)
        .update({ status: 'claiming', claiming_at: nowIso });

      if (updated === 0) {
        const row = await trx<CdkCodeRow>('cdk_codes')
          .where({ code, server_id: serverId })
          .first();
        if (!row) {
          throw new CdkNotFoundError(`CDK not found: code=${code}, server=${serverId}`);
        }
        if (row.status === 'claiming' || row.status === 'claimed') {
          throw new CdkAlreadyClaimedError(
            `CDK already claimed: code=${code}, status=${row.status}`,
          );
        }
        throw new CdkExpiredError(`CDK expired: code=${code}, status=${row.status}`);
      }

      claimedRow = await trx<CdkCodeRow>('cdk_codes')
        .where({ code, server_id: serverId })
        .first();
    });

    if (!claimedRow) {
      throw new CdkNotFoundError(`CDK not found after claiming: code=${code}`);
    }

    const cdkRow = claimedRow;

    // ---- 第二段：读取物品列表 + 逐物品命令渲染 + 发送 ----
    // 优先使用 cdk_code_items 子表（多物品礼包）；为空时降级用主物品（单物品礼包）
    const itemRows = await this.fetchItems(cdkRow.id);
    const itemsToDeliver: Array<{ item_name: string; count: number; quality: string }> =
      itemRows.length > 0
        ? itemRows.map((it) => ({
            item_name: it.item_name,
            count: it.count,
            quality: it.quality,
          }))
        : [{
            item_name: cdkRow.item_name,
            count: cdkRow.count,
            quality: cdkRow.quality,
          }];

    // 渲染并发送每个物品的命令
    const renderedCommands: string[] = [];
    try {
      for (const item of itemsToDeliver) {
        const cmd = await this.renderRedeemCommand(serverId, item, player);
        renderedCommands.push(cmd);
      }
    } catch (err) {
      // 渲染失败 → 回滚 unused
      await this.rollbackToUnused(cdkRow.id);
      throw err;
    }

    // 逐条入队命令队列
    try {
      for (const cmd of renderedCommands) {
        await this.commandDispatcher.enqueue(serverId, cmd, 'normal');
      }
    } catch (err) {
      // 入队失败 → 回滚 unused，透传 CommandQueueFullError
      await this.rollbackToUnused(cdkRow.id);
      throw err;
    }

    // ---- 第三段：标记 claimed ----
    await this.db<CdkCodeRow>('cdk_codes')
      .where({ id: cdkRow.id })
      .update({
        status: 'claimed',
        claimed_at: nowIso,
        claimed_player: player,
        claiming_at: null,
      });

    const finalRow = await this.db<CdkCodeRow>('cdk_codes')
      .where({ id: cdkRow.id })
      .first();
    if (!finalRow) {
      throw new CdkNotFoundError(`CDK disappeared after claiming: id=${cdkRow.id}`);
    }

    const finalItems = await this.fetchItems(cdkRow.id);
    return { code: toSummary(finalRow, finalItems), delivered: true };
  }

  /**
   * 用户自生成 CDK（v5 经济系统，仅 points/vip 类型）—— POST /api/cdk/generate
   *
   * 流程：
   *   1. 校验类型/参数，读取实例定价
   *      - points：amount=点券面值（正整数），冻结成本 = ceil(amount ÷ points_exchange_ratio)
   *      - vip：按 vip_duration 取实例定价（NULL → VipPricingNotConfiguredError），冻结成本=价格
   *   2. 单日消费上限校验（dailyMax = pricing.daily_consumption_limit ?? 平台上限）
   *   3. 落库 CDK 行（expires_at = now + 7 天，creator_user_id=生成者）
   *      - points：amount 存点券面值，count 列存冻结成本（经济类型 count 无物品语义）
   *      - vip：amount 存价格（=冻结成本），count 存 1
   *   4. 冻结余额（流水 type='cdk_generate'，opts.cdkId=新CDK id）——不发积分
   *      冻结失败时删除已落库 CDK 行后透传错误
   *
   * @returns { code, frozen_amount, expires_at }
   */
  async generateUserCdk(
    userId: string,
    req: GenerateUserCdkRequest,
  ): Promise<GenerateUserCdkResult> {
    const deps = this.requireEconomicDeps();

    const serverId = (req.server_id ?? '').trim();
    if (!serverId) {
      throw new ValidationError('server_id 不能为空');
    }
    if (req.type !== 'points' && req.type !== 'vip') {
      throw new ValidationError(`用户自生成 CDK 仅支持 points/vip 类型: ${String(req.type)}`);
    }

    const pricing = await deps.pricingService.getPricing(serverId);

    let amount: number;
    let frozenCost: number;
    let count: number;
    let vipDuration: string | null = null;
    let itemName: string;
    let freezeDescription: string;

    if (req.type === 'points') {
      if (!Number.isInteger(req.amount) || (req.amount as number) <= 0) {
        throw new ValidationError(`amount 必须为正整数（点券面值）: ${String(req.amount)}`);
      }
      amount = req.amount as number;
      frozenCost = Math.ceil(amount / pricing.points_exchange_ratio);
      count = frozenCost; // count 列存冻结成本（兑换时生成者核销取此列）
      itemName = '点券充值';
      freezeDescription = `生成CDK点券（面值${amount}点券，冻结${frozenCost}余额）`;
    } else {
      if (req.vip_duration !== 'monthly' && req.vip_duration !== 'lifetime') {
        throw new ValidationError(`vip_duration 必须为 monthly/lifetime: ${String(req.vip_duration)}`);
      }
      vipDuration = req.vip_duration;
      const price = vipDuration === 'monthly' ? pricing.vip_monthly_price : pricing.vip_lifetime_price;
      if (price === null || price === undefined) {
        throw new VipPricingNotConfiguredError(
          vipDuration === 'monthly' ? '该实例未开放订阅制 VIP' : '该实例未开放买断制 VIP',
        );
      }
      amount = price;
      frozenCost = price;
      count = 1;
      itemName = 'VIP';
      freezeDescription = `生成CDK VIP（${vipDuration}，冻结${price}余额）`;
    }

    // 单日消费上限校验（本次冻结金额计入）
    const dailyMax = pricing.daily_consumption_limit ?? (await deps.pricingService.getPlatformDailyMax());
    const limit = await deps.balanceService.checkDailyLimit(userId, frozenCost, dailyMax);
    if (!limit.allowed) {
      throw new DailyLimitExceededError(
        `超出单日消费上限：今日已消费 ${limit.today_spent}，本次 ${frozenCost}，上限 ${dailyMax}`,
      );
    }

    // 落库 CDK 行（7 天有效期）
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + USER_GENERATED_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const code = randomUUID().slice(0, 12).toUpperCase();
    const inserted: unknown = await this.db('cdk_codes')
      .insert({
        server_id: serverId,
        code,
        gift_name: null,
        gift_description: null,
        item_name: itemName,
        count,
        quality: 'normal',
        status: 'unused',
        claimed_player: null,
        claimed_at: null,
        claiming_at: null,
        expires_at: expiresAt,
        created_by: userId,
        created_at: nowIso,
        type: req.type,
        amount,
        vip_duration: vipDuration,
        creator_user_id: userId,
        refunded_at: null,
        refund_tx_id: null,
      })
      .returning('id');
    const cdkId = extractInsertId(inserted);

    // 冻结余额（流水 type='cdk_generate'，关联 cdkId）；失败时清理已落库行
    const traceId = randomUUID();
    try {
      await deps.balanceService.freeze(userId, frozenCost, 'cdk_generate', freezeDescription, traceId, {
        cdkId,
      });
    } catch (err) {
      await this.db('cdk_codes').where({ id: cdkId }).delete().catch(() => { /* 清理失败不掩盖原始错误 */ });
      throw err;
    }

    return { code, frozen_amount: frozenCost, expires_at: expiresAt };
  }

  /**
   * 兑换经济类型 CDK（v5 经济系统）—— 由 redeemGlobal 在 type!=='item' 时分派
   *
   * 两段事务：
   *   1. 条件 UPDATE 抢占 claiming（unused → claiming，需 expires_at > now）
   *   2. 按类型发放权益：
   *      - balance：balanceService.credit(兑换者, amount, 'cdk_recharge', {cdkId})
   *      - points：pointsService.credit(兑换者, server_id, amount, 'cdk_recharge')
   *      - vip：当前无有效 VIP 才 upsert user_vip_status（monthly=now+30天 / lifetime=null），
   *        并赠送 VIP1 门槛积分（integral_earn）；已有有效 VIP → VipAlreadyActiveError 回滚
   *   3. 生成者核销（creator_user_id 非空时）：冻结成本正式扣除
   *      （unfreezeAndDebit，流水 type='cdk_redeem'），并按 冻结成本×integral_ratio 给生成者发积分。
   *      冻结成本：points 类型取 count 列，vip 类型取 amount 列（=价格）
   *   4. 成功 → status='claimed', claimed_at=now, claimed_player=兑换用户名
   *   任一步失败 → 回滚 status='unused' 并抛错
   */
  async redeemEconomic(
    userId: string,
    code: string,
  ): Promise<{ code: CdkCodeSummary; delivered: boolean }> {
    const deps = this.requireEconomicDeps();
    const trimmedCode = (code ?? '').trim();
    if (!trimmedCode) {
      throw new ValidationError('code 不能为空');
    }

    const nowIso = new Date().toISOString();

    // ---- 第一段：条件 UPDATE 抢占 claiming ----
    let claimedRow: CdkCodeRow | undefined;
    await this.db.transaction(async (trx) => {
      const updated = await trx<CdkCodeRow>('cdk_codes')
        .where({ code: trimmedCode, status: 'unused' })
        .where('expires_at', '>', nowIso)
        .update({ status: 'claiming', claiming_at: nowIso });

      if (updated === 0) {
        const row = await trx<CdkCodeRow>('cdk_codes')
          .where({ code: trimmedCode })
          .first();
        if (!row) {
          throw new CdkNotFoundError(`CDK not found: code=${trimmedCode}`);
        }
        if (row.status === 'claiming' || row.status === 'claimed') {
          throw new CdkAlreadyClaimedError(
            `CDK already claimed: code=${trimmedCode}, status=${row.status}`,
          );
        }
        throw new CdkExpiredError(`CDK expired: code=${trimmedCode}, status=${row.status}`);
      }

      claimedRow = await trx<CdkCodeRow>('cdk_codes')
        .where({ code: trimmedCode })
        .first();
    });

    if (!claimedRow) {
      throw new CdkNotFoundError(`CDK not found after claiming: code=${trimmedCode}`);
    }
    const cdkRow = claimedRow;
    const traceId = randomUUID();

    try {
      // ---- 第二段：按类型发放权益 ----
      if (cdkRow.type === 'balance') {
        const amount = cdkRow.amount ?? 0;
        if (amount <= 0) {
          throw new ValidationError(`CDK 余额面值无效: id=${cdkRow.id}`);
        }
        await deps.balanceService.credit(
          userId,
          amount,
          'cdk_recharge',
          'CDK余额充值',
          null,
          traceId,
          { cdkId: cdkRow.id },
        );
      } else if (cdkRow.type === 'points') {
        const amount = cdkRow.amount ?? 0;
        if (amount <= 0) {
          throw new ValidationError(`CDK 点券面值无效: id=${cdkRow.id}`);
        }
        await deps.pointsService.credit(
          userId,
          cdkRow.server_id,
          amount,
          'cdk_recharge',
          'CDK点券充值',
          null,
          traceId,
        );
      } else if (cdkRow.type === 'vip') {
        const duration = cdkRow.vip_duration;
        if (duration !== 'monthly' && duration !== 'lifetime') {
          throw new ValidationError(`CDK vip_duration 无效: id=${cdkRow.id}, duration=${String(duration)}`);
        }
        // 已有有效 VIP → 抛错（外层回滚 claiming→unused）
        const existingVip = await this.db<UserVipStatusRow>('user_vip_status')
          .where({ user_id: userId, server_id: cdkRow.server_id })
          .first();
        if (existingVip && isVipRowActive(existingVip)) {
          throw new VipAlreadyActiveError('已拥有有效的 VIP，无法兑换该 CDK');
        }
        const vipExpiresAt =
          duration === 'monthly'
            ? new Date(Date.now() + MONTHLY_VIP_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString()
            : null;
        await this.db('user_vip_status')
          .insert({
            user_id: userId,
            server_id: cdkRow.server_id,
            vip_type: duration,
            vip_expires_at: vipExpiresAt,
            purchased_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .onConflict(['user_id', 'server_id'])
          .merge({
            vip_type: duration,
            vip_expires_at: vipExpiresAt,
            purchased_at: nowIso,
            updated_at: nowIso,
          });
        // 赠送 VIP1 门槛积分
        await deps.integralService.addIntegral(
          userId,
          cdkRow.server_id,
          VIP_THRESHOLDS[1].min,
          'integral_earn',
          'CDK兑换VIP门槛积分',
          traceId,
        );
      } else {
        throw new ValidationError(`非经济类型 CDK: type=${cdkRow.type}, id=${cdkRow.id}`);
      }

      // ---- 第三段：生成者冻结余额核销 + 消费积分（用户自生成场景） ----
      if (cdkRow.creator_user_id) {
        // 冻结成本：points 类型存 count 列，vip 类型存 amount 列（=价格）
        const frozenCost = cdkRow.type === 'points' ? cdkRow.count : (cdkRow.amount ?? 0);
        if (frozenCost > 0) {
          await deps.balanceService.unfreezeAndDebit(
            cdkRow.creator_user_id,
            frozenCost,
            'cdk_redeem',
            'CDK已被兑换',
            traceId,
            { cdkId: cdkRow.id },
          );
          const creatorPricing = await deps.pricingService.getPricing(cdkRow.server_id);
          const creatorIntegral = Math.round(frozenCost * creatorPricing.integral_ratio);
          if (creatorIntegral > 0) {
            await deps.integralService.addIntegral(
              cdkRow.creator_user_id,
              cdkRow.server_id,
              creatorIntegral,
              'integral_earn',
              'CDK被兑换消费积分',
              traceId,
            );
          }
        }
      }
    } catch (err) {
      // 任一步失败 → 回滚 unused
      await this.rollbackToUnused(cdkRow.id);
      throw err;
    }

    // ---- 第四段：标记 claimed（claimed_player=兑换用户名，查不到回退 userId） ----
    const claimedPlayer = await this.resolveUsername(userId);
    await this.db<CdkCodeRow>('cdk_codes')
      .where({ id: cdkRow.id })
      .update({
        status: 'claimed',
        claimed_at: nowIso,
        claimed_player: claimedPlayer,
        claiming_at: null,
      });

    const finalRow = await this.db<CdkCodeRow>('cdk_codes')
      .where({ id: cdkRow.id })
      .first();
    if (!finalRow) {
      throw new CdkNotFoundError(`CDK disappeared after claiming: id=${cdkRow.id}`);
    }

    const finalItems = await this.fetchItems(cdkRow.id);
    return { code: toSummary(finalRow, finalItems), delivered: true };
  }

  /**
   * 过期经济 CDK 退费扫描（v5 经济系统，调度器每日调用）
   *
   * 扫描 cdk_codes WHERE type != 'item' AND status='unused' AND refunded_at IS NULL
   *   AND expires_at < now：
   * - creator_user_id 非空（用户自生成）：解冻冻结成本（unfreeze，流水 type='cdk_refund'），
   *   更新 refunded_at / refund_tx_id / status='expired'
   * - creator_user_id 为空（管理员生成）：无冻结可退，仅标记 status='expired'
   *
   * 冻结成本：points 类型取 count 列，其余取 amount 列
   * 单行失败不阻断整批（与 rollbackStaleClaiming 一致的容错风格）
   *
   * @returns { refunded } 本次处理的记录数
   */
  async refundExpiredCdk(): Promise<{ refunded: number }> {
    const deps = this.requireEconomicDeps();
    const nowIso = new Date().toISOString();
    const rows = await this.db<CdkCodeRow>('cdk_codes')
      .whereNot('type', 'item')
      .where({ status: 'unused' })
      .whereNull('refunded_at')
      .where('expires_at', '<', nowIso);

    let refunded = 0;
    for (const row of rows) {
      try {
        if (row.creator_user_id) {
          const frozenCost = row.type === 'points' ? row.count : (row.amount ?? 0);
          if (frozenCost > 0) {
            const txId = await deps.balanceService.unfreeze(
              row.creator_user_id,
              frozenCost,
              'cdk_refund',
              'CDK过期自动退费',
              undefined,
              { cdkId: row.id },
            );
            await this.db<CdkCodeRow>('cdk_codes')
              .where({ id: row.id })
              .update({ refunded_at: nowIso, refund_tx_id: txId, status: 'expired' });
          } else {
            await this.db<CdkCodeRow>('cdk_codes')
              .where({ id: row.id })
              .update({ refunded_at: nowIso, status: 'expired' });
          }
        } else {
          // 管理员生成：无冻结可退，仅标记 expired
          await this.db<CdkCodeRow>('cdk_codes')
            .where({ id: row.id })
            .update({ status: 'expired' });
        }
        refunded++;
      } catch {
        // 单行失败不阻断整批扫描（生产环境应加日志，与 rollbackToUnused 容错风格一致）
      }
    }
    return { refunded };
  }

  // ----- 内部辅助 -----

  /**
   * 读取指定 CDK 的物品列表（来自 cdk_code_items 子表）
   * 按 sort_order 升序排列
   */
  private async fetchItems(cdkCodeId: number): Promise<CdkCodeItem[]> {
    const rows = await this.db<CdkCodeItemRow>('cdk_code_items')
      .where({ cdk_code_id: cdkCodeId })
      .orderBy('sort_order', 'asc');
    return rows.map(toItemSummary);
  }

  /**
   * 渲染 redeem 命令模板（单个物品）
   * - 从 servers 表查 pack_id
   * - 从 registry 获取 pack.business.cdk.redeem_command
   * - 通过 commandDispatcher.renderCommand 渲染变量（player/item/count/quality）
   */
  private async renderRedeemCommand(
    serverId: string,
    item: { item_name: string; count: number; quality: string },
    player: string,
  ): Promise<string> {
    const serverRow = await this.db<ServerRow>('servers')
      .where({ id: serverId })
      .first();
    if (!serverRow) {
      throw new PackNotFoundError(`Server pack not found: server=${serverId}`);
    }

    const pack = this.registry.get(serverRow.pack_id);
    if (!pack) {
      throw new PackNotFoundError(`Pack not found: ${serverRow.pack_id}`);
    }

    const cdkConfig = pack.business?.cdk;
    if (!cdkConfig || !cdkConfig.enabled) {
      throw new Error(`Pack ${serverRow.pack_id} CDK business disabled`);
    }
    const template = cdkConfig.redeem_command;
    if (!template) {
      throw new Error(
        `Pack ${serverRow.pack_id} business.cdk.redeem_command 未配置`,
      );
    }

    // 渲染变量：player/item/count/quality
    return this.commandDispatcher.renderCommand(template, {
      player,
      item: item.item_name,
      count: String(item.count),
      quality: item.quality,
    });
  }

  /**
   * 查询用户名（经济类型兑换成功时写 claimed_player；查不到回退 userId）
   */
  private async resolveUsername(userId: string): Promise<string> {
    const row = await this.db<{ id: string; username: string }>('users')
      .where({ id: userId })
      .first();
    return row?.username ?? userId;
  }

  /**
   * 回滚 CDK 状态到 unused（命令发送/入队失败时调用）
   */
  private async rollbackToUnused(cdkId: number): Promise<void> {
    try {
      await this.db<CdkCodeRow>('cdk_codes')
        .where({ id: cdkId, status: 'claiming' })
        .update({ status: 'unused', claiming_at: null });
    } catch {
      // 回滚失败不掩盖原始错误，仅记录（生产环境应加日志）
    }
  }

  /**
   * 回滚超时未完成的 claiming 记录（S7-1 实现）
   *
   * 由 OPTIMISTIC_LOCK_TIMEOUT_SCAN 周期任务调用：
   *   - 查询 status='claiming' 且 claiming_at < (now - timeoutMs) 的记录
   *   - 批量回滚为 status='unused'，清空 claiming_at
   *
   * @param timeoutMs 超时阈值（毫秒），默认 5 分钟
   * @returns 回滚的记录数
   */
  async rollbackStaleClaiming(timeoutMs: number = 5 * 60 * 1000): Promise<number> {
    const cutoffIso = new Date(Date.now() - timeoutMs).toISOString();
    const updated = await this.db<CdkCodeRow>('cdk_codes')
      .where({ status: 'claiming' })
      .where('claiming_at', '<', cutoffIso)
      .update({ status: 'unused', claiming_at: null });
    return updated;
  }
}

// ----- 纯函数 / 转换函数 -----

/**
 * 构造经济类型 CDK 行（管理员生成，createCodes 经济条目分支）。
 * 规则（user-center-consolidation-plan.md §5）：
 * - balance/points：amount 必填正整数（余额/点券面值）；vip：vip_duration 必填，amount 可选存价格
 * - item_name 存占位文案（'余额充值'/'点券充值'/'VIP'），count 存 1，quality='normal'
 * - balance 类型 server_id 存空字符串 ''（全局余额不绑定实例）
 * - creator_user_id=null（管理员生成非用户自购，无冻结/退费语义）
 */
function buildEconomicCodeRow(
  entryType: Exclude<CdkCodeType, 'item'>,
  c: CreateCdkCodesRequest['codes'][number] & CreateCdkCodeEntryExt,
  serverId: string,
  userId: string,
  code: string,
  expiresAt: string,
  nowIso: string,
): Omit<CdkCodeRow, 'id'> {
  if (entryType === 'vip') {
    if (c.vip_duration !== 'monthly' && c.vip_duration !== 'lifetime') {
      throw new ValidationError('vip 类型必须提供 vip_duration（monthly/lifetime）');
    }
    if (c.amount !== undefined && (!Number.isInteger(c.amount) || c.amount <= 0)) {
      throw new ValidationError(`vip 类型 amount 必须为正整数（价格）: ${String(c.amount)}`);
    }
  } else if (!Number.isInteger(c.amount) || (c.amount as number) <= 0) {
    throw new ValidationError(`${entryType} 类型必须提供正整数 amount: ${String(c.amount)}`);
  }

  const placeholderName =
    entryType === 'balance' ? '余额充值' : entryType === 'points' ? '点券充值' : 'VIP';

  return {
    server_id: entryType === 'balance' ? '' : serverId,
    code,
    gift_name: c.gift_name ?? null,
    gift_description: c.gift_description ?? null,
    item_name: placeholderName,
    count: 1,
    quality: 'normal',
    status: 'unused',
    claimed_player: null,
    claimed_at: null,
    claiming_at: null,
    expires_at: expiresAt,
    created_by: userId,
    created_at: nowIso,
    type: entryType,
    amount: entryType === 'vip' ? (c.amount ?? null) : (c.amount as number),
    vip_duration: entryType === 'vip' ? (c.vip_duration as 'monthly' | 'lifetime') : null,
    creator_user_id: null,
    refunded_at: null,
    refund_tx_id: null,
  };
}

/** VIP 权益资格是否有效（lifetime 恒有效；monthly 需未过期）——与 vipService.isVipActive 同口径 */
function isVipRowActive(row: UserVipStatusRow): boolean {
  if (row.vip_type === 'lifetime') return true;
  if (row.vip_type === 'monthly') {
    return row.vip_expires_at !== null && new Date(row.vip_expires_at).getTime() > Date.now();
  }
  return false;
}

/** 从 knex insert(...).returning('id') 结果中提取 ID（兼容 sqlite3 返回形态） */
function extractInsertId(inserted: unknown): number {
  const first = Array.isArray(inserted) ? inserted[0] : inserted;
  if (typeof first === 'object' && first !== null) {
    return Number((first as { id: number }).id);
  }
  return Number(first);
}

/** cdk_code_items 子表行 → CdkCodeItem */
function toItemSummary(row: CdkCodeItemRow): CdkCodeItem {
  return {
    item_name: row.item_name,
    count: row.count,
    quality: row.quality as CdkQuality,
    sort_order: row.sort_order,
  };
}

/** DB 行 + items 子表数据 → CdkCodeSummary（status / quality 收窄为联合类型） */
function toSummary(row: CdkCodeRow, items: CdkCodeItem[]): CdkCodeSummary {
  return {
    id: row.id,
    server_id: row.server_id,
    code: row.code,
    gift_name: row.gift_name,
    gift_description: row.gift_description,
    item_name: row.item_name,
    count: row.count,
    quality: row.quality as CdkQuality,
    items,
    status: row.status as CdkStatus,
    claimed_player: row.claimed_player,
    claimed_at: row.claimed_at,
    expires_at: row.expires_at,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

// ----- 工厂 -----

/**
 * 创建 cdkService 实例
 * @param economicDeps v5 经济系统依赖（可选；未注入时 generateUserCdk/redeemEconomic/refundExpiredCdk 抛明确错误）
 */
export function createCdkService(
  db: Knex,
  registry: PackRegistry,
  commandDispatcher: CommandDispatcher,
  economicDeps?: CdkEconomicDeps,
): CdkServiceImpl {
  return new CdkServiceImpl(db, registry, commandDispatcher, economicDeps);
}
