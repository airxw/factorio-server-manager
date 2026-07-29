// ============================================================================
// errors.ts — 运行时错误类
//
// 与 @public/interface_stub/shared-types.d.ts 中的错误类声明对齐：
//   - 所有错误继承 Error，含 code 字段
//   - code 与 error-codes-schema.json predefined_codes 对齐
//
// 说明：shared-types.d.ts 仅是类型声明（.d.ts），无运行时实现。
// 本文件提供可被 throw / instanceof 使用的运行时类。
//
// 注：本文件为多模块共享（vipService / userService 等），新增错误类请追加于此。
// ============================================================================

/**
 * 应用错误基类（对应 shared-types.d.ts AppError）。
 * 含 code 字段，与 error-codes-schema.json 错误码对齐。
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly category?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;

  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

// ----- 用户域 -----
export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND';
  constructor(message = '用户不存在') {
    super(message);
  }
}

/**
 * 通用参数校验错误（D9: 路径穿越防护 / D10: 命令注入防护使用）。
 * code = PANEL_VALIDATION_ERROR，httpStatus = 400。
 */
export class ValidationError extends AppError {
  readonly code = 'PANEL_VALIDATION_ERROR';
  readonly httpStatus = 400;
  constructor(message = '参数校验失败') {
    super(message);
  }
}

export class UserAlreadyExistsError extends AppError {
  readonly code = 'USER_ALREADY_EXISTS';
  constructor(message = '用户已存在') {
    super(message);
  }
}

export class InvalidCredentialError extends AppError {
  readonly code = 'INVALID_CREDENTIAL';
  constructor(message = '邮箱或密码错误') {
    super(message);
  }
}

/**
 * 密码强度不足错误（v3.4.0 / user-service 1.3.0 新增）。
 * code = AUTH_PWD_002 (error-codes-schema.json: http_status=400, category=auth, retryable=false)
 * 触发场景：zxcvbn(newPassword).score < auth.password_policy.min_zxcvbn_score（默认 3）
 */
export class PasswordStrengthInsufficientError extends AppError {
  readonly code = 'AUTH_PWD_002';
  readonly category = 'auth';
  readonly httpStatus = 400;
  constructor(message = '密码强度不足') {
    super(message);
  }
}

/**
 * 密码历史重用错误（v3.4.0 / user-service 1.3.0 新增）。
 * code = AUTH_PWD_003 (error-codes-schema.json: http_status=409, category=auth, retryable=false)
 * 触发场景：新密码命中最近 max_history 条历史密码（bcrypt.compare 命中）
 */
export class PasswordReusedError extends AppError {
  readonly code = 'AUTH_PWD_003';
  readonly category = 'auth';
  readonly httpStatus = 409;
  constructor(message = '新密码与最近使用的历史密码重复') {
    super(message);
  }
}

export class VerifyCodeInvalidError extends AppError {
  readonly code = 'VERIFY_CODE_INVALID';
  constructor(message = '验证码无效或已过期') {
    super(message);
  }
}

// ----- VIP 域 -----
export class VipPermissionNotFoundError extends AppError {
  readonly code = 'VIP_PERMISSION_NOT_FOUND';
}

export class VipLevelInsufficientError extends AppError {
  readonly code = 'VIP_LEVEL_INSUFFICIENT';
}

// ----- 命令域 -----
export class CommandRenderError extends AppError {
  readonly code = 'COMMAND_RENDER_FAILED';
  constructor(message = '命令模板渲染失败：变量值不合法') {
    super(message);
  }
}

export class CommandQueueFullError extends AppError {
  readonly code = 'COMMAND_QUEUE_FULL';
  constructor(message = '命令队列已满') {
    super(message);
  }
}

// ----- Daemon / 实例域 -----
export class DaemonUnreachableError extends AppError {
  readonly code = 'DAEMON_UNREACHABLE';
  constructor(message = 'Daemon 不可达') {
    super(message);
  }
}

export class InstanceNotFoundError extends AppError {
  readonly code = 'INSTANCE_NOT_FOUND';
  constructor(message = '实例不存在') {
    super(message);
  }
}

export class InstanceNotRunningError extends AppError {
  readonly code = 'INSTANCE_NOT_RUNNING';
  constructor(message = '实例未运行，命令无法发送') {
    super(message);
  }
}

// ----- Pack 域 -----
export class PackNotFoundError extends AppError {
  readonly code = 'PACK_NOT_FOUND';
  constructor(message = 'Pack 不存在') {
    super(message);
  }
}

// ----- 物品同步域 -----
export class ItemSyncFailedError extends AppError {
  readonly code = 'ITEM_SYNC_FAILED';
  constructor(message = '物品同步失败') {
    super(message);
  }
}

