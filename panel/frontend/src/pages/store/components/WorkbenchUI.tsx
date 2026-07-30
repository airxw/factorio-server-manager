// ============================================================================
// WorkbenchUI — Store Workbench 设计系统（DS）核心
// 视觉基线：浅色 Apple 生产力风 + 克制阴影 + 统一圆角体系
// 主 CTA 色：iOS 蓝 #007AFF（v4.x 起锁定，见 docs/plans/store-ui-polish-plan.md §3.2）
// 装饰 Tone：blue/violet/emerald/amber/rose/slate 保留用于 KPI/状态分级
// 圆角规范：大容器 16px(rounded-2xl)、卡片 12px(rounded-xl)、小元素 8px(rounded-lg)、胶囊 999px(rounded-full)
// 间距规范：区块间距 20px(space-y-5)、卡片内距 20px(p-5)
// 用法约束：所有 /store 业务页强制以此 DS 为唯一页面骨架语言，禁止再新增 daisyUI 裸拼页面
// ============================================================================

import type { ReactNode } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';

export type Tone = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';

const TONE_STYLES: Record<Tone, { icon: string; chip: string; accent: string }> = {
  blue: {
    icon: 'bg-blue-50 text-blue-600 ring-blue-100',
    chip: 'bg-blue-50 text-blue-700 ring-blue-100',
    accent: 'text-blue-600',
  },
  violet: {
    icon: 'bg-violet-50 text-violet-600 ring-violet-100',
    chip: 'bg-violet-50 text-violet-700 ring-violet-100',
    accent: 'text-violet-600',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    accent: 'text-emerald-600',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-600 ring-amber-100',
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
    accent: 'text-amber-600',
  },
  rose: {
    icon: 'bg-rose-50 text-rose-600 ring-rose-100',
    chip: 'bg-rose-50 text-rose-700 ring-rose-100',
    accent: 'text-rose-600',
  },
  slate: {
    icon: 'bg-slate-100 text-slate-600 ring-slate-200',
    chip: 'bg-slate-100 text-slate-700 ring-slate-200',
    accent: 'text-slate-600',
  },
};

// iOS 蓝主 CTA 色常量（v4.x 锁定，全 /store 基座唯一主按钮色）
export const IOS_BLUE = '#007AFF';
export const IOS_BLUE_HOVER = '#0A84FF';
export const IOS_BLUE_RING = 'focus-visible:ring-blue-300';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// 页级骨架
// ---------------------------------------------------------------------------

export function WorkbenchShell({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

interface WorkbenchHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  badges?: Array<{ label: string; value: string; tone?: Tone }>;
}

export function WorkbenchHeader({
  eyebrow,
  title,
  description,
  actions,
  badges,
}: WorkbenchHeaderProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {badges && badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <WorkbenchChip key={`${badge.label}-${badge.value}`} tone={badge.tone ?? 'slate'}>
              <span className="font-medium">{badge.label}</span>
              <span className="text-slate-400">/</span>
              <span>{badge.value}</span>
            </WorkbenchChip>
          ))}
        </div>
      )}
    </section>
  );
}

interface WorkbenchMetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  extra?: ReactNode;
}

export function WorkbenchMetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  extra,
}: WorkbenchMetricCardProps) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <article className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">{label}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-slate-900">
            {value}
          </p>
          {hint && <p className="mt-2 text-sm leading-5 text-slate-500">{hint}</p>}
        </div>
        <div
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1',
            toneStyle.icon,
          )}
        >
          <Icon size={20} />
        </div>
      </div>
      {extra && <div className="mt-4">{extra}</div>}
    </article>
  );
}

interface WorkbenchSectionProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkbenchSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: WorkbenchSectionProps) {
  return (
    <section
      className={cx(
        'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:p-6',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Icon size={14} />
              </span>
            )}
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
          </div>
          {description && <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

interface WorkbenchEmptyProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}

export function WorkbenchEmpty({
  title,
  description,
  action,
  icon: Icon,
  tone = 'slate',
}: WorkbenchEmptyProps) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-5 py-8 text-center">
      {Icon && (
        <div
          className={cx(
            'mx-auto flex h-12 w-12 items-center justify-center rounded-xl ring-1',
            toneStyle.icon,
          )}
        >
          <Icon size={20} />
        </div>
      )}
      <p className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-slate-800">{title}</p>
      <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function WorkbenchChip({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1',
        TONE_STYLES[tone].chip,
      )}
    >
      {children}
    </span>
  );
}

export function WorkbenchLinkAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
    >
      {label}
      <ArrowRight size={12} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 按钮（v4.x 起：主按钮锁定 iOS 蓝，禁止 daisyUI btn-primary/ghost 混用）
// ---------------------------------------------------------------------------

interface WorkbenchPrimaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  children: ReactNode;
}

export function WorkbenchPrimaryButton({
  icon: Icon,
  children,
  className,
  ...rest
}: WorkbenchPrimaryButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-[40px] items-center gap-2 rounded-full bg-[#007AFF] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#0A84FF] active:bg-[#0066DD] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2',
        className,
      )}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

