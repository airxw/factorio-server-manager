// ============================================================================
// Store Workbench 公共格式化工具
// 去重 ReportsRevenue / ReportsPlaytime / Players / Servers / StoreHome 中的复制
// ============================================================================

/** 金额格式化：超过 1 万显示「X.XX万」，否则保留两位小数 */
export function formatMoney(n: number): string {
  if (n >= 10000) return `¥${(n / 10000).toFixed(2)}万`;
  return `¥${n.toFixed(2)}`;
}

/** 金额格式化（精度版，不缩万）：用于表格/明细行 */
export function formatCurrency(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

/** 时长格式化：秒 → 「Xh Ym」/「Ym」/「Zs」 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds % 60)}s`;
}

// ---------------------------------------------------------------------------
// 实例状态映射（StoreHome / Servers / ServerDetailStore 共用）
// ---------------------------------------------------------------------------

export type InstanceStatusTone = 'emerald' | 'slate' | 'blue' | 'amber' | 'rose';

export interface InstanceStatusMeta {
  label: string;
  tone: InstanceStatusTone;
  pulse?: boolean;
}

export const INSTANCE_STATUS_MAP: Record<string, InstanceStatusMeta> = {
  running: { label: '运行中', tone: 'emerald' },
  stopped: { label: '已停止', tone: 'slate' },
  starting: { label: '启动中', tone: 'blue', pulse: true },
  stopping: { label: '停止中', tone: 'amber', pulse: true },
  error: { label: '异常', tone: 'rose' },
};

export function getInstanceStatusMeta(status: string): InstanceStatusMeta {
  return INSTANCE_STATUS_MAP[status] ?? { label: status ?? '未知', tone: 'slate' };
}

// ---------------------------------------------------------------------------
// 玩家状态映射（Players 共用）
// ---------------------------------------------------------------------------

export type PlayerStatusTone = 'emerald' | 'amber' | 'rose' | 'slate';

export interface PlayerStatusMeta {
  label: string;
  tone: PlayerStatusTone;
}

export const PLAYER_STATUS_MAP: Record<string, PlayerStatusMeta> = {
  active: { label: '活跃', tone: 'emerald' },
  disabled: { label: '已禁用', tone: 'slate' },
  banned: { label: '已封禁', tone: 'rose' },
  unknown: { label: '未知', tone: 'amber' },
};

export function getPlayerStatusMeta(status: string): PlayerStatusMeta {
  return PLAYER_STATUS_MAP[status] ?? { label: status ?? '未知', tone: 'slate' };
}

// ---------------------------------------------------------------------------
// 报表天数选项（ReportsRevenue / ReportsPlaytime 共用）
// ---------------------------------------------------------------------------

export const REPORT_DAY_OPTIONS = [7, 30, 90] as const;