// ----- 商店域（P2） -----
export class ShopItemNotFoundError extends AppError {
  readonly code = 'SHOP_ITEM_NOT_FOUND';
  constructor(message = '商店物品不存在或已下架') {
    super(message);
  }
}

export class ShopOrderNotFoundError extends AppError {
  readonly code = 'SHOP_ORDER_NOT_FOUND';
  constructor(message = '商店订单不存在') {
    super(message);
  }
}

export class ShopOrderAlreadyClaimedError extends AppError {
  readonly code = 'SHOP_ORDER_ALREADY_CLAIMED';
  constructor(message = '订单已被领取或正在领取中') {
    super(message);
  }
}

export class ShopOrderExpiredError extends AppError {
  readonly code = 'SHOP_ORDER_EXPIRED';
  constructor(message = '订单已过期') {
    super(message);
  }
}

// ----- CDK 域（P2） -----
export class CdkNotFoundError extends AppError {
  readonly code = 'CDK_NOT_FOUND';
  constructor(message = 'CDK 兑换码不存在') {
    super(message);
  }
}

export class CdkAlreadyClaimedError extends AppError {
  readonly code = 'CDK_ALREADY_CLAIMED';
  constructor(message = 'CDK 兑换码已被领取或正在领取中') {
    super(message);
  }
}

export class CdkExpiredError extends AppError {
  readonly code = 'CDK_EXPIRED';
  constructor(message = 'CDK 兑换码已过期') {
    super(message);
  }
}

// ----- P3 聊天 / 投票 / 玩家绑定 域 -----

export class ChatTriggerNotFoundError extends AppError {
  readonly code = 'CHAT_TRIGGER_NOT_FOUND';
  constructor(message = '聊天触发响应不存在') {
    super(message);
  }
}

export class VoteNotFoundError extends AppError {
  readonly code = 'VOTE_NOT_FOUND';
  constructor(message = '投票不存在') {
    super(message);
  }
}

export class VoteAlreadyClosedError extends AppError {
  readonly code = 'VOTE_ALREADY_CLOSED';
  constructor(message = '投票已结束') {
    super(message);
  }
}

export class VoteAlreadyCastError extends AppError {
  readonly code = 'VOTE_ALREADY_CAST';
  constructor(message = '该玩家已对此投票表态') {
    super(message);
  }
}

export class PlayerBindingNotFoundError extends AppError {
  readonly code = 'PLAYER_BINDING_NOT_FOUND';
  constructor(message = '玩家绑定记录不存在') {
    super(message);
  }
}

export class PlayerBindingAlreadyExistsError extends AppError {
  readonly code = 'PLAYER_BINDING_ALREADY_EXISTS';
  constructor(message = '玩家绑定已存在（同 user_id + scope_ref 或同 game_player_name + scope_ref + status）') {
    super(message);
  }
}

export class PlayerBindingVerifyCodeInvalidError extends AppError {
  readonly code = 'PLAYER_BINDING_VERIFY_CODE_INVALID';
  constructor(message = '验证码不正确') {
    super(message);
  }
}

export class PlayerBindingNotPendingError extends AppError {
  readonly code = 'PLAYER_BINDING_NOT_PENDING';
  constructor(message = '玩家绑定记录非 pending 状态，无法审核') {
    super(message);
  }
}

// ----- 游戏内验证码域（player_verify_codes，!verify 命令使用） -----
export class VerifyCodeNotFoundError extends AppError {
  readonly code = 'VERIFY_CODE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = '验证码不存在') {
    super(message);
  }
}

export class VerifyCodeExpiredError extends AppError {
  readonly code = 'VERIFY_CODE_EXPIRED';
  readonly httpStatus = 410;
  constructor(message = '验证码已过期') {
    super(message);
  }
}

export class VerifyCodeAlreadyUsedError extends AppError {
  readonly code = 'VERIFY_CODE_ALREADY_USED';
  readonly httpStatus = 409;
  constructor(message = '验证码已使用') {
    super(message);
  }
}

export class PlayerBindingMismatchError extends AppError {
  readonly code = 'PLAYER_BINDING_MISMATCH';
  readonly httpStatus = 400;
  constructor(message = '游戏玩家名或服务器不匹配') {
    super(message);
  }
}

export class PeriodicMessageNotFoundError extends AppError {
  readonly code = 'PERIODIC_MESSAGE_NOT_FOUND';
  constructor(message = '定时消息不存在') {
    super(message);
  }
}

// ----- P4 Mods / 存档 / 备份 / 监控 / 白名单黑名单 域 -----