interface WorkbenchSecondaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  children: ReactNode;
}

export function WorkbenchSecondaryButton({
  icon: Icon,
  children,
  className,
  ...rest
}: WorkbenchSecondaryButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2',
        className,
      )}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

interface WorkbenchIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: 'slate' | 'rose';
}

export function WorkbenchIconButton({
  icon: Icon,
  label,
  tone = 'slate',
  className,
  ...rest
}: WorkbenchIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-11 w-11 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1',
        tone === 'rose'
          ? 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
    >
      <Icon size={18} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 筛选条（替代 daisyUI select-bordered / join / input-bordered 裸拼）
// ---------------------------------------------------------------------------

export function WorkbenchFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
      {children}
    </div>
  );
}

interface WorkbenchSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function WorkbenchSelect({ label, className, children, ...rest }: WorkbenchSelectProps) {
  return (
    <label className="flex items-center gap-2">
      {label && (
        <span className="text-xs font-medium text-slate-500">{label}</span>
      )}
      <select
        {...rest}
        className={cx(
          'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        {children}
      </select>
    </label>
  );
}

interface WorkbenchSearchInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
}

export function WorkbenchSearchInput({
  icon: Icon,
  className,
  ...rest
}: WorkbenchSearchInputProps) {
  return (
    <div className={cx('relative min-w-[220px] flex-1 max-w-sm', className)}>
      {Icon && (
        <Icon
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
      )}
      <input
        type="text"
        {...rest}
        className={cx(
          'w-full rounded-full border border-slate-200 bg-white py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
          Icon ? 'pl-10 pr-4' : 'px-4',
        )}
      />
    </div>
  );
}

interface WorkbenchSegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface WorkbenchSegmentedProps<T extends string | number> {
  value: T;
  options: WorkbenchSegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export function WorkbenchSegmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: WorkbenchSegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50/80 p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-xs font-medium transition',
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 状态徽章（抽自 StoreHome StatusBadge，浅底深字克制色）
// ---------------------------------------------------------------------------

export type WorkbenchStatusTone = 'emerald' | 'slate' | 'blue' | 'amber' | 'rose';

const STATUS_TONE_CLASS: Record<WorkbenchStatusTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
};

const STATUS_DOT_CLASS: Record<WorkbenchStatusTone, string> = {
  emerald: 'bg-emerald-500',
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

interface WorkbenchStatusBadgeProps {
  label: string;
  tone?: WorkbenchStatusTone;
  pulse?: boolean;
}

export function WorkbenchStatusBadge({
  label,
  tone = 'slate',
  pulse = false,
}: WorkbenchStatusBadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1',
        STATUS_TONE_CLASS[tone],
      )}
    >
      <span
        className={cx(
          'inline-block h-2 w-2 rounded-full',
          STATUS_DOT_CLASS[tone],
          pulse && 'animate-pulse',
        )}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 信息提示（替代 daisyUI alert alert-info/warning，浅底深字带图标）
// ---------------------------------------------------------------------------

interface WorkbenchNoteProps {
  tone?: 'blue' | 'amber' | 'emerald' | 'rose';
  icon?: LucideIcon;
  children: ReactNode;
}

export function WorkbenchNote({ tone = 'blue', icon: Icon, children }: WorkbenchNoteProps) {
  const cls = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  }[tone];
  return (
    <div className={cx('rounded-xl px-4 py-3 text-sm ring-1', cls)}>
      <div className="flex items-start gap-2">
        {Icon && <Icon size={15} className="mt-0.5 shrink-0" />}
        <span className="leading-6">{children}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 图表框（标题 + 图例 + hover 浮层槽）
// ---------------------------------------------------------------------------

interface WorkbenchChartFrameProps {
  title: string;
  description?: string;
  legend?: ReactNode;
  children: ReactNode;
}

export function WorkbenchChartFrame({ title, description, legend, children }: WorkbenchChartFrameProps) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{title}</p>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {legend && <div className="flex flex-wrap items-center gap-3">{legend}</div>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页级骨架（与成稿同构：Header + KPI 行 + 双栏 Section）
// ---------------------------------------------------------------------------

export function WorkbenchPageSkeleton() {
  return (
    <WorkbenchShell>
      <div className="h-36 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-slate-200/80 bg-white/80"
          />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
        <div className="h-72 animate-pulse rounded-2xl border border-slate-200/80 bg-white/80" />
      </div>
    </WorkbenchShell>
  );
}

// ---------------------------------------------------------------------------
// 表格行 hover 包装（包现有 DataTable 不破坏 API，仅外观对齐）
// ---------------------------------------------------------------------------

export function WorkbenchTableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="table-wrap">{children}</div>
    </div>
  );
}

export function getWorkbenchToneClass(tone: Tone = 'slate') {
  return TONE_STYLES[tone];
}