export class ModNotFoundError extends AppError {
  readonly code = 'MOD_NOT_FOUND';
  constructor(message = 'Mod 记录不存在') {
    super(message);
  }
}

export class ModAlreadyExistsError extends AppError {
  readonly code = 'MOD_ALREADY_EXISTS';
  constructor(message = 'Mod 已存在（同 server_id + mod_name + version）') {
    super(message);
  }
}

export class SaveNotFoundError extends AppError {
  readonly code = 'SAVE_NOT_FOUND';
  constructor(message = '存档记录不存在') {
    super(message);
  }
}

export class SaveAlreadyExistsError extends AppError {
  readonly code = 'SAVE_ALREADY_EXISTS';
  constructor(message = '存档已存在（同 server_id + save_name）') {
    super(message);
  }
}

export class BackupNotFoundError extends AppError {
  readonly code = 'BACKUP_NOT_FOUND';
  constructor(message = '备份记录不存在') {
    super(message);
  }
}

export class SnapshotNotFoundError extends AppError {
  readonly code = 'SNAPSHOT_NOT_FOUND';
  constructor(message = '监控快照不存在') {
    super(message);
  }
}

export class ListEntryNotFoundError extends AppError {
  readonly code = 'LIST_ENTRY_NOT_FOUND';
  constructor(message = '白名单/黑名单条目不存在') {
    super(message);
  }
}

export class ListEntryAlreadyExistsError extends AppError {
  readonly code = 'LIST_ENTRY_ALREADY_EXISTS';
  constructor(message = '白名单/黑名单条目已存在（同 server_id + list_type + player_name）') {
    super(message);
  }
}

// ----- Webhook 域（P5） -----
export class WebhookNotFoundError extends AppError {
  readonly code = 'WEBHOOK_NOT_FOUND';
  constructor(message = 'Webhook 不存在') {
    super(message);
  }
}

export class WebhookDeliveryError extends AppError {
  readonly code = 'WEBHOOK_DELIVERY_FAILED';
  constructor(message = 'Webhook 投递失败') {
    super(message);
  }
}

// ----- VIP-实例绑定域（统一 bindings 表，v4.17.0 起） -----
export class BindingAlreadyExistsError extends AppError {
  readonly code = 'BINDING_ALREADY_EXISTS';
  readonly httpStatus = 409;
  constructor(message = '该实例已绑定（active 状态），请先解绑') {
    super(message);
  }
}

export class BindingNotFoundError extends AppError {
  readonly code = 'BINDING_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = '绑定记录不存在或已解绑') {
    super(message);
  }
}

/**
 * 用户未绑定实例且非 owner/server_admin，访问实例作用域资源被拒绝。
 * 用于 shopService.createOrder 等入口校验（v2.1.0 改造为按实例作用域）。
 */
export class BindingRequiredError extends AppError {
  readonly code = 'BINDING_REQUIRED';
  readonly httpStatus = 403;
  constructor(message = '需先绑定实例才能使用此功能') {
    super(message);
  }
}

// ----- P4 扩展域（Task 4-10 Factorio 集成新增） -----

/** Pack 未声明某能力字段（如 world_generation/mods/saves/config_files/update/chat_log） */
export class PackCapabilityNotDeclaredError extends AppError {
  readonly code = 'PACK_CAPABILITY_NOT_DECLARED';
  readonly httpStatus = 404;
  constructor(message = 'Pack 未声明此能力') {
    super(message);
  }
}

/** 配置文件不存在（Pack config_files 声明中找不到对应 name） */
export class ConfigFileNotFoundError extends AppError {
  readonly code = 'CONFIG_FILE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = '配置文件不存在') {
    super(message);
  }
}

/** 配置文件只读，禁止写入 */
export class ConfigFileReadOnlyError extends AppError {
  readonly code = 'CONFIG_FILE_READ_ONLY';
  readonly httpStatus = 403;
  constructor(message = '配置文件只读，禁止写入') {
    super(message);
  }
}

/** 地图生成命令执行失败 */
export class WorldGenError extends AppError {
  readonly code = 'WORLD_GEN_FAILED';
  readonly httpStatus = 500;
  constructor(message = '地图生成失败') {
    super(message);
  }
}

/** Mod 依赖冲突 */
export class ModDependencyError extends AppError {
  readonly code = 'MOD_DEPENDENCY_CONFLICT';
  readonly httpStatus = 400;
  constructor(message = 'Mod 依赖冲突') {
    super(message);
  }
}

/** Mod 下载失败 */
export class ModDownloadError extends AppError {
  readonly code = 'MOD_DOWNLOAD_FAILED';
  readonly httpStatus = 502;
  constructor(message = 'Mod 下载失败') {
    super(message);
  }
}

/** 游戏更新检查失败 */
export class UpdateCheckError extends AppError {
  readonly code = 'UPDATE_CHECK_FAILED';
  readonly httpStatus = 502;
  constructor(message = '游戏更新检查失败') {
    super(message);
  }
}

/** 游戏更新应用失败 */
export class UpdateApplyError extends AppError {
  readonly code = 'UPDATE_APPLY_FAILED';
  readonly httpStatus = 500;
  constructor(message = '游戏更新应用失败') {
    super(message);
  }
}

/** 聊天日志解析失败 */
export class ChatLogParseError extends AppError {
  readonly code = 'CHAT_LOG_PARSE_FAILED';
  constructor(message = '聊天日志解析失败') {
    super(message);
  }
}

// ----- 经济系统域（点券钱包） -----

/** 用户钱包余额不足 */
export class InsufficientBalanceError extends AppError {
  readonly code = 'INSUFFICIENT_BALANCE';
  readonly httpStatus = 400;
  constructor(message = '点券余额不足') {
    super(message);
  }
}

/** 今日已领取每日点券奖励，不可重复领取 */
export class DailyRewardAlreadyClaimedError extends AppError {
  readonly code = 'DAILY_REWARD_ALREADY_CLAIMED';
  readonly httpStatus = 409;
  constructor(message = '今日已领取每日点券奖励，请明日再来') {
    super(message);
  }
}

// ----- 用户中心经济系统域（global_balances / instance_points / user_integrals / withdraw_codes） -----

/** 余额已达充值上限（balance >= recharge_max），所有充值入口禁用 */
export class RechargeLimitExceededError extends AppError {
  readonly code = 'RECHARGE_LIMIT_EXCEEDED';
  readonly httpStatus = 409;
  constructor(message = '余额已达充值上限，请消费后再充值') {
    super(message);
  }
}

/** 超出单日消费上限（今日消费 + 本次金额 > daily_max） */
export class DailyLimitExceededError extends AppError {
  readonly code = 'DAILY_LIMIT_EXCEEDED';
  readonly httpStatus = 400;
  constructor(message = '超出单日消费上限') {
    super(message);
  }
}

/** 冻结余额不足（解冻金额 > frozen_balance） */
export class InsufficientFrozenBalanceError extends AppError {
  readonly code = 'INSUFFICIENT_FROZEN_BALANCE';
  readonly httpStatus = 400;
  constructor(message = '冻结余额不足') {
    super(message);
  }
}

/** 提现账期未满（最后一笔收入类交易未满 7 天） */
export class WithdrawPeriodNotMetError extends AppError {
  readonly code = 'WITHDRAW_PERIOD_NOT_MET';
  readonly httpStatus = 400;
  constructor(message = '账期未满：最后一笔收入需满 7 天后方可提现') {
    super(message);
  }
}

/** 提现码不存在 */
export class WithdrawCodeNotFoundError extends AppError {
  readonly code = 'WITHDRAW_CODE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = '提现码不存在') {
    super(message);
  }
}

/** 提现码已处理（非 pending 状态，不可重复核销/拒绝） */
export class WithdrawCodeAlreadyProcessedError extends AppError {
  readonly code = 'WITHDRAW_CODE_ALREADY_PROCESSED';
  readonly httpStatus = 409;
  constructor(message = '提现码已处理，不可重复操作') {
    super(message);
  }
}

/** 实例未配置对应 VIP 购买方式的定价（vip_monthly_price / vip_lifetime_price 为 NULL） */
export class VipPricingNotConfiguredError extends AppError {
  readonly code = 'VIP_PRICING_NOT_CONFIGURED';
  readonly httpStatus = 400;
  constructor(message = '该实例未开放此 VIP 购买方式') {
    super(message);
  }
}

/** 已拥有有效 VIP（买断制不可重复购买，订阅制未到期不可续购） */
export class VipAlreadyActiveError extends AppError {
  readonly code = 'VIP_ALREADY_ACTIVE';
  readonly httpStatus = 409;
  constructor(message = '已拥有有效的 VIP，不可重复购买') {
    super(message);
  }
}

/** 通用越权错误（如非实例管理员修改定价配置） */
export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message = '无权执行此操作') {
    super(message);
  }
}

// v4.3.0 文件管理相关错误 —— 因 fileService 需要按运行时条件抛出多种错误码，
// 此处定义一个通用类避免为每个 code 创建独立子类。HTTP 状态由 files 路由层的
// ERROR_CODE_TO_STATUS 映射决定，此处不强制 httpStatus。
export class FileOperationError extends AppError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
